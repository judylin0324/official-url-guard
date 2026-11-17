# 官網守門員 LINE 機器人

收到可疑的簡訊或 LINE 訊息，轉傳給官方帳號就能檢查；把它加進家族群組，有人貼出詐騙連結時會自動提醒。判斷引擎和 Chrome 擴充功能、手機檢查網頁是同一份程式（`src/lib/checker.js`）。

## 能做什麼

| 功能 | 說明 |
|---|---|
| 轉傳檢查 | 簡訊、LINE 訊息、Email、網址轉傳或貼給機器人，回覆結果卡片：燈號、冒充誰、真正的官方網址、正確的繳費管道 |
| 短網址展開 | `reurl.cc`、`bit.ly` 這類短網址，先向短網址服務問出真正的目的地再判斷（只讀轉址資訊，不會連到最後的網站） |
| 一鍵通報 | 結果卡片上按「一鍵通報這個網址」：①記錄下來（每週整理給維護者，提供給 165）②回覆「複製通報內容」和「開啟網詐通報查詢網」兩個按鈕，兩步完成正式通報 |
| 回報誤判／漏判 | 卡片上直接按，不需要 GitHub 帳號；每週自動彙整成 Issue |
| 傳給親友提醒 | 一鍵把提醒（網址已拆開成 `mvdis-gov-tw[.]cc`，不能誤點）分享給 LINE 好友或群組 |
| 群組自動提醒 | 加進家族群組後，有人貼出很可能是詐騙的連結，引用那則訊息提醒；平常不說話。可用「守門員 關閉／開啟／全部／檢查」調整 |
| 話術提醒 | 沒有網址也會檢查：要你交出驗證碼、先付錢才能領錢、要你保密、要你轉帳 |
| QR Code（選用） | 傳 QR Code 截圖，解出內容再判斷（需要 Workers 付費方案，見下方） |
| 圖文選單 | 聊天室下方六格：檢查可疑訊息、一鍵通報詐騙、撥打 165、保護家人群組、手機檢查網頁、隱私說明 |

## 架構

```
使用者的 LINE ──▶ LINE 平台 ──Webhook──▶ Cloudflare Worker（line-bot/src/worker.js）
                                            │  驗證簽章 → 判斷（src/lib/checker.js，涉詐清單打包在裡面）
                                            │  → 回覆結果卡片（line-bot/src/messages.js）
                                            └─ Cloudflare KV：通報次數、群組設定（不存訊息內容）
GitHub Actions：每日清單彙整完成 → 重新部署（清單更新）；每週一 → 讀取通報彙整、開 Issue
```

| 檔案 | 用途 |
|---|---|
| `src/worker.js` | 進入點：Webhook、事件分派、群組指令、通報彙整 API |
| `src/analyze.js` | 呼叫共用判斷引擎、短網址展開、一鍵通報時還原「冒充誰」 |
| `src/messages.js` | **所有回覆文字與 Flex 卡片**（改措辭、版面只要改這裡） |
| `src/store.js` | KV：通報彙整、群組設定、頻率限制 |
| `src/line-api.js` | LINE API：簽章驗證、回覆、讀取圖片、設定 Webhook |
| `src/image.js`、`src/png.js` | 圖片解碼與 QR Code（選用） |
| `tools/setup.mjs`、`setup.cmd` | 第一次部署的設定程式 |
| `tools/richmenu.mjs`、`assets/richmenu.png` | 圖文選單（`render` 重畫圖片、`install` 設定） |
| `tools/validate-messages.mjs` | 請 LINE 平台檢查每一種訊息格式 |
| `test/workerd-smoke.mjs` | 在 Cloudflare 實際執行環境（workerd）測試 |
| `../tools/build-line-bot.mjs` | 把涉詐清單打包成 `src/generated/data.js`（部署時自動執行） |
| `../tools/line-reports.mjs` | 每週通報彙整的 Issue 內容 |

## 第一次部署（約 20 分鐘）

需要：一個 LINE 帳號、一個 Cloudflare 帳號（免費）、電腦上的 Node.js 22 以上。

### 1. 建立 LINE 官方帳號與 Messaging API channel

