/* ============ LarpMusic (ЛарпМузыка) — приложение ============ */
(function () {
'use strict';

/* ---------- Telegram ---------- */
const TG = window.Telegram && window.Telegram.WebApp;
if (TG) { try { TG.ready(); TG.expand(); } catch (e) {} }

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/* ---------- Тема Telegram ---------- */
function applyTheme () {
  const tp = (TG && TG.themeParams) || {};
  const hex2rgb = (h) => {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const bg = hex2rgb(tp.bg_color);
  if (bg) {
    const lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255;
    document.body.classList.toggle('light', lum > 0.6);
    const set = (k, v) => v && document.documentElement.style.setProperty(k, v);
    set('--bg', tp.bg_color);
    set('--card', tp.secondary_bg_color);
    set('--card-2', tp.secondary_bg_color);
    set('--text', tp.text_color);
    set('--muted', tp.hint_color);
    set('--acc1', tp.button_color || '#6C5CE7');
    set('--acc2', tp.link_color || '#EC4899');
    set('--line', 'rgba(128,128,128,.18)');
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = tp.bg_color;
    if (TG && TG.setHeaderColor) { try { TG.setHeaderColor(tp.bg_color); } catch (e) {} }
    if (TG && TG.setBackgroundColor) { try { TG.setBackgroundColor(tp.bg_color); } catch (e) {} }
  }
}
applyTheme();

function haptic (type) {
  try {
    if (!TG || !TG.HapticFeedback) return;
    if (type === 'impact') TG.HapticFeedback.impactOccurred('light');
    else if (type === 'success') TG.HapticFeedback.notificationOccurred('success');
    else TG.HapticFeedback.impactOccurred('medium');
  } catch (e) {}
}
function openExternal (url) {
  if (!url) return;
  try { if (TG && TG.openTelegramLink) { TG.openTelegramLink(url); return; } } catch (e) {}
  window.open(url, '_blank', 'noopener');
}
function shareTrack (t) {
  if (!t) return;
  // Шарим ПРЯМУЮ ссылку на аудио — бот @Larp_music_bot превратит её в аудиофайл.
  // Если прямой ссылки нет (локальный файл/VK) — шарим страницу трека, как раньше.
  const direct = /^https?:\/\//i.test(t.url || '') ? t.url : '';
  const link = direct || t.openUrl || (location.origin + location.pathname);
  const text = 'Музыка: ' + t.title + ' — ' + t.artist;
  // Шаринг в Telegram: открываем диалог отправки — выбираем чат с ботом @Larp_music_bot
  const shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(link) +
                   '&text=' + encodeURIComponent(text);
  haptic('impact');
  try { if (TG && TG.openTelegramLink) { TG.openTelegramLink(shareUrl); return; } } catch (e) {}
  if (navigator.share) { navigator.share({ title: t.title, text: text + '\n' + link }).catch(() => {}); return; }
  try { window.open(shareUrl, '_blank', 'noopener'); return; } catch (e) {}
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast('Скопировано — вставь в чат'))
      .catch(() => toast('Не удалось поделиться', true));
    return;
  }
  toast('Не удалось поделиться', true);
}

/* ---------- store ---------- */
const store = {
  get (k, d) { try { const v = localStorage.getItem('mma:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set (k, v) { try { localStorage.setItem('mma:' + k, JSON.stringify(v)); } catch (e) {} },
  del (k) { try { localStorage.removeItem('mma:' + k); } catch (e) {} }
};

let toastTimer;
function toast (msg, isErr) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------- modal ---------- */
let modalOnClose = null;
function openModal (html, onClose) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  modalOnClose = onClose || null;
  document.body.style.overflow = 'hidden';
}
function closeModal () {
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
  document.body.style.overflow = '';
  if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
}
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

/* ---------- state ---------- */
const SRC_LABEL = { internet: 'Интернет', vk: 'VK', spotify: 'Spotify', yandex: 'Яндекс', local: 'Файлы' };

function defaultPlaylists () {
  return [
    { id: 'pl:fav', name: 'Мне нравится', cover: '', trackIds: [], system: true }
  ];
}
function favPlaylist () {
  let pl = state.playlists.find(p => p.id === 'pl:fav');
  if (!pl) {
    pl = { id: 'pl:fav', name: 'Мне нравится', cover: '', trackIds: [], system: true };
    state.playlists.unshift(pl);
    store.set('playlists', state.playlists);
  } else if (pl.name !== 'Мне нравится') {
    pl.name = 'Мне нравится';
    store.set('playlists', state.playlists);
  }
  return pl;
}
function isFav (id) { return favPlaylist().trackIds.includes(id); }
function toggleFav (t) {
  if (!t) return;
  const pl = favPlaylist();
  const i = pl.trackIds.indexOf(t.id);
  if (i >= 0) { pl.trackIds.splice(i, 1); toast('Убрано из «Мне нравится»'); }
  else { regTracks([t]); pl.trackIds.push(t.id); if (!pl.cover && t.cover) pl.cover = t.cover; toast('Добавлено в «Мне нравится»'); haptic('success'); }
  store.set('playlists', state.playlists);
  $$('[data-fav="' + CSS.escape(t.id) + '"]').forEach(b => b.classList.toggle('on', isFav(t.id)));
  renderFav();
  renderHome();
}

const settings = Object.assign({
  spotifyClientId: '', spotifyToken: '',
  vkToken: '',
  yaToken: '', yaClientId: '',
  proxy: 'https://larpmusic-proxy.wawerave.workers.dev',
  volume: 80
}, store.get('settings', {}));

const state = {
  playlists: store.get('playlists', defaultPlaylists()),
  recent: store.get('recent', []),
  queue: [], qi: -1, playing: false,
  shuffle: false, repeat: 'off',           // off | all | one
  muted: false,
  volume: settings.volume / 100,
  trends: [],
  activePlaylist: null,
  searchSrc: ['internet']
};

/* ---------- реестр треков (переживает перезагрузку) ---------- */
let registry = store.get('registry', {});
function regTracks (list) {
  list.forEach(t => { registry[t.id] = t; });
  const keys = Object.keys(registry);
  if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete registry[k]);
  store.set('registry', registry);
  return list;
}
function reg (id) { return registry[id]; }

/* ---------- IndexedDB для локальных файлов ---------- */
function idb () {
  return new Promise((res, rej) => {
    const r = indexedDB.open('mma', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut (id, blob) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function idbGet (id) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readonly');
      const rq = tx.objectStore('files').get(id);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  } catch (e) { return null; }
}
async function resolveLocalTracks () {
  const locals = Object.values(registry).filter(t => t.source === 'local' && !t.url);
  for (const t of locals) {
    const blob = await idbGet(t.id);
    if (blob) t.url = URL.createObjectURL(blob);
  }
}

/* ============ ПЛЕЕР ============ */
const audio = $('#audio');

function fmt (s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ':' + String(ss).padStart(2, '0');
}
function currentTrack () { return state.qi >= 0 ? reg(state.queue[state.qi]) : null; }

function loadQueue (ids, startIndex, autoplay) {
  state.queue = ids.filter(id => reg(id));
  state.qi = state.queue.indexOf(ids[startIndex]) >= 0 ? state.queue.indexOf(ids[startIndex]) : 0;
  playIndex(state.qi, autoplay !== false);
}
function playIndex (i, autoplay) {
  if (!state.queue.length) return;
  state.qi = (i + state.queue.length) % state.queue.length;
  const t = reg(state.queue[state.qi]);
  if (!t) return;
  if (!t.url) {
    toast('У этого трека нет прямой ссылки — открываю в источнике', true);
    if (t.openUrl) openExternal(t.openUrl);
    nextTrack(true);
    return;
  }
  audio.src = t.url;
  if (autoplay !== false) audio.play().catch(() => {});
  pushRecent(t.id);
  updatePlayerUI();
  mediaSession(t);
}
function playTrack (t, trackList) {
  const list = trackList || [t];
  const ids = list.map(x => x.id);
  regTracks(list);
  loadQueue(ids, ids.indexOf(t.id), true);
  haptic('impact');
}
function togglePlay () {
  if (!audio.src) {
    const ids = state.recent.filter(id => reg(id));
    if (ids.length) playIndex(0, true);
    else toast('Сначала выбери трек');
    return;
  }
  if (audio.paused) audio.play().catch(() => toast('Не удалось воспроизвести', true));
  else audio.pause();
}
function nextTrack (auto) {
  if (!state.queue.length) return;
  if (state.repeat === 'one' && auto) { audio.currentTime = 0; audio.play(); return; }
  if (state.shuffle) {
    let i = state.qi;
    if (state.queue.length > 1) while (i === state.qi) i = Math.floor(Math.random() * state.queue.length);
    playIndex(i, true);
    return;
  }
  if (state.qi + 1 < state.queue.length) playIndex(state.qi + 1, true);
  else if (state.repeat === 'all') playIndex(0, true);
  else { audio.pause(); audio.currentTime = 0; updatePlayerUI(); }
}
function prevTrack () {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.qi > 0) playIndex(state.qi - 1, true);
  else if (state.queue.length) playIndex(state.queue.length - 1, true);
}
function pushRecent (id) {
  state.recent = [id].concat(state.recent.filter(x => x !== id)).slice(0, 25);
  store.set('recent', state.recent);
}
function mediaSession (t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album || '',
      artwork: t.cover ? [{ src: t.cover, sizes: '600x600', type: 'image/jpeg' }] : []
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(false));
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
  } catch (e) {}
}

function setVolume (v) {
  state.volume = Math.min(1, Math.max(0, v));
  state.muted = state.volume === 0;
  audio.volume = state.volume;
  audio.muted = state.muted;
  settings.volume = Math.round(state.volume * 100);
  store.set('settings', settings);
  $('#volume').value = Math.round(state.volume * 100);
  $('#volVal').textContent = Math.round(state.volume * 100) + '%';
  $('#setVolume').value = Math.round(state.volume * 100);
  $('#setVolumeVal').textContent = Math.round(state.volume * 100) + '%';
  $('#btnMute').innerHTML = '<svg class="ic"><use href="#' + (state.muted ? 'i-mute' : 'i-vol') + '"/></svg>';
}

audio.addEventListener('play', () => {
  state.playing = true;
  document.body.classList.add('playing');
  document.body.classList.remove('paused');
  updatePlayButtons();
});
audio.addEventListener('pause', () => {
  state.playing = false;
  document.body.classList.remove('playing');
  document.body.classList.add('paused');
  updatePlayButtons();
});
audio.addEventListener('ended', () => nextTrack(true));
audio.addEventListener('error', () => {
  if (audio.src) toast('Файл недоступен — пропускаю', true);
});
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0, c = audio.currentTime || 0;
  $('#miniBar').style.width = d ? (c / d * 100) + '%' : '0%';
  $('#tCur').textContent = fmt(c);
  if (d) $('#tDur').textContent = fmt(d);
  const seek = $('#seek');
  if (document.activeElement !== seek) seek.value = d ? Math.round(c / d * 1000) : 0;
});

