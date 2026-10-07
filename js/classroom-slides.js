/* Anteemonee AI Classroom — slide deck viewer.
 *
 * Deliberately NOT the ebooks / past-papers viewer. This one has no controls:
 * no next/prev, no zoom, no page box, no fullscreen button. The class drives
 * it, so the student cannot skip ahead and desync from the explanation.
 *
 * The only public API is showSlide(n) and onSlide(cb). Everything else is
 * internal so nobody can accidentally expose navigation.
 */
(function () {
  'use strict';

  var PDFJS = '/assets/js/vendor/pdf.min.js';
  var PDFJS_WORKER = '/assets/js/vendor/pdf.worker.min.js';

  var doc = null;
  var url = null;
  var current = -1;
  var canvas = null;
  var ctx = null;
  var slideCb = null;
  var rendering = false;
  var queued = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
          resolve(window.pdfjsLib);
        } else reject(new Error('pdf.js loaded but pdfjsLib missing'));
      };
      s.onerror = function () { reject(new Error('could not load pdf.js')); };
      document.head.appendChild(s);
    });
  }

  function fitScale(page, cssW, cssH) {
    var base = page.getViewport({ scale: 1 });
    return Math.min(cssW / base.width, cssH / base.height);
  }

  function render() {
    if (!doc || !canvas) return;
    if (rendering) { queued = true; return; }
    if (current < 1 || current > doc.numPages) return;
    rendering = true;

    doc.getPage(current).then(function (page) {
      var box = canvas.parentElement.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var scale = fitScale(page, Math.max(320, box.width), Math.max(180, box.height));
      var vp = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(vp.width / dpr) + 'px';
      canvas.style.height = Math.floor(vp.height / dpr) + 'px';
      return page.render({ canvasContext: ctx, viewport: vp }).promise;
    }).then(function () {
      rendering = false;
      if (queued) { queued = null; render(); }
    }).catch(function (e) {
      rendering = false;
      console.warn('[Classroom] slide render failed', e);
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 140);
  });

  function withTimeout(p, ms, label) {
    return Promise.race([
      p,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error(label + ' timed out')); }, ms);
      }),
    ]);
  }

  var pendingSlide = null;

  var api = {
    // point the viewer at a deck
    open: function (pdfUrl, startSlide) {
      url = pdfUrl;
      current = -1;
      doc = null;
      pendingSlide = startSlide || 1;
      canvas = document.getElementById('cl-slide-canvas');
      if (!canvas) return Promise.reject(new Error('slide canvas missing'));
      ctx = canvas.getContext('2d');
      return loadScript(PDFJS)
        .then(function (lib) {
          return withTimeout(lib.getDocument({ url: pdfUrl }).promise, 25000, 'pdf load');
        })
        .then(function (d) {
          doc = d;
          return api.showSlide(pendingSlide || 1);
        });
    },
    showSlide: function (n) {
      var page = Math.max(1, Math.min(doc ? doc.numPages : 1e9, n | 0));
      // The class keeps moving while the PDF is still downloading, so hold the
      // latest requested slide and jump to it the moment the deck is ready.
      if (!doc) { pendingSlide = page; return Promise.resolve(); }
      pendingSlide = page;
      if (page === current) { render(); return Promise.resolve(); }
      current = page;
      // clear so a previous longer slide does not show through
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      render();
      if (slideCb) { try { slideCb(page, doc.numPages); } catch (_) {} }
      return Promise.resolve();
    },
    onSlide: function (fn) { slideCb = fn; },
    pageCount: function () { return doc ? doc.numPages : 0; },
    currentSlide: function () { return current; },
  };

  window.ClassroomSlides = api;
})();
