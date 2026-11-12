// 背景服務：攔截高風險網址、更新工具列徽章、處理通報與清單更新
import { buildContext, assessUrl, assessPage, assessMessage } from './lib/checker.js';
import { parseHost, normalizeDomain, isIp } from './lib/domain.js';
import { parseDomainList, sanitizeDomains } from './lib/blocklist.js';
import { OFFICIAL_SITES } from './data/official-sites.js';
import { LIST_SOURCES } from './data/list-sources.js';
import { issueUrl, PROJECT } from './data/project.js';
import { validateRemoteOfficial } from './lib/remote-official.js';
import { decodeQr } from './lib/qr.js';
import { dhash, matchLogo, validateLogoDb } from './lib/image-hash.js';
import { LOGO_HASHES } from './data/logo-hashes.js';

const DEFAULT_REPORT_URL = 'https://fraudbuster.digiat.org.tw/accessibility/index';
const DEFAULT_SETTINGS = {
  blockDanger: true, // 高風險網址先顯示警告頁
  pageGuard: true, // 網頁要你付款／轉帳／輸入驗證碼，但網址不對時，跳出全頁警告
  showBanner: true, // 可疑網站顯示提示列
  markLinks: true, // 標示網頁中的可疑連結
  rdap: false, // 自動查詢網域註冊日期（會把網域名稱送到 rdap.org）；關閉時仍可在警告畫面按按鈕查詢
  reportUrl: DEFAULT_REPORT_URL,
  reportScreenshot: true, // 一鍵通報時，把目前網頁截圖存到下載資料夾當證據
  aiAssist: true, // 電腦上已有 Chrome 內建 AI 模型時，用它判讀頁面自稱的機構（在本機執行，不會上傳）
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
    if (cached && cached.created) age = ageDays(cached.created);
  } catch { /* 無效網址 */ }
  const v = assessUrl(url, st.ctx, { domainAgeDays: age });
  // 來自詐騙信的連結：單看網址可能看不出問題（yarlgs.com），但信件內容已經判定是詐騙
  if (!['official', 'gov', 'trusted', 'skip', 'invalid', 'danger'].includes(v.level)) {
    const hit = await mailContextHit(v.host);
    if (hit) {
      return {
        ...v, level: 'danger', score: Math.max(v.score, 90), source: 'mail', impersonating: hit.impersonating || v.impersonating,
        reasons: [{ text: `這個連結來自一封被判定為詐騙的信件：${hit.reason}`, weight: 90 }, ...v.reasons.filter((r) => r.weight > 0)],
      };
    }
  }
  return v;
}

// ───────── 詐騙信裡的連結：記住 2 小時，點了一樣攔截 ─────────
const MAIL_CONTEXT_MS = 2 * 60 * 60 * 1000;
async function mailContextHit(host) {
  if (!host) return null;
  const { mailContext = {} } = await chrome.storage.session.get('mailContext');
  let h = host;
  while (h && h.includes('.')) {
    const e = mailContext[h];
    if (e && e.until > Date.now()) return e;
    h = h.slice(h.indexOf('.') + 1);
  }
  return null;
}
async function rememberMailContext(items) {
  const { mailContext = {} } = await chrome.storage.session.get('mailContext');
  const now = Date.now();
  for (const [h, e] of Object.entries(mailContext)) if (e.until < now) delete mailContext[h];
  for (const v of items) {
    if (v.level !== 'danger' || !v.host) continue;
    const top = v.reasons.find((r) => r.weight > 0);
    mailContext[v.host] = { reason: top ? top.text : '信件內容可疑', impersonating: v.impersonating || null, until: now + MAIL_CONTEXT_MS };
  }
  await chrome.storage.session.set({ mailContext });
}

const RDAP_URL = 'https://rdap.org/domain/';
const ageDays = (created) => Math.max(0, Math.floor((Date.now() - Date.parse(created)) / 86400000));

