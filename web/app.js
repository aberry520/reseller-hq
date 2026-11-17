// Reseller HQ — web label printer (no framework, no build step).
// Inventory comes from items.json (generated from ../seed-purchase.csv).
// QR payload is exactly `reseller://item/RB-xxx`, same as the phone app
// (src/lib/types.ts qrFor). ZPL matches src/lib/zpl.ts zplForItems.

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
  function zplEscape(s) {
    return String(s).replace(/[\^~]/g, '').trim();
  }
  function zplForItem(item) {
    var name = zplEscape(cleanName(item.name)).slice(0, 34);
    var lines = [
      '^XA',
      '^PW406',
      '^LL203',
      '^FO10,10^BQN,2,4',
      '^FDQA,' + zplEscape(item.qr) + '^FS',
      '^FO130,20^A0N,22,22^FD' + name.slice(0, 22) + '^FS',
    ];
    if (name.length > 22) lines.push('^FO130,48^A0N,22,22^FD' + name.slice(22) + '^FS');
    lines.push('^FO130,110^A0N,28,28^FD' + zplEscape(item.id) + '^FS');
    lines.push('^FO130,150^A0N,18,18^FDScan to open in Reseller HQ^FS');
    lines.push('^PQ1');
    lines.push('^XZ');
    return lines.join('\n');
  }
  function zplForItems(list) {
    return list.map(zplForItem).join('\n');
  }

  // ---- Label HTML (preview + print sheet share the same markup) ----
  function labelHtml(item) {
    var name = cleanName(item.name);
    return '<div class="label">' +
      '<div class="qr">' + qrSvg(item.qr) + '</div>' +
      '<div class="label-text">' +
        '<div class="label-name">' + esc(name) + '</div>' +
        '<div class="label-id">' + esc(item.id) + '</div>' +
        '<div class="label-tag">Scan to open in Reseller HQ</div>' +
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
  fetch('items.json')
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
