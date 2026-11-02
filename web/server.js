import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 8080);
const apiUrl = process.env.API_URL || 'http://localhost:8000';
const issuer = process.env.OIDC_ISSUER || '';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

// Only the own API, the login realm and the platform font host may be contacted
const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    `connect-src 'self' ${apiUrl} ${issuer ? new URL(issuer).origin : ''}`,
    `frame-src ${issuer ? new URL(issuer).origin : "'none'"}`,
    "style-src 'self' 'unsafe-inline' https://cdn.itdone.cloud",
    "font-src 'self' https://cdn.itdone.cloud",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};

function send(res, status, body, type) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': type });
  res.end(body);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/config.json') {
    return send(res, 200, JSON.stringify({ apiUrl, oidcIssuer: issuer, oidcClientId: process.env.OIDC_CLIENT_ID || '' }), types['.json']);
  }
  if (path === '/health') return send(res, 200, 'ok', 'text/plain');
  const file = normalize(join(root, path));
  const target = file.startsWith(root) && existsSync(file) && statSync(file).isFile() ? file : join(root, 'index.html');
  const immutable = target.includes(`${join(root, 'assets')}`);
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': types[extname(target)] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(target).pipe(res);
}).listen(port, () => console.log(`web listening on ${port}`));
