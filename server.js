/* ============ LarpMusic (ЛарпМузыка) — локальный сервер + CORS-прокси ============
 * Node 18+, без зависимостей:  node server.js
 * Раздаёт Mini App и проксирует запросы к VK / Яндекс / iTunes / Spotify.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m3u8': 'application/vnd.apple.mpegurl'
};

/* Разрешённые хосты для прокси (белый список — защита от open-proxy) */
const ALLOW = [
  '.vk.com', '.yandex.ru', '.yandex.net', '.yandex.com', '.yandex.ru',
  'itunes.apple.com', 'audio-ssl.spotify.com', 'audio-ssl.itunes.apple.com',
  'api.spotify.com', 'accounts.spotify.com', 'login.yandex.ru',
  'i.scdn.co', 'moscow.s3', 'api.audius.co', 'archive.org'
];
const ALLOW_EXT = /\.(vk\.com|yandex\.(ru|net|com)|itunes\.apple\.com|scdn\.co|audius\.co|archive\.org)$/i;

function allowed (host) {
  host = String(host || '').toLowerCase();
  if (!host) return false;
  if (host === 'itunes.apple.com' || host === 'api.spotify.com' ||
      host === 'accounts.spotify.com' || host === 'login.yandex.ru' ||
      host === 'api.audius.co' || host === 'archive.org') return true;
  return ALLOW_EXT.test(host);
}

async function handleProxy (req, res, target) {
  let parsed;
  try { parsed = new URL(target); } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('bad url');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    res.writeHead(400); return res.end('only http(s)');
  }
  if (!allowed(parsed.hostname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('host not allowed: ' + parsed.hostname);
  }

  const headers = {};
  for (const h of ['authorization', 'content-type', 'accept', 'x-yandex-music-client', 'x-retpath-y', 'user-agent']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  delete headers['host'];

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const r = await fetch(parsed.href, {
      method: req.method === 'HEAD' ? 'GET' : req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
    });
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('proxy error: ' + e.message);
  }
}

function serveStatic (req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }

  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-fallback
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('404'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const noCache = ['.html', '.js', '.css'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=300'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }
  if (u.pathname === '/proxy') {
    const target = u.searchParams.get('url');
    if (!target) { res.writeHead(400); return res.end('missing url'); }
    return handleProxy(req, res, target);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('LarpMusic (ЛарпМузыка) запущен:');
  console.log('  локально     http://localhost:' + PORT);
  console.log('  прокси       http://localhost:' + PORT + '/proxy?url=<encoded>');
  console.log('Для Telegram нужен HTTPS-адрес (ngrok / cloudflared / хостинг).');
});
