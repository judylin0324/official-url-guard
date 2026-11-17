// LINE 機器人（line-bot/）：用模擬的 LINE 平台與 KV 跑 Worker，檢查回覆內容、一鍵通報、群組行為與訊息格式限制
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeQr, toRgba, toPng } from './qr-encode.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['tools/build-line-bot.mjs'], { cwd: root, stdio: 'ignore' });
const { default: worker } = await import('../line-bot/src/worker.js');
const store = await import('../line-bot/src/store.js');
const { packData, reportText, REPORT_URL } = await import('../line-bot/src/messages.js');
const { decodePng } = await import('../line-bot/src/png.js');

const SECRET = 'test-channel-secret';

function kvMock() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); if (!v) return null; return type === 'json' ? JSON.parse(v.value) : v.value; },
    async put(k, value, o = {}) { m.set(k, { value: String(value), metadata: o.metadata, ttl: o.expirationTtl }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).metadata })), list_complete: true }; },
  };
}

// ───── 模擬 LINE 平台與網路 ─────
const replies = []; // 每次回覆 { replyToken, messages }
const requests = []; // 所有對外連線
let replyStatus = 200;
let imageBytes = null;
const SHORT = { 'https://reurl.cc/aBc123': 'https://www.mvdis.gov.tw.pay-fine.top/login', 'https://bit.ly/ok-post': 'https://www.post.gov.tw/post/internet/Postal/index.jsp' };
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  requests.push({ url, init });
  if (url.endsWith('/v2/bot/message/reply')) {
    replies.push(JSON.parse(init.body));
    return new Response('{}', { status: replyStatus });
  }
  if (url.includes('/v2/bot/chat/loading/start')) return new Response('{}', { status: 202 });
  if (/\/v2\/bot\/message\/[^/]+\/content$/.test(url)) return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } });
  if (SHORT[url]) return new Response('', { status: 301, headers: { location: SHORT[url] } });
  return new Response('not found', { status: 404 });
};

const env = () => ({ LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'test-token', REPORTS_TOKEN: 'reports-secret', BOT_ADD_URL: 'https://lin.ee/testbot', OUG_KV: kvMock() });
let seq = 0;
const user = (id = 'Uaaaaaaaaaaaaaaaa') => ({ type: 'user', userId: id });
const group = (gid = 'Cgroup1', uid = 'Ubbbbbbbbbbbbbbbb') => ({ type: 'group', groupId: gid, userId: uid });
const textEvent = (text, source = user(), extra = {}) => ({ type: 'message', mode: 'active', timestamp: Date.now(), source, replyToken: `rt${++seq}`, webhookEventId: `ev${seq}`, deliveryContext: { isRedelivery: false }, message: { type: 'text', id: `m${seq}`, text, quoteToken: `qt${seq}`, ...extra } });
const postbackEvent = (data, source = user()) => ({ type: 'postback', timestamp: Date.now(), source, replyToken: `rt${++seq}`, postback: { data } });

async function post(events, e, { signature } = {}) {
  const body = JSON.stringify({ destination: 'Ubot', events });
  const sig = signature ?? createHmac('sha256', SECRET).update(body).digest('base64');
  return worker.fetch(new Request('https://bot.example/webhook', { method: 'POST', headers: { 'x-line-signature': sig, 'content-type': 'application/json' }, body }), e);
}
/** 送一個事件，回傳這次的回覆訊息（沒回覆就是 null） */
async function send(event, e) {
  const before = replies.length;
  const res = await post([event], e);
  assert.equal(res.status, 200);
  assert.ok(replies.length - before <= 1);
  return replies.length > before ? replies[replies.length - 1].messages : null;
}
const walk = (node, fn) => { if (Array.isArray(node)) node.forEach((x) => walk(x, fn)); else if (node && typeof node === 'object') { fn(node); Object.values(node).forEach((x) => walk(x, fn)); } };
const actionsOf = (msgs) => { const out = []; walk(msgs, (n) => { if (n.type === 'button' && n.action) out.push(n.action); }); return out; };
const textsOf = (msgs) => { const out = []; walk(msgs, (n) => { if (typeof n.text === 'string') out.push(n.text); }); return out.join('\n'); };

const SCAM_SMS = '【監理服務網】您有一筆交通違規罰鍰逾期未繳，請於今日內至 https://mvdis-gov-tw.cc/pay 繳納，以免加重處罰。';

