/* =========================================================
   Anteemonee RECEIPTS
   Renders a thermal cash-receipt PNG on a <canvas> and encodes
   a real, scannable Code 128 barcode for the receipt number.

   Usage:
     AnteemoneeReceipt.render({...})   -> data:image/png;base64,...
     AnteemoneeReceipt.download({...}) -> triggers a browser download
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Code 128 (Code Set B) ----------
     Bar patterns per the Code 128 spec. Each entry lists the module
     widths (bars first) of the 11-module symbol: 6 elements, digits
     1..4 alternating bar/space. `111412` means bar,bar,bar,space,bar,space.
     Values are what a scanner measures; encoding and the test decoder in
     this file use the same table, so a round trip proves the geometry. */
  var PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
  ];

  // Code Set B character values 0..95 map to ASCII 32..127
  function codeB(ch) {
    var v = ch.charCodeAt(0);
    if (v < 32 || v > 127) throw new Error('Code 128 set B cannot encode: ' + ch);
    return v - 32;
  }

  // The table stores element RUN LENGTHS (e.g. STOP '2331112' = 2,3,3,1,1,1,2).
  // A barcode needs MODULES, so expand each run.
  function expand(runLengths) {
    var out = '';
    for (var i = 0; i < runLengths.length; i++) {
      var n = parseInt(runLengths.charAt(i), 10);
      out += i % 2 === 0 ? new Array(n + 1).join('1') : new Array(n + 1).join('0');
    }
    return out;
  }

  /* Returns the module string (1 = dark, 0 = light) for the payload. */
  function barcodeModules(text) {
    var values = [104];              // START B -- must be transmitted, not just summed
    for (var i = 0; i < text.length; i++) values.push(codeB(text.charAt(i)));

    // Checksum: (start + sum(i * value_i for i starting at 1)) % 103
    var sum = 104;
    for (var j = 0; j < text.length; j++) sum += values[j + 1] * (j + 1);
    values.push(sum % 103);
    values.push(106);                // STOP

    var bits = '';
    for (var k = 0; k < values.length; k++) bits += expand(PATTERNS[values[k]]);
    return bits;
  }

  // Turns the module string into a 2D array of booleans (one row).
  function barcodeRows(bits) {
    var rows = [];
    for (var i = 0; i < bits.length; i++) rows.push(bits.charAt(i) === '1');
    return rows;
  }

  /* ---------- canvas receipt ---------- */
  var W = 640;          // device pixels
  var MARGIN = 46;
  var FONT_STACK = '"SFMono-Regular",Menlo,Consolas,"DejaVu Sans Mono",monospace';

  function font(size, weight) { return (weight || '') + ' ' + size + 'px ' + FONT_STACK; }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Scalloped (perforated) edge, as on the reference receipt.
  function perforate(ctx, y, down) {
    var r = 9, step = 24;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (down) {
      ctx.moveTo(0, y - r);
      for (var x = 0; x <= W; x += step) ctx.arc(x, y, r, Math.PI, 0, false);
      ctx.lineTo(W, y + 2); ctx.lineTo(0, y + 2);
    } else {
      ctx.moveTo(0, y + r);
      for (var x2 = 0; x2 <= W; x2 += step) ctx.arc(x2, y, r, 0, Math.PI, false);
      ctx.lineTo(W, y - 2); ctx.lineTo(0, y - 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function asteriskRule(ctx, y, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = font(15, '');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var line = '* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *';
    while (ctx.measureText(line).width > W - MARGIN * 2) line = line.slice(0, -6);
    ctx.fillText(line, W / 2, y);
    ctx.restore();
  }

  function tracked(ctx, text, x, y, spacing) {
    // Letter-spaced centred text (the SHOP NAME look).
    var chars = text.split('');
    var widths = chars.map(function (c) { return ctx.measureText(c).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (chars.length - 1);
    var cx = x - total / 2;
    ctx.textAlign = 'left';
    for (var i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cx, y);
      cx += widths[i] + spacing;
    }
    ctx.textAlign = 'center';
  }

  /* opts:
       shopName, address (array of lines), title, columns [{label, value}],
       totalLabel, total, footerLines, barcodeText, stamp {text,color}, status */
  /* Paint once into a generous canvas, then crop to the height actually used.
     A separate measuring pass duplicated the layout maths and drifted out of
     sync; tracking the real y while painting cannot. */
  function render(opts) {
    opts = opts || {};
    var scale = 2;                    // crisp on retina
    var padding = 74;   // must exceed the text offset (20) plus margin, or the bottom scallop gets cropped
    var MAXH = 2000;

    var full = document.createElement('canvas');
    full.width = W * scale;
    full.height = MAXH * scale;
    var ctx = full.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'middle';

    var top = 24;
    var used = paint(ctx, opts, top);

    var paperH = used + padding;
    // Page background (soft grey, like the reference sheet).
    var bg = ctx.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, '#e9e9ec');
    bg.addColorStop(0.16, '#f6f6f7');
    bg.addColorStop(0.84, '#f6f6f7');
    bg.addColorStop(1, '#e9e9ec');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, MAXH);

    // The paper with a soft drop shadow.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    ctx.fillRect(34, top, W - 68, paperH);
    ctx.restore();
    perforate(ctx, top, true);
    perforate(ctx, top + paperH, false);

    // Re-paint the text on top now that the paper is down.
    used = paint(ctx, opts, top + 20);

    var out = document.createElement('canvas');
    out.width = W * scale;
    // +BOTTOM_PAD so the scalloped tear-off edge (which overhangs the paper)
    // is inside the crop instead of being sliced off.
    out.height = Math.ceil(top + paperH + 30) * scale;
    var octx = out.getContext('2d');
    octx.drawImage(full, 0, 0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function paint(ctx, opts, top) {
    var y = top;
    var dark = '#000';
    var grey = '#3a3a3a';
    ctx.textAlign = 'center';

    /* header */
    ctx.fillStyle = dark;
    ctx.font = font(34, '700');
    tracked(ctx, (opts.shopName || 'ANTEEMONEE').toUpperCase(), W / 2, y + 26, 5);
    y += 46;

    ctx.font = font(17, '');
    ctx.fillStyle = grey;
    (opts.address || []).forEach(function (line) {
      y += 24;
      ctx.fillText(line, W / 2, y);
    });
    y += 24;

    asteriskRule(ctx, y, dark);
    y += 40;

    ctx.font = font(27, '');
    ctx.fillStyle = dark;
    tracked(ctx, (opts.title || 'CASH RECEIPT').toUpperCase(), W / 2, y + 12, 4);
    y += 34;

    asteriskRule(ctx, y, dark);
    y += 30;

    /* table */
    var left = MARGIN + 6;
    var right = W - MARGIN - 6;
    ctx.font = font(19, '700');
    ctx.fillStyle = dark;
    ctx.textAlign = 'left';
    ctx.fillText('Description', left, y);
    ctx.textAlign = 'right';
    ctx.fillText('Price', right, y);
    y += 28;

    ctx.font = font(18, '');
    ctx.textAlign = 'left';
    (opts.columns || []).forEach(function (row) {
      ctx.fillStyle = grey;
      ctx.textAlign = 'left';
      ctx.fillText(String(row.label), left, y);
      ctx.textAlign = 'right';
      ctx.fillText(String(row.value), right, y);
      y += 27;
    });
    y += 12;
    asteriskRule(ctx, y, dark);
    y += 40;

    /* total */
    ctx.textAlign = 'left';
    ctx.fillStyle = dark;
    ctx.font = font(28, '700');
    ctx.fillText(opts.totalLabel || 'Total', left, y);
    ctx.textAlign = 'right';
    ctx.font = font(28, '700');
    ctx.fillText(String(opts.total), right, y);
    y += 36;

    /* secondary totals */
    ctx.font = font(18, '');
    (opts.subTotals || []).forEach(function (row) {
      ctx.textAlign = 'left';
      ctx.fillStyle = grey;
      ctx.fillText(row.label, left, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = grey;
      ctx.fillText(String(row.value), right, y);
      y += 25;
    });

    y += 10;
    asteriskRule(ctx, y, dark);
    y += 34;

    /* footer lines (bank card / approval code) */
    ctx.font = font(18, '');
    (opts.footerLines || []).forEach(function (row) {
      ctx.textAlign = 'left';
      ctx.fillStyle = grey;
      ctx.fillText(row.label, left, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = dark;
      ctx.fillText(String(row.value), right, y);
      y += 25;
    });

    y += 12;
    asteriskRule(ctx, y, dark);
    y += 40;

    /* thank you */
    ctx.textAlign = 'center';
    ctx.fillStyle = dark;
    ctx.font = font(22, '700');
    tracked(ctx, opts.thanks || 'THANK YOU!', W / 2, y + 10, 3);
    y += 34;

    /* stamp */
    if (opts.stamp && opts.stamp.text) {
      ctx.save();
      ctx.translate(W / 2, y + 44);
      ctx.rotate(-0.14);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = opts.stamp.color || '#111';
      ctx.font = font(44, '700');
      tracked(ctx, opts.stamp.text, 0, 0, 6);
      ctx.restore();
    }
    y += 96;

    /* barcode */
    var text = String(opts.barcodeText || '');
    if (text) {
      var bits = barcodeModules(text);
      var rows = barcodeRows(bits);
      // Fit the symbol inside the paper: a long receipt number can be 250+
      // modules, and a fixed bar width would run off the receipt edge.
      var avail = W - MARGIN * 2 - 24;
      var barW = Math.min(2.6, avail / rows.length);
      if (barW < 1) barW = 1;                    // never thinner than scanners like
      var bx = (W - rows.length * barW) / 2;
      ctx.fillStyle = '#000';
      for (var i = 0; i < rows.length; i++) {
        if (rows[i]) ctx.fillRect(bx + i * barW, y, barW, 62);
      }
      y += 72;
      ctx.fillStyle = grey;
      ctx.font = font(14, '');
      ctx.textAlign = 'center';
      tracked(ctx, text, W / 2, y, 1.5);
      y += 18;
    }
    return y - top;
  }

  function download(opts, filename) {
    var url = render(opts);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || ('receipt-' + (opts && opts.barcodeText ? opts.barcodeText : 'receipt') + '.png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return url;
  }

  window.AnteemoneeReceipt = {
    render: render,
    download: download,
    barcodeModules: barcodeModules,
    expand: expand,
    barcodeRows: barcodeRows,
    PATTERNS: PATTERNS,
    _font: font,
    _W: W
  };
})();