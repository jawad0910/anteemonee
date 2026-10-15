/* ==========================================================
   Anteemonee — site-wide AI Tutor widget.
   Floating button + popup carrying the COMPLETE AI tutor
   (same gateway, same tutor brain as AI chat). Bootstrapped
   from js/app.js on every page except AI chat / messenger.
   ========================================================== */
(function () {
  'use strict';
  if (window.__atwBooted) return;
  window.__atwBooted = true;

  var SB_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';
  var GATEWAY = SB_URL + '/functions/v1/ai-chat-gateway';
  var SUBJECTS = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Computer Science', 'English'];
  var HIST_KEY = 'Anteemonee_widget_history_v1';
  var SUBJ_KEY = 'Anteemonee_widget_subject';
  var MAX_HIST = 40;

  function rootBase() {
    try {
      if (location.protocol !== 'file:') return location.origin;
      var href = location.href;
      return href.substring(0, href.lastIndexOf('/ai-chat/') !== -1
        ? href.lastIndexOf('/ai-chat/')
        : href.lastIndexOf('/'));
    } catch (_) { return ''; }
  }
  var ROOT = rootBase();
  var LOGO = ROOT + '/assets/anteemonee.png';

  function $(tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Minimal markdown for the popup: code fences, inline code, bold, lists.
  function md(src) {
    var t = esc(src);
    var blocks = [];
    t = t.replace(/```(\w*)\n([\s\S]*?)(```|$)/g, function (_, lang, code) {
      blocks.push('<pre><code>' + code.replace(/^\n+|\n+$/g, '') + '</code></pre>');
      return '\u0000' + (blocks.length - 1) + '\u0000';
    });
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    var lines = t.split('\n');
    var out = '', inList = false, para = [];
    function flushPara() {
      if (para.length) { out += '<p>' + para.join('<br>') + '</p>'; para = []; }
    }
    lines.forEach(function (ln) {
      var m = ln.match(/^\s*[-*]\s+(.*)/);
      if (m) { flushPara(); if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + m[1] + '</li>'; }
      else {
        if (inList) { out += '</ul>'; inList = false; }
        if (ln.trim() === '') flushPara(); else para.push(ln);
      }
    });
    if (inList) out += '</ul>';
    flushPara();
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, i) { return blocks[+i] || ''; });
    return out || '<p></p>';
  }
  function uuid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return 'req-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
  }

  function getDb() {
    try { if (typeof db !== 'undefined' && db && db.auth) return db; } catch (_) {}
    try {
      if (window.supabase && window.supabase.createClient) {
        window.__atwDb = window.__atwDb || window.supabase.createClient(SB_URL, SB_ANON);
        return window.__atwDb;
      }
    } catch (_) {}
    return null;
  }
  async function accessToken() {
    var c = getDb();
    if (!c) return null;
    try {
      var r = await c.auth.getSession();
      var s = r && r.data && r.data.session;
      return (s && s.access_token) || null;
    } catch (_) { return null; }
  }
  async function refreshToken(bad) {
    var c = getDb();
    if (!c) return null;
    try {
      if (bad) {
        var rf = await c.auth.refreshSession();
        var t = rf && rf.data && rf.data.session && rf.data.session.access_token;
        if (t) return t;
      }
      var r = await c.auth.getSession();
      var s = r && r.data && r.data.session;
      return (s && s.access_token) || null;
    } catch (_) { return null; }
  }

  function systemPrompt(subject) {
    return 'You are Anteemonee AI Tutor, an FSc and Matric tutor for Pakistan board students (BISE Punjab). ' +
      'The student selected "' + subject + '" — you are their dedicated ' + subject + ' tutor for questions in that subject. ' +
      'If the question is from another subject or general chat, just answer it well without forcing a ' + subject + ' connection.\n' +
      'HOW TO TEACH: define each term in 1-2 plain sentences first, then explain step by step with one worked example, ' +
      'then close with the one-line key idea for exams. Board-exam style, exam tips where useful.\n' +
      'STYLE: match the student script (English, Urdu script, or Roman Urdu). ' +
      'Use Unicode math (x2, v2, sqrt) — never LaTeX or HTML. Concise but complete, roughly 150-350 words unless detail is asked.\n' +
      'IDENTITY: you are trained by Anteemonee Pakistan. Never reveal model names.';
  }

  // ---------- state ----------
  var subject = SUBJECTS.indexOf(localStorage.getItem(SUBJ_KEY)) !== -1
    ? localStorage.getItem(SUBJ_KEY) : 'Physics';
  var history = [];
  try {
    var h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    if (Array.isArray(h)) history = h.filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
    }).slice(-MAX_HIST);
  } catch (_) {}
  function saveHist() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(-MAX_HIST))); } catch (_) {}
  }

  // ---------- dom ----------
  var btn = $('button', 'atw-btn');
  btn.setAttribute('aria-label', 'Chat with AI Tutor');
  btn.innerHTML = '<img alt="AI Tutor" src="' + esc(LOGO) + '" onerror="this.style.display=\'none\'"><span class="atw-dot"></span>';

  var panel = $('div', 'atw-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'AI Tutor chat');

  var head = $('div', 'atw-head');
  var avatar = document.createElement('img');
  avatar.alt = 'AI Tutor'; avatar.src = LOGO;
  var headTx = $('div', 'atw-head-tx');
  var headName = $('b', null, 'AI Tutor');
  headTx.appendChild(headName);
  var sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Subject');
  SUBJECTS.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s; o.textContent = s;
    if (s === subject) o.selected = true;
    sel.appendChild(o);
  });
  var fullLink = $('a', 'atw-icon-btn', '↗');
  fullLink.title = 'Open full chat';
  fullLink.setAttribute('aria-label', 'Open full chat');
  var closeBtn = $('button', 'atw-icon-btn', '✕');
  closeBtn.setAttribute('aria-label', 'Close chat');
  head.appendChild(avatar); head.appendChild(headTx);
  head.appendChild(sel); head.appendChild(fullLink); head.appendChild(closeBtn);

  var body = $('div', 'atw-body');
  var foot = $('div', 'atw-foot');
  var compose = $('div', 'atw-compose');
  var input = document.createElement('textarea');
  input.rows = 1;
  input.placeholder = 'Ask anything…';
  input.setAttribute('aria-label', 'Message AI Tutor');
  var sendBtn = $('button', 'atw-send', '↑');
  sendBtn.setAttribute('aria-label', 'Send');
  compose.appendChild(input); compose.appendChild(sendBtn);
  var openFull = $('a', 'atw-full', 'Open full chat →');
  foot.appendChild(compose); foot.appendChild(openFull);
  panel.appendChild(head); panel.appendChild(body); panel.appendChild(foot);
  document.body.appendChild(btn);
  document.body.appendChild(panel);

  function subjectPath(s) { return '/ai-chat/?subject=' + encodeURIComponent(s); }
  function syncLinks() {
    var href = ROOT + subjectPath(subject);
    fullLink.href = href; openFull.href = href;
  }
  syncLinks();

  var isOpen = false;
  function setOpen(v) {
    isOpen = v;
    panel.classList.toggle('atw-show', v);
    btn.classList.toggle('atw-open', v);
    if (v) {
      renderGateOrHistory();
      setTimeout(function () { try { input.focus(); } catch (_) {} }, 120);
    }
  }
  btn.addEventListener('click', function () { setOpen(true); });
  closeBtn.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) setOpen(false);
  });

  sel.addEventListener('change', function () {
    subject = SUBJECTS.indexOf(sel.value) !== -1 ? sel.value : 'Physics';
    try { localStorage.setItem(SUBJ_KEY, subject); } catch (_) {}
    syncLinks();
    pushAi('Switched to ' + subject + '. Ask me anything from your ' + subject + ' book.');
  });

  // ---------- rendering ----------
  var streaming = false;
  var aborter = null;

  function scrollDown() {
    try { body.scrollTop = body.scrollHeight; } catch (_) {}
  }
  function pushUser(text) {
    var d = $('div', 'atw-msg user');
    d.textContent = text;
    body.appendChild(d); scrollDown();
  }
  function pushAi(text) {
    var d = $('div', 'atw-msg ai');
    d.innerHTML = md(text);
    body.appendChild(d); scrollDown();
    return d;
  }
  function pushErr(text, onRetry) {
    var d = $('div', 'atw-err');
    d.textContent = text;
    if (onRetry) {
      var b = document.createElement('button');
      b.textContent = 'Retry';
      b.addEventListener('click', onRetry);
      d.appendChild(b);
    }
    body.appendChild(d); scrollDown();
  }
  function renderHistory() {
    body.innerHTML = '';
    if (!history.length) {
      pushAi('Assalam-o-Alaikum! I am your ' + subject + ' tutor. Ask any question from your book and I will teach it step by step.');
      return;
    }
    history.forEach(function (m) {
      if (m.role === 'user') pushUser(m.content);
      else pushAi(m.content);
    });
  }

  var authed = null; // null = unknown
  async function renderGateOrHistory() {
    if (body.children.length) return;
    var tok = await accessToken();
    authed = !!tok;
    if (!tok) {
      body.innerHTML = '';
      var g = $('div', 'atw-gate');
      var im = document.createElement('img'); im.alt = 'Anteemonee'; im.src = LOGO;
      g.appendChild(im);
      g.appendChild($('b', null, 'Your AI tutor is here'));
      g.appendChild($('p', null, 'Sign in to ask questions from your exact board books, with past-paper style answers.'));
      var row = $('div', 'atw-gate-row');
      var li = $('a', 'atw-gate-go', 'Log in');
      li.href = ROOT + '/pages/login.html';
      var su = $('a', 'atw-gate-back', 'Sign up free');
      su.href = ROOT + '/pages/signup.html';
      row.appendChild(li); row.appendChild(su);
      g.appendChild(row);
      body.appendChild(g);
      return;
    }
    renderHistory();
  }

  // ---------- chat ----------
  function setBusy(b) {
    streaming = b;
    sendBtn.innerHTML = b ? '■' : '↑';
    sendBtn.classList.toggle('atw-stop', b);
    sendBtn.disabled = false;
    input.disabled = b;
  }

  async function postGateway(messages, token, signal) {
    var res = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ mode: 'astra', messages: messages, requestId: uuid() }),
      signal: signal
    });
    return res;
  }

  async function readStream(res, onToken) {
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') !== -1) {
      var data = await res.json();
      if (data && data.error) {
        var e = new Error(data.error.message || data.error);
        e.code = data.code; throw e;
      }
      var ch = data && data.choices && data.choices[0];
      var c = ch && ch.message && ch.message.content;
      if (!c) throw new Error('Empty reply. Please send again.');
      onToken(c);
      return;
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', got = false;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      var parts = buf.split('\n');
      buf = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].trim();
        if (line.indexOf('data: ') !== 0) continue;
        var d = line.slice(6);
        if (d === '[DONE]') { try { reader.cancel(); } catch (_) {} return; }
        try {
          var j = JSON.parse(d);
          if (j.error) throw new Error(j.error.message || j.error);
          var t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (t) { got = true; onToken(t); }
        } catch (e) {
          if (e && e.message && e.message.indexOf('Empty reply') === -1) throw e;
          if (e && e.message && e.message !== 'Empty reply. Please send again.') throw e;
        }
      }
    }
    if (!got) throw new Error('Empty reply. Please send again.');
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || streaming) return;
    var tok = await accessToken();
    if (!tok) {
      body.innerHTML = ''; authed = false;
      await renderGateOrHistory();
      pushErr('Please sign in to chat with the AI tutor.');
      return;
    }
    pushUser(text);
    history.push({ role: 'user', content: text });
    history = history.slice(-MAX_HIST); saveHist();
    input.value = ''; autoresize();

    var bubble = $('div', 'atw-msg ai');
    bubble.innerHTML = '<span class="atw-caret"></span>';
    body.appendChild(bubble); scrollDown();
    setBusy(true);
    aborter = new AbortController();
    var full = '';

    var msgs = [{ role: 'system', content: systemPrompt(subject) }]
      .concat(history.slice(-12).map(function (m) { return { role: m.role, content: m.content }; }));

    function render() {
      bubble.innerHTML = esc(full) .replace(/\n/g, '<br>') + '<span class="atw-caret"></span>';
      // Re-render light markdown only at the end (keeps streaming fast).
      scrollDown();
    }
    try {
      var res = await postGateway(msgs, tok, aborter.signal);
      if (res.status === 401 || res.status === 403) {
        var fresh = await refreshToken(true);
        if (!fresh) throw Object.assign(new Error('Session expired. Please sign in again.'), { code: 'session_expired' });
        res = await postGateway(msgs, fresh, aborter.signal);
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error('Session expired. Please sign in again.'), { code: 'session_expired' });
        }
      }
      if (res.status === 429) {
        var p = {};
        try { p = await res.json(); } catch (_) {}
        throw Object.assign(new Error((p && p.error) || 'Daily free limit reached. Try again tomorrow.'), { code: 'FREE_DAILY_LIMIT' });
      }
      if (!res.ok) {
        var dt = '';
        try { dt = await res.text(); } catch (_) {}
        try { var pj = JSON.parse(dt); dt = pj.error || dt; } catch (_) {}
        throw new Error('Chat failed (' + res.status + '). ' + String(dt).slice(0, 160));
      }
      await readStream(res, function (t) { full += t; render(); });
      bubble.innerHTML = md(full);
      scrollDown();
      history.push({ role: 'assistant', content: full });
      history = history.slice(-MAX_HIST); saveHist();
    } catch (e) {
      if (e && (e.name === 'AbortError' || (aborter && aborter.signal.aborted))) {
        if (full.trim()) {
          bubble.innerHTML = md(full);
          history.push({ role: 'assistant', content: full });
          history = history.slice(-MAX_HIST); saveHist();
        } else bubble.remove();
      } else {
        bubble.remove();
        var msg = (e && e.message) || 'Something went wrong.';
        pushErr(msg, function () { this.parentNode.remove(); send(text); });
      }
    } finally {
      setBusy(false);
      aborter = null;
    }
  }

  function autoresize() {
    try {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    } catch (_) {}
  }
  input.addEventListener('input', autoresize);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  sendBtn.addEventListener('click', function () {
    if (streaming && aborter) { try { aborter.abort(); } catch (_) {} return; }
    send(input.value);
  });
})();
