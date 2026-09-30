import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGas } from "./gas-sim.mjs";

const OWNER = "Uowner000000000000000000000000000";
const KEY = "k".repeat(32);
const textEvent = (text, id = Math.random().toString(36).slice(2)) => ({
  type: "message", webhookEventId: "evt-" + id, replyToken: "rt-" + id, source: { type: "user", userId: OWNER },
  message: { type: "text", id: "msg-" + id, text },
});
const replies = (gas) => gas.requests.filter((r) => r.url.endsWith("/message/reply")).map((r) => r.body.messages[0].text);

/** 依序回應 AI 的 API；LINE 相關請求回 200 */
function scripted(host, responses) {
  let i = 0;
  const seen = [];
  const fetch = (r) => {
    if (!r.url.includes(host)) return null;
    seen.push(r);
    const next = responses[i++];
    if (!next) throw new Error("AI 被呼叫的次數超出劇本");
    return next;
  };
  return { fetch, seen };
}

function gasWith(provider, fetch) {
  return loadGas({
    properties: { LINE_CHANNEL_ACCESS_TOKEN: "t", AI_PROVIDER: provider, AI_API_KEY: "sk-test", WEBHOOK_KEY: KEY, OWNER_USER_ID: OWNER },
    fetch,
  });
}

test("Claude：工具呼叫一輪後回答，送回 tool_result 並帶工具定義", () => {
  const ai = scripted("api.anthropic.com", [
    { body: { stop_reason: "tool_use", content: [{ type: "text", text: "我查一下" }, { type: "tool_use", id: "tu_1", name: "list_events", input: { date: "2026-10-03" } }] } },
    { body: { stop_reason: "end_turn", content: [{ type: "text", text: "10/3 沒有行程喔" }] } },
  ]);
  const gas = gasWith("claude", ai.fetch);
  gas.run("doPost", gas.webhook([textEvent("10/3 有什麼")]));
  assert.equal(replies(gas)[0], "10/3 沒有行程喔");
  const [first, second] = ai.seen;
  assert.equal(first.headers["x-api-key"], "sk-test");
  assert.equal(first.headers["anthropic-version"], "2023-06-01");
  assert.equal(first.body.tools[0].input_schema.type, "object");
  assert.ok(second.body.tools, "第二輪也要帶 tools");
  const toolResult = second.body.messages.at(-1).content[0];
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.tool_use_id, "tu_1");
  assert.match(toolResult.content, /沒有行程/);
});

test("Claude：金鑰錯誤時使用者看到白話說明", () => {
  const ai = scripted("api.anthropic.com", [{ code: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }]);
  const gas = gasWith("claude", ai.fetch);
  gas.run("doPost", gas.webhook([textEvent("hi")]));
  assert.match(replies(gas)[0], /AI 金鑰不能用/);
});

test("ChatGPT：function_call 一輪後回答；reasoning 與 function_call 原樣送回、帶 call_id", () => {
  const ai = scripted("api.openai.com", [
    { body: { status: "completed", output: [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAA" },
      { type: "function_call", id: "fc_1", call_id: "call_1", name: "create_event", arguments: JSON.stringify({ title: "牙醫", start: "2026-10-07T10:00" }) },
    ] } },
    { body: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "幫你加好了" }] }] } },
  ]);
  const gas = gasWith("openai", ai.fetch);
  gas.run("doPost", gas.webhook([textEvent("10/7 早上十點看牙醫")]));
  assert.match(replies(gas)[0], /^幫你加好了/);
  assert.equal(gas.calendar.events[0].start.toISOString(), "2026-10-07T02:00:00.000Z");
  const [first, second] = ai.seen;
  assert.equal(first.headers.Authorization, "Bearer sk-test");
  assert.equal(first.body.store, false);
  assert.equal(first.body.tools[0].type, "function");
  const types = second.body.input.map((i) => i.type ?? i.role);
  assert.deepEqual([...types], ["user", "reasoning", "function_call", "function_call_output"]);
  const out = second.body.input.at(-1);
  assert.equal(out.call_id, "call_1");
  assert.match(out.output, /已加入行事曆/);
});

