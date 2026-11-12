// 找出「看不到的連結」：詐騙網頁常把網址藏在按鈕、文字或程式裡（按下去才用 JavaScript 跳轉），
// 畫面上完全看不到網址。這裡從按鈕的事件屬性與網頁程式碼裡找出「會把人帶去哪裡」。
//
// 這個檔案是一般的內容指令碼（不是 ES module），排在 content.js 前面載入；測試直接 import。
// 找不到的情況（網址被拆成好幾段再組合、從伺服器取得）仍然有最後一道防線：
// 真正要連線時，background.js 會依「實際要去的網址」攔截。
(() => {
  const ABS_URL = /(?:https?:)?\/\/[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff.-]*\.[a-z\u00a1-\uffff]{2,}(?::\d+)?(?:\/[^\s'"`<>)\\]*)?/gi;
  // 會造成跳轉的寫法：location = '…'、location.href = '…'、location.assign('…')、location.replace('…')、
  // window.open('…')、xxx.href = '…'、form.action = '…'、navigate('…')
  const NAV = /(?:location(?:\.href)?\s*=|location\.(?:assign|replace)\s*\(|\bopen\s*\(|\bnavigate\s*\(|\.href\s*=|\.action\s*=)\s*(atob\s*\(\s*)?(['"`])([^'"`\s]{4,600})\2/g;
  // 用 base64 把網址藏起來：atob('aHR0cHM6Ly9…')（「http」編碼後一定以 aHR0c 開頭）
  const ATOB = /atob\s*\(\s*(['"`])(aHR0c[A-Za-z0-9+/=]{8,800})\1/g;
  const looksLikeUrl = (s) => /^(?:https?:)?\/\/[^/\s]+\.[^/\s]+/i.test(s);
  const decode = (b64) => { try { return atob(b64); } catch { return ''; } };

  /** 字串裡所有完整網址（https://…、//…） */
  function urlsIn(text) {
    return [...new Set(String(text || '').match(ABS_URL) || [])];
  }

  /** 程式碼裡「會把瀏覽器帶去」的網址 */
  function navUrls(code) {
    const out = new Set();
    const src = String(code || '');
    for (const m of src.matchAll(NAV)) {
      const value = m[1] ? decode(m[3]) : m[3];
      if (looksLikeUrl(value)) out.add(value);
    }
    for (const m of src.matchAll(ATOB)) {
      const value = decode(m[2]);
      if (looksLikeUrl(value)) out.add(value);
    }
    return [...out];
  }

  // ── 深度掃描：整段程式碼裡所有的網址，常見的藏法先解開再找 ──
  const HTTP_URL = /https?:\/\/[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff.-]*\.[a-z\u00a1-\uffff]{2,}(?::\d+)?(?:\/[^\s'"`<>)\\]*)?/gi;
  const MAX_DEEP = 300;

  // 打包器（Dean Edwards packer）：eval(function(p,a,c,k,e,d){…}('內容',進位,數量,'字1|字2|…'.split('|'),0,{}))
  // 不執行程式，直接照它的規則把代號換回原本的字
  const PACKED = /\}\s*\(\s*'((?:[^'\\]|\\.){20,})'\s*,\s*(\d{1,2})\s*,\s*\d{1,5}\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\(\s*'\|'\s*\)/g;
  function unpack(code) {
    let out = '';
    for (const m of String(code || '').matchAll(PACKED)) {
      const radix = Number(m[2]);
      if (radix < 2 || radix > 62) continue;
      const words = m[3].split('|');
      const toIndex = (tok) => {
        let n = 0;
        for (const ch of tok) {
          const c = ch.charCodeAt(0);
          const d = c <= 57 ? c - 48 : c >= 97 ? c - 87 : c - 29; // 0-9、a-z（10–35）、A-Z（36–61）
          if (d < 0 || d >= radix) return -1;
          n = n * radix + d;
        }
        return n;
      };
      const payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      out += '\n' + payload.replace(/\b\w+\b/g, (tok) => { const i = toIndex(tok); return i >= 0 && words[i] ? words[i] : tok; });
    }
    return out;
  }

  // 字串陣列混淆（javascript-obfuscator 等工具）：所有字串編成 base64 放進陣列，常用大小寫對調的字母表
  const B64_LITERAL = /['"`]([A-Za-z0-9+/]{16,800}={0,2})['"`]/g;
  const swapCase = (s) => s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  const readable = (s) => /^[\x20-\x7e\u00a1-\uffff]+$/.test(s);

  /** 把常見的藏法還原成看得懂的字串；解出來的結果再解一次（最多三層），對付多層包裝 */
  function reveal(code, depth = 0) {
    let s = String(code || '');
    if (depth === 0) s += unpack(s);
    // 字串拆開再相加：'https://mvdis-' + 'gov-tw' + ".cc" → 'https://mvdis-gov-tw.cc'（重複幾次以處理三段以上）
    for (let i = 0; i < 4; i++) s = s.replace(/(['"`])\s*\+\s*(['"`])/g, '');
    // 跳脫字元：\x68\x74\x74\x70、\u0068…、\/
    s = s.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\\//g, '/');
    const extra = [];
    // base64 字串：標準字母表與大小寫對調的字母表都試；解出來像文字才採用
    let tried = 0;
    for (const m of s.matchAll(B64_LITERAL)) {
      if (++tried > 3000) break;
      for (const variant of [m[1], swapCase(m[1])]) {
        const d = decode(variant);
        if (d && d.length >= 8 && readable(d) && (/https?:|\/\/|%[0-9a-f]{2}/i.test(d) || /^[A-Za-z0-9+/]{16,}={0,2}$/.test(d))) extra.push(d);
      }
    }
    // 百分比編碼：%68%74%74%70…
    for (const m of s.matchAll(/%68%74%74%70(?:%[0-9a-f]{2}|[\w.~\-/:?=&])+/gi)) { try { extra.push(decodeURIComponent(m[0])); } catch { /* 不是合法編碼 */ } }
    // String.fromCharCode(104,116,116,112,…)
    for (const m of s.matchAll(/fromCharCode\s*\(\s*((?:\d{2,3}\s*,\s*){6,400}\d{2,3})\s*\)/g)) {
      extra.push(String.fromCharCode(...m[1].split(',').map((n) => Number(n.trim()))));
    }
    // 整串倒過來寫：'cc.wt-vog-sidvm//:sptth'.split('').reverse().join('')
    for (const m of s.matchAll(/['"`]([^'"`\s]{6,400}\/\/:s?ptth)['"`]/g)) extra.push([...m[1]].reverse().join(''));
    if (!extra.length) return s;
    // 解出來的字串加上引號再解一次（base64 裡面再包一層 base64、編碼裡再拆字）
    const inner = extra.map((x) => `'${x}'`).join('\n');
    return `${s}\n${depth < 2 ? reveal(inner, depth + 1) : inner}`;
  }

  /** 程式碼裡出現的所有網址（含被藏起來的）。比 navUrls 寬，只用在不是官方網站的頁面 */
  function deepUrls(code) {
    const text = reveal(code);
    const out = new Set(navUrls(text));
    for (const m of text.match(HTTP_URL) || []) {
      out.add(m);
      if (out.size >= MAX_DEEP) break;
    }
    return [...out];
  }

  /** 貼上的 HTML（從信件、網頁複製）裡，按鈕或文字背後的連結；plain 是同一次貼上的純文字，已經看得到的網址不重複列 */
  function hiddenLinksInHtml(html, plain = '') {
    if (!html || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(String(html), 'text/html'); // 只解析，不會執行程式或載入圖片
    const hrefs = [...doc.querySelectorAll('a[href], area[href]')].map((a) => a.getAttribute('href') || '');
    return [...new Set(hrefs.filter((h) => /^https?:\/\//i.test(h) && !plain.includes(h)))].slice(0, 20);
  }

  globalThis.OUG_hiddenLinks = { urlsIn, navUrls, deepUrls, reveal, unpack, hiddenLinksInHtml };
})();
