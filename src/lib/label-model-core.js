// 網域名稱小模型的特徵與推論（訓練程式與插件共用同一份特徵定義）
export const MODEL_DIM = 8192;

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 網域名稱（不含後綴）的特徵：字元 1～4-gram（含頭尾標記）與幾個形狀特徵，雜湊到固定維度 */
export function labelFeatures(label) {
  const s = '^' + String(label).toLowerCase() + '$';
  const f = new Map();
  const put = (key, v = 1) => { const k = fnv(key) % MODEL_DIM; f.set(k, (f.get(k) || 0) + v); };
  for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= s.length; i++) put('g' + s.slice(i, i + n));
  const core = s.slice(1, -1);
  const letters = core.replace(/[^a-z]/g, '');
  const vowels = (letters.match(/[aeiou]/g) || []).length;
  const digits = (core.match(/\d/g) || []).length;
  put('len' + Math.min(core.length, 20));
  put('dig' + Math.min(digits, 6));
  put('hyp' + Math.min((core.match(/-/g) || []).length, 3));
  put('vow' + (letters.length ? Math.round((vowels / letters.length) * 10) : -1));
  put('cons' + Math.min(Math.max(0, ...(letters.match(/[^aeiou]+/g) || ['']).map((x) => x.length)), 6));
  // 正規化，避免長名稱分數偏高
  const norm = Math.sqrt([...f.values()].reduce((a, v) => a + v * v, 0)) || 1;
  return [...f].map(([k, v]) => [k, v / norm]);
}

let cached = null;
/** 回傳 0～1，越高越像詐騙網站的命名方式 */
export function labelScore(label, model) {
  if (!model) return 0;
  if (!cached || cached.model !== model) {
    const bytes = typeof atob === 'function'
      ? Uint8Array.from(atob(model.weights), (c) => c.charCodeAt(0))
      : Uint8Array.from(Buffer.from(model.weights, 'base64'));
    cached = { model, w: new Int8Array(bytes.buffer) };
  }
  let z = model.bias;
  for (const [k, v] of labelFeatures(label)) z += cached.w[k] * model.scale * v;
  return 1 / (1 + Math.exp(-z));
}
