// 各頁面共用：判斷結果的顯示方式
export const LEVEL_INFO = {
  official: { icon: '✓', title: '官方網站' },
  gov: { icon: '✓', title: '政府／學術機構網站' },
  trusted: { icon: '✓', title: '你信任的網站' },
  platform: { icon: '!', title: '網域是官方的，但內容不是' },
  unknown: { icon: 'i', title: '不在官方網站清單中' },
  caution: { icon: '!', title: '請小心：有可疑特徵' },
  danger: { icon: '✕', title: '高度疑似詐騙網站' },
  skip: { icon: '–', title: '這個頁面不需要檢查' },
  invalid: { icon: '?', title: '看不懂這個網址' },
};

export function h(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) e.append(c);
  return e;
}

/** 把網址的「真正網域」標粗，例如 www.ctbcbank.com.<b>verify-login.top</b> */
export function hostWithRegistrable(v) {
  const host = v.displayHost || v.host || '';
  const reg = v.registrable || '';
  const span = h('div', { class: 'host' });
  if (reg && host.endsWith(reg) && host !== reg) {
    span.append(host.slice(0, host.length - reg.length), h('b', { text: reg }));
  } else {
    span.append(h('b', { text: host }));
  }
  return span;
}

export function renderVerdict(v, { maxReasons = 4 } = {}) {
  const info = LEVEL_INFO[v.level] || LEVEL_INFO.unknown;
  const reasons = (v.reasons || []).slice(0, maxReasons);
  const card = h('div', { class: `verdict lv-${v.level}` }, [
    h('div', { class: 'row' }, [
      h('div', { class: 'icon', 'aria-hidden': 'true', text: info.icon }),
      h('div', {}, [
        h('div', { class: 'title', text: info.title }),
        v.match ? h('div', { class: 'who', text: v.match.name }) : null,
        v.host ? hostWithRegistrable(v) : null,
      ]),
    ]),
    reasons.length ? h('ul', {}, reasons.map((r) => h('li', { text: r.text }))) : null,
  ]);
  if (v.impersonating && ['danger', 'caution'].includes(v.level)) {
    const imp = v.impersonating;
    card.append(h('div', { class: 'official-link' }, [
      `疑似冒充「${imp.name}」。`,
      imp.domain ? h('span', {}, ['官方網址是 ', h('b', { text: imp.domain })]) : imp.hint || '',
      imp.url ? h('div', {}, [h('a', { href: imp.url, target: '_blank', rel: 'noopener', text: '→ 改為前往官方網站' })]) : null,
    ]));
  }
  return card;
}

export function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

/** 從貼上的簡訊文字中找出第一個網址；沒有 http 就自動補上 */
export function extractUrl(text) {
  const t = String(text || '').trim();
  const m = t.match(/https?:\/\/[^\s"'<>（）「」，。]+/i) || t.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>（）「」，。]*)?/i);
  if (!m) return null;
  return /^https?:\/\//i.test(m[0]) ? m[0] : 'https://' + m[0];
}
