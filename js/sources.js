/* ============ LarpMusic — источники музыки ============ */
window.Sources = (function () {
  const cfg = {
    proxy: 'https://www.extravisualdlc.online/api/proxy',
    // запасной прокси (Cloudflare Worker): основной белый список уже не изменить
    // (репо удалён), а CF-воркер владелец может обновить — туда уходят хосты
    // вне списка основного (open.spotify.com, региональные домены Яндекса)
    proxy2: 'https://larpmusic-proxy.wawerave.workers.dev',
    spotifyClientId: '',
    spotifyAccessToken: '',
    spotifyExpiresAt: 0,
    spotifyRefreshToken: '',
    vkToken: '',
    sharedVkToken: '',   // общий токен-донор: поиск VK для всех пользователей (вставь свой токен)
    yaToken: '',
    yaClientId: ''
  };

  function configure (o) { Object.assign(cfg, o || {}); }
  function getCfg () { return cfg; }

  /* ---------- HTTP: прямой запрос -> fallback на прокси ---------- */
  function proxied (url, which) {
    const p = (which === 2 ? cfg.proxy2 : cfg.proxy) || '';
    if (!p) return null;
    return p + (p.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url);
  }
  // запрос через конкретный прокси (для смены канала, если основной отклонил хост)
  function viaProxy (url, opts, which) {
    const p = proxied(url, which);
    if (!p) return Promise.reject(new Error('Прокси не настроен'));
    return fetchTo(p, opts, REQ_TIMEOUT);
  }

  const REQ_TIMEOUT = 8000;
  function fetchTo (url, opts, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    return fetch(url, Object.assign({}, opts, { signal: c.signal }))
      .finally(() => clearTimeout(t));
  }
  async function http (url, opts = {}) {
    try {
      const r = await fetchTo(url, opts, REQ_TIMEOUT);
      if (r.ok) return r;
      if (r.status !== 403 && r.status !== 401) throw new Error('HTTP ' + r.status);
      const txt = await r.text().catch(() => '');
      const err = new Error('API ответил ' + r.status + (txt ? ': ' + txt.slice(0, 160) : ''));
      err.status = r.status;
      throw err;
    } catch (e) {
      // канал 1: основной прокси
      try {
        const r = await viaProxy(url, opts, 1);
        if (r.ok) return r;
        // хост вне белого списка / гео-блок / прокси споткнулся — пробуем запасной
        if ([403, 451, 502].includes(r.status) && cfg.proxy2 && cfg.proxy2 !== cfg.proxy) {
          const r2 = await viaProxy(url, opts, 2);
          if (r2.ok) return r2;
        }
        const txt = await r.text().catch(() => '');
        let msg = 'Прокси: ' + r.status + (txt ? ' ' + txt.slice(0, 160) : '');
        if (r.status === 403 && /вне белого списка/i.test(txt) && /spotify|yandex/i.test(url)) {
          msg += ' — host ещё не добавлен в прокси. Обнови cloudflare-worker.js в Cloudflare.';
        }
        const err2 = new Error(msg);
        err2.status = r.status;
        throw err2;
      } catch (e2) {
        if (e2 && e2.status) throw e2;
        throw e2 instanceof Error ? e2 : e;
      }
    }
  }
  const httpGet = (url, headers) => http(url, headers ? { headers } : {});
  async function httpJson (url, headers) { const r = await httpGet(url, headers); return r.json(); }
  async function httpPost (url, body, headers) {
    const r = await http(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}),
      body
    });
    return r.json();
  }

  function b64url (bytes) {
    let s = '';
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const uid = (p) => p + ':' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  /* ================= AUDIUS (полные треки, без ключей) ================= */
  const audius = {
    host: null,
    fallbacks: [
      'https://discoveryprovider.audius.co',
      'https://discoveryprovider2.audius.co',
      'https://discoveryprovider3.audius.co',
      'https://discoveryprovider4.audius.co'
    ],
    async ensureHost () {
      if (audius.host) return audius.host;
      // 1) официальный список хостов
      try {
        const d = await httpJson('https://api.audius.co');
        const hosts = (d.data || []).filter(h => /^https:\/\//.test(h));
        if (hosts.length) {
          audius.host = hosts[Math.floor(Math.random() * hosts.length)].replace(/\/+$/, '');
          return audius.host;
        }
      } catch (e) { /* попробуем резервные */ }
      // 2) резервные хосты: берём первый, который ответил
      for (const h of audius.fallbacks) {
        try {
          const r = await httpGet(h + '/v1/health_check?app_name=MBMusic');
          if (r.ok || r.status === 404) { audius.host = h; return h; }
        } catch (e) { /* следующий */ }
      }
      return null;
    },
    mapTrack (t) {
      return {
        id: 'audius:' + t.id,
        title: t.title || 'Без названия',
        artist: (t.user && t.user.name) || 'Неизвестен',
        album: '',
        cover: (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'])) || '',
        url: '',  // url подставляется при поиске (нужен host)
        source: 'internet',
        duration: t.duration || 0,
        openUrl: t.permalink ? 'https://audius.co' + t.permalink : ''
      };
    },
    async searchOnce (host, q) {
      const d = await httpJson(host + '/v1/tracks/search?query=' + encodeURIComponent(q) +
        '&limit=30&app_name=MBMusic');
      return (d.data || []).map(t => {
        const m = audius.mapTrack(t);
        m.url = host + '/v1/tracks/' + t.id + '/stream?app_name=MBMusic';
        return m;
      }).filter(t => t.title);
    },
    async search (q) {
      // без health_check (лишний запрос): сразу ищем по хостам, берём первый живой
      let hosts = [];
      if (audius.host) hosts.push(audius.host);
      try {
        const d = await httpJson('https://api.audius.co');
        hosts = hosts.concat((d.data || []).filter(h => /^https:\/\//.test(h)));
      } catch (e) { /* официальный список недоступен — используем статические */ }
      hosts = hosts.concat(audius.fallbacks);
      const tried = new Set();
      for (const raw of hosts) {
        const h = String(raw).replace(/\/+$/, '');
        if (!h || tried.has(h)) continue;
        tried.add(h);
        if (tried.size > 3) break;
        try {
          const arr = await audius.searchOnce(h, q);
          if (arr.length) { audius.host = h; return arr; }
        } catch (e) { /* следующий хост */ }
      }
      return [];
    }
  };

  /* "4:05" / "1:02:03" / "253.5" -> секунды (иначе parseFloat("4:05")=4 и треки теряются) */
  function parseLen (v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
    const p = s.split(':').map(x => parseFloat(x) || 0);
    if (p.length === 3) return Math.round(p[0] * 3600 + p[1] * 60 + p[2]);
    if (p.length === 2) return Math.round(p[0] * 60 + p[1]);
    return Math.round(parseFloat(s) || 0);
  }

  /* ================= ARCHIVE.ORG (полные треки, без ключей) ================= */
  const archive = {
    mapFile (item, f) {
      const name = f.name || '';
      return {
        id: 'arch:' + item.identifier + '/' + encodeURIComponent(name),
        title: f.title || item.title || name.replace(/\.[a-z0-9]+$/i, ''),
        artist: (Array.isArray(item.creator) ? item.creator.join(', ') : item.creator) || 'Archive.org',
        album: (f.title && item.title) ? item.title : '',
        cover: 'https://archive.org/services/img/' + item.identifier,
        url: 'https://archive.org/download/' + item.identifier + '/' +
             name.split('/').map(encodeURIComponent).join('/'),
        source: 'internet',
        duration: parseLen(f.length),
        openUrl: 'https://archive.org/details/' + item.identifier
      };
    },
    async search (q) {
      const sUrl = 'https://archive.org/advancedsearch.php?q=' +
        encodeURIComponent('mediatype:(audio) AND ("' + q + '")') +
        '&fl[]=identifier&fl[]=title&fl[]=creator&rows=12&output=json';
      let d;
      try { d = await httpJson(sUrl); } catch (e) { return []; }
      const docs = (d.response && d.response.docs) || [];
      if (!docs.length) return [];
      const out = [];
      await Promise.all(docs.slice(0, 5).map(async item => {
        try {
          const m = await httpJson('https://archive.org/metadata/' + item.identifier);
          const files = (m.files || [])
            .filter(f => /\.mp3$/i.test(f.name || '') && parseLen(f.length) > 30);
          files.slice(0, 2).forEach(f => out.push(archive.mapFile(item, f)));
        } catch (e) { /* альбом пропускаем */ }
      }));
      return out.filter(t => t.title);
    }
  };

  /* ================= SOUNDCLOUD (полные треки, без ключей) ================= */
  /* client_id берём из bootstrap-конфига страницы soundcloud.com (32-символьный
     литерал), запасной путь — из js-бандлов (имена файлов содержат дефисы!).
     API-запросы идут через прокси (у api-v2 нет CORS), а сам звук — напрямую
     с их CDN: у плейлистов и сегментов Access-Control-Allow-Origin: *.
     Современные треки отдаются только HLS (aac в mp4) — их играет hls.js,
     старые — прямым mp3. */
  const soundcloud = {
    clientId: null,
    async getId () {
      if (soundcloud.clientId) return soundcloud.clientId;
      try {
        const html = await (await httpGet('https://soundcloud.com')).text();
        // 1) client_id лежит прямо в конфиге HTML-страницы
        const m = html.match(/"[a-zA-Z0-9]{32}"/);
        if (m) { soundcloud.clientId = m[0].slice(1, -1); return soundcloud.clientId; }
        // 2) запасной путь: скан js-бандлов (как yt-dlp)
        const js = html.match(/https?:\/\/a-v2\.sndcdn\.com\/assets\/[\w.-]+\.js/g) || [];
        for (const u of js.slice(-4).reverse()) {
          try {
            const body = await (await httpGet(u)).text();
            const c = body.match(/client_id["']?\s*:\s*["']([a-zA-Z0-9]{20,40})["']/);
            if (c) { soundcloud.clientId = c[1]; return c[1]; }
          } catch (e) { /* следующий бандл */ }
        }
      } catch (e) { /* сайт недоступен — источник молча пропустится */ }
      return null;
    },
    async api (path) {
      const id = await soundcloud.getId();
      if (!id) return null;
      return httpJson('https://api-v2.soundcloud.com' + path + (path.includes('?') ? '&' : '?') + 'client_id=' + id);
    },
    // playable-ссылка: новые треки — HLS (aac), старые — прямой mp3
    async streamUrl (t) {
      const id = await soundcloud.getId();
      if (!id) return null;
      const trs = (t.media && t.media.transcodings) || [];
      const mime = x => (((x || {}).format) || {}).mime_type || '';
      const proto = x => (((x || {}).format) || {}).protocol || '';
      const mp3 = trs.find(x => proto(x) === 'progressive' && /audio\/mpeg/.test(mime(x)));
      const hlsAac = trs
        .filter(x => proto(x) === 'hls' && /audio\/mp4/.test(mime(x)))
        .sort((a, b) => (b.preset === 'aac_160k') - (a.preset === 'aac_160k'))[0];
      const pick = mp3 || hlsAac;
      if (!pick) return null;
      const d = await httpJson(pick.url + (pick.url.includes('?') ? '&' : '?') + 'client_id=' + id);
      if (!d || !d.url) return null;
      return { url: d.url, hls: !mp3 };
    },
    async search (q) {
      const d = await soundcloud.api('/search/tracks?q=' + encodeURIComponent(q) + '&limit=20&offset=0');
      const col = (d && d.collection) ? d.collection : [];
      const out = await Promise.all(col.slice(0, 8).map(async t => {
        try {
          const full = (t.full_duration || t.duration || 0) / 1000;
          if (full < 60) return null;            // обрезки и 30-сек сниппеты не нужны
          const s = await soundcloud.streamUrl(t);
          if (!s || !s.url) return null;
          return {
            id: 'sc:' + t.id,
            scId: t.id,                    // для перевыпроса протухшей ссылки при воспроизведении
            title: String(t.title || '').replace(/\s+/g, ' ').trim() || 'Трек',
            artist: (t.user && t.user.username) || 'SoundCloud',
            album: '',
            cover: (t.artwork_url || (t.user && t.user.avatar_url) || '').replace('-large', '-t300x300'),
            url: s.url,
            hls: s.hls,
            source: 'Интернет',
            duration: Math.round(full),
            openUrl: t.permalink_url || ''
          };
        } catch (e) { return null; }
      }));
      return out.filter(Boolean);
    },

    /* перевыпрос потока по id трека: подписанные ссылки SoundCloud протухают ~за сутки */
    async refresh (t) {
      if (!t || !t.scId) return null;
      try {
        const d = await soundcloud.api('/tracks/' + t.scId);
        if (!d) return null;
        const s = await soundcloud.streamUrl(d);
        if (!s || !s.url) return null;
        return Object.assign({}, t, { url: s.url, hls: s.hls });
      } catch (e) { return null; }
    },

    /* импорт по ссылке: трек или плейлист (без токенов) */
    parseLink (raw) {
      let u;
      try { u = new URL(/^https?:/i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
      if (!/(^|\.)soundcloud\.com$/i.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/([^/]+)\/(sets|tracks)\/([^/]+)/);
      if (m) return { user: m[1], kind: m[2] === 'sets' ? 'playlist' : 'track', slug: m[3] };
      const t = u.pathname.match(/^\/([^/]+)\/([^/]+)$/);
      if (t) return { user: t[1], kind: 'track', slug: t[2] };
      return null;
    },
    async findByLink (p) {
      const url = 'https://soundcloud.com/' + p.user + '/' +
                  (p.kind === 'playlist' ? 'sets/' : '') + p.slug;
      const d = await soundcloud.api('/resolve?url=' + encodeURIComponent(url));
      if (!d) throw new Error('SoundCloud не ответил');
      if (d.kind === 'playlist') {
        const raw = d.tracks || [];
        const out = await Promise.all(raw.slice(0, 100).map(async t => {
          try {
            const full = (t.full_duration || t.duration || 0) / 1000;
            if (full < 30) return null;
            const s = await soundcloud.streamUrl(t);
            if (!s || !s.url) return null;
            return {
              id: 'sc:' + t.id, scId: t.id,
              title: String(t.title || 'Трек').replace(/\s+/g, ' ').trim(),
              artist: (t.user && t.user.username) || 'SoundCloud',
              album: d.title || '',
              cover: (t.artwork_url || '').replace('-large', '-t300x300'),
              url: s.url, hls: s.hls, source: 'Интернет',
              duration: Math.round(full),
              openUrl: t.permalink_url || ''
            };
          } catch (e) { return null; }
        }));
        const tracks = out.filter(Boolean);
        if (!tracks.length) throw new Error('В плейлисте нет воспроизводимых треков');
        return { name: d.title || 'Плейлист SoundCloud',
                 cover: (d.artwork_url || '').replace('-large', '-t300x300'),
                 tracks };
      }
      if (d.kind === 'track') {
        const s = await soundcloud.streamUrl(d);
        if (!s || !s.url) throw new Error('Трек недоступен для воспроизведения');
        return {
          name: d.title || 'Трек SoundCloud',
          cover: (d.artwork_url || '').replace('-large', '-t300x300'),
          tracks: [{
            id: 'sc:' + d.id, scId: d.id,
            title: String(d.title || 'Трек').replace(/\s+/g, ' ').trim(),
            artist: (d.user && d.user.username) || 'SoundCloud',
            album: '', cover: (d.artwork_url || '').replace('-large', '-t300x300'),
            url: s.url, hls: s.hls, source: 'Интернет',
            duration: Math.round((d.full_duration || d.duration || 0) / 1000),
            openUrl: d.permalink_url || ''
          }]
        };
      }
      throw new Error('Это не трек и не плейлист SoundCloud');
    }
  };

  /* ================= ИНТЕРНЕТ (SoundCloud + Audius + Archive.org + iTunes) ================= */
  const internet = {
    map (t) {
      const cover = (t.artworkUrl100 || '').replace('100x100bb', '600x600bb');
      return {
        id: 'internet:' + t.trackId,
        title: t.trackName || 'Без названия',
        artist: t.artistName || 'Неизвестен',
        album: t.collectionName || '',
        cover,
        url: t.previewUrl || '',           // 30-сек превью — играет без ключей
        source: 'internet',
        duration: Math.round((t.trackTimeMillis || 30000) / 1000),
        openUrl: t.trackViewUrl || ''
      };
    },
    async itunes (q) {
      const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(q) +
                  '&media=music&entity=song&limit=30';
      const data = await internet.jsonp(url, 8000); // JSONP — мгновенно и без CORS
      return (data.results || []).map(internet.map).filter(t => t.title);
    },
    // гонка с таймаутом: один зависший источник не блокирует поиск
    _race (p, ms = 8000) {
      return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);
    },
    async search (q) {
      // iTunes (30-сек превью) — в фоне: не тормозит выдачу, ТОЛЬКО если полных треков нет
      const prevP = internet._race(internet.itunes(q), 9000).catch(() => []);
      // полные треки: SoundCloud первым (огромный каталог), дальше Audius и Archive.org.
      // YouTube через Piped убран: публичные инстансы больше не отдают /streams.
      const full = await Promise.all([
        internet._race(soundcloud.search(q), 12000).catch(() => []),
        internet._race(audius.search(q), 10000).catch(() => []),
        internet._race(archive.search(q), 10000).catch(() => [])
      ]).then(r => r.reduce((acc, a) => acc.concat(a), []));
      // полные треки — всегда; 30-сек превью iTunes ТОЛЬКО если полных нет
      if (full.length) return full;
      return await prevP;
    },
    jsonp (url, timeout = 9000) {
      return new Promise((resolve, reject) => {
        const name = '__mmaj' + Date.now();
        const s = document.createElement('script');
        const t = setTimeout(() => { cleanup(); reject(new Error('JSONP таймаут')); }, timeout);
        function cleanup () { clearTimeout(t); delete window[name]; s.remove(); }
        window[name] = (d) => { cleanup(); resolve(d); };
        s.onerror = () => { cleanup(); reject(new Error('JSONP ошибка')); };
        s.src = url + '&callback=' + name;
        document.head.appendChild(s);
      });
    },
    trends () { return internet.search(['top hits', 'поп хиты', 'new music'][Math.floor(Math.random() * 3)]); }
  };

  /* ================= VK ================= */
  const vk = {
    isConnected: () => !!cfg.vkToken,
    // поиск доступен, если есть личный ТОКЕН ИЛИ общий (sharedVkToken) — импорту нужен только личный
    canSearch: () => !!(cfg.vkToken || cfg.sharedVkToken),
    authUrl (clientId, redirect) {
      return 'https://vk.com/oauth/authorize?client_id=' + encodeURIComponent(clientId) +
        '&redirect_uri=' + encodeURIComponent(redirect) +
        '&response_type=token&scope=audio,offline&display=page&state=vk';
    },
    async api (method, params, tokenOverride) {
      const token = tokenOverride || cfg.vkToken;   // по умолчанию — личный токен (для импорта)
      const q = new URLSearchParams(Object.assign({ v: '5.199', access_token: token }, params));
      const data = await httpJson('https://api.vk.com/method/' + method + '?' + q);
      if (data.error) throw new Error('VK error ' + data.error.error_code + ': ' + data.error.error_msg);
      return data.response;
    },
    mapTrack (a) {
      return {
        id: 'vk:' + (a.id || uid('v')),
        title: (a.title || '—') + (a.version ? ' (' + a.version + ')' : ''),
        artist: a.artist || '—',
        album: a.album || '',
        cover: a.thumb || '',
        url: a.url || '',
        source: 'vk',
        duration: a.duration || 0,
        openUrl: a.url ? '' : 'https://vk.com/audio' + (a.owner_id || '') + '_' + (a.id || '')
      };
    },
    async uid () {
      const r = await vk.api('users.get', {});
      return r[0].id;
    },
    async playlists () {
      const owner = await vk.uid().catch(() => null);
      const out = [];
      if (owner != null) {
        try {
          const albums = await vk.api('audio.getAlbums', { owner_id: owner, count: 100 });
          for (const al of (albums.items || [])) {
            out.push({
              id: 'vk-al:' + al.id,
              name: al.title || 'Альбом VK',
              cover: al.thumb || '',
              count: al.count || 0,
              fetch: async () => {
                const r = await vk.api('audio.get', { owner_id: owner, album_id: al.id, count: 1000 });
                return (r.items || []).map(vk.mapTrack);
              }
            });
          }
        } catch (e) { /* метод закрыт — попробуем общий список */ }
      }
      if (!out.length) {
        out.push({
          id: 'vk-all',
          name: 'Аудиозаписи VK',
          cover: '',
          count: 0,
          fetch: async () => {
            const r = await vk.api('audio.get', { owner_id: owner != null ? owner : '', count: 1000 });
            return (r.items || []).map(vk.mapTrack);
          }
        });
      }
      return out;
    },
    async search (q) {
      // для поиска берём личный токен, а если его нет — общий (sharedVkToken)
      const token = cfg.vkToken || cfg.sharedVkToken;
      if (!token) throw new Error('VK: токен не задан');
      const r = await vk.api('audio.get', { q, search: 1, count: 50 }, token);
      return (r.items || []).map(vk.mapTrack);
    },

    /* импорт по ссылке */
    parseLink (raw) {
      let u;
      try { u = new URL(/^https?:/i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
      if (!/(^|\.)vk\.(com|ru)$/.test(u.hostname)) return null;
      const z = u.searchParams.get('z') || '';
      const src = z || u.pathname.replace(/^\//, '');
      const m = String(src).match(/audio(-?\d+)_(\d+)(?:_pl(\d+))?/i);
      if (m) {
        return {
          type: m[3] ? 'album' : 'audio',
          owner: parseInt(m[1], 10),
          albumId: m[3] ? parseInt(m[3], 10) : null,
          audioId: parseInt(m[2], 10),
          label: decodeURIComponent(u.searchParams.get('t') || '') || 'VK аудио'
        };
      }
      const path = u.pathname.replace(/\/+$/, '');
      let m2 = path.match(/^\/club(-?\d+)$/i);
      if (m2) return { type: 'profile', owner: -parseInt(m2[1], 10), label: 'Группа ' + m2[1] };
      m2 = path.match(/^\/id(\d+)$/i);
      if (m2) return { type: 'profile', owner: parseInt(m2[1], 10), label: 'Профиль id' + m2[1] };
      m2 = path.match(/^\/([A-Za-z][A-Za-z0-9_.]{1,30})$/);
      if (m2) return { type: 'screen', screen: m2[1], label: m2[1] };
      return null;
    },
    async ownerByScreen (screen) {
      const d = await vk.api('utils.resolveScreenName', { screen_name: screen });
      const it = (d.items || [])[0];
      if (!it) throw new Error('Профиль не найден');
      return it.type === 'group' ? -it.id : it.id;
    },
    async albumsOf (owner) {
      const r = await vk.api('audio.getAlbums', { owner_id: owner, count: 100 }).catch(() => ({ items: [] }));
      return (r.items || []);
    },
    async audioOf (owner, albumId) {
      const params = { owner_id: owner, count: 1000 };
      if (albumId) params.album_id = albumId;
      const r = await vk.api('audio.get', params);
      return (r.items || []).map(vk.mapTrack);
    }
  };

  /* ================= SPOTIFY (OAuth PKCE) ================= */
  const spotify = {
    isConnected: () => !!(cfg.spotifyAccessToken && Date.now() < cfg.spotifyExpiresAt) ||
                          !!(cfg.spotifyRefreshToken),
    redirectUri () { return location.origin + location.pathname; },

    async authUrl (clientId) {
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      localStorage.setItem('mma_sp_verifier', verifier);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = b64url(new Uint8Array(digest));
      return 'https://accounts.spotify.com/authorize?client_id=' + encodeURIComponent(clientId) +
        '&response_type=code&redirect_uri=' + encodeURIComponent(spotify.redirectUri()) +
        '&code_challenge_method=S256&code_challenge=' + challenge +
        '&scope=' + encodeURIComponent('playlist-read-private playlist-read-collaborative user-library-read');
    },

    async handleCode (code) {
      const verifier = localStorage.getItem('mma_sp_verifier') || '';
      const data = await httpPost('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: spotify.redirectUri(),
          client_id: cfg.spotifyClientId,
          code_verifier: verifier
        }));
      if (data.error) throw new Error(data.error_description || data.error);
      cfg.spotifyAccessToken = data.access_token;
      cfg.spotifyRefreshToken = data.refresh_token || cfg.spotifyRefreshToken;
      cfg.spotifyExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      localStorage.removeItem('mma_sp_verifier');
      return cfg.spotifyAccessToken;
    },

    async refresh () {
      if (!cfg.spotifyRefreshToken || !cfg.spotifyClientId) return;
      const data = await httpPost('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: cfg.spotifyRefreshToken,
          client_id: cfg.spotifyClientId
        }));
      if (data.access_token) {
        cfg.spotifyAccessToken = data.access_token;
        cfg.spotifyExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      }
    },

    async token () {
      if (cfg.spotifyAccessToken && Date.now() < cfg.spotifyExpiresAt) return cfg.spotifyAccessToken;
      if (cfg.spotifyRefreshToken) { await spotify.refresh(); return cfg.spotifyAccessToken; }
      return cfg.spotifyAccessToken;
    },

    async api (path) {
      const t = await spotify.token();
      if (!t) throw new Error('Spotify не подключён');
      return httpJson('https://api.spotify.com/v1' + path, { Authorization: 'Bearer ' + t });
    },

    mapTrack (t) {
      return {
        id: 'spotify:' + t.id,
        title: t.name,
        artist: (t.artists || []).map(a => a.name).join(', '),
        album: (t.album || {}).name || '',
        cover: (t.album && t.album.images && t.album.images[0]) ? t.album.images[0].url : '',
        url: t.preview_url || '',
        source: 'spotify',
        duration: Math.round((t.duration_ms || 0) / 1000),
        openUrl: (t.external_urls || {}).spotify || ''
      };
    },

    async playlists () {
      const r = await spotify.api('/me/playlists?limit=50');
      return (r.items || []).map(pl => ({
        id: 'sp:' + pl.id,
        name: pl.name,
        cover: (pl.images && pl.images[0]) ? pl.images[0].url : '',
        count: pl.tracks ? pl.tracks.total : 0,
        fetch: async () => {
          const out = [];
          let next = '/playlists/' + pl.id + '/tracks?limit=100';
          while (next && out.length < 800) {
            const d = await spotify.api(next);
            out.push(...(d.items || []).map(i => i.track).filter(Boolean).map(spotify.mapTrack));
            next = d.next;
            if (next) next = next.replace('https://api.spotify.com/v1', '');
          }
          return out;
        }
      }));
    },

    async search (q) {
      const d = await spotify.api('/search?type=track&limit=30&q=' + encodeURIComponent(q));
      return (d.tracks.items || []).map(spotify.mapTrack);
    },

    /* импорт по ссылке */
    parseLink (raw) {
      let u;
      try { u = new URL(/^https?:/i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
      if (!/open\.spotify\.com|spotify\.link/i.test(u.hostname)) return null;
      const m = u.pathname.match(/\/(playlist|album|track|artist)\/([A-Za-z0-9]+)/);
      if (!m) return null;
      return { type: m[1], id: m[2] };
    },
    /* анонимный путь: embed-страница Spotify содержит те же данные без токена
       (публичные плейлисты/альбомы/треки; у трека есть 30-сек превью, если выдано) */
    async embed (type, id) {
      const html = await (await httpGet('https://open.spotify.com/embed/' + type + '/' + id)).text();
      const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!m) throw new Error('Spotify: embed не отдал данные');
      const d = JSON.parse(m[1]);
      const entity = (((d.props || {}).pageProps || {}).state || {}).data || {};
      const ent = entity.entity || {};
      if (!ent || !ent.title) throw new Error('Spotify: плейлист недоступен (приватный?)');
      const img = src => (src && src.sources && src.sources.length) ? src.sources[src.sources.length - 1].url : '';
      const tl = ent.trackList || [];
      return {
        name: ent.title || 'Spotify',
        cover: img(ent.coverArt) || '',
        tracks: tl.filter(x => x.title).map(x => ({
          id: 'spx:' + (x.uid || x.title),
          title: x.title,
          artist: x.subtitle || '',
          album: '',
          cover: img(x.coverArt) || img(ent.coverArt) || '',
          url: ((x.audioPreview || {}).url) || '',
          source: 'spotify',
          duration: Math.round((x.duration || 0) / 1000),
          openUrl: (x.shareUrl || '') + '',
          // для полного трека попробуем найти звук на SoundCloud при первом воспроизведении
          lookup: x.title + ' ' + (x.subtitle || '')
        }))
      };
    },
    async playlistTracksById (id) {
      const out = [];
      let next = '/playlists/' + id + '/tracks?limit=100';
      while (next && out.length < 800) {
        const d = await spotify.api(next);
        out.push(...(d.items || []).map(i => i.track).filter(Boolean).map(spotify.mapTrack));
        next = d.next;
        if (next) next = next.replace('https://api.spotify.com/v1', '');
      }
      return out.filter(t => t.title);
    },
    async findByLink (p) {
      // 1) без токена — публичные данные из embed-страницы (работает для всех)
      if (['playlist', 'album', 'track'].includes(p.type)) {
        try { return await spotify.embed(p.type, p.id); } catch (e) { /* попробуем API */ }
      }
      // 2) с токеном — если подключён (приватные плейлисты и полные метаданные)
      if (p.type === 'playlist') {
        const meta = await spotify.api('/playlists/' + p.id);
        return { name: meta.name || 'Плейлист Spotify',
                 cover: (meta.images && meta.images[0]) ? meta.images[0].url : '',
                 tracks: await spotify.playlistTracksById(p.id) };
      }
      if (p.type === 'album') {
        const meta = await spotify.api('/albums/' + p.id);
        return { name: meta.name || 'Альбом',
                 cover: (meta.images && meta.images[0]) ? meta.images[0].url : '',
                 tracks: (meta.tracks.items || []).map(spotify.mapTrack) };
      }
      if (p.type === 'track') {
        const t = spotify.mapTrack(await spotify.api('/tracks/' + p.id));
        return { name: t.title, cover: t.cover, tracks: [t] };
      }
      throw new Error('Этот тип ссылки не поддерживается — нужен плейлист, альбом или трек');
    }
  };

  /* ================= ЯНДЕКС МУЗЫКА ================= */
  const yandex = {
    isConnected: () => !!cfg.yaToken,
    authUrl (clientId, redirect) {
      return 'https://yandex.ru/oauth/authorize?response_type=token&client_id=' +
        encodeURIComponent(clientId) + '&redirect_uri=' + encodeURIComponent(redirect);
    },
    H () {
      const h = { 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023600' };
      if (cfg.yaToken) h.Authorization = 'OAuth ' + cfg.yaToken;
      return h;
    },
    // публичные плейлисты/треки Яндекс отдаёт и без токена — но только с российских IP
    async api (path) {
      let d;
      try {
        d = await httpJson('https://music.yandex.net' + path, yandex.H());
      } catch (e) {
        if (e && (e.status === 451 || /451|Unavailable/.test(String(e.message)))) {
          throw new Error('Яндекс отдаёт музыку только с российских IP — прокси за границей. ' +
                          'Вставь свой токен Яндекса в настройках или обнови cloudflare-worker.js');
        }
        throw e;
      }
      if (d.error) throw new Error('Яндекс: ' + (d.error.message || d.error.name || d.error));
      return d;
    },
    async uid () {
      const d = await httpJson('https://login.yandex.ru/info?format=json',
        { Authorization: 'OAuth ' + cfg.yaToken });
      if (!d.id) throw new Error('Токен Яндекса недействителен');
      return d.id;
    },
    cover (c) {
      if (!c) return '';
      return 'https://' + c.replace('%%', '400x400');
    },
    mapTrack (raw) {
      const t = raw.track || raw;
      const artists = (t.artists || []).map(a => a.name).join(', ');
      const url = t.directUrl || t.previewUrl || t.downloadUrl || t.url || '';
      return {
        id: 'yandex:' + (t.trackId || t.id || uid('y')),
        title: t.title || '—',
        artist: artists || '—',
        album: (t.albums && t.albums[0] ? t.albums[0].title : '') || '',
        cover: yandex.cover(t.coverUri ||
          (t.albums && t.albums[0] ? t.albums[0].coverUri : '') || (t.ogImage || '')),
        url,
        source: 'yandex',
        duration: t.durationMs ? Math.round(t.durationMs / 1000) : 0,
        openUrl: t.shareUrl
          ? t.shareUrl
          : (t.trackId ? 'https://music.yandex.ru/track/' + String(t.trackId).replace(':', '/') : '')
      };
    },
    async playlists () {
      const u = await yandex.uid();
      const d = await yandex.api('/users/' + u + '/playlists/list');
      const list = d.result && d.result.playlists ? d.result.playlists : (d.result || []);
      return list.map(pl => ({
        id: 'ym:' + u + ':' + pl.kind,
        name: pl.title || 'Плейлист',
        cover: yandex.cover(pl.coverUri),
        count: pl.trackCount || 0,
        fetch: async () => {
          const t = await yandex.api('/users/' + u + '/playlists/' + pl.kind + '/tracks');
          const arr = t.result && t.result.tracks ? t.result.tracks : (t.result || []);
          return arr.map(x => yandex.mapTrack(x.track ? x : x)).filter(x => x.title);
        }
      }));
    },
    async search (q) {
      const d = await yandex.api('/search?type=track&text=' + encodeURIComponent(q) + '&nocorrect=1&limit=30');
      let items = (d.result && d.result.tracks && d.result.tracks.items) || [];
      items = items.map(i => Array.isArray(i) ? i[0] : i).filter(Boolean);
      return items.map(yandex.mapTrack);
    },

    /* импорт по ссылке */
    parseLink (raw) {
      let u;
      try { u = new URL(/^https?:/i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
      if (!/(^|\.)yandex\.(ru|com)/i.test(u.hostname)) return null;
      const path = u.pathname.replace(/\/+$/, '');
      let m = path.match(/^\/users\/([^\/]+)\/playlists\/(\d+)$/);
      if (m) return { type: 'playlist', user: decodeURIComponent(m[1]), kind: m[2], label: 'Плейлист' };
      m = path.match(/^\/users\/([^\/]+)$/);
      if (m) return { type: 'profile', user: decodeURIComponent(m[1]), label: decodeURIComponent(m[1]) };
      m = path.match(/^\/albums\/(\d+)$/);
      if (m) return { type: 'album', id: m[1], label: 'Альбом' };
      m = path.match(/^\/track\/(\d+)$/);
      if (m) return { type: 'track', id: m[1], label: 'Трек' };
      // новый формат шаринга: /playlists/{uuid} (редакторские и публичные плейлисты)
      m = path.match(/^\/playlists\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      if (m) return { type: 'uuid', uuid: m[1], label: 'Плейлист' };
      m = path.match(/^\/playlists\/(\d+)$/);
      if (m) return { type: 'myplaylist', kind: m[1], label: 'Плейлист' };
      return null;
    },
    async tracksOf (user, kind) {
      const t = await yandex.api('/users/' + user + '/playlists/' + kind + '/tracks');
      const arr = t.result && t.result.tracks ? t.result.tracks : (t.result || []);
      return arr.map(x => yandex.mapTrack(x.track ? x : x)).filter(x => x.title);
    },
    async albumsOf (user) {
      const d = await yandex.api('/users/' + user + '/playlists/list');
      const list = d.result && d.result.playlists ? d.result.playlists : (d.result || []);
      return list;
    },
    async albumTracks (id) {
      const d = await yandex.api('/albums/' + id + '/tracks');
      const vols = (d.result && d.result.volumes) || [];
      const out = [];
      vols.forEach(v => (v || []).forEach(x => out.push(yandex.mapTrack(x.track || x))));
      return out.filter(x => x.title);
    },
    async oneTrack (id) {
      const d = await yandex.api('/tracks/' + id);
      return d.result ? [yandex.mapTrack(d.result)] : [];
    },
    async findByLink (p) {
      // uuid-ссылки нового формата: /playlists/{uuid} — отдаются анонимно, треки инлайн
      if (p.type === 'uuid') {
        const d = await yandex.api('/playlist/' + p.uuid);
        const pl = d.result || {};
        const tracks = (pl.tracks || []).map(x => yandex.mapTrack(x.track ? x : x)).filter(x => x.title);
        if (!tracks.length) throw new Error('Плейлист пуст или недоступен');
        return { name: pl.title || 'Плейлист', cover: yandex.cover(pl.coverUri || pl.ogImage), tracks };
      }
      if (p.type === 'playlist') {
        const lists = await yandex.albumsOf(p.user);
        const meta = lists.find(x => String(x.kind) === String(p.kind));
        return { name: meta ? meta.title : 'Плейлист',
                 cover: meta ? yandex.cover(meta.coverUri) : '',
                 tracks: await yandex.tracksOf(p.user, p.kind) };
      }
      if (p.type === 'myplaylist') {
        const u = await yandex.uid();
        const lists = await yandex.albumsOf(u);
        const meta = lists.find(x => String(x.kind) === String(p.kind));
        if (!meta) throw new Error('Плейлист не найден');
        return { name: meta.title, cover: yandex.cover(meta.coverUri),
                 tracks: await yandex.tracksOf(u, p.kind) };
      }
      if (p.type === 'profile') {
        const lists = await yandex.albumsOf(p.user);
        return {
          name: p.user,
          albums: lists.map(pl => ({
            id: 'ym:' + p.user + ':' + pl.kind,
            name: pl.title || 'Плейлист',
            cover: yandex.cover(pl.coverUri),
            count: pl.trackCount || 0,
            fetch: () => yandex.tracksOf(p.user, pl.kind)
          }))
        };
      }
      if (p.type === 'album') return { name: p.label, tracks: await yandex.albumTracks(p.id) };
      if (p.type === 'track') return { name: p.label, tracks: await yandex.oneTrack(p.id) };
      throw new Error('Ссылка не распознана');
    }
  };

  /* ================= M3U / прямые ссылки ================= */
  const m3u = {
    parse (text, baseUrl) {
      const out = [];
      const lines = String(text).split(/\r?\n/);
      let pending = '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF')) {
          const m = line.match(/#EXTINF:[^,]*,(.*)$/);
          pending = m ? m[1].trim() : '';
        } else if (!line.startsWith('#')) {
          let url = line;
          try { url = new URL(line, baseUrl || location.href).href; } catch (e) {}
          const parts = pending.split(' - ');
          out.push({
            id: 'm3u:' + uid('t'),
            title: pending || (url.split('/').pop().split('?')[0] || 'Трек'),
            artist: parts.length > 1 ? parts.slice(1).join(' - ') : '',
            album: '',
            cover: '',
            url: /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm|mp4)(\?|$)/i.test(url) ||
                  /^https?:\/\//i.test(url) ? url : '',
            source: 'internet',
            duration: 0,
            openUrl: url
          });
          pending = '';
        }
      }
      return out;
    }
  };

  /* ================= ПОИСК ПО ВСЕМ ИСТОЧНИКАМ ================= */
  async function searchAll (q, which) {
    const tasks = [];
    const names = [];
    if (which.includes('internet')) { names.push('internet'); tasks.push(internet.search(q).catch(() => [])); }
    if (which.includes('soundcloud')) { names.push('soundcloud'); tasks.push(soundcloud.search(q).catch(() => [])); }
    if (which.includes('vk') && vk.canSearch()) { names.push('vk'); tasks.push(vk.search(q).catch(() => [])); }
    if (which.includes('spotify') && spotify.isConnected()) { names.push('spotify'); tasks.push(spotify.search(q).catch(() => [])); }
    if (which.includes('yandex') && yandex.isConnected()) { names.push('yandex'); tasks.push(yandex.search(q).catch(() => [])); }
    const res = await Promise.all(tasks);
    const merged = [];
    names.forEach((n, i) => merged.push(...res[i]));
    // при дублях (один и тот же трек из разных источников) оставляем полную версию, а не превью
    const byKey = new Map();
    merged.forEach(t => {
      const k = (t.title + '|' + t.artist).toLowerCase();
      const old = byKey.get(k);
      if (!old) { byKey.set(k, t); return; }
      const score = x => (x.url ? 1 : 0) + Math.min(x.duration || 0, 300);
      if (score(t) > score(old)) byKey.set(k, t);
    });
    return Array.from(byKey.values());
  }

  return { configure, getCfg, httpGet, httpPost, uid, internet, vk, spotify, yandex, m3u, searchAll,
           soundcloud: { parseLink: soundcloud.parseLink, findByLink: soundcloud.findByLink,
                         refresh: soundcloud.refresh, search: soundcloud.search } };
})();
