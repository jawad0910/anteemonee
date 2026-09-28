/* ==========================================
   Anteemonee Chatbot - Full Implementation
   ========================================== */

(function () {
  'use strict';

  // â”€â”€ State â”€â”€
  const api = new AiApiService();
  let conversations = [];
  let activeConversationId = null;
  let messages = [];
  let isStreaming = false;
  let studentContext = null;
  const pendingImages = []; // Array of base64 data URLs, max 3
  let pendingQuizTopic = false;

  // â”€â”€ Per-user localStorage keys â”€â”€
  function chatStorageKey() {
    var base = (typeof currentUser !== 'undefined' && currentUser?.id) ? 'Anteemonee_ai_conversations_' + currentUser.id : 'Anteemonee_ai_conversations_anon';
    return base + '_' + subjectSlug(selectedSubject);
  }
  function personaStorageKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'Anteemonee_ai_persona_' + currentUser.id;
    return 'Anteemonee_ai_persona_anon';
  }
  function sessionStateKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'Anteemonee_ai_session_' + currentUser.id;
    return 'Anteemonee_ai_session_anon';
  }

  // ── Chat store: premium → Supabase DB (all devices), free/guest → localStorage only ──
  let isPremiumTier = false;

  async function refreshTier() {
    isPremiumTier = false;
    try {
      if (typeof Access !== 'undefined' && Access.state.ready) {
        isPremiumTier = Access.state.access;
      } else if (typeof db !== 'undefined' && db) {
        const { data: ent } = await db.rpc('get_entitlement_snapshot');
        isPremiumTier = (typeof Access !== 'undefined' && Access.isPaidEntitlement(ent));
      }
    } catch (_) { isPremiumTier = false; }
    return isPremiumTier;
  }

  function currentUserId() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) return currentUser.id;
    } catch (_) {}
    return null;
  }

  function readLocalConversations() {
    let arr = [];
    try {
      const raw = localStorage.getItem(chatStorageKey());
      arr = JSON.parse(raw || '[]');
      if (!Array.isArray(arr)) arr = [];
    } catch (_) { arr = []; }
    arr.forEach(c => {
      if (c.title && /\{/.test(c.title)) {
        c.title = c.title.replace(/\{.*$/g, '').trim() || 'New Chat';
      }
    });
    return arr;
  }

  function writeLocalConversations() {
    try {
      localStorage.setItem(chatStorageKey(), JSON.stringify(conversations));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        // Strip images from old conversations to free space, then retry
        for (let i = conversations.length - 1; i >= 0; i--) {
          conversations[i].messages.forEach(m => { m.images = null; });
        }
        try { localStorage.setItem(chatStorageKey(), JSON.stringify(conversations)); } catch (_) {}
      }
    }
  }

  // ── Pinned chats helpers (per-user, localStorage + optional DB column) ──
  function pinnedStorageKey() {
    var uid = currentUserId();
    var base = uid ? 'Anteemonee_pinned_' + uid : 'Anteemonee_pinned_anon';
    return base + '_' + subjectSlug(selectedSubject);
  }
  function loadPinnedMap() {
    try {
      var raw = localStorage.getItem(pinnedStorageKey());
      var obj = JSON.parse(raw || '{}');
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) { return {}; }
  }
  function savePinnedMap(map) {
    try { localStorage.setItem(pinnedStorageKey(), JSON.stringify(map || {})); } catch (_) {}
  }
  function applyPinnedState() {
    try {
      var map = loadPinnedMap();
      var changed = false;
      conversations.forEach(function(c){
        var shouldPinned = !!map[c.id];
        // if conversation already has pinned from DB, respect it but sync map
        if (typeof c.pinned === 'boolean') {
          shouldPinned = c.pinned || shouldPinned;
        }
        if (c.pinned !== shouldPinned) changed = true;
        c.pinned = shouldPinned;
        if (shouldPinned) map[c.id] = true; else delete map[c.id];
      });
      if (changed) savePinnedMap(map);
      // also clean map from deleted conversations
      var ids = {};
      conversations.forEach(function(c){ ids[c.id]=1; });
      var map2 = loadPinnedMap();
      var needSave=false;
      Object.keys(map2).forEach(function(k){ if(!ids[k]){ delete map2[k]; needSave=true; } });
      if(needSave) savePinnedMap(map2);
    } catch (_) {}
  }
  async function togglePin(id) {
    var conv = conversations.find(function(c){ return c.id === id; });
    if (!conv) return;
    var map = loadPinnedMap();
    var next = !conv.pinned;
    conv.pinned = next;
    if (next) map[id] = true; else delete map[id];
    savePinnedMap(map);
    renderHistory();
    try { showChatToast(next ? 'Pinned' : 'Unpinned'); } catch (_) {}
    if (isPremiumTier && currentUserId()) {
      try {
        var res = await db.from('chat_conversations').update({ pinned: !!next }).eq('id', conv.id);
        if (res && res.error && /pinned|column/i.test(res.error.message||'')) {
          // column missing -> local map is fallback
        }
      } catch (_) {}
      persistConversation(id);
    } else {
      writeLocalConversations();
    }
  }

  // Persist one conversation to the DB (premium only). Safe to fire-and-forget.
  async function saveConversationToDb(conv) {
    const uid = currentUserId();
    if (!uid || !conv) return false;
    try {
      const subj = conv.subject || selectedSubject || 'Physics';
      const row = {
        id: conv.id,
        user_id: uid,
        title: conv.title || 'New Chat',
        title_locked: !!conv.titleLocked,
        messages: Array.isArray(conv.messages) ? conv.messages : [],
        updated_at: new Date().toISOString(),
        subject: subj,
      };
      // pinned column is optional — try to include it if present in conv
      if (typeof conv.pinned === 'boolean') row.pinned = !!conv.pinned;
      const { error } = await db.from('chat_conversations').upsert(row, { onConflict: 'id' });
      if (error) {
        // fallback if subject/pinned column missing
        if (/subject|pinned|column/i.test(error.message||'')) {
          if (typeof row.subject !== 'undefined' && /subject|column/i.test(error.message||'')) delete row.subject;
          if (typeof row.pinned !== 'undefined' && /pinned|column/i.test(error.message||'')) delete row.pinned;
          const retry = await db.from('chat_conversations').upsert(row, { onConflict: 'id' });
          if (retry.error) return false;
        } else {
          return false;
        }
      }
      try { setMappedConvSubject(conv.id, subj); } catch (_) {}
      trimDbConversations(uid);
      return true;
    } catch (_) { return false; }
  }

  // Keep only the 50 most recent DB chats per user (best effort, background).
  function trimDbConversations(uid) {
    try {
      db.from('chat_conversations').select('id').eq('user_id', uid).order('updated_at', { ascending: false }).range(50, 500)
        .then(({ data }) => {
          const ids = (data || []).map(r => r.id).filter(Boolean);
          if (ids.length) db.from('chat_conversations').delete().in('id', ids).then(() => {}).catch(() => {});
        }).catch(() => {});
    } catch (_) {}
  }

  async function loadConversationsFromDb(uid) {
    try {
      const { data, error } = await db.from('chat_conversations')
        .select('id,title,title_locked,messages,pinned,subject')
        .eq('user_id', uid).order('updated_at', { ascending: false }).limit(150);
      if (!error && data) {
        return data.map(r => {
          var subj = resolveConvSubject(r);
          if (r && r.id && isKnownSubject(r.subject)) setMappedConvSubject(r.id, r.subject);
          return {
            id: r.id,
            title: r.title || 'New Chat',
            titleLocked: !!r.title_locked,
            messages: Array.isArray(r.messages) ? r.messages : [],
            pinned: !!r.pinned,
            subject: subj,
          };
        });
      }
    } catch (_) {}
    try {
      const { data, error } = await db.from('chat_conversations')
        .select('id,title,title_locked,messages,pinned')
        .eq('user_id', uid).order('updated_at', { ascending: false }).limit(150);
      if (!error && data) {
        return data.map(r => ({
          id: r.id,
          title: r.title || 'New Chat',
          titleLocked: !!r.title_locked,
          messages: Array.isArray(r.messages) ? r.messages : [],
          pinned: !!r.pinned,
          subject: resolveConvSubject(r),
        }));
      }
    } catch (_) {}
    const { data, error } = await db.from('chat_conversations')
      .select('id,title,title_locked,messages')
      .eq('user_id', uid).order('updated_at', { ascending: false }).limit(150);
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      title: r.title || 'New Chat',
      titleLocked: !!r.title_locked,
      messages: Array.isArray(r.messages) ? r.messages : [],
      pinned: false,
      subject: resolveConvSubject(r),
    }));
  }

  async function deleteConversationFromDb(id) {
    try { await db.from('chat_conversations').delete().eq('id', id); } catch (_) {}
  }

  // Route a persistence write to DB (premium) or localStorage (free/guest).
  function persistConversation(convId) {
    try { if (window.__voiceEphemeral) return; } catch (_) {} // call chats: never saved
    if (isPremiumTier && currentUserId()) {
      const conv = conversations.find(c => c.id === (convId || activeConversationId));
      if (conv) saveConversationToDb(conv).catch(() => {});
    } else {
      writeLocalConversations();
    }
  }

  // ── 10-day chat TTL: chats older than 10 days are deleted automatically ──
  var CHAT_TTL_MS = 10 * 24 * 60 * 60 * 1000;

  function convTimestamp(c) {
    if (c && c.updatedAt) return c.updatedAt;
    if (c && c.createdAt) return c.createdAt;
    var m = /^conv_(\d+)$/.exec((c && c.id) || '');
    if (m) return parseInt(m[1], 10);
    return Date.now();
  }

  // Drop expired chats from the in-memory list (free-tier path). Returns true if removed. Pinned chats are exempt.
  function removeExpiredFromMemory() {
    var now = Date.now();
    var removed = false;
    conversations.forEach(function (c) {
      if (!c.updatedAt) c.updatedAt = convTimestamp(c); // backfill legacy chats
    });
    var kept = [];
    for (var i = 0; i < conversations.length; i++) {
      var conv = conversations[i];
      if (conv.pinned) { kept.push(conv); continue; }
      if (now - convTimestamp(conv) > CHAT_TTL_MS) removed = true;
      else kept.push(conv);
    }
    if (removed) conversations = kept;
    return removed;
  }

  function pruneLocalConversations() {
    if (!removeExpiredFromMemory()) return;
    writeLocalConversations();
    try { renderHistory(); } catch (_) {}
  }

  // Premium path: delete the user's chats older than 10 days from the DB. Pinned chats are exempt if column exists.
  async function pruneDbConversations(uid) {
    try {
      var cutoff = new Date(Date.now() - CHAT_TTL_MS).toISOString();
      try {
        // try to keep pinned chats
        var res = await db.from('chat_conversations').delete().eq('user_id', uid).lt('updated_at', cutoff).or('pinned.is.null,pinned.eq.false');
        if (res && res.error && /pinned|column/i.test(res.error.message||'')) throw res.error;
      } catch (e) {
        if (/pinned|column/i.test((e && e.message)||'')) {
          await db.from('chat_conversations').delete().eq('user_id', uid).lt('updated_at', cutoff);
        }
      }
    } catch (_) {}
  }

  async function initConversationStore() {
    const uid = currentUserId();
    if (isPremiumTier && uid) {
      try {
        await pruneDbConversations(uid);
        const rows = await loadConversationsFromDb(uid);
        // Separate chats per subject: only keep current subject
        const filtered = rows.filter(function(r){
          var s = r.subject || 'Physics';
          return s === selectedSubject;
        });
        const local = readLocalConversations();
        // Tag local rows with subject for consistency
        local.forEach(function(c){ if (!c.subject) c.subject = selectedSubject; });
        if (filtered.length === 0 && local.length > 0) {
          // One-time upgrade migration: push this browser's chats to the DB.
          conversations = local.slice(0, 50);
          for (const c of conversations) { c.subject = c.subject || selectedSubject; await saveConversationToDb(c); }
          // keep local per-subject key, do not remove — it is the free-tier store
        } else {
          conversations = filtered.slice(0, 50);
          // Merge any local-only chats for this subject not yet in DB
          var ids = {};
          conversations.forEach(function(c){ ids[c.id]=1; });
          local.forEach(function(c){
            if (!ids[c.id] && (c.subject||selectedSubject)===selectedSubject) conversations.push(c);
          });
          conversations = conversations.slice(0, 50);
        }
      } catch (_) {
        conversations = readLocalConversations();
      }
    } else {
      conversations = readLocalConversations();
    }
    try { applyPinnedState(); } catch (_) {}
    // Legacy migration: move old sessionStorage data to the active store
    try {
      const legacy = sessionStorage.getItem('Anteemonee_ai_conversations');
      if (legacy) {
        const legacyArr = JSON.parse(legacy);
        if (Array.isArray(legacyArr) && legacyArr.length > 0 && conversations.length === 0) {
          conversations = legacyArr;
          if (isPremiumTier && uid) {
            for (const c of conversations.slice(0, 50)) { await saveConversationToDb(c); }
          } else {
            writeLocalConversations();
          }
        }
        sessionStorage.removeItem('Anteemonee_ai_conversations');
      }
    } catch (_) {}
    try { applyPinnedState(); } catch (_) {}
    // Free-tier path: drop chats older than 10 days on every load.
    if (!(isPremiumTier && uid)) pruneLocalConversations();
  }

  // â”€â”€ Persist session state to localStorage (no tokens â€” always from DB) â”€â”€
  function saveSessionState() {
    try {
      const state = {
        activeSession: activeSession ? { id: activeSession.id, started_at: activeSession.started_at, expires_at: activeSession.expires_at, messages_count: activeSession.messages_count } : null,
        sessionUsage,
        streakCount,
        longestStreak,
      };
      localStorage.setItem(sessionStateKey(), JSON.stringify(state));
    } catch (_) {}
  }
  function loadSessionState() {
    try {
      const raw = localStorage.getItem(sessionStateKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function clearSessionState() {
    // Only clear session data, keep streak (it persists independently)
    try {
      const raw = localStorage.getItem(sessionStateKey());
      if (raw) {
        const state = JSON.parse(raw);
        state.activeSession = null;
        localStorage.setItem(sessionStateKey(), JSON.stringify(state));
      }
    } catch (_) {}
  }

  // â”€â”€ AI Session State â”€â”€
  let activeSession = null; // { id, started_at, expires_at, messages_count, tokens_used }
  let sessionUsage = null;  // { ai_limit, ai_used, period_end }
  let sessionTimerInterval = null;
  let estimatedTokensUsed = 0; // client-side running estimate
  let lastPromptTokens = 0; // full billed prompt of the latest request (system + RAG + history)
  let lastApiMessages = null; // frozen base payload of the latest request (for continuations)

  // â”€â”€ Streak State â”€â”€
  let streakCount = 0;
  let longestStreak = 0;

  // â”€â”€ Study Timer State â”€â”€
  let studyTimerInterval = null;   // setInterval ID
  let studyTimerAccumulated = 0;   // seconds accumulated, not yet saved
  const STUDY_SAVE_INTERVAL = 5;   // save to DB every 5s (was 30, too much lost on nav)

  function isStudyTimerRunning() {
    return !!studyTimerInterval;
  }

  function startStudyTimer() {
    if (studyTimerInterval) return; // already running
    studyTimerInterval = setInterval(() => {
      studyTimerAccumulated++;
      if (studyTimerAccumulated >= STUDY_SAVE_INTERVAL) {
        saveStudyTimeToDb(studyTimerAccumulated);
        studyTimerAccumulated = 0;
      }
    }, 1000);
  }

  function stopStudyTimer() {
    if (!studyTimerInterval) return;
    clearInterval(studyTimerInterval);
    studyTimerInterval = null;
    if (studyTimerAccumulated > 0) {
      saveStudyTimeToDb(studyTimerAccumulated);
      studyTimerAccumulated = 0;
    }
  }

  async function saveStudyTimeToDb(seconds) {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    try {
      await db.rpc('add_study_time', { p_seconds: seconds });
    } catch (e) { console.warn('[StudyTimer] save failed:', e); }
  }

  // â”€â”€ Model / Persona State â”€â”€
  const PERSONAS = [
    {
      name: 'AI', providerIndex: 0,
      background: 'Your name is Chipa Sahab. You run a welfare organization in Karachi, Pakistan, helping people in need. If a student asks about your welfare work, answer warmly and factually — mention that you are dedicated to helping the community in Karachi. If asked about politics or politicians, redirect gently back to studies. Keep it brief and offer to return to academics.',
    },
    {
      name: 'AI', providerIndex: 1,
      background: 'Your name is Coder. You are the founder of Anteemonee. If a student asks about you, share only what is relevant: you are 18 years old, your birthday is August 26, 2008, you are based in Rahim Yar Khan, you are Punjabi, and you are currently in A Levels. Do not volunteer all of this at once — only share details when the student asks specific questions about you. Keep answers brief and redirect back to the task.',
      codingOnly: true,
    },
  ];
  let activePersonaIndex = 0;

  // ── Subject State ──
  const CHAT_SUBJECTS = [
    { name: 'Physics', code: '9702', color: '#2E7D32', bg: 'rgba(46,125,50,0.15)' },
    { name: 'Chemistry', code: '9701', color: '#C49557', bg: 'rgba(196,149,87,0.15)' },
    { name: 'Biology', code: '9700', color: '#8E44AD', bg: 'rgba(142,68,173,0.15)' },
    { name: 'Computer Science', code: '9618', color: '#2980B9', bg: 'rgba(41,128,185,0.15)' },
    { name: 'Mathematics', code: '9709', color: '#8E44AD', bg: 'rgba(142,68,173,0.15)' },
    { name: 'English', code: '9093', color: '#F39C12', bg: 'rgba(243,156,18,0.15)' }
  ];
  let selectedSubject = 'Physics';
  function subjectSlug(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'physics'; }
  function subjectStorageKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'Anteemonee_ai_subject_' + currentUser.id;
    return 'Anteemonee_ai_subject_anon';
  }
  function getSelectedSubject() { return selectedSubject; }
  function getSubjectMeta(name) {
    var n = String(name || '').toLowerCase();
    return CHAT_SUBJECTS.find(function(s){ return s.name.toLowerCase() === n; }) || CHAT_SUBJECTS[0];
  }
  function loadSelectedSubject() {
    try {
      var saved = localStorage.getItem(subjectStorageKey());
      if (saved && CHAT_SUBJECTS.some(function(s){ return s.name === saved; })) {
        selectedSubject = saved;
      }
    } catch (_) {}
  }
  function saveSelectedSubject() {
    try { localStorage.setItem(subjectStorageKey(), selectedSubject); } catch (_) {}
  }
  // Per-conversation subject map (fallback when the DB has no subject column yet).
  // Without this, every DB row loads as 'Physics' and other subjects lose their chats on refresh.
  function convSubjectMapKey() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) return 'Anteemonee_conv_subjects_' + currentUser.id;
    } catch (_) {}
    return 'Anteemonee_conv_subjects_anon';
  }
  function isKnownSubject(name) {
    return CHAT_SUBJECTS.some(function(s){ return s.name === name; });
  }
  function getMappedConvSubject(id) {
    try {
      var m = JSON.parse(localStorage.getItem(convSubjectMapKey()) || '{}');
      var s = m && m[id];
      return isKnownSubject(s) ? s : null;
    } catch (_) { return null; }
  }
  function setMappedConvSubject(id, subj) {
    if (!id || !isKnownSubject(subj)) return;
    try {
      var key = convSubjectMapKey();
      var m = {};
      try { m = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { m = {}; }
      m[id] = subj;
      var keys = Object.keys(m);
      if (keys.length > 200) {
        var drop = keys.length - 200;
        for (var i = 0; i < drop; i++) delete m[keys[i]];
      }
      localStorage.setItem(key, JSON.stringify(m));
    } catch (_) {}
  }
  function removeMappedConvSubject(id) {
    try {
      var key = convSubjectMapKey();
      var m = JSON.parse(localStorage.getItem(key) || '{}') || {};
      if (m && m[id]) { delete m[id]; localStorage.setItem(key, JSON.stringify(m)); }
    } catch (_) {}
  }
  function resolveConvSubject(r) {
    if (r && isKnownSubject(r.subject)) return r.subject;
    var mapped = r && r.id ? getMappedConvSubject(r.id) : null;
    if (mapped) return mapped;
    return 'Physics';
  }
  function updateSubjectUI() {
    try {
      var meta = getSubjectMeta(selectedSubject);
      var dot = document.getElementById('subject-dot');
      var nameEl = document.getElementById('subject-name');
      var input = document.getElementById('chat-input');
      var pill = document.getElementById('subject-pill');
      if (dot) dot.style.background = meta.color;
      if (nameEl) nameEl.textContent = meta.name;
      if (input) input.placeholder = 'Ask anything about ' + meta.name + '...';
      if (pill) {
        pill.style.borderColor = meta.color + '40';
      }
      // Update welcome subtitle if needed
      var sub = document.querySelector('.welcome-subtitle');
      if (sub && selectedSubject) {
        // keep generic, but could show subject
      }
    } catch (_) {}
  }
  function renderSubjectList() {
    var list = document.getElementById('subject-list');
    if (!list) return;
    list.innerHTML = CHAT_SUBJECTS.map(function(s){
      var isActive = s.name === selectedSubject;
      return '<div class="subject-item' + (isActive ? ' active' : '') + '" data-subject="' + s.name.replace(/"/g,'&quot;') + '">' +
        '<span class="dot" style="background:' + s.color + '"></span>' +
        '<span>' + s.name + '</span>' +
        '</div>';
    }).join('');
    list.querySelectorAll('.subject-item').forEach(function(el){
      el.addEventListener('click', function(){
        var name = el.getAttribute('data-subject');
        selectSubject(name);
      });
    });
  }
  async function selectSubject(name) {
    if (!name || name === selectedSubject) {
      // just close dropdown
      var dd = document.getElementById('subject-dropdown');
      var pill = document.getElementById('subject-pill');
      if (dd) dd.classList.remove('open');
      if (pill) { pill.classList.remove('open'); pill.setAttribute('aria-expanded','false'); }
      return;
    }
    // Save current subject's conversations before switching
    // No need to explicitly save, they are already persisted via chatStorageKey
    selectedSubject = name;
    saveSelectedSubject();
    updateSubjectUI();
    renderSubjectList();
    var dd = document.getElementById('subject-dropdown');
    var pill = document.getElementById('subject-pill');
    if (dd) dd.classList.remove('open');
    if (pill) { pill.classList.remove('open'); pill.setAttribute('aria-expanded','false'); }
    // Reload conversations for new subject
    try { showChatsLoading('Loading ' + name + ' chats…'); } catch (_) {}
    try {
      // Clear current UI
      activeConversationId = null;
      messages = [];
      var ml = document.getElementById('messages-list');
      if (ml) ml.innerHTML = '';
      var welcome = document.getElementById('chat-welcome');
      if (welcome) welcome.style.display = 'flex';
      var mList = document.getElementById('messages-list');
      if (mList) mList.style.display = 'none';
      // Reload from storage/DB for new subject
      await initConversationStore();
      try { applyPinnedState(); } catch(_) {}
      renderHistory();
      // Update filtered view if needed
      var inp = document.getElementById('chat-input');
      if (inp) inp.focus();
    } catch(e) { console.warn('[Subject] switch failed', e); }
    finally { try { hideChatsLoading(); } catch (_) {} }
  }
  function setupSubjectDropdown() {
    var pill = document.getElementById('subject-pill');
    var dd = document.getElementById('subject-dropdown');
    var wrap = document.getElementById('subject-pill-wrap');
    if (!pill || !dd) return;
    if (pill.dataset.bound) return;
    pill.dataset.bound = '1';
    pill.addEventListener('click', function(e){
      e.stopPropagation();
      var isOpen = dd.classList.contains('open');
      if (isOpen) {
        dd.classList.remove('open');
        pill.classList.remove('open');
        pill.setAttribute('aria-expanded','false');
      } else {
        dd.classList.add('open');
        pill.classList.add('open');
        pill.setAttribute('aria-expanded','true');
        renderSubjectList();
      }
    });
    document.addEventListener('click', function(e){
      if (!wrap.contains(e.target)) {
        dd.classList.remove('open');
        pill.classList.remove('open');
        pill.setAttribute('aria-expanded','false');
      }
    });
    // Close on outside click for mobile
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') {
        dd.classList.remove('open');
        pill.classList.remove('open');
        pill.setAttribute('aria-expanded','false');
      }
    });
    renderSubjectList();
    updateSubjectUI();
  }

  // ── Chats loading screen ──
  var _chatsLoadingFallback = null;
  function showChatsLoading(text) {
    try {
      var el = document.getElementById('chats-loading');
      if (el) {
        var t = el.querySelector('.chats-loading-text');
        if (t && text) t.textContent = text;
        el.classList.remove('hidden');
      }
      // Safety: never trap the user behind the loader
      try {
        if (_chatsLoadingFallback) clearTimeout(_chatsLoadingFallback);
        _chatsLoadingFallback = setTimeout(function(){ try { hideChatsLoading(); } catch (_) {} }, 15000);
      } catch (_) {}
      var sh = document.getElementById('sidebar-history');
      if (sh) sh.classList.add('is-loading');
      var shm = document.getElementById('sidebar-history-mobile');
      if (shm) shm.classList.add('is-loading');
    } catch (_) {}
  }
  function hideChatsLoading() {
    try {
      if (_chatsLoadingFallback) { clearTimeout(_chatsLoadingFallback); _chatsLoadingFallback = null; }
    } catch (_) {}
    try {
      var el = document.getElementById('chats-loading');
      if (el) el.classList.add('hidden');
      var sh = document.getElementById('sidebar-history');
      if (sh) sh.classList.remove('is-loading');
      var shm = document.getElementById('sidebar-history-mobile');
      if (shm) shm.classList.remove('is-loading');
    } catch (_) {}
  }

  // Auto model routing: coding tasks use the coding persona, everything else the tutor persona
  function isCodingTask(text) {
    if (!text) return false;
    var t = String(text).toLowerCase();
    if (/```/.test(t)) return true;
    try {
      if (typeof GitHub !== "undefined" && GitHub.hasAttachedFiles && GitHub.hasAttachedFiles()) return true;
    } catch (_) {}
    var codingKeywords = [
      "code","coding","programming","program","algorithm","function","class ","variable","loop","array","object","api ","rest api","graphql",
      "python","javascript","typescript","java ","c++","c#"," html","css","php","sql","mysql","postgres","mongodb","node.js","nodejs","react","next.js","vue","angular","svelte","flutter","dart","kotlin","swift","go language","golang","rust ",
      "debug","bug ","error in code","stack trace","exception","compile","build app","build website","create app","create website","make app","make website","create a website","create an app","build a website","build an app",
      "github","git ","commit","pull request","repo","repository","docker","deploy","frontend","backend","full stack","fullstack"
    ];
    for (var i = 0; i < codingKeywords.length; i++) {
      if (t.indexOf(codingKeywords[i]) !== -1) return true;
    }
    if (/\b(def |import |from .* import|console\.log|print\(|printf|scanf|#include|public static void|system\.out\.println|select .* from|insert into|update .* set|function\s*\(|=>|<\s*html|<\s*div|<\s*body|<\s*head)\b/.test(t)) return true;
    if (/\b(write|create|build|make|generate|fix|debug)\b[^.?!]{0,45}\b(code|program|script|function|app|website|web app|api)\b/.test(t)) return true;
    return false;
  }
  function getPersonaForText(text) {
    return isCodingTask(text) ? PERSONAS[1] : PERSONAS[0];
  }
  function getProviderIndexForText(text) {
    return getPersonaForText(text).providerIndex;
  }
  function applyPersonaForText(text) {
    activePersonaIndex = isCodingTask(text) ? 1 : 0;
    return PERSONAS[activePersonaIndex];
  }

  function isQuizRequest(text) {
    if (!text || isCodingTask(text)) return false;
    var t = String(text).toLowerCase();
    if (/\b(?:quiz|test)\s+(?:me|us)\b/.test(t)) return true;
    if (/\b(?:mcq|multiple[ -]choice|self[ -]?test|question[ -]?paper|past[ -]paper)\b/.test(t)) return true;
    if (/\b(?:create|make|generate|give|prepare|practice|build|need|start)\b/.test(t) && /\b(?:questions?|quiz|test|exam)\b/.test(t)) return true;
    if (/\b(?:quiz|test)\s+(?:on|about|for|in)\b/.test(t)) return true;
    if (/^\s*(?:quiz|test|questions?)(?:\s+please)?\s*[?.!]*$/.test(t)) return true;
    if (/\b\d+\s+questions?\b/.test(t) && /\b(on|about|for|from|regarding|covering)\b/.test(t)) return true;
    return false;
  }

  function hasQuizTopic(text) {
    if (!text) return false;
    var t = String(text).trim();
    var colonMatch = t.match(/\b(?:quiz|test|mcq|questions?)\b\s*[:\-]\s*(.+)/i) || t.match(/\b(?:on|about|for|in|regarding|covering)\b\s*[:\-]\s*(.+)/i);
    if (colonMatch && colonMatch[1].trim().length > 1) return true;
    var match = t.match(/\b(?:quiz|test|mcq|questions?)\b[^.?!]{0,25}\b(?:on|about|for|in|regarding|covering)\b\s+(.+)/i);
    if (match && match[1].trim().length > 1) return true;
    return t.length > 42;
  }

  function shouldCreateQuiz(text) {
    if (isQuizRequest(text)) return true;
    return !!(pendingQuizTopic && text && !isInstantGreeting(text));
  }

  function quizProtocolPrompt() {
    return `

INTERACTIVE QUIZ CARD MODE:
The student is asking for a quiz, test, MCQ set, or question practice. Return exactly one valid JSON object in one fenced block tagged "quiz". Do not put the word quiz outside the block and do not add a preamble, closing message, references, or study suggestions.

Use this exact shape:
{
  "title": "Short title",
  "subject": "${typeof selectedSubject !== 'undefined' ? selectedSubject : 'General'}",
  "description": "One short sentence",
  "difficulty": "Easy|Medium|Hard",
  "questions": [
    {
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": 0,
      "explanation": "A concise explanation of why the answer is correct and why the tempting alternatives are not.",
      "hint": "A short optional hint"
    }
  ]
}

Rules:
- Use 5 to 10 questions unless the student explicitly requests another count. Use 2 to 6 options per question.
- "answer" is a zero-based index into "options". Exactly one answer must be correct.
- Keep questions accurate, independent, and appropriate for the selected subject and the student's level. Respect the requested topic, difficulty, and language.
- If the student did not provide a topic, use the selected subject as the topic and create a balanced foundational quiz. Only ask a clarifying question when the request is genuinely ambiguous.
- Escape quotes correctly. Do not use comments, trailing commas, HTML, or Markdown outside the JSON block.`;
  }

  function quizForModel(quiz) {
    var normalized = normalizeQuizData(quiz);
    if (!normalized) return '';
    var index = Math.min(normalized.currentIndex, normalized.questions.length - 1);
    var current = normalized.questions[index];
    if (!current) return '';
    var selected = normalized.answers[index];
    return JSON.stringify({
      title: normalized.title,
      currentQuestion: index + 1,
      totalQuestions: normalized.questions.length,
      question: current.question,
      options: current.options,
      correctAnswerIndex: current.answer,
      selectedAnswerIndex: selected === null || selected === undefined ? null : selected,
      explanation: current.explanation
    });
  }

  function recentQuizContextPrompt() {
    for (var i = messages.length - 1; i >= 0; i--) {
      var message = messages[i];
      if (!message || message.role !== 'assistant' || !message.quiz) continue;
      var context = quizForModel(message.quiz);
      if (!context) continue;
      return `

RECENT INTERACTIVE QUIZ CONTEXT:
${context}
Use this context if the student refers to the quiz, an answer, or a question number. Do not output a new quiz block unless the student explicitly asks for another quiz.`;
    }
    return '';
  }

  // â”€â”€ DOM â”€â”€
  const chatContent = document.getElementById('chat-content');
  const welcome = document.getElementById('chat-welcome');
  const messagesList = document.getElementById('messages-list');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const btnStop = document.getElementById('btn-stop');
  const sidebarHistory = document.getElementById('sidebar-history');
  const sidebarHistoryMobile = document.getElementById('sidebar-history-mobile');
  const modelSelectedName = document.getElementById('model-selected-name');
  const modelDot = document.getElementById('model-dot');
  const scrollDownBtn = document.getElementById('scroll-down-btn');
  const imagePreviewBar = document.getElementById('image-preview-bar');
  const btnPlus = document.getElementById('btn-plus');
  const plusWrapper = document.getElementById('plus-wrapper');
  const modesBar = document.getElementById('modes-bar');
  const imageFileInput = document.getElementById('image-file-input');
  // True when the user is reading near the newest message. Streaming only
  // auto-scrolls in that case, so it never yanks the user away mid-read.
  let userNearBottom = true;

  // â”€â”€ AI Preferences (from Settings â†’ AI Preferences, stored in user_preferences) â”€â”€
  let aiPrefs = {
    responseStyle: 'balanced',
    explanationLevel: 'standard',
    language: 'mixed',
    studySuggestions: true,
    memoryEnabled: true,
    personalization: '',
    emojis: false,
    references: false,
  };
  function referencesStorageKey() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) return 'Anteemonee_ai_references_' + currentUser.id;
    } catch (_) {}
    return 'Anteemonee_ai_references_anon';
  }

  // â”€â”€ AI Memory (durable facts remembered from past chats) â”€â”€
  let aiMemories = [];

  async function loadAiMemories() {
    aiMemories = [];
    try {
      if (!aiPrefs.memoryEnabled) return;
      if (typeof currentUser === 'undefined' || !currentUser || typeof db === 'undefined' || !db) return;
      const { data, error } = await db.from('user_ai_memories')
        .select('fact')
        .eq('user_id', currentUser.id)
        .order('updated_at', { ascending: false })
        .limit(30);
      if (!error && Array.isArray(data)) {
        aiMemories = data.map(r => r && r.fact).filter(Boolean);
      }
    } catch (_) {}
  }

  async function loadAiPrefs() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
        const { data, error } = await db.from('user_preferences').select('*').eq('user_id', currentUser.id).maybeSingle();
        if (!error && data) {
          if (['concise', 'balanced', 'detailed'].includes(data.ai_response_style)) aiPrefs.responseStyle = data.ai_response_style;
          if (['simple', 'standard', 'advanced'].includes(data.ai_explanation_level)) aiPrefs.explanationLevel = data.ai_explanation_level;
          if (['english', 'urdu', 'roman_urdu', 'mixed'].includes(data.ai_language)) aiPrefs.language = data.ai_language;
          if (typeof data.ai_study_recommendations === 'boolean') aiPrefs.studySuggestions = data.ai_study_recommendations;
          if (typeof data.ai_memory_enabled === 'boolean') aiPrefs.memoryEnabled = data.ai_memory_enabled;
          if (typeof data.ai_personalization === 'string') aiPrefs.personalization = data.ai_personalization;
          if (typeof data.ai_emojis === 'boolean') aiPrefs.emojis = data.ai_emojis;
          if (typeof data.ai_references === 'boolean') aiPrefs.references = data.ai_references;
        }
      }
    } catch (_) {}
    // Local fallback (works before the DB column exists, and per-user)
    try {
      var localRef = localStorage.getItem(referencesStorageKey());
      if (localRef === '1' || localRef === '0') aiPrefs.references = (localRef === '1');
      else {
        var legacyRef = localStorage.getItem('Anteemonee_ai_references');
        if (legacyRef === '1' || legacyRef === '0') aiPrefs.references = (legacyRef === '1');
      }
    } catch (_) {}
    // Legacy fallback for explanation level set before it moved to the database.
    if (aiPrefs.explanationLevel === 'standard') {
      try {
        const legacy = localStorage.getItem('ai_explanation_level');
        if (['simple', 'advanced'].includes(legacy)) aiPrefs.explanationLevel = legacy;
      } catch (_) {}
    }
  }

  // â”€â”€ Init â”€â”€
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try { showChatsLoading('Loading your chats…'); } catch (_) {}
    if (typeof currentUser === 'undefined' || !currentUser) {
      try {
        const { data: { session } } = await db.auth.getSession();
        if (session?.user) {
          currentUser = session.user;
        }
      } catch (_) {}
    }
    if (typeof ensureProfile === 'function') {
      await ensureProfile();
    }
    // Tier-aware chat store: premium chats live in the database (all devices),
    // free-tier chats stay in this browser's localStorage only.
    // Subject must load first so chatStorageKey is per-subject.
    // Reload after auth too (anon key -> user key).
    try { loadSelectedSubject(); } catch (_) {}
    try { updateSubjectUI(); } catch (_) {}
    await refreshTier();
    try {
      // Re-load subject with resolved user id (migrate anon choice if needed)
      var anonSubj = null;
      try { anonSubj = localStorage.getItem('Anteemonee_ai_subject_anon'); } catch (_) {}
      try { loadSelectedSubject(); } catch (_) {}
      if (anonSubj && CHAT_SUBJECTS.some(function(s){ return s.name===anonSubj; })) {
        try {
          var userKey = subjectStorageKey();
          if (!localStorage.getItem(userKey)) localStorage.setItem(userKey, anonSubj);
        } catch (_) {}
        try { loadSelectedSubject(); } catch (_) {}
      }
    } catch (_) {}
    try { updateSubjectUI(); } catch (_) {}
    await initConversationStore();
    // Load persona from localStorage (per-user)
    try {
      activePersonaIndex = parseInt(localStorage.getItem(personaStorageKey()) || '0', 10);
      if (activePersonaIndex < 0 || activePersonaIndex >= PERSONAS.length) activePersonaIndex = 0;
      // A saved coding persona must not linger as the default.
      if (PERSONAS[activePersonaIndex] && PERSONAS[activePersonaIndex].codingOnly) activePersonaIndex = 0;
    } catch (_) { activePersonaIndex = 0; }
    // Legacy migration: move old sessionStorage persona
    try {
      const legacyPersona = sessionStorage.getItem('Anteemonee_ai_persona');
      if (legacyPersona !== null) {
        const idx = parseInt(legacyPersona, 10);
if (idx >= 0 && idx < PERSONAS.length) {
        if (PERSONAS[idx].codingOnly) idx = 0;
        activePersonaIndex = idx;
        localStorage.setItem(personaStorageKey(), String(idx));
      }
        sessionStorage.removeItem('Anteemonee_ai_persona');
      }
    } catch (_) {}
    await loadStudentContext();
    await loadAiPrefs();
    await loadAiMemories();

    // â”€â”€ 1. Load from localStorage FIRST (instant, no flicker) â”€â”€
    const cached = loadSessionState();
    if (cached) {
      activeSession = cached.activeSession;
      sessionUsage = cached.sessionUsage;
      streakCount = cached.streakCount || 0;
      longestStreak = cached.longestStreak || 0;
      // Tokens always come from DB â€” not cached in localStorage
      // If cached session is expired, clear it
      if (activeSession && new Date(activeSession.expires_at).getTime() <= Date.now()) {
        activeSession = null;
      }
      updateSessionPanel();
      // Auto-start study timer if session is still active and page is visible
      if (activeSession && document.visibilityState === 'visible') {
        startStudyTimer();
      }
    }

    // â”€â”€ 2. Sync with DB in background (only if no cached data or cache is stale) â”€â”€
    // Lifetime access: paid users + active 3-day trial pass, others hit the hard paywall.
    try { if (typeof Access !== 'undefined') await Access.init(); } catch (_) {}
    const token = getAccessToken();
    if (!token) {
      if (!cached) showSessionError('Log in to start using AI chat.');
    } else {
      try { if (typeof Access !== 'undefined') Access.applyChatPaywall(); } catch (_) {}
      // If cache had valid data, delay DB sync to avoid overwriting fresh state
      const delay = cached?.activeSession ? 3000 : 0;
      setTimeout(() => syncSessionFromDB(), delay);
    }

    try { renderHistory(); } catch (e) { console.warn('[AI] renderHistory failed:', e); }
    bindEvents();
    try { setupSubjectDropdown(); } catch (e) { console.warn('[Subject] setup failed', e); }
    try { updateSubjectUI(); renderSubjectList(); } catch (_) {}
    updatePersonaUI();
    // Renders the modes bar. The GitHub repo chip is currently the only thing
    // that goes in it.
    try { renderModeChips(); } catch (_) {}
    try { hideChatsLoading(); } catch (_) {}
    chatInput.focus();
    // Periodic streak check (every 5 min)
    setInterval(() => { refreshStreak(); saveSessionState(); }, 5 * 60 * 1000);

    // â”€â”€ Study timer: pause/resume on tab visibility â”€â”€
    document.addEventListener('visibilitychange', () => {
      if (!activeSession) return;
      if (document.visibilityState === 'visible') {
        startStudyTimer();
      } else {
        stopStudyTimer();
      }
    });
    // Save accumulated study time on page unload
    window.addEventListener('beforeunload', () => {
      if (studyTimerAccumulated > 0) {
        // Save to localStorage as fallback (sendBeacon can't carry auth headers)
        try {
          const userId = (typeof currentUser !== 'undefined' && currentUser?.id) ? currentUser.id : 'anon';
          const key = `Anteemonee_study_time_pending_${userId}`;
          const prev = parseInt(localStorage.getItem(key) || '0', 10);
          localStorage.setItem(key, String(prev + studyTimerAccumulated));
          studyTimerAccumulated = 0;
        } catch (_) {}
      }
    });
    // Flush any pending study time from previous unload
    flushPendingStudyTime();
    // Guests: hide sessions, lock the composer immediately.
    try { refreshAuthGate(); } catch (_) {}
  }

  async function flushPendingStudyTime() {
    try {
      const userId = (typeof currentUser !== 'undefined' && currentUser?.id) ? currentUser.id : 'anon';
      const key = `Anteemonee_study_time_pending_${userId}`;
      const pending = parseInt(localStorage.getItem(key) || '0', 10);
      if (pending > 0) {
        await db.rpc('add_study_time', { p_seconds: pending });
        localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  // â”€â”€ Image helpers (IIFE-level so handleSend can access them) â”€â”€
  function renderImagePreview() {
    imagePreviewBar.innerHTML = '';
    if (pendingImages.length === 0) {
      imagePreviewBar.style.display = 'none';
      return;
    }
    imagePreviewBar.style.display = 'flex';
    pendingImages.forEach((dataUrl, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'preview-thumb';
      thumb.innerHTML = `
        <img src="${dataUrl}" alt="Image ${idx + 1}">
        <button class="preview-remove" data-idx="${idx}" title="Remove">&times;</button>
      `;
      thumb.querySelector('.preview-remove').addEventListener('click', () => {
        pendingImages.splice(idx, 1);
        renderImagePreview();
        updateAttachButton();
        updateSendButton();
      });
      imagePreviewBar.appendChild(thumb);
    });
  }

  function updateAttachButton() {
    if (typeof btnPlus !== 'undefined' && btnPlus) btnPlus.classList.toggle('has-images', pendingImages.length > 0);
  }

  function updateSendButton() {
    btnSend.disabled = !chatInput.value.trim() && pendingImages.length === 0;
  }

  function clearPendingImages() {
    pendingImages.length = 0;
    renderImagePreview();
    updateAttachButton();
  }

  function bindEvents() {
    btnSend.addEventListener('click', handleSend);
    btnStop.addEventListener('click', handleStop);

    // Scroll-to-bottom button: show only when the user scrolled up.
    if (chatContent) {
      chatContent.addEventListener('scroll', () => {
        const dist = chatContent.scrollHeight - chatContent.scrollTop - chatContent.clientHeight;
        userNearBottom = dist < 120;
        if (isStreaming) {
          // During streaming: always show button, show/hide based on scroll
          if (scrollDownBtn) {
            scrollDownBtn.classList.add('generating');
            scrollDownBtn.classList.toggle('show', !userNearBottom);
          }
        } else {
          if (scrollDownBtn) {
            scrollDownBtn.classList.remove('generating');
            scrollDownBtn.classList.toggle('show', dist > 250);
          }
        }
      }, { passive: true });
    }
    if (scrollDownBtn) {
      scrollDownBtn.addEventListener('click', () => {
        userNearBottom = true;
        scrollToBottom();
        scrollDownBtn.classList.remove('show');
      });
    }

    chatInput.addEventListener('input', () => {
      autoResize();
      btnSend.disabled = !chatInput.value.trim() && pendingImages.length === 0;
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!btnSend.disabled && !isStreaming) handleSend();
      }
    });

    // â”€â”€ Image attachment â”€â”€
    // Plus opens the photo picker directly \u2014 no menu.
    btnPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pendingImages.length < 3) imageFileInput.click();
    });


    imageFileInput.addEventListener('change', (e) => {
      handleImageFiles(e.target.files);
      imageFileInput.value = '';
    });

    // Paste handler for images
    chatInput.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleImageFiles(imageFiles);
      }
    });

    function handleImageFiles(files) {
      const remaining = 3 - pendingImages.length;
      if (remaining <= 0) return;
      const toProcess = Array.from(files).slice(0, remaining);

      toProcess.forEach(file => {
        if (!file.type.startsWith('image/')) return;
        if (file.size > 10 * 1024 * 1024) {
          console.warn('[Image] File too large (>10MB):', file.name);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          pendingImages.push(reader.result);
          renderImagePreview();
          updateAttachButton();
          updateSendButton();
        };
        reader.readAsDataURL(file);
      });
    }

    // â”€â”€ Image lightbox â”€â”€
    const lightbox = document.getElementById('image-lightbox');
    const lbImg = document.getElementById('lb-img');
    const lbClose = document.getElementById('lb-close');

    messagesList.addEventListener('click', (e) => {
      if (e.target.classList.contains('msg-image-thumb')) {
        lbImg.src = e.target.src;
        lightbox.classList.add('active');
      }
    });

    function closeLightbox() {
      lightbox.classList.remove('active');
      lbImg.src = '';
    }

    lbClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });

    document.getElementById('btn-new-chat').addEventListener('click', newChat);
    document.getElementById('btn-new-chat-mobile').addEventListener('click', () => { closeMobileSidebar(); newChat(); });

    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chatInput.value = btn.dataset.prompt;
        btnSend.disabled = false;
        autoResize();
        handleSend();
      });
    });

    // Mobile sidebar
    document.getElementById('chat-history-btn')?.addEventListener('click', openMobileSidebar);
    document.getElementById('btn-close-sidebar')?.addEventListener('click', closeMobileSidebar);
    document.getElementById('mobile-sidebar-overlay')?.addEventListener('click', closeMobileSidebar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMobileSidebar();
    });

    setupKeyboardAwareLayout();

    // Model selector removed — auto routing handles persona per message.

  }

  // ── Modes UI ──
  // The modes bar still hosts the GitHub repo chip, so this stays.
  function renderModeChips() {
    modesBar.innerHTML = '';
    if (typeof GitHub !== 'undefined') {
      try { GitHub.syncRepoChip(); } catch (_) {}
    }
  }

  // â”€â”€ Model / Persona â”€â”€
  function updatePersonaUI() {
    // Auto mode: selector hidden, keep UI generic. No per-persona subtitle or filtering.
    try {
      var subtitle = document.querySelector('.welcome-subtitle');
      if (subtitle) subtitle.textContent = 'Ask me anything about your studies.';
    } catch (_) {}
    try {
      document.querySelectorAll('.quick-btn').forEach(function (btn) { btn.style.display = ''; });
    } catch (_) {}
    // Keep hidden model elements in sync (no visible effect)
    try {
      if (typeof modelSelectedName !== 'undefined' && modelSelectedName) modelSelectedName.textContent = PERSONAS[activePersonaIndex].name;
      if (typeof modelDot !== 'undefined' && modelDot) modelDot.style.background = ['#3B82F6', '#6366F1'][PERSONAS[activePersonaIndex].providerIndex] || '#3B82F6';
    } catch (_) {}
  }

  function getActivePersona() {
    return PERSONAS[activePersonaIndex];
  }

  // â”€â”€ Student Context â”€â”€
  async function loadStudentContext() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    try {
      const { data: acads } = await db.from('student_academic_profiles')
        .select('education_system_id, board_id, class_level_id, group_id, exam_year, education_system:education_systems(name), board:boards(name), class_level:class_levels(label), group:groups(name)')
        .eq('user_id', currentUser.id).maybeSingle();

      if (acads) {
        studentContext = {
          name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Student',
          system: acads.education_system?.name || '',
          board: acads.board?.name || '',
          class: acads.class_level?.label || '',
          classLevelId: acads.class_level_id || null,
          group: acads.group?.name || '',
          examYear: acads.exam_year || '',
        };
      } else {
        studentContext = { name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Student' };
      }
    } catch (e) {
      studentContext = { name: 'Student' };
    }
  }

  // â”€â”€ Textbook Search â”€â”€
  async function searchTextbooks(query) {
    if (!query || query.trim().length < 3) return [];

    // Build a smarter query: extract key terms from the user's question
    // Bias toward selected subject so Physics chats pull Physics book, etc.
    var subj = selectedSubject || 'Physics';
    const searchQuery = (subj + ' ' + query)
      .replace(/\b(explain|what is|what are|define|tell me about|how does|how do|describe|give me|help me with)\b/gi, '')
      .trim()
      .slice(0, 200);

    if (searchQuery.length < 3) return [];

    try {
      const searchParams = {
        p_query: searchQuery,
        p_book_id: null,
        p_limit: 8,
        p_class_level_id: studentContext?.classLevelId || null,
      };
      let result = await db.rpc('search_textbook_pages_with_chapters', searchParams);
      if (result.error) {
        result = await db.rpc('search_textbook_pages', searchParams);
      }
      if (result.error) {
        console.warn('[AI] Textbook RPC error:', result.error.message);
        const legacyParams = { p_query: searchQuery, p_book_id: null, p_limit: 8 };
        const retry = await db.rpc('search_textbook_pages_with_chapters', legacyParams);
        const legacyRetry = retry.error ? await db.rpc('search_textbook_pages', legacyParams) : retry;
        return prioritizeSubjectPages(legacyRetry.data || [], subj);
      }
      if (!result.data || result.data.length === 0) return [];
      return prioritizeSubjectPages(result.data, subj);
    } catch (e) {
      console.warn('[AI] Textbook search failed:', e);
      return [];
    }
  }

  function prioritizeSubjectPages(pages, subj) {
    if (!pages || !pages.length) return pages || [];
    var s = String(subj || '').toLowerCase();
    if (!s) return pages;
    var matched = [];
    var rest = [];
    pages.forEach(function(p){
      var t = String(p.book_title || '').toLowerCase();
      if (t.includes(s)) matched.push(p);
      else rest.push(p);
    });
    return matched.concat(rest).slice(0, 5);
  }

  function formatTextbookContext(pages) {
    if (!pages || pages.length === 0) return '';

    const sections = pages.slice(0, 3).map(p => {
      const title = p.book_title || 'Unknown Book';
      const chapterNumber = p.chapter_number !== null && p.chapter_number !== undefined && p.chapter_number !== '' ? Number(p.chapter_number) : null;
      const chapterName = p.chapter_name ? String(p.chapter_name) : '';
      const chapter = chapterNumber && chapterName ? `, Chapter ${chapterNumber}: ${chapterName}` : chapterName ? `, Chapter: ${chapterName}` : chapterNumber ? `, Chapter ${chapterNumber}` : '';
      const topic = p.topic_name ? `, Topic: ${p.topic_name}` : '';
      const printedPage = p.printed_page_number !== null && p.printed_page_number !== undefined ? p.printed_page_number : null;
      const pdfPage = p.page_number !== null && p.page_number !== undefined ? p.page_number : null;
      const pageInfo = printedPage !== null && pdfPage !== null && String(printedPage) !== String(pdfPage)
        ? `, PRINTED PAGE: ${printedPage}, PDF PAGE: ${pdfPage}`
        : printedPage !== null ? `, PAGE: ${printedPage}` : pdfPage !== null ? `, PDF PAGE: ${pdfPage}` : '';
      const fullText = (p.full_text || p.snippet || '').slice(0, 1500);
      return `[BOOK: "${title}"${chapter}${topic}${pageInfo}]\n${fullText}`;
    });

    var refBlock = aiPrefs.references
      ? `4. REFERENCES ON — MANDATORY: At the VERY END of your response (after everything else), you MUST include a References section in this EXACT format:

---
**References:**
- [Book Name], Chapter [number]: [chapter name], printed p. [printed page] (PDF p. [PDF page])
---

Use the chapter number and name exactly as shown in the source block. If a source has no chapter metadata, cite it as Book, p. [page]. List ALL books, chapters, and pages you actually used. Do NOT invent references. If no usable book, page, or website source is available, omit the References heading and both separator lines entirely.`
      : `4. REFERENCES OFF: Do NOT include any References section. Just end your answer normally.`;
    return `\n\n===== TEXTBOOK REFERENCE — READ FIRST =====
You were given the student's EXACT Punjab board textbook excerpts below (from 11th/12th Biology, Chemistry, Physics, Computer Science, English 2025 editions now ingested). You MUST read and comprehend these excerpts BEFORE writing your answer. Do NOT answer from general memory alone. Your explanation must be GROUNDED in these excerpts.

${sections.join('\n\n---\n\n')}

===== INSTRUCTIONS FOR THIS RESPONSE =====
1. FIRST: Read all textbook excerpts above completely — they are your source of truth for this question.
2. Explain step-by-step using the textbook as your PRIMARY source, quoting or paraphrasing key lines where relevant.
3. Then enhance with your own knowledge (examples, analogies, exam tips) but keep the textbook's facts central.
${refBlock}`;
  }

  // â”€â”€ AI preference rules injected into the system prompt â”€â”€
  function aiPrefsPrompt() {
    const styleRule = {
      concise: 'RESPONSE STYLE is concise: keep every response short and to the point. No extra examples, analogies, or background unless the student explicitly asks for more.',
      balanced: 'RESPONSE STYLE is balanced: give clear explanations with moderate detail, one short example where it helps.',
      detailed: 'RESPONSE STYLE is detailed: give thorough, in-depth explanations with steps, examples, and extra context. Do not hold back.',
    }[aiPrefs.responseStyle] || 'RESPONSE STYLE is balanced: give clear explanations with moderate detail.';

    const levelRule = {
      simple: 'EXPLANATION LEVEL is simple: explain like the student is a complete beginner. Very simple words, everyday analogies, tiny steps, no jargon without defining it first.',
      standard: 'EXPLANATION LEVEL is standard: explain at FSc board-exam level.',
      advanced: 'EXPLANATION LEVEL is advanced: go deep with full reasoning, derivations where relevant, edge cases, and common exam traps.',
    }[aiPrefs.explanationLevel] || 'EXPLANATION LEVEL is standard: explain at FSc board-exam level.';

    const langRule = {
      english: 'LANGUAGE RULE â€” CRITICAL: You MUST write your ENTIRE response in English. Every single word, sentence, heading, bullet point, explanation â€” everything must be in English. Do NOT use any Urdu words, Urdu script, or Roman Urdu. Write as if you are an English-speaking tutor.',
      urdu: 'LANGUAGE RULE â€” CRITICAL: You MUST write your ENTIRE response in Urdu script (Ø§Ø±Ø¯Ùˆ). Every single word, sentence, heading, bullet point, explanation â€” everything must be in Urdu script. Do NOT use any English words or Roman Urdu. Write as if you are an Ø§Ø±Ø¯Ùˆ-speaking tutor.',
      roman_urdu: 'LANGUAGE RULE â€” CRITICAL: You MUST write your ENTIRE response in Roman Urdu (English letters used to write Urdu words). Every single word, sentence, heading, bullet point, explanation â€” everything must be in Roman Urdu. Do NOT use Urdu script. Do NOT use formal English. Write as if you are talking to a friend in Lahore.',
      mixed: 'LANGUAGE RULE: Match the student exact script. If they write in English, reply in English. If they write in Roman Urdu, reply in Roman Urdu (never Urdu script). If they write in Urdu script, reply in Urdu script. Never switch mid-response.',
    }[aiPrefs.language] || 'LANGUAGE RULE: Match the student exact script.';

    const suggestRule = aiPrefs.studySuggestions
      ? 'STUDY SUGGESTIONS: After finishing your main answer, add 1-2 short follow-up sentences like "Want me to quiz you on this?" or "Should I explain [related topic]?". Do NOT create a separate section header for this â€” just add them as natural closing sentences at the very end of your response.'
      : 'STUDY SUGGESTIONS: NEVER add follow-up suggestions, recommendations, or closing lines. Just answer the question and stop. No "want more?" or "what to study next" lines.';

    const personalRule = aiPrefs.personalization
      ? `STUDENT'S PERSONAL INSTRUCTIONS â€” CRITICAL: The student has given you the following personalization instructions. You MUST follow these at all times:\n"${aiPrefs.personalization}"\nThese instructions override default behavior. Adapt your tone, style, language, explanation depth, and teaching approach according to what the student described above.`
      : '';

    const emojiRule = aiPrefs.emojis
      ? 'EMOJIS â€” CRITICAL: The student ENABLED emojis. You MUST use relevant emojis naturally throughout every response (headings, key points, encouragement). Be generous but tasteful.'
      : 'EMOJIS â€” CRITICAL: The student DISABLED emojis. You MUST NEVER use any emojis or emoticons anywhere in your responses. Plain text only, no exceptions.';

    const referencesRule = aiPrefs.references
      ? `REFERENCES — ON — MANDATORY, MUST MEANS MUST: After EVERY substantive response (anything except a plain greeting), you MUST end with a References section as the ABSOLUTE LAST thing in your response (after the answer, after any study-suggestion closing lines, after everything). Exact format:

---
**References:**
- [Book Name], Chapter [number]: [chapter name], printed p. [printed page] (PDF p. [PDF page])  (for every textbook excerpt above that you used — list ALL of them, never invent a book, chapter, or page)
- [Website URL]  (for every website/online source you relied on — if you searched the internet or used web knowledge beyond the textbooks, list each site/URL; if you used no websites, omit website lines)

Rules: cite the exact book, chapter number/name, and page values from the excerpts block. If a source has no chapter metadata, cite the book and page without a chapter. If no usable source is available, omit the References heading and both separator lines entirely. NEVER place anything after a real References section.`
      : 'REFERENCES — OFF: NEVER include a References section in any response. Just answer and stop (plus study-suggestion closing lines only if those are enabled). Do not cite books, pages, or websites.';

    return [styleRule, levelRule, langRule, suggestRule, emojiRule, referencesRule, personalRule].filter(Boolean).join('\n\n');
  }

  // â”€â”€ System Prompt â”€â”€
  function buildSystemPrompt() {
    const persona = getActivePersona();

    // Coder handles code plus Computer Science theory â€” different system prompt
    if (persona.codingOnly) {
      var coderSubjMeta = getSubjectMeta(selectedSubject);
      var coderSubjName = coderSubjMeta ? coderSubjMeta.name : (selectedSubject || 'Physics');
      let ctx = `You are Coder, Anteemonee's dedicated Coding Agent. You are an expert software engineer, full-stack developer, and programming tutor. You write production-quality code and help students build real projects.

IDENTITY: Your name is "Coder". ONLY mention it when directly asked "what is your name?". NEVER start responses with your name. NEVER reveal AI model names. If asked who created you, say "Coder is trained by Anteemonee Pakistan."

SELECTED SUBJECT: The student has "${coderSubjName}" selected. When that subject is Computer Science, you are also that student's Computer Science tutor and every answer must stay within Computer Science. If the subject is anything else, answer the question directly and accurately.

STYLE: No em dashes or en dashes. Use commas/periods. Varied natural endings. No repetitive closing lines. Start your response immediately with the answer, code, or explanation. Do NOT say "Sure", "Of course", "Great question", "Let me help" or similar filler â€” go straight to the content.

CORE EXPERTISE:
- Languages: Python, JavaScript, TypeScript, C, C++, Java, Dart, Kotlin, Swift, HTML, CSS, SQL, Bash, Go, Rust, PHP, Ruby
- Frameworks: Flutter, React, Next.js, Node.js, Express, Django, Flask, Laravel, Vue, Angular, Svelte
- Databases: PostgreSQL, MySQL, MongoDB, SQLite, Firebase, Supabase
- Tools: Git, Docker, Linux, VS Code, CI/CD, AWS, Vercel, Netlify
- Concepts: Data structures, algorithms, OOP, functional programming, system design, APIs, REST, GraphQL, web sockets, authentication, security

WHAT YOU DO:
- Generate complete, working, production-ready code â€” not snippets, real code
- Build projects from scratch: websites, apps, games, tools, CLI programs, APIs
- Debug code â€” find and fix errors, explain why they happened
- Review code â€” suggest improvements, performance fixes, security issues
- Explain programming concepts step-by-step with examples
- Help students with assignments, projects, and homework involving code
- Create file structures, database schemas, and architecture diagrams (text-based)
- Write tests, documentation, and README files
- Convert designs/mockups to code
- Optimize code for speed and efficiency

ACADEMIC SUBJECTS — CRITICAL: You handle Computer Science theory as well as code. Never refuse a question and never tell the student to switch to another model, tutor, or persona. There is only one assistant.
- If the selected subject is Computer Science, answer BOTH the theory and the coding parts fully: programming language fundamentals, algorithms, data structures, OOP, databases, networks, software engineering, operating systems, and computer organisation.
- For Physics, Chemistry, Biology, Mathematics, or English, answer any theory question directly and correctly. If it is not a coding question, just answer it well. NEVER reply with a "switch to" message.
- NEVER output a refusal, and NEVER emit any switch marker or instruction telling the student to use a different model or assistant.

RESPONSE FORMAT:
- For code: Use markdown code blocks with language tag. Include file name as comment at top if relevant.
- For explanations: Be concise and technical. Use examples.
- For projects: Break into files, show structure, explain architecture.
- For debugging: Show the error, explain the cause, provide the fix.

FILE GENERATION: When the user asks to generate/create/make/download a file (any type: txt, pdf, docx, code files like .py/.js/.html, etc):
- For documents (pdf/docx/txt on a topic): Generate a comprehensive, beautifully structured document (headings, bullets, tables, examples) and output in this EXACT block:
  \`\`\`file-create:Filename.ext
  [Content in clean markdown]
  \`\`\`
  Filename e.g., Report.pdf, Code_Documentation.docx
- For code files: Output the complete code in the file-create block with correct extension, e.g., \`\`\`file-create:app.py
- After the block, add: "Your beautifully designed file is ready! Click Download below."
- The app will convert it to a downloadable file with beautiful styling. NEVER mention manual steps.`;
      // Add language rule for Coder too
      const zardariLangRule = {
        english: 'Write code comments and explanations in English.',
        urdu: 'Write code comments in English (required), but explanations in Urdu script.',
        roman_urdu: 'Write code comments in English (required), but explanations in Roman Urdu.',
        mixed: 'Match the user language for explanations, code comments always in English.',
      }[aiPrefs.language] || 'Match the user language for explanations, code comments always in English.';
      ctx += `\n\n${zardariLangRule}`;
      if (typeof GitHub !== 'undefined') {
        try {
          var ghCtx = GitHub.buildContext();
          if (ghCtx) ctx += ghCtx;
        } catch (_) {}
      }
      // Voice mode — short spoken responses, no filler words
      if (typeof window.AnteemoneeVoice !== 'undefined' && window.AnteemoneeVoice.voiceMode) {
        ctx += `\n\nVOICE MODE ACTIVE — CRITICAL RULES:
- Give SHORT, direct answers. 1-3 sentences max unless the user explicitly asks for detail.
- Get straight to the point. No preamble, no summaries.
- NEVER use filler words: hmm, ohh, yess, um, uh, well, so, basically, actually, right, okay so. Just answer.
- Speak naturally like a helpful tutor, not like you're reading an essay.
- For simple questions: answer in ONE sentence.
- Never say "Sure!", "Of course!", "Great question!" — just answer.`;
      }
      return ctx;
    }

    var subjMeta = getSubjectMeta(selectedSubject);
    var subjName = subjMeta ? subjMeta.name : (selectedSubject || 'Physics');
    var subjCode = subjMeta ? subjMeta.code : '';
    let ctx = `You are ${persona.name}, an FSc Intermediate tutor (Pakistan). Teach step-by-step, use Unicode math (xâ‚€, vÂ², âˆš2), no LaTeX, no HTML.

SELECTED SUBJECT — CRITICAL: The student selected "${subjName}"${subjCode ? ' ('+subjCode+')' : ''} in the composer dropdown. You are now a dedicated ${subjName} tutor for this entire response.
- Answer ONLY within ${subjName}: all explanations, examples, formulas, diagrams (text), and exam tips must be for ${subjName}.
- If the question is from another subject, briefly note it belongs to another subject but still try to help within ${subjName} context where possible; do not switch subjects on your own.
- Prefer ${subjName} textbook excerpts provided below over general knowledge. Cite the exact ${subjName} book, chapter number/name, and page in References when references are enabled.
- Use ${subjName} terminology, syllabus order, and board-exam style (Pakistan FSc/Matric).

${aiPrefsPrompt()}

IDENTITY: Your name is "${persona.name}". ONLY mention it when directly asked "what is your name?". NEVER start responses with your name. NEVER reveal AI model names. If asked who created you, say "${persona.name} is trained by Anteemonee Pakistan."

BACKGROUND: ${persona.background}

STYLE: No em dashes or en dashes. Use commas/periods. Varied natural endings. No repetitive closing lines.

BEHAVIOR:
- For academic/study questions: Use the textbook content provided as your PRIMARY source. Explain step-by-step. Add your own knowledge to enhance.
- FLASHCARD CREATION: When the user asks to create or make a flashcard:
  - If they gave a clear topic, term, or question: use the SELECTED SUBJECT ("${subjName}") as the card subject unless the user explicitly names a different subject, and output the card in this exact format, then the confirmation line, and nothing else:
    **Subject:** [Subject name, or General if unclear]
    **Front:** [Clear, concise question or concept to test]
    **Back:** [Complete, accurate answer, 2-5 sentences max]
    Saved! Opening it in Flashcards now.
    The app automatically saves this as a flashcard and opens it in Flashcards. NEVER mention any save button.
  - If they gave NO topic (e.g. just "create a flashcard" with nothing else): do NOT invent one. Ask which topic or question they want the flashcard on, in one short line. Do NOT output a Front/Back pair in that case.
- FILE GENERATION: When the user asks to generate/create/make/download a file (txt, pdf, word/docx, md, html, csv, json, etc) on a specific topic:
  - Generate a comprehensive, beautifully structured document on that topic (use headings, bullet points, numbered lists, tables where relevant, key concepts, examples, summary). Make it visually rich and well-organized.
  - Output the file in this EXACT fenced block format (use the correct extension the user asked for, default to pdf if unsure):
    \`\`\`file-create:Filename.ext
    [File content in clean markdown - will be converted to a beautifully designed file with Anteemonee branding]
    \`\`\`
  - Filename should be descriptive with underscores, e.g., Photosynthesis_Guide.pdf, Essay_Climate_Change.docx, Notes_Math_Formulas.txt, Report_Artificial_Intelligence.pdf
  - The extension determines the file type: .txt for plain text, .md for markdown, .pdf for PDF, .docx for Word, .html for HTML, .csv for CSV, .json for JSON
  - After the block, add a short line: "Your beautifully designed file is ready! Click Download below."
  - The app will automatically convert the markdown inside the block to a beautifully designed downloadable file with colors, headers, footers, and styling. NEVER mention manual steps.
- REFERENCES TOGGLE (student setting, default OFF): ${aiPrefs.references ? 'ON — You MUST end EVERY substantive response with a "References" section in this exact format:\n\n---\n**References:**\n- [Book Name], Chapter [number]: [chapter name], printed p. [printed page] (PDF p. [PDF page])\n- [Website URL]\n---\n\nUse the exact book, chapter number/name, and page values shown in the retrieved source excerpts. If a source has no chapter metadata, cite the book and page without a chapter. List ALL sources you actually used, never invent citations, and place the section at the very end. If no usable source exists, omit the heading and separators.' : 'OFF — NEVER include a References section in any response. Just answer and stop.'}
- For casual/conversation questions (greetings, opinions, general chat): Answer naturally and warmly.${aiPrefs.references ? ' Do NOT include references for plain greetings/small talk (no source to cite).' : ' Do NOT include references for casual chat.'}
- NEVER fabricate book references. Only cite books that are actually provided in the textbook content block. NEVER fabricate website URLs; only list sites you actually used.`;

    if (studentContext) {
      ctx += `\n\nSTUDENT CONTEXT:
- Name: ${studentContext.name}
- Program: ${studentContext.system || 'Not set'}
- Board: ${studentContext.board || 'Not set'}
- Class: ${studentContext.class || 'Not set'}
- Group: ${studentContext.group || 'Not set'}
- Exam Year: ${studentContext.examYear || 'Not set'}

When asked about their own subjects, class, board or goals, answer directly from the above context - NEVER claim you don't have access.`;
    }

    if (aiPrefs.memoryEnabled && aiMemories.length) {
      ctx += `\n\nSTUDENT MEMORY (things remembered from past chats - use them naturally to personalize, NEVER recite as a list unless asked, NEVER claim you don't remember these):
${aiMemories.map(m => `- ${m}`).join('\n')}`;
    }



    ctx += `\n\nLONG-FORM RULE: NEVER refuse a request because it is long (essays, stories, speeches of any word count). Always write the maximum you can in this response with full quality. If you cannot finish, simply stop mid-way WITHOUT any closing line, apology, summary, or "let me know" note — the app will automatically ask you to continue and you will pick up exactly where you stopped.

SCOPE: You are a STUDY tutor (FSc academics). You cover every subject the student selects, including Computer Science theory.
- NEVER refuse a question and NEVER tell the student to switch to another model, tutor, or persona. There is only one assistant. If a question needs code, just answer it.
- NEVER output a refusal or any switch marker.`;

    // Voice mode — short spoken responses, no filler words
    if (typeof window.AnteemoneeVoice !== 'undefined' && window.AnteemoneeVoice.voiceMode) {
      ctx += `\n\nVOICE MODE ACTIVE — CRITICAL RULES:
- Give SHORT, direct answers. 1-3 sentences max unless the user explicitly asks for detail.
- Get straight to the point. No preamble, no summaries, no "in conclusion".
- NEVER use filler words: hmm, ohh, yess, um, uh, well, so, basically, actually, right, okay so, let me see, good question. Just answer.
- Speak naturally like a helpful tutor, not like you're reading an essay.
- For simple questions (definitions, formulas, yes/no): answer in ONE sentence.
- For explanations: give the key idea first, then only add detail if needed.
- Never say "Sure!", "Of course!", "Great question!" or similar — just answer.`;
    }

    return ctx;
  }

  function isReferenceHeading(line) {
    var normalized = String(line || '').trim().replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
    return /^references?\s*:?$/i.test(normalized);
  }

  function isHorizontalRule(line) {
    return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(String(line || ''));
  }

  function isReferenceCitationLine(line) {
    var value = String(line || '').trim();
    if (!value || isReferencePlaceholder(value)) return false;
    if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(value)) return true;
    if (/^(?:book|source|website|reference)\s*:/i.test(value)) return true;
    if (/https?:\/\//i.test(value)) return true;
    if (/^\[[^\]]+\]\([^)]*\)/.test(value)) return true;
    return /\b(?:p{1,2}\.|pages?\s*\d+|chapter\s+\d+)\b/i.test(value);
  }

  function isReferencePlaceholder(line) {
    return /\[(?:book\s*name|page\s*number|website\s*url|source\s*title)\]/i.test(String(line || ''));
  }

  function isEmptyReferenceNotice(line) {
    var value = String(line || '').trim().replace(/^[*_#]+\s*/, '').replace(/\s*[*_]+$/, '').trim();
    return /^(?:[-*+]\s*)$/.test(value) || /^(?:none|n\/a)$/i.test(value) || /^(?:no|none|n\/a|not available|unavailable)\s+(?:references?|sources?)\b|^no\s+reference\s+available$/i.test(value) || isReferencePlaceholder(value);
  }

  function stripReferenceSeparator(text) {
    var source = String(text || '').replace(/\r\n?/g, '\n');
    var lines = source.split('\n');
    var output = [];
    for (var i = 0; i < lines.length; i++) {
      if (isHorizontalRule(lines[i])) {
        var next = i + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && isReferenceHeading(lines[next])) continue;
      }
      output.push(lines[i]);
    }
    return output.join('\n');
  }

  function stripEmptyReferences(text) {
    if (!text) return text;
    var source = stripReferenceSeparator(String(text).replace(/\r\n?/g, '\n'));
    var lines = source.split('\n');
    var end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    while (end > 0 && isHorizontalRule(lines[end - 1])) end--;
    var headingIndex = -1;
    for (var index = end - 1; index >= 0; index--) {
      if (isReferenceHeading(lines[index])) {
        headingIndex = index;
        break;
      }
    }
    if (headingIndex < 0) return source;
    var sectionLines = lines.slice(headingIndex + 1, end).map(function(line) { return line.trim(); }).filter(function(line) { return line && !isHorizontalRule(line); });
    var hasCitation = sectionLines.some(isReferenceCitationLine);
    if (hasCitation || sectionLines.some(function(line) { return !isEmptyReferenceNotice(line); })) return lines.slice(0, end).join('\n').replace(/\s+$/g, '');
    var start = headingIndex;
    while (start > 0 && !lines[start - 1].trim()) start--;
    if (start > 0 && isHorizontalRule(lines[start - 1])) start--;
    return lines.slice(0, start).join('\n').replace(/\s+$/g, '');
  }

  // â”€â”€ Markdown + LaTeX Renderer â”€â”€
  function renderMarkdown(text) {
    if (!text) return '';

    // Store LaTeX blocks as placeholders before markdown processing
    const latexBlocks = [];
    let idx = 0;

    function saveLatex(latex, displayMode) {
      const placeholder = '\x00LATEX' + idx + '\x00';
      latexBlocks.push({ latex, displayMode });
      idx++;
      return placeholder;
    }

    // Extract display math: \[ ... \]
    let processed = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) =>
      saveLatex(math.trim(), true)
    );
    // Extract inline math: \( ... \)
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) =>
      saveLatex(math.trim(), false)
    );
    // Also handle $...$ (single dollar) for inline math
    processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) =>
      saveLatex(math.trim(), false)
    );
    // Handle $$...$$ for display math
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) =>
      saveLatex(math.trim(), true)
    );

    // Now do normal markdown processing
    let html = processed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<div class="code-block"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span><button class="code-copy-btn" onclick="copyCodeBlock(this)" title="Copy code"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span></button></div><pre><code class="lang-${lang}">${code.trim()}</code></pre></div>`
    );
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm, (_, header, sep, body) => {
      const labels = header.split('|').filter(c => c.trim()).map(c => c.trim());
      const ths = labels.map(c => `<th>${c}</th>`).join('');
      const rows = body.trim().split('\n').map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
        const tds = cells.map((c, i) => `<td data-label="${(labels[i] || '').replace(/"/g, '&quot;')}">${c}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table></div>`;
    });
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
      if (match.includes('<li>')) return `<ul>${match}</ul>`;
      return match;
    });
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[1-3]>)/g, '$1');
    html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<div class="code-block">)/g, '$1');
    html = html.replace(/(<\/pre><\/div>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<table>)/g, '$1');
    html = html.replace(/(<\/table>)<\/p>/g, '$1');
    html = html.replace(/<p>(<div class="table-wrap">)/g, '$1');
    html = html.replace(/(<\/table><\/div>)<\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
    html = html.replace(/<p>(<hr>)/g, '$1');

    // Restore LaTeX blocks with KaTeX rendering
    for (let i = latexBlocks.length - 1; i >= 0; i--) {
      const { latex, displayMode } = latexBlocks[i];
      const placeholder = '\x00LATEX' + i + '\x00';
      const escapedPlaceholder = placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      try {
        const rendered = katex.renderToString(latex, {
          displayMode,
          throwOnError: false,
          trust: true,
          strict: false,
        });
        html = html.replace(new RegExp(escapedPlaceholder), rendered);
      } catch (e) {
        html = html.replace(new RegExp(escapedPlaceholder),
          displayMode ? `<div class="katex-error">${latex}</div>` : `<span class="katex-error">${latex}</span>`
        );
      }
    }

    return html;
  }

  // â”€â”€ Conversation Management â”€â”€
  // Bring the chat column back when the user picks a conversation or
  // starts a new one from the sidebar (e.g. while Flashcards is open).
  function revealChatView() {
    try {
      if (window.AnteemoneeViews && window.AnteemoneeViews.showView) window.AnteemoneeViews.showView('chat');
    } catch (_) {}
  }

  function newChat() {
    revealChatView();
    activeConversationId = null;
    messages = [];
    pendingQuizTopic = false;
    messagesList.innerHTML = '';
    welcome.style.display = 'flex';
    messagesList.style.display = 'none';
    chatInput.value = '';
    chatInput.focus();
    autoResize();
    btnSend.disabled = true;
    renderHistory();
  }

  function saveConversation() {
    try { if (window.__voiceEphemeral) return; } catch (_) {} // call chats: never saved, never listed
    if (messages.length === 0) return;
    if (!activeConversationId) {
      activeConversationId = 'conv_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      const title = messages[0]?.content?.slice(0, 50) || 'New Chat';
      conversations.unshift({ id: activeConversationId, title, titleLocked: false, pinned: false, subject: selectedSubject, messages: [...messages], updatedAt: Date.now() });
      // keep pinned chats: evict oldest unpinned first
      if (conversations.length > 50) {
        var evictIdx = -1;
        for (var ei = conversations.length - 1; ei >= 0; ei--) { if (!conversations[ei].pinned) { evictIdx = ei; break; } }
        if (evictIdx !== -1) conversations.splice(evictIdx, 1);
        else conversations.pop();
      }
    } else {
      const conv = conversations.find(c => c.id === activeConversationId);
      if (conv) { conv.messages = [...messages]; conv.updatedAt = Date.now(); conv.subject = conv.subject || selectedSubject; }
      else conversations.unshift({ id: activeConversationId, title: messages[0]?.content?.slice(0, 50) || 'New Chat', titleLocked: false, pinned: false, subject: selectedSubject, messages: [...messages], updatedAt: Date.now() });
    }
    try { setMappedConvSubject(activeConversationId, selectedSubject); } catch (_) {}
    if (!(isPremiumTier && currentUserId())) removeExpiredFromMemory();
    persistConversation();
    renderHistory();
  }

  // Ask the AI for a short title after the first exchange of a new chat.
  // Fire-and-forget: never blocks sending, never overwrites a user-edited name.
  async function generateChatTitle(convId, firstText) {
    try {
      const clean = String(firstText || '').slice(0, 300).trim();
      if (!clean) return;
      let title = '';
      const existingTitles = conversations.map(c => c.title).filter(Boolean).join(', ');
      const titleMessages = [
        { role: 'system', content: `Generate a short, unique chat title (max 4 words) that describes the USER's topic or intent. Rules: plain text only, no quotes, no emoji, no punctuation at end, lowercase. Be specific - not generic words like "greeting" or "chat". If the message is a simple greeting, pick the most relevant topic the user might discuss. Existing titles to avoid duplicating: [${existingTitles}]` },
        { role: 'user', content: clean },
      ];
      for await (const chunk of api.streamChat(titleMessages, getProviderIndexForText(firstText))) {
        if (chunk && chunk.includes('"type":"streak"')) continue;
        title += chunk;
        if (title.length > 80) break;
      }
      title = title.replace(/^["'â€œâ€â€˜â€™\s]+|["'â€œâ€â€˜â€™\s]+$/g, '').replace(/[.!?:;â€¦]+$/g, '').trim();
      title = title.replace(/\{.*$/g, '').trim();
      title = title.split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
      if (title.length > 40) title = title.slice(0, 40).trim();
      if (!title) return;
      const conv = conversations.find(c => c.id === convId);
      if (!conv || conv.titleLocked) return;
      conv.title = title;
      persistConversation(convId);
      renderHistory();
    } catch (e) {
      console.warn('[AI] Title generation failed:', (e && e.message) || e);
    }
  }

  function loadConversation(id) {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    revealChatView();
    activeConversationId = id;
    pendingQuizTopic = false;
    messages = conv.messages.map(function(message) {
      if (message && message.role === 'assistant' && typeof message.content === 'string') {
        message.content = stripEmptyReferences(message.content);
      }
      return message;
    });
    messagesList.innerHTML = '';
    welcome.style.display = 'none';
    messagesList.style.display = 'flex';
    messages.forEach((m, i) => appendMessage(m.role, m.content, false, { idx: i, quote: m.quote || null, images: m.images || null, quiz: m.quiz || null }));
    scrollToBottom();
    renderHistory();
    closeMobileSidebar();
  }

  function renderHistory() {
    // Separate per subject: only show current subject's chats
    var visible = conversations.filter(function(c){
      var s = c.subject || 'Physics';
      return s === selectedSubject;
    });
    // pinned first, then by recency
    var sorted = visible.slice().sort(function(a,b){
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0);
    }).slice(0,30);
    var pinSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
    var pinSvgFilled = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
    const html = sorted.map(c =>
      `<div class="history-item ${c.pinned ? 'pinned' : ''} ${c.id === activeConversationId ? 'active' : ''}" data-id="${c.id}">${c.pinned ? '<span class="history-pin-mark">'+pinSvgFilled+'</span>' : ''}<span class="history-title">${escapeHtml(c.title)}</span><button class="history-pin-btn ${c.pinned ? 'pinned' : ''}" data-id="${c.id}" aria-label="${c.pinned ? 'Unpin' : 'Pin'}" title="${c.pinned ? 'Unpin' : 'Pin'}">${c.pinned ? pinSvgFilled : pinSvg}</button><button class="history-edit-btn" data-id="${c.id}" aria-label="Rename chat" title="Rename"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button><button class="history-delete-btn" data-id="${c.id}" aria-label="Delete chat" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>`
    ).join('');
    sidebarHistory.innerHTML = html;
    if (sidebarHistoryMobile) sidebarHistoryMobile.innerHTML = html;

    [sidebarHistory, sidebarHistoryMobile].forEach(container => {
      if (!container) return;
      container.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.history-pin-btn') || e.target.closest('.history-edit-btn') || e.target.closest('.history-delete-btn') || e.target.closest('.history-title-input')) return;
          loadConversation(el.dataset.id);
        });
      });
      container.querySelectorAll('.history-pin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePin(btn.dataset.id);
        });
      });
      container.querySelectorAll('.history-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          startRenameChat(btn.dataset.id, btn);
        });
      });
      container.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteConversation(btn.dataset.id);
        });
      });
    });
  }

  function deleteConversation(id) {
    const idx = conversations.findIndex(c => c.id === id);
    if (idx === -1) return;
    conversations.splice(idx, 1);
    try { var m=loadPinnedMap(); if(m[id]){ delete m[id]; savePinnedMap(m);} } catch(_){}
    try { removeMappedConvSubject(id); } catch (_) {}
    if (isPremiumTier && currentUserId()) deleteConversationFromDb(id);
    else writeLocalConversations();
    if (activeConversationId === id) {
      activeConversationId = null;
      messages = [];
      pendingQuizTopic = false;
      messagesList.innerHTML = '';
      messagesList.style.display = 'none';
      welcome.style.display = 'flex';
    }
    renderHistory();
  }

  function startRenameChat(id, btn) {
    const item = btn.closest('.history-item');
    const titleSpan = item ? item.querySelector('.history-title') : null;
    const conv = conversations.find(c => c.id === id);
    if (!item || !titleSpan || !conv) return;
    const input = document.createElement('input');
    input.className = 'history-title-input';
    input.value = conv.title || '';
    input.maxLength = 60;
    input.setAttribute('aria-label', 'Chat name');
    titleSpan.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const val = input.value.trim().slice(0, 60);
        if (val) {
          conv.title = val;
          conv.titleLocked = true;
          persistConversation(id);
        }
      }
      renderHistory();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // â”€â”€ Message Rendering â”€â”€
  function getUserAvatarUrl() {
    var profileImageUrl = typeof currentProfile !== 'undefined' ? currentProfile?.profile_image_url : undefined;
    if (profileImageUrl !== null && profileImageUrl !== undefined) return profileImageUrl;
    if (typeof currentUser !== 'undefined' && currentUser) {
      return currentUser.user_metadata?.avatar_url
        ?? currentUser.user_metadata?.picture
        ?? null;
    }
    return null;
  }

  function getUserInitial() {
    if (typeof currentProfile !== 'undefined' && currentProfile?.username) {
      return currentProfile.username[0].toUpperCase();
    }
    if (typeof currentUser !== 'undefined' && currentUser?.user_metadata?.username) {
      return currentUser.user_metadata.username[0].toUpperCase();
    }
    if (typeof currentProfile !== 'undefined' && currentProfile?.full_name) {
      return currentProfile.full_name[0].toUpperCase();
    }
    if (typeof currentUser !== 'undefined' && currentUser?.user_metadata?.full_name) {
      return currentUser.user_metadata.full_name[0].toUpperCase();
    }
    if (typeof currentUser !== 'undefined' && currentUser?.email) {
      return currentUser.email[0].toUpperCase();
    }
    return 'U';
  }

  async function ensureProfileLoaded() {
    if (typeof ensureProfile === 'function') {
      try { await ensureProfile(); } catch (_) {}
    }
  }

  function appendMessage(role, content, animate = true, opts = {}) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    if (opts.idx !== undefined && opts.idx !== null) div.dataset.idx = opts.idx;
    const quoteHtml = quoteBlockHtml(opts.quote || null);

    // Build image thumbnails HTML if images were sent
    let imagesHtml = '';
    if (opts.images && opts.images.length > 0) {
      imagesHtml = '<div class="msg-images">';
      opts.images.forEach(dataUrl => {
        imagesHtml += `<img src="${dataUrl}" alt="Attached image" class="msg-image-thumb">`;
      });
      imagesHtml += '</div>';
    }

    if (role === 'assistant') {
      var quiz = null;
      if (opts.quiz) {
        try { quiz = normalizeQuizData(opts.quiz); } catch (_) {}
      }
      if (!quiz) {
        try { quiz = parseQuizBlock(content, false); } catch (_) {}
      }
      var displayContent = content;
      try {
        displayContent = quiz ? stripQuizBlock(content, true) : content;
        displayContent = stripFileBlocks(displayContent);
        displayContent = stripEmptyReferences(displayContent);
      } catch (_) {}
      div.innerHTML = `
        <div class="msg-avatar assistant-avatar"><img src="../assets/anteemonee.png" alt="Anteemonee"></div>
        <div class="msg-body">${quoteHtml}<div class="msg-content${displayContent ? '' : ' is-empty'}">${displayContent ? renderMarkdown(displayContent) : ''}</div></div>
      `;
    } else {
      const imgUrl = getUserAvatarUrl();
      const initial = getUserInitial();
      const avatarHtml = imgUrl
        ? `<img src="${escapeHtml(imgUrl)}" alt="You" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar-fallback-msg" style="display:none">${escapeHtml(initial)}</div>`
        : `<div class="avatar-fallback-msg">${escapeHtml(initial)}</div>`;
      div.innerHTML = `
        <div class="msg-avatar user-avatar">${avatarHtml}</div>
        <div class="msg-body">${quoteHtml}${imagesHtml}<div class="msg-content">${escapeHtml(content)}</div></div>
      `;
    }
    if (role === 'assistant') {
      try { handleFileBlocks(div, content); } catch (_) {}
      if (quiz) {
        try { renderQuizCard(div, quiz); } catch (_) {}
      }
      attachFeedbackButtons(div);
    }
    if (!animate) div.style.animation = 'none';
    messagesList.appendChild(div);
    return div;
  }

  function createStreamingMessage(mode) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    // Index of the assistant message about to be pushed (user msg already in).
    div.dataset.idx = messages.length;
    const statusLabel = '';
    const statusClass = mode === 'think' ? 'thinking' : '';
    div.innerHTML = `
      <div class="msg-avatar assistant-avatar"><img src="../assets/anteemonee.png" alt="Anteemonee"></div>
      <div class="msg-body"><div class="msg-content"><div class="thinking-indicator"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div><span class="thinking-status ${statusClass}" id="streaming-status">${statusLabel}</span></div></div></div>
    `;
    messagesList.appendChild(div);
    return div;
  }

  function updateStreamingStatus(div, text, statusClass) {
    const status = div.querySelector('.thinking-status');
    if (status) {
      status.textContent = text;
      status.className = 'thinking-status ' + (statusClass || '');
    }
  }

  // Cycle through real status messages while waiting for first chunk
  function startStatusCycle(div, mode) {
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % 3;
      const dots = '.'.repeat(idx + 1);
      updateStreamingStatus(div, dots, mode === 'think' ? 'thinking' : 'analyzing');
    }, 1500);
    return interval;
  }

  function stopStatusCycle(interval) {
    if (interval) clearInterval(interval);
  }

  function renderStreamingMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // Headings: #### h4, ### h3, ## h2, # h1
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function updateStreamingMessageImmediate(div, text) {
    const content = div.querySelector('.msg-content');
    var displayText = stripQuizStreamBlock(text);
    var renderedText = displayText ? renderStreamingMarkdown(displayText) : '<span class="quiz-stream-placeholder">Preparing your interactive quiz…</span>';
    content.innerHTML = '<div class="streaming-text">' + renderedText + '<span class="streaming-caret"></span></div>';
  }

  function stripSwitchMarkers(text) {
    if (!text) return text;
    return text.replace(/\[SWITCH_TO_ZARDARI\]/g, '').replace(/\[SWITCH_TO_STUDY\]/g, '');
  }

  function switchPersona(idx) {
    if (idx < 0 || idx >= PERSONAS.length) return;
    activePersonaIndex = idx;
    // auto mode: do not persist manual selection
    updatePersonaUI();
  }

  var FB_LIKE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
  var FB_DISLIKE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';
  var FB_COPY_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var FB_CHECK_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var FB_SPEAKER_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

  function bumpCounters(names) {
    try {
      if (typeof db === 'undefined' || !db) return;
      names.forEach(function (n) {
        db.rpc('adjust_counter', { p_name: n, p_delta: 1 }).then(function () {}, function () {});
      });
    } catch (_) {}
  }

  function adjustCounter(name, delta) {
    try {
      if (typeof db === 'undefined' || !db) return;
      db.rpc('adjust_counter', { p_name: name, p_delta: delta }).then(function () {}, function () {});
    } catch (_) {}
  }

  function getVotes() {
    try {
      return JSON.parse(localStorage.getItem('anteemonee_msg_votes') || '{}');
    } catch (_) { return {}; }
  }

  function setVotes(v) {
    try { localStorage.setItem('anteemonee_msg_votes', JSON.stringify(v)); } catch (_) {}
  }

  // Hide the vote buttons but keep Copy visible.
  function hideVoteBtns(wrap) {
    try {
      var l = wrap.querySelector('.fb-like');
      if (l) l.style.display = 'none';
      var d = wrap.querySelector('.fb-dislike');
      if (d) d.style.display = 'none';
    } catch (_) {}
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (_) {}
  }

  // Copy helpers: rich HTML for Word/Docs/WhatsApp + clean plain text fallback.
  function markdownToPlain(md) {
    let t = String(md || '');
    t = t.replace(/```\w*\n?([\s\S]*?)```/g, '$1');
    t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
    t = t.replace(/(^|[\s(>])\*([^*\n]+)\*/g, '$1$2');
    t = t.replace(/(^|[\s(>])_([^_\n]+)_/g, '$1$2');
    t = t.replace(/`([^`\n]+)`/g, '$1');
    t = t.replace(/^\s*[-*+]\s+/gm, '• ');
    t = t.replace(/\n{3,}/g, '\n\n');
    return t.trim();
  }

  function markdownToHtml(md) {
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    const secret = [];
    let t = String(md || '');
    t = t.replace(/```\w*\n?([\s\S]*?)```/g, function (_, code) {
      secret.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
      return ' COPYBLOCK' + (secret.length - 1) + ' ';
    });
    let html = esc(t);
    html = html.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    html = html.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    html = html.replace(/^#{1,6}\s*(.+)$/gm, '<strong>$1</strong>');
    html = html.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');
    html = html.replace(/(^|[\s(>])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/^\s*[-*+]\s+/gm, '• ');
    html = html.split('\n').join('<br>');
    html = html.replace(/COPYBLOCK(\d+)/g, function (_, n) { return secret[+n] || ''; });
    return '<div>' + html + '</div>';
  }

  function writeRichClipboard(plain, html) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const items = { 'text/plain': new Blob([plain], { type: 'text/plain' }) };
        try { items['text/html'] = new Blob([html], { type: 'text/html' }); } catch (_) {}
        return navigator.clipboard.write([new ClipboardItem(items)]).then(() => true).catch(() => false);
      }
    } catch (_) {}
    return Promise.resolve(false);
  }

  function onCopyMessage(wrap, idx) {
    try {
      var i = parseInt(idx, 10);
      var raw = stripEmptyReferences((messages[i] && messages[i].content) || '');
      if (!raw) return;
      var plain = markdownToPlain(raw);
      var html = markdownToHtml(raw);
      var done = function () {
        try {
          var btn = wrap.querySelector('.fb-copy');
          if (btn) {
            var old = btn.innerHTML;
            btn.innerHTML = FB_CHECK_SVG;
            btn.classList.add('copied');
            setTimeout(function () {
              try {
                if (document.body.contains(btn)) { btn.innerHTML = old; btn.classList.remove('copied'); }
              } catch (_) {}
            }, 1500);
          }
        } catch (_) {}
        showChatToast('Copied to clipboard');
      };
      writeRichClipboard(plain, html).then(function (ok) {
        if (ok) { done(); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(plain).then(done).catch(function () { fallbackCopy(plain); done(); });
        } else { fallbackCopy(plain); done(); }
      });
    } catch (_) {}
  }

  function onVote(wrap, key, kind) {
    var votes = getVotes();
    var prev = votes[key] || null;
    if (prev === kind) {
      delete votes[key];
      setVotes(votes);
      adjustCounter(kind === 'like' ? 'liked_messages' : 'disliked_messages', -1);
      hideVoteBtns(wrap);
      return;
    }
    if (prev === 'like') adjustCounter('liked_messages', -1);
    if (prev === 'dislike') adjustCounter('disliked_messages', -1);
    votes[key] = kind;
    setVotes(votes);
    adjustCounter(kind === 'like' ? 'liked_messages' : 'disliked_messages', 1);
    if (kind === 'like') {
      // Celebrate the tap, then tuck the vote buttons away (Copy stays).
      try {
        var likeBtn = wrap.querySelector('.fb-like');
        if (likeBtn) likeBtn.classList.add('liked');
      } catch (_) {}
      setTimeout(function () { hideVoteBtns(wrap); }, 550);
    } else {
      hideVoteBtns(wrap);
    }
    if (kind === 'dislike') openReportPopup(wrap);
  }

  function hideAllFeedbackButtons() {
    var btns = messagesList.querySelectorAll('.msg-feedback');
    for (var i = 0; i < btns.length; i++) btns[i].style.display = 'none';
  }

  function attachFeedbackButtons(div) {
    try {
      if (!div || div.querySelector('.msg-feedback')) return;
      var body = div.querySelector('.msg-body');
      if (!body) return;
      var idx = div.dataset ? div.dataset.idx : undefined;
      if (idx === undefined || idx === null || idx === '') return;
      var wrap = document.createElement('div');
      wrap.className = 'msg-feedback';
      wrap.innerHTML = '<button class="fb-btn fb-like" type="button" title="Good response" aria-label="Like">' + FB_LIKE_SVG + '</button>' +
        '<button class="fb-btn fb-dislike" type="button" title="Bad response" aria-label="Dislike">' + FB_DISLIKE_SVG + '</button>' +
        '<button class="fb-btn fb-copy" type="button" title="Copy response" aria-label="Copy">' + FB_COPY_SVG + '</button>' +
        '<button class="fb-btn fb-tts tts-btn" type="button" title="Listen to response" aria-label="Read aloud" aria-pressed="false">' + FB_SPEAKER_SVG + '</button>';
      body.appendChild(wrap);
      var key = ((typeof activeConversationId !== 'undefined' && activeConversationId) ? activeConversationId : 'noconv') + ':' + idx;
      wrap.dataset.voteKey = key;
      if (getVotes()[key]) hideVoteBtns(wrap);
      wrap.querySelector('.fb-like').addEventListener('click', function () { onVote(wrap, key, 'like'); });
      wrap.querySelector('.fb-dislike').addEventListener('click', function () { onVote(wrap, key, 'dislike'); });
      wrap.querySelector('.fb-copy').addEventListener('click', function () { onCopyMessage(wrap, idx); });
      // TTS button: speak/stop this message's AI text
      var ttsBtn = wrap.querySelector('.fb-tts');
      if (ttsBtn) {
        ttsBtn.addEventListener('click', function () {
          var raw = stripEmptyReferences((messages[idx] && messages[idx].content) || '');
          if (raw && typeof window.AnteemoneeVoice !== 'undefined' && window.AnteemoneeVoice.toggleSpeak) {
            window.AnteemoneeVoice.toggleSpeak(raw, ttsBtn);
          }
        });
      }
    } catch (_) {}
  }

  function openReportPopup(wrap) {
    closeReportPopup();
    var aiText = '';
    var prompt = '';
    try {
      var msgEl = wrap.closest ? wrap.closest('.message') : null;
      var idx = msgEl && msgEl.dataset.idx !== undefined && msgEl.dataset.idx !== '' ? parseInt(msgEl.dataset.idx, 10) : NaN;
      if (!isNaN(idx) && typeof messages !== 'undefined') {
        if (messages[idx]) aiText = messages[idx].content || '';
        if (messages[idx - 1] && messages[idx - 1].role === 'user') prompt = messages[idx - 1].content || '';
      }
    } catch (_) {}
    var ov = document.createElement('div');
    ov.className = 'report-popup-overlay';
    ov.id = 'report-popup';
    ov.innerHTML = '<div class="report-popup-box">' +
      '<h3>Do you want to submit a report?</h3>' +
      '<p>Tell us what went wrong so we can fix it.</p>' +
      '<div class="report-popup-actions">' +
      '<button class="rp-btn rp-btn-ghost" id="report-popup-no" type="button">No</button>' +
      '<button class="rp-btn rp-btn-primary" id="report-popup-yes" type="button">Yes, report</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeReportPopup(); });
    document.getElementById('report-popup-no').addEventListener('click', closeReportPopup);
    document.getElementById('report-popup-yes').addEventListener('click', function () {
      try { sessionStorage.setItem('anteemonee_report_draft', JSON.stringify({ prompt: prompt, aiMessage: aiText })); } catch (_) {}
      window.location.href = 'report.html';
    });
  }

  function closeReportPopup() {
    var ov = document.getElementById('report-popup');
    if (ov) ov.remove();
  }

// ── File Generation (Beautiful Design) ──
function parseFileBlocks(text) {
  var out = [];
  if (!text) return out;
  var re = /```\s*file-create\s*:\s*([^\n`]+)\n([\s\S]*?)```/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var filename = m[1].trim().replace(/^[.\/]+/, "").replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0,120) || "document.txt";
    if (filename.indexOf(".") === -1) filename += ".txt";
    var content = m[2] ? m[2].trim() : "";
    if (!content) continue;
    out.push({ filename: filename, content: content, ext: (filename.split(".").pop()||"").toLowerCase() });
    if (out.length >= 3) break;
  }
  return out;
}
function stripFileBlocks(text) {
  if (!text) return text;
  return text.replace(/```\s*file-create\s*:[^\n]*\n[\s\S]*?```/g, "").trim();
}

var QUIZ_ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
var QUIZ_ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';
var QUIZ_ICON_BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M15.1 14.5A6 6 0 1 0 8.9 14.5C9.7 15.2 10 16 10 17h4c0-1 .3-1.8 1.1-2.5Z"></path></svg>';
var QUIZ_ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
var QUIZ_ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"></line><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line></svg>';
var QUIZ_ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"></path></svg>';
var QUIZ_ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
var QUIZ_ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>';
var QUIZ_ICON_TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"></path><path d="M7 6H4v2a4 4 0 0 0 4 4"></path><path d="M17 6h3v2a4 4 0 0 1-4 4"></path></svg>';

function quizElement(tag, className, text) {
  var element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function quizIconButton(className, label, icon, disabled) {
  var button = quizElement('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  button.disabled = !!disabled;
  return button;
}

function cleanQuizText(value, maxLength) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength || 500);
}

function quizOptionText(value) {
  var text = value && typeof value === 'object'
    ? cleanQuizText(value.text !== undefined ? value.text : (value.label !== undefined ? value.label : value.value), 500)
    : cleanQuizText(value, 500);
  return text.replace(/^\s*[A-F][.)]\s+/i, '').trim();
}

