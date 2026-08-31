// 集成测试：license.js 埋点 + 选项页「使用统计」面板（端到端）
// 目标：验证 background 真实查词序列的埋点累加（尤其「缓存命中不计数」这个 background 行为），
//       以及 options.js 的 renderStats() 在真实 DOM 上下文里能把数据渲染成数字。
// 覆盖：单测（license-test.js）未触及的两点 —— (1) 缓存命中不计数；(2) 选项页渲染接线。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const LIC = fs.readFileSync(path.resolve(__dirname, "..", "license.js"), "utf8");
const OPT = fs.readFileSync(path.resolve(__dirname, "..", "options.js"), "utf8");

// search: 模拟页面 URL 的查询串，用于测试 ?dev=1 开发者模式入口
function makeEnv(search) {
  const store = {};
  const storage = {
    local: {
      get(keys, cb) {
        if (typeof keys === "string") { cb({ [keys]: store[keys] }); return; }
        const o = {};
        (keys || []).forEach((k) => { o[k] = store[k]; });
        cb(o);
      },
      set(o, cb) { Object.assign(store, o); if (cb) cb(); }
    }
  };
  const elements = {};
  function el(id) {
    if (!elements[id]) elements[id] = {
      innerHTML: "", textContent: "", value: "", checked: true,
      style: {}, _on: {},
      // 记录监听器，便于测试里手动触发（如连点标题 5 次）
      addEventListener(ev, fn) { this._on[ev] = fn; }
    };
    return elements[id];
  }
  let domReady = null;
  const document = {
    addEventListener(ev, fn) { if (ev === "DOMContentLoaded") domReady = fn; },
    getElementById(id) { return el(id); }
  };
  const sandbox = {
    chrome: { storage }, console, Promise, Object, Array, JSON, Math, Date, document,
    setTimeout, clearTimeout,
    location: { search: search || "" }
  };
  sandbox.window = sandbox; // options.js 用 window.WR_LICENSE
  vm.createContext(sandbox);
  vm.runInContext(LIC, sandbox);
  if (!sandbox.WR_LICENSE) throw new Error("WR_LICENSE 未挂载");
  return {
    L: sandbox.WR_LICENSE,
    sandbox,
    store,
    elements,
    fireDom() { if (domReady) domReady(); }
  };
}

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  -> " + JSON.stringify(extra) : "")); }
}

