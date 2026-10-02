/* =========================================================
   Anteemonee FORGOT-PASSWORD POPUP — "Forgot password?" opens
   a modal reusing the exact same code (handleForgotPassword in
   app.js). Same element IDs as the former forgot-password page,
   so the helper binds unchanged (idempotent guard in app.js).
   Styling reuses the login-popup (lm-*) classes in style.css.
   ========================================================= */
(function () {
  'use strict';

  // A second copy of this file must never double-wire (duplicate script
  // tags would otherwise stack two popups with dead buttons on top).
  if (window.__fmLoaded) return;
  window.__fmLoaded = true;

  // Root-absolute prefixes: this script runs from the site root, from
  // /pages/*.html and from the folder pages (/ai-chat/, /settings/, ...), so a
  // depth-relative prefix would break on the moved pages.
  var assetPrefix = '/';
  var pagePrefix = '/pages/';

  var overlay = null;
  var lastFocused = null;

  function wireForgotHelper() {
    try { if (typeof setupForgotPasswordForm === 'function') setupForgotPasswordForm(); } catch (_) {}
  }

  function buildModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'lm-overlay';
    overlay.id = 'fm-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="lm-card" role="dialog" aria-modal="true" aria-labelledby="fm-title">' +
        '<button type="button" class="lm-close" id="fm-close" aria-label="Close">&times;</button>' +
        '<div class="lm-head">' +
          '<img src="' + assetPrefix + 'assets/anteemonee.png" alt="Anteemonee">' +
          '<h2 id="fm-title">Reset Password</h2>' +
          '<p>Enter your email and we\'ll send you a reset link</p>' +
        '</div>' +
        '<form class="lm-form" id="forgot-password-form">' +
          '<div class="auth-error" id="forgot-error"></div>' +
          '<div class="auth-success" id="forgot-success"></div>' +
          '<div class="lm-field">' +
            '<label for="forgot-email">Email</label>' +
            '<input type="email" id="forgot-email" class="form-input" placeholder="you@example.com" required autocomplete="email">' +
          '</div>' +
          '<button type="submit" class="btn-primary">Send Reset Link</button>' +
        '</form>' +
        '<div class="lm-footer">Remember your password? <a href="' + pagePrefix + 'login.html">Sign In</a></div>' +
      '</div>';
    document.body.appendChild(overlay);

    // One delegated listener for the close button + backdrop — no
    // per-element binds that could silently miss.
    overlay.addEventListener('click', function (e) {
      try {
        if (e.target === overlay) { closeForgotModal(); return; }
        var el = (e.target && e.target.closest) ? e.target.closest('#fm-close') : null;
        if (el) closeForgotModal();
      } catch (_) {}
    });

    // Bind the exact same forgot-password code as the former page.
    wireForgotHelper();
    return overlay;
  }

  function closeMobileMenu() {
    try {
      var menus = document.querySelectorAll('#mobile-menu.open, .mobile-menu.open, .site-mobile-menu.open');
      for (var i = 0; i < menus.length; i++) menus[i].classList.remove('open');
      var toggles = document.querySelectorAll('.mobile-menu-toggle.active, .site-menu-toggle.active');
      for (var j = 0; j < toggles.length; j++) toggles[j].classList.remove('active');
    } catch (_) {}
  }

  function openForgotModal() {
    try { if (typeof window.closeLoginModal === 'function') window.closeLoginModal(); } catch (_) {}
    try { if (typeof window.closeSignupModal === 'function') window.closeSignupModal(); } catch (_) {}
    closeMobileMenu();
    // Built lazily on first open so page init and popup wiring never double-bind.
    var ov = buildModal();
    wireForgotHelper();
    try { lastFocused = document.activeElement; } catch (_) {}
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    try { document.body.style.overflow = 'hidden'; } catch (_) {}
    setTimeout(function () {
      try {
        var input = document.getElementById('forgot-email');
        if (input) input.focus();
      } catch (_) {}
    }, 60);
  }

  function closeForgotModal() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    try { document.body.style.overflow = ''; } catch (_) {}
    try {
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    } catch (_) {}
  }

  // ESC closes.
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && overlay && overlay.classList.contains('open')) {
      closeForgotModal();
    }
  });

  // "Forgot password?" links open the popup instead of navigating.
  // "Sign In" links inside the popup are handled by the login popup script.
  document.addEventListener('click', function (e) {
    var a = null;
    try { a = e.target && e.target.closest ? e.target.closest('a[href]') : null; } catch (_) {}
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!/forgot-password\.html(\?|#|$)/.test(href)) return;
    e.preventDefault();
    openForgotModal();
  });

  window.openForgotModal = openForgotModal;
  window.closeForgotModal = closeForgotModal;
})();