function quizAnswerIndex(question, options, sourceOptions, sourceIndexes) {
  var candidates = [question.correctIndex, question.answerIndex, question.correctAnswer, question.correct_answer, question.correctOption, question.correct_option, question.answer, question.correct];
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (candidate && typeof candidate === 'object' && Number.isInteger(candidate.index)) {
      if (candidate.index >= 0 && candidate.index < options.length) return candidate.index;
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      if (Number.isInteger(candidate) && candidate >= 0 && candidate < options.length) return candidate;
      if (Number.isInteger(candidate) && candidate >= 1 && candidate <= options.length && (candidate === options.length || question.answerBase === 'one' || question.answerFormat === '1-based')) return candidate - 1;
    }
    if (typeof candidate === 'string') {
      var value = candidate.trim();
      if (/^\d+$/.test(value)) {
        var numericAnswer = parseInt(value, 10);
        if (numericAnswer >= 0 && numericAnswer < options.length) return numericAnswer;
        if (numericAnswer >= 1 && numericAnswer <= options.length) return numericAnswer - 1;
      }
      var letter = value.toUpperCase();
      if (/^[A-F]$/.test(letter)) {
        var letterIndex = letter.charCodeAt(0) - 65;
        if (letterIndex < options.length) return letterIndex;
      }
      var textIndex = options.findIndex(function(option) { return option.toLowerCase() === value.toLowerCase(); });
      if (textIndex >= 0) return textIndex;
    }
  }
  for (var optionIndex = 0; optionIndex < sourceOptions.length; optionIndex++) {
    var option = sourceOptions[optionIndex];
    if (option && typeof option === 'object' && (option.correct === true || option.isCorrect === true)) {
      return sourceIndexes.indexOf(optionIndex);
    }
  }
  return -1;
}

