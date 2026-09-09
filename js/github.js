/* Anteemonee GitHub integration (Zardari coding agent).
 *
 * OAuth connect (token exchange happens server-side in the `github-oauth`
 * edge function), repo picker, file reader, committer, and the repo panel.
 * No framework dependencies. Safe to load on any page (all DOM access
 * is guarded). Reads the shared Supabase client `db` when present.
 */
(function () {
  'use strict';

  var CLIENT_ID = 'Ov23li3A5rWHba1U72Pl';
  var SCOPE = 'repo';
  var MAX_ATTACH = 5;
  var MAX_FILE_BYTES = 30000;
  var MAX_TREE_ROWS = 300;

  var _token = null;
  var _conn = undefined; // undefined = unknown, null = not connected, object = connected
  var _reposCache = null;
  var _sel = null; // { owner, repo, branch }
  var _tree = null; // cached tree entries for _sel
  var _attached = []; // [{ path, content }]
  var _panelOpen = false;

  /* ---------- helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function uid() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) return currentUser.id;
    } catch (_) {}
    try {
      var a = (typeof db !== 'undefined' && db && db.auth) ? null : null;
    } catch (_) {}
    return 'anon';
  }

  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (_) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (_) {}
  }
  function lsDel(k) {
    try { window.localStorage.removeItem(k); } catch (_) {}
  }

  function selKey() { return 'anteemonee_gh_sel:' + uid(); }
  function pathsKey() { return 'anteemonee_gh_paths:' + uid(); }

  function redirectUri() {
    return window.location.origin + '/pages/auth/callback/github.html';
  }

  function encPath(p) {
    return String(p).split('/').map(encodeURIComponent).join('/');
  }

  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function client() {
    if (typeof db !== 'undefined' && db) return db;
    return null;
  }

  /* ---------- connection state ---------- */

  async function getConnection(force) {
    if (_conn !== undefined && !force) return _conn;
    var c = client();
    if (!c) { _conn = null; return null; }
    try {
      var res = await c.from('github_connections').select('github_username, scope, connected_at').maybeSingle();
      _conn = res.data || null;
      if (_conn) {
        var full = await c.from('github_connections').select('access_token').maybeSingle();
        _token = (full.data && full.data.access_token) || null;
      } else {
        _token = null;
      }
    } catch (_) {
      _conn = null;
      _token = null;
    }
    syncPlusItem();
    return _conn;
  }

  async function getToken() {
    if (_token) return _token;
    var c = client();
    if (!c) return null;
    try {
      var res = await c.from('github_connections').select('access_token, github_username').maybeSingle();
      if (res.data && res.data.access_token) {
        _token = res.data.access_token;
        _conn = { github_username: res.data.github_username };
        syncPlusItem();
        return _token;
      }
    } catch (_) {}
    _conn = null;
    _token = null;
    return null;
  }

  function isConnectedCached() {
    return !!(_conn && _conn.github_username);
  }

  function clearAuthState() {
    _token = null;
    _conn = null;
    _reposCache = null;
    syncPlusItem();
    if (_panelOpen) renderPanel();
  }

  async function markDisconnected() {
    clearAuthState();
    _sel = null;
    _tree = null;
    _attached = [];
    lsDel(selKey());
    lsDel(pathsKey());
    syncPlusItem();
    if (_panelOpen) renderPanel();
  }

  /* ---------- GitHub REST ---------- */

  async function api(path, opts) {
    var token = await getToken();
    if (!token) {
      var e0 = new Error('GitHub not connected. Tap GitHub in the + menu to connect.');
      e0.status = 401;
      throw e0;
    }
    var merged = Object.assign({}, opts || {});
    merged.headers = Object.assign(
      { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      (opts && opts.headers) || {}
    );
    var res = await fetch('https://api.github.com' + path, merged);
    if (res.status === 401) {
      clearAuthState();
      var e1 = new Error('GitHub token expired or revoked. Please reconnect GitHub.');
      e1.status = 401;
      throw e1;
    }
    if (!res.ok) {
      var e2 = new Error('GitHub error ' + res.status);
      e2.status = res.status;
      try { e2.detail = (await res.text()).slice(0, 300); } catch (_) {}
      throw e2;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function listRepos() {
    if (_reposCache) return _reposCache;
    var repos = await api('/user/repos?per_page=100&sort=updated');
    _reposCache = repos;
    return repos;
  }

  async function getBranches(owner, repo) {
    try {
      return await api('/repos/' + owner + '/' + repo + '/branches?per_page=100');
    } catch (_) {
      return [];
    }
  }

  async function getTree(owner, repo, branch) {
    var t = await api('/repos/' + owner + '/' + repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
    var files = (t.tree || []).filter(function (n) { return n.type === 'blob'; });
    return files.slice(0, 2000);
  }

  async function getFile(owner, repo, path, branch) {
    var f = await api('/repos/' + owner + '/' + repo + '/contents/' + encPath(path) + '?ref=' + encodeURIComponent(branch));
    if (f.type !== 'file' || !f.content) throw new Error('Not a readable file: ' + path);
    if (f.size > MAX_FILE_BYTES) {
      var e = new Error('File too large to attach (' + Math.round(f.size / 1024) + ' KB, max 30 KB): ' + path);
      e.status = 413;
      throw e;
    }
    return b64decode(f.content);
  }

  async function commitFile(owner, repo, path, content, message, branch) {
    var sha = null;
    try {
      var cur = await api('/repos/' + owner + '/' + repo + '/contents/' + encPath(path) + '?ref=' + encodeURIComponent(branch));
      sha = cur.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    var body = { message: message, content: b64encode(content), branch: branch };
    if (sha) body.sha = sha;
    return api('/repos/' + owner + '/' + repo + '/contents/' + encPath(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  /* ---------- OAuth ---------- */

  function startConnect() {
    var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('gh_oauth_state', state); } catch (_) {}
    var url = 'https://github.com/login/oauth/authorize'
      + '?client_id=' + encodeURIComponent(CLIENT_ID)
      + '&redirect_uri=' + encodeURIComponent(redirectUri())
      + '&scope=' + encodeURIComponent(SCOPE)
      + '&state=' + encodeURIComponent(state);
    window.location.href = url;
  }

  function friendlyFunctionError(body) {
    var code = body && body.error;
    var detail = body && body.detail;
    if (code === 'server_misconfigured') return 'GitHub keys missing on the server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in the edge function secrets.';
    if (code === 'oauth_exchange_failed') {
      if (detail && detail.indexOf('redirect_uri') !== -1) return 'Callback URL mismatch. The OAuth app callback URL must exactly match this page URL.';
      if (detail && detail.indexOf('bad_verification_code') !== -1) return 'This login link expired or was already used. Go back and tap Connect GitHub again.';
      return 'GitHub refused the login' + (detail ? ': ' + detail : '.') + ' Try connecting again.';
    }
    if (code === 'github_user_failed') return 'Could not read your GitHub profile. Retry.';
    if (code === 'store_failed') return 'Could not save the connection (database table missing?). Run migration 0062.';
    if (code === 'unauthorized') return 'Session expired. Sign in again, then retry.';
    if (code === 'bad_request') return 'Bad login request. Start over from the chat.';
    return 'GitHub connect failed' + (detail ? ': ' + detail : (code ? ' (' + code + ').' : '.'));
  }

  async function githubInvokeError(err) {
    var status = err && err.status;
    var body = null;
    try {
      var ctx = err && err.context;
      if (ctx && typeof ctx.json === 'function') body = await ctx.json();
    } catch (_) {}
    if (body && (body.error || body.detail)) return friendlyFunctionError(body);
    if (status === 404) return 'Connect service not deployed yet. Deploy the github-oauth edge function first.';
    if (status === 401 || status === 403) return 'Session expired. Sign in again, then retry.';
    return 'GitHub connect failed (HTTP ' + (status || 'network') + '). Check your connection and retry.';
  }

  async function handleCallback(explicitClient) {
    var params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      throw new Error(params.get('error_description') || params.get('error') || 'GitHub authorization failed.');
    }
    var code = params.get('code');
    var state = params.get('state');
    var saved = null;
    try { saved = sessionStorage.getItem('gh_oauth_state'); } catch (_) {}
    if (!code) throw new Error('No code returned from GitHub.');
    if (saved && state !== saved) throw new Error('State mismatch. Please start over from the chat.');
    var c = explicitClient || client();
    if (!c) throw new Error('You must be signed in to Anteemonee first.');
    var res = await c.functions.invoke('github-oauth', {
      body: { code: code, redirect_uri: redirectUri() }
    });
    if (res.error) throw new Error(await githubInvokeError(res.error));
    if (res.data && res.data.error) throw new Error(friendlyFunctionError(res.data));
    try { sessionStorage.removeItem('gh_oauth_state'); } catch (_) {}
    _conn = undefined;
    _token = null;
    _reposCache = null;
    await getConnection(true);
    return res.data && res.data.github_username;
  }

  async function disconnect() {
    var c = client();
    if (c) {
      try {
        var user = null;
        try {
          var s = await c.auth.getUser();
          user = s.data && s.data.user;
        } catch (_) {}
        if (user) await c.from('github_connections').delete().eq('user_id', user.id);
      } catch (_) {}
    }
    await markDisconnected();
  }

  /* ---------- selection persistence ---------- */

  function restoreSelection() {
    try {
      var s = lsGet(selKey());
      if (s) _sel = JSON.parse(s);
      var p = lsGet(pathsKey());
      if (p) {
        var paths = JSON.parse(p);
        if (Array.isArray(paths)) {
          _attached = paths.map(function (path) { return { path: path, content: null }; });
        }
      }
    } catch (_) {}
    syncPlusItem();
  }

  function persistSelection() {
    if (_sel) lsSet(selKey(), JSON.stringify(_sel)); else lsDel(selKey());
    lsSet(pathsKey(), JSON.stringify(_attached.map(function (f) { return f.path; })));
  }

  async function ensureAttachedLoaded() {
    if (!_sel) return;
    for (var i = 0; i < _attached.length; i++) {
      if (_attached[i].content == null) {
        try {
          _attached[i].content = await getFile(_sel.owner, _sel.repo, _attached[i].path, _sel.branch);
        } catch (_) {
          _attached[i].content = '[could not load this file]';
        }
      }
    }
  }

  /* ---------- Zardari context + update blocks ---------- */

  function buildContext() {
    var lines = [];
    lines.push('GITHUB ACCESS: You work in the user GitHub repos THROUGH THIS APP when connected.');
    if (!_sel) {
      lines.push('STATUS: no repo attached right now. If the user asks for GitHub repo work (view, create, or update files in a repo): NEVER say you lack access, cannot touch GitHub, or cannot make files. Tell them in one short line that their GitHub or repo is not connected yet and to tap + then GitHub to connect and pick a repo, then ask again. Still answer anything that does not need the repo.');
      return '\n\n' + lines.join('\n');
    }
    lines.push('STATUS: repo attached: ' + _sel.owner + '/' + _sel.repo + ' (branch: ' + _sel.branch + ').');
    lines.push('The user attached ' + _attached.length + ' file(s) from this repo. Base ALL repo edits on the attached content below. Never invent file contents.');
    var loaded = _attached.filter(function (f) { return f.content != null; });
    loaded.forEach(function (f, i) {
      lines.push('--- ATTACHED FILE ' + (i + 1) + ': ' + f.path + ' ---');
      lines.push(String(f.content).slice(0, 12000));
    });
    lines.push('GITHUB UPDATE CONTRACT: when the user asks you to CREATE a new file or CHANGE a file in this repo, always output the FULL new file content in a fenced block exactly like this: ```github-update:path/to/file.js on its own line, then the complete new file, then a closing ``` line. One block per file. Never tell the user to create the file locally or run git commands; the app commits for them. Only touch files the user explicitly asked to create or change. Never add extra files, bonus scripts, or examples they did not request. Every file you create or change MUST be inside its own ```github-update:path block. Never put repo file contents in regular code blocks. A short explanation of what changed goes OUTSIDE the blocks. You cannot commit yourself; the app applies changes only after the user taps Apply.');
    return '\n\n' + lines.join('\n');
  }

  function parseUpdates(text) {
    var out = [];
    if (!text) return out;
    var re = /```\s*github-update\s*:\s*([^\n`]+)\n([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var path = m[1].trim().replace(/^\.\//, '');
      var content = m[2].replace(/^\n/, '').replace(/\n$/, '');
      if (path && content) out.push({ path: path, content: content });
      if (out.length >= 5) break;
    }
    return out;
  }

  function handleAssistantMessage(div, text) {
    if (!_sel) return;
    var updates = parseUpdates(text);
    if (!updates.length) return;
    var host = div.querySelector('.msg-body') || div;
    var wrap = document.createElement('div');
    wrap.className = 'gh-apply-wrap';
    updates.forEach(function (u) { wrap.appendChild(applyCard(u)); });
    host.appendChild(wrap);
  }

  function applyCard(u) {
    var card = document.createElement('div');
    card.className = 'gh-apply-card';
    card.innerHTML =
      '<div class="gh-apply-head"><span class="gh-apply-path">' + esc(u.path) + '</span>' +
      '<span class="gh-apply-meta">' + esc(_sel.owner + '/' + _sel.repo + ' @ ' + _sel.branch) + '</span></div>' +
      '<div class="gh-apply-status">Zardari proposed an update. Review it in the message above, then apply.</div>' +
      '<div class="gh-apply-actions"><button class="gh-apply-btn" type="button">Apply to GitHub</button>' +
      '<button class="gh-discard-btn" type="button">Discard</button></div>';
    var statusEl = card.querySelector('.gh-apply-status');
    var applyBtn = card.querySelector('.gh-apply-btn');
    card.querySelector('.gh-discard-btn').addEventListener('click', function () {
      card.classList.add('removing');
      setTimeout(function () { card.remove(); }, 150);
    });
    applyBtn.addEventListener('click', async function () {
      if (!_sel) {
        statusEl.textContent = 'Repo no longer selected. Reopen the GitHub panel and pick a repo.';
        statusEl.classList.add('err');
        return;
      }
      applyBtn.disabled = true;
      statusEl.textContent = 'Committing to GitHub...';
      try {
        await commitFile(_sel.owner, _sel.repo, u.path, u.content, 'Update ' + u.path + ' via Anteemonee Zardari', _sel.branch);
        statusEl.textContent = 'Committed to ' + _sel.owner + '/' + _sel.repo + ' on branch ' + _sel.branch + '.';
        statusEl.classList.add('ok');
        applyBtn.textContent = 'Applied';
      } catch (err) {
        statusEl.textContent = 'Commit failed: ' + (err.message || 'unknown error');
        statusEl.classList.add('err');
        applyBtn.disabled = false;
      }
    });
    return card;
  }

  /* ---------- plus-menu item sync ---------- */

  function syncPlusItem() {
    try {
      var item = document.getElementById('plus-github-item');
      if (!item) return;
      item.classList.toggle('active', isConnectedCached());
      var label = item.querySelector('.plus-dropdown-label');
      if (label) label.textContent = _sel ? ('GitHub · ' + _sel.repo) : 'GitHub';
      item.title = _sel ? ('Connected: ' + _sel.owner + '/' + _sel.repo) : 'Connect GitHub';
    } catch (_) {}
    syncRepoChip();
  }

  function syncRepoChip() {
    try {
      var bar = document.getElementById('modes-bar');
      if (!bar) return;
      var old = bar.querySelector('.gh-repo-chip');
      if (old) old.remove();
      if (!_sel) return;
      var chip = document.createElement('span');
      chip.className = 'mode-chip gh-repo-chip';
      chip.title = 'Attached repo: ' + _sel.owner + '/' + _sel.repo + ' @ ' + _sel.branch + '. Tap to manage.';
      chip.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>' + esc(_sel.repo);
      chip.title = 'Attached repo: ' + _sel.owner + '/' + _sel.repo + ' @ ' + _sel.branch + '. Tap to manage, X to disconnect repo.';
      var xBtn = document.createElement('button');
      xBtn.className = 'mode-chip-remove';
      xBtn.type = 'button';
      xBtn.title = 'Disconnect repo (keeps GitHub connected)';
      xBtn.setAttribute('aria-label', 'Disconnect repo');
      xBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      xBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        disconnectRepo();
      });
      chip.appendChild(xBtn);
      chip.addEventListener('click', function () { openPanel(); });
      bar.appendChild(chip);
    } catch (_) {}
  }

  function disconnectRepo() {
    _sel = null;
    _tree = null;
    _attached = [];
    lsDel(selKey());
    lsDel(pathsKey());
    syncPlusItem();
    if (_panelOpen) renderPanel();
  }

  /* ---------- repo panel ---------- */

  function openPanel() {
    var overlay = $('github-panel');
    if (!overlay) return;
    _panelOpen = true;
    overlay.classList.add('show');
    renderPanel();
  }

  function closePanel() {
    var overlay = $('github-panel');
    if (overlay) overlay.classList.remove('show');
    _panelOpen = false;
  }

  function panelStatus(msg, isErr) {
    var el = $('github-panel-status');
    if (el) {
      el.textContent = msg || '';
      el.classList.toggle('err', !!isErr);
    }
  }

  async function renderPanel() {
    var body = $('github-panel-body');
    if (!body) return;
    body.innerHTML = '<div class="gh-loading">Loading...</div>';
    panelStatus('');
    try {
      var conn = await getConnection(false);
      if (!conn) {
        body.innerHTML =
          '<div class="gh-connect-box">' +
          '<p class="gh-connect-text">Connect your GitHub account so Zardari can browse your repositories, read files, and propose updates you approve.</p>' +
          '<button class="gh-connect-btn" id="gh-connect-btn" type="button">Connect GitHub</button>' +
          '<p class="gh-connect-note">You will approve access on github.com. Anteemonee never sees your password.</p></div>';
        $('gh-connect-btn').addEventListener('click', startConnect);
        return;
      }
      await renderConnectedPanel(body, conn);
    } catch (err) {
      body.innerHTML = '<div class="gh-loading">Failed to load: ' + esc(err.message || 'unknown error') + '</div>';
    }
  }

  async function renderConnectedPanel(body, conn) {
    var repos = await listRepos();
    var html = '<div class="gh-user-row"><span>Connected as <strong>@' + esc(conn.github_username || 'you') + '</strong></span>' +
      '<button class="gh-link-btn" id="gh-disconnect-btn" type="button">Disconnect</button></div>';

    html += '<div class="gh-section-title">SELECT REPOSITORY</div>';
    html += '<input class="gh-search" id="gh-repo-search" type="text" placeholder="Search repositories...">';
    html += '<div class="gh-repo-list" id="gh-repo-list">';
    repos.forEach(function (r, i) {
      var full = r.owner.login + '/' + r.name;
      var active = _sel && _sel.owner === r.owner.login && _sel.repo === r.name;
      html += '<button class="gh-repo-row' + (active ? ' active' : '') + '" data-i="' + i + '" type="button">' +
        '<span class="gh-repo-name">' + esc(full) + '</span>' +
        (r.private ? '<span class="gh-private">private</span>' : '') +
        (active ? '<span class="gh-check">✓</span>' : '') + '</button>';
    });
    html += '</div><div id="gh-repo-detail"></div>';

    body.innerHTML = html;

    $('gh-disconnect-btn').addEventListener('click', async function () {
      if (!confirm('Disconnect GitHub from Anteemonee?')) return;
      panelStatus('Disconnecting...');
      await disconnect();
      renderPanel();
    });

    $('gh-repo-search').addEventListener('input', function (e) {
      var q = e.target.value.toLowerCase();
      body.querySelectorAll('.gh-repo-row').forEach(function (row) {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    body.querySelectorAll('.gh-repo-row').forEach(function (row) {
      row.addEventListener('click', async function () {
        var r = repos[parseInt(row.dataset.i, 10)];
        await selectRepo(r.owner.login, r.name, r.default_branch || 'main');
      });
    });

    if (_sel) renderRepoDetail();
  }

  async function selectRepo(owner, repo, branch) {
    _sel = { owner: owner, repo: repo, branch: branch };
    _tree = null;
    _attached = [];
    persistSelection();
    syncPlusItem();
    await renderPanel();
  }

  async function renderRepoDetail() {
    var host = $('gh-repo-detail');
    if (!host || !_sel) return;
    host.innerHTML = '<div class="gh-loading">Loading files...</div>';
    try {
      var branches = await getBranches(_sel.owner, _sel.repo);
      _tree = await getTree(_sel.owner, _sel.repo, _sel.branch);
      var html = '<div class="gh-section-title">FILES IN ' + esc(_sel.repo) + ' <span class="gh-file-count">' + _tree.length + ' files</span></div>';
      html += '<div class="gh-branch-row"><span>Branch:</span><select class="gh-branch-select" id="gh-branch-select">';
      var seen = {};
      branches.forEach(function (b) {
        seen[b.name] = true;
        html += '<option value="' + esc(b.name) + '"' + (b.name === _sel.branch ? ' selected' : '') + '>' + esc(b.name) + '</option>';
      });
      if (!seen[_sel.branch]) html += '<option selected>' + esc(_sel.branch) + '</option>';
      html += '</select><button class="gh-link-btn" id="gh-disconnect-repo-btn" type="button">Disconnect repo</button></div>';
      html += '<input class="gh-search" id="gh-file-search" type="text" placeholder="Search files...">';
      html += '<div class="gh-file-list">';
      _tree.slice(0, MAX_TREE_ROWS).forEach(function (n) {
        var isA = _attached.some(function (f) { return f.path === n.path; });
        html += '<button class="gh-file-row' + (isA ? ' active' : '') + '" data-path="' + esc(n.path) + '" type="button">' +
          '<span class="gh-file-path">' + esc(n.path) + '</span>' +
          (isA ? '<span class="gh-check">✓</span>' : '') + '</button>';
      });
      html += '</div>';
      html += '<div class="gh-attached-title">ATTACHED FOR ZARDARI (' + _attached.length + '/' + MAX_ATTACH + ')</div>';
      html += '<div class="gh-attached-list" id="gh-attached-list">';
      if (!_attached.length) html += '<span class="gh-empty-note">Tap files above to attach them as context.</span>';
      _attached.forEach(function (f) {
        html += '<span class="gh-attached-chip">' + esc(f.path) +
          '<button data-unattach="' + esc(f.path) + '" type="button" aria-label="Remove">×</button></span>';
      });
      html += '</div>';
      host.innerHTML = html;

      $('gh-branch-select').addEventListener('change', async function (e) {
        _sel.branch = e.target.value;
        _tree = null;
        _attached = [];
        persistSelection();
        syncPlusItem();
        renderRepoDetail();
      });
      $('gh-disconnect-repo-btn').addEventListener('click', function () {
        disconnectRepo();
      });
      $('gh-file-search').addEventListener('input', function (e) {
        var q = e.target.value.toLowerCase();
        host.querySelectorAll('.gh-file-row').forEach(function (row) {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
      host.querySelectorAll('.gh-file-row').forEach(function (row) {
        row.addEventListener('click', function () { toggleAttach(row.dataset.path); });
      });
      host.querySelectorAll('[data-unattach]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          _attached = _attached.filter(function (f) { return f.path !== btn.dataset.unattach; });
          persistSelection();
          renderRepoDetail();
        });
      });
    } catch (err) {
      host.innerHTML = '<div class="gh-loading">Failed to load files: ' + esc(err.message || 'unknown error') + '</div>';
    }
  }

  async function toggleAttach(path) {
    var existing = _attached.findIndex(function (f) { return f.path === path; });
    if (existing >= 0) {
      _attached.splice(existing, 1);
      persistSelection();
      renderRepoDetail();
      return;
    }
    if (_attached.length >= MAX_ATTACH) {
      panelStatus('You can attach up to ' + MAX_ATTACH + ' files.', true);
      return;
    }
    panelStatus('Attaching ' + path + '...');
    try {
      var content = await getFile(_sel.owner, _sel.repo, path, _sel.branch);
      _attached.push({ path: path, content: content });
      persistSelection();
      panelStatus('');
      renderRepoDetail();
    } catch (err) {
      panelStatus(err.message || 'Could not attach file.', true);
    }
  }

  /* ---------- init ---------- */

  function init() {
    restoreSelection();
    // Warm the connection + attached contents in the background (never blocks chat).
    setTimeout(function () {
      getConnection(false).then(function () {
        if (_sel && _attached.length) ensureAttachedLoaded();
      }).catch(function () {});
    }, 1500);
    document.addEventListener('click', function (e) {
      var overlay = $('github-panel');
      if (overlay && e.target === overlay) closePanel();
    });
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'github-panel-close') closePanel();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GitHub = {
    startConnect: startConnect,
    handleCallback: handleCallback,
    openPanel: openPanel,
    closePanel: closePanel,
    disconnect: disconnect,
    disconnectRepo: disconnectRepo,
    getConnection: getConnection,
    isConnectedCached: isConnectedCached,
    buildContext: buildContext,
    parseUpdates: parseUpdates,
    handleAssistantMessage: handleAssistantMessage,
    commitFile: commitFile,
    ensureAttachedLoaded: ensureAttachedLoaded,
    syncRepoChip: syncRepoChip
  };
})();
