// LINE 回覆訊息的內容與 Flex 卡片。所有文字都在這裡，改措辭只要改這個檔案。
// 格式限制（LINE 規定）：一次回覆最多 5 則、Flex 單張卡片 30 KB、輪播最多 12 張、altText 1500 字、
// Flex 按鈕文字 40 字、快速回覆按鈕 20 字且最多 13 個、postback data 300 字、複製文字 1000 字。
import { PROJECT, publicUrl } from '../../src/data/project.js';

export const REPORT_URL = 'https://fraudbuster.digiat.org.tw/accessibility/index';
export const PRIVACY_URL = PROJECT.pages + 'privacy.html#line';
export const WEB_URL = PROJECT.pages;

const COLOR = { danger: '#C62828', caution: '#E65100', platform: '#E65100', unknown: '#546E7A', official: '#2E7D32', gov: '#2E7D32' };
const SEAL = { danger: '⚠ 高度疑似詐騙', caution: '! 有可疑特徵', platform: '! 請小心', unknown: '? 無法確認', official: '✓ 官方網站', gov: '✓ 政府／學術網域' };
const ADVICE = {
  danger: '請不要點開，也不要輸入任何資料。',
  caution: '先別輸入任何資料，改從官方 App 或自己輸入官方網址查詢。',
  platform: '這是官方平台，但上面的內容任何人都能建立（例如 Google 表單），不能代表任何機構。',
  unknown: '不在官方網站清單中。不代表是詐騙，也不代表安全；要付款或輸入資料前，請自己輸入官方網址進入。',
  official: '連結本身是官方網站。仍要留意訊息是不是要你轉帳或提供驗證碼。',
  gov: '連結是政府或學術機構網域。仍要留意訊息是不是要你轉帳或提供驗證碼。',
};
const WARN = new Set(['danger', 'caution', 'platform']);

/** 截斷文字（以字元計，不切斷 emoji） */
export const clip = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
/** 分享給別人時把網址「拆開」，避免對方誤點 */
export const defang = (host) => String(host || '').replace(/\./g, '[.]');
const t = (text, o = {}) => ({ type: 'text', text: clip(text, 1500) || ' ', wrap: true, ...o });
const btn = (action, o = {}) => ({ type: 'button', height: 'sm', ...o, action: { ...action, label: clip(action.label, 40) } });
const hostOf = (v) => v.displayHost || v.host || '';

/** postback 資料（最多 300 字）：網址只留到路徑，太長就截短 */
export function packData(a, k, url, claim = '') {
  let u = publicUrl(url || '');
  // c：訊息自稱的機構（通報時只剩網址，靠它還原「冒充誰」）
  const c = claim ? `&c=${encodeURIComponent(clip(claim, 30))}` : '';
  const make = () => `a=${a}&k=${k}${c}&u=${encodeURIComponent(u)}`;
  while (make().length > 300 && u.length > 20) u = u.slice(0, Math.floor(u.length * 0.8));
  return make().slice(0, 300);
}

/** 正式通報用的文字（貼到網詐通報查詢網；最多 1000 字） */
export function reportText(v) {
  const lines = ['【可疑詐騙網址通報】', `網址：${publicUrl(v.url)}`, `實際網域：${v.registrable || v.host}`];
  lines.push(`發現時間：${new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' })}`);
  if (v.via) lines.push(`來源短網址：${v.via}`);
  if (v.impersonating) lines.push(`疑似冒充：${v.impersonating.name}${v.impersonating.domain ? `（官方網址為 ${v.impersonating.domain}）` : ''}`);
  const rs = (v.reasons || []).filter((r) => r.weight > 0).slice(0, 4);
  if (rs.length) { lines.push('可疑原因：'); rs.forEach((r, i) => lines.push(`${i + 1}. ${r.text}`)); }
  lines.push('（由「官網守門員」LINE 機器人整理）');
  return clip(lines.join('\n'), 1000);
}

/** 傳給親友的提醒文字（網址拆開，不能直接點） */
export function shareText(v, botUrl) {
  const imp = v.impersonating;
  const lines = [
    `⚠ 提醒你：這個網址${v.level === 'danger' ? '很可能是詐騙' : '有可疑的地方'}${imp ? `（冒充「${imp.name}」）` : ''}，請不要點開、不要輸入任何資料。`,
    `可疑網址：${defang(v.registrable || v.host)}`,
  ];
  if (imp && imp.domain) lines.push(`真正的官方網址：${imp.domain}`);
  lines.push('有疑問請撥 165 反詐騙專線。');
  lines.push(botUrl ? `（官網守門員 LINE 機器人檢查結果。加好友就能檢查可疑訊息：${botUrl}）` : '（官網守門員 LINE 機器人檢查結果）');
  return lines.join('\n');
}
const lineShare = (text) => 'https://line.me/R/share?text=' + encodeURIComponent(text);