function updatePlayButtons () {
  const icon = state.playing ? '#i-pause' : '#i-play';
  $('#miniPlay').innerHTML = '<svg class="ic"><use href="' + icon + '"/></svg>';
  $('#btnPlay').innerHTML = '<svg class="ic"><use href="' + icon + '"/></svg>';
}
function updatePlayerUI () {
  const t = currentTrack();
  $('#miniPlayer').hidden = !t;
  if (!t) return;
  const cover = t.cover || phCover(t.title + t.artist);
  $('#miniCover').src = cover;
  $('#miniCoverBox').classList.add('has');
  $('#miniTitle').textContent = t.title;
  $('#miniArtist').textContent = t.artist;
  $('#fpCover').src = cover;
  document.querySelector('.vinyl').classList.remove('noimg');
  $('#fpTitle').textContent = t.title;
  $('#fpArtist').textContent = t.artist;
  const tag = $('#fpSource');
  tag.textContent = SRC_LABEL[t.source] || t.source;
  tag.className = 'src-tag s-' + t.source;
  tag.hidden = false;
  $$('.track').forEach(el => el.classList.toggle('playing', el.dataset.id === t.id));
  renderQueue();
}

/* ============ РЕНДЕР ============ */
function esc (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* фирменная градиентная обложка, если у трека нет картинки */
function phCover (seedText) {
  const s = String(seedText || 'music');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const a = h % 360, b = (a + 45) % 360, c = (a + 190) % 360;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="hsl(' + a + ',70%,46%)"/>' +
    '<stop offset="1" stop-color="hsl(' + c + ',65%,26%)"/></linearGradient></defs>' +
    '<rect width="300" height="300" fill="url(#g)"/>' +
    '<circle cx="230" cy="70" r="90" fill="hsl(' + b + ',80%,60%)" opacity="0.35"/>' +
    '<text x="150" y="196" font-size="120" text-anchor="middle" fill="#ffffffd9" ' +
    'font-family="Segoe UI,Arial,sans-serif">&#9834;</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function trackRow (t, list) {
  const cover = '<img class="track-cover" loading="lazy" alt="" src="' +
    esc(t.cover || phCover(t.title + t.artist)) + '" onerror="this.style.visibility=\'hidden\'">';
  const playing = currentTrack() && currentTrack().id === t.id ? ' playing' : '';
  const fav = isFav(t.id) ? ' on' : '';
  return '<div class="track' + playing + '" data-id="' + esc(t.id) + '" data-list="' + esc(list || '') + '">' +
    cover +
    '<div class="track-info">' +
      '<div class="track-title">' + esc(t.title) + '</div>' +
      '<div class="track-artist">' + esc(t.artist) +
        '<span class="src-tag s-' + t.source + '">' + (SRC_LABEL[t.source] || '') + '</span>' +
        '<span class="eq"><i></i><i></i><i></i><i></i></span>' +
      '</div>' +
    '</div>' +
    '<button class="icon-btn fav' + fav + '" data-fav="' + esc(t.id) + '" title="Мне нравится">' +
      '<svg class="ic"><use href="#i-heart"/></svg></button>' +
    '<button class="icon-btn share" data-share="' + esc(t.id) + '" title="Добавить музыку в чат">' +
      '<svg class="ic"><use href="#i-share"/></svg></button>' +
    (t.url ? '' :
      '<button class="icon-btn ext" data-ext="' + esc(t.id) + '" title="Открыть в источнике">' +
      '<svg class="ic"><use href="#i-ext"/></svg></button>') +
    '<button class="icon-btn add" data-add="' + esc(t.id) + '" title="В плейлист">' +
      '<svg class="ic"><use href="#i-plus"/></svg></button>' +
  '</div>';
}
function renderTrackList (el, tracks, emptyText) {
  if (!tracks || !tracks.length) {
    el.innerHTML = '<div class="empty">' + (emptyText || 'Пока пусто') + '</div>';
    return;
  }
  el.innerHTML = tracks.map(t => trackRow(t)).join('');
}

/* --- главая --- */
function plCover (pl) {
  if (pl.cover) return pl.cover;
  const t = pl.trackIds.map(reg).find(x => x && x.cover);
  return t ? t.cover : '';
}
function renderHome () {
  const grids = ['#homePlaylists', '#playlistGrid'];
  const plHtml = state.playlists.map(pl => {
    const cover = plCover(pl) || phCover(pl.name);
    return '<button class="pl-card" data-pl="' + esc(pl.id) + '">' +
      '<img class="pl-cover" loading="lazy" src="' + esc(cover) + '" onerror="this.style.visibility=\'hidden\'">' +
      '<div class="pl-name">' + esc(pl.name) + '</div>' +
      '<div class="pl-count">' + pl.trackIds.length + ' треков</div></button>';
  }).join('');
  grids.forEach(s => { const el = $(s); if (el) el.innerHTML = plHtml; });

  renderFav();
  renderTrackList($('#homeTrends'), state.trends, 'Не удалось загрузить тренды. Проверь интернет.');
  renderRecent();
}
function favTracks () {
  return favPlaylist().trackIds.map(reg).filter(Boolean);
}
function renderFav () {
  const el = $('#favList');
  if (!el) return;
  const list = favTracks();
  if (!list.length) {
    el.innerHTML = '<div class="empty-box">' +
      '<div class="empty-title">Здесь пока нет треков</div>' +
      '<button class="btn white" data-goto="search">Перейти к поиску</button></div>';
    return;
  }
  state.favCache = list;
  el.innerHTML = '<div class="track-list">' + list.map(t => trackRow(t)).join('') + '</div>';
}
function renderRecent () {
  const list = state.recent.map(id => reg(id)).filter(Boolean);
  renderTrackList($('#recentList'), list, 'Здесь появятся треки, которые ты слушал.');
}
function renderImportCards () {
  const cards = [
    { k: 'm3u', c: '#22c55e', icon: '#i-globe', t: 'M3U / прямые ссылки', s: 'Вставь ссылку или содержимое .m3u — треки заиграют сразу.', b: 'интернет' },
    { k: 'files', c: '#a78bfa', icon: '#i-folder', t: 'Файлы с устройства', s: 'MP3, M4A, WAV, FLAC — локально, без загрузки в сеть.', b: 'локально' },
    { k: 'spotify', brand: true, icon: '#i-spotify', t: 'Spotify', s: 'Вставь ссылку на плейлист или альбом — треки будут найдены.', b: 'Spotify' },
    { k: 'vk', brand: true, icon: '#i-vk', t: 'VK Музыка', s: 'Ссылка на плейлист или профиль — музыка найдётся сама.', b: 'VK' },
    { k: 'yandex', brand: true, icon: '#i-yandex', t: 'Яндекс Музыка', s: 'Ссылка на плейлист, альбом или профиль Яндекс Музыки.', b: 'Яндекс' }
  ];
  const ok = {
    spotify: Sources.spotify.isConnected(),
    vk: Sources.vk.isConnected(),
    yandex: Sources.yandex.isConnected()
  };
  $('#importCards').innerHTML = cards.map(c => {
    const logo = c.brand
      ? '<div class="imp-logo brand"><svg class="ic"><use href="' + c.icon + '"/></svg></div>'
      : '<div class="imp-logo" style="background:' + c.c + '"><svg class="ic"><use href="' + c.icon + '"/></svg></div>';
    return '<button class="imp-card" data-imp="' + c.k + '">' + logo +
      '<div class="imp-body">' +
        '<div class="imp-title">' + c.t +
          '<span class="imp-badge' + (ok[c.k] ? ' ok' : '') + '">' + (ok[c.k] ? 'подключено' : c.b) + '</span>' +
        '</div>' +
        '<div class="imp-sub">' + c.s + '</div>' +
      '</div>' +
      '<svg class="ic" style="color:var(--muted)"><use href="#i-link"/></svg>' +
    '</button>';
  }).join('');
}
function renderStatuses () {
  const set = (sel, on, txt) => {
    const el = $(sel);
    el.textContent = on ? txt || 'подключено' : 'не подключено';
    el.classList.toggle('ok', !!on);
  };
  set('#stSpotify', Sources.spotify.isConnected());
  set('#stVk', Sources.vk.isConnected());
  set('#stYandex', Sources.yandex.isConnected());
}

/* --- очередь в полном плеере --- */
function renderQueue () {
  const list = state.queue.map(id => reg(id)).filter(Boolean);
  if ($('#fpQueue').hidden) return;
  renderTrackList($('#queueList'), list, 'Очередь пуста.');
}

/* ============ НАВИГАЦИЯ ============ */
function goto (name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  if (name === 'import') renderImportCards();
  if (name === 'library') { renderHome(); }
  if (name === 'settings') { renderStatuses(); }
  if (name === 'reco') renderReco();
  haptic('impact');
}
$$('.tab').forEach(t => t.addEventListener('click', () => goto(t.dataset.view)));
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (g) goto(g.dataset.goto);
});
$('#btnTopSettings').addEventListener('click', () => goto('settings'));

