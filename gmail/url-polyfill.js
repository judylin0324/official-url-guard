// Google Apps Script 沒有瀏覽器的 URL／URLSearchParams，這裡提供判斷引擎需要的最小實作。
// 只在環境本身沒有 URL 時才啟用（瀏覽器、Node.js 會沿用內建版本）。
(function (root) {
  if (typeof root.URL === 'function') return;

  // ── Punycode 編碼（中文、日文網域轉成 xn--）──
  const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, IBIAS = 72, IN = 128;
  const adapt = (delta, numPoints, first) => {
    let k = 0;
    delta = first ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    while (delta > ((BASE - TMIN) * TMAX) >> 1) { delta = Math.floor(delta / (BASE - TMIN)); k += BASE; }
    return Math.floor(k + ((BASE - TMIN + 1) * delta) / (delta + SKEW));
  };
  const digit = (d) => String.fromCharCode(d + 22 + 75 * (d < 26));
  function punyEncode(input) {
    const cps = Array.from(input).map((c) => c.codePointAt(0));
    let out = cps.filter((c) => c < 128).map((c) => String.fromCharCode(c)).join('');
    const b = out.length;
    let h = b, n = IN, delta = 0, bias = IBIAS;
    if (b) out += '-';
    while (h < cps.length) {
      const m = Math.min(...cps.filter((c) => c >= n));
      delta += (m - n) * (h + 1);
      n = m;
      for (const c of cps) {
        if (c < n) delta++;
        if (c === n) {
          let q = delta;
          for (let k = BASE; ; k += BASE) {
            const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
            if (q < t) break;
            out += digit(t + ((q - t) % (BASE - t)));
            q = Math.floor((q - t) / (BASE - t));
          }
          out += digit(q);
          bias = adapt(delta, h + 1, h === b);
          delta = 0;
          h++;
        }
      }
      delta++;
      n++;
    }
    return out;
  }
  const toAsciiHost = (host) => host.normalize('NFKC').toLowerCase().split('.')
    .map((l) => (/[^\x00-\x7f]/.test(l) ? 'xn--' + punyEncode(l) : l)).join('.');

  function decode(s) {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
  }

  class URLSearchParams {
    constructor(search = '') {
      this._p = String(search).replace(/^\?/, '').split('&').filter(Boolean).map((kv) => {
        const i = kv.indexOf('=');
        return i < 0 ? [decode(kv), ''] : [decode(kv.slice(0, i)), decode(kv.slice(i + 1))];
      });
    }
    get(k) { const e = this._p.find(([x]) => x === k); return e ? e[1] : null; }
    has(k) { return this._p.some(([x]) => x === k); }
    keys() { return this._p.map(([k]) => k)[Symbol.iterator](); }
    entries() { return this._p.map((e) => e.slice())[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
    toString() { return this._p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); }
  }

  class URL {
    constructor(input, base) {
      let s = String(input).trim();
      if (base !== undefined && !/^[a-z][a-z0-9+.-]*:/i.test(s)) {
        const b = new URL(base);
        s = s.startsWith('/') ? b.origin + s : b.origin + b.pathname.replace(/[^/]*$/, '') + s;
      }
      const m = s.match(/^([a-z][a-z0-9+.-]*):(.*)$/i);
      if (!m) throw new TypeError('Invalid URL: ' + input);
      this.protocol = m[1].toLowerCase() + ':';
      let rest = m[2];
      this.username = this.password = this.port = this.hostname = '';
      this.hash = this.search = '';
      if (/^(https?|ftp|wss?):$/.test(this.protocol)) {
        const a = rest.match(/^\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/);
        if (!a) throw new TypeError('Invalid URL: ' + input);
        let auth = a[1];
        const at = auth.lastIndexOf('@');
        if (at >= 0) {
          const cred = auth.slice(0, at).split(':');
          this.username = cred[0] || '';
          this.password = cred.slice(1).join(':');
          auth = auth.slice(at + 1);
        }
        const hp = auth.match(/^(\[[^\]]+\]|[^:]*)(?::(\d*))?$/);
        if (!hp || !hp[1]) throw new TypeError('Invalid URL: ' + input);
        if (/[\s<>"{}|\\^`]/.test(hp[1])) throw new TypeError('Invalid URL: ' + input);
        this.hostname = toAsciiHost(hp[1]);
        const def = { 'http:': '80', 'https:': '443' }[this.protocol];
        this.port = hp[2] && hp[2] !== def ? hp[2] : '';
        // 和瀏覽器一樣，把路徑、查詢字串裡的非 ASCII 字元轉成 %XX
        const enc = (x) => x.replace(/[^\x00-\x7f]+/g, (t) => encodeURIComponent(t));
        this.pathname = enc(a[2] || '/');
        this.search = a[3] && a[3] !== '?' ? enc(a[3]) : '';
        this.hash = a[4] && a[4] !== '#' ? enc(a[4]) : '';
      } else {
        this.pathname = rest;
      }
      this.searchParams = new URLSearchParams(this.search);
    }
    get host() { return this.hostname + (this.port ? ':' + this.port : ''); }
    get origin() { return this.hostname ? `${this.protocol}//${this.host}` : 'null'; }
    get href() {
      if (!this.hostname) return this.protocol + this.pathname;
      const cred = this.username ? this.username + (this.password ? ':' + this.password : '') + '@' : '';
      return `${this.protocol}//${cred}${this.host}${this.pathname}${this.search}${this.hash}`;
    }
    toString() { return this.href; }
  }
  root.URL = URL;
  root.URLSearchParams = URLSearchParams;
})(typeof globalThis !== 'undefined' ? globalThis : this);
