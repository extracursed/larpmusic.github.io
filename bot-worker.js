/* ============ LarpMusic (ЛарпМузыка) — Telegram-бот v2 ============ */
/* Что нового в v2:
   • Треки из мини-аппа приходят в чат ФАЙЛОМ (mp3/m4a), а не ссылкой:
     воркер сам скачивает аудио (в т.ч. HLS-поток SoundCloud: склеивает
     сегменты в один файл) и загружает его в Telegram через sendAudio.
   • Новый дизайн сообщений (HTML-разметка, структура, кнопки).
   • Прежние тексты-приветствия сохранены ниже как BACKUP_V1.

   Как задеплоить (3 шага, бесплатно):
   1. Cloudflare → Workers & Pages → выбери воркер larpmusic-bot → Edit code
   2. Вставь ВЕСЬ этот файл → в строке BOT_TOKEN уже должен быть твой токен
      (если нет — BotFather → /mybots → API Token) → Deploy
   3. Webhook уже стоит; если бот молчит — открой в браузере:
      https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://larpmusic-bot.wawerave.workers.dev/

   Токен виден только внутри воркера — снаружи приватный код не читается. */

const BOT_TOKEN = 'ВСТАВЬ_СЮДА_ТОКЕН_БОТА';   // 123456:ABC-DEF...
const APP_URL = 'https://extracursed.github.io/larpmusic.github.io/';

/* ============ BACKUP_V1 — прежний дизайн сообщений (для отката) ============
const V1_START =
  'Привет! 👋\n\n' +
  'Рад, что заглянул. Я — ЛарпМузыка, твой музыкальный помощник прямо в Telegram.\n\n' +
  'Тут можно:\n' +
  '• слушать музыку онлайн,\n' +
  '• перенести плейлисты из VK, Spotify и Яндекс Музыки,\n' +
  '• смотреть рекомендации под твой вкус.\n\n' +
  'Открывай плеер по кнопке ниже — и поехали 🎧\n\n' +
  'Если что-то не выходит или есть вопрос — просто напиши сюда, я на связи.';
const V1_HELP =
  'Привет! Напиши /start — открою плеер. Внутри всё интуитивно: поиск, ' +
  'плейлисты, импорт из VK/Spotify/Яндекса и рекомендации.\n\n' +
  'Что-то зависло — обнови приложение или напиши мне сюда.';
========================= конец BACKUP_V1 ========= */

const OPEN_BTN = [{ text: '🎧 Открыть ЛарпМузыку', web_app: { url: APP_URL } }];
const OPEN_BTN_2 = [{ text: 'Открыть плеер', web_app: { url: APP_URL } }];

async function tg (method, payload) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) { return { ok: false }; }
}

/* ---------- скачивание аудио и отправка ФАЙЛОМ ---------- */
const MAX_BYTES = 28 * 1024 * 1024;   // запас под лимит Telegram 50 МБ

function baseOf (u, rel) {
  try { return new URL(rel, u).href; } catch (e) { return rel; }
}