test("ChatGPT：額度用完（429 credit_balance_exhausted）時提示儲值，不是說太忙", () => {
  const ai = scripted("api.openai.com", [{ code: 429, body: { error: { code: "credit_balance_exhausted", type: "insufficient_quota", message: "You exceeded your current quota" } } }]);
  const gas = gasWith("openai", ai.fetch);
  gas.run("doPost", gas.webhook([textEvent("hi")]));
  assert.match(replies(gas)[0], /餘額不足/);
});

test("ChatGPT：圖片用 input_image data URL 送出", () => {
  const ai = scripted("api.openai.com", [{ body: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "是海報" }] }] } }]);
  const fetch = (r) => (r.url.includes("api-data.line.me") ? { body: "IMG", headers: { "content-type": "image/jpeg" } } : ai.fetch(r));
  const gas = gasWith("openai", fetch);
  gas.run("doPost", gas.webhook([{ type: "message", webhookEventId: "e-i", replyToken: "rt-i", source: { type: "user", userId: OWNER }, message: { type: "image", id: "i1" } }]));
  gas.run("doPost", gas.webhook([textEvent("這是什麼")]));
  const part = ai.seen[0].body.input.at(-1).content.find((c) => c.type === "input_image");
  assert.equal(part.image_url, "data:image/jpeg;base64," + Buffer.from("IMG").toString("base64"));
});

test("Gemini：functionCall 後把模型那一輪原樣送回（含 thoughtSignature），functionResponse 帶同一個 id", () => {
  const ai = scripted("generativelanguage.googleapis.com", [
    { body: { candidates: [{ content: { role: "model", parts: [
      { functionCall: { name: "list_events", args: { date: "2026-10-03" }, id: "fc-abc" }, thoughtSignature: "SIG123" },
    ] }, finishReason: "STOP" }] } },
    { body: { candidates: [{ content: { role: "model", parts: [{ text: "那天沒有行程" }, { text: "", thoughtSignature: "SIG2" }] }, finishReason: "STOP" }] } },
  ]);
  const gas = gasWith("gemini", ai.fetch);
  gas.run("doPost", gas.webhook([textEvent("10/3 有空嗎")]));
  assert.equal(replies(gas)[0], "那天沒有行程");
  const [first, second] = ai.seen;
  assert.match(first.url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(first.headers["x-goog-api-key"], "sk-test");
  assert.equal(first.body.generationConfig.thinkingConfig.thinkingLevel, "low");
  const modelTurn = second.body.contents.at(-2);
  assert.equal(modelTurn.role, "model");
  assert.equal(modelTurn.parts[0].thoughtSignature, "SIG123");
  const reply = second.body.contents.at(-1);
  assert.equal(reply.role, "user");
  assert.equal(reply.parts[0].functionResponse.id, "fc-abc");
  assert.match(reply.parts[0].functionResponse.response.result, /沒有行程/);
});

test("Gemini：被安全機制擋下（沒有 candidates）時回白話，不當機", () => {
  const ai = scripted("generativelanguage.googleapis.com", [{ body: { promptFeedback: { blockReason: "SAFETY" } } }]);
  const gas = gasWith("gemini", ai.fetch);
  gas.run("doPost", gas.webhook([textEvent("x")]));
  assert.match(replies(gas)[0], /沒辦法處理/);
});

test("Gemini：金鑰無效（400 API_KEY_INVALID）→ 提示金鑰問題", () => {
  const ai = scripted("generativelanguage.googleapis.com", [{ code: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } } }]);
  const gas = gasWith("gemini", ai.fetch);
  gas.run("doPost", gas.webhook([textEvent("x")]));
  assert.match(replies(gas)[0], /AI 金鑰不能用/);
});

test("Gemini：圖片用 inlineData 送出", () => {
  const ai = scripted("generativelanguage.googleapis.com", [{ body: { candidates: [{ content: { role: "model", parts: [{ text: "海報" }] } }] } }]);
  const fetch = (r) => (r.url.includes("api-data.line.me") ? { body: "IMG", headers: { "content-type": "image/png" } } : ai.fetch(r));
  const gas = gasWith("gemini", fetch);
  gas.run("doPost", gas.webhook([{ type: "message", webhookEventId: "e-g", replyToken: "rt-g", source: { type: "user", userId: OWNER }, message: { type: "image", id: "g1" } }]));
  gas.run("doPost", gas.webhook([textEvent("看圖")]));
  const part = ai.seen[0].body.contents.at(-1).parts.find((p) => p.inlineData);
  assert.equal(part.inlineData.mimeType, "image/png");
});
