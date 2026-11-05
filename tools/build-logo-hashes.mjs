// 建立「官網 Logo 指紋」：逐一打開官方網站首頁，找出網站圖示（favicon、apple-touch-icon）與頁首 Logo，
// 在 Chromium 裡解碼後算出 dHash 指紋，寫入 src/data/logo-hashes.js。
// 由 GitHub Actions 每週執行（.github/workflows/logo-hashes.yml）；需要 Playwright 與 Chromium。
// 用法：node tools/build-logo-hashes.mjs [--limit 20]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_SITES } from '../src/data/official-sites.js';
import { hamming, LOGO_MATCH_DISTANCE } from '../src/lib/image-hash.js';
import { parseHost } from '../src/lib/domain.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const UA = 'Mozilla/5.0 (compatible; OfficialUrlGuardBot/1.0; +https://github.com/judylin0324/official-url-guard)';
const isGov = (d) => /(^|\.)(gov\.tw|gov\.taipei|go\.jp|lg\.jp)$/.test(d);

async function fetchWithTimeout(url, ms, asText) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: asText ? 'text/html' : 'image/*,*/*;q=0.5' }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) return null;
    if (asText) return { url: res.url || url, text: (await res.text()).slice(0, 600000) };
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length < 3e6 ? { url: res.url || url, buf, type: res.headers.get('content-type') || '' } : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };

/** 從首頁 HTML 找圖示與 Logo 的網址 */
function findImages(html, base) {
  const out = [];
  const abs = (u) => { try { const x = new URL(u.replace(/&amp;/g, '&'), base); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase();
    if (!/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const u = abs(attr(tag, 'href'));
    if (u) out.push({ url: u, kind: 'icon' });
  }
  out.push({ url: new URL('/favicon.ico', base).href, kind: 'icon' });
  let logos = 0;
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const hint = `${attr(tag, 'class')} ${attr(tag, 'id')} ${attr(tag, 'alt')} ${attr(tag, 'src')}`;
    if (!/logo/i.test(hint)) continue;
    const u = abs(attr(tag, 'src') || attr(tag, 'data-src'));
    if (u && !u.startsWith('data:')) { out.push({ url: u, kind: 'logo' }); if (++logos >= 4) break; }
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.url) ? false : seen.add(x.url))).slice(0, 8);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><title>decoder</title>');
// 把共用的指紋程式注入頁面（和擴充功能用同一份）
const lib = readFileSync(path.join(root, 'src/lib/image-hash.js'), 'utf8').replace(/^export\s+/gm, '');
await page.addScriptTag({ content: `window.__ih = (() => { ${lib}\nreturn { dhash }; })();` });

async function hashImage(buf, type) {
  return page.evaluate(async ({ b64, type }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: type || '' });
    let src;
    try { src = await createImageBitmap(blob); } catch {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch { return null; }
      src = img;
    }
    const w0 = src.width || 256, h0 = src.height || 256;
    const s = Math.min(1, 256 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    if (w < 12 || h < 12) return null;
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, w, h);
    return window.__ih.dhash(g.getImageData(0, 0, w, h));
  }, { b64: buf.toString('base64'), type: /image\//.test(type) ? type.split(';')[0] : '' });
}

const entries = [];
const failed = [];
let n = 0;
for (const site of OFFICIAL_SITES) {
  if (n >= LIMIT) break;
  n++;
  const domain = site.domains[0];
  const home = 'https://' + (site.home || (parseHost(domain).registrable === domain ? 'www.' + domain : domain)) + '/';
  const html = await fetchWithTimeout(home, 15000, true);
  if (!html) { failed.push(site.name); continue; }
  let got = 0;
  for (const img of findImages(html.text, html.url)) {
    const r = await fetchWithTimeout(img.url, 15000, false);
    if (!r) continue;
    const h = await hashImage(r.buf, r.type).catch(() => null);
    if (!h) continue;
    entries.push({ h, site: site.name, domain, kind: img.kind, gov: site.domains.some(isGov) });
    got++;
  }
  console.log(`${got ? '✔' : '○'} ${site.name}（${got} 張）`);
}
await browser.close();

// 同一張圖出現在不同機構（例如網站平台預設圖示），就沒有辨識力：
// 只出現在政府機關之間的（例如國徽）改成「政府網站」；跨到非政府機構的整組剔除
const hashes = [];
const used = new Set();
for (let i = 0; i < entries.length; i++) {
  if (used.has(i)) continue;
  const group = [i];
  for (let j = i + 1; j < entries.length; j++) if (!used.has(j) && hamming(entries[i].h, entries[j].h) <= LOGO_MATCH_DISTANCE) group.push(j);
  group.forEach((k) => used.add(k));
  const sites = new Set(group.map((k) => entries[k].site));
  if (sites.size === 1) {
    for (const k of group) {
      const e = entries[k];
      if (!hashes.some((x) => x.site === e.site && x.h === e.h)) hashes.push({ h: e.h, site: e.site, domain: e.domain, kind: e.kind });
    }
  } else if (group.every((k) => entries[k].gov)) {
    hashes.push({ h: entries[i].h, site: null, domain: null, gov: true, kind: entries[i].kind });
  }
}

const out = { format: 'oug-logo-hashes', generatedAt: new Date().toISOString(), sites: new Set(hashes.map((x) => x.site)).size, hashes };
writeFileSync(path.join(root, 'src/data/logo-hashes.js'),
  `// 官網 Logo 指紋（由 tools/build-logo-hashes.mjs 自動產生，請勿手動修改）\nexport const LOGO_HASHES = ${JSON.stringify(out, null, 0)};\n`);
console.log(`\n完成：${n} 個機構，${hashes.length} 個指紋；連不上 ${failed.length} 個（${failed.slice(0, 10).join('、')}${failed.length > 10 ? '…' : ''}）`);
