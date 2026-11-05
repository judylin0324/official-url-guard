// QR Code 解碼器（純 JavaScript、無外部程式庫），給「網頁上的繳費 QR Code」用。
// 網頁上的 QR Code 是電腦產生的清晰圖片（不是用相機拍的），所以只處理「正面、沒有透視變形」的情況：
//   找三個定位圖案 → 推算版本與每格大小 → 取樣 → 讀格式資訊 → 去遮罩 → 讀出碼字 → Reed-Solomon 更正 → 解析內容
// 規格依 ISO/IEC 18004；表格與排列方式和 Nayuki、ZXing 的實作一致。

// ───────── GF(256) 與 Reed-Solomon ─────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);

/** 產生錯誤更正碼字（data 後面接的那一段）：data(x)·x^n 除以 g(x)=Π(x-α^i) 的餘式 */
export function rsEncode(data, n) {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem.shift();
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

/** 更正一個區塊（陣列第 0 個是最高次項），成功回傳更正後的陣列，無法更正回傳 null */
export function rsDecode(block, n) {
  const len = block.length;
  const S = new Array(n);
  let bad = false;
  for (let j = 0; j < n; j++) {
    let s = 0;
    const a = EXP[j];
    for (let k = 0; k < len; k++) s = mul(s, a) ^ block[k];
    S[j] = s;
    if (s) bad = true;
  }
  if (!bad) return block.slice();
  // Berlekamp-Massey：錯誤位置多項式 Λ
  let C = new Array(n + 1).fill(0); C[0] = 1;
  let B = new Array(n + 1).fill(0); B[0] = 1;
  let L = 0, m = 1, b = 1;
  for (let r = 0; r < n; r++) {
    let d = S[r];
    for (let i = 1; i <= L; i++) d ^= mul(C[i], S[r - i]);
    if (d === 0) { m++; continue; }
    const coef = div(d, b);
    const T = C.slice();
    for (let i = 0; i + m <= n; i++) C[i + m] ^= mul(coef, B[i]);
    if (2 * L <= r) { L = r + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (2 * L > n) return null;
  // Chien：找出錯誤位置（i 是次方；陣列位置是 len-1-i）
  const evalAt = (poly, x) => { let y = 0; for (let i = poly.length - 1; i >= 0; i--) y = mul(y, x) ^ poly[i]; return y; };
  const positions = [];
  for (let i = 0; i < len; i++) if (evalAt(C, EXP[(255 - i) % 255]) === 0) positions.push(i);
  if (positions.length !== L) return null;
  // Forney：錯誤值 e = X·Ω(X⁻¹)/Λ'(X⁻¹)
  const omega = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) omega[i] ^= mul(S[j], C[i - j]);
  const deriv = C.map((c, i) => (i % 2 === 1 ? c : 0)).slice(1);
  const out = block.slice();
  for (const i of positions) {
    const xInv = EXP[(255 - i) % 255];
    const den = evalAt(deriv, xInv);
    if (!den) return null;
    const e = mul(EXP[i], div(evalAt(omega, xInv), den));
    out[len - 1 - i] ^= e;
  }
  // 再驗算一次
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < len; k++) s = mul(s, EXP[j]) ^ out[k];
    if (s) return null;
  }
  return out;
}

// ───────── 版本表 ─────────
// 每個區塊的錯誤更正碼字數、區塊數（依 L、M、Q、H；索引為版本 1～40）
const ECC_PER_BLOCK = [
  [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
export const ECL = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_ECL = [1, 0, 3, 2]; // 格式資訊裡 L、M、Q、H 的代碼

/** 資料區的模組數（扣掉定位、校正、時序、格式、版本資訊） */
export function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
export const totalCodewords = (ver) => Math.floor(rawDataModules(ver) / 8);
export function blockLayout(ver, ecl) {
  const ec = ECC_PER_BLOCK[ecl][ver - 1];
  const blocks = NUM_BLOCKS[ecl][ver - 1];
  const total = totalCodewords(ver);
  const numShort = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks);
  return { ec, blocks, total, numShort, shortLen, dataCodewords: total - ec * blocks };
}

export function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** 哪些位置是固定圖案（不放資料） */
export function functionMask(ver) {
  const size = ver * 4 + 17;
  const f = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = 1; };
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy);
  }
  for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }
  const al = alignmentPositions(ver);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy);
    }
  }
  for (const [x, y] of formatPositions(size, 0).concat(formatPositions(size, 1))) set(x, y);
  set(8, size - 8);
  if (ver >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b); set(b, a);
    }
  }
  return f;
}

