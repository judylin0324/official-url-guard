// 擴充功能套件檢查：Chrome 載入時會拒絕的問題，在這裡先擋下來
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('manifest.json 列出的指令碼與頁面檔案都存在', () => {
  const m = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = [m.background.service_worker, m.options_page, m.action.default_popup,
    ...m.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]), ...m.web_accessible_resources.flatMap((w) => w.resources)];
  for (const f of files) assert.ok(existsSync(path.join(root, f)), `找不到 ${f}`);
});

test('src/ 的程式檔是合法 UTF-8，而且不含 Unicode 非字元（Chrome 會因此拒絕載入整個擴充功能）', () => {
  for (const f of walk(path.join(root, 'src')).filter((p) => /\.(js|css|html)$/.test(p))) {
    const buf = readFileSync(f);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf); // 不是 UTF-8 會丟出錯誤
    const bad = text.match(/[\ufdd0-\ufdef\ufffe\uffff]/);
    assert.equal(bad, null, `${path.relative(root, f)} 含有非字元 U+${bad ? bad[0].charCodeAt(0).toString(16).toUpperCase() : ''}（正規表示式請寫成 \\uffff）`);
  }
});
