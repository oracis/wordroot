document.addEventListener("DOMContentLoaded", function () {
  const apiKey = document.getElementById("apiKey");
  const baseURL = document.getElementById("baseURL");
  const model = document.getElementById("model");
  const ttsMode = document.getElementById("ttsMode");
  const ttsRelay = document.getElementById("ttsRelay");
  const autoPdf = document.getElementById("autoPdf");
  const msg = document.getElementById("msg");

  chrome.storage.local.get(["apiKey", "baseURL", "model", "ttsMode", "ttsRelay", "autoPdf"], function (o) {
    apiKey.value = o.apiKey || "";
    baseURL.value = o.baseURL || "";
    model.value = o.model || "";
    ttsMode.value = o.ttsMode || "youdao";
    ttsRelay.value = o.ttsRelay || "http://localhost:8787";
    autoPdf.checked = o.autoPdf === undefined ? true : !!o.autoPdf;
  });

  const openVocab = document.getElementById("openVocab");
  if (openVocab) openVocab.addEventListener("click", function () {
    chrome.tabs.create({ url: chrome.runtime.getURL("vocab.html") });
  });

  // 清空统计（仅本机用量，不影响付费状态）
  const resetStats = document.getElementById("resetStats");
  if (resetStats) resetStats.addEventListener("click", function () {
    if (window.confirm("确定清空本机所有使用统计？此操作不可恢复。")) {
      WR_LICENSE.resetAll().then(function () { renderStats(); });
    }
  });

  // ---- 开发者模式门控：使用统计面板默认对普通用户隐藏 ----
  // 开启方式（二选一）：① 本页 URL 后加 ?dev=1  ② 连点标题 5 次
  // 状态存本机 chrome.storage.local，只影响当前浏览器 profile
  var DEV_KEY = "wr_devMode";

  function isDevUrl() {
    try {
      return /[?&]dev=1(?:&|$)/.test((window.location && window.location.search) || "");
    } catch (e) { return false; }
  }

  function applyDevMode(on) {
    var p = document.getElementById("statsPanel");
    if (p && p.style) p.style.display = on ? "block" : "none";
    if (on) renderStats();
  }

  function setDevMode(on) {
    try { chrome.storage.local.set({ wr_devMode: !!on }); } catch (e) {}
    applyDevMode(!!on);
  }

  function initDevMode() {
    if (isDevUrl()) { setDevMode(true); return; }
    try {
      chrome.storage.local.get([DEV_KEY], function (o) {
        applyDevMode(!!(o && o[DEV_KEY]));
      });
    } catch (e) { applyDevMode(false); }
  }

  initDevMode();

  // 标题连点 5 次进入开发者模式（1.5s 内计满重置）
  var titleHits = 0, titleTimer = null;
  var title = document.getElementById("title");
  if (title) title.addEventListener("click", function () {
    titleHits++;
    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(function () { titleHits = 0; }, 1500);
    if (titleHits >= 5) { titleHits = 0; setDevMode(true); }
  });

  var exitDev = document.getElementById("exitDev");
  if (exitDev) exitDev.addEventListener("click", function () { setDevMode(false); });

  document.getElementById("save").addEventListener("click", function () {
    // 自建中转走的是 <all_urls> 已覆盖的本地地址，无需动态申请权限
    chrome.storage.local.set(
      {
        apiKey: apiKey.value.trim(),
        baseURL: baseURL.value.trim(),
        model: model.value.trim(),
        ttsMode: ttsMode.value,
        ttsRelay: ttsRelay.value.trim(),
        autoPdf: autoPdf.checked
      },
      function () {
        chrome.runtime.sendMessage({ type: "SET_AUTOPDF", value: autoPdf.checked }, function () {
          msg.textContent = "已保存 ✓";
          setTimeout(function () { msg.textContent = ""; }, 2000);
        });
      }
    );
  });
});

function renderStats() {
  const table = document.getElementById("stats");
  if (!table || !window.WR_LICENSE) return;
  WR_LICENSE.stats().then(function (s) {
    // 面板顺序：定价决策指标（★）放最前，使用量作背景参考
    const rows = [
      ["★ 今日触发付费闸门", s.today.paywallHits + " 次"],
      ["★ 累计触发付费闸门", s.totals.paywallHits + " 次"],
      ["触发闸门的天数", s.paywallDays + " / " + s.trackedDays + " 天"],
      ["活跃日人均触发", s.avgPaywallPerActiveDay + " 次/天"],
      ["峰值单日触发", s.peakPaywallDay ? (s.peakPaywallDay.date + "：" + s.peakPaywallDay.paywallHits + " 次") : "—"],
      ["—", "—"],
      ["今日查词", s.today.lookups + " 次"],
      ["今日 AI 词源", s.today.llm + " 次"],
      ["今日 PDF / EPUB 打开", s.today.pdf + " / " + s.today.epub + " 次"],
      ["今日导出 / 收藏", s.today.exports + " / " + s.today.vocabAdds + " 次"],
      ["—", "—"],
      ["累计查词", s.totals.lookups + " 次"],
      ["累计 AI 词源", s.totals.llm + " 次"],
      ["有使用记录的活跃天数", s.activeDays + " / " + s.trackedDays + " 天"]
    ];
    table.innerHTML = rows
      .map(function (r) {
        if (r[0] === "—") return '<tr><td colspan="2" style="border-top:1px solid #eee;padding:2px 0"></td></tr>';
        var key = r[0].indexOf("★") === 0;
        var c = key ? "#b06a2c" : "#666";
        return (
          '<tr>' +
          '<td style="padding:4px 0;color:' + c + ';font-weight:' + (key ? "600" : "400") + '">' + r[0] + "</td>" +
          '<td style="padding:4px 0;text-align:right;font-weight:600;color:' + c + '">' + r[1] + "</td>" +
          "</tr>"
        );
      })
      .join("");

    const foot = document.getElementById("statsFoot");
    if (foot) {
      foot.textContent = s.enabled
        ? "付费闸门：已开启（达额度/付费功能会被拦截）"
        : "付费闸门：关闭中（全部免费）。「触发付费闸门」统计的是假如现在开启强制、会被拦的次数——这就是定价依据。查词额度线 " +
          WR_LICENSE.CONFIG.DAILY_FREE_LOOKUPS +
          " 次/天。";
    }
  });
}
