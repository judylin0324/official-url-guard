// 建立「官網 Logo 指紋」：逐一打開官方網站首頁，找出網站圖示（favicon、apple-touch-icon）與頁首 Logo，
// 在 Chromium 裡解碼後算出 dHash 指紋，寫入 src/data/logo-hashes.js。
// 由 GitHub Actions 每週執行（.github/workflows/logo-hashes.yml）；需要 Playwright 與 Chromium。
// 用法：node tools/build-logo-hashes.mjs [--limit 20] [--no-merge]
//   這次連不上的機構，預設沿用上次的指紋（--no-merge 則整份重建）。
//   很多台灣政府與銀行網站會擋國外連線，GitHub Actions 的機器在國外，連不上的可以在台灣的電腦上執行一次補齊。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_SITES } from '../src/data/official-sites.js';
import { LOGO_HASHES as PREVIOUS } from '../src/data/logo-hashes.js';
import { hamming, LOGO_MATCH_DISTANCE } from '../src/lib/image-hash.js';
import { parseHost } from '../src/lib/domain.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const UA = 'Mozilla/5.0 (compatible; OfficialUrlGuardBot/1.0; +https://github.com/judylin0324/official-url-guard)';
const isGov = (d) => /(^|\.)(gov\.tw|gov\.taipei|go\.jp|lg\.jp)$/.test(d);

/** 連不上（網路錯誤、逾時）回傳 null；伺服器拒絕回傳 { status } */
async function fetchWithTimeout(url, ms, asText) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: asText ? 'text/html' : 'image/*,*/*;q=0.5' }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) return asText ? { status: res.status } : null;
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

// 首頁是用 JavaScript 產生、或擋程式讀取時，改用真的瀏覽器打開
const webCtx = await browser.newContext({ locale: 'zh-TW' });
const web = await webCtx.newPage();
async function imagesViaBrowser(home) {
  try {
    await web.goto(home, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await web.waitForTimeout(2500);
    return await web.evaluate(() => {
      const out = [];
      for (const l of document.querySelectorAll('link[rel~="icon" i][href], link[rel="apple-touch-icon" i][href]')) if (!/mask-icon/i.test(l.rel)) out.push({ url: l.href, kind: 'icon' });
      out.push({ url: location.origin + '/favicon.ico', kind: 'icon' });
      let n = 0;
      for (const img of document.images) {
        if (n >= 4) break;
        const hint = `${img.className} ${img.id} ${img.alt} ${img.getAttribute('src') || ''}`;
        const inHeader = img.closest('header, nav, .header, #header, .navbar, [role="banner"]');
        if (!img.currentSrc || img.currentSrc.startsWith('data:') || !(/logo/i.test(hint) || inHeader)) continue;
        out.push({ url: img.currentSrc, kind: 'logo' });
        n++;
      }
      return out.filter((x, i, a) => a.findIndex((y) => y.url === x.url) === i).slice(0, 8);
    });
  } catch { return null; }
}
async function downloadViaBrowser(url) {
  try {
    const r = await webCtx.request.get(url, { timeout: 15000 });
    if (!r.ok()) return null;
    const buf = await r.body();
    return buf.length && buf.length < 3e6 ? { buf, type: r.headers()['content-type'] || '' } : null;
  } catch { return null; }
}

const entries = [];
const unreachable = [];
const noImage = [];
let n = 0;
for (const site of OFFICIAL_SITES) {
  if (n >= LIMIT) break;
  n++;
  const domain = site.domains[0];
  const home = 'https://' + (site.home || (parseHost(domain).registrable === domain ? 'www.' + domain : domain)) + '/';
  const html = await fetchWithTimeout(home, 15000, true);
  let got = 0;
  const add = async (img, dl) => {
    const r = await dl(img.url);
    if (!r) return;
    const h = await hashImage(r.buf, r.type).catch(() => null);
    if (!h) return;
    entries.push({ h, site: site.name, domain, kind: img.kind, gov: site.domains.some(isGov) });
    got++;
  };
  if (html && html.text) for (const img of findImages(html.text, html.url)) await add(img, (u) => fetchWithTimeout(u, 15000, false));
  // 讀得到首頁卻找不到圖（JavaScript 產生的網頁），或伺服器拒絕程式讀取：改用瀏覽器
  if (!got && html) {
    for (const img of (await imagesViaBrowser(home)) || []) await add(img, downloadViaBrowser);
  }
  if (!html) unreachable.push(site.name);
  else if (!got) noImage.push(site.name);
  console.log(`${got ? '✔' : '○'} ${site.name}（${got} 張）${html ? '' : '：連不上'}`);
}
await browser.close();

// 同一個品牌家族（國泰世華銀行、國泰人壽…）共用 Logo 是正常的
const GENERIC = new Set(['銀行', '證券', '人壽', '產險', '保險', '投信', '投顧', '中華', '台灣', '臺灣', '國際', '金融', '商業', '公司', '股份', '有限', '政府', '日本', '交通', '中央', '國家']);
function sameFamily(siteNames) {
  const names = [...siteNames];
  const first = names[0];
  for (let i = 0; i + 2 <= first.length; i++) {
    const bi = first.slice(i, i + 2);
    if (!GENERIC.has(bi) && /[\u4e00-\u9fff]{2}/.test(bi) && names.every((nm) => nm.includes(bi))) return true;
  }
  const labels = names.map((nm) => {
    const site = OFFICIAL_SITES.find((x) => x.name === nm);
    return site ? parseHost(site.domains[0]).label || '' : '';
  });
  // 網域名稱有共同開頭（ctbcbank、ctbcsec）或互相包含（taipeifubon、fubon）
  const prefix = labels.reduce((a, b) => { let k = 0; while (k < a.length && a[k] === b[k]) k++; return a.slice(0, k); });
  if (prefix.length >= 4) return true;
  const shortest = labels.slice().sort((a, b) => a.length - b.length)[0];
  return shortest.length >= 5 && labels.every((l) => l.includes(shortest));
}

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
  if (sites.size === 1 || sameFamily(sites)) {
    for (const k of group) {
      const e = entries[k];
      if (!hashes.some((x) => x.site === e.site && x.h === e.h)) hashes.push({ h: e.h, site: e.site, domain: e.domain, kind: e.kind });
    }
  } else if (group.every((k) => entries[k].gov)) {
    hashes.push({ h: entries[i].h, site: null, domain: null, gov: true, kind: entries[i].kind });
  }
}

