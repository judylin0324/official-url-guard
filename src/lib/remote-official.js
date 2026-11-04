// 官方清單線上更新：從專案的 GitHub Pages 下載最新官方清單。
// 為了防止 repo 被入侵時有人把詐騙網域標成「官方」，下載的清單必須通過以下檢查，否則一律沿用內建版本：
//   1. 格式正確、機構數與網域數在合理範圍
//   2. 每個網域都是有效網域，不能是後綴本身（com.tw）或頂級網域
//   3. 不能出現在 165／TWNIC 涉詐清單或使用者封鎖清單
//   4. 和內建版本相比，新增的網域最多 300 個
import { normalizeDomain, parseHost, HOSTING_PLATFORMS } from './domain.js';

const SUFFIX_LIKE = /^(com|net|org|edu|gov|mil|co|ac|or|ne|go|idv|game|ebiz|club)\.[a-z]{2}$/;

export const REMOTE_FORMAT = 1;
const MAX_NEW_DOMAINS = 300;
const STR = (x) => typeof x === 'string' && x.length > 0 && x.length < 200;
const STR_ARR = (a) => a === undefined || (Array.isArray(a) && a.length <= 50 && a.every(STR));

/** 把 OFFICIAL_SITES 轉成可以公開下載的 JSON（RegExp 等不能序列化的欄位不包含在官方清單裡） */
export function exportOfficial(sites, generatedAt = new Date().toISOString()) {
  return {
    format: REMOTE_FORMAT,
    generatedAt,
    sites: sites.map((s) => {
      const o = { name: s.name, category: s.category, domains: s.domains };
      for (const k of ['home', 'keywords', 'aliases', 'stems', 'anyText', 'generic', 'global']) if (s[k] !== undefined) o[k] = s[k];
      return o;
    }),
  };
}

/**
 * @param {object} remote 下載的 JSON
 * @param {object[]} bundled 內建 OFFICIAL_SITES
 * @param {Set<string>} forbidden 涉詐清單＋使用者封鎖清單
 * @returns {{ ok: boolean, error?: string, sites?: object[], added?: string[], removed?: string[] }}
 */
export function validateRemoteOfficial(remote, bundled, forbidden = new Set()) {
  if (!remote || remote.format !== REMOTE_FORMAT || !Array.isArray(remote.sites)) return { ok: false, error: '格式不符' };
  if (remote.sites.length < 100 || remote.sites.length > 3000) return { ok: false, error: `機構數不合理（${remote.sites.length}）` };
  const sites = [];
  const seen = new Set();
  for (const s of remote.sites) {
    if (!STR(s.name) || !STR(s.category) || !Array.isArray(s.domains) || !s.domains.length || s.domains.length > 20) return { ok: false, error: `「${s && s.name}」格式不符` };
    if (!STR_ARR(s.keywords) || !STR_ARR(s.aliases) || !STR_ARR(s.stems)) return { ok: false, error: `「${s.name}」欄位格式不符` };
    if (s.generic !== undefined && s.generic !== true && !STR_ARR(s.generic)) return { ok: false, error: `「${s.name}」generic 格式不符` };
    const domains = [];
    for (const d of s.domains) {
      const n = normalizeDomain(d);
      const p = parseHost(n);
      // normalizeDomain 會去掉 www.；官方清單本來就不放 www.，所以要求完全一致
      if (!n || n !== d || !n.includes('.') || p.registrable === p.suffix || SUFFIX_LIKE.test(n)) return { ok: false, error: `網域無效：${d}` };
      // 架站平台本身（github.io）不能整個變成官方，否則任何人的頁面都會被當成官方
      if (HOSTING_PLATFORMS.includes(n)) return { ok: false, error: `不能把架站平台整個列為官方：${d}` };
      let h = n, hit = false;
      while (h.includes('.')) { if (forbidden.has(h)) { hit = true; break; } h = h.slice(h.indexOf('.') + 1); }
      if (hit) return { ok: false, error: `網域出現在涉詐或封鎖清單：${d}` };
      if (seen.has(n)) return { ok: false, error: `網域重複：${d}` };
      seen.add(n);
      domains.push(n);
    }
    const o = { name: s.name, category: s.category, domains };
    for (const k of ['home', 'keywords', 'aliases', 'stems', 'anyText', 'generic', 'global']) if (s[k] !== undefined) o[k] = s[k];
    if (o.home !== undefined && !STR(o.home)) return { ok: false, error: `「${s.name}」home 格式不符` };
    if (o.anyText !== undefined && typeof o.anyText !== 'boolean') return { ok: false, error: `「${s.name}」anyText 格式不符` };
    if (o.global !== undefined && typeof o.global !== 'boolean') return { ok: false, error: `「${s.name}」global 格式不符` };
    sites.push(o);
  }
  const before = new Set(bundled.flatMap((s) => s.domains));
  const added = [...seen].filter((d) => !before.has(d));
  const removed = [...before].filter((d) => !seen.has(d));
  if (added.length > MAX_NEW_DOMAINS) return { ok: false, error: `一次新增太多網域（${added.length}）` };
  return { ok: true, sites, added, removed };
}
