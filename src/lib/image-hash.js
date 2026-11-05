// 圖片指紋（128 位元）：
//   前 64 位元：平均雜湊（aHash）—— 縮成 8×8 灰階，比平均暗的格子記 1（抓「哪裡有圖案」）
//   後 64 位元：差異雜湊（dHash）—— 縮成 9×8 灰階，右邊比左邊亮記 1（抓「邊緣在哪」）
// 同一張 Logo 就算被另存、縮放、轉檔，指紋也幾乎一樣；不同圖片的指紋差很多。
// 擴充功能（比對網頁上的 Logo）和 GitHub Actions（建立官網 Logo 指紋）共用這份程式，確保算法一致。

/** 灰階圖用區塊平均縮成 W×H（不依賴瀏覽器的縮圖演算法） */
function boxResize(gray, w, h, W, H) {
  const small = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = (y * h) / H, y1 = ((y + 1) * h) / H;
    for (let x = 0; x < W; x++) {
      const x0 = (x * w) / W, x1 = ((x + 1) * w) / W;
      let sum = 0, area = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          if (wx <= 0) continue;
          sum += gray[yy * w + xx] * wx * wy;
          area += wx * wy;
        }
      }
      small[y * W + x] = area ? sum / area : 255;
    }
  }
  return small;
}
const toHex = (bits) => {
  let hex = '';
  for (let i = 0; i < bits.length; i += 8) hex += bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0).toString(16).padStart(2, '0');
  return hex;
};

/** RGBA 像素 → 32 個十六進位字元的指紋；圖片太單調（幾乎同一個顏色）時回傳 null */
export function dhash({ data, width: w, height: h }) {
  if (!w || !h) return null;
  // 先疊在白色背景上轉灰階（透明背景的 Logo 很常見）
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = data[p + 3] / 255;
    gray[i] = a * (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) + (1 - a) * 255;
  }
  const avg = boxResize(gray, w, h, 8, 8);
  const dif = boxResize(gray, w, h, 9, 8);
  // 太單調的圖（空白、純色）沒有辨識力
  let min = 255, max = 0;
  for (const v of avg) { if (v < min) min = v; if (v > max) max = v; }
  if (max - min < 24) return null;
  const mean = avg.reduce((a, b) => a + b, 0) / 64;
  const bits = [];
  for (const v of avg) bits.push(v < mean - 1 ? 1 : 0);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(dif[y * 9 + x] < dif[y * 9 + x + 1] - 2 ? 1 : 0);
  const hex = toHex(bits);
  return informative(hex) ? hex : null;
}

const POP = Array.from({ length: 256 }, (_, n) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; });
export function hamming(a, b) {
  if (a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) d += POP[parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)];
  return d;
}
const ones = (hex) => { let c = 0; for (let i = 0; i < hex.length; i += 2) c += POP[parseInt(hex.slice(i, i + 2), 16)]; return c; };

/** 指紋太單純（例如幾乎全白只有一個小點、簡單漸層），容易和別的圖撞在一起 */
export function informative(hex) {
  if (!/^[0-9a-f]{32}$/.test(hex)) return false;
  const a = ones(hex.slice(0, 16)), d = ones(hex.slice(16));
  return a >= 6 && a <= 58 && d >= 3 && a + d >= 14;
}

export const LOGO_MATCH_DISTANCE = 10; // 128 位元中最多差幾個位元算同一張圖

/**
 * 在官網 Logo 指紋資料庫中找最接近的一筆
 * @param {string} hash
 * @param {{h: string, site: string|null, domain: string|null, gov?: boolean, kind: string}[]} db
 */
export function matchLogo(hash, db) {
  if (!hash || !db) return null;
  let best = null;
  for (const e of db) {
    const d = hamming(hash, e.h);
    if (d <= LOGO_MATCH_DISTANCE && (!best || d < best.distance)) best = { ...e, distance: d };
  }
  return best;
}

/** 下載來的指紋資料庫要先檢查格式；機構必須在官方清單裡 */
export function validateLogoDb(json, officialSites) {
  if (!json || json.format !== 'oug-logo-hashes' || !Array.isArray(json.hashes)) return { ok: false, error: '格式不對' };
  if (json.hashes.length > 8000) return { ok: false, error: '筆數過多' };
  const domains = new Map();
  for (const s of officialSites) for (const d of s.domains) domains.set(d, s.name);
  const out = [];
  for (const e of json.hashes) {
    if (!e || typeof e.h !== 'string' || !informative(e.h)) continue;
    if (e.gov === true && !e.domain) { out.push({ h: e.h, site: null, domain: null, gov: true, kind: String(e.kind || 'logo') }); continue; }
    if (typeof e.domain !== 'string' || domains.get(e.domain) !== e.site) continue;
    out.push({ h: e.h, site: e.site, domain: e.domain, kind: e.kind === 'icon' ? 'icon' : 'logo' });
  }
  if (!out.length) return { ok: false, error: '沒有可用的指紋' };
  return { ok: true, hashes: out };
}
