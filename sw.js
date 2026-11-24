// 兩個快取分開管理：
//  APP_CACHE      → 自己的程式檔（index.html、圖示…），改版時換版本號即可清掉舊的
//  RUNTIME_CACHE  → MediaPipe 的 wasm / 模型檔 / 字型這些「很大又很少變」的外部檔案，
//                   跨版本保留，避免每次更新 App 都要重新下載十幾 MB
const APP_CACHE = 'shadow-hand-app-v8'; // 改版號強制更新快取[cite: 7]
const RUNTIME_CACHE = 'shadow-hand-runtime-v1'; //[cite: 7]

const CORE_ASSETS = [
  './',
  './index.html',
  './script.js',
  './firebase-db.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
]; //[cite: 7]

// 只快取這幾個已知的外部網域（MediaPipe 程式、模型、Google Fonts）
const RUNTIME_HOSTS = [
  'cdn.jsdelivr.net',
  'storage.googleapis.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

async function putSafely(cacheName, request, response) {
  // 只存完整成功的回應；206（分段）、opaque 回應存了也不能用，直接略過
  if (!response || response.status !== 200) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (e) { /* 儲存空間不足等狀況：忽略，不影響本次使用 */ }
}

// 網路優先：有網路就拿最新版（所以更新後不需要使用者重裝 App），沒網路才用快取
async function networkFirst(request) {
  try {
    const res = await fetch(request);
    putSafely(APP_CACHE, request, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

// 快取優先：大型外部檔案只要抓過一次，之後（包含離線時）直接用快取
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  // <script>、<link> 標籤發出的是 no-cors 請求，回應是「不透明」的，快取不了也無法離線使用。
  // 這幾個網域都有開放 CORS，所以改用 cors 模式重抓，拿到的就是可快取的完整回應
  const fetchReq = request.mode === 'no-cors'
    ? new Request(request.url, { mode: 'cors', credentials: 'omit' })
    : request;
  const res = await fetch(fetchReq);
  putSafely(cacheName, request, res.clone());
  return res;
}

// 先給快取、背景再更新：適合圖示這類很少變的小檔案
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((res) => { putSafely(APP_CACHE, request, res.clone()); return res; })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const isHtml = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
    event.respondWith(isHtml ? networkFirst(req) : staleWhileRevalidate(req));
    return;
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
  // 其他網域：不攔截，交給瀏覽器處理
});