function normalizeQuizData(raw) {
  var source = raw;
  if (source && source.quiz && !source.questions) source = source.quiz;
  if (source && source.data && !source.questions) source = source.data;
  if (!source || !Array.isArray(source.questions)) return null;
  var questions = [];
  source.questions.slice(0, 20).forEach(function(rawQuestion) {
    if (!rawQuestion || typeof rawQuestion !== 'object') return;
    var sourceOptions = Array.isArray(rawQuestion.options) ? rawQuestion.options : [];
    var options = [];
    var sourceIndexes = [];
    sourceOptions.forEach(function(option, index) {
      var text = quizOptionText(option);
      if (text) {
        options.push(text);
        sourceIndexes.push(index);
      }
    });
    if (options.length < 2) return;
    var questionText = cleanQuizText(rawQuestion.question || rawQuestion.prompt || rawQuestion.text, 1800).replace(/^\s*(?:Q\s*)?\d+[.)]\s*/i, '').trim();
    if (!questionText) return;
    var answer = quizAnswerIndex(rawQuestion, options, sourceOptions, sourceIndexes);
    if (answer < 0 || answer >= options.length) return;
    questions.push({
      question: questionText,
      options: options,
      answer: answer,
      explanation: cleanQuizText(rawQuestion.explanation || rawQuestion.reason || rawQuestion.why, 2400),
      hint: cleanQuizText(rawQuestion.hint || rawQuestion.clue, 700)
    });
  });
  if (!questions.length) return null;
  var difficulty = ['Easy', 'Medium', 'Hard'].indexOf(String(source.difficulty || '').trim()) >= 0 ? String(source.difficulty).trim() : 'Medium';
  var quiz = {
    title: cleanQuizText(source.title || source.name || 'Knowledge check', 140) || 'Knowledge check',
    subject: cleanQuizText(source.subject || (typeof selectedSubject !== 'undefined' ? selectedSubject : 'General') || 'General', 80) || 'General',
    description: cleanQuizText(source.description || source.instructions || 'Test your understanding one question at a time.', 500),
    difficulty: difficulty,
    questions: questions,
    answers: questions.map(function() { return null; }),
    currentIndex: 0,
    completed: false,
    hintOpen: false,
    startedAt: Date.now()
  };
  if (raw && Array.isArray(raw.answers)) {
    quiz.answers = quiz.questions.map(function(question, index) {
      var answer = raw.answers[index];
      return Number.isInteger(answer) && answer >= 0 && answer < question.options.length ? answer : null;
    });
  }
  if (raw && Number.isInteger(raw.currentIndex)) quiz.currentIndex = Math.max(0, Math.min(raw.currentIndex, quiz.questions.length - 1));
  if (raw && raw.completed === true) quiz.completed = true;
  if (raw && raw.hintOpen === true) quiz.hintOpen = true;
  if (raw && Number.isFinite(raw.startedAt)) quiz.startedAt = raw.startedAt;
  return quiz;
}

