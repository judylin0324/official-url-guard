# 官網守門員 維護手冊

平常不需要做任何事：清單每天自動更新，測試與發布都是自動的。這份手冊列出「需要人處理」的情況與做法。架構見 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 例行檢查

| 頻率 | 看什麼 | 在哪裡看 | 正常的樣子 |
|---|---|---|---|
| 每週 | GitHub Actions 有沒有失敗 | repo 的 Actions 分頁 | 全部綠色 |
| 每週 | 有沒有新的誤判／漏判回報、清單來源異常 | repo 的 Issues 分頁 | 沒有標籤 `feed-health` 的未結 Issue |
| 每週 | 每週評估報告 | `reports/eval-latest.txt` | 命中率沒有明顯下降；熱門網站誤判沒有增加 |
| 每季 | 補齊 Logo 指紋 | 見下方 | |
| 每季 | 小模型是否需要重新訓練 | 每週評估報告最後一段 | |

## 遇到狀況怎麼辦

### 涉詐清單來源異常（收到標籤 `feed-health` 的 Issue）

每日彙整發現某個來源下載失敗或筆數驟降時會自動開 Issue。清單仍照常發布（沿用該來源上次成功的資料），所以不緊急。

1. 看 Issue 裡是哪個來源、什麼問題。
2. 打開 `src/data/list-sources.js` 裡該來源的 `page`，確認來源是不是搬家、改檔名或停止維護。
3. 搬家：改 `url`。停止維護：刪除那一筆（並考慮找替代來源）。筆數真的大幅減少（來源自己清理了舊資料）：刪除 `feed/sources/<id>.txt` 後重跑，讓它接受新的筆數。
4. 推送後到 Actions 手動執行「每日涉詐清單彙整」。恢復正常後 Issue 會自動關閉。

### 有人回報誤判（正常網站被警告）

1. 確認網域真的屬於該機構（官方公告、165 全民防騙網）。
2. 是官方網站：加進 `src/data/official-sites.js`。是一般網站被規則誤判：在 `test/corpus.mjs` 的 `LEGIT` 加上這個網址，再調整 `src/lib/checker.js` 讓測試通過。
3. `npm test` 通過後推送。官方清單會在幾分鐘內發布，使用者隔天自動更新。

### 有人回報漏判（詐騙沒有被警告）

1. 網址類：在 `test/corpus.mjs` 的 `SCAM` 加上樣式（改成虛構範例，不要放真實詐騙網址），調整規則。
2. 訊息類：在 `test/checker.test.mjs` 加一則案例（移除個資與追蹤代碼）。
3. 單一網址：請回報者同時到網詐通報查詢網通報，進了 165／TWNIC 清單就會自動攔截。

### 信箱、簡訊或通訊軟體網頁版沒有顯示警告

多半是對方網站改版。工具列視窗會顯示「找不到訊息內容，可能是網站改版了」。

1. 在該網站按 F12，找出訊息文字所在元素的選擇器。
2. 修改 `src/adapters/message-sites.js` 裡那個網站的 `message`（聊天）或 `body`（信箱）。
3. 在 `test/e2e.mjs` 的模擬頁面補上新的版面，確認測試通過。

### 補齊 Logo 指紋（要用台灣的網路）

GitHub 的機器在國外，許多台灣政府與銀行網站擋國外連線，要在台灣的電腦上補跑（上次：2026/11/12，374／446 個機構有指紋）。需要先安裝 Node.js 22 以上：

```bash
npm install --no-save playwright@1.63.0
npx playwright install chromium
node tools/build-logo-hashes.mjs
```

完成後把 `src/data/logo-hashes.js` 提交到 GitHub。之後每週的自動更新會沿用這些指紋。

Windows 可以直接雙擊：

- `tools\build-logo-hashes.cmd`：全部重建（20–40 分鐘）。
- `tools\build-logo-hashes-missing.cmd`：只補還沒有指紋的機構，並開啟看得到的瀏覽器視窗（幾分鐘）。有些網站在背景模式下不提供圖片，用一般視窗才抓得到；遇到驗證畫面的網站會跳過。

### 發行新版本

1. 改 `manifest.json` 與 `package.json` 的 `version`。
2. `npm test`、`node test/e2e.mjs` 通過後推送，再推版本標籤（例如 `v0.8.0`）。
3. 「打包發行版」會自動建立 GitHub Release 並附上 zip。

## 本機開發

```bash
npm test                    # 單元測試（Node.js 22+，不需要安裝任何套件）
node test/e2e.mjs           # 端對端測試（需要 playwright 與 Chromium，約 5 分鐘）
node tools/build-feed.mjs   # 試跑涉詐清單彙整
node tools/build-pages.mjs  # 產生 GitHub Pages 網站內容到 _site/
```
