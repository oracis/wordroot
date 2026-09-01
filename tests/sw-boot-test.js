// SW 冷启动防护回归测试
//
// 背景（真实 bug）：
//   MV3 service worker 在扩展热重载 / 文件被占用 / 反复启停时，
//   ① importScripts 可能抛 NetworkError，② chrome.runtime 可能变 undefined。
//   两种情况都会中断 background.js 的顶层执行 —— 连 onMessage 都注册不上，扩展直接变砖
//   （表现为 chrome://extensions 报 "background.js:140 (anonymous function)" 之类）。
//
// 本测试用 vm 在 mock 的 WorkerGlobalScope 里真实执行 background.js，覆盖三种场景：
//   1. 正常上下文          -> 三个监听器全部注册成功
//   2. importScripts 抛错   -> 降级为 WR_LICENSE stub，脚本跑完不中断
//   3. chrome.runtime 缺失  -> 静默跳过注册，脚本跑完不中断
//
// 运行：node tests/sw-boot-test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const BG = path.join(ROOT, "background.js");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (extra ? " -> " + JSON.stringify(extra) : ""));
  }
}

// 构造一个 mock 的 service worker 全局作用域
function makeSandbox(opts) {
  opts = opts || {};
  const reg = { onMessage: 0, onInstalled: 0, onStartup: 0, importScripts: [] };

  const runtime = opts.noRuntime
    ? undefined
    : {
        onMessage: { addListener() { reg.onMessage++; } },
        onInstalled: { addListener() { reg.onInstalled++; } },
        onStartup: { addListener() { reg.onStartup++; } },
        getURL: (p) => "chrome-extension://test/" + p,
        sendMessage(m, cb) { cb && cb({}); },
        lastError: null
      };

  const sandbox = {
    chrome: {
      runtime: runtime,
      storage: {
        local: {
          get(o, cb) { cb && cb({}); },
          set(o, cb) { cb && cb(); }
        }
      },
      declarativeNetRequest: {
        updateDynamicRules(o, cb) { cb && cb(); }
      },
      permissions: {
        contains(r, cb) { cb && cb(true); },
        request(r, cb) { cb && cb(true); }
      }
    },
    console: { log() {}, warn() {}, error() {}, info() {} },
    fetch: () => Promise.reject(new Error("no network in test")),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    Promise: Promise,
    JSON: JSON,
    Math: Math,
    Date: Date,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    RegExp: RegExp,
    Uint8Array: Uint8Array,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    isNaN: isNaN,
    parseInt: parseInt,
    parseFloat: parseFloat,
    // 关键：模拟 SW 的 importScripts，把目标脚本注入同一作用域
    importScripts: function (name) {
      reg.importScripts.push(name);
      if (opts.importScriptsThrows) {
        throw new Error("NetworkError: Failed to execute 'importScripts'");
      }
      const src = fs.readFileSync(path.join(ROOT, name), "utf8");
      vm.runInContext(src, sandbox, { filename: name });
    },
    __reg: reg
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function boot(opts) {
  const sandbox = makeSandbox(opts);
  const ctx = vm.createContext(sandbox);
  const src = fs.readFileSync(BG, "utf8");
  let error = null;
  try {
    vm.runInContext(src, ctx, { filename: "background.js" });
  } catch (e) {
    error = e;
  }
  return { sandbox: sandbox, reg: sandbox.__reg, error: error };
}

console.log("=== SW 冷启动防护测试 ===\n");

// ---- 1. 正常上下文 ----
console.log("1. 正常 SW 上下文");
{
  const r = boot();
  check("background.js 执行无异常", r.error === null, r.error && { msg: r.error.message });
  check("importScripts('license.js') 被调用", r.reg.importScripts.join(",") === "license.js", r.reg.importScripts);
  check("onMessage 已注册", r.reg.onMessage === 1, { v: r.reg.onMessage });
  check("onInstalled 已注册", r.reg.onInstalled === 1, { v: r.reg.onInstalled });
  check("onStartup 已注册", r.reg.onStartup === 1, { v: r.reg.onStartup });
  check(
    "WR_LICENSE 来自真实 license.js（非 stub）",
    typeof r.sandbox.WR_LICENSE === "object" && r.sandbox.WR_LICENSE.CONFIG && r.sandbox.WR_LICENSE.CONFIG.ENABLED === false,
    { t: typeof r.sandbox.WR_LICENSE }
  );
}

// ---- 2. importScripts 抛错（热重载竞态）----
console.log("\n2. importScripts 抛 NetworkError");
{
  const r = boot({ importScriptsThrows: true });
  check("background.js 未被中断（无顶层异常）", r.error === null, r.error && { msg: r.error.message });
  check("仍注册了 onMessage（核心功能不瘫）", r.reg.onMessage === 1, { v: r.reg.onMessage });
  check("仍注册了 onInstalled / onStartup", r.reg.onInstalled === 1 && r.reg.onStartup === 1, r.reg);
  check(
    "降级为 WR_LICENSE 兜底 stub",
    typeof r.sandbox.WR_LICENSE === "object" && r.sandbox.WR_LICENSE.can && r.sandbox.WR_LICENSE.record,
    { t: typeof r.sandbox.WR_LICENSE }
  );
  // stub 必须「全放行」，不能因为埋点模块挂了就拦住用户查词
  const res = r.sandbox.WR_LICENSE.can("lookup");
  check(
    "stub 的 can() 全放行（allowed=true）",
    res && typeof res.then === "function"
      ? true
      : res && res.allowed === true,
    res
  );
  const recRes = r.sandbox.WR_LICENSE.record("lookup");
  check("stub 的 record() 返回 Promise 且不抛", recRes && typeof recRes.then === "function", { t: typeof recRes });
}

// ---- 3. chrome.runtime 缺失（SW 上下文失效）----
console.log("\n3. chrome.runtime 为 undefined");
{
  const r = boot({ noRuntime: true });
  check("background.js 未被中断（无顶层异常）", r.error === null, r.error && { msg: r.error.message });
  check("静默跳过注册，未抛 Cannot read properties of undefined", r.reg.onMessage === 0, { v: r.reg.onMessage });
  check("onInstalled / onStartup 也静默跳过", r.reg.onInstalled === 0 && r.reg.onStartup === 0, r.reg);
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：PASS " + pass + " / FAIL " + fail);
if (fail > 0) process.exit(1);
