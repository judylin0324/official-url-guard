// 解析 165 涉詐網域清單（政府資料開放平臺「165反詐騙諮詢專線_遭停止解析涉詐網站」CSV），
// 也接受一行一個網域的純文字。
import { normalizeDomain } from './domain.js';
import { normalizeLineId, isProtectedDomain } from './checker.js';

function parseCsvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** 回傳去重後的網域陣列 */
export function parseDomainList(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  const rows = parseCsvRows(clean);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = header.findIndex((h) => /網域|網址|domain|url|網站/.test(h) && !/名稱|性質|name/.test(h));
  const out = new Set();
  const dataRows = col >= 0 ? rows.slice(1) : rows;
  for (const r of dataRows) {
    const cells = col >= 0 ? [r[col]] : r;
    for (const c of cells) {
      // 一格可能塞了多個網址
      for (const piece of String(c || '').split(/[\s、;；|]+/)) {
        // 「1.5」這類數字會被瀏覽器當成 IP，只接受含英文字母的網域或完整的 IPv4
        if (!/[a-z\u00c0-\uffff]/i.test(piece) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(piece.trim())) continue;
        const d = normalizeDomain(piece);
        if (d && d.includes('.')) out.add(d);
      }
    }
  }
  return [...out];
}

/** 解析 165「詐騙 LINE ID」清單（CSV 或一行一個） */
export function parseLineIdList(text) {
  const rows = parseCsvRows(String(text || '').replace(/^\uFEFF/, ''));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = header.findIndex((h) => /line|帳號|id/.test(h) && !/日期|時間|件數|name|名稱/.test(h));
  const out = new Set();
  for (const r of col >= 0 ? rows.slice(1) : rows) {
    for (const c of col >= 0 ? [r[col]] : r) {
      const id = normalizeLineId(String(c || '').replace(/^.*line\.me\/(?:R\/)?ti\/p\//i, ''));
      // 純數字多半是日期或件數，不是 LINE ID
      if (id && !/^\d+$/.test(id)) out.add(id);
    }
  }
  return [...out];
}

/** 剔除官方、政府網域與無效項目，回傳 { kept, removed } */
export function sanitizeDomains(domains, ctx, max = 200000) {
  const kept = [], removed = [];
  for (const d of new Set(domains)) {
    if (isProtectedDomain(d, ctx)) removed.push(d);
    else kept.push(d);
    if (kept.length >= max) break;
  }
  return { kept, removed };
}
