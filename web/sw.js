// 手機版檢查網頁的離線支援：判斷全部在手機上執行，所以沒有網路時也要能開啟。
// 有網路時一律拿最新版（清單與規則才會更新），拿不到才用上次存下來的版本。
const CACHE = 'oug-web-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'manifest.webmanifest', 'app-icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // 從簡訊「分享」進來的網址帶著訊息內容（?text=…），不寫進快取；離線時回傳不帶參數的首頁
  const isPage = req.mode === 'navigate';
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && !url.search) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(isPage ? './' : req, copy)); }
      return res;
    }).catch(() => caches.match(isPage ? './' : req).then((hit) => hit || Response.error())),
  );
});
