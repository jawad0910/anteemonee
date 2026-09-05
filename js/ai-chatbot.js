/* ==========================================
   Wassal AI Chatbot — Full Implementation
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

  // ── Persist session state to localStorage ──
  function saveSessionState() {
    try {
      const state = {
        activeSession,
        sessionUsage,
        streakCount,
        longestStreak,
        estimatedTokensUsed,
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
        state.estimatedTokensUsed = 0;
        localStorage.setItem(sessionStateKey(), JSON.stringify(state));
      }
    } catch (_) {}
  }

  // ── AI Session State ──
  const TOKEN_LIMIT = 120000;
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
      name: 'Shehbaz Sharif', provider: 'Groq', providerIndex: 0,
      background: 'Your name comes from Shehbaz Sharif, the Pakistani politician: president of PML-N, Prime Minister of Pakistan, and former Chief Minister of Punjab (known for infrastructure projects like metro bus systems and a hands-on administrative style). If a student asks about him, answer factually and neutrally using these facts plus your general knowledge. Keep it brief and offer to return to studies.',
    },
    {
      name: 'Imran Khan', provider: 'Qwen', providerIndex: 1,
      background: 'Your name comes from Imran Khan, the Pakistani politician and former cricketer: founder and chairman of PTI, Prime Minister of Pakistan (2018 to 2022), captain of the 1992 Cricket World Cup winning team, and founder of Shaukat Khanum Memorial Cancer Hospital. If a student asks about him, answer factually and neutrally using these facts plus your general knowledge. Keep it brief and offer to return to studies.',
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

  // ── AI Preferences (from Settings → AI Preferences, stored in user_preferences) ──
  let aiPrefs = {
    responseStyle: 'balanced',
    explanationLevel: 'standard',
    language: 'mixed',
    studySuggestions: true,
  };

  async function loadAiPrefs() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
        const { data, error } = await db.from('user_preferences').select('*').eq('user_id', currentUser.id).maybeSingle();
        if (!error && data) {
          if (['concise', 'balanced', 'detailed'].includes(data.ai_response_style)) aiPrefs.responseStyle = data.ai_response_style;
          if (['simple', 'standard', 'advanced'].includes(data.ai_explanation_level)) aiPrefs.explanationLevel = data.ai_explanation_level;
          if (['english', 'urdu', 'roman_urdu', 'mixed'].includes(data.ai_language)) aiPrefs.language = data.ai_language;
          if (typeof data.ai_study_recommendations === 'boolean') aiPrefs.studySuggestions = data.ai_study_recommendations;
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

    // ── 1. Load from localStorage FIRST (instant, no flicker) ──
    const cached = loadSessionState();
    if (cached) {
      activeSession = cached.activeSession;
      sessionUsage = cached.sessionUsage;
      streakCount = cached.streakCount || 0;
      longestStreak = cached.longestStreak || 0;
      estimatedTokensUsed = cached.estimatedTokensUsed || 0;
      // If cached session is expired, clear it
      if (activeSession && new Date(activeSession.expires_at).getTime() <= Date.now()) {
        activeSession = null;
        estimatedTokensUsed = 0;
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
          const key = 'wassal_study_time_pending';
          const prev = parseInt(localStorage.getItem(key) || '0', 10);
          localStorage.setItem(key, String(prev + studyTimerAccumulated));
          studyTimerAccumulated = 0;
        } catch (_) {}
      }
    });
    // Flush any pending study time from previous unload
    flushPendingStudyTime();

    // ── iOS keyboard handling: adjust layout when virtual keyboard opens/closes ──
    const chatbotLayout = document.querySelector('.chatbot-layout');
    if (window.visualViewport && chatbotLayout) {
      const applyViewportHeight = () => {
        const vv = window.visualViewport;
        // Offset from bottom of layout viewport to bottom of visual viewport (keyboard height)
        const bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
        chatbotLayout.style.bottom = bottomOffset + 'px';
      };
      window.visualViewport.addEventListener('resize', applyViewportHeight);
      window.visualViewport.addEventListener('scroll', applyViewportHeight);
      applyViewportHeight();
    }
  }

  async function flushPendingStudyTime() {
    try {
      const pending = parseInt(localStorage.getItem('wassal_study_time_pending') || '0', 10);
      if (pending > 0) {
        await db.rpc('add_study_time', { p_seconds: pending });
        localStorage.removeItem('wassal_study_time_pending');
      }
    } catch (_) {}
  }

  function bindEvents() {
    btnSend.addEventListener('click', handleSend);
    btnStop.addEventListener('click', handleStop);

    chatInput.addEventListener('input', () => {
      autoResize();
      btnSend.disabled = !chatInput.value.trim();
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!btnSend.disabled && !isStreaming) handleSend();
      }
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
  }

  // ── Model / Persona ──
  function updatePersonaUI() {
    const persona = PERSONAS[activePersonaIndex];
    modelSelectedName.textContent = persona.name;
    modelDot.style.background = persona.providerIndex === 0 ? '#3B82F6' : '#F59E0B';
    document.querySelectorAll('#model-dropdown .model-option').forEach((el, i) => {
      el.classList.toggle('active', i === activePersonaIndex);
    });
    const mobileName = document.getElementById('model-selected-name-mobile');
    const mobileDot = document.getElementById('model-dot-mobile');
    if (mobileName) mobileName.textContent = persona.name;
    if (mobileDot) mobileDot.style.background = persona.providerIndex === 0 ? '#3B82F6' : '#F59E0B';
    const mobileDropdown = document.getElementById('model-dropdown-mobile');
    if (mobileDropdown) {
      mobileDropdown.querySelectorAll('.model-option').forEach((el, i) => {
        el.classList.toggle('active', i === activePersonaIndex);
      });
    }
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
4. At the END of your response, include a "References" section like this:

**References:**
- [Book Name], p. [page number]

Only include the References section when textbook content was found. If no textbook content is provided, do NOT include any references.`;
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
      english: 'LANGUAGE SETTING is English: ALWAYS reply in English, no matter what language the student writes in.',
      urdu: 'LANGUAGE SETTING is Urdu: ALWAYS reply in Urdu script, no matter what language the student writes in.',
      roman_urdu: 'LANGUAGE SETTING is Roman Urdu: ALWAYS reply in Roman Urdu (never Urdu script), no matter what language the student writes in.',
      mixed: 'LANGUAGE: Match the student exact script. English goes to English. Roman Urdu goes to Roman Urdu (never Urdu script). Urdu script goes to Urdu script. Never switch mid-conversation.',
    }[aiPrefs.language] || 'LANGUAGE: Match the student exact script.';

    const suggestRule = aiPrefs.studySuggestions
      ? 'STUDY SUGGESTIONS are ON: end study-related answers with 1 or 2 short follow-up suggestions (for example: want to practice MCQs on this, revise a related topic, or try a quick quiz).'
      : 'STUDY SUGGESTIONS are OFF: NEVER add follow-up suggestions, recommendations, or closers like want more, or what to study next lines. Just answer and stop.';

    return `${styleRule}\n\n${levelRule}\n\n${langRule}\n\n${suggestRule}`;
  }

  // ── System Prompt ──
  function buildSystemPrompt() {
    const persona = getActivePersona();

    let ctx = `You are ${persona.name}, an FSc Intermediate tutor (Pakistan). Teach step-by-step, use Unicode math (x₀, v², √2), no LaTeX, no HTML.

${aiPrefsPrompt()}

IDENTITY: Your name is "${persona.name}". ONLY mention it when directly asked "what is your name?". NEVER start responses with your name. NEVER reveal AI model names. If asked who created you, say "${persona.name} is trained by Wassal Pakistan."

BACKGROUND: ${persona.background}

STYLE: No em dashes or en dashes. Use commas/periods. Varied natural endings. No repetitive closing lines.

BEHAVIOR:
- For academic/study questions: Use the textbook content provided as your PRIMARY source. Explain step-by-step. Add your own knowledge to enhance. Include a References section at the end with book name and page number.
- For casual/conversation questions (greetings, opinions, general chat): Answer naturally and warmly. Do NOT include any references or textbook citations.
- NEVER fabricate book references. Only cite books that are actually provided in the textbook content block.`;

    if (studentContext) {
      ctx += `\n\nSTUDENT CONTEXT:
- Name: ${studentContext.name}
- Program: ${studentContext.system || 'Not set'}
- Board: ${studentContext.board || 'Not set'}
- Class: ${studentContext.class || 'Not set'}
- Group: ${studentContext.group || 'Not set'}
- Exam Year: ${studentContext.examYear || 'Not set'}

When asked about their own subjects, class, board or goals, answer directly from the above context — NEVER claim you don't have access.`;
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
      `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`
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
      const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map(row => {
        const tds = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
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
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<table>)/g, '$1');
    html = html.replace(/(<\/table>)<\/p>/g, '$1');
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
    localStorage.setItem(chatStorageKey(), JSON.stringify(conversations));
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
        { role: 'system', content: `Generate a short, unique chat title (max 4 words) that describes the USER's topic or intent. Rules: plain text only, no quotes, no emoji, no punctuation at end, lowercase. Be specific — not generic words like "greeting" or "chat". If the message is a simple greeting, pick the most relevant topic the user might discuss. Existing titles to avoid duplicating: [${existingTitles}]` },
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
    messages.forEach(m => appendMessage(m.role, m.content, false));
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

  function appendMessage(role, content, animate = true) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    if (role === 'assistant') {
      div.innerHTML = `
        <div class="msg-avatar assistant-avatar"><img src="../assets/wassal.png" alt="Wassal"></div>
        <div class="msg-body"><div class="msg-content">${renderMarkdown(content)}</div></div>
      `;
    } else {
      const imgUrl = getUserAvatarUrl();
      const initial = getUserInitial();
      const avatarHtml = imgUrl
        ? `<img src="${imgUrl}" alt="You" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar-fallback-msg" style="display:none">${initial}</div>`
        : `<div class="avatar-fallback-msg">${initial}</div>`;
      div.innerHTML = `
        <div class="msg-avatar user-avatar">${avatarHtml}</div>
        <div class="msg-body"><div class="msg-content">${escapeHtml(content)}</div></div>
      `;
    }
    if (!animate) div.style.animation = 'none';
    messagesList.appendChild(div);
    return div;
  }

  function createStreamingMessage() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
      <div class="msg-avatar assistant-avatar"><img src="../assets/wassal.png" alt="Wassal"></div>
      <div class="msg-body"><div class="msg-content"><div class="thinking-indicator"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div></div></div>
    `;
    messagesList.appendChild(div);
    return div;
  }

  function updateStreamingMessage(div, text) {
    const content = div.querySelector('.msg-content');
    content.innerHTML = renderMarkdown(text) + '<span class="streaming-caret"></span>';
  }

  function finalizeStreamingMessage(div, text) {
    const content = div.querySelector('.msg-content');
    content.innerHTML = renderMarkdown(text);
  }

  // ── Session Management ──
  function getAccessToken() {
    try {
      const raw = localStorage.getItem('sb-zkuytvjeqkpexcbyoyhz-auth-token');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed?.access_token || null;
      }
    } catch (_) {}
    return null;
  }

  async function syncSessionFromDB() {
    try {
      const { data: ent } = await db.rpc('get_entitlement_snapshot');
      if (ent) {
        sessionUsage = { ai_limit: ent.ai_limit, ai_used: ent.ai_used, period_end: ent.period_end };
        if (ent.active_session) {
          const dbMsgs = ent.active_session.messages_count || 0;
          const dbTokens = ent.active_session.tokens_used || 0;
          const localMsgs = activeSession?.messages_count || 0;
          const localTokens = activeSession?.tokens_used || 0;
          // Only overwrite if DB is strictly newer OR local has no session
          if (!activeSession || activeSession.id !== ent.active_session.id) {
            // Different session or no local session — use DB
            activeSession = ent.active_session;
            estimatedTokensUsed = dbTokens;
          } else if (dbMsgs > localMsgs || dbTokens > localTokens) {
            // Same session — only overwrite if DB is ahead
            activeSession.messages_count = dbMsgs;
            activeSession.tokens_used = dbTokens;
            estimatedTokensUsed = dbTokens;
          }
          // else: local is newer, keep it
        } else {
          // No active session in DB — clear local only if session expired
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
          chatInput.placeholder = 'Token limit reached for this session';
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

      const { data, error } = await db.rpc('start_ai_session');
      if (error) throw error;
      if (!data?.ok) {
        const msg = data?.error === 'LIMIT_REACHED'
          ? `No sessions left this month. Resets ${formatPeriodEnd(data.resets_at)}.`
          : data?.error === 'NOT_AUTHENTICATED'
            ? 'Please log in to use AI chat.'
            : 'Could not start session. Please try again.';
        showSessionError(msg);
        return false;
      }

      activeSession = data.session;
      sessionUsage = data.usage;
      // Keep local counts if RPC returned zeros (DB might not be updated yet)
      if (activeSession.messages_count === 0 && activeSession.tokens_used === 0) {
        // Use locally cached values instead
        const cached = loadSessionState();
        if (cached?.activeSession?.id === activeSession.id) {
          activeSession.messages_count = cached.activeSession.messages_count || 0;
          activeSession.tokens_used = cached.activeSession.tokens_used || 0;
          estimatedTokensUsed = cached.estimatedTokensUsed || 0;
        } else {
          estimatedTokensUsed = 0;
        }
      } else {
        estimatedTokensUsed = activeSession.tokens_used || 0;
      }
      api.setAccessToken(token);
      updateSessionPanel();
      saveSessionState();
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
  // 120,000 tokens = $0.018 → $0.00000015 per token
  // PKR rate (update periodically)
  const USD_TO_PKR = 280;
  const COST_PER_TOKEN_USD = 0.018 / 120000;

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
        <div class="session-idle-hint">Send a message to start a 30 min session</div>
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
        activeSession = null;
        estimatedTokensUsed = 0;
        stopStudyTimer(); // ← stop counting study time
        clearSessionState();
        updateSessionPanel();
      }
    }, 1000);
  }

  function updateTokensAfterResponse(inputText, outputText) {
    if (!activeSession) return;
    const inputTk = estimateInputTokens(inputText);
    const outputTk = estimateOutputTokens(outputText);
    estimatedTokensUsed += inputTk + outputTk;
    activeSession.tokens_used = estimatedTokensUsed;
    activeSession.messages_count = (activeSession.messages_count || 0) + 1;
    updateSessionPanel();
    saveSessionState();
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

  // ── Send / Stop ──
  async function handleSend() {
    const text = chatInput.value.trim();
    if (!text || isStreaming) return;

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
    const estInput = estimateInputTokens(text + (studentContext ? JSON.stringify(studentContext) : ''));
    if (estimatedTokensUsed + estInput >= TOKEN_LIMIT) {
      showSessionError(`Token limit reached (${formatTokens(TOKEN_LIMIT)}). Wait for the next session.`);
      return;
    }

    chatInput.value = '';
    autoResize();
    btnSend.disabled = true;
    chatInput.disabled = true;

    if (welcome.style.display !== 'none') {
      welcome.style.display = 'none';
      messagesList.style.display = 'flex';
    }

    appendMessage('user', text);
    messages.push({ role: 'user', content: text });
    scrollToBottom();

    isStreaming = true;
    btnSend.style.display = 'none';
    btnStop.style.display = 'flex';

    const streamDiv = createStreamingMessage();
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

    const systemPrompt = buildSystemPrompt() + textbookContext;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
    ];

    let fullResponse = '';
    const selectedProviderIndex = getActivePersona().providerIndex;

    // Pass session ID and auth token to API
    api.setSessionId(activeSession?.id || null);
    api.setAccessToken(getAccessToken());

    try {
      for await (const chunk of api.streamChat(apiMessages, selectedProviderIndex)) {
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
        updateStreamingMessage(streamDiv, fullResponse);
        scrollToBottom();
      }

      finalizeStreamingMessage(streamDiv, fullResponse);
      messages.push({ role: 'assistant', content: fullResponse });
      updateTokensAfterResponse(text, fullResponse);
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
        handleSend();
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
          { role: 'user', content: 'Your previous response was cut off. Please continue from where you left off. Do not repeat what was already said — just continue the explanation.' },
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
            scrollToBottom();
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
