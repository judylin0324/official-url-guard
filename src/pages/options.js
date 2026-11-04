import { h, send } from './ui.js';
import { parseDomainList, parseLineIdList } from '../lib/blocklist.js';
import { normalizeDomain } from '../lib/domain.js';
import { OFFICIAL_SITES } from '../data/official-sites.js';
import { LIST_SOURCES } from '../data/list-sources.js';
import { sanitizeDomains } from '../lib/blocklist.js';
import { buildContext } from '../lib/checker.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_REPORT_URL = 'https://fraudbuster.digiat.org.tw/accessibility/index';

function flash(el, text, ok = true) {
  el.textContent = text;
  el.className = ok ? 'saved' : 'err';
  setTimeout(() => { el.textContent = ''; }, 6000);
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return settings;
}

async function setSetting(key, value) {
  const settings = await getSettings();
  settings[key] = value;
  await chrome.storage.local.set({ settings });
}

async function renderBlocklistStat() {
  const { blocklist165, blocklistManual } = await chrome.storage.local.get(['blocklist165', 'blocklistManual']);
  const auto = (blocklist165 && blocklist165.domains) || [];
  const manual = (blocklistManual && blocklistManual.domains) || [];
  $('blStat').textContent = auto.length || manual.length
    ? `已收錄 ${(auto.length + manual.length).toLocaleString()} 個涉詐網域` + (blocklist165 ? `（更新於 ${new Date(blocklist165.updatedAt).toLocaleString('zh-TW', { hour12: false })}）` : '')
    : '尚未下載，按「立即更新」取得清單';
  const status = new Map(((blocklist165 && blocklist165.sources) || []).map((r) => [r.id, r]));
  $('blSources').replaceChildren(...LIST_SOURCES.map((src) => {
    const r = status.get(src.id);
    return h('li', {}, [
      h('a', { href: src.page, target: '_blank', rel: 'noopener', text: src.name }),
      r ? h('span', { class: r.ok ? 'ok' : 'bad', text: r.ok ? `${r.count.toLocaleString()} 筆` : `無法下載（${r.error}）` }) : h('span', { class: 'muted', text: '尚未更新' }),
    ]);
  }));
  $('manualStat').textContent = manual.length ? `手動匯入：${manual.length.toLocaleString()} 個網域（${blocklistManual.source}）` : '';
}

async function runUpdate() {
  $('blMsg').textContent = '下載中…';
  $('blUpdate').disabled = true;
  const r = await send({ type: 'update165' });
  $('blUpdate').disabled = false;
  if (r && r.ok) flash($('blMsg'), `更新完成：${r.count.toLocaleString()} 個網域` + (r.removed ? `（已剔除 ${r.removed} 個官方或政府網域）` : ''));
  else flash($('blMsg'), (r && r.error) || '更新失敗', false);
  renderBlocklistStat();
}

function parseLines(text) {
  const out = new Set(), bad = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const d = normalizeDomain(t);
    if (d) out.add(d); else bad.push(t);
  }
  return { list: [...out].sort(), bad };
}

