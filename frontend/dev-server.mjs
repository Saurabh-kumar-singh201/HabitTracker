import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = normalize(join(__filename, '..'));
const host = '127.0.0.1';
const preferredPort = Number(process.env.PORT || 5173);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function resolvePath(urlPath) {
  const cleaned = (urlPath || '/').split('?')[0].split('#')[0];
  const requested = cleaned === '/' ? '/index.html' : cleaned;
  const safePath = normalize(join(rootDir, requested));

  if (!safePath.startsWith(rootDir)) return null;
  if (!existsSync(safePath)) return normalize(join(rootDir, 'index.html'));
  return safePath;
}

const server = createServer(async (req, res) => {
  const filePath = resolvePath(req.url || '/');

  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    if (extname(filePath) === '.html') {
      const html = await readFile(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error.message}`);
  }
});

function startServer(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT) {
      startServer(port + 1);
      return;
    }

    console.error(`Failed to start frontend dev server: ${error.message}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Frontend dev server running at http://${host}:${port}`);
  });
}

startServer(preferredPort);
