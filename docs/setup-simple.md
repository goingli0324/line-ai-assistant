# 簡易版設定教學（Google Apps Script）

做完之後，你會有一個**只屬於你自己的 LINE 機器人**。在 LINE 裡跟它聊天，就是在用你選的 AI：ChatGPT、Gemini 或 Claude。

它能做的事：

- 回答問題、寫作、翻譯、整理重點
- 看照片、讀照片上的字
- 拍海報、會議通知或邀請函，它幫你加進 Google 行事曆
- 問它「明天有什麼行程」
- 記得最近的對話，可以接著問

**需要準備**：Gmail 帳號、手機上的 LINE，大約 30–40 分鐘。建議用電腦操作。

**費用**：LINE 和 Google 這兩邊都免費，AI 那邊依你選的公司而定（見第 2 步）。

---

## 第 1 步：建立 LINE 官方帳號，拿到金鑰

1. 用電腦打開 [LINE Developers](https://developers.line.biz/console/)，用你的 LINE 帳號登入。
2. 第一次進來會請你建立一個 **Provider**（名稱隨意，例如「我的助理」）。
3. 在 Provider 裡點 **Create a new channel** → 選 **Messaging API**。
4. 畫面會說現在不能直接在這裡建立，請點綠色按鈕 **Create a LINE Official Account**。
5. 照表單填寫：帳號名稱就是機器人的名字，其他照實填，不用申請認證。
6. 完成後點 **前往 LINE Official Account Manager**，同意條款。
7. 在 Official Account Manager：**設定 → Messaging API → 啟用 Messaging API**，選你在第 2 步建立的 Provider，其他欄位留空，按確定。
8. 回到 [LINE Developers](https://developers.line.biz/console/)，點進剛出現的頻道 → **Messaging API** 分頁 → 捲到最下面 **Channel access token** → 按 **Issue**。
9. 把這串很長的文字**複製起來先放著**，第 5 步要用。

> 🔒 這串 token 等於機器人的鑰匙，不要貼給任何人，也不要貼到群組。

**順便關掉 LINE 內建的自動回覆**，不然會跟 AI 搶著回話：
Official Account Manager → **設定 → 回應設定**，把「加入好友的歡迎訊息」和「自動回應訊息」都關掉。

---

## 第 2 步：拿一把 AI 金鑰（三選一）

| | Gemini（Google） | ChatGPT（OpenAI） | Claude（Anthropic） |
|---|---|---|---|
| 費用 | **有免費額度**，不用綁卡 | 要先儲值（最少 5 美元） | 要先儲值 |
| 申請網址 | [Google AI Studio](https://aistudio.google.com/apikey) | [OpenAI Platform](https://platform.openai.com/api-keys) | [Claude Console](https://platform.claude.com/settings/keys) |
| 第 5 步 `AI_PROVIDER` 要填 | `gemini` | `openai` | `claude` |

- **不知道選哪個？先選 Gemini**，免費就能開始用。
- ⚠️ Gemini 免費方案的對話內容，Google 可能拿去改進他們的產品。會傳工作文件、學生或客戶資料的話，建議改用付費方案，或選另外兩家。
- 用法：打開申請網址 → 登入 → 建立 API key → 複製起來先放著。
- 用 ChatGPT 或 Claude 的話，要先到網站的 Billing（帳單）頁面儲值，不然金鑰不能用。
- 一般聊天的用量很小，大多數人一個月花不到幾十元台幣。

> 🔒 AI 金鑰也不要給任何人。被別人拿到，他就能花你的錢。

---

## 第 3 步：建立 Apps Script 專案，貼上程式

1. 打開 [Google Apps Script](https://script.google.com/home)，用你的 Gmail 登入。**行事曆就是這個帳號的。**
2. 點左上角 **新專案**。
3. 點左上角「未命名的專案」，改個名字，例如「LINE AI 助理」。
4. 打開 [程式碼（Code.gs）](https://raw.githubusercontent.com/goingli0324/line-ai-assistant/main/gas/Code.gs)，全選（Ctrl＋A／⌘＋A）→ 複製。
5. 回到 Apps Script，把編輯器裡原本的幾行**全部刪掉**，貼上剛剛複製的程式。
6. 按 💾 存檔（或 Ctrl＋S／⌘＋S）。

---

## 第 4 步：設定時區

左邊齒輪 **專案設定** → **時區** 選「(GMT+08:00) 台北」。不在台灣就選你所在的時區。

（行程的時間是照你的 Google 行事曆時區算的，這裡設成一樣比較不會出錯。）

---

## 第 5 步：填入金鑰

還在 **專案設定** 頁，捲到最下面 **指令碼屬性** → **編輯指令碼屬性** → 新增這三筆：

| 屬性 | 值 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 第 1 步複製的 LINE token |
| `AI_PROVIDER` | `gemini`、`openai` 或 `claude`（小寫） |
| `AI_API_KEY` | 第 2 步複製的 AI 金鑰 |

按 **儲存指令碼屬性**。

> 想指定模型的話，可以再加一筆 `AI_MODEL`，不加就用預設。預設是 Gemini `gemini-3.8-flash`、ChatGPT `gpt-6-luna`、Claude `claude-sonnet-5-5`。

---

## 第 6 步：執行 setup（授權）

1. 回到左邊 **編輯器**（`< >` 圖示）。
2. 上方工具列的函式選單選 **setup** → 按 **執行**。
3. 會跳出「需要授權」→ **審查權限** → 選你的 Gmail 帳號。
4. 如果出現「**Google 尚未驗證這個應用程式**」：點左下 **進階** → **前往「LINE AI 助理」（不安全）**。
   - 這是因為這支程式是你自己建的，Google 沒審查過，屬於正常現象。程式只會碰到你自己的行事曆。
5. 按 **允許**。
6. 下方「執行紀錄」出現 **✅ 設定齊全** 就成功了。出現 ❌ 的話，照它說的補上缺的設定，再執行一次。

---

## 第 7 步：部署

1. 右上角 **部署** → **新增部署作業**。
2. 左邊齒輪選 **網頁應用程式**。
3. 設定：
   - 說明：隨意
   - 執行身分：**我**
   - 誰可以存取：**所有人**
4. 按 **部署**。

> 「所有人」是為了讓 LINE 送得進來。程式會檢查網址裡的密碼，也只回應你本人，別人拿到網址也用不了。

---

## 第 8 步：把網址貼到 LINE

1. 回到編輯器，函式選單選 **showWebhookUrl** → **執行**。
2. 執行紀錄會印出一串以 `?key=` 結尾的網址，**整串複製**。
3. 到 [LINE Developers](https://developers.line.biz/console/) → 你的頻道 → **Messaging API** 分頁：
   - **Webhook URL** → Edit → 貼上 → Update
   - **Use webhook** 打開
   - **Webhook redelivery** 保持**關閉**
4. 旁邊的 **Verify** 按了會顯示錯誤（302）。**這是正常的，不用理它**：Apps Script 的回應方式跟 LINE 預期的不同，但訊息實際上都收得到。

---

## 第 9 步：加好友、綁定自己

1. 在 **Messaging API** 分頁上方有 QR code，用手機 LINE 掃描、加好友。
2. 傳一則訊息給它，例如「你好」。
3. 收到「👋 綁定完成！」就好了。之後只有你能用，別人加好友傳訊息只會收到「私人助理」的回覆。

> ⚠️ 一定要**你自己**傳第一則訊息：第一個傳訊息的人會被綁定為主人。

---

## 試試看

- 「幫我想三個週末可以帶小孩去的地方」
- 拍一張活動海報傳過去 → 按「加到行事曆」
- 「明天有什麼行程？」
- 「新對話」→ 清掉前面的對話，重新開始

---

## 出問題時

**先執行 `checkSettings`**（函式選單選它 → 執行），執行紀錄會告訴你 LINE 金鑰、AI 金鑰、主人綁定是否正常。

| 狀況 | 怎麼辦 |
|---|---|
| 傳訊息完全沒反應 | 1. Webhook URL 是不是 `/exec?key=` 結尾、有沒有整串貼上 2. **Use webhook** 有沒有打開 3. 部署時「誰可以存取」是不是「所有人」 |
| 回「AI 金鑰不能用」 | 重新複製金鑰，更新指令碼屬性 `AI_API_KEY` |
| 回「餘額不足」 | 到 AI 公司網站的 Billing 頁儲值 |
| 行程時間差了幾小時 | 第 4 步的時區，跟 Google 行事曆的時區設成一樣 |
| 想換一個人當主人 | 執行 `resetOwner`，再用新的 LINE 帳號傳訊息 |
| 想換 AI 公司 | 改指令碼屬性 `AI_PROVIDER` 和 `AI_API_KEY`，存檔即可，不用重新部署 |

**更新程式（有新版時）**：貼上新的程式、存檔之後，**一定要**到「部署 → 管理部署作業 → ✏️ 編輯 → 版本選『新版本』→ 部署」。只存檔的話，LINE 用到的還是舊版。網址不會變，不用重貼到 LINE。

---

## 隱私說明

- 程式跑在**你自己的 Google 帳號**裡，對話與行程不會經過作者或任何第三方。
- 你傳的訊息與照片會送到你選的 AI 公司處理，依各家的隱私條款處理。
- 對話記憶只存在 Apps Script 的快取，30 分鐘沒說話就自動消失。
