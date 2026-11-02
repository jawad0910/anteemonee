/**
 * GlideSelect — vanilla port of the React Bits "GlideSelect"
 * (https://reactbits.dev) for Anteemonee AI Tutor. No React/deps.
 *
 *   var sel = GlideSelect.create({
 *     options: [{ value: 'Physics', labelHtml: '<i class="dot"></i>Physics', tag: '9702' }, ...],
 *     defaultValue: 'Physics', showTags: true, size: 'md', radius: 12,
 *     placement: 'top', ariaLabel: 'Subject',
 *     onChange: function (value, option) { ... },   // true pick
 *   });
 *   sel.el        // root node
 *   sel.setValue('Physics')   // outside changes never animate
 *   sel.getValue() / sel.destroy()
 */
(function () {
  'use strict';

  var SIZES = {
    sm: { chip: 28, row: 26, font: 12 },
    md: { chip: 32, row: 30, font: 13 },
    lg: { chip: 44, row: 40, font: 14 }
  };
  var PAD = 4;
  var GAP = 1;
  var MENU_GAP = 6;
  var uidCounter = 0;

  function textOf(item) {
    if (typeof item.label === 'string') return item.label;
    return item.value;
  }
  function rowLabelHtml(item) {
    if (typeof item.labelHtml === 'string') return item.labelHtml;
    if (typeof item.label === 'string') return esc(item.label);
    return esc(item.value);
  }
  function typeaheadIndex(items, from, ch) {
    var c = String(ch).toLowerCase();
    var n = items.length;
    for (var k = 1; k <= n; k++) {
      var i = (from + k) % n;
      if (textOf(items[i]).toLowerCase().indexOf(c) === 0) return i;
    }
    return from;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function create(opts) {
    opts = opts || {};
    var id = 'gs-' + (++uidCounter);
    var options = (opts.options || ['One', 'Two', 'Three']).map(function (o) {
      if (typeof o === 'string') return { value: o, label: o, labelHtml: esc(o) };
      return o;
    });
    var current = opts.defaultValue != null ? opts.defaultValue : '';
    var selected = options.findIndex(function (it) { return it.value === current; });
    var phase = 'closed';
    var active = null;
    var side = opts.placement || 'bottom';
    var align = opts.align || 'left';
    var size = SIZES[opts.size] || SIZES.md;
    var radius = opts.radius != null ? opts.radius : 10;
    var menuWidth = opts.menuWidth != null ? opts.menuWidth : 176;
    var popDuration = opts.popDuration != null ? opts.popDuration : 180;
    var glideDuration = opts.glideDuration != null ? opts.glideDuration : 220;
    var popOut = Math.round((popDuration * 2) / 3);
    var step = size.row + GAP;
    var instant = false;
    var closeTimer = null;
    var scrub = null;

    var root = document.createElement('div');
    root.className = 'glide-select' + (opts.className ? ' ' + opts.className : '');
    root.setAttribute('data-size', opts.size || 'md');
    root.id = id;
    var S = size;
    root.style.setProperty('--gs-accent', opts.accentColor || 'var(--accent-hi, #f5f5f5)');
    root.style.setProperty('--gs-surface', opts.surfaceColor || 'var(--bg-elevated, #27272a)');
    root.style.setProperty('--gs-highlight', opts.highlightColor || 'var(--liquid-bg, #3f3f46)');
    root.style.setProperty('--gs-text', opts.textColor || 'var(--text, #f5f5f5)');
    root.style.setProperty('--gs-radius', radius + 'px');
    root.style.setProperty('--gs-inner-radius', Math.max(3, radius - 4) + 'px');
    root.style.setProperty('--gs-chip', (opts.chipHeight != null ? opts.chipHeight : S.chip) + 'px');
    root.style.setProperty('--gs-row', S.row + 'px');
    root.style.setProperty('--gs-font', S.font + 'px');
    root.style.setProperty('--gs-menu-w', menuWidth + 'px');
    root.style.setProperty('--gs-pop', popDuration + 'ms');
    root.style.setProperty('--gs-pop-out', popOut + 'ms');
    root.style.setProperty('--gs-glide', glideDuration + 'ms');
    root.style.setProperty('--gs-origin', (side === 'bottom' ? 'top' : 'bottom') + ' ' + align);

    // ── trigger ──
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', opts.ariaLabel || 'Select');
    trigger.className = 'glide-select__trigger';
    var labelEl = document.createElement('span');
    labelEl.className = 'glide-select__label';
    if (selected >= 0) labelEl.innerHTML = rowLabelHtml(options[selected]);
    else labelEl.textContent = opts.placeholder || 'Select…';
    if (selected < 0) labelEl.setAttribute('data-empty', '');
    var chev = document.createElement('span');
    chev.className = 'glide-select__chevron';
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l4 5 4-5"/><path d="M8 14l4 5 4-5"/></svg>';
    trigger.appendChild(labelEl);
    trigger.appendChild(chev);
    root.appendChild(trigger);

    // ── menu ──
    var menu = null;
    var list = null;
    var pill = null;
    var items = [];

    function layoutMenu() {
      if (!menu) return;
      var r = root.getBoundingClientRect();
      var need = menu.offsetHeight + MENU_GAP;
      side = (opts.placement === 'bottom' && r.bottom + need > window.innerHeight) ? 'top'
        : (opts.placement === 'top' && r.top - need < 0) ? 'bottom' : opts.placement;
      menu.setAttribute('data-side', side);
      root.style.setProperty('--gs-origin', (side === 'bottom' ? 'top' : 'bottom') + ' ' + align);
      menu.style.transitionDuration = instant ? '0ms' : '';
      menu.setAttribute('data-state', 'closed');
      void menu.offsetHeight;
      menu.setAttribute('data-state', 'open');
      // selected pill rest
      if (pill) {
        pill.style.transition = 'none';
        pill.style.transform = 'translateY(' + Math.max(0, selected) * step + 'px)';
        pill.style.opacity = '0';
        void pill.offsetHeight;
        pill.style.transition = '';
      }
    }

    function ensureMenu() {
      if (menu && menu.isConnected) return;
      if (!menu) {
        menu = document.createElement('div');
        menu.className = 'glide-select__menu';
        menu.setAttribute('data-align', align);
        list = document.createElement('div');
        list.className = 'glide-select__list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', opts.ariaLabel || 'Select');
        pill = document.createElement('span');
        pill.className = 'glide-select__pill';
        pill.setAttribute('aria-hidden', 'true');
        list.appendChild(pill);
        var showTags = opts.showTags !== false;
        options.forEach(function (it, i) {
          var o = document.createElement('div');
          o.className = 'glide-select__option';
          o.id = id + '-' + i;
          o.setAttribute('role', 'option');
          o.setAttribute('data-index', String(i));
          o.setAttribute('aria-selected', i === selected ? 'true' : 'false');
          var name = document.createElement('span');
          name.className = 'glide-select__name';
          name.innerHTML = rowLabelHtml(it);
          o.appendChild(name);
          if (showTags && it.tag) {
            var tag = document.createElement('span');
            tag.className = 'glide-select__tag';
            tag.textContent = it.tag;
            o.appendChild(tag);
          }
          var check = document.createElement('span');
          check.className = 'glide-select__check';
          if (i === selected) check.setAttribute('data-on', '');
          check.setAttribute('aria-hidden', 'true');
          check.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
          o.appendChild(check);
          items[i] = o;
          list.appendChild(o);
        });
        menu.appendChild(list);

        // pointer scrub (touch/mouse drag across the list)
        function rowAt(clientY) {
          var t = list.getBoundingClientRect();
          var i = Math.floor((clientY - t.top - PAD) / step);
          return i >= 0 && i < options.length ? i : null;
        }
        list.addEventListener('pointerdown', function (e) {
          if (scrub) return;
          try { list.setPointerCapture(e.pointerId); } catch (_) {}
          scrub = { id: e.pointerId };
          instant = true;
          setActive(rowAt(e.clientY));
        });
        list.addEventListener('pointermove', function (e) {
          if (!scrub || scrub.id !== e.pointerId) return;
          var i = rowAt(e.clientY);
          if (i !== active) setActive(i);
        });
        list.addEventListener('pointerup', function (e) {
          if (!scrub || scrub.id !== e.pointerId) return;
          var i = e.type === 'pointerup' ? rowAt(e.clientY) : null;
          scrub = null;
          if (i !== null) pick(i, false);
        });
        list.addEventListener('pointercancel', function (e) {
          if (!scrub || scrub.id !== e.pointerId) return;
          scrub = null;
        });
        list.addEventListener('pointerover', function (e) {
          if (e.pointerType === 'touch' || scrub) return;
          var row = e.target.closest('[data-index]');
          if (!row) return;
          var i = Number(row.getAttribute('data-index'));
          if (i !== active) setActive(i);
        });
        list.addEventListener('pointerleave', function () {
          if (scrub) return;
        });
      }
      (opts.portal || document.body).appendChild(menu);
      // The menu is portalled OUTSIDE the .glide-select root, so every
      // inherited custom property must be copied onto it by hand.
      var csn = root.style;
      for (var i = 0; i < csn.length; i++) {
        var pr = csn[i];
        if (pr.indexOf('--gs-') === 0) menu.style.setProperty(pr, csn.getPropertyValue(pr));
      }
      positionMenu();
    }

    function positionMenu() {
      if (!menu || !menu.isConnected) return;
      var r = root.getBoundingClientRect();
      menu.style.left = '';
      menu.style.right = '';
      menu.style.top = '';
      menu.style.bottom = '';
      menu.setAttribute('data-align', align);
      var mw = Math.max(menuWidth, root.offsetWidth);
      if (align === 'right') {
        menu.style.left = r.left + 'px';
      } else {
        menu.style.left = r.left + 'px';
      }
      menu.style.minWidth = Math.max(mw, r.width) + 'px';
      if (side === 'bottom') menu.style.top = r.bottom + MENU_GAP + 'px';
      else menu.style.top = (r.top - menu.offsetHeight - MENU_GAP) + 'px';
    }

    function setActive(i) {
      active = i;
      if (!pill || !menu) return;
      if (i === null || i === undefined) {
        pill.style.opacity = '0';
        return;
      }
      var jump = instant || pill.style.opacity !== '1';
      if (jump) {
        pill.style.transitionProperty = 'opacity';
        pill.style.transitionDuration = '0ms, 150ms';
      } else {
        pill.style.removeProperty('transition-property');
        pill.style.removeProperty('transition-duration');
      }
      pill.style.transform = 'translateY(' + i * step + 'px)';
      pill.style.opacity = '1';
      instant = false;
    }

    function open(viaKey) {
      if (opts.disabled) return;
      clearTimeout(closeTimer);
      phase = 'open';
      trigger.setAttribute('aria-expanded', 'true');
      ensureMenu();
      layoutMenu();
      instant = true;
      setActive(selected >= 0 ? selected : (viaKey ? 0 : null));
    }

    function close(mode) {
      setActive(null);
      clearTimeout(closeTimer);
      if (mode === 'instant' || !menu) {
        phase = 'closed';
        trigger.setAttribute('aria-expanded', 'false');
        if (menu) { try { menu.remove(); } catch (_) {} }
        return;
      }
      phase = 'closing';
      trigger.setAttribute('aria-expanded', 'false');
      menu.setAttribute('data-state', 'closed');
      closeTimer = setTimeout(function () {
        phase = 'closed';
        try { menu.remove(); } catch (_) {}
      }, popOut + 20);
    }

    function pick(i, viaKey) {
      var it = options[i];
      if (!it) { close('instant'); return; }
      var changed = it.value !== current;
      if (changed) {
        current = it.value;
        selected = i;
        // selected-row visuals
        items.forEach(function (n, k) {
          if (!n) return;
          var check = n.querySelector('.glide-select__check');
          if (check) if (k === i) check.setAttribute('data-on', ''); else check.removeAttribute('data-on');
          if (k === i) n.setAttribute('aria-selected', 'true'); else n.setAttribute('aria-selected', 'false');
        });
        labelEl.innerHTML = rowLabelHtml(it);
        trigger.dataset.swap = '';
        if (typeof opts.onChange === 'function') {
          try { opts.onChange(it.value, it); } catch (_) {}
        }
        setTimeout(function () { delete trigger.dataset.swap; }, 170);
      }
      close('instant');
      try { trigger.focus({ preventScroll: true }); } catch (_) {}
    }

    var lastPointerOpen = 0;
    trigger.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || opts.disabled) return;
      e.preventDefault();
      lastPointerOpen = Date.now();
      try { trigger.focus({ preventScroll: true }); } catch (_) {}
      if (phase === 'open') close('pop');
      else open(false);
    });
    // AT tools and programmatic clicks carry no pointer events; treat a clean
    // click (no pointerdown in the last 400ms) as a toggle too.
    trigger.addEventListener('click', function (e) {
      if (opts.disabled) return;
      if (Date.now() - lastPointerOpen < 400) return;
      lastPointerOpen = Date.now();
      if (phase === 'open') close('pop');
      else open(false);
    });

    trigger.addEventListener('keydown', function (e) {
      var k = e.key;
      var n = options.length;
      var cur = active !== null ? active : Math.max(0, selected);
      function go(i) {
        e.preventDefault();
        instant = true;
        setActive(Math.min(n - 1, Math.max(0, i)));
      }
      if (phase !== 'open') {
        if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
          e.preventDefault();
          open(true);
        }
        return;
      }
      if (k === 'ArrowDown') go(active === null ? cur : cur + 1);
      else if (k === 'ArrowUp') go(active === null ? cur : cur - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(n - 1);
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(cur, true); }
      else if (k === 'Escape' || k === 'Tab') {
        if (k === 'Escape') e.preventDefault();
        close('instant');
      } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        go(typeaheadIndex(options, cur, k));
      }
    });

    document.addEventListener('pointerdown', function onDown(e) {
      if (phase === 'open' && !root.contains(e.target)) close('pop');
    }, true);

    window.addEventListener('resize', function () { if (phase === 'open') positionMenu(); }, { passive: true });
    window.addEventListener('scroll', function () { if (phase === 'open') positionMenu(); }, { passive: true, capture: true });

    return {
      el: root,
      getValue: function () { return current; },
      setValue: function (v) {
        var i = options.findIndex(function (it) { return it.value === v; });
        if (i >= 0 && v !== current) {
          current = v; selected = i;
          items.forEach(function (n, k) {
            if (!n) return;
            var check = n.querySelector('.glide-select__check');
            if (check) { if (k === i) check.setAttribute('data-on', ''); else check.removeAttribute('data-on'); }
            if (k === i) n.setAttribute('aria-selected', 'true'); else n.setAttribute('aria-selected', 'false');
          });
          labelEl.innerHTML = rowLabelHtml(options[i]);
        }
      },
      close: function () { close('instant'); },
      destroy: function () { try { menu && menu.remove(); } catch (_) {} try { root.remove(); } catch (_) {} },
    };
  }

  window.GlideSelect = { create: create };
})();
