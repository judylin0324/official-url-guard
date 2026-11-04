// 核對候選官方網域：必須出現在 Chrome 台灣熱門網站清單（CrUX）中，避免收錄記錯或不存在的網域。
// 用法：node tools/verify-domains.mjs <crux-tw.csv.gz> <候選檔.json>
//   候選檔格式：[{ name, category, domains: [...] , ...其他欄位 }]
// 輸出：每個網域的最佳排名；沒有出現的網域會標出來。
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseHost } from '../src/lib/domain.js';

const [cruxPath, candPath] = process.argv.slice(2);
const rank = new Map();
for (const line of gunzipSync(readFileSync(cruxPath)).toString('utf8').split('\n').slice(1)) {
  const [origin, r] = line.split(',');
  if (!origin) continue;
  let host;
  try { host = new URL(origin).hostname; } catch { continue; }
  // 記錄網域本身與每一層上層網域的最佳排名
  let h = host;
  while (h.includes('.')) {
    const cur = rank.get(h);
    if (!cur || Number(r) < cur) rank.set(h, Number(r));
    h = h.slice(h.indexOf('.') + 1);
  }
}
const cands = JSON.parse(readFileSync(candPath, 'utf8'));
let ok = 0, missing = 0;
const out = [];
for (const c of cands) {
  const res = c.domains.map((d) => ({ d, r: rank.get(d) || null, reg: parseHost(d).registrable === d }));
  const keep = res.filter((x) => x.r);
  ok += keep.length; missing += res.length - keep.length;
  out.push({ ...c, domains: keep.map((x) => x.d), _ranks: Object.fromEntries(res.map((x) => [x.d, x.r])) });
}
console.error(`核對完成：${ok} 個網域出現在台灣熱門網站、${missing} 個沒有出現`);
console.log(JSON.stringify(out, null, 1));
