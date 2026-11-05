// 裝置端 AI 判讀的規則（AI 本身在 Chrome 裡執行；這裡測「怎麼使用 AI 的回答」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, assessUrl, assessPage, aiGrounded } from '../src/lib/checker.js';

const ctx = buildContext();
const page = (url, s) => assessPage({ title: '', bodyText: '', fields: {}, ...s }, ctx, assessUrl(url, ctx));
const login = { title: 'Member Login', identityText: 'MEGA ICBC', bodyText: 'Please enter your user ID, password and SMS verification code to continue.', fields: { password: true, otp: true } };

test('AI 說的機構名稱必須在網頁上找得到根據', () => {
  assert.equal(aiGrounded('臺北市停車管理工程處', '北市停管處 停車費繳納'), true); // 簡稱
  assert.equal(aiGrounded('中華郵政', '北市停管處 停車費繳納'), false); // 憑空捏造
  assert.equal(aiGrounded('MEGA ICBC', 'Welcome to MEGA ICBC online'), true);
  assert.equal(aiGrounded('Online Bank Service', 'Welcome back'), false); // 只有一般字
});

test('關鍵字看不出自稱誰的網銀登入頁：AI 判讀為兆豐銀行 → 危險', () => {
  const before = page('https://secure-member-login.com/', login);
  assert.notEqual(before.level, 'danger');
  const v = page('https://secure-member-login.com/', { ...login, ai: { org: 'MEGA ICBC', official: '兆豐國際商業銀行', isGov: false } });
  assert.equal(v.level, 'danger');
  assert.match(v.reasons[0].text, /裝置端 AI 判讀.*MEGA ICBC.*兆豐/);
  assert.equal(v.impersonating.domain, 'megabank.com.tw');
  assert.equal(v.page.ai.matched, '兆豐國際商業銀行');
});

test('AI 捏造網頁上沒有的機構、或網頁沒要錢沒要密碼時，AI 不影響結果', () => {
  const fake = page('https://secure-member-login.com/', { ...login, ai: { org: '中華郵政', official: '中華郵政股份有限公司', isGov: false } });
  assert.notEqual(fake.level, 'danger');
  assert.equal(fake.page.ai, null);
  const blog = page('https://my-travel-blog.net/', { title: 'MEGA ICBC 信用卡心得', bodyText: '分享我的 MEGA ICBC 信用卡使用心得', ai: { org: 'MEGA ICBC', official: '兆豐國際商業銀行', isGov: false } });
  assert.notEqual(blog.level, 'danger');
});

test('AI 判讀為政府機關（不在官方清單的機關名稱）', () => {
  const v = page('https://fee-pay-center.net/', { title: '繳費中心', bodyText: '新北交通局通知：您有一筆費用未繳，請輸入卡號', fields: { card: true },
    ai: { org: '新北交通局', official: '新北市政府交通局', isGov: true } });
  assert.equal(v.level, 'danger');
  assert.ok(v.reasons.some((r) => /裝置端 AI 判讀/.test(r.text)));
});
