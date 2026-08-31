// 单元测试：background.js 的发音分流（handleTts）——有道直连 / 自建中继两条路径
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BG = fs.readFileSync(path.resolve(__dirname, "..", "background.js"), "utf8");

function makeEnv(ttsMode, ttsRelay) {
  const calls = [];
  const storage = {
    local: {
      get(keys, cb) {
        if (Array.isArray(keys)) {
          const o = {};
          if (keys.includes("ttsMode")) o.ttsMode = ttsMode;
          if (keys.includes("ttsRelay")) o.ttsRelay = ttsRelay;
          cb(o);
        }
      },
      set(o, cb) { cb && cb(); }
    }
  };
  const chrome = {
    runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getURL: (p) => "chrome-extension://t/" + p, lastError: null },
    storage,
    declarativeNetRequest: { updateDynamicRules(o, cb) { cb && cb(); } },
    // 测试环境默认授予 localhost 权限，让 online 模式走通
    permissions: { contains(req, cb) { cb && cb(true); }, request(req, cb) { cb && cb(true); } }
  };
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const sandbox = { chrome, fetch, console, URLSearchParams, Promise, Uint8Array, Array, encodeURIComponent, Date, Math };
  // MV3 service worker 的 importScripts：把同扩展内脚本载入同一 context（background.js 用它加载 license.js）
  sandbox.importScripts = function (p) {
    const src = fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
    vm.runInContext(src, sandbox);
  };
  vm.createContext(sandbox);
  vm.runInContext(BG, sandbox); // 定义 handleTts / handleTtsOnline / getTtsSettings
  return { handleTts: sandbox.handleTts, calls };
}

(async () => {
  // 用例 1：默认（未设置）→ 有道直连，GET dictvoice,type=1
  {
    const { handleTts, calls } = makeEnv(undefined, "");
    const buf = await handleTts("trajectory", "http://localhost:8787");
    const c = calls[0];
    const ok = c.url.includes("dict.youdao.com/dictvoice?audio=trajectory&type=1") && c.opts === undefined;
    console.log("case1 youdao 默认:", ok ? "PASS" : "FAIL", "->", c.url);
  }
  // 用例 2：youdao 模式 → 有道，忽略 relay
  {
    const { handleTts, calls } = makeEnv("youdao", "");
    await handleTts("project", "http://localhost:8787");
    const c = calls[0];
    console.log("case2 youdao 模式:", c.url.includes("dict.youdao.com") ? "PASS" : "FAIL", "->", c.url);
  }
  // 用例 3：online 模式 + storage 有中继地址 → POST 到该中继 /tts
  {
    const { handleTts, calls } = makeEnv("online", "http://localhost:9000");
    await handleTts("eject", "http://localhost:8787");
    const c = calls[0];
    const ok = c.url === "http://localhost:9000/tts" && c.opts.method === "POST";
    console.log("case3 online 用 storage 地址:", ok ? "PASS" : "FAIL", "->", c.url, c.opts && c.opts.method);
  }
  // 用例 4：online 模式但 storage 无地址 → 用 content 传参兜底
  {
    const { handleTts, calls } = makeEnv("online", "");
    await handleTts("object", "http://localhost:8787");
    const c = calls[0];
    console.log("case4 online content 兜底:", c.url === "http://localhost:8787/tts" ? "PASS" : "FAIL", "->", c.url);
  }
  process.exit(0);
})();
