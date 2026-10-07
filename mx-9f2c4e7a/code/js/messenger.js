/* =========================================================
   Anteemonee MESSENGER — 1-on-1 student chat.
   Requires the messenger migration (conversations,
   dm_participants, messages + safe user RPCs).
   ========================================================= */
(function () {
  'use strict';

  var SUPA_URL = 'https://zkuytvjeqkpexcbyoyhz.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprdXl0dmplcWtwZXhjYnlveWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MjUwNDAsImV4cCI6MjEwMzAwMTA0MH0.8tMbR057BmGaO0_T4nMOVLt1AAmWsPKBEopoSYYis44';

  var REACT_EMOJI = ['❤️', '😂', '😮', '😢', '😡', '👍'];
  var S = { db: null, user: null, convos: [], peers: {}, activeId: null, activePeerId: null, channel: null, seen: {}, friendships: [], friendPeers: {}, blocked: {}, replyTo: null };

  function getDb() {
    try { if (typeof db !== 'undefined' && db) return db; } catch (_) {}
    try { return supabase.createClient(SUPA_URL, SUPA_ANON); } catch (_) { return null; }
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uuidv4() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (_) {}
    var hex = '0123456789abcdef', out = '';
    for (var i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
      else if (i === 14) out += '4';
      else if (i === 19) out += hex[(Math.random() * 4 | 0) + 8];
      else out += hex[Math.random() * 16 | 0];
    }
    return out;
  }
  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      var now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      var hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (sameDay) return hm;
      var yesterday = new Date(now.getTime() - 86400000);
      if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (_) { return ''; }
  }
  function timeAgo(iso) {
    try {
      var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return 'just now';
      var m = Math.floor(s / 60);
      if (m < 60) return m + (m === 1 ? ' min ago' : ' mins ago');
      var h = Math.floor(m / 60);
      if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
      var d = Math.floor(h / 24);
      if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
      var w = Math.floor(d / 7);
      if (w < 5) return w + (w === 1 ? ' week ago' : ' weeks ago');
      return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (_) { return ''; }
  }
  function peerOf(convo) {
    var ids = convo.memberIds || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== S.user.id) return S.peers[ids[i]] || null;
    }
    return null;
  }
  function peerName(peer) {
    if (!peer) return 'Chat';
    return peer.full_name || (peer.username ? '@' + peer.username : 'Chat');
  }
  function avatarHtml(peer, size) {
    var s = size || 40;
    var name = peerName(peer);
    var initial = (name || 'C').charAt(0).toUpperCase();
    if (peer && peer.profile_image_url) {
      return '<span class="ms-ava" style="width:' + s + 'px;height:' + s + 'px"><img src="' + esc(peer.profile_image_url) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span class="ms-ava-fb">' + esc(initial) + '</span></span>';
    }
    return '<span class="ms-ava" style="width:' + s + 'px;height:' + s + 'px"><span class="ms-ava-fb">' + esc(initial) + '</span></span>';
  }

  function show(view) {
    ['msg-gate', 'msg-app'].forEach(function (id) {
      var el = $(id);
      if (el) el.style.display = (id === view) ? '' : 'none';
    });
    var gate = $('msg-gate');
    if (gate && view === 'msg-gate') gate.style.display = 'flex';
  }

  async function boot(user) {
    S.db = getDb();
    if (!user || !S.db) { show('msg-gate'); return; }
    S.user = user;
    show('msg-app');
    bindStatic();
    bindFriendsChrome();
    await loadConversations();
    loadFriends();
    // Deep link: /mx-9f2c4e7a/?dm=<conversation-id> takes precedence —
    // it opens only if the id is one of YOUR conversations (the list comes
    // from RLS-filtered queries, so a stranger's link simply isn't there).
    try {
      var params = new URLSearchParams(window.location.search);
      var dm = params.get('dm');
      if (dm) {
        if (isUuid(dm) && S.convos.some(function (c) { return c.id === dm; })) {
          await openConversation(dm);
          return;
        }
        toastMs("This chat isn't available to you.");
        syncDmUrl(null);
      } else {
        var to = params.get('to');
        if (to) {
          var found = await openUserByName(to);
          if (found) return;
        }
      }
    } catch (_) {}
  }
  function isUuid(s) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
  }
  // Keeps the address bar on the open DM so the link is always shareable.
  // replaceState, never pushState — Back should leave the page, not walk
  // through every chat you opened.
  function syncDmUrl(id) {
    try {
      var u = new URL(window.location.href);
      if (id) u.searchParams.set('dm', id);
      else u.searchParams.delete('dm');
      u.searchParams.delete('to');
      var qs = u.searchParams.toString();
      window.history.replaceState(null, '', u.pathname + (qs ? '?' + qs : ''));
    } catch (_) {}
  }

  var staticBound = false;
  function bindStatic() {
    if (staticBound) return;
    staticBound = true;
    var send = $('ms-send');
    if (send) send.addEventListener('click', sendMessage);
    var input = $('ms-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
    }
    var back = $('ms-back');
    if (back) back.addEventListener('click', function () { leaveChat(); });
    var nq = $('ms-new-q');
    if (nq) {
      var t = null;
      nq.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(searchUsers, 250);
      });
    }
    var nb = $('ms-new-btn');
    if (nb) nb.addEventListener('click', function () { searchUsers(); });
    bindPeerMenu();
  }

  async function loadConversations() {
    var list = $('ms-list');
    try { list.innerHTML = '<div class="ms-hint">Loading…</div>'; } catch (_) {}
    // One round trip instead of five. list_my_conversations() resolves the
    // threads, each peer, and the latest message server-side; the old path
    // awaited dm_participants -> dm_conversations -> dm_participants ->
    // get_user_public -> dm_messages in sequence, and at ~200ms per PostgREST
    // round trip from here that stacked up to about a second of dead time
    // before anything rendered.
    try {
      var res = await S.db.rpc('list_my_conversations');
      if (res.error) throw res.error;
      S.convos = (res.data || []).map(function (r) {
        var memberIds = [S.user.id];
        if (r.peer_id) {
          memberIds.push(r.peer_id);
          S.peers[r.peer_id] = {
            id: r.peer_id,
            username: r.peer_username,
            full_name: r.peer_full_name,
            profile_image_url: r.peer_avatar
          };
        }
        return {
          id: r.conversation_id,
          memberIds: memberIds,
          last_message_at: r.last_message_at,
          muted: !!r.muted,
          pinned: !!r.pinned,
          last: r.last_body == null ? null : { body: r.last_body, created_at: r.last_created_at }
        };
      });
      renderList();
      return;
    } catch (e) {
      console.warn('list_my_conversations unavailable, using fallback:', e && e.message);
    }
    await loadConversationsLegacy(list);
  }

  // Kept as a fallback so an older database without the RPC still gets a
  // working (if slower) chat list.
  async function loadConversationsLegacy(list) {
    try {
      var mine = await S.db.from('dm_participants').select('conversation_id').eq('user_id', S.user.id);
      var ids = ((mine.data || []).map(function (r) { return r.conversation_id; }));
      if (!ids.length) { S.convos = []; renderList(); return; }
      var convos = await S.db.from('dm_conversations').select('id,created_at,last_message_at').in('id', ids).order('last_message_at', { ascending: false }).limit(50);
      S.convos = convos.data || [];
      var parts = await S.db.from('dm_participants').select('conversation_id,user_id').in('conversation_id', ids);
      var byConv = {};
      (parts.data || []).forEach(function (p) {
        (byConv[p.conversation_id] = byConv[p.conversation_id] || []).push(p.user_id);
      });
      S.convos.forEach(function (c) { c.memberIds = byConv[c.id] || []; });
      var peerIds = [];
      S.convos.forEach(function (c) {
        (c.memberIds || []).forEach(function (id) { if (id !== S.user.id && peerIds.indexOf(id) === -1) peerIds.push(id); });
      });
      if (peerIds.length) {
        var pr = await S.db.rpc('get_user_public', { uids: peerIds });
        (pr.data || []).forEach(function (u) { S.peers[u.id] = u; });
      }
      var last = await S.db.from('dm_messages').select('conversation_id,body,created_at').in('conversation_id', ids).order('created_at', { ascending: false }).limit(200);
      var latest = {};
      (last.data || []).forEach(function (m) { if (!latest[m.conversation_id]) latest[m.conversation_id] = m; });
      S.convos.forEach(function (c) { c.last = latest[c.id] || null; });
      renderList();
    } catch (e) {
      console.error('loadConversations failed:', e);
      try { list.innerHTML = '<div class="ms-hint">Could not load chats. Check your connection.</div>'; } catch (_) {}
    }
  }

  var PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><path d="M12 15v5"/></svg>';
  var MUTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>';
  var PIN_MI = '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><path d="M12 15v5"/></svg>';
  var MUTE_MI = '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>';

  var FWD_MI = '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 17l5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>';
  var COPY_MI = '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var DEL_MI = '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
  var FLAG_MI = '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V4h11l-1.2 3.2L15 10H4"/><path d="M19 21V11a6 6 0 0 0-3-5.2"/></svg>';

  function renderList() {
    var list = $('ms-list');
    if (!list) return;
    var html = '';
    var chattedPeerIds = [];
    if (S.convos.length) {
      html += S.convos.map(function (c) {
        var peer = peerOf(c);
        (c.memberIds || []).forEach(function (id) {
          if (id !== S.user.id && chattedPeerIds.indexOf(id) === -1) chattedPeerIds.push(id);
        });
        var preview = c.last ? c.last.body : 'Say hello 👋';
        var sub = c.last ? timeAgo(c.last.created_at) : '';
        return '<div class="ms-convo-wrap" data-wrap="' + c.id + '">'
          + '<button type="button" class="ms-convo' + (c.id === S.activeId ? ' active' : '') + '" data-convo="' + c.id + '">'
          + avatarHtml(peer, 44)
          + '<span class="ms-convo-body">'
          + '<span class="ms-convo-top">'
          + '<span class="ms-convo-name">' + (c.pinned ? '<span class="ms-convo-flags">' + PIN_ICON + '</span>' : '')
          + '<b>' + esc(peerName(peer)) + '</b></span></span>'
          + '<span class="ms-convo-bot">'
          + '<span class="ms-convo-prev">' + esc(preview) + '</span>'
          + '<span class="ms-time-col">' + (c.muted ? '<span class="ms-convo-flags">' + MUTE_ICON + '</span>' : '')
          + '<span>' + esc(sub) + '</span></span></span>'
          + '</span>'
          + '</button>'
          + '<button type="button" class="ms-convo-more" data-cmenu="' + c.id + '" aria-label="Chat options" aria-haspopup="menu" aria-expanded="false">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>'
          + '</button>'
          + '<div class="ms-menu ms-convo-menu" data-cmenu-for="' + c.id + '" role="menu">'
          + '<button type="button" data-act="pin" data-for="' + c.id + '" role="menuitem">' + PIN_MI + '<span class="cm-label">' + (c.pinned ? 'Unpin chat' : 'Pin chat') + '</span></button>'
          + '<button type="button" data-act="mute" data-for="' + c.id + '" role="menuitem">' + MUTE_MI + '<span class="cm-label">' + (c.muted ? 'Unmute' : 'Mute') + '</span></button>'
          + '<button type="button" data-act="delete" data-for="' + c.id + '" class="danger" role="menuitem">'
          + '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Delete chat</button>'
          + '</div></div>';
      }).join('');
    }
    // Friends without any messages yet, right inside the chats list.
    var fresh = friendRows().filter(function (r) { return r.status === 'accepted'; }).map(function (r) {
      return (r.requester_id === S.user.id) ? r.addressee_id : r.requester_id;
    }).filter(function (id, i, arr) { return id && chattedPeerIds.indexOf(id) === -1 && arr.indexOf(id) === i; });
    html += fresh.map(function (id) {
      var peer = S.friendPeers[id] || S.peers[id] || null;
      return '<button type="button" class="ms-convo" data-friend="' + esc(id) + '">'
        + avatarHtml(peer, 44)
        + '<span class="ms-convo-body"><span class="ms-convo-top"><b>' + esc(peerName(peer)) + '</b><span></span></span>'
        + '<span class="ms-convo-prev">No messages yet — send the first message</span></span>'
        + '</button>';
    }).join('');
    if (!html) {
      list.innerHTML = '<div class="ms-hint">No conversations yet.<br>Search a username above to start chatting.</div>';
      syncPeerActions();
      return;
    }
    list.innerHTML = html;
    syncPeerActions();
    bindConvoMenus(list);
    list.querySelectorAll('[data-convo]').forEach(function (b) {
      b.addEventListener('click', function () { openConversation(b.getAttribute('data-convo')); });
    });
    list.querySelectorAll('[data-friend]').forEach(function (b) {
      b.addEventListener('click', function () { openDirectChat(b.getAttribute('data-friend')); });
    });
  }

  async function openConversation(id) {
    S.activeId = id;
    S.seen = {};
    cancelReply();
    closeMsgMenus();
    renderList();
    syncDmUrl(id);
    try { var emp = $('ms-empty'); if (emp) emp.style.display = 'none'; } catch (_) {}
    var convo = null;
    S.convos.forEach(function (c) { if (c.id === id) convo = c; });
    var peer = convo ? peerOf(convo) : null;
    S.activePeerId = null;
    (convo && convo.memberIds || []).forEach(function (mid) {
      if (mid !== S.user.id) S.activePeerId = mid;
    });
    var head = $('ms-peer');
    if (head) head.innerHTML = avatarHtml(peer, 36) + '<span><b>' + esc(peerName(peer)) + '</b></span>';
    syncPeerActions();
    var box = $('ms-messages');
    if (box) box.innerHTML = '<div class="ms-hint">Loading messages…</div>';
    try { document.querySelector('.msg-wrap').classList.add('chat-open'); } catch (_) {}
    try {
      if (S.channel) { await S.db.removeChannel(S.channel); S.channel = null; }
    } catch (_) {}
    try {
      var res = await S.db.rpc('get_dm_messages', { p_conversation: id });
      if (res.error) throw res.error;
      if (box) box.innerHTML = '';
      msgStore = {};
      (res.data || []).forEach(appendMessage);
      scrollBottom();
    } catch (_) {
      if (box) box.innerHTML = '<div class="ms-hint">Could not load messages.</div>';
    }
    try {
      S.channel = S.db.channel('conv-' + id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: 'conversation_id=eq.' + id }, function (payload) {
          if (!payload || !payload.new) return;
          var m = payload.new;
          m.reactions = m.reactions || [];
          if (m.reply_to_id) {
            // The quote isn't in the realtime payload. Take it from the
            // already-rendered parent, else refresh the thread once.
            var parent = msgStore[m.reply_to_id];
            if (parent) { m.reply_body = parent.body; m.reply_sender_id = parent.sender_id; }
            else scheduleMsgRefresh();
          }
          appendMessage(m); scrollBottom(); bumpPreview(m);
        })
        .subscribe();
    } catch (_) {}
    try {
      var input = $('ms-input');
      if (input) input.focus();
    } catch (_) {}
  }

  function appendMessage(m) {
    if (!m || S.seen[m.id]) return;
    S.seen[m.id] = true;
    var box = $('ms-messages');
    if (!box) return;
    var mine = m.sender_id === S.user.id;
    var who = peerName(S.peers[m.sender_id] || null);
    if (mine) who = 'You';
    var rx = reactionsOf(m);
    var mineRx = mine ? ' mine' : '';
    var html = '';
    if (m.forwarded) {
      html += '<span class="ms-fwd-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 17l5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>Forwarded</span>';
    }
    if (m.reply_body) {
      html += '<span class="ms-reply-ref">↩ <b>' + esc(who) + '</b> · ' + esc(m.reply_body) + '</span>';
    }
    // Toolbar and picker live INSIDE the bubble: the bubble is their
    // positioning anchor (so they stay flush regardless of how wide .ms-msg
    // grows) and being its children means hovering the bubble keeps them
    // visible all the way across.
    html += '<span class="ms-bubble">' + esc(m.body)
      + '<span class="ms-emoji-strip" data-emoji-for="' + m.id + '" hidden>'
      + REACT_EMOJI.map(function (e) { return '<button type="button" data-emoji="' + e + '" data-mid="' + m.id + '">' + e + '</button>'; }).join('')
      + '<button type="button" class="ms-plus" data-plus="1" data-mid="' + m.id + '" title="More emoji" aria-label="More emoji">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>'
      + '</span>'
      + '<span class="ms-msg-acts" data-acts-for="' + m.id + '">'
      + '<button type="button" data-mact="react" data-mid="' + m.id + '" title="React" aria-label="React to message">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><circle cx="9" cy="10" r="1.05" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.05" fill="currentColor" stroke="none"/><path d="M8.1 14.3a4.7 4.7 0 0 0 7.8 0"/></svg></button>'
      + '<button type="button" data-mact="reply" data-mid="' + m.id + '" title="Reply" aria-label="Reply">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 14.5 4 9.5l5.5-5"/><path d="M4 9.5h9.5a6 6 0 0 1 6 6V19"/></svg></button>'
      + '<button type="button" data-mact="more" data-mid="' + m.id + '" title="More" aria-label="More actions">'
      + '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.2" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="18.8" r="1.75"/></svg></button>'
      + '</span></span>';
    if (rx.length) {
      html += '<span class="ms-reactions">' + rx.map(function (r) {
        return '<button type="button" class="ms-react' + (r.mine ? mineRx : '') + '" data-react="' + r.emoji + '" data-mid="' + m.id + '">' + r.emoji + (r.n > 1 ? '<em>' + r.n + '</em>' : '') + '</button>';
      }).join('') + '</span>';
    }
    html += '<span class="ms-time">' + esc(fmtTime(m.created_at)) + '</span>';
    var div = document.createElement('div');
    div.className = 'ms-msg' + (mine ? ' me' : '');
    div.setAttribute('data-mid', m.id);
    div.innerHTML = html;
    box.appendChild(div);
    wireMsgNode(div, m);
  }
  // Collapses [{u,e}] from the RPC into [{emoji, n, mine}].
  function reactionsOf(m) {
    var list = m.reactions;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch (_) { list = []; } }
    if (!list || !list.length) return [];
    var out = [], byEmoji = {};
    list.forEach(function (r) {
      var e = r.e || r.emoji;
      if (!e) return;
      if (!byEmoji[e]) { byEmoji[e] = { emoji: e, n: 0, mine: false }; out.push(byEmoji[e]); }
      byEmoji[e].n++;
      if (r.u === S.user.id) byEmoji[e].mine = true;
    });
    return out;
  }
  function scrollBottom() {
    try {
      var box = $('ms-messages');
      if (box) box.scrollTop = box.scrollHeight;
    } catch (_) {}
  }
  function bumpPreview(m) {
    if (!m || m.conversation_id !== S.activeId) { loadConversationsQuiet(); return; }
    S.convos.forEach(function (c) { if (c.id === m.conversation_id) c.last = m; });
    renderList();
  }
  var quietTimer = null;
  function loadConversationsQuiet() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () {
      var keep = S.activeId;
      loadConversations().then(function () { S.activeId = keep; renderList(); });
    }, 1500);
  }

  async function sendMessage() {
    var input = $('ms-input');
    if (!input || !S.activeId) return;
    var body = (input.value || '').trim();
    if (!body) return;
    if (body.length > 2000) body = body.slice(0, 2000);
    input.value = '';
    input.style.height = 'auto';
    var replyToId = S.replyTo ? S.replyTo.id : null;
    var replyPrev = S.replyTo ? S.replyTo.body : null;
    var replyPrevSender = S.replyTo ? S.replyTo.sender_id : null;
    cancelReply();
    try {
      var payload = { conversation_id: S.activeId, sender_id: S.user.id, body: body };
      if (replyToId) payload.reply_to_id = replyToId;
      var res = await S.db.from('dm_messages').insert(payload).select('id,sender_id,body,created_at,reply_to_id').single();
      if (res.error) throw res.error;
      if (res.data) {
        res.data.reactions = [];
        if (replyToId) { res.data.reply_body = replyPrev; res.data.reply_sender_id = replyPrevSender; }
        appendMessage(res.data); scrollBottom(); bumpPreview(res.data);
      }
      try { await S.db.from('dm_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', S.activeId); } catch (_) {}
    } catch (e) {
      input.value = body;
      try { toastMs('Could not send. Try again.'); } catch (_) {}
      if (replyToId) startReply(replyToId);
    }
  }
  function toastMs(msg) {
    var t = $('ms-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  async function searchUsers() {
    var q = (($('ms-new-q') || {}).value || '').trim();
    var box = $('ms-results');
    if (!box) return;
    if (q.length < 2) { box.innerHTML = ''; box.style.display = 'none'; return; }
    try {
      var res = await S.db.rpc('search_users_by_username', { q: q });
      var rows = res.data || [];
      if (!rows.length) { box.innerHTML = '<div class="ms-hint">No students found.</div>'; box.style.display = ''; return; }
      box.innerHTML = rows.map(function (u) {
        var name = u.full_name || (u.username ? '@' + u.username : 'Student');
        var initial = (name || 'S').charAt(0).toUpperCase();
        var av = u.profile_image_url
          ? '<span class="ms-ava" style="width:32px;height:32px"><img src="' + esc(u.profile_image_url) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span class="ms-ava-fb">' + esc(initial) + '</span></span>'
          : '<span class="ms-ava" style="width:32px;height:32px"><span class="ms-ava-fb">' + esc(initial) + '</span></span>';
        return '<button type="button" class="ms-user" data-uid="' + esc(u.id) + '">' + av + '<span><b>' + esc(name) + '</b><span class="ms-uname">@' + esc(u.username || '') + '</span></span></button>';
      }).join('');
      box.style.display = '';
      box.querySelectorAll('[data-uid]').forEach(function (b) {
        b.addEventListener('click', function () { openDirectChat(b.getAttribute('data-uid')); });
      });
    } catch (_) {
      box.innerHTML = '<div class="ms-hint">Search unavailable right now.</div>';
      box.style.display = '';
    }
  }

  async function openUserByName(username) {
    try {
      var res = await S.db.rpc('search_users_by_username', { q: username });
      var rows = res.data || [];
      for (var i = 0; i < rows.length; i++) {
        if ((rows[i].username || '').toLowerCase() === String(username).toLowerCase()) {
          await openDirectChat(rows[i].id);
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  async function openDirectChat(otherId) {
    var box = $('ms-results');
    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
    var nq = $('ms-new-q');
    if (nq) nq.value = '';
    try { toastMs('Opening chat…'); } catch (_) {}
    // One round trip. open_dm_conversation() finds an existing thread or
    // creates one inside a single transaction, so tapping Message twice can
    // no longer race into two duplicate conversations, and it also replaces
    // the read-then-insert dance (plus its RLS chicken-and-egg) entirely.
    try {
      var res = await S.db.rpc('open_dm_conversation', { p_other: otherId });
      if (res.error) throw res.error;
      var cid = res.data;
      if (!cid) throw new Error('No conversation returned');
      var pr = await S.db.rpc('get_user_public', { uids: [otherId] });
      if (pr.data && pr.data[0]) S.peers[otherId] = pr.data[0];
      var known = false;
      S.convos.forEach(function (c) { if (c.id === cid) known = true; });
      if (!known) {
        S.convos.unshift({ id: cid, memberIds: [S.user.id, otherId], last: null, last_message_at: new Date().toISOString() });
      }
      await openConversation(cid);
      return;
    } catch (e) {
      var msg = String((e && e.message) || '');
      if (!/does not exist|not found|PGRST202|404/i.test(msg)) {
        console.error('openDirectChat failed:', e);
        try { toastMs(msg ? 'Could not open chat: ' + msg : 'Could not open chat. Try again.'); } catch (_) {}
        return;
      }
      console.warn('open_dm_conversation unavailable, using fallback:', msg);
    }
    await openDirectChatLegacy(otherId);
  }

  // Kept as a fallback so an older database without the RPC still works.
  async function openDirectChatLegacy(otherId) {
    try {
      var mine = await S.db.from('dm_participants').select('conversation_id').eq('user_id', S.user.id);
      var ids = (mine.data || []).map(function (r) { return r.conversation_id; });
      if (ids.length) {
        var parts = await S.db.from('dm_participants').select('conversation_id,user_id').in('conversation_id', ids);
        var byConv = {};
        (parts.data || []).forEach(function (p) {
          (byConv[p.conversation_id] = byConv[p.conversation_id] || []).push(p.user_id);
        });
        var keys = Object.keys(byConv);
        for (var i = 0; i < keys.length; i++) {
          var members = byConv[keys[i]];
          if (members.length === 2 && members.indexOf(S.user.id) !== -1 && members.indexOf(otherId) !== -1) {
            await openConversation(keys[i]);
            return;
          }
        }
      }
      // Mint the id client-side. The INSERT policy on dm_conversations is permissive
      // (WITH CHECK true), but its SELECT policy only exposes conversations the user
      // already participates in — and no dm_participants row exists yet at this point.
      // So `INSERT ... RETURNING` comes back filtered to zero rows and .single() throws
      // PGRST116, leaving an orphan conversation behind on every attempt.
      var cid = uuidv4();
      var c = await S.db.from('dm_conversations').insert({ id: cid, created_by: S.user.id });
      if (c.error) throw c.error;
      var ins = await S.db.from('dm_participants').insert([
        { conversation_id: cid, user_id: S.user.id },
        { conversation_id: cid, user_id: otherId }
      ]);
      if (ins.error) throw ins.error;
      var pr = await S.db.rpc('get_user_public', { uids: [otherId] });
      if (pr.data && pr.data[0]) S.peers[otherId] = pr.data[0];
      S.convos.unshift({ id: cid, memberIds: [S.user.id, otherId], last: null, last_message_at: new Date().toISOString() });
      await openConversation(cid);
    } catch (e) {
      console.error('openDirectChatLegacy failed:', e);
      try { toastMs(e && e.message ? 'Could not open chat: ' + e.message : 'Could not open chat. Try again.'); } catch (_) {}
    }
  }

  /* ── Chat header menu: block / report / unfriend ── */

  var peerMenuBound = false;
  function bindPeerMenu() {
    if (peerMenuBound) return;
    peerMenuBound = true;
    var btn = $('ms-peer-btn');
    var menu = $('ms-peer-menu');
    if (btn && menu) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        try {
          if (!menu.classList.contains('open')) return;
          if (menu.contains(e.target) || btn.contains(e.target)) return;
          menu.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
        } catch (_) {}
      });
      document.addEventListener('keydown', function (e) {
        if ((e.key === 'Escape' || e.keyCode === 27) && menu.classList.contains('open')) {
          menu.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
        }
      });
      menu.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!item) return;
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        peerAction(item.getAttribute('data-act'));
      });
    }
    // Close an open chat-row menu on any outside click / Escape.
    document.addEventListener('click', function () {
      var list = $('ms-list');
      if (list) closeConvoMenus(list);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.keyCode !== 27) return;
      var list = $('ms-list');
      if (list) closeConvoMenus(list);
    });

    var rc = $('ms-reply-cancel');
    if (rc) rc.addEventListener('click', cancelReply);
    var fq = $('ms-fwd-q');
    if (fq) fq.addEventListener('input', function () { renderForwardList(fq.value); });
    var fc = $('ms-fwd-cancel');
    if (fc) fc.addEventListener('click', function () {
      var ov = $('ms-fwd-modal');
      if (ov) ov.hidden = true;
    });
    var fo = $('ms-fwd-modal');
    if (fo) fo.addEventListener('mousedown', function (e) { if (e.target === fo) fo.hidden = true; });

    // Call buttons are UI-only for now: no signalling or media pipeline yet.
    var voice = $('ms-call-voice');
    if (voice) voice.addEventListener('click', function () { toastMs('Voice calls are coming soon.'); });
    var video = $('ms-call-video');
    if (video) video.addEventListener('click', function () { toastMs('Video calls are coming soon.'); });
    var ov = $('ms-modal');
    var ok = $('ms-modal-ok');
    var cancel = $('ms-modal-cancel');
    if (ok) ok.addEventListener('click', function () {
      var active = $('ms-modal-reasons').querySelector('.ms-reason.active');
      var details = (($('ms-modal-details') || {}).value || '').trim();
      closeModal(true, { reason: active ? active.textContent : '', details: details });
    });
    if (cancel) cancel.addEventListener('click', function () { closeModal(false); });
    if (ov) ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeModal(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        if (ov && !ov.hidden) closeModal(false);
        closeMsgMenus();
        var fo = $('ms-fwd-modal');
        if (fo && !fo.hidden) fo.hidden = true;
      }
    });
    // Clicking anywhere off a message dismisses its toolbar popovers.
    document.addEventListener('click', function () { closeMsgMenus(); });

    var rc = $('ms-reply-cancel');
    if (rc) rc.addEventListener('click', cancelReply);
    var fq = $('ms-fwd-q');
    if (fq) fq.addEventListener('input', function () { renderForwardList(fq.value); });
    var fc = $('ms-fwd-cancel');
    if (fc) fc.addEventListener('click', function () {
      var fo = $('ms-fwd-modal');
      if (fo) fo.hidden = true;
    });
    var fo2 = $('ms-fwd-modal');
    if (fo2) fo2.addEventListener('mousedown', function (e) { if (e.target === fo2) fo2.hidden = true; });
  }

  function isFriendOf(id) {
    var found = false;
    friendRows().forEach(function (r) {
      if (r.status !== 'accepted') return;
      var other = (r.requester_id === S.user.id) ? r.addressee_id : r.requester_id;
      if (other === id) found = true;
    });
    return found;
  }
  function syncPeerActions() {
    var wrap = $('ms-peer-actions');
    if (!wrap) return;
    if (!S.activeId || !S.activePeerId) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var label = $('ms-peer-block-label');
    if (label) label.textContent = S.blocked[S.activePeerId] ? 'Unblock' : 'Block';
    var unfriend = document.querySelector('#ms-peer-menu [data-act="unfriend"]');
    if (unfriend) unfriend.hidden = !isFriendOf(S.activePeerId);
  }
  function leaveChat() {
    try { if (S.channel) { S.db.removeChannel(S.channel); S.channel = null; } } catch (_) {}
    S.activeId = null;
    S.activePeerId = null;
    S.seen = {};
    cancelReply();
    closeMsgMenus();
    syncDmUrl(null);
    try {
      var wrap = document.querySelector('.msg-wrap');
      if (wrap) wrap.classList.remove('chat-open');
    } catch (_) {}
    try { var empty = $('ms-empty'); if (empty) empty.style.display = ''; } catch (_) {}
    syncPeerActions();
  }

  var modalResolve = null;
  function askModal(opts) {
    var ov = $('ms-modal');
    if (!ov) return Promise.resolve({ ok: false });
    $('ms-modal-title').textContent = opts.title || '';
    $('ms-modal-text').textContent = opts.text || '';
    var ok = $('ms-modal-ok');
    ok.textContent = opts.confirm || 'Confirm';
    ok.className = 'ms-modal-btn ' + (opts.tone === 'danger' ? 'danger' : 'ghost');
    var why = $('ms-modal-why');
    var reasonsBox = $('ms-modal-reasons');
    reasonsBox.innerHTML = '';
    var details = $('ms-modal-details');
    details.value = '';
    if (opts.reasons && opts.reasons.length) {
      why.hidden = false;
      details.placeholder = opts.placeholder || 'Add more detail (optional)';
      opts.reasons.forEach(function (label, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ms-reason' + (i === 0 ? ' active' : '');
        b.textContent = label;
        b.addEventListener('click', function () {
          reasonsBox.querySelectorAll('.ms-reason').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        });
        reasonsBox.appendChild(b);
      });
    } else {
      why.hidden = true;
    }
    ov.hidden = false;
    setTimeout(function () { try { ok.focus(); } catch (_) {} }, 30);
    return new Promise(function (resolve) { modalResolve = resolve; });
  }
  function closeModal(value, data) {
    var ov = $('ms-modal');
    if (ov) ov.hidden = true;
    var r = modalResolve;
    modalResolve = null;
    if (r) r({ ok: !!value, data: data || {} });
  }

  function copyDmLink() {
    if (!S.activeId) return;
    var url;
    try {
      var u = new URL(window.location.href);
      u.search = '?dm=' + encodeURIComponent(S.activeId);
      u.hash = '';
      url = u.toString();
    } catch (_) { return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toastMs('Link copied — only you two can open it.'); }, function () { toastMs('Could not copy link.'); });
        return;
      }
    } catch (_) {}
    toastMs('Could not copy link.');
  }

  async function peerAction(act) {
    var id = S.activePeerId;
    if (!id) return;
    var name = peerName(S.peers[id] || null);
    if (act === 'copylink') return copyDmLink();
    if (act === 'block') return toggleBlock(id, name);
    if (act === 'report') return reportUser(id, name);
    if (act === 'unfriend') return unfriendUser(id, name);
  }

  async function toggleBlock(id, name) {
    var isBlocked = !!S.blocked[id];
    var res = await askModal({
      title: isBlocked ? ('Unblock ' + name + '?') : ('Block ' + name + '?'),
      text: isBlocked
        ? 'They will be able to message you again.'
        : 'They will not be able to message you, and this chat will be hidden. You can unblock them any time.',
      confirm: isBlocked ? 'Unblock' : 'Block',
      tone: 'danger'
    });
    if (!res.ok) return;
    try {
      if (isBlocked) {
        var del = await S.db.from('dm_blocks').delete().eq('blocker_id', S.user.id).eq('blocked_id', id);
        if (del.error) throw del.error;
        delete S.blocked[id];
        toastMs('Unblocked ' + name + '.');
      } else {
        var ins = await S.db.from('dm_blocks').insert({ blocker_id: S.user.id, blocked_id: id });
        if (ins.error) throw ins.error;
        S.blocked[id] = true;
        toastMs('Blocked ' + name + '.');
      }
      syncPeerActions();
      if (!isBlocked) { leaveChat(); loadConversations(); }
    } catch (e) {
      console.error('toggleBlock failed:', e);
      toastMs('Could not update block. Try again.');
    }
  }

  async function reportUser(id, name) {
    var res = await askModal({
      title: 'Report ' + name,
      text: 'Let us know what happened. Our team reviews every report.',
      reasons: ['Harassment', 'Spam or scam', 'Inappropriate content', 'Impersonation', 'Something else'],
      confirm: 'Report',
      tone: 'danger'
    });
    if (!res.ok) return;
    try {
      var row = {
        reporter_id: S.user.id,
        reported_id: id,
        reason: res.data.reason || 'Something else',
        details: res.data.details || null
      };
      if (S.activeId) row.conversation_id = S.activeId;
      var ins = await S.db.from('dm_reports').insert(row);
      if (ins.error) throw ins.error;
      toastMs('Report sent. Thanks for letting us know.');
    } catch (e) {
      console.error('reportUser failed:', e);
      toastMs('Could not send report. Try again.');
    }
  }

  async function unfriendUser(id, name) {
    var res = await askModal({
      title: 'Remove ' + name + '?',
      text: 'They will be removed from your friends list. Your chat history is kept.',
      confirm: 'Unfriend',
      tone: 'danger'
    });
    if (!res.ok) return;
    try {
      var del = await S.db.from('dm_friendships').delete()
        .eq('status', 'accepted')
        .or('and(requester_id.eq.' + S.user.id + ',addressee_id.eq.' + id + '),and(requester_id.eq.' + id + ',addressee_id.eq.' + S.user.id + ')');
      if (del.error) throw del.error;
      toastMs('Removed ' + name + ' from friends.');
      await loadFriends();
      syncPeerActions();
    } catch (e) {
      console.error('unfriendUser failed:', e);
      toastMs('Could not update friends. Try again.');
    }
  }

  async function loadBlocked() {
    if (!S.db || !S.user) return;
    try {
      var res = await S.db.from('dm_blocks').select('blocked_id');
      S.blocked = {};
      (res.data || []).forEach(function (r) { S.blocked[r.blocked_id] = true; });
    } catch (_) {}
  }

  /* ── Per-message actions ── */

  var msgStore = {};
  function wireMsgNode(node, m) {
    if (!m) return;
    msgStore[m.id] = m;
    // Show/hide in JS rather than relying on :hover alone. The toolbar sits
    // outside the bubble's box, so a pointer crossing the join can land on
    // neither element and drop :hover before it arrives. The grace period
    // means a sub-pixel miss doesn't kill the bar — moving onto it fires
    // mouseenter again and cancels the pending hide.
    var acts = node.querySelector('.ms-msg-acts');
    if (acts) {
      var hideTimer = null;
      var showActs = function () { clearTimeout(hideTimer); acts.classList.add('open'); };
      var hideActs = function () {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () { acts.classList.remove('open'); }, 160);
      };
      node.addEventListener('mouseenter', showActs);
      node.addEventListener('mouseleave', hideActs);
      acts.addEventListener('mouseenter', showActs);
      acts.addEventListener('mouseleave', hideActs);
    }
    node.addEventListener('click', function (e) {
      var t = e.target;
      var emoji = t.closest && t.closest('[data-emoji]');
      var react = t.closest && t.closest('[data-react]');
      var plus = t.closest && t.closest('[data-plus]');
      var act = t.closest && t.closest('[data-mact]');
      if (emoji) { e.stopPropagation(); toggleReaction(emoji.getAttribute('data-emoji'), emoji.getAttribute('data-mid')); return; }
      if (react) { e.stopPropagation(); toggleReaction(react.getAttribute('data-react'), react.getAttribute('data-mid')); return; }
      if (plus) { e.stopPropagation(); openFullPicker(plus.getAttribute('data-mid')); return; }
      if (act) {
        e.stopPropagation();
        var kind = act.getAttribute('data-mact');
        var id = act.getAttribute('data-mid');
        if (kind === 'react') {
          var strip = node.querySelector('.ms-emoji-strip');
          // `hidden` already means "closed", so pass it straight through —
          // negating it asked the picker to close while it was shut.
          if (strip) toggleEmojiStrip(node, strip.hidden);
        }
        else if (kind === 'reply') { startReply(id); }
        else if (kind === 'more') { openMsgMenu(act, id); }
      }
    });
  }
  function toggleEmojiStrip(node, show) {
    var box = $('ms-messages');
    if (!box) return;
    if (!show) {
      box.querySelectorAll('.ms-emoji-strip').forEach(function (s) { s.hidden = true; });
      box.querySelectorAll('.ms-msg.reacting').forEach(function (n) { n.classList.remove('reacting'); });
      return;
    }
    var strip = node.querySelector('.ms-emoji-strip');
    if (strip) { strip.hidden = false; node.classList.add('reacting'); }
  }
  async function toggleReaction(emoji, id) {
    if (!emoji || !id) return;
    var m = msgStore[id];
    var have = reactionsOf(m || {}).some(function (r) { return r.mine && r.emoji === emoji; });
    try {
      if (have) {
        var del = await S.db.from('dm_reactions').delete().eq('message_id', id).eq('user_id', S.user.id).eq('emoji', emoji);
        if (del.error) throw del.error;
      } else {
        var ins = await S.db.from('dm_reactions').upsert({
          conversation_id: S.activeId, message_id: id, user_id: S.user.id, emoji: emoji
        }, { onConflict: 'message_id,user_id' });
        if (ins.error) throw ins.error;
      }
      var box = $('ms-messages');
      if (box) box.querySelectorAll('.ms-emoji-strip').forEach(function (s) { s.hidden = true; });
      if (box) box.querySelectorAll('.ms-msg.reacting').forEach(function (n) { n.classList.remove('reacting'); });
      await reloadMessages();
    } catch (e) {
      console.error('toggleReaction failed:', e);
      toastMs('Could not react. Try again.');
    }
  }

  /* Full emoji picker: every emoji, loaded once on first use. */
  var fullPickerWrap = null, fullPickerEl = null;
  function isDarkTheme() {
    try { return document.documentElement.getAttribute('data-theme') !== 'light'; }
    catch (_) { return true; }
  }
  async function ensureEmojiPicker() {
    try {
      if (window.customElements && window.customElements.get('emoji-picker')) return true;
      await import('https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js');
      return !!(window.customElements && window.customElements.get('emoji-picker'));
    } catch (e) {
      console.error('emoji picker failed to load:', e);
      return false;
    }
  }
  async function openFullPicker(mid) {
    var m = msgStore[mid];
    if (!m) return;
    S.reactMid = mid;
    if (!fullPickerWrap) {
      fullPickerWrap = document.createElement('div');
      fullPickerWrap.className = 'ms-emoji-full';
      fullPickerWrap.id = 'ms-emoji-full';
      fullPickerWrap.hidden = true;
      fullPickerWrap.innerHTML = '<div class="ms-emoji-loading">Loading emoji…</div>';
      document.body.appendChild(fullPickerWrap);
      fullPickerWrap.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    var anchor = document.querySelector('.ms-msg[data-mid="' + mid + '"] .ms-msg-acts');
    var r = anchor ? anchor.getBoundingClientRect() : null;
    fullPickerWrap.hidden = false;
    var W = Math.min(352, window.innerWidth - 20), H = 420;
    var left = Math.max(10, Math.min(r ? r.left : window.innerWidth / 2, window.innerWidth - W - 10));
    var top = r ? r.bottom + 8 : 100;
    if (top + H > window.innerHeight - 10) top = Math.max(10, (r ? r.top : 200) - H - 8);
    fullPickerWrap.style.width = W + 'px';
    fullPickerWrap.style.left = left + 'px';
    fullPickerWrap.style.top = top + 'px';
    var ok = await ensureEmojiPicker();
    if (!S.reactMid) return; // closed while loading
    if (!ok) {
      toastMs('Could not load the full emoji list.');
      closeFullPicker();
      return;
    }
    if (!fullPickerEl) {
      fullPickerEl = document.createElement('emoji-picker');
      fullPickerEl.addEventListener('emoji-click', function (ev) {
        var uni = ev && ev.detail && ev.detail.unicode;
        var target = S.reactMid;
        closeFullPicker();
        if (uni && target) toggleReaction(uni, target);
      });
      var load = fullPickerWrap.querySelector('.ms-emoji-loading');
      if (load) load.remove();
      fullPickerWrap.appendChild(fullPickerEl);
    }
    fullPickerEl.classList.toggle('dark', isDarkTheme());
    fullPickerEl.classList.toggle('light', !isDarkTheme());
  }
  function closeFullPicker() {
    S.reactMid = null;
    if (fullPickerWrap) fullPickerWrap.hidden = true;
  }

  function startReply(id) {
    var m = msgStore[id];
    if (!m) return;
    S.replyTo = m;
    var bar = $('ms-reply-bar');
    var text = $('ms-reply-text');
    if (!bar || !text) return;
    text.innerHTML = 'Replying to <b>' + esc(m.sender_id === S.user.id ? 'yourself' : peerName(S.peers[m.sender_id] || null)) + '</b> · ' + esc(m.body);
    bar.hidden = false;
    try { var input = $('ms-input'); if (input) input.focus(); } catch (_) {}
  }
  function cancelReply() {
    S.replyTo = null;
    var bar = $('ms-reply-bar');
    if (bar) bar.hidden = true;
  }

  function openMsgMenu(anchor, id) {
    closeMsgMenus();
    var m = msgStore[id];
    if (!m) return;
    var mine = m.sender_id === S.user.id;
    var ageMin = Math.floor((Date.now() - new Date(m.created_at).getTime()) / 60000);
    var canUnsend = mine && ageMin < 5;
    var menu = document.createElement('div');
    menu.className = 'ms-menu ms-msg-menu';
    menu.setAttribute('role', 'menu');
    var who = peerName(S.peers[m.sender_id] || null);
    menu.innerHTML =
      '<button type="button" data-mact2="forward" role="menuitem">' + FWD_MI + 'Forward</button>'
      + '<button type="button" data-mact2="copy" role="menuitem">' + COPY_MI + 'Copy</button>'
      + (canUnsend ? '<button type="button" data-mact2="unsend" role="menuitem">' + DEL_MI + 'Unsend</button>' : '')
      + '<button type="button" data-mact2="report" class="danger" role="menuitem">' + FLAG_MI + (mine ? 'Report' : 'Report ' + esc(who)) + '</button>';
    document.body.appendChild(menu);
    // .ms-menu is display:none until .open is applied, so open it *before*
    // measuring — offsetWidth reads 0 while hidden and the placement
    // maths depends on it.
    menu.classList.add('open');
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 6, left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 10);
    if (top + menu.offsetHeight > window.innerHeight - 10) top = Math.max(10, r.top - menu.offsetHeight - 6);
    menu.style.top = top + 'px';
    menu.style.left = Math.max(10, left) + 'px';
    menu.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-mact2]');
      if (!b) return;
      var kind = b.getAttribute('data-mact2');
      closeMsgMenus();
      if (kind === 'forward') openForwardPicker(id);
      else if (kind === 'copy') copyText(m.body);
      else if (kind === 'unsend') unsendMessage(id);
      else if (kind === 'report') reportMessage(id, m);
    });
    var acts = anchor.closest && anchor.closest('.ms-msg-acts');
    if (acts) acts.classList.add('open');
  }
  function closeMsgMenus() {
    document.querySelectorAll('.ms-msg-menu').forEach(function (m) { m.remove(); });
    closeFullPicker();
    var box = $('ms-messages');
    if (box) {
      box.querySelectorAll('.ms-msg-acts.open').forEach(function (a) { a.classList.remove('open'); });
      box.querySelectorAll('.ms-emoji-strip').forEach(function (s) { s.hidden = true; });
      box.querySelectorAll('.ms-msg.reacting').forEach(function (n) { n.classList.remove('reacting'); });
    }
  }
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toastMs('Copied.'); }, function () { toastMs('Could not copy.'); });
        return;
      }
    } catch (_) {}
    toastMs('Could not copy.');
  }
  async function unsendMessage(id) {
    try {
      var res = await S.db.from('dm_messages').delete().eq('id', id).select('id');
      // RLS silently skips rows it refuses, so an empty result means the
      // message was too old to unsend rather than a hard failure.
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) { toastMs('You can only unsend within 5 minutes.'); return; }
      toastMs('Message unsent.');
      await reloadMessages();
    } catch (e) {
      console.error('unsend failed:', e);
      toastMs('Could not unsend. Try again.');
    }
  }
  async function reportMessage(id, m) {
    var res = await askModal({
      title: 'Report this message',
      text: 'Our team reviews every report.',
      reasons: ['Harassment', 'Spam or scam', 'Inappropriate content', 'Something else'],
      confirm: 'Report',
      tone: 'danger'
    });
    if (!res.ok) return;
    try {
      var ins = await S.db.from('dm_reports').insert({
        reporter_id: S.user.id,
        reported_id: m.sender_id,
        conversation_id: S.activeId,
        message_id: id,
        reason: res.data.reason || 'Something else',
        details: res.data.details || null
      });
      if (ins.error) throw ins.error;
      toastMs('Report sent. Thanks for letting us know.');
    } catch (e) {
      console.error('reportMessage failed:', e);
      toastMs('Could not send report. Try again.');
    }
  }

  function openForwardPicker(id) {
    var m = msgStore[id];
    var ov = $('ms-fwd-modal');
    if (!m || !ov) return;
    S.fwdMsg = m;
    $('ms-fwd-quote').textContent = m.body;
    var q = $('ms-fwd-q');
    if (q) q.value = '';
    ov.hidden = false;
    renderForwardList('');
    setTimeout(function () { try { if (q) q.focus(); } catch (_) {} }, 30);
  }
  function renderForwardList(filter) {
    var box = $('ms-fwd-list');
    if (!box) return;
    var f = String(filter || '').trim().toLowerCase();
    var ids = [];
    friendRows().forEach(function (r) {
      if (r.status !== 'accepted') return;
      var other = (r.requester_id === S.user.id) ? r.addressee_id : r.requester_id;
      if (!other || other === S.activePeerId || ids.indexOf(other) !== -1) return;
      var p = S.friendPeers[other] || S.peers[other] || null;
      var name = peerName(p);
      if (f && name.toLowerCase().indexOf(f) === -1) return;
      ids.push(other);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms-fwd-row';
      b.innerHTML = avatarHtml(p, 30) + '<span><b>' + esc(name) + '</b><span>@' + esc((p && p.username) || '') + '</span></span>';
      b.addEventListener('click', function () { forwardTo(other, name); });
      box.appendChild(b);
    });
    if (!ids.length) {
      box.innerHTML = '<div class="fr-empty">' + esc(f ? 'No friends match that.' : 'No friends to forward to yet.') + '</div>';
    }
  }
  async function forwardTo(peerId, name) {
    var m = S.fwdMsg;
    if (!m) return;
    try {
      var open = await S.db.rpc('open_dm_conversation', { p_other: peerId });
      if (open.error) throw open.error;
      var cid = open.data;
      if (!cid) throw new Error('Could not open the chat');
      var ins = await S.db.from('dm_messages').insert({
        conversation_id: cid, sender_id: S.user.id, body: m.body, forwarded: true
      });
      if (ins.error) throw ins.error;
      var ov = $('ms-fwd-modal');
      if (ov) ov.hidden = true;
      toastMs('Forwarded to ' + name + '.');
      loadConversations();
    } catch (e) {
      console.error('forward failed:', e);
      toastMs('Could not forward. Try again.');
    }
  }

  var msgRefreshTimer = null;
  function scheduleMsgRefresh() {
    clearTimeout(msgRefreshTimer);
    msgRefreshTimer = setTimeout(reloadMessages, 400);
  }

  async function reloadMessages() {
    if (!S.activeId) return;
    closeFullPicker();
    try {
      var res = await S.db.rpc('get_dm_messages', { p_conversation: S.activeId });
      if (res.error) throw res.error;
      var box = $('ms-messages');
      if (!box) return;
      box.innerHTML = '';
      S.seen = {};
      msgStore = {};
      (res.data || []).forEach(appendMessage);
      scrollBottom();
    } catch (e) {
      console.error('reloadMessages failed:', e);
      toastMs('Could not refresh messages.');
    }
  }

  /* ── Chat list menu: pin / mute / delete (per-user) ── */

  function sortConvos() {
    S.convos.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
    });
  }
  // Upsert needs the full row, so unspecified flags carry over from the
  // current state — otherwise pinning a muted chat would silently unmute it.
  async function saveConvoPref(c, patch) {
    try {
      var res = await S.db.from('dm_convo_settings').upsert({
        user_id: S.user.id,
        conversation_id: c.id,
        muted: patch.muted != null ? patch.muted : !!c.muted,
        pinned: patch.pinned != null ? patch.pinned : !!c.pinned,
        hidden: false
      }, { onConflict: 'user_id,conversation_id' });
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('saveConvoPref failed:', e);
      toastMs('Could not save that. Try again.');
      return false;
    }
  }
  async function convoMenuAction(act, id) {
    var c = null;
    S.convos.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    var name = peerName(peerOf(c));

    if (act === 'pin') {
      var next = !c.pinned;
      if (!await saveConvoPref(c, { pinned: next })) return;
      c.pinned = next;
      sortConvos();
      toastMs(next ? 'Pinned to the top.' : 'Unpinned.');
      renderList();
      return;
    }
    if (act === 'mute') {
      var nextM = !c.muted;
      if (!await saveConvoPref(c, { muted: nextM })) return;
      c.muted = nextM;
      toastMs(nextM ? 'Muted. You will not be notified.' : 'Notifications on.');
      renderList();
      return;
    }
    if (act === 'delete') {
      var res = await askModal({
        title: 'Delete this chat?',
        text: 'This removes the conversation from your list only. ' + name
          + ' keeps their copy, and every message stays in the database.',
        confirm: 'Delete',
        tone: 'danger'
      });
      if (!res.ok) return;
      if (!await saveConvoPref(c, { hidden: true })) return;
      if (S.activeId === c.id) leaveChat();
      toastMs('Chat deleted.');
      loadConversations();
    }
  }
  function bindConvoMenus(list) {
    list.querySelectorAll('[data-cmenu]').forEach(function (btn) {
      var menu = list.querySelector('[data-cmenu-for="' + btn.getAttribute('data-cmenu') + '"]');
      if (!menu) return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeConvoMenus(list);
        var open = menu.classList.toggle('open');
        btn.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    list.querySelectorAll('.ms-convo-menu').forEach(function (menu) {
      menu.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!item) return;
        e.stopPropagation();
        closeConvoMenus(list);
        convoMenuAction(item.getAttribute('data-act'), item.getAttribute('data-for'));
      });
    });
  }
  function closeConvoMenus(list) {
    list.querySelectorAll('.ms-convo-menu.open').forEach(function (m) { m.classList.remove('open'); });
    list.querySelectorAll('.ms-convo-more.open').forEach(function (b) {
      b.classList.remove('open');
      b.setAttribute('aria-expanded', 'false');
    });
  }

  /* ── Top-right menu + friends ── */

  var chromeBound = false;
  function bindFriendsChrome() {
    if (chromeBound) return;
    chromeBound = true;
    var menuBtn = $('ms-menu-btn');
    var menu = $('ms-menu');
    if (menuBtn && menu) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        try {
          if (!menu.classList.contains('open')) return;
          if (menu.contains(e.target) || menuBtn.contains(e.target)) return;
          menu.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        } catch (_) {}
      });
      document.addEventListener('keydown', function (e) {
        if ((e.key === 'Escape' || e.keyCode === 27) && menu.classList.contains('open')) {
          menu.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }
    var optNew = $('ms-opt-new');
    if (optNew) optNew.addEventListener('click', function () {
      closeMenu();
      try { var q = $('ms-new-q'); if (q) q.focus(); } catch (_) {}
    });
    var optRef = $('ms-opt-refresh');
    if (optRef) optRef.addEventListener('click', function () {
      closeMenu();
      loadConversations();
      loadFriends();
      toastMs('Refreshing…');
    });
    var optPro = $('ms-opt-profile');
    if (optPro) optPro.addEventListener('click', function () { window.location.href = '/account/'; });
    var fb = $('ms-friends-btn');
    if (fb) fb.addEventListener('click', openFriends);
    var fc = $('fr-close');
    if (fc) fc.addEventListener('click', closeFriends);
    var fo = $('fr-overlay');
    if (fo) fo.addEventListener('mousedown', function (e) { if (e.target === fo) closeFriends(); });
    document.addEventListener('keydown', function (e) {
      var o = $('fr-overlay');
      if ((e.key === 'Escape' || e.keyCode === 27) && o && o.classList.contains('open')) closeFriends();
    });
    var fq = $('fr-q');
    if (fq) {
      var t = null;
      fq.addEventListener('input', function () { clearTimeout(t); t = setTimeout(frSearch, 250); });
    }
    bindFrTabs();
  }
  function closeMenu() {
    try {
      var menu = $('ms-menu');
      var btn = $('ms-menu-btn');
      if (menu) menu.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    } catch (_) {}
  }

  function openFriends() {
    closeMenu();
    var ov = $('fr-overlay');
    if (!ov) return;
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    loadFriends();
    // Land on the section that actually has something to show.
    var c = frCounts();
    setFrTab(c.requests ? 'requests' : (c.friends ? 'friends' : 'find'));
    moveFrThumb();
  }
  function closeFriends() {
    var ov = $('fr-overlay');
    if (!ov) return;
    ov.classList.remove('open');
    ov.setAttribute('aria-hidden', 'true');
  }
  window.openFriends = openFriends;
  window.closeFriends = closeFriends;

  function friendRows() {
    return S.friendships || [];
  }
  function friendStatusMap() {
    var map = {};
    friendRows().forEach(function (r) {
      var other = (r.requester_id === S.user.id) ? r.addressee_id : r.requester_id;
      map[other] = { status: r.status, id: r.id, mine: r.requester_id === S.user.id };
    });
    return map;
  }

  async function loadFriends() {
    if (!S.db || !S.user) return;
    try {
      var res = await S.db.from('dm_friendships').select('*')
        .or('requester_id.eq.' + S.user.id + ',addressee_id.eq.' + S.user.id)
        .order('created_at', { ascending: false }).limit(200);
      S.friendships = (res.data || []).filter(function (r) { return r.status !== 'rejected' || r.requester_id === S.user.id; });
      var ids = [];
      S.friendships.forEach(function (r) {
        var other = (r.requester_id === S.user.id) ? r.addressee_id : r.requester_id;
        if (other && ids.indexOf(other) === -1 && !S.friendPeers[other]) ids.push(other);
      });
      if (ids.length) {
        var pr = await S.db.rpc('get_user_public', { uids: ids });
        (pr.data || []).forEach(function (u) { S.friendPeers[u.id] = u; S.peers[u.id] = S.peers[u.id] || u; });
      }
      renderList();
      renderFriendPopup();
      loadBlocked();
    } catch (_) {}
  }

  function friendPeer(r) {
    var other = (r.requester_id === S.user.id) ? r.addressee_id : r.requester_id;
    return S.friendPeers[other] || S.peers[other] || null;
  }

  var FR_ICON_REQ = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>';
  var FR_ICON_FRI = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  var FR_ICON_SEARCH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>';

  function frEmpty(icon, title, sub) {
    return '<div class="fr-empty"><span class="fr-empty-icon">' + icon + '</span><b>' + esc(title) + '</b>'
      + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>';
  }
  function frCounts() {
    var inc = 0, fri = 0;
    friendRows().forEach(function (r) {
      if (r.status === 'pending' && r.addressee_id === S.user.id) inc++;
      else if (r.status === 'accepted') fri++;
    });
    return { requests: inc, friends: fri };
  }
  function frSetCount(id, n) {
    var el = $(id);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.toggle('zero', n === 0);
  }

  function renderFriendPopup() {
    var reqBox = $('fr-requests');
    var listBox = $('fr-list');
    var dot = $('ms-req-dot');
    var counts = frCounts();
    var incoming = friendRows().filter(function (r) { return r.status === 'pending' && r.addressee_id === S.user.id; });
    var accepted = friendRows().filter(function (r) { return r.status === 'accepted'; });
    try {
      if (dot) dot.classList.toggle('show', counts.requests > 0);
    } catch (_) {}
    frSetCount('fr-req-count', counts.requests);
    frSetCount('fr-fri-count', counts.friends);
    if (reqBox) {
      reqBox.innerHTML = incoming.map(function (r) {
        var peer = friendPeer(r);
        return '<div class="fr-row pending">' + avatarHtml(peer, 36)
          + '<span class="fr-info"><b>' + esc(peerName(peer)) + '</b>'
          + '<span>Wants to be friends · ' + esc(timeAgo(r.created_at)) + '</span></span>'
          + '<span class="fr-act"><button type="button" class="fr-btn" data-accept="' + r.id + '">Accept</button>'
          + '<button type="button" class="fr-btn ghost" data-decline="' + r.id + '">Decline</button></span></div>';
      }).join('') || frEmpty(FR_ICON_REQ, 'No pending requests', 'When a student adds you, they show up here.');
      reqBox.querySelectorAll('[data-accept]').forEach(function (b) {
        b.addEventListener('click', function () { decideRequest(b.getAttribute('data-accept'), 'accepted'); });
      });
      reqBox.querySelectorAll('[data-decline]').forEach(function (b) {
        b.addEventListener('click', function () { decideRequest(b.getAttribute('data-decline'), 'rejected'); });
      });
    }
    if (listBox) {
      listBox.innerHTML = accepted.map(function (r) {
        var other = (r.requester_id === S.user.id) ? r.addressee_id : r.requester_id;
        var peer = friendPeer(r);
        return '<div class="fr-row">' + avatarHtml(peer, 36)
          + '<span class="fr-info"><b>' + esc(peerName(peer)) + '</b></span>'
          + '<span class="fr-act"><button type="button" class="fr-btn ghost" data-msg="' + esc(other) + '">Message</button></span></div>';
      }).join('') || frEmpty(FR_ICON_FRI, 'No friends yet', 'Open the Find tab and search a username to add people.');
      listBox.querySelectorAll('[data-msg]').forEach(function (b) {
        b.addEventListener('click', function () { closeFriends(); openDirectChat(b.getAttribute('data-msg')); });
      });
    }
    moveFrThumb();
  }

  /* ── Drawer section tabs ── */

  function setFrTab(tab) {
    var seg = $('fr-seg');
    if (!seg || !tab) return;
    var btns = seg.querySelectorAll('.fr-seg-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-tab') === tab;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var panels = document.querySelectorAll('.fr-panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].getAttribute('data-panel') !== tab;
    }
    moveFrThumb();
    if (tab === 'find') setTimeout(function () { try { var q = $('fr-q'); if (q) q.focus(); } catch (_) {} }, 90);
  }
  function moveFrThumb() {
    var seg = $('fr-seg');
    var thumb = $('fr-seg-thumb');
    var active = seg ? seg.querySelector('.fr-seg-btn.active') : null;
    if (!seg || !thumb || !active) return;
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }
  function bindFrTabs() {
    var seg = $('fr-seg');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.fr-seg-btn') : null;
      if (b && seg.contains(b)) setFrTab(b.getAttribute('data-tab'));
    });
    seg.addEventListener('keydown', function (e) {
      var keys = ['ArrowLeft', 'ArrowRight'];
      if (keys.indexOf(e.key) === -1 && e.keyCode !== 37 && e.keyCode !== 39) return;
      var btns = [].slice.call(seg.querySelectorAll('.fr-seg-btn'));
      var i = btns.indexOf(document.activeElement);
      if (i === -1) i = 0;
      else i = (i + (e.key === 'ArrowRight' || e.keyCode === 39 ? 1 : btns.length - 1)) % btns.length;
      e.preventDefault();
      btns[i].focus();
      setFrTab(btns[i].getAttribute('data-tab'));
    });
    window.addEventListener('resize', moveFrThumb);
  }

  var frTimer = null;
  function frSearch() {
    var q = (($('fr-q') || {}).value || '').trim();
    var box = $('fr-results');
    if (!box) return;
    if (q.length < 2) { box.innerHTML = frEmpty(FR_ICON_SEARCH, 'Find students', 'Type at least 2 characters of a username.'); return; }
    clearTimeout(frTimer);
    frTimer = setTimeout(function () { frSearchNow(q); }, 200);
  }
  async function frSearchNow(q) {
    var box = $('fr-results');
    if (!box) return;
    try {
      var res = await S.db.rpc('search_users_by_username', { q: q });
      var rows = res.data || [];
      if (!rows.length) { box.innerHTML = frEmpty(FR_ICON_SEARCH, 'No students found', 'Try a different username.'); return; }
      var map = friendStatusMap();
      box.innerHTML = rows.map(function (u) {
        var name = u.full_name || (u.username ? '@' + u.username : 'Student');
        var initial = (name || 'S').charAt(0).toUpperCase();
        var av = u.profile_image_url
          ? '<span class="ms-ava" style="width:32px;height:32px"><img src="' + esc(u.profile_image_url) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span class="ms-ava-fb">' + esc(initial) + '</span></span>'
          : '<span class="ms-ava" style="width:32px;height:32px"><span class="ms-ava-fb">' + esc(initial) + '</span></span>';
        var st = map[u.id];
        var act;
        if (!st) act = '<button type="button" class="fr-btn" data-add="' + esc(u.id) + '">Add</button>';
        else if (st.status === 'accepted') act = '<button type="button" class="fr-btn ghost" data-msg2="' + esc(u.id) + '">Message</button>';
        else if (st.status === 'pending' && st.mine) act = '<span class="fr-tag">Pending</span>';
        else if (st.status === 'pending') act = '<button type="button" class="fr-btn" data-accept2="' + st.id + '">Accept</button>';
        else act = '<button type="button" class="fr-btn" data-add="' + esc(u.id) + '">Add</button>';
        return '<div class="fr-row">' + av
          + '<span class="fr-info"><b>' + esc(name) + '</b><span>@' + esc(u.username || '') + '</span></span>'
          + '<span class="fr-act">' + act + '</span></div>';
      }).join('');
      box.querySelectorAll('[data-add]').forEach(function (b) {
        b.addEventListener('click', function () { sendFriendRequest(b.getAttribute('data-add'), b); });
      });
      box.querySelectorAll('[data-msg2]').forEach(function (b) {
        b.addEventListener('click', function () { closeFriends(); openDirectChat(b.getAttribute('data-msg2')); });
      });
      box.querySelectorAll('[data-accept2]').forEach(function (b) {
        b.addEventListener('click', function () { decideRequest(b.getAttribute('data-accept2'), 'accepted'); });
      });
    } catch (_) {
      box.innerHTML = frEmpty(FR_ICON_SEARCH, 'Search unavailable', 'Please try again in a moment.');
    }
  }

  async function sendFriendRequest(otherId) {
    try {
      var res = await S.db.from('dm_friendships').select('*')
        .or('and(requester_id.eq.' + S.user.id + ',addressee_id.eq.' + otherId + '),and(requester_id.eq.' + otherId + ',addressee_id.eq.' + S.user.id + ')')
        .limit(5);
      var rows = res.data || [];
      var mine = null, theirs = null;
      rows.forEach(function (r) {
        if (r.status === 'accepted') mine = mine || 'accepted';
        if (r.requester_id === S.user.id && r.status === 'pending') mine = r;
        if (r.requester_id === otherId && r.status === 'pending') theirs = r;
      });
      if (mine === 'accepted' || rows.some(function (r) { return r.status === 'accepted'; })) { toastMs('Already friends.'); return; }
      if (theirs) {
        await S.db.from('dm_friendships').update({ status: 'accepted', decided_at: new Date().toISOString() }).eq('id', theirs.id);
        toastMs('Friend added!');
      } else if (mine && mine.id) {
        toastMs('Request already sent.');
        return;
      } else {
        var rejected = rows.filter(function (r) { return r.requester_id === S.user.id && r.status === 'rejected'; })[0];
        if (rejected) {
          await S.db.from('dm_friendships').update({ status: 'pending', decided_at: null }).eq('id', rejected.id);
        } else {
          var ins = await S.db.from('dm_friendships').insert({ requester_id: S.user.id, addressee_id: otherId, status: 'pending' });
          if (ins.error) throw ins.error;
        }
        toastMs('Friend request sent!');
      }
      await loadFriends();
      frSearchNow((($('fr-q') || {}).value || '').trim());
    } catch (e) {
      toastMs('Could not send request.');
    }
  }

  async function decideRequest(id, status) {
    try {
      var res = await S.db.from('dm_friendships').update({ status: status, decided_at: new Date().toISOString() }).eq('id', id);
      if (res.error) throw res.error;
      toastMs(status === 'accepted' ? 'Friend added!' : 'Request declined.');
      await loadFriends();
      frSearchNow((($('fr-q') || {}).value || '').trim());
    } catch (_) {
      toastMs('Something went wrong.');
    }
  }

  function init() {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var user = null;
      try { user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; } catch (_) {}
      if (user || tries > 50 || window.__authReady === true) {
        clearInterval(timer);
        boot(user);
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.MessengerRefresh = function () { if (S.user) loadConversations(); };
})();
