/* ============ LarpMusic (ЛарпМузыка) — CORS-прокси для Cloudflare Workers ============ */
/* Зачем: GitHub Pages — статический хостинг, серверного /proxy там нет, а API
   VK и Яндекса блокируют запросы прямо из браузера (CORS). Этот Worker —
   замена server.js в облаке, бесплатный план хватает с запасом.

   Как задеплоить (2 минуты, без карты):
   1. cloudflare.com → Workers & Pages → Create Worker
   2. Вставь весь этот файл → Deploy
   3. Скопируй URL вида https://music-proxy.ИМЯ.workers.dev
   4. В приложении: Ещё → «API-прокси (CORS)» → вставь URL → сохранить
   5. В URL прокси приложение автоматически добавит ?url=...

   Прокси пропускает только белый список хостов — это не open-proxy.      */

const ALLOW = [
  'api.vk.com',
  'music.yandex.net', 'login.yandex.ru',
  'api.audius.co', 'discoveryprovider.audius.co',
  'discoveryprovider2.audius.co', 'discoveryprovider3.audius.co', 'discoveryprovider4.audius.co',
  'api.spotify.com', 'accounts.spotify.com',
  'archive.org'
];

function allowed (host) {
  host = String(host || '').toLowerCase();
  return ALLOW.some(h => host === h || host.endsWith('.' + h));
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

addEventListener('fetch', e => e.respondWith(handle(e.request)));

async function handle (req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const u = new URL(req.url);
  const target = u.searchParams.get('url');
  if (!target) {
    return new Response('Добавь параметр ?url=https://...', { status: 400, headers: CORS });
  }

  let t;
  try { t = new URL(target); } catch (e) {
    return new Response('Некорректный URL', { status: 400, headers: CORS });
  }
  if (t.protocol !== 'https:' || !allowed(t.hostname)) {
    return new Response('Хост вне белого списка: ' + t.hostname, { status: 403, headers: CORS });
  }

  const init = { method: req.method === 'POST' ? 'POST' : 'GET', redirect: 'follow' };
  if (req.method === 'POST') {
    init.body = await req.text();
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  const r = await fetch(t.href, init);
  const headers = new Headers(CORS);
  headers.set('Content-Type',
    r.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(r.body, { status: r.status, headers });
}
