/**
 * 真的打 AI 公司的 API，確認三家串接的格式對（模擬測試只能證明「照我的理解運作」）。
 * 在 Cloud Run job 裡跑：金鑰從掛載的密鑰檔讀，程式不印出任何金鑰。
 *   REAL_ENV_FILE=/secrets/app.env node test/real-api.mjs
 */
import { readFileSync } from "node:fs";
import { loadGas } from "./gas-sim.mjs";
import { syncFetch } from "./sync-fetch.mjs";

const env = {};
for (const line of readFileSync(process.env.REAL_ENV_FILE, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const KEYS = { claude: env.ANTHROPIC_API_KEY, gemini: env.GEMINI_API_KEY, openai: env.OPENAI_API_KEY };
const OWNER = "Uowner000000000000000000000000000";
// 8x8 紅色 PNG
const RED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC";

function realFetch(request) {
  if (request.url.includes("api.line.me")) return { code: 200, body: {} }; // LINE 不真的送
  if (request.url.includes("api-data.line.me")) return { code: 200, body: Buffer.from(RED_PNG, "base64").toString("latin1"), headers: { "content-type": "image/png" }, binary: true };
  const res = syncFetch(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...request.headers },
    body: JSON.stringify(request.body),
  });
  return { code: res.code, body: res.body };
}

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`[REAL] ${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
}

for (const provider of ["claude", "gemini", "openai"]) {
  if (!KEYS[provider]) {
    console.log(`[REAL] SKIP ${provider}：沒有金鑰`);
    continue;
  }
  const gas = loadGas({
    properties: { LINE_CHANNEL_ACCESS_TOKEN: "t", AI_PROVIDER: provider, AI_API_KEY: KEYS[provider], WEBHOOK_KEY: "k", OWNER_USER_ID: OWNER },
    fetch: realFetch,
  });
  const say = (text, id) => {
    gas.run("doPost", gas.webhook([{ type: "message", webhookEventId: "e" + id, replyToken: "r" + id, source: { type: "user", userId: OWNER }, message: { type: "text", id: "m" + id, text } }]));
    const r = gas.requests.filter((q) => q.url.endsWith("/message/reply")).at(-1);
    return r ? r.body.messages[0].text : "(沒有回覆)";
  };
  const t0 = Date.now();
  const hello = say("只回答兩個字：你好", 1);
  check(`${provider} 基本對話`, /你好/.test(hello), `${hello.slice(0, 40)}（${Date.now() - t0}ms）`);

  const t1 = Date.now();
  const added = say("幫我把「牙醫回診」加到 2026-10-07 早上 10 點到 11 點", 2);
  const ev = gas.calendar.events[0];
  check(`${provider} 呼叫工具新增行程`, ev && ev.title.includes("牙醫") && ev.start.toISOString() === "2026-10-07T02:00:00.000Z",
    `${ev ? ev.title + " " + ev.start.toISOString() : "沒有建立"}；回覆：${added.slice(0, 50)}（${Date.now() - t1}ms）`);

  const listed = say("2026-10-07 我有什麼行程？", 3);
  check(`${provider} 查行程（多輪＋工具）`, /牙醫/.test(listed), listed.slice(0, 60));

  gas.run("doPost", gas.webhook([{ type: "message", webhookEventId: "e4", replyToken: "r4", source: { type: "user", userId: OWNER }, message: { type: "image", id: "img" } }]));
  const seen = say("這張圖主要是什麼顏色？只回答顏色", 5);
  check(`${provider} 看圖`, /紅/.test(seen), seen.slice(0, 40));
  const errors = gas.logs.filter(([level]) => level === "error").map(([, m]) => m.slice(0, 200));
  if (errors.length) console.log(`[REAL] ${provider} 錯誤紀錄：${errors.join(" | ")}`);
}
console.log(`[REAL] DONE failures=${failures}`);
