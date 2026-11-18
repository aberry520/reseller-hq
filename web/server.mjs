// Zero-dependency local server for the Reseller HQ web label printer.
// Usage (on Austin's Windows PC, Node v26 already installed):
//   cd web
//   node server.mjs
// Then open http://localhost:8080 in Chrome or Edge.
// Listens on all interfaces, so the phone can also open it over the same
// Wi-Fi at http://<pc-ip>:8080 if needed. Serves only files inside web/.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(normalize(join(fileURLToPath(import.meta.url), '..')));
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    // Block directory traversal: resolved path must stay inside web/.
    const file = resolve(join(ROOT, normalize(path)));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const body = await readFile(file);
    // Never cache: the inventory (items.json) and the app code change
    // under the user, and a cached copy shows stale RB labels after an
    // ID rename even though the file on disk is already RHQ.
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reseller HQ label printer running — open http://localhost:8080`);
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) {
        console.log(`Also reachable on this Wi-Fi at http://${i.address}:${PORT}`);
      }
    }
  }
  console.log('Press Ctrl+C to stop.');
});