/** 格式資訊 15 個位元的位置（第 i 個是 bit i）；copy 0 在左上，copy 1 在右上＋左下 */
export function formatPositions(size, copy) {
  const out = [];
  if (copy === 0) {
    for (let i = 0; i <= 5; i++) out.push([8, i]);
    out.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) out.push([14 - i, 8]);
  } else {
    for (let i = 0; i < 8; i++) out.push([size - 1 - i, 8]);
    for (let i = 8; i < 15; i++) out.push([8, size - 15 + i]);
  }
  return out;
}

export function formatBits(ecl, mask) {
  const data = (FORMAT_ECL[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
const FORMATS = [];
for (let e = 0; e < 4; e++) for (let k = 0; k < 8; k++) FORMATS.push({ ecl: e, mask: k, bits: formatBits(e, k) });

export function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

export const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 資料模組的排列順序（右下角開始、兩欄一組、上下來回，跳過第 6 欄） */
export function dataOrder(ver, func) {
  const size = ver * 4 + 17;
  const out = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) {
      const y = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!func[y][x]) out.push([x, y]);
      }
    }
  }
  return out;
}

// ───────── 從模組矩陣讀出文字 ─────────
const popcount = (v) => { let c = 0; while (v) { c += v & 1; v >>>= 1; } return c; };

/** matrix[y][x]＝1 表示深色。回傳 { text, ecl, mask } 或 null */
export function decodeMatrix(matrix) {
  const size = matrix.length;
  const ver = (size - 17) / 4;
  if (!Number.isInteger(ver) || ver < 1 || ver > 40) return null;
  // 格式資訊：兩份都讀，取最接近的合法值
  let fmt = null, best = 99;
  for (const copy of [0, 1]) {
    let v = 0;
    formatPositions(size, copy).forEach(([x, y], i) => { if (matrix[y][x]) v |= 1 << i; });
    for (const f of FORMATS) {
      const d = popcount(v ^ f.bits);
      if (d < best) { best = d; fmt = f; }
    }
  }
  if (!fmt || best > 3) return null;
  const func = functionMask(ver);
  const maskFn = MASKS[fmt.mask];
  const order = dataOrder(ver, func);
  const lay = blockLayout(ver, fmt.ecl);
  const codewords = new Array(lay.total).fill(0);
  for (let i = 0; i < lay.total * 8; i++) {
    const [x, y] = order[i];
    const bit = (matrix[y][x] ? 1 : 0) ^ (maskFn(x, y) ? 1 : 0);
    codewords[i >> 3] |= bit << (7 - (i & 7));
  }
  // 拆回各區塊（短區塊排在前面；短區塊少一個資料碼字）
  const longLen = lay.shortLen + 1;
  const blocks = Array.from({ length: lay.blocks }, () => []);
  let k = 0;
  for (let i = 0; i < longLen; i++) {
    for (let j = 0; j < lay.blocks; j++) {
      if (i === lay.shortLen - lay.ec && j < lay.numShort) continue;
      blocks[j].push(codewords[k++]);
    }
  }
  const data = [];
  for (const b of blocks) {
    const fixed = rsDecode(b, lay.ec);
    if (!fixed) return null;
    data.push(...fixed.slice(0, fixed.length - lay.ec));
  }
  const text = parseSegments(data, ver);
  return text === null ? null : { text, ecl: 'LMQH'[fmt.ecl], mask: fmt.mask, version: ver };
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const ECI_CHARSET = { 1: 'iso-8859-1', 3: 'iso-8859-1', 4: 'iso-8859-2', 20: 'shift_jis', 22: 'windows-1251', 26: 'utf-8', 28: 'big5', 29: 'gbk', 30: 'euc-kr' };

/** 位元組轉文字：有 ECI 指定就照它，否則依序試 UTF-8、Big5、Shift_JIS，挑亂碼最少的 */
function bytesToText(bytes, charset) {
  const u8 = Uint8Array.from(bytes);
  if (typeof TextDecoder === 'undefined') return String.fromCharCode(...u8);
  if (charset) { try { return new TextDecoder(charset).decode(u8); } catch { /* 改用猜的 */ } }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { /* 不是 UTF-8 */ }
  const tryDecode = (cs) => { try { return new TextDecoder(cs, { fatal: true }).decode(u8); } catch { return null; } };
  // Big5 與 Shift_JIS 的位元組範圍重疊，用日文特有的寫法判斷：
  // 0x81–0x9F、0xE0–0xEF 開頭的雙位元組（Big5 常用字不會用到），或連續半形片假名且帶濁音符號（ﾞﾟ）
  let sjisLike = false, run = 0, dakuten = false;
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i];
    if (((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef)) && i + 1 < u8.length && u8[i + 1] >= 0x40 && u8[i + 1] !== 0x7f) { sjisLike = true; break; }
    if (b >= 0xa1 && b <= 0xdf) { run++; if (b === 0xde || b === 0xdf) dakuten = true; if (run >= 3 && dakuten) { sjisLike = true; break; } } else { run = 0; dakuten = false; }
  }
  for (const cs of sjisLike ? ['shift_jis', 'big5'] : ['big5', 'shift_jis']) {
    const t = tryDecode(cs);
    if (t !== null) return t;
  }
  return String.fromCharCode(...u8);
}