/* ============ ПОИСК ============ */
let searchTimer;
async function runSearch (q) {
  q = (q || '').trim();
  if (!q) return;
  $('#searchStatus').textContent = 'Ищу «' + q + '»…';
  $('#searchResults').innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>';
  const which = state.searchSrc.slice();
  if (which.includes('vk') && !Sources.vk.canSearch()) toast('VK-поиск недоступен — нет токена', true);
  if (which.includes('spotify') && !Sources.spotify.isConnected()) toast('Spotify не подключён — вкладка «Ещё»', true);
  if (which.includes('yandex') && !Sources.yandex.isConnected()) toast('Яндекс не подключён — вкладка «Ещё»', true);
  try {
    const res = await Sources.searchAll(q, which);
    regTracks(res);
    renderTrackList($('#searchResults'), res, 'Ничего не найдено. Попробуй другой запрос или включи больше источников.');
    $('#searchStatus').textContent = res.length ? 'Найдено: ' + res.length : '';
    state.lastSearchList = res;
  } catch (e) {
    $('#searchResults').innerHTML = '';
    $('#searchStatus').textContent = 'Ошибка: ' + e.message;
    toast('Поиск не удался: ' + e.message, true);
  }
}
$('#searchInput').addEventListener('input', e => {
  $('#searchClear').hidden = !e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(e.target.value), 550);
});
$('#searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(e.target.value); });
$('#searchClear').addEventListener('click', () => { $('#searchInput').value = ''; $('#searchClear').hidden = true; $('#searchResults').innerHTML = ''; $('#searchStatus').textContent = ''; });
$$('#srcChips .chip').forEach(c => c.addEventListener('click', () => {
  const s = c.dataset.src;
  const i = state.searchSrc.indexOf(s);
  if (i >= 0) state.searchSrc.splice(i, 1); else state.searchSrc.push(s);
  if (!state.searchSrc.length) { state.searchSrc.push(s); }
  $$('#srcChips .chip').forEach(x => x.classList.toggle('active', state.searchSrc.includes(x.dataset.src)));
  if ($('#searchInput').value) runSearch($('#searchInput').value);
}));
$$('#genreChips .chip').forEach(c => c.addEventListener('click', () => {
  goto('search');
  $('#searchInput').value = c.dataset.q;
  $('#searchClear').hidden = false;
  runSearch(c.dataset.q);
}));
$('#btnRefreshTrends').addEventListener('click', loadTrends);
async function loadTrends () {
  try {
    const t = await Sources.internet.trends();
    regTracks(t);
    state.trends = t;
  } catch (e) { state.trends = []; }
  renderTrackList($('#homeTrends'), state.trends, 'Не удалось загрузить тренды.');
}

/* ============ РЕКОМЕНДАЦИИ ============ */
function analyzeTaste () {
  const favs = favTracks();
  const recent = state.recent.map(reg).filter(Boolean);
  const w = {};
  const bump = (artist, k) => String(artist || '').split(/[,;/&]+/).map(s => s.trim())
    .filter(s => s.length > 1 && !/various|разные|сборник/i.test(s))
    .forEach(a => { w[a] = (w[a] || 0) + k; });
  favs.forEach(t => bump(t.artist, 3));
  recent.forEach(t => bump(t.artist, 1));
  const artists = Object.entries(w).sort((a, b) => b[1] - a[1]);
  const known = new Set([...favs, ...recent].map(t => (t.title + '|' + t.artist).toLowerCase()));
  return { favs, recent, artists, known };
}
function tasteHtml (taste) {
  return '<div class="taste-card">' +
    '<div class="taste-nums">' +
      '<div><b>' + taste.favs.length + '</b><span>в «Мне нравится»</span></div>' +
      '<div><b>' + taste.recent.length + '</b><span>прослушано</span></div>' +
      '<div><b>' + taste.artists.length + '</b><span>исполнителей</span></div>' +
    '</div>' +
    (taste.artists.length
      ? '<div class="taste-artists"><span>Чаще всего тебе нравится:</span><div class="chips">' +
        taste.artists.slice(0, 6).map(a => '<span class="chip static">' + esc(a[0]) + '</span>').join('') + '</div></div>'
      : '<p class="hint" style="margin:16px 0 0">Отмечай треки сердцем и слушай музыку — подборки будут точнее.</p>') +
    '</div>';
}
async function renderReco (force) {
  const el = $('#recoList'), tasteEl = $('#recoTaste');
  if (!el) return;
  const taste = analyzeTaste();
  tasteEl.innerHTML = tasteHtml(taste);
  if (state.recoCache && state.recoCache.length && !force) {
    renderTrackList(el, state.recoCache, 'Пока нечего рекомендовать.');
    return;
  }
  el.innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>';
  const queries = taste.artists.slice(0, 4).map(a => a[0]);
  if (!queries.length) queries.push('популярная музыка');
  let out = [];
  try {
    const res = await Promise.all(queries.map(q => Sources.internet.search(q).catch(() => [])));
    res.forEach(arr => out.push(...arr));
  } catch (e) {}
  if (!out.length) out = Object.values(registry);
  const score = t => {
    const a = t.artist.toLowerCase();
    let s = 0;
    taste.artists.forEach(x => { if (a.includes(x[0].toLowerCase())) s += 10 + x[1]; });
    return s;
  };
  const seen = new Set();
  out = out.filter(t => {
    const k = (t.title + '|' + t.artist).toLowerCase();
    if (taste.known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  out.sort((a, b) => score(b) - score(a));
  state.recoCache = out.slice(0, 24);
  renderTrackList(el, state.recoCache, 'Пока нечего рекомендовать — добавь треки в «Мне нравится» и послушай поиск.');
}
$('#btnRecoRefresh').addEventListener('click', () => renderReco(true));

/* ============ ДЕЙСТВИЯ С ТРЕКАМИ ============ */
let pendingTracks = null;   // список, из которого играет строка
document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { e.stopPropagation(); openAddToPlaylist(reg(add.dataset.add)); return; }
  const share = e.target.closest('[data-share]');
  if (share) { e.stopPropagation(); shareTrack(reg(share.dataset.share)); return; }
  const fav = e.target.closest('[data-fav]');
  if (fav) { e.stopPropagation(); toggleFav(reg(fav.dataset.fav)); return; }
  const ext = e.target.closest('[data-ext]');
  if (ext) { e.stopPropagation(); const t = reg(ext.dataset.ext); if (t) { if (t.openUrl) openExternal(t.openUrl); else if (t.url) openExternal(t.url); else toast('Нет ссылки', true); } return; }
  const openFav = e.target.closest('[data-open-fav]');
  if (openFav) { openPlaylist(favPlaylist().id); return; }
  const row = e.target.closest('.track');
  if (!row) return;
  const t = reg(row.dataset.id);
  if (!t) return;
  const container = row.closest('.track-list');
  let list = [];
  if (container && container.id === 'searchResults') list = state.lastSearchList || [];
  else if (container && container.id === 'homeTrends') list = state.trends;
  else if (container && container.id === 'queueList') list = state.queue.map(reg).filter(Boolean);
  else if (container && container.id === 'sheetTracks') list = sheetTrackCache;
  else if (container && container.id === 'recentList') list = state.recent.map(reg).filter(Boolean);
  else if (container && container.id === 'recoList') list = state.recoCache || [];
  else if (row.closest('#favList')) list = state.favCache || favTracks();
  if (!list.length) list = [t];
  playTrack(t, list);
});

function openAddToPlaylist (t) {
  if (!t) return;
  const items = state.playlists.map(pl =>
    '<button class="pick" data-pladd="' + esc(pl.id) + '" data-tid="' + esc(t.id) + '">' +
      '<img alt="" src="' + esc(plCover(pl) || phCover(pl.name)) + '">' +
      '<div class="pick-body"><div class="pick-name">' + esc(pl.name) + '</div>' +
      '<div class="pick-sub">' + pl.trackIds.length + ' треков</div></div>' +
      '<div class="check"><svg class="ic"><use href="#i-plus"/></svg></div>' +
    '</button>').join('');
  openModal(
    '<h3>Добавить в плейлист</h3>' +
    '<p class="sub">' + esc(t.title) + ' — ' + esc(t.artist) + '</p>' +
    '<div class="pick-list">' + items + '</div>' +
    '<div class="modal-actions"><button class="btn ghost" id="mNewPl">+ Новый плейлист</button></div>'
  );
  $('#mNewPl').addEventListener('click', () => {
    askName('Новый плейлист', 'Мой плейлист', name => {
      addTrackToPlaylist(createPlaylist(name), t);
      closeModal();
      toast('Добавлено ✓'); haptic('success');
    });
  });
  $$('#modalBody [data-pladd]').forEach(b => b.addEventListener('click', () => {
    addTrackToPlaylist(b.dataset.pladd, t);
    closeModal();
    toast('Добавлено ✓', false); haptic('success');
  }));
}
function createPlaylist (name, cover) {
  const pl = { id: 'pl:' + Sources.uid('pl'), name, cover: cover || '', trackIds: [] };
  state.playlists.push(pl);
  store.set('playlists', state.playlists);
  renderHome();
  return pl.id;
}
function addTrackToPlaylist (plId, t) {
  const pl = state.playlists.find(p => p.id === plId);
  if (!pl) return;
  regTracks([t]);
  if (!pl.trackIds.includes(t.id)) pl.trackIds.push(t.id);
  if (!pl.cover && t.cover) pl.cover = t.cover;
  store.set('playlists', state.playlists);
  renderHome();
}
function ensurePlaylist (name) {
  const found = state.playlists.find(p => p.name === name);
  if (found) return found;
  const id = createPlaylist(name);
  return state.playlists.find(p => p.id === id);
}
function addTracksToPlaylist (pl, tracks) {
  if (!pl || !tracks || !tracks.length) return 0;
  regTracks(tracks);
  let added = 0;
  for (const t of tracks) {
    if (!pl.trackIds.includes(t.id)) { pl.trackIds.push(t.id); added++; }
    if (!pl.cover && t.cover) pl.cover = t.cover;
  }
  store.set('playlists', state.playlists);
  renderHome();
  return added;
}
function askName (title, def, cb) {
  openModal(
    '<h3>' + esc(title) + '</h3>' +
    '<div class="field-card"><div class="field-row"><label>Название</label></div>' +
    '<input type="text" id="askInput" value="' + esc(def || '') + '"></div>' +
    '<div class="modal-actions"><button class="btn primary" id="askOk">Готово</button></div>');
  const inp = $('#askInput');
  if (inp) { inp.focus(); try { inp.select(); } catch (e) {} }
  const go = () => {
    const v = inp ? inp.value.trim() : '';
    if (!v) return;
    closeModal();
    cb(v);
  };
  $('#askOk').addEventListener('click', go);
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
$('#btnNewPlaylist').addEventListener('click', () => {
  askName('Новый плейлист', 'Плейлист ' + (state.playlists.length + 1), name => openPlaylist(createPlaylist(name)));
});

/* ============ ЛИСТ ПЛЕЙЛИСТА ============ */
let sheetTrackCache = [];
function openPlaylist (plId) {
  const pl = state.playlists.find(p => p.id === plId);
  if (!pl) return;
  state.activePlaylist = plId;
  sheetTrackCache = pl.trackIds.map(reg).filter(Boolean);
  $('#sheetTitle').textContent = pl.name;
  $('#sheetMeta').textContent = pl.trackIds.length + ' треков';
  renderTrackList($('#sheetTracks'), sheetTrackCache, 'Плейлист пуст — добавь треки из поиска или импортируй из VK / Spotify / Яндекс.');
  const sheet = $('#playlistSheet');
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  haptic('impact');
}
function closeSheet () {
  const sheet = $('#playlistSheet');
  sheet.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; }, 350);
}
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheetPlay').addEventListener('click', () => {
  if (!sheetTrackCache.length) return toast('Плейлист пуст', true);
  playTrack(sheetTrackCache[0], sheetTrackCache);
});
$('#sheetShuffle').addEventListener('click', () => {
  if (!sheetTrackCache.length) return toast('Плейлист пуст', true);
  state.shuffle = true; $('#btnShuffle').classList.add('on');
  const r = sheetTrackCache.slice().sort(() => Math.random() - 0.5);
  playTrack(r[0], r);
});
$('#sheetDelete').addEventListener('click', () => {
  const pl = state.playlists.find(p => p.id === state.activePlaylist);
  if (!pl) return;
  if (!confirm('Удалить плейлист «' + pl.name + '»?')) return;
  state.playlists = state.playlists.filter(p => p.id !== pl.id);
  store.set('playlists', state.playlists);
  closeSheet(); renderHome();
  toast('Плейлист удалён');
});

