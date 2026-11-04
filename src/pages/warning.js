import { h, send, hostWithRegistrable } from './ui.js';

const $ = (id) => document.getElementById(id);
// 兩種來源：導航攔截（網址有編碼）與 165／封鎖清單硬擋（網址原樣接在 url= 後面）
function readTarget() {
  const m = location.search.match(/[?&]url=(.*)$/);
  if (!m) return '';
  const src = new URLSearchParams(location.search.split('&url=')[0]).get('src');
  if (src === 'list') return m[1];
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}
const target = readTarget();
send({ type: 'countBlocked', kind: 'url' });

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 5000);
}

async function init() {
  const v = await send({ type: 'assess', url: target });
  if (!v) return;
  $('host').replaceWith(Object.assign(hostWithRegistrable(v), { id: 'host', className: 'host' }));
  $('reasons').replaceChildren(...v.reasons.filter((r) => r.weight > 0 || v.reasons.length === 1).slice(0, 5).map((r) => h('li', { text: r.text })));

  const imp = v.impersonating;
  if (imp) {
    $('imp').hidden = false;
    $('imp').replaceChildren(
      `這個網址看起來在冒充「${imp.name}」。`,
      imp.domain ? h('span', {}, ['真正的官方網址是 ', h('b', { text: imp.domain }), '。']) : h('span', { text: imp.hint || '' }),
    );
    if (imp.url) {
      $('official').hidden = false;
      $('official').href = imp.url;
      $('official').textContent = `改為前往${imp.name}官方網站`;
    }
  }

  $('leave').addEventListener('click', () => send({ type: 'leave' }));
  $('falsePositive').addEventListener('click', (e) => { e.preventDefault(); send({ type: 'openIssue', kind: 'false-positive', url: v.url }); });
  $('report').addEventListener('click', async () => {
    const r = await send({ type: 'prepareReport', url: v.url });
    if (r && r.text) {
      try { await navigator.clipboard.writeText(r.text); toast('已開啟通報網站，可疑網址與說明已複製，可直接貼上'); } catch { toast('已開啟通報網站'); }
    }
  });
  $('ack').addEventListener('change', (e) => { $('proceed').disabled = !e.target.checked; $('trust').disabled = !e.target.checked; });
  $('trust').addEventListener('click', async () => {
    await send({ type: 'trustDomain', domain: v.registrable || v.host });
    location.replace(v.url);
  });
  $('proceed').addEventListener('click', async () => {
    await send({ type: 'allowHost', host: v.host });
    location.replace(v.url);
  });
}

init();