/** 查網域註冊日期。force＝使用者按了「查註冊日期」（不受自動查詢設定限制） */
async function domainAge(url, { force = false } = {}) {
  const st = await getState();
  let p;
  try { p = parseHost(new URL(url).hostname); } catch { return { status: 'invalid' }; }
  if (!p.registrable || p.isIp) return { status: 'unsupported' };
  if (p.platform) return { status: 'unsupported', domain: p.registrable };
  const cached = st.rdapCache[p.registrable];
  // 註冊日期不會變，查到就一直用；查不到的，手動查詢時隔一天可以再試
  if (cached && (cached.created || !force || Date.now() - cached.at < 86400000)) {
    return { domain: p.registrable, created: cached.created, days: cached.created ? ageDays(cached.created) : null, status: cached.created ? 'ok' : 'notfound', cached: true, fresh: false };
  }
  if (!force && !st.settings.rdap) return null;
  let created = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(RDAP_URL + encodeURIComponent(p.registrable), { signal: ctrl.signal, headers: { accept: 'application/rdap+json, application/json' } });
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const ev = (json.events || []).find((e) => e.eventAction === 'registration');
      created = ev && !Number.isNaN(Date.parse(ev.eventDate)) ? ev.eventDate : null;
    }
  } catch { /* 查不到就算了 */ }
  const { rdapCache = {} } = await chrome.storage.local.get('rdapCache');
  rdapCache[p.registrable] = { created, at: Date.now() };
  const keys = Object.keys(rdapCache);
  if (keys.length > 500) keys.sort((a, b) => rdapCache[a].at - rdapCache[b].at).slice(0, keys.length - 500).forEach((k) => delete rdapCache[k]);
  await chrome.storage.local.set({ rdapCache });
  return { domain: p.registrable, created, days: created ? ageDays(created) : null, status: created ? 'ok' : 'notfound', fresh: true };
}

async function lookupDomainAge(url) {
  const r = await domainAge(url);
  return Boolean(r && r.fresh && r.created);
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
  chrome.storage.session.remove(['verdict:' + tabId, 'adapter:' + tabId]);
  recentRedirect.delete(tabId);
});

// ───────── 網頁上的 QR Code 解碼 ─────────
/** 圖片 → QR Code 文字。有內建 BarcodeDetector（macOS、ChromeOS 等）先用它，否則用自己的解碼器 */
async function decodeQrBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof BarcodeDetector !== 'undefined') {
      try {
        const found = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap);
        if (found && found[0] && found[0].rawValue) return found[0].rawValue;
      } catch { /* 這台電腦不支援，改用自己的解碼器 */ }
    }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(bitmap, 0, 0, w, h);
    const r = decodeQr(g.getImageData(0, 0, w, h));
    return r ? r.text : null;
  } finally {
    bitmap.close();
  }
}

const qrCache = new Map(); // 圖片網址 → 解碼結果（服務休眠前有效）
async function decodeQrItems(items) {
  const texts = [];
  for (const it of (items || []).slice(0, 8)) {
    try {
      let text;
      if (it.dataUrl && /^data:image\/(png|jpeg|gif|webp|bmp)[;,]/i.test(it.dataUrl) && it.dataUrl.length < 8e6) {
        text = await decodeQrBlob(await (await fetch(it.dataUrl)).blob());
      } else if (it.url && /^https?:\/\//i.test(it.url)) {
        if (qrCache.has(it.url)) text = qrCache.get(it.url);
        else {
          // 網頁已經載入過這張圖；不帶 Cookie，只下載圖片本身
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          const res = await fetch(it.url, { credentials: 'omit', cache: 'force-cache', signal: ctrl.signal });
          clearTimeout(timer);
          const blob = res.ok ? await res.blob() : null;
          text = blob && blob.size < 5e6 && /^image\//.test(blob.type || 'image/') ? await decodeQrBlob(blob) : null;
          qrCache.set(it.url, text);
          if (qrCache.size > 300) qrCache.delete(qrCache.keys().next().value);
        }
      }
      if (text) texts.push(String(text).slice(0, 4000));
    } catch { /* 不是圖片或解不出來 */ }
  }
  return texts;
}

