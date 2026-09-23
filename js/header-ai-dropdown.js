(function () {
  var ICONS = {
    book: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    layers: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    bookOpen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    clipboard: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 13l2 2 4-4"/></svg>'
  };

  function ensureIconCss() {
    if (document.getElementById('nav-drop-icon-css')) return;
    var st = document.createElement('style');
    st.id = 'nav-drop-icon-css';
    st.textContent = '.nav-drop .nav-menu a{display:flex;align-items:center;gap:8px}.nav-drop .nav-menu a svg{flex-shrink:0;opacity:.65}';
    document.head.appendChild(st);
  }
  function fixPrefixes() {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var inPages = false;
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.indexOf('../css/style.css') !== -1) { inPages = true; break; }
      if (/^(css\/style\.css)/.test(href)) { inPages = false; }
    }
    var path = location.pathname.replace(/\\/g, '/');
    if (path.indexOf('/pages/') !== -1) inPages = true;
    if (path.endsWith('/index.html') || path === '/' || /\/$/.test(path)) {
      if (path.indexOf('/pages/') === -1) inPages = false;
    }
    if (inPages) return { ai: 'ai-chat.html', test: 'ai-test-builder.html' };
    return { ai: 'pages/ai-chat.html', test: 'pages/ai-test-builder.html' };
  }

  function dropdownHtml(p, label) {
    return (
      '<div class="nav-drop">' +
      '<a href="#">' + label + ' <span class="caret">▾</span></a>' +
      '<div class="nav-menu">' +
      '<a href="' + p.ai + '">' + ICONS.chat + 'AI Tutor</a>' +
      '<a href="' + p.test + '">' + ICONS.clipboard + 'AI Test Builder</a>' +
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
      document.querySelectorAll('.nav-menu a').forEach(function (a) {
        var href = a.getAttribute('href') || '';
        var isTest = href.indexOf('ai-test-builder') !== -1 && path.indexOf('ai-test-builder') !== -1;
        var isTutor = (href.indexOf('ai-chat') !== -1) && path.indexOf('ai-chat') !== -1 && path.indexOf('ai-test') === -1;
        if (isTest || isTutor) {
          a.style.color = 'var(--accent)';
          a.style.fontWeight = '650';
        }
      });
    } catch (_) {}
  }

  function iconForLibrary(href) {
    href = href || '';
    if (href.indexOf('ebooks') !== -1) return ICONS.book;
    if (href.indexOf('flashcards') !== -1) return ICONS.layers;
    if (href.indexOf('definitions') !== -1) return ICONS.bookOpen;
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
      var tutor = document.createElement('a');
      tutor.className = cls;
      tutor.setAttribute('href', p.ai);
      tutor.setAttribute('data-ai-mobile', '1');
      tutor.textContent = 'AI Tutor';
      var test = document.createElement('a');
      test.className = cls;
      test.setAttribute('href', p.test);
      test.setAttribute('data-ai-mobile', '1');
      test.textContent = 'AI Test Builder';
      a.setAttribute('data-ai-mobile', '1');
      a.replaceWith(tutor, test);
    });

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
