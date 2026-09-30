/**
 * 給模擬環境用的「同步」HTTP：Apps Script 的 UrlFetchApp 是同步的，Node 的 fetch 是非同步的。
 * 做法：另開一個 worker 去 fetch，主執行緒用 Atomics.wait 等它做完。
 */
import { Worker, receiveMessageOnPort, MessageChannel } from "node:worker_threads";

const WORKER_CODE = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", async ({ port, signal, url, init }) => {
  let result;
  try {
    const res = await fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    result = { code: res.status, body: buf.toString("utf8"), contentType: res.headers.get("content-type") };
  } catch (err) {
    result = { error: String(err) };
  }
  port.postMessage(result);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
`;

let worker;
export function syncFetch(url, init) {
  worker ??= new Worker(WORKER_CODE, { eval: true });
  worker.unref();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  worker.postMessage({ port: port2, signal, url, init }, [port2]);
  Atomics.wait(signal, 0, 0, 120_000);
  const message = receiveMessageOnPort(port1);
  if (!message) throw new Error("同步 fetch 逾時");
  if (message.message.error) throw new Error(message.message.error);
  return message.message;
}
