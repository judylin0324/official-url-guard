// LINE 圖文選單（聊天室下方的六格按鈕）
//   node tools/richmenu.mjs render    重新畫選單圖片 assets/richmenu.png（開發用，需要 playwright 與中文字型）
//   node tools/richmenu.mjs install   建立選單、上傳圖片、設為所有人的預設選單（需要 LINE_CHANNEL_ACCESS_TOKEN）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const IMAGE = path.join(here, '..', 'assets', 'richmenu.png');
const WEB = 'https://judylin0324.github.io/official-url-guard/';
const W = [833, 834, 833];
const H = [843, 843];

// 六格：上排 檢查／通報／165，下排 家人群組／手機檢查網頁／隱私
export const CELLS = [
  { title: '檢查可疑訊息', sub: '轉傳或貼上就能查', icon: 'check', action: { type: 'message', label: '怎麼檢查訊息', text: '說明' } },
  { title: '一鍵通報詐騙', sub: '教你兩步通報 165', icon: 'report', action: { type: 'postback', label: '怎麼通報詐騙', data: 'a=howrep', displayText: '怎麼通報詐騙？' } },
  { title: '撥打 165', sub: '反詐騙諮詢專線', icon: 'phone', action: { type: 'uri', label: '撥打 165', uri: 'tel:165' } },
  { title: '保護家人群組', sub: '把我加進家族群組', icon: 'family', action: { type: 'postback', label: '保護家人群組', data: 'a=group', displayText: '怎麼保護家人群組？' } },
  { title: '手機檢查網頁', sub: '不用 LINE 也能查', icon: 'web', action: { type: 'uri', label: '手機檢查網頁', uri: WEB } },
  { title: '隱私說明', sub: '訊息不會被儲存', icon: 'lock', action: { type: 'message', label: '隱私說明', text: '隱私' } },
];

export function richMenuDefinition() {
  const areas = CELLS.map((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    return { bounds: { x: W.slice(0, col).reduce((a, b) => a + b, 0), y: row * H[0], width: W[col], height: H[row] }, action: c.action };
  });
  return { size: { width: 2500, height: 1686 }, selected: true, name: '官網守門員選單', chatBarText: '防詐工具', areas };
}

const ICONS = {
  check: '<rect x="18" y="26" width="120" height="86" rx="18"/><path d="M48 112l-10 26 34-26"/><circle cx="104" cy="104" r="34" fill="#fff"/><path d="M128 128l30 30"/><path d="M90 104l10 10 18-22"/>',
  report: '<path d="M40 150V28"/><path d="M40 32h96l-18 30 18 30H40"/>',
  phone: '<path d="M52 24h20l12 34-16 12c10 20 22 32 42 42l12-16 34 12v20c0 10-8 18-18 18C80 146 28 94 34 42c0-10 8-18 18-18z"/>',
  family: '<circle cx="56" cy="46" r="20"/><circle cx="116" cy="46" r="20"/><path d="M20 140c0-30 16-52 36-52s36 22 36 52"/><path d="M80 140c0-30 16-52 36-52s36 22 36 52"/><path d="M86 22l30-10 30 10v26c0 22-14 36-30 42-16-6-30-20-30-42z" fill="#fff"/><path d="M104 46l9 9 17-19"/>',
  web: '<rect x="44" y="14" width="80" height="140" rx="14"/><path d="M74 134h20"/><path d="M60 50h48M60 70h48M60 90h30"/>',
  lock: '<rect x="34" y="72" width="100" height="78" rx="14"/><path d="M56 72V52a28 28 0 0156 0v20"/><path d="M84 104v18"/>',
};

function html() {
  const cells = CELLS.map((c, i) => `<div class="cell" style="width:${W[i % 3]}px;height:${H[0]}px">
    <svg viewBox="0 0 172 172" width="230" height="230" fill="none" stroke="#0c4a6e" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${ICONS[c.icon]}</svg>
    <div class="t">${c.title}</div><div class="s">${c.sub}</div></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:2500px;height:1686px;background:#f4f7f6;font-family:"Noto Sans CJK TC","Noto Sans TC","Microsoft JhengHei",sans-serif}
    .grid{display:flex;flex-wrap:wrap;width:2500px;height:1686px}
    .cell{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;border-right:4px solid #d5dfdb;border-bottom:4px solid #d5dfdb;background:#fff}
    .cell:nth-child(3n){border-right:0}.cell:nth-child(n+4){border-bottom:0}
    .cell:nth-child(2){background:#fff5f5}.cell:nth-child(2) svg{stroke:#c62828}
    .t{font-size:92px;font-weight:700;color:#0f172a;letter-spacing:2px}.s{font-size:54px;color:#475569}
  </style></head><body><div class="grid">${cells}</div></body></html>`;
}

async function render() {
  // 沒有裝在專案裡時，改用全域安裝的 playwright
  const { chromium } = await import('playwright').catch(async () => (await import('node:module')).createRequire(import.meta.url)('playwright'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2500, height: 1686 } });
  await page.setContent(html());
  await page.screenshot({ path: IMAGE, type: 'png' });
  await browser.close();
  console.log('已產生', IMAGE);
}

/** 建立並設為預設選單；同名的舊選單會刪掉 */
export async function install(token, { fetchImpl = fetch, log = console.log, apiBase = 'https://api.line.me', dataBase = 'https://api-data.line.me' } = {}) {
  const auth = { authorization: `Bearer ${token}` };
  const call = async (url, init = {}) => {
    const res = await fetchImpl(url, { ...init, headers: { ...auth, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${url} → ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  };
  const def = richMenuDefinition();
  await call(`${apiBase}/v2/bot/richmenu/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(def) });
  const old = (await (await call(`${apiBase}/v2/bot/richmenu/list`)).json()).richmenus || [];
  const { richMenuId } = await (await call(`${apiBase}/v2/bot/richmenu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(def) })).json();
  await call(`${dataBase}/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: readFileSync(IMAGE) });
  await call(`${apiBase}/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });
  for (const m of old.filter((x) => x.name === def.name)) await call(`${apiBase}/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE' }).catch(() => {});
  log(`圖文選單已設定（${richMenuId}）`);
  return richMenuId;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cmd = process.argv[2];
  if (cmd === 'render') await render();
  else if (cmd === 'install') {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) { console.error('請先設定環境變數 LINE_CHANNEL_ACCESS_TOKEN'); process.exit(1); }
    await install(token);
  } else if (cmd === 'json') writeFileSync(process.stdout.fd, JSON.stringify(richMenuDefinition(), null, 2) + '\n');
  else { console.log('用法：node tools/richmenu.mjs render | install | json'); process.exit(1); }
}