/* HLS (m3u8): скачиваем init-сегмент + все медиа-сегменты и склеиваем в один fmp4-файл */
async function fetchHls (playlistUrl, depth) {
  if (depth > 2) return null;
  const r = await fetch(playlistUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return null;
  const text = await r.text();
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // мастер-плейлист? — берём первый вложенный плейлист
  if (/#EXT-X-STREAM-INF/i.test(text)) {
    for (const l of lines) if (!l.startsWith('#')) {
      return fetchHls(baseOf(playlistUrl, l), depth + 1);
    }
    return null;
  }
  const mapUrl = (text.match(/#EXT-X-MAP:URI="([^"]+)"/i) || [])[1];
  const segs = lines.filter(l => !l.startsWith('#'));
  if (!segs.length) return null;
  const parts = [];
  const grab = async u => {
    const rr = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!rr.ok) throw new Error('seg ' + rr.status);
    return new Uint8Array(await rr.arrayBuffer());
  };
  let total = 0;
  if (mapUrl) { const b = await grab(baseOf(playlistUrl, mapUrl)); parts.push(b); total += b.length; }
  for (const s of segs.slice(0, 600)) {
    const b = await grab(baseOf(playlistUrl, s));
    total += b.length;
    if (total > MAX_BYTES) break;
    parts.push(b);
  }
  if (!total) return null;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return { bytes: out, ext: '.m4a', type: 'audio/mp4' };
}

async function fetchDirect (url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return null;
  const type = r.headers.get('content-type') || '';
  if (/text\/html|json/i.test(type)) return null;      // это страница, не аудио
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 8000 || bytes.length > MAX_BYTES) return null;
  const isM3u = /\.m3u8?(\?|$)/i.test(url) || /mpegurl/i.test(type);
  const ext = /mp3|mpeg/i.test(type) || /\.mp3(\?|$)/i.test(url) ? '.mp3'
            : /flac/i.test(type) ? '.flac'
            : /wav/i.test(type) ? '.wav'
            : /mp4|m4a|aac/i.test(type) || /\.(m4a|mp4)(\?|$)/i.test(url) ? '.m4a' : '.mp3';
  return { bytes, ext, type: /mp3|mpeg|flac|wav|mp4|m4a|aac/i.test(type) ? type : 'audio/mpeg', isM3u };
}

/* Отправляет трек в чат файлом. Возвращает true при успехе. */
async function sendAudioFile (chat, audioUrl, title, artist) {
  try {
    let data = null;
    if (/\.m3u8|mpegurl/i.test(audioUrl)) data = await fetchHls(audioUrl, 0);
    if (!data) data = await fetchDirect(audioUrl);
    if (data && data.isM3u && !/\.m4a/.test(data.ext)) data = await fetchHls(audioUrl, 0) || data;
    if (!data) return false;
    const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim();
    const name = ((safe(artist) ? safe(artist) + ' - ' : '') + (safe(title) || 'track')).slice(0, 90) + data.ext;
    const fd = new FormData();
    fd.append('chat_id', chat);
    fd.append('audio', new File([data.bytes], name, { type: data.type }));
    fd.append('title', title || 'Трек');
    if (artist) fd.append('performer', artist);
    fd.append('caption', '🎧 ' + (title || 'Трек') + (artist ? ' — ' + artist : ''));
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendAudio', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    return !!(j && j.ok);
  } catch (e) { return false; }
}

/* ---------- сообщения ---------- */
const WELCOME = {
  text:
    '<b>Привет! Это ЛарпМузыка</b> — вся твоя музыка в одном месте 🎧\n\n' +
    'Что внутри:\n' +
    '▪️ Поиск по интернету и SoundCloud — <b>полные треки</b>, не обрезки\n' +
    '▪️ Перенос плейлистов из VK, Spotify, Яндекса и SoundCloud\n' +
    '▪️ Рекомендации по твоим вкусам\n' +
    '▪️ Отправка трека прямо в чат — <b>файлом</b>\n\n' +
    '👉 Жми кнопку <b>«🎧 Открыть ЛарпМузыку»</b> ниже — и поехали!',
  buttons: [OPEN_BTN]
};
const HELP = {
  text:
    '<b>Подсказка</b>\n\n' +
    '🎧 Музыка — в плеере (кнопка ниже)\n' +
    '📤 Хочешь отправить трек другу — в плеере нажми ⤴ у трека, выбери чат: придёт аудиофайлом\n' +
    '🔁 Перенос музыки между устройствами — Настройки → Перенос музыки\n\n' +
    'Если что-то не работает — напиши мне, я на связи.',
  buttons: [OPEN_BTN_2]
};
const FALLBACK = {
  text: 'Я тут, чтобы включать музыку 🙂 Открывай плеер — а если хочешь отправить трек в чат, жми ⤴ рядом с ним в приложении.',
  buttons: [OPEN_BTN_2]
};

addEventListener('fetch', e => e.respondWith(handle(e.request)));

async function handle (req) {
  if (req.method === 'GET') return new Response('LarpMusic bot v2 ok', { status: 200 });

  let update;
  try { update = await req.json(); } catch (e) { return new Response('ok'); }

  const msg = update.message || update.edited_message ||
              (update.callback_query && update.callback_query.message);
  if (!msg || !msg.chat) return new Response('ok');

  const chat = msg.chat.id;
  const text = String(msg.text || '').trim();

  if (text === '/start' || text.startsWith('/start@')) {
    await tg('sendMessage', {
      chat_id: chat, text: WELCOME.text, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [WELCOME.buttons] }
    });
    return new Response('ok');
  }

  if (text === '/help' || text.startsWith('/help@')) {
    await tg('sendMessage', {
      chat_id: chat, text: HELP.text, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [HELP.buttons] }
    });
    return new Response('ok');
  }

  if (text.startsWith('/')) {
    await tg('sendMessage', {
      chat_id: chat,
      text: 'Пока знаю только <code>/start</code> и <code>/help</code> 🙂',
      parse_mode: 'HTML'
    });
    return new Response('ok');
  }

  if (text) {
    // пересылка трека из плеера: «Музыка: Title — Artist https://...»
    const urlMatch = text.match(/https?:\/\/\S+/);
    if (urlMatch) {
      const audioUrl = urlMatch[0];
      const label = text.replace(/https?:\/\/\S+/g, '').replace(/^\s*Музыка:\s*/i, '').trim();
      const m = label.split(/\s+[—–-]\s+/);
      const title = (m[0] || '').trim();
      const artist = (m.slice(1).join(' — ') || '').trim();
      const sent = await sendAudioFile(chat, audioUrl, title, artist);
      if (sent) return new Response('ok');
      // файлом не вышло — пробуем отправить ссылку как аудио (Telegram сам скачает)
      const byUrl = await tg('sendAudio', {
        chat_id: chat, audio: audioUrl,
        title: title || undefined, performer: artist || undefined,
        caption: '🎧 ' + (title || 'Трек') + (artist ? ' — ' + artist : '')
      });
      if (byUrl && byUrl.ok) return new Response('ok');
      await tg('sendMessage', {
        chat_id: chat,
        text: 'Не смог скачать этот трек файлом 😕 Ссылка: ' + audioUrl,
        reply_markup: { inline_keyboard: [OPEN_BTN_2] }
      });
      return new Response('ok');
    }
    await tg('sendMessage', {
      chat_id: chat, text: FALLBACK.text,
      reply_markup: { inline_keyboard: [FALLBACK.buttons] }
    });
  }
  return new Response('ok');
}
