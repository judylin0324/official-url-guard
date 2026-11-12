/**
 * 官網守門員：Gmail 收件匣過濾（Google Apps Script）
 *
 * 在你自己的 Google 帳號裡執行，每 10 分鐘檢查新收到的信：
 *   ・判定為詐騙 → 加上「官網守門員/疑似詐騙」標籤並移出收件匣（不會刪除，可在標籤中找到）
 *   ・有可疑之處 → 加上「官網守門員/請小心」標籤，留在收件匣
 * 判斷方式和「官網守門員」瀏覽器擴充功能相同。信件內容只在你的 Google 帳號裡分析，不會傳到其他地方。
 *
 * 安裝：執行 install()。移除：執行 uninstall()。說明見 https://github.com/judylin0324/official-url-guard/tree/main/gmail
 */

// ───── 可以調整的設定 ─────
var SETTINGS = {
  SCAM_ACTION: 'archive', // 'archive'：加標籤並移出收件匣；'spam'：移到垃圾郵件；'label'：只加標籤
  SCAN_MINUTES: 10, // 多久檢查一次（Google 允許 1、5、10、15、30 分鐘）
  LOOKBACK_HOURS: 24, // 第一次執行時往回檢查多久的信
  USE_SCAM_LISTS: true, // 下載 165／TWNIC 涉詐網域清單（只下載公開檔案）
};
var LABEL_ROOT = '官網守門員';
var LABEL_SCAM = '官網守門員/疑似詐騙';
var LABEL_CAUTION = '官網守門員/請小心';
// 本專案每天彙整好的涉詐清單（已包含下面兩個原始來源）；下載不到或筆數異常時才改抓原始來源
var FEED_URL = 'https://judylin0324.github.io/official-url-guard/blocklist.txt';
var FEED_MIN_COUNT = 1000;
var LIST_SOURCES = [
  'https://raw.githubusercontent.com/lf94878964/Taiwan-Blocked-Domains/main/blocked_domains.txt',
  'https://raw.githubusercontent.com/g0v-data/165-data/main/gamble.csv',
];

/** 安裝：建立定時檢查，並立刻檢查一次 */
function install() {
  uninstall();
  ScriptApp.newTrigger('scanInbox').timeBased().everyMinutes(SETTINGS.SCAN_MINUTES).create();
  var result = scanInbox();
  console.log('已安裝：每 ' + SETTINGS.SCAN_MINUTES + ' 分鐘檢查一次新信。');
  return result;
}

/** 移除定時檢查（已加上的標籤會保留） */
function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scanInbox') ScriptApp.deleteTrigger(t);
  });
}

/** 檢查新信（由定時觸發，也可以手動執行） */
function scanInbox() {
  var props = PropertiesService.getUserProperties();
  var now = Math.floor(Date.now() / 1000);
  var last = Number(props.getProperty('lastScan')) || now - SETTINGS.LOOKBACK_HOURS * 3600;
  var since = last - 300; // 多抓 5 分鐘，避免漏掉剛好在邊界的信
  var ctx = getContext_();
  var seen = loadSeen_(props);
  var scamLabel = getLabel_(LABEL_SCAM);
  var cautionLabel = getLabel_(LABEL_CAUTION);
  var counts = { checked: 0, scam: 0, caution: 0 };
  var threads = GmailApp.search('in:inbox after:' + since, 0, 100);
  threads.forEach(function (thread) {
    var worst = null;
    thread.getMessages().forEach(function (msg) {
      if (msg.getDate().getTime() / 1000 < since || seen[msg.getId()]) return;
      seen[msg.getId()] = now;
      counts.checked++;
      var v = checkMessage_(msg, ctx);
      if (v.overall === 'danger' || (v.overall === 'caution' && worst !== 'danger')) worst = v.overall;
      if (v.overall) console.log('[' + v.overall + '] ' + msg.getSubject() + '｜' + v.reason);
    });
    if (worst === 'danger') {
      thread.addLabel(scamLabel);
      if (SETTINGS.SCAM_ACTION === 'spam') thread.moveToSpam();
      else if (SETTINGS.SCAM_ACTION === 'archive') thread.moveToArchive();
      counts.scam++;
    } else if (worst === 'caution') {
      thread.addLabel(cautionLabel);
      counts.caution++;
    }
  });
  props.setProperty('lastScan', String(now));
  saveSeen_(props, seen, now);
  console.log('檢查 ' + counts.checked + ' 封：疑似詐騙 ' + counts.scam + '、請小心 ' + counts.caution);
  return counts;
}

