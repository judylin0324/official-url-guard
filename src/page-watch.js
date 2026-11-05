// 在網頁本身的執行環境（MAIN world）觀察：你剛輸入的信用卡號或驗證碼，有沒有在你按下送出之前，
// 就被網頁程式偷偷傳出去（詐騙套件常一邊打字一邊把卡號傳給詐騙集團，好立刻盜刷）。
// 只在記憶體裡比對，不記錄、不上傳：回報給官網守門員的只有「傳到哪個網站」「是卡號還是驗證碼」「是不是還沒按送出」。
(() => {
  if (window.top !== window || window.__ougWatch) return;
  try { Object.defineProperty(window, '__ougWatch', { value: true }); } catch { return; }

  const secrets = []; // { value, kind, at }，最多 6 筆
  let lastAct = 0; // 使用者最後一次按按鈕、送出表單、按 Enter 的時間
  const reported = new Set();

  // 常見的工作階段錄影／分析工具：它們錄到卡號是網站設定問題，不是盜卡程式，回報時不算「偷傳」
  const RECORDERS = /(^|\.)(clarity\.ms|hotjar\.(com|io)|fullstory\.com|logrocket\.(io|com)|lr-ingest\.(io|com)|mouseflow\.com|smartlook\.(com|cloud)|contentsquare\.net|quantummetric\.com|yandex\.(ru|com))$/i;

  function luhn(d) {
    let sum = 0, dbl = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let x = d.charCodeAt(i) - 48;
      if (dbl) { x *= 2; if (x > 9) x -= 9; }
      sum += x;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  const isCard = (d) => /^[2-6]\d{12,18}$/.test(d) && !/^(\d)\1+$/.test(d) && luhn(d);
  const OTP_HINT = /(otp|one.?time|verif|passcode|sms.?code|驗證碼|認證碼|動態密碼|簡訊碼|簡訊密碼|確認碼|認証コード|確認コード|ワンタイム)/i;

  function remember(value, kind) {
    const old = secrets.find((s) => s.value === value);
    if (old) return;
    // 卡號被 base64 編碼後的樣子（依它在整段資料中的位置，有三種對齊方式）
    let b64 = [];
    if (kind === 'card') {
      try { b64 = [0, 1, 2].map((k) => btoa('\0'.repeat(k) + value).slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + value.length)) / 6))); } catch { /* 忽略 */ }
    }
    secrets.push({ value, kind, at: Date.now(), b64 });
    if (secrets.length > 6) secrets.shift();
  }

  function hintOf(el) {
    return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.className].filter(Boolean).join(' ');
  }

  document.addEventListener('input', (e) => {
    try {
      const t = e.composedPath ? e.composedPath()[0] : e.target;
      if (!t || t.tagName !== 'INPUT' || t.type === 'password') return;
      const v = String(t.value || '').replace(/[\s-]/g, '');
      if (isCard(v)) { remember(v, 'card'); return; }
      // 卡號拆成四格、每格四碼
      if (t.maxLength === 4 && /^\d{4}$/.test(v)) {
        const scope = t.form || (t.parentElement && t.parentElement.parentElement) || document;
        const boxes = [...scope.querySelectorAll('input')].filter((x) => x.maxLength === 4 || x.maxLength === 3);
        const joined = boxes.map((x) => String(x.value || '')).join('');
        if (isCard(joined)) remember(joined, 'card');
        return;
      }
      if (/^\d{6,8}$/.test(v) && ((t.autocomplete || '') === 'one-time-code' || OTP_HINT.test(hintOf(t)))) remember(v, 'otp');
    } catch { /* 忽略 */ }
  }, true);

  // 使用者「有動作」：按按鈕、點連結、送出表單、在輸入框按 Enter（點輸入框本身不算）
  window.addEventListener('click', (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && t.tagName && /^(INPUT|SELECT|TEXTAREA|LABEL|OPTION)$/.test(t.tagName) && !/^(submit|button|image|checkbox|radio)$/i.test(t.type || '')) return;
    lastAct = Date.now();
  }, true);
  window.addEventListener('submit', () => { lastAct = Date.now(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter') lastAct = Date.now(); }, true);

  // 外傳內容的格式：數字之間可能夾空白、連字號、%20、+
  const squash = (s) => s.replace(/(?<=\d)(?:\s|-|%20|\+)+(?=\d)/g, '');
  function hitIn(text) {
    if (!text) return null;
    const raw = String(text).slice(0, 300000);
    const s = squash(raw);
    for (const x of secrets) {
      if (new RegExp('(?<!\\d)' + x.value + '(?!\\d)').test(s)) return x;
      if (x.b64.some((b) => raw.includes(b))) return x;
    }
    return null;
  }

  function textOf(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    try {
      if (body instanceof URLSearchParams) return body.toString();
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        let o = '';
        for (const [k, v] of body) if (typeof v === 'string') o += `${k}=${v}&`;
        return o;
      }
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
    } catch { /* 忽略 */ }
    return '';
  }

  function report(url, hit) {
    let host = '';
    try { host = new URL(url, location.href).hostname.toLowerCase(); } catch { return; }
    if (!host) return;
    const beforeSubmit = hit.kind === 'card' && lastAct < hit.at && !RECORDERS.test(host);
    const key = `${host}|${hit.kind}|${beforeSubmit}`;
    if (reported.has(key)) return;
    reported.add(key);
    try { window.postMessage({ __oug: 'exfil', host, kind: hit.kind, beforeSubmit }, '*'); } catch { /* 忽略 */ }
  }

  function inspect(url, body) {
    if (!secrets.length) return;
    try {
      const u = String(url || '');
      if (typeof Blob !== 'undefined' && body instanceof Blob) {
        const hitU = hitIn(u);
        if (hitU) report(u, hitU);
        else if (body.size < 1e6) body.text().then((t) => { const h = hitIn(t); if (h) report(u, h); }, () => {});
        return;
      }
      const hit = hitIn(u) || hitIn(textOf(body));
      if (hit) report(u, hit);
    } catch { /* 不能讓檢查影響網頁 */ }
  }

  // ── 包住網頁送資料的方法（照常送出，只是先比對一下）──
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function fetch(input, init) {
      if (secrets.length) {
        try {
          const isReq = typeof Request !== 'undefined' && input instanceof Request;
          const url = isReq ? input.url : String(input);
          if (init && init.body != null) inspect(url, init.body);
          else if (isReq && input.method !== 'GET' && input.method !== 'HEAD') {
            inspect(url, '');
            input.clone().text().then((t) => inspect(url, t), () => {});
          } else inspect(url, '');
        } catch { /* 忽略 */ }
      }
      return origFetch.apply(this, arguments);
    };
  }

  const XHR = window.XMLHttpRequest && XMLHttpRequest.prototype;
  if (XHR) {
    const urls = new WeakMap();
    const open = XHR.open, send = XHR.send;
    XHR.open = function open_(method, url) { try { urls.set(this, String(url)); } catch { /* 忽略 */ } return open.apply(this, arguments); };
    XHR.send = function send_(body) { if (secrets.length) inspect(urls.get(this) || '', body); return send.apply(this, arguments); };
  }

  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon;
    navigator.sendBeacon = function sendBeacon(url, data) { if (secrets.length) inspect(url, data); return beacon.apply(this, arguments); };
  }

  if (window.WebSocket) {
    const wsSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function send(data) { if (secrets.length) inspect(this.url, data); return wsSend.apply(this, arguments); };
  }

  // 用圖片網址夾帶（new Image().src = 'https://x/?c=卡號'）
  const imgSrc = window.HTMLImageElement && Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imgSrc && imgSrc.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...imgSrc,
      set(v) { if (secrets.length) inspect(String(v), ''); return imgSrc.set.call(this, v); },
    });
  }
})();
