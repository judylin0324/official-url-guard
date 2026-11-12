// 每日涉詐清單彙整（tools/feed-core.mjs）與清單來源設定
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeSource, buildFeed, problemReport } from '../tools/feed-core.mjs';
import { LIST_SOURCES, FEED } from '../src/data/list-sources.js';
import { parseDomainList, sanitizeDomains } from '../src/lib/blocklist.js';
import { buildContext } from '../src/lib/checker.js';

const SRC = { id: 'x', name: '測試來源' };
const NOW = '2026-11-12T00:00:00.000Z';
const many = (n, tag = 'a') => Array.from({ length: n }, (_, i) => `${tag}${i}.example-scam.top`);

test('清單彙整：下載成功就採用新資料並排序去重', () => {
  const m = mergeSource(SRC, many(100), { ok: true, domains: ['b.top', 'a.top', 'a.top'] .concat(many(120)) }, '2026-11-11T00:00:00.000Z', NOW);
  assert.equal(m.problem, null);
  assert.equal(m.status.ok, true);
  assert.equal(m.status.count, 122);
  assert.equal(m.status.lastOkAt, NOW);
  assert.deepEqual(m.domains.slice(0, 2), ['a.top', 'a0.example-scam.top']);
});

test('清單彙整：下載失敗、找不到網域、筆數驟降 → 沿用上次資料並回報問題', () => {
  const prev = many(1000);
  const failed = mergeSource(SRC, prev, { ok: false, error: 'HTTP 404' }, '2026-11-10T00:00:00.000Z', NOW);
  assert.equal(failed.domains, prev);
  assert.equal(failed.status.carried, true);
  assert.equal(failed.status.lastOkAt, '2026-11-10T00:00:00.000Z');
  assert.match(failed.problem, /下載失敗：HTTP 404（沿用上次的 1000 筆，2026-11-10）/);
  assert.match(mergeSource(SRC, prev, { ok: true, domains: [] }, null, NOW).problem, /找不到網域/);
  const dropped = mergeSource(SRC, prev, { ok: true, domains: many(600) }, null, NOW);
  assert.equal(dropped.domains.length, 1000);
  assert.match(dropped.problem, /筆數從 1000 驟降到 600/);
  // 少一成屬於正常波動（來源下架了舊網域）
  assert.equal(mergeSource(SRC, prev, { ok: true, domains: many(900) }, null, NOW).problem, null);
  // 第一次執行沒有舊資料可沿用
  const first = mergeSource(SRC, [], { ok: false, error: '連線逾時' }, null, NOW);
  assert.equal(first.status.carried, false);
  assert.match(first.problem, /沒有可沿用的資料/);
});

test('清單彙整：合併後剔除官方與政府網域', () => {
  const ctx = buildContext();
  const { domains, removed } = buildFeed(
    [{ domains: ['scam-b.top', 'google.com', 'scam-a.top'] }, { domains: ['scam-a.top', 'mvdis.gov.tw'] }],
    (d) => sanitizeDomains(d, ctx),
  );
  assert.deepEqual(domains, ['scam-a.top', 'scam-b.top']);
  assert.deepEqual(removed, ['google.com', 'mvdis.gov.tw']);
});

test('清單彙整：問題報告列出每個來源的狀態', () => {
  const text = problemReport(['測試來源：下載失敗'], { generatedAt: NOW, count: 5, sources: [{ name: '測試來源', ok: false, carried: true, count: 5, previous: 5, lastOkAt: '2026-11-10T00:00:00.000Z' }] });
  assert.match(text, /發現 1 個問題/);
  assert.match(text, /\| 測試來源 \| 沿用舊資料 \| 5 \| 5 \| 2026-11-10 \|/);
});

test('清單來源設定：彙整清單指向專案網站；至少有一個來源進彙整、一個來源由使用者直接下載', () => {
  assert.match(FEED.url, /^https:\/\/judylin0324\.github\.io\/official-url-guard\/blocklist\.txt$/);
  assert.ok(LIST_SOURCES.some((s) => s.inFeed));
  assert.ok(LIST_SOURCES.some((s) => !s.inFeed));
  for (const s of LIST_SOURCES) assert.ok(s.id && s.name && /^https:\/\//.test(s.url) && /^https:\/\//.test(s.page), s.id);
});

test('已提交的彙整清單：格式正確、筆數合理、不含官方網域', () => {
  const meta = JSON.parse(readFileSync(new URL('../feed/meta.json', import.meta.url), 'utf8'));
  const domains = parseDomainList(readFileSync(new URL('../feed/blocklist.txt', import.meta.url), 'utf8'));
  assert.equal(domains.length, meta.count);
  assert.ok(domains.length >= FEED.minCount, `只有 ${domains.length} 筆`);
  assert.equal(sanitizeDomains(domains, buildContext()).removed.length, 0);
  assert.ok(!Number.isNaN(Date.parse(meta.generatedAt)));
});
