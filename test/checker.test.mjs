import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainToUnicode } from 'node:url';
import { buildContext, assessUrl, assessPage, findTransferInstruction } from '../src/lib/checker.js';
import { parseHost, punycodeDecode, normalizeDomain, skeleton } from '../src/lib/domain.js';
import { parseDomainList } from '../src/lib/blocklist.js';

const ctx = buildContext({ blocklist: ['scam-invest.com'], userTrusted: ['my-company.com.tw'], userBlocked: ['bad.example'] });
const level = (url) => assessUrl(url, ctx).level;
const page = (url, signals) => assessPage({ fields: {}, ...signals }, ctx, assessUrl(url, ctx));

test('網域拆解', () => {
  assert.equal(parseHost('www.mvdis.gov.tw').registrable, 'mvdis.gov.tw');
  assert.equal(parseHost('a.b.ctbcbank.com').registrable, 'ctbcbank.com');
  assert.equal(parseHost('evil.github.io').registrable, 'evil.github.io');
  assert.equal(parseHost('www.bbc.co.uk').registrable, 'bbc.co.uk');
  assert.equal(parseHost('pay.gov.taipei').registrable, 'gov.taipei');
});

test('punycode 解碼與 Node 內建結果一致', () => {
  for (const label of ['xn--pple-43d', 'xn--kpry57d', 'xn--kprw13d', 'xn--fiqs8s', 'xn--80ak6aa92e', 'xn--mnchen-3ya']) {
    assert.equal(punycodeDecode(label.slice(4)), domainToUnicode(label), label);
  }
  assert.equal(skeleton('ctbc-bаnk'), skeleton('ctbcbank')); // 西里爾 а
});

test('官方網站、政府網域', () => {
  assert.equal(level('https://www.ctbcbank.com/twrbo/'), 'official');
  assert.equal(level('https://www.esunbank.com/zh-tw/personal'), 'official');
  assert.equal(level('https://www.mvdis.gov.tw/'), 'official');
  assert.equal(level('https://www.ntpc.gov.tw/'), 'gov');
  assert.equal(level('https://www.ntu.edu.tw/'), 'gov');
  assert.equal(level('https://pma.gov.taipei/'), 'official');
  assert.equal(level('https://fraudbuster.digiat.org.tw/accessibility/index'), 'official');
});

test('仿冒網址一律判為危險', () => {
  for (const u of [
    'https://ctbcbamk.com/login',            // 差一個字
    'https://ctbc-bank.top/',                 // 加符號
    'https://www.ctbcbank.com.verify.top/',   // 官方網址藏前面
    'https://secure-ctbcbank.com/',           // 用 - 假裝子網域
    'https://esunbank-tw.com/',               // 品牌＋後綴字
    'https://mvdis-gov-tw.cc/pay',            // 假政府
    'https://fetc-tw.top/etc/pay',            // 假 ETC
    'https://xn--pple-43d.com/',              // 西里爾字母 аpple
    'https://shopee-tw.vip/',
    'https://post-gov.tw.xyz/',
    'https://fubon.top/',
  ]) assert.equal(level(u), 'danger', u);
});

test('一般網站不應誤判為危險', () => {
  for (const u of ['https://example.com/', 'https://pineapple.com/', 'https://capital.com/', 'https://agora.io/',
    'https://apple.stackexchange.com/', 'https://www.cathaypacific.com/', 'https://reurl.cc/abc', 'https://github.com/']) {
    assert.notEqual(level(u), 'danger', u);
  }
});

test('自訂清單與 165 清單', () => {
  assert.equal(level('https://a.b.scam-invest.com/'), 'danger');
  assert.equal(level('https://www.my-company.com.tw/'), 'trusted');
  assert.equal(level('https://bad.example/'), 'danger');
  assert.equal(level('http://192.168.1.1/'), 'skip');
});

test('官方平台上的使用者內容', () => {
  assert.equal(level('https://docs.google.com/forms/d/abc/viewform'), 'platform');
  assert.equal(level('https://line.me/R/ti/p/@scam'), 'platform');
  assert.equal(level('https://line.me/zh-hant/'), 'official');
});

test('假停車費頁面（信用卡）', () => {
  const v = page('https://tw-parking-pay.com/pay', {
    title: '臺北市停車管理工程處-停車費線上繳納', bodyText: '您的停車費逾期未繳，請補繳。', fields: { card: true, cvv: true },
  });
  assert.equal(v.level, 'danger');
  assert.equal(v.impersonating.domain, 'gov.taipei');
});

