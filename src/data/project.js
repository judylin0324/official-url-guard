// 專案資訊與回報網址（GitHub Issues）
export const PROJECT = {
  repo: 'judylin0324/official-url-guard',
  home: 'https://github.com/judylin0324/official-url-guard',
  pages: 'https://judylin0324.github.io/official-url-guard/',
};

const LEVEL_TEXT = {
  official: '官方網站', gov: '政府／學術網域', trusted: '使用者信任', platform: '官方平台上的使用者內容',
  unknown: '不在官方清單', caution: '可疑', danger: '高度疑似詐騙', skip: '略過', invalid: '無效網址',
};

/** 回報內容會公開，所以只保留網址的「網站＋路徑」，查詢參數（常含 email、登入代碼）一律拿掉 */
export function publicUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url || '').split(/[?#]/)[0].slice(0, 300);
  }
}

/**
 * 產生 GitHub Issue 表單網址（欄位會自動帶入）
 * @param {'false-positive'|'missed-scam'} kind 誤判／漏判
 * @param {object} v assessUrl() 的結果
 * @param {string} version 插件或網頁版本
 */
export function issueUrl(kind, v, version = '') {
  const host = (v && (v.registrable || v.host)) || '';
  const params = new URLSearchParams({
    template: `${kind}.yml`,
    title: `${kind === 'false-positive' ? '[誤判]' : '[漏判]'} ${host}`,
    url: publicUrl(v && v.url),
    verdict: `${LEVEL_TEXT[v && v.level] || ''}（${(v && v.score) || 0} 分）`,
    reasons: ((v && v.reasons) || []).filter((r) => r.weight > 0).slice(0, 6).map((r) => `- ${r.text}`).join('\n'),
    version,
  });
  return `${PROJECT.home}/issues/new?${params}`;
}
