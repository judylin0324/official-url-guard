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
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])],
});
// 模擬專案網站上的官方清單（線上更新測試用）
const { OFFICIAL_SITES } = await import('../src/data/official-sites.js');
const { exportOfficial } = await import('../src/lib/remote-official.js');
let remoteOfficial = exportOfficial([...OFFICIAL_SITES, { name: '測試新機構', category: '購物', domains: ['brand-new-official.com.tw'] }]);
const requestedHosts = new Set();
await context.route('**/*', (route) => {
  const u = new URL(route.request().url());
  requestedHosts.add(u.hostname);
  if (!/^https?:$/.test(u.protocol)) return route.continue();
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
const tabIdOf = async (p) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u || t.pendingUrl === u)?.id, p.url());
const verdictOf = async (p) => sw.evaluate(async (id) => (await chrome.storage.session.get('verdict:' + id))['verdict:' + id], await tabIdOf(p));
const overlayVisible = (p) => p.evaluate(() => !!document.querySelector('official-url-guard'));
const settle = (ms = 1800) => new Promise((r) => setTimeout(r, ms));
// 擴充功能把導航中途改道時，Playwright 的 waitForURL 可能提早結束，所以改用輪詢
const waitUrl = async (p, re, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !re.test(p.url())) await settle(200);
};

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
await page.screenshot({ path: path.join(SHOTS, '2-parking-overlay.png') });

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
await reportPage.waitForLoadState();
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
const issueHref = decodeURIComponent(issuePage.url());
check('回報誤判開啟 GitHub Issue 表單並帶入網址', issueHref.startsWith('https://github.com/judylin0324/official-url-guard/issues/new') && issueHref.includes('url=https://ctbc-bank.top/login'));
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

// 18. 設定頁
const opt = await context.newPage();
await opt.goto(`chrome-extension://${extId}/src/pages/options.html`);
await settle(600);
await opt.screenshot({ path: path.join(SHOTS, '7-options.png'), fullPage: true });

await context.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exit(failed ? 1 : 0);