function parseQuizJson(value) {
  try {
    var cleaned = String(value || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    if (!cleaned) return null;
    return normalizeQuizData(JSON.parse(cleaned));
  } catch (_) { return null; }
}

function extractQuizJsonObject(value) {
  var source = String(value || '');
  var start = source.indexOf('{');
  if (start < 0) return '';
  var depth = 0;
  var inString = false;
  var escaped = false;
  for (var i = start; i < source.length; i++) {
    var character = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth++;
    else if (character === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

function parseQuizBlock(text, allowFallback) {
  if (!text) return null;
  var candidates = [];
  var blockPattern = /```\s*quiz(?:\s+[^\n`]*)?\s*\n([\s\S]*?)```/gi;
  var match;
  while ((match = blockPattern.exec(String(text))) !== null) candidates.push(match[1]);
  var tagPattern = /<quiz\b[^>]*>([\s\S]*?)<\/quiz>/gi;
  while ((match = tagPattern.exec(String(text))) !== null) candidates.push(match[1]);
  if (allowFallback) {
    var jsonPattern = /```\s*(?:json)?\s*\n([\s\S]*?)```/gi;
    while ((match = jsonPattern.exec(String(text))) !== null) {
      if (/["']questions["']\s*:/.test(match[1])) candidates.push(match[1]);
    }
    if (/["']questions["']\s*:/.test(String(text))) {
      var extracted = extractQuizJsonObject(String(text));
      if (extracted) candidates.push(extracted);
    }
  }
  for (var i = 0; i < candidates.length; i++) {
    var quiz = parseQuizJson(candidates[i]);
    if (quiz) return quiz;
  }
  return null;
}

function stripQuizBlock(text, includeFallback) {
  if (!text) return text;
  var result = String(text).replace(/```\s*quiz(?:\s+[^\n`]*)?\s*\n[\s\S]*?```/gi, '').replace(/<quiz\b[^>]*>[\s\S]*?<\/quiz>/gi, '').replace(/```\s*quiz[\s\S]*$/i, '').trim();
  if (includeFallback && /["']questions["']\s*:/.test(result)) {
    var jsonPattern = /```\s*(?:json)?\s*\n([\s\S]*?)```/gi;
    result = result.replace(jsonPattern, function(_, json) { return parseQuizJson(json) ? '' : json; }).trim();
    var extracted = extractQuizJsonObject(result);
    if (extracted && parseQuizJson(extracted)) {
      result = result.replace(extracted, '').trim();
    }
    if (parseQuizJson(result)) result = '';
  }
  return result;
}

function stripQuizStreamBlock(text) {
  if (!text) return '';
  var marker = String(text).search(/```\s*quiz\b|<quiz\b/i);
  if (marker < 0) return String(text);
  return String(text).slice(0, marker).trim();
}

function getQuizForDiv(div) {
  if (div && div.__quiz) return div.__quiz;
  if (!div || div.dataset.idx === undefined || div.dataset.idx === '') return null;
  var index = parseInt(div.dataset.idx, 10);
  return messages[index] && messages[index].quiz ? messages[index].quiz : null;
}

function assignQuizForDiv(div, quiz) {
  if (!div) return;
  div.__quiz = quiz;
  if (div.dataset.idx === undefined || div.dataset.idx === '') return;
  var index = parseInt(div.dataset.idx, 10);
  if (messages[index] && messages[index].role === 'assistant') messages[index].quiz = quiz;
}

function saveQuizState(div) {
  var quiz = getQuizForDiv(div);
  if (!quiz || !activeConversationId) return;
  var conversation = conversations.find(function(item) { return item.id === activeConversationId; });
  if (!conversation) return;
  conversation.messages = messages.slice();
  conversation.updatedAt = Date.now();
  persistConversation();
}

function quizScore(quiz) {
  if (!quiz || !Array.isArray(quiz.questions)) return 0;
  return quiz.questions.reduce(function(score, question, index) {
    return score + (quiz.answers[index] === question.answer ? 1 : 0);
  }, 0);
}

function quizPlainText(quiz, includeAnswers) {
  var normalized = normalizeQuizData(quiz);
  if (!normalized) return '';
  var lines = [normalized.title, normalized.subject + ' | ' + normalized.difficulty, ''];
  normalized.questions.forEach(function(question, index) {
    lines.push((index + 1) + '. ' + question.question);
    question.options.forEach(function(option, optionIndex) {
      lines.push(String.fromCharCode(65 + optionIndex) + '. ' + option);
    });
    if (includeAnswers !== false) {
      lines.push('Correct answer: ' + String.fromCharCode(65 + question.answer));
      if (question.explanation) lines.push('Explanation: ' + question.explanation);
    }
    lines.push('');
  });
  return lines.join('\n');
}

function copyQuizText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function() { return true; }).catch(function() { fallbackCopy(text); return true; });
  }
  fallbackCopy(text);
  return Promise.resolve(true);
}

