// Gmail 收件匣過濾（Apps Script）的模擬測試：
// 在沒有 URL、atob、Buffer 的沙盒裡執行（和 Google Apps Script 一樣），用模擬的 GmailApp 等服務。
// 真正的 Gmail 行為仍需在 Apps Script 實際執行確認。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildEngine } from '../tools/build-gmail.mjs';

function makeSandbox(threads, lists) {
  const labels = new Map();
  const props = new Map();
  const cache = new Map();
  const triggers = [];
  const label = (name) => ({ getName: () => name });
  const sandbox = {
    console: { log: () => {} },
    Utilities: { base64Decode: (b) => [...Uint8Array.from(atob(b), (c) => c.charCodeAt(0))].map((x) => (x > 127 ? x - 256 : x)) },
    GmailApp: {
      search: (q) => {
        const after = Number((q.match(/after:(\d+)/) || [])[1] || 0);
        return threads.filter((t) => !t.archived && t.msgs.some((m) => m.date / 1000 >= after));
      },
      getUserLabelByName: (n) => labels.get(n) || null,
      createLabel: (n) => { const l = label(n); labels.set(n, l); return l; },
    },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    CacheService: {
      getUserCache: () => ({
        get: (k) => cache.get(k) ?? null,
        getAll: (ks) => Object.fromEntries(ks.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])),
        putAll: (o) => { for (const [k, v] of Object.entries(o)) cache.set(k, v); },
      }),
    },
    UrlFetchApp: {
      fetch: (url) => ({ getResponseCode: () => 200, getContentText: () => lists[url.includes('Taiwan-Blocked') ? 'twnic' : 'g0v'] }),
    },
    ScriptApp: {
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => triggers.push({ fn, n, getHandlerFunction: () => fn }) }) }) }),
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    },
  };
  sandbox.globalThis = sandbox;
  return { sandbox, triggers, cache };
}

let nextId = 1;
function thread(from, subject, plain, html, minutesAgo = 5) {
  const msg = {
    date: Date.now() - minutesAgo * 60000,
    id: 'm' + nextId++,
    getId() { return this.id; }, getDate() { return new Date(this.date); }, getFrom: () => from, getSubject: () => subject,
    getPlainBody: () => plain, getBody: () => html,
  };
  return {
    msgs: [msg], labels: [], archived: false, spam: false,
    getMessages() { return this.msgs; }, addLabel(l) { this.labels.push(l.getName()); }, moveToArchive() { this.archived = true; }, moveToSpam() { this.spam = true; },
  };
}

test('Gmail 收件匣過濾：詐騙信移出收件匣、正常信不動', () => {
  // 使用者實際收到的兩封詐騙信（追蹤代碼已替換）
  const etax = thread('e-Tax <info@nta-etax-refund.com>', '年末調整による還付金のお支払いについて',
    'お手元のAndr​oidスマートフォンよりご確認ください。\n平素よりe-Taxをご利用いただき、誠にありがとうございます。国税庁でございます。\n還付金の内容を確認する\n※ 国税庁が口座番号・暗証番号の入力を求めることは一切ありません。',
    '<p>国税庁でございます。</p><a href="https://yarlgs.com/AbCdEf.money">還付金の内容を確認する</a>');
  const cht = thread('"[lChunghwalTelecomlCo., Ltd]" <notice@cht-bill-refund.com>', '申請確認',
    '帳單重複繳款－退款資格確認\n您的帳單可能因付款作業錯誤而重複繳款。\n檢視並確認您的資料\n請勿透過電子郵件提供密碼或完整的信用卡資料。',
    '<a href="https://clt0000000.benchurl.com/c/l?u=0&amp;e=0&amp;email=REDACTED">檢視並確認您的資料</a>');
  const mvdis = thread('監理服務網 <service@mvdis.gov.tw>', '牌照稅繳納通知', '本期使用牌照稅已開徵，請至監理服務網查詢。',
    '<a href="https://www.mvdis.gov.tw/">監理服務網</a>');
  const news = thread('Pinkoi <news@pinkoi.com>', '本週設計好物', '本週精選設計師作品，點此看更多。', '<a href="https://www.pinkoi.com/browse">看更多</a>');
  const listed = thread('客服中心 <support@fake-exchange-abc.com>', '出金通知', '您的出金申請已受理，請登入查看：', '<a href="https://www.fake-exchange-abc.com/login">登入</a>');
  const old = thread('國稅局 <a@b-scam.com>', '舊信', '舊的詐騙信', '<a href="https://ctbc-bank.top/">x</a>', 60 * 48);
  const threads = [etax, cht, mvdis, news, listed, old];
  const lists = {
    twnic: 'scam-from-list.top\nwww.google.com\n',
    g0v: '﻿WEBSITE_NM,WEBURL,CNT,STA_SDATE,STA_EDATE\n網站名稱,網址,件數,統計起始日期,統計結束日期\n假交易所,www.fake-exchange-abc.com,3,2026/10/01,2026/10/07\n',
  };
  const { sandbox, triggers, cache } = makeSandbox(threads, lists);
  vm.createContext(sandbox);
  assert.equal(vm.runInContext('typeof URL', sandbox), 'undefined'); // 和 Apps Script 一樣沒有 URL
  vm.runInContext(buildEngine(), sandbox);
  vm.runInContext(readFileSync(new URL('../gmail/Code.gs', import.meta.url), 'utf8'), sandbox);
  const counts = vm.runInContext('install()', sandbox);

  assert.deepEqual(etax.labels, ['官網守門員/疑似詐騙']);
  assert.equal(etax.archived, true);
  assert.deepEqual(cht.labels, ['官網守門員/疑似詐騙']);
  assert.equal(cht.archived, true);
  assert.deepEqual(listed.labels, ['官網守門員/疑似詐騙']); // 165 清單上的網域
  assert.deepEqual(mvdis.labels, []);
  assert.equal(mvdis.archived, false);
  assert.deepEqual(news.labels, []);
  assert.deepEqual(old.labels, []); // 超過往回檢查的時間範圍
  assert.equal(counts.scam, 3);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].n, 10);
  assert.ok(cache.get('oug:list:n')); // 清單已快取
  // 清單淨化：TWNIC 清單裡混進 www.google.com 也不會把 Google 的信當成詐騙
  const g = thread('Google <no-reply@accounts.google.com>', '安全性快訊', '你的帳戶有新的登入。', '<a href="https://www.google.com/">查看</a>');
  threads.push(g);
  const again = vm.runInContext('scanInbox()', sandbox);
  assert.deepEqual(g.labels, []);
  assert.equal(again.checked, 1); // 已檢查過的信不重複處理
  vm.runInContext('uninstall()', sandbox);
  assert.equal(triggers.length, 0);
});
