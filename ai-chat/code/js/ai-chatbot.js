/* ==========================================
   Anteemonee Chatbot - Full Implementation
   ========================================== */

(function () {
  'use strict';

  try { console.info('[Anteemonee AI] js build v102 (slash commands + tests)'); } catch (_) {}

  // â”€â”€ State â”€â”€
  const api = new AiApiService();
  let conversations = [];
  let activeConversationId = null;

  // Chat store lifecycle. The composer must never wait on this: the history
  // list shows a loading state, and anything the user writes in the meantime
  // is written to localStorage immediately and uploaded once the store lands.
  let chatStoreReady = false;
  const pendingDbUploads = new Set();
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

  // ── Per-chat share code: only the owner can open the chat by this code ──
  function makeShareCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }
  function ensureShareCodes() {
    var changed = false;
    conversations.forEach(function(c) {
      if (!c.shareCode) { c.shareCode = makeShareCode(); changed = true; }
    });
    if (changed) {
      if (currentUserId()) {
        conversations.forEach(function(c) { saveConversationToDb(c).catch(function() {}); });
      } else {
        writeLocalConversations();
      }
    }
  }
  function resolveConversationByCode(code) {
    var q = String(code || '').trim().toLowerCase();
    if (!q) return null;
    for (var i = 0; i < conversations.length; i++) {
      var c = conversations[i];
      if (!c) continue;
      if (typeof c.shareCode === 'string' && c.shareCode.toLowerCase() === q) return c;
      if (typeof c.id === 'string' && c.id.toLowerCase() === q) return c;
    }
    return null;
  }
  function clearChatUrlParam() {
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.has('chat')) {
        u.searchParams.delete('chat');
        window.history.replaceState({}, '', u.pathname + u.search + u.hash);
      }
    } catch (_) {}
  }
  function setChatUrlParam(code) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('chat', code);
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch (_) {}
  }

  function getChatLinkParts() {
    try {
      var u = new URL(window.location.href);
      var code = u.searchParams.get('chat');
      if (code) return { path: '/ai-chat/?chat=' + code, full: u.origin + '/ai-chat/?chat=' + code };
    } catch (_) {}
    return null;
  }
  function updateChatLinkBar() {
    try {
      var pill = document.getElementById('chat-link-pill');
      var textEl = document.getElementById('chat-link-text');
      if (!pill || !textEl) return;
      var parts = getChatLinkParts();
      if (parts) {
        textEl.textContent = parts.path;
        pill.style.display = '';
      } else {
        pill.style.display = 'none';
      }
    } catch (_) {}
  }
  function personaStorageKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'Anteemonee_ai_persona_' + currentUser.id;
    return 'Anteemonee_ai_persona_anon';
  }
  function sessionStateKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'Anteemonee_ai_session_' + currentUser.id;
    return 'Anteemonee_ai_session_anon';
  }
  // ── Chat store: every signed-in student syncs across devices ──
  let isPremiumTier = false;

  async function refreshTier() {
    // No tiers anymore: signed in means full access.
    isPremiumTier = !!currentUserId();
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
        // (attached uploads + generated images, largest first)
        for (let i = conversations.length - 1; i >= 0; i--) {
          conversations[i].messages.forEach(m => { m.images = null; m.generatedImage = null; });
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
    if (currentUserId()) {
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
      // Generated images are now small public URLs (uploaded by ai-image on
      // the server), so keep them in the DB messages payload.
      const dbMessages = Array.isArray(conv.messages) ? conv.messages : [];
      const row = {
        id: conv.id,
        user_id: uid,
        title: conv.title || 'New Chat',
        title_locked: !!conv.titleLocked,
        messages: dbMessages,
        updated_at: new Date().toISOString(),
        subject: subj,
      };
      // pinned column is optional — try to include it if present in conv
      if (typeof conv.pinned === 'boolean') row.pinned = !!conv.pinned;
      if (conv.shareCode) row.share_code = conv.shareCode;
      const { error } = await db.from('chat_conversations').upsert(row, { onConflict: 'id' });
      if (error) {
        // fallback if subject/pinned column missing
        if (/subject|pinned|column|share_code/i.test(error.message||'')) {
          if (typeof row.subject !== 'undefined' && /subject|column/i.test(error.message||'')) delete row.subject;
          if (typeof row.pinned !== 'undefined' && /pinned|column/i.test(error.message||'')) delete row.pinned;
          if (typeof row.share_code !== 'undefined' && /share_code|column/i.test(error.message||'')) delete row.share_code;
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
        .select('id,title,title_locked,messages,pinned,subject,share_code')
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
            shareCode: r.share_code || null,
          };
        });
      }
    } catch (_) {}
    try {
      const { data, error } = await db.from('chat_conversations')
        .select('id,title,title_locked,messages,pinned,share_code')
        .eq('user_id', uid).order('updated_at', { ascending: false }).limit(150);
      if (!error && data) {
        return data.map(r => ({
          id: r.id,
          title: r.title || 'New Chat',
          titleLocked: !!r.title_locked,
          messages: Array.isArray(r.messages) ? r.messages : [],
          pinned: !!r.pinned,
          subject: resolveConvSubject(r),
          shareCode: r.share_code || null,
        }));
      }
    } catch (_) {}
    const { data, error } = await db.from('chat_conversations')
      .select('id,title,title_locked,messages,share_code')
      .eq('user_id', uid).order('updated_at', { ascending: false }).limit(150);
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      title: r.title || 'New Chat',
      titleLocked: !!r.title_locked,
      messages: Array.isArray(r.messages) ? r.messages : [],
      pinned: false,
      subject: resolveConvSubject(r),
      shareCode: r.share_code || null,
    }));
  }

  async function deleteConversationFromDb(id) {
    try { await db.from('chat_conversations').delete().eq('id', id); } catch (_) {}
  }

  // Upload whatever was written while the store was still loading. Runs once,
  // after the DB rows have been merged in, so nothing created during the wait
  // is lost.
  async function flushPendingDbUploads(extraIds) {
    try {
      if (extraIds && extraIds.length) extraIds.forEach(function (id) { pendingDbUploads.add(id); });
      if (!pendingDbUploads.size) return;
      if (!currentUserId()) { pendingDbUploads.clear(); return; }
      var ids = Array.from(pendingDbUploads);
      pendingDbUploads.clear();
      for (const id of ids) {
        const conv = conversations.find(function (c) { return c.id === id; });
        if (conv) await saveConversationToDb(conv);
      }
    } catch (e) { console.warn('[AI] pending upload failed:', e); }
  }

  // Route a persistence write to DB (premium) or localStorage (free/guest).
  function persistConversation(convId) {
    try { if (window.__voiceEphemeral) return; } catch (_) {} // call chats: never saved
    if (!chatStoreReady) {
      // The store is still loading: save locally right now (instant, offline
      // safe) and queue this chat for upload once it finishes.
      writeLocalConversations();
      var pendingId = convId || activeConversationId;
      if (pendingId) pendingDbUploads.add(pendingId);
      return;
    }
    if (currentUserId()) {
      const conv = conversations.find(c => c.id === (convId || activeConversationId));
      if (conv) saveConversationToDb(conv).catch(() => {});
    } else {
      writeLocalConversations();
    }
  }

  // Live graph edits (title, values, type, rows) are written back into the
  // owning message so they survive reloads AND sync to other devices through
  // the DB. `div.dataset.idx` (set on every render) indexes into `messages`.
  function __graphEdited(idx, data) {
    try {
      var i = parseInt(idx, 10);
      if (!messages || !Number.isFinite(i) || i < 0 || i >= messages.length) return;
      var m = messages[i];
      if (!m || m.role !== 'assistant') return;
      var normalized = normalizeGraphData(data);
      if (!normalized) return;
      m.graph = normalized;
      persistConversation(activeConversationId);
    } catch (_) {}
  }
  window.__anteemoneeGraphEdited = __graphEdited;

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

  // Chats written while the store was loading live in localStorage only. Fold
  // them into the freshly loaded rows (local wins when it is newer) and report
  // which ids still need uploading.
  function mergeLocalChats(rows, queued) {
    var ids = {};
    rows.forEach(function (r) { ids[r.id] = 1; });
    var local = readLocalConversations();
    local.forEach(function (c) { if (!c.subject) c.subject = selectedSubject; });
    local.forEach(function (c) {
      if (!ids[c.id]) {
        // Never uploaded: keep it and queue the upload.
        if ((c.subject || selectedSubject) === selectedSubject) { rows.push(c); ids[c.id] = 1; queued.push(c.id); }
        return;
      }
      // Present in the DB already: local may hold newer messages.
      var row = rows.find(function (r) { return r.id === c.id; });
      if (row && c.messages && c.messages.length > ((row.messages && row.messages.length) || 0)) {
        row.messages = c.messages;
        row.updatedAt = c.updatedAt;
        queued.push(c.id);
      }
    });
    return rows;
  }

  async function initConversationStore() {
    const uid = currentUserId();
    // Show the loading state in the history lists straight away.
    chatStoreReady = false;
    try { renderHistory(); } catch (_) {}
    var queued = [];
    if (uid) {
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
          mergeLocalChats(filtered, queued);
          conversations = filtered.slice(0, 50);
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
          if (uid) {
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
    if (!uid) pruneLocalConversations();
    // Chats written during the wait are in localStorage; fold them in.
    try {
      var late = [];
      mergeLocalChats(conversations, late);
      conversations = conversations.slice(0, 50);
      queued = queued.concat(late);
    } catch (_) {}
    chatStoreReady = true;
    try { renderHistory(); } catch (_) {}
    flushPendingDbUploads(queued);
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
        pill.style.setProperty('--subj-color', meta.color);
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
      var meta = getSubjectMeta(s.name);
      return '<button type="button" class="subject-item' + (isActive ? ' active' : '') + '" role="option"' +
        ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
        ' data-subject="' + s.name.replace(/"/g,'&quot;') + '" style="--subj-color:' + meta.color + '">' +
        '<span class="dot"></span>' +
        '<span class="subject-item-name">' + s.name + '</span>' +
        '<span class="subject-item-check" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>' +
        '</button>';
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
      closeSubjectDropdown(document.getElementById('subject-dropdown'), document.getElementById('subject-pill'));
      return;
    }
    // Save current subject's conversations before switching
    // No need to explicitly save, they are already persisted via chatStorageKey
    selectedSubject = name;
    saveSelectedSubject();
    updateSubjectUI();
    renderSubjectList();
    closeSubjectDropdown(document.getElementById('subject-dropdown'), document.getElementById('subject-pill'));
    // Reload conversations for new subject
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
      try { syncWelcomeMode(); } catch (_) {}
      // Reload from storage/DB for new subject. Background: the composer stays
      // usable while the list reloads.
      try { initConversationStore().catch(function (e) { console.warn('[AI] store reload failed:', e); }); } catch (_) {}
    try { ensureShareCodes(); } catch (_) {}
    // Deep link to one of the user's chats via ?chat=SHARECODE.
    // Anyone else landing here is moved to their own first chat.
    try {
      var deepCode = null;
      try { deepCode = new URL(window.location.href).searchParams.get('chat'); } catch (_) {}
      if (deepCode) {
        var owned = resolveConversationByCode(deepCode);
        if (owned) {
          loadConversation(owned.id);
        } else {
          try { renderHistory(); } catch (_) {}
          var first = conversations.find(function(c){ return (c.subject || 'Physics') === selectedSubject; }) || conversations[0];
          if (first) loadConversation(first.id);
          else newChat();
        }
      }
    } catch (_) {}
      try { applyPinnedState(); } catch(_) {}
      renderHistory();
      // Update filtered view if needed
      var inp = document.getElementById('chat-input');
      if (inp) inp.focus();
    } catch(e) { console.warn('[Subject] switch failed', e); }
  }
  var SUBJECT_SHEET_MAX = 420;
  function subjectDropdownIsPortalled(dd) {
    return !!(dd && dd.parentElement && dd.parentElement !== document.getElementById('subject-pill-wrap'));
  }
  // Phones only: the composer uses backdrop-filter, which makes it the
  // containing block for position:fixed children. Move the sheet to <body> so
  // it can span the viewport instead of being clipped by the composer.
  function portalSubjectDropdown(dd, pill) {
    if (!dd || !pill) return;
    var wantSheet = window.innerWidth <= SUBJECT_SHEET_MAX;
    var isSheet = subjectDropdownIsPortalled(dd);
    if (!wantSheet && isSheet) {
      var wrap = document.getElementById('subject-pill-wrap');
      if (wrap && dd.parentElement === document.body) wrap.appendChild(dd);
      dd.removeAttribute('style');
      return;
    }
    if (!wantSheet) return;
    if (!isSheet) document.body.appendChild(dd);
    var H = window.innerHeight || document.documentElement.clientHeight || 0;
    var GAP = 12;
    // Anchor on the pill's own edge when it is measurable. If it comes back
    // unmeasured (hidden mid-toggle, zero-height layout) anchor on the top of
    // the composer's toolbar instead, which is where the pill renders.
    // Walk a fallback chain: the pill itself, then its wrapper, then the
    // toolbar row. A theme flip or reflow can momentarily report a zero-size
    // rect, and anchoring on a stale edge would drop the sheet off screen.
    var probe = null;
    var candidates = [pill, document.getElementById('subject-pill-wrap'), document.querySelector('.chat-input-row-left')];
    for (var ci = 0; ci < candidates.length; ci++) {
      if (!candidates[ci]) continue;
      var cr = candidates[ci].getBoundingClientRect();
      if (cr && cr.height && cr.width) { probe = cr; break; }
    }
    var edgeTop = probe ? probe.top : null;
    var edgeBottom = probe ? probe.bottom : null;
    dd.style.position = 'fixed';
    dd.style.left = '10px';
    dd.style.right = '10px';
    dd.style.zIndex = '2600';
    if (edgeTop == null) {
      dd.style.top = '72px';
      dd.style.bottom = '12px';
      dd.style.maxHeight = Math.max(160, H - 84) + 'px';
      return;
    }
    // Anchor the sheet right above the pill, but flip below it when there is
    // clearly more room underneath. Whichever side wins, the sheet only gets
    // as tall as that side allows and otherwise sizes to its content, so the
    // six subjects stay visible without scrolling when there is space.
    var above = Math.round(edgeTop) - GAP;
    var below = Math.round(H - edgeBottom) - GAP;
    var useBelow = below > above && below > 240;
    if (useBelow) {
      dd.style.top = (Math.round(edgeBottom) + GAP) + 'px';
      dd.style.bottom = 'auto';
      dd.style.maxHeight = Math.max(120, below) + 'px';
    } else {
      dd.style.top = 'auto';
      // Anchoring the bottom edge keeps the sheet sitting just above the pill
      // no matter how tall its content ends up being.
      dd.style.bottom = (Math.round(H - edgeTop) + GAP) + 'px';
      dd.style.maxHeight = Math.max(120, above) + 'px';
    }
  }
  function closeSubjectDropdown(dd, pill) {
    if (dd) dd.classList.remove('open');
    if (pill) { pill.classList.remove('open'); pill.setAttribute('aria-expanded','false'); }
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
        closeSubjectDropdown(dd, pill);
      } else {
        renderSubjectList();
        portalSubjectDropdown(dd, pill);
        dd.classList.add('open');
        pill.classList.add('open');
        pill.setAttribute('aria-expanded','true');
        // One correction pass after layout settles.
        try {
          requestAnimationFrame(function(){ if (dd.classList.contains('open')) portalSubjectDropdown(dd, pill); });
        } catch (_) {}
        // Keep it correct if the window resizes while open.
        try {
          window.addEventListener('resize', function onRs(){
            if (!dd.classList.contains('open')) { window.removeEventListener('resize', onRs); return; }
            portalSubjectDropdown(dd, pill);
          }, { passive: true });
        } catch (_) {}
      }
    });
    document.addEventListener('click', function(e){
      // Once portalled the sheet is outside the wrap, so check the pill too.
      if (!wrap.contains(e.target) && e.target !== pill && !dd.contains(e.target)) {
        closeSubjectDropdown(dd, pill);
      }
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (dd.classList.contains('open')) closeSubjectDropdown(dd, pill);
      }
    });
    renderSubjectList();
    updateSubjectUI();
  }

  // Subject selector is for signed-in users only — guests keep the default
  // subject. Default markup stays visible; hide only once logged-out state
  // is confirmed so signed-in users never see a flicker.
  function updateSubjectVisibility() {
    try {
      var wrap = document.getElementById('subject-pill-wrap');
      if (!wrap) return true;
      var loggedIn = (typeof currentUser !== 'undefined' && currentUser && currentUser.id);
      if (loggedIn) { wrap.style.display = ''; return true; }
      if (window.__authReady === true || window.__aiAuthResolved === true) {
        wrap.style.display = 'none';
        return true;
      }
      return false;
    } catch (_) { return true; }
  }

  // ── Chats loading screen ──
  var _chatsLoadingFallback = null;
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

  // ── Graph intent (text -> interactive chart) ──────────────────
  // Trigger on "graph / chart / plot / bar chart / line chart / pie chart"
  // phrases. "draw a graph" is already a false friend for image generation,
  // so there is no overlap with the image pipeline.
  function isGraphRequest(text) {
    if (!text || isCodingTask(text)) return false;
    var t = String(text).toLowerCase();
    if (looksLikeTextOnlyAsk(t) && t.indexOf('graph') === -1 && t.indexOf('chart') === -1 && t.indexOf('plot') === -1) return false;
    if (/\b(?:bar|line|pie|scatter|area|column|histogram)\s+(?:chart|graph)\b/.test(t)) return true;
    // Common study phrasing: "speed-time graph", "velocity time graph",
    // "distance time graph", "make a graph of v = 10+2t", "plot this data".
    if (/(?:speed|velocity|distance|time|displacement|acceleration|force|position|energy|temperature|momentum)\s*-\s*(?:time|distance|velocity|speed|displacement)\s+graph\b/.test(t)) return true;
    if (/(?:make|draw|create|plot|generate|show|build)\b[^.?!]{0,40}\bgraph\b/.test(t)) return true;
    if (/\b(?:chart|graph|plot)\b/.test(t)) {
      // Skip: "graph theory", "graph of a function y=" follow-ups are still fine,
      // but "what is a graph" is a definition, not a chart request.
      if (/what is (?:a |the )?(?:graph|chart)\b/.test(t)) return false;
      if (/graph theory|theory of graph\b/.test(t)) return false;
      return true;
    }
    return false;
  }

  function graphProtocolPrompt() {
    return `
GRAPH RESPONSE FORMAT - CRITICAL, FOLLOW EXACTLY:
When the student asks you to create, make, draw or plot a graph, chart or data visualisation
(for example "draw a graph of v = 10 + 2t", "make a speed-time graph", "plot this data", "bar chart of results"),
you MUST include exactly ONE fenced code block tagged "graph" containing a single valid JSON object.
Normal explanatory text may come before and after it, but the graph JSON block itself is REQUIRED.
Follow this schema exactly:

\`\`\`graph
{
  "title": "Chart title",
  "type": "line",
  "xLabel": "X axis label",
  "yLabel": "Y axis label",
  "labels": ["2019", "2020", "2021"],
  "datasets": [
    { "name": "Series name", "data": [10, 25, 40] }
  ]
}
\`\`\`

Rules:
- "type" is one of: line, bar, pie, scatter, area. Choose the type that best fits the data.
- For a function or equation, compute at least 5 sensible data points yourself and put them in the dataset.
- "labels" must have the same length as every "data" array. For pie charts, labels are the slice names.
- Use the \`\`\`graph\`\`\` fence ONLY for a chart; never for any other JSON.
- If the student gave raw numbers, use exactly those numbers.
- If the student asks for a specific range (for example "speed from 0 to 10, time from 10s to 60s"),
  build sensible data points spanning that range and put them in labels/data.
- NEVER answer a graph request with text alone. Always include the \`\`\`graph\`\`\` block.
- Explain briefly below the chart what the graph shows.`;
  }

  // ── Image generation intent (text -> image, Qwen primary + Mistral fallback) ──
  // Explicit only: avoids hijacking "what is an image..." study questions.
  // Pure text trigger: no buttons or modes. Anything that reads like an
  // image request routes to image generation.
  // Widened so ordinary phrasing routes on its own: "sketch the water cycle",
  // "wallpaper of Karachi at night", "tasveer banao". An image noun is still
  // required, because bare "draw X" would swallow study questions like "draw a
  // conclusion" or "make a graph in the answer".
  var IMAGE_NOUNS = '(image|picture|photo|photograph|illustration|drawing|diagram|poster|logo|art|painting|sketch|wallpaper|meme|avatar|icon|banner|portrait|scene|artwork|visual)';
  var IMAGE_VERBS = '(generate|create|make|draw|paint|design|produce|show|give|send|render|sketch|illustrate|visualise|visualize|capture|illustrate)';
  // Roman Urdu and the phrasing students actually type.
  var IMAGE_URDU = '(tasveer|tasveerbanai|image|picture|photo|sketch|drawing|khanay|tablo)';

  // Phrases that look like an image request but are asking for words. These must
  // never be hijacked, or ordinary study help silently turns into a picture.
  var IMAGE_FALSE_FRIENDS = [
    'draw a conclusion', 'draw conclusions', 'draw a graph', 'draw graphs',
    'draw a diagram in', 'diagram in text', 'in text form', 'in text',
    'write a description', 'describe the image', 'what is an image',
    'what are images', 'types of image', 'image processing', 'image compression',
    'image format', 'unit of image', 'real image', 'virtual image',
    'make a plan', 'make a summary', 'make a table', 'make a list',
    'make a note', 'make a difference', 'show me how', 'show the steps',
    'show your work', 'show the formula', 'show me the code',
    'explain how images work', 'binary image', 'grayscale image',
  ];
  // ...unless the student is clearly contrasting it with a real picture.
  var IMAGE_FALSE_FRIEND_BYPASS = /(but|instead|rather)\b[^.?!]{0,40}\b(generate|create|draw|make|paint|render|sketch)\b/i;

  function looksLikeTextOnlyAsk(t) {
    for (var i = 0; i < IMAGE_FALSE_FRIENDS.length; i++) {
      if (t.indexOf(IMAGE_FALSE_FRIENDS[i]) !== -1) {
        if (IMAGE_FALSE_FRIEND_BYPASS.test(t)) continue;
        return true;
      }
    }
    return false;
  }

  // These verbs already mean "make me a picture", so they do not need a noun:
  // "sketch the water cycle", "visualise the ecosystem". "draw" is excluded on
  // purpose, because "draw a conclusion" / "draw a graph" are everyday phrases.
  var VISUAL_VERB = '\\b(sketch|paint|render|illustrate|visualise|visualize|illustrate|depict)\\b';
  // Roman Urdu needs both orders: "tasveer banao" and "tasveer chahiye".
  var URDU_VERB = '\\b(banao|banani|banway|banaye|banati|kar[oe]|kro|kardo|d[eo]|dijiye|chahiye|chaahiye|banwa)\\b';

  function isImageGenRequest(text) {
    if (!text || isCodingTask(text)) return false;
    var t = String(text).trim();
    if (/^\s*\/image\b/i.test(t)) return true;
    if (/^\s*\/(?:draw|paint|art|sketch)\b/i.test(t)) return true;

    var lower = t.toLowerCase();
    if (looksLikeTextOnlyAsk(lower)) return false;

    // Roman Urdu: "tasveer banao", "picture banao", "mujhe tasveer chahiye"
    if (new RegExp(IMAGE_URDU + '\\s*' + URDU_VERB, 'i').test(t)) return true;
    if (new RegExp(URDU_VERB + '\\s*(?:me\\s+)?(?:ek\\s+)?' + IMAGE_URDU, 'i').test(t)) return true;

    // "give me a picture of a cat", "can you draw a diagram of the heart"
    var polite = new RegExp('^\\s*(please\\s+)?(can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+)?' + IMAGE_VERBS + '\\s+(me\\s+|us\\s+|an?\\s+|the\\s+)?(?:of\\s+)?' + IMAGE_NOUNS + '\\b', 'i');
    if (polite.test(t)) return true;

    // "sketch the water cycle", "visualise the ecosystem for me"
    if (new RegExp(VISUAL_VERB + '\\s+(me\\s+|an?\\s+|the\\s+)?\\S', 'i').test(t)) return true;

    // "... generate an image of ..." anywhere in the sentence
    var midRe = new RegExp('\\b' + IMAGE_VERBS + '\\s+(me\\s+|us\\s+|an?\\s+|the\\s+)?.{0,60}\\b' + IMAGE_NOUNS + '\\b\\s*(of|for|about|showing|with|depicting|that|where)\\b', 'i');
    if (midRe.test(t)) return true;

    // "i want/need a picture", "mujhe tasveer chahiye"
    var wantRe = new RegExp('\\b(?:i\\s+(?:want|need|require))\\s+(an?\\s+|the\\s+|ek\\s+)?' + IMAGE_NOUNS + '\\b', 'i');
    if (wantRe.test(t)) return true;

    // "a picture of a lion", "logo for my app", "wallpaper of the stars"
    var bareRe = new RegExp('^\\s*(an?\\s+|the\\s+)?' + IMAGE_NOUNS + '\\s+(of|for|about|showing|with|depicting)\\b', 'i');
    if (bareRe.test(t)) return true;

    return false;
  }

  // Vision. The student attaching an image already routes to the vision model, so
  // this exists for the cases where they announce the intent before uploading,
  // or attach one with a vague caption. It only ever runs when an image is
  // actually present, so it can never fire on text alone.
  var VISION_TRIGGERS = '\\b(scan|scanned|read|reads|look at|whats (in|this|that)|what is (in|this|that)|solve|explain|answer|question|homework|worksheet|transcribe|ocr|extract|summarise|summarize|identify|check this|correct this|diagram|label|notes?|photo|picture|image|pic)\\b';
  // True whenever an image is attached: the vision model reads it and the text
  // model answers from that description, whatever the student typed alongside.
  function wantsVisionRead(text, hasImages) {
    if (!hasImages) return false;
    return true;
  }
  // They asked us to look at something but never attached it. Worth catching so
  // the reply can ask for the photo instead of answering blind.
  function asksToScanWithoutImage(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!new RegExp(VISION_TRIGGERS, 'i').test(t)) return false;
    return /\b(this|these|it|here|my (photo|picture|image|notes|page|book|work|homework)|attached?)\b/i.test(t)
        || /^\s*(scan|read|look at|solve|explain|check|ocr|transcribe)\b/i.test(t);
  }

  function extractImagePrompt(text) {
    var t = String(text || '').trim().replace(/^\s*\/image\b\s*/i, '');
    // Strip the leading request phrasing so the provider gets a clean visual
    // description. Full sentences pass through untouched when nothing matches.
    t = t.replace(/^\s*(please\s+)?(can you\s+|could you\s+)?(generate|create|make|draw|paint|design|produce|show|give|send)(\s+me|\s+us)?\s+(an?\s+|the\s+)?(image|picture|photo|illustration|drawing|diagram|poster|logo|art|painting)\s+(of|for|about|showing|with|depicting)?\s*/i, '');
    t = t.replace(/^\s*i\s+(want|need)\s+(an?\s+|the\s+)?(image|picture|photo|illustration|drawing|diagram|poster|logo|art|painting)\s+(of|for|about|showing|with|depicting)?\s*/i, '');
    t = t.replace(/^[:\-\s]+/, '').trim();
    return t.slice(0, 500) || String(text || '').trim().slice(0, 500);
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

  // ── AI Memory extraction ──
  // Whenever this runs, that many chat replies have been finished since the last
  // time we asked the tutor to remember anything. A burst of a few turns is sent
  // as one request: it costs one cheap call instead of one per message, the
  // extractor sees enough conversation to tell a new fact from a restated one,
  // and a student who asks one quick question never triggers it at all.
  let turnsSinceMemoryScan = 0;
  const MEMORY_SCAN_EVERY_TURNS = 3;
  // Only the tail is useful (older turns are already stored); the server caps
  // this as well, so a long chat cannot make the request unbounded.
  const MEMORY_SCAN_TAIL = 8;

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

  /**
   * Ask the tutor to remember what just happened, without ever getting in the
   * student's way: runs in the background after the reply has been painted, and
   * every failure is swallowed. The whole feature is a nicety — a failed
   * extraction must never surface as an error or delay the next message.
   */
  async function extractMemoriesFromChat() {
    try {
      if (!aiPrefs.memoryEnabled) return;
      if (typeof currentUser === 'undefined' || !currentUser) return;
      const token = getAccessToken();
      if (!token) return;
      // Uploaded photos are sent to the chat as image data; the extractor reads
      // text only, so those turns are dropped rather than shipped for nothing.
      const tail = messages
        .slice(-MEMORY_SCAN_TAIL)
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content && !m.images)
        .map(m => ({ role: m.role, content: String(m.content) }));
      if (!tail.some(m => m.role === 'user')) return;

      // Same resolution order the other edge-function callers use: the shared
      // service instance first, then the page globals.
      const base = (typeof api !== 'undefined' && api && api.supabaseUrl) || (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '');
      const anonKey = (typeof api !== 'undefined' && api && api.supabaseKey) || (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '');
      if (!base) return;
      const res = await fetch(base + '/functions/v1/ai-memory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          messages: tail,
          session_id: activeSession ? activeSession.id : null,
          subject: (typeof selectedSubject !== 'undefined' && selectedSubject) ? selectedSubject : null,
          source: 'chat',
        }),
      });
      const data = await res.json().catch(function () { return null; });
      if (data && data.ok && (data.stored || data.forgotten)) {
        // Fold the new facts in immediately: the next reply in this same chat can
        // already use them, instead of catching up on the next reload.
        await loadAiMemories();
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
    if (typeof currentUser === 'undefined' || !currentUser) {
      try {
        const { data: { session } } = await db.auth.getSession();
        if (session?.user) {
          currentUser = session.user;
        }
      } catch (_) {}
    }
    // Session check above is authoritative for this page — guests lose the
    // subject selector, signed-in users keep it.
    try { window.__aiAuthResolved = true; } catch (_) {}
    try { updateSubjectVisibility(); } catch (_) {}
    if (typeof ensureProfile === 'function') {
      await ensureProfile();
    }
    // Tier-aware chat store: premium chats live in the database (all devices),
    // free-tier chats stay in this browser's localStorage only.
    // Subject must load first so chatStorageKey is per-subject.
    // Reload after auth too (anon key -> user key).
    try { loadSelectedSubject(); } catch (_) {}
    try {
      var qSub = new URLSearchParams(window.location.search).get('subject');
      if (qSub) {
        var qHit = CHAT_SUBJECTS.find(function (s) { return s.name.toLowerCase() === String(qSub).toLowerCase(); });
        if (qHit) { selectedSubject = qHit.name; try { saveSelectedSubject(); } catch (_) {} }
      }
    } catch (_) {}
    try { updateSubjectUI(); } catch (_) {}
    // Version is per-user, so reload it once the user id is known.
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
    // The chat store can take a while on a slow connection, so it runs in the
    // background: the composer, send button and selectors come up immediately
    // and anything sent meanwhile is saved locally, then uploaded to the DB.
    try { renderHistory(); } catch (_) {}
    var storeReady = initConversationStore().catch(function (e) {
      console.warn('[AI] chat store failed:', e);
      chatStoreReady = true;
      try { renderHistory(); } catch (_) {}
    });
    var afterStore = function () {
      try { ensureShareCodes(); } catch (_) {}
      // Deep link: restore the chat referenced in the URL (?chat=...) on refresh.
      try {
        var deepCode = null;
        try { deepCode = new URL(window.location.href).searchParams.get('chat'); } catch (_) {}
        if (deepCode) {
          var owned = resolveConversationByCode(deepCode);
          if (owned) {
            loadConversation(owned.id);
          } else {
            var first = conversations.find(function(c){ return (c.subject || 'Physics') === selectedSubject; }) || conversations[0];
            if (first) loadConversation(first.id);
          }
        }
      } catch (_) {}
    };
    try { storeReady.then(afterStore); } catch (_) { afterStore(); }
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
    // Free & unlimited: just sync access state in the background.
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
    syncWelcomeMode();
    bindEvents();
    try { setupSubjectDropdown(); } catch (e) { console.warn('[Subject] setup failed', e); }
    try {
      updateSubjectVisibility();
      // Safety net for late auth changes (e.g. account switch without reload).
      var _svTries = 0;
      var _svTimer = setInterval(function () {
        _svTries++;
        var done = false;
        try { done = updateSubjectVisibility(); } catch (_) { done = true; }
        if (done || _svTries > 40) { clearInterval(_svTimer); }
      }, 500);
    } catch (_) {}
    try { updateSubjectUI(); renderSubjectList(); } catch (_) {}
    updatePersonaUI();
    // Renders the modes bar. The GitHub repo chip is currently the only thing
    // that goes in it.
    try { renderModeChips(); } catch (_) {}
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
    btnSend.disabled = !chatInput.value.trim() && pendingImages.length === 0 && !pendingTestRef;
  }

  function clearPendingImages() {
    pendingImages.length = 0;
    renderImagePreview();
    updateAttachButton();
  }

  function bindEvents() {
    btnSend.addEventListener('click', handleSend);
    btnStop.addEventListener('click', handleStop);
    wireSlashMenu();

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
      handleSlashTrigger();
      btnSend.disabled = !chatInput.value.trim() && pendingImages.length === 0 && !pendingTestRef;
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
      if (e.target.classList.contains('msg-image-thumb') || e.target.classList.contains('msg-generated-image')) {
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
    try { bindChatSearch(); } catch (e) { console.warn('[Search] setup failed', e); }
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
      if (typeof modelDot !== 'undefined' && modelDot) modelDot.style.background = ['#3B82F6', 'var(--accent)'][PERSONAS[activePersonaIndex].providerIndex] || '#3B82F6';
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

    async function runSearch(q) {
      const searchParams = {
        p_query: q,
        p_book_id: null,
        p_limit: TEXTBOOK_MAX_PAGES + 3,
        p_class_level_id: studentContext?.classLevelId || null,
      };
      let result = await db.rpc('search_textbook_pages_with_chapters', searchParams);
      if (result.error) {
        result = await db.rpc('search_textbook_pages', searchParams);
      }
      if (result.error) {
        console.warn('[AI] Textbook RPC error:', result.error.message);
        const legacyParams = { p_query: q, p_book_id: null, p_limit: TEXTBOOK_MAX_PAGES + 3 };
        const retry = await db.rpc('search_textbook_pages_with_chapters', legacyParams);
        const legacyRetry = retry.error ? await db.rpc('search_textbook_pages', legacyParams) : retry;
        return prioritizeSubjectPages(legacyRetry.data || [], subj);
      }
      if (!result.data || result.data.length === 0) return [];
      return prioritizeSubjectPages(result.data, subj);
    }

    try {
      var pages = await runSearch(searchQuery);
      if (pages.length) return pages;
      // Empty result: the full-text AND-match missed (e.g. "name of first
      // chapter" needs words the pages never contain). Retry with only the
      // subject plus content words so the model gets something real.
      var fallbackQuery = (subj + ' ' + query)
        .replace(/\b(explain|explains|what|whats|which|is|are|was|were|the|a|an|of|in|on|for|to|name|names|first|chapter|chapters|ch|list|lists|me|my|us|tell|tells|give|gives|about|how|does|do|did|can|could|please|kind|types|type|mean|means|meaning|called|known|define|defines|describe|describes|help|helps|with)\b/gi, '')
        .replace(/\s+/g, ' ').trim().slice(0, 200);
      if (fallbackQuery.length >= 3 && fallbackQuery.toLowerCase() !== searchQuery.toLowerCase()) {
        console.log('[AI] Textbook search empty, retrying broader: "' + fallbackQuery + '"');
        pages = await runSearch(fallbackQuery);
        if (pages.length) return pages;
      }
      return [];
    } catch (e) {
      console.warn('[AI] Textbook search failed:', e);
      return [];
    }
  }

  // Questions about chapter names/order ("first chapter of Biology") can
  // never match page text, because pages rarely contain the words "first"
  // or "chapter". Answer those from the official chapter list instead.
  function isChapterListQuestion(text) {
    var t = String(text || '');
    if (!/\bchapters?\b|\bch\b/i.test(t)) return false;
    return /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|\d+\s*(st|nd|rd|th)?|list|lists|names?|how many|number of|order|sequence|start|starts|begin|begins)\b/i.test(t);
  }

  async function fetchChapterListContext(text) {
    if (!isChapterListQuestion(text)) return '';
    var subj = selectedSubject || 'Physics';
    try {
      var res = await db.rpc('list_chapters_by_subject_name', { p_subject_name: subj });
      if (res.error || !res.data || !res.data.length) return '';
      var books = {};
      var order = [];
      res.data.forEach(function (c) {
        var key = (c.book_id !== null && c.book_id !== undefined) ? String(c.book_id) : 'book';
        if (!books[key]) { books[key] = []; order.push(key); }
        books[key].push(c);
      });
      var lines = [];
      order.slice(0, 2).forEach(function (key) {
        lines.push('BOOK (' + subj + ' textbook, book id ' + key + ') - official chapter list:');
        books[key].slice(0, 20).forEach(function (c) {
          var num = (c.number !== null && c.number !== undefined) ? c.number : '?';
          lines.push('- Chapter ' + num + ': ' + (c.name || ''));
        });
      });
      if (!lines.length) return '';
      return 'OFFICIAL CHAPTER LIST from our library - use these EXACT chapter names and numbers. ' +
        'When asked for the first chapter, it is Chapter 1 in the list below:\n' +
        lines.join('\n') + '\n\n';
    } catch (e) {
      console.warn('[AI] Chapter list lookup failed:', e);
      return '';
    }
  }

  // "Explain page 7" can never match full-text search (page text rarely
  // contains its own page number). Fetch the exact printed page instead.
  function parsePageNumberQuestion(text) {
    var m = String(text || '').match(/\b(?:pages?|pg|p\.?)\s*(?:no\.?|number|#)?\s*(\d{1,4})\b/i);
    return m ? parseInt(m[1], 10) : null;
  }

  async function fetchTextbookPageContext(text) {
    var n = parsePageNumberQuestion(text);
    if (!n) return '';
    var subj = selectedSubject || 'Physics';
    try {
      var res = await db.rpc('get_textbook_page_by_number', {
        p_subject_name: subj,
        p_printed_page: n,
        p_class_level_id: studentContext?.classLevelId || null,
      });
      if (res.error || !res.data || !res.data.length) return '';
      var parts = res.data.slice(0, 2).map(function (p) {
        var title = p.book_title || (subj + ' textbook');
        var ch = (p.chapter_number !== null && p.chapter_number !== undefined)
          ? ', Chapter ' + p.chapter_number + (p.chapter_name ? ': ' + p.chapter_name : '')
          : (p.chapter_name ? ', Chapter: ' + p.chapter_name : '');
        var pg = ', PRINTED PAGE: ' + p.printed_page_number;
        if (p.page_number !== null && p.page_number !== undefined && String(p.page_number) !== String(p.printed_page_number)) {
          pg += ' (PDF p. ' + p.page_number + ')';
        }
        return '[BOOK: "' + title + '"' + ch + pg + ']\n' + String(p.full_text || '').slice(0, 2500);
      });
      if (!parts.length) return '';
      return 'The student asked about printed page ' + n + ' - the EXACT page text from our library is below. ' +
        'Explain THIS page (do not ask for a photo; you already have the text):\n' +
        parts.join('\n\n') + '\n\n';
    } catch (e) {
      console.warn('[AI] Page lookup failed:', e);
      return '';
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

  // How much of the ingested book reaches the model, and how hard the model is
  // pushed to teach from it. With one thin snippet the models — Astra in
  // particular, being a large general model — blend towards general knowledge,
  // so answers stop reading like they came from the Punjab board textbook.
  // These are the knobs for that: more pages, more text per page, and an
  // explicit book/general ratio with page citations in the instructions.
  var TEXTBOOK_MAX_PAGES = 5;
  var TEXTBOOK_PAGE_CHARS = 1800;
  var TEXTBOOK_BOOK_SHARE = 70;

  function formatTextbookContext(pages) {
    if (!pages || pages.length === 0) return '';

    // The ranker ranks pages, not chapters, so the same printed page can come
    // back twice. One page counted twice would read as two sources.
    var seenPages = {};
    var picked = [];
    for (var i = 0; i < pages.length && picked.length < TEXTBOOK_MAX_PAGES; i++) {
      var candidate = pages[i];
      if (!candidate) continue;
      var cPrinted = candidate.printed_page_number !== null && candidate.printed_page_number !== undefined ? candidate.printed_page_number : null;
      var cPdf = candidate.page_number !== null && candidate.page_number !== undefined ? candidate.page_number : null;
      var pageKey = String(candidate.book_id || candidate.book_title || '?') + '#' +
        (cPrinted !== null ? cPrinted : cPdf !== null ? cPdf : i);
      if (seenPages[pageKey]) continue;
      seenPages[pageKey] = true;
      picked.push(candidate);
    }
    if (picked.length === 0) return '';

    const sections = picked.map(p => {
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
      const fullText = (p.full_text || p.snippet || '').slice(0, TEXTBOOK_PAGE_CHARS);
      return `[BOOK: "${title}"${chapter}${topic}${pageInfo}]\n${fullText}`;
    });

    var generalShare = 100 - TEXTBOOK_BOOK_SHARE;
    // Page attribution in the body is a references setting: with references off
    // the student explicitly asked for no books or pages to be cited at all.
    var citeInline = aiPrefs.references
      ? ' Name the book and the printed page as you state each book fact, like "(Physics Class 11, p. 35)".'
      : ' Do NOT name the book or any page number in the answer body (the References section is switched off).';

    var refBlock = aiPrefs.references
      ? `5. REFERENCES ON — MANDATORY: At the VERY END of your response (after everything else), you MUST include a References section in this EXACT format:

---
**References:**
- [Book Name], Chapter [number]: [chapter name], printed p. [printed page] (PDF p. [PDF page])
---

Use the chapter number and name exactly as shown in the source block. If a source has no chapter metadata, cite it as Book, p. [page]. List ALL books, chapters, and pages you actually used. Do NOT invent references. If no usable book, page, or website source is available, omit the References heading and both separator lines entirely.`
      : `5. REFERENCES OFF: Do NOT include any References section, and do not name books or page numbers anywhere in the answer. Just end your answer normally.`;
    return `\n\n===== TEXTBOOK REFERENCE — READ FIRST =====
You were given the student's EXACT Punjab board textbook excerpts below (from 11th/12th Biology, Chemistry, Physics, Computer Science, English 2025 editions now ingested). You MUST read and comprehend these excerpts BEFORE writing your answer. Do NOT answer from general memory alone. Teach from these excerpts first, and let general knowledge fill only the gaps.

${sections.join('\n\n---\n\n')}

===== HOW TO USE THESE EXCERPTS =====
1. READ THEM FIRST. They are the source of truth for this question.
2. ${TEXTBOOK_BOOK_SHARE}% FROM THE BOOK: build the bulk of your answer out of these excerpts. Open with the book's own definition of the topic, quoting the key sentence from the excerpt, then teach the book's facts, formulas, values and terminology, and keep the book's wording wherever it is clearer than your own.${citeInline}
3. ${generalShare}% OF YOUR OWN: only after the book has had its say, add your own analogies, extra worked examples and exam tips. Your own knowledge must never replace or contradict a book fact: where the excerpts cover a point, the book wins.
4. IF THE EXCERPTS DO NOT COVER IT: say so in one short line, then answer that part from general knowledge so the student is not left stuck.
${refBlock}`;
  }

  // â”€â”€ AI preference rules injected into the system prompt â”€â”€
  function aiPrefsPrompt() {
    // Every response, at every style, must actually DEFINE what it is talking
    // about before explaining it. This is the rule that was missing, which is
    // why answers felt useless: short replies were skipping the definition.
    const foundationRule =
      'ANSWER FOUNDATION - MANDATORY IN EVERY RESPONSE:\n' +
      '1. DEFINE THE TOPIC FIRST. Open by stating what the concept, term, or process actually IS, in one or two plain sentences, BEFORE any explanation. If the student used a technical term, define that exact term first. Never assume a term is known.\n' +
      '2. GIVE IT CONTEXT. Say why it matters, what it is used for, and where it fits in the bigger picture of the subject.\n' +
      '3. ONLY THEN WORK IT THROUGH. Break it into steps, show the reasoning, give a concrete worked example, and mention the mistakes students usually make.\n' +
      '4. CLOSE WITH THE KEY IDEA. End with one or two sentences the student could repeat in an exam.\n' +
      'Never reply with a bare one-line answer that skips the definition. Short is fine, undefined is not.';

    const styleRule = {
      concise: 'RESPONSE STYLE is CONCISE: define the topic in 1-2 sentences, then give the direct answer and the single most important point. Skip extra examples and background. Never skip the definition. Roughly 120-200 words.',
      balanced: 'RESPONSE STYLE is BALANCED: a full, complete explanation, not a summary. Define the topic, give context, then walk through it step by step, add one clear worked example, note a common mistake, and close with the key takeaway. Roughly 350-600 words.',
      detailed: 'RESPONSE STYLE is DETAILED: teach the topic thoroughly rather than summarising it. Define it, give context, then use clear headed sections for each part, show multiple worked examples, cover edge cases and exceptions, list the mistakes students actually make in exams, and add exam tips and memory aids. Roughly 700-1200 words. Write as much as the topic genuinely needs. Do not hold back, and do not pad with filler.',
    }[aiPrefs.responseStyle] || 'RESPONSE STYLE is BALANCED: a full, complete explanation with a definition, context, step-by-step working, a worked example, and a key takeaway. Roughly 350-600 words.';

    const levelRule = {
      simple: 'EXPLANATION LEVEL is SIMPLE: explain as if the student has never seen this topic before. Very simple words, everyday analogies, tiny steps, and define every piece of jargon the moment you use it. Explain the WHY, not just the WHAT.',
      standard: 'EXPLANATION LEVEL is STANDARD: explain at FSc board-exam level, but completely and self-contained. Assume the student knows the class background, NOT that they know this specific topic.',
      advanced: 'EXPLANATION LEVEL is ADVANCED: go deep. Show the full reasoning and the derivation where one exists, explain WHY the result holds, discuss edge cases and limiting cases, compare it against related ideas the student might confuse it with, and flag the classic exam traps and which marks are awarded for each part. Be substantially longer than a standard explanation.',
    }[aiPrefs.explanationLevel] || 'EXPLANATION LEVEL is STANDARD: explain at FSc board-exam level, completely and self-contained.';

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

    // Response style and explanation level combine: the two deepest settings
    // together mean a textbook-chapter answer, and that has to be spelled out
    // or the model settles for something short.
    const isDetailed = aiPrefs.responseStyle === 'detailed';
    const isAdvanced = aiPrefs.explanationLevel === 'advanced';
    const depthRule = (isDetailed && isAdvanced)
      ? 'MAXIMUM DEPTH MODE: response style is DETAILED and explanation level is ADVANCED. This is the deepest setting available. Write a long, thorough, textbook-chapter-quality explanation: full derivations, every relevant case, several worked examples, and a complete summary of the key ideas. Length is expected here, roughly 900-1500 words, unless the question is genuinely trivial. Never cut the explanation short.'
      : (isDetailed || isAdvanced)
        ? 'HIGH DEPTH MODE: write a full thorough explanation rather than a summary. Include the complete reasoning, a worked example, and the mistakes students make. Length is expected, roughly 600-1000 words.'
        : (aiPrefs.responseStyle === 'concise'
          ? 'KEEP IT TIGHT: this is the concise style. Do not write long sections, do not add multiple examples, and do not pad. But always include the definition and the key idea.'
          : '');

    return [foundationRule, styleRule, levelRule, depthRule, langRule, suggestRule, emojiRule, referencesRule, personalRule].filter(Boolean).join('\n\n');
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
- For explanations: follow the RESPONSE STYLE and EXPLANATION LEVEL rules given below. Define the term first, then explain the reasoning, then give examples.
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
      // The coding persona used to skip the student's response style and
      // explanation level entirely, so those settings had no effect here.
      ctx += `\n\n${aiPrefsPrompt()}`;
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
- For academic/study questions: teach from the textbook excerpts provided. Roughly 70% of the answer must be the book's own definitions, facts, formulas and wording, and at most 30% your own general knowledge, examples or exam tips. Explain step-by-step and never let your own knowledge replace a book fact.
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



    ctx += `\n\nLONG-FORM RULE: NEVER refuse a request because it is long (essays, stories, speeches, and full topic explanations of any word count). Always write the maximum you can in this response with full quality. NEVER cut a real explanation short just to be brief, and NEVER pad it with filler words to make it longer. If you cannot finish, simply stop mid-way WITHOUT any closing line, apology, summary, or "let me know" note — the app will automatically ask you to continue and you will pick up exactly where you stopped.

SCOPE: You are a STUDY tutor (FSc academics). You cover every subject the student selects, including Computer Science theory.
- NEVER refuse a question and NEVER tell the student to switch to another model, tutor, or persona. There is only one assistant. If a question needs code, just answer it.
- NEVER output a refusal or any switch marker.`;

    // Capabilities. The student should feel they are talking to one assistant
    // that can read what they photograph and can draw what they describe. Behind
    // the scenes those requests are handled by dedicated vision and image models,
    // but the student never needs to know, ask, or choose: never mention models,
    // tools, routing, or "vision", and never refuse on the grounds that you
    // cannot see or cannot create images.
    ctx += `\n\nWHAT YOU CAN DO (all of it is you, there is nothing else to switch to):
- READING IMAGES: when the student attaches a photo, screenshot, diagram, handwritten page, or past-paper question, read it carefully and answer from what is actually in it. The image is described to you before you reply, so treat that description as ground truth. Never say you cannot see the image, never ask them to retype it, and never apologise for not being able to view it. If part of the image is genuinely unreadable, say which part, briefly, and answer the rest.
- CREATING IMAGES: when the student asks for a picture, diagram, drawing, poster, logo, illustration, or any visual, produce it. Say nothing about it beforehand, do not apologise, and do not describe how you would make it. Just make it and then, if useful, add one short line about the result.
- ONE ASSISTANT: there is no second bot, no "image mode", no switching. If the student asks what you can do, tell them plainly that you can answer questions, read their photos and diagrams, and create images for them. If they ask which company or model you are, answer as Anteemonee and move on.
- NEVER SAY: "I can't generate images", "I can't see images", "as a text model", "I don't have vision", "please use the image tool", or anything that implies the student has to do it themselves or pick a different assistant.`;

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

  // ── Chat history search ────────────────────────────────────────────────────
  // The desktop and mobile sidebars each own an input, but one shared query so
  // typing in either filters both lists at once.
  let chatSearchQuery = '';
  function currentChatSearch() { return chatSearchQuery.trim(); }

  // Split on whitespace so "water cycle" only matches the phrase in that order.
  function searchTerms(query) {
    return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  }
  // Best matching message snippet, so results show why they matched.
  function matchSnippet(conv, query) {
    var terms = searchTerms(query);
    if (!terms.length) return '';
    var msgs = Array.isArray(conv && conv.messages) ? conv.messages : [];
    var best = '', bestScore = 0;
    for (var i = 0; i < msgs.length; i++) {
      var body = String((msgs[i] && msgs[i].content) || '').replace(/\s+/g, ' ').trim();
      if (!body) continue;
      var low = body.toLowerCase();
      var score = 0;
      for (var t = 0; t < terms.length; t++) { if (low.indexOf(terms[t]) !== -1) score++; }
      if (score > bestScore) { bestScore = score; best = body; }
    }
    if (!best || !bestScore) return '';
    // Show the neighbourhood of the first hit rather than the very start.
    var at = -1, firstTerm = terms[0];
    for (var k = 0; k < terms.length && at === -1; k++) at = best.toLowerCase().indexOf(terms[k]);
    var start = at > 48 ? at - 40 : 0;
    var text = (start > 0 ? '\u2026' : '') + best.slice(start, start + 96) + (start + 96 < best.length ? '\u2026' : '');
    return '<span class="history-snippet">' + highlightMatch(text, query) + '</span>';
  }
  function conversationMatches(conv, query) {
    var terms = searchTerms(query);
    if (!terms.length) return true;
    var hay = String((conv && conv.title) || '').toLowerCase();
    var msgs = Array.isArray(conv && conv.messages) ? conv.messages : [];
    for (var i = 0; i < msgs.length; i++) hay += ' ' + String((msgs[i] && msgs[i].content) || '').toLowerCase();
    // Every term must appear somewhere in the chat, which is what students
    // expect from a search box.
    for (var t = 0; t < terms.length; t++) if (hay.indexOf(terms[t]) === -1) return false;
    return true;
  }
  function searchScore(conv, query) {
    var terms = searchTerms(query);
    var title = String((conv && conv.title) || '').toLowerCase();
    var score = 0;
    for (var t = 0; t < terms.length; t++) {
      if (title.indexOf(terms[t]) !== -1) score += 3;
      else if (Array.isArray(conv && conv.messages)) {
        for (var i = 0; i < conv.messages.length; i++) {
          if (String((conv.messages[i] && conv.messages[i].content) || '').toLowerCase().indexOf(terms[t]) !== -1) { score += 1; break; }
        }
      }
    }
    return score;
  }
  // Wrap matches in <mark>. Operates on escaped text, and splits on the terms
  // first so the markers are never injected into user content.
  function highlightMatch(text, query) {
    var safe = escapeHtml(String(text || ''));
    var terms = searchTerms(query);
    if (!terms.length) return safe;
    // Escape the term for use inside a regex, then match on the escaped form.
    var pattern = terms
      .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
      .filter(Boolean)
      .sort(function (a, b) { return b.length - a.length; });
    if (!pattern.length) return safe;
    var re;
    try { re = new RegExp('(' + pattern.join('|') + ')', 'gi'); } catch (_) { return safe; }
    return safe.replace(re, '<mark>$1</mark>');
  }
  function applyChatSearch() {
    var query = currentChatSearch();
    document.querySelectorAll('[data-chat-search]').forEach(function (box) {
      var input = box.querySelector('.chat-search-input');
      var clear = box.querySelector('.chat-search-clear');
      if (input && input.value !== query) input.value = query;
      if (clear) clear.hidden = !query;
      box.setAttribute('data-active', query ? 'true' : 'false');
    });
    try { renderHistory(); } catch (_) {}
  }
  function bindChatSearch() {
    document.querySelectorAll('[data-chat-search]').forEach(function (box) {
      if (box.dataset.bound === '1') return;
      box.dataset.bound = '1';
      var input = box.querySelector('.chat-search-input');
      var clear = box.querySelector('.chat-search-clear');
      if (!input) return;
      // Debounced so a long history is not re-rendered on every keystroke.
      var timer = null;
      input.addEventListener('input', function () {
        chatSearchQuery = input.value;
        var clearBtn = box.querySelector('.chat-search-clear');
        if (clearBtn) clearBtn.hidden = !input.value;
        box.setAttribute('data-active', input.value ? 'true' : 'false');
        clearTimeout(timer);
        timer = setTimeout(function () { try { renderHistory(); } catch (_) {} }, 130);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); try { renderHistory(); } catch (_) {} }
        else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; chatSearchQuery = ''; applyChatSearch(); }
      });
      if (clear) clear.addEventListener('click', function () {
        input.value = ''; chatSearchQuery = '';
        applyChatSearch();
        input.focus();
      });
    });
  }

  function newChat() {
    // Leaving a filtered list behind looks like history has vanished.
    if (currentChatSearch()) { chatSearchQuery = ''; try { applyChatSearch(); } catch (_) {} }
    revealChatView();
    activeConversationId = null;
    clearChatUrlParam();
    try { updateChatLinkBar(); } catch (_) {}
    messages = [];
    pendingQuizTopic = false;
    messagesList.innerHTML = '';
    welcome.style.display = 'flex';
    messagesList.style.display = 'none';
    syncWelcomeMode();
    chatInput.value = '';
    chatInput.focus();
    autoResize();
    btnSend.disabled = true;
    renderHistory();
    renderBranchBar();
  }

  function saveConversation() {
    try { if (window.__voiceEphemeral) return; } catch (_) {} // call chats: never saved, never listed
    if (messages.length === 0) return;
    conversations.forEach(function(c) { if (!c.shareCode) c.shareCode = makeShareCode(); });
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
    // Keep the share code in the URL for every saved chat, so a refresh
    // restores the same conversation via ?chat=CODE.
    try {
      var liveConv = conversations.find(function(c){ return c.id === activeConversationId; });
      if (liveConv) setChatUrlParam(liveConv.shareCode || liveConv.id);
    } catch (_) {}
    renderHistory();
    try { updateChatLinkBar(); } catch (_) {}
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

  // Rebuild the whole message list from `messages`, keeping data-idx in step.
  // One code path for load/edit so the DOM can never drift from the array.
  function renderMessagesFrom() {
    Object.keys(_graphCharts || {}).forEach(function (id) {
      try { _graphCharts[id].destroy(); } catch (_) {}
      delete _graphCharts[id];
    });
    messagesList.innerHTML = '';
    if (messages.length) {
      welcome.style.display = 'none';
      messagesList.style.display = 'flex';
      messages.forEach((m, i) => appendMessage(m.role, m.content, false, {
        idx: i, quote: m.quote || null, images: m.images || null, test: m.testRef || null,
        quiz: m.quiz || null, graph: m.graph || null, generatedImage: m.generatedImage || null,
      }));
    } else {
      messagesList.style.display = 'none';
      welcome.style.display = 'flex';
    }
    syncWelcomeMode();
  }

  // ChatGPT-style welcome: when no messages exist, the composer sits in the
  // center of the screen under a time-of-day greeting. The first message
  // drops it back to the bottom of the feed.
  function syncWelcomeMode() {
    try {
      var active = welcome.style.display !== 'none';
      document.body.classList.toggle('welcome-center', active);
      if (active) try { scrollToBottom(); } catch (_) {}
    } catch (_) {}
  }

  // ---------- Edit branches ----------
  // Editing rewrites history, so the messages after the edited turn have to go
  // somewhere. They are archived as a branch instead of being destroyed, and
  // kept in their own localStorage map so a DB sync (which replaces conv.messages)
  // can never clobber them.
  function branchStorageKey() {
    var base = currentUserId() ? currentUserId() : 'anon';
    return 'Anteemonee_ai_branches_' + base + '_' + subjectSlug(selectedSubject);
  }
  function readBranchMap() {
    try {
      var raw = localStorage.getItem(branchStorageKey());
      var m = JSON.parse(raw || '{}');
      return (m && typeof m === 'object') ? m : {};
    } catch (_) { return {}; }
  }
  function writeBranchMap(map) {
    try { localStorage.setItem(branchStorageKey(), JSON.stringify(map || {})); } catch (_) {}
  }
  function getBranches(convId) {
    if (!convId) return [];
    var list = readBranchMap()[convId];
    return Array.isArray(list) ? list : [];
  }
  function addBranch(convId, at, snapshot) {
    if (!convId || !Array.isArray(snapshot) || !snapshot.length) return null;
    var map = readBranchMap();
    var list = Array.isArray(map[convId]) ? map[convId] : [];
    var branch = {
      id: 'br_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      at: at,
      createdAt: Date.now(),
      messages: snapshot,
    };
    list.push(branch);
    while (list.length > 5) list.shift();          // keep storage bounded
    map[convId] = list;
    writeBranchMap(map);
    return branch;
  }
  function removeBranch(convId, branchId) {
    var map = readBranchMap();
    var list = Array.isArray(map[convId]) ? map[convId] : [];
    map[convId] = list.filter(function (b) { return b && b.id !== branchId; });
    if (!map[convId].length) delete map[convId];
    writeBranchMap(map);
  }

  function branchBar() {
    var area = document.querySelector('.chat-input-area');
    if (!area) return null;
    var el = area.querySelector('#branch-bar');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'branch-bar';
    el.id = 'branch-bar';
    el.hidden = true;
    var wrapper = area.querySelector('.chat-input-wrapper');
    if (wrapper && wrapper.parentNode) area.insertBefore(el, wrapper); else area.appendChild(el);
    return el;
  }

  function renderBranchBar() {
    var el = branchBar();
    if (!el) return;
    var list = getBranches(activeConversationId);
    if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
    var n = list.length;
    el.hidden = false;
    el.innerHTML = BRANCH_ICON
      + '<span class="branch-bar-text">' + (n === 1 ? '1 earlier version' : n + ' earlier versions') + ' of this chat</span>'
      + '<button class="branch-bar-btn" type="button">View</button>';
    var btn = el.querySelector('.branch-bar-btn');
    if (btn) btn.addEventListener('click', function () { openBranchPanel(); });
  }

  function openBranchPanel() {
    closeBranchPanel();
    var list = getBranches(activeConversationId);
    if (!list.length) return;
    var rows = list.map(function (b, i) {
      var first = '';
      for (var m = 0; m < b.messages.length; m++) {
        if (b.messages[m] && b.messages[m].role === 'user') { first = String(b.messages[m].content || '').slice(0, 90); break; }
      }
      var turns = b.messages.filter(function (m) { return m && m.role === 'user'; }).length;
      return '<div class="branch-item" data-branch="' + escapeHtml(b.id) + '">'
        + '<div class="branch-item-head"><span class="branch-item-title">Version ' + (list.length - i) + '</span>'
        + '<span class="branch-item-meta">' + turns + ' message' + (turns === 1 ? '' : 's') + '</span></div>'
        + '<div class="branch-item-body">' + escapeHtml(first) + (first.length >= 90 ? '\u2026' : '') + '</div>'
        + '<button class="branch-restore" type="button">Restore this version</button>'
        + '</div>';
    }).join('');

    var ov = document.createElement('div');
    ov.className = 'branch-overlay';
    ov.id = 'branch-overlay';
    ov.innerHTML = '<div class="branch-panel" role="dialog" aria-modal="true" aria-label="Earlier versions">'
      + '<div class="branch-panel-head"><h3>Earlier versions</h3>'
      + '<button class="branch-panel-close" type="button" aria-label="Close">\u00d7</button></div>'
      + '<p class="branch-panel-note">These are the messages that came after the one you edited. Restoring replaces the current chat.</p>'
      + '<div class="branch-list">' + rows + '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeBranchPanel(); });
    ov.querySelector('.branch-panel-close').addEventListener('click', closeBranchPanel);
    ov.querySelectorAll('.branch-restore').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.branch-item');
        if (item) restoreBranch(item.getAttribute('data-branch'));
      });
    });
  }

  function closeBranchPanel() {
    var ov = document.getElementById('branch-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function restoreBranch(branchId) {
    var list = getBranches(activeConversationId);
    var branch = list.find(function (b) { return b && b.id === branchId; });
    if (!branch) return;
    messages = branch.messages.map(function (m) { return Object.assign({}, m); });
    removeBranch(activeConversationId, branchId);
    renderMessagesFrom();
    scrollToBottom();
    saveConversation();
    renderHistory();
    renderBranchBar();
    closeBranchPanel();
    try { showChatToast('Earlier version restored'); } catch (_) {}
  }

  // ---------- Edit & resend ----------
  // Editing a message rewrites history: everything from that message onward is
  // dropped and the new text is sent as a fresh turn. `backup` is only kept so
  // Cancel can restore the branch that was removed.
  function editBanner() {
    var area = document.querySelector('.chat-input-area');
    if (!area) return null;
    var el = area.querySelector('#edit-banner');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'edit-banner';
    el.id = 'edit-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = EDIT_BANNER_SVG
      + '<span class="edit-banner-text">Editing your message \u2014 resending replaces everything after it.</span>'
      + '<button class="edit-banner-cancel" type="button" aria-label="Cancel editing">Cancel</button>';
    var wrapper = area.querySelector('.chat-input-wrapper');
    if (wrapper && wrapper.parentNode) area.insertBefore(el, wrapper); else area.appendChild(el);
    el.querySelector('.edit-banner-cancel').addEventListener('click', function () { cancelEditMessage(); });
    return el;
  }

  function showEditBanner() {
    var el = editBanner();
    if (el) el.hidden = false;
  }

  function hideEditBanner() {
    var area = document.querySelector('.chat-input-area');
    var el = area && area.querySelector('#edit-banner');
    if (el) el.hidden = true;
  }

  // Actions for the user's own bubble: edit+resend and copy.
  // Icon-only, revealed on hover (always visible on touch). Reuses the .fb-copy
  // class so copying shares the assistant row's check-mark behaviour.
  function attachUserActions(div) {
    try {
      if (!div || div.querySelector('.msg-user-actions')) return;
      var body = div.querySelector('.msg-body');
      if (!body) return;
      var rawIdx = div.dataset ? div.dataset.idx : undefined;
      if (rawIdx === undefined || rawIdx === null || rawIdx === '') return;
      var idx = parseInt(rawIdx, 10);
      var row = document.createElement('div');
      row.className = 'msg-user-actions';
      row.innerHTML =
        '<button class="fb-btn msg-edit-btn" type="button" title="Edit and resend" aria-label="Edit message">' + EDIT_PEN_SVG + '</button>' +
        '<button class="fb-btn fb-copy" type="button" title="Copy message" aria-label="Copy">' + FB_COPY_SVG + '</button>';
      body.appendChild(row);

      row.querySelector('.msg-edit-btn').addEventListener('click', function () {
        startEditMessage(idx);
      });
      // onCopyMessage reads messages[idx] and swaps in the check mark on .fb-copy.
      row.querySelector('.fb-copy').addEventListener('click', function () {
        onCopyMessage(row, idx);
      });
    } catch (_) {}
  }

  function startEditMessage(idx) {
    if (pendingEdit) return;            // already mid-edit; banner owns the composer
    if (isStreaming) return;            // never rewrite history under an open stream
    var target = messages[idx];
    if (!target || target.role !== 'user') return;
    var original = typeof target.content === 'string' ? target.content : '';

    pendingEdit = {
      idx: idx,
      text: original,
      backup: messages.slice(),
      hadImages: Array.isArray(target.images) && target.images.length > 0,
    };

    // Quote refers to the turn being replaced, so it goes with it.
    pendingQuote = null;
    try { renderQuoteChip(); } catch (_) {}

    messages = messages.slice(0, idx);  // drop this message + every AI reply after it
    renderMessagesFrom();
    scrollToBottom();

    chatInput.value = original;
    autoResize();
    // Mirror the composer state: a disabled composer must not get a live send button.
    btnSend.disabled = chatInput.disabled || (!chatInput.value.trim() && pendingImages.length === 0 && !pendingTestRef);
    showEditBanner();
    chatInput.focus();
    try { chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length); } catch (_) {}
  }

  // Called when the edited turn is resent. The truncation stays (the model needs
  // a coherent context) but the discarded tail is archived as a restorable branch,
  // so an edit never destroys earlier work.
  function commitEditMessage() {
    // Only worth archiving if something came *after* the edited turn. The
    // message at idx is replaced (already in the composer), so it is not a loss.
    if (pendingEdit && Array.isArray(pendingEdit.backup) && pendingEdit.backup.length > pendingEdit.idx + 1) {
      addBranch(activeConversationId, pendingEdit.idx, pendingEdit.backup);
    }
    pendingEdit = null;
    hideEditBanner();
    renderBranchBar();
  }

  // Silent=true is used when switching conversations: never touch the composer then.
  function cancelEditMessage(silent) {
    if (pendingEdit) {
      messages = pendingEdit.backup;    // restore the branch we cut
      renderMessagesFrom();
      scrollToBottom();
    }
    pendingEdit = null;
    hideEditBanner();
    if (silent) return;
    if (chatInput.value.trim()) {
      chatInput.value = '';
      autoResize();
      btnSend.disabled = true;
    }
  }

  function loadConversation(id) {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    revealChatView();
    activeConversationId = id;
    pendingQuizTopic = false;
    cancelEditMessage(true);
    setChatUrlParam(conv.shareCode || conv.id);
    try { updateChatLinkBar(); } catch (_) {}
    messages = conv.messages.map(function(message) {
      // Older/failed saves may carry the raw ```graph fence in content but no
      // .graph field yet — extract it here so graphs always re-render.
      if (!message.graph && message && message.role === 'assistant' && typeof message.content === 'string') {
        try { message.graph = parseGraphBlock(message.content); } catch (_) {}
        // Older conversations: the model described the points in prose without
        // a fence. Read the points straight from that text so the card comes
        // back even for chats from before the graph feature.
        if (!message.graph) {
          try { message.graph = extractGraphFromProse(message.content); } catch (_) {}
        }
        if (!message.graph) {
          try { message.graph = extractGraphFromSegments(message.content); } catch (_) {}
        }
      }
      if (message && message.role === 'assistant' && typeof message.content === 'string') {
        message.content = stripEmptyReferences(message.content);
      }
      return message;
    });
    renderMessagesFrom();
    scrollToBottom();
    renderHistory();
    renderBranchBar();
    closeMobileSidebar();
  }

  function renderHistory() {
    // Loading screen: the store may still be talking to the database. Keep the
    // panel alive with skeleton rows so it never looks broken or empty.
    if (!chatStoreReady) {
      var rows = '';
      for (var li = 0; li < 6; li++) {
        rows += '<div class="history-skeleton" aria-hidden="true">'
          + '<span class="hs-dot"></span>'
          + '<span class="hs-bar" style="width:' + (58 + ((li * 13) % 34)) + '%"></span>'
          + '</div>';
      }
      var loadingHtml = '<div class="history-loading" role="status" aria-live="polite">'
        + '<div class="history-loading-label"><span class="hl-spinner" aria-hidden="true"></span>Loading your chats</div>'
        + rows
        + '</div>';
      if (sidebarHistory) sidebarHistory.innerHTML = loadingHtml;
      if (sidebarHistoryMobile) sidebarHistoryMobile.innerHTML = loadingHtml;
      return;
    }
    // Separate per subject: only show current subject's chats
    var visible = conversations.filter(function(c){
      var s = c.subject || 'Physics';
      return s === selectedSubject;
    });
    // Search narrows further, across titles AND the messages inside each chat.
    var query = currentChatSearch();
    if (query) visible = visible.filter(function (c) { return conversationMatches(c, query); });
    // pinned first, then by recency. While searching, relevance leads.
    var sorted = visible.slice().sort(function(a,b){
      if (query) {
        var ra = searchScore(a, query), rb = searchScore(b, query);
        if (ra !== rb) return rb - ra;
      }
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0);
    }).slice(0, query ? 50 : 30);
    // Rebuilt row: one "⋮" control per chat; actions live in a popup.
    const pinMarkSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
    const itemHtml = (c) =>
      `<div class="history-item ${c.pinned ? 'pinned' : ''} ${c.id === activeConversationId ? 'active' : ''}" data-id="${c.id}">${c.pinned ? '<span class="history-pin-mark">' + pinMarkSvg + '</span>' : ''}<span class="history-item-text"><span class="history-title">${query ? highlightMatch(c.title, query) : escapeHtml(c.title)}</span>${query ? matchSnippet(c, query) : ''}</span><button class="history-menu-btn" data-id="${c.id}" aria-label="Chat options" aria-haspopup="true" title="Chat options">${HISTORY_MENU_SVG.dots}</button></div>`;

    // Pinned chats regroup into their own section above the normal chats.
    const pinnedList = sorted.filter(c => c.pinned);
    const normalList = sorted.filter(c => !c.pinned);
    let html = '';
    if (query) {
      // While searching, relevance leads — keep one flat list.
      html = sorted.map(itemHtml).join('');
    } else {
      if (pinnedList.length) {
        html += '<div class="history-section"><div class="sidebar-label"><span class="history-label-pin">' + pinMarkSvg + '</span>Pinned</div>' + pinnedList.map(itemHtml).join('') + '</div>';
      }
      if (normalList.length) {
        html += '<div class="history-section"><div class="sidebar-label">Chats</div>' + normalList.map(itemHtml).join('') + '</div>';
      }
    }
    // No early return here: the binding code below must still run, otherwise the
    // chat-link controls would go unclickable the next time a search has results.
    if (!sorted.length && query) {
      var noneHtml = '<div class="chat-search-empty">No chats match \u201C' + escapeHtml(query) + '\u201D</div>';
      sidebarHistory.innerHTML = noneHtml;
      if (sidebarHistoryMobile) sidebarHistoryMobile.innerHTML = noneHtml;
    } else {
      sidebarHistory.innerHTML = html;
      if (sidebarHistoryMobile) sidebarHistoryMobile.innerHTML = html;
    }

    [sidebarHistory, sidebarHistoryMobile].forEach(container => {
      if (!container) return;
      container.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.history-menu-btn') || e.target.closest('.history-title-input')) return;
          loadConversation(el.dataset.id);
        });
      });
      container.querySelectorAll('.history-menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openHistoryMenu(btn);
        });
      });
      try {
        var linkCopyBtn = document.getElementById('chat-link-copy');
        var linkTextEl = document.getElementById('chat-link-text');
        if (linkCopyBtn && !linkCopyBtn.dataset.bound) {
          linkCopyBtn.dataset.bound = '1';
          linkCopyBtn.addEventListener('click', function () {
            try { var parts = getChatLinkParts(); if (parts) navigator.clipboard.writeText(parts.full); } catch (_) {}
            try { showChatToast('Chat link copied'); } catch (_) {}
          });
        }
        if (linkTextEl && !linkTextEl.dataset.bound) {
          linkTextEl.dataset.bound = '1';
          linkTextEl.addEventListener('click', function () {
            try { var parts = getChatLinkParts(); if (parts) navigator.clipboard.writeText(parts.full); } catch (_) {}
            try { showChatToast('Chat link copied'); } catch (_) {}
          });
        }
      } catch (_) {}

    });
  }

  function deleteConversation(id) {
    const idx = conversations.findIndex(c => c.id === id);
    if (idx === -1) return;
    conversations.splice(idx, 1);
    try { var m=loadPinnedMap(); if(m[id]){ delete m[id]; savePinnedMap(m);} } catch(_){}
    try { removeMappedConvSubject(id); } catch (_) {}
    if (currentUserId()) deleteConversationFromDb(id);
    else writeLocalConversations();
    if (activeConversationId === id) {
      Object.keys(_graphCharts || {}).forEach(function (gid) {
        try { _graphCharts[gid].destroy(); } catch (_) {}
        delete _graphCharts[gid];
      });
      activeConversationId = null;
      messages = [];
      pendingQuizTopic = false;
      messagesList.innerHTML = '';
      messagesList.style.display = 'none';
      welcome.style.display = 'flex';
      syncWelcomeMode();
    }
    renderHistory();
  }

  // ── Delete confirmation dialog ────────────────────────────────
  // Deleting is permanent (no trash), so always ask first and surface the
  // chat title to make it unambiguous which conversation is going away.
  function confirmDeleteChat(id) {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    const title = conv.title || 'this chat';
    // Dismiss any open row menu before the modal appears.
    closeHistoryMenu();

    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Delete chat?');
    overlay.innerHTML =
      '<div class="delete-confirm-card">' +
        '<div class="delete-confirm-icon" aria-hidden="true">' + HISTORY_MENU_SVG.delete + '</div>' +
        '<h3>Delete this chat?</h3>' +
        '<p class="delete-confirm-title">"' + escapeHtml(title) + '"</p>' +
        '<p class="delete-confirm-note">This conversation will be permanently removed.</p>' +
        '<div class="delete-confirm-actions">' +
          '<button class="delete-confirm-cancel" type="button">Cancel</button>' +
          '<button class="delete-confirm-ok" type="button">Delete</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('delete-confirm-open');

    function close() {
      overlay.remove();
      document.body.classList.remove('delete-confirm-open');
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector('.delete-confirm-cancel').addEventListener('click', close);
    overlay.querySelector('.delete-confirm-ok').addEventListener('click', function () {
      close();
      deleteConversation(id);
    });
    // Focus the safer action by default.
    overlay.querySelector('.delete-confirm-cancel').focus();
  }

  // ── Chat row "⋮" menu · rename / pin / delete in one popup ──
  const HISTORY_MENU_SVG = {
    dots: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    rename: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
    delete: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
  };
  var _historyMenu = null;
  var _historyMenuOwner = null;

  function closeHistoryMenu() {
    if (_historyMenu) { _historyMenu.remove(); _historyMenu = null; _historyMenuOwner = null; }
  }

  function openHistoryMenu(btn) {
    closeHistoryMenu();
    const id = btn.getAttribute('data-id');
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    const menu = document.createElement('div');
    menu.className = 'history-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Chat actions');
    menu.innerHTML =
      '<button class="history-menu-item" data-act="rename" role="menuitem">' + HISTORY_MENU_SVG.rename + '<span>Rename</span></button>'
      + '<button class="history-menu-item" data-act="pin" role="menuitem">' + HISTORY_MENU_SVG.pin + '<span>' + (conv.pinned ? 'Unpin' : 'Pin to top') + '</span></button>'
      + '<div class="history-menu-sep" role="separator"></div>'
      + '<button class="history-menu-item danger" data-act="delete" role="menuitem">' + HISTORY_MENU_SVG.delete + '<span>Delete chat</span></button>';
    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.history-menu-item');
      if (!item) return;
      const act = item.getAttribute('data-act');
      e.stopPropagation();
      closeHistoryMenu();
      if (act === 'rename') startRenameChat(id, btn);
      else if (act === 'pin') togglePin(id);
      else if (act === 'delete') confirmDeleteChat(id);
    });

    // Position next to the ⋮ button, kept inside the viewport.
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth || 190;
    const mh = menu.offsetHeight || 150;
    let left = r.right - mw;
    let top = r.top - 6;
    if (left < 12) left = 12;
    if (top + mh > window.innerHeight - 12) top = Math.max(12, r.bottom - mh);
    if (top < 12) top = 12;
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.style.opacity = '1';
    menu.style.transform = 'translateY(0) scale(1)';
    menu.style.pointerEvents = 'auto';
    _historyMenu = menu;
    _historyMenuOwner = btn;
  }

  document.addEventListener('click', function (e) {
    if (_historyMenu && !e.target.closest('.history-menu') && !e.target.closest('.history-menu-btn')) {
      closeHistoryMenu();
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeHistoryMenu(); });
  window.addEventListener('resize', closeHistoryMenu);
  window.addEventListener('scroll', closeHistoryMenu, { passive: true, capture: true });

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
    const testHtml = (role === 'user' && opts.test) ? testChipHtml(opts.test) : '';

    // Build image thumbnails HTML if images were sent
    let imagesHtml = '';
    if (opts.images && opts.images.length > 0) {
      imagesHtml = '<div class="msg-images">';
      opts.images.forEach(dataUrl => {
        imagesHtml += `<img src="${dataUrl}" alt="Attached image" class="msg-image-thumb">`;
      });
      imagesHtml += '</div>';
    }

    // Generated image (text -> image): large render, click opens lightbox.
    let generatedHtml = '';
    if (opts.generatedImage) {
      generatedHtml = `<div class="msg-generated"><img src="${opts.generatedImage}" alt="Generated image" class="msg-generated-image"></div>`;
    }

    if (role === 'assistant') {
      var quiz = null;
      if (opts.quiz) {
        try { quiz = normalizeQuizData(opts.quiz); } catch (_) {}
      }
      if (!quiz) {
        try { quiz = parseQuizBlock(content, false); } catch (_) {}
      }
      var graphData = null;
      try { graphData = opts.graph || parseGraphBlock(content); } catch (_) {}
      var displayContent = content;
      try {
        displayContent = quiz ? stripQuizBlock(content, true) : content;
        displayContent = stripFileBlocks(displayContent);
        displayContent = stripGraphBlock(displayContent);
        displayContent = stripRedoxComponent(displayContent);
        displayContent = stripEmptyReferences(displayContent);
      } catch (_) {}
      // A graph card is showing: keep the bubble to one tiny caption line
      // (or nothing). The full explanation stays in the stored message.
      if (graphData && !quiz) displayContent = shortGraphCaption(graphData);
      div.innerHTML = `
        <div class="msg-avatar assistant-avatar"><img src="../assets/anteemonee.png" alt="Anteemonee"></div>
        <div class="msg-body">${quoteHtml}${generatedHtml}<div class="msg-content${displayContent ? '' : ' is-empty'}">${displayContent ? renderMarkdown(displayContent) : ''}</div></div>
      `;
    } else {
      const imgUrl = getUserAvatarUrl();
      const initial = getUserInitial();
      const avatarHtml = imgUrl
        ? `<img src="${escapeHtml(imgUrl)}" alt="You" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar-fallback-msg" style="display:none">${escapeHtml(initial)}</div>`
        : `<div class="avatar-fallback-msg">${escapeHtml(initial)}</div>`;
      div.innerHTML = `
        <div class="msg-avatar user-avatar">${avatarHtml}</div>
        <div class="msg-body">${quoteHtml}${testHtml}${imagesHtml}<div class="msg-content">${escapeHtml(content)}</div></div>
      `;
      attachUserActions(div);
    }
    if (role === 'assistant') {
      try { handleFileBlocks(div, content); } catch (_) {}
      if (quiz) {
        try { renderQuizCard(div, quiz); } catch (_) {}
      }
      try {
        if (graphData) renderGraphCard(div, graphData);
      } catch (err) { try { console.warn('[Graph] appendMessage:', err && err.message); } catch (_) {} }
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

  /**
   * Friendly name for the model id the tunnel actually served. The router
   * sometimes answers via an internal fallback model, so the pill must read
   * the real id — never a hardcoded name.
   */
  function tunnelModelLabel(model) {
    var m = String(model || '').toLowerCase();
    if (m.indexOf('space-bunny') !== -1) return 'Space Bunny';
    if (m.indexOf('muse-spark') !== -1) return 'Muse Spark 1.3';
    if (m.indexOf('gpt-6') !== -1 || m.indexOf('astra') !== -1) return 'GPT-6 Astra';
    return null;
  }

  /**
   * Name of the engine that is actually serving the reply in flight.
   * `api.lastServed` is written by the API service from the live stream itself
   * (it reads the `model` id off the chunks), so this reflects the real route:
   * the tunnel model name when the priority tunnel answers, otherwise the fallback model.
   */
  function getServingEngineLabel() {
    try {
      var served = (typeof api !== 'undefined' && api && api.lastServed) ? api.lastServed : null;
      if (!served) return null;
      if (served.engine !== 'astra') return served.provider || 'AI';
      return tunnelModelLabel(served.model) || served.provider || 'Muse Spark';
    } catch (_) { return null; }
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
    var graphExpected = !!(div && div.__graphRequested) || /```\s*graph\s*\n/i.test(text);
    if (graphExpected) displayText = '';
    displayText = displayText.replace(/```\s*graph\s*\n[\s\S]*?```/gi, '<span class="graph-stream-placeholder">📊 Building your chart…</span>');
    var renderedText;
    if (displayText) renderedText = renderStreamingMarkdown(displayText);
    else if (graphExpected) renderedText = '<span class="graph-stream-placeholder">📊 Building your chart…</span>';
    else renderedText = '<span class="quiz-stream-placeholder">Preparing your interactive quiz…</span>';
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

  var BRANCH_ICON = '<svg class="branch-bar-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4a8.8 8.8 0 0 1 0 16"/><path d="M3.5 9a9 9 0 0 0 0 6"/></svg>';
  var EDIT_PEN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" strokecap="round" strokelinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var EDIT_BANNER_SVG = '<svg class="edit-banner-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" strokecap="round" strokelinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
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
      attachEngineBadge(body, idx);
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

  /**
   * Small "which model answered this" label inside the feedback row, right
   * after the sound button. It is rendered from the engine recorded on the
   * message, which the API service took from the real streamed response — so
   * the label can never claim Astra when Astra was not the one that answered.
   * That makes a silent fallback visible. Shown for every account.
   */
  function attachEngineBadge(body, idx) {
    try {
      var wrap = body ? body.querySelector('.msg-feedback') : null;
      var tts = wrap ? wrap.querySelector('.fb-tts') : null;
      if (!tts || wrap.querySelector('.msg-model')) return;
      var message = (typeof messages !== 'undefined' && messages && messages[idx]) ? messages[idx] : null;
      var engine = message && message.engine;
      if (!engine || !engine.engine) return;
      var label = document.createElement('span');
      label.className = 'msg-model';
      if (engine.engine === 'astra') {
        var tLabel = tunnelModelLabel(engine.model) || engine.provider || 'Muse Spark 1.3';
        label.textContent = tLabel;
        label.title = 'Answered by ' + tLabel + (engine.model ? ' (' + engine.model + ')' : '');
      } else {
        label.textContent = engine.provider || 'AI';
        label.title = 'Answered by ' + (engine.provider || 'the fallback model') + (engine.model ? ' (' + engine.model + ')' : '');
      }
      if (tts.insertAdjacentElement) tts.insertAdjacentElement('afterend', label);
      else wrap.appendChild(label);
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
      window.location.href = '/pages/report.html';
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

// ── Graph block: ```graph\n{...json...}\n``` ───────────────────
function parseGraphBlock(text) {
  if (!text) return null;
  var m = text.match(/```\s*graph\s*\n([\s\S]*?)```/i);
  if (m && m[1]) {
    try {
      var data = JSON.parse(m[1].trim());
      var norm = normalizeGraphData(data);
      if (norm) return norm;
    } catch (_) {}
  }
  // Fallback: the model sometimes answers with a generic ```json fence that
  // still contains chart-shaped data (title/labels/datasets). Accept that too.
  var j = text.match(/```\s*(?:json|javascript)?\s*\n([\s\S]*?)```/i);
  if (j && j[1]) {
    try {
      var candidate = JSON.parse(j[1].trim());
      var norm2 = normalizeGraphData(candidate);
      if (norm2) return norm2;
    } catch (_) {}
  }
  return null;
}
function stripGraphBlock(text) {
  if (!text) return text;
  var out = text.replace(/```\s*graph\s*\n[\s\S]*?```/gi, "").trim();
  out = out.replace(/```\s*(?:json|javascript)?\s*\n[\s\S]*?\{"title"[\s\S]*?```/gi, "").trim();
  return out;
}
function normalizeGraphData(graph) {
  if (!graph || typeof graph !== 'object') return null;
  var labels = Array.isArray(graph.labels) ? graph.labels.map(l => String(l == null ? '' : l)) : [];
  var rawSets = Array.isArray(graph.datasets) && graph.datasets.length ? graph.datasets : [];
  if (!labels.length && !rawSets.length) return null;
  var datasets = rawSets.map(function (s) {
    var vals = Array.isArray(s && s.data) ? s.data.map(function (v) {
      var n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    }) : [];
    return { name: String((s && s.name) || 'Series'), data: vals };
  }).filter(function (d) { return d.data.length > 0; });
  // Allow raw number arrays: datasets:[ [1,2,3], [4,5,6] ]
  if (!datasets.length) {
    datasets = rawSets.map(function (s, idx) {
      var vals = Array.isArray(s) ? s : [];
      return { name: 'Series ' + (idx + 1), data: vals.map(function (v) { var n = parseFloat(v); return Number.isFinite(n) ? n : 0; }) };
    });
  }
  if (!datasets.length && !labels.length) return null;
  var types = ['line', 'bar', 'pie', 'scatter', 'area'];
  var type = types.indexOf(String(graph.type).toLowerCase()) !== -1 ? String(graph.type).toLowerCase() : 'line';
  // For scatter we need points; fall back to line with x as index if absent.
  if (type === 'scatter') type = 'line';
  // When a parser forgets the axis names, guess them from the title
  // ("Speed vs Time" -> X = Time, Y = Speed) and default to X/Y otherwise.
  var axisGuess = ['X', 'Y'];
  var titleAxis = String(graph.title || '').match(/([A-Za-z][A-Za-z ]*?)\s*(?:vs\.?|versus|–|—|-)\s*([A-Za-z][A-Za-z ]*)/i);
  if (titleAxis) axisGuess = [titleAxis[2].trim(), titleAxis[1].trim()];
  return {
    title: String(graph.title || 'Chart'),
    type: type,
    xLabel: String(graph.xLabel || axisGuess[0]),
    yLabel: String(graph.yLabel || axisGuess[1]),
    labels: labels,
    datasets: datasets.filter(function (d) { return d.data.length > 0; }),
  };
}

// When a chart card is present the bubble text is collapsed to one short
// caption line (e.g. "Speed vs Time · X: Time (s) · Y: Speed (m/s)"). Returns
// '' when there is nothing worth showing, so the bubble can hide entirely.
function shortGraphCaption(graph) {
  try {
    var g = normalizeGraphData(graph);
    if (!g) return '';
    var bits = [];
    if (g.title && g.title !== 'Chart') bits.push(g.title);
    if (g.xLabel && g.yLabel && g.xLabel !== 'X' && g.yLabel !== 'Y') {
      bits.push('X: ' + g.xLabel + ' \u00b7 Y: ' + g.yLabel);
    }
    return bits.join(' \u00b7 ');
  } catch (_) {}
  return '';
}

// Final safety net: if a graph was requested but the model answered in prose
// without emitting a ```graph fence, rebuild a graph from the numbers the
// student gave (e.g. "speed from 0 to 10, time from 10s to 60s").
function synthesizeGraphFromPrompt(promptText) {
  try {
    if (!promptText) return null;
    var t = String(promptText);
    // Capture an "X from A to B" pair with optional units, e.g.
    //   time from 10 s to 60 s
    //   speed from 0 to 10 m/s
    var yMatch = t.match(/(?:speed|velocity|value|reading|marks|score|distance|position|force|temperature|count|number|price|population|mass|energy|voltage|current)\s*(?:from|of|=|:)\s*([0-9]+(?:\.[0-9]+)?)[^\d]{0,14}([0-9]+(?:\.[0-9]+)?)/i);
    var xMatch = t.match(/(?:time|year|day|month|hour|week|t)\s*(?:from|of|=\s*\d|=|:)\s*([0-9]+(?:\.[0-9]+)?)[^\d]{0,14}([0-9]+(?:\.[0-9]+)?)/i);
    if (xMatch && (yMatch || /(?:speed|velocity|distance|position|force|temperature|value)/i.test(t))) {
      var x0 = parseFloat(xMatch[1]), x1 = parseFloat(xMatch[2]);
      var y0 = yMatch ? parseFloat(yMatch[1]) : 0;
      var y1 = yMatch ? parseFloat(yMatch[2]) : (/\b(0|zero)\b/i.test(t) ? 1 : 10);
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 === x1) return null;
      var n = Math.min(11, Math.max(5, Math.ceil(Math.abs(x1 - x0) / 5)));
      var labels = [], data = [];
      for (var i = 0; i <= n; i++) {
        var frac = i / n;
        labels.push(String(Math.round((x0 + (x1 - x0) * frac) * 100) / 100));
        data.push(Math.round((y0 + (y1 - y0) * frac) * 100) / 100);
      }
      var yName = yMatch ? t.slice(0, Math.max(0, t.indexOf(yMatch[0]))) : 'Value';
      var unit = t.match(/(m\/s|m s-1|m s⁻¹|km\/h|kmh|m|s|days|years?|months?|newton|n|kg|m s|m\/s²)/i);
      var xLabel = 'Time' + (x0 === 0 ? '' : ' (start ' + x0 + ')');
      return {
        title: (yName ? yName.trim() : 'Value') + ' over ' + 'time',
        type: 'line',
        xLabel: 'Time',
        yLabel: (['speed','velocity'].some(function(w){ return /speed|velocity/i.test(promptText); }) ? 'Speed' : 'Value') + (unit ? ' (' + unit[1] + ')' : ''),
        labels: labels,
        datasets: [{ name: 'Data', data: data }],
      };
    }
  } catch (_) {}
  return null;
}

// Second safety net: the model often describes the exact points in prose
// without emitting a fence, e.g.
//   "d = 0 m ⇒ W = 0 J" ... "d = 5 m ⇒ W = 50 J"
// or "F = 10 N" + "d = 0,1,2,3,4,5 m". Extract those (x, y) pairs and build
// the chart from them so the card always appears.
function extractGraphFromProse(text) {
  try {
    if (!text) return null;
    var t = String(text).replace(/\u2013|\u2014|–|—/g, '\u2192').replace(/\u2011|\u207b/g, '-');
    var labels = [], data = [];

    // Explicit point pairs for any physics pair, e.g.
    //   "t = 0 s → v = 0 m/s"   "d = 1 m ⇒ W = 10 J"
    //   "(0, 0) (2, 4)"          "x: 1, 2, 3 → y: 4, 5, 6"
    var X_VARS = '(?:t|d|v|x|h|m|time|displacement|distance|speed|velocity|position|force|temperature|height|mass|volume|year|day|month|week)';
    var Y_VARS = '(?:v|W|work|y|speed|velocity|force|temperature|distance|displacement|area|energy|height|reading|value|count|price|population)';
    var pairRe = new RegExp(
      X_VARS + '\\s*[=:]\\s*(\\d+(?:\\.\\d+)?)' + // x = 0
      '\\s*(?:m|m\\/s|m s-1|m s|s|km\\/h|cm|mm|kg|N|l|u)?' +
      '\\s*(?:=>|->|\\u21d2|\\u2192|gives|is|=|,|\\(|to)' +
      '\\s*' + Y_VARS + '\\s*[=:]\\s*(\\d+(?:\\.\\d+)?)' +
      '\\s*(?:J|J|m|m\\/s|m s-1|m s|cm|mm|kg|N|l|s)?',
      'gi'
    );
    var m;
    while ((m = pairRe.exec(t)) !== null) {
      labels.push(m[1]);
      data.push(parseFloat(m[2]));
    }
    if (labels.length && labels.length === data.length) {
      // Keep only the largest sensible run that is truly consecutive.
      var seen = {}, outLabels = [], outData = [];
      for (var i = 0; i < labels.length; i++) {
        if (seen[labels[i]]) continue;
        seen[labels[i]] = 1;
        outLabels.push(labels[i]);
        outData.push(data[i]);
      }
      if (outLabels.length >= 2) return buildLine(outLabels, outData);
    }

    // "v = 2t" / "a = 2" style formula with explicit time values:
    //   "a = 2 m/s², t = 0,2,4,6,8,10 s"  ->  speed = a*t
    if (!labels.length) {
      var formulaM = t.match(/(?:v|speed|y|W|work|distance|force)\s*[=:]\s*(?:u\s*\+?)?(\d+(?:\.\d+)?)[\s·×x*](?:t|d|time|displacement|x)/gi);
      var accM = t.match(/(?:a|acceleration|constant)\s*[=:]\s*(\d+(?:\.\d+)?)\s*m\/s2|m s-2|m\/s\u00b2|m s\u207b\u00b2/i) ||
        t.match(/(?:a|acceleration)\s*[=:]\s*(\d+(?:\.\d+)?)/i);
      var xValsM = t.match(/(?:t|time)\s*[=:]\s*([\d,\s.]+?)\s*s/i) ||
        t.match(/(?:t|time)\s*[=:]\s*([\d,\s.]+?)(?:\n|, and| and |;|\.)/i);
      if (accM) {
        var aVal = parseFloat(accM[1]);
        var xSrc = null;
        // Prefer times explicitly listed
        var times = t.match(/(?:t\s*[=:]\s*)([\d,\s.]{2,40})\s*s/gi);
        if (times && times.length) {
          var tt = times[times.length - 1].match(/([\d,\s.]{2,40})/);
          if (tt) xSrc = tt[1].split(/[,\s]+/).map(parseFloat).filter(function(n){ return Number.isFinite(n); });
        } else if (xValsM) {
          xSrc = xValsM[1].split(/[,\s]+/).map(parseFloat).filter(function(n){ return Number.isFinite(n); });
        }
        if (xSrc && xSrc.length >= 2 && Number.isFinite(aVal)) {
          return buildLine(xSrc.map(String), xSrc.map(function(x){ return Math.round(x * aVal * 100) / 100; }), true);
        }
      }
    }

    // Constant-force style: "F = 15 N" with an x list "d = 0,1,2,3 m".
    if (/(?:work|W)\s*[=:]\s*(?:F|force|constant)\s*[·×xd]\s*(?:d|displacement)/i.test(t) ||
        /(?:F|force)\s*[=:]\s*(\d+(?:\.\d+)?)\s*N/i.test(t)) {
      var fM = t.match(/(?:F|force|constant force)\s*[=:]\s*(\d+(?:\.\d+)?)\s*N/i);
      var xList = t.match(/(?:d|displacement)\s*[=:]\s*([\d,\s.]+?)\s*m/i);
      if (fM && xList) {
        var F = parseFloat(fM[1]);
        var xs = xList[1].split(/[,\s]+/).map(function(s){ return parseFloat(s); }).filter(function(n){ return Number.isFinite(n); });
        if (xs.length >= 2 && Number.isFinite(F)) {
          return buildLine(xs.map(String), xs.map(function(x){ return Math.round(x * F * 100) / 100; }));
        }
      }
    }
  } catch (_) {}
  return null;

  function buildLine(xs, ys, speed) {
    var speedGraph = /speed|velocity|t\s*[=:]\s*\d/i.test(t) || speed === true;
    return {
      title: speedGraph ? 'Speed vs Time' : (/work|W\s*[=:]/i.test(t) ? 'Work vs Displacement' : 'Graph'),
      type: 'line',
      xLabel: speedGraph ? 'Time (s)' : (/work|W\s*[=:]/i.test(t) ? 'Displacement (m)' : 'X'),
      yLabel: speedGraph ? 'Speed (m/s)' : (/work|W\s*[=:]/i.test(t) ? 'Work (J)' : 'Y'),
      labels: xs,
      datasets: [{ name: 'Data', data: ys }],
    };
  }
}

// Last resort: the student asked for a graph but the model produced nothing
// parseable (e.g. "make a random graph with random values"). Ship a clean
// demo dataset so a chart card always appears instead of dead text.
function randomDemoGraph(promptText) {
  try {
    var values = [];
    var labels = [];
    var base = (promptText && promptText.match(/random graph|random values|random data|random chart/i)) ? 1 : 0;
    for (var i = 0; i < 6; i++) {
      labels.push(String(base * 10 + i * 2));
      values.push(Math.round((20 + Math.sin(i * 1.4) * 14 + (base ? (i % 2 ? 9 : 3) : 0)) * 10) / 10);
    }
    return {
      title: base ? 'Random Data Graph' : 'Sample Graph',
      type: 'line',
      xLabel: 'X',
      yLabel: 'Y',
      labels: labels,
      datasets: [{ name: 'Sample', data: values }],
    };
  } catch (_) {}
  return null;
}

// Third safety net: the model describes the graph via time-segments, e.g.
//   "From 0 s to 2 s the speed rises from 0 to 5 m s⁻¹"
//   "Between 2 s and 4 s ... speed jumps to 12 m s⁻¹"
//   "From 8 s to 10 s the line is slightly descending (speed falls to 10)"
// plus a worked example like "½ × (5+12) × 2" whose trapezium endpoints are
// the sequential (time, speed) points. Rebuild the point list from these.
function extractGraphFromSegments(text) {
  try {
    if (!text) return null;
    var t = String(text).replace(/\u00d7|x|×/g, ' x ').replace(/\u2013|\u2014|–|—/g, '\u2192');
    var times = [];
    var st = {};
    function pushT(v) { if (Number.isFinite(v) && !(st['t' + v])) { st['t' + v] = 1; times.push(v); } }
    var segRe = /(?:from|between)\s+(\d+(?:\.\d+)?)\s*s?\s*(?:to|and|\u2192|:|->|[,\-])\s*(\d+(?:\.\d+)?)\s*s/gi;
    var m;
    while ((m = segRe.exec(t)) !== null) { pushT(parseFloat(m[1])); pushT(parseFloat(m[2])); }
    if (!times.length) return null;
    times.sort(function(a, b) { return a - b; });

    // Endpoint speeds from segment text, in order of appearance.
    var speeds = [];
    function pushS(v) { if (Number.isFinite(v)) speeds.push(v); }
    // "rises from A to B" -> A then B  |  "jumps to B"/"drops to B"/"falls to B" -> B
    var riseRe = /(?:rises?|increases?|climbs?|accelerates?)\s+(?:from|at)?\s*(\d+(?:\.\d+)?)\s*(?:to|and|up\s+to|reaches)\s*(\d+(?:\.\d+)?)/gi;
    while ((m = riseRe.exec(t)) !== null) { pushS(parseFloat(m[1])); pushS(parseFloat(m[2])); }
    var jumpRe = /(?:jumps?|shoots?|goes?\s+up|climbs?\s+back|rises?\s+to)\s*(?:up\s+to|to|by)?\s*(\d+(?:\.\d+)?)/gi;
    while ((m = jumpRe.exec(t)) !== null) { pushS(parseFloat(m[1])); }
    var dropRe = /(?:drops?|falls?|decreases?|goes?\s+down|descends?|slows?|decelerat(?:es|ing)?)\s*(?:down\s+to|to|by|from)?\s*(\d+(?:\.\d+)?)/gi;
    while ((m = dropRe.exec(t)) !== null) { pushS(parseFloat(m[1])); }

    // Worked example trapezium endpoints give the exact ordered speed points:
    //   "½ × (5+12) × 2" -> speeds 5, 12  ...  sequence: 5,12,8,15,10
    var trapEnds = [];
    var trapRe = /\(\s*(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*\)/gi;
    while ((m = trapRe.exec(t)) !== null) {
      var a = parseFloat(m[1]), b = parseFloat(m[2]);
      if (!trapEnds.length) trapEnds.push(a);
      trapEnds.push(b);
    }

    // Prefer the dense worked-example sequence; fall back to segment endpoints.
    var bestSpeeds = trapEnds.length >= 2 ? trapEnds : speeds;

    // Time 0 usually starts from rest (0 m/s); the model gives one speed per
    // time after that.
    var full = [];
    if (times[0] === 0) {
      full = [0];
      for (var i = 0; i < times.length - 1; i++) full.push(bestSpeeds[i] != null ? bestSpeeds[i] : 0);
    } else {
      full = bestSpeeds.slice(0, times.length);
    }
    if (full.length < times.length) {
      while (full.length < times.length) full.push(0);
    }
    if (times.length < 2 || full.length < 2) return null;
    var pts = [];
    for (var j = 0; j < times.length; j++) pts.push([times[j], full[j]]);
    return {
      title: /velocity|speed|speed-time/i.test(t) ? 'Speed vs Time' : (/work|W\s*[=:]/i.test(t) ? 'Work vs Displacement' : 'Graph'),
      type: 'line',
      xLabel: /velocity|speed|speed-time/i.test(t) ? 'Time (s)' : 'X',
      yLabel: /velocity|speed|speed-time/i.test(t) ? 'Speed (m/s)' : 'Y',
      labels: pts.map(function(p){ return String(p[0]); }),
      datasets: [{ name: 'Data', data: pts.map(function(p){ return p[1]; }) }],
    };
  } catch (_) {}
  return null;
}

// Legacy cleaner: older answers may still carry a redox-component fence in
// stored history. It is no longer produced or rendered, just stripped out.
function stripRedoxComponent(text) {
  if (!text) return text;
  return text.replace(/```\s*redox-component\s*\n[\s\S]*?```/ig, "").trim();
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

// ── Interactive graph card ───────────────────────────────────────
// Renders a Chart.js chart from the model's ```graph``` block. The student
// can edit titles, labels and values, switch the chart type, add/remove rows
// and download the result as a PNG.
var _graphCharts = {}; // idx -> Chart instance
try { window.__anteemoneeGraphCharts = _graphCharts; } catch (_) {}

function graphChartColors() {
  var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3B82F6';
  var text = getComputedStyle(document.body).color || 'rgba(255,255,255,0.8)';
  var grid = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(255,255,255,0.12)';
  return { accent: accent, text: text, grid: grid };
}

function escapeGraphHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildGraphEditor(card, chartId, chart, onEdit) {
  var grid = document.createElement('div');
  grid.className = 'graph-editor';
  var rows = document.createElement('div');
  rows.className = 'graph-editor-rows';
  grid.style.setProperty('--graph-cols', Math.max(1, (chart.config.data.datasets || []).length));

  function renderRows() {
    rows.innerHTML = '';
    var labels = chart.data.labels || [];
    var sets = chart.config.data.datasets || [];
    for (var i = 0; i < labels.length; i++) {
      (function (rowIdx) {
        var row = document.createElement('div');
        row.className = 'graph-editor-row';
        var labelInput = document.createElement('input');
        labelInput.className = 'graph-ed-input graph-ed-label';
        labelInput.value = labels[rowIdx];
        labelInput.placeholder = 'Label';
        var valueInputs = [];
        sets.forEach(function (set, sIdx) {
          var vi = document.createElement('input');
          vi.className = 'graph-ed-input graph-ed-value';
          vi.type = 'number';
          vi.step = 'any';
          vi.value = set.data[rowIdx] != null ? set.data[rowIdx] : '';
          vi.title = set.label || ('Series ' + (sIdx + 1));
          valueInputs.push(vi);
        });
        var remove = document.createElement('button');
        remove.className = 'graph-ed-remove';
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove row');
        remove.innerHTML = '✕';
        row.appendChild(labelInput);
        valueInputs.forEach(function (vi) { row.appendChild(vi); });
        row.appendChild(remove);
        labelInput.addEventListener('input', function () {
          chart.data.labels[rowIdx] = labelInput.value;
          chart.update();
          if (onEdit) onEdit();
        });
        valueInputs.forEach(function (vi, sIdx) {
          vi.addEventListener('input', function () {
            var v = parseFloat(vi.value);
            chart.config.data.datasets[sIdx].data[rowIdx] = Number.isFinite(v) ? v : 0;
            chart.update();
            if (onEdit) onEdit();
          });
        });
        remove.addEventListener('click', function () {
          chart.data.labels.splice(rowIdx, 1);
          chart.config.data.datasets.forEach(function (set) { set.data.splice(rowIdx, 1); });
          chart.update();
          renderRows();
          if (onEdit) onEdit();
        });
        rows.appendChild(row);
      })(i);
    }
  }

  var addRow = document.createElement('button');
  addRow.className = 'graph-ed-add';
  addRow.type = 'button';
  addRow.textContent = '+ Add value';
  addRow.addEventListener('click', function () {
    chart.data.labels.push('New');
    chart.config.data.datasets.forEach(function (set) { set.data.push(0); });
    chart.update();
    renderRows();
    if (onEdit) onEdit();
  });

  // Value column headers
  var head = document.createElement('div');
  head.className = 'graph-ed-head';
  var headLabel = document.createElement('span');
  headLabel.textContent = 'Label';
  head.appendChild(headLabel);
  (chart.config.data.datasets || []).forEach(function (set) {
    var hs = document.createElement('span');
    hs.textContent = set.label || 'Value';
    hs.title = set.label;
    head.appendChild(hs);
  });

  grid.appendChild(head);
  grid.appendChild(rows);
  grid.appendChild(addRow);
  renderRows();
  return grid;
}

function renderGraphCard(div, rawGraph) {
  var graph = normalizeGraphData(rawGraph);
  if (!graph || typeof Chart === 'undefined') return null;
  var host = div.querySelector('.msg-body') || div;
  var msgIdx = (div && div.dataset && div.dataset.idx != null) ? parseInt(div.dataset.idx, 10) : null;
  var existing = host.querySelector('.graph-card');
  if (existing) existing.remove();

  var card = document.createElement('section');
  card.className = 'graph-card';

  var head = document.createElement('div');
  head.className = 'graph-card-head';
  var title = document.createElement('input');
  title.className = 'graph-card-title';
  title.value = graph.title;
  title.setAttribute('aria-label', 'Chart title');

  var typeSel = document.createElement('select');
  typeSel.className = 'graph-type-select';
  ['line', 'bar', 'area', 'pie', 'scatter'].forEach(function (t) {
    var opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    if (t === graph.type) opt.selected = true;
    typeSel.appendChild(opt);
  });

  var download = document.createElement('button');
  download.className = 'graph-download';
  download.type = 'button';
  download.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>PNG</span>';
  download.setAttribute('aria-label', 'Download chart as PNG');

  var wrap = document.createElement('div');
  wrap.className = 'graph-canvas-wrap';
  var canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', graph.title + ' chart');
  wrap.appendChild(canvas);

  head.appendChild(title);
  head.appendChild(typeSel);
  head.appendChild(download);
  card.appendChild(head);
  card.appendChild(wrap);
  var axisCap = document.createElement('div');
  axisCap.className = 'graph-axis-caption';
  axisCap.textContent = 'X-axis: ' + (graph.xLabel || 'X') + '   \u00b7   Y-axis: ' + (graph.yLabel || 'Y');
  card.appendChild(axisCap);

  var chartId = 'chrome_' + Math.random().toString(36).slice(2, 10);
  canvas.id = chartId;
  var colors = graphChartColors();

  function makeDataset(set, idx) {
    var palette = ['#3B82F6', '#F59E0B', '#22C55E', '#EF4444', '#8B5CF6', '#06B6D4'];
    var color = palette[idx % palette.length];
    var base = {
      label: set.name || 'Series ' + (idx + 1),
      data: set.data || [],
      borderColor: color,
      backgroundColor: color,
      pointBackgroundColor: color,
      pointRadius: 4,
      pointHoverRadius: 6,
    };
    return base;
  }

  function buildConfig() {
    var type = typeSel.value;
    var sets = graph.datasets.map(makeDataset);
    var config = {
      type: type === 'area' ? 'line' : (type === 'pie' ? 'doughnut' : type),
      data: {
        labels: graph.labels,
        datasets: sets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        plugins: {
          legend: { labels: { color: colors.text, font: { size: 11 } } },
          tooltip: { enabled: true },
        },
      },
    };
    if (type === 'area') {
      sets.forEach(function (s) {
        s.fill = true;
        s.backgroundColor = colorMix(s.borderColor, 0.22);
        s.tension = 0.35;
      });
      config.options.scales = {
        x: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 } } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 } } },
      };
      config.options.plugins.title = {
        display: false,
      };
    } else if (type === 'line' || type === 'scatter') {
      sets.forEach(function (s) {
        s.tension = 0.35;
        s.borderWidth = 2;
      });
      config.options.scales = {
        x: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 } } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 } } },
      };
    } else if (type === 'bar') {
      sets.forEach(function (s) {
        s.borderRadius = 6;
        s.maxBarThickness = 42;
      });
      config.options.scales = {
        x: { grid: { display: false }, ticks: { color: colors.text, font: { size: 11 } } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 } } },
      };
    } else if (type === 'pie') {
      config.options.plugins.legend.position = 'bottom';
      sets.forEach(function (s, idx) {
        var palette = ['#3B82F6', '#F59E0B', '#22C55E', '#EF4444', '#8B5CF6', '#06B6D4'];
        s.backgroundColor = graph.labels.map(function (_, li) { return shade(palette[(idx + li) % palette.length], li * 0.06); });
        s.borderColor = colors.text;
        s.borderWidth = 1;
      });
    }
    if (type !== 'pie' && config.options.scales) {
      [['x', graph.xLabel || 'X'], ['y', graph.yLabel || 'Y']].forEach(function (pair) {
        config.options.scales[pair[0]].title = {
          display: true,
          text: pair[1],
          color: colors.text,
          font: { size: 12, weight: 'bold' },
        };
      });
    }
    return config;
  }

  function colorMix(hex, alpha) {
    try {
      var c = hex.replace('#', '');
      var n = parseInt(c.length === 3 ? c.split('').map(function (s) { return s + s; }).join('') : c, 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    } catch (_) { return hex; }
  }
  function shade(hex, amt) {
    try {
      var c = hex.replace('#', '');
      var n = parseInt(c.length === 3 ? c.split('').map(function (s) { return s + s; }).join('') : c, 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      r = Math.max(0, Math.min(255, Math.round(r + (255 - r) * amt)));
      g = Math.max(0, Math.min(255, Math.round(g + (255 - g) * amt)));
      b = Math.max(0, Math.min(255, Math.round(b + (255 - b) * amt)));
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    } catch (_) { return hex; }
  }

  var chart = new Chart(canvas.getContext('2d'), buildConfig());
  _graphCharts[chartId] = chart;

  function commitGraphEdits() {
    try {
      if (msgIdx === null || !window.__anteemoneeGraphEdited) return;
      window.__anteemoneeGraphEdited(msgIdx, {
        title: graph.title || title.value,
        type: typeSel.value,
        xLabel: graph.xLabel || 'X',
        yLabel: graph.yLabel || 'Y',
        labels: (chart.data.labels || []).slice(),
        datasets: (chart.config.data.datasets || []).map(function (s) {
          return { name: s.label || 'Data', data: (s.data || []).slice() };
        }),
      });
    } catch (_) {}
  }

  title.addEventListener('input', function () {
    graph.title = title.value;
    commitGraphEdits();
  });
  typeSel.addEventListener('change', function () {
    chart.destroy();
    chart = new Chart(canvas.getContext('2d'), buildConfig());
    _graphCharts[chartId] = chart;
    commitGraphEdits();
  });
  download.addEventListener('click', function () {
    try {
      // Give the animation a beat, then export at 2x for crispness.
      setTimeout(function () {
        var url = canvas.toDataURL('image/png');
        var a = document.createElement('a');
        a.href = url;
        a.download = (graph.title || 'chart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        showChatToast('Graph downloaded as PNG');
      }, 90);
    } catch (_) {}
  });

  var editor = buildGraphEditor(card, chartId, chart, commitGraphEdits);
  card.appendChild(editor);
  host.appendChild(card);
  return card;
}

function destroyGraphsIn(host) {
  if (!host) return;
  var canvas = host.querySelector('.graph-card canvas');
  if (canvas && canvas.id && _graphCharts[canvas.id]) {
    try { _graphCharts[canvas.id].destroy(); } catch (_) {}
    delete _graphCharts[canvas.id];
  }
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
        var htmlDoc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>"+escapeHtml(filename)+"</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:800px;margin:40px auto;padding:32px;line-height:1.7;color:#0F172A;background:#F8FAFC}h1{color:var(--accent);border-bottom:3px solid var(--accent);padding-bottom:12px}h2{color:var(--accent);margin-top:28px}h3{color:#0D9488}blockquote{border-left:4px solid var(--accent);background:#EEF2FF;padding:12px 16px;border-radius:8px}code{background:#0F172A;color:#E2E8F0;padding:2px 6px;border-radius:4px}pre{background:#0F172A;color:#E2E8F0;padding:16px;border-radius:12px;overflow:auto}table{width:100%;border-collapse:collapse;margin:16px 0}th{background:var(--accent);color:#fff;padding:10px;text-align:left}td{padding:10px;border:1px solid #E2E8F0}tr:nth-child(even) td{background:#F8FAFC}header{border-bottom:2px solid var(--accent);padding-bottom:16px;margin-bottom:24px}footer{text-align:center;color:#64748B;font-size:12px;margin-top:40px;border-top:1px solid #E2E8F0;padding-top:16px}</style></head><body><header><h1>"+escapeHtml(filename.replace(/\.[^.]+$/,"").replace(/[_-]+/g," "))+"</h1><p style=\"color:#64748B\">Generated by Anteemonee • "+new Date().toLocaleDateString()+"</p></header><article>"+renderMarkdown(content).replace(/<p><\/p>/g,"")+"</article><footer>Generated by Anteemonee • AI Study Tutor</footer></body></html>";
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
        var htmlDoc2 = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Preview</title><style>body{font-family:Inter,sans-serif;max-width:800px;margin:40px auto;padding:24px;color:#0F172A}h1{color:var(--accent)}h2{color:var(--accent)}h3{color:#0D9488}</style></head><body>"+renderMarkdown(f.content)+"</body></html>";
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
    var graphData = null;
    try { graphData = parseGraphBlock(text); } catch (_) {}
    // If the model forgot the fence but the student clearly asked for a graph
    // with numbers, build the chart from their own data so a card still shows.
    if (!graphData && div.__graphRequested) {
      try { graphData = synthesizeGraphFromPrompt(div.__graphPromptCt || ''); } catch (_) {}
    }
    if (!graphData && div.__graphRequested) {
      try { graphData = extractGraphFromProse(text); } catch (_) {}
    }
    if (!graphData && div.__graphRequested) {
      try { graphData = extractGraphFromSegments(text); } catch (_) {}
    }
    if (!graphData && div.__graphRequested) {
      try { graphData = randomDemoGraph(text); } catch (_) {}
    }
    var displayText = stripEmptyReferences(stripFileBlocks(stripRedoxComponent(stripQuizBlock(stripSwitchMarkers(text), !!div.__quizRequested))));
    displayText = stripGraphBlock(displayText);
    // A graph card is showing: collapse the bubble to one tiny caption line
    // (or nothing). Full explanation remains in the stored message content.
    if (graphData && !quiz) displayText = shortGraphCaption(graphData);
    content.innerHTML = displayText ? renderMarkdown(displayText) : '';
    content.classList.toggle('is-empty', !displayText);
    try {
      if (typeof GitHub !== 'undefined' && getActivePersona().codingOnly) GitHub.handleAssistantMessage(div, text);
    } catch (_) {}
    try { handleFileBlocks(div, text); } catch (_) {}
    destroyGraphsIn(div);
    if (graphData) {
      try { renderGraphCard(div, graphData); } catch (_) {}
    }
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
    try { message.content = stripGraphBlock(message.content); } catch (_) {}
    // Record which engine produced this reply (tunnel model id, or the
    // Groq → Qwen → Mistral chain after a fallback) so the UI can show it honestly.
    try {
      message.engine = (typeof api !== 'undefined' && api && api.lastServed)
        ? { engine: api.lastServed.engine || null, provider: api.lastServed.provider || null, model: api.lastServed.model || null }
        : null;
    } catch (_) { message.engine = null; }
    try {
      var graphData = parseGraphBlock(text);
      if (!graphData && div && div.__graphRequested) graphData = synthesizeGraphFromPrompt(div.__graphPromptCt || '');
      if (!graphData && div && div.__graphRequested) graphData = extractGraphFromProse(text);
      if (!graphData && div && div.__graphRequested) graphData = extractGraphFromSegments(text);
      if (!graphData && div && div.__graphRequested) graphData = randomDemoGraph(text);
      if (graphData) message.graph = graphData;
    } catch (_) {}
    if (quiz) {
      try { message.quiz = normalizeQuizData(quiz) || quiz; } catch (_) { message.quiz = quiz; }
      if (div) div.__quiz = message.quiz;
    }
    return message;
  }

  // â”€â”€ Text Selection: Reply + Flashcard â”€â”€
  let pendingQuote = null; // { role: 'assistant'|'user', text }
  let pendingTestRef = null; // test attached via the /-menu
  // Edit-and-resend. `backup` keeps the discarded tail so Cancel can undo.
  let pendingEdit = null; // { idx, text, backup, hadImages }
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
        t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:9999;max-width:calc(100vw - 32px);text-align:center;padding:12px 22px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--text);background:var(--liquid-bg-strong);border:1px solid var(--liquid-border);box-shadow:0 10px 34px rgba(0,0,0,0.35);opacity:0;pointer-events:none;transition:opacity 0.25s ease;';
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
          window.location.href = '/flashcards/?edit=' + encodeURIComponent(ins.data.id);
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
      window.location.href = '/flashcards/?edit=' + encodeURIComponent(ins.data.id);
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

  // ── Slash commands: type "/" in an empty composer to attach a built test ──
  let slashOpen = false;

  function handleSlashTrigger() {
    if (chatInput && chatInput.value === '/') openSlashMenu('commands');
    else closeSlashMenu();
  }

  function openSlashMenu(view) {
    const m = document.getElementById('slash-menu');
    if (!m) return;
    slashOpen = true;
    m.style.display = 'flex';
    const title = document.getElementById('slash-menu-title');
    if (title) title.textContent = view === 'tests' ? 'Your built tests' : 'Slash commands';
    const body = document.getElementById('slash-menu-body');
    if (!body) return;
    if (view === 'tests') {
      showSlashLoading('Loading your tests…');
      loadTestsIntoSlash(body);
    } else {
      renderSlashCommands(body);
    }
  }

  function closeSlashMenu() {
    slashOpen = false;
    const m = document.getElementById('slash-menu');
    if (m) m.style.display = 'none';
  }

  function showSlashLoading(msg) {
    const body = document.getElementById('slash-menu-body');
    if (body) body.innerHTML = '<div class="slash-loading">' + escapeHtml(msg || 'Loading…') + '</div>';
  }

  function renderSlashCommands(body) {
    body.innerHTML = '';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'slash-item';
    item.innerHTML = '<span class="slash-item-ic">\u{1F4C4}</span><span><b>Tests</b><small>Attach a test you built in the Test Builder</small></span>';
    item.addEventListener('click', function () { openSlashMenu('tests'); });
    body.appendChild(item);
  }

  async function loadTestsIntoSlash(body) {
    if (!getAccessToken()) {
      body.innerHTML = '<div class="slash-empty">Sign in to load your built tests.</div>';
      return;
    }
    const tests = await fetchMyTests();
    body.innerHTML = '';
    if (!tests.length) {
      body.innerHTML =
        '<div class="slash-empty">No tests here yet.<br>' +
        '<a class="slash-empty-cta" href="../ai-test-builder/" target="_blank" rel="noopener">Open the AI Test Builder</a></div>';
      return;
    }
    tests.forEach(function (t) {
      const title = (t.config && t.config.paper_title) || t.title || 'Test';
      const sub = [t.subject, t.board_name].filter(Boolean).join(' \u00b7 ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slash-test-item';
      btn.innerHTML =
        '<span class="slash-test-star">' + (t.priority ? '\u2605' : '') + '</span>' +
        '<span class="slash-test-t">' + escapeHtml(title) + '</span>' +
        '<span class="slash-test-sub">' + escapeHtml(sub) + '</span>';
      btn.addEventListener('click', function () { selectTestForChat(t); });
      body.appendChild(btn);
    });
  }

  async function fetchMyTests() {
    try {
      const token = getAccessToken();
      if (!token) return [];
      const base = (typeof api !== 'undefined' && api && api.supabaseUrl) || 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
      const ctrl = new AbortController();
      const timeout = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 12000);
      const res = await fetch(base + '/functions/v1/ai-test-builder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ action: 'list' }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return fallbackFetchMyTests();
      const data = await res.json();
      if (data && Array.isArray(data.tests)) return data.tests;
      return fallbackFetchMyTests();
    } catch (e) {
      console.warn('[Tests] list failed:', e && (e.message || e));
      return fallbackFetchMyTests();
    }
  }

  async function fallbackFetchMyTests() {
    try {
      const d = (typeof db !== 'undefined') ? db : null;
      if (!d) return [];
      const res = await d.from('ai_test_history')
        .select('id,title,subject,board_name,pdf_url,pdf_path,priority,config,created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      return (res && Array.isArray(res.data)) ? res.data : [];
    } catch (e) {
      console.warn('[Tests] fallback list failed:', e && (e.message || e));
      return [];
    }
  }

  function selectTestForChat(t) {
    pendingTestRef = {
      id: String((t && t.id) || ''),
      title: ((t && t.config && t.config.paper_title) || (t && t.title) || 'Test'),
      subject: (t && t.subject) || 'Subject',
      pdfUrl: (t && t.pdf_url) || null,
      pdfPath: (t && t.pdf_path) || null,
      chapters: (t && t.config && Array.isArray(t.config.chapters)) ? t.config.chapters : [],
    };
    closeSlashMenu();
    chatInput.value = '';
    autoResize();
    renderTestChip();
    refreshSendState();
    chatInput.focus();
  }

  function renderTestChip() {
    let chip = document.getElementById('test-chip');
    if (!pendingTestRef) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'test-chip';
      chip.className = 'test-chip';
      chip.innerHTML =
        '<span class="test-chip-ic">\u{1F4C4}</span>' +
        '<div class="test-chip-body"><div class="test-chip-label">Attached test</div><div class="test-chip-text"></div></div>' +
        '<button class="test-chip-cancel" type="button" aria-label="Remove test">\u00d7</button>';
      const area = document.querySelector('.chat-input-area');
      const wrapper = document.querySelector('.chat-input-wrapper');
      if (area && wrapper) area.insertBefore(chip, wrapper);
      chip.querySelector('.test-chip-cancel').addEventListener('click', function (e) {
        e.stopPropagation();
        pendingTestRef = null;
        renderTestChip();
        refreshSendState();
        chatInput.focus();
      });
    }
    chip.querySelector('.test-chip-text').textContent = pendingTestRef.title;
  }

  function refreshSendState() {
    try {
      btnSend.disabled = chatInput.disabled || (!chatInput.value.trim() && pendingImages.length === 0 && !pendingTestRef);
    } catch (_) {}
  }

  function refreshSendStateFromText() {
    autoResize();
    btnSend.disabled = !chatInput.value.trim() && pendingImages.length === 0 && !pendingTestRef;
  }

  // Guard: "not a good prompt" when a test is attached but the question is
  // missing or basically empty. The model should ask what the student wants.
  function testAttachmentNeedsPromptNotice(text, testRef) {
    if (!testRef) return '';
    if (String(text || '').trim().length >= 6) return '';
    return ' The student attached a practice test they built, but has not yet asked anything specific about it. ' +
      'Ask, in one short paragraph ending with a question, what they would like to do with the test \u2014 e.g. ' +
      'get the answers from the book, check or explain specific questions, discuss the topic, or mark their answers ' +
      'against the marking scheme. Do not answer for them until they say what they want.';
  }

  // Keep attached tests "in memory": re-supply the most recent ones' text on
  // every subsequent turn so the model never loses access to them.
  function buildAttachedTestContext() {
    const seen = {};
    const blocks = [];
    for (let i = Math.max(0, messages.length - 40); i < messages.length - 1; i++) {
      const ref = messages[i] && messages[i].testRef;
      if (!ref || !ref.id || seen[ref.id]) continue;
      seen[ref.id] = 1;
      if (blocks.length >= 2) break;
      const chLine = (Array.isArray(ref.chapters) && ref.chapters.length)
        ? ref.chapters.map(function (c) { return ('Ch. ' + (c && c.number != null ? c.number : '') + ' ' + ((c && c.name) || '')).trim(); }).join(', ')
        : '';
      const text = ref.pdfText || '';
      blocks.push(
        'Previously attached to this chat — test "' + (ref.title || 'Test') +
        '" (subject: ' + (ref.subject || 'Subject') + (chLine ? ', chapters: ' + chLine : '') + '). ' +
        (text
          ? 'The student may ask anything about it — answers, explanations, discussion, marking. Test content:\n[START OF TEST]\n' + text + '\n[END OF TEST]'
          : '[No stored test text for this attachment. Ask what they need.]')
      );
    }
    return blocks.length ? '\n\n' + blocks.join('\n\n') : '';
  }

  async function extractPdfText(url) {
    try {
      if (!url || !window.pdfjsLib) return '';
      const pdf = await window.pdfjsLib.getDocument({
        url: url,
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: true,
      }).promise;
      const maxPages = Math.min(pdf.numPages, 6);
      const parts = [];
      for (let i = 1; i <= maxPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          parts.push((tc.items || []).map(function (it) { return it.str || ''; }).join(' '));
          try { await page.cleanup(); } catch (_) {}
        } catch (_) {}
      }
      try { await pdf.destroy(); } catch (_) {}
      const text = parts.join('\n').replace(/[ \t]+/g, ' ').trim();
      return text.slice(0, 16000);
    } catch (e) {
      console.warn('[Tests] pdf extract failed:', e && (e.message || e));
      return '';
    }
  }

  function testChipHtml(ref) {
    if (!ref || !ref.title) return '';
    return '<div class="msg-test-chip">\u{1F4C4} <span>' + escapeHtml(ref.title) + '</span></div>';
  }

  function wireSlashMenu() {
    document.addEventListener('click', function (e) {
      if (!slashOpen) return;
      // Ignore clicks on nodes that were just removed by re-rendering the menu
      // (e.g. clicking "Tests"), otherwise the popup closes itself instantly.
      if (!e.target || !e.target.isConnected) return;
      if (e.target.closest && e.target.closest('#slash-menu')) return;
      closeSlashMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && slashOpen) closeSlashMenu();
    });
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
    if (authed) return true;
    // model selector hidden permanently — auto routing handles models
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

  // ── Text -> image: Qwen/Mistral, 4/day cap (400/day with own key) ──

  // Shared "limit reached" renderer: beautiful card + live renewal countdown.
  function renderImageLimitCard(streamDiv, error, prompt) {
    var used = (error && typeof error.used === 'number') ? error.used : 4;
    var limit = (error && typeof error.limit === 'number') ? error.limit : 4;
    var resetsAt = (error && (error.resetsAt || error.resets_at)) || null;
    var content = null;
    try { content = streamDiv && streamDiv.querySelector('.msg-content'); } catch (_) {}
    var retry = null;
    if (prompt && typeof regenerateImage === 'function') {
      retry = function () { try { regenerateImage(prompt); } catch (e) { console.warn('[ImageGen] retry failed', e); } };
    }
    if (window.ImageLimitCard && content) {
      try {
        window.ImageLimitCard.show(content, { used: used, limit: limit, resetsAt: resetsAt, onRetry: retry });
        return;
      } catch (e) { console.warn('[ImageGen] limit card failed', e); }
    }
    finalizeStreamingMessage(streamDiv, "You've used all " + limit + ' images for today. Your limit renews at midnight UTC.');
  }

  function isImageLimitError(error, msg) {
    return !!(error && (error.code === 'IMAGE_GEN_LIMIT' || /IMAGE_GEN_LIMIT/.test(String(msg || ''))));
  }

  // Retry a failed generation (used by the limit card once a key is added).
  async function regenerateImage(prompt) {
    if (isStreaming || !prompt) return;
    isStreaming = true;
    btnSend.style.display = 'none';
    btnStop.style.display = 'flex';
    btnSend.disabled = true;
    chatInput.disabled = true;
    var streamDiv = createStreamingMessage(null);
    try {
      var target = streamDiv.querySelector('.msg-content');
      if (target) {
        target.innerHTML =
          '<div class="msg-image-loading">' +
            '<div class="msg-image-loading-shine"></div>' +
            '<span class="msg-image-loading-text">Creating image' +
              '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>' +
            '</span>' +
          '</div>';
      }
    } catch (_) {}
    scrollToBottom();

    api.setAccessToken(getAccessToken());
    try {
      const result = await api.generateImage(prompt);
      try { streamDiv.remove(); } catch (_) {}
      var div = appendMessage('assistant', '', true, { idx: messages.length, generatedImage: result.image });
      messages.push({ role: 'assistant', content: '', generatedImage: result.image });
      attachFeedbackButtons(div);
      bumpCounters(['total_messages', 'ai_messages']);
    } catch (error) {
      var msg = String((error && error.message) || 'Image generation failed');
      try { console.warn('[ImageGen] retry failed:', msg); } catch (_) {}
      if (isImageLimitError(error, msg)) {
        renderImageLimitCard(streamDiv, error, prompt);
      } else if (error && (error.code === 'session_expired' || /\b(401|403)\b/.test(msg))) {
        finalizeStreamingMessage(streamDiv, 'Your session expired. Please sign in again to generate images.');
        try { refreshAuthGate(); } catch (_) {}
      } else {
        finalizeStreamingMessage(streamDiv, "Anteemonee can't generate an image for this prompt. Try another one.");
      }
    }
    isStreaming = false;
    btnStop.style.display = 'none';
    btnSend.style.display = 'flex';
    btnSend.disabled = true;
    chatInput.disabled = false;
    chatInput.focus();
    saveConversation();
    scrollToBottom();
  }

  async function handleImageGeneration(text) {
    const prompt = extractImagePrompt(text);
    if (prompt.length < 3) {
      try { showChatToast('Describe the image in a few words'); } catch (_) {}
      isStreaming = false;
      chatInput.disabled = false;
      btnSend.disabled = false;
      chatInput.focus();
      return;
    }
    chatInput.value = '';
    autoResize();
    btnSend.disabled = true;
    chatInput.disabled = true;
    clearPendingImages();
    if (welcome.style.display !== 'none') {
      welcome.style.display = 'none';
      messagesList.style.display = 'flex';
      syncWelcomeMode();
    }
    appendMessage('user', text || '', true, { idx: messages.length });
    messages.push({ role: 'user', content: text });
    bumpCounters(['total_messages', 'user_messages']);
    hideAllFeedbackButtons();
    pendingQuote = null;
    renderQuoteChip();
    scrollToBottom();

    if (scrollDownBtn) {
      scrollDownBtn.classList.add('generating');
      if (!userNearBottom) scrollDownBtn.classList.add('show');
    }
    btnSend.style.display = 'none';
    btnStop.style.display = 'flex';

    const streamDiv = createStreamingMessage(null);
    var statusCycle = null;
    try {
      var imageLoadingTarget = streamDiv.querySelector('.msg-content');
      if (imageLoadingTarget) {
        imageLoadingTarget.innerHTML =
          '<div class="msg-image-loading">' +
            '<div class="msg-image-loading-shine"></div>' +
            '<span class="msg-image-loading-text">Creating image' +
              '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>' +
            '</span>' +
          '</div>';
      }
    } catch (_) {}
    scrollToBottom();

    api.setAccessToken(getAccessToken());
    try {
      const result = await api.generateImage(prompt);
      stopStatusCycle(statusCycle);
      try { streamDiv.remove(); } catch (_) {}
      var div = appendMessage('assistant', '', true, { idx: messages.length, generatedImage: result.image });
      var assistantMessage = { role: 'assistant', content: '', generatedImage: result.image };
      messages.push(assistantMessage);
      attachFeedbackButtons(div);
      bumpCounters(['total_messages', 'ai_messages']);
    } catch (error) {
      stopStatusCycle(statusCycle);
      var msg = String((error && error.message) || 'Image generation failed');
      try { console.warn('[ImageGen] failed:', msg, (error && error.detail) || ''); } catch (_) {}
      if (isImageLimitError(error, msg)) {
        renderImageLimitCard(streamDiv, error, prompt);
        messages.pop();
      } else if (error && (error.code === 'session_expired' || /\b(401|403)\b/.test(msg))) {
        finalizeStreamingMessage(streamDiv, 'Your session expired. Please sign in again to generate images.');
        messages.pop();
        try { refreshAuthGate(); } catch (_) {}
      } else {
        finalizeStreamingMessage(streamDiv, "Anteemonee can't generate an image for this prompt. Try another one.");
        messages.pop();
      }
    }
    isStreaming = false;
    stopStatusCycle(statusCycle);
    if (scrollDownBtn) {
      scrollDownBtn.classList.remove('generating');
      scrollDownBtn.classList.remove('show');
    }
    btnStop.style.display = 'none';
    btnSend.style.display = 'flex';
    btnSend.disabled = true;
    chatInput.disabled = false;
    chatInput.focus();
    saveConversation();
    scrollToBottom();
  }

  async function handleSend() {
    const text = chatInput.value.trim();
    const hasImages = pendingImages.length > 0;
    const testRef = pendingTestRef;
    const quizRequested = !hasImages && shouldCreateQuiz(text);
    const graphRequested = !hasImages && isGraphRequest(text);
    if (!hasImages && isQuizRequest(text) && !hasQuizTopic(text)) pendingQuizTopic = true;
    if ((!text && !hasImages && !testRef) || isStreaming) return;
    if (!isAuthed()) { refreshAuthGate(); return; }
    // Free students keep chatting until today's allowance is spent. The gateway
    // is the real gate — this only avoids a pointless round trip.
    try { if (typeof Access !== 'undefined' && Access.state.ready && Access.isOverQuota && Access.isOverQuota('chat')) { refreshAuthGate(); return; } } catch (_) {}

    // Lock immediately — prevent double-send during any async gap
    isStreaming = true;
    // Tracks whether an answer actually landed, so the memory scan below never
    // runs off the back of a failed or stopped turn.
    let assistantReplied = false;
    chatInput.disabled = true;
    btnSend.disabled = true;
    // Text -> image bypasses the text chat pipeline entirely.
    if (!hasImages && isImageGenRequest(text)) {
      try { if (typeof GitHub !== 'undefined') GitHub.disconnectRepo(); } catch (_) {}
      await handleImageGeneration(text);
      return;
    }
    const quote = pendingQuote;
    const imagesToSend = [...pendingImages]; // snapshot before clearing
    if (pendingTestRef) { pendingTestRef = null; renderTestChip(); }
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
      syncWelcomeMode();
    }

    commitEditMessage();
    appendMessage('user', text || '', true, { idx: messages.length, quote: quote || null, images: hasImages ? imagesToSend : null, test: testRef || null });
    messages.push(quote
      ? { role: 'user', content: text, quote, images: hasImages ? imagesToSend : null, testRef: testRef || null }
      : { role: 'user', content: text, images: hasImages ? imagesToSend : null, testRef: testRef || null });
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
    streamDiv.__graphRequested = graphRequested;
    streamDiv.__graphPromptCt = text;
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
    var lightRag = !isCodingAgent && !isGreetingMsg && !isGenerationTask &&
      text.length < 150 && /^(what is|what are|what was|define|name|list|which|who|when|where|how many)\b/i.test(text.trim());
    TEXTBOOK_MAX_PAGES = lightRag ? 2 : 5;
    TEXTBOOK_PAGE_CHARS = lightRag ? 1200 : 1800;
    const textbookPromise = (isCodingAgent || isGreetingMsg || isGenerationTask)
      ? Promise.resolve([])
      : searchTextbooks(text).catch(function (err) {
          console.warn('[AI] Textbook search failed:', err);
          return [];
        });
    const chapterListPromise = (isCodingAgent || isGreetingMsg || isGenerationTask)
      ? Promise.resolve('')
      : fetchChapterListContext(text).catch(function () { return ''; });
    const pagePromise = (isCodingAgent || isGreetingMsg || isGenerationTask)
      ? Promise.resolve('')
      : fetchTextbookPageContext(text).catch(function () { return ''; });
    const memoriesPromise = loadAiMemories().catch(function () {});
    const textbookPages = await textbookPromise;
    const chapterListBlock = await chapterListPromise;
    const pageBlock = await pagePromise;
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
      if (chapterListBlock) {
        console.log('[AI] Chapter-list context attached');
        textbookContext = chapterListBlock + textbookContext;
      }
      if (pageBlock) {
        console.log('[AI] Exact-page context attached');
        textbookContext = pageBlock + textbookContext;
      }
    } catch (e) {
      console.warn('[AI] Textbook search failed:', e);
    }

    // Fresh memory reload â€” picks up extractions from OTHER chats too.
    // Greetings get a tiny prompt: no system brick, no RAG, no history.
    const systemPrompt = isGreetingMsg
      ? ('You are a friendly study companion. The user just greeted you. Reply with a brief warm greeting (one or two short sentences max) and offer help. No references section.')
      : buildSystemPrompt() + textbookContext + (graphRequested ? graphProtocolPrompt() : '') + (quizRequested ? quizProtocolPrompt() : '') + recentQuizContextPrompt();

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
    // Asked us to read something but never attached it. Say so plainly and ask
    // for the photo, rather than answering blind or claiming to have seen it.
    if (!hasImages && asksToScanWithoutImage(text)) {
      visionContext =
        'The student asked you to read, scan or answer something from a photo, diagram or page, ' +
        'but no image came through. You cannot see anything yet. Reply in one or two short ' +
        'sentences: say you need them to attach or send the photo, and that you will read it and ' +
        'answer straight away once they do. Do not answer the question speculatively, do not say ' +
        'you cannot see images, and do not pretend you already looked.';
    }
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

    // ── Test attachment context: pull the PDF text so the AI can discuss it ──
    let testContext = '';
    if (testRef) {
      try { updateStreamingStatus(streamDiv, 'Reading your test…', 'analyzing'); } catch (_) {}
      let pdfText = '';
      if (testRef.pdfUrl) pdfText = await extractPdfText(testRef.pdfUrl);
      // Persist the text on the message so follow-up turns keep "memory" of it.
      testRef.pdfText = pdfText;
      const chLine = (Array.isArray(testRef.chapters) && testRef.chapters.length)
        ? testRef.chapters.map(function (c) { return ('Ch. ' + (c && c.number != null ? c.number : '') + ' ' + ((c && c.name) || '')).trim(); }).join(', ')
        : '';
      testContext =
        'The student attached one of their AI-built practice tests as reference material. ' +
        'Test title: ' + (testRef.title || 'Practice Test') + '. ' +
        'Subject: ' + (testRef.subject || 'Subject') + (chLine ? '. Chapter(s): ' + chLine + '.' : '') + '\n\n' +
        (pdfText
          ? 'Here is the full text of that test:\n[START OF TEST]\n' + pdfText + '\n[END OF TEST]'
          : '[The test PDF could not be read from this browser; only its title and subject are available. Ask what they want or answer from the title/subject if that is enough.]');
      const notice = testAttachmentNeedsPromptNotice(text, testRef);
      if (notice) testContext += '\n\n' + notice;
    }

    const promptBase = imageAwarePrompt + (testContext ? '\n\n' + testContext : '') + buildAttachedTestContext();
    const userContent = text || (testRef
      ? 'The student attached a practice test (details are in the system instructions above) but has not typed anything yet.'
      : '');

    const historyMessages = messages.slice(-6).map(m => ({
      role: m.role,
      content: (m.quote
        ? `[Replying to ${m.quote.role === 'assistant' ? 'AI' : 'you'}: "${m.quote.text}"]\n${m.content}`
        : m.content) + (m.quiz ? '\n[Interactive quiz context: ' + quizForModel(m.quiz) + ']' : ''),
    }));
    const lastUser = historyMessages[historyMessages.length - 1];
    if (testRef && lastUser && lastUser.role === 'user' && !lastUser.content) {
      lastUser.content = userContent;
    }

    const apiMessages = isGreetingMsg
      ? [{ role: 'system', content: promptBase }, { role: 'user', content: userContent }]
      : [{ role: 'system', content: promptBase }, ...historyMessages];
    // Snapshot what this request actually bills (system + textbook + history).
    lastPromptTokens = estimatePromptTokens(apiMessages);
    lastApiMessages = apiMessages;

    let fullResponse = '';
    let firstChunk = true;
    // Redox remaps which provider answers first; Beta uses the persona default.
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
          // Name the live engine while the reply streams — the fastest way to
          // see whether Astra answered or the request fell back.
          var servingEngine = getServingEngineLabel();
          updateStreamingStatus(streamDiv, servingEngine ? servingEngine + ' is generating\u2026' : 'Generating response...', 'analyzing');
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
      if (error && error.code === 'FREE_DAILY_LIMIT') {
        // Today's 15 messages are spent. The gateway spent them before
        // generating a single token, so nothing was wasted, and it told us
        // when the day rolls over. Lock the input and offer the upgrade.
        try {
          finalizeStreamingMessage(streamDiv, error.message || 'Daily free limit reached.');
          if (typeof Access !== 'undefined') await Access.refreshQuota();
        } catch (_) {}
        try { refreshAuthGate(); } catch (_) {}
        return;
      }
      if (error && error.code === 'session_expired') {
        // The gateway meters per user_id, so a signed-out student is refused.
        // Point them at sign-in rather than failing over to a chain that
        // would refuse them the same way.
        try { finalizeStreamingMessage(streamDiv, 'Please sign in to use the AI tutor.'); } catch (_) {}
        try { refreshAuthGate(); } catch (_) {}
        return;
      }
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
      // ── IMAGE_LIMIT: attached-image reading cap (unchanged behaviour) ──
      if (error.message && error.message.includes('IMAGE_LIMIT') && !error.message.includes('IMAGE_GEN_LIMIT')) {
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
      // ── IMAGE_GEN_LIMIT: generated-image cap (4/day, 400 with own key) ──
      if (error.message && error.message.includes('IMAGE_GEN_LIMIT')) {
        console.warn('[AI] Generated-image limit reached');
        renderImageLimitCard(streamDiv, error, null);
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
        assistantReplied = true;
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
        // Nothing usable was streamed, so this bubble is an error notice: drop
        // the engine tag so the error text is never attributed to a model.
        try { if (typeof api !== 'undefined' && api) api.lastServed = null; } catch (_) {}
        // An expired session is recoverable and needs a specific instruction,
        // not a status code the student cannot act on.
        //
        // Only trust the explicit `session_expired` code, which the API service
        // sets solely when the gateway itself rejects our token. A loose match
        // on "401"/"403" anywhere in the message used to mislabel every
        // upstream tunnel failure as a login problem — the gateway forwards the
        // tunnel's own 401/403 text, so a bad Flagship key told the student to
        // sign in again when their session was perfectly fine.
        const expired = error && error.code === 'session_expired';
        const errText = expired
          ? 'Your session expired. Please sign in again to keep chatting \u2014 your chats are saved.'
          : `Sorry, something went wrong. ${error.message}`;
        finalizeStreamingMessage(streamDiv, errText);
        const errorMessage = createAssistantMessage(errText, streamDiv);
        messages.push(errorMessage);
        if (errorMessage.quiz) pendingQuizTopic = false;
        updateTokensAfterResponse(text, errText);
        if (expired) {
          try { showChatToast('Session expired \u2014 please sign in again'); } catch (_) {}
          try { refreshAuthGate(); } catch (_) {}
        }
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

    // Background memory extraction, every few turns and only after a real reply:
    // deliberately not awaited, so remembering something never delays the chat.
    if (assistantReplied && aiPrefs.memoryEnabled) {
      turnsSinceMemoryScan++;
      if (turnsSinceMemoryScan >= MEMORY_SCAN_EVERY_TURNS) {
        turnsSinceMemoryScan = 0;
        extractMemoriesFromChat();
      }
    }

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
          messages.forEach((m, i) => appendMessage(m.role, m.content, false, { idx: i, quote: m.quote || null, images: m.images || null, test: m.testRef || null, quiz: m.quiz || null, generatedImage: m.generatedImage || null }));
        }
        syncWelcomeMode();
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