test('LINE 機器人：簽章錯誤拒絕；LINE 後台的 Verify（空事件）回 200', async () => {
  const e = env();
  assert.equal((await post([textEvent('hi')], e, { signature: 'bad' })).status, 401);
  assert.equal((await post([textEvent('hi')], e, { signature: '' })).status, 401);
  const before = replies.length;
  assert.equal((await post([], e)).status, 200);
  assert.equal(replies.length, before);
});

test('LINE 機器人：轉傳假監理站簡訊 → 危險卡片，有一鍵通報、前往官網、傳給親友、回報誤判', async () => {
  const msgs = await send(textEvent(SCAM_SMS), env());
  const flex = msgs.find((m) => m.type === 'flex');
  assert.ok(flex, '要有結果卡片');
  assert.match(flex.altText, /高度疑似詐騙：mvdis-gov-tw\.cc（冒充監理服務網/);
  assert.match(textsOf(flex), /真正的官方網址是 mvdis\.gov\.tw/);
  const acts = actionsOf(flex);
  const rep = acts.find((a) => a.type === 'postback' && a.data.startsWith('a=rep&k=scam'));
  assert.ok(rep && rep.displayText === '一鍵通報');
  assert.ok(acts.some((a) => a.type === 'uri' && /mvdis\.gov\.tw/.test(a.uri) && /官網/.test(a.label)));
  const share = acts.find((a) => a.type === 'uri' && a.uri.startsWith('https://line.me/R/share?text='));
  const shareText = decodeURIComponent(share.uri.split('text=')[1]);
  assert.match(shareText, /mvdis-gov-tw\[\.\]cc/, '分享給親友的網址要拆開，避免誤點');
  assert.match(shareText, /lin\.ee\/testbot/);
  assert.ok(acts.some((a) => a.type === 'postback' && a.data.startsWith('a=rep&k=fp')));
  assert.ok(msgs[msgs.length - 1].quickReply.items.length >= 3, '最後一則訊息附快速回覆');
});

test('LINE 機器人：一般訊息、官方網址、說明與隱私指令', async () => {
  const e = env();
  assert.match(textsOf(await send(textEvent('媽，我今天會晚一點回家，晚餐不用等我'), e)), /沒有找到網址/);
  const official = await send(textEvent('本期統一發票中獎號碼已公布，請到 https://www.einvoice.nat.gov.tw/ 查詢。'), e);
  assert.match(textsOf(official), /✓ (官方網站|政府／學術網域)/);
  assert.ok(!actionsOf(official).some((a) => a.type === 'postback' && /k=scam/.test(a.data)), '官方網站不顯示通報按鈕');
  assert.match(textsOf(await send(textEvent('說明'), e)), /怎麼用[\s\S]*轉寄/);
  assert.match(textsOf(await send(textEvent('隱私'), e)), /不會儲存/);
  assert.match(textsOf(await send(textEvent('謝謝！'), e)), /不客氣/);
  const howRep = await send(textEvent('通報'), e);
  assert.ok(actionsOf(howRep).some((a) => a.uri === REPORT_URL));
  assert.ok(actionsOf(howRep).some((a) => a.uri === 'tel:165'));
});

test('LINE 機器人：沒有網址但要你交出驗證碼 → 提醒話術', async () => {
  assert.match(textsOf(await send(textEvent('我手機壞了，等一下會有驗證碼傳到你手機，收到後把驗證碼傳給我'), env())), /驗證碼/);
});

test('LINE 機器人：短網址先問出真正的目的地再判斷（不連到目的地網站）', async () => {
  requests.length = 0;
  const msgs = await send(textEvent('[臺北市停車管理工程處] 您的車輛停車費尚未繳納，請盡速繳費 https://reurl.cc/aBc123'), env());
  const flex = msgs.find((m) => m.type === 'flex');
  assert.match(flex.altText, /高度疑似詐騙/);
  assert.match(textsOf(flex), /www\.mvdis\.gov\.tw\.pay-fine\.top/);
  assert.match(textsOf(flex), /短網址 reurl\.cc\/aBc123 實際連到這裡/);
  const shortReq = requests.find((r) => r.url === 'https://reurl.cc/aBc123');
  assert.equal(shortReq.init.redirect, 'manual');
  assert.ok(!requests.some((r) => r.url.includes('pay-fine.top')), '不能連到詐騙網站');
  // 轉到官方網站的短網址
  const ok = await send(textEvent('包裹查詢 https://bit.ly/ok-post'), env());
  assert.match(textsOf(ok), /✓ (官方網站|政府／學術網域)/);
});

