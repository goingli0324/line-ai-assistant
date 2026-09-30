/**
 * 在 Node 裡模擬 Google Apps Script 的執行環境，把 gas/Code.gs 載進來測。
 * 只模擬 Code.gs 用到的服務；行事曆、快取、屬性都是記憶體版本，外部 HTTP 由測試指定的 handler 回應。
 *
 * 用法：
 *   const gas = loadGas({ properties: {...}, fetch: (url, options) => ({ code, body }) });
 *   gas.run("doPost", { parameter: { key }, postData: { contents } });
 *   gas.calendar.events / gas.requests / gas.logs 看結果
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CODE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "gas", "Code.gs");
const TZ = "Asia/Taipei";

/** 把某時區的「牆上時間」換成真正的時間點（用 Intl 算出該時區當下的偏移） */
function zonedToDate(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (asIfUtc - guess));
}

function formatDate(date, tz, fmt) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "long",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const pad = (v) => String(v).padStart(2, "0");
  const weekday = { Sunday: "星期日", Monday: "星期一", Tuesday: "星期二", Wednesday: "星期三", Thursday: "星期四", Friday: "星期五", Saturday: "星期六" }[get("weekday")];
  return fmt
    .replace("yyyy", get("year"))
    .replace("MM", pad(get("month")))
    .replace("dd", pad(get("day")))
    .replace("HH", pad(get("hour")))
    .replace("mm", pad(get("minute")))
    .replace("EEEE", weekday)
    .replace(/(^|[^M])M(?!M)/, (_, pre) => pre + String(Number(get("month"))))
    .replace(/(^|[^d])d(?!d)/, (_, pre) => pre + String(Number(get("day"))));
}

function parseDate(text, tz, fmt) {
  let m;
  if (fmt === "yyyy-MM-dd" && (m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return zonedToDate(+m[1], +m[2], +m[3], 0, 0, tz);
  if (fmt === "yyyy-MM-dd HH:mm" && (m = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/))) {
    return zonedToDate(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
  }
  throw new Error(`模擬環境不支援的 parseDate：${text} / ${fmt}`);
}

class FakeCalendar {
  constructor(id, name, { selected = true, hidden = false } = {}) {
    Object.assign(this, { id, name, selected, hidden, events: [] });
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getTimeZone() { return TZ; }
  isSelected() { return this.selected; }
  isHidden() { return this.hidden; }
  createEvent(title, start, end, options = {}) { return this.#add({ title, start, end, allDay: false, ...options }); }
  createAllDayEvent(title, start, end, options = {}) { return this.#add({ title, start, end, allDay: true, ...options }); }
  #add(e) {
    const event = {
      ...e,
      getTitle: () => e.title,
      getStartTime: () => e.start,
      getEndTime: () => e.end,
      isAllDayEvent: () => e.allDay,
      getLocation: () => e.location ?? "",
    };
    this.events.push(event);
    return event;
  }
  getEventsForDay(day) {
    const key = formatDate(day, TZ, "yyyy-MM-dd");
    return this.events.filter((e) => formatDate(e.start, TZ, "yyyy-MM-dd") === key);
  }
}

export function loadGas({ properties = {}, fetch, extraCalendars = [] } = {}) {
  const props = { ...properties };
  const cache = new Map();
  const requests = [];
  const logs = [];
  const primary = new FakeCalendar("owner@gmail.com", "我的行事曆");
  const calendars = [primary, ...extraCalendars.map((c) => new FakeCalendar(c.id, c.name, c))];

  const response = (code, body, headers = {}) => ({
    getResponseCode: () => code,
    getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)),
    getBlob: () => ({
      getBytes: () => (headers.binary ? Buffer.from(body, "latin1") : Buffer.from(typeof body === "string" ? body : JSON.stringify(body))),
      getContentType: () => headers["content-type"] ?? "image/jpeg",
    }),
  });

  const sandbox = {
    console: {
      log: (...a) => logs.push(["log", a.join(" ")]),
      warn: (...a) => logs.push(["warn", a.join(" ")]),
      error: (...a) => logs.push(["error", a.join(" ")]),
    },
    JSON, Date, Math, String, Number, Array, Object, Error, RegExp, Boolean, parseInt,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v, ttl) => {
          if (String(v).length > 100 * 1024) throw new Error(`CacheService 值超過 100KB（${k}）`);
          if (ttl > 21600) throw new Error("CacheService TTL 超過 6 小時");
          cache.set(k, String(v));
        },
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CalendarApp: { getDefaultCalendar: () => primary, getAllCalendars: () => calendars },
    Session: { getScriptTimeZone: () => TZ },
    ScriptApp: { getService: () => ({ getUrl: () => "https://script.google.com/macros/s/TEST/exec" }) },
    ContentService: { createTextOutput: (t) => ({ text: t }) },
    Utilities: {
      getUuid: () => randomUUID(),
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url"),
      computeDigest: (_alg, text) => [...createHash("sha256").update(text).digest()],
      DigestAlgorithm: { SHA_256: "SHA_256" },
      formatDate,
      parseDate,
    },
    UrlFetchApp: {
      fetch: (url, options = {}) => {
        const request = { url, method: options.method ?? "get", headers: options.headers ?? {}, body: options.payload ? JSON.parse(options.payload) : undefined };
        requests.push(request);
        const result = fetch ? fetch(request) : null;
        if (!result) return response(200, {});
        return response(result.code ?? 200, result.body ?? {}, { ...result.headers, binary: result.binary });
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(CODE_PATH, "utf8"), sandbox, { filename: "Code.gs" });

  return {
    run: (name, ...args) => sandbox[name](...args),
    sandbox,
    props, cache, requests, logs, calendar: primary, calendars,
    /** 組一個 LINE webhook 的 doPost 參數 */
    webhook(events, key = props.WEBHOOK_KEY) {
      return { parameter: { key }, postData: { contents: JSON.stringify({ events }) } };
    },
  };
}
