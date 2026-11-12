// 每日涉詐清單彙整：下載 src/data/list-sources.js 裡標示 inFeed 的來源 → 檢查 → 合併、淨化 → 寫到 feed/
//   feed/sources/<id>.txt   每個來源上次成功的網域（來源出問題時沿用）
//   feed/blocklist.txt      彙整後的清單，一行一個網域（發布到專案網站，擴充功能與 Gmail 過濾下載這一份）
//   feed/meta.json          產生時間、各來源狀態、問題
//   feed/problems.md        有問題時才產生（GitHub Actions 用它開 Issue）
// 用法：node tools/build-feed.mjs [--offline 資料夾]   （--offline：從資料夾讀 <id>.txt／.csv，測試用）
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIST_SOURCES } from '../src/data/list-sources.js';
import { parseDomainList, sanitizeDomains } from '../src/lib/blocklist.js';
import { buildContext } from '../src/lib/checker.js';
import { mergeSource, buildFeed, problemReport } from './feed-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const feedDir = path.join(root, 'feed');
const srcDir = path.join(feedDir, 'sources');
mkdirSync(srcDir, { recursive: true });
const offline = process.argv.includes('--offline') ? process.argv[process.argv.indexOf('--offline') + 1] : null;

const readLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean) : []);
const prevMeta = existsSync(path.join(feedDir, 'meta.json')) ? JSON.parse(readFileSync(path.join(feedDir, 'meta.json'), 'utf8')) : { sources: [], count: 0 };
const prevStatus = new Map(prevMeta.sources.map((s) => [s.id, s]));

async function download(src) {
  try {
    let text;
    if (offline) {
      const f = ['.txt', '.csv'].map((ext) => path.join(offline, src.id + ext)).find(existsSync);
      if (!f) throw new Error('找不到離線檔案');
      text = readFileSync(f, 'utf8');
    } else {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(60000), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    }
    return { ok: true, domains: parseDomainList(text) };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? '連線逾時' : e.message };
  }
}

const now = new Date().toISOString();
const merged = [];
const problems = [];
for (const src of LIST_SOURCES.filter((s) => s.inFeed)) {
  const file = path.join(srcDir, src.id + '.txt');
  const m = mergeSource(src, readLines(file), await download(src), (prevStatus.get(src.id) || {}).lastOkAt || null, now);
  merged.push(m);
  if (m.problem) problems.push(m.problem);
  else writeFileSync(file, m.domains.join('\n') + '\n');
  console.log(`${m.status.ok ? '✔' : '✘'} ${src.name}：${m.status.count} 筆${m.problem ? '　' + m.status.error : ''}`);
}

const ctx = buildContext();
const { domains, removed } = buildFeed(merged, (d) => sanitizeDomains(d, ctx));
if (prevMeta.count >= 1000 && domains.length < prevMeta.count * 0.8) problems.push(`彙整後總筆數從 ${prevMeta.count} 降到 ${domains.length}`);
if (!domains.length) {
  console.error('彙整後沒有任何網域，不覆寫現有清單');
  process.exit(1);
}

const listFile = path.join(feedDir, 'blocklist.txt');
const listText = domains.join('\n') + '\n';
// 清單和問題都沒變、上次產生時間又在 36 小時內：什麼都不寫，避免每天產生只改時間的提交。
// 超過 36 小時就算內容沒變也更新產生時間，擴充功能才知道彙整流程還在運作（它把 4 天沒更新視為停擺）。
const unchanged = existsSync(listFile) && readFileSync(listFile, 'utf8') === listText
  && JSON.stringify(prevMeta.problems || []) === JSON.stringify(problems)
  && Date.now() - Date.parse(prevMeta.generatedAt) < 36 * 3600 * 1000;
if (unchanged) {
  console.log(`清單沒有變化（${domains.length} 筆），沿用 ${prevMeta.generatedAt} 的版本`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `problems=${problems.length}\ncount=${domains.length}\n`, { flag: 'a' });
  process.exit(0);
}
const meta = { version: 1, generatedAt: now, count: domains.length, removedProtected: removed.length, sources: merged.map((m) => m.status), problems };
writeFileSync(listFile, listText);
writeFileSync(path.join(feedDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
const problemFile = path.join(feedDir, 'problems.md');
if (problems.length) writeFileSync(problemFile, problemReport(problems, meta) + '\n');
else rmSync(problemFile, { force: true });
console.log(`feed/blocklist.txt：${domains.length} 筆（剔除官方／政府網域 ${removed.length} 筆）${problems.length ? `；${problems.length} 個問題` : ''}`);
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `problems=${problems.length}\ncount=${domains.length}\n`, { flag: 'a' });