test('LINE 機器人：一鍵通報 → 記錄網域（不存使用者 ID）、複製通報內容、開啟網詐通報網；同一人重複不重算', async () => {
  const e = env();
  const card = await send(textEvent(SCAM_SMS), e);
  const data = actionsOf(card).find((a) => a.type === 'postback' && a.data.startsWith('a=rep&k=scam')).data;
  const r1 = await send(postbackEvent(data, user('Uuser1')), e);
  const acts = actionsOf(r1);
  const copy = acts.find((a) => a.type === 'clipboard');
  assert.ok(copy && copy.clipboardText.length <= 1000);
  assert.match(copy.clipboardText, /【可疑詐騙網址通報】[\s\S]*mvdis-gov-tw\.cc[\s\S]*疑似冒充：監理服務網/);
  assert.ok(acts.some((a) => a.type === 'uri' && a.uri === REPORT_URL));
  assert.ok(acts.some((a) => a.uri === 'tel:165'));
  assert.match(textsOf(r1), /已經記錄下來/);
  assert.match(textsOf(r1), /通報內容（也可以長按這段文字複製）/, '舊版 LINE 不支援複製按鈕，附上文字');
  const rec = await e.OUG_KV.get('r:mvdis-gov-tw.cc', 'json');
  assert.equal(rec.scam, 1);
  assert.deepEqual(rec.paths, ['mvdis-gov-tw.cc/pay']);
  assert.match(textsOf(await send(postbackEvent(data, user('Uuser1')), e)), /之前已經通報過/);
  assert.equal((await e.OUG_KV.get('r:mvdis-gov-tw.cc', 'json')).scam, 1);
  await send(postbackEvent(data, user('Uuser2')), e);
  assert.equal((await e.OUG_KV.get('r:mvdis-gov-tw.cc', 'json')).scam, 2);
  const everything = JSON.stringify([...e.OUG_KV.m.entries()]);
  assert.ok(!everything.includes('Uuser1') && !everything.includes('Uuser2'), 'KV 裡不能有 LINE 使用者 ID');
  // 回報誤判
  assert.match(textsOf(await send(postbackEvent(packData('rep', 'fp', 'https://www.example-shop.com.tw/cart'), user('Uuser3')), e)), /誤判/);
  assert.equal((await e.OUG_KV.get('r:example-shop.com.tw', 'json')).fp, 1);
});

test('LINE 機器人：沒有設定 KV 時一鍵通報照樣可用（不記錄）', async () => {
  const e = env();
  delete e.OUG_KV;
  const r = await send(postbackEvent(packData('rep', 'scam', 'https://mvdis-gov-tw.cc/pay'), user()), e);
  assert.ok(actionsOf(r).some((a) => a.type === 'clipboard'));
  assert.doesNotMatch(textsOf(r), /已經記錄下來/);
});

test('LINE 機器人：通報彙整 API 需要密鑰', async () => {
  const e = env();
  await send(postbackEvent(packData('rep', 'scam', 'https://mvdis-gov-tw.cc/pay'), user('Ux')), e);
  const get = (auth, ee = e) => worker.fetch(new Request('https://bot.example/api/reports?days=7', { headers: auth ? { authorization: `Bearer ${auth}` } : {} }), ee);
  assert.equal((await get()).status, 401);
  assert.equal((await get('wrong')).status, 401);
  const ok = await (await get('reports-secret')).json();
  assert.equal(ok.reports[0].domain, 'mvdis-gov-tw.cc');
  const noToken = { ...e };
  delete noToken.REPORTS_TOKEN;
  assert.equal((await get('reports-secret', noToken)).status, 404);
  const health = await (await worker.fetch(new Request('https://bot.example/'), e)).json();
  assert.ok(health.ok && health.blocklist > 1000 && health.reports === true);
});

