// 单元测试：license.js 授权与额度模块
// 覆盖：默认关闭不拦截、埋点照常计数、开启后 quota/premium/cap 判定、付费状态、跨天滚动归档
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.resolve(__dirname, "..", "license.js"), "utf8");

// 可控时钟：让「跨天滚动」这类逻辑能被确定性地测试
function makeDate(iso) {
  const fixed = new Date(iso).getTime();
  class D extends Date {
    constructor(...a) {
      if (a.length === 0) super(fixed);
      else super(...a);
    }
    static now() { return fixed; }
  }
  return D;
}

function makeEnv(store, iso) {
  const s = store || {};
  const storage = {
    local: {
      get(keys, cb) {
        if (typeof keys === "string") { cb({ [keys]: s[keys] }); return; }
        const o = {};
        (keys || []).forEach((k) => { o[k] = s[k]; });
        cb(o);
      },
      set(o, cb) { Object.assign(s, o); cb && cb(); }
    }
  };
  const sandbox = {
    chrome: { storage },
    console,
    Promise,
    Object,
    Array,
    JSON,
    Math,
    Date: iso ? makeDate(iso) : Date
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  if (!sandbox.WR_LICENSE) throw new Error("WR_LICENSE 未挂载到 sandbox 全局");
  return { L: sandbox.WR_LICENSE, store: s };
}

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  -> " + JSON.stringify(extra) : "")); }
}

