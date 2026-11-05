// 內容腳本：讀取網頁「要你做什麼」（刷卡、轉帳、輸入驗證碼…），交給背景判斷，必要時顯示警告。
// 只讀取、不修改網頁資料；所有判斷都在本機完成。
(() => {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
  if (window.__officialUrlGuard) return;
  window.__officialUrlGuard = true;

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res || null); });
    } catch { resolve(null); }
  });

  // ───────── 欄位辨識 ─────────
  const RE = {
    card: /(card.?(num|no)|cc.?num|cardnumber|credit.?card|debit.?card|信用卡|卡號|簽帳金融卡)/i,
    cardExclude: /(會員|悠遊|一卡通|集點|卡號末|後四碼|後4碼)/,
    cvv: /(\bcvv2?\b|\bcvc2?\b|\bcvn\b|\bcsc\b|security.?code|安全碼|檢查碼|末三碼|背面.{0,4}三碼)/i,
    expiry: /(\bexp(iry|iration|ire)?\b|exp[_-]?(date|month|year|mm|yy)|mm\s*\/\s*yy|有效(期限|日期|年月|月年)|到期(日|年月))/i,
    otp: /(\botp\b|one.?time|驗證碼|簡訊碼|動態密碼|認證碼|簡訊密碼)/i,
    otpExclude: /(圖形|captcha|圖片|驗證圖)/i,
    idNumber: /(身分證|身份證|national.?id|統一證號|居留證)/i,
    bankAccount: /(銀行帳號|帳戶號碼|存款帳號|匯款帳號|網銀|網路銀行|使用者代號|bank.?account|account.?(number|no))/i,
  };
  const SKIP_TYPES = new Set(['hidden', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset', 'file', 'range', 'color']);

  function isVisible(el) {
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  }

  function describe(el) {
    const parts = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.title];
    if (el.labels) for (const l of el.labels) parts.push(l.innerText);
    const p = el.parentElement;
    if (p) {
      const t = p.innerText;
      if (t && t.length < 80) parts.push(t);
    }
    const prev = el.previousElementSibling;
    if (prev && prev.innerText && prev.innerText.length < 40) parts.push(prev.innerText);
    return parts.filter(Boolean).join(' ');
  }

  /** 收集所有可見輸入框，包含 open shadow DOM 與同網域 iframe 裡的 */
  function allInputs() {
    const out = [];
    const visit = (root, depth) => {
      if (!root || depth > 3 || out.length >= 200) return;
      for (const el of root.querySelectorAll('input, select')) {
        if (!SKIP_TYPES.has((el.type || '').toLowerCase()) && isVisible(el)) out.push(el);
        if (out.length >= 200) return;
      }
      for (const host of root.querySelectorAll('*')) {
        if (host.shadowRoot) visit(host.shadowRoot, depth + 1);
      }
      for (const frame of root.querySelectorAll('iframe')) {
        try { if (frame.contentDocument) visit(frame.contentDocument, depth + 1); } catch { /* 不同網域的 iframe 讀不到 */ }
      }
    };
    visit(document, 0);
    return out;
  }

  function detectFields() {
    const f = { card: false, cvv: false, expiry: false, password: false, otp: false, idNumber: false, bankAccount: false };
    let shortRun = 0;
    for (const el of allInputs()) {
      const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
      const info = describe(el);
      if (ac === 'cc-number' || (RE.card.test(info) && !RE.cardExclude.test(info))) f.card = true;
      if (ac === 'cc-csc' || RE.cvv.test(info)) f.cvv = true;
      if (ac.startsWith('cc-exp') || RE.expiry.test(info)) f.expiry = true;
      if ((el.type || '').toLowerCase() === 'password') f.password = true;
      if (ac === 'one-time-code' || (RE.otp.test(info) && !RE.otpExclude.test(info))) f.otp = true;
      if (RE.idNumber.test(info)) f.idNumber = true;
      if (RE.bankAccount.test(info)) f.bankAccount = true;
      if (/^[0x•*\d]{4}[\s-][0x•*\d]{4}[\s-][0x•*\d]{4}/i.test(el.placeholder || '')) f.card = true;
      // 拆成四格、每格四碼的卡號輸入框
      shortRun = el.maxLength === 4 ? shortRun + 1 : 0;
      if (shortRun >= 4) f.card = true;
    }
    return f;
  }

  // ───────── 打字當下的判斷（只算出是非值，輸入內容不會離開這個頁面）─────────
  function luhnValid(digits) {
    let sum = 0, dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  function looksLikeCard(value) {
    const d = String(value || '').replace(/[\s-]/g, '');
    return /^\d{13,19}$/.test(d) && /^[2-6]/.test(d) && !/^(\d)\1+$/.test(d) && luhnValid(d);
  }
  const ID_LETTER = 'ABCDEFGHJKLMNPQRSTUVXYWZIO'; // 依序代表 10～35
  function looksLikeTwId(value) {
    const v = String(value || '').trim().toUpperCase();
    if (!/^[A-Z][12890]\d{8}$/.test(v)) return false;
    const n = ID_LETTER.indexOf(v[0]) + 10;
    let sum = Math.floor(n / 10) + (n % 10) * 9;
    for (let i = 1; i <= 8; i++) sum += Number(v[i]) * (9 - i);
    sum += Number(v[9]);
    return sum % 10 === 0;
  }
  const typed = { card: false, idNumber: false, otp: false };

  // ───────── 連結、表單、程式碼線索 ─────────
  function collectLinks() {
    const out = { apk: false, chat: 0, lineIds: [] };
    const ids = new Set();
    for (const a of [...document.querySelectorAll('a[href]')].slice(0, 1500)) {
      const href = a.getAttribute('href') || '';
      if (/\.apk(\?|#|$)/i.test(href) || /^itms-services:/i.test(href)) out.apk = true;
      let u;
      try { u = new URL(a.href); } catch { continue; }
      const h = u.hostname.replace(/^www\./, '');
      if ((h === 'line.me' && /^\/(R\/)?ti\/(p|g|g2)\//i.test(u.pathname)) || h === 'lin.ee' || h === 'liff.line.me' || h === 't.me') out.chat++;
      const m = h === 'line.me' && u.pathname.match(/^\/(?:R\/)?ti\/p\/([^/?#]+)/i);
      if (m) ids.add(decodeURIComponent(m[1]));
    }
    // 文字裡的「LINE ID：xxx」「賴：@xxx」
    const text = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 20000) : '';
    for (const m of text.matchAll(/(?:LINE|line|賴|Line)\s*(?:ID|id|帳號)?\s*[:：]\s*([@~]?[A-Za-z0-9._-]{2,40})/g)) ids.add(m[1]);
    out.lineIds = [...ids].slice(0, 30);
    return out;
  }

  function findExfil() {
    for (const s of [...document.scripts].slice(0, 80)) {
      const t = s.src ? '' : (s.textContent || '').slice(0, 200000);
      if (/api\.telegram\.org\/bot/i.test(t)) return 'Telegram 機器人';
      if (/discord(app)?\.com\/api\/webhooks/i.test(t)) return 'Discord';
    }
    for (const f of document.forms) {
      const action = f.getAttribute('action') || '';
      if (/api\.telegram\.org\/bot/i.test(action)) return 'Telegram 機器人';
      if (/discord(app)?\.com\/api\/webhooks/i.test(action)) return 'Discord';
    }
    return null;
  }

  function formHosts() {
    const hosts = new Set();
    for (const f of [...document.forms].slice(0, 20)) {
      try {
        const u = new URL(f.action || location.href, location.href);
        if (/^https?:$/.test(u.protocol) && u.hostname !== location.hostname) hosts.add(u.hostname);
      } catch { /* 忽略 */ }
    }
    return [...hosts];
  }

  // 抄襲官網的痕跡：原始碼留著官網的正式網址，或直接從官網載入 Logo、樣式、程式
  function collectCopy() {
    const abs = (v) => { if (!v) return ''; try { return new URL(v, location.href).href; } catch { return ''; } };
    const canonical = document.querySelector('link[rel~="canonical" i][href]');
    const og = document.querySelector('meta[property="og:url" i][content]');
    const baseEl = document.querySelector('base[href]');
    const resources = [];
    const keys = new Set();
    const push = (url, kind, logo) => {
      let host;
      try {
        const u = new URL(url, location.href);
        if (!/^https?:$/.test(u.protocol)) return;
        host = u.hostname.toLowerCase();
      } catch { return; }
      if (host === location.hostname) return;
      const key = `${host}|${kind}|${logo ? 1 : 0}`;
      if (keys.has(key) || resources.length >= 80) return;
      keys.add(key);
      resources.push({ host, kind, logo: Boolean(logo) });
    };
    for (const l of [...document.querySelectorAll('link[href]')].slice(0, 120)) {
      const rel = (l.getAttribute('rel') || '').toLowerCase();
      if (rel.includes('stylesheet')) push(l.href, 'css');
      else if (rel.includes('icon')) push(l.href, 'icon');
    }
    for (const sc of [...document.scripts].slice(0, 120)) if (sc.src) push(sc.src, 'script');
    for (const img of [...document.images].slice(0, 300)) {
      const src = img.currentSrc || img.src;
      if (!src) continue;
      const hint = `${img.className} ${img.id} ${img.alt} ${img.getAttribute('src') || ''}`;
      push(src, 'img', /logo/i.test(hint) || Boolean(img.closest('header, .header, #header, nav')));
    }
    return { canonical: abs(canonical && canonical.getAttribute('href')), ogUrl: abs(og && og.getAttribute('content')), baseHref: baseEl ? baseEl.href : '', resources };
  }

  // 網頁裡嵌入的 iframe 網域：正規金流（綠界、TapPay、Stripe…）的刷卡欄位放在它們自己的 iframe 裡
  function collectGateways() {
    const hosts = new Set();
    const visit = (root, depth) => {
      if (!root || depth > 2) return;
      for (const f of root.querySelectorAll('iframe[src]')) {
        try { const u = new URL(f.src, location.href); if (/^https?:$/.test(u.protocol)) hosts.add(u.hostname.toLowerCase()); } catch { /* 忽略 */ }
        if (hosts.size >= 30) return;
      }
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
    };
    visit(document, 0);
    hosts.delete(location.hostname);
    return [...hosts];
  }

  // 網頁程式偷傳卡號（由 page-watch.js 在網頁環境內比對後回報；只有目的網域與是非值）
  let exfilLive = null;

  // ───────── 網頁上的 QR Code：找出像 QR Code 的圖片，交給背景解碼 ─────────
  const qrTexts = [];
  const qrTried = new WeakSet();
  let qrBudget = 24; // 每個網頁最多解碼幾張圖
  const QR_HINT = /掃碼|掃描|掃一掃|QR|條碼|行動支付|台灣\s*Pay|LINE\s*Pay|街口|付款|繳費|繳納|轉帳|匯款|加好友|支付|領取|scan|pay/i;
  const squareish = (w, h) => w >= 48 && h >= 48 && w / h > 0.5 && w / h < 2;

  async function toDataUrl(el) {
    const c = document.createElement('canvas');
    if (el instanceof HTMLCanvasElement) return el.toDataURL('image/png'); // 被跨網域圖片污染時會丟出例外
    let src = el;
    let w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
    if (el instanceof SVGSVGElement) {
      const r = el.getBoundingClientRect();
      w = Math.round(r.width) * 3; h = Math.round(r.height) * 3;
      const xml = new XMLSerializer().serializeToString(el);
      src = new Image();
      src.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml.includes('xmlns=') ? xml : xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
      await src.decode();
    }
    const scale = Math.min(1, 1200 / Math.max(w, h));
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  async function scanQr() {
    if (!deepCheck || qrBudget <= 0 || !document.body) return;
    const text = (document.body.innerText || '').slice(0, 20000) + document.title;
    if (!QR_HINT.test(text)) return;
    const cands = [];
    for (const img of [...document.images].slice(0, 300)) {
      if (qrTried.has(img) || !img.complete || !img.naturalWidth) continue;
      if (!squareish(img.naturalWidth, img.naturalHeight) || !squareish(img.width || img.naturalWidth, img.height || img.naturalHeight)) continue;
      cands.push(img);
    }
    for (const el of [...document.querySelectorAll('canvas, svg')].slice(0, 100)) {
      if (qrTried.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (!squareish(r.width, r.height)) continue;
      if (el instanceof SVGSVGElement && el.querySelectorAll('rect, path').length < 1) continue;
      cands.push(el);
    }
    const items = [];
    for (const el of cands.slice(0, Math.min(8, qrBudget))) {
      qrTried.add(el);
      qrBudget--;
      try {
        items.push({ dataUrl: await toDataUrl(el) });
      } catch {
        // 跨網域圖片讀不到像素：交給背景下載解碼
        const src = el.currentSrc || el.src;
        if (src && /^https?:/i.test(src)) items.push({ url: src });
      }
    }
    if (!items.length) return;
    const res = await send({ type: 'decodeQr', items });
    let changed = false;
    for (const t of (res && res.texts) || []) if (t && !qrTexts.includes(t)) { qrTexts.push(t); changed = true; }
    if (changed && !overlayShown) { checks = Math.min(checks, MAX_CHECKS - 1); check(); }
  }

  function collectSignals() {
    const text = (el, max) => ((el && (el.innerText || el.textContent)) || '').slice(0, max);
    const identity = [];
    document.querySelectorAll('h1').forEach((h, i) => { if (i < 3) identity.push(text(h, 120)); });
    identity.push(text(document.querySelector('header'), 300));
    [...document.images].slice(0, 40).forEach((img) => {
      const hint = `${img.className} ${img.id} ${img.getAttribute('src') || ''}`;
      if (img.alt && (/logo/i.test(hint) || img.closest('header'))) identity.push(img.alt);
    });
    return {
      url: location.href,
      title: document.title || '',
      siteName: (document.querySelector('meta[property="og:site_name"]') || {}).content || '',
      identityText: identity.join(' \n '),
      bodyText: text(document.body, 8000),
      fields: detectFields(),
      typed: { ...typed },
      links: collectLinks(),
      exfil: findExfil(),
      formHosts: formHosts(),
      isHttp: location.protocol === 'http:',
      copy: collectCopy(),
      gateways: collectGateways(),
      exfilLive,
      qr: qrTexts.slice(0, 10),
    };
  }

  // ───────── 警告介面（Shadow DOM，避免和網頁樣式互相干擾）─────────
  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif; }
    .overlay { position: fixed; inset: 0; background: rgba(20,0,0,.72); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 2147483647; }
    .card { background: #fff; color: #1f2328; width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,.4); }
    .head { background: #cf222e; color: #fff; padding: 20px 24px; border-radius: 16px 16px 0 0; }
    .head h1 { margin: 0; font-size: 22px; line-height: 1.35; font-weight: 700; }
    .head p { margin: 6px 0 0; font-size: 15px; opacity: .95; line-height: 1.5; }
    .body { padding: 18px 24px 22px; font-size: 15px; line-height: 1.6; }
    .facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; background: #fff8f8; border: 1px solid #ffd8d3; border-radius: 10px; padding: 12px 14px; margin: 0 0 14px; }
    .facts dt { color: #6e7781; white-space: nowrap; }
    .facts dd { margin: 0; word-break: break-all; font-weight: 600; }
    .facts .bad { color: #cf222e; }
    .facts .good { color: #1a7f37; }
    ul { margin: 0 0 16px; padding-left: 20px; }
    li { margin: 4px 0; }
    .btns { display: flex; flex-direction: column; gap: 8px; }
    button, a.btn { appearance: none; border: 0; border-radius: 10px; padding: 12px 16px; font-size: 16px; font-weight: 700; cursor: pointer; text-align: center; text-decoration: none; display: block; }
    .primary { background: #1f2328; color: #fff; }
    .official { background: #1a7f37; color: #fff; }
    .report { background: #fff; color: #cf222e; border: 2px solid #cf222e !important; }
    .minor { display: flex; justify-content: space-between; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
    .link { background: none; color: #57606a; font-size: 13px; font-weight: 400; padding: 4px 0; text-decoration: underline; }
    .tip { font-size: 13px; color: #57606a; margin-top: 12px; }
    .bar { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646; display: flex; align-items: center; gap: 10px; padding: 10px 14px; font-size: 14px; line-height: 1.45; color: #1f2328; background: #fff4d6; border-bottom: 2px solid #d97706; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
    .bar.red { background: #ffebe9; border-bottom-color: #cf222e; }
    .bar .msg { flex: 1; min-width: 0; }
    .bar b { font-weight: 700; }
    .bar button { padding: 6px 12px; font-size: 13px; border-radius: 8px; flex: none; }
    .bar .x { background: transparent; color: #57606a; font-size: 18px; padding: 2px 8px; }
    .channels { background: #f0faf3; border: 1px solid #b7e4c4; border-radius: 10px; padding: 10px 14px; margin: 0 0 14px; font-size: 14px; }
    .channels b { display: block; margin-bottom: 4px; color: #1a7f37; }
    .channels ul { margin: 0; }
    .channels a { color: #0b5cad; font-weight: 600; }
    .channels small { color: #57606a; }
    .age { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .age button, .bar button.mini { background: #fff; color: #1f2328; border: 1px solid #d0d7de !important; font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 8px; display: inline-block; }
    .age .new { color: #cf222e; }
    .panel { position: fixed; top: 46px; right: 12px; width: min(420px, calc(100vw - 24px)); max-height: 70vh; overflow: auto; z-index: 2147483646; background: #fff; color: #1f2328; border-radius: 12px; padding: 12px 14px; font-size: 14px; line-height: 1.55; box-shadow: 0 12px 32px rgba(0,0,0,.25); }
    .panel .channels { margin: 0; }
    .head.amber { background: #b45309; }
    .head.dark { background: #24292f; }
    .ask { font-size: 16px; margin: 0 0 12px; }
    .ask b { color: #cf222e; }
    .toast { position: fixed; right: 16px; bottom: 16px; max-width: 360px; z-index: 2147483647; background: #1f2328; color: #fff; padding: 14px 16px; border-radius: 12px; font-size: 14px; line-height: 1.5; box-shadow: 0 8px 24px rgba(0,0,0,.3); }
    @media (max-width: 520px) { .bar { flex-wrap: wrap; } }
  `;

  let root = null;
  function ui() {
    if (root) return root;
    const host = document.createElement('official-url-guard');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);
    return root;
  }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => e.addEventListener(ev, fn));
      else e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  /** 一鍵通報：先把警告畫面藏起來截一張網頁的圖當證據，再開啟通報網站 */
  async function report(v, url = location.href) {
    const host = root && root.host;
    if (host) host.style.visibility = 'hidden';
    await frame();
    let res;
    try {
      res = await send({ type: 'prepareReport', url, title: document.title, capture: true });
    } finally {
      if (host) host.style.visibility = '';
    }
    if (res && res.text) {
      try { await navigator.clipboard.writeText(res.text); } catch { /* 有些網站禁止剪貼簿 */ }
    }
    if (res && res.screenshot) toast(`已截圖存證：下載資料夾裡的「${res.screenshot}」。通報時可以一起附上。`);
  }

  /** 正確的繳費管道 */
  function channelsBlock(ch) {
    if (!ch || !ch.items || !ch.items.length) return null;
    return el('div', { class: 'channels', 'data-oug': 'channels' }, [
      el('b', { text: `${ch.topic}：請改用這些正確管道` }),
      el('ul', {}, ch.items.map((it) => el('li', {}, it.url
        ? [el('a', { href: it.url, target: '_blank', rel: 'noopener', text: it.name }), ' ', el('small', { text: it.url.replace(/^https?:\/\//, '').replace(/\/$/, '') })]
        : [it.name]))),
    ]);
  }

  /** 查網域註冊日期（按了才查：只把網域名稱送到 rdap.org） */
  function ageNode(v, after) {
    const box = el('span', { class: 'age' });
    const btn = el('button', {
      text: '查註冊日期', 'data-oug': 'age',
      on: {
        click: async () => {
          btn.disabled = true;
          btn.textContent = '查詢中…';
          const r = await send({ type: 'domainAge', url: location.href });
          box.replaceChildren(ageText(r));
          if (r && typeof r.days === 'number' && after) after(r);
        },
      },
    });
    box.appendChild(btn);
    return box;
  }
  function ageText(r) {
    if (!r || !r.created) return el('span', { text: r && r.status === 'unsupported' ? '這種網域查不到註冊日期' : '查不到註冊日期' });
    const date = new Date(r.created).toLocaleDateString('zh-TW');
    if (r.days <= 90) return el('span', { class: 'new', text: `${date}（才 ${r.days} 天！新註冊的網站很可能是詐騙）` });
    return el('span', { text: `${date}（${r.days >= 365 ? Math.floor(r.days / 365) + ' 年多' : r.days + ' 天'}）` });
  }

  let overlayShown = false;
  function showOverlay(v) {
    if (overlayShown) return;
    overlayShown = true;
    send({ type: 'countBlocked', kind: 'page' });
    const r = ui();
    const imp = v.impersonating;
    const top = v.reasons.filter((x) => x.weight > 0).slice(0, 3);
    const asks = v.page && v.page.asks.length ? v.page.asks.join('、') : v.page && v.page.creds.length ? v.page.creds.join('、') : '';
    const facts = el('dl', { class: 'facts' }, [
      imp ? el('dt', { text: '頁面自稱' }) : null,
      imp ? el('dd', { text: imp.name }) : null,
      el('dt', { text: '實際網址' }),
      el('dd', { class: 'bad', text: v.registrable || v.displayHost }),
      imp ? el('dt', { text: '官方網址' }) : null,
      imp ? el('dd', { class: 'good', text: imp.domain || imp.hint || '' }) : null,
      asks ? el('dt', { text: '它要你' }) : null,
      asks ? el('dd', { text: asks }) : null,
      v.registrable ? el('dt', { text: '註冊時間' }) : null,
      v.registrable ? el('dd', {}, [ageNode(v)]) : null,
    ]);
    const overlay = el('div', { class: 'overlay', role: 'alertdialog', 'aria-modal': 'true', 'data-oug': 'page-overlay' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'head' }, [
          el('h1', { text: v.page && v.page.asks.length ? '先別付款！這個網頁很可能是假的' : '先別輸入！這個網頁很可能是假的' }),
          el('p', { text: '網頁可以做得跟官方一模一樣，但網址騙不了人。' }),
        ]),
        el('div', { class: 'body' }, [
          facts,
          el('ul', {}, top.map((x) => el('li', { text: x.text }))),
          channelsBlock(v.page && v.page.channels),
          el('div', { class: 'btns' }, [
            el('button', { class: 'primary', text: '離開這個網頁', on: { click: () => send({ type: 'leave' }) } }),
            imp && imp.url ? el('a', { class: 'btn official', href: imp.url, text: `前往${imp.name}官方網站` }) : null,
            el('button', { class: 'report', 'data-oug': 'report', text: '一鍵通報詐騙網站', on: { click: () => report(v) } }),
          ]),
          el('div', { class: 'minor' }, [
            el('button', {
              class: 'link', text: '這是我確認過的官方網站（加入信任）',
              on: { click: async () => { await send({ type: 'trustDomain', domain: v.registrable }); overlay.remove(); } },
            }),
            el('button', {
              class: 'link', text: '這是正常網站？回報誤判',
              on: { click: () => send({ type: 'openIssue', kind: 'false-positive', url: location.href }) },
            }),
            el('button', {
              class: 'link', text: '仍要繼續（不建議）',
              on: { click: async () => { await send({ type: 'allowHost', host: v.host }); overlay.remove(); showBar(v, true); } },
            }),
          ]),
          el('p', { class: 'tip', text: '不確定的話，請撥打 165 反詐騙諮詢專線，或自己輸入官方網址查詢，不要點簡訊裡的連結。' }),
        ]),
      ]),
    ]);
    r.appendChild(overlay);
    // 把焦點從網頁的輸入框移開，避免繼續打字
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    overlay.querySelector('button.primary').focus();
  }

  let barShown = false;
  function showBar(v, proceeded = false) {
    if (barShown) return;
    barShown = true;
    const r = ui();
    const reason = (v.reasons.find((x) => x.weight > 0) || v.reasons[0] || { text: '' }).text;
    const bar = el('div', { class: 'bar' + (proceeded ? ' red' : ''), role: 'alert', 'data-oug': 'bar' }, [
      el('div', { class: 'msg' }, [
        el('b', { text: proceeded ? '⚠ 你正在瀏覽高度疑似詐騙的網站：' : '⚠ 請確認網址：' }),
        proceeded ? '請勿付款、轉帳或輸入任何個資。' : reason.replace(/[。.]?$/, '。'),
        '實際網域：',
        el('b', { text: v.registrable || v.displayHost }),
      ]),
      v.page && v.page.channels ? el('button', { class: 'mini', text: '正確繳費管道', on: { click: () => togglePanel(channelsBlock(v.page.channels)) } }) : null,
      v.registrable ? el('button', {
        class: 'mini', text: '註冊多久？',
        on: { click: () => togglePanel(el('div', {}, [el('b', { text: `${v.registrable} 的註冊日期：` }), ageNode(v, (res) => { if (res.days <= 90) recheck(); })])) },
      }) : null,
      el('button', { class: 'report', text: '一鍵通報', on: { click: () => report(v) } }),
      el('button', {
        class: 'x', text: '×', 'aria-label': '關閉提示',
        on: { click: () => { bar.remove(); if (panel) panel.remove(); send({ type: 'dismissBanner', host: v.host }); } },
      }),
    ]);
    r.appendChild(bar);
  }

  let panel = null;
  function togglePanel(content) {
    if (panel) { panel.remove(); panel = null; return; }
    if (!content) return;
    panel = el('div', { class: 'panel', role: 'dialog' }, [content]);
    ui().appendChild(panel);
  }

  // 查到網站很新之後重新判斷（可能升級成危險）
  function recheck() {
    barShown = false;
    const r = ui();
    r.querySelectorAll('.bar, .panel').forEach((x) => x.remove());
    panel = null;
    checks = Math.min(checks, MAX_CHECKS - 1);
    check();
  }

  function toast(message, ms = 9000) {
    const r = ui();
    const t = el('div', { class: 'toast', role: 'status', text: message });
    r.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ───────── 送出前最後一道關卡：不在官方清單的網站，送出卡號（或可疑網站送出驗證碼）前先確認一次 ─────────
  let lastVerdict = null;
  let submitOk = false; // 使用者這次瀏覽已確認過這個網站
  let guardOpen = false;
  let bypass = false;
  const SUBMIT_WORDS = /送出|確認|確定|下一步|付款|繳費|繳納|支付|結帳|提交|立即|驗證|領取|申請|完成|submit|pay|confirm|next|continue|verify|send|proceed|checkout|次へ|支払|送信/i;

  function guardKind() {
    if (!deepCheck || submitOk || !lastVerdict || bypass) return null;
    if (['official', 'gov', 'trusted', 'skip', 'invalid'].includes(lastVerdict.level)) return null;
    if (typed.card) return 'card';
    if (typed.otp && ['caution', 'danger', 'platform'].includes(lastVerdict.level)) return 'otp';
    return null;
  }

  function submitTarget(t) {
    if (!(t instanceof Element)) return null;
    const b = t.closest('button, input[type="submit"], input[type="button"], input[type="image"], [role="button"], a');
    if (b && b.tagName === 'BUTTON' && (b.type || 'submit') === 'submit' && b.form) return b;
    if (b && b.tagName === 'INPUT' && /^(submit|image)$/i.test(b.type)) return b;
    const node = b || t;
    const label = String(node.innerText || node.value || node.getAttribute('aria-label') || '').trim();
    return label && label.length <= 30 && SUBMIT_WORDS.test(label) ? node : null;
  }

  function showSubmitGuard(kind, proceed) {
    if (guardOpen) return;
    guardOpen = true;
    const v = lastVerdict;
    const r = ui();
    const what = kind === 'otp' ? '簡訊驗證碼' : '信用卡卡號';
    const bad = v.level === 'danger' || v.level === 'caution';
    const status = v.level === 'danger' ? '高度疑似詐騙' : v.level === 'caution' ? '有可疑特徵' : v.level === 'platform' ? '任何人都能建立的頁面' : '不在官方網站清單中';
    const imp = v.impersonating;
    const close = () => { overlay.remove(); guardOpen = false; };
    const overlay = el('div', { class: 'overlay', role: 'alertdialog', 'aria-modal': 'true', 'data-oug': 'submit-guard' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'head ' + (v.level === 'danger' ? '' : bad ? 'amber' : 'dark') }, [
          el('h1', { text: `送出${what}前，請再確認一次網址` }),
          el('p', { text: '假的繳費網頁可以做得跟真的一模一樣，只有網址騙不了人。' }),
        ]),
        el('div', { class: 'body' }, [
          el('p', { class: 'ask' }, ['你正要把', what, '送給 ', el('b', { text: v.registrable || v.displayHost }), '。']),
          el('dl', { class: 'facts' }, [
            el('dt', { text: '這個網站' }),
            el('dd', { class: bad ? 'bad' : '', text: status }),
            imp ? el('dt', { text: '頁面自稱' }) : null,
            imp ? el('dd', { text: imp.name }) : null,
            imp && imp.domain ? el('dt', { text: '官方網址' }) : null,
            imp && imp.domain ? el('dd', { class: 'good', text: imp.domain }) : null,
            v.registrable ? el('dt', { text: '註冊時間' }) : null,
            v.registrable ? el('dd', {}, [ageNode(v)]) : null,
          ]),
          el('ul', {}, [
            el('li', { text: '這個網址是你自己輸入、或從官方 App 進來的嗎？如果是點簡訊、Email、LINE 裡的連結，請不要送出。' }),
            el('li', { text: '停車費、罰單、通行費、補運費、退稅、補助，都不會用簡訊連結叫你刷卡或輸入驗證碼。' }),
            ...(v.reasons || []).filter((x) => x.weight > 0).slice(0, 2).map((x) => el('li', { text: x.text })),
          ]),
          channelsBlock(v.page && v.page.channels),
          el('div', { class: 'btns' }, [
            el('button', { class: 'primary', text: '不要送出', on: { click: close } }),
            imp && imp.url ? el('a', { class: 'btn official', href: imp.url, text: `改到${imp.name}官方網站` }) : null,
            v.level === 'danger' ? el('button', { class: 'report', text: '一鍵通報詐騙網站', on: { click: () => { close(); report(v); } } }) : null,
          ]),
          el('div', { class: 'minor' }, [
            el('button', {
              class: 'link', 'data-oug': 'confirm-submit', text: `我確認網址正確，送出${what}`,
              on: { click: async () => { submitOk = true; close(); await send({ type: 'submitConfirmed', host: v.host }); proceed(); } },
            }),
          ]),
        ]),
      ]),
    ]);
    r.appendChild(overlay);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    overlay.querySelector('button.primary').focus();
  }

  function fromOurUi(e) {
    return e.composedPath().some((n) => n && n.tagName && /^OFFICIAL-URL-GUARD/.test(n.tagName));
  }

  window.addEventListener('click', (e) => {
    const kind = guardKind();
    if (!kind || fromOurUi(e)) return;
    const target = submitTarget(e.composedPath()[0]);
    if (!target) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showSubmitGuard(kind, () => {
      bypass = true;
      try { target.click(); } finally { bypass = false; }
    });
  }, true);

  window.addEventListener('submit', (e) => {
    const kind = guardKind();
    const form = e.target;
    if (!kind || !(form instanceof HTMLFormElement)) return;
    const submitter = e.submitter;
    e.preventDefault();
    e.stopImmediatePropagation();
    showSubmitGuard(kind, () => {
      bypass = true;
      try {
        if (form.requestSubmit) form.requestSubmit(submitter && submitter.form === form ? submitter : undefined);
        else HTMLFormElement.prototype.submit.call(form);
      } catch {
        HTMLFormElement.prototype.submit.call(form);
      } finally { bypass = false; }
    });
  }, true);

  // page-watch.js（網頁環境）回報：剛輸入的卡號被傳出去了
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__oug !== 'exfil' || typeof d.host !== 'string') return;
    const next = { host: d.host.slice(0, 253), kind: d.kind === 'otp' ? 'otp' : 'card', beforeSubmit: d.beforeSubmit === true };
    // 保留最嚴重的一筆：送出前外傳 > 外傳到別的網站
    if (exfilLive && exfilLive.beforeSubmit && !next.beforeSubmit) return;
    exfilLive = next;
    if (deepCheck && !overlayShown) { checks = Math.min(checks, MAX_CHECKS - 1); check(); }
  });

  // ───────── 檢查流程 ─────────
  let settings = { markLinks: true, pageGuard: true, showBanner: true };
  let deepCheck = true; // 官方網站不分析網頁內容（效能與隱私）
  let checking = false, pending = false, checks = 0, lastKey = '';
  const MAX_CHECKS = 25;
  const startedAt = Date.now();
  const keyOf = (fields) => JSON.stringify([fields, typed]);

  async function check() {
    if (!deepCheck || overlayShown || checks >= MAX_CHECKS) return;
    if (checking) { pending = true; return; }
    checking = true;
    try {
      const signals = collectSignals();
      lastKey = keyOf(signals.fields);
      const res = await send({ type: 'pageCheck', signals });
      checks++;
      if (!res || !res.verdict) return;
      settings = res.settings;
      const { verdict: v, allowed, dismissed } = res;
      lastVerdict = v;
      if (res.submitOk) submitOk = true;
      if (allowed) {
        if (v.level === 'danger') showBar(v, true);
      } else if (v.level === 'danger' && settings.pageGuard) {
        showOverlay(v);
      } else if ((v.level === 'caution' || v.level === 'danger') && settings.showBanner && !dismissed) {
        // 只因後綴之類的弱線索被判可疑時，只亮工具列徽章、不打擾；有冒名、要付款或分數較高才顯示提示列
        const asksSomething = v.page && (v.page.asks.length || v.page.creds.length);
        if (asksSomething || v.impersonating || v.score >= 45 || v.level === 'danger') showBar(v);
      }
    } finally {
      checking = false;
      if (pending) { pending = false; setTimeout(check, 300); }
    }
  }

  // 網頁內容變動時（例如按下「繳費」後才出現信用卡欄位）重新檢查。
  // 欄位只在前 2 分鐘自動監看，之後改由「點進輸入框」「打字」觸發；可疑連結監看 10 分鐘。避免拖慢網頁。
  let moTimer = null;
  const mo = new MutationObserver(() => {
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > 600000) { mo.disconnect(); return; }
      if (deepCheck && !overlayShown && elapsed < 120000 && keyOf(detectFields()) !== lastKey) check();
      if (deepCheck && !overlayShown && elapsed < 120000) scanQr();
      if (settings.markLinks) scanLinks();
    }, 1200);
  });

  // 正要在輸入框打字時，再確認一次
  document.addEventListener('focusin', (e) => {
    if (!deepCheck || overlayShown || !(e.target instanceof HTMLInputElement)) return;
    if (keyOf(detectFields()) !== lastKey) check();
  }, true);

  // 打字時：內容通過信用卡號或身分證字號的檢查碼，就算欄位沒有標示也立刻重新判斷
  let typeTimer = null;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!deepCheck || overlayShown || !(t instanceof HTMLInputElement) || t.type === 'password') return;
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => {
      let changed = false;
      if (!typed.card && looksLikeCard(t.value)) { typed.card = true; changed = true; }
      if (!typed.idNumber && looksLikeTwId(t.value)) { typed.idNumber = true; changed = true; }
      if (!typed.otp && /^\d{4,8}$/.test(String(t.value || '').trim())
          && ((t.getAttribute('autocomplete') || '') === 'one-time-code' || (RE.otp.test(describe(t)) && !RE.otpExclude.test(describe(t))))) typed.otp = true;
      if (changed) check();
    }, 250);
  }, true);

  // ───────── 可疑連結標示 ─────────
  const seen = new WeakSet();
  const URL_TEXT = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\/?#]\S*)?$/i;
  async function scanLinks() {
    const anchors = [...document.querySelectorAll('a[href]')].filter((a) => !seen.has(a)).slice(0, 600);
    if (!anchors.length) return;
    const hosts = new Set();
    const pairs = [], pairAnchors = [];
    for (const a of anchors) {
      seen.add(a);
      let u;
      try { u = new URL(a.href); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || u.hostname === location.hostname) continue;
      hosts.add(u.hostname);
      const shown = (a.textContent || '').trim();
      const m = shown.length < 120 && shown.match(URL_TEXT);
      if (m && m[1].toLowerCase() !== u.hostname) { pairs.push([m[1].toLowerCase(), u.hostname]); pairAnchors.push(a); }
    }
    if (!hosts.size) return;
    const res = await send({ type: 'scanLinks', hosts: [...hosts], pairs });
    if (!res) return;
    for (const a of anchors) {
      let h;
      try { h = new URL(a.href).hostname; } catch { continue; }
      const hit = res.levels[h];
      if (hit) {
        a.setAttribute('data-oug-level', hit.level);
        a.title = `⚠ 官網守門員：${hit.reason}${a.title ? '\n' + a.title : ''}`;
      }
    }
    for (const mm of res.mismatches) {
      const a = pairAnchors[mm.index];
      if (!a) continue;
      a.setAttribute('data-oug-level', 'caution');
      a.title = `⚠ 官網守門員：連結文字顯示「${mm.shown}」，實際卻連到「${mm.actual}」`;
    }
  }

  // ───────── 網頁信箱：開信時檢查寄件人、內文與連結 ─────────
  const pick = (root, sel) => (root && root.querySelector(sel)) || null;
  const emailFrom = (el, attrs) => {
    if (!el) return null;
    for (const a of attrs) {
      const v = el.getAttribute(a);
      const m = v && v.match(/[\w.+-]+@(?:[\w-]+\.)+[a-z]{2,}/i);
      if (m) return { name: (el.getAttribute('name') || el.textContent || '').trim().slice(0, 80), address: m[0] };
    }
    const m = (el.textContent || '').match(/[\w.+-]+@(?:[\w-]+\.)+[a-z]{2,}/i);
    return m ? { name: '', address: m[0] } : null;
  };
  const WEBMAIL = [
    {
      host: /^mail\.google\.com$/,
      body: 'div.a3s',
      container: (b) => b.closest('.adn, .gs, .h7') || b.parentElement,
      sender: (c) => emailFrom(pick(c, 'span.gD[email], span[email]'), ['email']),
      subject: () => (pick(document, 'h2.hP') || {}).textContent || '',
    },
    {
      host: /^outlook\.(live|office|office365)\.com$/,
      body: 'div[aria-label="Message body"], div[aria-label="郵件內文"], div[aria-label="郵件本文"], div[aria-label="訊息本文"], div[aria-label="メッセージ本文"]',
      container: (b) => b.closest('[data-app-section="ReadingPane"], [role="main"], [role="region"]') || b.parentElement,
      sender: (c) => emailFrom(pick(c, '[title*="@"], [aria-label*="@"]'), ['title', 'aria-label']),
      subject: () => (pick(document, '[role="main"] [role="heading"]') || {}).textContent || '',
    },
    {
      host: /^(mail\.yahoo\.com|tw\.mail\.yahoo\.com|mail\.yahoo\.co\.jp)$/,
      body: '[data-test-id="message-view-body-content"], .msg-body',
      container: (b) => b.closest('[data-test-id="message-view"]') || b.parentElement,
      sender: (c) => emailFrom(pick(c, '[data-test-id="message-from"] [title*="@"], [data-test-id="email-pill"]'), ['title']),
      subject: () => (pick(document, '[data-test-id="message-group-subject-text"]') || {}).textContent || '',
    },
  ];
  const mailClient = WEBMAIL.find((m) => m.host.test(location.hostname));
  const mailSeen = new WeakMap();

  function mailBanner(body, r) {
    const host = document.createElement('official-url-guard-mail');
    host.setAttribute('data-level', r.overall);
    host.style.cssText = 'display:block;margin:0 0 12px;';
    const root = host.attachShadow({ mode: 'open' });
    const danger = r.overall === 'danger';
    const reasons = [];
    if (r.worst) reasons.push(...r.worst.reasons.filter((x) => x.weight > 0).map((x) => x.text));
    reasons.push(...r.messageNotes);
    const imp = r.worst && r.worst.impersonating;
    root.innerHTML = `<style>
      .box{font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.55;
        border:2px solid ${danger ? '#cf222e' : '#d97706'};background:${danger ? '#ffebe9' : '#fff4d6'};color:#1f2328}
      b.t{font-size:15px;display:block;margin-bottom:4px} ul{margin:4px 0 8px;padding-left:20px} li{margin:2px 0}
      .row{display:flex;gap:8px;flex-wrap:wrap} button,a.btn{font:inherit;font-size:13px;font-weight:700;border-radius:8px;padding:6px 10px;cursor:pointer;text-decoration:none}
      .rep{background:#fff;color:#cf222e;border:2px solid #cf222e} .ok{background:#1a7f37;color:#fff;border:0} .fp{background:transparent;border:0;color:#57606a;text-decoration:underline;font-weight:400}
    </style><div class="box" role="alert"><b class="t"></b><ul></ul><div class="row"></div></div>`;
    root.querySelector('.t').textContent = danger ? '⚠ 官網守門員：這封信很可能是詐騙，請不要點信裡的連結' : '⚠ 官網守門員：這封信有可疑的地方，請先確認';
    const ul = root.querySelector('ul');
    for (const t of [...new Set(reasons)].slice(0, 4)) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
    const row = root.querySelector('.row');
    if (imp && imp.url) { const a = document.createElement('a'); a.className = 'btn ok'; a.href = imp.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `改到${imp.name}官方網站查詢`; row.appendChild(a); }
    // 正確的繳費／查詢管道（例如通行費 → 遠通電收官網）
    const ch = r.worst && r.worst.channels;
    const chLink = ch && ch.items.find((it) => it.url && (!imp || it.url !== imp.url));
    if (chLink) { const a = document.createElement('a'); a.className = 'btn ok'; a.href = chLink.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `正確管道：${chLink.name}`; row.appendChild(a); }
    if (r.worst) {
      const b = document.createElement('button'); b.className = 'rep'; b.textContent = '一鍵通報詐騙網址';
      b.addEventListener('click', async () => {
        // 截圖存證：把整封信（含寄件人）截下來，警告框先藏起來
        host.style.visibility = 'hidden';
        await frame();
        let res;
        try { res = await send({ type: 'prepareReport', url: r.worst.url, title: document.title, capture: true }); } finally { host.style.visibility = ''; }
        if (res && res.text) { try { await navigator.clipboard.writeText(res.text); } catch { /* 忽略 */ } }
        if (res && res.screenshot) toast(`已截圖存證：下載資料夾裡的「${res.screenshot}」。`);
      });
      row.appendChild(b);
      const fp = document.createElement('button'); fp.className = 'fp'; fp.textContent = '這封信是正常的？回報誤判';
      fp.addEventListener('click', () => send({ type: 'openIssue', kind: 'false-positive', url: r.worst.url }));
      row.appendChild(fp);
    }
    body.parentElement.insertBefore(host, body);
    // 信裡通往可疑目的地的連結加上紅框（點了也會被攔截）
    const bad = new Set(r.items.filter((v) => v.level === 'danger').map((v) => v.url));
    for (const a of body.querySelectorAll('a[href]')) {
      if (bad.has(a.href) || r.items.some((v) => v.level === 'danger' && v.wrapper === a.href)) {
        a.setAttribute('data-oug-level', 'danger');
        a.title = '⚠ 官網守門員：這封信很可能是詐騙，這個連結會被攔截';
      }
    }
  }

  async function checkMail() {
    if (!mailClient) return;
    for (const body of [...document.querySelectorAll(mailClient.body)].slice(0, 10)) {
      if (!isVisible(body)) continue;
      const text = (body.innerText || '').slice(0, 8000);
      if (text.length < 20 || mailSeen.get(body) === text.length) continue;
      mailSeen.set(body, text.length);
      const c = mailClient.container(body);
      const sender = mailClient.sender(c);
      // 連結用真正的網址（a.href），不是顯示的文字；Gmail 的安全轉址另外放在 data-saferedirecturl
      const links = [...body.querySelectorAll('a[href]')].slice(0, 50).map((a) => a.href).filter((h) => /^https?:/i.test(h));
      const head = [mailClient.subject(), sender ? `From: ${sender.name} <${sender.address}>` : ''].filter(Boolean).join('\n');
      const r = await send({ type: 'assessEmail', text: `${head}\n${text}`, links, sender });
      if (!r || !r.overall || body.previousElementSibling?.tagName === 'OFFICIAL-URL-GUARD-MAIL') continue;
      mailBanner(body, r);
    }
  }
  let mailTimer = null;
  const scheduleMail = () => { clearTimeout(mailTimer); mailTimer = setTimeout(checkMail, 800); };
  if (mailClient) {
    new MutationObserver(scheduleMail).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('hashchange', scheduleMail);
  }

  // ───────── 網詐通報查詢網：自動帶入可疑網址 ─────────
  async function autofillReport() {
    const pr = await send({ type: 'getPendingReport' });
    if (!pr) return;
    let tries = 0;
    const attempt = () => {
      tries++;
      const fields = [...document.querySelectorAll('input[type="url"], input[type="text"], input:not([type]), textarea')].filter(isVisible);
      const target = fields.find((f) => /網址|url|網站|連結|link/i.test(describe(f)) && !f.value);
      const detail = fields.find((f) => f.tagName === 'TEXTAREA' && /說明|內容|描述|情形|經過|備註/i.test(describe(f)) && !f.value);
      const fill = (f, val) => {
        const proto = f.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(f, val);
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (target) {
        fill(target, pr.url);
        if (detail) fill(detail, pr.text);
        toast(`官網守門員已幫你填入可疑網址：${pr.host}\n完整說明也已複製到剪貼簿，需要時可貼上。請確認內容後再送出。`);
        send({ type: 'clearPendingReport' });
      } else if (tries < 20) {
        setTimeout(attempt, 1000);
      } else {
        toast(`可疑網址與說明已複製到剪貼簿：${pr.host}\n請在通報欄位按 Ctrl+V（Mac 為 ⌘+V）貼上。`);
      }
    };
    attempt();
  }

  async function start() {
    if (location.hostname === 'fraudbuster.digiat.org.tw') autofillReport();
    if (mailClient) scheduleMail();
    const pre = await send({ type: 'urlCheck', url: location.href });
    if (pre) {
      settings = pre.settings || settings;
      deepCheck = !['official', 'gov', 'trusted', 'skip'].includes(pre.level);
    }
    if (deepCheck) {
      check();
      scanQr();
      // 圖片還沒下載完的，等網頁載入完成再找一次
      if (document.readyState !== 'complete') window.addEventListener('load', () => setTimeout(scanQr, 300), { once: true });
    }
    if (settings.markLinks) scanLinks();
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
