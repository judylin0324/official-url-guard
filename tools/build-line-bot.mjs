// 產生 LINE 機器人要打包的資料：line-bot/src/generated/data.js
//   涉詐網域清單（feed/blocklist.txt，已淨化）直接打包進 Worker，啟動時就建好判斷用的資料，
//   每則訊息不用再下載或解析清單（Cloudflare Workers 免費方案每個請求只有 10 毫秒 CPU）。
//   官方網站清單由 src/data/official-sites.js 直接匯入，同樣在部署時打包。
// 清單每天更新：GitHub Actions「LINE 機器人部署」在每日彙整完成後重新部署（見 .github/workflows/line-bot.yml）。
// 用法：node tools/build-line-bot.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'line-bot/src/generated');
mkdirSync(outDir, { recursive: true });

const listFile = path.join(root, 'feed/blocklist.txt');
const metaFile = path.join(root, 'feed/meta.json');
const domains = existsSync(listFile)
  ? readFileSync(listFile, 'utf8').split('\n').map((x) => x.trim().toLowerCase()).filter((x) => x && !x.startsWith('#'))
  : [];
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const body = [
  '// 由 tools/build-line-bot.mjs 產生，請勿手動修改（這個檔案不進版本控制）',
  `export const BUILT_AT = ${JSON.stringify(new Date().toISOString())};`,
  `export const ENGINE_VERSION = ${JSON.stringify(manifest.version)};`,
  `export const FEED_GENERATED_AT = ${JSON.stringify(meta.generatedAt || null)};`,
  `export const BLOCKLIST = ${JSON.stringify(domains)};`,
  '',
].join('\n');
writeFileSync(path.join(outDir, 'data.js'), body);
console.log(`line-bot/src/generated/data.js：涉詐網域 ${domains.length} 筆（彙整時間 ${meta.generatedAt || '未知'}），判斷引擎 ${manifest.version}`);
