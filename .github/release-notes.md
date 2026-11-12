## 下載哪一個？

| 檔案 | 用途 |
|---|---|
| **official-url-guard-{{VERSION}}.zip** | 電腦的 Chrome／Edge 擴充功能（大部分人下載這個） |
| gmail-apps-script-{{VERSION}}.zip | Gmail 收件匣過濾（選用，安裝方式見壓縮檔裡的 README.md） |

手機請直接用網頁版：<https://judylin0324.github.io/official-url-guard/>（可以「加到主畫面」）

## 安裝擴充功能（約 1 分鐘）

1. 下載 **official-url-guard-{{VERSION}}.zip**，按右鍵「解壓縮全部」。解壓縮後會有一個 `official-url-guard` 資料夾，請放在固定的地方（例如「文件」），之後不要刪除或移動。
2. Chrome 網址列輸入 `chrome://extensions`（Edge 輸入 `edge://extensions`）。
3. 打開右上角的「**開發人員模式**」。
4. 按「**載入未封裝項目**」，選 `official-url-guard` 資料夾（裡面看得到 `manifest.json` 的那一層）。
5. 點工具列的拼圖圖示，把「官網守門員」釘選出來。

涉詐網域清單、官方網站清單、官網 Logo 指紋每天自動更新。之後有新版本時，下載新的 zip 換掉舊資料夾，再到 `chrome://extensions` 按「官網守門員」的重新載入圖示。

## 這個版本能做什麼

- 仿冒網址在連線前攔截；165、TWNIC 涉詐網域連一個封包都不會送出
- 網頁自稱停管處、監理站、銀行，卻要你刷卡、轉帳、輸入驗證碼，網址又不是官方的 → 全頁警告，並告訴你正確的繳費管道
- 抄襲官網的痕跡、官網 Logo 圖片比對、網頁上的 QR Code、打字途中偷傳卡號、送出卡號前最後確認
- 一鍵通報網詐通報查詢網（自動截圖存證）、一鍵查網站註冊多久
- Gmail、Outlook、Yahoo 網頁信箱開信自動檢查
- Google 訊息網頁版（Android 簡訊）、Messenger、Telegram、WhatsApp 網頁版：自動檢查對方傳來的訊息
- 手機檢查網頁可以安裝成 App；Android 可從簡訊或 LINE 長按訊息「分享」到官網守門員
- 涉詐網域清單改由專案每天彙整、檢查後發布，下載更快，來源異常時自動通知維護者

完整說明見 [README](https://github.com/judylin0324/official-url-guard#readme)。這是輔助工具，不保證攔截所有詐騙；有疑問請撥 **165**。