test('假罰單頁面（轉帳）', () => {
  const v = page('https://traffic-fine.net/', { title: '交通違規罰鍰繳納', bodyText: '請於三日內轉帳至 (822) 1234-5678-9012 戶名：監理服務' });
  assert.equal(v.level, 'danger');
  assert.ok(v.page.asks.includes('轉帳／匯款'));
});

test('運動幣、健康幣、普發現金、抽獎', () => {
  assert.equal(page('https://sport500.cc/', { title: '運動幣領取', bodyText: '恭喜您獲得運動幣500元，請輸入信用卡完成驗證', fields: { card: true } }).level, 'danger');
  assert.equal(page('https://health-coin.net/', { title: '健康幣兌換', bodyText: '健康幣即將到期，請輸入身分證字號與簡訊驗證碼', fields: { idNumber: true, otp: true } }).level, 'danger');
  assert.equal(page('https://cash-tw.net/', { title: '普發現金登記', bodyText: '請輸入網銀帳號與密碼以領取普發現金', fields: { bankAccount: true, password: true } }).level, 'danger');
  const addr = 'T' + 'A1b2C3d4E5f6G7h8J9k1L2m3N4p5Q6r7S'; // 34 碼 base58
  assert.equal(page('https://lucky-wheel.xyz/', { title: '幸運轉盤', bodyText: `恭喜中獎！請支付手續費 USDT TRC20 至錢包地址 ${addr}` }).level, 'danger');
});

test('冒充品牌：點數到期', () => {
  const v = page('https://cht-point.shop/', { title: '中華電信 點數即將到期', bodyText: '兌換商品只需支付運費', fields: { card: true } });
  assert.equal(v.level, 'danger');
  assert.equal(v.impersonating.domain, 'cht.com.tw');
});

test('一般商店結帳、匯款不應判為危險（只提醒）', () => {
  const shop = page('https://my-small-shop.com/checkout', {
    title: '結帳 - 小店', bodyText: '支援中國信託、玉山銀行信用卡。逾期未付款訂單將自動取消。包裹三日內寄出', fields: { card: true, cvv: true },
  });
  assert.equal(shop.level, 'caution');
  const transfer = page('https://handmade-tw.com/order', { title: '訂單完成', bodyText: '請匯款至 玉山銀行(808) 帳號 0123-456-789012' });
  assert.equal(transfer.level, 'caution');
  const news = page('https://news.example.com/a', { title: '中華郵政宣布新服務', identityText: '中華郵政宣布新服務', bodyText: '中華郵政今天宣布…停車費…' });
  assert.equal(news.level, 'unknown');
});

test('官方網站不做頁面檢查', () => {
  assert.equal(page('https://www.mvdis.gov.tw/', { title: '監理服務網', bodyText: '罰鍰繳納', fields: { card: true } }).level, 'official');
});

test('Google 表單收銀行帳號', () => {
  assert.equal(page('https://docs.google.com/forms/d/abc', { title: '中獎領取', bodyText: '請填寫銀行帳號', fields: { bankAccount: true } }).level, 'danger');
});

test('轉帳指示偵測不把手機號碼當帳號', () => {
  assert.equal(findTransferInstruction('客服專線 0912-345-678，歡迎轉帳詢問'), null);
  assert.ok(findTransferInstruction('ATM 轉帳：銀行代碼 012 帳號 12345678901234'));
});

test('165 CSV 解析', () => {
  const csv = '﻿民國年月,網域,網站性質,法律依據,聲請單位\n11310,"https://www.fake-invest.top/login",假投資,詐欺犯罪危害防制條例第42條,刑事警察局\n11310,abc-shop.xyz,假購物,同上,刑事警察局\n11310,1.5,x,y,z\n';
  assert.deepEqual(parseDomainList(csv).sort(), ['abc-shop.xyz', 'fake-invest.top']);
  assert.deepEqual(parseDomainList('a.com\nhttps://b.com/x\n*.c.net\n'), ['a.com', 'b.com', 'c.net']);
  assert.equal(normalizeDomain('HTTPS://WWW.Example.COM:8080/a?b'), 'example.com');
});