1. 到 [LINE Official Account Manager](https://manager.line.biz/) 建立官方帳號（名稱建議「官網守門員」）。免費方案即可：機器人只用「回覆」，回覆訊息不計入每月則數。
2. 在官方帳號的「設定 → Messaging API」按「啟用 Messaging API」，選擇或建立一個 Provider。
3. 到 [LINE Developers](https://developers.line.biz/console/) 找到剛建立的 channel：
   - 「Basic settings」分頁的 **Channel secret**
   - 「Messaging API」分頁最下方的 **Channel access token**（按「Issue」產生）
   這兩個值等一下設定程式會問。

### 2. 執行設定程式

Windows：雙擊 `line-bot\setup.cmd`。其他系統：

```bash
cd line-bot
npm install
npm run setup
```

它會依序：

1. 開啟瀏覽器登入 Cloudflare（沒有帳號先免費註冊，按「Allow」授權）
2. 建立 KV 並寫進 `wrangler.toml`
3. 詢問 Channel secret、Channel access token（輸入時不會顯示）
4. 部署到 Cloudflare Workers、設定密鑰（自動產生通報彙整 API 的密鑰、自動帶入加好友連結）
5. 設定 LINE Webhook 網址並測試、請 LINE 檢查每一種訊息格式
6. 設定圖文選單

結果存在 `line-bot/設定結果.txt`（裡面有密鑰，已設定不會上傳到 GitHub）。可以重複執行。

> 第一次使用 Cloudflare Workers 時，如果出現「workers.dev subdomain」的錯誤，先到 Cloudflare 後台的「Workers & Pages」設定一個子網域，再重新執行。

### 3. LINE Official Account Manager 的三個開關

「設定 → 回應設定」：

- Webhook：**開啟**
- 自動回應訊息：**關閉**（不然每則訊息都會多一則罐頭回覆）
- 加入好友的歡迎訊息：**關閉**（機器人會自己送）

「設定 → 帳號設定」：

- 允許加入群組或多人聊天室：**開啟**

### 4. 試用

用手機加官方帳號好友，貼一則測試訊息：

```
【監理服務網】您有一筆交通違規罰鍰逾期未繳，請於今日內至 https://mvdis-gov-tw.cc/pay 繳納
```

應該會收到紅色的「高度疑似詐騙」卡片。

### 5. 讓 GitHub 自動更新（建議）

涉詐清單打包在機器人裡，要重新部署才會更新。到 repo 的 **Settings → Secrets and variables → Actions** 新增：

| 名稱 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 後台 → My Profile → API Tokens → Create Token → 範本「Edit Cloudflare Workers」 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 後台 → Workers & Pages 頁面右側的 Account ID |
| `LINE_BOT_KV_ID` | `設定結果.txt` 裡的值 |
| `LINE_BOT_URL` | `設定結果.txt` 裡的值 |
| `LINE_BOT_REPORTS_TOKEN` | `設定結果.txt` 裡的值 |

設定後：

- 每天涉詐清單彙整完成，「LINE 機器人部署」自動重新部署（`.github/workflows/line-bot.yml`）
- 每週一「LINE 通報彙整」把使用者的通報整理成 Issue（`.github/workflows/line-reports.yml`）

## 費用與限制

| 項目 | 免費額度 | 說明 |
|---|---|---|
| LINE 官方帳號 | 回覆訊息不限則數 | 機器人只用回覆，不主動推播 |
| Cloudflare Workers | 每天 10 萬次請求、每次 10 毫秒 CPU | 一般訊息約 1–5 毫秒。後台出現「Exceeded CPU」錯誤時改用付費方案（每月 5 美元） |
| Cloudflare KV | 每天 10 萬次讀取、1,000 次寫入 | 一次通報寫 2 次，約每天 500 次通報 |
| QR Code 圖片 | — | 解碼一張圖要幾十到幾百毫秒 CPU，**免費方案跑不完**，預設關閉。付費方案可用 `npx wrangler secret put IMAGE_QR` 輸入 `on` 開啟 |

其他限制：

- 機器人只看得到「傳給它的訊息」和「它所在群組的訊息」，看不到使用者和別人的一對一聊天。
- 讀不到圖片裡的文字（截圖請改成複製文字）。
- 「複製通報內容」按鈕需要 LINE 14.0 以上；舊版 LINE 可以長按下一則訊息的文字複製。
- 群組裡只有文字訊息會檢查，照片不讀。

## 隱私

這是本專案唯一在雲端判斷的入口（其他入口都在使用者裝置上判斷），所以特別限制儲存的內容：

- 訊息只在處理那一次請求時讀取，判斷完就丟掉，不寫進任何儲存空間，也不寫進記錄檔。
- 一鍵通報、回報誤判／漏判只記錄：網域、網址路徑（不含查詢參數）、次數、時間。去重用的使用者代號是雜湊，無法還原成 LINE 使用者 ID，30 天後自動刪除。
- 群組設定只存群組代號的雜湊與兩個開關；機器人被移出群組時刪除。
- 短網址展開時，向短網址服務送出的請求來自 Cloudflare，不帶使用者資訊。

完整說明：[隱私權政策](https://judylin0324.github.io/official-url-guard/privacy.html#line)

## 開發

```bash
cd line-bot
npm install
npm test                       # 打包，並在 workerd（Cloudflare 的執行環境）用模擬的 LINE 平台測試
node --test ../test/line-bot.test.mjs   # 單元測試（根目錄的 npm test 也會跑）
npm run dev                    # 本機啟動（wrangler dev）
LINE_CHANNEL_ACCESS_TOKEN=… npm run validate   # 改了卡片版面後，請 LINE 檢查格式
node tools/richmenu.mjs render # 重畫圖文選單圖片（需要 playwright）
```

改回覆文字：只改 `src/messages.js`，跑 `node --test ../test/line-bot.test.mjs`（會檢查 LINE 的長度限制），推到 `main` 後自動部署。
