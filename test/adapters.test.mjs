// 訊息網站轉接設定（src/adapters/message-sites.js）：網址對應、設定完整性
import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/adapters/message-sites.js';

const SITES = globalThis.OUG_MESSAGE_SITES;
const find = globalThis.OUG_findMessageSite;
const idOf = (host, path = '/') => (find(host, path) || {}).id || null;

test('轉接設定：每個網站都有必要欄位，id 不重複', () => {
  assert.ok(SITES.length >= 7);
  assert.equal(new Set(SITES.map((s) => s.id)).size, SITES.length);
  for (const s of SITES) {
    assert.ok(s.id && s.name && s.host instanceof RegExp, s.id);
    if (s.kind === 'mail') {
      assert.ok(typeof s.body === 'string' && s.body.length, `${s.id} 缺 body`);
      for (const fn of ['container', 'sender', 'subject']) assert.equal(typeof s[fn], 'function', `${s.id} 缺 ${fn}`);
    } else {
      assert.equal(s.kind, 'chat', s.id);
      assert.ok(typeof s.message === 'string' && s.message.length, `${s.id} 缺 message`);
    }
  }
});

test('轉接設定：網頁信箱、簡訊、通訊軟體網頁版對應到正確的設定', () => {
  assert.equal(idOf('mail.google.com'), 'gmail');
  assert.equal(idOf('outlook.live.com'), 'outlook');
  assert.equal(idOf('outlook.office.com'), 'outlook');
  assert.equal(idOf('tw.mail.yahoo.com'), 'yahoo');
  assert.equal(idOf('messages.google.com', '/web/conversations/12'), 'google-messages');
  assert.equal(idOf('www.messenger.com', '/t/123'), 'messenger');
  assert.equal(idOf('web.telegram.org', '/k/'), 'telegram');
  assert.equal(idOf('web.whatsapp.com'), 'whatsapp');
});

test('轉接設定：facebook.com 只有訊息頁才檢查；長得像的網域不套用', () => {
  assert.equal(idOf('www.facebook.com', '/'), null);
  assert.equal(idOf('www.facebook.com', '/marketplace/item/1'), null);
  assert.equal(idOf('www.facebook.com', '/messages/t/123'), 'messenger');
  assert.equal(idOf('messages.google.com.evil.top'), null);
  assert.equal(idOf('web.whatsapp.com.login-verify.cc'), null);
  assert.equal(idOf('mail.google.com.tw-secure.top'), null);
  assert.equal(idOf('www.google.com'), null);
});

test('轉接設定：巢狀元素只取最外層', () => {
  const node = (children = []) => { const n = { children, contains: (x) => n === x || children.some((c) => c.contains(x)) }; return n; };
  const inner = node();
  const outer = node([inner]);
  const other = node();
  assert.deepEqual(globalThis.OUG_outermost([outer, inner, other]), [outer, other]);
});