// ───────── 官網 Logo 比對 ─────────
let logoDb = null;
async function getLogoDb() {
  if (logoDb) return logoDb;
  const bundled = validateLogoDb(LOGO_HASHES, OFFICIAL_SITES);
  const { logoRemote } = await chrome.storage.local.get('logoRemote');
  // 線上版比內建版新就用線上版（線上版下載時已經檢查過）
  const useRemote = logoRemote && logoRemote.hashes && (!LOGO_HASHES.generatedAt || logoRemote.generatedAt > LOGO_HASHES.generatedAt);
  logoDb = useRemote ? logoRemote.hashes : bundled.ok ? bundled.hashes : [];
  return logoDb;
}
chrome.storage.onChanged.addListener((changes) => { if (changes.logoRemote) logoDb = null; });

async function updateLogos() {
  try {
    const remote = JSON.parse(await fetchText(PROJECT.pages + 'logo-hashes.json', 20000));
    const v = validateLogoDb(remote, OFFICIAL_SITES);
    if (!v.ok) return { ok: false, error: v.error };
    await chrome.storage.local.set({ logoRemote: { hashes: v.hashes, generatedAt: remote.generatedAt || '', fetchedAt: Date.now() } });
    return { ok: true, count: v.hashes.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 圖片 → 指紋：縮到最長邊 256 像素（和建立官網指紋時一樣） */
async function hashImageBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const s = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
    if (w < 12 || h < 12) return null;
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0, w, h);
    return dhash(g.getImageData(0, 0, w, h));
  } finally {
    bitmap.close();
  }
}

async function logoCheck(items) {
  const db = await getLogoDb();
  if (!db.length) return { matches: [], dbSize: 0 };
  const matches = [];
  for (const it of (items || []).slice(0, 6)) {
    try {
      let blob = null;
      if (it.dataUrl && /^data:image\/(png|jpeg|gif|webp|bmp)[;,]/i.test(it.dataUrl) && it.dataUrl.length < 8e6) blob = await (await fetch(it.dataUrl)).blob();
      else if (it.url && /^https?:\/\//i.test(it.url)) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(it.url, { credentials: 'omit', cache: 'force-cache', signal: ctrl.signal });
        clearTimeout(timer);
        blob = res.ok ? await res.blob() : null;
      }
      if (!blob || blob.size > 3e6) continue;
      const h = await hashImageBlob(blob);
      const m = h && matchLogo(h, db);
      if (m) matches.push({ site: m.site, domain: m.domain, gov: Boolean(m.gov), kind: it.kind === 'icon' ? 'icon' : 'logo', distance: m.distance });
    } catch { /* 不是圖片或讀不到 */ }
  }
  return { matches, dbSize: db.length };
}

