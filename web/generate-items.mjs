// Generate web/items.json from ../seed-purchase.csv (the source of truth).
// Usage: node generate-items.mjs
// Re-run whenever the sheet / seed CSV changes, then restart the server.
// Expected counts: 192 items, 61 Sold, 57 Listed, 30 Draft, 29 blank,
// 11 Trash, 2 Return, 2 Trash Return. To List = Draft + blank = 59.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

// Minimal CSV parser that handles quoted fields with embedded newlines/commas.
// Same approach as ../scripts/generate-seed.mjs.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function money(s) {
  const v = parseFloat(String(s ?? '').replace(/[$,%]/g, '').trim());
  return Number.isFinite(v) ? v : 0;
}

const text = readFileSync(join(dir, '..', 'seed-purchase.csv'), 'utf-8');
const rows = parseCsv(text);
const header = rows[0];
const idx = (name) => header.indexOf(name);

const items = rows
  .slice(1)
  .filter((r) => r.some((c) => String(c).trim() !== ''))
  .map((r, i) => {
    const id = `RB-${String(i + 1).padStart(3, '0')}`;
    return {
      id,
      name: (r[idx('Item')] ?? '').trim(),
      status: (r[idx('Status')] ?? '').trim(),
      purchase: money(r[idx('Purchase')]),
      place: (r[idx('Place of Purchase')] ?? '').trim(),
      // Same QR payload as the phone app: src/lib/types.ts qrFor(id).
      qr: `reseller://item/${id}`,
    };
  });

const counts = {};
for (const it of items) counts[it.status || '(blank)'] = (counts[it.status || '(blank)'] ?? 0) + 1;
const toList = items.filter((it) => it.status === 'Draft' || it.status === '').length;
console.log('items:', items.length, counts, 'To List:', toList);

writeFileSync(join(dir, 'items.json'), JSON.stringify(items, null, 2) + '\n');
console.log('wrote web/items.json');