/* ============ ИМПОРТ ============ */
document.addEventListener('click', e => {
  const c = e.target.closest('[data-imp]');
  if (c) openImport(c.dataset.imp);
});
document.addEventListener('click', e => {
  const p = e.target.closest('[data-pl]');
  if (p && !p.closest('#modalBody')) openPlaylist(p.dataset.pl);
});

function openImport (kind) {
  if (kind === 'files') return openFilesImport();
  if (kind === 'm3u') return openM3uImport();
  if (kind === 'spotify') return openSpotifyImport();
  if (kind === 'vk') return openVkImport();
  if (kind === 'yandex') return openYandexImport();
}

/* --- M3U --- */
function openM3uImport () {
  openModal(
    '<h3>Импорт из интернета (M3U)</h3>' +
    '<p class="sub">Вставь ссылку на .m3u/.m3u8 плейлист <b>или</b> его содержимое (строки #EXTINF + ссылки на mp3).</p>' +
    '<textarea class="mono" id="m3uText" placeholder="https://example.com/playlist.m3u&#10;&#10;или&#10;&#10;#EXTINF:180,Исполнитель - Трек&#10;https://example.com/song.mp3"></textarea>' +
    '<div class="modal-actions">' +
      '<button class="btn primary" id="m3uUrl">По ссылке</button>' +
      '<button class="btn ghost" id="m3uRaw">Из текста</button>' +
    '</div>'
  );
  $('#m3uUrl').addEventListener('click', async () => {
    const v = $('#m3uText').value.trim();
    if (!v) return toast('Вставь ссылку', true);
    try {
      const r = await Sources.httpGet(v);
      const txt = await r.text();
      importFromM3u(txt, v);
    } catch (e) { toast('Не удалось скачать: ' + e.message, true); }
  });
  $('#m3uRaw').addEventListener('click', () => {
    const v = $('#m3uText').value.trim();
    if (!v) return toast('Вставь содержимое', true);
    importFromM3u(v, '');
  });
}
function importFromM3u (text, base) {
  const tracks = regTracks(Sources.m3u.parse(text, base));
  if (!tracks.length) return toast('Треки не найдены', true);
  const id = createPlaylist('Импорт M3U', tracks[0].cover);
  state.playlists.find(p => p.id === id).trackIds = tracks.map(t => t.id);
  store.set('playlists', state.playlists);
  renderHome();
  closeModal();
  toast('Импортировано: ' + tracks.length + ' ✓'); haptic('success');
  goto('library');
}

