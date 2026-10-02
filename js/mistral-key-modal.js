/* =========================================================
   Anteemonee: Bring your own Mistral API key
   Shared popup + quota/usage helper.

   Saving a key raises the daily image quota from 4/day to 400/day
   and makes the key the provider actually used for image generation.

   Exposes:
     window.MistralKeyUI.open()          open the popup
     window.MistralKeyUI.close()         close the popup
     window.MistralKeyUI.save(key)       persist a key (returns stats)
     window.MistralKeyUI.remove()        delete the key (returns stats)
     window.MistralKeyUI.stats()         { has_key, used_today, total_images,
                                            limit, remaining, resets_at, ... }
     window.MistralKeyUI.onChange(cb)    subscribe to key changes
     window.MistralKeyUI.VIDEO_URL       "how to get a key" video
   ========================================================= */
(function () {
  'use strict';

  if (window.MistralKeyUI) return;

  var VIDEO_URL = 'https://youtube.com/anteemoneee';
  var BASE_LIMIT = 4;
  var BOOSTED_LIMIT = 400;
  var MAX_KEY_LEN = 200;

  var listeners = [];
  var overlay = null;
  var lastFocused = null;
  var busy = false;

  /* ---------- helpers ---------- */

  function supa() {
    return (typeof db !== 'undefined' && db) ? db : null;
  }

  function uid() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) return currentUser.id;
    } catch (_) {}
    return null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatReset(resetsAt) {
    try {
      var d = resetsAt ? new Date(resetsAt) : null;
      if (!d || isNaN(d.getTime())) return 'midnight UTC';
      return d.toLocaleString(undefined, {
        weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      });
    } catch (_) {
      return 'midnight UTC';
    }
  }

  function normalizeStats(raw) {
    var used = Number(raw && raw.used_today) || 0;
    var hasKey = !!(raw && raw.has_key);
    var base = Number(raw && raw.base_limit) || BASE_LIMIT;
    var boosted = Number(raw && raw.boosted_limit) || BOOSTED_LIMIT;
    var limit = Number(raw && raw.limit) || (hasKey ? boosted : base);
    return {
      ok: true,
      has_key: hasKey,
      key_hint: (raw && raw.key_hint) || null,
      used_today: used,
      total_images: Number(raw && raw.total_images) || 0,
      limit: limit,
      remaining: Math.max(0, limit - used),
      base_limit: base,
      boosted_limit: boosted,
      resets_at: (raw && raw.resets_at) || null,
    };
  }

  /* Client-side fallback for when the stats RPC is not deployed yet. */
  async function statsFallback() {
    var d = supa();
    var id = uid();
    if (!d || !id) return normalizeStats(null);
    var hasKey = false;
    var hint = null;
    try {
      var kr = await d.from('user_api_keys').select('mistral_api_key').eq('user_id', id).maybeSingle();
      var key = kr && kr.data ? String(kr.data.mistral_api_key || '').trim() : '';
      if (key) { hasKey = true; hint = '••••' + key.slice(-4); }
    } catch (_) {}
    var used = 0;
    var total = 0;
    try {
      var startIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
      var [todayR, totalR] = await Promise.all([
        d.from('ai_generated_images').select('id', { count: 'exact', head: true })
          .eq('user_id', id).gte('created_at', startIso),
        d.from('ai_generated_images').select('id', { count: 'exact', head: true })
          .eq('user_id', id),
      ]);
      used = (todayR && todayR.count) || 0;
      total = (totalR && totalR.count) || 0;
    } catch (_) {}
    return normalizeStats({
      has_key: hasKey,
      key_hint: hint,
      used_today: used,
      total_images: total,
      limit: hasKey ? BOOSTED_LIMIT : BASE_LIMIT,
      resets_at: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
    });
  }

  /* Public: current quota + usage for this user. */
  async function stats() {
    var d = supa();
    if (!d || !uid()) return normalizeStats(null);
    try {
      var r = await d.rpc('my_image_stats');
      var data = r && r.data;
      if (r && !r.error && data && data.ok) return normalizeStats(data);
    } catch (_) {}
    return statsFallback();
  }

  /* ---------- persistence ---------- */

  function validateKey(raw) {
    var key = String(raw || '').trim().replace(/\s+/g, '');
    if (!key) return { ok: false, error: 'Paste your Mistral API key to continue.' };
    if (key.length < 20) return { ok: false, error: 'That key looks too short. Copy the whole key from Mistral.' };
    if (key.length > MAX_KEY_LEN) return { ok: false, error: 'That key is too long to be a Mistral API key.' };
    if (!/^[A-Za-z0-9._-]+$/.test(key)) return { ok: false, error: 'Mistral keys contain only letters, digits, dots, dashes and underscores.' };
    return { ok: true, key: key };
  }

  function emit(next) {
    listeners.forEach(function (cb) {
      try { cb(next); } catch (e) { console.warn('[mistral-key] listener failed', e); }
    });
    try {
      window.dispatchEvent(new CustomEvent('anteemonee:apikeychange', { detail: next }));
    } catch (_) {}
  }

  async function save(rawKey) {
    var d = supa();
    var id = uid();
    if (!d || !id) return { ok: false, error: 'Sign in to save an API key.' };
    var v = validateKey(rawKey);
    if (!v.ok) return v;
    try {
      var r = await d.from('user_api_keys').upsert({
        user_id: id,
        mistral_api_key: v.key,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (r && r.error) {
        return { ok: false, error: 'Could not save your key. Please try again.' };
      }
    } catch (e) {
      return { ok: false, error: 'Could not save your key. Please try again.' };
    }
    var s = await stats();
    // The write succeeded, so the key is definitely in place: never let a
    // lagging read (or a stats RPC that is not deployed yet) report the old
    // state.
    if (!s.has_key) {
      s.has_key = true;
      s.key_hint = '••••' + v.key.slice(-4);
      s.limit = s.boosted_limit || BOOSTED_LIMIT;
      s.remaining = Math.max(0, s.limit - s.used_today);
    }
    emit(s);
    return { ok: true, stats: s };
  }

  async function remove() {
    var d = supa();
    var id = uid();
    if (!d || !id) return { ok: false, error: 'Sign in first.' };
    try {
      var r = await d.from('user_api_keys')
        .delete().eq('user_id', id);
      if (r && r.error) return { ok: false, error: 'Could not remove your key. Please try again.' };
    } catch (_) {
      return { ok: false, error: 'Could not remove your key. Please try again.' };
    }
    var s = await stats();
    if (s.has_key) {
      s.has_key = false;
      s.key_hint = null;
      s.limit = s.base_limit || BASE_LIMIT;
      s.remaining = Math.max(0, s.limit - s.used_today);
    }
    emit(s);
    return { ok: true, stats: s };
  }

  /* ---------- popup ---------- */

  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function build() {
    if (overlay) return overlay;
    var el = document.createElement('div');
    el.className = 'mk-overlay';
    el.id = 'mistral-key-overlay';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="mk-card" role="dialog" aria-modal="true" aria-labelledby="mk-title">' +
        '<div class="mk-glow" aria-hidden="true"></div>' +
        '<button type="button" class="mk-close" id="mk-close" aria-label="Close">&times;</button>' +
        '<div class="mk-head">' +
          '<span class="mk-badge" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20"/></svg>' +
          '</span>' +
          '<h2 id="mk-title">Add your Mistral API key</h2>' +
          '<p>Unlock <strong>400 images a day</strong> instead of ' + BASE_LIMIT + ', and generate with your own key.</p>' +
        '</div>' +
        '<form class="mk-form" id="mk-form" novalidate>' +
          '<div class="mk-field">' +
            '<label for="mk-input">Mistral API key</label>' +
            '<div class="mk-input-wrap">' +
              '<input type="password" id="mk-input" class="mk-input" placeholder="Paste your key here" autocomplete="off" spellcheck="false" maxlength="' + MAX_KEY_LEN + '">' +
              '<button type="button" class="mk-eye" id="mk-eye" aria-label="Show or hide your key">' + EYE + EYE_OFF + '</button>' +
            '</div>' +
            '<div class="mk-error" id="mk-error" role="alert" hidden></div>' +
          '</div>' +
          '<div class="mk-actions">' +
            '<button type="button" class="mk-btn mk-btn-ghost" id="mk-cancel">Cancel</button>' +
            '<button type="submit" class="mk-btn mk-btn-primary" id="mk-save">Save key</button>' +
          '</div>' +
        '</form>' +
        '<div class="mk-foot">' +
          '<span>Don\'t know how to get a Mistral key?</span>' +
          '<a class="mk-video" id="mk-video" href="' + VIDEO_URL + '" target="_blank" rel="noopener noreferrer">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
            'See how' +
          '</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    overlay = el;

    el.addEventListener('click', function (e) {
      var t = e.target;
      if (t === el) { close(); return; }
      try {
        if (t.closest('#mk-close') || t.closest('#mk-cancel')) { close(); return; }
      } catch (_) {}
    });

    document.getElementById('mk-form').addEventListener('submit', submit);
    document.getElementById('mk-eye').addEventListener('click', function () {
      var input = document.getElementById('mk-input');
      var btn = document.getElementById('mk-eye');
      if (!input || !btn) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-on', show);
      btn.innerHTML = show ? EYE_OFF : EYE;
      input.focus();
    });

    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.keyCode === 27) && overlay && overlay.classList.contains('open')) {
        close();
      }
    });
    return el;
  }

  function setError(msg) {
    var box = document.getElementById('mk-error');
    if (!box) return;
    if (msg) {
      box.textContent = msg;
      box.hidden = false;
      box.classList.remove('is-shown');
      void box.offsetWidth;
      box.classList.add('is-shown');
    } else {
      box.hidden = true;
      box.textContent = '';
      box.classList.remove('is-shown');
    }
  }

  function setBusy(state) {
    busy = !!state;
    var save = document.getElementById('mk-save');
    var cancel = document.getElementById('mk-cancel');
    var input = document.getElementById('mk-input');
    if (save) {
      save.disabled = busy;
      save.classList.toggle('is-loading', busy);
      save.textContent = busy ? 'Saving…' : 'Save key';
    }
    if (cancel) cancel.disabled = busy;
    if (input) input.disabled = busy;
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (busy) return;
    var input = document.getElementById('mk-input');
    setError('');
    setBusy(true);
    var res = await save(input ? input.value : '');
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Could not save your key.');
      try { if (input) input.focus(); } catch (_) {}
      return;
    }
    var card = overlay && overlay.querySelector('.mk-card');
    if (card) card.classList.add('is-saved');
    var video = document.getElementById('mk-video');
    var foot = video && video.parentNode;
    if (foot) foot.innerHTML = '<span class="mk-saved-note">Key saved, ' + BOOSTED_LIMIT + ' images a day</span>';
    setTimeout(close, 950);
  }

  function open(opts) {
    var options = opts || {};
    var el = build();
    try { lastFocused = document.activeElement; } catch (_) {}
    setError('');
    setBusy(false);
    var card = el.querySelector('.mk-card');
    if (card) card.classList.remove('is-saved');
    var foot = el.querySelector('.mk-foot');
    if (foot) {
      foot.innerHTML =
        '<span>Don\'t know how to get a Mistral key?</span>' +
        '<a class="mk-video" id="mk-video" href="' + VIDEO_URL + '" target="_blank" rel="noopener noreferrer">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
          'See how' +
        '</a>';
    }
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    try { document.body.style.overflow = 'hidden'; } catch (_) {}
    setTimeout(function () {
      try {
        var input = document.getElementById('mk-input');
        if (input) { input.value = ''; input.focus(); }
      } catch (_) {}
    }, 140);
    try {
      if (typeof options.onOpen === 'function') options.onOpen();
    } catch (_) {}
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    try { document.body.style.overflow = ''; } catch (_) {}
    try { if (lastFocused && lastFocused.focus) lastFocused.focus(); } catch (_) {}
  }

  /* ---------- public ---------- */

  window.MistralKeyUI = {
    VIDEO_URL: VIDEO_URL,
    BASE_LIMIT: BASE_LIMIT,
    BOOSTED_LIMIT: BOOSTED_LIMIT,
    open: open,
    close: close,
    save: save,
    remove: remove,
    stats: stats,
    validateKey: validateKey,
    formatReset: formatReset,
    escapeHtml: escapeHtml,
    onChange: function (cb) {
      if (typeof cb === 'function') listeners.push(cb);
      return function () {
        listeners = listeners.filter(function (f) { return f !== cb; });
      };
    },
  };

  // Any element with data-action="add-mistral-key" opens the popup.
  document.addEventListener('click', function (e) {
    var el = null;
    try { el = e.target && e.target.closest ? e.target.closest('[data-action="add-mistral-key"]') : null; } catch (_) {}
    if (!el) return;
    e.preventDefault();
    open();
  });
})();