function parseSegments(data, ver) {
  let pos = 0;
  const total = data.length * 8;
  const read = (n) => {
    if (pos + n > total) throw new Error('eof');
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1);
    return v;
  };
  const g = ver <= 9 ? 0 : ver <= 26 ? 1 : 2;
  let out = '';
  let charset = null;
  let pending = []; // 連續的位元組片段合併後再轉文字（UTF-8 字元可能跨片段）
  const flush = () => { if (pending.length) { out += bytesToText(pending, charset); pending = []; } };
  try {
    while (pos + 4 <= total) {
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 0b0111) { // ECI
        flush();
        const b1 = read(8);
        const id = (b1 & 0x80) === 0 ? b1 : (b1 & 0xc0) === 0x80 ? ((b1 & 0x3f) << 8) | read(8) : ((b1 & 0x1f) << 16) | read(16);
        charset = ECI_CHARSET[id] || charset;
      } else if (mode === 0b0001) { // 數字
        flush();
        let n = read([10, 12, 14][g]);
        while (n >= 3) { out += String(read(10)).padStart(3, '0'); n -= 3; }
        if (n === 2) out += String(read(7)).padStart(2, '0');
        else if (n === 1) out += String(read(4));
      } else if (mode === 0b0010) { // 英數
        flush();
        let n = read([9, 11, 13][g]);
        while (n >= 2) { const v = read(11); out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
        if (n === 1) out += ALNUM[read(6)];
      } else if (mode === 0b0100) { // 位元組
        const n = read([8, 16, 16][g]);
        for (let i = 0; i < n; i++) pending.push(read(8));
      } else if (mode === 0b1000) { // 漢字（Shift_JIS）
        flush();
        const n = read([8, 10, 12][g]);
        const sj = [];
        for (let i = 0; i < n; i++) {
          const v = read(13);
          let c = ((Math.floor(v / 0xc0)) << 8) | (v % 0xc0);
          c += c < 0x1f00 ? 0x8140 : 0xc140;
          sj.push(c >> 8, c & 0xff);
        }
        out += bytesToText(sj, 'shift_jis');
      } else if (mode === 0b0011) { // 結構化連接：略過
        read(16);
      } else if (mode === 0b0101) { // FNC1（第一位置）
        // 沒有額外資料
      } else if (mode === 0b1001) { // FNC1（第二位置）
        read(8);
      } else {
        break;
      }
    }
  } catch { /* 資料提早結束：保留已讀到的內容 */ }
  flush();
  return out;
}

