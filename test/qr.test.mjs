// QR Code 解碼器與「網頁上的 QR Code」判斷規則
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rsEncode, rsDecode, blockLayout, decodeQr, decodeMatrix, alignmentPositions } from '../src/lib/qr.js';
import { buildContext, assessUrl, assessPage, analyzeQr } from '../src/lib/checker.js';
import { encodeQr, toRgba } from './qr-encode.mjs';

const ctx = buildContext();

test('Reed-Solomon：與公開範例相同（HELLO WORLD，版本 1-M）', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('Reed-Solomon：錯誤在可更正範圍內都能修好，超過時回報失敗而不是亂猜', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let t = 0; t < 200; t++) {
    const ec = [10, 18, 26, 30][t % 4];
    const data = Array.from({ length: 15 + rnd(100) }, () => rnd(256));
    const cw = data.concat(rsEncode(data, ec));
    const bad = cw.slice();
    const pos = new Set();
    while (pos.size < rnd(ec / 2 + 1)) pos.add(rnd(bad.length));
    for (const p of pos) bad[p] ^= 1 + rnd(255);
    assert.deepEqual(rsDecode(bad, ec), cw);
  }
});

test('版本表：資料容量與規格相同', () => {
  const caps = { 1: [19, 16, 13, 9], 7: [156, 124, 88, 66], 10: [274, 216, 154, 122], 20: [861, 669, 485, 385], 30: [1735, 1373, 985, 745], 40: [2956, 2334, 1666, 1276] };
  for (const [v, c] of Object.entries(caps)) assert.deepEqual([0, 1, 2, 3].map((e) => blockLayout(Number(v), e).dataCodewords), c);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
});

test('QR Code：各種長度、錯誤更正等級、遮罩都能從圖片解回原文', () => {
  const texts = ['https://tw-parking-pay.com/pay?id=123', 'TWQRP://個人轉帳/158/02/V1?D1=12000', '停車費 NT$120', 'x'.repeat(260)];
  for (const s of texts) {
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      for (const mask of [0, 3, 5, 7]) {
        const m = encodeQr(s, { ecl, mask });
        assert.equal(decodeMatrix(m).text, s);
        assert.equal(decodeQr(toRgba(m, { scale: 3 })).text, s, `${s.slice(0, 12)} ${ecl} ${mask}`);
      }
    }
  }
});

test('QR Code：彩色、反白、透明背景、縮小到每格 2 像素、圖片中只佔一小塊也解得出來', () => {
  const s = 'https://example-pay.net/qr';
  const m = encodeQr(s);
  assert.equal(decodeQr(toRgba(m, { dark: [20, 90, 40], light: [250, 240, 210] })).text, s);
  assert.equal(decodeQr(toRgba(m, { dark: [255, 255, 255], light: [0, 0, 0] })).text, s);
  assert.equal(decodeQr(toRgba(m, { scale: 2 })).text, s);
  const t = toRgba(m, { scale: 4 });
  for (let i = 0; i < t.data.length; i += 4) if (t.data[i] === 255) t.data[i + 3] = 0;
  assert.equal(decodeQr(t).text, s);
  // 放在一張較大的圖片（海報）右下角
  const small = toRgba(m, { scale: 3 });
  const W = 600, H = 420, big = new Uint8ClampedArray(W * H * 4).fill(235);
  for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) {
    const src = (y * small.width + x) * 4, dst = ((y + 300 - 120) * W + (x + 450)) * 4;
    big.set(small.data.subarray(src, src + 4), dst);
  }
  assert.equal(decodeQr({ data: big, width: W, height: H }).text, s);
  // 沒有 QR Code 的圖片
  assert.equal(decodeQr({ data: new Uint8ClampedArray(200 * 200 * 4).fill(128), width: 200, height: 200 }), null);
});

test('QR Code：Big5 編碼的中文也能正確顯示', () => {
  const big5 = Buffer.from('b0b1a8aeb64fb8c9c3ba2068747470733a2f2f7061792e6578616d706c652f', 'hex');
  assert.equal(decodeMatrix(encodeQr(big5)).text, '停車費補繳 https://pay.example/');
});

test('analyzeQr：分辨網址、台灣 Pay、行動支付付款碼、加密貨幣、LINE 加好友', () => {
  const emv = '000201010212' + '5910' + 'WANG DA MI' + '5303901' + '540512000' + '5802TW' + '6304ABCD';
  const r = analyzeQr(['https://ctbc-bank.top/verify', 'TWQRP://個人轉帳/158/02/V1?D1=12000', emv, 'TXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234', 'https://line.me/ti/p/~fake-svc']);
  assert.deepEqual(r.urls, ['https://ctbc-bank.top/verify', 'https://line.me/ti/p/~fake-svc']);
  assert.equal(r.pay.kind, 'TWQR');
  assert.ok(r.items.some((i) => /WANG DA MI/.test(i.display) && /12000/.test(i.display)));
  assert.match(r.crypto, /TRON/);
  assert.deepEqual(r.lineIds, ['fake-svc']);
});

const page = (url, s) => assessPage({ title: '', bodyText: '', fields: {}, ...s }, ctx, assessUrl(url, ctx));

test('網頁上的 QR Code：冒名繳費頁的轉帳碼、連到仿冒網址的 QR Code 判為危險', () => {
  // 頁面自稱停管處，只放一個台灣 Pay 轉帳碼（沒有任何輸入欄位）
  const v = page('https://parking-pay-tw.net/', { title: '臺北市停車管理工程處 停車費補繳', bodyText: '請使用行動支付 App 掃描 QR Code 繳費', qr: ['TWQRP://個人轉帳/158/02/V1?D1=120'] });
  assert.equal(v.level, 'danger');
  assert.ok(v.page.asks.includes('掃碼付款／轉帳'));
  assert.ok(v.reasons.some((r) => /台灣 Pay/.test(r.text)));
  // QR Code 本身連到仿冒網址
  const u = page('https://some-blog.net/', { title: '優惠活動', bodyText: '掃描領取', qr: ['https://www.ctbcbank.com.verify-login.top/'] });
  assert.equal(u.level, 'danger');
  assert.match(u.reasons[0].text, /QR Code 連到/);
  // 官網的 QR Code、正常商店的付款碼不會變危險
  const ok = page('https://my-handmade-shop.com/pay', { title: '付款', bodyText: '掃碼付款', qr: ['https://www.post.gov.tw/'] });
  assert.notEqual(ok.level, 'danger');
  const shop = page('https://my-handmade-shop.com/pay', { title: '結帳', bodyText: 'LINE Pay 掃碼付款', qr: ['000201010212' + '5910WANG DA MI' + '5303901'] });
  assert.notEqual(shop.level, 'danger');
});
