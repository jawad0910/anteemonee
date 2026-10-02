/* Anteemonee AI Classroom — client module.
 *
 * A classroom is topic-driven, not scheduled: the student picks a topic,
 * a subject and a board, and the AI builds a slide deck plus a live class.
 *
 * Phase 1 (this file): identity, the one-time AI-classmate names setup,
 * and classroom creation. The room, deck and voice live in later phases
 * but the room is entered through goToRoom() so the flow never changes.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';

  // The three AI classmates: two girls, one boy. Voices are Gemini prebuilt
  // voices served by the existing voice-tts function, so each speaker is
  // audibly distinct.
  var DEFAULT_STUDENTS = [
    { name: '', voice: 'Leda', gender: 'girl' },
    { name: '', voice: 'Aoede', gender: 'girl' },
    { name: '', voice: 'Puck', gender: 'boy' }
  ];

  var TUTOR = { name: 'Ms. Nida', voice: 'Nida', gender: 'female' };

  var state = {
    user: null,
    students: null,     // persisted AI classmates, or null when never set
    subjects: [],
    boards: [],
    boardId: 30,        // Punjab Board is the only board with ingested textbooks
    subjectId: null,
    classroom: null
  };

  // app.js declares `let db` at the top level of a classic script, which lands
  // in the global lexical scope and NOT on window. Read the bare binding.
  function getDb() {
    try {
      if (typeof db !== 'undefined' && db) return db;
    } catch (_) {}
    try {
      if (window.db) return window.db;
    } catch (_) {}
    return null;
  }

  function el(id) { return document.getElementById(id); }

  function accessToken() {
    try {
      var raw = localStorage.getItem('sb-zkuytvjeqkpexcbyoyhz-auth-token');
      if (raw) return (JSON.parse(raw) || {}).access_token || null;
    } catch (_) {}
    return null;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, kind) {
    var t = el('cl-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'cl-toast is-visible' + (kind ? ' is-' + kind : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.className = 'cl-toast'; }, 4200);
  }

  /* ── identity ────────────────────────────────────────────────────────── */

  // Ask Supabase directly rather than trusting the app.js `currentUser`
  // global: that global is only populated by the initial page-load check, so
  // it stays null if the session is established later on this same page.
  async function sessionUser() {
    var c = getDb();
    if (!c || !c.auth) return null;
    try {
      var res = await c.auth.getSession();
      var s = res && res.data && res.data.session;
      return (s && s.user) || null;
    } catch (_) {
      return null;
    }
  }

  async function waitForAuth() {
    for (var i = 0; i < 40; i++) {
      var u = await sessionUser();
      if (u) return u;
      if (window.__authReady === true) {
        // app.js finished its own check; fall back to its global once.
        return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
      }
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    return null;
  }

  /* ── AI classmate names (one time per user) ──────────────────────────── */

  async function loadMyStudents() {
    var c = getDb();
    if (!c || !state.user) return null;
    var res = await c.from('classroom_student_names')
      .select('students')
      .eq('user_id', state.user.id)
      .maybeSingle();
    if (res.error) { console.warn('[Classroom] names load failed', res.error); return null; }
    var rows = res.data && res.data.students;
    if (!Array.isArray(rows) || rows.length !== 3) return null;
    if (!rows.every(function (r) { return r && String(r.name || '').trim(); })) return null;
    return rows;
  }

  async function saveMyStudents(students) {
    var c = getDb();
    if (!c || !state.user) return false;
    var payload = {
      user_id: state.user.id,
      students: students,
      updated_at: new Date().toISOString()
    };
    var res = await c.from('classroom_student_names')
      .upsert(payload, { onConflict: 'user_id' });
    if (res.error) { console.warn('[Classroom] names save failed', res.error); return false; }
    state.students = students;
    return true;
  }

  /* ── reference data ──────────────────────────────────────────────────── */

  // Only subjects that actually have chapters, otherwise a classroom could be
  // created for a book the AI cannot read.
  //
  // Counted from the chapters table (tens of rows) rather than book_pages
  // (thousands, and PostgREST caps a select at 1000 rows, which silently
  // hides most books).
  //
  // The subjects table holds duplicate names (Chemistry 10 and 13, Physics 9
  // and 17, Computer Science 16 and 22) because each education system gets
  // its own row, so collapse by name and keep the id with the most chapters.
  async function loadSubjects() {
    var c = getDb();
    if (!c) return [];

    var chRes = await c.from('chapters').select('subject_id');
    if (chRes.error) { console.warn('[Classroom] chapters load failed', chRes.error); return []; }
    var counts = {};
    (chRes.data || []).forEach(function (r) {
      if (r.subject_id == null) return;
      counts[r.subject_id] = (counts[r.subject_id] || 0) + 1;
    });
    var ids = Object.keys(counts);
    if (!ids.length) { state.subjects = []; return []; }

    var subjRes = await c.from('subjects').select('id,name');
    if (subjRes.error) { console.warn('[Classroom] subjects load failed', subjRes.error); return []; }

    var byName = {};
    (subjRes.data || []).forEach(function (s) {
      var n = counts[s.id];
      if (!n) return;
      if (!byName[s.name] || n > byName[s.name].chapters) {
        byName[s.name] = { id: s.id, name: s.name, chapters: n };
      }
    });

    state.subjects = Object.keys(byName)
      .map(function (k) { return byName[k]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    return state.subjects;
  }

  async function loadBoards() {
    var c = getDb();
    if (!c) return [];
    var res = await c.from('boards').select('id,name').order('id');
    state.boards = res.data || [];
    return state.boards;
  }

  /* ── screens ─────────────────────────────────────────────────────────── */

  var SCREENS = ['gate', 'dash', 'lobby', 'building', 'room'];

  function showScreen(name) {
    SCREENS.forEach(function (id) {
      var node = el('cl-' + id);
      if (node) node.hidden = (id !== name);
    });
    /* In the room the site chrome is hidden so the class owns the whole page. */
    document.body.classList.toggle('cl-in-room', name === 'room');
    window.scrollTo(0, 0);
  }

  function showNamesModal(show) {
    var m = el('cl-names');
    if (!m) return;
    if (show) {
      renderNamesForm(state.students || DEFAULT_STUDENTS);
      m.hidden = false;
      var first = el('cl-name-0');
      if (first) setTimeout(function () { first.focus(); }, 60);
    } else {
      m.hidden = true;
    }
  }

  /* ── dashboard ───────────────────────────────────────────────────────── */

  function ago(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function statusChip(status) {
    var s = String(status || '');
    return '<span class="cl-status cl-st-' + esc(s) + '">' + esc(s) + '</span>';
  }

  function renderRoomItem(r) {
    var isHost = r.created_by === state.user.id;
    var bits = [];
    bits.push(statusChip(r.status));
    if (r.subject_name) bits.push(esc(r.subject_name));
    if (r.board_name) bits.push(esc(r.board_name));
    if (r.slide_count) bits.push(r.slide_count + ' slides');
    bits.push(ago(r.created_at));

    var actions = '';
    if (r.status === 'ready' || r.status === 'live') {
      actions += '<button type="button" class="cl-btn cl-btn-ghost cl-btn-sm" data-join="' + esc(r.id) + '">Join</button>';
    }
    if (isHost && r.status !== 'ended' && r.status !== 'failed') {
      actions += '<button type="button" class="cl-btn cl-btn-ghost cl-btn-sm" data-end="' + esc(r.id) + '">End</button>';
    }

    return '<div class="cl-item" data-room="' + esc(r.id) + '">'
      + '<div class="cl-item-body">'
      + '<p class="cl-item-topic">' + esc(r.topic) + '</p>'
      + '<div class="cl-item-meta">' + bits.join('<span aria-hidden="true">&middot;</span>') + '</div>'
      + '</div>'
      + (actions ? '<div class="cl-item-actions">' + actions + '</div>' : '')
      + '</div>';
  }

  function renderDash(rooms) {
    var open = [];
    var done = [];
    (rooms || []).forEach(function (r) {
      if (r.status === 'ended' || r.status === 'failed') done.push(r);
      else open.push(r);
    });

    var cur = el('cl-current');
    if (cur) {
      cur.innerHTML = open.length
        ? open.map(renderRoomItem).join('')
        : '<div class="cl-empty">No classrooms yet. Start one on any topic.</div>';
    }
    var hist = el('cl-history');
    if (hist) {
      hist.innerHTML = done.length
        ? done.map(renderRoomItem).join('')
        : '<div class="cl-empty">Finished classrooms will appear here.</div>';
    }

    var sub = el('cl-dash-sub');
    if (sub) {
      sub.textContent = open.length
        ? 'You have ' + open.length + ' classroom' + (open.length === 1 ? '' : 's') + ' in progress.'
        : 'Pick a classroom, or start a new one on any topic.';
    }
  }

  async function loadRooms() {
    var c = getDb();
    if (!c || !state.user) return [];
    // RLS already limits this to rooms the user hosts or has joined.
    var res = await c
      .from('classrooms')
      .select('id,topic,subject_id,board_id,created_by,status,slide_count,created_at,subject:subjects(name),board:boards(name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (res.error) { console.warn('[Classroom] rooms load failed', res.error); return []; }
    return (res.data || []).map(function (r) {
      return {
        id: r.id,
        topic: r.topic,
        status: r.status,
        slide_count: r.slide_count,
        created_by: r.created_by,
        created_at: r.created_at,
        subject_name: (r.subject && r.subject.name) || '',
        board_name: (r.board && r.board.name) || '',
      };
    });
  }

  async function refreshDash() {
    renderDash(await loadRooms());
  }

  async function endClassroom(id, btn) {
    var c = getDb();
    if (!c) return;
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Ending…'; }
    var res = await c.from('classrooms').update({ status: 'ended' }).eq('id', id);
    if (res.error) {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      toast('Could not end that classroom.', 'error');
      return;
    }
    await refreshDash();
    toast('Classroom ended.');
  }

  function onDashClick(e) {
    var join = e.target.closest('[data-join]');
    if (join) { goToRoom(join.getAttribute('data-join')); return; }
    var end = e.target.closest('[data-end]');
    if (end) { endClassroom(end.getAttribute('data-end'), end); }
  }
  // "New classroom" asks for the classmate names only the first time.
  async function startNewClassroom() {
    var names = await loadMyStudents();
    if (names) {
      state.students = names;
      await renderLobby();
      showScreen('lobby');
      return;
    }
    showNamesModal(true);
  }

  var GENDER_ICON = {
    girl: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><line x1="12" y1="14" x2="12" y2="21"/><line x1="8.5" y1="21" x2="15.5" y2="21"/></svg>',
    boy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="14" r="5"/><line x1="14" y1="10.5" x2="20" y2="4.5"/><polyline points="14.5 4.5 20 4.5 20 10"/></svg>'
  };

  var INPUT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

  function renderNamesForm(students) {
    var wrap = el('cl-names-grid');
    if (!wrap) return;
    wrap.innerHTML = students.map(function (s, i) {
      var g = s.gender === 'boy' ? 'boy' : 'girl';
      var word = g === 'boy' ? 'Male' : 'Female';
      return '<div class="cl-name-row">'
        + '<label class="cl-name-label" for="cl-name-' + i + '">Classmate ' + (i + 1) + '</label>'
        + '<span class="cl-input-wrap">' + INPUT_ICON
        + '<input id="cl-name-' + i + '" class="cl-input" type="text" maxlength="24" '
        + 'placeholder="Enter a name" autocomplete="off">'
        + '<span class="cl-input-gender cl-gender-' + g + '" title="' + word + '" '
        + 'aria-label="' + word + '">' + (GENDER_ICON[g] || '') + '</span>'
        + '</span>'
        + '</div>';
    }).join('');
  }

  function openNamesSetup() {
    showNamesModal(true);
  }

  function collectNames() {
    return DEFAULT_STUDENTS.map(function (base, i) {
      var node = el('cl-name-' + i);
      return {
        name: node ? String(node.value || '').trim() : '',
        voice: base.voice,
        gender: base.gender
      };
    });
  }

  async function submitNames() {
    var students = collectNames();
    var blank = students.filter(function (s) { return !s.name; }).length;
    if (blank) { toast('Please name all three classmates.', 'error'); return; }
    var dupes = new Set(students.map(function (s) { return s.name.toLowerCase(); }));
    if (dupes.size !== 3) { toast('Please use three different names.', 'error'); return; }

    var btn = el('cl-names-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    var ok = await saveMyStudents(students);
    if (!ok) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save and continue'; }
      toast('Could not save names. Check your connection.', 'error');
      return;
    }
    showNamesModal(false);
    // Subjects and boards load before the form is useful, so the button stays
    // in its loading state until there is somewhere to go.
    await renderLobby();
    showScreen('lobby');
  }

  function renderStudentStrip() {
    var wrap = el('cl-my-students');
    if (!wrap || !state.students) return;
    wrap.innerHTML = state.students.map(function (s, i) {
      return '<span class="cl-chip"><span class="cl-chip-dot" data-voice="' + esc(s.voice) + '"></span>' + esc(s.name) + '</span>';
    }).join('')
      + '<button type="button" class="cl-linkbtn" id="cl-rename">Change names</button>';
    var btn = el('cl-rename');
    if (btn) btn.addEventListener('click', openNamesSetup);
  }

  function renderLobbyForm() {
    var subj = el('cl-subject');
    if (subj) {
      subj.innerHTML = state.subjects.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
      }).join('');
      if (state.subjectId) subj.value = String(state.subjectId);
    }
    var board = el('cl-board');
    if (board) {
      board.innerHTML = state.boards.map(function (b) {
        return '<option value="' + b.id + '"' + (String(b.id) === String(state.boardId) ? ' selected' : '') + '>'
          + esc(b.name) + (String(b.id) === '30' ? ' — textbook available' : '') + '</option>';
      }).join('');
    }
    updateBoardNote();
  }

  function updateBoardNote() {
    var note = el('cl-board-note');
    var sel = el('cl-board');
    if (!note || !sel) return;
    var isPunjab = String(sel.value) === '30';
    note.textContent = isPunjab
      ? 'Your full Punjab textbook is used to build the slides.'
      : 'Only the Punjab textbook is available, so slides are built from it and explained for your board.';
    note.classList.toggle('is-warn', !isPunjab);
  }

  async function renderLobby() {
    await Promise.all([loadSubjects(), loadBoards()]);
    renderLobbyForm();
    renderStudentStrip();
    // A previous attempt may have left the button disabled mid-create.
    var cb = el('cl-create');
    if (cb) { cb.disabled = false; cb.textContent = 'Create classroom'; }
  }

  /* ── create ──────────────────────────────────────────────────────────── */

  async function createClassroom() {
    var c = getDb();
    if (!c) { toast('Database unavailable.', 'error'); return; }

    var topic = String((el('cl-topic') || {}).value || '').trim();
    var subjectId = (el('cl-subject') || {}).value;
    var boardId = (el('cl-board') || {}).value;
    if (topic.length < 2) { toast('Enter a topic to study.', 'error'); return; }
    if (!subjectId) { toast('Pick a subject.', 'error'); return; }

    var btn = el('cl-create');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    showScreen('building');
    setBuildingStatus('Reading your topic and searching the textbook…');

    try {
      var subjectName = (state.subjects.find(function (s) { return String(s.id) === String(subjectId); }) || {}).name || '';
      var boardName = (state.boards.find(function (b) { return String(b.id) === String(boardId); }) || {}).name || '';

      var res = await c.from('classrooms').insert({
        topic: topic,
        subject_id: Number(subjectId),
        board_id: Number(boardId),
        created_by: state.user.id,
        status: 'building'
      }).select('id').single();
      if (res.error) throw res.error;

      var roomId = res.data.id;
      // The host is always a member of their own room.
      await c.from('classroom_members').insert({
        classroom_id: roomId, user_id: state.user.id, role: 'host', display_name: hostName()
      });

      state.classroom = { id: roomId, topic: topic, subject: subjectName, board: boardName, status: 'building' };
      setBuildingStatus('Topic: ' + topic + ' · ' + subjectName);
      goToRoom(roomId);
    } catch (err) {      console.warn('[Classroom] create failed', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Create classroom'; }
      setBuildingStatus('Could not create the classroom: ' + ((err && err.message) || 'unknown error'));
      showScreen('dash');
      await refreshDash();
      toast('Could not create the classroom.', 'error');
    }
  }

  function hostName() {
    try {
      if (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.username) return currentProfile.username;
    } catch (_) {}
    try {
      if (typeof currentUser !== 'undefined' && currentUser) {
        var meta = currentUser.user_metadata || {};
        var n = meta.full_name || meta.name;
        if (n) return String(n).trim().split(/\s+/)[0];
        return (currentUser.email || 'Student').split('@')[0];
      }
    } catch (_) {}
    return 'Student';
  }

  function setBuildingStatus(text) {
    var n = el('cl-building-status');
    if (n) n.textContent = text;
  }

  var DECK_FN = 'https://zkuytvjeqkpexcbyoyhz.supabase.co/functions/v1/ai-classroom-deck';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // One attempt at asking the function to build the deck. A slow or dropped
  // response is not a failure: the function writes status='ready' when it
  // finishes, which is what we actually wait for.
  function requestDeck(id) {
    var headers = { 'Content-Type': 'application/json' };
    var t = accessToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch(DECK_FN, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ classroom_id: id })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (out) {
        if (r.ok && out && out.ok) return { ok: true, out: out };
        return { ok: false, error: (out && out.error) || ('deck build returned ' + r.status) };
      });
    }, function (e) {
      return { ok: false, error: (e && e.message) || 'network error' };
    });
  }

  // Build the deck if the room does not have one yet, then enter the room.
  // Building a class takes a while, so this waits on the classroom row rather
  // than on the HTTP response: a slow build keeps the loading screen up instead
  // of telling the student it failed.
  async function ensureDeck(id) {
    var c = getDb();
    if (!c) throw new Error('database unavailable');

    var readStatus = async function () {
      var res = await c.from('classrooms')
        .select('status,deck_path,error_text')
        .eq('id', id)
        .maybeSingle();
      return (res && res.data) || null;
    };

    var row = await readStatus();
    if (row && row.status === 'ready' && row.deck_path) return true;
    if (row && row.status === 'failed') throw new Error(row.error_text || 'the last attempt failed');

    setBuildingStatus('Searching your textbook and the web…');
    var attempt = requestDeck(id);

    var startedAt = Date.now();
    var deadline = startedAt + 240000;   // four minutes is far more than a build needs
    var lastError = '';
    var tries = 0;

    while (Date.now() < deadline) {
      var waited = Math.round((Date.now() - startedAt) / 1000);
      setBuildingStatus('Building your classroom… ' + waited + 's');

      var result = await Promise.race([attempt, sleep(4000)]);
      if (result && result.ok) return true;
      if (result && result.error) lastError = result.error;

      // The request itself failed, so nothing is being built. Try again.
      if (result && !result.ok) {
        tries++;
        if (tries < 3 && Date.now() < deadline - 30000) {
          await sleep(4000);
          attempt = requestDeck(id);
          continue;
        }
      }

      // Otherwise the build is running: follow the row until it lands.
      var now = await readStatus();
      if (now && now.status === 'ready' && now.deck_path) return true;
      if (now && now.status === 'failed') throw new Error(now.error_text || 'the build failed');
    }

    var tail = await readStatus();
    if (tail && tail.status === 'ready' && tail.deck_path) return true;
    throw new Error(lastError || 'the classroom took too long to build');
  }

  // Phase 3 fills this in: the room takes over from here.
  async function goToRoom(id) {
    state.pendingRoom = id;
    showScreen('building');
    setBuildingStatus('Preparing your classroom…');
    try {
      await ensureDeck(id);
      var st = el('cl-room-state');
      if (st) st.textContent = 'Joining…';
      showScreen('room');
      if (window.ClassroomRoom) await window.ClassroomRoom.enter(id);
    } catch (err) {
      var msg = (err && err.message) || 'unknown error';
      setBuildingStatus('Could not open the classroom: ' + msg);
      showScreen('dash');
      await refreshDash();
      toast('Could not open the classroom.', 'error');
    }
  }

  /* ── init ────────────────────────────────────────────────────────────── */

  var started = false;

  // A guest arriving from an invite link has no dashboard entry. The lookup and
  // the seat claim go through a SECURITY DEFINER function because the normal
  // read policy hides the room from anyone who is not already a member.
  async function joinFromInvite() {
    var c = getDb();
    if (!c || !state.user) return false;
    var m = /[?&]join=([a-z0-9]+)/i.exec(location.search || '');
    if (!m) return false;

    showScreen('building');
    setBuildingStatus('Joining the class…');

    var res = await c.rpc('join_classroom_by_invite', { p_code: m[1] });
    if (res.error || !res.data || !res.data.length) {
      showScreen('dash');
      await refreshDash();
      toast((res.error && res.error.message) || 'That classroom link is not valid.', 'error');
      return false;
    }
    goToRoom(res.data[0].id);
    return true;
  }

  async function init() {
    if (started) return;
    if (!getDb()) { showScreen('gate'); return; }
    showScreen('gate');
    // Reuse a user already handed to us by the auth listener.
    if (!state.user) state.user = await waitForAuth();
    if (!state.user) {
      var g = el('cl-gate');
      if (g) g.innerHTML = '<div class="cl-gate-box"><div class="cl-lock-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>'
        + '<h2>Sign in to join a classroom</h2>'
        + '<p>You need an Anteemonee account so your classmates and transcript are saved. Log in or create a free account to continue.</p>'
        + '<div class="cl-gate-actions"><a class="btn-login" href="login.html">Log in</a><a class="btn-signup" href="signup.html">Sign Up</a></div></div>';
      return;
    }
    started = true;

    // Invite link takes priority over the dashboard.
    try {
      if (await joinFromInvite()) return;
    } catch (e) {
      console.warn('[Classroom] invite join failed', e);
    }

    // Names are only needed when a classroom is actually being created, so a
    // returning user goes straight to the dashboard.
    state.students = await loadMyStudents();
    await refreshDash();
    showScreen('dash');
  }

  function watchAuth() {
    var c = getDb();
    if (!c || !c.auth || typeof c.auth.onAuthStateChange !== 'function') return;
    try {
      c.auth.onAuthStateChange(function (event, session) {
        // Signing in after the page loaded (or a token refresh) must still
        // take us off the sign-in gate.
        if (session && session.user && !started) {
          state.user = session.user;
          init();
        }
      });
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    var save = el('cl-names-save');
    if (save) save.addEventListener('click', submitNames);
    var close = el('cl-names-close');
    if (close) {
      close.addEventListener('click', function () {
        showNamesModal(false);
        showScreen('dash');
      });
    }
    var create = el('cl-create');
    if (create) create.addEventListener('click', createClassroom);
    var topic = el('cl-topic');
    if (topic) {
      topic.addEventListener('keydown', function (e) { if (e.key === 'Enter') createClassroom(); });
    }
    var board = el('cl-board');
    if (board) board.addEventListener('change', updateBoardNote);

    var newBtn = el('cl-new');
    if (newBtn) newBtn.addEventListener('click', startNewClassroom);
    var cur = el('cl-current');
    if (cur) cur.addEventListener('click', onDashClick);
    var hist = el('cl-history');
    if (hist) hist.addEventListener('click', onDashClick);
    var back = el('cl-lobby-back');
    if (back) {
      back.addEventListener('click', function () { showScreen('dash'); });
    }
    var leave = el('cl-room-leave');
    if (leave) {
      leave.addEventListener('click', async function () {
        // Leaving is how a class ends, so the button says so.
        leave.textContent = 'Ending…';
        leave.disabled = true;
        if (window.ClassroomRoom) window.ClassroomRoom.stop();
        showScreen('dash');
        await refreshDash();
      });
    }
    var askForm = el('cl-ask-form');
    if (askForm) {
      askForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var input = el('cl-ask');
        if (!input) return;
        var v = input.value.trim();
        if (!v) return;
        input.value = '';
        if (window.ClassroomRoom) window.ClassroomRoom.askTutor(v);
      });
    }

    watchAuth();
    init();
  });

  window.Classroom = {
    state: state,
    init: init,
    refreshDash: refreshDash,
    getStudents: function () { return state.students; },
    getTutor: function () { return TUTOR; },
    goToRoom: goToRoom
  };
})();