test('LINE 機器人：群組只在危險時引用那則訊息提醒；平常不說話；沒有快速回覆', async () => {
  store.resetRateLimit();
  const e = env();
  assert.equal(await send(textEvent('今天晚上吃什麼？', group()), e), null);
  assert.equal(await send(textEvent('監理站網址 https://www.mvdis.gov.tw/', group()), e), null);
  assert.equal(await send(textEvent('這家店好像不錯 https://www.some-new-cafe-example.com.tw/', group()), e), null);
  const ev = textEvent(SCAM_SMS, group());
  const msgs = await send(ev, e);
  assert.equal(msgs[0].type, 'text');
  assert.equal(msgs[0].quoteToken, ev.message.quoteToken, '引用那則訊息');
  assert.match(msgs[0].text, /很可能是詐騙[\s\S]*真正的官方網址：mvdis\.gov\.tw/);
  assert.equal(msgs[1].type, 'flex');
  assert.ok(msgs.every((m) => !m.quickReply));
});

test('LINE 機器人：群組指令（關閉、開啟、全部、檢查、@提及）', async () => {
  store.resetRateLimit();
  const e = env();
  const g = group('Cgroup-cmd');
  assert.match(textsOf(await send(textEvent('守門員 說明', g), e)), /群組指令[\s\S]*目前設定：自動檢查，只提醒很可能是詐騙的/);
  assert.match(textsOf(await send(textEvent('守門員 關閉', g), e)), /不自動檢查/);
  assert.equal(await send(textEvent(SCAM_SMS, g), e), null, '關閉後不自動提醒');
  const checked = await send(textEvent('守門員 檢查 https://www.mvdis.gov.tw/', g), e);
  assert.match(textsOf(checked), /✓/);
  assert.ok(checked.every((m) => !m.quickReply));
  assert.match(textsOf(await send(textEvent('守門員 開啟', g), e)), /只會在很可能是詐騙時提醒/);
  assert.ok(await send(textEvent(SCAM_SMS, g), e));
  const kvKeys = [...e.OUG_KV.m.keys()].filter((k) => k.startsWith('g:'));
  assert.equal(kvKeys.length, 1);
  assert.ok(!kvKeys[0].includes('Cgroup-cmd'), '群組 ID 只存雜湊');
  // @官網守門員 + 網址：即使安全也回覆
  const text = '@官網守門員 https://www.post.gov.tw/';
  const mention = await send(textEvent(text, g, { mention: { mentionees: [{ index: 0, length: 6, type: 'user', userId: 'Ubot', isSelf: true }] } }), e);
  assert.match(textsOf(mention), /✓/);
  // 被移出群組：刪掉設定
  await post([{ type: 'leave', timestamp: Date.now(), source: g }], e);
  assert.equal([...e.OUG_KV.m.keys()].filter((k) => k.startsWith('g:')).length, 0);
});

test('LINE 機器人：加好友、加入群組的歡迎訊息；圖片（未開啟）與群組照片', async () => {
  store.resetRateLimit();
  const e = env();
  assert.match(textsOf(await send({ type: 'follow', timestamp: Date.now(), source: user(), replyToken: 'rtf' }, e)), /謝謝你加我好友/);
  assert.match(textsOf(await send({ type: 'join', timestamp: Date.now(), source: group(), replyToken: 'rtj' }, e)), /不會儲存/);
  const img = (source) => ({ type: 'message', timestamp: Date.now(), source, replyToken: `rt${++seq}`, message: { type: 'image', id: `img${seq}` } });
  assert.match(textsOf(await send(img(user()), e)), /讀不到圖片/);
  assert.equal(await send(img(group()), e), null, '群組照片不讀');
});

test('LINE 機器人：開啟圖片功能時解出 QR Code 並判斷（PNG）', async () => {
  store.resetRateLimit();
  const e = { ...env(), IMAGE_QR: 'on' };
  imageBytes = toPng(toRgba(encodeQr('https://www.mvdis.gov.tw.pay-fine.top/login'), { scale: 5 }));
  requests.length = 0;
  const msgs = await send({ type: 'message', timestamp: Date.now(), source: user('Uimg'), replyToken: 'rti', message: { type: 'image', id: 'img-qr' } }, e);
  assert.match(textsOf(msgs), /QR Code 內容：https:\/\/www\.mvdis\.gov\.tw\.pay-fine\.top\/login/);
  assert.match(msgs.find((m) => m.type === 'flex').altText, /高度疑似詐騙/);
  assert.ok(requests.some((r) => r.url.includes('/chat/loading/start')), '讀圖時顯示輸入中動畫');
  imageBytes = toPng(toRgba([[0, 1], [1, 0]], { scale: 40 }));
  assert.match(textsOf(await send({ type: 'message', timestamp: Date.now(), source: user('Uimg'), replyToken: 'rti2', message: { type: 'image', id: 'img-noqr' } }, e)), /找不到 QR Code/);
});

