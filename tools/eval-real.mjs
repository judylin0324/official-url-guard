// 用公開的真實資料評估判斷規則（不匯入任何清單，只看規則本身抓得到多少）
// 用法：node tools/eval-real.mjs <資料夾> [--examples]
//
// 資料夾內需要（取得方式見 README「用真實資料評估」）：
//   twnic.json      TWNIC 停止解析詐騙網域（github.com/lf94878964/Taiwan-Blocked-Domains 的 taiwan_blocked_domain.json）
//   gamble.csv      165 假投資（博弈）網站（github.com/g0v-data/165-data）
//   crux-tw.csv.gz  Chrome 台灣熱門網站（github.com/InternetHealthReport/crux-top-lists-country 的 data/country/tw/*.csv.gz）
//   cases/          標註過的訊息案例 YAML（github.com/batterycat/message-unpacked 的 content/cases）
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { buildContext, assessUrl, assessMessage } from '../src/lib/checker.js';

const dir = process.argv[2];
const showExamples = process.argv.includes('--examples');
if (!dir) { console.error('用法：node tools/eval-real.mjs <資料夾> [--examples]'); process.exit(1); }
const ctx = buildContext();
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '-');
const tally = (rows) => rows.reduce((m, r) => ((m[r.level] = (m[r.level] || 0) + 1), m), {});
const out = {};

function fmt(name, t, total) {
  const d = t.danger || 0, c = t.caution || 0;
  console.log(`${name}：共 ${total}｜危險 ${d}（${pct(d, total)}）｜可疑 ${c}（${pct(c, total)}）｜至少提醒 ${pct(d + c, total)}｜其他 ${total - d - c}`);
}

// 1. TWNIC
const twnicPath = path.join(dir, 'twnic.json');
if (existsSync(twnicPath)) {
  const recs = JSON.parse(readFileSync(twnicPath, 'utf8'));
  const rows = recs.map((r) => {
    let url = r.fake_url && /^https?:\/\//i.test(r.fake_url) ? r.fake_url : 'https://' + r.domain_name;
    try { new URL(url); } catch { url = 'https://' + r.domain_name; }
    const v = assessUrl(url, ctx);
    return { url, level: v.level, score: v.score, what: r.one_page_digital_economy_scam_site || '', reason: v.reasons[0] && v.reasons[0].text };
  });
  out.twnic = rows;
  fmt('TWNIC 停止解析詐騙網址', tally(rows), rows.length);
  // 依「冒充對象」分組
  const groups = {};
  for (const r of rows) {
    const key = r.what.replace(/^Links? to (the )?/i, '').replace(/ (website|homepage|login page|official website).*$/i, '').slice(0, 40) || '(未註明)';
    (groups[key] ||= []).push(r);
  }
  const top = Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, 15);
  for (const [k, rs] of top) {
    const t = tally(rs);
    console.log(`   ${String(rs.length).padStart(4)}  ${k.padEnd(40)} 危險 ${pct(t.danger || 0, rs.length)}  至少提醒 ${pct((t.danger || 0) + (t.caution || 0), rs.length)}`);
  }
  if (showExamples) {
    console.log('   ── 漏掉的例子 ──');
    rows.filter((r) => r.level !== 'danger' && r.level !== 'caution').slice(0, 40).forEach((r) => console.log(`   ${r.level.padEnd(8)} ${r.url.slice(0, 70)}  ← ${r.what.slice(0, 50)}`));
  }
}

