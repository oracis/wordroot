/*
 * license.js — 授权与额度模块（WordRoot 付费化「技术准备」）
 *
 * 设计原则：**埋点先跑，强制执行后开**
 *
 *   CONFIG.ENABLED = false（当前状态）：
 *     - can() 恒返回 allowed:true —— 不拦截任何用户，零体验变化
 *     - record() 照常计数 —— 先把真实用量数据攒起来，用数据决定定价
 *     - 默认不发起任何网络请求；仅当用户在选项页勾选「匿名改进计划」后，
 *       才上报纯计数（不含查了什么单词、不含 IP、不可识别个人）
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
    HISTORY_DAYS: 30, // 保留多少天的用量历史
    // ---- 匿名聚合上报（默认全关，需用户 opt-in）----
    REPORT_URL: "", // 接收端地址，留空 = 不上报
    REPORT_TOKEN: "", // 可选共享密钥（sendBeacon 走 ?t=，fetch 走 header x-wr-token），空 = 不校验
    REPORT_OPTIN_KEY: "wr_report", // 选项页开关存这里
    REPORT_LAST_KEY: "wr_report_last", // 当天已上报的日期，去重用
    ANON_ID_KEY: "wr_anon_id" // 每台机器固定匿名 id，仅服务端按天去重用，不可识别个人
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

  var METRICS = ["lookups", "llm", "pdf", "epub", "exports", "vocabAdds"];

  var KEY_USAGE = "wr_usage";
  var KEY_HIST = "wr_usage_hist";
  var KEY_PAID = "wr_paid";
  // 上报相关 key 单一来源（取自 CONFIG，避免两边不一致）
  var KEY_REPORT_OPTIN = CONFIG.REPORT_OPTIN_KEY;
  var KEY_REPORT_LAST = CONFIG.REPORT_LAST_KEY;
  var KEY_ANON_ID = CONFIG.ANON_ID_KEY;

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
    var map = { lookup: "lookups", llm: "llm", pdf: "pdf", epub: "epub", export: "exports", vocabAdd: "vocabAdds" };
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
  function can(feature, extra) {
    if (!CONFIG.ENABLED) {
      return Promise.resolve({ allowed: true, code: "disabled", reason: "", left: null });
    }
    var rule = RULES[feature];
    if (!rule) return Promise.resolve({ allowed: true, code: "ok", reason: "", left: null });

    return Promise.all([getUsage(), getPaid()]).then(function (r) {
      var u = r[0];
      var paid = r[1];
      if (paid.paid) return { allowed: true, code: "paid", reason: "", left: null };

      var name = FEATURE_NAMES[feature] || feature;

      if (rule.type === "open") return { allowed: true, code: "open", reason: "", left: null };

      if (rule.type === "quota") {
        var used = u[rule.metric] || 0;
        var left = rule.limit - used;
        if (left <= 0) {
          return {
            allowed: false,
            code: "quota_exceeded",
            reason: "今日免费额度已用完（" + name + " " + rule.limit + " 次/天）。解锁后不限次数。",
            left: 0
          };
        }
        return { allowed: true, code: "ok", reason: "", left: left };
      }

      if (rule.type === "cap") {
        var count = (extra && extra.count) || 0;
        if (count >= rule.limit) {
          return {
            allowed: false,
            code: "cap_reached",
            reason: "免费版生词本上限 " + rule.limit + " 个词（当前 " + count + " 个）。解锁后不限容量。",
            left: 0
          };
        }
        return { allowed: true, code: "ok", reason: "", left: rule.limit - count };
      }

      // premium
      return {
        allowed: false,
        code: "premium_only",
        reason: "「" + name + "」是付费功能。",
        left: 0
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

      return {
        enabled: CONFIG.ENABLED,
        today: u,
        history: hist,
        totals: totals,
        activeDays: activeDays,
        trackedDays: hist.length + 1,
        avgLookupsPerActiveDay: activeDays ? Math.round((totals.lookups / activeDays) * 10) / 10 : 0,
        peakDay: peak,
        paid: o[KEY_PAID] || { paid: false }
      };
    });
  }

  function resetAll() {
    return sSet({ wr_usage: blankUsage(todayStr()), wr_usage_hist: [], wr_paid: { paid: false, plan: null, paidAt: null, source: null } })
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

  // ---- 匿名聚合上报（仅计数，不含单词/IP，需用户 opt-in）----
  // 每台机器生成一次固定匿名 id，只用于服务端按天去重，不可反查个人
  function anonId() {
    return sGet([KEY_ANON_ID]).then(function (o) {
      if (o[KEY_ANON_ID]) return o[KEY_ANON_ID];
      var id = "a" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      return sSet({ wr_anon_id: id }).then(function () { return id; });
    });
  }

  // 真正把 payload 发出去。优先 sendBeacon（页面/SW 卸载也可靠），兜底 fetch keepalive
  function sendReport(payload) {
    try {
      var url = CONFIG.REPORT_URL;
      if (!url) return false;
      var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      if (navigator && navigator.sendBeacon) {
        // sendBeacon 不支持自定义 header，token 放 query 参数
        var sep = url.indexOf("?") >= 0 ? "&" : "?";
        var u = url + sep + "t=" + encodeURIComponent(CONFIG.REPORT_TOKEN || "");
        return navigator.sendBeacon(u, blob);
      }
      fetch(url, {
        method: "POST",
        body: blob,
        keepalive: true,
        headers: { "Content-Type": "application/json", "x-wr-token": CONFIG.REPORT_TOKEN }
      }).catch(function () {});
      return true;
    } catch (e) {
      return false;
    }
  }

  // 上报当日用量。返回 {sent, reason}。opt-in 关 / 无 URL / 当天已报 / 发送失败 都不发
  function reportUsage() {
    return sGet([KEY_REPORT_OPTIN]).then(function (o) {
      if (!o[KEY_REPORT_OPTIN]) return { sent: false, reason: "optout" };
      if (!CONFIG.REPORT_URL) return { sent: false, reason: "nourl" };
      return getUsage().then(function (u) {
        return sGet([KEY_REPORT_LAST]).then(function (s) {
          var today = todayStr();
          if (s[KEY_REPORT_LAST] === today) return { sent: false, reason: "already" };
          return anonId().then(function (id) {
            var payload = {
              v: chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : "?",
              date: today,
              id: id,
              lookups: u.lookups || 0,
              llm: u.llm || 0,
              pdf: u.pdf || 0,
              epub: u.epub || 0,
              exports: u.exports || 0,
              vocabAdds: u.vocabAdds || 0
            };
            var ok = sendReport(payload);
            if (ok) sSet({ wr_report_last: today }); // 无论服务端是否收到都标记，避免疯狂重试
            return { sent: ok, reason: ok ? "ok" : "failed" };
          });
        });
      });
    });
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
    openPaymentPage: openPaymentPage,
    reportUsage: reportUsage
  };

  root.WR_LICENSE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof self !== "undefined" ? self : this);
