// 背景服務：攔截高風險網址、更新工具列徽章、處理通報與清單更新
import { buildContext, assessUrl, assessPage, assessMessage } from './lib/checker.js';
import { parseHost, normalizeDomain, isIp } from './lib/domain.js';
import { parseDomainList, sanitizeDomains } from './lib/blocklist.js';
import { OFFICIAL_SITES } from './data/official-sites.js';
import { LIST_SOURCES } from './data/list-sources.js';
import { issueUrl, PROJECT } from './data/project.js';
import { validateRemoteOfficial } from './lib/remote-official.js';

const DEFAULT_REPORT_URL = 'https://fraudbuster.digiat.org.tw/accessibility/index';
const DEFAULT_SETTINGS = {
  blockDanger: true, // 高風險網址先顯示警告頁
  pageGuard: true, // 網頁要你付款／轉帳／輸入驗證碼，但網址不對時，跳出全頁警告
  showBanner: true, // 可疑網站顯示提示列
  markLinks: true, // 標示網頁中的可疑連結
  rdap: false, // 查詢網域註冊日期（會把網域名稱送到 rdap.org）
  reportUrl: DEFAULT_REPORT_URL,
  autoUpdateLists: true, // 每天從公開來源更新涉詐網域清單（只下載清單，不傳送任何瀏覽資料）
  remoteOfficial: true, // 每天從專案網站更新官方網站清單（通過安全檢查才採用）
  feedUrl: '', // 額外的清單下載網址（選填）
};


const ALLOW_MINUTES = 30;

// ───────── 狀態（服務可能隨時被瀏覽器休眠，所以都從 storage 重建）─────────
let statePromise = null;

async function loadState() {
  const data = await chrome.storage.local.get(['settings', 'userTrusted', 'userBlocked', 'blocklist165', 'blocklistManual', 'lineIds165', 'rdapCache', 'officialRemote']);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const remote = data.officialRemote;
  const useRemote = settings.remoteOfficial && remote && Array.isArray(remote.sites) && remote.sites.length;
  const ctx = buildContext({
    sites: useRemote ? remote.sites : OFFICIAL_SITES,
    userTrusted: data.userTrusted || [],
    userBlocked: data.userBlocked || [],
    // 自動更新的清單與手動匯入的清單分開存，自動更新不會蓋掉手動匯入
    blocklist: [...((data.blocklist165 && data.blocklist165.domains) || []), ...((data.blocklistManual && data.blocklistManual.domains) || [])],
    lineIds: (data.lineIds165 && data.lineIds165.ids) || [],
  });
  return { settings, ctx, rdapCache: data.rdapCache || {}, blocklistInfo: data.blocklist165 || null, lineIdInfo: data.lineIds165 || null, officialInfo: useRemote ? remote : null };
}

function getState() {
  if (!statePromise) statePromise = loadState();
  return statePromise;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (keys.some((k) => ['settings', 'userTrusted', 'userBlocked', 'blocklist165', 'blocklistManual', 'lineIds165', 'rdapCache', 'officialRemote'].includes(k))) statePromise = null;
  if (keys.some((k) => ['settings', 'userBlocked', 'userTrusted', 'blocklist165', 'blocklistManual'].includes(k))) scheduleSync();
});

// ───────── 已知詐騙網域：用 declarativeNetRequest 在「送出請求前」就導到警告頁 ─────────
// 165 清單與自訂封鎖清單上的網址，連一個封包都不會送到詐騙網站。其他高風險網址則由下方的導航攔截處理。
const DNR_CHUNK = 2000;
let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncBlockRules().catch((e) => console.warn('同步攔截規則失敗', e)); }, 300);
}

let dnrRuleCount = null; // null＝尚未確認
async function dnrActive() {
  if (dnrRuleCount === null) dnrRuleCount = (await chrome.declarativeNetRequest.getDynamicRules()).length;
  return dnrRuleCount > 0;
}

