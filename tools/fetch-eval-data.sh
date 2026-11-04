#!/usr/bin/env bash
# 下載評估用的公開資料（tools/eval-real.mjs、tools/train-model.mjs 使用）
# 用法：bash tools/fetch-eval-data.sh [資料夾，預設 eval-data]
set -euo pipefail
D="${1:-eval-data}"
mkdir -p "$D/cases"
RAW=https://raw.githubusercontent.com

echo "下載 TWNIC 停止解析詐騙網域…"
curl -fsSL "$RAW/lf94878964/Taiwan-Blocked-Domains/main/taiwan_blocked_domain.json" -o "$D/twnic.json"

echo "下載 165 假投資（博弈）網站（g0v 鏡像）…"
curl -fsSL "$RAW/g0v-data/165-data/main/gamble.csv" -o "$D/gamble.csv"

echo "下載 Chrome 台灣熱門網站（最近一個月有資料的檔案）…"
got=""
for back in 1 2 3 4; do
  ym=$(date -u -d "$(date -u +%Y-%m-15) -${back} month" +%Y%m)
  if curl -fsSL "$RAW/InternetHealthReport/crux-top-lists-country/main/data/country/tw/${ym}.csv.gz" -o "$D/crux-tw.csv.gz"; then got=$ym; break; fi
done
[ -n "$got" ] || { echo "找不到 Chrome 熱門網站資料" >&2; exit 1; }
echo "  使用 ${got}"

echo "下載標註訊息案例…"
rm -rf "$D/mu"
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/batterycat/message-unpacked.git "$D/mu"
git -C "$D/mu" sparse-checkout set content/cases
cp "$D"/mu/content/cases/*.yaml "$D/cases/"
rm -rf "$D/mu"
echo "完成：$D"
