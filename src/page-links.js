// 在網頁本身的執行環境（MAIN world）觀察：網頁程式「執行時」解出或取得了哪些網址。
// 靜態掃描（src/content/hidden-links.js）讀的是程式碼；多層混淆、執行時才解碼、或從伺服器取得的目的地，
// 要等程式真的跑出結果才看得到。這裡只記「出現過哪些網域」，交給 content.js 檢查是不是仿冒網址。
// 不記錄內容、不上傳；回報的只有網域名稱，以及它來自程式（code）還是伺服器回傳的資料（data）。
(() => {
  if (window.top !== window || window.__ougLinks) return;
  try { Object.defineProperty(window, '__ougLinks', { value: true }); } catch { return; }

  const here = location.hostname;
  const seen = new Set();
  let pending = [];
  let timer = null;
  let deep = true; // 官方網站由 content.js 通知關閉（不讀伺服器回傳的資料）
  let responses = 0;
  const MAX_HOSTS = 300, MAX_RESPONSES = 40, MAX_TEXT = 300000;
  const URL_RE = /https?:\/\/[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff.-]*\.[a-z\u00a1-\uffff]{2,}/gi;
  const B64_RE = /aHR0c[A-Za-z0-9+/=]{8,600}/g;
  const origAtob = window.atob;

  function flush() {
    timer = null;
    const items = pending;
    pending = [];
    try { window.postMessage({ __oug: 'reveal', items }, '*'); } catch { /* 忽略 */ }
  }
  function note(url, src) {
    try {
      const h = new URL(String(url), location.href).hostname.toLowerCase();
      if (!h || h === here || seen.has(h) || seen.size >= MAX_HOSTS) return;
      seen.add(h);
      pending.push({ host: h, src });
      if (!timer) timer = setTimeout(flush, 400);
    } catch { /* 不是網址 */ }
  }
  const looksUrl = (s) => typeof s === 'string' && s.length >= 10 && s.length < 2000 && (s.startsWith('https://') || s.startsWith('http://') || s.startsWith('//'));
  function scanText(text, src) {
    try {
      const s = String(text).slice(0, MAX_TEXT).replace(/\\\//g, '/'); // JSON 裡的 https:\/\/
      for (const m of s.match(URL_RE) || []) note(m, src);
      for (const m of s.match(B64_RE) || []) { try { const d = origAtob(m); if (looksUrl(d)) note(d, src); } catch { /* 不是 base64 */ } }
    } catch { /* 不能讓檢查影響網頁 */ }
  }

  // ── 解碼函式的輸出：多層混淆最後一定會解出真正的網址 ──
  if (typeof origAtob === 'function') {
    window.atob = function atob() {
      const r = origAtob.apply(this, arguments);
      try { if (looksUrl(r)) note(r, 'code'); else if (r.length < 4000 && r.includes('http')) scanText(r, 'code'); } catch { /* 忽略 */ }
      return r;
    };
  }
  for (const name of ['decodeURIComponent', 'unescape']) {
    const orig = window[name];
    if (typeof orig !== 'function') continue;
    window[name] = { [name]() { const r = orig.apply(this, arguments); if (looksUrl(r)) note(r, 'code'); return r; } }[name];
  }

  // ── 程式開新視窗、改連結或表單的目的地 ──
  const origOpen = window.open;
  if (typeof origOpen === 'function') {
    window.open = function open(url) { if (url) note(url, 'code'); return origOpen.apply(this, arguments); };
  }
  for (const [proto, prop] of [[window.HTMLAnchorElement && HTMLAnchorElement.prototype, 'href'], [window.HTMLFormElement && HTMLFormElement.prototype, 'action']]) {
    const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (d && d.set && d.configurable) Object.defineProperty(proto, prop, { ...d, set(v) { if (looksUrl(String(v))) note(v, 'code'); return d.set.call(this, v); } });
  }

  // ── 伺服器回傳的資料（設定檔、API 回應）裡的網址 ──
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function fetch() {
      const p = origFetch.apply(this, arguments);
      if (deep && responses < MAX_RESPONSES) {
        try {
          p.then((res) => {
            try {
              const type = res.headers.get('content-type') || '';
              if (res.bodyUsed || res.type === 'opaque' || !/json|javascript|text\/plain/i.test(type) || Number(res.headers.get('content-length') || 0) > MAX_TEXT) return;
              responses++;
              res.clone().text().then((t) => scanText(t, 'data'), () => {});
            } catch { /* 忽略 */ }
          }, () => {});
        } catch { /* 忽略 */ }
      }
      return p;
    };
  }
  const XHR = window.XMLHttpRequest && XMLHttpRequest.prototype;
  if (XHR) {
    const send = XHR.send;
    XHR.send = function send_() {
      if (deep && responses < MAX_RESPONSES) {
        try {
          this.addEventListener('load', () => {
            try {
              if (this.responseType !== '' && this.responseType !== 'text') return;
              const t = this.responseText;
              if (t && t.length <= MAX_TEXT) { responses++; scanText(t, 'data'); }
            } catch { /* 忽略 */ }
          });
        } catch { /* 忽略 */ }
      }
      return send.apply(this, arguments);
    };
  }

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__oug === 'deep-off') deep = false;
  });
})();