// 2. 165 假投資（博弈）
const gamblePath = path.join(dir, 'gamble.csv');
if (existsSync(gamblePath)) {
  const lines = readFileSync(gamblePath, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(2).filter(Boolean);
  const seen = new Set();
  const rows = [];
  for (const line of lines) {
    const [name, host] = line.split(',');
    if (!host || seen.has(host)) continue;
    seen.add(host);
    const url = /^https?:\/\//i.test(host) ? host : 'https://' + host;
    let v;
    try { v = assessUrl(url, ctx); } catch { continue; }
    rows.push({ url, name, level: v.level, reason: v.reasons[0] && v.reasons[0].text });
  }
  out.gamble = rows;
  fmt('165 假投資（博弈）網站', tally(rows), rows.length);
  if (showExamples) {
    console.log('   ── 判為官方或政府的（應檢查）──');
    rows.filter((r) => ['official', 'gov', 'platform'].includes(r.level)).slice(0, 30).forEach((r) => console.log(`   ${r.level.padEnd(8)} ${r.url.slice(0, 60)}  ${r.name}`));
  }
}

// 3. Chrome 台灣熱門網站（測誤判）
const cruxPath = path.join(dir, 'crux-tw.csv.gz');
if (existsSync(cruxPath)) {
  const lines = gunzipSync(readFileSync(cruxPath)).toString('utf8').split('\n').slice(1).filter(Boolean);
  const byRank = {};
  const flagged = [];
  for (const line of lines) {
    const [origin, rank] = line.split(',');
    const v = assessUrl(origin + '/', ctx);
    const b = (byRank[rank] ||= { total: 0, danger: 0, caution: 0 });
    b.total++;
    if (v.level === 'danger' || v.level === 'caution') {
      b[v.level]++;
      flagged.push({ origin, rank: Number(rank), level: v.level, reason: v.reasons[0] && v.reasons[0].text });
    }
  }
  out.crux = flagged;
  console.log('Chrome 台灣熱門網站（誤判檢查；排名越後面越可能本身就是詐騙站）：');
  let cum = { total: 0, danger: 0, caution: 0 };
  for (const rank of Object.keys(byRank).map(Number).sort((a, b) => a - b)) {
    const b = byRank[rank];
    cum = { total: cum.total + b.total, danger: cum.danger + b.danger, caution: cum.caution + b.caution };
    console.log(`   前 ${String(rank).padStart(6)} 名（累計 ${cum.total}）：危險 ${cum.danger}（${pct(cum.danger, cum.total)}）｜可疑 ${cum.caution}（${pct(cum.caution, cum.total)}）`);
  }
  if (showExamples) {
    console.log('   ── 前 5 萬名中被判危險的 ──');
    flagged.filter((f) => f.level === 'danger' && f.rank <= 50000).slice(0, 60).forEach((f) => console.log(`   ${String(f.rank).padStart(6)} ${f.origin.padEnd(45)} ${f.reason.slice(0, 60)}`));
  }
}

// 4. 標註過的訊息案例
const casesDir = path.join(dir, 'cases');
if (existsSync(casesDir)) {
  const rows = [];
  for (const f of readdirSync(casesDir).filter((n) => n.endsWith('.yaml') && !n.startsWith('_'))) {
    const y = readFileSync(path.join(casesDir, f), 'utf8');
    const cls = (y.match(/^classification:\s*(\S+)/m) || [])[1];
    const bodies = [...y.matchAll(/^\s+body:\s*(.+)$/gm)].map((m) => m[1].replace(/^['"]|['"]$/g, '')).filter((b) => !/^[|>]/.test(b));
    const text = bodies.join('\n');
    const r = assessMessage(text, ctx);
    const levels = r.items.map((v) => v.level);
    const top = levels.includes('danger') ? 'danger' : levels.includes('caution') || levels.includes('platform') || r.messageNotes.length ? 'caution' : levels.length ? levels[0] : 'no-url';
    rows.push({ file: f, cls, top, hasUrl: levels.length > 0, text });
  }
  out.cases = rows;
  for (const cls of ['fraud', 'trustworthy', 'insufficient-evidence']) {
    const rs = rows.filter((r) => r.cls === cls);
    if (!rs.length) continue;
    const t = rs.reduce((m, r) => ((m[r.top] = (m[r.top] || 0) + 1), m), {});
    console.log(`訊息案例【${cls}】${rs.length} 則：${Object.entries(t).map(([k, v]) => `${k} ${v}`).join('｜')}`);
  }
  if (showExamples) {
    console.log('   ── 標為「可信」卻被判危險或可疑 ──');
    rows.filter((r) => r.cls === 'trustworthy' && ['danger', 'caution'].includes(r.top)).forEach((r) => console.log(`   ${r.top} ${r.file}: ${r.text.slice(0, 80)}`));
    console.log('   ── 標為「詐騙」、有連結卻沒提醒 ──');
    rows.filter((r) => r.cls === 'fraud' && r.hasUrl && !['danger', 'caution'].includes(r.top)).forEach((r) => console.log(`   ${r.top} ${r.file}: ${r.text.slice(0, 90)}`));
  }
}

export default out;
