// 測試用：產生 QR Code（位元組模式、UTF-8）與 PNG 圖檔。擴充功能本身不需要產生 QR Code。
import { deflateSync } from 'node:zlib';
import { rsEncode, blockLayout, functionMask, formatPositions, formatBits, versionBits, MASKS, dataOrder, alignmentPositions, ECL } from '../src/lib/qr.js';

/** @returns {number[][]} matrix[y][x]，1＝深色 */
export function encodeQr(text, { ecl = 'M', mask = 2, minVersion = 1 } = {}) {
  const e = ECL[ecl];
  const bytes = typeof text === 'string' ? [...Buffer.from(text, 'utf8')] : [...text]; // 也可以直接給位元組（測試 Big5 等編碼）
  let ver = minVersion;
  for (; ver <= 40; ver++) {
    const cc = ver <= 9 ? 8 : 16;
    if (4 + cc + bytes.length * 8 <= blockLayout(ver, e).dataCodewords * 8) break;
  }
  if (ver > 40) throw new Error('內容太長');
  const lay = blockLayout(ver, e);
  // 資料位元
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = lay.dataCodewords * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < lay.dataCodewords; pad ^= 0xec ^ 0x11) data.push(pad);
  // 分區塊、加上錯誤更正碼、交錯排列
  const blocks = [];
  for (let i = 0, k = 0; i < lay.blocks; i++) {
    const datLen = lay.shortLen - lay.ec + (i < lay.numShort ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ecc = rsEncode(dat, lay.ec);
    if (i < lay.numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== lay.shortLen - lay.ec || j >= lay.numShort) codewords.push(b[i]); });
  }
  // 畫固定圖案
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < size; i++) { m[6][i] = i % 2 === 0 ? 1 : 0; m[i][6] = i % 2 === 0 ? 1 : 0; }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        m[y][x] = d !== 2 && d !== 4 ? 1 : 0;
      }
    }
  }
  const al = alignmentPositions(ver);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m[al[j] + dy][al[i] + dx] = Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0;
    }
  }
  if (ver >= 7) {
    const vb = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const bit = (vb >>> i) & 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      m[b][a] = bit; m[a][b] = bit;
    }
  }
  // 放資料、套遮罩
  const func = functionMask(ver);
  const order = dataOrder(ver, func);
  order.forEach(([x, y], i) => {
    const bit = i < codewords.length * 8 ? (codewords[i >> 3] >>> (7 - (i & 7))) & 1 : 0;
    m[y][x] = bit ^ (MASKS[mask](x, y) ? 1 : 0);
  });
  const fb = formatBits(e, mask);
  for (const copy of [0, 1]) formatPositions(size, copy).forEach(([x, y], i) => { m[y][x] = (fb >>> i) & 1; });
  m[size - 8][8] = 1;
  return m;
}

/** 模組矩陣 → RGBA 像素（每格 scale 像素、四周留白 border 格） */
export function toRgba(matrix, { scale = 6, border = 4, dark = [0, 0, 0], light = [255, 255, 255] } = {}) {
  const n = matrix.length, w = (n + border * 2) * scale;
  const data = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - border, my = Math.floor(y / scale) - border;
      const on = mx >= 0 && my >= 0 && mx < n && my < n && matrix[my][mx];
      const c = on ? dark : light, p = (y * w + x) * 4;
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    }
  }
  return { data, width: w, height: w };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA 像素 → PNG */
export function toPng({ data, width, height }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
