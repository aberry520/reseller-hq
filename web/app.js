// Reseller HQ — web label printer (no framework, no build step).
// Inventory comes from items.json (generated from ../src/lib/seed-data.ts).
// QR payload is exactly `reseller://item/<id>`, same as the phone app
// (src/lib/types.ts qrFor). ZPL matches src/lib/zpl.ts zplForItems.
// The QR is derived from the item's ID at render time, never from a
// stored qr field, so it can't go stale when an ID changes (the RB →
// RHQ rename left the old items.json with RB-xxx IDs and QR codes).

(function () {
  'use strict';

  var FILTERS = ['All', 'To List', 'Draft', 'Listed', 'Sold', 'Trash'];

  var items = [];
  var selected = new Set();
  var filter = 'To List';
  var query = '';

  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list');
  var chipsEl = $('chips');
  var previewEl = $('preview');
  var sheetEl = $('label-sheet');

  // ---- QR: local vendored qrcode-generator (qrcode.min.js), CDN fallback ----
  function ensureQrLib() {
    if (typeof qrcode === 'function') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('QR library failed to load')); };
      document.head.appendChild(s);
    });
  }

  function qrSvg(payload) {
    // qrcode-generator: type 0 = auto version, 'M' error correction.
    var qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0 });
  }

  // ---- Matching the phone app ----
  function cleanName(raw) {
    return String(raw || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  }
  // Short, human-readable label name — same logic as src/lib/zpl.ts shortName.
  // The sheet's Item field often carries a MAC.BID suffix (" | Location:
  // Anderson - LRetail: $149.00 Invoice: ... | $52.43 Unpaid") that is
  // unreadable on a 2"x1" label and puts prices on it. Keep only the product
  // name, strip any price/invoice text, max 24 chars at a word boundary.
  // The QR holds the full identity; the phone shows the full name on scan.
  function shortName(raw) {
    var s = cleanName(raw);
    var loc = s.search(/\|?\s*Location:/i);
    if (loc >= 0) s = s.slice(0, loc);
    s = s
      .replace(/\$\s?[\d,]+(\.\d{2})?/g, '')
      .replace(/invoice:?\s*\d+/gi, '')
      .replace(/retail:?/gi, '')
      .replace(/\b(saved|unpaid)\b/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/[|;:,]+$/g, '')
      .trim();
    if (!s) return 'Unnamed item';
    if (s.length <= 24) return s;
    var cut = s.slice(0, 24);
    var lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim();
  }
  function splitNameLines(name) {
    if (name.length <= 18) return [name];
    var cut = name.slice(0, 18);
    var lastSpace = cut.lastIndexOf(' ');
    if (lastSpace >= 8) return [cut.slice(0, lastSpace).trim(), name.slice(lastSpace + 1, 36).trim()];
    return [cut.trim(), name.slice(18, 36).trim()];
  }
  function matchesFilter(item, f) {
    if (f === 'All') return true;
    if (f === 'To List') return item.status === 'Draft' || item.status === '';
    if (f === 'Trash') return item.status === 'Trash' || item.status === 'Trash Return';
    return item.status === f;
  }
  function displayStatus(item) {
    return item.status === '' ? 'Unlisted' : item.status;
  }
  function filteredItems() {
    var q = query.trim().toLowerCase();
    return items.filter(function (it) {
      if (!matchesFilter(it, filter)) return false;
      if (!q) return true;
      return cleanName(it.name).toLowerCase().indexOf(q) !== -1 ||
        it.id.toLowerCase() === q;
    });
  }
  function selectedItems() {
    return items.filter(function (it) { return selected.has(it.id); });
  }
  function money(n) {
    return '$' + Number(n || 0).toFixed(2);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- ZPL: byte-for-byte the same layout as src/lib/zpl.ts ----
  // The QR payload is derived from the ID (same as qrFor in the phone
  // app), so a renamed ID can never leave a stale QR behind.
  function qrFor(item) {
    return 'reseller://item/' + item.id;
  }
  function zplEscape(s) {
    return String(s).replace(/[\^~]/g, '').trim();
  }
  function zplForItem(item) {
    var name = zplEscape(shortName(item.name));
    var nameLines = splitNameLines(name);
    var lines = [
      '^XA',
      '^PW406',
      '^LL203',
      '^FO10,10^BQN,2,4',
      '^FDQA,' + zplEscape(qrFor(item)) + '^FS',
      '^FO130,20^A0N,26,26^FD' + nameLines[0] + '^FS',
    ];
    if (nameLines[1]) lines.push('^FO130,52^A0N,26,26^FD' + nameLines[1] + '^FS');
    lines.push('^FO130,118^A0N,28,28^FD' + zplEscape(item.id) + '^FS');
    lines.push('^PQ1');
    lines.push('^XZ');
    return lines.join('\n');
  }
  function zplForItems(list) {
    return list.map(zplForItem).join('\n');
  }

  // ---- Label HTML (preview + print sheet share the same markup) ----
  // QR + short name + ID only. No prices, no "Scan to open" tagline —
  // the tagline wasted a line and clipped at the bottom of the label.
  function labelHtml(item) {
    var name = shortName(item.name);
    return '<div class="label">' +
      '<div class="qr">' + qrSvg(qrFor(item)) + '</div>' +
      '<div class="label-text">' +
        '<div class="label-name">' + esc(name) + '</div>' +
        '<div class="label-id">' + esc(item.id) + '</div>' +
      '</div></div>';
  }

  // ---- Rendering ----
  function renderChips() {
    var counts = {};
    FILTERS.forEach(function (f) {
      counts[f] = items.filter(function (it) { return matchesFilter(it, f); }).length;
    });
    chipsEl.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="chip' + (filter === f ? ' active' : '') +
        '" data-filter="' + f + '">' + f + ' (' + counts[f] + ')</button>';
    }).join('');
    chipsEl.querySelectorAll('.chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        filter = btn.getAttribute('data-filter');
        render();
      });
    });
  }

  function renderList() {
    var list = filteredItems();
    $('list-meta').textContent =
      list.length + ' shown \u00b7 ' + selected.size + ' selected \u00b7 ' + items.length + ' total';
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">No items match this search / filter.</p>';
      return;
    }
    listEl.innerHTML = list.map(function (it) {
      var st = displayStatus(it);
      return '<div class="row" data-id="' + it.id + '" role="checkbox" aria-checked="' +
        selected.has(it.id) + '" tabindex="0">' +
        '<input type="checkbox" tabindex="-1"' + (selected.has(it.id) ? ' checked' : '') + '>' +
        '<div class="row-main"><div class="row-name">' + esc(cleanName(it.name)) + '</div>' +
        '<div class="row-meta">' + esc(it.id) + ' \u00b7 bought ' + money(it.purchase) +
        (it.place ? ' \u00b7 ' + esc(it.place) : '') + '</div></div>' +
        '<span class="badge ' + st + '">' + esc(st) + '</span></div>';
    }).join('');
    listEl.querySelectorAll('.row').forEach(function (row) {
      var toggle = function () {
        var id = row.getAttribute('data-id');
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        render();
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      });
    });
  }

  function renderPreview() {
    var list = selectedItems();
    $('selected-pill').textContent = selected.size + ' selected';
    $('preview-meta').textContent = list.length
      ? list.length + ' label' + (list.length === 1 ? '' : 's') + ' ready to print.'
      : 'Nothing selected yet. Pick items above, or use a bulk button.';
    previewEl.innerHTML = list.map(labelHtml).join('');
    $('btn-print').disabled = list.length === 0;
    $('btn-zpl').disabled = list.length === 0;
  }

  function render() {
    renderChips();
    renderList();
    renderPreview();
  }

  // ---- Bulk actions ----
  $('btn-select-filtered').addEventListener('click', function () {
    filteredItems().forEach(function (it) { selected.add(it.id); });
    render();
  });
  $('btn-select-all').addEventListener('click', function () {
    items.forEach(function (it) { selected.add(it.id); });
    render();
  });
  $('btn-select-tolist').addEventListener('click', function () {
    items.forEach(function (it) {
      if (it.status === 'Draft' || it.status === '') selected.add(it.id);
    });
    render();
  });
  $('btn-clear').addEventListener('click', function () {
    selected.clear();
    render();
  });

  $('btn-print').addEventListener('click', function () {
    var list = selectedItems();
    if (!list.length) { alert('Nothing selected — pick at least one item first.'); return; }
    sheetEl.innerHTML = list.map(labelHtml).join('');
    window.print();
  });

  $('btn-zpl').addEventListener('click', function () {
    var list = selectedItems();
    if (!list.length) { alert('Nothing selected — pick at least one item first.'); return; }
    var blob = new Blob([zplForItems(list)], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'labels.zpl';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  });

  $('search').addEventListener('input', function (e) {
    query = e.target.value;
    renderList();
  });

  // ---- Load ----
  // no-store: the browser must not serve a cached items.json after the
  // file is regenerated (that showed stale RB labels after the RHQ rename).
  fetch('items.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('items.json not found (HTTP ' + r.status + ')');
      return r.json();
    })
    .then(function (data) {
      items = data;
      // Default selection: the To List pile, so the bulk flow is one click.
      items.forEach(function (it) {
        if (it.status === 'Draft' || it.status === '') selected.add(it.id);
      });
      return ensureQrLib();
    })
    .then(render)
    .catch(function (err) {
      listEl.innerHTML = '<p class="empty">Could not load items: ' + esc(err.message) +
        '. Make sure items.json sits next to index.html and the server is running.</p>';
    });
})();
