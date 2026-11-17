// 官網守門員 LINE 機器人（Cloudflare Worker）
//
//   POST /webhook        LINE 平台送來的事件（訊息、按鈕、加好友、加入群組…），先驗證簽章
//   GET  /               健康檢查：判斷引擎版本、涉詐清單更新時間
//   GET  /api/reports    通報彙整（需要 Authorization: Bearer <REPORTS_TOKEN>），給每週自動開 Issue 用
//
// 環境變數（wrangler secret put …）：
//   LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN  必填，LINE Developers 後台取得
//   REPORTS_TOKEN                                   選填，設定後才開放 /api/reports
//   BOT_ADD_URL                                     選填，官方帳號的加好友連結（https://lin.ee/… 或 https://line.me/R/ti/p/@…）
//   IMAGE_QR                                        選填，on＝解讀圖片裡的 QR Code（需要 Workers 付費方案）
// KV 綁定 OUG_KV：選填，記錄通報與群組設定。
import { checkText, checkQr, checkUrl, buildResult } from './analyze.js';
import { verifySignature, hashId, reply, startLoading, getContent } from './line-api.js';
import { qrFromImage } from './image.js';
import * as M from './messages.js';
import { recordReport, listReports, getGroupSettings, setGroupSettings, forgetGroup, allow } from './store.js';
import { BUILT_AT, ENGINE_VERSION, FEED_GENERATED_AT, BLOCKLIST } from './generated/data.js';

// 啟動時先把判斷與訊息卡片的程式跑一遍，讓第一則真正的訊息不用等程式編譯。
// Workers 免費方案每個請求只有 10 毫秒 CPU，但啟動時有 1 秒，這段算在啟動時間裡。
(function warmUp() {
  for (const text of ['【監理服務網】您有罰鍰逾期未繳，請至 https://www.mvdis.gov.tw.pay-fine.top/login 繳納', '本期統一發票中獎號碼 https://www.einvoice.nat.gov.tw/', '把驗證碼傳給我', '晚點回家']) {
    const r = buildResult(text);
    JSON.stringify(M.resultMessages(r, {}));
    JSON.stringify(M.groupWarning(r, { quoteToken: 'q' }));
    if (r.items[0]) JSON.stringify(M.reportReceived('scam', checkUrl(r.items[0].url, '監理服務網'), { stored: true, duplicate: false }));
  }
  M.helpMessages({});
  new URLSearchParams('a=rep&k=scam&u=x');
})();

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const URLISH = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}\b)/i;
const BOT_CALL = /^\s*(?:@?官網守門員|守門員)\s*[:：,，]?\s*/;

const isCmd = (text, re) => re.test(text.trim().replace(/[!！?？。.~～\s]+$/, ''));
const CMD = {
  help: /^(說明|使用說明|怎麼用|教學|help|選單|menu|\?|？)$/i,
  privacy: /^(隱私|隱私說明|隱私權|privacy)$/i,
  report: /^(通報|怎麼通報|如何通報|檢舉|165)$/,
  group: /^(群組|保護家人|家族群組|加入群組)$/,
  thanks: /^(謝謝|感謝|謝啦|3q|thanks?|thank you|好|好的|ok|okay|收到|了解|嗨|你好|哈囉|hi|hello)$/i,
};

/** 這個 Worker 的設定，給訊息內容用 */
const opts = (env) => ({ botUrl: env.BOT_ADD_URL || '', imageQr: env.IMAGE_QR === 'on' });
/** 群組裡不顯示快速回覆（每個人都會看到） */
const noQuick = (msgs) => msgs.map(({ quickReply, ...m }) => m);

