// Verify the sync-diff checks without an Expo runtime:
//   1. Compile src/lib/sync-diff.ts + src/lib/sync-diff.test.ts to /tmp with tsc.
//   2. Run the test file with node.
// Usage: npm run test:sync-diff
// Requires: npx tsc (typescript is a devDependency).

import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'sync-diff-verify-'));
execSync(
  `npx tsc --ignoreConfig src/lib/sync-diff.ts src/lib/sync-diff.test.ts src/lib/listing.ts src/lib/types.ts src/lib/pricing.ts src/lib/ebay-categories.ts src/lib/ebay-categories-data.ts --outDir "${out}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
  { stdio: 'inherit' },
);
execSync(`node "${join(out, 'sync-diff.test.js')}"`, { stdio: 'inherit' });
console.log('Sync-diff checks done.');
