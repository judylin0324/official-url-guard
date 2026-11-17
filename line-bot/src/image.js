// 從使用者傳來的圖片解出 QR Code。解碼圖片很吃運算時間，
// Cloudflare Workers 免費方案（每個請求 10 毫秒 CPU）跑不完，所以預設關閉（環境變數 IMAGE_QR=on 才開啟，需要付費方案）。
import { decodeQr } from '../../src/lib/qr.js';
import { decodePng, isPng } from './png.js';

const isJpeg = (b) => b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** 圖片太大時每邊縮小一半（取 2×2 平均），QR Code 解碼器最多處理 400 萬像素 */
export function halve(img) {
  const w = img.width >> 1, h = img.height >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  const s = img.data, W = img.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = ((2 * y) * W + 2 * x) * 4, b = a + 4, c = a + W * 4, d = c + 4, o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (s[a + k] + s[b + k] + s[c + k] + s[d + k]) >> 2;
    }
  }
  return { data: out, width: w, height: h };
}

/** 解碼 PNG 或 JPEG。JPEG 用 jpeg-js（只有開啟圖片功能時才會載入） */
export async function decodeImage(bytes) {
  if (isPng(bytes)) return decodePng(bytes);
  if (isJpeg(bytes)) {
    const { default: decodeJpeg } = await import('jpeg-js/lib/decoder.js');
    try {
      const r = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 24, maxMemoryUsageInMB: 96 });
      return { data: r.data, width: r.width, height: r.height };
    } catch { return null; }
  }
  return null;
}

/**
 * @returns {Promise<{ok: boolean, text?: string}>} ok=false：圖片讀不了；text 沒有值：讀得了但沒有 QR Code
 */
export async function qrFromImage(bytes) {
  let img = await decodeImage(bytes);
  if (!img) return { ok: false };
  while (img.width * img.height > 4e6) img = halve(img);
  const r = decodeQr(img) || (img.width * img.height > 1e6 ? decodeQr(halve(img)) : null);
  return { ok: true, text: r ? r.text : undefined };
}
