/* ==========================================================
   Anteemonee — Header notifications (all pages)
   Bell + dropdown panel injected into the shared header.

   Two sources are merged, newest first:
     1. broadcast rows from the `site_notifications` table (sent from the
        cpanteemonee control panel) — read with the anon key
     2. local items pushed by this browser (localStorage)

   Item shape: { id, title, body, image, href, at, read }
     title = heading, body = description,
     image = image URL, href = link the user lands on when they click

   Public API:
     AnteemoneeNotifications.add({ title, body, image, href })
     AnteemoneeNotifications.list()      -> merged array (newest first)
     AnteemoneeNotifications.unread()    -> number
     AnteemoneeNotifications.markAllRead()
     AnteemoneeNotifications.clear()
     AnteemoneeNotifications.refresh()   -> re-poll the table now
     AnteemoneeNotifications.open() / .close()

   Other scripts can push a notification with:
     window.dispatchEvent(new CustomEvent('anteemonee:notification',
       { detail: { title: '…', body: '…', image: '…', href: '…' } }))
   ========================================================== */
(function () {
  'use strict';

  var LOCAL_KEY = 'Anteemonee_notifications';
  var REMOTE_KEY = 'Anteemonee_notifications_remote';
  var READ_KEY = 'Anteemonee_notifications_read';
  var HIDDEN_KEY = 'Anteemonee_notifications_hidden';
  var SEED_KEY = 'Anteemonee_notifications_seeded';
  var MAX_ITEMS = 30;
  var POLL_MS = 60000;
  var BTN_ID = 'header-notif-btn';
  var REMOTE_PREFIX = 'n:';

  var FALLBACK_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
  var FALLBACK_ANON =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6' +
    'InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUw' +
    'NDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';

  var btn, panel, listEl, badgeEl, emptyEl;
  var client = null, firstFetch = true;

  /* ── storage ─────────────────────────────────────────────── */
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      var val = raw ? JSON.parse(raw) : null;
      return val == null ? fallback : val;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  function loadLocal() {
    var list = readJson(LOCAL_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveLocal(list) {
    writeJson(LOCAL_KEY, list.slice(0, MAX_ITEMS));
  }

  function idSet(key) {
    var arr = readJson(key, []);
    var out = {};
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length; i++) out[arr[i]] = true;
    }
    return out;
  }

  function addId(key, id) {
    var arr = readJson(key, []);
    if (!Array.isArray(arr)) arr = [];
    if (arr.indexOf(id) === -1) {
      arr.push(id);
      writeJson(key, arr.slice(-200));
    }
  }

  function seedOnce() {
    try {
      if (localStorage.getItem(SEED_KEY)) return;
      localStorage.setItem(SEED_KEY, '1');
    } catch (e) {
      return;
    }
    if (loadLocal().length) return;
    saveLocal([
      {
        id: 'seed-welcome',
        title: 'Welcome to Anteemonee',
        body: 'News, reminders and account updates will show up here.',
        image: '',
        href: '',
        at: Date.now(),
        read: false
      }
    ]);
  }

  /* ── remote (Supabase `site_notifications` table) ─────────── */
  function supabaseUrl() {
    try {
      if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) return SUPABASE_URL;
    } catch (e) {}
    return FALLBACK_URL;
  }

  function anonKey() {
    try {
      if (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) return SUPABASE_ANON_KEY;
    } catch (e) {}
    return FALLBACK_ANON;
  }

  function getClient() {
    if (client) return client;
    try {
      if (typeof db !== 'undefined' && db && typeof db.from === 'function') {
        client = db;
        return client;
      }
    } catch (e) {}
    try {
      if (window.supabase && window.supabase.createClient) {
        client = window.supabase.createClient(supabaseUrl(), anonKey());
        return client;
      }
    } catch (e) {}
    return null;
  }

  function fetchRemote() {
    var c = getClient();
    if (!c) return;
    var q = c
      .from('site_notifications')
      .select('id,heading,description,image_url,link,active,created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS);
    Promise.resolve(q)
      .then(function (res) {
        if (!res || res.error || !Array.isArray(res.data)) return; // table not migrated yet
        applyRemote(res.data);
      })
      .catch(function () {});
  }

  function applyRemote(rows) {
    var prev = readJson(REMOTE_KEY, []);
    var seen = {};
    if (Array.isArray(prev)) {
      for (var i = 0; i < prev.length; i++) seen[prev[i].id] = true;
    }
    writeJson(REMOTE_KEY, rows);
    render();
    if (firstFetch) {
      firstFetch = false;
      return;
    }
    for (var j = 0; j < rows.length; j++) {
      if (!seen[rows[j].id]) {
        bump();
        break;
      }
    }
  }

  /* ── merge ───────────────────────────────────────────────── */
  function remoteRows() {
    var rows = readJson(REMOTE_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function merged() {
    var read = idSet(READ_KEY);
    var hidden = idSet(HIDDEN_KEY);
    var out = [];
    var rows = remoteRows();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var id = REMOTE_PREFIX + r.id;
      if (hidden[id]) continue;
      var ts = r.created_at ? Date.parse(r.created_at) : NaN;
      out.push({
        id: id,
        title: r.heading || 'Notification',
        body: r.description || '',
        image: r.image_url || '',
        href: r.link || '',
        at: isNaN(ts) ? Date.now() : ts,
        read: !!read[id],
        remote: true
      });
    }
    var local = loadLocal();
    for (var k = 0; k < local.length; k++) out.push(local[k]);
    out.sort(function (a, b) {
      return (b.at || 0) - (a.at || 0);
    });
    return out.slice(0, MAX_ITEMS);
  }

  function unreadCount() {
    return merged().filter(function (n) {
      return !n.read;
    }).length;
  }

  /* ── helpers ─────────────────────────────────────────────── */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function timeAgo(ts) {
    var secs = Math.max(0, Math.floor((Date.now() - (ts || 0)) / 1000));
    if (secs < 45) return 'Just now';
    if (secs < 3600) return Math.round(secs / 60) + 'm ago';
    if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
    if (secs < 172800) return 'Yesterday';
    if (secs < 604800) return Math.round(secs / 86400) + 'd ago';
    try {
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function emit() {
    try {
      window.dispatchEvent(new CustomEvent('anteemonee:notifications-change'));
    } catch (e) {}
  }

  /* ── rendering ───────────────────────────────────────────── */
  function render() {
    if (!listEl) return;
    var items = merged();
    var unread = 0;

    listEl.textContent = '';
    for (var i = 0; i < items.length; i++) {
      listEl.appendChild(renderItem(items[i]));
      if (!items[i].read) unread++;
    }

    emptyEl.hidden = items.length > 0;
    listEl.hidden = items.length === 0;

    badgeEl.hidden = unread === 0;
    badgeEl.textContent = unread > 9 ? '9+' : String(unread);
    btn.classList.toggle('has-unread', unread > 0);
    btn.setAttribute(
      'aria-label',
      unread ? 'Notifications, ' + unread + ' unread' : 'Notifications'
    );
  }

  function renderItem(n) {
    var li = el('li', 'notif-item' + (n.read ? ' is-read' : ''));
    var itemBtn = el('button', 'notif-item-btn');
    itemBtn.type = 'button';

    if (n.image) {
      var img = document.createElement('img');
      img.className = 'notif-item-img';
      img.alt = '';
      img.loading = 'lazy';
      img.src = n.image;
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      itemBtn.appendChild(img);
    }

    itemBtn.appendChild(el('span', 'notif-dot'));

    var body = el('span', 'notif-item-body');
    body.appendChild(el('span', 'notif-item-title', n.title || 'Notification'));
    if (n.body) body.appendChild(el('span', 'notif-item-text', n.body));
    body.appendChild(el('span', 'notif-item-time', timeAgo(n.at)));
    itemBtn.appendChild(body);

    itemBtn.addEventListener('click', function () {
      markRead(n.id);
      if (n.href) {
        close();
        window.location.href = n.href;
      }
    });

    li.appendChild(itemBtn);
    return li;
  }

  function markRead(id) {
    if (String(id).indexOf(REMOTE_PREFIX) === 0) {
      addId(READ_KEY, id);
      render();
      emit();
      return;
    }
    var items = loadLocal();
    var changed = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id && !items[i].read) {
        items[i].read = true;
        changed = true;
      }
    }
    if (changed) {
      saveLocal(items);
      render();
      emit();
    }
  }

  function bump() {
    if (!btn) return;
    btn.classList.remove('bump');
    void btn.offsetWidth; // replay the animation
    btn.classList.add('bump');
  }

  /* ── open / close ────────────────────────────────────────── */
  function open() {
    if (!panel) return;
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (!panel) return;
    if (panel.hidden) open();
    else close();
  }

  /* ── mount ───────────────────────────────────────────────── */
  function buildIcon() {
    return (
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
    );
  }

  function mount() {
    if (document.getElementById(BTN_ID)) return;

    var actions =
      document.querySelector('.header-actions') ||
      document.querySelector('.site-header-actions');
    var inner =
      document.querySelector('.header-inner') ||
      document.querySelector('.site-header-inner');
    var host = actions || inner;
    if (!host) return;

    var wrap = el('div', 'notif-wrap');

    btn = el('button', 'icon-btn notif-btn');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Notifications');
    btn.setAttribute('title', 'Notifications');
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'header-notif-panel');
    btn.innerHTML = buildIcon();

    badgeEl = el('span', 'notif-badge');
    badgeEl.id = 'header-notif-badge';
    badgeEl.hidden = true;
    btn.appendChild(badgeEl);
    wrap.appendChild(btn);

    panel = el('div', 'notif-panel');
    panel.id = 'header-notif-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Notifications');
    panel.hidden = true;

    var head = el('div', 'notif-head');
    head.appendChild(el('span', 'notif-head-title', 'Notifications'));
    var clearBtn = el('button', 'notif-clear', 'Clear all');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      clearAll();
    });
    head.appendChild(clearBtn);
    panel.appendChild(head);

    listEl = el('ul', 'notif-list');
    listEl.id = 'header-notif-list';
    panel.appendChild(listEl);

    emptyEl = el('div', 'notif-empty', 'You\u2019re all caught up.');
    emptyEl.id = 'header-notif-empty';
    panel.appendChild(emptyEl);

    wrap.appendChild(panel);

    if (actions) {
      // Sit with the other header icons: right before the theme toggle.
      var theme = actions.querySelector('.theme-toggle');
      actions.insertBefore(wrap, theme || actions.firstChild);
    } else {
      // Auth-flow headers are centered logo only — park the bell on the right
      // so the logo stays centered.
      wrap.classList.add('notif-wrap--floating');
      inner.appendChild(wrap);
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) close();
    });
    window.addEventListener('storage', function (e) {
      if (e.key && e.key.indexOf('Anteemonee_notifications') === 0) render();
    });

    render();
  }

  /* ── public API ──────────────────────────────────────────── */
  function add(data) {
    data = data || {};
    var item = {
      id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: String(data.title || data.heading || 'Notification'),
      body: (data.body || data.description) ? String(data.body || data.description) : '',
      image: data.image ? String(data.image) : '',
      href: (data.href || data.link) ? String(data.href || data.link) : '',
      at: data.at || Date.now(),
      read: false
    };
    var items = loadLocal();
    items.unshift(item);
    saveLocal(items);
    render();
    bump();
    emit();
    return item;
  }

  function markAllRead() {
    var items = loadLocal().map(function (n) {
      n.read = true;
      return n;
    });
    saveLocal(items);
    var rows = merged();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].remote) addId(READ_KEY, rows[i].id);
    }
    render();
    emit();
  }

  function clearAll() {
    saveLocal([]);
    var rows = remoteRows();
    for (var i = 0; i < rows.length; i++) addId(HIDDEN_KEY, REMOTE_PREFIX + rows[i].id);
    render();
    emit();
  }

  var api = {
    list: merged,
    add: add,
    unread: unreadCount,
    markAllRead: markAllRead,
    clear: clearAll,
    refresh: fetchRemote,
    open: open,
    close: close
  };

  try {
    window.AnteemoneeNotifications = api;
  } catch (e) {}

  window.addEventListener('anteemonee:notification', function (e) {
    add((e && e.detail) || {});
  });

  function boot() {
    seedOnce();
    mount();
    fetchRemote();
    setInterval(fetchRemote, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') fetchRemote();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