/* --- локальные файлы --- */
function openFilesImport () {
  openModal(
    '<h3>Файлы с устройства</h3>' +
    '<p class="sub">Выбери MP3 / M4A / WAV / FLAC. Файлы хранятся локально в браузере (IndexedDB) и не загружаются в сеть.</p>' +
    '<input type="file" id="fileInput" accept="audio/*" multiple style="width:100%;color:var(--muted);font-size:13px">' +
    '<p class="note">Имя файла «Исполнитель - Название» станет метаданным трека.</p>'
  );
  $('#fileInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const tracks = [];
    for (const f of files) {
      const id = 'local:' + Sources.uid('f');
      try { await idbPut(id, f); } catch (err) {}
      const base = f.name.replace(/\.[^.]+$/, '');
      const parts = base.split(' - ');
      tracks.push({
        id, title: parts.length > 1 ? parts.slice(1).join(' - ') : base,
        artist: parts.length > 1 ? parts[0] : 'Локальный файл',
        album: '', cover: '', url: URL.createObjectURL(f),
        source: 'local', duration: 0, openUrl: ''
      });
    }
    regTracks(tracks);
    const id = createPlaylist('Мои файлы', '');
    state.playlists.find(p => p.id === id).trackIds = tracks.map(t => t.id);
    store.set('playlists', state.playlists);
    renderHome();
    closeModal();
    toast('Добавлено файлов: ' + files.length + ' ✓'); haptic('success');
    goto('library');
  });
}

/* --- Общий флоу импорта: ссылка -> подтверждение -> куда добавить --- */
let imp = null; // { name, tracks, selected }

function impStatus (msg, err) {
  const el = $('#impStatus');
  if (!el) return;
  el.innerHTML = msg
    ? '<div class="imp-status' + (err ? ' err' : '') + '">' + msg + '</div>'
    : '';
}
function impBusy (on, msg) {
  impStatus(on
    ? '<div class="progress-line"><i></i></div><p class="hint" style="margin:10px 0 0">' + (msg || 'Загружаю…') + '</p>'
    : '');
}
function showImportConfirm (res) {
  imp = { name: res.name || 'Импорт', tracks: res.tracks || [], selected: (res.tracks || []).map((_, i) => i) };
  impStatus('');
  $('#impResult').innerHTML =
    '<div class="confirm-head"><b>Найдено: ' + imp.tracks.length + ' треков</b><span>' + esc(imp.name) + '</span></div>' +
    '<div class="pick-list" id="impPreview">' + imp.tracks.slice(0, 80).map((t, i) =>
      '<div class="pick sel" data-i="' + i + '">' +
        '<img loading="lazy" alt="" src="' + esc(t.cover || phCover(t.title + t.artist)) + '">' +
        '<div class="pick-body"><div class="pick-name">' + esc(t.title) + '</div>' +
        '<div class="pick-sub">' + esc(t.artist) + '</div></div>' +
        '<div class="check"><svg class="ic"><use href="#i-check"/></svg></div>' +
      '</div>').join('') + '</div>' +
    (imp.tracks.length > 80 ? '<p class="note">Показаны первые 80 — добавятся все ' + imp.tracks.length + '.</p>' : '') +
    '<div class="modal-actions"><button class="btn primary" id="impConfirm">Подтвердить</button></div>';
  $$('#impPreview .pick').forEach(x => x.addEventListener('click', () => { x.classList.toggle('sel'); haptic('impact'); }));
  $('#impConfirm').addEventListener('click', showImportDestinations);
  haptic('success');
}
function showImportDestinations () {
  const sel = $$('#impPreview .pick.sel').map(x => +x.dataset.i);
  if (sel.length) imp.selected = sel;
  if (!imp.selected.length) return toast('Выбери хотя бы один трек', true);
  $('#impResult').innerHTML =
    '<div class="confirm-head"><b>Куда добавить</b><span>' + imp.selected.length + ' треков</span></div>' +
    '<div class="dest-list">' +
      '<button class="dest" data-dest="new">' +
        '<span class="sec-icon"><svg class="ic"><use href="#i-plus"/></svg></span>' +
        '<span class="dest-body"><b>Добавить папку</b><span>Создам новый плейлист</span></span></button>' +
      '<button class="dest" data-dest="folder">' +
        '<span class="sec-icon"><svg class="ic"><use href="#i-folder"/></svg></span>' +
        '<span class="dest-body"><b>Добавить в папку VK Music</b><span>Общий плейлист импорта</span></span></button>' +
      '<button class="dest" data-dest="fav">' +
        '<span class="sec-icon"><svg class="ic"><use href="#i-heart"/></svg></span>' +
        '<span class="dest-body"><b>Добавить в «Мне нравится»</b><span>Попадёт в избранное</span></span></button>' +
    '</div>';
  $$('#impResult [data-dest]').forEach(b => b.addEventListener('click', () => applyImportDest(b.dataset.dest)));
}
function applyImportDest (dest) {
  const list = imp.selected.map(i => imp.tracks[i]).filter(Boolean);
  if (!list.length) return;
  if (dest === 'new') {
    if ($('#impNewName')) return;
    $('#impResult').insertAdjacentHTML('beforeend',
      '<div class="field-card" style="margin-top:14px">' +
      '<div class="field-row"><label>Название папки</label></div>' +
      '<input type="text" id="impNewName" value="' + esc(imp.name) + '">' +
      '<div class="modal-actions"><button class="btn primary" id="impNewOk">Создать и добавить</button></div></div>');
    $('#impNewName').focus();
    $('#impNewOk').addEventListener('click', () => {
      const nm = $('#impNewName').value.trim();
      if (!nm) return;
      commitImport(ensurePlaylist(nm), list);
    });
    return;
  }
  if (dest === 'folder') return commitImport(ensurePlaylist('VK Music'), list);
  commitImport(favPlaylist(), list);
}
function commitImport (pl, list) {
  const added = addTracksToPlaylist(pl, list);
  closeModal();
  renderImportCards();
  haptic('success');
  toast(added ? 'Добавлено в «' + pl.name + '»: ' + added : 'Всё это уже было в плейлисте');
  goto('library');
}
function showImportPicker (albums, title) {
  impStatus('');
  $('#impResult').innerHTML =
    '<div class="confirm-head"><b>' + esc(title || 'Выбери плейлист') + '</b></div>' +
    '<div class="pick-list" id="impAlbums">' + albums.map((a, i) =>
      '<div class="pick" data-a="' + i + '">' +
        '<img loading="lazy" alt="" src="' + esc(a.cover || phCover(a.name)) + '">' +
        '<div class="pick-body"><div class="pick-name">' + esc(a.name) + '</div>' +
        '<div class="pick-sub">' + (a.count ? a.count + ' треков' : '') + '</div></div>' +
        '<svg class="ic" style="color:var(--muted)"><use href="#i-ext"/></svg>' +
      '</div>').join('') + '</div>';
  $$('#impAlbums .pick').forEach(x => x.addEventListener('click', async () => {
    const a = albums[+x.dataset.a];
    impBusy(true, 'Загружаю «' + esc(a.name) + '»…');
    try {
      const tracks = regTracks(await a.fetch());
      impBusy(false);
      if (!tracks.length) throw new Error('Плейлист пуст');
      showImportConfirm({ name: a.name, cover: a.cover, tracks });
    } catch (e) { impBusy(false); impStatus(esc(e.message), true); }
  }));
}
function openLinkImportModal (o) {
  openModal(
    '<h3>' + esc(o.title) + '</h3>' +
    '<p class="sub">Вставь ссылку на плейлист, альбом или профиль — я найду музыку и предложу, куда её добавить.</p>' +
    '<div class="field-card">' +
      '<div class="field-row"><label>Ссылка</label>' +
        '<span class="tag ' + o.tag + (o.connected ? ' ok' : '') + '">' + (o.connected ? 'подключено' : 'нужен доступ') + '</span></div>' +
      '<input type="text" id="impLink" placeholder="' + esc(o.placeholder) + '" value="' + esc(o.lastLink || '') + '">' +
      '<button class="btn primary wide" id="impFind"><svg class="ic"><use href="#i-search"/></svg> Найти музыку</button>' +
    '</div>' +
    '<div id="impStatus"></div>' +
    (o.connected ? '' :
      '<details class="details"><summary>Музыка не находится? Подключи доступ</summary>' +
        '<div style="margin-top:10px">' + o.connectHtml + '</div>' +
      '</details>') +
    (o.extraHtml || '') +
    '<div id="impResult"></div>');
  $('#impFind').addEventListener('click', o.onFind);
  $('#impLink').addEventListener('keydown', e => { if (e.key === 'Enter') o.onFind(); });
  if (!o.connected && o.bindConnect) o.bindConnect();
  if (o.bindExtra) o.bindExtra();
}

