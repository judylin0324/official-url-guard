# 官網守門員 架構說明

這份文件說明各部分怎麼分工、資料怎麼流動，以及要加新功能時該動哪裡。日常維護步驟見 [MAINTENANCE.md](MAINTENANCE.md)。

## 四層架構

```
使用者入口（在哪裡偵測）
  ├─ Chrome／Edge 擴充功能      manifest.json、src/background.js、src/content.js、src/pages/
  │    └─ 訊息轉接層            src/adapters/message-sites.js（信箱、簡訊、通訊軟體網頁版，一個網站一筆設定）
  ├─ 手機檢查網頁（可安裝成 App）web/template.html、web/manifest.webmanifest、web/sw.js
  └─ Gmail 收件匣過濾            gmail/Code.gs（在使用者自己的 Google 帳號執行）
        │  送入：網址、網頁訊號、訊息文字
        ▼
判斷引擎（怎麼判斷；純計算，不碰瀏覽器 API，三個入口共用同一份）
  src/lib/checker.js   assessUrl（網址）、assessPage（網頁內容）、assessMessage（簡訊／Email）
  src/lib/domain.js、qr.js、image-hash.js、label-model-core.js
        ▲  載入：清單與參數
        │
資料（拿什麼比對；與程式分開，每天線上更新）
  src/data/official-sites.js   官方網站清單（人工維護，唯一一定要人確認的資料）
  feed/blocklist.txt           每日彙整的涉詐網域清單（自動）
  src/data/logo-hashes.js      官網 Logo 指紋（自動，每週）
  src/data/risk-data.js、payment-data.js、label-model.js   風險參數、金流、小模型
        ▲  發布更新
        │
自動化（怎麼保持最新；全部是 GitHub Actions，不需要自己的伺服器）
  test.yml          每次推送：單元測試、端對端測試
  daily-feed.yml    每天：彙整涉詐清單、來源健檢（異常自動開 Issue）
  logo-hashes.yml   每週：重建 Logo 指紋
  weekly-eval.yml   每週：用真實詐騙資料量測命中率與誤判
  pages.yml         發布手機網頁、官方清單、涉詐清單、Logo 指紋到 GitHub Pages
  release.yml       推版本標籤：打包擴充功能與 Gmail 指令碼
```

設計原則：

1. **判斷只寫一次。** 新增入口不重寫判斷邏輯，只負責把網址或訊息文字送進引擎。`tools/build-web.mjs`、`tools/build-gmail.mjs` 把同一份引擎打包給手機網頁與 Gmail。
2. **判斷在使用者的裝置上完成。** 不上傳瀏覽紀錄與輸入內容；連網只為了下載清單。
3. **資料與程式分開。** 清單類資料放在專案網站（GitHub Pages），擴充功能每天下載，不用等改版。
4. **下載的資料一律先檢查。** 涉詐清單先剔除官方與政府網域（`sanitizeDomains`）；官方清單通過 `validateRemoteOfficial` 才採用。任何一份線上資料被竄改，都不能把官方網站擋掉，也不能把詐騙網域變成官方。
5. **會壞的地方要有人知道。** 清單來源異常自動開 Issue；訊息網站改版找不到訊息時，工具列視窗會顯示提示。

## 一次判斷的資料流（擴充功能）

| 時機 | 誰負責 | 做什麼 |
|---|---|---|
| 送出請求前 | `background.js` 的 declarativeNetRequest 規則 | 涉詐清單與自訂封鎖的網域直接導到警告頁 |
| 導航時 | `background.js` → `assessUrl` | 仿冒網址顯示警告頁；結果存進分頁狀態、更新徽章 |
| 網頁載入後 | `content.js` 擷取訊號 → `background.js` → `assessPage` | 比對「自稱是誰」「要你做什麼」與網址 |
| 開信、看訊息時 | `content.js` 依 `src/adapters/message-sites.js` 讀取內容 → `assessMessage` | 信件上方警告；簡訊與聊天訊息浮動警告或外框 |
| 送出卡號、驗證碼前 | `content.js`、`page-watch.js` | 送出前確認；偵測打字途中偷傳卡號 |

## 涉詐清單的兩層來源

```
原始來源（TWNIC 社群整理、165 假投資 g0v 鏡像）
   │  每天 03:17，GitHub Actions：下載 → 健檢 → 合併 → 淨化
   ▼
feed/blocklist.txt ──發布──▶ https://judylin0324.github.io/official-url-guard/blocklist.txt
                                   │
擴充功能、Gmail 過濾 ◀──每天下載──┘     下載不到、太舊（超過 4 天）、筆數異常 → 自動改抓原始來源
擴充功能另外直接下載：內政部官方來源（只接受台灣網路連線，GitHub 的機器抓不到）
```

來源清單只有一個地方：`src/data/list-sources.js`。加上 `inFeed: true` 的來源由每日彙整處理，隔天就會出現在所有使用者的清單裡，不必發新版。

## 要加東西時動哪裡

| 想做的事 | 改哪裡 | 要補的測試 |
|---|---|---|
| 新增官方網站 | `src/data/official-sites.js` | `npm test`（語料不能新增誤判） |
| 新增涉詐清單來源 | `src/data/list-sources.js` | `node tools/build-feed.mjs` 試跑一次 |
| 支援新的信箱或通訊軟體網頁版；網站改版修選擇器 | `src/adapters/message-sites.js` | `test/adapters.test.mjs`、`test/e2e.mjs` 加一個模擬頁 |
| 新的詐騙手法（關鍵字、名目） | `src/lib/checker.js`、`src/data/official-sites.js` | `test/checker.test.mjs` 加真實案例 |
| 新的入口（例如 LINE 機器人） | 新資料夾；用 `tools/build-web.mjs` 的方式打包引擎 | 比照 `test/gmail.test.mjs` 在模擬環境執行 |

## 尚未完成（依優先順序）

1. LINE 官方帳號機器人：使用者轉傳可疑訊息即回覆判斷。需要雲端服務（這是唯一不在使用者裝置上判斷的入口，隱私權政策要另外說明）。
2. 上架 Chrome 線上應用程式商店、Edge 外掛商店；Firefox 版（含 Android）。
3. 程式重整：`checker.js`、`content.js`、`background.js` 依職責拆檔；判斷規則裡的詞彙表資料化並線上更新。
4. 約 95 個擋國外連線的官方網站缺 Logo 指紋，要從台灣的網路補跑（見 MAINTENANCE.md）。
5. 裝置端 AI 尚未在真正內建模型的 Chrome 上驗證。
6. 簡訊與通訊軟體網頁版的選擇器只用模擬頁面測試過，需要在真實帳號上確認。
