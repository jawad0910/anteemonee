/* Anteemonee AI Classroom — live room link.
 *
 * The host client is authoritative: it drives the AI narration and publishes
 * what is happening. Everyone else subscribes and renders that state, so the
 * slides and the speaker can never drift apart between classmates.
 *
 * Two transports:
 *   broadcast        live state (slide, speaker, start/stop) - low latency
 *   postgres_changes the transcript, straight from classroom_messages
 *
 * The channel is private: realtime.messages RLS only lets the host and the
 * members of that classroom read or write its topic.
 */
(function () {
  'use strict';

  var channel = null;
  var roomId = null;
  var isHost = false;
  var me = null;
  var handlers = {};

  function getDb() {
    try { if (typeof db !== 'undefined' && db) return db; } catch (_) {}
    try { if (window.db) return window.db; } catch (_) {}
    return null;
  }

  function topic() { return 'classroom:' + roomId; }

  function emit(name, payload) {
    (handlers[name] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.warn('[Classroom live] handler', name, e); }
    });
  }

  function displayName() {
    if (me && me.user_metadata) {
      var n = me.user_metadata.full_name || me.user_metadata.name;
      if (n) return String(n).trim().split(/\s+/)[0];
    }
    return (me && me.email ? me.email.split('@')[0] : 'Student');
  }

  function join(id, opts) {
    var c = getDb();
    if (!c || !id) return Promise.reject(new Error('not ready'));
    leave();

    roomId = id;
    isHost = !!(opts && opts.isHost);
    me = (window.Classroom && Classroom.state.user) || null;

    channel = c.channel(topic(), {
      config: {
        private: true,
        broadcast: { self: false, ack: false },
        presence: { key: String(me && me.id || 'anon') },
      },
    });

    // ── live state from the host ──
    channel.on('broadcast', { event: 'state' }, function (msg) {
      if (!isHost) emit('state', msg.payload);
    });
    channel.on('broadcast', { event: 'line' }, function (msg) {
      emit('line', msg.payload);
    });
    channel.on('broadcast', { event: 'ended' }, function (msg) {
      emit('ended', msg.payload);
    });

    // ── classmates speaking / chatting ──
    channel.on('broadcast', { event: 'say' }, function (msg) {
      if (isHost) emit('say', msg.payload);
    });

    // ── who is here ──
    channel.on('presence', { event: 'sync' }, function () {
      var st = channel.presenceState();
      var people = [];
      Object.keys(st).forEach(function (k) {
        (st[k] || []).forEach(function (p) { people.push(p); });
      });
      emit('presence', people);
    });
    channel.on('presence', { event: 'join' }, function () {
      var st = channel.presenceState();
      var people = [];
      Object.keys(st).forEach(function (k) { (st[k] || []).forEach(function (p) { people.push(p); }); });
      emit('presence', people);
    });

    // The transcript is replayed from the database on join rather than streamed,
    // so a line is never rendered twice from both paths.

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('live channel timed out')); }, 12000);
      channel.subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          channel.track({ user_id: (me && me.id) || null, name: displayName(), host: isHost });
          resolve(channel);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(new Error('live channel ' + status));
        }
      });
    });
  }

  function leave() {
    if (channel) {
      try { channel.unsubscribe(); } catch (_) {}
      channel = null;
    }
    roomId = null;
  }

  function send(event, payload) {
    if (!channel) return Promise.resolve();
    return channel.send({ type: 'broadcast', event: event, payload: payload });
  }

  window.ClassroomLive = {
    join: join,
    leave: leave,
    on: function (name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    off: function (name) { delete handlers[name]; },
    // host -> everyone
    publishState: function (s) { return send('state', s); },
    publishLine: function (l) { return send('line', l); },
    publishEnded: function (e) { return send('ended', e || {}); },
    // member -> host
    say: function (text, kind, id) {
      return send('say', { who: displayName(), text: text, kind: kind || 'text', id: id || null });
    },
    isHost: function () { return isHost; },
  };
})();