/** 一個網址的判斷結果卡片 */
export function verdictBubble(v, { botUrl = '' } = {}) {
  const level = COLOR[v.level] ? v.level : 'unknown';
  const imp = v.impersonating;
  const host = hostOf(v);
  const body = [];
  body.push({ type: 'box', layout: 'vertical', spacing: 'xs', contents: [
    t('網址', { size: 'xs', color: '#6B7280' }),
    t(host, { size: 'md', weight: 'bold', color: '#111827' }),
    ...(v.registrable && host !== v.registrable && host.endsWith(v.registrable) ? [t(`真正的網域是「${v.registrable}」`, { size: 'xs', color: '#6B7280' })] : []),
  ] });
  if (v.match && ['official', 'gov'].includes(level)) body.push(t(v.match.name, { size: 'sm', color: '#2E7D32', weight: 'bold' }));
  if (imp && WARN.has(level)) {
    body.push({ type: 'box', layout: 'vertical', backgroundColor: '#FFF4E5', cornerRadius: '8px', paddingAll: '10px', contents: [
      t(`看起來在冒充「${imp.name}」。`, { size: 'sm', weight: 'bold', color: '#7C2D12' }),
      t(imp.domain ? `真正的官方網址是 ${imp.domain}` : (imp.hint || '請改從官方網站或 App 查詢'), { size: 'sm', color: '#7C2D12' }),
    ] });
  }
  const reasons = (v.reasons || []).filter((r) => (WARN.has(level) ? r.weight > 0 : true)).slice(0, 3);
  if (reasons.length) {
    body.push({ type: 'box', layout: 'vertical', spacing: 'sm', contents: reasons.map((r) => ({ type: 'box', layout: 'baseline', spacing: 'sm', contents: [
      t('・', { size: 'sm', flex: 0, color: COLOR[level] }),
      t(r.text, { size: 'sm', color: '#374151', flex: 1 }),
    ] })) });
  }
  if (v.channels && v.channels.items && v.channels.items.length && WARN.has(level)) {
    body.push({ type: 'separator' });
    body.push(t(`${v.channels.topic}：請改用這些正確管道`, { size: 'sm', weight: 'bold', color: '#1F2937' }));
    for (const it of v.channels.items.slice(0, 4)) {
      body.push(it.url
        ? t(`→ ${it.name}`, { size: 'sm', color: '#1D4ED8', decoration: 'underline', action: { type: 'uri', label: clip(it.name, 40), uri: it.url } })
        : t(`→ ${it.name}`, { size: 'sm', color: '#374151' }));
    }
  }
  body.push(t(ADVICE[level], { size: 'xs', color: '#6B7280' }));

  const footer = [];
  if (WARN.has(level)) {
    footer.push(btn({ type: 'postback', label: '一鍵通報這個網址', data: packData('rep', 'scam', v.url, imp && imp.name), displayText: '一鍵通報' }, { style: 'primary', color: '#C62828' }));
    if (imp && imp.url) footer.push(btn({ type: 'uri', label: `前往${imp.name}官網`, uri: imp.url }, { style: 'secondary' }));
    footer.push(btn({ type: 'uri', label: '傳給親友提醒', uri: lineShare(shareText(v, botUrl)) }, { style: 'secondary' }));
    footer.push(btn({ type: 'postback', label: '這是正常網站？回報誤判', data: packData('rep', 'fp', v.url), displayText: '回報誤判' }, { style: 'link' }));
  } else if (level === 'unknown') {
    footer.push(btn({ type: 'postback', label: '這是詐騙？一鍵回報', data: packData('rep', 'miss', v.url), displayText: '回報這是詐騙' }, { style: 'secondary' }));
    footer.push(btn({ type: 'uri', label: '撥打 165 詢問', uri: 'tel:165' }, { style: 'link' }));
  }
  return {
    type: 'bubble',
    size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: COLOR[level], paddingAll: '14px', contents: [
      t(SEAL[level], { color: '#FFFFFF', weight: 'bold', size: 'lg' }),
      ...(v.via ? [t(`短網址 ${clip(v.via.replace(/^https?:\/\//, ''), 60)} 實際連到這裡`, { color: '#FFFFFFDD', size: 'xs' })] : []),
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '14px', contents: body },
    ...(footer.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer } } : {}),
  };
}