async function handleText(event, env) {
  const text = String(event.message.text || '');
  const src = event.source || {};
  const inGroup = src.type === 'group' || src.type === 'room';

  if (!inGroup) {
    if (isCmd(text, CMD.help)) return M.helpMessages(opts(env));
    if (isCmd(text, CMD.privacy)) return M.privacyMessages();
    if (isCmd(text, CMD.report)) return M.howToReportMessages();
    if (isCmd(text, CMD.group)) return M.groupHowToMessages(opts(env));
    if (isCmd(text, CMD.thanks)) return M.withQuickReply([{ type: 'text', text: '不客氣！收到可疑的簡訊或訊息，隨時轉傳給我檢查。' }]);
    const r = await checkText(text);
    return M.resultMessages(r, opts(env));
  }

  // ───── 群組、多人聊天 ─────
  const groupKey = await hashId(env.LINE_CHANNEL_SECRET, src.groupId || src.roomId);
  const selfMentions = ((event.message.mention && event.message.mention.mentionees) || []).filter((m) => m.isSelf && Number.isInteger(m.index));
  const called = BOT_CALL.test(text);
  if (called || selfMentions.length) {
    // 拿掉「@官網守門員」（依 LINE 給的位置，從後面往前刪，不影響訊息裡其他的 @帳號）
    let stripped = text;
    for (const m of [...selfMentions].sort((a, b) => b.index - a.index)) stripped = stripped.slice(0, m.index) + stripped.slice(m.index + m.length);
    const rest = stripped.replace(BOT_CALL, '').trim();
    const settings = await getGroupSettings(env, groupKey);
    if (!rest || isCmd(rest, CMD.help)) return M.groupHelpMessages(settings);
    if (/^(關閉|安靜|停止|暫停)$/.test(rest)) return M.groupSettingChanged(await setGroupSettings(env, groupKey, { mode: 'off' }));
    if (/^(開啟|啟動|恢復|打開)$/.test(rest)) return M.groupSettingChanged(await setGroupSettings(env, groupKey, { mode: 'on' }));
    if (/^(全部|全部提醒|可疑也提醒)$/.test(rest)) return M.groupSettingChanged(await setGroupSettings(env, groupKey, { mode: 'on', level: 'all' }));
    if (/^(只提醒危險|只有危險|預設)$/.test(rest)) return M.groupSettingChanged(await setGroupSettings(env, groupKey, { mode: 'on', level: 'danger' }));
    if (isCmd(rest, CMD.privacy)) return noQuick(M.privacyMessages());
    const target = rest.replace(/^(檢查|查|幫我看|看看)\s*/, '');
    if (!target) return [{ type: 'text', text: '請在「守門員 檢查」後面貼上訊息或網址。' }];
    return noQuick(M.resultMessages(await checkText(target), opts(env)));
  }

  const settings = await getGroupSettings(env, groupKey);
  if (settings.mode === 'off') return null;
  // 只提醒危險時，沒有網址的訊息不用檢查（話術類的警訊最多是「可疑」）
  if (settings.level !== 'all' && !URLISH.test(text)) return null;
  if (!URLISH.test(text) && text.length < 15) return null;
  const r = await checkText(text);
  const hit = r.overall === 'danger' || (settings.level === 'all' && (r.overall === 'caution' || r.overall === 'platform'));
  return hit ? M.groupWarning(r, { quoteToken: event.message.quoteToken, botUrl: opts(env).botUrl }) : null;
}

async function handleImage(event, env) {
  const src = event.source || {};
  if (src.type !== 'user') return null; // 群組裡的照片不讀（多半是家人的照片）
  if (env.IMAGE_QR !== 'on') return M.imageMessages({ enabled: false });
  await startLoading(env, src.userId, 20);
  const bytes = await getContent(env, event.message.id);
  if (!bytes) return M.imageMessages({ enabled: true });
  const q = await qrFromImage(bytes);
  if (!q.ok) return M.imageMessages({ enabled: true });
  if (!q.text) return M.imageMessages({ enabled: true, found: false });
  return M.resultMessages(await checkQr(q.text), opts(env));
}

