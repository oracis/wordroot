// 单元测试：handleLookup 新链路 —— 缓存→内置词典→离线高频库→LLM(有key)/有道兜底(无key或LLM失败)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BG = fs.readFileSync(path.resolve(__dirname, "..", "background.js"), "utf8");

function makeEnv({ cache = {}, apiKey = "", youdaoOk = true, llmOk = true, offlineDict = null }) {
  const fetches = [];
  const store = Object.assign({}, cache);
  if (apiKey) store.apiKey = apiKey;
  const storage = {
    local: {
      get(keys, cb) {
        if (typeof keys === "string") { cb({ [keys]: store[keys] }); return; }
        const o = {};
        (keys || []).forEach((k) => { o[k] = store[k]; });
        cb(o);
      },
      set(o, cb) { Object.assign(store, o); cb && cb(); }
    }
  };
  const chrome = {
    runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getURL: (p) => "chrome-extension://t/" + p, lastError: null },
    storage,
    declarativeNetRequest: { updateDynamicRules(o, cb) { cb && cb(); } }
  };
  const fetch = async (url, opts) => {
    fetches.push(url);
    if (String(url).startsWith("chrome-extension://t/dict/offline.json")) {
      if (!offlineDict) throw new Error("no offline");
      return { ok: true, json: async () => offlineDict };
    }
    if (String(url).includes("dict.youdao.com/jsonapi")) {
      if (!youdaoOk) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({
        ec: { word: [{ ukphone: "ˈjuːdu", usphone: "ˈjuːduː", trs: [{ tr: [{ l: { i: ["n. 测试释义甲"] } }] }, { tr: [{ l: { i: ["v. 测试释义乙"] } }] }] }] },
        "uk-phonetic": [{ phonetic: "ˈjuːdu" }], "us-phonetic": [{ phonetic: "ˈjuːduː" }],
        etym: { etyms: { zh: [{ value: "源自古英语，由 x 和 y 组合构成。\n\n代表同一立场。" }] } },
        rel_word: { rels: [{ rel: { pos: "adj.", words: [{ word: "understanding", tran: " 了解的" }, { word: "understandable", tran: " 可理解的" }] } }, { rel: { pos: "n.", words: [{ word: "understood", tran: " 已理解的" }] } }] },
        "blng_sents_part": { "sentence-pair": [{ sentence: "I fully understand your motives.", "sentence-translation": "我完全理解你的动机。" }, { sentence: "A.", "sentence-translation": "B。" }] }
      }) };
    }
    if (String(url).includes("/chat/completions")) {
      if (!llmOk) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ word: "foo", uk: "/x/", breakdown: "f-oo", etymology: "LLM词源", mnemonics: ["m1"], usages: ["u1"], examples: [{ en: "E", zh: "译" }] }) } }] }) };
    }
    throw new Error("unexpected url " + url);
  };
  const sandbox = { chrome, fetch, console, URLSearchParams, Promise, Uint8Array, Array, JSON, encodeURIComponent, Object, Date, Math };
  // MV3 service worker 的 importScripts：把同扩展内脚本载入同一 context（background.js 用它加载 license.js）
  sandbox.importScripts = function (p) {
    const src = fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
    vm.runInContext(src, sandbox);
  };
  vm.createContext(sandbox);
  vm.runInContext(BG, sandbox);
  return { handleLookup: sandbox.handleLookup, fetches, store };
}

(async () => {
  // 用例 1：缓存命中 → 不发起任何网络
  {
    const env = makeEnv({ cache: { "ety:foo": { word: "foo", breakdown: "缓存" } } });
    const r = await env.handleLookup("Foo");
    console.log("case1 缓存命中:", r.type === "ok" && r.cached === true && env.fetches.length === 0 ? "PASS" : "FAIL");
  }
  // 用例 2：无 key、离线词库命中 → 返回离线简明数据，不碰网络
  {
    const env = makeEnv({ offlineDict: { apple: { uk: "/ˈæpl/", defs: [{ pos: "n.", tran: "苹果" }] } } });
    const r = await env.handleLookup("apple");
    console.log("case2 离线高频命中:", r.type === "ok" && r.data.defs && r.data.defs[0].tran === "苹果" && r.data.source === "offline" ? "PASS" : "FAIL", JSON.stringify(r.data));
  }
  // 用例 3：无 key、离线未命中 → 有道兜底（含 释义+词源+同根词+例句）
  {
    const env = makeEnv({});
    const r = await env.handleLookup("xyzabc");
    const d = r.data;
    const ok = r.type === "ok" && d.defs && d.defs.length === 2 && d.source === "youdao" &&
      d.us === "/ˈjuːduː/" &&
      d.etymology && d.etymology.includes("源自古英语") &&
      d.related && d.related.length === 3 && d.related[0].word === "understanding" &&
      d.examples && d.examples.length === 2 && d.examples[0].zh === "我完全理解你的动机。";
    console.log("case3 无key有道全字段兜底:", ok ? "PASS" : "FAIL",
      "defs=", d.defs && d.defs.length, "etym=", !!d.etymology, "rel=", d.related && d.related.length, "ex=", d.examples && d.examples.length);
  }
  // 用例 2b：离线命中变形词 → 用原型音标回填
  {
    const env = makeEnv({ offlineDict: { model: { uk: "/ˈmɒd(ə)l/", defs: [{ pos: "n.", tran: "模型" }] }, models: { defs: [{ pos: "n.", tran: "model 的复数" }] } } });
    const r = await env.handleLookup("models");
    const ok = r.type === "ok" && r.data.uk === "/ˈmɒd(ə)l/" && r.data._lemma === "model" && r.data.source === "offline";
    console.log("case2b 变形词原型回填:", ok ? "PASS" : "FAIL", JSON.stringify(r.data));
  }
  // 用例 4：有 key → LLM 优先
  {
    const env = makeEnv({ apiKey: "sk-test" });
    const r = await env.handleLookup("hello");
    console.log("case4 有key LLM优先:", r.type === "ok" && r.data.etymology === "LLM词源" ? "PASS" : "FAIL");
  }
  // 用例 5：有 key 但 LLM 失败 → 有道兜底
  {
    const env = makeEnv({ apiKey: "sk-test", llmOk: false });
    const r = await env.handleLookup("hello");
    console.log("case5 LLM失败降级有道:", r.type === "ok" && r.data.source === "youdao" ? "PASS" : "FAIL");
  }
  // 用例 6：无 key 且有道也失败 → need_key
  {
    const env = makeEnv({ youdaoOk: false });
    const r = await env.handleLookup("zzzqqq");
    console.log("case6 双失败→need_key:", r.type === "need_key" ? "PASS" : "FAIL", "->", r.type);
  }
  process.exit(0);
})();
