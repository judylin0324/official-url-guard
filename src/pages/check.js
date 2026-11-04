import { renderVerdict, h, send, extractUrl } from './ui.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search).get('q') || '';
const url = extractUrl(q);

async function init() {
  if (!url) {
    $('result').replaceChildren(h('div', { class: 'verdict lv-invalid' }, [h('div', { class: 'title', text: '找不到網址' }), h('p', { class: 'muted', text: q.slice(0, 200) })]));
    return;
  }
  $('full').textContent = url;
  const v = await send({ type: 'assess', url });
  $('result').replaceChildren(renderVerdict(v, { maxReasons: 5 }));
  const btns = $('btns');
  if (['official', 'gov', 'trusted'].includes(v.level)) {
    btns.append(h('button', { class: 'btn green', text: '開啟這個網站', onclick: () => { chrome.tabs.create({ url: v.url }); window.close(); } }));
  } else {
    if (v.impersonating && v.impersonating.url) {
      btns.append(h('button', { class: 'btn green', text: `改為前往${v.impersonating.name}官方網站`, onclick: () => { chrome.tabs.create({ url: v.impersonating.url }); window.close(); } }));
    }
    if (v.level === 'danger' || v.level === 'caution') {
      btns.append(h('button', {
        class: 'btn red', text: '一鍵通報這個網址',
        onclick: async () => {
          const r = await send({ type: 'prepareReport', url: v.url });
          if (r) { try { await navigator.clipboard.writeText(r.text); } catch { /* 忽略 */ } }
          window.close();
        },
      }));
    }
    if (v.level !== 'danger') {
      btns.append(h('button', { class: 'btn', text: '仍要開啟', onclick: () => { chrome.tabs.create({ url: v.url }); window.close(); } }));
    }
  }
  const kind = ['danger', 'caution', 'platform'].includes(v.level) ? 'false-positive' : 'missed-scam';
  btns.append(h('button', {
    class: 'btn', text: kind === 'false-positive' ? '這是正常網站？回報誤判' : '這是詐騙網站？回報漏判',
    onclick: () => { send({ type: 'openIssue', kind, url: v.url }); window.close(); },
  }));
  btns.append(h('button', { class: 'btn', text: '關閉', onclick: () => window.close() }));
}

init();
