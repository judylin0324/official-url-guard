// 官網守門員 LINE 機器人：一次完成部署設定
//   1. 登入 Cloudflare（第一次會開瀏覽器）
//   2. 建立 KV（記錄通報與群組設定），把 id 寫進 wrangler.toml
//   3. 輸入 LINE 的 Channel secret 與 Channel access token（輸入時不會顯示）
//   4. 部署到 Cloudflare Workers，設定密鑰
//   5. 設定 LINE Webhook 網址並測試、檢查訊息格式、設定圖文選單
//   6. 結果存在「設定結果.txt」（不會上傳到 GitHub）
// 用法：cd line-bot && npm install && npm run setup     （Windows 可直接雙擊 setup.cmd）
// 可以重複執行：已經完成的步驟會沿用（KV、通報 API 密鑰）。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..');
const TOML = path.join(dir, 'wrangler.toml');
const RESULT = path.join(dir, '設定結果.txt');
const SECRETS_FILE = path.join(dir, '.setup-secrets.json');
export const KV_PLACEHOLDER = 'REPLACE_WITH_KV_NAMESPACE_ID';
const LINE_API = 'https://api.line.me';

const win = process.platform === 'win32';
/** 執行 npx 指令（預設）或其他指令；capture 時同時顯示並收集輸出 */
function run(args, { capture = false, input = null, cmd = 'npx' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(win ? `${cmd}.cmd` : cmd, args, { cwd: dir, shell: win, stdio: [input == null ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'] });
    let out = '';
    if (capture) {
      child.stdout.on('data', (c) => { out += c; process.stdout.write(c); });
      child.stderr.on('data', (c) => { out += c; process.stderr.write(c); });
    }
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
    child.on('close', (code) => resolve({ code, out }));
  });
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write(s.replace(/[^\r\n]/g, '*')); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

/** 從 wrangler 的輸出找出 KV id */
export function parseKvId(output) {
  const m = String(output).match(/\bid["']?\s*[=:]\s*["']([0-9a-f]{32})["']/i);
  return m ? m[1] : null;
}
/** 把 KV id 寫進 wrangler.toml 的內容 */
export function withKvId(toml, id) {
  return toml.replace(KV_PLACEHOLDER, id);
}
/** 從 wrangler deploy 的輸出找出 workers.dev 網址 */
export function parseWorkerUrl(output) {
  const m = String(output).match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i);
  return m ? m[0] : null;
}
/** 讀上次的設定結果（重複執行時沿用通報 API 密鑰） */
export function readPrevious(text) {
  const get = (k) => { const m = String(text || '').match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : ''; };
  return { reportsToken: get('LINE_BOT_REPORTS_TOKEN'), url: get('LINE_BOT_URL'), kv: get('LINE_BOT_KV_ID') };
}

async function lineGet(token, p) {
  const res = await fetch(LINE_API + p, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const step = (n, s) => console.log(`\n【${n}/6】${s}`);
  console.log('官網守門員 LINE 機器人設定');
  if (Number(process.versions.node.split('.')[0]) < 22) { console.error('需要 Node.js 22 以上，請到 https://nodejs.org/ 安裝 LTS 版本'); process.exit(1); }
  if (!existsSync(path.join(dir, 'node_modules', 'wrangler'))) {
    console.log('安裝需要的套件…');
    await run(['install', '--no-audit', '--no-fund'], { cmd: 'npm' });
  }
  const prev = readPrevious(existsSync(RESULT) ? readFileSync(RESULT, 'utf8') : '');

  step(1, '登入 Cloudflare');
  const who = await run(['wrangler', 'whoami'], { capture: true });
  if (who.code !== 0 || /not authenticated|You are not logged in/i.test(who.out)) {
    console.log('將開啟瀏覽器，請登入 Cloudflare（沒有帳號請先免費註冊），按「Allow」授權。');
    if ((await run(['wrangler', 'login'])).code !== 0) { console.error('登入失敗，請重新執行。'); process.exit(1); }
  }

  step(2, '建立 KV（記錄通報與群組設定）');
  let toml = readFileSync(TOML, 'utf8');
  let kvId = (toml.match(/^id\s*=\s*"([0-9a-f]{32})"/m) || [])[1] || '';
  if (!kvId) {
    const created = await run(['wrangler', 'kv', 'namespace', 'create', 'OUG_KV'], { capture: true });
    kvId = parseKvId(created.out);
    if (!kvId) {
      // 已經建立過：從清單找
      const list = await run(['wrangler', 'kv', 'namespace', 'list'], { capture: true });
      try {
        const arr = JSON.parse(list.out.slice(list.out.indexOf('[')));
        const hit = arr.find((x) => x.title === 'OUG_KV' || /-OUG_KV$/.test(x.title));
        kvId = hit ? hit.id : '';
      } catch { /* 解析失敗 */ }
    }
    if (!kvId) { console.error('找不到 KV 的 id，請把上面的訊息貼給維護者。'); process.exit(1); }
    toml = withKvId(toml, kvId);
    writeFileSync(TOML, toml);
    console.log(`KV id：${kvId}（已寫入 wrangler.toml）`);
  } else console.log(`沿用 KV：${kvId}`);

  step(3, '輸入 LINE 官方帳號的金鑰');
  console.log('在 LINE Developers（https://developers.line.biz/console/）選你的 Messaging API channel：');
  console.log('  Channel secret：在「Basic settings」分頁');
  console.log('  Channel access token：在「Messaging API」分頁最下方，按「Issue」產生');
  const secret = process.env.LINE_CHANNEL_SECRET || await ask('Channel secret：', { hidden: true });
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || await ask('Channel access token：', { hidden: true });
  let info;
  try { info = await lineGet(token, '/v2/bot/info'); } catch (e) { console.error(`Channel access token 無效（${e.message}），請確認後重新執行。`); process.exit(1); }
  if (!/^[0-9a-f]{32}$/i.test(secret)) { console.error('Channel secret 格式不對（應該是 32 個英數字），請確認後重新執行。'); process.exit(1); }
  const addUrl = info.basicId ? `https://line.me/R/ti/p/${encodeURIComponent(info.basicId)}` : '';
  console.log(`官方帳號：${info.displayName}（${info.basicId || '沒有 ID'}）`);

  step(4, '部署到 Cloudflare Workers');
  const dep = await run(['wrangler', 'deploy'], { capture: true });
  if (dep.code !== 0) {
    if (/workers\.dev subdomain/i.test(dep.out)) console.error('\n請先到 Cloudflare 後台 → Workers & Pages，設定一個 workers.dev 子網域，再重新執行。');
    else console.error('\n部署失敗，請把上面的訊息貼給維護者。');
    process.exit(1);
  }
  const url = parseWorkerUrl(dep.out) || prev.url || await ask('請貼上上面顯示的 https://….workers.dev 網址：');
  const reportsToken = prev.reportsToken || randomBytes(24).toString('hex');
  writeFileSync(SECRETS_FILE, JSON.stringify({ LINE_CHANNEL_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: token, REPORTS_TOKEN: reportsToken, BOT_ADD_URL: addUrl }));
  try {
    if ((await run(['wrangler', 'secret', 'bulk', path.basename(SECRETS_FILE)])).code !== 0) { console.error('設定密鑰失敗，請把上面的訊息貼給維護者。'); process.exit(1); }
  } finally { rmSync(SECRETS_FILE, { force: true }); }

  step(5, '設定 LINE Webhook、檢查訊息格式');
  const { setWebhook } = await import('../src/line-api.js');
  let test = null;
  for (let i = 0; i < 4 && !(test && test.success); i++) {
    await new Promise((r) => setTimeout(r, 3000)); // 等新版本生效
    try { test = await setWebhook({ LINE_CHANNEL_ACCESS_TOKEN: token }, `${url}/webhook`); } catch (e) { test = { success: false, reason: e.message }; }
  }
  console.log(test && test.success ? `Webhook 測試成功：${url}/webhook` : `Webhook 測試沒有通過（${test && (test.reason || test.statusCode)}），請到 LINE Developers 的 Messaging API 分頁確認。`);
  const { validateAll } = await import('./validate-messages.mjs');
  const failed = await validateAll(token);

  step(6, '設定圖文選單');
  const { install } = await import('./richmenu.mjs');
  try { await install(token); } catch (e) { console.error('圖文選單設定失敗：' + e.message); }

  const summary = [
    '# 官網守門員 LINE 機器人設定結果（不要上傳到 GitHub，裡面有密鑰）',
    `# ${new Date().toLocaleString('zh-TW', { hour12: false })}`,
    `LINE_BOT_URL=${url}`,
    `LINE_BOT_KV_ID=${kvId}`,
    `LINE_BOT_REPORTS_TOKEN=${reportsToken}`,
    `BOT_ADD_URL=${addUrl}`,
    '',
    '# 要讓 GitHub 每天自動更新機器人的涉詐清單、每週整理通報，請到',
    '# https://github.com/judylin0324/official-url-guard/settings/secrets/actions 新增以下密鑰：',
    '#   LINE_BOT_URL、LINE_BOT_KV_ID、LINE_BOT_REPORTS_TOKEN（值在上面）',
    '#   CLOUDFLARE_API_TOKEN：Cloudflare 後台 → My Profile → API Tokens → Create Token → 範本「Edit Cloudflare Workers」',
    '#   CLOUDFLARE_ACCOUNT_ID：Cloudflare 後台 → Workers & Pages 右側的 Account ID',
  ].join('\n');
  writeFileSync(RESULT, summary + '\n');

  console.log('\n────────────────────────');
  console.log('完成！還有三件事要在 LINE Official Account Manager（https://manager.line.biz/）設定：');
  console.log('  1. 設定 → 回應設定：「Webhook」開啟、「自動回應訊息」關閉、「加入好友的歡迎訊息」關閉');
  console.log('  2. 設定 → 帳號設定：「允許加入群組或多人聊天室」開啟');
  console.log('  3. 用手機加官方帳號好友，傳一則可疑簡訊試試看');
  if (addUrl) console.log(`加好友連結：${addUrl}`);
  console.log(`\n設定結果已存在：${RESULT}`);
  if (failed) console.log('\n注意：有訊息格式沒通過 LINE 檢查，請把第 5 步的訊息貼給維護者。');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
