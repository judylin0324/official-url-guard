import { renderVerdict, h, send, ageLabel } from './ui.js';

const $ = (id) => document.getElementById(id);

async function currentTab() {
  // ?tabId= 讓自動化測試能指定要顯示哪個分頁
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch { /* 忽略 */ }
}

function actionButtons(v, tab) {
  const box = $('actions');
  box.replaceChildren();
  if (!v || !v.host || ['skip', 'invalid'].includes(v.level)) return;
  const domain = v.registrable || v.host;
  if (['danger', 'caution', 'platform', 'unknown'].includes(v.level)) {
    box.append(h('button', {
      class: 'btn red', text: '一鍵通報詐騙',
      onclick: async () => {
        // 從工具列通報：順便把目前的網頁截圖存證（警告頁不截）
        const onPage = tab && v.url === tab.url;
        const r = await send({ type: 'prepareReport', url: v.url, title: tab && tab.title, tabId: tab && tab.id, capture: onPage });
        if (r) await copy(r.text);
        window.close();
      },
    }));
  }
  if (['danger', 'caution', 'platform', 'unknown'].includes(v.level) && v.registrable) {
    const btn = h('button', {
      class: 'btn small', text: '註冊多久？', title: `查詢 ${v.registrable} 的註冊日期（只把網域名稱送到 rdap.org）`,
      onclick: async () => {
        btn.disabled = true;
        btn.textContent = '查詢中…';
        const r = await send({ type: 'domainAge', url: v.url });
        const line = h('div', { class: 'age-line' + (r && r.days != null && r.days <= 90 ? ' new' : ''), text: `${v.registrable}：${ageLabel(r)}` });
        $('current').append(line);
        btn.remove();
      },
    });
    box.append(btn);
  }
  if (['unknown', 'caution'].includes(v.level)) {
    box.append(h('button', {
      class: 'btn small', text: '信任此網站',
      title: `把 ${domain} 加入自訂信任清單`,
      onclick: async () => { await send({ type: 'trustDomain', domain }); refresh(); },
    }));
  }
  if (['danger', 'caution', 'platform'].includes(v.level)) {
    box.append(h('button', { class: 'btn small', text: '回報誤判', title: '這是正常網站，卻被警告', onclick: () => { send({ type: 'openIssue', kind: 'false-positive', url: v.url }); window.close(); } }));
  } else if (['unknown', 'official', 'gov'].includes(v.level)) {
    box.append(h('button', { class: 'btn small', text: '回報漏判', title: '這是詐騙網站，卻沒有被警告', onclick: () => { send({ type: 'openIssue', kind: 'missed-scam', url: v.url }); window.close(); } }));
  }
  if (['unknown', 'caution', 'platform'].includes(v.level)) {
    box.append(h('button', {
      class: 'btn small', text: '封鎖此網站',
      title: `把 ${domain} 加入自訂封鎖清單`,
      onclick: async () => { await send({ type: 'blockDomain', domain }); if (tab) chrome.tabs.reload(tab.id); window.close(); },
    }));
  }
}

async function refresh() {
  const tab = await currentTab();
  const url = tab && tab.url;
  let v;
  if (url && url.startsWith(chrome.runtime.getURL('src/pages/warning.html'))) {
    v = await send({ type: 'assess', url: new URL(url).searchParams.get('url') });
  } else if (url && /^https?:/i.test(url)) {
    v = await send({ type: 'getTabVerdict', tabId: tab.id, url });
  } else {
    v = { level: 'skip', reasons: [{ text: '瀏覽器內建頁面或空白頁不需要檢查', weight: 0 }] };
  }
  $('current').replaceChildren(renderVerdict(v));
  actionButtons(v, tab);
  // 簡訊、通訊軟體網頁版：告訴使用者這一頁的訊息有沒有在自動檢查
  const ad = tab && /^https?:/i.test(url || '') ? await send({ type: 'getAdapterStatus', tabId: tab.id }) : null;
  if (ad) {
    $('current').append(h('div', {
      class: 'age-line' + (ad.found ? '' : ' new'),
      text: ad.found
        ? `${ad.name}：正在自動檢查這個畫面上的訊息（${ad.found} 則）`
        : `${ad.name}：找不到訊息內容，可能是網站改版了。請把訊息貼到下方檢查。`,
    }));
  }
}

async function manualCheck() {
  const text = $('manualInput').value;
  const out = $('manualResult');
  if (!text.trim()) return;
  const r = await send({ type: 'assessMessage', text });
  const nodes = [];
  for (const v of r.items) {
    nodes.push(renderVerdict(v));
    if (v.level === 'danger' || v.level === 'caution') {
      nodes.push(h('div', { class: 'actions', style: 'margin:6px 0 4px' }, [
        h('button', {
          class: 'btn red small', text: '一鍵通報這個網址',
          onclick: async () => { const res = await send({ type: 'prepareReport', url: v.url }); if (res) await copy(res.text); window.close(); },
        }),
      ]));
    }
  }
  if (r.noUrl) nodes.push(h('div', { class: 'verdict lv-unknown' }, [h('div', { class: 'title', text: '訊息裡找不到網址' })]));
  for (const note of r.messageNotes) nodes.push(h('div', { class: 'verdict lv-caution', style: 'margin-top:6px', text: note }));
  out.replaceChildren(...nodes);
}

// 從信件或網頁複製的內容，按鈕或文字背後常藏著真正的連結（畫面上看不到網址）。
// 貼上時把這些隱藏連結一起列出來檢查。
$('manualInput').addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  const lib = globalThis.OUG_hiddenLinks;
  if (!cd || !lib) return;
  const plain = cd.getData('text/plain') || '';
  const hiddenLinks = lib.hiddenLinksInHtml(cd.getData('text/html'), plain);
  if (!hiddenLinks.length) return;
  e.preventDefault();
  const box = $('manualInput');
  const insert = `${plain}\n${hiddenLinks.map((h) => `〔隱藏連結〕 ${h}`).join('\n')}\n`;
  box.setRangeText(insert, box.selectionStart, box.selectionEnd, 'end');
  manualCheck();
});
$('manualBtn').addEventListener('click', manualCheck);
$('manualInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manualCheck(); } });
$('openOptions').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

send({ type: 'status' }).then((s) => {
  if (!s) return;
  const blocked = (s.stats.url || 0) + (s.stats.page || 0);
  $('stats').textContent = (blocked ? `已攔下 ${blocked} 次 · ` : '') + `官方 ${s.officialCount} 網域 · 165 清單 ${s.blocklistCount.toLocaleString()} 筆`;
});

refresh();
