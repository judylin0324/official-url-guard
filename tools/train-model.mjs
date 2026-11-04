// 訓練「網域名稱」小模型：判斷網域名稱是不是像詐騙網站常見的隨機或仿冒命名。
// 只看名稱本身（不看後綴，後綴風險另外計分），字元 n-gram 加上邏輯迴歸，全部在本機執行。
//
// 用法：node tools/train-model.mjs <資料夾> [--write]
//   資料夾內容同 tools/eval-real.mjs（twnic.json、gamble.csv、crux-tw.csv.gz）
//   --write：把模型寫入 src/data/label-model.js
//
// 切分方式（避免「考古題」）：
//   詐騙：2025-07-01 以前通報的用來訓練，之後的用來測試（模擬遇到新手法）
//   正常：Chrome 台灣熱門網站前 10 萬名，依網域雜湊 8:2 切分，測試集完全沒看過
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHost } from '../src/lib/domain.js';
import { labelFeatures, MODEL_DIM } from '../src/lib/label-model-core.js';

const dir = process.argv[2];
const WRITE = process.argv.includes('--write');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CUTOFF = '20250701';

const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const labelOf = (host) => { const p = parseHost(host); return p.platform ? '' : p.label; };

// 詐騙
const scamTrain = new Set(), scamTest = new Set();
for (const r of JSON.parse(readFileSync(path.join(dir, 'twnic.json'), 'utf8'))) {
  const l = labelOf(r.domain_name);
  if (l) (String(r.report_received_date) < CUTOFF ? scamTrain : scamTest).add(l);
}
for (const line of readFileSync(path.join(dir, 'gamble.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(2)) {
  const [, url, , start] = line.split(',');
  if (!url) continue;
  let host;
  try { host = new URL(/^https?:/.test(url) ? url : 'https://' + url).hostname; } catch { continue; }
  const l = labelOf(host);
  if (l) ((start || '').replace(/\//g, '') < CUTOFF ? scamTrain : scamTest).add(l);
}
// 正常（前 10 萬名；排名越後面越可能混入詐騙站）
const legitTrain = new Set(), legitTest = new Set();
for (const line of gunzipSync(readFileSync(path.join(dir, 'crux-tw.csv.gz'))).toString('utf8').split('\n').slice(1)) {
  const [origin, rank] = line.split(',');
  if (!origin || Number(rank) > 100000) continue;
  let l;
  try { l = labelOf(new URL(origin).hostname); } catch { continue; }
  if (!l || scamTrain.has(l) || scamTest.has(l)) continue;
  (hash(l) % 5 === 0 ? legitTest : legitTrain).add(l);
}
for (const l of legitTest) legitTrain.delete(l);
for (const l of scamTest) scamTrain.delete(l);
console.log(`訓練：詐騙 ${scamTrain.size}、正常 ${legitTrain.size}｜測試：詐騙 ${scamTest.size}、正常 ${legitTest.size}`);

// 邏輯迴歸（隨機梯度下降、L2、類別平衡）
const data = [...[...scamTrain].map((l) => [labelFeatures(l), 1]), ...[...legitTrain].map((l) => [labelFeatures(l), 0])];
const wPos = data.length / (2 * scamTrain.size), wNeg = data.length / (2 * legitTrain.size);
const W = new Float64Array(MODEL_DIM);
let b = 0;
const lr0 = 0.05, l2 = 1e-6;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let epoch = 0; epoch < 6; epoch++) {
  for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [data[i], data[j]] = [data[j], data[i]]; }
  const lr = lr0 / (1 + epoch);
  for (const [f, y] of data) {
    let z = b;
    for (const [k, v] of f) z += W[k] * v;
    const p = 1 / (1 + Math.exp(-z));
    const g = (p - y) * (y ? wPos : wNeg);
    for (const [k, v] of f) W[k] -= lr * (g * v + l2 * W[k]);
    b -= lr * g;
  }
}
const score = (l) => { let z = b; for (const [k, v] of labelFeatures(l)) z += W[k] * v; return 1 / (1 + Math.exp(-z)); };

// 在測試集上找門檻：正常網站誤判率 0.5%、0.2%
const legitScores = [...legitTest].map(score).sort((x, y) => y - x);
const scamScores = [...scamTest].map(score);
const thresholdAt = (fpr) => legitScores[Math.floor(legitScores.length * fpr)];
const report = {};
for (const fpr of [0.02, 0.01, 0.005, 0.002]) {
  const t = thresholdAt(fpr);
  const recall = scamScores.filter((s) => s >= t).length / scamScores.length;
  report[fpr] = { threshold: t, recall };
  console.log(`正常網站誤判 ${(fpr * 100).toFixed(1)}% 的門檻 ${t.toFixed(3)} → 新詐騙網域抓到 ${(recall * 100).toFixed(1)}%`);
}

if (WRITE) {
  // 量化成 8 位元整數，檔案約 10 KB
  const maxAbs = W.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const scale = maxAbs / 127;
  const q = Int8Array.from(W, (x) => Math.round(x / scale));
  const b64 = Buffer.from(q.buffer).toString('base64');
  const out = `// 自動產生：node tools/train-model.mjs <資料夾> --write（請勿手動修改）
// 網域名稱小模型。訓練資料：TWNIC 停止解析詐騙網域與 165 假投資網站（${CUTOFF.slice(0, 4)}/${CUTOFF.slice(4, 6)} 以前），
// 以及 Chrome 台灣熱門網站前 10 萬名的八成。
// 測試集（${CUTOFF.slice(0, 4)}/${CUTOFF.slice(4, 6)} 以後的新詐騙網域、沒看過的兩成熱門網站）：
//   正常網站誤判 0.5% 時抓到 ${(report[0.005].recall * 100).toFixed(1)}%；誤判 0.2% 時抓到 ${(report[0.002].recall * 100).toFixed(1)}%
export const LABEL_MODEL = {
  dim: ${MODEL_DIM},
  scale: ${scale},
  bias: ${b},
  weights: '${b64}',
  // 門檻：正常網站誤判率 0.5% 與 0.2%（以測試集量測）
  t1: ${report[0.005].threshold},
  t2: ${report[0.002].threshold},
};
`;
  writeFileSync(path.join(root, 'src/data/label-model.js'), out);
  console.log(`已寫入 src/data/label-model.js（${Math.round(out.length / 1024)} KB）`);
}