// ───────── 第二版新增 ─────────
import { LEGIT, SCAM, SCAM_HOLDOUT } from './corpus.mjs';
import { parseLineIdList } from '../src/lib/blocklist.js';

test(`正常網站語料（${LEGIT.length} 個）：不可判為危險`, () => {
  const bad = LEGIT.map((u) => [u, assessUrl(u, ctx)]).filter(([, r]) => r.level === 'danger');
  assert.deepEqual(bad.map(([u, r]) => `${u} ${r.reasons[0].text}`), []);
});

test(`詐騙網址語料（${SCAM.length + SCAM_HOLDOUT.length} 個）：必須判為危險`, () => {
  const missed = [...SCAM, ...SCAM_HOLDOUT].map((u) => [u, assessUrl(u, ctx)]).filter(([, r]) => r.level !== 'danger');
  assert.deepEqual(missed.map(([u, r]) => `${u} ${r.level} ${r.score}`), []);
});

test('跨國品牌的海外官網只提示，便宜網域照樣攔', () => {
  assert.notEqual(level('https://www.google.co.jp/'), 'danger');
  assert.notEqual(level('https://www.amazon.de/'), 'danger');
  assert.equal(level('https://paypal.cc/'), 'danger');
  assert.equal(level('https://google.top/'), 'danger');
  assert.equal(level('https://ctbcbank.net/'), 'danger'); // 台灣銀行不會換後綴營業
});

test('165 詐騙 LINE ID', () => {
  const c = buildContext({ lineIds: ['@scam888', 'fakeinvest'] });
  assert.equal(assessUrl('https://line.me/R/ti/p/@scam888', c).level, 'danger');
  assert.equal(assessUrl('https://line.me/ti/p/~FakeInvest', c).level, 'danger');
  assert.equal(assessUrl('https://line.me/R/ti/p/@goodshop', c).level, 'platform');
  const v = assessPage({ title: '投資交流', bodyText: '', fields: {}, links: { lineIds: ['scam888'] } }, c, assessUrl('https://stock-club.net/', c));
  assert.equal(v.level, 'danger');
  assert.deepEqual(parseLineIdList('日期,LINE ID,件數\n11310,@scam888,3\n11310,https://line.me/ti/p/~abc123,1\n').sort(), ['abc123', 'scam888']);
});

test('打字時偵測到卡號／身分證（欄位沒標示也抓）', () => {
  const v = page('https://parking-fee.net/', { title: '停車費繳納', bodyText: '您的停車費逾期未繳', typed: { card: true } });
  assert.equal(v.level, 'danger');
  const w = page('https://gift-center.net/', { title: '運動幣領取', bodyText: '運動幣', typed: { idNumber: true } });
  assert.equal(w.level, 'danger');
});

test('資料直接送到 Telegram', () => {
  assert.equal(page('https://secure-update.net/', { title: '帳戶驗證', bodyText: '', fields: { password: true }, exfil: 'Telegram 機器人' }).level, 'danger');
});

test('冒名要你下載 APK', () => {
  assert.equal(page('https://nhi-app.net/', { title: '健保署 APP 下載', identityText: '健保署', bodyText: '', links: { apk: true } }).level, 'danger');
  assert.equal(page('https://cool-game.net/', { title: '遊戲下載', bodyText: '', links: { apk: true } }).level, 'caution');
});

test('假投資導流頁；新聞報導詐騙不誤判', () => {
  const scam = page('https://stock-master.net/', { title: '免費領取飆股', bodyText: '名師帶單，保證獲利，穩賺不賠！立即加入 LINE 群組', links: { chat: 2 } });
  assert.equal(scam.level, 'danger');
  const news = page('https://news.example.com/b', {
    title: '假投資詐騙再起', bodyText: '警方提醒，詐團以「保證獲利」「穩賺不賠」為誘餌，民眾受害後報案。如有疑問請撥 165。', links: { chat: 1 },
  });
  assert.notEqual(news.level, 'danger');
});

test('沒加密的付款頁會加重', () => {
  const s = page('https://my-small-shop.com/checkout', { title: '結帳', bodyText: '', fields: { card: true } }).score;
  const h = page('http://my-small-shop.com/checkout', { title: '結帳', bodyText: '', fields: { card: true }, isHttp: true }).score;
  assert.ok(h > s);
});

// ───────── 簡訊判斷 ─────────
import { assessMessage, extractUrls } from '../src/lib/checker.js';

