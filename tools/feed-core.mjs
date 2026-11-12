// 每日涉詐清單彙整的核心邏輯（純函式，方便測試）。由 tools/build-feed.mjs 呼叫。

/** 筆數比上次少超過三成，視為來源出問題（檔案被截斷、格式改了），沿用上次的資料 */
export const DROP_RATIO = 0.7;
/** 上次筆數少於這個數字的來源不做「驟降」檢查（小清單波動大） */
export const DROP_MIN_PREV = 100;

/**
 * 決定一個來源這次要用哪份資料。
 * @param {{id:string,name:string}} src 來源
 * @param {string[]} prev 上次成功的網域（沒有就給空陣列）
 * @param {{ok:boolean, domains?:string[], error?:string}} fetched 這次下載與解析的結果
 * @param {string|null} prevOkAt 上次成功的時間（ISO）
 * @param {string} now 現在時間（ISO）
 */
export function mergeSource(src, prev, fetched, prevOkAt, now) {
  const base = { id: src.id, name: src.name, previous: prev.length };
  const carry = (problem) => ({
    domains: prev,
    status: { ...base, ok: false, carried: prev.length > 0, count: prev.length, lastOkAt: prevOkAt, error: problem },
    problem: `${src.name}：${problem}${prev.length ? `（沿用上次的 ${prev.length} 筆${prevOkAt ? '，' + prevOkAt.slice(0, 10) : ''}）` : '（沒有可沿用的資料）'}`,
  });
  if (!fetched.ok) return carry(`下載失敗：${fetched.error || '未知錯誤'}`);
  const domains = [...new Set(fetched.domains || [])].sort();
  if (!domains.length) return carry('檔案裡找不到網域（格式可能改了）');
  if (prev.length >= DROP_MIN_PREV && domains.length < prev.length * DROP_RATIO) {
    return carry(`筆數從 ${prev.length} 驟降到 ${domains.length}`);
  }
  return { domains, status: { ...base, ok: true, carried: false, count: domains.length, lastOkAt: now }, problem: null };
}

/**
 * 合併所有來源 → 淨化（剔除官方、政府網域）→ 排序。
 * @param {{domains:string[]}[]} merged mergeSource() 的結果
 * @param {(domains:string[]) => {kept:string[], removed:string[]}} sanitize
 */
export function buildFeed(merged, sanitize) {
  const all = new Set();
  for (const m of merged) for (const d of m.domains) all.add(d);
  const { kept, removed } = sanitize([...all]);
  return { domains: [...kept].sort(), removed: [...removed].sort() };
}

/** 給 GitHub Issue 用的說明文字 */
export function problemReport(problems, meta) {
  return [
    `每日涉詐清單彙整（${meta.generatedAt.slice(0, 10)}）發現 ${problems.length} 個問題。清單仍然照常發布，有問題的來源沿用上次成功的資料。`,
    '',
    ...problems.map((p) => `- ${p}`),
    '',
    '| 來源 | 狀態 | 這次筆數 | 上次筆數 | 上次成功 |',
    '|---|---|---|---|---|',
    ...meta.sources.map((s) => `| ${s.name} | ${s.ok ? '正常' : s.carried ? '沿用舊資料' : '失敗'} | ${s.count} | ${s.previous} | ${(s.lastOkAt || '').slice(0, 10) || '—'} |`),
    '',
    `彙整後共 ${meta.count} 筆。處理方式見 docs/MAINTENANCE.md「涉詐清單來源異常」。來源恢復正常後，這個 Issue 會自動關閉。`,
  ].join('\n');
}