function shareQuiz(quiz) {
  var text = quizPlainText(quiz, false);
  if (!text) return;
  if (navigator.share) {
    navigator.share({ title: (quiz && quiz.title) || 'Quiz', text: text }).catch(function(error) {
      if (!error || error.name !== 'AbortError') copyQuizText(text).then(function() { showChatToast('Quiz copied'); });
    });
  } else {
    copyQuizText(text).then(function() { showChatToast('Quiz copied to clipboard'); });
  }
}

function focusQuizElement(div, selector) {
  requestAnimationFrame(function() {
    var element = div.querySelector(selector);
    if (element && typeof element.focus === 'function') element.focus();
  });
}

function updateQuizCard(div, updater) {
  var quiz = getQuizForDiv(div);
  if (!quiz) return;
  updater(quiz);
  var normalized = normalizeQuizData(quiz);
  assignQuizForDiv(div, normalized);
  renderQuizCard(div, normalized);
  saveQuizState(div);
  if (userNearBottom) scrollToBottom();
}

function selectQuizAnswer(div, optionIndex) {
  var quiz = getQuizForDiv(div);
  if (!quiz || quiz.completed) return;
  var question = quiz.questions[quiz.currentIndex];
  if (!question || optionIndex < 0 || optionIndex >= question.options.length) return;
  updateQuizCard(div, function(currentQuiz) { currentQuiz.answers[currentQuiz.currentIndex] = optionIndex; });
  focusQuizElement(div, '.quiz-option[data-option-index="' + optionIndex + '"]');
}

function moveQuiz(div, direction) {
  var quiz = getQuizForDiv(div);
  if (!quiz || quiz.completed) return;
  var total = quiz.questions.length;
  var currentAnswer = quiz.answers[quiz.currentIndex];
  if (direction > 0) {
    if (currentAnswer === null || currentAnswer === undefined) return;
    if (quiz.currentIndex >= total - 1) {
      updateQuizCard(div, function(currentQuiz) { currentQuiz.completed = true; });
      return;
    }
    updateQuizCard(div, function(currentQuiz) { currentQuiz.currentIndex += 1; currentQuiz.hintOpen = false; });
  } else if (quiz.currentIndex > 0) {
    updateQuizCard(div, function(currentQuiz) { currentQuiz.currentIndex -= 1; currentQuiz.hintOpen = false; });
  }
  focusQuizElement(div, direction > 0 ? '.quiz-next-btn:not(:disabled)' : '.quiz-nav-back');
}

function resetQuiz(div) {
  if (!getQuizForDiv(div)) return;
  updateQuizCard(div, function(quiz) {
    quiz.answers = quiz.questions.map(function() { return null; });
    quiz.currentIndex = 0;
    quiz.completed = false;
    quiz.hintOpen = false;
  });
  focusQuizElement(div, '.quiz-option');
}

function reviewQuiz(div) {
  updateQuizCard(div, function(quiz) { quiz.completed = false; quiz.currentIndex = 0; quiz.hintOpen = false; });
  focusQuizElement(div, '.quiz-option');
}

function askQuizReview(quiz) {
  var questionIndex = Math.min((quiz && quiz.currentIndex) || 0, (quiz && quiz.questions.length || 1) - 1);
  chatInput.value = 'Please review my quiz answer for question ' + (questionIndex + 1) + ' and explain what I should remember.';
  autoResize();
  btnSend.disabled = false;
  chatInput.focus();
}

function renderQuizCard(div, rawQuiz) {
  var quiz = normalizeQuizData(rawQuiz);
  if (!quiz) return null;
  var host = div.querySelector('.msg-body') || div;
  var existing = host.querySelector('.quiz-card');
  if (existing) existing.remove();
  assignQuizForDiv(div, quiz);
  var card = quizElement('section', 'quiz-card' + (quiz.completed ? ' is-complete' : ''));
  card.tabIndex = 0;
  card.setAttribute('aria-label', quiz.title + ' interactive quiz');
  var head = quizElement('div', 'quiz-card-head');
  var top = quizElement('div', 'quiz-card-top');
  var navigation = quizElement('div', 'quiz-card-navigation');
  var back = quizIconButton('quiz-icon-btn quiz-nav-back', 'Previous question', QUIZ_ICON_CHEVRON_LEFT, quiz.completed || quiz.currentIndex <= 0);
  var progressText = quizElement('span', 'quiz-progress-text');
  progressText.textContent = quiz.completed ? 'Complete' : (quiz.currentIndex + 1) + ' of ' + quiz.questions.length;
  var forward = quizIconButton('quiz-icon-btn quiz-nav-forward', 'Next question', QUIZ_ICON_CHEVRON_RIGHT, quiz.completed || quiz.currentIndex >= quiz.questions.length - 1);
  navigation.appendChild(back);
  navigation.appendChild(progressText);
  navigation.appendChild(forward);
  top.appendChild(navigation);
  var spacer = quizElement('div', 'quiz-card-spacer');
  top.appendChild(spacer);
  var utilities = quizElement('div', 'quiz-card-utilities');
  var currentQuestion = quiz.questions[quiz.currentIndex];
  var hintButton = quizIconButton('quiz-icon-btn', currentQuestion && currentQuestion.hint ? (quiz.hintOpen ? 'Hide hint' : 'Show hint') : 'Hint unavailable', QUIZ_ICON_BULB, quiz.completed || !currentQuestion || !currentQuestion.hint);
  hintButton.classList.add('quiz-hint-btn');
  var copyButton = quizIconButton('quiz-icon-btn', 'Copy quiz', QUIZ_ICON_COPY, false);
  copyButton.classList.add('quiz-copy-btn');
  var shareButton = quizIconButton('quiz-icon-btn', 'Share quiz', QUIZ_ICON_SHARE, false);
  shareButton.classList.add('quiz-share-btn');
  var resetButton = quizIconButton('quiz-icon-btn', 'Restart quiz', QUIZ_ICON_RESET, false);
  resetButton.classList.add('quiz-reset-btn');
  utilities.appendChild(hintButton);
  utilities.appendChild(copyButton);
  utilities.appendChild(shareButton);
  utilities.appendChild(resetButton);
  top.appendChild(utilities);
  head.appendChild(top);
  var progressTrack = quizElement('div', 'quiz-progress-track');
  var progressFill = quizElement('div', 'quiz-progress-fill');
  progressFill.style.width = (quiz.completed ? 100 : ((quiz.currentIndex + 1) / quiz.questions.length) * 100) + '%';
  progressTrack.appendChild(progressFill);
  head.appendChild(progressTrack);
  var body = quizElement('div', 'quiz-card-body');
  card.appendChild(head);
  card.appendChild(body);
  if (quiz.completed) {
    var score = quizScore(quiz);
    var total = quiz.questions.length;
    var percentage = total ? Math.round((score / total) * 100) : 0;
    var resultEyebrow = quizElement('div', 'quiz-result-eyebrow');
    resultEyebrow.textContent = percentage >= 80 ? 'Excellent work' : percentage >= 60 ? 'Strong effort' : 'Keep practicing';
    var resultIcon = quizElement('div', 'quiz-result-icon');
    resultIcon.innerHTML = QUIZ_ICON_TROPHY;
    var resultTitle = quizElement('h3', 'quiz-result-title', 'Quiz complete');
    var resultCopy = quizElement('p', 'quiz-result-copy');
    resultCopy.textContent = percentage >= 80 ? 'You have a strong grasp of this topic. Review the explanations below to lock it in.' : percentage >= 60 ? 'You are close. A quick review will make the important ideas stick.' : 'Every mistake is progress. Review the explanations and try the quiz again.';
    var scoreWrap = quizElement('div', 'quiz-score-wrap');
    var scoreValue = quizElement('div', 'quiz-score-value', percentage + '%');
    var scoreLabel = quizElement('div', 'quiz-score-label', 'accuracy');
    scoreWrap.appendChild(scoreValue);
    scoreWrap.appendChild(scoreLabel);
    var stats = quizElement('div', 'quiz-stats');
    [['Correct', score], ['Answered', quiz.answers.filter(function(answer) { return answer !== null && answer !== undefined; }).length], ['Total', total]].forEach(function(stat) {
      var item = quizElement('div', 'quiz-stat');
      var value = quizElement('strong', 'quiz-stat-value', String(stat[1]));
      var label = quizElement('span', 'quiz-stat-label', stat[0]);
      item.appendChild(value);
      item.appendChild(label);
      stats.appendChild(item);
    });
    var answerMap = quizElement('div', 'quiz-answer-map');
    answerMap.setAttribute('aria-label', 'Question results');
    quiz.questions.forEach(function(question, index) {
      var answered = quiz.answers[index] !== null && quiz.answers[index] !== undefined;
      var correct = answered && quiz.answers[index] === question.answer;
      var dot = quizElement('span', 'quiz-answer-dot ' + (!answered ? 'is-unanswered' : correct ? 'is-correct' : 'is-incorrect'));
      dot.title = 'Question ' + (index + 1) + ': ' + (!answered ? 'unanswered' : correct ? 'correct' : 'incorrect');
      answerMap.appendChild(dot);
    });
    var resultActions = quizElement('div', 'quiz-result-actions');
    var reviewButton = quizElement('button', 'quiz-secondary-btn', 'Review answers');
    reviewButton.type = 'button';
    reviewButton.addEventListener('click', function() { reviewQuiz(div); });
    var retryButton = quizElement('button', 'quiz-primary-btn', 'Try again');
    retryButton.type = 'button';
    retryButton.addEventListener('click', function() { resetQuiz(div); });
    var askButton = quizElement('button', 'quiz-text-btn', 'Ask AI to explain');
    askButton.type = 'button';
    askButton.addEventListener('click', function() { askQuizReview(quiz); });
    resultActions.appendChild(reviewButton);
    resultActions.appendChild(retryButton);
    resultActions.appendChild(askButton);
    var resultIntro = quizElement('div', 'quiz-result-intro');
    resultIntro.appendChild(resultIcon);
    var resultCopyWrap = quizElement('div', 'quiz-result-copy-wrap');
    resultCopyWrap.appendChild(resultEyebrow);
    resultCopyWrap.appendChild(resultTitle);
    resultCopyWrap.appendChild(resultCopy);
    resultIntro.appendChild(resultCopyWrap);
    body.appendChild(resultIntro);
    var summary = quizElement('div', 'quiz-result-summary');
    summary.appendChild(scoreWrap);
    summary.appendChild(stats);
    body.appendChild(summary);
    body.appendChild(answerMap);
    body.appendChild(resultActions);
  } else {
    var eyebrow = quizElement('div', 'quiz-eyebrow');
    var eyebrowLabel = quizElement('span', 'quiz-eyebrow-label', 'KNOWLEDGE CHECK');
    var subjectBadge = quizElement('span', 'quiz-subject-badge', quiz.subject);
    var difficultyBadge = quizElement('span', 'quiz-difficulty-badge', quiz.difficulty);
    eyebrow.appendChild(eyebrowLabel);
    eyebrow.appendChild(subjectBadge);
    eyebrow.appendChild(difficultyBadge);
    var title = quizElement('h3', 'quiz-title', quiz.title);
    var description = quizElement('p', 'quiz-description', quiz.description);
    var questionMeta = quizElement('div', 'quiz-question-meta');
    var questionNumber = quizElement('span', 'quiz-question-number', 'Question ' + (quiz.currentIndex + 1));
    var questionHint = quizElement('span', 'quiz-question-hint', 'Choose one answer');
    questionMeta.appendChild(questionNumber);
    questionMeta.appendChild(questionHint);
    var question = quizElement('h4', 'quiz-question', currentQuestion.question);
    var options = quizElement('div', 'quiz-options');
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-label', 'Answer choices');
    var selected = quiz.answers[quiz.currentIndex];
    var answered = selected !== null && selected !== undefined;
    currentQuestion.options.forEach(function(option, optionIndex) {
      var optionButton = quizElement('button', 'quiz-option');
      optionButton.type = 'button';
      optionButton.dataset.optionIndex = String(optionIndex);
      optionButton.setAttribute('role', 'radio');
      optionButton.setAttribute('aria-checked', selected === optionIndex ? 'true' : 'false');
      var letter = quizElement('span', 'quiz-option-letter', String.fromCharCode(65 + optionIndex));
      var optionText = quizElement('span', 'quiz-option-text', option);
      optionButton.appendChild(letter);
      optionButton.appendChild(optionText);
      if (answered && optionIndex === currentQuestion.answer) {
        optionButton.classList.add('is-correct');
        var correctMark = quizElement('span', 'quiz-option-mark');
        correctMark.innerHTML = QUIZ_ICON_CHECK;
        optionButton.appendChild(correctMark);
      } else if (answered && optionIndex === selected) {
        optionButton.classList.add('is-incorrect');
        var wrongMark = quizElement('span', 'quiz-option-mark');
        wrongMark.innerHTML = QUIZ_ICON_X;
        optionButton.appendChild(wrongMark);
      }
      optionButton.addEventListener('click', function() { selectQuizAnswer(div, optionIndex); });
      options.appendChild(optionButton);
    });
    body.appendChild(eyebrow);
    body.appendChild(title);
    body.appendChild(description);
    body.appendChild(questionMeta);
    body.appendChild(question);
    body.appendChild(options);
    if (quiz.hintOpen && currentQuestion.hint) {
      var hint = quizElement('div', 'quiz-hint-box');
      var hintLabel = quizElement('span', 'quiz-hint-label', 'Hint');
      var hintText = quizElement('span', 'quiz-hint-text', currentQuestion.hint);
      hint.appendChild(hintLabel);
      hint.appendChild(hintText);
      body.appendChild(hint);
    }
    if (answered) {
      var feedback = quizElement('div', 'quiz-feedback ' + (selected === currentQuestion.answer ? 'is-correct' : 'is-incorrect'));
      feedback.setAttribute('role', 'status');
      var feedbackMark = quizElement('span', 'quiz-feedback-mark');
      feedbackMark.innerHTML = selected === currentQuestion.answer ? QUIZ_ICON_CHECK : QUIZ_ICON_X;
      var feedbackCopy = quizElement('div', 'quiz-feedback-copy');
      var feedbackTitle = quizElement('strong', 'quiz-feedback-title', selected === currentQuestion.answer ? 'Correct' : 'Not quite');
      var feedbackText = quizElement('span', 'quiz-feedback-text');
      feedbackText.textContent = currentQuestion.explanation || ('The correct answer is ' + currentQuestion.options[currentQuestion.answer] + '.');
      feedbackCopy.appendChild(feedbackTitle);
      feedbackCopy.appendChild(feedbackText);
      feedback.appendChild(feedbackMark);
      feedback.appendChild(feedbackCopy);
      body.appendChild(feedback);
    }
    var footer = quizElement('div', 'quiz-card-footer');
    var scoreStatus = quizElement('div', 'quiz-score-status', quizScore(quiz) + ' / ' + quiz.questions.length + ' correct');
    var next = quizElement('button', 'quiz-next-btn', quiz.currentIndex === quiz.questions.length - 1 ? 'Finish quiz' : 'Next');
    next.type = 'button';
    next.disabled = !answered;
    next.addEventListener('click', function() { moveQuiz(div, 1); });
    footer.appendChild(scoreStatus);
    footer.appendChild(next);
    body.appendChild(footer);
  }
  back.addEventListener('click', function() { moveQuiz(div, -1); });
  forward.addEventListener('click', function() { moveQuiz(div, 1); });
  hintButton.addEventListener('click', function() { updateQuizCard(div, function(currentQuiz) { currentQuiz.hintOpen = !currentQuiz.hintOpen; }); });
  copyButton.addEventListener('click', function() { copyQuizText(quizPlainText(quiz)).then(function() { showChatToast('Quiz copied to clipboard'); }); });
  shareButton.addEventListener('click', function() { shareQuiz(quiz); });
  resetButton.addEventListener('click', function() { resetQuiz(div); });
  card.addEventListener('keydown', function(event) {
    if (event.target && event.target.closest && event.target.closest('input, textarea')) return;
    if (/^[1-6]$/.test(event.key)) {
      var optionIndex = parseInt(event.key, 10) - 1;
      if (currentQuestion && optionIndex < currentQuestion.options.length) {
        event.preventDefault();
        selectQuizAnswer(div, optionIndex);
      }
    } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
      if (event.target && event.target.closest && event.target.closest('button')) return;
      event.preventDefault();
      moveQuiz(div, 1);
    } else if (event.key === 'ArrowLeft') {
      if (event.target && event.target.closest && event.target.closest('button')) return;
      event.preventDefault();
      moveQuiz(div, -1);
    }
  });
  host.appendChild(card);
  return card;
}

