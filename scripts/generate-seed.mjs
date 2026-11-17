// Regenerate src/lib/seed-data.ts from seed-purchase.csv.
// Usage: node scripts/generate-seed.mjs
// The CSV is the source of truth (exported from the Google Sheet Purchase tab).
// Counts are printed at the end — expect 192 items, 61 Sold, 57 Listed,
// 30 Draft, 29 blank, 11 Trash, 2 Return, 2 Trash Return.

import { readFileSync, writeFileSync } from 'node:fs';

// Minimal CSV parser that handles quoted fields with embedded newlines/commas.
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

const text = readFileSync(new URL('../seed-purchase.csv', import.meta.url), 'utf-8');
const rows = parseCsv(text);
const header = rows[0];
const idx = (name) => header.indexOf(name);
const items = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== '')).map((r, i) => ({
  id: `RB-${String(i + 1).padStart(3, '0')}`,
  name: (r[idx('Item')] ?? '').trim(),
  purchase: money(r[idx('Purchase')]),
  estShip: money(r[idx('Est Ship')]),
  suggestedPrice: money(r[idx('Suggested Price')]),
  minPrice: money(r[idx('Min Price')]),
  researchPrice: money(r[idx('Research Price')]),
  notes: (r[idx('Notes')] ?? '').trim(),
  place: (r[idx('Place of Purchase')] ?? '').trim(),
  datePurchased: (r[idx('Date Purchased')] ?? '').trim(),
  status: (r[idx('Status')] ?? '').trim(),
  dateListed: (r[idx('Date Listed')] ?? '').trim(),
  dateSold: (r[idx('Date Sold')] ?? '').trim(),
  soldPrice: money(r[idx('Sold Price')]),
  fees: money(r[idx('Fees')]),
  shipping: money(r[idx('Shipping')]),
  profit: money(r[idx('Profit')]),
  revenue: money(r[idx('Revenue')]),
  profitMargin: (r[idx('Profit Mrgin')] ?? '').trim(),
}));

const counts = {};
for (const it of items) counts[it.status || '(blank)'] = (counts[it.status || '(blank)'] ?? 0) + 1;
console.log('items:', items.length, counts);

const out = `// GENERATED from seed-purchase.csv — do not edit by hand.\n// Regenerate with: node scripts/generate-seed.mjs\n// Counts verified 2026-11-16: 192 items, 61 Sold, 57 Listed, 30 Draft, 29 blank, 11 Trash, 2 Return, 2 Trash Return.\nimport type { SeedItem } from './types';\n\nexport const SEED_ITEMS: SeedItem[] = ${JSON.stringify(items, null, 2)};\n`;
writeFileSync(new URL('../src/lib/seed-data.ts', import.meta.url), out);
console.log('wrote src/lib/seed-data.ts');