async function handlePostback(event, env) {
  const p = new URLSearchParams(event.postback.data || '');
  const src = event.source || {};
  const inGroup = src.type !== 'user';
  const fix = (msgs) => (inGroup ? noQuick(msgs) : msgs);
  switch (p.get('a')) {
    case 'rep': {
      const kind = ['scam', 'fp', 'miss'].includes(p.get('k')) ? p.get('k') : 'scam';
      const url = p.get('u') || '';
      const v = checkUrl(url, p.get('c') || '');
      if (v.level === 'invalid') return fix([{ type: 'text', text: '這個網址看不懂，沒辦法通報。' }]);
      const userKey = await hashId(env.LINE_CHANNEL_SECRET, src.userId || src.groupId || src.roomId || '');
      const domain = v.registrable || v.host;
      const res = await recordReport(env, { kind, url: v.url, domain, level: v.level, userKey });
      return fix(M.reportReceived(kind, v, res));
    }
    case 'howrep': return fix(M.howToReportMessages());
    case 'group': return fix(M.groupHowToMessages(opts(env)));
    case 'help': return fix(M.helpMessages(opts(env)));
    case 'privacy': return fix(M.privacyMessages());
    default: return null;
  }
}

async function handleEvent(event, env) {
  const src = event.source || {};
  const who = src.userId || src.groupId || src.roomId || 'anon';
  switch (event.type) {
    case 'message': {
      const inGroup = src.type !== 'user';
      // 頻率限制：一對一每人每分鐘 20 則，群組每群每分鐘 60 則
      if (!allow(inGroup ? `g:${src.groupId || src.roomId}` : `u:${who}`, inGroup ? 60 : 20)) return inGroup ? null : M.rateLimitedMessages();
      if (event.message.type === 'text') return handleText(event, env);
      if (event.message.type === 'image') return handleImage(event, env);
      if (inGroup) return null;
      return M.withQuickReply([{ type: 'text', text: '請把可疑的簡訊、LINE 訊息或網址「文字」傳給我，我就能幫你檢查。' }]);
    }
    case 'postback':
      if (!allow(`p:${who}`, 20)) return null;
      return handlePostback(event, env);
    case 'follow': return M.welcomeMessages(opts(env));
    case 'join': return M.groupJoinMessages();
    case 'leave': {
      // 被移出群組：刪掉這個群組的設定
      await forgetGroup(env, await hashId(env.LINE_CHANNEL_SECRET, src.groupId || src.roomId));
      return null;
    }
    default: return null;
  }
}

async function webhook(request, env) {
  const body = await request.text();
  if (!(await verifySignature(env.LINE_CHANNEL_SECRET, body, request.headers.get('x-line-signature')))) {
    return new Response('invalid signature', { status: 401 });
  }
  let payload;
  try { payload = JSON.parse(body); } catch { return new Response('bad request', { status: 400 }); }
  const events = Array.isArray(payload.events) ? payload.events : [];
  // LINE 後台的「Verify」只送空的 events；一律回 200，避免 LINE 重送
  await Promise.allSettled(events.map(async (event) => {
    let msgs = null;
    try {
      msgs = await handleEvent(event, env);
    } catch (e) {
      console.error('處理事件失敗', event.type, e && e.stack);
      if (event.source && event.source.type === 'user' && event.replyToken) msgs = M.errorMessages();
    }
    if (msgs && msgs.length && event.replyToken) {
      try { await reply(env, event.replyToken, msgs); } catch (e) { console.error('回覆失敗', e && e.message); }
    }
  }));
  return new Response('OK');
}

/** 固定時間比較兩個字串 */
function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && ['/', '/webhook', '/callback'].includes(url.pathname)) return webhook(request, env);
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, name: '官網守門員 LINE 機器人', engine: ENGINE_VERSION, builtAt: BUILT_AT, feedGeneratedAt: FEED_GENERATED_AT, blocklist: BLOCKLIST.length, reports: Boolean(env.OUG_KV), imageQr: env.IMAGE_QR === 'on' });
    }
    if (request.method === 'GET' && url.pathname === '/api/reports') {
      if (!env.REPORTS_TOKEN) return new Response('not found', { status: 404 });
      const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!sameSecret(auth, env.REPORTS_TOKEN)) return new Response('unauthorized', { status: 401 });
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
      return json({ generatedAt: new Date().toISOString(), days, reports: await listReports(env, { days }) });
    }
    return new Response('not found', { status: 404 });
  },
};