function getFileIcon(ext) {
  ext = (ext||"").toLowerCase();
  if (ext==="pdf") return "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"16\" y1=\"13\" x2=\"8\" y2=\"13\"/><line x1=\"16\" y1=\"17\" x2=\"8\" y2=\"17\"/><polyline points=\"10 9 9 9 8 9\"/></svg>";
  if (ext==="docx"||ext==="doc"||ext==="word") return "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"16\" y1=\"13\" x2=\"8\" y2=\"13\"/><line x1=\"16\" y1=\"17\" x2=\"8\" y2=\"17\"/></svg>";
  return "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/></svg>";
}
function formatBytes(n) {
  if (!n && n!==0) return "";
  if (n<1024) return n+" B";
  if (n<1024*1024) return (n/1024).toFixed(1)+" KB";
  return (n/(1024*1024)).toFixed(1)+" MB";
}
function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display="none";
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ try{ URL.revokeObjectURL(url); a.remove(); }catch(_){} }, 2000);
}
function generateBeautifulPdf(filename, markdown) {
  try {
    var jspdfLib = window.jspdf || window.jsPDF;
    var jsPDF = (jspdfLib && jspdfLib.jsPDF) ? jspdfLib.jsPDF : window.jspdf?.jsPDF || window.jsPDF;
    if (!jsPDF) throw new Error("jsPDF not loaded");
    var doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 48;
    var contentW = pageW - margin*2;
    var y = 0;
    var titleFromMd = (markdown.match(/^#\s+(.+)$/m)||[])[1] || filename.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ");
    function addHeader() {
      doc.setFillColor(99,102,241);
      doc.rect(0,0,pageW,72,"F");
      doc.setFillColor(129,140,248);
      doc.rect(0,68,pageW,4,"F");
      doc.setTextColor(255,255,255);
      doc.setFont("helvetica","bold");
      doc.setFontSize(13);
      doc.text("Anteemonee", margin, 30);
      doc.setFontSize(7);
      doc.setFont("helvetica","normal");
      doc.setTextColor(224,231,255);
      doc.text("AI Study Tutor  •  Beautiful Document", margin, 44);
      doc.setFontSize(7);
      doc.setTextColor(255,255,255);
      doc.text(new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}), pageW - margin - 85, 30);
      doc.setFontSize(6);
      doc.setTextColor(224,231,255);
      doc.text("anteemonee.com", pageW - margin - 85, 44);
    }
    function addFooter(pageNum) {
      doc.setFontSize(7);
      doc.setTextColor(100,116,139);
      doc.setFont("helvetica","normal");
      doc.text("Generated by Anteemonee • AI Study Tutor", margin, pageH - 28);
      doc.text("Page "+pageNum, pageW - margin - 40, pageH - 28);
      doc.setDrawColor(226,232,240);
      doc.setLineWidth(0.6);
      doc.line(margin, pageH - 38, pageW - margin, pageH - 38);
    }
    function ensureSpace(need) {
      if (y + need > pageH - 55) {
        addFooter(doc.internal.getNumberOfPages());
        doc.addPage();
        y = 88;
        doc.setFillColor(99,102,241);
        doc.setDrawColor(99,102,241);
        doc.setLineWidth(2);
        doc.line(margin, 72, pageW - margin, 72);
      }
    }
    addHeader();
    y = 108;
    doc.setFillColor(248,250,252);
    doc.setDrawColor(226,232,240);
    doc.setLineWidth(0.8);
    var titleH = 56;
    doc.roundedRect(margin, y, contentW, titleH, 10, 10, "FD");
    doc.setTextColor(15,23,42);
    doc.setFont("helvetica","bold");
    doc.setFontSize(18);
    var titleLines = doc.splitTextToSize(titleFromMd, contentW - 28);
    if (titleLines.length>2) titleLines = titleLines.slice(0,2);
    var ty = y + 22;
    titleLines.forEach(function(l){ doc.text(l, margin+14, ty); ty+=16; });
    doc.setFont("helvetica","normal");
    doc.setFontSize(8);
    doc.setTextColor(100,116,139);
    doc.text(filename+"  •  "+new Date().toLocaleDateString(), margin+14, y+44);
    y += titleH + 22;
    var lines = markdown.split("\n");
    var inTable = false;
    var tableRows = [];
    function flushTable() {
      if (!tableRows.length) return;
      var cols = tableRows[0].length;
      var colW = contentW / cols;
      var rowH = 22;
      tableRows.forEach(function(row, ri){
        ensureSpace(rowH);
        var isHead = ri===0;
        if (isHead) {
          doc.setFillColor(99,102,241);
          doc.setTextColor(255,255,255);
          doc.setFont("helvetica","bold");
          doc.setFontSize(8);
        } else {
          doc.setFillColor(ri%2===0?248:255, ri%2===0?250:255, ri%2===0?252:255);
          doc.setTextColor(15,23,42);
          doc.setFont("helvetica","normal");
          doc.setFontSize(8);
        }
        row.forEach(function(cell, ci){
          var x = margin + ci*colW;
          doc.setDrawColor(226,232,240);
          doc.setLineWidth(0.5);
          doc.rect(x, y, colW, rowH, isHead?"FD":"S");
          var txt = doc.splitTextToSize(String(cell).trim().slice(0,80), colW-10);
          var tx = txt[0]||"";
          doc.text(tx, x+6, y+14);
        });
        y += rowH;
      });
      y += 8;
      tableRows = [];
      inTable = false;
    }
    for (var i=0;i<lines.length;i++) {
      var raw = lines[i];
      var t = raw.trim();
      if (!t) { y += 6; continue; }
      if (t.startsWith("|") && t.endsWith("|")) {
        var next = (lines[i+1]||"").trim();
        if (!inTable && /^\|[\s:|-]+\|$/.test(next)) {
          tableRows.push(t.split("|").filter(function(c){return c.trim();}).map(function(c){return c.trim();}));
          inTable = true;
          i++; continue;
        } else if (inTable) {
          tableRows.push(t.split("|").filter(function(c){return c.trim();}).map(function(c){return c.trim();}));
          continue;
        }
      } else if (inTable) {
        flushTable();
      }
      if (t.startsWith("# ")) {
        ensureSpace(30);
        doc.setTextColor(79,70,229);
        doc.setFont("helvetica","bold");
        doc.setFontSize(16);
        var txt = t.replace(/^#\s+/,"").trim();
        var wlines = doc.splitTextToSize(txt, contentW);
        wlines.forEach(function(l){ doc.text(l, margin, y); y+=18; });
        doc.setDrawColor(99,102,241);
        doc.setLineWidth(1.2);
        doc.line(margin, y-6, margin+36, y-6);
        y+=8;
      } else if (t.startsWith("## ")) {
        ensureSpace(26);
        doc.setTextColor(79,70,229);
        doc.setFont("helvetica","bold");
        doc.setFontSize(13);
        var txt2 = t.replace(/^##\s+/,"").trim();
        var w2 = doc.splitTextToSize(txt2, contentW);
        w2.forEach(function(l){ doc.text(l, margin, y); y+=15; });
        y+=4;
      } else if (t.startsWith("### ")) {
        ensureSpace(22);
        doc.setTextColor(13,148,136);
        doc.setFont("helvetica","bold");
        doc.setFontSize(11);
        var txt3 = t.replace(/^###\s+/,"").trim();
        var w3 = doc.splitTextToSize(txt3, contentW);
        w3.forEach(function(l){ doc.text(l, margin, y); y+=13; });
        y+=2;
      } else if (t.startsWith("- ") || t.startsWith("* ") || t.startsWith("• ")) {
        ensureSpace(16);
        var bullet = t.replace(/^[-*•]\s+/,"").trim().replace(/\*\*(.+?)\*\*/g,"$1");
        doc.setFillColor(13,148,136);
        doc.circle(margin+6, y-3, 2.2, "F");
        doc.setTextColor(30,41,59);
        doc.setFont("helvetica","normal");
        doc.setFontSize(9.5);
        var bLines = doc.splitTextToSize(bullet, contentW-18);
        var bx = margin+14;
        bLines.forEach(function(l, idx){
          doc.text(l, bx, y);
          if (idx < bLines.length-1) { y+=12; ensureSpace(12); }
        });
        y+=7;
      } else if (/^\d+\.\s/.test(t)) {
        ensureSpace(16);
        var num = t.match(/^(\d+)\./)[1];
        var ntxt = t.replace(/^\d+\.\s+/,"").trim().replace(/\*\*(.+?)\*\*/g,"$1");
        doc.setFillColor(99,102,241);
        doc.setTextColor(255,255,255);
        doc.setFont("helvetica","bold");
        doc.setFontSize(7);
        doc.circle(margin+8, y-3, 7, "F");
        doc.text(String(num), margin+8, y+1, {align:"center"});
        doc.setTextColor(30,41,59);
        doc.setFont("helvetica","normal");
        doc.setFontSize(9.5);
        var nLines = doc.splitTextToSize(ntxt, contentW-22);
        var nx = margin+20;
        nLines.forEach(function(l, idx){
          doc.text(l, nx, y);
          if (idx < nLines.length-1) { y+=12; ensureSpace(12); }
        });
        y+=7;
      } else if (t.startsWith("> ")) {
        ensureSpace(18);
        var q = t.replace(/^>\s+/,"").trim();
        doc.setFillColor(240,249,255);
        doc.setDrawColor(99,102,241);
        doc.setLineWidth(2);
        doc.rect(margin, y-9, contentW, 18, "FD");
        doc.line(margin, y-9, margin, y+9);
        doc.setTextColor(30,58,138);
        doc.setFont("helvetica","italic");
        doc.setFontSize(9);
        var qLines = doc.splitTextToSize(q, contentW-16);
        qLines.forEach(function(l){ doc.text(l, margin+10, y); y+=11; });
        y+=4;
      } else if (t.startsWith("```")) {
        var codeLines = [];
        i++;
        while (i<lines.length && !lines[i].trim().startsWith("```")) { codeLines.push(lines[i]); i++; }
        var codeStr = codeLines.join("\n").trim();
        if (codeStr) {
          ensureSpace(36);
          var codeH = Math.min(120, codeLines.length*11 + 18);
          ensureSpace(codeH);
          doc.setFillColor(15,23,42);
          doc.roundedRect(margin, y-10, contentW, codeH, 6,6,"F");
          doc.setTextColor(226,232,240);
          doc.setFont("courier","normal");
          doc.setFontSize(7.5);
          var cLines = doc.splitTextToSize(codeStr, contentW-16);
          var cy = y;
          cLines.slice(0,10).forEach(function(l){ doc.text(l, margin+8, cy); cy+=10; });
          y += codeH + 6;
        }
      } else {
        ensureSpace(16);
        var para = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");
        doc.setTextColor(15,23,42);
        doc.setFont("helvetica","normal");
        doc.setFontSize(9.5);
        var pLines = doc.splitTextToSize(para, contentW);
        pLines.forEach(function(l){
          doc.text(l, margin, y);
          y+=12;
          if (y > pageH - 60) ensureSpace(12);
        });
        y+=3;
      }
    }
    if (inTable) flushTable();
    var total = doc.internal.getNumberOfPages();
    for (var p=1; p<=total; p++) {
      doc.setPage(p);
      addFooter(p);
    }
    var blob = doc.output("blob");
    return blob;
  } catch (e) {
    console.warn("[File] PDF gen failed:", e);
    return new Blob([markdown], {type:"text/plain"});
  }
}
function generateBeautifulDocx(filename, markdown) {
  return new Promise(function(resolve){
    try {
      if (!window.docx) throw new Error("docx not loaded");
      var docx = window.docx;
      var titleFromMd = (markdown.match(/^#\s+(.+)$/m)||[])[1] || filename.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ");
      var children = [];
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: titleFromMd, bold: true, size: 32, color: "6366F1" })],
        heading: docx.HeadingLevel.TITLE,
        spacing: { after: 200 },
        alignment: docx.AlignmentType.CENTER,
      }));
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: "Anteemonee  •  "+new Date().toLocaleDateString()+"  •  "+filename, size: 16, color: "64748B", italics: true })],
        alignment: docx.AlignmentType.CENTER,
        spacing: { after: 400 },
      }));
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: "", break: 1 })],
        border: { bottom: { color: "6366F1", space: 1, style: docx.BorderStyle.SINGLE, size: 6 } },
        spacing: { after: 300 },
      }));
      var lines = markdown.split("\n");
      var inCode = false;
      var codeBuf = [];
      for (var i=0;i<lines.length;i++) {
        var raw = lines[i];
        var t = raw.trim();
        if (!t) { children.push(new docx.Paragraph({ spacing: { after: 120 } })); continue; }
        if (t.startsWith("```")) {
          if (!inCode) { inCode = true; codeBuf = []; }
          else {
            inCode = false;
            var codeStr = codeBuf.join("\n");
            children.push(new docx.Paragraph({
              children: [new docx.TextRun({ text: codeStr, font: "Consolas", size: 16, color: "E2E8F0" })],
              shading: { type: docx.ShadingType.SOLID, color: "0F172A", fill: "0F172A" },
              spacing: { after: 200 },
            }));
            codeBuf = [];
          }
          continue;
        }
        if (inCode) { codeBuf.push(raw); continue; }
        if (t.startsWith("# ")) {
          var txt = t.replace(/^#\s+/,"").trim();
          children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: txt, bold: true, size: 28, color: "4F46E5" })], heading: docx.HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
        } else if (t.startsWith("## ")) {
          var txt2 = t.replace(/^##\s+/,"").trim();
          children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: txt2, bold: true, size: 24, color: "4F46E5" })], heading: docx.HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
        } else if (t.startsWith("### ")) {
          var txt3 = t.replace(/^###\s+/,"").trim();
          children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: txt3, bold: true, size: 22, color: "0D9488" })], heading: docx.HeadingLevel.HEADING_3, spacing: { before: 180, after: 80 } }));
        } else if (t.startsWith("- ") || t.startsWith("* ")) {
          var btxt = t.replace(/^[-*]\s+/,"").trim();
          children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: "•  "+btxt, size: 20, color: "0F172A" })], bullet: { level: 0 }, spacing: { after: 80 } }));
        } else if (/^\d+\.\s/.test(t)) {
          var ntxt = t.replace(/^\d+\.\s+/,"").trim();
          children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: ntxt, size: 20, color: "0F172A" })], numbering: { reference: "default-numbering", level: 0 }, spacing: { after: 80 } }));
        } else if (t.startsWith("> ")) {
          var qtxt = t.replace(/^>\s+/,"").trim();
          children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: qtxt, italics: true, size: 20, color: "1E40AF" })],
            shading: { type: docx.ShadingType.SOLID, color: "EFF6FF", fill: "EFF6FF" },
            indent: { left: 400 },
            spacing: { after: 120 },
          }));
        } else if (t.startsWith("|")) {
          var cells = t.split("|").filter(function(c){return c.trim();});
          if (/^[\s:|-]+$/.test(cells.join(""))) continue;
          children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: cells.join("  |  "), size: 18, color: "334155" })], spacing: { after: 40 } }));
        } else {
          var para = t.replace(/\*\*(.+?)\*\*/g, "$1");
          children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: para, size: 20, color: "0F172A" })], spacing: { after: 160 } }));
        }
      }
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: "Generated by Anteemonee • AI Study Tutor • anteemonee.com", size: 14, color: "64748B", italics: true })],
        alignment: docx.AlignmentType.CENTER,
        spacing: { before: 400 },
      }));
      var doc = new docx.Document({
        numbering: { config: [{ reference: "default-numbering", levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: "%1.", alignment: docx.AlignmentType.LEFT }] }] },
        sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children: children }],
      });
      docx.Packer.toBlob(doc).then(function(blob){ resolve(blob); }).catch(function(e){
        console.warn("[File] docx pack failed", e);
        resolve(new Blob([markdown], {type:"text/plain"}));
      });
    } catch (e) {
      console.warn("[File] docx gen failed", e);
      resolve(new Blob([markdown], {type:"text/plain"}));
    }
  });
}
function handleFileBlocks(div, text) {
  var blocks = parseFileBlocks(text);
  if (!blocks.length) return;
  var host = div.querySelector(".msg-body") || div;
  var existing = host.querySelectorAll(".file-card");
  existing.forEach(function(e){ e.remove(); });
  blocks.forEach(function(f){
    var card = document.createElement("div");
    card.className = "file-card";
    var ext = f.ext.toLowerCase();
    var icon = getFileIcon(ext);
    var preview = f.content.slice(0, 220).replace(/\n/g, " ").slice(0, 140);
    if (preview.length >= 140) preview += "…";
    card.innerHTML = "<div class=\"file-card-head\">" +
      "<span class=\"file-icon\">" + icon + "</span>" +
      "<span class=\"file-meta\"><span class=\"file-name\">" + escapeHtml(f.filename) + "</span><span class=\"file-sub\">" + ext.toUpperCase() + " • " + formatBytes(new Blob([f.content]).size) + " • Anteemonee Beautiful Design</span></span>" +
      "<span class=\"file-badge\">" + ext.toUpperCase() + "</span></div>" +
      "<div class=\"file-preview\">" + escapeHtml(preview) + "</div>" +
      "<div class=\"file-actions\"><button class=\"file-download-btn\" type=\"button\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg> Download</button><button class=\"file-preview-btn\" type=\"button\">Preview</button></div>";
    var dlBtn = card.querySelector(".file-download-btn");
    var prevBtn = card.querySelector(".file-preview-btn");
    dlBtn.addEventListener("click", function(){
      var filename = f.filename;
      var content = f.content;
      var extLower = ext;
      if (extLower === "pdf") {
        var blob = generateBeautifulPdf(filename, content);
        downloadBlob(blob, filename);
        showChatToast("PDF downloaded: " + filename);
      } else if (extLower === "docx" || extLower === "doc") {
        showChatToast("Generating Word file…");
        generateBeautifulDocx(filename, content).then(function(blob){
          downloadBlob(blob, filename);
          showChatToast("Word downloaded: " + filename);
        });
      } else if (extLower === "html") {
        var htmlDoc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>"+escapeHtml(filename)+"</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:800px;margin:40px auto;padding:32px;line-height:1.7;color:#0F172A;background:#F8FAFC}h1{color:#4F46E5;border-bottom:3px solid #6366F1;padding-bottom:12px}h2{color:#4F46E5;margin-top:28px}h3{color:#0D9488}blockquote{border-left:4px solid #6366F1;background:#EEF2FF;padding:12px 16px;border-radius:8px}code{background:#0F172A;color:#E2E8F0;padding:2px 6px;border-radius:4px}pre{background:#0F172A;color:#E2E8F0;padding:16px;border-radius:12px;overflow:auto}table{width:100%;border-collapse:collapse;margin:16px 0}th{background:#6366F1;color:#fff;padding:10px;text-align:left}td{padding:10px;border:1px solid #E2E8F0}tr:nth-child(even) td{background:#F8FAFC}header{border-bottom:2px solid #6366F1;padding-bottom:16px;margin-bottom:24px}footer{text-align:center;color:#64748B;font-size:12px;margin-top:40px;border-top:1px solid #E2E8F0;padding-top:16px}</style></head><body><header><h1>"+escapeHtml(filename.replace(/\.[^.]+$/,"").replace(/[_-]+/g," "))+"</h1><p style=\"color:#64748B\">Generated by Anteemonee • "+new Date().toLocaleDateString()+"</p></header><article>"+renderMarkdown(content).replace(/<p><\/p>/g,"")+"</article><footer>Generated by Anteemonee • AI Study Tutor</footer></body></html>";
        var blob2 = new Blob([htmlDoc], {type:"text/html"});
        downloadBlob(blob2, filename);
        showChatToast("HTML downloaded");
      } else {
        var blob3 = new Blob([content], {type: extLower==="json"?"application/json": extLower==="csv"?"text/csv":"text/plain"});
        downloadBlob(blob3, filename);
        showChatToast("Downloaded: " + filename);
      }
    });
    prevBtn.addEventListener("click", function(){
      var extLower = f.ext.toLowerCase();
      if (extLower === "html") {
        var htmlDoc2 = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Preview</title><style>body{font-family:Inter,sans-serif;max-width:800px;margin:40px auto;padding:24px;color:#0F172A}h1{color:#6366F1}h2{color:#4F46E5}h3{color:#0D9488}</style></head><body>"+renderMarkdown(f.content)+"</body></html>";
        var w = window.open("", "_blank");
        if (w) { w.document.write(htmlDoc2); w.document.close(); }
      } else {
        var overlay = document.createElement("div");
        overlay.className = "file-preview-overlay";
        overlay.innerHTML = "<div class=\"file-preview-modal\"><div class=\"file-preview-head\"><span>" + escapeHtml(f.filename) + "</span><button class=\"file-preview-close\" type=\"button\">&times;</button></div><div class=\"file-preview-body\">" + renderMarkdown(f.content.slice(0,8000)) + "</div></div>";
        document.body.appendChild(overlay);
        overlay.addEventListener("click", function(e){ if(e.target===overlay || e.target.closest(".file-preview-close")) overlay.remove(); });
      }
    });
    host.appendChild(card);
  });
}



  function finalizeStreamingMessage(div, text) {
    try {
      if (typeof _streamRenderTimer !== 'undefined' && _streamRenderTimer) { clearTimeout(_streamRenderTimer); }
    } catch (_) {}
    try { _streamRenderTimer = null; _pendingStreamDiv = null; _pendingStreamText = ''; } catch (_) {}
    const content = div.querySelector('.msg-content');
    var quiz = null;
    try {
      quiz = parseQuizBlock(text, !!div.__quizRequested) || div.__quiz || null;
    } catch (_) {}
    var displayText = stripEmptyReferences(stripFileBlocks(stripQuizBlock(stripSwitchMarkers(text), !!div.__quizRequested)));
    content.innerHTML = displayText ? renderMarkdown(displayText) : '';
    content.classList.toggle('is-empty', !displayText);
    try {
      if (typeof GitHub !== 'undefined' && getActivePersona().codingOnly) GitHub.handleAssistantMessage(div, text);
    } catch (_) {}
    try { handleFileBlocks(div, text); } catch (_) {}
    if (quiz) {
      div.__quiz = quiz;
      try { renderQuizCard(div, quiz); } catch (_) {}
    } else {
      div.__quiz = null;
      var oldCard = div.querySelector('.quiz-card');
      if (oldCard) oldCard.remove();
    }
  }

  function createAssistantMessage(text, div) {
    var quiz = div && div.__quiz ? div.__quiz : null;
    if (!quiz) {
      try { quiz = parseQuizBlock(text, !!(div && div.__quizRequested)); } catch (_) {}
    }
    var message = { role: 'assistant', content: stripEmptyReferences(stripQuizBlock(stripSwitchMarkers(text || ''), !!(div && div.__quizRequested))) };
    if (quiz) {
      try { message.quiz = normalizeQuizData(quiz) || quiz; } catch (_) { message.quiz = quiz; }
      if (div) div.__quiz = message.quiz;
    }
    return message;
  }

  // â”€â”€ Text Selection: Reply + Flashcard â”€â”€
  let pendingQuote = null; // { role: 'assistant'|'user', text }
  let pendingSel = null;
  let selToolbar = null;

  function getSelToolbar() {
    if (selToolbar) return selToolbar;
    selToolbar = document.createElement('div');
    selToolbar.id = 'sel-toolbar';
    selToolbar.innerHTML = `
      <button class="sel-tool-btn sel-reply" type="button">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
        <span>Reply</span>
      </button>
      <button class="sel-tool-btn sel-flashcard" type="button" title="Save as flashcard">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="7" y1="14" x2="13" y2="14"/></svg>
        <span>Flashcard</span>
      </button>`;
    document.body.appendChild(selToolbar);
    selToolbar.querySelector('.sel-reply').addEventListener('click', onReplyFromToolbar);
    selToolbar.querySelector('.sel-flashcard').addEventListener('click', onFlashcardFromToolbar);
    return selToolbar;
  }

  function showChatToast(msg) {
    try {
      var t = document.getElementById('chat-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'chat-toast';
        t.setAttribute('role', 'status');
        t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:9999;max-width:calc(100vw - 32px);text-align:center;padding:12px 22px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--text);background:var(--liquid-bg-strong, rgba(20,28,23,0.85));border:1px solid var(--liquid-border, rgba(255,255,255,0.14));box-shadow:0 10px 34px rgba(0,0,0,0.35);opacity:0;pointer-events:none;transition:opacity 0.25s ease;';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = '1';
      if (showChatToast._timer) clearTimeout(showChatToast._timer);
      showChatToast._timer = setTimeout(function () { t.style.opacity = '0'; }, 2600);
    } catch (_) {}
  }

  // Save the selected chat text as a flashcard row in Supabase, then open
  // the Flashcards page on that card so the user can add the question.
  // The selection goes into the BACK (answer) field. Nothing is kept in
  // localStorage - the row lives in the database.
  // ── Auto flashcard: when the user asked for one and the reply holds a ──
  // Front/Back pair, save it to the DB and open it in Flashcards (edit mode).
  function parseFlashcardFromText(reply) {
    try {
      const t = String(reply || '');
      const m = t.match(/\*\*Front:\*\*\s*([\s\S]+?)\s*\*\*Back:\*\*\s*([\s\S]+)/i);
      if (!m) return null;
      let front = m[1].trim();
      front = front.replace(/\n?\*{0,2}Subject:\*{0,2}.*$/gim, '').trim();
      front = front.replace(/\*\*/g, '').trim();
      let back = m[2].trim();
      back = back.replace(/Saved!\s*Opening it in Flashcards now\.?\s*/gi, '').trim();
      back = back.split(/\n\*{0,2}References:\*{0,2}[\s\S]*$/i)[0].trim();
      back = back.replace(/\n?\*{0,2}Subject:\*{0,2}.*$/gim, '').trim();
      back = back.replace(/\*\*/g, '').trim();
      back = back.replace(/Flashcard ready[\s\S]*$/i, '').trim();
      let subject = 'General';
      const sm = t.match(/\*\*Subject:\*\*\s*([^\n]+)/i);
      if (sm) subject = sm[1].replace(/\*\*/g, '').trim().slice(0, 60) || 'General';
      if (!front || !back) return null;
      return { front: front.slice(0, 500), back: back.slice(0, 2000), subject };
    } catch (_) { return null; }
  }

  let lastAutoFlashcard = { front: '', at: 0 };

  // Intent may live in an earlier message ("create a flashcard" → AI asks
  // for the topic → user replies with just the topic), so scan recent turns.
  function recentFlashcardIntent() {
    try {
      let seen = 0;
      for (let i = messages.length - 1; i >= 0 && seen < 4; i--) {
        const m = messages[i];
        if (!m || m.role !== 'user') continue;
        seen++;
        if (/flash\s*-?\s*cards?/i.test(String(m.content || ''))) return true;
      }
    } catch (_) {}
    return false;
  }

  function autoCreateFlashcardFromReply(userText, replyText) {
    try {
      if (!/flash\s*-?\s*cards?/i.test(String(userText || '')) && !recentFlashcardIntent()) return;
      const fc = parseFlashcardFromText(replyText);
      if (!fc) return;
      const key = fc.front.toLowerCase();
      if (lastAutoFlashcard.front === key && Date.now() - lastAutoFlashcard.at < 5 * 60 * 1000) return;
      (async () => {
        try {
          let user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
          if ((!user || !user.id) && typeof db !== 'undefined' && db) {
            try { const res = await db.auth.getUser(); user = res.data && res.data.user; } catch (_) {}
          }
          if (!user || !user.id) { showChatToast('Sign in to save flashcards.'); return; }
          if (typeof db === 'undefined' || !db) { showChatToast('Database unavailable. Check your connection.'); return; }
          showChatToast('Creating flashcard...');
          const ins = await db.from('flashcards').insert({ user_id: user.id, front: fc.front, back: fc.back, subject: fc.subject || 'General' }).select('id').single();
          if (ins.error || !ins.data) throw ins.error || new Error('insert failed');
          lastAutoFlashcard = { front: fc.front.toLowerCase(), at: Date.now() };
          try {
            if (window.AnteemoneeViews && window.AnteemoneeViews.showFlashcards) {
              window.AnteemoneeViews.showFlashcards(ins.data.id);
              return;
            }
          } catch (_) {}
          window.location.href = 'flashcards.html?edit=' + encodeURIComponent(ins.data.id);
        } catch (err) {
          console.warn('[AI] Auto flashcard failed:', err);
          showChatToast('Could not create flashcard.');
        }
      })();
    } catch (_) {}
  }

  async function onFlashcardFromToolbar() {
    if (!pendingSel || !pendingSel.text) return;
    var answer = String(pendingSel.text).trim().slice(0, 4000);
    if (!answer) return;
    hideSelToolbar();
    try {
      var user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
      if ((!user || !user.id) && typeof db !== 'undefined' && db) {
        try {
          var res = await db.auth.getUser();
          user = res.data && res.data.user;
        } catch (_) {}
      }
      if (!user || !user.id) {
        showChatToast('Sign in to save flashcards.');
        return;
      }
      if (typeof db === 'undefined' || !db) {
        showChatToast('Database unavailable. Check your connection.');
        return;
      }
      showChatToast('Saving flashcard...');
      var ins = await db.from('flashcards').insert({ user_id: user.id, front: '', back: answer }).select('id').single();
      if (ins.error) throw ins.error;
      try {
        if (window.AnteemoneeViews && window.AnteemoneeViews.showFlashcards) {
          window.AnteemoneeViews.showFlashcards(ins.data.id);
          return;
        }
      } catch (_) {}
      window.location.href = 'flashcards.html?edit=' + encodeURIComponent(ins.data.id);
    } catch (err) {
      console.warn('[AI] Flashcard save failed:', err);
      var msg = (err && err.message) || 'unknown error';
      if (err && (err.code === '42P01' || /schema cache|Could not find the table/i.test(msg))) {
        showChatToast('Flashcards table not set up yet. Open the Flashcards page for setup steps.');
      } else {
        showChatToast('Could not save flashcard: ' + String(msg).slice(0, 120));
      }
    }
  }

  function hideSelToolbar() {
    if (selToolbar) selToolbar.classList.remove('show');
    pendingSel = null;
  }

  function currentSelectionInChat() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const anchorEl = node.nodeType === 1 ? node : node.parentElement;
    if (!anchorEl || !anchorEl.closest || !anchorEl.closest('#messages-list')) return null;
    const msgEl = anchorEl.closest('.message');
    if (!msgEl || msgEl.dataset.idx === undefined || msgEl.dataset.idx === '') return null;
    const idx = parseInt(msgEl.dataset.idx, 10);
    const msg = messages[idx];
    if (!msg) return null;
    return { text, role: msg.role, rect: range.getBoundingClientRect() };
  }

  function refreshSelToolbar() {
    const bar = getSelToolbar();
    const found = currentSelectionInChat();
    if (!found || isStreaming) { hideSelToolbar(); return; }
    pendingSel = found;
    bar.classList.add('show');
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = found.rect.top - bh - 10;
    if (top < 8) top = found.rect.bottom + 10;
    let left = found.rect.left + (found.rect.width / 2) - (bw / 2);
    left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
    bar.style.top = Math.max(8, top) + 'px';
    bar.style.left = left + 'px';
  }

  function onReplyFromToolbar() {
    if (!pendingSel) return;
    pendingQuote = { role: pendingSel.role, text: pendingSel.text };
    renderQuoteChip();
    try { window.getSelection().removeAllRanges(); } catch (_) {}
    hideSelToolbar();
    chatInput.focus();
  }

  function renderQuoteChip() {
    let chip = document.getElementById('reply-chip');
    if (!pendingQuote) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'reply-chip';
      chip.innerHTML = `<div class="reply-chip-bar"></div>
        <div class="reply-chip-body"><div class="reply-chip-label"></div><div class="reply-chip-text"></div></div>
        <button class="reply-chip-cancel" type="button" aria-label="Cancel reply">Ã—</button>`;
      const area = document.querySelector('.chat-input-area');
      const wrapper = document.querySelector('.chat-input-wrapper');
      if (area && wrapper) area.insertBefore(chip, wrapper);
      chip.querySelector('.reply-chip-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        pendingQuote = null;
        renderQuoteChip();
        chatInput.focus();
      });
      chip.querySelector('.reply-chip-body').addEventListener('click', () => {
        if (pendingQuote) openQuoteModal(pendingQuote.role, pendingQuote.text);
      });
    }
    chip.querySelector('.reply-chip-label').textContent =
      'Replying to ' + (pendingQuote.role === 'assistant' ? 'AI' : 'you');
    chip.querySelector('.reply-chip-text').textContent = pendingQuote.text;
  }

  function quoteBlockHtml(quote) {
    if (!quote || !quote.text) return '';
    const label = quote.role === 'assistant' ? 'AI' : 'You';
    return `<div class="msg-quote" data-role="${quote.role === 'assistant' ? 'assistant' : 'user'}" data-full="${encodeURIComponent(quote.text)}" title="View quoted message">` +
      `<span class="msg-quote-label">${label}</span>` +
      `<span class="msg-quote-text">${escapeHtml(quote.text)}</span></div>`;
  }

  function openQuoteModal(role, text) {
    let ov = document.getElementById('quote-modal-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'quote-modal-overlay';
      ov.innerHTML = `<div class="quote-modal" role="dialog" aria-modal="true">
        <div class="quote-modal-head"><span class="quote-modal-title"></span><button class="quote-modal-close" type="button" aria-label="Close">Ã—</button></div>
        <div class="quote-modal-body"></div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => {
        if (e.target === ov || e.target.closest('.quote-modal-close')) closeQuoteModal();
      });
    }
    ov.querySelector('.quote-modal-title').textContent =
      'Quoted from ' + (role === 'assistant' ? 'AI' : 'you');
    ov.querySelector('.quote-modal-body').textContent = text;
    ov.classList.add('show');
  }

  function closeQuoteModal() {
    const ov = document.getElementById('quote-modal-overlay');
    if (ov) ov.classList.remove('show');
  }

  document.addEventListener('mouseup', (e) => {
    if (e.target && e.target.closest && e.target.closest('#sel-toolbar')) return;
    setTimeout(refreshSelToolbar, 10);
  });
  document.addEventListener('touchend', () => setTimeout(refreshSelToolbar, 350));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideSelToolbar(); closeQuoteModal(); }
  });
  if (typeof chatContent !== 'undefined' && chatContent) {
    chatContent.addEventListener('scroll', hideSelToolbar, { passive: true });
  }
  if (typeof messagesList !== 'undefined' && messagesList) {
    messagesList.addEventListener('click', (e) => {
      const q = e.target && e.target.closest ? e.target.closest('.msg-quote') : null;
      if (q) {
        try {
          openQuoteModal(q.dataset.role || 'assistant', decodeURIComponent(q.dataset.full || ''));
        } catch (_) {}
      }
    });
  }

  // â”€â”€ Session Management â”€â”€
  function getAccessToken() {
    try {
      // Use Supabase client to get the current session (always the active account)
      if (typeof db !== 'undefined' && db && db.auth) {
        // Synchronous check of the in-memory session cache
        const sessionStr = localStorage.getItem('sb-zkuytvjeqkpexcbyoyhz-auth-token');
        if (sessionStr) {
          const parsed = JSON.parse(sessionStr);
          return parsed?.access_token || null;
        }
      }
    } catch (_) {}
    return null;
  }

  async function syncSessionFromDB() {
    try {
      const { data: ent } = await db.rpc('get_entitlement_snapshot');
      if (ent) {
        sessionUsage = { ai_limit: ent.ai_limit, ai_used: ent.ai_used, period_end: ent.period_end, session_minutes: ent.ai_session_minutes || 45 };
        if (ent.active_session) {
          const dbMsgs = ent.active_session.messages_count || 0;
          const dbTokens = ent.active_session.tokens_used || 0;
          // Always use DB as source of truth for tokens
          if (!activeSession || activeSession.id !== ent.active_session.id) {
            activeSession = ent.active_session;
            estimatedTokensUsed = dbTokens;
          } else {
            // Same session â€” always trust DB for tokens
            activeSession.messages_count = dbMsgs;
            activeSession.tokens_used = dbTokens;
            estimatedTokensUsed = dbTokens;
          }
        } else {
          // No active session in DB â€” clear local if expired
          if (activeSession && new Date(activeSession.expires_at).getTime() <= Date.now()) {
            activeSession = null;
            estimatedTokensUsed = 0;
          }
        }
        updateSessionPanel();
        saveSessionState();
      }
    } catch (e) { console.warn('[Session] DB sync failed:', e); }
    try {
      const { data: streak } = await db.rpc('get_user_streak');
      if (streak) {
        streakCount = streak.current_streak || 0;
        longestStreak = streak.longest_streak || 0;
        updateSessionPanel();
        saveSessionState();
      }
    } catch (_) {}
  }

  async function startSession() {
    try {
      const token = getAccessToken();
      if (!token) {
        showSessionError('Please log in to use AI chat.');
        return false;
      }

      // Clean up old session in DB before starting new one
      if (activeSession?.id && db) {
        db.rpc('end_ai_session', { p_session_id: activeSession.id }).then(() => {}).catch(() => {});
      }

      const { data, error } = await db.rpc('start_ai_session');
      if (error) throw error;
      if (!data?.ok) {
        const retrySecs = data?.retry_after_seconds || 0;
        const retryTxt = retrySecs > 0 ? ` Try again in ${formatRetryAfter(retrySecs)}.` : '';
        const msg = data?.error === 'RATE_LIMITED'
            ? `You're starting sessions a little too fast.${retryTxt}`
            : data?.error === 'NOT_AUTHENTICATED'
              ? 'Please log in to use AI chat.'
              : 'Could not start session. Please try again.';
        showSessionError(msg);
        return false;
      }

      activeSession = data.session;
      sessionUsage = data.usage;
      // Always trust DB for tokens on new session
      estimatedTokensUsed = activeSession.tokens_used || 0;
      api.setAccessToken(token);
      updateSessionPanel();
      saveSessionState();
      // Fresh window, fresh memory context (background, never blocks).
      loadAiMemories();
      return true;
    } catch (e) {
      console.error('[Session] start failed:', e);
      const detail = e?.message || e?.hint || 'Unknown error';
      showSessionError(`Session error: ${detail}`);
      return false;
    }
  }

  function showSessionError(msg) {
    console.warn('[Session]', msg);
    chatInput.disabled = true;
    chatInput.placeholder = 'Error: ' + msg;
  }

  function formatPeriodEnd(iso) {
    if (!iso) return 'next month';
    const d = new Date(iso);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  // â”€â”€ Cost calculation â”€â”€
  // 100,000 tokens = $0.018 â†’ $0.00000018 per token
  // PKR rate (update periodically)
  const USD_TO_PKR = 280;
  const COST_PER_TOKEN_USD = 0.018 / 100000;

  function formatCostPKR(tokens) {
    const pkr = tokens * COST_PER_TOKEN_USD * USD_TO_PKR;
    if (pkr < 0.01) return 'Rs. 0';
    if (pkr < 1) return 'Rs. ' + pkr.toFixed(2);
    return 'Rs. ' + pkr.toFixed(pkr >= 100 ? 0 : 1);
  }

  // Auth gate: guests see no sessions and cannot chat at all.
  function isAuthed() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) return true;
    } catch (_) {}
    try {
      if (typeof getAccessToken === 'function' && getAccessToken()) return true;
    } catch (_) {}
    return false;
  }

  function refreshAuthGate() {
    var authed = isAuthed();
    var locked = false;
    try {
      document.body.classList.toggle('guest', !authed);
      if (typeof Access !== 'undefined' && Access.state.ready) locked = Access.applyChatPaywall();
      var labels = document.querySelectorAll('.sidebar-label');
      for (var li = 0; li < labels.length; li++) labels[li].style.display = authed ? '' : 'none';
      var wa = document.querySelectorAll('.welcome-action-btn');
      for (var wi = 0; wi < wa.length; wi++) wa[wi].disabled = !authed || locked;
    } catch (_) {}
    if (authed && !locked) return true;
    if (locked) {
      try {
        chatInput.value = '';
        chatInput.disabled = true;
        chatInput.placeholder = 'Your free trial has ended — get lifetime access to continue.';
        autoResize();
        btnSend.disabled = true;
        btnSend.style.display = 'flex';
        btnStop.style.display = 'none';
        isStreaming = false;
      } catch (_) {}
      return false;
    }
    // model selector hidden permanently — auto routing handles models
    if (authed) return true;
    try {
      chatInput.value = '';
      chatInput.disabled = true;
      chatInput.placeholder = 'Sign in to chat with Anteemonee...';
      autoResize();
      btnSend.disabled = true;
      btnSend.style.display = 'flex';
      btnStop.style.display = 'none';
      isStreaming = false;
    } catch (_) {}
    return false;
  }

  function updateSessionPanel() {}

  // Display-only helper: turns server retry_after_seconds into friendly text.
  function formatRetryAfter(secs) {
    const s = Math.max(1, Math.round(Number(secs) || 30));
    if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} minute${m === 1 ? '' : 's'} ${r}s` : `${m} minute${m === 1 ? '' : 's'}`;
  }

  // Estimate the BILLED prompt: everything actually sent to the model.
  function estimatePromptTokens(msgs) {
    let chars = 0;
    try {
      for (const m of (msgs || [])) {
        const c = m && m.content;
        chars += (typeof c === 'string' ? c.length : JSON.stringify(c || '').length);
      }
    } catch (_) {}
    return Math.ceil(chars / 4);
  }

  function estimateInputTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  // Greetings / small talk: answered with a minimal prompt (no textbook RAG,
  // no history) so a "hi" costs tens of tokens instead of thousands.
  var GREETING_RE = /^(hi+|hello+|hey+|yo|hii+|helloo+|aoa|salam|salaam|assalam\s*o?\s*alaikum|salam\s*o?\s*alaikum|adab|good\s*(morning|afternoon|evening|day|night)|how\s*are\s*you.*|what'?s?\s*up.*|how'?s?\s*it\s*going.*|howdy|sup|namaste)[\s!.,?~\-_]*$/i;

  function isInstantGreeting(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (t.length > 60) return false;
    return GREETING_RE.test(t);
  }

  function estimateOutputTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  function startSessionTimer() {}

  // ── Long-output continuation: when a response is cut off (model hit its ──
  // output limit) or a requested word count is far from met, keep streaming
  // more segments into the SAME message, rotating providers 0→1→2→0…
  // Stops on: natural finish, refusal, user Stop, session budget, seg cap.
  const MAX_CONTINUATIONS = 8;

  function parseRequestedWords(t) {
    try {
      const m = String(t || '').match(/(\d[\d,]*)\s*-?\s*words?\b/i);
      if (!m) return 0;
      return parseInt(m[1].replace(/,/g, ''), 10) || 0;
    } catch (_) { return 0; }
  }

  function countWords(t) {
    try { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }
    catch (_) { return 0; }
  }

  function looksRefusal(t) {
    return /i['’]m sorry,?\s+but i can['’]t\s+(provide|generate|write|create|do)|i can['’]t\s+(provide|generate)\s+a\s+[\d,]+-?word/i.test(String(t || ''));
  }

  async function maybeAutoContinue(streamDiv, userText) {
    try {
      if (!streamDiv || !document.body.contains(streamDiv)) return;
      if (streamDiv.__quizRequested) return;
      if (!activeSession) return;
      if (!lastApiMessages || !lastApiMessages.length) return;
      let asst = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i] && messages[i].role === 'assistant' && messages[i].content) { asst = messages[i]; break; }
      }
      if (!asst) return;
      if (looksRefusal(asst.content)) return; // never loop on refusals
      const requested = parseRequestedWords(userText);
      const cutByModel = api && api._lastFinishReason === 'length';
      if (!cutByModel && !(requested >= 800 && countWords(asst.content) < requested * 0.6)) return;
      // Strip any switch markers once, so per-segment finalize can't duplicate cards.
      try { asst.content = stripSwitchMarkers(asst.content); } catch (_) {}
      // Take over the UI for the continuation run.
      isStreaming = true;
      chatInput.disabled = true;
      btnSend.disabled = true;
      btnSend.style.display = 'none';
      btnStop.style.display = 'flex';
      if (scrollDownBtn) scrollDownBtn.classList.add('generating');
      const baseProvider = getActivePersona().providerIndex;
      for (let seg = 0; seg < MAX_CONTINUATIONS; seg++) {
        if (!streamDiv || !document.body.contains(streamDiv)) break;
        if (!activeSession) break;
        try { updateStreamingStatus(streamDiv, 'Continuing… (part ' + (seg + 2) + ')', 'analyzing'); } catch (_) {}
        const contMsgs = [
          ...lastApiMessages,
          { role: 'assistant', content: asst.content },
          { role: 'user', content: 'Continue exactly where you left off. Do not repeat anything already written, do not add any introduction, and do not add a conclusion unless the piece is actually finished.' },
        ];
        lastPromptTokens = estimatePromptTokens(contMsgs);
        const provIdx = (baseProvider + seg + 1) % 3;
        let segText = '';
        try {
          for await (const chunk of api.streamChat(contMsgs, provIdx)) {
            if (chunk && chunk.includes('"type":"streak"')) {
              try {
                const parsed = JSON.parse(chunk);
                if (parsed.type === 'streak') {
                  streakCount = parsed.current_streak || 0;
                  longestStreak = parsed.longest_streak || 0;
                  updateSessionPanel();
                  saveSessionState();
                  continue;
                }
              } catch (_) {}
            }
            segText += chunk;
            asst.content += chunk;
            updateStreamingMessageThrottled(streamDiv, asst.content);
            if (userNearBottom) scrollToBottom();
          }
        } catch (e) {
          if (e && (e.name === 'AbortError' || /aborted|abort/i.test(e.message || ''))) {
            asst.content += '\n\n*[Stopped]*';
            try { finalizeStreamingMessage(streamDiv, asst.content); } catch (_) {}
            break;
          }
          // Provider failed mid-segment: loop rotates to the next provider and
          // resumes from the partial text already appended above.
          console.warn('[AI] continuation segment failed, rotating provider:', (e && e.message) || e);
        }
        try {
          estimatedTokensUsed += lastPromptTokens + estimateOutputTokens(segText);
          if (activeSession) activeSession.tokens_used = estimatedTokensUsed;
          updateSessionPanel();
          saveSessionState();
        } catch (_) {}
        try { asst.content = stripSwitchMarkers(asst.content); } catch (_) {}
        try { finalizeStreamingMessage(streamDiv, asst.content); } catch (_) {}
        if (looksRefusal(segText)) break;
        const fr = api ? api._lastFinishReason : null;
        if (fr && fr !== 'length') break; // model finished naturally
        const need = parseRequestedWords(userText);
        if (!need || countWords(asst.content) >= need * 0.6) {
          if (!fr || fr !== 'length') break;
        }
      }
      try { persistConversation(); renderHistory(); } catch (_) {}
      try { reconcileTokensWithServer(); } catch (_) {}
    } catch (_) {}
    try {
      isStreaming = false;
      btnStop.style.display = 'none';
      btnSend.style.display = 'flex';
      btnSend.disabled = true;
      if (scrollDownBtn) scrollDownBtn.classList.remove('generating');
      chatInput.disabled = false;
      chatInput.focus();
    } catch (_) {}
  }

  function updateTokensAfterResponse(inputText, outputText) {
    if (!activeSession) return;
    // Bill what the request actually sent (full prompt), not just the new message.
    const promptTk = lastPromptTokens > 0 ? lastPromptTokens : estimateInputTokens(inputText);
    const outputTk = estimateOutputTokens(outputText);
    const newTokens = promptTk + outputTk;
    estimatedTokensUsed += newTokens;
    activeSession.tokens_used = estimatedTokensUsed;
    activeSession.messages_count = (activeSession.messages_count || 0) + 1;
    updateSessionPanel();
    saveSessionState();
    // Also sync to DB (edge function already does this, but we update messages_count here)
    if (db) {
      db.from('ai_sessions')
        .update({ messages_count: activeSession.messages_count })
        .eq('id', activeSession.id)
        .then(() => {})
        .catch(() => {});
    }
    // Reconcile with server truth: the server bills the FULL prompt each
    // request (system + textbook + history) while the client only estimated
    // the new pair. Poll until the committed server value catches up, so the
    // panel never jumps on refresh. Never let the display regress.
    try { reconcileTokensWithServer(); } catch (_) {}
  }

  function reconcileTokensWithServer() {
    try {
      if (reconcileTokensWithServer._t) clearTimeout(reconcileTokensWithServer._t);
    } catch (_) {}
    const sid = activeSession ? activeSession.id : null;
    const prior = estimatedTokensUsed;
    let attempts = 0;
    const trySync = async () => {
      try {
        if (!activeSession || activeSession.id !== sid) return; // session changed/ended
        attempts++;
        try { await syncSessionFromDB(); } catch (_) {}
        if (!activeSession || activeSession.id !== sid) return;
        if (estimatedTokensUsed < prior && attempts < 4) {
          // Server hasn't committed this response yet — keep the live number, retry.
          estimatedTokensUsed = prior;
          activeSession.tokens_used = prior;
          try { updateSessionPanel(); } catch (_) {}
          try { reconcileTokensWithServer._t = setTimeout(trySync, 6000); } catch (_) {}
        }
      } catch (_) {}
    };
    try { reconcileTokensWithServer._t = setTimeout(trySync, 3000); } catch (_) {}
  }

  async function refreshStreak() {
    try {
      const { data } = await db.rpc('get_user_streak');
      if (data) {
        streakCount = data.current_streak || 0;
        longestStreak = data.longest_streak || 0;
        updateSessionPanel();
        saveSessionState();
      }
    } catch (_) {}
  }

  function showSessionExpiredPopup() {}

  // â"€â"€ Send / Stop â"€â"€
  // blocked/exhausted session leaves isStreaming=true forever and every
  // later send is silently ignored (looks "stuck").
  function unlockInputForRetry(placeholder) {
    isStreaming = false;
    btnStop.style.display = 'none';
    btnSend.style.display = 'flex';
    btnSend.disabled = true;
    chatInput.disabled = false;
    if (placeholder) chatInput.placeholder = placeholder;
    chatInput.focus();
    if (scrollDownBtn) {
      scrollDownBtn.classList.remove('generating');
      scrollDownBtn.classList.remove('show');
    }
  }

  // Throttled streaming renderer: rewriting innerHTML on EVERY token chunk
  // is O(n^2) DOM work and janks badly on long code outputs. Cap at ~16fps.
  var _lastStreamRender = 0;
  var _pendingStreamText = '';
  var _pendingStreamDiv = null;
  var _streamRenderTimer = null;
  function flushStreamingRender() {
    _streamRenderTimer = null;
    if (_pendingStreamDiv) {
      _lastStreamRender = Date.now();
      updateStreamingMessageImmediate(_pendingStreamDiv, _pendingStreamText);
      if (userNearBottom) scrollToBottom();
    }
  }
  function updateStreamingMessageThrottled(div, text) {
    _pendingStreamDiv = div;
    _pendingStreamText = text;
    var now = Date.now();
    if (now - _lastStreamRender >= 60) {
      if (_streamRenderTimer) { clearTimeout(_streamRenderTimer); _streamRenderTimer = null; }
      _lastStreamRender = now;
      updateStreamingMessageImmediate(div, text);
      if (userNearBottom) scrollToBottom();
    } else if (!_streamRenderTimer) {
      _streamRenderTimer = setTimeout(flushStreamingRender, 60);
    }
  }

  async function handleSend() {
    const text = chatInput.value.trim();
    const hasImages = pendingImages.length > 0;
    const quizRequested = !hasImages && shouldCreateQuiz(text);
    if (!hasImages && isQuizRequest(text) && !hasQuizTopic(text)) pendingQuizTopic = true;
    if ((!text && !hasImages) || isStreaming) return;
    if (!isAuthed()) { refreshAuthGate(); return; }
    try { if (typeof Access !== 'undefined' && Access.state.ready && !Access.state.access) { refreshAuthGate(); return; } } catch (_) {}

    // Lock immediately â€” prevent double-send during any async gap
    isStreaming = true;
    chatInput.disabled = true;
    btnSend.disabled = true;
    const quote = pendingQuote;
    const imagesToSend = [...pendingImages]; // snapshot before clearing
    hideSelToolbar();

    // Refresh AI preferences in case user changed them mid-session
    await loadAiPrefs();

    // â”€â”€ Session gate: must have an active session â”€â”€
    if (!activeSession || new Date(activeSession.expires_at).getTime() <= Date.now()) {
      const started = await startSession();
      if (!started) { unlockInputForRetry(); return; } // blocked -- no sessions left
    }

    // Start study timer if page is visible and session is active
    if (document.visibilityState === 'visible') {
      startStudyTimer();
    }

    // â”€â”€ Token budget check â”€â”€
    chatInput.value = '';
    autoResize();
    btnSend.disabled = true;
    chatInput.disabled = true;
    clearPendingImages();
    // Repo attachments belong to Coder only: study messages auto-disconnect the repo
    try {
      if (typeof GitHub !== 'undefined' && !isCodingTask(text)) GitHub.disconnectRepo();
    } catch (_) {}

    if (welcome.style.display !== 'none') {
      welcome.style.display = 'none';
      messagesList.style.display = 'flex';
    }

    appendMessage('user', text || '', true, { idx: messages.length, quote: quote || null, images: hasImages ? imagesToSend : null });
    messages.push(quote ? { role: 'user', content: text, quote, images: hasImages ? imagesToSend : null } : { role: 'user', content: text, images: hasImages ? imagesToSend : null });
    bumpCounters(['total_messages', 'user_messages']);
    hideAllFeedbackButtons();
    pendingQuote = null;
    renderQuoteChip();
    scrollToBottom();

    // Switch scroll-down button to generating state (only visible if scrolled up)
    if (scrollDownBtn) {
      scrollDownBtn.classList.add('generating');
      if (!userNearBottom) scrollDownBtn.classList.add('show');
    }
    btnSend.style.display = 'none';
    btnStop.style.display = 'flex';

    const streamDiv = createStreamingMessage(null);
    streamDiv.__quizRequested = quizRequested;
    const statusCycle = startStatusCycle(streamDiv, null);
    scrollToBottom();

    // Auto model routing: pick persona per message (no manual selector)
    try { applyPersonaForText(text); } catch (_) {}
    try { updatePersonaUI(); } catch (_) {}

    // Textbook RAG is study-only: Coder (coding agent) skips it entirely.
    // Saves a DB round trip and keeps the coding prompt lean (faster TTFT).
    // Textbook search + memory reload run in parallel, not sequentially.
    const isCodingAgent = getActivePersona().codingOnly;
    const isGreetingMsg = !hasImages && !pendingQuote && isInstantGreeting(text);
    // Pure writing tasks are composed from knowledge — retrieval only burns tokens.
    const isGenerationTask = /\b(write|writes|writing|compose|draft|generate|create|make|prepare)\b[^.?!]{0,50}\b(essay|story|stories|poem|poems|poetry|speech|speeches|letter|letters|paragraph|paragraphs|precis|dialogue|dialogues|novel|autobiography)\b/i.test(text);
    const textbookPromise = (isCodingAgent || isGreetingMsg || isGenerationTask)
      ? Promise.resolve([])
      : searchTextbooks(text).catch(function (err) {
          console.warn('[AI] Textbook search failed:', err);
          return [];
        });
    const memoriesPromise = loadAiMemories().catch(function () {});
    const textbookPages = await textbookPromise;
    await memoriesPromise;
    let textbookContext = '';
    try {
      if (textbookPages.length > 0) {
        console.log(`[AI] Found ${textbookPages.length} textbook pages for: "${text}"`);
        console.log('[AI] Books:', textbookPages.map(p => `${p.book_title} p.${p.printed_page_number || p.page_number}`).join(', '));
        textbookContext = formatTextbookContext(textbookPages);
      } else if (!isCodingAgent) {
        console.log(`[AI] No textbook pages found for: "${text}"`);
      }
    } catch (e) {
      console.warn('[AI] Textbook search failed:', e);
    }

    // Fresh memory reload â€” picks up extractions from OTHER chats too.
    // Greetings get a tiny prompt: no system brick, no RAG, no history.
    const systemPrompt = isGreetingMsg
      ? ('You are a friendly study companion. The user just greeted you. Reply with a brief warm greeting (one or two short sentences max) and offer help. No references section.')
      : buildSystemPrompt() + textbookContext + (quizRequested ? quizProtocolPrompt() : '') + recentQuizContextPrompt();

    // Auth must be set before the vision call below: it hits an edge function
    // that rejects anonymous callers, and the token used to be applied further
    // down, after the messages were built.
    api.setSessionId(activeSession?.id || null);
    api.setAccessToken(getAccessToken());

    // ── Image reading pass, before any answer tokens are streamed ──
    // The chat model is text-only, so a vision model describes the images and
    // that description is injected as context. A failed read is NOT fatal: we
    // answer without the image rather than showing an error, but we tell the
    // student the image was not read so a confident answer cannot pretend
    // otherwise.
    let visionContext = '';
    let visionFailed = false;
    if (hasImages) {
      try {
        updateStreamingStatus(streamDiv, 'Reading the image' + (imagesToSend.length > 1 ? 's' : '') + '\u2026', 'analyzing');
        const vision = await api.describeImages({
          images: imagesToSend,
          question: text,
          subject: selectedSubject,
        });
        if (vision && vision.description) {
          visionContext =
            'The student attached ' +
            (vision.count > 1 ? vision.count + ' images' : 'an image') +
            '. A vision model read them and reported the following. Treat this as an ' +
            'accurate description of what is in the image(s), and answer the student from it. ' +
            'Never claim you cannot see the image: you are reading a description of it, and you ' +
            'should respond as though you have seen it. Never invent detail beyond this report.\n\n' +
            vision.description;
        }
      } catch (e) {
        visionFailed = true;
        console.warn('[Vision] image read failed:', e && (e.message || e));
        try {
          updateStreamingStatus(streamDiv, 'Could not read the image', 'analyzing');
        } catch (_) {}
      }
    }

    const imageAwarePrompt = visionContext
      ? systemPrompt + '\n\nIMAGE DESCRIPTION (from a vision model, treat as ground truth):\n' + visionContext
      : systemPrompt;
    if (visionFailed) {
      // Be explicit in the reply that the image was not read.
      try { updateStreamingStatus(streamDiv, 'Answering without the image', 'analyzing'); } catch (_) {}
    }

    const apiMessages = isGreetingMsg
      ? [{ role: 'system', content: imageAwarePrompt }, { role: 'user', content: text }]
      : [
      { role: 'system', content: imageAwarePrompt },
      ...messages.slice(-6).map(m => ({
        role: m.role,
        content: (m.quote
          ? `[Replying to ${m.quote.role === 'assistant' ? 'AI' : 'you'}: "${m.quote.text}"]\n${m.content}`
          : m.content) + (m.quiz ? '\n[Interactive quiz context: ' + quizForModel(m.quiz) + ']' : ''),
      })),
    ];
    // Snapshot what this request actually bills (system + textbook + history).
    lastPromptTokens = estimatePromptTokens(apiMessages);
    lastApiMessages = apiMessages;

    let fullResponse = '';
    let firstChunk = true;
    const selectedProviderIndex = getActivePersona().providerIndex;

    try {
    // Images are deliberately NOT forwarded: the chat model is text-only, so
    // the bytes would cost upload time and prompt tokens and be ignored. The
    // vision pass above already turned them into text context.
    for await (const chunk of api.streamChat(apiMessages, selectedProviderIndex, null)) {
        // Check for streak event from Edge Function
        if (chunk && chunk.includes('"type":"streak"')) {
          try {
            const parsed = JSON.parse(chunk);
            if (parsed.type === 'streak') {
              streakCount = parsed.current_streak || 0;
              longestStreak = parsed.longest_streak || 0;
              updateSessionPanel();
              saveSessionState();
              continue;
            }
          } catch (_) {}
        }
        fullResponse += chunk;
        if (firstChunk) {
          firstChunk = false;
          stopStatusCycle(statusCycle);
          updateStreamingStatus(streamDiv, 'Generating response...', 'analyzing');
        }
        updateStreamingMessageThrottled(streamDiv, fullResponse);
        if (userNearBottom) scrollToBottom();
      }

      finalizeStreamingMessage(streamDiv, fullResponse);
      autoCreateFlashcardFromReply(text, fullResponse);
      stopStatusCycle(statusCycle);
            const assistantMessage = createAssistantMessage(fullResponse, streamDiv);
            messages.push(assistantMessage);
            if (assistantMessage.quiz) pendingQuizTopic = false;
      attachFeedbackButtons(streamDiv);
      bumpCounters(['total_messages', 'ai_messages']);
      updateTokensAfterResponse(text, fullResponse);
      // Auto-play TTS if the message was sent via voice (within last 30s)
      try { if (typeof window.AnteemoneeVoice !== 'undefined' && window.AnteemoneeVoice.onAiResponseComplete) window.AnteemoneeVoice.onAiResponseComplete(messages[messages.length - 1].content); } catch (_) {}
      userNearBottom = true;
      if (scrollDownBtn) {
        scrollDownBtn.classList.remove('generating');
        scrollDownBtn.classList.remove('show');
      }
    } catch (error) {
      // â”€â”€ Auto-retry on NO_SESSION: session exists locally but not in DB â”€â”€
      if (error.message && error.message.includes('NO_SESSION')) {
        console.warn('[AI] Session not found in DB. Starting fresh session and retrying...');
        activeSession = null;
        estimatedTokensUsed = 0;
        clearSessionState();
        const restarted = await startSession();
        if (!restarted) {
          finalizeStreamingMessage(streamDiv, 'Session expired. Please try again.');
          messages.pop();
          return;
        }
        api.setSessionId(activeSession?.id || null);
        api.setAccessToken(getAccessToken());
        // Remove the failed user message + assistant bubble, then resend
        messages.pop();
        const failedBubbles = messagesList.querySelectorAll('.msg-user, .msg-assistant');
        if (failedBubbles.length) failedBubbles[failedBubbles.length - 1]?.remove();
        if (failedBubbles.length > 1) failedBubbles[failedBubbles.length - 2]?.remove();
        isStreaming = false;
        chatInput.value = text;
        pendingQuote = quote;
        renderQuoteChip();
        handleSend();
        return;
      }
      // â”€â”€ TOKEN_LIMIT: tokens exhausted but session still running â”€â”€
      if (error.message && error.message.includes('TOKEN_LIMIT')) {
        console.warn('[AI] Token limit reached. Session still active.');
        // If we have a partial response, try to continue with other providers
        if (fullResponse.length > 0) {
          const providers = [0, 1, 2].filter(i => i !== selectedProviderIndex);
          let continued = false;
          for (const fallbackIndex of providers) {
            try {
              console.warn(`[AI] Token limit. Trying provider ${fallbackIndex} to continue...`);
              const continuationMessages = [
                ...apiMessages,
                { role: 'assistant', content: fullResponse },
                { role: 'user', content: 'Your previous response was cut off. Please continue from where you left off. Do not repeat what was already said - just continue the explanation.' },
              ];
              lastPromptTokens = estimatePromptTokens(continuationMessages);
              for await (const chunk of api.streamChat(continuationMessages, fallbackIndex)) {
                if (chunk && chunk.includes('"type":"streak"')) {
                  try { const p = JSON.parse(chunk); if (p.type === 'streak') { streakCount = p.current_streak || 0; longestStreak = p.longest_streak || 0; updateSessionPanel(); saveSessionState(); continue; } } catch (_) {}
                }
                fullResponse += chunk;
                updateStreamingMessageThrottled(streamDiv, fullResponse);
                if (userNearBottom) scrollToBottom();
              }
              continued = true;
              break;
            } catch (_) { continue; }
          }
          if (continued) {
            finalizeStreamingMessage(streamDiv, fullResponse);
            autoCreateFlashcardFromReply(text, fullResponse);
      const assistantMessage = createAssistantMessage(fullResponse, streamDiv);
      messages.push(assistantMessage);
      if (assistantMessage.quiz) pendingQuizTopic = false;
            attachFeedbackButtons(streamDiv);
            bumpCounters(['total_messages', 'ai_messages']);
            updateTokensAfterResponse(text, fullResponse);
            try { if (typeof window.AnteemoneeVoice !== 'undefined' && window.AnteemoneeVoice.onAiResponseComplete) window.AnteemoneeVoice.onAiResponseComplete(messages[messages.length - 1].content); } catch (_) {}
            isStreaming = false;
            if (scrollDownBtn) { scrollDownBtn.classList.remove('generating'); scrollDownBtn.classList.remove('show'); }
            btnStop.style.display = 'none';
            btnSend.style.display = 'flex';
            btnSend.disabled = true;
            chatInput.disabled = false;
            chatInput.focus();
            await maybeAutoContinue(streamDiv, text);
            return;
          }
        }
        // If no partial response or all providers failed
        finalizeStreamingMessage(streamDiv, 'All models are busy right now. Please try again in a moment.');
        messages.pop();
        isStreaming = false;
        if (scrollDownBtn) { scrollDownBtn.classList.remove('generating'); scrollDownBtn.classList.remove('show'); }
        btnStop.style.display = 'none';
        btnSend.style.display = 'flex';
        chatInput.disabled = false;
        return;
      }
      // â”€â”€ RATE_LIMITED / CONCURRENT_LIMIT: friendly, display-only â”€â”€
      if (error.message && (error.message.includes('RATE_LIMITED') || error.message.includes('CONCURRENT_LIMIT'))) {
        const secs = (error.retryAfter && Number(error.retryAfter)) || 30;
        const friendly = error.message.includes('CONCURRENT_LIMIT')
          ? 'Another reply is still generating. Wait for it to finish, then try again.'
          : `You're moving a little too fast. Try again in ${formatRetryAfter(secs)}.`;
        console.warn('[AI] Throttled:', error.message);
        finalizeStreamingMessage(streamDiv, friendly);
        stopStatusCycle(statusCycle);
        messages.pop();
        isStreaming = false;
        btnStop.style.display = 'none';
        btnSend.style.display = 'flex';
        chatInput.disabled = false;
        return;
      }
      // â”€â”€ IMAGE_LIMIT: daily image cap reached â”€â”€
      if (error.message && error.message.includes('IMAGE_LIMIT')) {
        console.warn('[AI] Image limit reached');
        finalizeStreamingMessage(streamDiv, 'Daily image limit reached. Upgrade to Premium for more images per day.');
        stopStatusCycle(statusCycle);
        messages.pop();
        isStreaming = false;
        btnStop.style.display = 'none';
        btnSend.style.display = 'flex';
        chatInput.disabled = false;
        return;
      }
      // If incomplete stream â€” auto-retry with fallback
      if (error instanceof IncompleteStreamError && fullResponse.length > 0) {
        const fallbackIndex = selectedProviderIndex === 0 ? 1 : 0;
        console.warn(`[AI] Stream incomplete. Retrying with fallback provider ${fallbackIndex}...`);

        // Add partial response as context so fallback continues from where it left off
        const continuationMessages = [
          ...apiMessages,
          { role: 'assistant', content: fullResponse },
          { role: 'user', content: 'Your previous response was cut off. Please continue from where you left off. Do not repeat what was already said - just continue the explanation.' },
        ];
        lastPromptTokens = estimatePromptTokens(continuationMessages);

        try {
          for await (const chunk of api.streamChat(continuationMessages, fallbackIndex)) {
            if (chunk && chunk.includes('"type":"streak"')) {
              try {
                const parsed = JSON.parse(chunk);
                if (parsed.type === 'streak') {
                  streakCount = parsed.current_streak || 0;
                  longestStreak = parsed.longest_streak || 0;
                  updateSessionPanel();
                  saveSessionState();
                  continue;
                }
              } catch (_) {}
            }
            fullResponse += chunk;
            updateStreamingMessageThrottled(streamDiv, fullResponse);
            if (userNearBottom) scrollToBottom();
          }
        } catch (fallbackError) {
          fullResponse += '\n\n*[Response continued but may be incomplete]*';
        }

        finalizeStreamingMessage(streamDiv, fullResponse);
        autoCreateFlashcardFromReply(text, fullResponse);
              const assistantMessage = createAssistantMessage(fullResponse, streamDiv);
            messages.push(assistantMessage);
            if (assistantMessage.quiz) pendingQuizTopic = false;
        attachFeedbackButtons(streamDiv);
        bumpCounters(['total_messages', 'ai_messages']);
        updateTokensAfterResponse(text, fullResponse);
        try { if (typeof window.AnteemoneeVoice !== 'undefined' && window.AnteemoneeVoice.onAiResponseComplete) window.AnteemoneeVoice.onAiResponseComplete(messages[messages.length - 1].content); } catch (_) {}
      } else if (error && (error.name === 'AbortError' || /aborted|abort/i.test(error.message || ''))) {
        // User tapped Stop: keep whatever streamed so far, no error text.
        stopStatusCycle(statusCycle);
        var stoppedText = (fullResponse && fullResponse.trim())
          ? fullResponse + '\n\n*[Stopped]*'
          : '*[Stopped]*';
        finalizeStreamingMessage(streamDiv, stoppedText);
        const stoppedMessage = createAssistantMessage(stoppedText, streamDiv);
        messages.push(stoppedMessage);
        if (stoppedMessage.quiz) pendingQuizTopic = false;
        attachFeedbackButtons(streamDiv);
        updateTokensAfterResponse(text, stoppedText);
      } else {
        const errText = `Sorry, something went wrong. ${error.message}`;
        finalizeStreamingMessage(streamDiv, errText);
        const errorMessage = createAssistantMessage(errText, streamDiv);
        messages.push(errorMessage);
        if (errorMessage.quiz) pendingQuizTopic = false;
        updateTokensAfterResponse(text, errText);
      }
    }

    isStreaming = false;
    stopStatusCycle(statusCycle);
    // Restore scroll-down button to normal state
    if (scrollDownBtn) {
      scrollDownBtn.classList.remove('generating');
      scrollDownBtn.classList.remove('show');
    }
    btnStop.style.display = 'none';
    btnSend.style.display = 'flex';
    btnSend.disabled = true;
    // Re-enable input
    chatInput.disabled = false;
    chatInput.focus();

    // Long outputs: keep streaming follow-up segments into the same message.
    await maybeAutoContinue(streamDiv, text);

    const isFirstExchange = !activeConversationId;
    const firstUserText = messages.length ? messages[0].content : '';
    saveConversation();
    if (isFirstExchange && firstUserText) generateChatTitle(activeConversationId, firstUserText);
    scrollToBottom();
  }

  function handleStop() {
    api.abort();
  }

  // â”€â”€ Helpers â”€â”€
  function autoResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContent.scrollTop = chatContent.scrollHeight;
    });
  }

  // â”€â”€ Mobile keyboard: lift the fixed chat layout above the virtual keyboard â”€â”€
  // Chrome Android handles interactive-widget=resizes-content in the viewport meta.
  // iOS Safari ignores that entirely, so we read the visual viewport shrink and
  // mirror it into --kb-offset (consumed by .chatbot-layout bottom).
  function setupKeyboardAwareLayout() {
    try {
      if (!window.visualViewport) return;
      var vv = window.visualViewport;
      var layout = document.querySelector('.chatbot-layout');
      if (!layout) return;
      var rafId = null;

      function applyOffset() {
        var kbHeight = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        layout.style.setProperty('--kb-offset', kbHeight + 'px');
        if (kbHeight > 40) {
          userNearBottom = true;
          scrollToBottom();
          if (scrollDownBtn) scrollDownBtn.classList.remove('show');
        }
      }

      // visualViewport fires on resize (keyboard open/close) and scroll (scroll-snap)
      vv.addEventListener('resize', applyOffset);
      vv.addEventListener('scroll', applyOffset);

      // On iOS Safari the keyboard animation can lag behind the focus event.
      // Poll for a few animation frames after focus to catch the final height.
      function onInputFocus() {
        applyOffset();
        var frames = 0;
        function poll() {
          applyOffset();
          frames++;
          if (frames < 12) rafId = requestAnimationFrame(poll);
        }
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(poll);
      }

      chatInput.addEventListener('focus', onInputFocus);
      chatInput.addEventListener('blur', function () {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        // Reset after a tick so the transition looks clean
        setTimeout(function () {
          layout.style.setProperty('--kb-offset', '0px');
        }, 50);
      });
    } catch (_) {}
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function openMobileSidebar() {
    document.getElementById('mobile-sidebar')?.classList.add('active');
    document.getElementById('mobile-sidebar-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileSidebar() {
    document.getElementById('mobile-sidebar')?.classList.remove('active');
    document.getElementById('mobile-sidebar-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Voice-call scratch space: call turns live in `messages` while on call,
  // then are rewound on hang-up — never saved, never in history.
  window.AnteemoneeVoiceStore = {
    mark() { try { return messages.length; } catch (_) { return 0; } },
    rewind(n) {
      try {
        n = Math.max(0, n | 0);
        if (messages.length > n) messages = messages.slice(0, n);
        messagesList.innerHTML = '';
        if (!messages.length) { welcome.style.display = 'flex'; messagesList.style.display = 'none'; }
        else {
          welcome.style.display = 'none'; messagesList.style.display = 'flex';
          messages.forEach((m, i) => appendMessage(m.role, m.content, false, { idx: i, quote: m.quote || null, images: m.images || null, quiz: m.quiz || null }));
        }
        try { renderHistory(); } catch (_) {}
        try { scrollToBottom(); } catch (_) {}
      } catch (_) {}
    },
  };
})();

function copyCodeBlock(btn) {
  const codeBlock = btn.closest('.code-block');
  const code = codeBlock.querySelector('code');
  navigator.clipboard.writeText(code.textContent).then(() => {
    const label = btn.querySelector('span');
    const original = label.textContent;
    label.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { label.textContent = original; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {});
}
