// 在 Cloudflare 的實際執行環境（workerd，透過 wrangler dev）跑一次 LINE 機器人：
// 模擬 LINE 平台送來的事件，確認打包後的程式在 Workers 環境能正常回覆（簽章、判斷、一鍵通報、KV、JPEG／PNG QR Code）。
// 用法：cd line-bot && npm install && npm test
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import { encodeQr, toRgba, toPng } from '../../test/qr-encode.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'smoke-secret';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✔' : '✘'} ${name}${ok || !detail ? '' : ' — ' + detail}`); };

// ───── 模擬 LINE 平台 ─────
const replies = [];
let image = null;
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.endsWith('/v2/bot/message/reply')) { replies.push(JSON.parse(body)); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (req.url.includes('/chat/loading/start')) { res.writeHead(202); return res.end('{}'); }
    if (/\/content$/.test(req.url) && image) { res.writeHead(200, { 'content-type': image.type, 'content-length': image.bytes.length }); return res.end(Buffer.from(image.bytes)); }
    res.writeHead(404); res.end();
  });
}).listen(0, '127.0.0.1');
await new Promise((r) => mock.once('listening', r));
const api = `http://127.0.0.1:${mock.address().port}`;

// ───── 啟動 wrangler dev ─────
const port = 8700 + Math.floor(Math.random() * 200);
const persist = mkdtempSync(path.join(tmpdir(), 'oug-line-'));
const vars = { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'smoke-token', LINE_API_BASE: api, REPORTS_TOKEN: 'smoke-reports', IMAGE_QR: 'on', BOT_ADD_URL: 'https://lin.ee/smoke' };
const args = ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--show-interactive-dev-session=false', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
const dev = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: path.join(here, '..'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
dev.stdout.on('data', (c) => { log += c; });
dev.stderr.on('data', (c) => { log += c; });
const base = `http://127.0.0.1:${port}`;
const ready = async () => {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(base + '/'); if (r.ok) return r.json(); } catch { /* 還沒好 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev 沒有啟動：\n' + log.slice(-2000));
};

let code = 1;
try {
  const health = await ready();
  check('Worker 在 workerd 啟動，涉詐清單已打包', health.ok && health.blocklist > 1000 && health.reports === true, JSON.stringify(health));

  const post = async (events, sig) => {
    const body = JSON.stringify({ destination: 'Ubot', events });
    const res = await fetch(base + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig ?? createHmac('sha256', SECRET).update(body).digest('base64') }, body });
    return res.status;
  };
  const say = async (message, source = { type: 'user', userId: 'Usmoke' }) => {
    const n = replies.length;
    const status = await post([{ type: 'message', timestamp: Date.now(), source, replyToken: 'rt' + n, mode: 'active', message: { id: 'm' + n, quoteToken: 'q' + n, ...message } }]);
    return { status, msgs: replies.length > n ? replies[replies.length - 1].messages : null };
  };

  check('簽章錯誤回 401', (await post([], 'wrong')) === 401);
  const scam = await say({ type: 'text', text: '【監理服務網】您有罰鍰逾期未繳，請於今日內至 https://mvdis-gov-tw.cc/pay 繳納' });
  const flex = scam.msgs && scam.msgs.find((m) => m.type === 'flex');
  check('假監理站簡訊回覆危險卡片', scam.status === 200 && flex && /高度疑似詐騙/.test(flex.altText), JSON.stringify(scam.msgs || log.slice(-800)).slice(0, 300));

  const data = JSON.stringify(flex || {}).match(/"data":"(a=rep&k=scam[^"]+)"/);
  const n = replies.length;
  await post([{ type: 'postback', timestamp: Date.now(), source: { type: 'user', userId: 'Usmoke' }, replyToken: 'rtp', postback: { data: data ? data[1] : '' } }]);
  const rep = replies.length > n ? JSON.stringify(replies[replies.length - 1].messages) : '';
  check('一鍵通報回覆複製按鈕並寫入 KV', /"type":"clipboard"/.test(rep) && /已經記錄下來/.test(rep), rep.slice(0, 200));
  const list = await (await fetch(base + '/api/reports', { headers: { authorization: 'Bearer smoke-reports' } })).json();
  check('通報彙整 API 讀得到剛才的通報', list.reports && list.reports[0] && list.reports[0].domain === 'mvdis-gov-tw.cc', JSON.stringify(list).slice(0, 200));

  // JPEG（LINE 傳來的照片與截圖多半是 JPEG）與 PNG 的 QR Code
  const qr = toRgba(encodeQr('https://www.mvdis.gov.tw.pay-fine.top/login'), { scale: 6 });
  image = { type: 'image/jpeg', bytes: encodeJpeg({ data: Buffer.from(qr.data), width: qr.width, height: qr.height }, 90).data };
  const jpg = await say({ type: 'image' });
  check('JPEG 圖片裡的 QR Code 解得出來並判斷', jpg.msgs && /QR Code 內容：https:\/\/www\.mvdis\.gov\.tw\.pay-fine\.top/.test(JSON.stringify(jpg.msgs)), JSON.stringify(jpg.msgs || log.slice(-800)).slice(0, 300));
  image = { type: 'image/png', bytes: toPng(qr) };
  const png = await say({ type: 'image' });
  check('PNG 圖片裡的 QR Code 解得出來（平台內建解壓縮）', png.msgs && /QR Code 內容/.test(JSON.stringify(png.msgs)), JSON.stringify(png.msgs || log.slice(-800)).slice(0, 300));

  const grp = await say({ type: 'text', text: '晚餐吃什麼' }, { type: 'group', groupId: 'Csmoke', userId: 'Usmoke' });
  check('群組一般訊息不回覆', grp.status === 200 && grp.msgs === null);
  code = results.every(Boolean) ? 0 : 1;
} catch (e) {
  console.error(e.message);
} finally {
  dev.kill('SIGTERM');
  mock.close();
  setTimeout(() => { try { rmSync(persist, { recursive: true, force: true }); } catch { /* 忽略 */ } process.exit(code); }, 1500);
  console.log(`${results.filter(Boolean).length}/${results.length} 通過`);
}