test('從簡訊找出網址（含沒有 https:// 的、排除 email）', () => {
  assert.deepEqual(extractUrls('請至 post-tw.cfd 更新，或來信 abc@gmail.com，或 https://reurl.cc/x7Y。'), ['https://post-tw.cfd', 'https://reurl.cc/x7Y']);
});

test('簡訊自稱的機構和連結不一致 → 危險；連結正確 → 官方', () => {
  const lv = (m) => assessMessage(m, ctx).items.map((v) => v.level);
  assert.deepEqual(lv('【監理服務網】您有一筆罰鍰逾期未繳，請至 https://tw-traffic-pay.com/fine 繳納'), ['danger']);
  assert.deepEqual(lv('[臺北市停車管理工程處] 停車費尚未繳納 https://reurl.cc/abcd'), ['danger']);
  assert.deepEqual(lv('您的運動幣即將到期，立即領取 https://sport-coin.net/get'), ['danger']);
  assert.deepEqual(lv('老師帶你穩賺不賠 https://lin.ee/abcd'), ['danger']);
  assert.deepEqual(lv('【監理服務網】牌照稅請至 https://www.mvdis.gov.tw/ 查詢'), ['official']);
  assert.deepEqual(lv('本期發票中獎請至 einvoice.nat.gov.tw 查詢'), ['official']);
  assert.deepEqual(lv('晚上吃飯 https://www.google.com/maps/place/abc'), ['official']);
});

test('沒有網址的訊息：保證獲利、轉帳要提醒', () => {
  const r = assessMessage('保證獲利，加賴 @teacher888 帶你飆股', ctx);
  assert.ok(r.noUrl && r.messageNotes.length >= 1);
});

// ───────── 第三版：依真實資料調整 ─────────
test('品牌專屬頂級網域與同集團網域視為官方', () => {
  for (const u of ['https://gemini.google/', 'https://outlook.cloud.microsoft/', 'https://www.cathay-ins.com.tw/', 'https://ibank.tcbbank.com.tw/',
    'https://one.efubon.com.tw/', 'https://www.kgibank.com/', 'https://commons.wikimedia.org/', 'https://web-tw-pay.line-apps.com/']) {
    assert.equal(level(u), 'official', u);
  }
});

test('真實資料中的誤判已修正（一般單字、跨國品牌、公部門廠商）', () => {
  for (const u of ['https://www.21-finance.com/', 'https://taiwanplay.com/', 'https://www.cswater.com.tw/', 'https://railway.com/',
    'https://shopee.com.my/', 'https://www.rakuten-card.co.jp/', 'https://www.hsbc.com.hk/', 'https://opengovtw.com/',
    'https://esn.gov.mailcloud.tw/', 'https://www.office24.com.tw/', 'https://ssstwitter.com/', 'https://tiktokio.com/',
    'https://www.nanshanrun.com/', 'https://telegram-group.org/', 'https://www.ife-tigerairtw.com/']) {
    assert.notEqual(level(u), 'danger', u);
  }
});

test('真實詐騙手法（依 TWNIC 停止解析網址的樣式改寫）', () => {
  for (const u of ['https://tw88.shopeexyz.cyou/', 'https://newebabc.top/', 'https://newebpay123.tw-abc.shop/', 'https://rakutenxk.com/',
    'https://e-invoice-tw.top/', 'https://anydesk-tw.com/', 'https://line-lite.top/', 'https://abc.github.io/shopee-coupon/?a=1',
    'https://mvdis-gov-tw.cc/', 'https://einvoice-nat-tw.com/']) {
    assert.equal(level(u), 'danger', u);
  }
});

test('只有便宜後綴的隨機網址：可疑但不攔截', () => {
  assert.equal(level('https://abcde.top/'), 'caution');
  assert.equal(level('https://abcde.cc/'), 'unknown'); // .cc 在台灣正常網站一樣常見
});

test('簡訊：要你點連結後交出秘密並施壓 → 危險；只是付款通知 → 不判危險', () => {
  const lv = (m) => assessMessage(m, ctx).items.map((v) => v.level)[0];
  assert.equal(lv('你的點數今晚失效，請至 https://points-abc.com 登入並綁定信用卡才能兌換'), 'danger');
  assert.equal(lv('恭喜獲得免費升級，請至 https://upgrade-abc.com 輸入信用卡並回傳驗證碼'), 'danger');
  assert.notEqual(lv('您的訂單已成立，請於三天內完成付款 https://my-shop-abc.com/order/123'), 'danger');
});

