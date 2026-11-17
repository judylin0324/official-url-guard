// 資料儲存（Cloudflare KV，綁定名稱 OUG_KV）。沒有設定 KV 時，所有功能照常運作，只是不記錄通報。
// 只存三種東西，都不含訊息內容：
//   r:<網域>                通報彙整：網域、通報／誤判／漏判次數、首次與最近時間、最多 5 個路徑（不含查詢參數）
//   d:<種類>:<使用者代號>:<網域>  同一人重複通報的去重標記（30 天後自動刪除；使用者代號是無法還原的雜湊）
//   g:<群組代號>             群組設定（自動檢查開關、提醒範圍）
// KV 免費方案每天 10 萬次讀取、1,000 次寫入；一次通報寫 2 次，群組設定很少寫入。

const DEDUPE_TTL = 30 * 86400;
const MAX_PATHS = 5;
export const KINDS = { scam: 'scam', fp: 'fp', miss: 'miss' };

/**
 * 記錄一次通報。
 * @returns {Promise<{stored: boolean, duplicate: boolean}>}
 */
export async function recordReport(env, { kind, url, domain, level, userKey, now = Date.now() }) {
  const kv = env.OUG_KV;
  if (!kv || !domain || !KINDS[kind]) return { stored: false, duplicate: false };
  try {
    const dk = `d:${kind}:${userKey}:${domain}`;
    if (userKey && (await kv.get(dk))) return { stored: true, duplicate: true };
    const key = `r:${domain}`;
    const cur = (await kv.get(key, 'json')) || { domain, scam: 0, fp: 0, miss: 0, first: now, paths: [] };
    cur[kind] = (cur[kind] || 0) + 1;
    cur.last = now;
    cur.level = level || cur.level || null;
    let path = '';
    try { const u = new URL(url); path = u.hostname + u.pathname; } catch { /* 沒有網址 */ }
    if (path && !cur.paths.includes(path)) cur.paths = [path.slice(0, 200), ...cur.paths].slice(0, MAX_PATHS);
    await kv.put(key, JSON.stringify(cur), { metadata: { last: now } });
    if (userKey) await kv.put(dk, '1', { expirationTtl: DEDUPE_TTL });
    return { stored: true, duplicate: false };
  } catch (e) {
    console.error('記錄通報失敗', e);
    return { stored: false, duplicate: false };
  }
}

/** 列出通報（給每週彙整用）。days：只列最近幾天有新通報的網域 */
export async function listReports(env, { days = 7, now = Date.now(), limit = 1000 } = {}) {
  const kv = env.OUG_KV;
  if (!kv) return [];
  const since = now - days * 86400000;
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: 'r:', cursor, limit: 1000 });
    for (const k of page.keys) {
      // metadata 裡有最近時間，不用每筆都讀
      if (k.metadata && typeof k.metadata.last === 'number' && k.metadata.last < since) continue;
      const v = await kv.get(k.name, 'json');
      if (v && v.last >= since) out.push(v);
      if (out.length >= limit) break;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < limit);
  return out.sort((a, b) => (b.scam + b.miss) - (a.scam + a.miss) || b.fp - a.fp || b.last - a.last);
}

// ───────── 群組設定 ─────────
const DEFAULT_GROUP = { mode: 'on', level: 'danger' };
const groupCache = new Map(); // 群組代號 → { value, at }（減少 KV 讀取）
const GROUP_CACHE_MS = 10 * 60 * 1000;

export async function getGroupSettings(env, groupKey) {
  const hit = groupCache.get(groupKey);
  if (hit && Date.now() - hit.at < GROUP_CACHE_MS) return hit.value;
  let value = DEFAULT_GROUP;
  try {
    const stored = env.OUG_KV && (await env.OUG_KV.get(`g:${groupKey}`, 'json'));
    if (stored) value = { ...DEFAULT_GROUP, ...stored };
  } catch { /* 讀不到就用預設值 */ }
  groupCache.set(groupKey, { value, at: Date.now() });
  if (groupCache.size > 5000) groupCache.clear();
  return value;
}

export async function setGroupSettings(env, groupKey, patch) {
  const value = { ...(await getGroupSettings(env, groupKey)), ...patch };
  groupCache.set(groupKey, { value, at: Date.now() });
  try { if (env.OUG_KV) await env.OUG_KV.put(`g:${groupKey}`, JSON.stringify(value)); } catch (e) { console.error('儲存群組設定失敗', e); }
  return value;
}

export async function forgetGroup(env, groupKey) {
  groupCache.delete(groupKey);
  try { if (env.OUG_KV) await env.OUG_KV.delete(`g:${groupKey}`); } catch { /* 忽略 */ }
}

// ───────── 頻率限制（記在記憶體裡，不寫 KV）─────────
const hits = new Map();
/** 每個使用者每分鐘最多 limit 則；超過回傳 false */
export function allow(key, limit = 20, windowMs = 60000, now = Date.now()) {
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 10000) hits.clear();
  return true;
}
export function resetRateLimit() { hits.clear(); groupCache.clear(); }
