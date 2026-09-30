import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGas } from "./gas-sim.mjs";

const OWNER = "Uowner000000000000000000000000000";
const STRANGER = "Ustranger0000000000000000000000000";
const KEY = "k".repeat(32);

/** 假的 AI：照劇本回應，記下每次收到的內容 */
function withFakeAI(gas, script) {
  const calls = [];
  gas.sandbox.PROVIDERS_.fake = {
    defaultModel: "fake-1",
    run(opts) {
      calls.push(opts);
      return script(opts, calls.length);
    },
  };
  return calls;
}

function setupGas(extra = {}) {
  const gas = loadGas({
    properties: { LINE_CHANNEL_ACCESS_TOKEN: "t", AI_PROVIDER: "fake", AI_API_KEY: "x", WEBHOOK_KEY: KEY, ...extra.properties },
    fetch: extra.fetch,
    extraCalendars: extra.extraCalendars,
  });
  return gas;
}

const textEvent = (userId, text, id = Math.random().toString(36).slice(2)) => ({
  type: "message", webhookEventId: "evt-" + id, replyToken: "rt-" + id, source: { type: "user", userId },
  message: { type: "text", id: "msg-" + id, text },
});
const replies = (gas) => gas.requests.filter((r) => r.url.endsWith("/message/reply")).map((r) => r.body.messages[0].text);

test("webhook 網址的 key 不對就不處理", () => {
  const gas = setupGas();
  const out = gas.run("doPost", gas.webhook([textEvent(OWNER, "hi")], "wrong"));
  assert.equal(out.text, "forbidden");
  assert.equal(gas.requests.length, 0);
});

test("第一個傳訊息的人被綁定為主人，其他人被擋", () => {
  const gas = setupGas();
  withFakeAI(gas, () => "你好");
  gas.run("doPost", gas.webhook([textEvent(OWNER, "hi")]));
  assert.equal(gas.props.OWNER_USER_ID, OWNER);
  assert.match(replies(gas)[0], /綁定完成/);
  gas.run("doPost", gas.webhook([textEvent(STRANGER, "hi")]));
  assert.match(replies(gas)[1], /私人助理/);
});

test("AI 用 create_event 工具時，活動用台北時間建立、回覆附上行事曆連結", () => {
  const gas = setupGas({ properties: { OWNER_USER_ID: OWNER } });
  withFakeAI(gas, (opts) => {
    const result = opts.runTool("create_event", { title: "系務會議", start: "2026-10-05T14:00", end: "2026-10-05T15:30", location: "B302" });
    assert.match(result, /已加入行事曆/);
    return "好，幫你加好了";
  });
  gas.run("doPost", gas.webhook([textEvent(OWNER, "10/5 下午兩點系務會議")]));
  const [event] = gas.calendar.events;
  assert.equal(event.title, "系務會議");
  assert.equal(event.start.toISOString(), "2026-10-05T06:00:00.000Z");
  assert.equal(event.end.toISOString(), "2026-10-05T07:30:00.000Z");
  assert.equal(event.location, "B302");
  assert.match(replies(gas)[0], /📅 https:\/\/calendar\.google\.com\/calendar\/r\/day\/2026\/10\/5\?authuser=owner%40gmail\.com/);
});

test("同一則 LINE 事件重送兩次只處理一次", () => {
  const gas = setupGas({ properties: { OWNER_USER_ID: OWNER } });
  const calls = withFakeAI(gas, () => "ok");
  const event = textEvent(OWNER, "hi", "same");
  gas.run("doPost", gas.webhook([event]));
  gas.run("doPost", gas.webhook([event]));
  assert.equal(calls.length, 1);
});

test("同一則訊息裡同一個活動重試也只建一次", () => {
  const gas = setupGas({ properties: { OWNER_USER_ID: OWNER } });
  withFakeAI(gas, (opts) => {
    opts.runTool("create_event", { title: "A", start: "2026-10-05" , allDay: true });
    opts.runTool("create_event", { title: "A", start: "2026-10-05", allDay: true });
    return "ok";
  });
  gas.run("doPost", gas.webhook([textEvent(OWNER, "加")]));
  assert.equal(gas.calendar.events.length, 1);
  const e = gas.calendar.events[0];
  assert.equal(e.allDay, true);
  assert.equal(e.end.getTime() - e.start.getTime(), 24 * 3600 * 1000, "整天活動結束日要是隔天（不含）");
});