/** 卡片的通知文字（聊天列表、通知、舊版 LINE 顯示這段） */
export function altTextFor(r) {
  const v = r.items[0];
  if (!v) return '官網守門員檢查結果';
  const imp = v.impersonating;
  return clip(`${SEAL[v.level] || '檢查結果'}：${hostOf(v)}${imp && WARN.has(v.level) ? `（冒充${imp.name}）` : ''}${r.items.length > 1 ? `，共 ${r.items.length} 個網址` : ''}`, 400);
}

/** 一對一聊天：完整的檢查結果（最多 5 則訊息） */
export function resultMessages(r, { botUrl = '' } = {}) {
  const out = [];
  if (r.qr) {
    const lines = [`QR Code 內容：${clip(r.qr.text, 200)}`];
    for (const it of (r.qr.items || []).slice(0, 3)) if (it.display) lines.push(`・${it.display}`);
    if (r.qr.pay) lines.push('這是付款用的 QR Code。付款前請確認收款方是你要付錢的對象。');
    if (r.qr.crypto) lines.push('這是虛擬貨幣錢包地址。轉出後幾乎追不回來，陌生人要你轉幣，幾乎都是詐騙。');
    out.push({ type: 'text', text: clip(lines.join('\n'), 1000) });
  }
  if (r.items.length) {
    const bubbles = r.items.slice(0, 5).map((v) => verdictBubble(v, { botUrl }));
    out.push({ type: 'flex', altText: altTextFor(r), contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles } });
  }
  if (r.notes.length) {
    const head = r.items.length ? '這則訊息還有這些警訊：' : '訊息裡沒有網址，但有詐騙常見的話術：';
    out.push({ type: 'text', text: clip(`${head}\n${r.notes.slice(0, 5).map((n) => `・${n}`).join('\n')}\n\n不確定的話，請先撥 165 反詐騙專線確認。`, 2000) });
  } else if (r.noUrl && !r.qr) {
    out.push({ type: 'text', text: '這則訊息裡沒有找到網址，也沒有常見的詐騙話術。\n\n不過只要對方要你轉帳、提供驗證碼、或加 LINE 私下聯絡，都請先撥 165 確認。\n\n想檢查網址，可以把整則訊息（含連結）轉傳或貼給我。' });
  }
  if (!out.length) out.push({ type: 'text', text: '檢查完成，沒有發現問題。' });
  return withQuickReply(out.slice(0, 5));
}

/** 群組：只在有危險時出聲，先引用那則訊息說明，再附上結果卡片 */
export function groupWarning(r, { quoteToken, botUrl = '' } = {}) {
  const v = r.items.find((x) => WARN.has(x.level)) || r.items[0];
  const danger = r.overall === 'danger';
  const lines = [`⚠ 官網守門員提醒：這則訊息${danger ? '很可能是詐騙' : '有可疑的地方'}，請先不要點裡面的連結${danger ? '，也不要輸入任何資料' : ''}。`];
  if (v) {
    const reason = (v.reasons || []).find((x) => x.weight > 0);
    if (reason) lines.push(reason.text);
    if (v.impersonating && v.impersonating.domain) lines.push(`真正的官方網址：${v.impersonating.domain}`);
  } else if (r.notes.length) {
    lines.push(r.notes[0]);
  }
  lines.push('有疑問請撥 165。');
  const msgs = [{ type: 'text', text: clip(lines.join('\n'), 1000), ...(quoteToken ? { quoteToken } : {}) }];
  if (v && WARN.has(v.level)) msgs.push({ type: 'flex', altText: altTextFor({ items: [v] }), contents: verdictBubble(v, { botUrl }) });
  return msgs;
}

