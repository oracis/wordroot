/*
 * license-report-test.js — 匿名聚合上报（reportUsage）单元测试
 *
 * 验证隐私与去重两条铁律：
 *   1. opt-in 关闭 / 无 URL 时绝不发请求
 *   2. 发的 payload 只含计数，绝不含单词原文、不含 IP
 *   3. 同一天重复调用只发一次（去重）
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const NODE = "C:/Users/DELL/.workbuddy/binaries/node/versions/22.22.2/node.exe";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name); }
}

// ---- 内存版 chrome.storage.local ----
function makeEnv(optin, reportUrl) {
  const store = {};
  const storage = {
    get(keys, cb) {
      let o;
      if (typeof keys === "string") { o = {}; o[keys] = store[keys]; }
      else if (Array.isArray(keys)) { o = {}; keys.forEach(k => (o[k] = store[k])); }
      else { o = {}; Object.keys(keys).forEach(k => (o[k] = store[k] !== undefined ? store[k] : keys[k])); }
      if (cb) cb(o);
      return Promise.resolve(o);
    },
    set(obj, cb) { Object.keys(obj).forEach(k => (store[k] = obj[k])); if (cb) cb(); return Promise.resolve(); }
  };
  const captured = []; // { url, blob }
  const sandbox = {
    chrome: {
      storage: { local: storage },
      runtime: { getManifest: () => ({ version: "0.1.0-test" }) }
    },
    navigator: {
      sendBeacon: (url, blob) => { captured.push({ url, blob }); return true; }
    },
    fetch: () => { throw new Error("fetch should not be used when sendBeacon exists"); },
    Blob: Blob,
    console
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, "..", "license.js"), "utf8");
  vm.runInContext(code, sandbox);
  const L = sandbox.WR_LICENSE;
  L.CONFIG.REPORT_URL = reportUrl || "";
  if (optin) store.wr_report = true;
  return { L, store, captured, sandbox };
}

async function readPayload(captured) {
  const item = captured[captured.length - 1];
  const text = await item.blob.text();
  return JSON.parse(text);
}

(async function () {
  console.log("== license-report-test ==");

  // 1. opt-in 关闭：不发，reason=optout
  {
    const e = makeEnv(false, "https://example.com/report");
    const r = await e.L.reportUsage();
    check("opt-in 关闭时不发请求", e.captured.length === 0 && r.sent === false && r.reason === "optout");
  }

  // 2. opt-in 开 + 有 usage：发，payload 只含计数、无单词/IP
  {
    const e = makeEnv(true, "https://example.com/report");
    await e.L.record("lookup"); await e.L.record("lookup"); await e.L.record("lookup");
    await e.L.record("llm"); await e.L.record("pdf");
    const r = await e.L.reportUsage();
    check("opt-in 开启且有用量时上报成功", r.sent === true && r.reason === "ok");
    check("发送了恰好 1 个请求", e.captured.length === 1);

    const p = await readPayload(e.captured);
    const allowed = ["v", "date", "id", "lookups", "llm", "pdf", "epub", "exports", "vocabAdds"];
    const keys = Object.keys(p);
    check("payload 字段均为计数类（无单词/IP）", keys.length === allowed.length && keys.every(k => allowed.includes(k)));
    check("payload 不含 word/IP 等敏感字段", !("word" in p) && !("ip" in p) && !("text" in p));
    check("payload 计数正确（lookups=3,llm=1,pdf=1）", p.lookups === 3 && p.llm === 1 && p.pdf === 1);
    check("payload 带版本号 v", typeof p.v === "string" && p.v.length > 0);
    check("payload 带固定匿名 id", typeof p.id === "string" && p.id.length > 0);
    check("token 经 query 传递（?t=）", e.captured[0].url.indexOf("?t=") >= 0);
  }

  // 3. 当天重复：去重，不发
  {
    const e = makeEnv(true, "https://example.com/report");
    await e.L.record("lookup");
    const first = await e.L.reportUsage();
    const second = await e.L.reportUsage(); // 同一天再调
    check("首次上报成功", first.sent === true);
    check("同日重复上报被去重（sent=false, reason=already）", second.sent === false && second.reason === "already");
    check("同日只发了 1 个请求", e.captured.length === 1);
  }

  // 4. REPORT_URL 为空：不上报
  {
    const e = makeEnv(true, "");
    const r = await e.L.reportUsage();
    check("REPORT_URL 为空时不发（reason=nourl）", e.captured.length === 0 && r.sent === false && r.reason === "nourl");
  }

  console.log("\n== license-report-test: " + pass + " passed, " + fail + " failed ==");
  process.exit(fail ? 1 : 0);
})();