async function init() {
  const settings = await getSettings();
  document.querySelectorAll('[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    input.checked = settings[key] !== undefined ? Boolean(settings[key]) : key !== 'rdap'; // 只有網域註冊日期查詢預設關閉
    input.addEventListener('change', () => setSetting(key, input.checked));
  });

  // 165 清單
  await renderBlocklistStat();
  $('feedUrl').value = settings.feedUrl || '';
  $('blFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const parsed = parseDomainList(await file.text());
    const { kept, removed } = sanitizeDomains(parsed, buildContext());
    if (!kept.length) {
      flash($('blMsg'), '檔案裡找不到網域，請確認是涉詐網站的 CSV 或一行一個網域的文字檔', false);
      return;
    }
    await chrome.storage.local.set({ blocklistManual: { domains: kept, updatedAt: Date.now(), source: file.name } });
    flash($('blMsg'), `匯入完成：${kept.length.toLocaleString()} 個網域` + (removed.length ? `（已剔除 ${removed.length} 個官方或政府網域）` : ''));
    renderBlocklistStat();
  });
  $('blUpdate').addEventListener('click', runUpdate);
  $('feedSave').addEventListener('click', async () => {
    const url = $('feedUrl').value.trim();
    if (url && !/^https:\/\//.test(url)) { flash($('blMsg'), '請輸入 https:// 開頭的網址', false); return; }
    await setSetting('feedUrl', url);
    runUpdate();
  });

  // 165 詐騙 LINE ID
  const renderLineStat = async () => {
    const { lineIds165 } = await chrome.storage.local.get('lineIds165');
    $('liStat').textContent = lineIds165 && lineIds165.ids && lineIds165.ids.length
      ? `已匯入 ${lineIds165.ids.length.toLocaleString()} 個詐騙 LINE ID（更新於 ${new Date(lineIds165.updatedAt).toLocaleString('zh-TW', { hour12: false })}）`
      : '尚未匯入';
  };
  await renderLineStat();
  $('liFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ids = parseLineIdList(await file.text());
    if (!ids.length) { flash($('liMsg'), '檔案裡找不到 LINE ID', false); return; }
    await chrome.storage.local.set({ lineIds165: { ids, updatedAt: Date.now(), source: file.name } });
    flash($('liMsg'), `匯入完成：${ids.length.toLocaleString()} 個 LINE ID`);
    renderLineStat();
  });

  // 統計
  const { stats } = await chrome.storage.local.get('stats');
  if (stats && (stats.url || stats.page)) {
    $('statsLine').textContent = `已幫你攔下 ${stats.url || 0} 個可疑網址、${stats.page || 0} 個假冒付款頁`;
  }

  // 自訂清單
  const { userTrusted = [], userBlocked = [] } = await chrome.storage.local.get(['userTrusted', 'userBlocked']);
  $('trusted').value = userTrusted.join('\n');
  $('blocked').value = userBlocked.join('\n');
  $('saveLists').addEventListener('click', async () => {
    const t = parseLines($('trusted').value), b = parseLines($('blocked').value);
    const blockedSet = new Set(b.list);
    const trusted = t.list.filter((d) => !blockedSet.has(d));
    await chrome.storage.local.set({ userTrusted: trusted, userBlocked: b.list });
    $('trusted').value = trusted.join('\n');
    $('blocked').value = b.list.join('\n');
    const bad = [...t.bad, ...b.bad];
    flash($('listMsg'), bad.length ? `已儲存，但這幾行不是有效網域：${bad.slice(0, 3).join('、')}` : '已儲存', !bad.length);
  });

  // 通報網址
  $('reportUrl').value = settings.reportUrl || DEFAULT_REPORT_URL;
  $('reportSave').addEventListener('click', async () => {
    const v = $('reportUrl').value.trim();
    if (!/^https:\/\//.test(v)) { flash($('reportMsg'), '請輸入 https:// 開頭的網址', false); return; }
    await setSetting('reportUrl', v);
    flash($('reportMsg'), '已儲存');
  });
  $('reportReset').addEventListener('click', async () => {
    $('reportUrl').value = DEFAULT_REPORT_URL;
    await setSetting('reportUrl', DEFAULT_REPORT_URL);
    flash($('reportMsg'), '已恢復預設');
  });

  // 官方清單來源
  const st = await send({ type: 'status' });
  const { officialRemoteStatus } = await chrome.storage.local.get('officialRemoteStatus');
  if (st && st.officialSource) {
    const o = st.officialSource;
    $('officialSource').textContent = `目前使用線上版本（${new Date(o.generatedAt).toLocaleDateString('zh-TW')} 發布，比內建版本新增 ${o.addedCount} 個、移除 ${o.removedCount} 個網域）`;
  } else if (officialRemoteStatus && !officialRemoteStatus.ok) {
    $('officialSource').textContent = `目前使用內建版本（線上版本未採用：${officialRemoteStatus.error}）`;
  } else {
    $('officialSource').textContent = '目前使用內建版本';
  }

  // 官方清單
  const byCat = new Map();
  for (const s of OFFICIAL_SITES) {
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category).push(s);
  }
  const domainCount = OFFICIAL_SITES.reduce((n, s) => n + s.domains.length, 0);
  $('officialStat').prepend(`共 ${OFFICIAL_SITES.length} 個機構、${domainCount} 個網域。`);
  const list = $('officialList');
  for (const [cat, sites] of byCat) {
    list.append(h('div', { class: 'cat', text: cat }));
    for (const s of sites) list.append(h('div', { class: 'site' }, [h('span', { text: s.name }), h('code', { text: s.domains.join('、') })]));
  }
}

init();
