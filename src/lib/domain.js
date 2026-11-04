// 網域解析工具：取出「真正的網域」、處理國際化網域（punycode）、比對相似字元。
// 這個檔案不依賴瀏覽器 API，Node.js 測試也能直接載入。

// 兩層式國家網域常見的第二層（例：com.tw、gov.tw、co.jp、ac.uk）
const GENERIC_SLD = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'co', 'ac', 'or', 'ne', 'go', 'idv',
  'gob', 'nic', 'gen', 'ltd', 'plc', 'sch', 'info', 'biz', 'nom', 'game', 'ebiz', 'club',
]);

// 免費架站／代管平台：任何人都能在這些網域底下申請自己的子網域，
// 所以「xxx.github.io」的真正擁有者是 xxx，不是 GitHub。
export const HOSTING_PLATFORMS = [
  'github.io', 'gitlab.io', 'web.app', 'firebaseapp.com', 'pages.dev', 'workers.dev', 'r2.dev',
  'netlify.app', 'vercel.app', 'herokuapp.com', 'onrender.com', 'glitch.me', 'replit.app',
  'repl.co', 'fly.dev', 'blogspot.com', 'wordpress.com', 'wixsite.com', 'weebly.com',
  'webflow.io', 'framer.app', 'framer.website', 'square.site', 'mystrikingly.com', 'carrd.co',
  '000webhostapp.com', 'azurewebsites.net', 'cloudfront.net', 'appspot.com', 'ngrok.io',
  'ngrok-free.app', 'ngrok.app', 'trycloudflare.com', 'duckdns.org', 'ddns.net', 'no-ip.org',
  'hopto.org', 'zapto.org', 'sytes.net', 'linkpc.net', 'my.canva.site', 'canva.site',
  'notion.site', 'gitbook.io', 'surge.sh', 'tiiny.site', 'yolasite.com', 'jimdosite.com',
  'godaddysites.com', 'webnode.page', 'site123.me', 'ucoz.net', 'googleusercontent.com', 'up.railway.app', 'pages.github.io',
  'web.core.windows.net', 'blob.core.windows.net', 'myshopify.com', 'shopline.tw', 'cyberbiz.co', 'weebly.com', 'tilda.ws',
  'chatgpt.site', 'lovable.app', 'bolt.host', 'replit.dev', 'streamlit.app', 'gradio.live', 'hf.space',
];

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isIp(host) {
  return IPV4_RE.test(host) || host.startsWith('[') || host.includes(':');
}

export function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '[::1]') return true;
  if (!IPV4_RE.test(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * 拆解主機名稱。
 * 例：www.mvdis.gov.tw → { registrable: 'mvdis.gov.tw', suffix: 'gov.tw', label: 'mvdis', sub: 'www' }
 */
export function parseHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return { host, registrable: '', suffix: '', label: '', sub: '', isIp: false, platform: null };
  if (isIp(host)) return { host, registrable: host, suffix: '', label: host, sub: '', isIp: true, platform: null };

  const labels = host.split('.');
  let platform = null;
  for (const p of HOSTING_PLATFORMS) {
    if ((host === p || host.endsWith('.' + p)) && (!platform || p.length > platform.length)) platform = p;
  }
  let suffixLen = 1;
  if (platform) suffixLen = platform.split('.').length;
  else if (labels.length >= 3 && labels[labels.length - 1].length === 2 && GENERIC_SLD.has(labels[labels.length - 2])) suffixLen = 2;

  const suffix = labels.slice(-suffixLen).join('.');
  if (labels.length <= suffixLen) {
    // 主機本身就是後綴（例如直接開 github.io）
    return { host, registrable: host, suffix, label: labels[0], sub: '', isIp: false, platform: null };
  }
  return {
    host,
    registrable: labels.slice(-(suffixLen + 1)).join('.'),
    suffix,
    label: labels[labels.length - suffixLen - 1],
    sub: labels.slice(0, labels.length - suffixLen - 1).join('.'),
    isIp: false,
    platform,
  };
}

/** host 本身或它的任一上層網域是否在集合中；回傳命中的那一個網域。 */
export function findDomainInSet(host, set) {
  if (!set || !set.size || !host) return null;
  let h = host;
  while (h) {
    if (set.has(h)) return h;
    const i = h.indexOf('.');
    if (i < 0) break;
    h = h.slice(i + 1);
  }
  return null;
}

/** 使用者貼上的各種格式（含 http://、路徑、*.、www.、中文網域）統一成小寫 ASCII 網域；無效時回傳空字串。 */
export function normalizeDomain(input) {
  let s = String(input || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\*\./, '');
  s = s.split(/[\/?#\s]/)[0];
  s = s.replace(/:\d+$/, '');
  if (!s || s.includes('@')) return '';
  let host;
  try {
    host = new URL('http://' + s).hostname;
  } catch {
    return '';
  }
  host = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (isIp(host)) return host;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host)) return '';
  return host;
}

// ---------- Punycode（RFC 3492）解碼：把 xn--pple-43d 還原成 аpple ----------
const BASE = 36, T_MIN = 1, T_MAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;

function adapt(delta, numPoints, firstTime) {
  let k = 0;
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return Math.floor(k + ((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function digitOf(c) {
  if (c >= 48 && c <= 57) return c - 22;
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 97;
  return BASE;
}

export function punycodeDecode(input) {
  const output = [];
  let n = INITIAL_N, i = 0, bias = INITIAL_BIAS;
  let basic = input.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j));
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('invalid punycode');
      const digit = digitOf(input.charCodeAt(index++));
      if (digit >= BASE) throw new Error('invalid punycode');
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

export function toUnicodeLabel(label) {
  if (!label.startsWith('xn--')) return label;
  try {
    return punycodeDecode(label.slice(4));
  } catch {
    return label;
  }
}

export function toUnicodeHost(host) {
  return host.split('.').map(toUnicodeLabel).join('.');
}

// ---------- 外觀相似字元（homoglyph）正規化 ----------
const CONFUSABLES = {
  // 西里爾字母
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't',
  'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ԁ': 'd', 'ѕ': 's', 'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w', 'ь': 'b',
  // 希臘字母
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u',
  'χ': 'x', 'ω': 'w',
  // 其他拉丁變體
  'ı': 'i', 'ɩ': 'i', 'ł': 'l', 'ø': 'o', 'ɡ': 'g', 'ß': 'ss', 'đ': 'd', 'ħ': 'h',
  // 數字與符號
  '0': 'o', '1': 'l', 'i': 'l', '|': 'l', '3': 'e', '5': 's', '7': 't', '8': 'b',
};

/** 把字串轉成「外觀骨架」：拿掉重音符號、把長得像的字元統一，用來抓 ctbcbank / ctbcbаnk / ctbc-bank 這類仿冒。 */
export function skeleton(str) {
  const decomposed = String(str).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  for (const ch of decomposed) out += CONFUSABLES[ch] ?? ch;
  return out.replace(/[-_.]/g, '').replace(/rn/g, 'm').replace(/vv/g, 'w');
}

/** 是否同時混用拉丁字母與西里爾／希臘字母（國際化網域仿冒的典型手法）。 */
export function hasMixedScripts(str) {
  const latin = /[a-z]/i.test(str);
  const other = /[Ͱ-ϿЀ-ӿԀ-ԯ]/.test(str);
  return latin && other;
}

/** Damerau–Levenshtein（OSA）編輯距離，超過 max 時提早結束並回傳 max + 1。 */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}
