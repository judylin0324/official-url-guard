// 官網 Logo 指紋比對
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dhash, hamming, matchLogo, validateLogoDb, informative } from '../src/lib/image-hash.js';
import { buildContext, assessUrl, assessPage } from '../src/lib/checker.js';
import { OFFICIAL_SITES } from '../src/data/official-sites.js';
import { LOGO_HASHES } from '../src/data/logo-hashes.js';

/** 用函式畫一張圖：f(x, y) 回傳 [r, g, b]，座標是 0～1 */
export function draw(w, h, f, alpha = () => 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f((x + 0.5) / w, (y + 0.5) / h);
    data.set([r, g, b, alpha((x + 0.5) / w, (y + 0.5) / h)], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}
// 兩個不同的「Logo」
const bankLogo = (x, y) => (Math.hypot(x - 0.25, y - 0.5) < 0.2 ? [200, 20, 40] : x > 0.5 && y > 0.3 && y < 0.7 ? [30, 60, 140] : [255, 255, 255]);
const shopLogo = (x, y) => (Math.abs(x - y) < 0.12 ? [20, 140, 60] : y > 0.8 ? [240, 160, 0] : [255, 255, 255]);

test('指紋：同一張 Logo 放大縮小、改成透明背景，指紋幾乎一樣；不同 Logo 差很多', () => {
  const a = dhash(draw(240, 120, bankLogo));
  const b = dhash(draw(96, 48, bankLogo));
  const c = dhash(draw(240, 120, bankLogo, (x, y) => (bankLogo(x, y)[0] === 255 ? 0 : 255)));
  const d = dhash(draw(240, 120, shopLogo));
  assert.ok(a && b && c && d);
  assert.ok(hamming(a, b) <= 10, `縮放 ${hamming(a, b)}`);
  assert.ok(hamming(a, c) <= 10, `透明 ${hamming(a, c)}`);
  assert.ok(hamming(a, d) > 30, `不同 ${hamming(a, d)}`);
});

test('指紋：空白或純色圖片沒有辨識力，不產生指紋', () => {
  assert.equal(dhash(draw(64, 64, () => [255, 255, 255])), null);
  assert.equal(dhash(draw(64, 64, () => [200, 30, 30])), null);
  assert.equal(informative('0'.repeat(32)), false);
});

test('指紋資料庫：只接受官方清單裡的機構，格式不對就拒絕', () => {
  const h = dhash(draw(200, 100, bankLogo));
  const ok = validateLogoDb({ format: 'oug-logo-hashes', hashes: [
    { h, site: '中國信託商業銀行', domain: 'ctbcbank.com', kind: 'icon' },
    { h, site: '中國信託商業銀行', domain: 'ctbc-bank.top', kind: 'icon' }, // 網域不屬於這個機構
    { h, site: '假銀行', domain: 'fake.com', kind: 'icon' },
    { h: 'zz', site: '中國信託商業銀行', domain: 'ctbcbank.com' },
  ] }, OFFICIAL_SITES);
  assert.equal(ok.ok, true);
  assert.equal(ok.hashes.length, 1);
  assert.equal(validateLogoDb({ hashes: [] }, OFFICIAL_SITES).ok, false);
  assert.equal(matchLogo(dhash(draw(80, 40, bankLogo)), ok.hashes).site, '中國信託商業銀行');
  assert.equal(matchLogo(dhash(draw(80, 40, shopLogo)), ok.hashes), null);
  // 內建的指紋資料庫格式正確（GitHub Actions 每週更新）
  assert.equal(LOGO_HASHES.format, 'oug-logo-hashes');
  if (LOGO_HASHES.hashes.length) assert.equal(validateLogoDb(LOGO_HASHES, OFFICIAL_SITES).ok, true);
});

const ctx = buildContext();
const page = (url, s) => assessPage({ title: '', bodyText: '', fields: {}, ...s }, ctx, assessUrl(url, ctx));

test('Logo 比對：網站圖示和中國信託一樣、又要卡號 → 危險；只有 Logo 一樣（新聞、介紹）→ 不加分', () => {
  const logo = [{ site: '中國信託商業銀行', domain: 'ctbcbank.com', kind: 'icon', distance: 1 }];
  const v = page('https://card-service-tw.com/verify', { title: '信用卡驗證', bodyText: '請輸入卡號', fields: { card: true }, logo });
  assert.equal(v.level, 'danger');
  assert.match(v.reasons[0].text, /中國信託.*網站圖示.*圖片比對/);
  assert.equal(v.impersonating.domain, 'ctbcbank.com');
  const news = page('https://some-news-site.com/article', { title: '銀行新聞', bodyText: '中信銀今日宣布', logo });
  assert.notEqual(news.level, 'danger');
  assert.ok(!news.reasons.some((r) => r.weight > 0 && /圖片比對|網站圖示/.test(r.text)));
  // 結帳頁上的支付品牌 Logo（不是網站圖示）不算
  const shop = page('https://my-handmade-shop.com/checkout', { title: '結帳', bodyText: '', fields: { card: true }, logo: [{ site: '街口支付', domain: 'jkopay.com', kind: 'logo', distance: 2 }] });
  assert.notEqual(shop.level, 'danger');
  // 政府網站共用的圖示（例如國徽）
  const gov = page('https://fine-pay-tw.com/', { title: '罰鍰繳納', bodyText: '', fields: { card: true }, logo: [{ site: null, domain: null, gov: true, kind: 'icon', distance: 0 }] });
  assert.equal(gov.level, 'danger');
  assert.match(gov.reasons[0].text, /政府網站/);
});
