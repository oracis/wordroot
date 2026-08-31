/*
 * license.js — 授权与额度模块（WordRoot 付费化「技术准备」）
 *
 * 设计原则：**埋点先跑，强制执行后开**
 *
 *   CONFIG.ENABLED = false（当前状态）：
 *     - can() 恒返回 allowed:true —— 不拦截任何用户，零体验变化
 *     - record() 照常计数 —— 先把真实用量数据攒起来，用数据决定定价
 *     - 不发起任何网络请求，不加载任何远程脚本（统计仅存本机 chrome.storage.local）
 *
 *   CONFIG.ENABLED = true：
 *     - 按 RULES 拦截未付费用户
 *
 * 未来接入 ExtensionPay 只需三步：
 *   1. 把 ExtPay.js **下载到本目录**（MV3 禁止远程加载脚本，不能挂 CDN）
 *      并在 background service worker 里 importScripts("ExtPay.js")
 *   2. CONFIG.ENABLED = true，CONFIG.EXTENSION_ID = '你的扩展ID'
 *   3. 在 refreshPaid() 里接 extpay.getUser()，把结果写入 wr_paid
 *
 * 注意：本模块被 4 类上下文共用，保持无副作用、无 DOM 依赖：
 *   - background service worker（importScripts）
 *   - content script（manifest content_scripts）
 *   - vocab.html / reader.html（<script src>）
 */