async function syncBlockRules() {
  statePromise = null; // 確保用的是剛寫入的清單
  const st = await getState();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const domains = st.settings.blockDanger
    ? [...new Set([...st.ctx.blocklist, ...st.ctx.userBlocked])].filter((d) => d && !isIp(d))
    : [];
  // 使用者選擇「仍要前往」或「加入信任」的網域不攔截
  const allowed = [...new Set([...Object.keys(await getAllowed()), ...st.ctx.userTrusted])].filter((d) => d && !isIp(d));
  const addRules = [];
  for (let i = 0; i < domains.length; i += DNR_CHUNK) {
    addRules.push({
      id: 1000 + i / DNR_CHUNK,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: chrome.runtime.getURL('src/pages/warning.html') + '?src=list&url=\\0' },
      },
      condition: {
        regexFilter: '^https?://.*',
        requestDomains: domains.slice(i, i + DNR_CHUNK),
        ...(allowed.length ? { excludedRequestDomains: allowed } : {}),
        resourceTypes: ['main_frame'],
      },
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules });
  dnrRuleCount = addRules.length;
  return addRules.length;
}

async function getAllowed() {
  const { allowedHosts = {} } = await chrome.storage.session.get('allowedHosts');
  const now = Date.now();
  for (const [h, exp] of Object.entries(allowedHosts)) if (exp < now) delete allowedHosts[h];
  return allowedHosts;
}

async function isAllowed(host) {
  const allowed = await getAllowed();
  return Boolean(allowed[host]);
}

async function allowHost(host) {
  const allowed = await getAllowed();
  allowed[host] = Date.now() + ALLOW_MINUTES * 60 * 1000;
  await chrome.storage.session.set({ allowedHosts: allowed });
  await syncBlockRules();
}

// ───────── 判斷 ─────────
async function assess(url) {
  const st = await getState();
  let age;
  try {
    const reg = parseHost(new URL(url).hostname).registrable;
    const cached = st.rdapCache[reg];
    if (cached && cached.created) age = Math.floor((Date.now() - Date.parse(cached.created)) / 86400000);
  } catch { /* 無效網址 */ }
  return assessUrl(url, st.ctx, { domainAgeDays: age });
}

async function lookupDomainAge(url) {
  const st = await getState();
  if (!st.settings.rdap) return false;
  let p;
  try { p = parseHost(new URL(url).hostname); } catch { return false; }
  if (!p.registrable || p.isIp || p.platform || st.rdapCache[p.registrable]) return false;
  let created = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(p.registrable)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const ev = (json.events || []).find((e) => e.eventAction === 'registration');
      created = ev ? ev.eventDate : null;
    }
  } catch { /* 查不到就算了 */ }
  const { rdapCache = {} } = await chrome.storage.local.get('rdapCache');
  rdapCache[p.registrable] = { created, at: Date.now() };
  const keys = Object.keys(rdapCache);
  if (keys.length > 500) keys.sort((a, b) => rdapCache[a].at - rdapCache[b].at).slice(0, keys.length - 500).forEach((k) => delete rdapCache[k]);
  await chrome.storage.local.set({ rdapCache });
  return Boolean(created);
}

// ───────── 徽章 ─────────
const BADGE = {
  official: { text: '✓', color: '#1a7f37', label: '官方網站' },
  gov: { text: '✓', color: '#1a7f37', label: '政府／學術網域' },
  trusted: { text: '✓', color: '#1a7f37', label: '你信任的網站' },
  platform: { text: '!', color: '#b45309', label: '官方平台上的使用者內容' },
  caution: { text: '!', color: '#d97706', label: '有可疑特徵' },
  danger: { text: '✕', color: '#cf222e', label: '高度疑似詐騙' },
  unknown: { text: '', color: '#6e7781', label: '不在官方清單' },
};

