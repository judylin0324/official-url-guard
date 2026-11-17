// 每週 LINE 使用者通報彙整：從機器人的 /api/reports 取得最近 7 天的通報，用目前的判斷引擎重新判斷，
// 產生 GitHub Issue 內容（.github/workflows/line-reports.yml 每週一執行）。
// 用法：LINE_BOT_URL=… LINE_BOT_REPORTS_TOKEN=… node tools/line-reports.mjs [輸出檔]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildContext, assessUrl } from '../src/lib/checker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVEL = { danger: '危險', caution: '可疑', platform: '平台內容', unknown: '不在清單', official: '官方', gov: '政府', trusted: '信任', invalid: '無效', skip: '略過' };

/** 依通報內容與目前判斷，建議維護者怎麼處理 */
export function suggestion(r, level, inList) {
  if (r.fp > 0 && ['danger', 'caution'].includes(level) && r.fp >= r.scam + r.miss) return '可能誤判：確認是不是官方網站，是的話加進官方清單';
  if (r.scam + r.miss > 0 && ['unknown', 'platform'].includes(level)) return inList ? '已在涉詐清單' : '漏判：補判斷規則，並向 165／TWNIC 通報';
  if (r.scam + r.miss > 0 && ['official', 'gov', 'trusted'].includes(level)) return '使用者認為官方網站是詐騙：確認是否被冒用或使用者誤會';
  if (inList) return '已在涉詐清單';
  return '已判為危險或可疑；可向 165 通報';
}

export function buildIssue(data, ctx, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = (data.reports || []).map((r) => {
    const v = assessUrl('https://' + ((r.paths && r.paths[0]) || r.domain), ctx);
    const inList = ctx.blocklist.has(r.domain);
    return { r, level: v.level, inList, tip: suggestion(r, v.level, inList) };
  });
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    `LINE 機器人最近 ${data.days} 天收到 ${rows.length} 個網域的通報（${today} 整理）。每個使用者對同一個網域只算一次，不含任何使用者資料。`,
    '',
    '| 網域 | 詐騙通報 | 漏判回報 | 誤判回報 | 目前判斷 | 建議處理 | 範例路徑 |',
    '|---|---|---|---|---|---|---|',
    ...rows.slice(0, 200).map(({ r, level, tip }) => `| ${cell(r.domain)} | ${r.scam || 0} | ${r.miss || 0} | ${r.fp || 0} | ${LEVEL[level] || level} | ${tip} | ${cell((r.paths || []).slice(0, 2).join('<br>'))} |`),
    '',
    '處理方式見 docs/MAINTENANCE.md「LINE 使用者通報彙整」。向 165 通報可用網詐通報查詢網：https://fraudbuster.digiat.org.tw/',
  ];
  return { title: `LINE 使用者通報彙整（${today}）`, body: lines.join('\n'), count: rows.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const base = (process.env.LINE_BOT_URL || '').replace(/\/+$/, '');
  const token = process.env.LINE_BOT_REPORTS_TOKEN;
  if (!base || !token) { console.log('沒有設定 LINE_BOT_URL 或 LINE_BOT_REPORTS_TOKEN，略過'); process.exit(0); }
  const res = await fetch(`${base}/api/reports?days=7`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`讀取通報失敗：HTTP ${res.status}`); process.exit(1); }
  const list = existsSync(path.join(root, 'feed/blocklist.txt')) ? readFileSync(path.join(root, 'feed/blocklist.txt'), 'utf8').split('\n').filter(Boolean) : [];
  const issue = buildIssue(await res.json(), buildContext({ blocklist: list }));
  const out = process.argv[2] || 'line-reports.md';
  writeFileSync(out, issue.body + '\n');
  console.log(`${issue.count} 個網域；內容寫在 ${out}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `count=${issue.count}\ntitle=${issue.title}\n`, { flag: 'a' });
}