test('LINE 機器人：PNG 解碼（調色盤、灰階、透明）', async () => {
  const png = toPng(toRgba(encodeQr('hello'), { scale: 2 }));
  const img = await decodePng(png);
  assert.ok(img.width > 20 && img.data.length === img.width * img.height * 4);
  assert.equal(await decodePng(new Uint8Array([1, 2, 3])), null);
});

test('LINE 機器人：頻率限制；LINE 回覆失敗時仍回 200', async () => {
  store.resetRateLimit();
  const e = env();
  let last;
  for (let i = 0; i < 21; i++) last = await send(textEvent('媽我晚點回家', user('Uspam')), e);
  assert.match(textsOf(last), /稍等一分鐘/);
  replyStatus = 500;
  assert.equal((await post([textEvent(SCAM_SMS, user('Ufail'))], e)).status, 200);
  replyStatus = 200;
});

test('LINE 機器人：通報內容與 postback 資料符合長度限制', () => {
  const long = 'https://scam.example.top/' + '很長的路徑'.repeat(200) + '?token=secret';
  const d = packData('rep', 'scam', long);
  assert.ok(d.length <= 300);
  assert.doesNotMatch(decodeURIComponent(d), /token=secret/, '查詢參數不放進 postback');
  assert.ok(reportText({ url: long, host: 'scam.example.top', reasons: [{ text: 'x'.repeat(900), weight: 50 }] }).length <= 1000);
});

test('LINE 機器人：所有回覆都符合 LINE 的訊息格式限制', () => {
  assert.ok(replies.length > 20);
  for (const { messages } of replies) {
    assert.ok(messages.length >= 1 && messages.length <= 5, '一次最多 5 則');
    for (const m of messages) {
      if (m.type === 'text') assert.ok(m.text.length >= 1 && m.text.length <= 5000);
      if (m.type === 'flex') {
        assert.ok(m.altText && [...m.altText].length <= 1500);
        const size = new TextEncoder().encode(JSON.stringify(m.contents)).length;
        if (m.contents.type === 'carousel') { assert.ok(size <= 50000); assert.ok(m.contents.contents.length <= 12); }
        else assert.ok(size <= 30000, `卡片 ${size} bytes`);
      }
      if (m.quickReply) {
        assert.ok(m.quickReply.items.length <= 13);
        for (const it of m.quickReply.items) assert.ok([...it.action.label].length <= 20, it.action.label);
      }
      walk(m, (n) => {
        if (n.type === 'text' && 'wrap' in n) assert.ok(n.text.length > 0, 'Flex 文字不能是空的');
        if (n.type === 'button') assert.ok([...n.action.label].length <= 40, n.action.label);
        if (n.type === 'postback') { assert.ok(n.data.length <= 300); if (n.displayText) assert.ok(n.displayText.length <= 300); }
        if (n.type === 'clipboard') assert.ok(n.clipboardText.length >= 1 && n.clipboardText.length <= 1000);
        if (n.type === 'uri') assert.ok(/^(https:|tel:|line:)/.test(n.uri) && n.uri.length <= 10000, n.uri);
      });
    }
  }
});