/** 按下「一鍵通報」之後：記錄結果＋兩步完成正式通報 */
export function reportReceived(kind, v, { stored, duplicate }) {
  const host = v.registrable || v.host || '';
  if (kind === 'fp') {
    return withQuickReply([{ type: 'text', text: duplicate
      ? `你之前已經回報過「${host}」被誤判了，謝謝！維護者確認後會修正。`
      : `謝謝你的回報！${stored ? '已經記錄下來，' : ''}維護者會確認「${host}」是不是被誤判，修正後所有使用者都會自動更新。` }]);
  }
  const intro = duplicate
    ? `你之前已經通報過「${host}」了，謝謝！`
    : stored
      ? `謝謝！「${host}」已經記錄下來。維護者會整理大家的通報，提供給 165 與網域管理單位。`
      : '謝謝你的通報！';
  const bubble = {
    type: 'bubble',
    size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#1F2937', paddingAll: '14px', contents: [t(duplicate ? '已經通報過了' : '已收到你的通報', { color: '#FFFFFF', weight: 'bold', size: 'lg' })] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '14px', contents: [
      t(intro, { size: 'sm', color: '#374151' }),
      t('要正式向政府通報，只要兩步：', { size: 'sm', weight: 'bold', color: '#111827' }),
      t('① 按「複製通報內容」\n② 按「開啟網詐通報查詢網」，在網頁上貼上送出', { size: 'sm', color: '#374151' }),
      t('已經被騙或付了錢，請立刻撥打 165 或 110。', { size: 'xs', color: '#B91C1C' }),
    ] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      btn({ type: 'clipboard', label: '① 複製通報內容', clipboardText: reportText(v) }, { style: 'primary', color: '#C62828' }),
      btn({ type: 'uri', label: '② 開啟網詐通報查詢網', uri: REPORT_URL }, { style: 'secondary' }),
      btn({ type: 'uri', label: '撥打 165 反詐騙專線', uri: 'tel:165' }, { style: 'link' }),
    ] },
  };
  return withQuickReply([
    { type: 'flex', altText: duplicate ? '已經通報過這個網址' : '已收到你的通報，兩步完成正式通報', contents: bubble },
    // 舊版 LINE（14.0 以前）不支援「複製」按鈕，附上同樣的內容讓使用者長按複製
    { type: 'text', text: `通報內容（也可以長按這段文字複製）：\n\n${reportText(v)}` },
  ]);
}

// ───────── 說明文字 ─────────

export function helpMessages({ botUrl = '', imageQr = false } = {}) {
  return withQuickReply([{ type: 'text', text: [
    '我是官網守門員，幫你檢查可疑的簡訊、LINE 訊息、Email 和網址，不用點開連結。',
    '',
    '【怎麼用】',
    '1. 手機簡訊：長按訊息 →「分享」或「轉寄」→ 選 LINE →「官網守門員」。iPhone 請長按 →「拷貝」，回到這裡貼上。',
    '2. LINE 訊息：長按訊息 →「分享」→ 選「官網守門員」。',
    '3. 只有網址也可以，直接貼給我。',
    imageQr ? '4. QR Code：截圖傳給我，我會解開 QR Code 檢查。' : '4. 我讀不到圖片裡的文字，截圖請改成複製文字貼給我。',
    '',
    '【保護家人】把我加進家族群組，有人貼出詐騙連結時我會自動提醒。',
    '',
    '檢查結果卡片上有「一鍵通報」，按了就會記錄，並教你兩步向政府通報。',
    botUrl ? `\n分享給親友：${botUrl}` : '',
    '有疑問請撥 165 反詐騙專線。',
  ].filter((x) => x !== '').join('\n') }]);
}

export function welcomeMessages(opts = {}) {
  return [{ type: 'text', text: '謝謝你加我好友！收到可疑的簡訊或訊息，轉傳給我就能檢查。' }, ...helpMessages(opts)];
}

export function privacyMessages() {
  return withQuickReply([{ type: 'text', text: [
    '【隱私說明】',
    '・你傳給我的訊息只用來檢查，檢查完就丟掉，不會儲存，也不會給任何人看。',
    '・在群組裡，我讀取訊息只為了找連結，同樣不儲存。',
    '・你按「一鍵通報」或「回報誤判」時，只記錄網址（不含查詢參數）和次數，用來整理給 165 與修正判斷；不會記錄你是誰（只存無法還原的代號，避免重複計算）。',
    '・遇到短網址時，我只向短網址服務詢問它會轉到哪裡，不會打開最後的網站。',
    `完整說明：${PRIVACY_URL}`,
  ].join('\n') }]);
}

export function howToReportMessages() {
  const bubble = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '14px', contents: [
      t('怎麼通報詐騙', { weight: 'bold', size: 'lg', color: '#111827' }),
      t('把可疑的訊息或網址轉傳給我，檢查結果卡片上有「一鍵通報」：按一下就會記錄，並幫你準備好通報內容。', { size: 'sm', color: '#374151' }),
      t('也可以直接到政府的網詐通報查詢網通報，或撥打 165 反詐騙專線。', { size: 'sm', color: '#374151' }),
      t('已經被騙或付了錢，請立刻撥打 165 或 110，並保留對話紀錄與轉帳證明。', { size: 'xs', color: '#B91C1C' }),
    ] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      btn({ type: 'uri', label: '開啟網詐通報查詢網', uri: REPORT_URL }, { style: 'primary', color: '#C62828' }),
      btn({ type: 'uri', label: '撥打 165 反詐騙專線', uri: 'tel:165' }, { style: 'secondary' }),
    ] },
  };
  return withQuickReply([{ type: 'flex', altText: '怎麼通報詐騙', contents: bubble }]);
}