/* --- Spotify --- */
function openSpotifyImport () {
  const connected = Sources.spotify.isConnected();
  openLinkImportModal({
    title: 'Spotify', tag: 't-spotify', connected,
    lastLink: settings.spLastLink || '',
    placeholder: 'https://open.spotify.com/playlist/37i9dQZF1DX...',
    onFind: spFindByLink,
    extraHtml: connected
      ? '<div class="modal-actions"><button class="btn ghost" id="spMine">Выбрать из моих плейлистов</button></div>' : '',
    bindExtra: connected ? () => $('#spMine').addEventListener('click', spLoadMine) : null,
    connectHtml:
      '<div class="field-card">' +
        '<div class="field-row"><label>Client ID</label></div>' +
        '<input type="text" id="spCid" placeholder="1a2b3c4d..." value="' + esc(settings.spotifyClientId) + '">' +
        '<div class="field-row" style="margin-top:9px"><label>или Access Token</label></div>' +
        '<input type="text" id="spTok" placeholder="BQ..." value="' + esc(settings.spotifyToken) + '">' +
        '<button class="btn primary wide" id="spConnect">Подключить</button>' +
        '<ol class="steps"><li>Открой <b>developer.spotify.com → Create app</b></li>' +
        '<li>Redirect URI укажи: <b>' + esc(Sources.spotify.redirectUri()) + '</b></li>' +
        '<li>Скопируй Client ID сюда</li></ol>' +
      '</div>',
    bindConnect: () => {
      $('#spConnect').addEventListener('click', async () => {
        const cid = $('#spCid').value.trim(), tok = $('#spTok').value.trim();
        settings.spotifyClientId = cid; settings.spotifyToken = tok;
        Sources.getCfg().spotifyClientId = cid;
        store.set('settings', settings);
        try {
          if (tok) {
            Sources.getCfg().spotifyAccessToken = tok;
            Sources.getCfg().spotifyExpiresAt = Date.now() + 3600 * 1000;
            await Sources.spotify.api('/me');
          } else if (cid) {
            location.href = await Sources.spotify.authUrl(cid);
            return;
          } else throw new Error('Укажи Client ID или токен');
          Sources.getCfg().spotifyRefreshToken = '';
          renderStatuses(); renderImportCards();
          toast('Spotify подключён ✓'); haptic('success');
          closeModal();
          setTimeout(() => openSpotifyImport(), 350);
        } catch (e) { impStatus(esc(e.message), true); }
      });
    }
  });
}
async function spFindByLink () {
  const link = $('#impLink').value.trim();
  if (!link) return toast('Вставь ссылку Spotify', true);
  const p = Sources.spotify.parseLink(link);
  if (!p) {
    impStatus('Примеры: <b>https://open.spotify.com/playlist/…</b>, <b>…/album/…</b>, <b>…/track/…</b>', true);
    return;
  }
  settings.spLastLink = link; store.set('settings', settings);
  impBusy(true, 'Ищу музыку по ссылке…');
  try {
    if (!Sources.spotify.isConnected()) throw new Error('Spotify скрывает плейлисты без доступа — раскрой раздел ниже');
    const res = await Sources.spotify.findByLink(p);
    impBusy(false);
    if (!res.tracks.length) throw new Error('По ссылке ничего не найдено');
    showImportConfirm(res);
  } catch (e) { impBusy(false); impStatus(esc(e.message), true); }
}
async function spLoadMine () {
  impBusy(true, 'Загружаю мои плейлисты…');
  try {
    const lists = await Sources.spotify.playlists();
    impBusy(false);
    showImportPicker(lists, 'Мои плейлисты Spotify');
  } catch (e) { impBusy(false); impStatus(esc(e.message), true); }
}

