// 判斷：和擴充功能、手機檢查網頁共用同一份引擎（src/lib/checker.js）。
// 判斷用的資料在 Worker 啟動時就建好（全域範圍），每則訊息只做比對。
import { buildContext, assessMessage, assessUrl, analyzeQr, extractUrls, SHORTENERS } from '../../src/lib/checker.js';
import { parseHost } from '../../src/lib/domain.js';
import { OFFICIAL_SITES } from '../../src/data/official-sites.js';
import { BLOCKLIST } from './generated/data.js';

export const ctx = buildContext({ blocklist: BLOCKLIST });


const ORDER = { danger: 3, caution: 2, platform: 1 };
const SHOWN = new Set(['danger', 'caution', 'platform', 'unknown', 'official', 'gov']);

/** 依嚴重程度排序、同一個網址只留一筆 */
function rank(items) {
  const seen = new Set();
  return [...items]
    .filter((v) => SHOWN.has(v.level))
    .sort((a, b) => (ORDER[b.level] || 0) - (ORDER[a.level] || 0) || (b.score || 0) - (a.score || 0))
    .filter((v) => { const k = v.host + (v.url || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 整則訊息的燈號：任何連結危險就是危險；沒有連結但話術可疑算「可疑」（和擴充功能的網頁信箱相同） */
export function overallOf(items, notes, sender) {
  const worst = items[0] || null;
  let overall = worst && ORDER[worst.level] ? worst.level : null;
  if (!overall && ((notes && notes.length) || (sender && sender.problem))) overall = 'caution';
  return overall;
}

// ───────── 短網址展開 ─────────
// 只向「已知的短網址服務」詢問它會轉到哪裡（讀轉址標頭，不下載內容），不會連到最後的目的地網站。
const MAX_HOPS = 3;
export async function expandShortUrl(url, fetchImpl = fetch) {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let u;
    try { u = new URL(current); } catch { return null; }
    if (!SHORTENERS.has(parseHost(u.hostname).registrable)) return hop ? current : null;
    try {
      const res = await fetchImpl(u.href, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'OfficialUrlGuardBot/1.0 (+https://github.com/judylin0324/official-url-guard)' }, signal: AbortSignal.timeout(3000) });
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* 忽略 */ }
      if (!loc || res.status < 300 || res.status >= 400) return hop ? current : null;
      current = new URL(loc, u.href).href;
    } catch {
      return hop ? current : null;
    }
  }
  return current;
}

/**
 * 檢查一段文字（簡訊、LINE 訊息、Email、網址、QR Code 內容）。
 * @param {string} text
 * @param {{ expand?: boolean, fetchImpl?: Function, extraLinks?: string[] }} options
 */
export async function checkText(text, { expand = true, fetchImpl = fetch, extraLinks = [] } = {}) {
  const clean = String(text || '').slice(0, 8000);
  // 短網址先問出真正的目的地，一起判斷
  const expanded = new Map(); // 真正的目的地 → 短網址
  if (expand) {
    const shorts = [...new Set([...extractUrls(clean), ...extraLinks])].filter((u) => {
      try { return SHORTENERS.has(parseHost(new URL(u).hostname).registrable); } catch { return false; }
    }).slice(0, 4);
    const results = await Promise.all(shorts.map((s) => expandShortUrl(s, fetchImpl).then((d) => [s, d])));
    for (const [s, d] of results) if (d && d !== s) expanded.set(d, s);
  }
  return buildResult(clean, expanded, extraLinks);
}

/** checkText 的同步部分（短網址已經展開）：判斷、合併短網址、排序 */
export function buildResult(clean, expanded = new Map(), extraLinks = []) {
  const r = assessMessage(clean, ctx, { links: [...extraLinks, ...expanded.keys()] });
  // 展開成功的短網址：只顯示真正的目的地，並註明是從哪個短網址轉過去的
  const shortDone = new Set(expanded.values());
  const items = r.items
    .filter((v) => !shortDone.has(v.url))
    .map((v) => (expanded.has(v.url)
      ? { ...v, via: expanded.get(v.url), reasons: [...v.reasons.filter((x) => x.weight > 0), { text: `這是短網址 ${expanded.get(v.url).replace(/^https?:\/\//, '')} 實際會連到的網站`, weight: 0 }, ...v.reasons.filter((x) => x.weight === 0)] }
      : v));
  const ranked = rank(items);
  return {
    overall: overallOf(ranked, r.messageNotes, r.sender),
    items: ranked,
    notes: r.messageNotes,
    noUrl: r.noUrl && !extraLinks.length,
    claim: r.claim,
    sender: r.sender,
  };
}

/** 檢查 QR Code 的內容：網址照網址判斷，付款碼、錢包地址、LINE 加好友另外說明 */
export async function checkQr(qrText, options = {}) {
  const q = analyzeQr([qrText]);
  const links = q.urls.slice(0, 5);
  const r = await checkText(links.length ? links.join('\n') : qrText, options);
  return { ...r, qr: { text: qrText.slice(0, 300), items: q.items, pay: q.pay, crypto: q.crypto } };
}

/**
 * 給一鍵通報用：重新判斷單一網址。通報時只剩網址，
 * claim（訊息自稱的機構）用來還原「冒充誰」，讓通報內容和當初的檢查結果一致。
 */
export function checkUrl(url, claim = '') {
  const v = assessUrl(url, ctx);
  const name = String(claim || '').slice(0, 30);
  if (!name || ['official', 'gov', 'trusted', 'invalid', 'skip'].includes(v.level) || (v.impersonating && v.impersonating.name === name)) return v;
  const site = OFFICIAL_SITES.find((s) => s.name === name);
  const host = v.displayHost || v.host;
  const reason = site
    ? { weight: 85, text: `訊息自稱「${site.name}」，但連結 ${host} 不是「${site.name}」的官方網址（官方是 ${site.domains[0]}）` }
    : { weight: 85, text: `訊息以「${name}」名義要你點連結，但連結不是政府網域。政府網站以 .gov.tw 結尾（臺北市為 .gov.taipei）` };
  return {
    ...v,
    impersonating: site ? { name: site.name, domain: site.domains[0] } : { name, domain: null },
    reasons: [reason, ...v.reasons.filter((r) => r.weight > 0)],
  };
}