test('簡訊沒有連結：交出驗證碼、先付錢、保密要提醒；一般通知不提醒', () => {
  const notes = (m) => assessMessage(m, ctx).messageNotes;
  assert.ok(notes('恭喜抽中免費貼圖！請把手機收到的六位數驗證碼回傳給我').length);
  assert.ok(notes('先付 100 元開通帳號，第一次領點數時會一起退給你。不用告訴爸媽').length >= 2);
  assert.equal(notes('明天放學後的社團活動暫停一次，詳情請看校務平台。').length, 0);
});

test('一頁式購物、假投資出金', () => {
  const shop = page('https://good-deal.top/p/1', { title: '限時特價', bodyText: '全館破盤價！限時倒數 3 小時，貨到付款，加 LINE 客服', fields: {} });
  assert.equal(shop.level, 'danger');
  const realShop = page('https://real-shop-abc.com/p/1', { title: '商品', bodyText: '限時特價，支援貨到付款。好物商行股份有限公司 統一編號 12345678', fields: {} });
  assert.notEqual(realShop.level, 'danger');
  const invest = page('https://invest-abc.com/withdraw', { title: '出金', bodyText: '您的帳戶獲利 50 萬元，需先繳納 10% 稅金才能出金', fields: {} });
  assert.equal(invest.level, 'danger');
});

test('清單淨化：剔除官方與政府網域，但保留雲端空間上的個別詐騙空間', async () => {
  const { sanitizeDomains } = await import('../src/lib/blocklist.js');
  const { kept, removed } = sanitizeDomains(['google.com', 'play.google.com', 'www.mvdis.gov.tw', 'com.tw', 'scam-shop.top',
    'shilic.s3.ap-east-1.amazonaws.com', 'amazonaws.com', 's3.amazonaws.com', 's3.ap-east-1.amazonaws.com', 'pay.gov.taipei'], buildContext());
  assert.deepEqual(kept.sort(), ['scam-shop.top', 'shilic.s3.ap-east-1.amazonaws.com']);
  assert.equal(removed.length, 8);
});

test('165 官方 CSV 的雙標題列（英文＋中文）', () => {
  const csv = '﻿WEBSITE_NM,WEBURL,CNT,STA_SDATE,STA_EDATE\n網站名稱,網址,件數,統計起始日期,統計結束日期\n0857娛樂城,www.0857.games,1,2023/12/12,2023/12/18\n0x,www.0xdappplus.com,2,2023/04/25,2023/04/30\n';
  assert.deepEqual(parseDomainList(csv).sort(), ['0857.games', '0xdappplus.com']);
});

test('網域名稱小模型：隨機命名的便宜網域加分，正常名稱不受影響、單獨不會觸發警告', async () => {
  const { labelScore } = await import('../src/lib/label-model-core.js');
  const { LABEL_MODEL } = await import('../src/data/label-model.js');
  assert.ok(labelScore('npvgxc', LABEL_MODEL) > labelScore('bookstore', LABEL_MODEL));
  const noModel = buildContext({ useModel: false });
  // 只有模型分數、沒有其他線索時，不會變成「可疑」
  assert.equal(assessUrl('https://npvgxc.com/', ctx).level, 'unknown'); // .com 沒有其他線索：模型分數最多 25，不到「可疑」的 30
  assert.ok(assessUrl('https://npvgxc.shop/', ctx).score >= assessUrl('https://npvgxc.shop/', noModel).score);
  assert.equal(assessUrl('https://www.books.com.tw/', ctx).level, 'official');
});

