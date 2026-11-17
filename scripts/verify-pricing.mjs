// Verify the pricing examples without an Expo runtime:
//   1. Compile src/lib/pricing.ts + src/lib/pricing.test.ts to /tmp with tsc.
//   2. Run the test file with node.
// Usage: npm run test:pricing
// Requires: npx tsc (typescript is a devDependency).

import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'pricing-verify-'));
execSync(
  `npx tsc --ignoreConfig src/lib/pricing.ts src/lib/pricing.test.ts --outDir "${out}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
  { stdio: 'inherit' },
);
execSync(`node "${join(out, 'pricing.test.js')}"`, { stdio: 'inherit' });
console.log('Pricing checks done.');