/* --- VK --- */
function openVkImport () {
  const connected = Sources.vk.isConnected();
  openLinkImportModal({
    title: 'VK Музыка', tag: 't-vk', connected,
    lastLink: settings.vkLastLink || '',
    placeholder: 'https://vk.com/music?z=audio-1_123 или https://vk.com/username',
    onFind: vkFindByLink,
    connectHtml:
      '<div class="field-card">' +
        '<div class="field-row"><label>Access Token</label></div>' +
        '<input type="text" id="vkTok" placeholder="vk1.a.xxx" value="' + esc(settings.vkToken) + '">' +
        '<div class="field-row" style="margin-top:9px"><label>или ID приложения для входа</label></div>' +
        '<input type="text" id="vkApp" placeholder="например 123456">' +
        '<div class="modal-actions">' +
          '<button class="btn primary" id="vkSave">Сохранить</button>' +
          '<button class="btn ghost" id="vkAuth">Войти через VK</button>' +
        '</div>' +
        '<ol class="steps"><li>Redirect URI приложения: <b>' + esc(location.origin + location.pathname) + '</b></li>' +
        '<li>Права: <b>audio, offline</b></li><li>Если audio.get недоступен — метод закрыт на стороне VK</li></ol>' +
      '</div>',
    bindConnect: () => {
      $('#vkSave').addEventListener('click', async () => {
        const t = $('#vkTok').value.trim();
        if (!t) return impStatus('Вставь токен', true);
        settings.vkToken = t; Sources.getCfg().vkToken = t; store.set('settings', settings);
        try {
          await Sources.vk.uid();
          renderStatuses(); renderImportCards();
          toast('VK подключён ✓'); haptic('success');
          closeModal(); setTimeout(() => openVkImport(), 350);
        } catch (e) { impStatus(esc(e.message), true); }
      });
      $('#vkAuth').addEventListener('click', () => {
        const app = $('#vkApp').value.trim();
        if (!app) return impStatus('Укажи ID приложения VK', true);
        location.href = Sources.vk.authUrl(app, location.origin + location.pathname);
      });
    }
  });
}
/* VK часто отдаёт «закрытую» музыку как ошибку доступа — переводим в понятный текст */
function vkErrFriendly (e) {
  const m = String((e && e.message) || e || '');
  const code = (m.match(/VK error (\d+)/) || [])[1];
  const closed = ['201', '204', '219', '170', '103', '30'].includes(code) ||
    /access denied|access to audio|no permission|permission denied|private|скрыт|закрыт|запрещ/i.test(m);
  if (closed) return 'Закрыт доступ к музыке — этот профиль скрывает аудиозаписи от всех.';
  if (code) return 'VK ответил ошибкой ' + code + '. Проверь, что музыка открыта, или попробуй позже.';
  return m || 'Не удалось получить музыку из VK.';
}
async function vkFindByLink () {
  const link = $('#impLink').value.trim();
  if (!link) return toast('Вставь ссылку VK', true);
  const p = Sources.vk.parseLink(link);
  if (!p) {
    impStatus('Примеры: <b>https://vk.com/music?z=audio-1_123456</b>, <b>https://vk.com/username</b>, <b>https://vk.com/club1</b>', true);
    return;
  }
  settings.vkLastLink = link; store.set('settings', settings);
  impBusy(true, 'Ищу музыку по ссылке…');
  try {
    if (!Sources.vk.isConnected()) throw new Error('VK скрывает аудио без подтверждения — раскрой раздел ниже');
    let owner = p.owner;
    if (p.type === 'screen') owner = await Sources.vk.ownerByScreen(p.screen);
    if (p.type === 'audio' && !owner) owner = await Sources.vk.uid();
    if (p.type === 'album') {
      const tracks = await Sources.vk.audioOf(owner, p.albumId);
      impBusy(false);
      if (!tracks.length) throw new Error('Плейлист пуст или недоступен');
      return showImportConfirm({ name: p.label, tracks });
    }
    if (p.type === 'audio') {
      const all = await Sources.vk.audioOf(owner);
      impBusy(false);
      const one = all.find(t => t.id === 'vk:' + p.audioId);
      if (one) return showImportConfirm({ name: one.title, cover: one.cover, tracks: [one] });
      if (!all.length) throw new Error('Аудио не найдено');
      return showImportConfirm({ name: p.label, tracks: all });
    }
    // профиль / группа
    const albums = await Sources.vk.albumsOf(owner).catch(() => []);
    if (albums.length > 1) {
      impBusy(false);
      return showImportPicker(albums.map(al => ({
        name: al.title || 'Плейлист VK', cover: al.thumb || '', count: al.count,
        fetch: () => Sources.vk.audioOf(owner, al.id)
      })), 'Плейлисты профиля');
    }
    const tracks = await Sources.vk.audioOf(owner, albums.length ? albums[0].id : null);
    impBusy(false);
    if (!tracks.length) throw new Error('Закрыт доступ к музыке — этот профиль скрывает аудиозаписи от всех.');
    showImportConfirm({ name: albums.length ? albums[0].title : p.label, tracks });
  } catch (e) { impBusy(false); impStatus(esc(vkErrFriendly(e)), true); }
}

/* --- Яндекс --- */
function openYandexImport () {
  const connected = Sources.yandex.isConnected();
  openLinkImportModal({
    title: 'Яндекс Музыка', tag: 't-yandex', connected,
    lastLink: settings.ymLastLink || '',
    placeholder: 'https://music.yandex.ru/users/username/playlists/1002',
    onFind: yaFindByLink,
    connectHtml:
      '<div class="field-card">' +
        '<div class="field-row"><label>Access Token</label></div>' +
        '<input type="text" id="ymTok" placeholder="y0_AgAAAA..." value="' + esc(settings.yaToken) + '">' +
        '<div class="field-row" style="margin-top:9px"><label>или Client ID для OAuth-входа</label></div>' +
        '<input type="text" id="ymCid" placeholder="Client ID" value="' + esc(settings.yaClientId) + '">' +
        '<div class="modal-actions">' +
          '<button class="btn primary" id="ymSave">Сохранить</button>' +
          '<button class="btn ghost" id="ymAuth">Войти через Яндекс</button>' +
        '</div>' +
        '<ol class="steps"><li>Приложение создать: <b>oauth.yandex.ru</b></li>' +
        '<li>Redirect URI: <b>' + esc(location.origin + location.pathname) + '</b></li>' +
        '<li>Ссылки будут читаться автоматически после сохранения токена</li></ol>' +
      '</div>',
    bindConnect: () => {
      $('#ymSave').addEventListener('click', async () => {
        const t = $('#ymTok').value.trim(), cid = $('#ymCid').value.trim();
        if (!t) return impStatus('Вставь токен', true);
        settings.yaToken = t; settings.yaClientId = cid;
        Sources.getCfg().yaToken = t; Sources.getCfg().yaClientId = cid;
        store.set('settings', settings);
        try {
          await Sources.yandex.uid();
          renderStatuses(); renderImportCards();
          toast('Яндекс подключён ✓'); haptic('success');
          closeModal(); setTimeout(() => openYandexImport(), 350);
        } catch (e) { impStatus(esc(e.message), true); }
      });
      $('#ymAuth').addEventListener('click', () => {
        const cid = $('#ymCid').value.trim();
        if (!cid) return impStatus('Укажи Client ID', true);
        location.href = Sources.yandex.authUrl(cid, location.origin + location.pathname);
      });
    }
  });
}
async function yaFindByLink () {
  const link = $('#impLink').value.trim();
  if (!link) return toast('Вставь ссылку Яндекс Музыки', true);
  const p = Sources.yandex.parseLink(link);
  if (!p) {
    impStatus('Примеры: <b>https://music.yandex.ru/users/username/playlists/1002</b>, ' +
      '<b>…/users/username</b>, <b>…/albums/123</b>, <b>…/track/456</b>', true);
    return;
  }
  settings.ymLastLink = link; store.set('settings', settings);
  impBusy(true, 'Ищу музыку по ссылке…');
  try {
    if (!Sources.yandex.isConnected()) throw new Error('Яндекс требует OAuth — раскрой раздел ниже');
    const res = await Sources.yandex.findByLink(p);
    impBusy(false);
    if (res.albums) {
      if (!res.albums.length) throw new Error('У пользователя нет открытых плейлистов');
      return showImportPicker(res.albums, 'Плейлисты ' + res.name);
    }
    if (!res.tracks.length) throw new Error('По ссылке ничего не найдено');
    showImportConfirm(res);
  } catch (e) { impBusy(false); impStatus(esc(e.message), true); }
}

