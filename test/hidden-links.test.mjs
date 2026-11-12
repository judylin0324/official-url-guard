// 看不到的連結（src/content/hidden-links.js）：從按鈕事件與網頁程式裡找出會被帶去的網址
import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/content/hidden-links.js';

const { urlsIn, navUrls, deepUrls, hiddenLinksInHtml } = globalThis.OUG_hiddenLinks;

test('隱藏連結：找出各種 JavaScript 跳轉寫法裡的網址', () => {
  assert.deepEqual(navUrls(`location.href='https://mvdis-gov-tw.cc/pay'`), ['https://mvdis-gov-tw.cc/pay']);
  assert.deepEqual(navUrls(`window.location = "https://a-scam.top/x";`), ['https://a-scam.top/x']);
  assert.deepEqual(navUrls('window.location.replace(`https://b-scam.top/`)'), ['https://b-scam.top/']);
  assert.deepEqual(navUrls(`document.location.assign('//c-scam.top/login')`), ['//c-scam.top/login']);
  assert.deepEqual(navUrls(`window.open('https://d-scam.top/', '_blank')`), ['https://d-scam.top/']);
  assert.deepEqual(navUrls(`link.href = 'https://e-scam.top/'; form.action = "https://f-scam.top/post";`), ['https://e-scam.top/', 'https://f-scam.top/post']);
});

test('隱藏連結：用 base64 藏起來的網址也解得開', () => {
  const b64 = Buffer.from('https://www.mvdis.gov.tw.pay-fine.top/login').toString('base64');
  assert.deepEqual(navUrls(`btn.onclick = () => { window.location.href = atob('${b64}'); }`), ['https://www.mvdis.gov.tw.pay-fine.top/login']);
  assert.deepEqual(navUrls(`const u = atob("${b64}"); go(u);`), ['https://www.mvdis.gov.tw.pay-fine.top/login']);
});

test('隱藏連結：不是跳轉的字串、相對路徑、一般程式不會被當成網址', () => {
  assert.deepEqual(navUrls(`location.href = '/member/login'; location.hash = '#top';`), []);
  assert.deepEqual(navUrls(`const api = 'https://api.example.com/v1'; fetch(api);`), []);
  assert.deepEqual(navUrls(`el.title = 'open'; reopen('later'); atob('Zm9vYmFy');`), []);
  assert.deepEqual(navUrls(''), []);
});

test('隱藏連結：事件屬性裡的完整網址', () => {
  assert.deepEqual(urlsIn(`go('https://x-scam.top/a?b=1'); track("//cdn.example.com/p.gif")`), ['https://x-scam.top/a?b=1', '//cdn.example.com/p.gif']);
  assert.deepEqual(urlsIn('return false;'), []);
});

test('隱藏連結：沒有 DOMParser 的環境（Node）不會出錯', () => {
  assert.deepEqual(hiddenLinksInHtml('<a href="https://x.top/">按我</a>', '按我'), []);
});

test('深度掃描：整段程式碼裡的網址都找得到，不限跳轉指令', () => {
  assert.deepEqual(deepUrls(`const cfg = { target: "https://mvdis-gov-tw.cc/pay", retry: 3 }; function go(){ jump(cfg.target); }`), ['https://mvdis-gov-tw.cc/pay']);
  assert.deepEqual(deepUrls('var a = 1; // 沒有網址'), []);
});

test('深度掃描：拆字相加、跳脫字元、base64、百分比編碼、fromCharCode、倒著寫都解得開', () => {
  const target = 'https://mvdis-gov-tw.cc/pay';
  const has = (code) => assert.ok(deepUrls(code).includes(target), code.slice(0, 70));
  has(`var u = 'https://mvdis-' + 'gov-tw' + ".cc/pay"; setTimeout(function(){ top[k] = u; }, 9);`);
  has(`var u = "${[...target].map((c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}";`);
  has(`var u = "https:\\/\\/mvdis-gov-tw.cc\\/pay";`);
  has(`var p = ['${Buffer.from(target).toString('base64')}', 'x']; go(decode(p[0]));`);
  has(`go(decodeURIComponent('${[...target].map((c) => '%' + c.charCodeAt(0).toString(16)).join('')}'));`);
  has(`var u = String.fromCharCode(${[...target].map((c) => c.charCodeAt(0)).join(', ')});`);
  has(`var u = '${[...target].reverse().join('')}'.split('').reverse().join('');`);
});