// ───────── 從圖片找出 QR Code ─────────
function otsu(lum) {
  const hist = new Array(256).fill(0);
  for (const v of lum) hist[v]++;
  const n = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t + 0.5;
}

function ratioOk(r) {
  const total = r[0] + r[1] + r[2] + r[3] + r[4];
  if (total < 7 || r.some((x) => x === 0)) return false;
  const u = total / 7;
  const tol = Math.max(u * 0.5, 0.8);
  return Math.abs(r[0] - u) < tol && Math.abs(r[1] - u) < tol && Math.abs(r[2] - 3 * u) < tol * 2.5 && Math.abs(r[3] - u) < tol && Math.abs(r[4] - u) < tol;
}

/** 沿著一條線（get(i)、長度 len）從 start 往兩邊量 1:1:3:1:1 */
function crossCheck(get, start, len) {
  if (!get(start)) return null;
  let up = start;
  while (up >= 0 && get(up)) up--;
  let a = up;
  while (a >= 0 && !get(a)) a--;
  let b = a;
  while (b >= 0 && get(b)) b--;
  let dn = start;
  while (dn < len && get(dn)) dn++;
  let c = dn;
  while (c < len && !get(c)) c++;
  let d = c;
  while (d < len && get(d)) d++;
  const r = [a - b, up - a, dn - up - 1, c - dn, d - c];
  if (!ratioOk(r)) return null;
  return { center: (up + 1 + dn) / 2, total: r.reduce((s, x) => s + x, 0) };
}

