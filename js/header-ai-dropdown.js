(function () {
  var ICONS = {
    book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    layers: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    bookOpen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    clipboard: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 13l2 2 4-4"/></svg>',
    classroom: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M21 13v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M12 14v5"/></svg>',
    file: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
  };

  function ensureIconCss() {
    if (document.getElementById('nav-drop-icon-css')) return;
    var st = document.createElement('style');
    st.id = 'nav-drop-icon-css';
    st.textContent = '.nav-drop .nav-menu a{display:flex;align-items:center;gap:8px}.nav-drop .nav-menu a svg{flex-shrink:0;opacity:.65}';
    document.head.appendChild(st);
  }
  function fixPrefixes() {
    function resolvesUnderPages(rel) {
      try {
        return /\/pages\/[^/]+$/.test(new URL(rel, document.baseURI).pathname);
      } catch (_) { return false; }
    }
    if (resolvesUnderPages('ai-classroom.html')) {
      return { ai: 'ai-chat.html', test: 'ai-test-builder.html', classroom: 'ai-classroom.html' };
    }
    return {
      ai: 'pages/ai-chat.html',
      test: 'pages/ai-test-builder.html',
      classroom: 'pages/ai-classroom.html'
    };
  }

  function dropdownHtml(p, label) {
    return (
      '<div class="nav-drop">' +
      '<a href="#">' + label + ' <span class="caret">▾</span></a>' +
      '<div class="nav-menu">' +
      '<a href="' + p.ai + '">' + ICONS.chat + 'AI Tutor</a>' +
      '<a href="' + p.test + '">' + ICONS.clipboard + 'AI Test Builder</a>' +
      '<a href="' + p.classroom + '">' + ICONS.classroom + 'AI Classroom</a>' +
      '</div></div>'
    );
  }

  function isDesktopAiLink(a) {
    if (!a || !a.classList) return false;
    if (a.closest('.nav-menu')) return false;
    if (a.closest('.mobile-menu') || a.closest('#mobile-menu') || a.closest('.site-mobile-menu')) return false;
    if (a.closest('.profile-dropdown') || a.closest('.landing-profile-dropdown') || a.closest('.dropdown')) return false;
    if (a.classList.contains('dropdown-item')) return false;
    if (a.classList.contains('mobile-nav-link') || a.classList.contains('site-mobile-link')) return false;
    if (a.classList.contains('btn-secondary') || a.classList.contains('btn-primary') || a.classList.contains('btn-login') || a.classList.contains('btn-signup')) return false;
    var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (text !== 'AI Assistant') return false;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('ai-chat') === -1) return false;
    if (!a.closest('nav') && !a.closest('.header') && !a.closest('header')) return false;
    return true;
  }

  function isMobileAiLink(a) {
    if (!a || !a.classList) return false;
    if (!(a.classList.contains('mobile-nav-link') || a.classList.contains('site-mobile-link'))) return false;
    var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    return text === 'AI Assistant';
  }

  function markCurrent() {
    try {
      var path = location.pathname;
      document.querySelectorAll('.nav-menu a, .mobile-acc-list a').forEach(function (a) {
        var href = a.getAttribute('href') || '';
        var on = function (slug) { return href.indexOf(slug) !== -1 && path.indexOf(slug) !== -1; };
        if (on('ai-test-builder') || on('ai-classroom') || (on('ai-chat') && path.indexOf('ai-test') === -1)) {
          a.style.color = 'var(--accent)';
          a.style.fontWeight = '650';
        }
      });
    } catch (_) {}
  }

  function iconForLibrary(href) {
    href = href || '';
    if (href.indexOf('ai-classroom') !== -1) return ICONS.classroom;
    if (href.indexOf('ebooks') !== -1) return ICONS.book;
    if (href.indexOf('flashcards') !== -1) return ICONS.layers;
    if (href.indexOf('definitions') !== -1) return ICONS.bookOpen;
    if (href.indexOf('past-papers') !== -1) return ICONS.file;
    if (href.indexOf('ai-test-builder') !== -1) return ICONS.clipboard;
    if (href.indexOf('ai-chat') !== -1) return ICONS.chat;
    return null;
  }

  function decorateLibrary() {
    ensureIconCss();
    document.querySelectorAll('.nav-drop .nav-menu a').forEach(function (a) {
      if (a.getAttribute('data-nav-icon') === '1') return;
      if (a.querySelector('svg')) { a.setAttribute('data-nav-icon', '1'); return; }
      var icon = iconForLibrary(a.getAttribute('href'));
      if (!icon) return;
      a.setAttribute('data-nav-icon', '1');
      a.insertAdjacentHTML('afterbegin', icon);
    });
  }

  // Icons inside the hamburger menu: eBooks / Flashcards / Definitions /
  // Past Papers links + AI Tutor / AI Test Builder in the AI accordion.
  function decorateMobileIcons() {
    document.querySelectorAll('a.mobile-nav-link, a.site-mobile-link').forEach(function (a) {
      if (a.getAttribute('data-menu-icon') === '1') return;
      if (a.querySelector('svg')) { a.setAttribute('data-menu-icon', '1'); return; }
      var icon = iconForLibrary(a.getAttribute('href'));
      if (!icon) return;
      a.setAttribute('data-menu-icon', '1');
      a.insertAdjacentHTML('afterbegin', icon);
    });
  }

  function enhance() {
    var p = fixPrefixes();
    ensureIconCss();
    decorateLibrary();

    document.querySelectorAll('nav a, header a, .header a').forEach(function (a) {
      if (!isDesktopAiLink(a)) return;
      if (a.getAttribute('data-ai-drop') === '1') return;
      var wrap = document.createElement('div');
      wrap.innerHTML = dropdownHtml(p, 'AI Assistant');
      var drop = wrap.firstChild;
      a.setAttribute('data-ai-drop', '1');
      a.replaceWith(drop);
    });

    document.querySelectorAll('a.mobile-nav-link, a.site-mobile-link').forEach(function (a) {
      if (!isMobileAiLink(a)) return;
      if (a.getAttribute('data-ai-mobile') === '1') return;
      var cls = a.className;
      // Same accordion pattern as the Library group in the hamburger menu.
      var wrap = document.createElement('div');
      wrap.className = 'mobile-acc-dropdown';
      wrap.setAttribute('data-ai-mobile', '1');
      wrap.innerHTML =
        '<button type="button" class="' + cls + ' mobile-acc-toggle">AI Assistant <span class="mobile-acc-chevron">▾</span></button>' +
        '<div class="mobile-acc-list">' +
          '<a href="' + p.ai + '" class="' + cls + '">' + ICONS.chat + 'AI Tutor</a>' +
          '<a href="' + p.test + '" class="' + cls + '">' + ICONS.clipboard + 'AI Test Builder</a>' +
          '<a href="' + p.classroom + '" class="' + cls + '">' + ICONS.classroom + 'AI Classroom</a>' +
        '</div>';
      a.setAttribute('data-ai-mobile', '1');
      a.replaceWith(wrap);
    });

    decorateMobileIcons();
    markCurrent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
  setTimeout(enhance, 400);
  setTimeout(enhance, 1200);
})();
