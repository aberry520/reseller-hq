// Verify the dashboard checks without an Expo runtime:
//   1. Compile src/lib/dashboard.ts + src/lib/dashboard.test.ts to /tmp with tsc.
//   2. Run the test file with node.
// Usage: npm run test:dashboard
// Requires: npx tsc (typescript is a devDependency).

import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'dashboard-verify-'));
execSync(
  `npx tsc --ignoreConfig src/lib/dashboard.ts src/lib/dashboard.test.ts --outDir "${out}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
  { stdio: 'inherit' },
);
execSync(`node "${join(out, 'dashboard.test.js')}"`, { stdio: 'inherit' });
console.log('Dashboard checks done.');