async function setBadge(tabId, verdict) {
  const b = BADGE[verdict && verdict.level] || { text: '', color: '#6e7781', label: '' };
  try {
    await chrome.action.setBadgeText({ tabId, text: b.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    await chrome.action.setTitle({ tabId, title: verdict && verdict.host ? `官網守門員：${b.label}\n${verdict.displayHost || verdict.host}` : '官網守門員' });
  } catch { /* 分頁已關閉 */ }
}

async function saveVerdict(tabId, verdict) {
  await chrome.storage.session.set({ ['verdict:' + tabId]: verdict });
}

async function getVerdict(tabId) {
  const key = 'verdict:' + tabId;
  const data = await chrome.storage.session.get(key);
  return data[key] || null;
}

const RANK = { skip: 0, invalid: 0, official: 1, gov: 1, trusted: 1, unknown: 2, platform: 3, caution: 4, danger: 5 };

// ───────── 導航攔截 ─────────
const recentRedirect = new Map();

function warningUrl(url) {
  return chrome.runtime.getURL('src/pages/warning.html') + '?src=nav&url=' + encodeURIComponent(url);
}

async function guard(tabId, url) {
  if (!/^https?:/i.test(url)) return null;
  const verdict = await assess(url);
  const st = await getState();
  // 清單上的網域已由 declarativeNetRequest 在送出請求前攔下，不重複導向
  if (verdict.source === 'list' && (await dnrActive())) return verdict;
  if (verdict.level === 'danger' && st.settings.blockDanger && !(await isAllowed(verdict.host))) {
    const last = recentRedirect.get(tabId);
    if (!last || last.url !== url || Date.now() - last.at > 3000) {
      recentRedirect.set(tabId, { url, at: Date.now() });
      try { await chrome.tabs.update(tabId, { url: warningUrl(url) }); } catch { /* 分頁已關閉 */ }
    }
  }
  return verdict;
}

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0 || d.tabId < 0) return;
  guard(d.tabId, d.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = info.url || (info.status === 'loading' ? tab.url : null);
  if (!url) return;
  if (!/^https?:/i.test(url)) {
    await setBadge(tabId, null);
    return;
  }
  const verdict = await guard(tabId, url);
  if (!verdict) return;
  // 同一頁面若內容腳本已判定更嚴重，就不要蓋掉
  const prev = await getVerdict(tabId);
  if (prev && prev.url === verdict.url && RANK[prev.level] > RANK[verdict.level]) return;
  await saveVerdict(tabId, verdict);
  await setBadge(tabId, verdict);
  if (['unknown', 'caution'].includes(verdict.level) && (await lookupDomainAge(url))) {
    const again = await guard(tabId, url);
    if (again && RANK[again.level] > RANK[verdict.level]) {
      await saveVerdict(tabId, again);
      await setBadge(tabId, again);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('verdict:' + tabId);
  recentRedirect.delete(tabId);
});

// ───────── 一鍵通報 ─────────
function buildReportText(v, title) {
  const time = new Date().toLocaleString('zh-TW', { hour12: false });
  const lines = [
    '【可疑詐騙網址通報】',
    `網址：${v.url}`,
    `實際網域：${v.registrable || v.host}`,
    `發現時間：${time}`,
  ];
  if (title) lines.push(`頁面標題：${title}`);
  if (v.impersonating) lines.push(`疑似冒充：${v.impersonating.name}${v.impersonating.domain ? `（官方網址為 ${v.impersonating.domain}）` : ''}`);
  const reasons = (v.reasons || []).filter((r) => r.weight > 0).slice(0, 5);
  if (reasons.length) {
    lines.push('可疑原因：');
    reasons.forEach((r, i) => lines.push(`${i + 1}. ${r.text}`));
  }
  lines.push('（由「官網守門員」瀏覽器擴充功能整理）');
  return lines.join('\n');
}

async function prepareReport(url, title) {
  const st = await getState();
  const v = await assess(url);
  const text = buildReportText(v, title);
  await chrome.storage.session.set({ pendingReport: { url: v.url, host: v.host, text, at: Date.now() } });
  await chrome.tabs.create({ url: st.settings.reportUrl || DEFAULT_REPORT_URL });
  return { text };
}

// ───────── 涉詐網域清單更新 ─────────
let updating = null;
async function fetchText(url, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function update165() {
  if (updating) return updating; // 避免同時跑兩次
  updating = (async () => {
    const st = await getState();
    const sources = [...LIST_SOURCES];
    if (st.settings.feedUrl) sources.push({ id: 'custom', name: '自訂清單網址', url: st.settings.feedUrl });
    const results = [];
    const all = [];
    for (const src of sources) {
      try {
        const domains = parseDomainList(await fetchText(src.url));
        if (!domains.length) throw new Error('檔案裡找不到網域');
        all.push(...domains);
        results.push({ id: src.id, name: src.name, ok: true, count: domains.length });
      } catch (e) {
        results.push({ id: src.id, name: src.name, ok: false, error: e.name === 'AbortError' ? '連線逾時' : e.message });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    if (!okCount) return { ok: false, error: '所有來源都無法下載，請確認網路連線', sources: results };
    const { kept, removed } = sanitizeDomains(all, st.ctx);
    await chrome.storage.local.set({ blocklist165: { domains: kept, updatedAt: Date.now(), sources: results, removed: removed.slice(0, 50) } });
    const rules = await syncBlockRules().catch(() => 0); // 立刻生效，不等排程
    // 檢查用的涉詐網域：剛下載的、手動匯入的、使用者封鎖的全部都算
    const forbidden = new Set([...kept, ...st.ctx.blocklist, ...st.ctx.userBlocked]);
    const official = st.settings.remoteOfficial ? await updateOfficial(forbidden) : null;
    return { ok: true, count: kept.length, removed: removed.length, removedSample: removed.slice(0, 10), rules, sources: results, official };
  })();
  try { return await updating; } finally { updating = null; }
}

// ───────── 官方網站清單線上更新 ─────────
async function updateOfficial(forbidden) {
  const url = PROJECT.pages + 'official-sites.json';
  try {
    const remote = JSON.parse(await fetchText(url, 20000));
    const v = validateRemoteOfficial(remote, OFFICIAL_SITES, forbidden);
    if (!v.ok) {
      await chrome.storage.local.set({ officialRemoteStatus: { ok: false, error: v.error, at: Date.now() } });
      return { ok: false, error: v.error };
    }
    await chrome.storage.local.set({
      officialRemote: { sites: v.sites, generatedAt: remote.generatedAt, fetchedAt: Date.now(), added: v.added.slice(0, 50), addedCount: v.added.length, removedCount: v.removed.length },
      officialRemoteStatus: { ok: true, at: Date.now() },
    });
    return { ok: true, sites: v.sites.length, added: v.added.length, removed: v.removed.length };
  } catch (e) {
    await chrome.storage.local.set({ officialRemoteStatus: { ok: false, error: e.name === 'AbortError' ? '連線逾時' : e.message, at: Date.now() } });
    return { ok: false, error: e.message };
  }
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'update165') return;
  const st = await getState();
  if (st.settings.autoUpdateLists) update165();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } });
  chrome.alarms.create('update165', { periodInMinutes: 24 * 60, delayInMinutes: 1 });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'check-link', title: '用官網守門員檢查這個連結（不開啟）', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'check-selection', title: '用官網守門員檢查選取的網址', contexts: ['selection'] });
  });
  await syncBlockRules().catch(() => {});
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
    const st = await getState();
    if (st.settings.autoUpdateLists) update165().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => { syncBlockRules().catch(() => {}); });

