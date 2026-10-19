/* =========================================================
   Anteemonee SIGNUP POPUP — header "Sign Up" opens a modal
   reusing the exact same signup code (handleSignup in app.js).
   It uses the same element IDs as pages/signup.html, so every
   helper (username check, password rules, confirm match) works
   unchanged. The modal is never injected on signup.html itself.
   Signup links (?mode=add_account) keep the full-page flow.
   ========================================================= */
(function () {
  'use strict';

  // A second copy of this file must never double-wire (duplicate script
  // tags would otherwise stack two popups with dead buttons on top).
  if (window.__smLoaded) return;
  window.__smLoaded = true;

  // The signup page already has the full form — no popup needed there.
  try {
    if (/(^|\/)signup\.html$/.test(window.location.pathname)) return;
  } catch (_) {}

  // Root-absolute prefixes: this script runs from the site root, from
  // /pages/*.html and from the folder pages (/ai-chat/, /settings/, ...), so a
  // depth-relative prefix would break on the moved pages.
  var assetPrefix = '/';
  var pagePrefix = '/pages/';

  var overlay = null;
  var lastFocused = null;

  var GOOGLE_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
  var SPOTIFY_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
  var EYE_OPEN = '<svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_CLOSED = '<svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function wireSignupHelpers() {
    // Same IDs as pages/signup.html, so the page helpers bind unchanged.
    try { if (typeof setupSignupForm === 'function') setupSignupForm(); } catch (_) {}
    try { if (typeof setupPasswordRequirements === 'function') setupPasswordRequirements(); } catch (_) {}
    try { if (typeof setupUsernameAvailability === 'function') setupUsernameAvailability(); } catch (_) {}
  }

  function buildModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'sm-overlay';
    overlay.id = 'sm-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="sm-card" role="dialog" aria-modal="true" aria-labelledby="sm-title">' +
        '<button type="button" class="sm-close" id="sm-close" aria-label="Close">&times;</button>' +
        '<div class="sm-head">' +
          '<img src="' + assetPrefix + 'assets/anteemonee.png" alt="Anteemonee">' +
          '<h2 id="sm-title">Create account</h2>' +
          '<p>Takes less than a minute</p>' +
        '</div>' +
        '<form class="sm-form" id="signup-form">' +
          '<div class="sm-error" id="signup-error"></div>' +
          '<div class="sm-success" id="signup-success"></div>' +
          '<div class="sm-field">' +
            '<label for="signup-username">Username</label>' +
            '<input type="text" id="signup-username" class="form-input" placeholder="Choose a username" required autocomplete="username" minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+">' +
          '</div>' +
          '<div class="sm-field">' +
            '<label for="signup-email">Email</label>' +
            '<input type="email" id="signup-email" class="form-input" placeholder="you@example.com" required autocomplete="email">' +
          '</div>' +
          '<div class="sm-field">' +
            '<label for="signup-password">Password</label>' +
            '<div class="input-wrapper">' +
              '<input type="password" id="signup-password" class="form-input" placeholder="Create a password" required minlength="6" maxlength="50" autocomplete="new-password">' +
              '<button type="button" class="password-toggle" onclick="togglePassword(\'signup-password\', this)" aria-label="Toggle password visibility">' + EYE_OPEN + EYE_CLOSED + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="sm-field">' +
            '<label for="signup-confirm-password">Confirm Password</label>' +
            '<div class="input-wrapper">' +
              '<input type="password" id="signup-confirm-password" class="form-input" placeholder="Re-enter your password" required autocomplete="new-password">' +
              '<button type="button" class="password-toggle" onclick="togglePassword(\'signup-confirm-password\', this)" aria-label="Toggle password visibility">' + EYE_OPEN + EYE_CLOSED + '</button>' +
            '</div>' +
            '<span id="signup-confirm-error" class="sm-confirm-error">Passwords do not match</span>' +
          '</div>' +
          '<button type="submit" class="btn-primary">Create Account</button>' +
        '</form>' +
        '<div class="sm-divider"><span>or continue with</span></div>' +
        '<div class="sm-providers">' +
          '<button type="button" class="sm-provider-btn" onclick="signInWithGoogle()">' + GOOGLE_SVG + 'Continue with Google</button>' +
          '<button type="button" class="sm-provider-btn sm-spotify" onclick="signInWithSpotify()">' + SPOTIFY_SVG + 'Continue with Spotify</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // One delegated listener for the close button + backdrop — no
    // per-element binds that could silently miss.
    overlay.addEventListener('click', function (e) {
      try {
        if (e.target === overlay) { closeSignupModal(); return; }
        var el = (e.target && e.target.closest) ? e.target.closest('#sm-close') : null;
        if (el) closeSignupModal();
      } catch (_) {}
    });

    // Bind the exact same signup code as the signup page.
    wireSignupHelpers();
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

  function openSignupModal() {
    // Don't popup over the full-page add-account flow.
    try {
      if (new URLSearchParams(window.location.search).get('mode') === 'add_account') {
        window.location.href = pagePrefix + 'signup.html?mode=add_account';
        return;
      }
    } catch (_) {}
    try { if (typeof window.closeLoginModal === 'function') window.closeLoginModal(); } catch (_) {}
    closeMobileMenu();
    var ov = buildModal();
    // Bind the exact same signup code as the signup page (idempotent).
    wireSignupHelpers();
    try { lastFocused = document.activeElement; } catch (_) {}
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    try { document.body.style.overflow = 'hidden'; } catch (_) {}
    setTimeout(function () {
      try {
        var input = document.getElementById('signup-username');
        if (input) input.focus();
      } catch (_) {}
    }, 60);
  }

  function closeSignupModal() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    try { document.body.style.overflow = ''; } catch (_) {}
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get('auth') === 'signup') {
        u.searchParams.delete('auth');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    } catch (_) {}
    try {
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    } catch (_) {}
  }

  // ESC closes.
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && overlay && overlay.classList.contains('open')) {
      closeSignupModal();
    }
  });

  // Header / mobile / footer "Sign Up" links open the popup instead of navigating.
  // "Sign In" links inside the popup are handled by the login popup script.
  document.addEventListener('click', function (e) {
    var a = null;
    try { a = e.target && e.target.closest ? e.target.closest('a[href]') : null; } catch (_) {}
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!/signup\.html(\?|#|$)/.test(href)) return;
    if (href.indexOf('mode=add_account') !== -1) return; // full-page flow
    e.preventDefault();
    openSignupModal();
  });

  // Built lazily on first open so page init and popup wiring never double-bind.
  window.openSignupModal = openSignupModal;
  window.closeSignupModal = closeSignupModal;

  // Deep link: /?auth=signup opens the popup on load.
  (function openFromQuery() {
    var open = function () {
      try {
        if (new URLSearchParams(window.location.search).get('auth') === 'signup') openSignupModal();
      } catch (_) {}
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open);
    else open();
  })();
})();
