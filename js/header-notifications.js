/* ==========================================================
   Anteemonee — Header notifications (all pages)
   Injects the bell + dropdown panel into the shared header
   and keeps notifications in localStorage (no backend needed).

   Public API:
     AnteemoneeNotifications.add({ title, body, href })
     AnteemoneeNotifications.list()      -> array (newest first)
     AnteemoneeNotifications.unread()    -> number
     AnteemoneeNotifications.markAllRead()
     AnteemoneeNotifications.clear()
     AnteemoneeNotifications.open() / .close()

   Other scripts can push a notification with:
     window.dispatchEvent(new CustomEvent('anteemonee:notification',
       { detail: { title: '…', body: '…', href: '…' } }))
   ========================================================== */
(function () {
  'use strict';

  var KEY = 'Anteemonee_notifications';
  var SEED_KEY = 'Anteemonee_notifications_seeded';
  var MAX_ITEMS = 30;
  var BTN_ID = 'header-notif-btn';

  var btn, panel, listEl, badgeEl, emptyEl;

  /* ── storage ─────────────────────────────────────────────── */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
    } catch (e) {}
  }

  function seedOnce() {
    try {
      if (localStorage.getItem(SEED_KEY)) return;
      localStorage.setItem(SEED_KEY, '1');
    } catch (e) {
      return;
    }
    if (load().length) return;
    save([
      {
        id: 'seed-welcome',
        title: 'Welcome to Anteemonee',
        body: 'News, reminders and account updates will show up here.',
        href: '',
        at: Date.now(),
        read: false
      }
    ]);
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
    var items = load();
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
    var btnItem = el('button', 'notif-item-btn');
    btnItem.type = 'button';

    btnItem.appendChild(el('span', 'notif-dot'));

    var body = el('span', 'notif-item-body');
    body.appendChild(el('span', 'notif-item-title', n.title || 'Notification'));
    if (n.body) body.appendChild(el('span', 'notif-item-text', n.body));
    body.appendChild(el('span', 'notif-item-time', timeAgo(n.at)));
    btnItem.appendChild(body);

    btnItem.addEventListener('click', function () {
      markRead(n.id);
      if (n.href) {
        close();
        window.location.href = n.href;
      }
    });

    li.appendChild(btnItem);
    return li;
  }

  function markRead(id) {
    var items = load();
    var changed = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id && !items[i].read) {
        items[i].read = true;
        changed = true;
      }
    }
    if (changed) {
      save(items);
      render();
      emit();
    }
  }

  function bump() {
    if (!btn) return;
    btn.classList.remove('bump');
    // force reflow so the animation can replay
    void btn.offsetWidth;
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
      save([]);
      render();
      emit();
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
      // Sit next to the other header icons: right before the theme toggle.
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
      if (e.key === KEY) render();
    });

    render();
  }

  /* ── public API ──────────────────────────────────────────── */
  function add(data) {
    data = data || {};
    var item = {
      id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: String(data.title || 'Notification'),
      body: data.body ? String(data.body) : '',
      href: data.href ? String(data.href) : '',
      at: data.at || Date.now(),
      read: false
    };
    var items = load();
    items.unshift(item);
    save(items);
    render();
    bump();
    emit();
    return item;
  }

  var api = {
    list: load,
    add: add,
    unread: function () {
      return load().filter(function (n) {
        return !n.read;
      }).length;
    },
    markAllRead: function () {
      var items = load().map(function (n) {
        n.read = true;
        return n;
      });
      save(items);
      render();
      emit();
    },
    clear: function () {
      save([]);
      render();
      emit();
    },
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
