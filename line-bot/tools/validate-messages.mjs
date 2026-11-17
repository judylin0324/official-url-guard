// 請 LINE 平台檢查機器人會送出的每一種訊息格式（不會真的送出，也不計入訊息則數）。
// 改了 src/messages.js 的卡片版面後執行一次，確認 LINE 接受。
// 用法：LINE_CHANNEL_ACCESS_TOKEN=… node tools/validate-messages.mjs   （setup 會自動執行）
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 產生每一種訊息的範例（和實際回覆走同一份程式） */
export async function sampleMessages() {
  execFileSync(process.execPath, [path.join(here, '../../tools/build-line-bot.mjs')], { stdio: 'ignore' });
  const { buildResult, checkUrl } = await import('../src/analyze.js');
  const M = await import('../src/messages.js');
  const { richMenuDefinition } = await import('./richmenu.mjs');
  const scam = buildResult('【監理服務網】您有一筆交通違規罰鍰逾期未繳，請於今日內至 https://mvdis-gov-tw.cc/pay 繳納');
  const many = buildResult('停車費 https://www.mvdis.gov.tw.pay-fine.top/login 另見 https://www.einvoice.nat.gov.tw/ 以及 https://some-unknown-shop-example.com.tw/');
  const notes = buildResult('等一下會有驗證碼傳到你手機，收到後把驗證碼傳給我，不要告訴別人');
  const official = buildResult('包裹查詢 https://www.post.gov.tw/');
  const qr = { ...scam, qr: { text: 'https://mvdis-gov-tw.cc/pay', items: [{ display: '網址：mvdis-gov-tw.cc' }], pay: null, crypto: null } };
  const v = checkUrl('https://mvdis-gov-tw.cc/pay', '監理服務網');
  return {
    '危險卡片（一則網址）': M.resultMessages(scam, { botUrl: 'https://lin.ee/example' }),
    '多個網址（輪播）': M.resultMessages(many, {}),
    '沒有網址、只有話術': M.resultMessages(notes, {}),
    '官方網站': M.resultMessages(official, {}),
    'QR Code 結果': M.resultMessages(qr, {}),
    '群組提醒（引用訊息）': M.groupWarning(scam, {}),
    '一鍵通報完成': M.reportReceived('scam', v, { stored: true, duplicate: false }),
    '重複通報': M.reportReceived('scam', v, { stored: true, duplicate: true }),
    '回報誤判': M.reportReceived('fp', v, { stored: true, duplicate: false }),
    '說明': M.helpMessages({ botUrl: 'https://lin.ee/example' }),
    '歡迎訊息': M.welcomeMessages({}),
    '隱私說明': M.privacyMessages(),
    '怎麼通報': M.howToReportMessages(),
    '保護家人群組': M.groupHowToMessages({}),
    '加入群組': M.groupJoinMessages(),
    '群組說明': M.groupHelpMessages({ mode: 'on', level: 'danger' }),
    '圖片': M.imageMessages({ enabled: false }),
    richMenu: richMenuDefinition(),
  };
}

export async function validateAll(token, { fetchImpl = fetch, log = console.log, apiBase = 'https://api.line.me' } = {}) {
  const samples = await sampleMessages();
  let failed = 0;
  for (const [name, messages] of Object.entries(samples)) {
    const isMenu = name === 'richMenu';
    const res = await fetchImpl(`${apiBase}/v2/bot/${isMenu ? 'richmenu/validate' : 'message/validate/reply'}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(isMenu ? messages : { messages }),
    });
    if (res.ok) log(`✔ ${isMenu ? '圖文選單' : name}`);
    else { failed++; log(`✘ ${isMenu ? '圖文選單' : name}：${res.status} ${(await res.text()).slice(0, 500)}`); }
  }
  return failed;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) { console.error('請先設定環境變數 LINE_CHANNEL_ACCESS_TOKEN'); process.exit(1); }
  const failed = await validateAll(token);
  console.log(failed ? `${failed} 種訊息格式被 LINE 拒絕，請把上面的訊息貼給維護者` : '全部訊息格式都通過 LINE 檢查');
  process.exit(failed ? 1 : 0);
}
