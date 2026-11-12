// 把判斷引擎（src/lib、src/data）打包進手機版網頁，輸出：
//   web/index.html          完整網頁，可放到任何靜態網站（例如 GitHub Pages）；
//                           搭配 web/manifest.webmanifest、web/sw.js 可安裝成手機 App，並接收其他 App「分享」過來的訊息
//   web/artifact.html       不含 <html>/<head>/<body> 外框的版本（給 claude.ai Artifact 發佈用）
// 用法：node tools/build-web.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// 依相依順序串接，拿掉 import／export 關鍵字
const parts = ['src/lib/domain.js', 'src/data/official-sites.js', 'src/data/risk-data.js', 'src/data/label-model.js', 'src/data/payment-data.js', 'src/lib/label-model-core.js', 'src/data/project.js', 'src/lib/checker.js'].map((f) => {
  const code = read(f)
    .replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^export\s+(const|function|class|let)\s/gm, '$1 ');
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`${f} 還有未處理的 import/export`);
  return `// ── ${f} ──\n${code}`;
});
const engine = `window.OUG = (() => {\n${parts.join('\n')}\nreturn { buildContext, assessUrl, assessMessage, OFFICIAL_SITES, issueUrl, PROJECT };\n})();`;

const template = read('web/template.html');
if (!template.includes('/*ENGINE*/')) throw new Error('template 缺少 /*ENGINE*/');
const fragment = template.replace('/*ENGINE*/', () => engine);
writeFileSync(path.join(root, 'web/artifact.html'), fragment);
writeFileSync(path.join(root, 'web/index.html'),
  `<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#0c4a6e">\n<link rel="apple-touch-icon" href="app-icon-192.png">\n</head>\n<body>\n${fragment}\n</body>\n</html>\n`);
console.log(`web/index.html、web/artifact.html 已產生（${Math.round(fragment.length / 1024)} KB）`);