export function groupHowToMessages({ botUrl = '' } = {}) {
  return withQuickReply([{ type: 'text', text: [
    '【把我加進家族群組】',
    '1. 打開家族群組，點右上角的選單 →「邀請」。',
    '2. 在好友清單選「官網守門員」。',
    '',
    '加入後，群組裡有人貼出很可能是詐騙的連結，我會引用那則訊息提醒大家。平常不會說話，訊息也不會被儲存。',
    '群組裡輸入「守門員 說明」可以看設定方式。',
    botUrl ? `\n也可以把這個連結傳給家人，請他們加我好友：${botUrl}` : '',
  ].filter((x) => x !== '').join('\n') }]);
}

export function groupJoinMessages() {
  return [{ type: 'text', text: [
    '大家好，我是官網守門員 🛡',
    '我會自動檢查群組裡分享的連結，只有在「很可能是詐騙」時才會引用那則訊息提醒，平常不會打擾。',
    '',
    '・訊息只在檢查當下讀取，不會儲存。',
    '・輸入「守門員 說明」看所有指令。',
    '・不想要自動檢查，輸入「守門員 關閉」。',
  ].join('\n') }];
}

export function groupHelpMessages(settings) {
  const now = settings.mode === 'off' ? '已關閉自動檢查' : settings.level === 'all' ? '自動檢查，可疑的也提醒' : '自動檢查，只提醒很可能是詐騙的';
  return [{ type: 'text', text: [
    '【官網守門員群組指令】',
    '・守門員 檢查 <訊息或網址>：檢查一段內容',
    '・守門員 全部：可疑的連結也提醒',
    '・守門員 只提醒危險：只提醒很可能是詐騙的（預設）',
    '・守門員 關閉：停止自動檢查（還是可以用「守門員 檢查」）',
    '・守門員 開啟：恢復自動檢查',
    '・守門員 隱私：隱私說明',
    '',
    `目前設定：${now}`,
  ].join('\n') }];
}

export function groupSettingChanged(settings) {
  const text = settings.mode === 'off'
    ? '好的，我先不自動檢查了。需要時輸入「守門員 檢查」加上訊息或網址。'
    : settings.level === 'all'
      ? '好的，之後可疑的連結我也會提醒。'
      : '好的，我只會在很可能是詐騙時提醒。';
  return [{ type: 'text', text }];
}

export function imageMessages({ enabled, found }) {
  const text = !enabled
    ? '我目前讀不到圖片裡的內容。請長按訊息選「複製」後貼給我，或把網址直接傳給我。'
    : found === false
      ? '圖片裡找不到 QR Code。我讀不到圖片裡的文字，請把訊息文字複製貼給我。'
      : '圖片太大或格式不支援。請改傳截圖，或把訊息文字複製貼給我。';
  return withQuickReply([{ type: 'text', text }]);
}

export function rateLimitedMessages() {
  return [{ type: 'text', text: '訊息有點多，請稍等一分鐘再傳給我。' }];
}

export function errorMessages() {
  return withQuickReply([{ type: 'text', text: '抱歉，檢查時出了問題。請稍後再試，或改用手機檢查網頁：' + WEB_URL }]);
}

// ───────── 快速回覆 ─────────
const qr = (action) => ({ type: 'action', action: { ...action, label: clip(action.label, 20) } });
export function quickReply() {
  return { items: [
    qr({ type: 'message', label: '怎麼轉傳訊息給我', text: '說明' }),
    qr({ type: 'postback', label: '怎麼通報詐騙', data: 'a=howrep', displayText: '怎麼通報詐騙？' }),
    qr({ type: 'uri', label: '撥打 165', uri: 'tel:165' }),
    qr({ type: 'postback', label: '保護家人群組', data: 'a=group', displayText: '怎麼保護家人群組？' }),
    qr({ type: 'message', label: '隱私說明', text: '隱私' }),
  ] };
}
/** 把快速回覆加在最後一則訊息上（LINE 只顯示最後一則的快速回覆） */
export function withQuickReply(msgs) {
  if (!msgs.length) return msgs;
  const last = { ...msgs[msgs.length - 1], quickReply: quickReply() };
  return [...msgs.slice(0, -1), last];
}