test('官方清單線上更新：通過檢查才採用', async () => {
  const { exportOfficial, validateRemoteOfficial } = await import('../src/lib/remote-official.js');
  const { OFFICIAL_SITES } = await import('../src/data/official-sites.js');
  const good = exportOfficial(OFFICIAL_SITES);
  assert.equal(validateRemoteOfficial(good, OFFICIAL_SITES).ok, true);
  const mutate = (fn) => { const j = JSON.parse(JSON.stringify(good)); fn(j); return validateRemoteOfficial(j, OFFICIAL_SITES, new Set(['scam-shop.top'])); };
  assert.equal(mutate((j) => j.sites[0].domains.push('scam-shop.top')).ok, false);   // 涉詐清單上的網域
  assert.equal(mutate((j) => j.sites[1].domains.push('com.tw')).ok, false);          // 後綴本身
  assert.equal(mutate((j) => j.sites[2].domains.push('github.io')).ok, false);       // 整個架站平台
  assert.equal(mutate((j) => { j.sites = j.sites.slice(0, 50); }).ok, false);        // 機構數不合理
  assert.equal(mutate((j) => { for (let i = 0; i < 301; i++) j.sites.push({ name: 'x' + i, category: '購物', domains: [`new-shop-${i}.com`] }); }).ok, false); // 一次新增太多
  const ok = mutate((j) => j.sites.push({ name: '新機構', category: '購物', domains: ['new-official-shop.com.tw'] }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.added, ['new-official-shop.com.tw']);
});

// ───────── Email（依使用者實際收到的詐騙信改寫：追蹤代碼、案件編號已替換）─────────
const ETAX_MAIL = [
  '年末調整による還付金のお支払いについて',
  'お手元のAndr​oidスマートフォンよりご確認ください。',
  '平素よりe-Taxをご利用いただき、誠にありがとうございます。国税庁でございます。',
  '2025年分の年末調整の処‍理が完了し、還付金をお受け取りいただける運びとなりました。',
  '還付金の内容を確認する',
  '※ 国税庁が口座番号・暗証番号の入力を求めることは一切ありません。',
  '※本メールは送信専用⁠です。ご返信には対応しておりません。https://yarlgs.com/AbCdEf.money',
].join('\n');
const CHT_MAIL = [
  '[lChunghwalTelecomlCo., Ltd]\t申請確認',
  '帳單重複繳款－退款資格確認',
  '您的帳單可能因付款作業錯誤而重複繳款。請檢視付款資料，並確認兩筆付款是否屬於同一筆帳單。',
  '案件編號\tCHT000000000000',
  '檢視並確認您的資料',
  '如果您不認得這些付款紀錄，請透過該公司官方網站查閱帳單。請勿透過電子郵件提供密碼或完整的信用卡資料。',
  'https://clt0000000.benchurl.com/c/l?u=0&e=0&c=0&t=0&email=REDACTED&seq=1',
].join('\n');

test('真實詐騙信：日本国税庁 e-Tax 退稅信', () => {
  const r = assessMessage(ETAX_MAIL, ctx);
  assert.equal(r.claim, '日本国税庁（e-Tax）');
  assert.equal(r.items[0].level, 'danger');
  const text = r.items[0].reasons.map((x) => x.text).join('\n');
  assert.match(text, /nta\.go\.jp/);
  assert.match(text, /看不見的字元/);           // Andr​oid、処‍理、送信専用⁠
  assert.doesNotMatch(text, /點連結付款/);       // 「還付金のお支払い」是付錢給你，不是要你付款
  assert.doesNotMatch(text, /提供銀行帳戶/);     // 「口座番号…求めることは一切ありません」是否定句
});

test('真實詐騙信：冒充中華電信的重複繳款退款信', () => {
  const r = assessMessage(CHT_MAIL, ctx);
  assert.equal(r.claim, '中華電信');
  assert.equal(r.items[0].level, 'danger');
  const text = r.items[0].reasons.map((x) => x.text).join('\n');
  assert.match(text, /拆開、混入字元/);          // lChunghwalTelecom
  assert.match(text, /電子報追蹤連結/);          // benchurl.com
  assert.doesNotMatch(text, /提供信用卡資料/);   // 「請勿…提供密碼或完整的信用卡資料」是否定句
});

test('轉址連結：外層是官方網域也要拆開檢查', () => {
  assert.equal(assessUrl('https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fctbc-bank.top%2Flogin&data=05', ctx).level, 'danger');
  assert.equal(assessUrl('https://www.google.com/url?q=https://ctbc-bank.top/login&sa=D', ctx).level, 'danger');
  assert.equal(assessUrl('https://www.google.com/search?q=https://example.com', ctx).level, 'official');
  assert.equal(assessUrl('https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.mvdis.gov.tw%2F', ctx).level, 'official');
});

test('寄件人：免費信箱或非官方網域自稱機構', () => {
  const r = assessMessage('From: 中華郵政 <service.post@gmail.com>\n【中華郵政】您的包裹地址不完整，請點 https://post-tw-abc.com 更新', ctx);
  assert.ok(r.sender && r.sender.problem && /免費信箱/.test(r.sender.problem));
  const ok = assessMessage('寄件者：監理服務網 <service@mvdis.gov.tw>\n您的牌照稅請至 https://www.mvdis.gov.tw/ 查詢', ctx);
  assert.equal(ok.sender.problem, null);
  assert.equal(ok.items[0].level, 'official');
});

test('英文短字名稱不誤判（autopay 不是 au PAY）', () => {
  const r = assessMessage('Heads up, I set up autopay on the shared card. You will see $38 next week.', ctx);
  assert.equal(r.messageNotes.length, 0);
});

test('日本政府與品牌', () => {
  assert.equal(level('https://www.nta.go.jp/'), 'official');
  assert.equal(level('https://www.city.minato.tokyo.lg.jp/'), 'gov');
  assert.equal(level('https://www.e-tax.nta.go.jp/'), 'official');
  assert.equal(level('https://kuronekoyamato-jp.top/'), 'danger');
  assert.equal(level('https://www.vpass.ne.jp/'), 'official');
});

test('一般網站帶 ?url= 參數不是轉址（回報表單、網址檢測網站不能被擋）', () => {
  assert.equal(assessUrl('https://github.com/judylin0324/official-url-guard/issues/new?template=false-positive.yml&url=https://ctbc-bank.top/login', ctx).level, 'official');
  assert.equal(assessUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fctbc-bank.top%2F&h=AT0', ctx).level, 'danger');
});

// ───────── 仿冒繳款網頁（第六版）─────────
test('抄襲官網：canonical／og:url 指向官網，名稱做成圖片也抓得到', () => {
  // 頁面文字沒有任何機構名稱（Logo 是圖片），但原始碼留著官網的正式網址
  const v = page('https://pay-online-tw.com/fee', { title: '線上繳費', bodyText: '請輸入繳費資料', fields: { card: true },
    copy: { canonical: 'https://www.mvdis.gov.tw/m3-emv-trn/', resources: [] } });
  assert.equal(v.level, 'danger');
  assert.equal(v.impersonating.domain, 'mvdis.gov.tw');
  assert.match(v.reasons[0].text, /複製/);
  const og = page('https://pay-online-tw.com/fee', { title: '繳費', bodyText: '', fields: { card: true }, copy: { ogUrl: 'https://www.fetc.net.tw/pay' } });
  assert.equal(og.level, 'danger');
});

test('抄襲官網：直接載入官網的 Logo、樣式', () => {
  const res = [{ host: 'www.post.gov.tw', kind: 'img', logo: true }, { host: 'www.post.gov.tw', kind: 'css' }];
  assert.equal(page('https://parcel-fee.net/pay', { title: '補繳運費', bodyText: '', fields: { card: true }, copy: { resources: res } }).level, 'danger');
  // 沒有要錢時只提醒
  assert.equal(page('https://parcel-fee.net/', { title: '首頁', bodyText: '', fields: {}, copy: { resources: res } }).level, 'caution');
});

test('抄襲官網：常見嵌入不算（無障礙標章、新聞網站、金流程式、只有一張普通圖片）', () => {
  const shop = (copy) => page('https://my-handmade-shop.com/checkout', { title: '結帳', bodyText: '', fields: { card: true }, copy });
  assert.notEqual(shop({ resources: [{ host: 'accessibility.moda.gov.tw', kind: 'img', logo: true }, { host: 'accessibility.moda.gov.tw', kind: 'img', logo: true }] }).level, 'danger');
  assert.notEqual(shop({ canonical: 'https://www.cna.com.tw/news/123' }).level, 'danger'); // 新聞不是高敏感機構
  assert.notEqual(shop({ resources: [{ host: 'payment.ecpay.com.tw', kind: 'script' }, { host: 'payment.ecpay.com.tw', kind: 'css' }] }).level, 'danger');
  assert.notEqual(shop({ resources: [{ host: 'www.ntpc.gov.tw', kind: 'img' }] }).level, 'danger');
});

test('偷傳卡號：還沒按送出就外傳 → 危險；送出時送到正規金流 → 不加分', () => {
  const v = page('https://parking-fee-tw.com/', { title: '繳費', bodyText: '', fields: { card: true }, exfilLive: { host: 'collect.evil-api.com', beforeSubmit: true, kind: 'card' } });
  assert.equal(v.level, 'danger');
  assert.match(v.reasons[0].text, /還沒按送出/);
  const g = page('https://my-handmade-shop.com/checkout', { title: '結帳', bodyText: '', fields: { card: true }, exfilLive: { host: 'payment.ecpay.com.tw', beforeSubmit: false, kind: 'card' } });
  assert.notEqual(g.level, 'danger');
  // 正規金流的程式在送出前就把卡號換成代碼（tokenize）是正常的
  const tok = page('https://my-handmade-shop.com/checkout', { title: '結帳', bodyText: '', fields: { card: true }, exfilLive: { host: 'api.stripe.com', beforeSubmit: true, kind: 'card' } });
  assert.notEqual(tok.level, 'danger');
  assert.ok(tok.reasons.some((r) => /正規金流（Stripe）/.test(r.text)));
  // 驗證碼輸入完自動送出驗證是常見設計，不當成偷傳
  const otp = page('https://my-handmade-shop.com/login', { title: '登入', bodyText: '', fields: { otp: true }, exfilLive: { host: 'my-handmade-shop.com', beforeSubmit: true, kind: 'otp' } });
  assert.notEqual(otp.level, 'danger');
});

test('抄襲官網：結帳頁上的支付品牌 Logo 不算', () => {
  const v = page('https://my-handmade-shop.com/checkout', { title: '結帳', bodyText: '付款方式', fields: { card: true },
    copy: { resources: [{ host: 'www.taiwanpay.com.tw', kind: 'img', logo: true }, { host: 'www.jkopay.com', kind: 'img', logo: true }] } });
  assert.notEqual(v.level, 'danger');
  assert.equal(v.page.copied, null);
});

test('正規金流與自製刷卡表單', () => {
  const raw = page('https://my-handmade-shop.com/checkout', { title: '結帳', bodyText: '', fields: { card: true } });
  assert.ok(raw.reasons.some((r) => /自己做的表單/.test(r.text)));
  const gw = page('https://my-handmade-shop.com/checkout', { title: '結帳', bodyText: '', fields: {}, gateways: ['js.tappaysdk.com'] });
  assert.ok(gw.reasons.some((r) => /TapPay/.test(r.text)));
  assert.equal(gw.page.gateway, 'TapPay');
});

test('假的信用卡 3D 驗證頁', () => {
  const v = page('https://secure-verify-card.com/3ds', { title: '3D 驗證', bodyText: 'Verified by Visa 請輸入簡訊驗證碼完成交易', fields: { otp: true } });
  assert.equal(v.level, 'danger');
  const real = page('https://acs.cardinalcommerce.com/x', { title: '3D Secure', bodyText: 'Verified by Visa', fields: { otp: true } });
  assert.notEqual(real.reasons[0] && real.reasons[0].text.includes('假的信用卡 3D'), true);
});

test('小額誘餌與正確繳費管道', () => {
  const v = page('https://pay-parking.net/', { title: '停車費補繳', bodyText: '您的停車費 NT$ 120 尚未繳納，請補繳', fields: { card: true } });
  assert.ok(v.reasons.some((r) => /120 元這種小額/.test(r.text)));
  assert.equal(v.page.channels.topic, '停車費');
  assert.ok(v.page.channels.items.some((i) => i.url === 'https://ebill.ba.org.tw/'));
  const big = page('https://pay-parking.net/', { title: '停車費補繳', bodyText: '停車費 NT$ 1,800 尚未繳納', fields: { card: true } });
  assert.ok(!big.reasons.some((r) => /小額/.test(r.text)));
  // 「2025年」不是金額
  const yr = page('https://pay-parking.net/', { title: '停車費補繳', bodyText: '2025年停車費', fields: { card: true } });
  assert.ok(!yr.reasons.some((r) => /小額/.test(r.text)));
  const etc = assessMessage('【遠通電收】您有一筆通行費未繳，請至 https://fetc-pay.cc/ 補繳', ctx).items[0];
  assert.equal(etc.channels.topic, 'ETC 通行費');
  const cht = assessMessage(CHT_MAIL, ctx).items[0];
  assert.ok(cht.channels && cht.channels.items[0].url.includes('cht.com.tw'));
});
