/**
 * LatticeLoader — vanilla port of the React Bits "LatticeLoader"
 * (https://reactbits.dev) for Anteemonee AI Tutor. Non-React build:
 * create(opts) returns a small API object; statuses mirror the original.
 *
 *   var ll = LatticeLoader.create({ label: 'Thinking', pattern: 'orbit' });
 *   someRow.appendChild(ll.el);
 *   ll.setLabel('Reading the textbook…');
 *   ll.stop();          // freezes the stopwatch; returns elapsed ms
 *   ll.setStatus('done');   // green check + "Done in X.Xs"
 *   ll.setStatus('error');  // red cross + "Failed after X.Xs"
 */
(function () {
  'use strict';

  var PATTERNS = {
    arrow: { 3: { cells: [1, 2, 3, 0, 1, 2, 1, 2, 3], loop: 7.2, scale: 1 } },
    dots: { 3: { cells: [0, 1, 2, 0, 1, 2, 0, 1, 2], loop: 3, scale: 2.4 } },
    ripple: { 3: { cells: [2, 1, 2, 1, 0, 1, 2, 1, 2], loop: 4.8, scale: 1.5 } },
    spiral: { 3: { cells: [0, 1, 2, 7, 8, 3, 6, 5, 4], loop: 9, scale: 1.2, lit: 0.35 } },
    orbit: {
      3: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 },
      4: { cells: [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6], loop: 6, scale: 1.2, lit: 0.45 }
    },
    snake: {
      3: { cells: [0, 1, 2, 5, 4, 3, 6, 7, 8], loop: 9, scale: 1, lit: 0.35 },
      4: { cells: [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12], loop: 16, scale: 1, lit: 0.25 }
    },
    sweep: { 4: { cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6], loop: 5, scale: 1, lit: 0.45 } },
    spin: { 4: { cells: [0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 2, 2, 3, 3, 2, 2], loop: 4, scale: 1.6, lit: 0.35 } },
    rain: { 4: { cells: [0, 2, 1, 3, 1, 3, 2, 4, 2, 4, 3, 5, 3, 5, 4, 6], loop: 4, scale: 1.2, lit: 0.35 } },
    pulse: { 4: { cells: [2, 1, 1, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2], loop: 2.4, scale: 2.5, lit: 0.45 } }
  };
  var DEFAULT_PATTERN = { 3: 'orbit', 4: 'sweep' };
  var MARKS = {
    3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] },
    4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] }
  };

  function resolvePattern(pattern, grid) {
    if (typeof pattern === 'string') {
      var named = PATTERNS[pattern];
      return (named && named[grid]) || PATTERNS[DEFAULT_PATTERN[grid]][grid];
    }
    var cells = [];
    for (var i = 0; i < grid * grid; i++) cells.push(i < pattern.cells.length ? pattern.cells[i] : null);
    var max = 0;
    cells.forEach(function (v) { if (v != null && v > max) max = v; });
    return { cells: cells, loop: pattern.loop != null ? pattern.loop : max + 4.2, scale: pattern.scale != null ? pattern.scale : 1, lit: pattern.lit != null ? pattern.lit : 0.62 };
  }

  function fmt(ds) {
    return ds < 600 ? (ds / 10).toFixed(1) + 's' : Math.floor(ds / 600) + 'm ' + ((ds % 600) / 10).toFixed(1) + 's';
  }
  function spoken(ds) {
    return ds < 600
      ? (ds / 10).toFixed(1) + ' seconds'
      : Math.floor(ds / 600) + ' minutes ' + ((ds % 600) / 10).toFixed(1) + ' seconds';
  }

  function create(opts) {
    opts = opts || {};
    var n = opts.grid === 4 ? 4 : 3;
    var pat = resolvePattern(opts.pattern || 'orbit', n);
    var marks = MARKS[n];
    var step = opts.step != null ? opts.step : 110;
    var idleOpacity = opts.idleOpacity != null ? opts.idleOpacity : 0.15;
    var shape = opts.shape || 'round';
    var glow = !!opts.glow;
    var glowColor = opts.glowColor || '';
    var showTimer = opts.showTimer !== false;
    var label = opts.label || 'Thinking';
    var doneLabel = opts.doneLabel || 'Done in';
    var errorLabel = opts.errorLabel || 'Failed after';
    var doneColor = opts.doneColor || '#22c55e';
    var errorColor = opts.errorColor || '#ef4444';
    var color = opts.color || 'currentColor';

    var d = step * pat.scale;
    var cycle = Math.round(pat.loop * d);

    var root = document.createElement('span');
    root.className = 'lattice-loader' + (opts.className ? ' ' + opts.className : '');
    root.setAttribute('role', 'status');
    root.setAttribute('data-status', 'working');
    root.setAttribute('data-shape', shape);
    if (glow) root.setAttribute('data-glow', '');
    root.style.setProperty('--ll-n', String(n));
    root.style.setProperty('--ll-cell', (opts.cellSize != null ? opts.cellSize : 5) + 'px');
    root.style.setProperty('--ll-gap', (opts.gap != null ? opts.gap : 1.5) + 'px');
    root.style.setProperty('--ll-font', (opts.fontSize != null ? opts.fontSize : 13) + 'px');
    root.style.setProperty('--ll-color', color);
    root.style.setProperty('--ll-mark', doneColor);
    root.style.setProperty('--ll-idle', String(idleOpacity));
    root.style.setProperty('--ll-glow', glowColor || color);
    root.style.setProperty('--ll-mark-glow', glowColor || doneColor);
    root.style.setProperty('--ll-cycle', cycle + 'ms');
    if (opts.style) for (var k in opts.style) { try { root.style[k] = opts.style[k]; } catch (_) {} }

    // grid
    var gridEl = document.createElement('span');
    gridEl.className = 'lattice-loader__grid';
    gridEl.setAttribute('aria-hidden', 'true');
    var run = document.createElement('span');
    run.className = 'lattice-loader__layer lattice-loader__run';
    pat.cells.forEach(function (unit) {
      var c = document.createElement('span');
      c.className = 'lattice-loader__cell';
      if (unit == null) c.setAttribute('data-hole', '');
      else {
        if (pat.lit && pat.lit !== 0.62) c.setAttribute('data-lit', String(Math.round(pat.lit * 100)));
        c.style.animationDelay = Math.round(unit * d) + 'ms';
      }
      run.appendChild(c);
    });
    var markLayer = document.createElement('span');
    markLayer.className = 'lattice-loader__layer lattice-loader__mark';
    pat.cells.forEach(function (_, i) {
      var c = document.createElement('span');
      c.className = 'lattice-loader__cell';
      if (marks.done.indexOf(i) !== -1) c.setAttribute('data-on', '');
      markLayer.appendChild(c);
    });
    gridEl.appendChild(run);
    gridEl.appendChild(markLayer);

    // labels (crossfade via data-active)
    var labelEl = document.createElement('span');
    labelEl.className = 'lattice-loader__label';
    labelEl.setAttribute('aria-hidden', 'true');
    var tWork = document.createElement('span');
    tWork.className = 'lattice-loader__text';
    tWork.setAttribute('data-active', '');
    tWork.textContent = label;
    var tDone = document.createElement('span');
    tDone.className = 'lattice-loader__text';
    tDone.textContent = doneLabel;
    var tErr = document.createElement('span');
    tErr.className = 'lattice-loader__text';
    tErr.textContent = errorLabel;
    labelEl.appendChild(tWork);
    labelEl.appendChild(tDone);
    labelEl.appendChild(tErr);

    root.appendChild(gridEl);
    root.appendChild(labelEl);

    // stopwatch
    var timerEl = null;
    if (showTimer) {
      timerEl = document.createElement('span');
      timerEl.className = 'lattice-loader__timer';
      timerEl.setAttribute('aria-hidden', 'true');
      timerEl.textContent = '0.0s';
      root.appendChild(timerEl);
    }

    // screen-reader live line
    var sr = document.createElement('span');
    sr.className = 'lattice-loader__sr';
    sr.textContent = label + ', in progress';
    sr.setAttribute('role', 'status');
    root.appendChild(sr);

    // stopwatch loop (auto-cleans once detached)
    var startedAt = performance.now();
    var ds = 0;
    var paint = function (v) {
      ds = v;
      if (timerEl) timerEl.textContent = fmt(v);
    };
    paint(0);
    var id = setInterval(function () {
      if (!root.isConnected) { clearInterval(id); return; }
      if (dataStatus !== 'working') return;               // frozen
      paint(Math.floor((performance.now() - startedAt) / 100));
    }, 100);

    var dataStatus = 'working';

    function setAnnounce() {
      if (dataStatus === 'working') {
        sr.textContent = label + ', in progress';
      } else {
        sr.textContent = (dataStatus === 'done' ? doneLabel : errorLabel) + (showTimer ? ' ' + spoken(ds) : '');
      }
    }

    var api = {
      el: root,
      setStatus: function (s) {
        if (s !== 'done' && s !== 'error' && s !== 'working') return;
        dataStatus = s;
        root.setAttribute('data-status', s);
        if (s === 'done') root.style.setProperty('--ll-mark', doneColor);
        if (s === 'error') root.style.setProperty('--ll-mark', errorColor);
        tWork.removeAttribute('data-active');
        tDone.setAttribute('data-active', s === 'done' ? '' : 'off');
        tErr.setAttribute('data-active', s === 'error' ? '' : 'off');
        if (s === 'done') tErr.removeAttribute('data-active');
        if (s === 'error') tDone.removeAttribute('data-active');
        if (s === 'working') {
          tWork.setAttribute('data-active', '');
          tDone.removeAttribute('data-active');
          tErr.removeAttribute('data-active');
        }
        setAnnounce();
      },
      setLabel: function (t) {
        label = String(t == null ? '' : t);
        tWork.textContent = label;
        if (dataStatus === 'working') sr.textContent = label + ', in progress';
      },
      stop: function () {
        if (dataStatus === 'working') {
          paint(Math.floor((performance.now() - startedAt) / 100));
        }
        return ds * 100; // elapsed ms
      },
      reset: function () {
        startedAt = performance.now();
        paint(0);
        api.setStatus('working');
      }
    };
    return api;
  }

  window.LatticeLoader = { create: create };
})();
