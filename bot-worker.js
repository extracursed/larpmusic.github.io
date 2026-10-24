/* ============ LarpMusic (ЛарпМузыка) — Telegram-бот: приветствие ============ */
/* Это отдельный Worker-«бот». Он отвечает на /start в Telegram тёплым
   приветствием и кнопкой, которая открывает наш Mini App.

   Как задеплоить (3 шага, бесплатно, без карты):
   1. Cloudflare → Workers & Pages → Create Worker (Start with Hello World)
      → имя, например larpmusic-bot → Deploy
   2. Edit code → вставь ВЕСЬ этот файл → найди строку BOT_TOKEN и впиши туда
      токен своего бота (BotFather → /mybots → бот → API Token) → Deploy
   3. Открой в браузере (подставь свой токен вместо <TOKEN>):
      https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://larpmusic-bot.wawerave.workers.dev/
      Увидишь {"ok":true,...} — всё, бот начал отвечать на /start.

   Это приватный код воркера (его не видно снаружи), поэтому токен здесь в безопасности. */

const BOT_TOKEN = 'ВСТАВЬ_СЮДА_ТОКЕН_БОТА';   // например 123456:ABC-DEF...
const APP_URL = 'https://extracursed.github.io/larpmusic.github.io/';

const OPEN_BTN = [{ text: '🎵 Открыть ЛарпМузыку', web_app: { url: APP_URL } }];

// Универсальный вызов Bot API
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

addEventListener('fetch', e => e.respondWith(handle(e.request)));

async function handle (req) {
  // GET — просто проверка, что воркер жив
  if (req.method === 'GET') return new Response('LarpMusic bot ok', { status: 200 });

  let update;
  try { update = await req.json(); } catch (e) { return new Response('ok'); }

  const msg = update.message || update.edited_message ||
              (update.callback_query && update.callback_query.message);
  if (!msg || !msg.chat) return new Response('ok');

  const chat = msg.chat.id;
  const text = String(msg.text || '').trim();

  let out = null;

  if (text === '/start' || text.startsWith('/start@')) {
    out = {
      text:
        'Привет! 👋\n\n' +
        'Рад, что заглянул. Я — ЛарпМузыка, твой музыкальный помощник прямо в Telegram.\n\n' +
        'Тут можно:\n' +
        '• слушать музыку онлайн,\n' +
        '• перенести плейлисты из VK, Spotify и Яндекс Музыки,\n' +
        '• смотреть рекомендации под твой вкус.\n\n' +
        'Открывай плеер по кнопке ниже — и поехали 🎧\n\n' +
        'Если что-то не выходит или есть вопрос — просто напиши сюда, я на связи.',
      buttons: [OPEN_BTN]
    };
  } else if (text === '/help' || text.startsWith('/help@')) {
    out = {
      text:
        'Привет! Напиши /start — открою плеер. Внутри всё интуитивно: поиск, ' +
        'плейлисты, импорт из VK/Spotify/Яндекса и рекомендации.\n\n' +
        'Что-то зависло — обнови приложение или напиши мне сюда.',
      buttons: [OPEN_BTN]
    };
  } else if (text.startsWith('/')) {
    out = { text: 'Пока я понимаю команды /start и /help. Напиши /start, чтобы открыть плеер.' };
  } else if (text) {
    // Прислали прямую ссылку на аудио (пересылка трека из плеера)? Отправляем ФАЙЛОМ.
    const urlMatch = text.match(/https?:\/\/\S+/);
    if (urlMatch) {
      const audioUrl = urlMatch[0];
      const label = text.replace(/https?:\/\/\S+/g, '').replace(/^\s*Музыка:\s*/i, '').trim();
      const m = label.split(/\s+[—–-]\s+/);
      const title = (m[0] || '').trim() || 'Трек';
      const artist = (m[1] || '').trim();
      const res = await tg('sendAudio', {
        chat_id: chat,
        audio: audioUrl,
        title: title,
        performer: artist || undefined,
        caption: 'Музыка: ' + title + (artist ? ' — ' + artist : '')
      });
      if (res && res.ok) return new Response('ok'); // файл ушёл — и хватит
      // не вышло (ссылка не аудио) — отвечаем как обычно ниже
    }
    out = {
      text: 'Слушаю тебя 🙂 А музыка — в кнопке ниже. Напиши /start, если нужно открыть плеер заново.',
      buttons: [OPEN_BTN]
    };
  }

  if (out) {
    await tg('sendMessage', {
      chat_id: chat,
      text: out.text,
      reply_markup: out.buttons ? { inline_keyboard: out.buttons } : undefined
    });
  }
  return new Response('ok');
}