function findFinders(bits, w, h) {
  const at = (x, y) => bits[y * w + x];
  const raw = [];
  for (let y = 0; y < h; y++) {
    const runs = [];
    let x = 0;
    while (x < w) {
      const v = at(x, y), s = x;
      while (x < w && at(x, y) === v) x++;
      runs.push([s, x - s, v]);
    }
    for (let k = 0; k + 4 < runs.length; k++) {
      if (runs[k][2] !== 1) continue;
      const r = [runs[k][1], runs[k + 1][1], runs[k + 2][1], runs[k + 3][1], runs[k + 4][1]];
      if (!ratioOk(r)) continue;
      const cx = Math.floor(runs[k + 2][0] + runs[k + 2][1] / 2);
      const vert = crossCheck((i) => at(cx, i), y, h);
      if (!vert) continue;
      const cy = Math.floor(vert.center);
      const hor = crossCheck((i) => at(i, cy), cx, w);
      if (!hor) continue;
      raw.push({ x: hor.center, y: vert.center, m: (hor.total + vert.total) / 14 });
    }
    if (raw.length > 5000) break;
  }
  // 合併同一個定位圖案的多次偵測
  const clusters = [];
  for (const p of raw) {
    const c = clusters.find((q) => Math.abs(q.x - p.x) < q.m * 2 && Math.abs(q.y - p.y) < q.m * 2 && Math.abs(q.m - p.m) < Math.max(q.m, p.m) * 0.5);
    if (c) {
      c.sx += p.x; c.sy += p.y; c.sm += p.m; c.n++;
      c.x = c.sx / c.n; c.y = c.sy / c.n; c.m = c.sm / c.n;
    } else clusters.push({ x: p.x, y: p.y, m: p.m, sx: p.x, sy: p.y, sm: p.m, n: 1 });
  }
  return clusters.sort((a, b) => b.n - a.n).slice(0, 12);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 從候選定位圖案挑出可能的三個一組（左上、右上、左下） */
function triples(cands) {
  const out = [];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      for (let k = j + 1; k < cands.length; k++) {
        const t = [cands[i], cands[j], cands[k]];
        const ms = t.map((c) => c.m);
        if (Math.max(...ms) > Math.min(...ms) * 1.6) continue;
        // 直角的頂點是左上
        const sides = [[0, 1, 2], [1, 0, 2], [2, 0, 1]].map(([a, b, c]) => ({ tl: t[a], p: t[b], q: t[c], hyp: dist(t[b], t[c]), l1: dist(t[a], t[b]), l2: dist(t[a], t[c]) }));
        const s = sides.sort((x, y) => y.hyp - x.hyp)[0];
        if (Math.abs(s.l1 - s.l2) > Math.max(s.l1, s.l2) * 0.2) continue;
        if (Math.abs(s.hyp * s.hyp - s.l1 * s.l1 - s.l2 * s.l2) > s.hyp * s.hyp * 0.2) continue;
        const cross = (s.p.x - s.tl.x) * (s.q.y - s.tl.y) - (s.p.y - s.tl.y) * (s.q.x - s.tl.x);
        const [tr, bl] = cross > 0 ? [s.p, s.q] : [s.q, s.p];
        out.push({ tl: s.tl, tr, bl, score: t.reduce((a, c) => a + c.n, 0) });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

function sampleGrid(bits, w, h, tri, ver) {
  const size = ver * 4 + 17;
  const { tl, tr, bl } = tri;
  const span = size - 7;
  const ux = { x: (tr.x - tl.x) / span, y: (tr.y - tl.y) / span };
  const uy = { x: (bl.x - tl.x) / span, y: (bl.y - tl.y) / span };
  const mod = Math.hypot(ux.x, ux.y);
  const off = mod >= 3 ? 0.2 : 0;
  const get = (px, py) => {
    const x = Math.floor(px), y = Math.floor(py);
    return x >= 0 && y >= 0 && x < w && y < h ? bits[y * w + x] : 0;
  };
  const m = [];
  for (let y = 0; y < size; y++) {
    const row = new Uint8Array(size);
    for (let x = 0; x < size; x++) {
      const fx = x + 0.5 - 3.5, fy = y + 0.5 - 3.5;
      const px = tl.x + fx * ux.x + fy * uy.x, py = tl.y + fx * ux.y + fy * uy.y;
      if (!off) { row[x] = get(px, py); continue; }
      let s = get(px, py);
      for (const [dx, dy] of [[-off, -off], [off, -off], [-off, off], [off, off]]) {
        s += get(px + (dx * ux.x + dy * uy.x), py + (dx * ux.y + dy * uy.y));
      }
      row[x] = s >= 3 ? 1 : 0;
    }
    m.push(row);
  }
  return m;
}

/**
 * 解碼一張圖片裡的 QR Code。
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} img RGBA 像素（例如 getImageData() 的結果）
 * @returns {{text: string, version: number, ecl: string, mask: number} | null}
 */
export function decodeQr(img) {
  const { width: w, height: h, data } = img;
  if (!w || !h || w * h > 4e6) return null;
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = data[p + 3] / 255;
    const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    lum[i] = Math.round(a * l + (1 - a) * 255); // 透明背景當成白色
  }
  const t = otsu(lum);
  for (const invert of [false, true]) {
    const bits = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bits[i] = (lum[i] < t) !== invert ? 1 : 0;
    const cands = findFinders(bits, w, h);
    if (cands.length < 3) continue;
    for (const tri of triples(cands)) {
      const m = (tri.tl.m + tri.tr.m + tri.bl.m) / 3;
      const modules = (dist(tri.tl, tri.tr) + dist(tri.tl, tri.bl)) / 2 / m + 7;
      const est = Math.round((modules - 17) / 4);
      for (const ver of [est, est + 1, est - 1]) {
        if (ver < 1 || ver > 40) continue;
        const r = decodeMatrix(sampleGrid(bits, w, h, tri, ver));
        if (r) return r;
      }
    }
  }
  return null;
}
