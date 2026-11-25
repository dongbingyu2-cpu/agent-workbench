import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Serve the built SPA for the desktop shell. Only active when a dist directory is
 * supplied (Electron sets AW_DIST_DIR); the dev server keeps using Vite instead.
 */
export function registerStatic(app: FastifyInstance, distDir: string): void {
  const root = path.resolve(distDir);
  if (!fs.existsSync(path.join(root, 'index.html'))) return;

  app.get('/*', async (req, reply) => {
    const url = (req.raw.url || '/').split('?')[0];
    if (url.startsWith('/api/') || url === '/ws') return reply.code(404).send({ error: 'not found' });

    const decoded = decodeURIComponent(url);
    let file = path.resolve(root, `.${decoded}`);
    if (file !== root && !file.startsWith(root + path.sep)) return reply.code(403).send({ error: 'forbidden' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');

    reply.type(CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(fs.readFileSync(file));
  });
}