// ───────── 裝置端 AI（Chrome 內建的 Gemini Nano）─────────
// 只在「要你付款或輸入密碼、關鍵字卻找不到自稱機構」時才問 AI；模型在本機執行，網頁內容不會上傳。
// 只有模型已經下載好才會使用，不會自動下載（模型很大，要使用者在設定頁按下載）。
const AI_OPTIONS = { expectedInputs: [{ type: 'text', languages: ['en', 'ja'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const AI_SYSTEM = 'You help detect impersonation scams on web pages in Taiwan and Japan. Given the visible text of a web page, '
  + 'identify the organization the page presents itself as (the company, bank, government agency, public program or service whose identity the page uses for itself, '
  + 'for example in its title, header or greeting). claimedName: copy that name exactly as written on the page (it may be an abbreviation or an English name). '
  + 'officialName: the full official name of that organization (Traditional Chinese for Taiwanese organizations, Japanese for Japanese ones, otherwise English). '
  + 'If the page does not present itself as any specific organization, answer null for both. isGovernment is true only when that organization is a government agency or public program. '
  + 'Use only the text given for claimedName; do not guess.';
const AI_SCHEMA = {
  type: 'object',
  properties: {
    claimedName: { type: ['string', 'null'] },
    officialName: { type: ['string', 'null'] },
    isGovernment: { type: 'boolean' },
    topic: { type: 'string', enum: ['parking_fee', 'traffic_fine', 'toll', 'parcel', 'tax_refund', 'utility_bill', 'subsidy', 'prize', 'investment', 'account_verification', 'shopping', 'other'] },
  },
  required: ['claimedName', 'officialName', 'isGovernment', 'topic'],
};
let aiStatusCache = { at: 0, value: null };
async function aiAvailability() {
  const LM = globalThis.LanguageModel;
  if (!LM || typeof LM.availability !== 'function') return 'unsupported';
  if (aiStatusCache.value && Date.now() - aiStatusCache.at < 10 * 60 * 1000) return aiStatusCache.value;
  let v;
  try { v = await LM.availability(AI_OPTIONS); } catch { try { v = await LM.availability(); } catch { v = 'unavailable'; } }
  aiStatusCache = { at: Date.now(), value: v };
  return v;
}
let aiBase = null;
const aiCache = new Map();
async function aiRead(url, text) {
  if (aiCache.has(url)) return aiCache.get(url);
  if ((await aiAvailability()) !== 'available') return null;
  const LM = globalThis.LanguageModel;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let session = null;
  try {
    if (!aiBase) {
      const init = { initialPrompts: [{ role: 'system', content: AI_SYSTEM }] };
      try { aiBase = await LM.create({ ...AI_OPTIONS, ...init }); } catch { aiBase = await LM.create(init); }
    }
    session = typeof aiBase.clone === 'function' ? await aiBase.clone({ signal: ctrl.signal }) : aiBase;
    const raw = await session.prompt(`Web page text (between <page> and </page>):\n<page>\n${text}\n</page>`, { responseConstraint: AI_SCHEMA, signal: ctrl.signal });
    const j = JSON.parse(String(raw).replace(/^```(?:json)?|```$/g, '').trim());
    const clean = (v) => { const t = typeof v === 'string' ? v.trim() : ''; return t && !/^(null|none|n\/a|unknown|無|なし)$/i.test(t) ? t.slice(0, 80) : null; };
    const org = clean(j.claimedName);
    const res = { org, official: org ? clean(j.officialName) : null, isGov: Boolean(org && j.isGovernment === true), topic: typeof j.topic === 'string' ? j.topic.slice(0, 40) : 'other' };
    aiCache.set(url, res);
    if (aiCache.size > 200) aiCache.delete(aiCache.keys().next().value);
    return res;
  } catch {
    return null; // 模型忙碌、逾時或回答格式不對：當作沒有 AI 結果
  } finally {
    clearTimeout(timer);
    if (session && session !== aiBase && typeof session.destroy === 'function') session.destroy();
  }
}

// ───────── 一鍵通報 ─────────
function buildReportText(v, title, extra = {}) {
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
  if (extra.age && extra.age.created) lines.push(`網域註冊日期：${new Date(extra.age.created).toLocaleDateString('zh-TW')}（${extra.age.days} 天前）`);
  if (extra.screenshot) lines.push(`網頁截圖：已存在下載資料夾（${extra.screenshot}）`);
  lines.push('（由「官網守門員」瀏覽器擴充功能整理）');
  return lines.join('\n');
}

/** 把分頁目前的畫面存成 PNG（下載資料夾／官網守門員通報截圖／） */
async function captureEvidence(tabId, host) {
  if (tabId == null || !chrome.downloads) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || !/^https?:/i.test(tab.url || '')) return null;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const safeHost = String(host || 'page').toLowerCase().replace(/[^a-z0-9.-]/g, '_').slice(0, 80);
    // 有些系統（例如部分 Linux）不接受中文檔名，就改用英文資料夾名稱
    for (const folder of ['官網守門員通報截圖', 'OfficialUrlGuard-report']) {
      const filename = `${folder}/${safeHost}-${stamp}.png`;
      try {
        const id = await chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
        return { id, filename };
      } catch { /* 換下一個名稱 */ }
    }
    return null;
  } catch {
    return null; // 例如分頁不在前景、瀏覽器不允許截圖
  }
}

async function prepareReport(url, title, { tabId = null, capture = false } = {}) {
  const st = await getState();
  const v = await assess(url);
  const shot = capture && st.settings.reportScreenshot !== false ? await captureEvidence(tabId, v.host) : null;
  const age = await domainAge(url).catch(() => null); // 只用已查過的結果或依設定查詢
  const text = buildReportText(v, title, { screenshot: shot && shot.filename, age });
  await chrome.storage.session.set({ pendingReport: { url: v.url, host: v.host, text, at: Date.now() } });
  await chrome.tabs.create({ url: st.settings.reportUrl || DEFAULT_REPORT_URL });
  return { text, screenshot: shot ? shot.filename : null };
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
    const logos = st.settings.remoteOfficial ? await updateLogos() : null;
    return { ok: true, count: kept.length, removed: removed.length, removedSample: removed.slice(0, 10), rules, sources: results, official, logos };
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

    case 'assessEmail': {
      // 網頁信箱：內文、真正的連結網址、寄件人
      const r = assessMessage(msg.text, st.ctx, { links: msg.links || [], sender: msg.sender || null });
      const order = { danger: 3, caution: 2, platform: 1 };
      const worst = [...r.items].sort((a, b) => (order[b.level] || 0) - (order[a.level] || 0))[0] || null;
      let overall = worst && order[worst.level] ? worst.level : null;
      if (!overall && (r.messageNotes.length || (r.sender && r.sender.problem))) overall = 'caution';
      if (overall === 'danger') {
        await countBlocked('page');
        await rememberMailContext(r.items); // 之後點信裡的連結會被攔截
      }
      return { ...r, overall, worst };
    }

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
      const { dismissed = {}, submitOk = {} } = await chrome.storage.session.get(['dismissed', 'submitOk']);
      // 要錢或要密碼、卻找不到自稱機構：可以請裝置端 AI 再讀一次
      const aiEligible = Boolean(st.settings.aiAssist !== false && !msg.signals.ai && verdict.page && (verdict.page.asks.length || verdict.page.creds.length)
        && !verdict.page.claim && !verdict.impersonating && verdict.level !== 'danger' && (await aiAvailability()) === 'available');
      return { verdict, settings: st.settings, allowed: await isAllowed(verdict.host), dismissed: Boolean(dismissed[verdict.host]), submitOk: Boolean(submitOk[verdict.host]), aiEligible };
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

    case 'adapterStatus': {
      // 簡訊／通訊軟體網頁版：記下這個分頁找到幾則訊息，工具列視窗用來顯示「有沒有在自動檢查」
      if (sender.tab) {
        await chrome.storage.session.set({ ['adapter:' + sender.tab.id]: { id: String(msg.id || ''), name: String(msg.name || ''), found: Number(msg.found) || 0, at: Date.now() } });
      }
      return { ok: true };
    }

    case 'getAdapterStatus': {
      const key = 'adapter:' + msg.tabId;
      return (await chrome.storage.session.get(key))[key] || null;
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
      return prepareReport(msg.url, msg.title, { tabId, capture: Boolean(msg.capture) });

    case 'aiRead': {
      const s = msg.signals || {};
      const text = [s.title, s.siteName, s.identityText, s.bodyText].filter(Boolean).join('\n').slice(0, 3000);
      return { ai: text.length > 20 ? await aiRead((sender.tab && sender.tab.url) || s.url, text) : null };
    }

    case 'aiStatus':
      if (msg.fresh) aiStatusCache = { at: 0, value: null };
      return { status: await aiAvailability(), enabled: st.settings.aiAssist !== false };

    case 'logoCheck':
      return logoCheck(msg.items);

    case 'decodeQr':
      return { texts: await decodeQrItems(msg.items) };

    case 'domainAge':
      return domainAge(msg.url || (sender.tab && sender.tab.url), { force: true });

    case 'submitConfirmed': {
      // 使用者在「送出前確認」選了送出：這次瀏覽（瀏覽器關閉前）同一網站不再詢問
      const { submitOk = {} } = await chrome.storage.session.get('submitOk');
      if (msg.host) submitOk[String(msg.host).toLowerCase()] = Date.now();
      await chrome.storage.session.set({ submitOk });
      return { ok: true };
    }

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
globalThis.__oug = { assess, getState, buildReportText, syncBlockRules, update165, domainAge, updateLogos, resetAi: () => { aiBase = null; aiCache.clear(); aiStatusCache = { at: 0, value: null }; } };
