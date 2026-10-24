/* ============ LarpMusic (ЛарпМузыка) — CORS-прокси v2 для Cloudflare Workers ============ */
/* Зачем: GitHub Pages — статический хостинг, серверного /proxy там нет, а API
   VK, Яндекса и Spotify блокируют запросы прямо из браузера (CORS). Этот
   Worker — замена server.js в облаке, бесплатный план хватает с запасом.

   v2: добавлены open.spotify.com (анонимный импорт публичных плейлистов через
   embed-страницу), региональные домены Яндекса, CDN превью Spotify (scdn.co)
   и zvuk.com. Приложение использует этот воркер как ЗАПАСНОЙ прокси: сначала
   основной, при отказе хоста (403/451/502) — этот.

   Как обновить задеплоенный воркер (например, larpmusic-proxy):
   1. cloudflare.com → Workers & Pages → выбери воркер → Edit code
   2. Вставь весь этот файл → Deploy
   Больше ничего не нужно — URL в приложении уже вшит как запасной.

   Прокси пропускает только белый список хостов — это не open-proxy. */

const ALLOW = [
  'api.vk.com', 'vk.com',
  'music.yandex.net', 'api.music.yandex.net', 'api.music.yandex.com', 'api.music.yandex.kz',
  'music.yandex.ru', 'music.yandex.com', 'login.yandex.ru',
  'api.audius.co', 'discoveryprovider.audius.co',
  'discoveryprovider2.audius.co', 'discoveryprovider3.audius.co', 'discoveryprovider4.audius.co',
  'api.spotify.com', 'accounts.spotify.com', 'open.spotify.com',
  'scdn.co', 'p.scdn.co', 'i.scdn.co',
  'archive.org',
  // SoundCloud (client_id берём с их фронтенда; звук идёт напрямую с CDN)
  'soundcloud.com', 'sndcdn.com',
  // zvuk.com (превью без подписки; полный каталог — только с подпиской)
  'zvuk.com', 'cdn66.zvuk.com', 'cdn-image.zvuk.com'
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
    init.headers = {
      'Content-Type': req.headers.get('Content-Type') || 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    };
  }

  const r = await fetch(t.href, init);
  const headers = new Headers(CORS);
  headers.set('Content-Type',
    r.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(r.body, { status: r.status, headers });
}
