# LINE AI 隨身助理

在 LINE 裡用你自己的 AI。可以選 ChatGPT、Gemini 或 Claude，用你自己的金鑰，只有你本人能用。

- 💬 回答問題、寫作、翻譯、整理重點
- 📷 看照片、讀照片上的字
- 📅 拍海報、會議通知或邀請函，自動加進你的 Google 行事曆
- 🗓 「明天有什麼行程？」直接查你的行事曆
- 🧠 記得最近的對話，可以接著問

## 兩個版本

| | 簡易版 | 完整版 |
|---|---|---|
| 放在哪裡跑 | 你自己的 Google Apps Script | 你自己的 Google Cloud |
| 費用 | 免費（只付 AI 用量） | Google Cloud 免費額度內幾乎免費，但要綁信用卡 |
| 設定難度 | 複製貼上、按幾個按鈕，約 30–40 分鐘 | 要照步驟在終端機打指令，約 1 小時 |
| 回覆速度 | 稍慢 | 快 |
| 語音訊息、上網查資料、生圖 | — | ✅ |
| 教學 | [簡易版設定教學](docs/setup-simple.md) | 準備中 |

**不確定選哪個？先用簡易版。**

## 隱私

程式跑在你自己的 Google 帳號裡，對話和行程不會經過作者或任何第三方。
你傳的訊息會送到你選的 AI 公司處理，依各家的隱私條款處理。

## 授權

[MIT](LICENSE)：可以自由使用、修改、分享。

---

<details>
<summary>給開發者</summary>

- 簡易版程式是單一檔案 [`gas/Code.gs`](gas/Code.gs)。三家 AI 的差異都包在檔案最後的 `PROVIDERS_` 裡，要加新的 AI 公司，就是在那裡多寫一個 `run(opts)`。
- 測試：`npm test`。會在 Node 裡模擬 Apps Script 環境，跑完整的 LINE 訊息流程。
- `test/real-api.mjs` 會真的呼叫 AI 的 API，需要金鑰檔，見檔案開頭的說明。
- GAS 讀不到 HTTP 標頭，所以無法驗 LINE 簽章。改在 webhook 網址帶一組隨機的 `key` 當密碼，並用 `webhookEventId` 去重。

</details>
