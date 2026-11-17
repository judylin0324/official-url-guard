// 精簡的 PNG 解碼器（給 QR Code 截圖用）。用平台內建的 DecompressionStream 解壓縮，不需要外部程式庫。
// 支援：灰階、RGB、調色盤、灰階＋透明、RGBA；位元深度 1／2／4／8／16。不支援交錯式（Adam7）PNG。

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export const isPng = (b) => b && b.length > 8 && SIG.every((x, i) => b[i] === x);

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @returns {Promise<{data: Uint8ClampedArray, width: number, height: number} | null>} */
export async function decodePng(bytes, { maxPixels = 16e6 } = {}) {
  if (!isPng(bytes)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p);
    const name = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (name === 'IHDR') { width = dv.getUint32(p + 8); height = dv.getUint32(p + 12); depth = bytes[p + 16]; type = bytes[p + 17]; interlace = bytes[p + 20]; }
    else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    p += 12 + len;
  }
  if (!width || !height || width * height > maxPixels || interlace) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return null;
  let total = 0;
  for (const c of idat) total += c.length;
  const joined = new Uint8Array(total);
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  let raw;
  try { raw = await inflate(joined); } catch { return null; }

  const bpp = Math.max(1, (channels * depth) >> 3); // 用來做過濾運算的「每像素位元組數」
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < (stride + 1) * height) return null;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[x] = v & 255;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  const sample = (row, i) => {
    // 取第 i 個樣本，轉成 0–255
    if (depth === 8) return row[i];
    if (depth === 16) return row[i * 2];
    const perByte = 8 / depth;
    const v = (row[Math.floor(i / perByte)] >> (8 - depth * ((i % perByte) + 1))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const q = (y * width + x) * 4;
      if (type === 3) {
        const idx = sample(row, x);
        rgba[q] = palette ? palette[idx * 3] : 0; rgba[q + 1] = palette ? palette[idx * 3 + 1] : 0; rgba[q + 2] = palette ? palette[idx * 3 + 2] : 0;
        rgba[q + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(row, x * channels);
        rgba[q] = rgba[q + 1] = rgba[q + 2] = g;
        rgba[q + 3] = type === 4 ? sample(row, x * channels + 1) : 255;
      } else {
        rgba[q] = sample(row, x * channels); rgba[q + 1] = sample(row, x * channels + 1); rgba[q + 2] = sample(row, x * channels + 2);
        rgba[q + 3] = type === 6 ? sample(row, x * channels + 3) : 255;
      }
    }
  }
  return { data: rgba, width, height };
}
