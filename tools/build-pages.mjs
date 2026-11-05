// 產生 GitHub Pages 網站內容到 _site/：手機版簡訊檢查網頁、官方清單 JSON、隱私權政策
// 用法：node tools/build-pages.mjs
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_SITES } from '../src/data/official-sites.js';
import { exportOfficial } from '../src/lib/remote-official.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'tools/build-web.mjs')], { stdio: 'inherit' });
copyFileSync(path.join(root, 'web/index.html'), path.join(out, 'index.html'));
copyFileSync(path.join(root, 'web/privacy.html'), path.join(out, 'privacy.html'));
// Gmail 收件匣過濾（Apps Script）：讓使用者直接打開複製
execFileSync(process.execPath, [path.join(root, 'tools/build-gmail.mjs')], { stdio: 'inherit' });
mkdirSync(path.join(out, 'gmail'), { recursive: true });
for (const f of ['Code.gs', 'Engine.gs']) copyFileSync(path.join(root, 'gmail/dist', f), path.join(out, 'gmail', f));
const json = exportOfficial(OFFICIAL_SITES);
writeFileSync(path.join(out, 'official-sites.json'), JSON.stringify(json));
writeFileSync(path.join(out, '.nojekyll'), '');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
console.log(`_site/ 已產生：index.html、privacy.html、official-sites.json（${json.sites.length} 個機構）；插件版本 ${manifest.version}`);