test("先傳圖片、再傳文字：AI 收到圖片", () => {
  const gas = setupGas({
    properties: { OWNER_USER_ID: OWNER },
    fetch: (r) => (r.url.includes("api-data.line.me") ? { code: 200, body: "JPEGDATA", headers: { "content-type": "image/jpeg" } } : null),
  });
  const calls = withFakeAI(gas, () => "這是一張海報");
  gas.run("doPost", gas.webhook([{ type: "message", webhookEventId: "e-img", replyToken: "rt-img", source: { type: "user", userId: OWNER }, message: { type: "image", id: "img1" } }]));
  assert.match(replies(gas)[0], /收到圖片/);
  gas.run("doPost", gas.webhook([textEvent(OWNER, "加到行事曆")]));
  assert.equal(calls[0].image.base64, Buffer.from("JPEGDATA").toString("base64"));
  assert.equal(calls[0].image.mimeType, "image/jpeg");
});

test("查行程：包含勾選顯示的其他行事曆，不含隱藏的", () => {
  const gas = setupGas({
    properties: { OWNER_USER_ID: OWNER },
    extraCalendars: [{ id: "family", name: "家庭" }, { id: "hidden", name: "隱藏的", hidden: true }],
  });
  const tz = (h) => new Date(Date.UTC(2026, 9, 3, h - 8));
  gas.calendar.createEvent("團練", tz(19), tz(21));
  gas.calendars[1].createEvent("家庭聚餐", tz(12), tz(13));
  gas.calendars[2].createEvent("不該出現", tz(9), tz(10));
  let result;
  withFakeAI(gas, (opts) => { result = opts.runTool("list_events", { date: "2026-10-03" }); return "ok"; });
  gas.run("doPost", gas.webhook([textEvent(OWNER, "10/3 有什麼")]));
  assert.match(result, /12:00–13:00 家庭聚餐（家庭）/);
  assert.match(result, /19:00–21:00 團練/);
  assert.doesNotMatch(result, /不該出現/);
  assert.ok(result.indexOf("家庭聚餐") < result.indexOf("團練"), "依時間排序");
});

test("工具收到壞日期時，錯誤訊息不回顯輸入", () => {
  const gas = setupGas({ properties: { OWNER_USER_ID: OWNER } });
  let result;
  withFakeAI(gas, (opts) => { result = opts.runTool("list_events", { date: "https://evil.example/?d=secret" }); return "ok"; });
  gas.run("doPost", gas.webhook([textEvent(OWNER, "x")]));
  assert.match(result, /日期格式不正確/);
  assert.doesNotMatch(result, /evil/);
});

test("對話記憶：帶到下一則；說「新對話」就清掉", () => {
  const gas = setupGas({ properties: { OWNER_USER_ID: OWNER } });
  const calls = withFakeAI(gas, (_o, n) => "回答" + n);
  gas.run("doPost", gas.webhook([textEvent(OWNER, "第一句")]));
  gas.run("doPost", gas.webhook([textEvent(OWNER, "第二句")]));
  assert.deepEqual(calls[1].history.map((h) => h.text), ["第一句", "回答1"]);
  gas.run("doPost", gas.webhook([textEvent(OWNER, "新對話")]));
  gas.run("doPost", gas.webhook([textEvent(OWNER, "第三句")]));
  assert.equal(calls[2].history.length, 0);
});

test("AI 出錯時回白話訊息，不整個沒回應", () => {
  const gas = setupGas({ properties: { OWNER_USER_ID: OWNER } });
  withFakeAI(gas, () => { throw new Error("HTTP 401 invalid x-api-key"); });
  gas.run("doPost", gas.webhook([textEvent(OWNER, "hi")]));
  assert.match(replies(gas)[0], /AI 金鑰不能用/);
});
