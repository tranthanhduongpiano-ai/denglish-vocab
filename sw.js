/* Denglish Vocab (iPhone) - service worker: luu khung app de mo duoc ca khi khong co mang.
 * Doi CACHE moi lan cap nhat app de iPhone tai ban moi. */
const CACHE = 'denglish-vocab-v8';
const SHELL = [
  './', 'index.html', 'dictation.html', 'app.css', 'typecard.css', 'dictation.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/db.js', 'js/util.js', 'js/parse.js', 'js/ai.js', 'js/prompts.js',
  'js/images.js', 'js/audio.js', 'js/sync.js', 'js/typecard.js', 'js/wordpop.js', 'js/dictation.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
// Thu vien / font tu CDN: luu lai sau lan tai dau
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'i.ytimg.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('denglish-vocab-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Khung app: lay ban moi khi co mang (de cap nhat), mat mang thi dung ban da luu.
    // cache 'no-cache': hoi lai GitHub Pages moi lan, khong dung ban 10 phut trong bo nho trinh duyet
    // (tranh vua cap nhat xong ma file nay moi, file kia cu).
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
  // GitHub, Gemini, kho anh: luon goi thang (khong luu)
});