/** 判斷一封信 */
function checkMessage_(msg, ctx) {
  var from = msg.getFrom() || '';
  var addr = from.match(/<([^>]+)>/) || from.match(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
  var sender = addr ? { name: from.replace(/<.*>/, '').replace(/"/g, '').trim(), address: addr[1] } : null;
  // 連結用 HTML 裡真正的網址（顯示的文字可能是假的）
  var html = msg.getBody() || '';
  var links = [];
  var re = /href\s*=\s*["']([^"']+)["']/gi, m;
  while ((m = re.exec(html)) && links.length < 50) {
    var href = m[1].replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
    if (/^https?:\/\//i.test(href)) links.push(href);
  }
  var text = (msg.getSubject() || '') + '\nFrom: ' + from + '\n' + (msg.getPlainBody() || '').slice(0, 8000);
  var r = OUG.assessMessage(text, ctx, { links: links, sender: sender });
  var order = { danger: 3, caution: 2, platform: 1 };
  var worst = r.items.slice().sort(function (a, b) { return (order[b.level] || 0) - (order[a.level] || 0); })[0] || null;
  var overall = worst && order[worst.level] >= 2 ? worst.level : null;
  if (!overall && (r.messageNotes.length || (r.sender && r.sender.problem))) overall = 'caution';
  var reason = worst && worst.reasons[0] ? worst.reasons[0].text : r.messageNotes[0] || '';
  return { overall: overall, reason: reason, result: r };
}

/** 建立判斷用的資料（含 165／TWNIC 涉詐網域；快取 6 小時） */
function getContext_() {
  var domains = SETTINGS.USE_SCAM_LISTS ? getScamDomains_() : [];
  return OUG.buildContext({ blocklist: domains });
}

function getScamDomains_() {
  var cache = CacheService.getUserCache();
  var meta = cache.get('oug:list:n');
  if (meta) {
    var keys = [];
    for (var i = 0; i < Number(meta); i++) keys.push('oug:list:' + i);
    var parts = cache.getAll(keys);
    if (Object.keys(parts).length === keys.length) return keys.map(function (k) { return parts[k]; }).join('\n').split('\n').filter(Boolean);
  }
  var all = [];
  try {
    var feed = UrlFetchApp.fetch(FEED_URL, { muteHttpExceptions: true });
    if (feed.getResponseCode() === 200) all = OUG.parseDomainList(feed.getContentText());
  } catch (e) {
    console.log('彙整清單下載失敗（' + e + '），改用原始來源');
  }
  if (all.length < FEED_MIN_COUNT) all = [];
  (all.length ? [] : LIST_SOURCES).forEach(function (url) {
    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) all = all.concat(OUG.parseDomainList(res.getContentText()));
    } catch (e) {
      console.log('清單下載失敗：' + url + '（' + e + '）');
    }
  });
  var kept = OUG.sanitizeDomains(all, OUG.buildContext()).kept;
  // CacheService 每筆上限 100 KB，分段存
  var chunks = [], cur = [], size = 0;
  kept.forEach(function (d) {
    if (size + d.length + 1 > 90000) { chunks.push(cur.join('\n')); cur = []; size = 0; }
    cur.push(d); size += d.length + 1;
  });
  if (cur.length) chunks.push(cur.join('\n'));
  var put = { 'oug:list:n': String(chunks.length) };
  chunks.forEach(function (c, i) { put['oug:list:' + i] = c; });
  try { cache.putAll(put, 21600); } catch (e) { console.log('快取失敗：' + e); }
  return kept;
}

function getLabel_(name) {
  if (!GmailApp.getUserLabelByName(LABEL_ROOT)) GmailApp.createLabel(LABEL_ROOT);
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// 記住最近檢查過的信，避免同一封信重複處理（保留 3 天）
function loadSeen_(props) {
  try { return JSON.parse(props.getProperty('seen') || '{}'); } catch (e) { return {}; }
}
function saveSeen_(props, seen, now) {
  var keep = {};
  Object.keys(seen).forEach(function (id) { if (seen[id] > now - 3 * 86400) keep[id] = seen[id]; });
  var ids = Object.keys(keep);
  // PropertiesService 每個值上限 9 KB，最多記 200 封（約 6 KB）
  if (ids.length > 200) ids.sort(function (a, b) { return keep[a] - keep[b]; }).slice(0, ids.length - 200).forEach(function (id) { delete keep[id]; });
  props.setProperty('seen', JSON.stringify(keep));
}