// ───────── 右鍵選單：不用點開就能檢查 ─────────
chrome.contextMenus.onClicked.addListener((info) => {
  const raw = info.menuItemId === 'check-link' ? info.linkUrl : info.selectionText;
  if (!raw) return;
  const url = chrome.runtime.getURL('src/pages/check.html') + '?q=' + encodeURIComponent(raw);
  chrome.windows.create({ url, type: 'popup', width: 440, height: 680 });
});

// ───────── 統計 ─────────
async function countBlocked(kind) {
  const { stats = { url: 0, page: 0, since: Date.now() } } = await chrome.storage.local.get('stats');
  stats[kind] = (stats[kind] || 0) + 1;
  await chrome.storage.local.set({ stats });
}

// ───────── 訊息 ─────────
async function handle(msg, sender) {
  const st = await getState();
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  switch (msg.type) {
    case 'assess':
      return assess(msg.url);

    case 'assessMessage':
      return assessMessage(msg.text, st.ctx);

    case 'openIssue': {
      // 誤判／漏判回報：開啟預填好的 GitHub Issue 表單（網址只保留到路徑）
      const v = msg.verdict || (await assess(msg.url));
      await chrome.tabs.create({ url: issueUrl(msg.kind === 'missed-scam' ? 'missed-scam' : 'false-positive', v, chrome.runtime.getManifest().version) });
      return { ok: true };
    }

    case 'urlCheck': {
      const v = await assess(msg.url || (sender.tab && sender.tab.url));
      return { level: v.level, settings: st.settings };
    }

    case 'countBlocked':
      await countBlocked(msg.kind === 'page' ? 'page' : 'url');
      return { ok: true };

    case 'pageCheck': {
      const url = (sender.tab && sender.tab.url) || msg.signals.url;
      const base = await assess(url);
      const verdict = assessPage(msg.signals, st.ctx, base);
      if (tabId != null) {
        const prev = await getVerdict(tabId);
        if (!prev || prev.url !== verdict.url || RANK[verdict.level] >= RANK[prev.level]) {
          await saveVerdict(tabId, verdict);
          await setBadge(tabId, verdict);
        }
      }
      const { dismissed = {} } = await chrome.storage.session.get('dismissed');
      return { verdict, settings: st.settings, allowed: await isAllowed(verdict.host), dismissed: Boolean(dismissed[verdict.host]) };
    }

    case 'scanLinks': {
      const levels = {};
      for (const host of (msg.hosts || []).slice(0, 400)) {
        const v = await assess('https://' + host + '/');
        if (v.level === 'danger' || v.level === 'caution') levels[host] = { level: v.level, reason: v.reasons[0] ? v.reasons[0].text : '' };
      }
      const mismatches = [];
      for (const [i, [shown, actual]] of (msg.pairs || []).slice(0, 400).entries()) {
        const a = parseHost(shown).registrable, b = parseHost(actual).registrable;
        if (!a || !b || a === b) continue;
        const target = await assess('https://' + actual + '/');
        if (['official', 'gov', 'trusted'].includes(target.level)) continue;
        mismatches.push({ index: i, shown: a, actual: b });
      }
      return { levels, mismatches, settings: st.settings };
    }

    case 'getTabVerdict': {
      const v = await getVerdict(msg.tabId);
      if (v && msg.url && v.url !== msg.url) return assess(msg.url);
      return v || (msg.url ? assess(msg.url) : null);
    }

    case 'allowHost':
      await allowHost(msg.host);
      return { ok: true };

    case 'dismissBanner': {
      const { dismissed = {} } = await chrome.storage.session.get('dismissed');
      dismissed[msg.host] = Date.now();
      await chrome.storage.session.set({ dismissed });
      return { ok: true };
    }

    case 'trustDomain':
    case 'blockDomain': {
      const key = msg.type === 'trustDomain' ? 'userTrusted' : 'userBlocked';
      const other = key === 'userTrusted' ? 'userBlocked' : 'userTrusted';
      const d = normalizeDomain(msg.domain);
      if (!d) return { ok: false };
      const data = await chrome.storage.local.get([key, other]);
      const list = new Set(data[key] || []);
      list.add(d);
      const otherList = (data[other] || []).filter((x) => x !== d);
      await chrome.storage.local.set({ [key]: [...list].sort(), [other]: otherList });
      await syncBlockRules(); // 先更新攔截規則，呼叫端接著跳轉才不會又被擋
      return { ok: true, domain: d };
    }

    case 'leave': {
      // 離開危險頁：能上一頁就上一頁，否則開新分頁
      if (tabId == null) return { ok: false };
      try { await chrome.tabs.goBack(tabId); } catch { await chrome.tabs.update(tabId, { url: 'chrome://newtab/' }); }
      return { ok: true };
    }

    case 'prepareReport':
      return prepareReport(msg.url, msg.title);

    case 'getPendingReport': {
      const { pendingReport } = await chrome.storage.session.get('pendingReport');
      if (!pendingReport || Date.now() - pendingReport.at > 15 * 60 * 1000) return null;
      return pendingReport;
    }

    case 'clearPendingReport':
      await chrome.storage.session.remove('pendingReport');
      return { ok: true };

    case 'update165':
      return update165();

    case 'status': {
      const { stats = { url: 0, page: 0 } } = await chrome.storage.local.get('stats');
      return {
        officialCount: st.ctx.officialCount,
        siteCount: OFFICIAL_SITES.length,
        blocklistCount: st.ctx.blocklist.size,
        lineIdCount: st.ctx.lineIds.size,
        officialSource: st.officialInfo ? { generatedAt: st.officialInfo.generatedAt, fetchedAt: st.officialInfo.fetchedAt, addedCount: st.officialInfo.addedCount, removedCount: st.officialInfo.removedCount } : null,
        stats,
        blocklistUpdatedAt: st.blocklistInfo ? st.blocklistInfo.updatedAt : null,
        blocklistSources: st.blocklistInfo ? st.blocklistInfo.sources || [] : [],
        settings: st.settings,
      };
    }

    case 'syncRules':
      return { rules: await syncBlockRules() };

    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e && e.message) }));
  return true;
});

// 給自動化測試用
globalThis.__oug = { assess, getState, buildReportText, syncBlockRules, update165 };
