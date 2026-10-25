/* ==========================================================
   Anteemonee — Site chrome (all pages)
   One integrated source for the header, mobile menu and
   footer. Pages include one <script> tag and (optionally)
   two placeholder divs; nothing is copy-pasted per page.

   Usage in any page:
     <div data-site-header></div>
     <script src="{path-to}/js/site-chrome.js"></script>
       ...page content...
     <div data-site-footer></div>

   If a placeholder is missing the matching block is simply
   not injected, so app-like pages (ai-chat) can skip the
   footer while pages that forget the tag still work.
   ========================================================== */
(function () {
  'use strict';

  /* ── Root ─────────────────────────────────────────────────────
     Works out the depth of the current document relative to the
     site root, no matter if it is a folder index (/ai-chat/) or
     a direct file (/pages/login.html). Override per page with
     <body data-root=".."> for special deployments. */
  function docRoot() {
    var forced = document.body && document.body.getAttribute('data-root');
    if (forced !== null && forced !== undefined && forced !== '') return forced;
    var path = window.location.pathname;
    var dir = /\.[a-zA-Z0-9]+$/.test(path) ? path.replace(/[^/]*$/, '') : path;
    var depth = (dir.match(/\//g) || []).length - 1; // '/a/b/' -> 2 slashes -> 1 level up
    if (dir === '' || dir === '/') depth = 0;
    if (path === '/') depth = 0;
    return new Array(Math.max(depth, 0) + 1).join('../') || './';
  }

  /* Paid users skip the Premium upsell link; localStorage hint (written by
     app.js from the entitlement snapshot) applies before first paint. */
  try {
    if (localStorage.getItem('Anteemonee_paid') === '1') {
      document.documentElement.classList.add('has-premium');
    } else {
      document.documentElement.classList.remove('has-premium');
    }
  } catch (_) {}

  /* ── Templates ──────────────────────────────────────────────── */
  // Small line icons for the header nav (15px, stroke 1.8).
  var NAV_ICON = {
    ebook: '<svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    cards: '<svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="M8.5 4.5h9a2 2 0 0 1 2 2v9"/><path d="M19.5 3h1a1.5 1.5 0 0 1 1.5 1.5v11"/></svg>',
    papers: '<svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/></svg>',
    spark: '<svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg>',
    checklist: '<svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/></svg>'
  };

  function headerTemplate(root) {
    return (
      '<header class="header" id="site-header">' +
        '<div class="header-inner">' +
          '<a href="' + root + 'index.html" class="logo-link">' +
            '<img src="' + root + 'assets/anteemonee.png" alt="Anteemonee" class="logo-img">' +
            '<span class="brand-stack"><span class="logo-text">Anteemonee</span></span>' +
          '</a>' +
          '<nav class="landing-nav" aria-label="Primary">' +
            '<div class="nav-drop">' +
              '<a href="#">Library <span class="caret">▾</span></a>' +
              '<div class="nav-menu">' +
                '<a href="' + root + 'ebooks/">' + NAV_ICON.ebook + '<span>eBooks</span></a>' +
                '<a href="' + root + 'flashcards/">' + NAV_ICON.cards + '<span>Flashcards</span></a>' +
                '<a href="' + root + 'past-papers/">' + NAV_ICON.papers + '<span>Past Papers</span></a>' +
              '</div>' +
            '</div>' +
            '<div class="nav-drop">' +
              '<a href="' + root + 'ai-chat/">AI Assistant <span class="caret">▾</span></a>' +
              '<div class="nav-menu">' +
                '<a href="' + root + 'ai-chat/">' + NAV_ICON.spark + '<span>AI Tutor</span></a>' +
                '<a href="' + root + 'ai-examiner/">' + NAV_ICON.checklist + '<span>AI Examiner</span></a>' +
              '</div>' +
            '</div>' +
            '<a href="' + root + 'ai-test-builder/">AI Test Builder</a>' +
            '<a href="' + root + 'slame/">Slame</a>' +
            '<a href="' + root + 'century-club/">Century Club</a>' +
            '<a href="' + root + 'premium/">Premium</a>' +
          '</nav>' +
          '<div class="header-actions">' +
            '<button class="icon-btn theme-toggle" id="theme-toggle" aria-label="Toggle theme">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' +
            '</button>' +
            '<div id="landing-auth" class="auth-logged-out" style="display:none">' +
              '<a href="' + root + 'pages/login.html" class="btn-login">Log in</a>' +
              '<a href="' + root + 'pages/signup.html" class="btn-signup">Sign Up</a>' +
            '</div>' +
            '<div id="landing-auth-in" class="auth-logged-in" style="display:none; position: relative;"></div>' +
            '<button class="mobile-menu-toggle" id="menu-toggle" aria-label="Menu"><span></span></button>' +
          '</div>' +
        '</div>' +
      '</header>' +
      '<div class="mobile-menu" id="mobile-menu">' +
        '<div class="mobile-menu-veil" aria-hidden="true"></div>' +
        '<div class="mobile-menu-sheet">' +
        '<div class="mobile-menu-label">Menu</div>' +
        '<div class="mobile-acc-dropdown">' +
          '<button type="button" class="mobile-nav-link mobile-acc-toggle">Library <span class="mobile-acc-chevron">▾</span></button>' +
          '<div class="mobile-acc-list">' +
            '<a href="' + root + 'ebooks/" class="mobile-nav-link">' + NAV_ICON.ebook + '<span>eBooks</span></a>' +
            '<a href="' + root + 'flashcards/" class="mobile-nav-link">' + NAV_ICON.cards + '<span>Flashcards</span></a>' +
            '<a href="' + root + 'past-papers/" class="mobile-nav-link">' + NAV_ICON.papers + '<span>Past Papers</span></a>' +
          '</div>' +
        '</div>' +
        '<a href="' + root + 'ai-chat/" class="mobile-nav-link">' + NAV_ICON.spark + '<span>AI Tutor</span></a>' +
        '<a href="' + root + 'ai-examiner/" class="mobile-nav-link">' + NAV_ICON.checklist + '<span>AI Examiner</span></a>' +
        '<a href="' + root + 'ai-test-builder/" class="mobile-nav-link">AI Test Builder</a>' +
        '<a href="' + root + 'slame/" class="mobile-nav-link">Slame</a>' +
        '<a href="' + root + 'century-club/" class="mobile-nav-link">Century Club</a>' +
        '<a href="' + root + 'premium/" class="mobile-nav-link">Premium</a>' +
        '<div class="mobile-cta">' +
          '<a href="' + root + 'pages/login.html" class="btn-login">Log in</a>' +
          '<a href="' + root + 'pages/signup.html" class="btn-signup">Sign Up</a>' +
        '</div>' +
        '</div></div>'
    );
  }

  function footerTemplate(root) {
    return (
      '<footer class="footer">' +
        '<div class="footer-inner">' +
          '<div class="footer-top">' +
            '<div class="footer-brand">' +
              '<a href="' + root + 'index.html" class="logo-link">' +
                '<img src="' + root + 'assets/anteemonee.png" alt="Anteemonee" class="logo-img">' +
                '<span class="logo-text-wrap"><span class="brand-stack"><span class="logo-text">Anteemonee</span></span>' +
                '<span class="logo-sub">Student OS</span></span>' +
              '</a>' +
              '<p>The Student OS for Pakistan: FSc, matric &amp; intermediate.</p>' +
            '</div>' +
            '<div class="footer-links">' +
              '<div class="footer-col">' +
                '<h4>Explore</h4>' +
                '<a href="' + root + 'ai-chat/">AI Tutor</a>' +
                '<a href="' + root + 'flashcards/">Flashcards</a>' +
                '<a href="' + root + 'past-papers/">Past Papers</a>' +
                '<a href="' + root + 'pages/download.html">Download App</a>' +
              '</div>' +
              '<div class="footer-col">' +
                '<h4>Account</h4>' +
                '<a id="footer-signup-link" href="' + root + 'pages/signup.html">Sign Up</a>' +
                '<a href="' + root + 'account/">Profile</a>' +
                '<a href="' + root + 'settings/">Settings</a>' +
                '<a href="' + root + 'premium/">Premium</a>' +
              '</div>' +
              '<div class="footer-col">' +
                '<h4>Legal</h4>' +
                '<a href="' + root + 'privacy/">Privacy Policy</a>' +
                '<a href="' + root + 'terms/">Terms of Service</a>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="footer-bottom"><p>© 2026 Anteemonee. Made for Pakistan&apos;s students.</p></div>' +
        '</div>' +
      '</footer>'
    );
  }

  /* ── Nav highlight ────────────────────────────────────────── */
  function markCurrent() {
    var here = window.location.pathname.replace(/index\.html$/, '').replace(/\/+$/, '/') || '/';
    var links = document.querySelectorAll('.landing-nav > a, .mobile-menu > a');
    var dropChild = document.querySelectorAll('.landing-nav .nav-menu a, .mobile-menu .mobile-acc-list a');
    var matchedDropdownTrigger = false;
    for (var d = 0; d < dropChild.length; d++) {
      var a = dropChild[d];
      var href = a.getAttribute('href') || '';
      if (!href || href === '#') continue;
      var target = null;
      try { target = new URL(a.href, window.location.href); } catch (e) { continue; }
      if (!target || target.origin !== window.location.origin) continue;
      var p = target.pathname.replace(/index\.html$/, '').replace(/\/+$/, '/') || '/';
      if (p === here) {
        a.classList.add('is-current');
        var owner = a.closest('.nav-drop');
        if (owner) {
          var trigger = owner.querySelector(':scope > a');
          if (trigger) trigger.classList.add('has-current');
        }
        matchedDropdownTrigger = true;
      }
    }
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href') || '';
      if (!href || href === '#') continue;
      var target = null;
      try { target = new URL(a.href, window.location.href); } catch (e) { continue; }
      if (!target || target.origin !== window.location.origin) continue;
      var p = target.pathname.replace(/index\.html$/, '').replace(/\/+$/, '/') || '/';
      if (p === here) {
        a.classList.add('is-current');
        a.setAttribute('aria-current', 'page');
      }
    }
    // Pages reached through a dropdown get a quiet marker on their trigger.
    if (matchedDropdownTrigger && !document.querySelector('.landing-nav > a.is-current')) {
      document.querySelectorAll('.landing-nav .nav-drop .nav-menu a.is-current')
        .forEach(function (a) {
          var owner = a.closest('.nav-drop');
          if (!owner) return;
          var trigger = owner.querySelector(':scope > a');
          if (trigger) { trigger.classList.add('is-current'); trigger.setAttribute('aria-current', 'page'); }
        });
    }
  }

  function render(root) {
    var spots = document.querySelectorAll('[data-site-header]');
    for (var i = 0; i < spots.length; i++) {
      var ph = spots[i];
      if (ph.dataset.chromeDone === '1') continue;
      ph.dataset.chromeDone = '1';
      ph.outerHTML = headerTemplate(root);
    }
    var footers = document.querySelectorAll('[data-site-footer]');
    for (var j = 0; j < footers.length; j++) {
      var fp = footers[j];
      if (fp.dataset.chromeDone === '1') continue;
      fp.dataset.chromeDone = '1';
      fp.outerHTML = footerTemplate(root);
    }
    if ((spots.length || footers.length) && !markCurrent.done) {
      markCurrent.done = true;
      try { markCurrent(); } catch (e) {}
    }
  }

  /* Belt and braces: any placeholder that appears after this script
     has already run (e.g. the footer include further down the page)
     triggers a second render pass automatically. */
  new MutationObserver(function () { render(docRoot()); })
    .observe(document.documentElement, { childList: true, subtree: true });

  function boot() { render(docRoot()); }
  if (document.readyState === 'loading' && !document.querySelector('[data-site-header], [data-site-footer], .header')) {
    document.addEventListener('DOMContentLoaded', function () { boot(); });
  } else {
    boot();
  }
})();
