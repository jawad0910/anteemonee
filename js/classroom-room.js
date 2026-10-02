/* Anteemonee AI Classroom — the live room.
 *
 * Plays the generated class script: walks the beat timeline, moves the slides
 * (the viewer has no controls, the AI drives it), speaks each line with that
 * speaker's voice, and writes the transcript.
 *
 * The user can interrupt at any time: playback parks on the current beat, the
 * tutor answers, then the class resumes from exactly where it stopped.
 */
(function () {
  'use strict';

  var room = null;        // the classroom row
  var script = null;      // the class script
  var beatIndex = 0;
  var playing = false;
  var paused = false;
  var resumeFn = null;
  var voiceByName = {};
  var ended = false;
  var me = '';            // this student's display name
  var hostFlag = false;   // this browser is the one driving the class

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getDb() {
    try { if (typeof db !== 'undefined' && db) return db; } catch (_) {}
    try { if (window.db) return window.db; } catch (_) {}
    return null;
  }

  function accessToken() {
    try {
      var raw = localStorage.getItem('sb-zkuytvjeqkpexcbyoyhz-auth-token');
      if (raw) return (JSON.parse(raw) || {}).access_token || null;
    } catch (_) {}
    return null;
  }

  /* ── casting ─────────────────────────────────────────────────────────── */

  function buildCast() {
    voiceByName = {};
    voiceAssignments = {};
    var list = (script.students || []).concat([script.tutor || {}]);
    list.forEach(function (p) {
      if (p && p.name) voiceByName[p.name] = p.voice || 'Kore';
    });
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || '?').charAt(0).toUpperCase();
  }

  function renderTiles() {
    var wrap = el('cl-tiles');
    if (!wrap) return;
    var you = (window.Classroom && Classroom.state.user) || {};
    var youName = (you.user_metadata && (you.user_metadata.full_name || you.user_metadata.name)) || 'You';
    var cast = [
      { name: script.tutor && script.tutor.name, role: 'Tutor', voice: script.tutor && script.tutor.voice, kind: 'ai_tutor' },
    ].concat((script.students || []).map(function (s) {
      return { name: s.name, role: 'Classmate', voice: s.voice, kind: 'ai_student' };
    })).concat([{ name: youName, role: 'You', voice: null, kind: 'user' }]);

    wrap.innerHTML = cast.map(function (c) {
      return '<div class="cl-tile" data-speaker="' + esc(c.name) + '" data-kind="' + esc(c.kind) + '">'
        + '<div class="cl-tile-av" data-voice="' + esc(c.voice || '') + '">' + esc(initials(c.name)) + '</div>'
        + '<div class="cl-tile-meta">'
        + '<span class="cl-tile-name">' + esc(c.name) + '</span>'
        + '<span class="cl-tile-role">' + esc(c.role) + '</span>'
        + '</div>'
        + '<span class="cl-tile-live" aria-hidden="true"></span>'
        + '</div>';
    }).join('');
  }

  // Beat scripts address the tutor as the literal "tutor", while the cast entry
  // holds the display name, so both have to be recognised.
  function tutorName() {
    return (script && script.tutor && script.tutor.name) || 'Ms. Nida';
  }

  function isTutorSpeaker(name) {
    if (!name) return false;
    var n = String(name).trim().toLowerCase();
    return n === 'tutor' || n === String(tutorName()).trim().toLowerCase();
  }

  function setSpeaking(name) {
    var wrap = el('cl-tiles');
    if (!wrap) return;
    wrap.querySelectorAll('.cl-tile').forEach(function (t) {
      t.classList.toggle('is-speaking', t.getAttribute('data-speaker') === name);
    });
  }

  function clearSpeaking() { setSpeaking(null); }

  /* ── transcript ──────────────────────────────────────────────────────── */

  function appendLine(kind, who, text, slide) {
    var box = el('cl-chat');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'cl-msg cl-msg-' + kind;
    row.innerHTML = '<span class="cl-msg-who">' + esc(who) + '</span>'
      + '<span class="cl-msg-text">' + esc(text) + '</span>';
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  // A classmate joining late still sees what was already said.
  async function loadTranscript() {
    var c = getDb();
    if (!c || !room) return;
    var res = await c.from('classroom_messages')
      .select('speaker_kind,speaker_name,body,slide_index,created_at')
      .eq('classroom_id', room.id)
      .order('id', { ascending: true })
      .limit(200);
    if (res.error || !res.data || !res.data.length) return;
    var box = el('cl-chat');
    if (box) box.innerHTML = '';
    res.data.forEach(function (m) {
      appendLine(m.speaker_kind, m.speaker_name, m.body, m.slide_index);
    });
  }

  function saveLine(kind, who, text, slide) {
    var c = getDb();
    if (!c || !room) return;
    var uid = null;
    try {
      var st = window.Classroom && window.Classroom.state;
      uid = (st && st.user && st.user.id) || null;
    } catch (_) {}
    try {
      // supabase-js builders are lazy: nothing is sent until the promise is
      // consumed, so this must be awaited or explicitly started.
      c.from('classroom_messages').insert({
        classroom_id: room.id,
        speaker_kind: kind,
        speaker_name: who,
        user_id: kind === 'user' ? uid : null,
        slide_index: slide == null ? null : slide,
        kind: 'speech',
        body: String(text).slice(0, 900)
      }).then(function () {}, function (e) {
        console.warn('[Classroom] transcript save failed', e && e.message);
      });
    } catch (e) {
      console.warn('[Classroom] transcript save threw', e && e.message);
    }
  }

  /* ── speech ──────────────────────────────────────────────────────────── */
  /* Narration uses the browser's own voices, the same engine the AI chat
     "speak" button uses. Nothing is generated per line, so a class never waits
     on a network round trip and there is no TTS quota to exhaust. */

  // Chrome reports an empty voice list until the first voiceschanged event.
  var voicesReady = null;
  function localVoices() {
    try {
      var synth = window.speechSynthesis;
      if (!synth || !synth.getVoices) return Promise.resolve([]);
      var now = synth.getVoices();
      if (now && now.length) return Promise.resolve(now);
      if (!voicesReady) {
        voicesReady = new Promise(function (resolve) {
          var settled = false;
          function finish() {
            if (settled) return;
            settled = true;
            try { synth.removeEventListener('voiceschanged', finish); } catch (_) {}
            try { resolve(synth.getVoices() || []); } catch (_) { resolve([]); }
          }
          try { synth.addEventListener('voiceschanged', finish); } catch (_) {}
          setTimeout(finish, 1200);
        });
      }
      return voicesReady;
    } catch (_) { return Promise.resolve([]); }
  }

  // A per-speaker voice preference plus pitch, so the three classmates and the
  // tutor stay distinguishable even when the OS only exposes a couple of voices.
  // The teacher is a woman, so her list only holds female voices.
  var VOICE_PROFILES = {
    Leda:   { names: ['Samantha', 'Karen', 'Victoria', 'Fiona', 'Tessa', 'Serena', 'Google UK English Female', 'Microsoft Sonia', 'Microsoft Hazel'], pitch: 1.18, rate: 1.0 },
    Aoede:  { names: ['Moira', 'Allison', 'Ava', 'Susan', 'Zira', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny'], pitch: 1.32, rate: 1.02 },
    Puck:   { names: ['Daniel', 'Alex', 'Fred', 'Tom', 'Rishi', 'Google UK English Male', 'Microsoft David', 'Microsoft Mark'], pitch: 0.82, rate: 0.98 },
    Nida:   { names: ['Serena', 'Catherine', 'Samantha', 'Karen', 'Fiona', 'Victoria', 'Tessa', 'Google UK English Female', 'Microsoft Sonia', 'Microsoft Catherine', 'Microsoft Hazel'], pitch: 1.04, rate: 0.99 },
    // Scripts generated before the teacher had her own key still say Charon.
    Charon: { names: ['Serena', 'Catherine', 'Samantha', 'Karen', 'Fiona', 'Victoria', 'Tessa', 'Google UK English Female', 'Microsoft Sonia', 'Microsoft Catherine', 'Microsoft Hazel'], pitch: 1.04, rate: 0.99 }
  };

  function voiceProfile(key) {
    return VOICE_PROFILES[key] || { names: [], pitch: 1, rate: 1 };
  }

  function speechLang(text) {
    if (/[\u0600-\u06FF]/.test(String(text || ''))) return 'ur-PK';
    var page = '';
    try { page = document.documentElement.lang || ''; } catch (_) {}
    var browser = '';
    try { browser = navigator.language || ''; } catch (_) {}
    var lang = page || browser || 'en-US';
    return /^ur\b/i.test(lang) ? 'ur-PK' : lang;
  }

  function pickVoice(voices, lang, profile, assigned) {
    if (!voices || !voices.length) return null;
    var local = voices.filter(function (v) { return v.localService === true; });
    var all = local.length ? local : voices;
    // Keep speakers on different voices where the OS offers enough of them.
    // `assigned` maps speaker -> voice name, so read the claimed names out of it.
    var claimed = assigned ? Object.keys(assigned).map(function (k) { return assigned[k]; }) : [];
    var pool = claimed.length ? all.filter(function (v) { return claimed.indexOf(String(v.name || '')) === -1; }) : all;
    if (!pool.length) pool = all;
    var nameOf = function (v) { return String(v.name || '').toLowerCase(); };
    // Substring match: platforms name the same voice "Aria", "Microsoft Aria
    // Online (Natural)", "Google UK English Female", so exact names never hit.
    for (var i = 0; i < profile.names.length; i++) {
      var want = profile.names[i].toLowerCase();
      var hit = pool.find(function (v) { return nameOf(v).indexOf(want) !== -1; });
      if (hit) return hit;
    }
    var target = String(lang || '').toLowerCase();
    var base = target.split('-')[0];
    return pool.find(function (v) { return v.lang && v.lang.toLowerCase() === target; })
      || pool.find(function (v) { return v.lang && v.lang.toLowerCase().split('-')[0] === base; })
      || null;
  }

  // Long utterances are cut off by some engines around 200 characters, so very
  // long lines are spoken as sentence-sized pieces. A normal line is left in one
  // piece on purpose: a new utterance restarts the intonation, which is what
  // makes a voice sound like it changes tone after every full stop.
  var ONE_PIECE_LIMIT = 340;

  function chunkText(text) {
    var whole = String(text || '').trim();
    if (!whole) return [];
    if (whole.length <= ONE_PIECE_LIMIT) return [whole];
    var parts = whole.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [whole];
    var chunks = [];
    parts.forEach(function (part) {
      var current = '';
      String(part).trim().split(/\s+/).filter(Boolean).forEach(function (word) {
        if (current && (current.length + word.length + 1) > 240) {
          chunks.push(current);
          current = word;
        } else {
          current = current ? current + ' ' + word : word;
        }
      });
      if (current) chunks.push(current);
    });
    return chunks;
  }

  // Rough speaking pace, used to hold a beat on screen long enough to read.
  function estimateMs(text) {
    return Math.max(1400, Math.min(20000, (String(text || '').length / 14) * 1000));
  }

  var speechToken = 0;
  var speechResolve = null;
  var speechKeepAlive = null;
  var voiceAssignments = {};   // speaker -> voice name already claimed

  function stopAudio() {
    speechToken++;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
    if (speechKeepAlive) { try { clearInterval(speechKeepAlive); } catch (_) {} speechKeepAlive = null; }
    // Release the awaiting line so a pause or leave is never stuck.
    if (speechResolve) { var r = speechResolve; speechResolve = null; r(); }
  }

  function speakLine(text, speakerKey) {
    var clean = String(text || '').trim();
    if (!clean) return Promise.resolve();
    stopAudio();

    var synth = window.speechSynthesis;
    var Utterance = window.SpeechSynthesisUtterance
      || (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null);
    if (!synth || !Utterance) return Promise.resolve();

    var token = speechToken;
    var profile = voiceProfile(voiceByName[speakerKey] || speakerKey || '');
    var lang = speechLang(clean);
    var chunks = chunkText(clean);
    var started = Date.now();
    var want = estimateMs(clean);
    var index = 0;
    var voice = null;

    return new Promise(function (resolve) {
      speechResolve = resolve;

      function finish() {
        if (token !== speechToken) return;
        speechToken++;
        speechResolve = null;
        if (speechKeepAlive) { try { clearInterval(speechKeepAlive); } catch (_) {} speechKeepAlive = null; }
        var left = want - (Date.now() - started);
        if (left > 0) setTimeout(resolve, left);
        else resolve();
      }

      function next() {
        if (token !== speechToken) return;
        if (index >= chunks.length) { finish(); return; }
        var chunk = chunks[index++];
        var u;
        try { u = new Utterance(chunk); } catch (_) { finish(); return; }
        u.lang = lang;
        u.rate = profile.rate;
        u.pitch = profile.pitch;
        u.volume = 1;
        // The same resolved voice object is reused for every chunk of this line,
        // so the voice can never change halfway through a sentence.
        if (voice) u.voice = voice;
        u.onend = next;
        u.onerror = finish;
        try { if (synth.resume) synth.resume(); synth.speak(u); } catch (_) { finish(); }
      }

      // Engines park long queues and background tabs, so nudge them along.
      try {
        speechKeepAlive = setInterval(function () { try { synth.resume(); } catch (_) {} }, 5000);
      } catch (_) {}

      // The voice is chosen once, before the first chunk is spoken.
      localVoices().then(function (voices) {
        if (token !== speechToken) return;
        voice = pickVoice(voices, lang, profile, voiceAssignments);
        if (voice) voiceAssignments[speakerKey] = String(voice.name || '');
        next();
      });
    });
  }

  function speakBeat(i) {
    var b = script.beats[i];
    if (!b || !b.text) return Promise.resolve();
    return speakLine(b.text, b.speaker);
  }

  /* ── playback ────────────────────────────────────────────────────────── */

  function waitIfPaused() {
    if (!paused) return Promise.resolve();
    return new Promise(function (resolve) { resumeFn = resolve; });
  }

  function pause() {
    if (!playing || paused) return;
    paused = true;
    stopAudio();
    var b = el('cl-room-state');
    if (b) b.textContent = 'Paused — the tutor is listening to you';
  }

  function resume() {
    if (!paused) return;
    paused = false;
    var b = el('cl-room-state');
    if (b) b.textContent = 'Class in progress';
    var fn = resumeFn;
    resumeFn = null;
    if (fn) fn();
  }

  // A classmate breaks in on their own now and then, written by the model from
  // whatever slide is on screen. The request is started while the current line
  // is still being spoken, so the class never waits for it.
  var CHATTER_EVERY = 7;
  var chatterPending = null;
  var chatterTurn = 0;
  var chatterReady = null;

  function startChatter() {
    if (chatterPending) return;
    var students = (script && script.students) || [];
    if (!students.length) return;
    chatterTurn++;
    var who = students[(chatterTurn - 1) % students.length].name;
    chatterPending = askModel({ mode: 'chatter', speaker: who }).then(function (out) {
      chatterPending = null;
      chatterReady = (out && String(out.answer || '').trim()) ? { speaker: who, text: String(out.answer).trim() } : null;
    }, function () {
      chatterPending = null;
      chatterReady = null;
    });
  }

  async function play() {
    if (playing || !script) return;
    playing = true;
    var beats = script.beats || [];
    for (var i = beatIndex; i < beats.length; i++) {
      await waitIfPaused();
      beatIndex = i;
      var b = beats[i];
      if (!b || !b.text) continue;

      setSpeaking(b.speaker);

      // The AI drives the slides; the viewer exposes no controls.
      if ((b.type === 'teach') && b.slide != null) {
        await goToPage(b.slide + 1);
      }

      // Ask for the next spontaneous remark while this line is being spoken.
      var dueChatter = i > 0 && i % CHATTER_EVERY === 0;
      if (dueChatter) startChatter();

      var kind = isTutorSpeaker(b.speaker) ? 'ai_tutor' : 'ai_student';
      sayLine(kind, isTutorSpeaker(b.speaker) ? tutorName() : b.speaker, b.text, b.slide, null);

      await speakBeat(i);
      clearSpeaking();

      // If a remark came back while the tutor was talking, it is spoken next.
      if (dueChatter && chatterPending) await chatterPending;
      if (dueChatter && chatterReady) {
        var got = chatterReady;
        chatterReady = null;
        setSpeaking(got.speaker);
        sayLine('ai_student', got.speaker, got.text, null, nextMsgId());
        await speakLine(got.text, got.speaker);
        clearSpeaking();
      }
    }
    playing = false;
    ended = true;
    setEndedState();
  }

  function setEndedState() {
    ended = true;
    var b = el('cl-room-state');
    if (b) b.textContent = 'Class finished';
    var chip = el('cl-progress-chip');
    if (chip) chip.textContent = 'Finished';
    setUpAskBox();
    // Only the host writes the status: a guest joining a class that has already
    // finished just sees the finished state.
    if (amHost()) endClass({ silent: true });
  }

  /* ── user interjection ───────────────────────────────────────────────── */

  var REPLY_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co/functions/v1/ai-classroom-reply';

  // Every line carries an id so the sender and the echo of it are only ever
  // rendered once, whichever order they arrive in.
  var msgSeq = 0;
  function nextMsgId() {
    msgSeq++;
    return (me || 'anon') + '-' + Date.now().toString(36) + '-' + msgSeq;
  }
  var rendered = {};
  function markRendered(id) {
    if (id) rendered[id] = true;
  }
  function alreadyRendered(id) {
    return !!(id && rendered[id]);
  }

  // Ask the classroom model, grounded in the same textbook pages as the deck.
  // mode 'tutor' is the teacher, 'student' is one named classmate.
  async function askModel(payload) {
    var headers = { 'Content-Type': 'application/json' };
    var t = accessToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    try {
      var r = await fetch(REPLY_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(Object.assign({
          classroom_id: room ? room.id : null,
          asker: whoAmI()
        }, payload))
      });
      var out = await r.json().catch(function () { return {}; });
      if (out && out.answer) return out;
      return null;
    } catch (_) {
      return null;
    }
  }

  function whoAmI() {
    try {
      var u = (window.Classroom && Classroom.state.user) || null;
      if (u) {
        var m = u.user_metadata || {};
        return String(m.full_name || m.name || (u.email || 'You').split('@')[0]);
      }
    } catch (_) {}
    return 'You';
  }

  // If the student names a classmate, that classmate answers. Otherwise the
  // teacher does. This is what makes "Ayesha, what do you think?" reach Ayesha.
  function classmateNamedIn(text) {
    var lower = String(text || '').toLowerCase();
    var students = (script && script.students) || [];
    var named = null;
    students.forEach(function (s) {
      var n = String((s && s.name) || '').toLowerCase().trim();
      if (n.length > 2 && lower.indexOf(n) !== -1) named = s.name;
    });
    // The teacher's own name in the text means the student wants the teacher.
    var tn = String(tutorName() || '').toLowerCase().trim();
    if (tn.length > 2 && lower.indexOf(tn) !== -1) return null;
    return named;
  }

  /* ── slides ──────────────────────────────────────────────────────────── */

  function pageCount() {
    return (script && script.slides && script.slides.length) || 0;
  }

  // Moving the class to a slide is one place, so the screen, the database and
  // everyone else's screen can never disagree about which slide is showing.
  async function goToPage(n, opts) {
    if (!window.ClassroomSlides) return false;
    var total = pageCount() || window.ClassroomSlides.pageCount();
    if (!total) return false;
    var page = Math.max(1, Math.min(total, Math.trunc(n) || 1));
    try { await window.ClassroomSlides.showSlide(page); } catch (_) { return false; }
    if (opts && opts.quiet) return true;

    var chip = el('cl-progress-chip');
    if (chip) chip.textContent = 'Slide ' + page + ' of ' + total;
    if (amHost()) {
      window.ClassroomLive.publishState({ slide: page, total: total });
      var c = getDb();
      if (c && room) {
        try {
          c.from('classrooms').update({ current_slide: page - 1 }).eq('id', room.id).then(
            function () {}, function () {}
          );
        } catch (_) {}
      }
    }
    return true;
  }

  // "go to slide 5", "next slide", "show me the last one" and friends. Returns the
  // page it moved to, or 0 when the message was not about the slides at all.
  function slideRequest(text) {
    var t = String(text || '').toLowerCase().trim();
    if (!t) return 0;
    if (!/\bslide|page|diagram|figure|back|next|previous|again|skip|return|revisit|start over/.test(t)) return 0;
    // Needs to actually be a request, not a question about slide content.
    if (!/\b(go|show|open|switch|change|move|jump|take|bring|display|skip|back|next|previous|again|return|revisit|see|start)\b/.test(t)) return 0;

    var total = pageCount() || (window.ClassroomSlides ? window.ClassroomSlides.pageCount() : 0);
    var current = window.ClassroomSlides ? window.ClassroomSlides.currentSlide() : 1;
    if (!total) return 0;

    var n = 0;
    var digits = t.match(/\b(?:slide|page)\s*(?:number\s*)?(\d{1,3})\b/);
    if (digits) n = parseInt(digits[1], 10);
    else if (/\blast\b|\bfinal\b|\bending\b/.test(t)) n = total;
    else if (/\bfirst\b|\bbeginning\b|\bstart over\b|\bfrom the start\b/.test(t)) n = 1;
    else if (/\bnext\b|\bforward\b|\bahead\b/.test(t)) n = current + 1;
    else if (/\b(previous|prev|back|go back)\b/.test(t)) n = current - 1;
    else if (/\bsame\b|\bthis one\b|\brepeat\b/.test(t)) n = current;
    else return 0;

    if (n < 1) n = 1;
    if (n > total) n = total;
    return n;
  }

  function sayLine(kind, name, text, slide, id) {
    markRendered(id);
    appendLine(kind, name, text, slide);
    saveLine(kind, name, text, slide);
    if (amHost()) {
      window.ClassroomLive.publishLine({ speaker: name, text: text, kind: kind, slide: slide, id: id });
    }
  }

  // The whole path for one question: render it, work out who should answer,
  // move the slides if the student asked for that, and speak the answer.
  async function answerQuestion(text, asker, opts) {
    var options = opts || {};
    var asked = asker || whoAmI();
    var page = slideRequest(text);

    if (page) {
      var moved = await goToPage(page);
      if (moved) {
        var tn0 = tutorName();
        var line = 'Of course, we are on slide ' + page + ' now.';
        setSpeaking(tn0);
        sayLine('ai_tutor', tn0, line, page - 1, nextMsgId());
        await speakLine(line, tn0);
        clearSpeaking();
        return true;
      }
    }

    var named = options.forceTutor ? null : classmateNamedIn(text);
    var out = await askModel({
      mode: named ? 'student' : 'tutor',
      speaker: named || '',
      question: text
    });

    if (!out) {
      // The model could not answer. Say so rather than dropping the question.
      var tnX = tutorName();
      var fallback = 'I could not get an answer to that one. Ask me again in a moment.';
      sayLine('ai_tutor', tnX, fallback, null, nextMsgId());
      return true;
    }

    var speaker = named || out.speaker || tutorName();
    var kind = named ? 'ai_student' : 'ai_tutor';
    var line = String(out.answer || '').trim();
    if (!line) return false;
    setSpeaking(speaker);
    sayLine(kind, speaker, line, null, nextMsgId());
    await speakLine(line, speaker);
    clearSpeaking();
    return true;
  }

  // Playback parks on the current beat so the class resumes where it stopped.
  // Works the same after the lesson has finished: there is nothing to resume,
  // but the student can keep asking.
  async function askTutor(question) {
    if (!question || !String(question).trim()) return;
    var text = String(question).trim();
    var id = nextMsgId();

    // A guest hands the question to the host, but still sees it right away
    // instead of waiting for the message to come back around.
    var isHost = amHost();
    if (!isHost) {
      markRendered(id);
      appendLine('user', me || 'You', text, null);
      if (window.ClassroomLive) window.ClassroomLive.say(text, 'text', id);
      return;
    }

    markRendered(id);
    appendLine('user', me || 'You', text, null);
    saveLine('user', me || 'You', text, null);

    pause();
    try {
      await answerQuestion(text, me || 'You');
    } catch (e) {
      console.warn('[Classroom] answer failed', e);
    }
    resume();
  }

  /* ── voice input ─────────────────────────────────────────────────────── */

  var STT_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co/functions/v1/voice-stt';
  var recorder = null;
  var chunks = [];
  var recStream = null;

  function stopRecording() {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
    recorder = null;
    recStream = null;
    chunks = [];
  }

  // Records a short clip, transcribes it, and asks the class the question.
  async function toggleMic() {
    var btn = el('cl-mic');
    if (recorder && recorder.state === 'recording') {
      stopRecording();
      if (btn) { btn.classList.remove('is-live'); btn.textContent = 'Speak'; }
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var hint = el('cl-live-hint');
      if (hint) hint.textContent = 'Microphone is not available in this browser.';
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      var hint2 = el('cl-live-hint');
      if (hint2) hint2.textContent = 'Microphone permission was blocked.';
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(recStream);
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = async function () {
      try { if (recStream) recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      if (!chunks.length) return;
      var blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      var fd = new FormData();
      fd.append('file', blob, 'voice.webm');
      fd.append('model', 'whisper-large-v3-turbo');
      fd.append('language', 'auto');
      fd.append('response_format', 'json');
      var headers = {};
      var t = accessToken();
      if (t) headers.Authorization = 'Bearer ' + t;
      try {
        var r = await fetch(STT_URL, { method: 'POST', headers: headers, body: fd });
        var out = await r.json().catch(function () { return {}; });
        var said = (out && (out.text || out.transcript)) || '';
        if (said) {
          var input = el('cl-ask');
          if (input) input.value = said;
          askTutor(said);
        }
      } catch (_) {
        var h = el('cl-live-hint');
        if (h) h.textContent = 'Could not hear that. Try again.';
      }
    };
    recorder.start();
    if (btn) { btn.classList.add('is-live'); btn.textContent = 'Listening…'; }
  }

  /* ── entry ───────────────────────────────────────────────────────────── */

  function inviteLink() {
    if (!room || !room.invite_code) return '';
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'ai-classroom.html?join=' + room.invite_code;
  }

  async function enter(roomId) {
    var c = getDb();
    if (!c) { el('cl-room-state').textContent = 'Database unavailable'; return; }

    var res = await c.from('classrooms')
      .select('id,topic,subject_id,board_id,status,slide_count,deck_path,class_script,current_slide,created_by,invite_code')
      .eq('id', roomId)
      .maybeSingle();
    if (res.error || !res.data) { el('cl-room-state').textContent = 'Classroom not found'; return; }

    room = res.data;
    script = room.class_script;
    var isHost = !!(window.Classroom && Classroom.state.user && room.created_by === Classroom.state.user.id);
    hostFlag = isHost;

    buildCast();
    renderTiles();
    renderInvite(isHost);

    // Join the live channel before anything else can bail out, so classmates
    // are still connected (and can chat) even if the deck has not been built.
    if (window.ClassroomLive) {
      try {
        await window.ClassroomLive.join(roomId, { isHost: isHost });
        wireLive(isHost);
      } catch (e) {
        console.warn('[Classroom] live channel unavailable', e);
        var hint = el('cl-live-hint');
        if (hint) hint.textContent = 'Live sync unavailable — you are watching alone.';
      }
    }

    if (!script || !script.beats || !script.beats.length) {
      el('cl-room-state').textContent = 'This classroom has no class script yet.';
      loadTranscript();
      return;
    }

    if (!isHost) await loadTranscript();

    var deckUrl = room.deck_path ? publicDeckUrl(room.deck_path) : null;
    if (deckUrl && window.ClassroomSlides) {
      try {
        // Register before opening: open() jumps straight to the first slide and
        // would otherwise fire the callback while it is still unset.
        window.ClassroomSlides.onSlide(function (page, total) {
          var chip = el('cl-progress-chip');
          if (chip) chip.textContent = 'Slide ' + page + ' / ' + total;
          if (amHost()) {
            window.ClassroomLive.publishState({ slide: page, total: total });
          }
        });
        window.ClassroomSlides.open(deckUrl, 1).catch(function (e) {
          console.warn('[Classroom] deck failed to open', e);
          var chip = el('cl-progress-chip');
          if (chip) chip.textContent = 'Slides unavailable';
        });
      } catch (e) {
        console.warn('[Classroom] deck failed to open', e);
      }
    }

    var head = el('cl-room-topic');
    if (head) head.textContent = room.topic;
    var sub = el('cl-room-sub');
    if (sub) sub.textContent = (script.subject || '') + (script.board ? ' · ' + script.board : '');
    var st = el('cl-room-state');
    if (st) st.textContent = isHost ? 'Class in progress' : 'Watching the class';

    me = whoAmI();
    setUpAskBox();

    // A class that has already run does not start again, but the student can
    // keep asking questions about it for as long as they like.
    if (room.status === 'ended' || ended) {
      ended = true;
      setEndedState();
      if (!isHost) await loadTranscript();
      var deckEnd = room.deck_path ? publicDeckUrl(room.deck_path) : null;
      if (deckEnd && window.ClassroomSlides) {
        try {
          await window.ClassroomSlides.open(deckEnd, (room.current_slide || 0) + 1);
        } catch (e) {
          console.warn('[Classroom] deck failed to open', e);
        }
      }
      return;
    }

    // A beat index is not a slide number, so playback always starts at the top.
    beatIndex = 0;
    if (isHost) play();
  }

  // The ask box stays usable for the whole visit, including after the lesson
  // has finished, and says so instead of leaving the student guessing.
  function setUpAskBox() {
    var input = el('cl-ask');
    var hint = el('cl-live-hint');
    if (input) input.disabled = false;
    if (hint) {
      hint.textContent = ended
        ? 'The class has finished. Ask anything about it, or name a classmate to ask them.'
        : 'Asking pauses the class. Name a classmate and they answer you. The tutor answers everyone else.';
    }
  }

  function renderInvite(isHost) {
    var wrap = el('cl-invite');
    if (!wrap) return;
    // Only the host can invite; a guest joining from a link has nothing to share.
    if (!isHost) { wrap.innerHTML = ''; return; }
    var link = inviteLink();
    if (!link) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<span class="cl-invite-label">Invite</span>'
      + '<input class="cl-invite-input" id="cl-invite-link" readonly value="' + esc(link) + '">'
      + '<button type="button" class="cl-btn cl-btn-ghost cl-btn-sm" id="cl-invite-copy">Copy</button>';
    var btn = el('cl-invite-copy');
    if (btn) {
      btn.addEventListener('click', function () {
        var input = el('cl-invite-link');
        if (!input) return;
        input.select();
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(link);
        } catch (_) {}
        try { document.execCommand('copy'); } catch (_) {}
        btn.textContent = 'Copied ✓';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1800);
      });
    }
  }

  // ── live wiring ────────────────────────────────────────────────────────
  function wireLive(isHost) {
    var L = window.ClassroomLive;
    if (!L) return;

    L.on('state', function (s) {
      if (s && s.slide != null && window.ClassroomSlides) {
        try { window.ClassroomSlides.showSlide(s.slide); } catch (_) {}
      }
    });

    L.on('line', function (l) {
      if (!l) return;
      // The sender already drew their own line; the echo must not repeat it.
      if (alreadyRendered(l.id)) return;
      var kind = l.kind || (isTutorSpeaker(l.speaker) ? 'ai_tutor' : 'ai_student');
      markRendered(l.id);
      appendLine(kind, l.speaker, l.text, l.slide);
    });

    // The live class arrives over broadcast. The database is only replayed on
    // join, so a line is never rendered twice from both paths.
    L.on('presence', function (people) {
      renderPresence(people || []);
    });

    L.on('ended', function () {
      var st = el('cl-room-state');
      if (st) st.textContent = 'Class finished';
    });

    // Someone who joins after the class moved on never heard the earlier
    // broadcasts, so the host re-sends where the class currently is.
    if (isHost) {
      L.on('presence', function () {
        if (!window.ClassroomSlides) return;
        var page = window.ClassroomSlides.currentSlide();
        if (page && page > 0) {
          L.publishState({ slide: page, total: window.ClassroomSlides.pageCount() });
        }
      });
    }

    // Only the host reacts to a classmate speaking.
    if (isHost) {
      L.on('say', function (m) {
        if (!m || !m.text) return;
        handleClassmateMessage(m.who, m.text, m.kind, m.id);
      });
    }
  }

  function renderPresence(people) {
    var wrap = el('cl-here');
    if (!wrap) return;
    var names = people
      .map(function (p) { return p && p.name; })
      .filter(Boolean)
      .filter(function (n, i, a) { return a.indexOf(n) === i; });
    wrap.innerHTML = names.length
      ? names.length + ' in the room: ' + names.join(', ')
      : '';
  }

  // A classmate spoke: pause, answer, resume. Their line is already on the
  // sender's own screen, so it is only added here if it has not been seen yet.
  async function handleClassmateMessage(who, text, kind, id) {
    if (alreadyRendered(id)) return;
    markRendered(id);
    appendLine('user', who, text, null);
    saveLine('user', who, text, null);
    pause();
    try {
      await answerQuestion(text, who);
    } catch (e) {
      console.warn('[Classroom] answer failed', e);
    }
    resume();
  }

  function publicDeckUrl(path) {
    var c = getDb();
    if (!c) return null;
    try {
      var p = c.storage.from('ai-classroom-decks').getPublicUrl(path);
      return (p && p.data && p.data.publicUrl) || null;
    } catch (_) {
      return null;
    }
  }

  // Ending the class is not a separate chore: the host leaving ends it for
  // everyone. Only the host can do this, so a guest pressing Leave just leaves.
  // Idempotent, because Leave can be pressed twice.
  var endPromise = null;
  function amHost() {
    // Tracked here rather than read from the live channel, so a host whose live
    // connection failed still drives their own class and can still end it.
    return hostFlag;
  }
  function endClass(opts) {
    if (!amHost()) return Promise.resolve();
    if (endPromise) return endPromise;
    var silent = opts && opts.silent;
    ended = true;
    if (!silent) {
      var b = el('cl-room-state');
      if (b) b.textContent = 'Class finished';
      var chip = el('cl-progress-chip');
      if (chip) chip.textContent = 'Finished';
    }
    if (window.ClassroomLive) {
      try { window.ClassroomLive.publishEnded({}); } catch (_) {}
    }
    endPromise = (async function () {
      var c = getDb();
      if (!c || !room) return;
      try {
        await c.from('classrooms').update({ status: 'ended' }).eq('id', room.id);
      } catch (e) {
        console.warn('[Classroom] end failed', e);
      }
      if (window.Classroom && window.Classroom.refreshDash) {
        try { await window.Classroom.refreshDash(); } catch (_) {}
      }
    })();
    return endPromise;
  }

  function stop() {
    // Leaving ends the class for everyone.
    endClass();
    pause();
    stopAudio();
    stopRecording();
    playing = false;
    if (window.ClassroomLive) window.ClassroomLive.leave();
  }

  window.ClassroomRoom = {
    enter: enter,
    stop: stop,
    askTutor: askTutor,
    pause: pause,
    resume: resume,
    toggleMic: toggleMic,
    inviteLink: inviteLink,
    endClass: endClass,
    pageCount: pageCount
  };
})();
