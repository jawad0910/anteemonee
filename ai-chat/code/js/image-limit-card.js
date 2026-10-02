/* =========================================================
   Anteemonee: "daily image limit reached" card for AI chat

   Renders a self-contained, animated card with a live countdown to the
   moment the quota renews, plus the upgrade path to 400 images/day via a
   user-supplied Mistral API key.

   window.ImageLimitCard.show(contentEl, {
     used, limit, resetsAt, onRetry
   })
   ========================================================= */
(function () {
  'use strict';

  if (window.ImageLimitCard) return;

  var VIDEO_URL = 'https://youtube.com/anteemoneee';
  var BASE_LIMIT = 4;
  var BOOSTED_LIMIT = 400;

  var LIVE_CARDS = [];

  /* ---------- time helpers ---------- */

  function nextUtcMidnight() {
    var now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  }

  function resolveReset(resetsAt) {
    if (resetsAt) {
      var d = new Date(resetsAt);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) return d;
    }
    return nextUtcMidnight();
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function splitRemaining(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    return {
      h: Math.floor(total / 3600),
      m: Math.floor((total % 3600) / 60),
      s: total % 60,
    };
  }

  function resetLabel(date) {
    try {
      // The quota rolls over at midnight UTC, which is not midnight for most
      // readers, so lead with their own clock time.
      var local = date.toLocaleTimeString(undefined, {
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      });
      if (date.getTimezoneOffset() === 0) return local + ' UTC';
      var h = date.getUTCHours();
      var m = date.getUTCMinutes();
      var utc = (h % 12 === 0 ? 12 : h % 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' PM' : ' AM');
      return local + ' · ' + utc + ' UTC';
    } catch (_) {
      return 'midnight UTC';
    }
  }

  /* ---------- markup ---------- */

  var ICON_LOCK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="3"/>' +
    '<circle cx="8.5" cy="8.5" r="1.6"/>' +
    '<path d="M21 15l-5-5L5 21"/></svg>';

  var ICON_SPARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3l1.9 4.9L19 9.8l-4.3 3.3L16.2 18 12 15.3 7.8 18l1.5-4.9L5 9.8l5.1-1.9z"/></svg>';

  var ICON_KEY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14.5 4a5.5 5.5 0 1 1-4.2 9.1L4 19.4V22h2.6l1-1h2v-2h2l1.3-1.3"/>' +
    '<circle cx="16.5" cy="7.5" r="1.1"/></svg>';

  var ICON_PLAY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildCard(opts) {
    var used = Number(opts.used) > 0 ? Number(opts.used) : BASE_LIMIT;
    var limit = Number(opts.limit) > 0 ? Number(opts.limit) : BASE_LIMIT;
    var resetsAt = resolveReset(opts.resetsAt);

    var wrap = document.createElement('div');
    wrap.className = 'imglim';
    wrap.setAttribute('role', 'status');
    wrap.innerHTML =
      '<div class="imglim-glow" aria-hidden="true"></div>' +
      '<div class="imglim-head">' +
        '<span class="imglim-icon" aria-hidden="true">' + ICON_LOCK + '</span>' +
        '<div class="imglim-head-text">' +
          '<div class="imglim-eyebrow">Daily image limit reached</div>' +
          '<div class="imglim-title">You are all out of images for today</div>' +
        '</div>' +
        '<span class="imglim-tally"><b>' + used + '</b><i>/' + limit + '</i></span>' +
      '</div>' +

      '<p class="imglim-copy">You have used all <strong>' + limit + ' image' +
        (limit === 1 ? '' : 's') + '</strong> included with your account today. ' +
        'Your limit renews automatically, so there is nothing to do.</p>' +

      '<div class="imglim-renew">' +
        '<div class="imglim-renew-label">Your ' + limit + ' images come back in</div>' +
        '<div class="imglim-countdown" data-countdown>' +
          '<span class="unit"><b data-h>00</b><i>hrs</i></span>' +
          '<span class="sep">:</span>' +
          '<span class="unit"><b data-m>00</b><i>min</i></span>' +
          '<span class="sep">:</span>' +
          '<span class="unit"><b data-s>00</b><i>sec</i></span>' +
        '</div>' +
        '<div class="imglim-renew-at">Renews at ' + esc(resetLabel(resetsAt)) + '</div>' +
      '</div>' +

      '<div class="imglim-upgrade">' +
        '<div class="imglim-upgrade-head">' +
          '<span class="imglim-upgrade-icon" aria-hidden="true">' + ICON_SPARK + '</span>' +
          '<div>' +
            '<div class="imglim-upgrade-title">Want ' + BOOSTED_LIMIT + ' images a day?</div>' +
            '<div class="imglim-upgrade-sub">Add your own Mistral API key. Your key generates every image and your daily cap rises to ' + BOOSTED_LIMIT + '.</div>' +
          '</div>' +
        '</div>' +
        '<div class="imglim-actions">' +
          '<button type="button" class="imglim-btn imglim-btn-primary" data-action="add-mistral-key">' + ICON_KEY + '<span>Add your Mistral API key</span></button>' +
          (typeof opts.onRetry === 'function'
            ? '<button type="button" class="imglim-btn imglim-btn-primary is-hidden" data-retry>' + ICON_SPARK + '<span>Generate another image</span></button>'
            : '') +
        '</div>' +
        '<a class="imglim-link" href="' + VIDEO_URL + '" target="_blank" rel="noopener noreferrer">' +
          'Don\'t know how to get a Mistral key? ' +
          '<span class="imglim-link-play" aria-hidden="true">' + ICON_PLAY + '</span>See how' +
        '</a>' +
      '</div>';

    return wrap;
  }

  /* ---------- countdown ---------- */

  function markRenewed(card) {
    if (!card || card.getAttribute('data-state') === 'renewed') return;
    card.setAttribute('data-state', 'renewed');
    var eyebrow = card.querySelector('.imglim-eyebrow');
    var title = card.querySelector('.imglim-title');
    var label = card.querySelector('.imglim-renew-label');
    var at = card.querySelector('.imglim-renew-at');
    if (eyebrow) eyebrow.textContent = 'Quota refreshed';
    if (title) title.textContent = 'Your images are back';
    if (label) label.textContent = 'Your daily images have been restored';
    if (at) at.textContent = 'You can start creating again';
  }

  function startCountdown(card, resetsAt) {
    var cd = card.querySelector('[data-countdown]');
    if (!cd) return;
    var hEl = cd.querySelector('[data-h]');
    var mEl = cd.querySelector('[data-m]');
    var sEl = cd.querySelector('[data-s]');
    var entry = { card: card, timer: null, stop: function () {} };

    function tick() {
      if (!card.isConnected) { entry.stop(); return; }
      var left = resetsAt.getTime() - Date.now();
      if (left <= 0) {
        if (hEl) hEl.textContent = '00';
        if (mEl) mEl.textContent = '00';
        if (sEl) sEl.textContent = '00';
        markRenewed(card);
        entry.stop();
        return;
      }
      var p = splitRemaining(left);
      if (hEl) hEl.textContent = two(p.h);
      if (mEl) mEl.textContent = two(p.m);
      if (sEl) sEl.textContent = two(p.s);
    }

    entry.stop = function () {
      if (entry.timer) { clearInterval(entry.timer); entry.timer = null; }
      var i = LIVE_CARDS.indexOf(entry);
      if (i !== -1) LIVE_CARDS.splice(i, 1);
    };
    entry.timer = setInterval(tick, 1000);
    LIVE_CARDS.push(entry);
    tick();
  }

  /* ---------- unlocked state ---------- */

  function setUnlocked(card) {
    if (!card || card.getAttribute('data-state') === 'unlocked') return;
    var icon = card.querySelector('.imglim-icon');
    var title = card.querySelector('.imglim-title');
    var eyebrow = card.querySelector('.imglim-eyebrow');
    var tally = card.querySelector('.imglim-tally');
    var copy = card.querySelector('.imglim-copy');
    var upgrade = card.querySelector('.imglim-upgrade');

    card.setAttribute('data-state', 'unlocked');
    if (icon) icon.innerHTML = ICON_SPARK;
    if (eyebrow) eyebrow.textContent = 'Mistral API key connected';
    if (title) title.textContent = BOOSTED_LIMIT + ' images a day unlocked';
    if (tally) {
      tally.innerHTML = '<b>' + BOOSTED_LIMIT + '</b><i>/day</i>';
    }
    if (copy) {
      copy.innerHTML = 'Your own Mistral key is now generating every image, and your daily cap has been raised from ' +
        BASE_LIMIT + ' to <strong>' + BOOSTED_LIMIT + '</strong>.';
    }
    if (upgrade) {
      upgrade.innerHTML =
        '<div class="imglim-upgrade-head">' +
          '<span class="imglim-upgrade-icon" aria-hidden="true">' + ICON_SPARK + '</span>' +
          '<div>' +
            '<div class="imglim-upgrade-title">You are all set</div>' +
            '<div class="imglim-upgrade-sub">Nothing else to do. Ask for another image and it will be generated with your key.</div>' +
          '</div>' +
        '</div>' +
        '<div class="imglim-actions" data-retry-slot></div>';
    }
  }

  /* ---------- public ---------- */

  function show(contentEl, opts) {
    var options = opts || {};
    if (!contentEl) return null;
    try {
      contentEl.innerHTML = '';
      contentEl.classList.remove('is-empty');
    } catch (_) {}

    var card = buildCard(options);
    contentEl.appendChild(card);
    startCountdown(card, resolveReset(options.resetsAt));

    var retryBtn = card.querySelector('[data-retry]');
    if (retryBtn && typeof options.onRetry === 'function') {
      retryBtn.addEventListener('click', function () { options.onRetry(); });
    }

    // If the user adds their key while this card is on screen, flip it to the
    // unlocked state in place.
    if (window.MistralKeyUI && typeof window.MistralKeyUI.onChange === 'function') {
      window.MistralKeyUI.onChange(function (s) {
        if (s && s.has_key) {
          setUnlocked(card);
          var slot = card.querySelector('[data-retry-slot]');
          if (slot && typeof options.onRetry === 'function' && !slot.querySelector('[data-retry-live]')) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'imglim-btn imglim-btn-primary';
            b.setAttribute('data-retry-live', '1');
            b.innerHTML = ICON_SPARK + '<span>Generate another image</span>';
            b.addEventListener('click', function () { options.onRetry(); });
            slot.appendChild(b);
          }
        }
      });
    }

    // Entrance animation on the next frame for a smooth appear.
    try {
      requestAnimationFrame(function () { card.classList.add('is-in'); });
    } catch (_) {
      card.classList.add('is-in');
    }
    return card;
  }

  window.ImageLimitCard = { show: show, VIDEO_URL: VIDEO_URL };
})();