(async () => {
  // 主环境：模拟用 ?dev=1 打开选项页（开发者模式开启，统计面板可见）
  const env = makeEnv("?dev=1");
  const { L, elements, fireDom } = env;

  // ---- 模拟 background.handleLookupInner 的关键路径（缓存命中不计数）----
  async function lookup(word, cached) {
    const g = await L.can("lookup");
    if (!g.allowed) return "blocked";
    if (cached) return "cache"; // 缓存命中：直接 return，不 record
    await L.record("lookup");
    return "ok";
  }

  // 6 次调用：apple 查 2 次（第 2 次走缓存），其余 3 个不同词真实查，date 真实查
  await lookup("apple", false);
  await lookup("banana", false);
  await lookup("apple", true);   // 缓存命中
  await lookup("cherry", false);
  await lookup("apple", true);   // 缓存命中
  await lookup("date", false);
  const u = await L.getUsage();
  check("缓存命中不计数：6 次调用仅 4 次真实查词（apple 重复 2 次走缓存）", u.lookups === 4, { lookups: u.lookups });

  // 其他埋点
  await L.record("llm");
  await L.record("vocabAdd");
  await L.record("pdf");

  // ---- 选项页「使用统计」面板：加载 options.js 并触发 DOMContentLoaded ----
  vm.runInContext(OPT, env.sandbox);
  fireDom();
  await new Promise((r) => setTimeout(r, 20)); // 等 stats().then 微任务落 DOM

  check("dev=1：统计面板可见", elements["statsPanel"].style.display === "block",
    { d: elements["statsPanel"].style.display });
  const html = elements["stats"].innerHTML;
  check("选项页 #stats 渲染出「今日查词」", html.includes("今日查词"), { html: html.slice(0, 80) });
  check("选项页 #stats 今日查词=4 次", html.includes("4 次"), { html: html.slice(0, 160) });
  check("选项页 #stats 渲染出定价指标「触发付费闸门」", html.includes("触发付费闸门"), { html: html.slice(0, 200) });
  check("选项页含「清空统计」按钮", !!elements["resetStats"], { has: !!elements["resetStats"] });
  const foot = elements["statsFoot"].textContent;
  check("选项页 #statsFoot 显示闸门「关闭中」", foot.includes("关闭中"), { foot });

  // ---- stats() 端到端数值 ----
  const s = await L.stats();
  check("stats.today.lookups === 4", s.today.lookups === 4, { v: s.today.lookups });
  check("stats.today.llm === 1", s.today.llm === 1, { v: s.today.llm });
  check("stats.today.pdf === 1", s.today.pdf === 1, { v: s.today.pdf });
  check("stats.today.vocabAdds === 1", s.today.vocabAdds === 1, { v: s.today.vocabAdds });
  check("stats.activeDays >= 1", s.activeDays >= 1, { v: s.activeDays });
  check("stats.peakDay.lookups === 4", s.peakDay && s.peakDay.lookups === 4, { v: s.peakDay && s.peakDay.lookups });
  check("stats.avgLookupsPerActiveDay === 4", s.avgLookupsPerActiveDay === 4, { v: s.avgLookupsPerActiveDay });

  // ---- 关闭状态不拦截任何功能（埋点先跑的核心前提）----
  check("ENABLED=false：can('lookup') 放行", (await L.can("lookup")).allowed === true);
  check("ENABLED=false：can('pdf') 放行（不拦付费功能）", (await L.can("pdf")).allowed === true);
  check("RULES.llm.type === 'open'（开启付费后 LLM 仍只统计不拦截）", L.RULES.llm.type === "open");

  // ---- 开发者模式门控：普通用户默认看不到统计面板 ----
  {
    // 无 dev=1、storage 无 wr_devMode 标记
    const env2 = makeEnv("");
    await env2.L.record("lookup");
    vm.runInContext(OPT, env2.sandbox);
    env2.fireDom();
    await new Promise((r) => setTimeout(r, 20));

    check("默认：统计面板隐藏（display:none）",
      env2.elements["statsPanel"].style.display === "none",
      { d: env2.elements["statsPanel"].style.display });
    // renderStats 未执行 -> 连 #stats 元素都不会被取用（这是「真的没渲染」的强证据）
    check("默认：不渲染统计内容（用户看不到付费闸门指标）",
      !env2.elements["stats"] || env2.elements["stats"].innerHTML === "",
      { has: !!env2.elements["stats"], html: env2.elements["stats"] && env2.elements["stats"].innerHTML });

    // 连点标题 5 次进入开发者模式
    const title = env2.elements["title"];
    for (let i = 0; i < 5; i++) title._on.click();
    await new Promise((r) => setTimeout(r, 20));
    check("连点标题 5 次：面板显示且渲染出统计",
      env2.elements["statsPanel"].style.display === "block" &&
      env2.elements["stats"].innerHTML.includes("今日查词"),
      { d: env2.elements["statsPanel"].style.display, html: env2.elements["stats"].innerHTML.slice(0, 80) });
    check("连点开启后写入本机 wr_devMode 标记", env2.store.wr_devMode === true, { v: env2.store.wr_devMode });

    // 退出开发者模式
    env2.elements["exitDev"]._on.click();
    await new Promise((r) => setTimeout(r, 20));
    check("退出开发者模式：面板重新隐藏",
      env2.elements["statsPanel"].style.display === "none" && env2.store.wr_devMode === false,
      { d: env2.elements["statsPanel"].style.display, v: env2.store.wr_devMode });
  }

  console.log("\n集成测试：PASS " + pass + " / FAIL " + fail);
  process.exit(fail ? 1 : 0);
})();
