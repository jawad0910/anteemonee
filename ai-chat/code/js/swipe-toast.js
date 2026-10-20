/**
 * SwipeToast — vanilla port of the React Bits "SwipeToast"
 * (https://reactbits.dev) for Anteemonee AI Tutor. No React, no motion:
 * WAAPI for the fuse + fades, hand-rolled pointer physics for the swipe.
 *
 *   const toast = SwipeToast.show({
 *     title: 'Chat deleted', description: '"Chapter 3 doubts"',
 *     actionLabel: 'Undo', onAction: restore,
 *     duration: 5000, fuse: 'bottom', pauseOnHover: true,
 *   });
 *
 * Multiple toasts stack bottom-right. Returns { close, el }.
 */
(function () {
  'use strict';

  var EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  var FLICK = 0.11;                 // px per ms — a flick is a flick
  var DEAD_ZONE = 3;
  var RESIST_PX = 24;               // upward rubberband scale
  var COLLAPSE_MS = 200;
  var EXIT = 0.7;
  var BURN = [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }];

  var stack = null;
  function ensureStack() {
    if (stack && stack.isConnected) return stack;
    stack = document.createElement('div');
    stack.className = 'swipe-toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
    return stack;
  }

  function rubberband(over, dim, c) {
    c = c || 0.55;
    return (over * dim * c) / (dim + c * Math.abs(over));
  }
  function velocityOf(hist) {
    if (hist.length < 2) return 0;
    var t0 = hist[0][0], t1 = hist[hist.length - 1][0];
    if (historyAge(hist) > 100) return 0;
    return (hist[hist.length - 1][1] - hist[0][1]) / Math.max(1, t1 - t0);
  }
  function historyAge(hist) {
    return performance.now() - hist[hist.length - 1][0];
  }

  function show(opts) {
    opts = opts || {};
    var slideMs = opts.slideMs != null ? opts.slideMs : 400;
    var duration = opts.duration != null ? opts.duration : 4000;
    var fuse = duration > 0 ? (opts.fuse || 'bottom') : 'none';
    var dismissible = opts.dismissible !== false;
    var pauseOnHover = opts.pauseOnHover !== false;
    var swipeDistance = opts.swipeDistance != null ? opts.swipeDistance : 40;

    var host = ensureStack();
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

    var root = document.createElement('div');
    root.className = 'swipe-toast' + (opts.className ? ' ' + opts.className : '');
    root.setAttribute('data-phase', 'opening');
    root.setAttribute('data-inline', 'false');
    root.setAttribute('data-fuse', fuse);
    root.setAttribute('data-dismissible', dismissible ? 'true' : 'false');
    // CSS custom properties
    root.style.setProperty('--st-bg', opts.background || 'var(--bg-card, #27272a)');
    root.style.setProperty('--st-ink', opts.color || 'var(--text, #f5f5f5)');
    root.style.setProperty('--st-fuse', opts.fuseColor || '#f5a524');
    root.style.setProperty('--st-w', (opts.width || 356) + 'px');
    root.style.setProperty('--st-radius', (opts.radius != null ? opts.radius : 12) + 'px');
    root.style.setProperty('--st-slide', slideMs + 'ms');
    root.style.setProperty('--st-gap', '10px');
    root.style.width = 'min(var(--st-w), 100%)';
    if (opts.style) for (var k in opts.style) { try { root.style[k] = opts.style[k]; } catch (_) {} }

    var card = document.createElement('div');
    card.className = 'swipe-toast__card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.setAttribute('aria-atomic', 'true');
    card.tabIndex = 0;

    if (opts.icon) {
      var ic = document.createElement('span');
      ic.className = 'swipe-toast__icon';
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = opts.icon;
      card.appendChild(ic);
    }

    var body = document.createElement('span');
    body.className = 'swipe-toast__body';
    var title = document.createElement('span');
    title.className = 'swipe-toast__title';
    if (opts.titleHtml) title.innerHTML = opts.titleHtml;
    else title.textContent = opts.title || 'File archived';
    body.appendChild(title);
    if (opts.description) {
      var desc = document.createElement('span');
      desc.className = 'swipe-toast__desc';
      if (opts.descriptionHtml) desc.innerHTML = opts.descriptionHtml;
      else desc.textContent = opts.description;
      body.appendChild(desc);
    }
    card.appendChild(body);

    var phase = 'open';
    var instant = false;
    var lastInput = 'pointer';
    var anim = null;
    var closeTimer = null;
    var pendingClose = null;
    var reason = 'timeout';
    var leaving = false;
    var drag = null;
    var flags = { hover: false, interacting: false, focus: false, hidden: false };
    var latest = { onAction: typeof opts.onAction === 'function' ? opts.onAction : null, onClose: typeof opts.onClose === 'function' ? opts.onClose : null };
    var y = 0;                                  // translateY
    var actBtn = null;
    var closeBtn = null;
    var fuseEl = null;

    if (opts.actionLabel) {
      actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'swipe-toast__action';
      actBtn.textContent = opts.actionLabel;
      actBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof latest.onAction === 'function') {
          try { latest.onAction(); } catch (_) {}
        }
        close('action');
      });
      card.appendChild(actBtn);
    }
    if (opts.closeButton) {
      closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'swipe-toast__close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        close('close');
      });
      card.appendChild(closeBtn);
    }

    fuseEl = document.createElement('i');
    fuseEl.className = 'swipe-toast__fuse';
    fuseEl.setAttribute('aria-hidden', 'true');
    card.appendChild(fuseEl);

    var lift = document.createElement('div');
    lift.className = 'swipe-toast__lift';
    lift.appendChild(card);
    var gate = document.createElement('div');
    gate.className = 'swipe-toast__gate';
    gate.appendChild(lift);
    root.appendChild(gate);
    host.appendChild(root);

    // ── fuse management ──
    function syncFuse() {
      if (!anim) return;
      var f = flags;
      if (f.hover || f.interacting || f.focus || f.hidden) {
        try { anim.pause(); } catch (_) {}
      } else {
        try { anim.play(); } catch (_) {}
      }
    }

    function finish(why) {
      phase = 'gone';
      root.setAttribute('data-phase', 'gone');
      leaving = false;
      // collapse the space it keeps in the stack, then remove
      setTimeout(function () { try { root.remove(); } catch (_) {} }, COLLAPSE_MS);
      if (typeof latest.onClose === 'function') {
        try { latest.onClose(why); } catch (_) {}
      }
    }

    function close(why) {
      if (phase !== 'open' || leaving) {
        if (phase === 'closing' || phase === 'gone') return;
      }
      if (drag) { pendingClose = why; return; }
      if (anim) { try { anim.pause(); } catch (_) {} }
      reason = why;
      var now = (why === 'escape') || ((why === 'action' || why === 'close') && lastInput === 'keyboard');
      instant = now;
      if (now) root.setAttribute('data-instant', '');
      phase = 'closing';
      root.setAttribute('data-phase', 'closing');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(function () { finish(why); }, now ? 0 : Math.round(slideMs * EXIT) + 60);
    }

    function rescue() {
      clearTimeout(closeTimer);
      root.removeAttribute('data-instant');
      instant = false;
      y = 0;
      card.style.transform = 'translateY(0px)';
      card.style.opacity = '1';
      phase = 'open';
      root.setAttribute('data-phase', 'open');
      syncFuse();
    }

    // ── swipe physics ──
    function swipeOut(dy, v) {
      if (anim) { try { anim.pause(); } catch (_) {} }
      leaving = true;
      pendingClose = null;
      phase = 'closing';
      root.setAttribute('data-phase', 'closing');
      var drop = dy + card.offsetHeight;
      if (!reduce) {
        try {
          card.animate(
            [{ transform: 'translateY(' + y + 'px)' },
             { transform: 'translateY(' + drop + 'px)' }],
            { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
          );
        } catch (_) {}
      }
      try {
        var fadeAnim = card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE_OUT, fill: 'forwards' });
        if (fadeAnim && fadeAnim.finished) fadeAnim.finished.then(function () { finish('swipe'); }).catch(function () { finish('swipe'); });
        else setTimeout(function () { finish('swipe'); }, 220);
      } catch (_) { finish('swipe'); }
    }

    card.addEventListener('pointerdown', function (e) {
      lastInput = 'pointer';
      if (e.button !== 0 || !dismissible || drag || leaving) return;
      if (e.target.closest('button')) return;
      if (phase === 'closing') rescue();
      try { card.setPointerCapture(e.pointerId); } catch (_) {}
      drag = { id: e.pointerId, startY: e.clientY, grab: null, moved: false, hist: [[performance.now(), y]] };
      flags.interacting = true;
      syncFuse();
    });
    card.addEventListener('pointermove', function (e) {
      var d = drag;
      if (!d || d.id !== e.pointerId) return;
      if (d.grab === null) {
        if (Math.abs(e.clientY - d.startY) < DEAD_ZONE) return;
        d.grab = e.clientY - y;
        card.setAttribute('data-swiping', '');
      }
      var raw = e.clientY - d.grab;
      var next = raw >= 0 ? raw : rubberband(raw, RESIST_PX);
      y = next;
      card.style.transform = 'translateY(' + next + 'px)';
      d.moved = true;
      d.hist.push([performance.now(), next]);
      if (d.hist.length > 4) d.hist.shift();
    });
    function pointerUp(e) {
      var d = drag;
      if (!d || d.id !== e.pointerId) return;
      drag = null;
      card.removeAttribute('data-swiping');
      try { card.releasePointerCapture(e.pointerId); } catch (_) {}
      flags.interacting = false;
      var dy = y;
      var v = velocityOf(d.hist);
      var flick = v > FLICK;
      if (dy > 0 && (flick || (dy >= swipeDistance && v >= 0))) {
        swipeOut(dy, v);
        return;
      }
      if (d.moved) {
        // spring back with a small overshoot
        try {
          var overshoot = Math.round(reduce ? 0 : 7 * (opts.settleBounce != null ? opts.settleBounce : 0.2));
          var keep = [{ transform: 'translateY(' + dy + 'px)' }];
          if (overshoot > 0) keep.push({ transform: 'translateY(' + (-overshoot) + 'px)', offset: 0.68 });
          keep.push({ transform: 'translateY(0px)' });
          card.animate(keep, { duration: reduce ? 200 : 480, easing: reduce ? EASE_OUT : 'cubic-bezier(0.34, 1.3, 0.64, 1)', fill: 'forwards' });
        } catch (_) {}
        y = 0;
        card.style.transform = 'translateY(0px)';
      }
      var queued = pendingClose;
      pendingClose = null;
      if (queued) close(queued);
      else syncFuse();
    }
    card.addEventListener('pointerup', pointerUp);
    card.addEventListener('pointercancel', pointerUp);

    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') lastInput = 'keyboard';
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        close('escape');
      }
    });

    // visibility helper
    var onVisibility = function () {
      flags.hidden = document.hidden;
      syncFuse();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // mount animation
    var mountedAt = 0;
    if ('CSSStartingStyleRule' in window) {
      requestAnimationFrame(function () { root.setAttribute('data-mounted', 'true'); });
    } else {
      requestAnimationFrame(function () { root.setAttribute('data-mounted', 'true'); });
    }
    requestAnimationFrame(function () {
      root.setAttribute('data-mounted', 'false');
      requestAnimationFrame(function () { root.setAttribute('data-mounted', 'true'); });
    });

    // fuse lifecycle
    if (duration > 0) {
      try {
        anim = fuseEl.animate(BURN, { duration: duration, easing: 'linear', fill: 'forwards' });
        anim.onfinish = function () { close('timeout'); };
      } catch (_) { anim = null; }
      // fallback pure timer (WAAPI paused states also pause timer Frames)
      (function idleTimer() {
        var waited = 0;
        var iv = setInterval(function () {
          if (!root.isConnected) { clearInterval(iv); return; }
          var blocked = flags.hover || flags.interacting || flags.focus || flags.hidden || phase !== 'open' || leaving;
          if (!blocked) waited += 100;
          if (waited >= duration) { clearInterval(iv); close('timeout'); }
        }, 100);
      })();
    }

    return {
      el: root,
      close: close,
      pause: function () { flags.hover = true; syncFuse(); },
      resume: function () { flags.hover = false; syncFuse(); },
    };
  }

  window.SwipeToast = { show: show };
})();
