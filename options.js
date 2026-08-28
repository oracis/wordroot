document.addEventListener("DOMContentLoaded", function () {
  const apiKey = document.getElementById("apiKey");
  const baseURL = document.getElementById("baseURL");
  const model = document.getElementById("model");
  const ttsMode = document.getElementById("ttsMode");
  const ttsRelay = document.getElementById("ttsRelay");
  const autoPdf = document.getElementById("autoPdf");
  const optReport = document.getElementById("optReport");
  const msg = document.getElementById("msg");

  chrome.storage.local.get(["apiKey", "baseURL", "model", "ttsMode", "ttsRelay", "autoPdf", "wr_report"], function (o) {
    apiKey.value = o.apiKey || "";
    baseURL.value = o.baseURL || "";
    model.value = o.model || "";
    ttsMode.value = o.ttsMode || "youdao";
    ttsRelay.value = o.ttsRelay || "http://localhost:8787";
    autoPdf.checked = o.autoPdf === undefined ? true : !!o.autoPdf;
    if (optReport) optReport.checked = !!o.wr_report;
  });

  const openVocab = document.getElementById("openVocab");
  if (openVocab) openVocab.addEventListener("click", function () {
    chrome.tabs.create({ url: chrome.runtime.getURL("vocab.html") });
  });

  // 匿名改进计划开关：勾选即生效，不依赖「保存」按钮
  if (optReport) optReport.addEventListener("change", function () {
    chrome.storage.local.set({ wr_report: optReport.checked });
  });

  // ---- 使用统计（埋点数据，用于定价决策）----
  renderStats();

  document.getElementById("save").addEventListener("click", function () {
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
    const rows = [
      ["今日查词", s.today.lookups + " 次"],
      ["今日 AI 词源", s.today.llm + " 次"],
      ["今日 PDF / EPUB 打开", s.today.pdf + " / " + s.today.epub + " 次"],
      ["今日导出 / 收藏", s.today.exports + " / " + s.today.vocabAdds + " 次"],
      ["—", "—"],
      ["累计查词", s.totals.lookups + " 次"],
      ["累计 AI 词源", s.totals.llm + " 次"],
      ["有使用记录的活跃天数", s.activeDays + " / " + s.trackedDays + " 天"],
      ["活跃日人均查词", s.avgLookupsPerActiveDay + " 次/天"],
      ["峰值单日", s.peakDay ? (s.peakDay.date + "：" + s.peakDay.lookups + " 次") : "—"]
    ];
    table.innerHTML = rows
      .map(function (r) {
        if (r[0] === "—") return '<tr><td colspan="2" style="border-top:1px solid #eee;padding:2px 0"></td></tr>';
        return (
          '<tr><td style="padding:4px 0;color:#666">' +
          r[0] +
          '</td><td style="padding:4px 0;text-align:right;font-weight:600">' +
          r[1] +
          "</td></tr>"
        );
      })
      .join("");

    const foot = document.getElementById("statsFoot");
    if (foot) {
      foot.textContent = s.enabled
        ? "付费闸门：已开启"
        : "付费闸门：关闭中（当前全部免费，仅统计不拦截）。额度线 " +
          WR_LICENSE.CONFIG.DAILY_FREE_LOOKUPS +
          " 次/天，达到后才会影响用户。";
    }
  });
}