test('LINE 機器人：圖文選單六格剛好蓋滿 2500×1686，圖片符合 LINE 規格', async () => {
  const { richMenuDefinition, IMAGE } = await import('../line-bot/tools/richmenu.mjs');
  const { readFileSync } = await import('node:fs');
  const def = richMenuDefinition();
  assert.equal(def.areas.length, 6);
  assert.ok([...def.chatBarText].length <= 14);
  const area = def.areas.reduce((n, a) => n + a.bounds.width * a.bounds.height, 0);
  assert.equal(area, 2500 * 1686);
  for (const a of def.areas) {
    assert.ok(a.bounds.x + a.bounds.width <= 2500 && a.bounds.y + a.bounds.height <= 1686);
    assert.ok([...a.action.label].length <= 20);
  }
  const png = readFileSync(IMAGE);
  assert.ok(png.length < 1024 * 1024, '圖片要小於 1 MB');
  assert.equal(png.readUInt32BE(16), 2500);
  assert.equal(png.readUInt32BE(20), 1686);
  // 安裝：驗證 → 建立 → 上傳圖片 → 設為預設 → 刪掉舊的同名選單
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.replace(/https:\/\/api(-data)?\.line\.me/, '')}`);
    if (url.endsWith('/richmenu/list')) return new Response(JSON.stringify({ richmenus: [{ richMenuId: 'old1', name: def.name }, { richMenuId: 'other', name: '別的選單' }] }));
    if (url.endsWith('/v2/bot/richmenu')) return new Response(JSON.stringify({ richMenuId: 'new1' }));
    return new Response('{}');
  };
  const { install } = await import('../line-bot/tools/richmenu.mjs');
  assert.equal(await install('tok', { fetchImpl: fake, log: () => {} }), 'new1');
  assert.deepEqual(calls, ['POST /v2/bot/richmenu/validate', 'GET /v2/bot/richmenu/list', 'POST /v2/bot/richmenu', 'POST /v2/bot/richmenu/new1/content', 'POST /v2/bot/user/all/richmenu/new1', 'DELETE /v2/bot/richmenu/old1']);
});

test('LINE 機器人：訊息格式檢查工具涵蓋每一種回覆；設定程式解析 wrangler 輸出', async () => {
  const { validateAll } = await import('../line-bot/tools/validate-messages.mjs');
  const seen = [];
  const failed = await validateAll('tok', { log: () => {}, fetchImpl: async (url, init) => { seen.push([url, JSON.parse(init.body)]); return new Response('{}'); } });
  assert.equal(failed, 0);
  assert.ok(seen.length >= 15);
  assert.ok(seen.some(([u]) => u.endsWith('/richmenu/validate')));
  for (const [u, body] of seen) if (u.endsWith('/message/validate/reply')) assert.ok(body.messages.length >= 1 && body.messages.length <= 5);
  const setup = await import('../line-bot/tools/setup.mjs');
  assert.equal(setup.parseKvId('[[kv_namespaces]]\nbinding = "OUG_KV"\nid = "0123456789abcdef0123456789abcdef"'), '0123456789abcdef0123456789abcdef');
  assert.equal(setup.parseKvId('{ "id": "fedcba9876543210fedcba9876543210" }'), 'fedcba9876543210fedcba9876543210');
  assert.equal(setup.parseWorkerUrl('Uploaded\n  https://official-url-guard-line.judy-lin.workers.dev\nCurrent Version ID: x'), 'https://official-url-guard-line.judy-lin.workers.dev');
  const toml = (await import('node:fs')).readFileSync(new URL('../line-bot/wrangler.toml', import.meta.url), 'utf8');
  assert.ok(toml.includes(setup.KV_PLACEHOLDER), 'repo 裡的 wrangler.toml 保留預留字，自動部署時才用密鑰取代');
  assert.match(setup.withKvId(toml, 'a'.repeat(32)), /id = "a{32}"/);
});

test('LINE 通報彙整：依目前判斷給維護者建議', async () => {
  const { buildIssue } = await import('../tools/line-reports.mjs');
  const { buildContext } = await import('../src/lib/checker.js');
  const ctx = buildContext({ blocklist: ['listed-scam-site.top'] });
  const issue = buildIssue({ days: 7, reports: [
    { domain: 'mvdis-gov-tw.cc', scam: 3, miss: 0, fp: 0, paths: ['mvdis-gov-tw.cc/pay'] },
    { domain: 'my-quiet-bakery-example.com.tw', scam: 0, miss: 2, fp: 0, paths: ['my-quiet-bakery-example.com.tw/'] },
    { domain: 'listed-scam-site.top', scam: 1, miss: 0, fp: 0, paths: [] },
    { domain: 'post.gov.tw', scam: 1, miss: 0, fp: 0, paths: ['www.post.gov.tw/'] },
  ] }, ctx, { today: '2026-11-17' });
  assert.equal(issue.title, 'LINE 使用者通報彙整（2026-11-17）');
  assert.equal(issue.count, 4);
  assert.match(issue.body, /\| mvdis-gov-tw\.cc \| 3 \| 0 \| 0 \| 危險 \|/);
  assert.match(issue.body, /my-quiet-bakery-example\.com\.tw \| 0 \| 2 \| 0 \| 不在清單 \| 漏判/);
  assert.match(issue.body, /listed-scam-site\.top[^\n]*已在涉詐清單/);
  assert.match(issue.body, /post\.gov\.tw[^\n]*使用者認為官方網站是詐騙/);
});
