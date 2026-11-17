// LINE Messaging API 的最小封裝（不使用 SDK，Worker 打包比較小）。
// 參考：https://developers.line.biz/en/reference/messaging-api/

const enc = new TextEncoder();

/** API 網址可以用環境變數覆寫，測試時指向本機的模擬伺服器 */
const apiBase = (env) => env.LINE_API_BASE || 'https://api.line.me';
const dataBase = (env) => env.LINE_DATA_API_BASE || env.LINE_API_BASE || 'https://api-data.line.me';

/** 驗證 x-line-signature：用 Channel secret 對原始內容做 HMAC-SHA256，再轉 base64 */
export async function verifySignature(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof rawBody === 'string' ? enc.encode(rawBody) : rawBody));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  const expected = btoa(bin);
  // 固定時間比較，避免從回應時間猜出簽章
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** 使用者代號只存雜湊（拿不回原本的 LINE 使用者 ID）。用 Channel secret 當鑰匙，別人無法用公開的 ID 反查 */
export async function hashId(secret, id) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret || 'oug')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(String(id || ''))));
  return [...mac.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function call(env, url, init, fetchImpl) {
  const res = await (fetchImpl || fetch)(url, {
    ...init,
    headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`LINE API ${res.status}: ${detail.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** 回覆訊息（一次最多 5 則；回覆不計入官方帳號的訊息則數） */
export async function reply(env, replyToken, messages, fetchImpl) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).slice(0, 5);
  if (!replyToken || !list.length) return null;
  return call(env, `${apiBase(env)}/v2/bot/message/reply`, { method: 'POST', body: JSON.stringify({ replyToken, messages: list }) }, fetchImpl);
}

/** 在一對一聊天顯示「輸入中」動畫（讀圖片時用；群組不支援） */
export async function startLoading(env, userId, seconds = 10, fetchImpl) {
  if (!userId) return null;
  return call(env, `${apiBase(env)}/v2/bot/chat/loading/start`, { method: 'POST', body: JSON.stringify({ chatId: userId, loadingSeconds: seconds }) }, fetchImpl).catch(() => null);
}

/** 下載使用者傳來的圖片（最多 maxBytes） */
export async function getContent(env, messageId, maxBytes = 6e6, fetchImpl) {
  const res = await call(env, `${dataBase(env)}/v2/bot/message/${encodeURIComponent(messageId)}/content`, { method: 'GET' }, fetchImpl);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) { try { await res.body?.cancel(); } catch { /* 忽略 */ } return null; }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.length > maxBytes ? null : buf;
}

/** 設定 Webhook 網址與測試（部署設定程式用） */
export async function setWebhook(env, endpoint, fetchImpl) {
  await call(env, `${apiBase(env)}/v2/bot/channel/webhook/endpoint`, { method: 'PUT', body: JSON.stringify({ endpoint }) }, fetchImpl);
  const res = await call(env, `${apiBase(env)}/v2/bot/channel/webhook/test`, { method: 'POST', body: JSON.stringify({ endpoint }) }, fetchImpl);
  return res.json();
}

/** 驗證訊息格式（部署後檢查卡片格式有沒有被 LINE 接受） */
export async function validateReply(env, messages, fetchImpl) {
  return call(env, `${apiBase(env)}/v2/bot/message/validate/reply`, { method: 'POST', body: JSON.stringify({ messages }) }, fetchImpl);
}