// 這次連不上或抓不到圖的機構，沿用上次的指紋（網站暫時故障、擋國外連線時不會被清掉）
if (!process.argv.includes('--no-merge') && PREVIOUS && Array.isArray(PREVIOUS.hashes)) {
  const fresh = new Set(entries.map((e) => e.site));
  const names = new Set(OFFICIAL_SITES.map((x) => x.name));
  let kept = 0;
  for (const e of PREVIOUS.hashes) {
    const carry = e.site ? !fresh.has(e.site) && names.has(e.site) : !hashes.some((x) => x.gov);
    if (carry && !hashes.some((x) => x.h === e.h && x.site === e.site)) { hashes.push(e); kept++; }
  }
  if (kept) console.log(`沿用上次的指紋 ${kept} 個`);
}

const out = { format: 'oug-logo-hashes', generatedAt: new Date().toISOString(), sites: new Set(hashes.map((x) => x.site)).size, hashes };
writeFileSync(path.join(root, 'src/data/logo-hashes.js'),
  `// 官網 Logo 指紋（由 tools/build-logo-hashes.mjs 自動產生，請勿手動修改）\nexport const LOGO_HASHES = ${JSON.stringify(out, null, 0)};\n`);
const list = (a) => `${a.length} 個${a.length ? `（${a.slice(0, 12).join('、')}${a.length > 12 ? '…' : ''}）` : ''}`;
console.log(`\n完成：${n} 個機構，${out.sites} 個有指紋，共 ${hashes.length} 個指紋`);
console.log(`連不上（多半是擋國外連線）：${list(unreachable)}`);
console.log(`連上了但抓不到圖：${list(noImage)}`);