/* ============ НАСТРОЙКИ ============ */
function bindSettings () {
  $('#setSpotifyId').value = settings.spotifyClientId;
  $('#setSpotifyToken').value = settings.spotifyToken;
  $('#setVkToken').value = settings.vkToken;
  $('#setYaToken').value = settings.yaToken;
  $('#setYaClientId').value = settings.yaClientId;
  $('#setVolume').value = settings.volume;
  $('#setVolumeVal').textContent = settings.volume + '%';

  $('#setVolume').addEventListener('input', e => setVolume(+e.target.value / 100));
  // поле прокси скрыто из UI; URL прокси зашит в Sources.cfg.proxy по умолчанию
  if ($('#setProxy')) {
    $('#setProxy').value = settings.proxy;
    $('#setProxy').addEventListener('change', e => {
      settings.proxy = e.target.value.trim();
      store.set('settings', settings);
      Sources.configure({ proxy: settings.proxy });
      toast('Прокси сохранён');
    });
  }
  $('#btnConnectSpotify').addEventListener('click', () => { goto('import'); setTimeout(() => openSpotifyImport(), 250); });
  $('#btnSaveVk').addEventListener('click', async () => {
    const t = $('#setVkToken').value.trim();
    settings.vkToken = t; Sources.getCfg().vkToken = t; store.set('settings', settings);
    try { await Sources.vk.uid(); toast('VK подключён ✓'); haptic('success'); }
    catch (e) { toast(e.message, true); }
    renderStatuses(); renderImportCards();
  });
  $('#btnSaveYa').addEventListener('click', async () => {
    const t = $('#setYaToken').value.trim();
    settings.yaToken = t; Sources.getCfg().yaToken = t; store.set('settings', settings);
    try { await Sources.yandex.uid(); toast('Яндекс подключён ✓'); haptic('success'); }
    catch (e) { toast(e.message, true); }
    renderStatuses(); renderImportCards();
  });
  $('#setYaClientId').addEventListener('change', e => {
    settings.yaClientId = e.target.value.trim();
    Sources.getCfg().yaClientId = settings.yaClientId;
    store.set('settings', settings);
  });
  $('#setSpotifyId').addEventListener('change', e => {
    settings.spotifyClientId = e.target.value.trim();
    Sources.getCfg().spotifyClientId = settings.spotifyClientId;
    store.set('settings', settings);
  });
  $('#setSpotifyToken').addEventListener('change', e => {
    settings.spotifyToken = e.target.value.trim();
    store.set('settings', settings);
  });
  $('#btnYaAuth').addEventListener('click', () => {
    const cid = $('#setYaClientId').value.trim();
    if (!cid) return toast('Сначала укажи Client ID', true);
    settings.yaClientId = cid; Sources.getCfg().yaClientId = cid; store.set('settings', settings);
    location.href = Sources.yandex.authUrl(cid, location.origin + location.pathname);
  });
  $('#btnClearData').addEventListener('click', () => {
    if (!confirm('Удалить все плейлисты, токены и кэш?')) return;
    Object.keys(localStorage).filter(k => k.startsWith('mma')).forEach(k => localStorage.removeItem(k));
    location.reload();
  });
}

/* ============ ПЛЕЕР — события ============ */
$('#btnPlay').addEventListener('click', togglePlay);
$('#miniPlay').addEventListener('click', e => { e.stopPropagation(); togglePlay(); });
$('#btnNext').addEventListener('click', () => nextTrack(false));
$('#miniNext').addEventListener('click', e => { e.stopPropagation(); nextTrack(false); });
$('#btnPrev').addEventListener('click', prevTrack);
$('#btnShuffle').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  $('#btnShuffle').classList.toggle('on', state.shuffle);
  toast(state.shuffle ? 'Перемешивание: вкл' : 'Перемешивание: выкл');
  haptic('impact');
});
$('#btnRepeat').addEventListener('click', () => {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  const b = $('#btnRepeat');
  b.classList.toggle('on', state.repeat !== 'off');
  b.classList.toggle('cyc', state.repeat === 'one');
  toast('Повтор: ' + (state.repeat === 'off' ? 'выкл' : state.repeat === 'all' ? 'весь список' : 'один трек'));
  haptic('impact');
});
$('#seek').addEventListener('input', e => {
  if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
});
$('#volume').addEventListener('input', e => setVolume(+e.target.value / 100));
$('#btnMute').addEventListener('click', () => {
  if (state.muted || state.volume === 0) setVolume(0.8);
  else { state.muted = true; audio.muted = true; $('#btnMute').innerHTML = '<svg class="ic"><use href="#i-mute"/></svg>'; }
});

function openFullPlayer () {
  if (!currentTrack()) return;
  $('#fullPlayer').classList.add('open');
  $('#fullPlayer').setAttribute('aria-hidden', 'false');
  $('#fpBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (TG && TG.BackButton) { try { TG.BackButton.show(); } catch (e) {} }
}
function closeFullPlayer () {
  $('#fullPlayer').classList.remove('open');
  $('#fullPlayer').setAttribute('aria-hidden', 'true');
  $('#fpBackdrop').classList.remove('open');
  document.body.style.overflow = '';
  if (TG && TG.BackButton) { try { TG.BackButton.hide(); } catch (e) {} }
}
$('#miniOpen').addEventListener('click', openFullPlayer);
$('#miniCoverBox').addEventListener('click', openFullPlayer);
$('#fpClose').addEventListener('click', closeFullPlayer);
$('#fpBackdrop').addEventListener('click', closeFullPlayer);
if (TG && TG.BackButton) {
  try {
    TG.BackButton.onClick(() => {
      if ($('#fullPlayer').classList.contains('open')) closeFullPlayer();
      else if (!$('#playlistSheet').hidden) closeSheet();
      else if (!$('#modal').hidden) closeModal();
    });
  } catch (e) {}
}
$('#fpQueueBtn').addEventListener('click', () => {
  const q = $('#fpQueue');
  q.hidden = !q.hidden;
  if (!q.hidden) renderQueue();
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight' && e.shiftKey) nextTrack(false);
  if (e.code === 'ArrowLeft' && e.shiftKey) prevTrack();
});

/* ============ OAuth-редиректы при загрузке ============ */
async function handleRedirects () {
  const sp = new URLSearchParams(location.search);
  const code = sp.get('code');
  const stateP = sp.get('state');
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));

  if (code && settings.spotifyClientId) {
    try {
      await Sources.spotify.handleCode(code);
      toast('Spotify авторизован ✓'); haptic('success');
      history.replaceState(null, '', location.pathname);
      renderStatuses(); renderImportCards();
      goto('import'); setTimeout(() => openSpotifyImport(), 400);
      return;
    } catch (e) { toast('Spotify: ' + e.message, true); }
  }
  const yt = hash.get('access_token');
  if (yt && stateP === 'vk') {
    settings.vkToken = yt; Sources.getCfg().vkToken = yt; store.set('settings', settings);
    toast('VK авторизован ✓'); haptic('success');
    history.replaceState(null, '', location.pathname);
    renderStatuses(); renderImportCards();
    goto('import'); setTimeout(() => openVkImport(), 400);
    return;
  }
  if (yt && (hash.get('token_type') || hash.get('token_type') === 'Bearer')) {
    settings.yaToken = yt; Sources.getCfg().yaToken = yt; store.set('settings', settings);
    toast('Яндекс авторизован ✓'); haptic('success');
    history.replaceState(null, '', location.pathname);
    renderStatuses(); renderImportCards();
    goto('import'); setTimeout(() => openYandexImport(), 400);
    return;
  }
  if (stateP === 'vk' && !yt) {
    const err = hash.get('error') || sp.get('error') || 'отменено';
    toast('Авторизация VK: ' + err, true);
    history.replaceState(null, '', location.pathname);
  }
  if (yt && !stateP && !hash.get('token_type')) {
    settings.vkToken = yt; Sources.getCfg().vkToken = yt; store.set('settings', settings);
    history.replaceState(null, '', location.pathname);
  }
}

/* ============ INIT ============ */
function renderUser () {
  const box = $('#sideUser');
  if (!box) return;
  const u = (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) || null;
  box.hidden = false;
  const name = u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : 'Гость';
  const handle = u && u.username ? '@' + u.username : (u ? 'Telegram' : 'в офлайне');
  $('#sideName').textContent = name;
  $('#sideHandle').textContent = handle;
  const img = $('#sideAvatar');
  const initial = name.trim().charAt(0).toUpperCase() || '♪';
  const ph = document.createElement('div');
  ph.className = 'ph-avatar';
  ph.textContent = initial;
  if (u && u.photo_url) {
    img.src = u.photo_url;
    img.onerror = () => img.replaceWith(ph);
  } else {
    img.replaceWith(ph);
  }
}
async function init () {
  Sources.configure({
    proxy: settings.proxy,
    spotifyClientId: settings.spotifyClientId,
    spotifyAccessToken: settings.spotifyToken,
    spotifyExpiresAt: settings.spotifyToken ? Date.now() + 3600 * 1000 : 0,
    vkToken: settings.vkToken,
    yaToken: settings.yaToken,
    yaClientId: settings.yaClientId
  });

  setVolume(settings.volume / 100);
  audio.volume = state.volume;
  bindSettings();
  renderUser();
  renderHome();
  renderImportCards();
  renderStatuses();
  updatePlayButtons();

  const hour = new Date().getHours();
  $('#heroKicker').textContent = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  await resolveLocalTracks();
  await handleRedirects();
  loadTrends();

  if (TG) {
    try { TG.ready(); TG.expand(); } catch (e) {}
  }
}
init();

})();
