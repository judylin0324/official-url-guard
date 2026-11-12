// 訊息網站轉接設定：一個網站一筆，告訴 content.js「這個網站的信件／訊息內容放在哪裡」。
//
// 網站改版導致沒有顯示警告時，只需要修改這裡的選擇器（selector），不用動判斷邏輯。
// 這個檔案是一般的內容指令碼（不是 ES module），在 manifest.json 裡排在 content.js 前面載入，
// 用 globalThis.OUG_MESSAGE_SITES 把設定交給 content.js；測試則直接 import 這個檔案。
//
// kind: 'mail' 網頁信箱（一次開一封信）
//   body       信件內文的選擇器
//   container  (內文元素) → 包住寄件人資訊的外層元素
//   sender     (外層元素) → { name, address } 或 null
//   subject    () → 主旨文字
//
// kind: 'chat' 簡訊與通訊軟體網頁版（畫面上同時有很多則訊息）
//   message    每一則訊息文字的選擇器（選到巢狀元素時，只取最外層）
//   incoming   (訊息元素) → 是不是對方傳來的；自己送出的訊息不檢查。省略＝全部檢查
//   path       只在符合的網址路徑啟用（例如 facebook.com 只看 /messages/）。省略＝整個網站
//
// ⚠ 這些選擇器是依各網站公開的版面結構撰寫，開發時只能用模擬頁面測試（無法登入真實帳號）。
//   每個轉接設定都有對應的模擬頁面測試（test/adapters.test.mjs、test/e2e.mjs）。
(() => {
  const EMAIL_RE = /[\w.+-]+@(?:[\w-]+\.)+[a-z]{2,}/i;
  const pick = (root, sel) => (root && root.querySelector(sel)) || null;
  const emailFrom = (el, attrs) => {
    if (!el) return null;
    for (const a of attrs) {
      const v = el.getAttribute(a);
      const m = v && v.match(EMAIL_RE);
      if (m) return { name: (el.getAttribute('name') || el.textContent || '').trim().slice(0, 80), address: m[0] };
    }
    const m = (el.textContent || '').match(EMAIL_RE);
    return m ? { name: '', address: m[0] } : null;
  };

  const SITES = [
    // ───────── 網頁信箱 ─────────
    {
      id: 'gmail', name: 'Gmail', kind: 'mail',
      host: /^mail\.google\.com$/,
      body: 'div.a3s',
      container: (b) => b.closest('.adn, .gs, .h7') || b.parentElement,
      sender: (c) => emailFrom(pick(c, 'span.gD[email], span[email]'), ['email']),
      subject: () => (pick(document, 'h2.hP') || {}).textContent || '',
    },
    {
      id: 'outlook', name: 'Outlook', kind: 'mail',
      host: /^outlook\.(live|office|office365)\.com$/,
      body: 'div[aria-label="Message body"], div[aria-label="郵件內文"], div[aria-label="郵件本文"], div[aria-label="訊息本文"], div[aria-label="メッセージ本文"]',
      container: (b) => b.closest('[data-app-section="ReadingPane"], [role="main"], [role="region"]') || b.parentElement,
      sender: (c) => emailFrom(pick(c, '[title*="@"], [aria-label*="@"]'), ['title', 'aria-label']),
      subject: () => (pick(document, '[role="main"] [role="heading"]') || {}).textContent || '',
    },
    {
      id: 'yahoo', name: 'Yahoo 信箱', kind: 'mail',
      host: /^(mail\.yahoo\.com|tw\.mail\.yahoo\.com|mail\.yahoo\.co\.jp)$/,
      body: '[data-test-id="message-view-body-content"], .msg-body',
      container: (b) => b.closest('[data-test-id="message-view"]') || b.parentElement,
      sender: (c) => emailFrom(pick(c, '[data-test-id="message-from"] [title*="@"], [data-test-id="email-pill"]'), ['title']),
      subject: () => (pick(document, '[data-test-id="message-group-subject-text"]') || {}).textContent || '',
    },

    // ───────── 簡訊與通訊軟體網頁版 ─────────
    {
      // Google 訊息網頁版：把 Android 手機的簡訊同步到電腦瀏覽器（messages.google.com/web）
      id: 'google-messages', name: 'Google 訊息（簡訊）', kind: 'chat',
      host: /^messages\.google\.com$/,
      message: 'mws-text-message-part, mws-message-part-content, [data-e2e-message-text-content]',
      incoming: (el) => !el.closest('.outgoing, [is-outgoing="true"], [data-e2e-is-outgoing="true"]'),
    },
    {
      id: 'messenger', name: 'Messenger', kind: 'chat',
      host: /^(www\.messenger\.com|www\.facebook\.com)$/,
      path: (hostname, pathname) => hostname === 'www.messenger.com' || /^\/messages(\/|$)/.test(pathname),
      message: '[role="grid"] [role="row"] div[dir="auto"], [role="main"] [role="row"] div[dir="auto"]',
    },
    {
      id: 'telegram', name: 'Telegram 網頁版', kind: 'chat',
      host: /^web\.telegram\.org$/,
      message: '.bubble .message, .Message .text-content',
      incoming: (el) => !el.closest('.is-out, .own'),
    },
    {
      id: 'whatsapp', name: 'WhatsApp 網頁版', kind: 'chat',
      host: /^web\.whatsapp\.com$/,
      message: '.message-in .copyable-text .selectable-text, .message-in .selectable-text.copyable-text',
    },
  ];

  /** 找出目前網址對應的轉接設定（沒有就回傳 null） */
  const findSite = (hostname, pathname = '/') =>
    SITES.find((s) => s.host.test(hostname) && (!s.path || s.path(hostname, pathname))) || null;

  /** 巢狀元素只留最外層，避免同一則訊息檢查兩次 */
  const outermost = (els) => els.filter((el) => !els.some((other) => other !== el && other.contains(el)));

  globalThis.OUG_MESSAGE_SITES = SITES;
  globalThis.OUG_findMessageSite = findSite;
  globalThis.OUG_outermost = outermost;
})();