(async () => {
  // ---- 1. 默认关闭：不拦截任何功能 ----
  {
    const { L } = makeEnv();
    const r1 = await L.can("lookup");
    const r2 = await L.can("pdf");
    const r3 = await L.can("export");
    check("默认关闭：查词/PDF/导出 全部放行",
      r1.allowed && r2.allowed && r3.allowed && r1.code === "disabled", { r1, r2, r3 });
    check("默认关闭：CONFIG.ENABLED 为 false", L.CONFIG.ENABLED === false);
  }

  // ---- 2. 关闭状态下埋点照常计数（这是「埋点先跑」的核心）----
  {
    const { L, store } = makeEnv();
    await L.record("lookup");
    await L.record("lookup");
    await L.record("llm");
    await L.record("epub");
    const u = await L.getUsage();
    check("关闭状态仍计数：lookups=2 llm=1 epub=1",
      u.lookups === 2 && u.llm === 1 && u.epub === 1, u);
    check("计数已落盘到 chrome.storage", store.wr_usage && store.wr_usage.lookups === 2, store.wr_usage);
  }

  // ---- 3. 开启后：额度内放行、超额度拦截 ----
  {
    const { L } = makeEnv();
    L.CONFIG.ENABLED = true;
    for (let i = 0; i < 5; i++) await L.record("lookup");
    const ok = await L.can("lookup");
    check("开启后额度内放行且剩余正确（15-5=10）", ok.allowed && ok.left === 10, ok);

    for (let i = 0; i < 10; i++) await L.record("lookup"); // 累计 15
    const no = await L.can("lookup");
    check("超出每日额度被拦截", !no.allowed && no.code === "quota_exceeded" && /额度/.test(no.reason), no);
  }

  // ---- 4. premium 功能：未付费拦截，付费后放行 ----
  {
    const { L, store } = makeEnv();
    L.CONFIG.ENABLED = true;
    const noPdf = await L.can("pdf");
    const noEpub = await L.can("epub");
    const noExport = await L.can("export");
    check("未付费：PDF/EPUB/导出 均被拦截",
      !noPdf.allowed && !noEpub.allowed && !noExport.allowed &&
      noPdf.code === "premium_only", { noPdf, noEpub, noExport });

    await L.setPaid({ paid: true, plan: "lifetime", paidAt: Date.now(), source: "test" });
    const yesPdf = await L.can("pdf");
    const yesLookup = await L.can("lookup");
    check("付费后：全部放行（额度也跳过）",
      yesPdf.allowed && yesPdf.code === "paid" && yesLookup.allowed && yesLookup.code === "paid",
      { yesPdf, yesLookup });
    check("付费状态已持久化", store.wr_paid && store.wr_paid.paid === true, store.wr_paid);
  }

  // ---- 5. LLM 只埋点不拦截（用户自带 Key，不该收钱）----
  {
    const { L } = makeEnv();
    L.CONFIG.ENABLED = true;
    await L.record("llm");
    await L.record("llm");
    const r = await L.can("llm");
    check("LLM 始终放行（type=open）", r.allowed && r.code === "open", r);
    const u = await L.getUsage();
    check("LLM 用量仍被统计", u.llm === 2, u);
  }

  // ---- 6. 生词本容量上限 ----
  {
    const { L } = makeEnv();
    L.CONFIG.ENABLED = true;
    const under = await L.can("vocab", { count: 49 });
    const at = await L.can("vocab", { count: 50 });
    const over = await L.can("vocab", { count: 80 });
    check("生词本 49/50 放行", under.allowed, under);
    check("生词本 50/50 与 80/50 拦截", !at.allowed && !over.allowed && at.code === "cap_reached", { at, over });
  }

  // ---- 7. 跨天滚动：旧数据归档进 history，今日计数归零 ----
  {
    const store = {};
    const day1 = makeEnv(store, "2026-08-01T10:00:00");
    await day1.L.record("lookup");
    await day1.L.record("lookup");
    await day1.L.record("llm");

    const day2 = makeEnv(store, "2026-08-02T10:00:00");
    await day2.L.record("lookup");
    const u2 = await day2.L.getUsage();
    check("跨天：今日计数重置为 1", u2.date === "2026-08-02" && u2.lookups === 1, u2);

    const st = await day2.L.stats();
    const d1 = st.history.filter((d) => d.date === "2026-08-01")[0];
    check("跨天：前一天归档进 history（lookups=2 llm=1）",
      !!d1 && d1.lookups === 2 && d1.llm === 1, st.history);
    check("汇总：累计查词=3 累计LLM=1", st.totals.lookups === 3 && st.totals.llm === 1, st.totals);
    check("汇总：活跃天数=2", st.activeDays === 2, { activeDays: st.activeDays, tracked: st.trackedDays });
    check("汇总：活跃日人均查词=1.5", st.avgLookupsPerActiveDay === 1.5, { v: st.avgLookupsPerActiveDay });
    check("汇总：峰值日为 08-01（2 次）",
      st.peakDay && st.peakDay.date === "2026-08-01" && st.peakDay.lookups === 2, st.peakDay);
  }

  // ---- 8. 空用量日不污染 history ----
  {
    const store = {};
    const a = makeEnv(store, "2026-09-01T10:00:00");
    await a.L.getUsage(); // 只读，不产生任何用量
    const b = makeEnv(store, "2026-09-02T10:00:00");
    const st = await b.L.stats();
    check("无用量的一天不写入 history", st.history.length === 0, st.history);
  }

  // ---- 9. 付费墙 HTML 可用 ----
  {
    const { L } = makeEnv();
    const html = L.paywallHtml("pdf", "「PDF 划词」是付费功能。");
    check("付费墙 HTML 含解锁按钮", /data-wr-act="upgrade"/.test(html) && /立即解锁/.test(html));
  }

  // ---- 10. 关闭状态下也记录「本会被拦截」次数（定价依据，埋点先跑的核心）----
  {
    const { L } = makeEnv();
    for (let i = 0; i < 15; i++) await L.record("lookup"); // 填满免费额度 15
    await L.can("lookup"); // 第 16 次：超额度 -> 记 1 次闸门（仍放行，因未开启）
    await L.can("pdf");    // premium_only -> 记 1 次
    await L.can("epub");   // premium_only -> 记 1 次
    await L.can("export"); // premium_only -> 记 1 次
    const u = await L.getUsage();
    const st = await L.stats();
    check("关闭状态也记 paywallHits：超额1 + 付费功能3 = 4", u.paywallHits === 4, u);
    check("stats 汇总 paywallHits=4", st.totals.paywallHits === 4, st.totals);
    check("stats.paywallDays=1", st.paywallDays === 1, { v: st.paywallDays });
    // 捕获计数后再验证「仍全部放行」（不真正拦截）
    check("且仍全部放行（不真正拦截）",
      (await L.can("lookup")).allowed && (await L.can("pdf")).allowed, {});
  }

  // ---- 11. 清空统计：仅清用量，付费状态保留 ----
  {
    const { L } = makeEnv();
    await L.record("lookup");
    await L.record("paywallHit");
    await L.setPaid({ paid: true, plan: "lifetime", paidAt: Date.now(), source: "test" });
    await L.resetAll();
    const u = await L.getUsage();
    check("resetAll 后今日用量归零", u.lookups === 0 && u.paywallHits === 0, u);
    const paid = await L.getPaid();
    check("resetAll 不影响付费状态（paid 仍为 true）", paid.paid === true, paid);
  }

  console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：PASS " + pass + " / FAIL " + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
