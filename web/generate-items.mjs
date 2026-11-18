// Generate web/items.json from ../src/lib/seed-data.ts (the source of
// truth — the same 253 RHQ-xxx items the phone app seeds from).
// Usage: node generate-items.mjs
// Re-run whenever the sheet / seed data changes, then restart the server.
// The QR is derived from the ID (reseller://item/<id>), never stored
// separately, so it can't go stale when an ID changes — the RB → RHQ
// rename left the old items.json with RB-xxx IDs and RB-xxx QR codes.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

// seed-data.ts is TypeScript, but the SEED_ITEMS array itself is plain
// JSON (quoted keys, no TS syntax inside). Extract and parse it. The
// first '[' in the file is the SeedItem[] type annotation, so find the
// '[' after the '=' that starts the array literal.
const seedSrc = readFileSync(join(dir, '..', 'src', 'lib', 'seed-data.ts'), 'utf-8');
const eq = seedSrc.indexOf('=', seedSrc.indexOf('SEED_ITEMS'));
const start = seedSrc.indexOf('[', eq);
const end = seedSrc.lastIndexOf('];');
if (start < 0 || end < 0 || eq < 0) {
  console.error('could not find SEED_ITEMS array in src/lib/seed-data.ts');
  process.exit(1);
}
const seedItems = JSON.parse(
  // TypeScript allows a trailing comma after the last element; JSON
  // does not, so strip it before parsing.
  seedSrc.slice(start, end + 1).replace(/,\s*]$/, ']'),
);

const items = seedItems.map((s) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  purchase: s.purchase,
  place: s.place,
  // Same QR payload as the phone app: src/lib/types.ts qrFor(id).
  // Derived from the ID so it always matches.
  qr: `reseller://item/${s.id}`,
}));

const counts = {};
for (const it of items) counts[it.status || '(blank)'] = (counts[it.status || '(blank)'] ?? 0) + 1;
const toList = items.filter((it) => it.status === 'Draft' || it.status === '').length;
console.log('items:', items.length, counts, 'To List:', toList);

writeFileSync(join(dir, 'items.json'), JSON.stringify(items, null, 2) + '\n');
console.log('wrote web/items.json');
