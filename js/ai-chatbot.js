/* ==========================================
   Wassal AI Chatbot - Full Implementation
   ========================================== */

(function () {
  'use strict';

  // ── State ──
  const api = new AiApiService();
  let conversations = [];
  let activeConversationId = null;
  let messages = [];
  let isStreaming = false;
  let studentContext = null;
  const pendingImages = []; // Array of base64 data URLs, max 3
  let thinkMode = false;
  let researchMode = false;

  // ── Per-user localStorage keys ──
  function chatStorageKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'wassal_ai_conversations_' + currentUser.id;
    return 'wassal_ai_conversations_anon';
  }
  function personaStorageKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'wassal_ai_persona_' + currentUser.id;
    return 'wassal_ai_persona_anon';
  }
  function sessionStateKey() {
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'wassal_ai_session_' + currentUser.id;
    return 'wassal_ai_session_anon';
  }

  // ── Persist session state to localStorage (no tokens — always from DB) ──
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

  // ── AI Session State ──
  const TOKEN_LIMIT = 100000;
  let activeSession = null; // { id, started_at, expires_at, messages_count, tokens_used }
  let sessionUsage = null;  // { ai_limit, ai_used, period_end }
  let sessionTimerInterval = null;
  let estimatedTokensUsed = 0; // client-side running estimate

  // ── Streak State ──
  let streakCount = 0;
  let longestStreak = 0;

  // ── Study Timer State ──
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

  // ── Model / Persona State ──
  const PERSONAS = [
    {
      name: 'Shehbaz Sharif', providerIndex: 0,
      background: 'Your name comes from Shehbaz Sharif, the Pakistani politician: president of PML-N, Prime Minister of Pakistan, and former Chief Minister of Punjab (known for infrastructure projects like metro bus systems and a hands-on administrative style). If a student asks about him, answer factually and neutrally using these facts plus your general knowledge. Keep it brief and offer to return to studies.',
    },
    {
      name: 'Imran Khan', providerIndex: 1,
      background: 'Your name comes from Imran Khan, the Pakistani politician and former cricketer: founder and chairman of PTI, Prime Minister of Pakistan (2018 to 2022), captain of the 1992 Cricket World Cup winning team, and founder of Shaukat Khanum Memorial Cancer Hospital. If a student asks about him, answer factually and neutrally using these facts plus your general knowledge. Keep it brief and offer to return to studies.',
    },
    {
      name: 'Zardari', providerIndex: 2,
      background: 'Your name comes from Asif Ali Zardari, the President of Pakistan and co-chairman of the Pakistan Peoples Party (PPP), husband of Benazir Bhutto. He served as President from 2008 to 2013. If a student asks about him, answer factually and neutrally.',
      codingOnly: true,
    },
  ];
  let activePersonaIndex = 0;

  // ── DOM ──
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
  const modelDropdown = document.getElementById('model-dropdown');
  const modelTrigger = document.getElementById('model-selector-trigger');
  const scrollDownBtn = document.getElementById('scroll-down-btn');
  const imagePreviewBar = document.getElementById('image-preview-bar');
  const btnAttach = document.getElementById('btn-attach');
  const btnModes = document.getElementById('btn-modes');
  const modesLabel = document.getElementById('modes-label');
  const modesWrapper = document.getElementById('modes-select-wrapper');
  const modesDropdown = document.getElementById('modes-dropdown');
  // True when the user is reading near the newest message. Streaming only
  // auto-scrolls in that case, so it never yanks the user away mid-read.
  let userNearBottom = true;

  // ── AI Preferences (from Settings → AI Preferences, stored in user_preferences) ──
  let aiPrefs = {
    responseStyle: 'balanced',
    explanationLevel: 'standard',
    language: 'mixed',
    studySuggestions: true,
    memoryEnabled: true,
    personalization: '',
  };

  // ── AI Memory (durable facts remembered from past chats) ──
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
        }
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

  // ── Init ──
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
    if (typeof ensureProfile === 'function') {
      await ensureProfile();
    }
    // Load conversations from localStorage (per-user)
    try {
      const raw = localStorage.getItem(chatStorageKey());
      conversations = JSON.parse(raw || '[]');
      if (!Array.isArray(conversations)) conversations = [];
      conversations.forEach(c => {
        if (c.title && /\{/.test(c.title)) {
          c.title = c.title.replace(/\{.*$/g, '').trim() || 'New Chat';
        }
      });
    } catch (_) { conversations = []; }
    // Legacy migration: move old sessionStorage data to new per-user localStorage
    try {
      const legacy = sessionStorage.getItem('wassal_ai_conversations');
      if (legacy) {
        const legacyArr = JSON.parse(legacy);
        if (Array.isArray(legacyArr) && legacyArr.length > 0 && conversations.length === 0) {
          conversations = legacyArr;
          localStorage.setItem(chatStorageKey(), JSON.stringify(conversations));
        }
        sessionStorage.removeItem('wassal_ai_conversations');
      }
    } catch (_) {}
    // Load persona from localStorage (per-user)
    try {
      activePersonaIndex = parseInt(localStorage.getItem(personaStorageKey()) || '0', 10);
      if (activePersonaIndex < 0 || activePersonaIndex >= PERSONAS.length) activePersonaIndex = 0;
    } catch (_) { activePersonaIndex = 0; }
    // Legacy migration: move old sessionStorage persona
    try {
      const legacyPersona = sessionStorage.getItem('wassal_ai_persona');
      if (legacyPersona !== null) {
        const idx = parseInt(legacyPersona, 10);
        if (idx >= 0 && idx < PERSONAS.length) {
          activePersonaIndex = idx;
          localStorage.setItem(personaStorageKey(), String(idx));
        }
        sessionStorage.removeItem('wassal_ai_persona');
      }
    } catch (_) {}
    await loadStudentContext();
    await loadAiPrefs();
    await loadAiMemories();

    // ── 1. Load from localStorage FIRST (instant, no flicker) ──
    const cached = loadSessionState();
    if (cached) {
      activeSession = cached.activeSession;
      sessionUsage = cached.sessionUsage;
      streakCount = cached.streakCount || 0;
      longestStreak = cached.longestStreak || 0;
      // Tokens always come from DB — not cached in localStorage
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

    // ── 2. Sync with DB in background (only if no cached data or cache is stale) ──
    const token = getAccessToken();
    if (!token) {
      if (!cached) showSessionError('Log in to start using AI chat.');
    } else {
      // If cache had valid data, delay DB sync to avoid overwriting fresh state
      const delay = cached?.activeSession ? 3000 : 0;
      setTimeout(() => syncSessionFromDB(), delay);
    }

    try { renderHistory(); } catch (e) { console.warn('[AI] renderHistory failed:', e); }
    bindEvents();
    updatePersonaUI();
    chatInput.focus();
    // Periodic streak check (every 5 min)
    setInterval(() => { refreshStreak(); saveSessionState(); }, 5 * 60 * 1000);

    // ── Study timer: pause/resume on tab visibility ──
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
          const key = `wassal_study_time_pending_${userId}`;
          const prev = parseInt(localStorage.getItem(key) || '0', 10);
          localStorage.setItem(key, String(prev + studyTimerAccumulated));
          studyTimerAccumulated = 0;
        } catch (_) {}
      }
    });
    // Flush any pending study time from previous unload
    flushPendingStudyTime();
  }

  async function flushPendingStudyTime() {
    try {
      const userId = (typeof currentUser !== 'undefined' && currentUser?.id) ? currentUser.id : 'anon';
      const key = `wassal_study_time_pending_${userId}`;
      const pending = parseInt(localStorage.getItem(key) || '0', 10);
      if (pending > 0) {
        await db.rpc('add_study_time', { p_seconds: pending });
        localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  // ── Image helpers (IIFE-level so handleSend can access them) ──
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
    btnAttach.classList.toggle('has-images', pendingImages.length > 0);
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

    // ── Image attachment ──
    const imageFileInput = document.getElementById('image-file-input');

    btnAttach.addEventListener('click', () => {
      if (pendingImages.length >= 3) return;
      imageFileInput.click();
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

    // ── Image lightbox ──
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

    // Desktop model selector
    modelTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      modelDropdown.classList.toggle('active');
    });

    document.querySelectorAll('#model-dropdown .model-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.model, 10);
        activePersonaIndex = idx;
        localStorage.setItem(personaStorageKey(), String(idx));
        updatePersonaUI();
        modelDropdown.classList.remove('active');
      });
    });

    document.addEventListener('click', () => modelDropdown.classList.remove('active'));

    // Mobile model selector
    const mobileTrigger = document.getElementById('model-selector-trigger-mobile');
    const mobileDropdown = document.getElementById('model-dropdown-mobile');
    if (mobileTrigger && mobileDropdown) {
      mobileTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileDropdown.classList.toggle('active');
      });

      mobileDropdown.querySelectorAll('.model-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.model, 10);
          activePersonaIndex = idx;
          localStorage.setItem(personaStorageKey(), String(idx));
          updatePersonaUI();
          mobileDropdown.classList.remove('active');
        });
      });

      document.addEventListener('click', () => mobileDropdown.classList.remove('active'));
    }

    // ── Modes dropdown (Think / Research) ──
    btnModes.addEventListener('click', (e) => {
      e.stopPropagation();
      modesWrapper.classList.toggle('open');
    });

    modesDropdown.querySelectorAll('.modes-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = opt.dataset.mode;
        if (mode === 'think') {
          thinkMode = !thinkMode;
          if (thinkMode) researchMode = false;
        } else if (mode === 'research') {
          researchMode = !researchMode;
          if (researchMode) thinkMode = false;
        }
        updateModesUI();
        modesWrapper.classList.remove('open');
      });
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!modesWrapper.contains(e.target)) {
        modesWrapper.classList.remove('open');
      }
    });
  }

  // ── Modes UI (Think / Research dropdown) ──
  function updateModesUI() {
    const hasMode = thinkMode || researchMode;
    btnModes.classList.toggle('active', hasMode);

    if (thinkMode) {
      modesLabel.textContent = 'Think';
    } else if (researchMode) {
      modesLabel.textContent = 'Research';
    } else {
      modesLabel.textContent = '';
    }

    // Update active state on options
    modesDropdown.querySelectorAll('.modes-option').forEach(opt => {
      const isActive = (opt.dataset.mode === 'think' && thinkMode)
                    || (opt.dataset.mode === 'research' && researchMode);
      opt.classList.toggle('active', isActive);
    });
  }

  // ── Model / Persona ──
  function updatePersonaUI() {
    const persona = PERSONAS[activePersonaIndex];
    const dotColors = ['#3B82F6', '#F59E0B', '#1FA055'];
    modelSelectedName.textContent = persona.name + (persona.codingOnly ? ' (Coding Agent)' : '');
    modelDot.style.background = dotColors[persona.providerIndex] || '#3B82F6';
    document.querySelectorAll('#model-dropdown .model-option').forEach((el, i) => {
      el.classList.toggle('active', i === activePersonaIndex);
    });
    const mobileName = document.getElementById('model-selected-name-mobile');
    const mobileDot = document.getElementById('model-dot-mobile');
    if (mobileName) mobileName.textContent = persona.name + (persona.codingOnly ? ' (Coding Agent)' : '');
    if (mobileDot) mobileDot.style.background = dotColors[persona.providerIndex] || '#3B82F6';
    const mobileDropdown = document.getElementById('model-dropdown-mobile');
    if (mobileDropdown) {
      mobileDropdown.querySelectorAll('.model-option').forEach((el, i) => {
        el.classList.toggle('active', i === activePersonaIndex);
      });
    }
    // Update welcome subtitle based on active persona
    const subtitle = document.querySelector('.welcome-subtitle');
    if (subtitle) {
      subtitle.textContent = persona.codingOnly
        ? 'Ask me anything about coding, programming, or building projects.'
        : 'Ask me anything about your studies.';
    }
    // Update quick actions visibility
    document.querySelectorAll('.quick-btn').forEach(btn => {
      const isCoding = btn.dataset.prompt.toLowerCase().includes('python') || btn.dataset.prompt.toLowerCase().includes('code');
      if (persona.codingOnly) {
        btn.style.display = isCoding ? '' : 'none';
      } else {
        btn.style.display = isCoding ? 'none' : '';
      }
    });
  }

  function getActivePersona() {
    return PERSONAS[activePersonaIndex];
  }

  // ── Student Context ──
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

  // ── Textbook Search ──
  async function searchTextbooks(query) {
    if (!query || query.trim().length < 3) return [];

    // Build a smarter query: extract key terms from the user's question
    const searchQuery = query
      .replace(/\b(explain|what is|what are|define|tell me about|how does|how do|describe|give me|help me with)\b/gi, '')
      .trim()
      .slice(0, 200);

    if (searchQuery.length < 3) return [];

    try {
      const { data, error } = await db.rpc('search_textbook_pages', {
        p_query: searchQuery,
        p_book_id: null,
        p_limit: 3,
        p_class_level_id: studentContext?.classLevelId || null,
      });

      if (error) {
        console.warn('[AI] Textbook RPC error:', error.message);
        // Fallback: try without class_level_id if column doesn't exist
        if (error.message?.includes('p_class_level_id') || error.message?.includes('does not exist')) {
          const { data: retryData } = await db.rpc('search_textbook_pages', {
            p_query: searchQuery,
            p_book_id: null,
            p_limit: 3,
          });
          return retryData || [];
        }
        return [];
      }
      if (!data || data.length === 0) return [];
      return data;
    } catch (e) {
      console.warn('[AI] Textbook search failed:', e);
      return [];
    }
  }

  function formatTextbookContext(pages) {
    if (!pages || pages.length === 0) return '';

    const sections = pages.slice(0, 2).map(p => {
      const title = p.book_title || 'Unknown Book';
      const page = p.printed_page_number || p.page_number;
      const chapter = p.chapter_name ? `, Chapter: ${p.chapter_name}` : '';
      const topic = p.topic_name ? `, Topic: ${p.topic_name}` : '';
      const fullText = (p.full_text || p.snippet || '').slice(0, 1200);
      return `[BOOK: "${title}"${chapter}${topic}, PAGE: ${page}]\n${fullText}`;
    });

    return `\n\n===== TEXTBOOK REFERENCE (STUDY MODE) =====
The student's question matches the following textbook content. You MUST study this content carefully and base your primary explanation on it.

${sections.join('\n\n---\n\n')}

===== INSTRUCTIONS FOR THIS RESPONSE =====
1. Study the textbook content above carefully. It is from the student's actual course book.
2. Explain the concept step-by-step, using the textbook content as your PRIMARY source.
3. Add your own knowledge to enhance the explanation (examples, analogies, further clarification).
4. CRITICAL: At the VERY END of your response, you MUST include a References section in this EXACT format:

---
**References:**
- [Book Name], p. [page number]
---

This References section is MANDATORY. Every response that uses textbook content MUST end with it. List ALL books and pages you referenced. Do NOT skip this step.`;
  }

  // ── AI preference rules injected into the system prompt ──
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
      english: 'LANGUAGE RULE — CRITICAL: You MUST write your ENTIRE response in English. Every single word, sentence, heading, bullet point, explanation — everything must be in English. Do NOT use any Urdu words, Urdu script, or Roman Urdu. Write as if you are an English-speaking tutor.',
      urdu: 'LANGUAGE RULE — CRITICAL: You MUST write your ENTIRE response in Urdu script (اردو). Every single word, sentence, heading, bullet point, explanation — everything must be in Urdu script. Do NOT use any English words or Roman Urdu. Write as if you are an اردو-speaking tutor.',
      roman_urdu: 'LANGUAGE RULE — CRITICAL: You MUST write your ENTIRE response in Roman Urdu (English letters used to write Urdu words). Every single word, sentence, heading, bullet point, explanation — everything must be in Roman Urdu. Do NOT use Urdu script. Do NOT use formal English. Write as if you are talking to a friend in Lahore.',
      mixed: 'LANGUAGE RULE: Match the student exact script. If they write in English, reply in English. If they write in Roman Urdu, reply in Roman Urdu (never Urdu script). If they write in Urdu script, reply in Urdu script. Never switch mid-response.',
    }[aiPrefs.language] || 'LANGUAGE RULE: Match the student exact script.';

    const suggestRule = aiPrefs.studySuggestions
      ? 'STUDY SUGGESTIONS: After finishing your main answer, add 1-2 short follow-up sentences like "Want me to quiz you on this?" or "Should I explain [related topic]?". Do NOT create a separate section header for this — just add them as natural closing sentences at the very end of your response.'
      : 'STUDY SUGGESTIONS: NEVER add follow-up suggestions, recommendations, or closing lines. Just answer the question and stop. No "want more?" or "what to study next" lines.';

    const personalRule = aiPrefs.personalization
      ? `STUDENT'S PERSONAL INSTRUCTIONS — CRITICAL: The student has given you the following personalization instructions. You MUST follow these at all times:\n"${aiPrefs.personalization}"\nThese instructions override default behavior. Adapt your tone, style, language, explanation depth, and teaching approach according to what the student described above.`
      : '';

    return [styleRule, levelRule, langRule, suggestRule, personalRule].filter(Boolean).join('\n\n');
  }

  // ── System Prompt ──
  function buildSystemPrompt() {
    const persona = getActivePersona();

    // Zardari is coding-only — different system prompt
    if (persona.codingOnly) {
      let ctx = `You are Zardari, Wassal's dedicated Coding Agent. You are an expert software engineer, full-stack developer, and programming tutor. You write production-quality code and help students build real projects.

IDENTITY: Your name is "Zardari". ONLY mention it when directly asked "what is your name?". NEVER start responses with your name. NEVER reveal AI model names. If asked who created you, say "Zardari is trained by Wassal Pakistan."

STYLE: No em dashes or en dashes. Use commas/periods. Varied natural endings. No repetitive closing lines. Start your response immediately with the answer, code, or explanation. Do NOT say "Sure", "Of course", "Great question", "Let me help" or similar filler — go straight to the content.

CORE EXPERTISE:
- Languages: Python, JavaScript, TypeScript, C, C++, Java, Dart, Kotlin, Swift, HTML, CSS, SQL, Bash, Go, Rust, PHP, Ruby
- Frameworks: Flutter, React, Next.js, Node.js, Express, Django, Flask, Laravel, Vue, Angular, Svelte
- Databases: PostgreSQL, MySQL, MongoDB, SQLite, Firebase, Supabase
- Tools: Git, Docker, Linux, VS Code, CI/CD, AWS, Vercel, Netlify
- Concepts: Data structures, algorithms, OOP, functional programming, system design, APIs, REST, GraphQL, web sockets, authentication, security

WHAT YOU DO:
- Generate complete, working, production-ready code — not snippets, real code
- Build projects from scratch: websites, apps, games, tools, CLI programs, APIs
- Debug code — find and fix errors, explain why they happened
- Review code — suggest improvements, performance fixes, security issues
- Explain programming concepts step-by-step with examples
- Help students with assignments, projects, and homework involving code
- Create file structures, database schemas, and architecture diagrams (text-based)
- Write tests, documentation, and README files
- Convert designs/mockups to code
- Optimize code for speed and efficiency

NON-CODING RULES:
- For Physics, Chemistry, Biology, Math theory, FSc subjects, or any non-coding question: reply with "I'm Zardari, the coding expert. Switch to Shehbaz Sharif or Imran Khan for academic questions — they handle Physics, Chemistry, Biology, and Math theory better."
- NEVER answer non-coding academic questions, even if you know the answer
- You CAN help with: computational math, data science, scientific computing, numerical methods, simulations, and anything that involves writing code

RESPONSE FORMAT:
- For code: Use markdown code blocks with language tag. Include file name as comment at top if relevant.
- For explanations: Be concise and technical. Use examples.
- For projects: Break into files, show structure, explain architecture.
- For debugging: Show the error, explain the cause, provide the fix.`;
      // Add language rule for Zardari too
      const zardariLangRule = {
        english: 'Write code comments and explanations in English.',
        urdu: 'Write code comments in English (required), but explanations in Urdu script.',
        roman_urdu: 'Write code comments in English (required), but explanations in Roman Urdu.',
        mixed: 'Match the user language for explanations, code comments always in English.',
      }[aiPrefs.language] || 'Match the user language for explanations, code comments always in English.';
      ctx += `\n\n${zardariLangRule}`;
      if (thinkMode) {
        ctx += `\n\nTHINK MODE ACTIVE: Deep thinking mode. Reason step by step. Consider edge cases. Give a thorough, well-thought-out coding solution.`;
      }
      return ctx;
    }

    let ctx = `You are ${persona.name}, an FSc Intermediate tutor (Pakistan). Teach step-by-step, use Unicode math (x₀, v², √2), no LaTeX, no HTML.

${aiPrefsPrompt()}

IDENTITY: Your name is "${persona.name}". ONLY mention it when directly asked "what is your name?". NEVER start responses with your name. NEVER reveal AI model names. If asked who created you, say "${persona.name} is trained by Wassal Pakistan."

BACKGROUND: ${persona.background}

STYLE: No em dashes or en dashes. Use commas/periods. Varied natural endings. No repetitive closing lines.

BEHAVIOR:
- For academic/study questions: Use the textbook content provided as your PRIMARY source. Explain step-by-step. Add your own knowledge to enhance.
- CRITICAL — REFERENCES: When textbook content is provided in the system, you MUST ALWAYS end your response with a "References" section in this exact format:

---
**References:**
- [Book Name], p. [page number]
---

This is MANDATORY for every academic response that uses textbook content. List ALL books and pages you referenced. Place this section at the very end of your response, after everything else.
- For casual/conversation questions (greetings, opinions, general chat): Answer naturally and warmly. Do NOT include references for casual chat.
- NEVER fabricate book references. Only cite books that are actually provided in the textbook content block.`;

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

    if (thinkMode) {
      ctx += `\n\nTHINK MODE ACTIVE: The student has activated deep thinking mode. Take your time. Think step by step like a thoughtful human would. Reason through the problem thoroughly before answering. Consider multiple angles, potential pitfalls, and edge cases. Use more of your reasoning capacity. Do NOT give a rushed or surface-level answer. If the question is complex, break it down and work through each part carefully. This is not a simple Q&A — the student wants a genuinely thoughtful, thorough response.`;
    }

    if (researchMode) {
      ctx += `\n\nRESEARCH MODE ACTIVE: The student has activated research mode. Search your knowledge thoroughly for the most accurate, up-to-date, and well-sourced information. Draw from multiple perspectives and sources. If you're not certain about something, say so honestly rather than guessing. Cite where information comes from when possible. Prioritize accuracy and depth over speed.`;
    }

    return ctx;
  }

  // ── Markdown + LaTeX Renderer ──
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

  // ── Conversation Management ──
  function newChat() {
    activeConversationId = null;
    messages = [];
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
    if (messages.length === 0) return;
    if (!activeConversationId) {
      activeConversationId = 'conv_' + Date.now();
      const title = messages[0]?.content?.slice(0, 50) || 'New Chat';
      conversations.unshift({ id: activeConversationId, title, titleLocked: false, messages: [...messages] });
      if (conversations.length > 50) conversations.pop();
    } else {
      const conv = conversations.find(c => c.id === activeConversationId);
      if (conv) { conv.messages = [...messages]; }
      else conversations.unshift({ id: activeConversationId, title: messages[0]?.content?.slice(0, 50) || 'New Chat', titleLocked: false, messages: [...messages] });
    }
    try {
      localStorage.setItem(chatStorageKey(), JSON.stringify(conversations));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        // Strip images from old conversations to free space, then retry
        for (let i = conversations.length - 1; i >= 0; i--) {
          conversations[i].messages.forEach(m => { m.images = null; });
        }
        try { localStorage.setItem(chatStorageKey(), JSON.stringify(conversations)); } catch (_) {}
      }
    }
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
      for await (const chunk of api.streamChat(titleMessages, getActivePersona().providerIndex)) {
        if (chunk && chunk.includes('"type":"streak"')) continue;
        title += chunk;
        if (title.length > 80) break;
      }
      title = title.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').replace(/[.!?:;…]+$/g, '').trim();
      title = title.replace(/\{.*$/g, '').trim();
      title = title.split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
      if (title.length > 40) title = title.slice(0, 40).trim();
      if (!title) return;
      const conv = conversations.find(c => c.id === convId);
      if (!conv || conv.titleLocked) return;
      conv.title = title;
      localStorage.setItem(chatStorageKey(), JSON.stringify(conversations));
      renderHistory();
    } catch (e) {
      console.warn('[AI] Title generation failed:', (e && e.message) || e);
    }
  }

  function loadConversation(id) {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    activeConversationId = id;
    messages = [...conv.messages];
    messagesList.innerHTML = '';
    welcome.style.display = 'none';
    messagesList.style.display = 'flex';
    messages.forEach((m, i) => appendMessage(m.role, m.content, false, { idx: i, quote: m.quote || null, images: m.images || null }));
    scrollToBottom();
    renderHistory();
    closeMobileSidebar();
  }

  function renderHistory() {
    const html = conversations.slice(0, 30).map(c =>
      `<div class="history-item ${c.id === activeConversationId ? 'active' : ''}" data-id="${c.id}"><span class="history-title">${escapeHtml(c.title)}</span><button class="history-edit-btn" data-id="${c.id}" aria-label="Rename chat" title="Rename"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button><button class="history-delete-btn" data-id="${c.id}" aria-label="Delete chat" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>`
    ).join('');
    sidebarHistory.innerHTML = html;
    if (sidebarHistoryMobile) sidebarHistoryMobile.innerHTML = html;

    [sidebarHistory, sidebarHistoryMobile].forEach(container => {
      if (!container) return;
      container.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.history-edit-btn') || e.target.closest('.history-delete-btn') || e.target.closest('.history-title-input')) return;
          loadConversation(el.dataset.id);
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
    try { localStorage.setItem(chatStorageKey(), JSON.stringify(conversations)); } catch (_) {}
    if (activeConversationId === id) {
      activeConversationId = null;
      messages = [];
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
          try { localStorage.setItem(chatStorageKey(), JSON.stringify(conversations)); } catch (_) {}
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

  // ── Message Rendering ──
  function getUserAvatarUrl() {
    if (typeof currentProfile !== 'undefined' && currentProfile?.profile_image_url) {
      return currentProfile.profile_image_url;
    }
    if (typeof currentUser !== 'undefined' && currentUser) {
      return currentUser.user_metadata?.avatar_url
        || currentUser.user_metadata?.picture
        || null;
    }
    return null;
  }

  function getUserInitial() {
    if (typeof currentProfile !== 'undefined' && currentProfile?.username) {
      return currentProfile.username[0].toUpperCase();
    }
    if (typeof currentProfile !== 'undefined' && currentProfile?.full_name) {
      return currentProfile.full_name[0].toUpperCase();
    }
    return (typeof currentUser !== 'undefined' && currentUser?.user_metadata?.full_name?.[0]?.toUpperCase())
      || 'U';
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
      div.innerHTML = `
        <div class="msg-avatar assistant-avatar"><img src="../assets/wassal.png" alt="Wassal"></div>
        <div class="msg-body">${quoteHtml}<div class="msg-content">${renderMarkdown(content)}</div></div>
      `;
    } else {
      const imgUrl = getUserAvatarUrl();
      const initial = getUserInitial();
      const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="You" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar-fallback-msg" style="display:none">${initial}</div>`
        : `<div class="avatar-fallback-msg">${initial}</div>`;
      div.innerHTML = `
        <div class="msg-avatar user-avatar">${avatarHtml}</div>
        <div class="msg-body">${quoteHtml}${imagesHtml}<div class="msg-content">${escapeHtml(content)}</div></div>
      `;
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
    const statusLabel = mode === 'research' ? 'Researching sources...'
                      : mode === 'think' ? 'Reasoning through this...'
                      : 'Understanding your prompt...';
    const statusClass = mode === 'research' ? 'researching'
                      : mode === 'think' ? 'thinking'
                      : '';
    div.innerHTML = `
      <div class="msg-avatar assistant-avatar"><img src="../assets/wassal.png" alt="Wassal"></div>
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
    const statuses = mode === 'research'
      ? ['Searching textbooks...', 'Cross-referencing sources...', 'Gathering information...', 'Compiling findings...']
      : mode === 'think'
      ? ['Analyzing the problem...', 'Breaking it down...', 'Reasoning step by step...', 'Considering approaches...']
      : ['Searching textbooks...', 'Analyzing your prompt...', 'Finding the best explanation...', 'Preparing response...'];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % statuses.length;
      updateStreamingStatus(div, statuses[idx], mode === 'research' ? 'researching' : mode === 'think' ? 'thinking' : 'analyzing');
    }, 2500);
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

  function updateStreamingMessage(div, text) {
    const content = div.querySelector('.msg-content');
    content.innerHTML = '<div class="streaming-text">' + renderStreamingMarkdown(text) + '</div><span class="streaming-caret"></span>';
  }

  function finalizeStreamingMessage(div, text) {
    const content = div.querySelector('.msg-content');
    content.innerHTML = renderMarkdown(text);
  }

  // ── Text Selection: Reply + Flashcard ──
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
      <button class="sel-tool-btn sel-disabled" type="button" aria-disabled="true" title="Flashcards coming soon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="7" y1="14" x2="13" y2="14"/></svg>
        <span>Flashcard</span><em class="sel-soon">Soon</em>
      </button>`;
    document.body.appendChild(selToolbar);
    selToolbar.querySelector('.sel-reply').addEventListener('click', onReplyFromToolbar);
    return selToolbar;
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
        <button class="reply-chip-cancel" type="button" aria-label="Cancel reply">×</button>`;
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
        <div class="quote-modal-head"><span class="quote-modal-title"></span><button class="quote-modal-close" type="button" aria-label="Close">×</button></div>
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

  // ── Session Management ──
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
            // Same session — always trust DB for tokens
            activeSession.messages_count = dbMsgs;
            activeSession.tokens_used = dbTokens;
            estimatedTokensUsed = dbTokens;
          }
        } else {
          // No active session in DB — clear local if expired
          if (activeSession && new Date(activeSession.expires_at).getTime() <= Date.now()) {
            activeSession = null;
            estimatedTokensUsed = 0;
          }
        }
        updateSessionPanel();
        if (ent.ai_used >= ent.ai_limit && !activeSession) {
          chatInput.disabled = true;
          chatInput.placeholder = 'No sessions left this month';
        }
        if (activeSession && estimatedTokensUsed >= TOKEN_LIMIT) {
          chatInput.disabled = true;
          chatInput.placeholder = 'Tokens exhausted - start a new session';
          showTokenExhaustedPopup();
        }
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
        const msg = data?.error === 'LIMIT_REACHED'
          ? `You've used all your AI sessions for this month. Resets ${formatPeriodEnd(data.resets_at)}.`
          : data?.error === 'RATE_LIMITED'
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
    // Show error in the sidebar panel and lock input
    const panel = document.getElementById('session-panel');
    if (panel) {
      panel.innerHTML = `<div class="session-error">${escapeHtml(msg)}</div>`;
    }
    const mobile = document.getElementById('session-panel-mobile');
    if (mobile) {
      mobile.innerHTML = `<div class="session-error">${escapeHtml(msg)}</div>`;
    }
    chatInput.disabled = true;
    chatInput.placeholder = 'No sessions available';
  }

  function formatPeriodEnd(iso) {
    if (!iso) return 'next month';
    const d = new Date(iso);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  // ── Cost calculation ──
  // 100,000 tokens = $0.018 → $0.00000018 per token
  // PKR rate (update periodically)
  const USD_TO_PKR = 280;
  const COST_PER_TOKEN_USD = 0.018 / 100000;

  function formatCostPKR(tokens) {
    const pkr = tokens * COST_PER_TOKEN_USD * USD_TO_PKR;
    if (pkr < 0.01) return 'Rs. 0';
    if (pkr < 1) return 'Rs. ' + pkr.toFixed(2);
    return 'Rs. ' + pkr.toFixed(pkr >= 100 ? 0 : 1);
  }

  function updateSessionPanel() {
    const tokensUsed = estimatedTokensUsed || activeSession?.tokens_used || 0;
    const tokenPct = Math.min(100, Math.round((tokensUsed / TOKEN_LIMIT) * 100));
    const msgCount = activeSession?.messages_count || 0;
    const monthlyUsed = sessionUsage?.ai_used || 0;
    const monthlyLimit = sessionUsage?.ai_limit || 25;
    const monthlyLeft = Math.max(0, monthlyLimit - monthlyUsed);
    const isActive = activeSession && new Date(activeSession.expires_at).getTime() > Date.now();

    let html;

    if (isActive) {
      const barClass = tokenPct >= 90 ? 'danger' : tokenPct >= 70 ? 'warn' : '';
      const startTimeStr = new Date(activeSession.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      html = `
        <div class="session-header">
          <span class="session-header-dot active"></span>
          <span>Session Active</span>
        </div>
        <div class="session-row">
          <span class="session-label">Started</span>
          <span class="session-value">${startTimeStr}</span>
        </div>
        <div class="session-row">
          <span class="session-label">Ends in</span>
          <span class="session-value countdown session-countdown">${formatCountdown(activeSession.expires_at)}</span>
        </div>
        <div class="session-progress">
          <div class="session-progress-bar ${barClass}" style="width:${tokenPct}%"></div>
        </div>
        <div class="session-meta">
          <span>${formatTokens(tokensUsed)} / ${formatTokens(TOKEN_LIMIT)} tokens</span>
          <span>${msgCount} msg${msgCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="session-cost">~${formatCostPKR(tokensUsed)}</div>
        <div class="session-divider"></div>
        ${streakCount > 0 ? `
        <div class="session-row">
          <span class="session-label">Streak</span>
          <span class="session-value streak-value">${streakCount} day${streakCount !== 1 ? 's' : ''} 🔥</span>
        </div>` : `
        <div class="session-row">
          <span class="session-label">Streak</span>
          <span class="session-value streak-value">0</span>
        </div>`}
        <div class="session-row">
          <span class="session-label">Sessions left</span>
          <span class="session-value">${monthlyLeft} / ${monthlyLimit}</span>
        </div>
      `;
    } else {
      html = `
        <div class="session-header">
          <span class="session-header-dot inactive"></span>
          <span>No Active Session</span>
        </div>
        <div class="session-idle-hint">Send a message to start a ${sessionUsage?.session_minutes || 45} min session</div>
        <div class="session-divider"></div>
        <div class="session-row">
          <span class="session-label">Streak</span>
          <span class="session-value streak-value">${streakCount > 0 ? streakCount + ' day' + (streakCount !== 1 ? 's' : '') + ' 🔥' : '0'}</span>
        </div>
        <div class="session-row">
          <span class="session-label">Sessions left</span>
          <span class="session-value">${monthlyLeft} / ${monthlyLimit}</span>
        </div>
      `;
    }

    const panel = document.getElementById('session-panel');
    if (panel) panel.innerHTML = html;
    const mobile = document.getElementById('session-panel-mobile');
    if (mobile) mobile.innerHTML = html;

    if (isActive) startSessionTimer();
  }

  function formatCountdown(expiresAt) {
    if (!expiresAt) return '--';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}m ${sec.toString().padStart(2, '0')}s`;
  }

  function formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
    return String(n);
  }

  // Display-only helper: turns server retry_after_seconds into friendly text.
  function formatRetryAfter(secs) {
    const s = Math.max(1, Math.round(Number(secs) || 30));
    if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} minute${m === 1 ? '' : 's'} ${r}s` : `${m} minute${m === 1 ? '' : 's'}`;
  }

  function estimateInputTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  function estimateOutputTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  function startSessionTimer() {
    if (sessionTimerInterval) clearInterval(sessionTimerInterval);
    sessionTimerInterval = setInterval(() => {
      if (!activeSession) { clearInterval(sessionTimerInterval); return; }
      const text = formatCountdown(activeSession.expires_at);
      document.querySelectorAll('.session-countdown').forEach(el => el.textContent = text);

      if (text === 'Expired') {
        clearInterval(sessionTimerInterval);
        const expiredSessionId = activeSession?.id;
        activeSession = null;
        estimatedTokensUsed = 0;
        stopStudyTimer();
        clearSessionState();
        removeTokenExhaustedPopup();
        updateSessionPanel();
        // Clean up session in DB
        if (expiredSessionId && db) {
          db.rpc('end_ai_session', { p_session_id: expiredSessionId }).then(() => {}).catch(() => {});
        }
        showSessionExpiredPopup();
      }
    }, 1000);
  }

  function updateTokensAfterResponse(inputText, outputText) {
    if (!activeSession) return;
    const inputTk = estimateInputTokens(inputText);
    const outputTk = estimateOutputTokens(outputText);
    const newTokens = inputTk + outputTk;
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

  // ── Token Exhausted Popup (Modal) ──
  function showTokenExhaustedPopup() {
    removeTokenExhaustedPopup();
    const overlay = document.createElement('div');
    overlay.className = 'session-modal-overlay';
    overlay.id = 'token-exhausted-popup';
    overlay.innerHTML = `
      <div class="session-modal">
        <button class="session-modal-close" id="btn-close-token-exhausted" title="Close">&times;</button>
        <div class="session-modal-icon" style="background:rgba(255,107,107,0.12);color:#FF6B75">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <h3 class="session-modal-title">Tokens Exhausted</h3>
        <p class="session-modal-desc">You've used all 100K tokens for this session. Start a new session to keep chatting.</p>
        <button class="session-modal-btn" id="btn-start-new-session">Start New Session</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    document.getElementById('btn-close-token-exhausted')?.addEventListener('click', () => {
      removeTokenExhaustedPopup();
    });

    document.getElementById('btn-start-new-session')?.addEventListener('click', async () => {
      removeTokenExhaustedPopup();
      const started = await startSession();
      if (started) {
        chatInput.disabled = false;
        chatInput.placeholder = 'Ask Wassal AI anything...';
        chatInput.focus();
        estimatedTokensUsed = 0;
        updateSessionPanel();
      }
    });
  }

  function removeTokenExhaustedPopup() {
    const existing = document.getElementById('token-exhausted-popup');
    if (existing) existing.remove();
  }

  // ── Session Expired Popup ──
  function showSessionExpiredPopup() {
    removeTokenExhaustedPopup();
    const overlay = document.createElement('div');
    overlay.className = 'session-modal-overlay';
    overlay.id = 'token-exhausted-popup';
    overlay.innerHTML = `
      <div class="session-modal">
        <button class="session-modal-close" id="btn-close-session-expired" title="Close">&times;</button>
        <div class="session-modal-icon" style="background:rgba(255,183,77,0.12);color:#FFB74D">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <h3 class="session-modal-title">Session Expired</h3>
        <p class="session-modal-desc">Your session time is up. Start a new session to continue.</p>
        <button class="session-modal-btn" id="btn-start-new-session">Start New Session</button>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    document.getElementById('btn-close-session-expired')?.addEventListener('click', () => {
      removeTokenExhaustedPopup();
    });

    document.getElementById('btn-start-new-session')?.addEventListener('click', async () => {
      removeTokenExhaustedPopup();
      const started = await startSession();
      if (started) {
        chatInput.disabled = false;
        chatInput.placeholder = 'Ask Wassal AI anything...';
        chatInput.focus();
        estimatedTokensUsed = 0;
        updateSessionPanel();
      }
    });
  }

  // ── Send / Stop ──
  async function handleSend() {
    const text = chatInput.value.trim();
    const hasImages = pendingImages.length > 0;
    if ((!text && !hasImages) || isStreaming) return;

    // Lock immediately — prevent double-send during any async gap
    isStreaming = true;
    chatInput.disabled = true;
    btnSend.disabled = true;
    const quote = pendingQuote;
    const imagesToSend = [...pendingImages]; // snapshot before clearing
    hideSelToolbar();

    // Refresh AI preferences in case user changed them mid-session
    await loadAiPrefs();

    // ── Session gate: must have an active session ──
    if (!activeSession || new Date(activeSession.expires_at).getTime() <= Date.now()) {
      const started = await startSession();
      if (!started) return; // blocked — no sessions left
    }

    // Start study timer if page is visible and session is active
    if (document.visibilityState === 'visible') {
      startStudyTimer();
    }

    // ── Token budget check ──
    const estInput = estimateInputTokens(text + (quote ? quote.text : '') + (studentContext ? JSON.stringify(studentContext) : ''));
    if (estimatedTokensUsed + estInput >= TOKEN_LIMIT) {
      showTokenExhaustedPopup();
      chatInput.disabled = true;
      chatInput.placeholder = 'Tokens exhausted - start a new session';
      return;
    }

    chatInput.value = '';
    autoResize();
    btnSend.disabled = true;
    chatInput.disabled = true;
    clearPendingImages();
    // Reset think/research toggles after sending
    thinkMode = false;
    researchMode = false;
    updateModesUI();

    if (welcome.style.display !== 'none') {
      welcome.style.display = 'none';
      messagesList.style.display = 'flex';
    }

    appendMessage('user', text || '', true, { idx: messages.length, quote: quote || null, images: hasImages ? imagesToSend : null });
    messages.push(quote ? { role: 'user', content: text, quote, images: hasImages ? imagesToSend : null } : { role: 'user', content: text, images: hasImages ? imagesToSend : null });
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

    const streamDiv = createStreamingMessage(thinkMode ? 'think' : researchMode ? 'research' : null);
    const statusCycle = startStatusCycle(streamDiv, thinkMode ? 'think' : researchMode ? 'research' : null);
    scrollToBottom();

    // Search textbooks before sending to AI
    let textbookContext = '';
    try {
      const pages = await searchTextbooks(text);
      if (pages.length > 0) {
        console.log(`[AI] Found ${pages.length} textbook pages for: "${text}"`);
        console.log('[AI] Books:', pages.map(p => `${p.book_title} p.${p.printed_page_number || p.page_number}`).join(', '));
        textbookContext = formatTextbookContext(pages);
      } else {
        console.log(`[AI] No textbook pages found for: "${text}"`);
      }
    } catch (e) {
      console.warn('[AI] Textbook search failed:', e);
    }

    // Fresh memory reload — picks up extractions from OTHER chats too.
    await loadAiMemories();

    const systemPrompt = buildSystemPrompt() + textbookContext;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map(m => ({
        role: m.role,
        content: m.quote
          ? `[Replying to ${m.quote.role === 'assistant' ? 'AI' : 'you'}: "${m.quote.text}"]\n${m.content}`
          : m.content,
      })),
    ];

    let fullResponse = '';
    let firstChunk = true;
    const selectedProviderIndex = getActivePersona().providerIndex;

    // Pass session ID and auth token to API
    api.setSessionId(activeSession?.id || null);
    api.setAccessToken(getAccessToken());

    try {
    for await (const chunk of api.streamChat(apiMessages, selectedProviderIndex, hasImages ? imagesToSend : null)) {
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
        updateStreamingMessage(streamDiv, fullResponse);
        if (userNearBottom) scrollToBottom();
      }

      finalizeStreamingMessage(streamDiv, fullResponse);
      stopStatusCycle(statusCycle);
      messages.push({ role: 'assistant', content: fullResponse });
      updateTokensAfterResponse(text, fullResponse);
      userNearBottom = true;
      if (scrollDownBtn) {
        scrollDownBtn.classList.remove('generating');
        scrollDownBtn.classList.remove('show');
      }
    } catch (error) {
      // ── Auto-retry on NO_SESSION: session exists locally but not in DB ──
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
      // ── TOKEN_LIMIT: tokens exhausted but session still running ──
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
              for await (const chunk of api.streamChat(continuationMessages, fallbackIndex)) {
                if (chunk && chunk.includes('"type":"streak"')) {
                  try { const p = JSON.parse(chunk); if (p.type === 'streak') { streakCount = p.current_streak || 0; longestStreak = p.longest_streak || 0; updateSessionPanel(); saveSessionState(); continue; } } catch (_) {}
                }
                fullResponse += chunk;
                updateStreamingMessage(streamDiv, fullResponse);
                if (userNearBottom) scrollToBottom();
              }
              continued = true;
              break;
            } catch (_) { continue; }
          }
          if (continued) {
            finalizeStreamingMessage(streamDiv, fullResponse);
            messages.push({ role: 'assistant', content: fullResponse });
            updateTokensAfterResponse(text, fullResponse);
            isStreaming = false;
            if (scrollDownBtn) { scrollDownBtn.classList.remove('generating'); scrollDownBtn.classList.remove('show'); }
            btnStop.style.display = 'none';
            btnSend.style.display = 'flex';
            btnSend.disabled = true;
            if (estimatedTokensUsed < TOKEN_LIMIT) { chatInput.disabled = false; chatInput.focus(); } else { chatInput.disabled = true; chatInput.placeholder = 'Token limit reached for this session'; }
            showTokenExhaustedPopup();
            return;
          }
        }
        // If no partial response or all providers failed
        finalizeStreamingMessage(streamDiv, 'Token limit reached for this session. Start a new session to continue.');
        messages.pop();
        showTokenExhaustedPopup();
        isStreaming = false;
        if (scrollDownBtn) { scrollDownBtn.classList.remove('generating'); scrollDownBtn.classList.remove('show'); }
        btnStop.style.display = 'none';
        btnSend.style.display = 'flex';
        chatInput.disabled = true;
        chatInput.placeholder = 'Tokens exhausted - start a new session';
        return;
      }
      // ── RATE_LIMITED / CONCURRENT_LIMIT: friendly, display-only ──
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
      // ── IMAGE_LIMIT: daily image cap reached ──
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
      // If incomplete stream — auto-retry with fallback
      if (error instanceof IncompleteStreamError && fullResponse.length > 0) {
        const fallbackIndex = selectedProviderIndex === 0 ? 1 : 0;
        console.warn(`[AI] Stream incomplete. Retrying with fallback provider ${fallbackIndex}...`);

        // Add partial response as context so fallback continues from where it left off
        const continuationMessages = [
          ...apiMessages,
          { role: 'assistant', content: fullResponse },
          { role: 'user', content: 'Your previous response was cut off. Please continue from where you left off. Do not repeat what was already said - just continue the explanation.' },
        ];

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
            updateStreamingMessage(streamDiv, fullResponse);
            if (userNearBottom) scrollToBottom();
          }
        } catch (fallbackError) {
          fullResponse += '\n\n*[Response continued but may be incomplete]*';
        }

        finalizeStreamingMessage(streamDiv, fullResponse);
        messages.push({ role: 'assistant', content: fullResponse });
        updateTokensAfterResponse(text, fullResponse);
      } else {
        const errText = `Sorry, something went wrong. ${error.message}`;
        finalizeStreamingMessage(streamDiv, errText);
        messages.push({ role: 'assistant', content: errText });
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
    // Re-enable input if token budget allows
    if (estimatedTokensUsed < TOKEN_LIMIT) {
      chatInput.disabled = false;
      chatInput.focus();
    } else {
      chatInput.disabled = true;
      chatInput.placeholder = 'Token limit reached for this session';
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

  // ── Helpers ──
  function autoResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContent.scrollTop = chatContent.scrollHeight;
    });
  }

  // ── Mobile keyboard: lift the fixed chat layout above the virtual keyboard ──
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