(function (root) {
  "use strict";

  // ---- 配置：改这里 ----
  var CONFIG = {
    ENABLED: false, // 主开关。false = 全部免费，只埋点不拦截
    EXTENSION_ID: "", // ExtensionPay 注册后填入
    DAILY_FREE_LOOKUPS: 15, // 免费层每日查词额度（缓存命中不计数）
    FREE_VOCAB_LIMIT: 50, // 免费层生词本容量上限
    HISTORY_DAYS: 30 // 保留多少天的用量历史
  };

  // ---- 功能点：改这里调整哪些收费 ----
  var FEATURE_NAMES = {
    lookup: "查词",
    llm: "AI 词源拆解",
    pdf: "PDF 划词",
    epub: "EPUB 划词",
    export: "生词本导出",
    vocab: "生词本容量"
  };

  // type: quota = 每日额度；premium = 付费专属；cap = 数量上限（需传 count）；open = 只埋点不拦截
  var RULES = {
    lookup: { type: "quota", metric: "lookups", limit: CONFIG.DAILY_FREE_LOOKUPS },
    // LLM 用的是用户自己的 Key、花的是他自己的钱 —— 不设限，只统计用量
    llm: { type: "open" },
    pdf: { type: "premium" },
    epub: { type: "premium" },
    export: { type: "premium" },
    vocab: { type: "cap", limit: CONFIG.FREE_VOCAB_LIMIT }
  };

  var METRICS = ["lookups", "llm", "pdf", "epub", "exports", "vocabAdds", "paywallHits"];

  var KEY_USAGE = "wr_usage";
  var KEY_HIST = "wr_usage_hist";
  var KEY_PAID = "wr_paid";

  // ---- 工具 ----
  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function sGet(keys) {
    return new Promise(function (res) {
      try { chrome.storage.local.get(keys, function (o) { res(o || {}); }); }
      catch (e) { res({}); }
    });
  }

  function sSet(obj) {
    return new Promise(function (res) {
      try { chrome.storage.local.set(obj, function () { res(true); }); }
      catch (e) { res(false); }
    });
  }

  function blankUsage(date) {
    var u = { date: date };
    for (var i = 0; i < METRICS.length; i++) u[METRICS[i]] = 0;
    return u;
  }

  // ---- 用量读写（跨天自动滚动，旧数据进历史）----
  function getUsage() {
    var today = todayStr();
    return sGet([KEY_USAGE, KEY_HIST]).then(function (o) {
      var u = o[KEY_USAGE];
      if (u && u.date === today) return u;
      var hist = o[KEY_HIST] || [];
      if (u && u.date) {
        // 只归档有实际用量的日子，避免空记录刷屏
        var used = METRICS.some(function (m) { return (u[m] || 0) > 0; });
        if (used) {
          hist.push(u);
          if (hist.length > CONFIG.HISTORY_DAYS) hist = hist.slice(-CONFIG.HISTORY_DAYS);
        }
      }
      var fresh = blankUsage(today);
      return sSet({ wr_usage: fresh, wr_usage_hist: hist }).then(function () { return fresh; });
    });
  }

  // 计数。ENABLED 与否都会记 —— 这就是「埋点先跑」的意义
  function record(action, n) {
    var map = { lookup: "lookups", llm: "llm", pdf: "pdf", epub: "epub", export: "exports", vocabAdd: "vocabAdds", paywallHit: "paywallHits" };
    var metric = map[action];
    if (!metric) return Promise.resolve(null);
    return getUsage().then(function (u) {
      u[metric] = (u[metric] || 0) + (n || 1);
      return sSet({ wr_usage: u }).then(function () { return u; });
    });
  }

  // ---- 付费状态（ExtensionPay 接入点）----
  function getPaid() {
    return sGet([KEY_PAID]).then(function (o) {
      return o[KEY_PAID] || { paid: false, plan: null, paidAt: null, source: null };
    });
  }

  function setPaid(v) {
    return sSet({ wr_paid: v }).then(function () { return v; });
  }

  // ExtensionPay 接入后在这里拉真实状态；当前为空实现
  function refreshPaid() {
    if (!CONFIG.ENABLED || !CONFIG.EXTENSION_ID) return getPaid();
    return getPaid();
  }

  // ---- 判定核心 ----
  // can(feature) -> Promise<{allowed, code, reason, left}>
  //   code: disabled | paid | ok | quota_exceeded | premium_only | cap_reached
  //
  // 设计要点：**无论是否真正开启强制，都会先算出「本会被拦截」的结果并埋点**。
  // 这样在 CONFIG.ENABLED=false（埋点先跑）阶段，就能准确统计「假如现在收费，
  // 会有多少次触发付费墙」——这是定价决策最直接的依据。
  function can(feature, extra) {
    var rule = RULES[feature];
    if (!rule) return Promise.resolve({ allowed: true, code: "ok", reason: "", left: null });

    return Promise.all([getUsage(), getPaid()]).then(function (r) {
      var u = r[0];
      var paid = r[1];
      var name = FEATURE_NAMES[feature] || feature;

      // 先算出「如果开启强制，会是什么结果」
      var decision = "ok";
      var reason = "";
      var left = null;

      if (paid.paid) {
        decision = "paid";
      } else if (rule.type === "open") {
        decision = "open";
      } else if (rule.type === "quota") {
        var used = u[rule.metric] || 0;
        left = rule.limit - used;
        if (left <= 0) {
          decision = "quota_exceeded";
          reason = "今日免费额度已用完（" + name + " " + rule.limit + " 次/天）。解锁后不限次数。";
        }
      } else if (rule.type === "cap") {
        var count = (extra && extra.count) || 0;
        if (count >= rule.limit) {
          decision = "cap_reached";
          reason = "免费版生词本上限 " + rule.limit + " 个词（当前 " + count + " 个）。解锁后不限容量。";
        }
      } else {
        decision = "premium_only";
        reason = "「" + name + "」是付费功能。";
      }

      // 埋点：只要「本会被拦截」就计数（开启或关闭都记），用于估算潜在付费需求
      var wouldBlock = decision === "quota_exceeded" || decision === "premium_only" || decision === "cap_reached";
      if (wouldBlock) record("paywallHit");

      // 真正放行与否仍取决于主开关；code 保留原始语义供调用方判断
      var allowed = CONFIG.ENABLED ? !wouldBlock : true;
      var code = wouldBlock ? decision : (CONFIG.ENABLED ? decision : "disabled");
      return {
        allowed: allowed,
        code: code,
        reason: CONFIG.ENABLED ? reason : "",
        left: CONFIG.ENABLED ? left : null
      };
    });
  }

  // ---- 统计：给选项页/决策用 ----
  function stats() {
    return sGet([KEY_USAGE, KEY_HIST, KEY_PAID]).then(function (o) {
      var today = todayStr();
      var u = o[KEY_USAGE] && o[KEY_USAGE].date === today ? o[KEY_USAGE] : blankUsage(today);
      var hist = o[KEY_HIST] || [];
      var totals = blankUsage("-");
      var peak = null;

      for (var i = 0; i < METRICS.length; i++) totals[METRICS[i]] = 0;

      hist.concat([u]).forEach(function (d) {
        for (var i = 0; i < METRICS.length; i++) totals[METRICS[i]] += d[METRICS[i]] || 0;
        if (!peak || (d.lookups || 0) > (peak.lookups || 0)) peak = d;
      });

      var activeDays = hist.concat([u]).filter(function (d) {
        return (d.lookups || 0) > 0 || (d.llm || 0) > 0 || (d.pdf || 0) > 0 || (d.epub || 0) > 0;
      }).length;

      // 定价核心：有多少天触发过付费闸门、峰值单日、活跃日人均触发
      var paywallDays = hist.concat([u]).filter(function (d) {
        return (d.paywallHits || 0) > 0;
      }).length;

      var peakPaywall = null;
      hist.concat([u]).forEach(function (d) {
        if (!peakPaywall || (d.paywallHits || 0) > (peakPaywall.paywallHits || 0)) peakPaywall = d;
      });

      return {
        enabled: CONFIG.ENABLED,
        today: u,
        history: hist,
        totals: totals,
        activeDays: activeDays,
        paywallDays: paywallDays,
        trackedDays: hist.length + 1,
        avgLookupsPerActiveDay: activeDays ? Math.round((totals.lookups / activeDays) * 10) / 10 : 0,
        avgPaywallPerActiveDay: activeDays ? Math.round((totals.paywallHits / activeDays) * 10) / 10 : 0,
        peakDay: peak,
        peakPaywallDay: peakPaywall,
        paid: o[KEY_PAID] || { paid: false }
      };
    });
  }

  // 清空全部使用统计（不影响付费状态）。供选项页「清空统计」按钮调用。
  function resetAll() {
    return sSet({ wr_usage: blankUsage(todayStr()), wr_usage_hist: [] })
      .then(function () { return stats(); });
  }

  // ---- 付费墙 UI 占位（ENABLED=false 时不会走到）----
  function paywallHtml(feature, reason) {
    return (
      '<div class="wr-paywall">' +
      '<div class="wr-paywall-t">解锁完整版</div>' +
      '<div class="wr-paywall-r">' + (reason || (FEATURE_NAMES[feature] || "此功能") + "需要解锁") + "</div>" +
      '<button class="wr-paywall-btn" data-wr-act="upgrade">立即解锁</button>' +
      '<div class="wr-paywall-n">一次买断，永久可用 · 无需订阅</div>' +
      "</div>"
    );
  }

  function openPaymentPage() {
    if (!CONFIG.ENABLED) return Promise.resolve(false);
    return Promise.resolve(false); // ExtensionPay: extpay.openPaymentPage()
  }

  var API = {
    CONFIG: CONFIG,
    FEATURE_NAMES: FEATURE_NAMES,
    RULES: RULES,
    record: record,
    can: can,
    getUsage: getUsage,
    getPaid: getPaid,
    setPaid: setPaid,
    refreshPaid: refreshPaid,
    stats: stats,
    resetAll: resetAll,
    paywallHtml: paywallHtml,
    openPaymentPage: openPaymentPage
  };

  root.WR_LICENSE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof self !== "undefined" ? self : this);
