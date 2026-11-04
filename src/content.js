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
  const typed = { card: false, idNumber: false };

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

  async function report(v) {
    const res = await send({ type: 'prepareReport', url: location.href, title: document.title });
    if (res && res.text) {
      try { await navigator.clipboard.writeText(res.text); } catch { /* 有些網站禁止剪貼簿 */ }
    }
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
    ]);
    const overlay = el('div', { class: 'overlay', role: 'alertdialog', 'aria-modal': 'true' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'head' }, [
          el('h1', { text: v.page && v.page.asks.length ? '先別付款！這個網頁很可能是假的' : '先別輸入！這個網頁很可能是假的' }),
          el('p', { text: '網頁可以做得跟官方一模一樣，但網址騙不了人。' }),
        ]),
        el('div', { class: 'body' }, [
          facts,
          el('ul', {}, top.map((x) => el('li', { text: x.text }))),
          el('div', { class: 'btns' }, [
            el('button', { class: 'primary', text: '離開這個網頁', on: { click: () => send({ type: 'leave' }) } }),
            imp && imp.url ? el('a', { class: 'btn official', href: imp.url, text: `前往${imp.name}官方網站` }) : null,
            el('button', { class: 'report', text: '一鍵通報詐騙網站', on: { click: () => report(v) } }),
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
    const bar = el('div', { class: 'bar' + (proceeded ? ' red' : ''), role: 'alert' }, [
      el('div', { class: 'msg' }, [
        el('b', { text: proceeded ? '⚠ 你正在瀏覽高度疑似詐騙的網站：' : '⚠ 請確認網址：' }),
        proceeded ? '請勿付款、轉帳或輸入任何個資。' : reason.replace(/[。.]?$/, '。'),
        '實際網域：',
        el('b', { text: v.registrable || v.displayHost }),
      ]),
      el('button', { class: 'report', text: '一鍵通報', on: { click: () => report(v) } }),
      el('button', {
        class: 'x', text: '×', 'aria-label': '關閉提示',
        on: { click: () => { bar.remove(); send({ type: 'dismissBanner', host: v.host }); } },
      }),
    ]);
    r.appendChild(bar);
  }

  function toast(message, ms = 9000) {
    const r = ui();
    const t = el('div', { class: 'toast', role: 'status', text: message });
    r.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

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
    const pre = await send({ type: 'urlCheck', url: location.href });
    if (pre) {
      settings = pre.settings || settings;
      deepCheck = !['official', 'gov', 'trusted', 'skip'].includes(pre.level);
    }
    if (deepCheck) check();
    if (settings.markLinks) scanLinks();
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
