// 產生 Gmail 收件匣過濾的 Apps Script 檔案到 gmail/dist/：Code.gs（主程式）、Engine.gs（判斷引擎＋URL 替代實作）
// 用法：node tools/build-gmail.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const FILES = ['src/lib/domain.js', 'src/data/official-sites.js', 'src/data/risk-data.js', 'src/data/label-model.js',
  'src/lib/label-model-core.js', 'src/data/project.js', 'src/lib/checker.js', 'src/lib/blocklist.js'];

export function buildEngine() {
  const parts = FILES.map((f) => {
    const code = read(f).replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '').replace(/^export\s+(const|function|class|let)\s/gm, '$1 ');
    if (/^\s*(import|export)\s/m.test(code)) throw new Error(`${f} 還有未處理的 import/export`);
    return `// ── ${f} ──\n${code}`;
  });
  const version = JSON.parse(read('manifest.json')).version;
  return `// 自動產生：node tools/build-gmail.mjs（請勿手動修改）官網守門員判斷引擎 v${version}\n${read('gmail/url-polyfill.js')}\n`
    + `var OUG = (function () {\n${parts.join('\n')}\nreturn { buildContext, assessUrl, assessMessage, parseDomainList, sanitizeDomains, OFFICIAL_SITES, version: '${version}' };\n})();\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.join(root, 'gmail/dist');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'Engine.gs'), buildEngine());
  copyFileSync(path.join(root, 'gmail/Code.gs'), path.join(out, 'Code.gs'));
  console.log('gmail/dist/ 已產生：Code.gs、Engine.gs');
}
