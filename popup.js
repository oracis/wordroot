function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function render(out, word, res) {
  if (!res) { out.innerHTML = '<div class="need">扩展未响应</div>'; return; }
  if (res.type === "need_key") {
    out.innerHTML = '<div class="need">暂时查不到「' + escapeHtml(word) + '」（离线词库与有道在线都没有该词）。</div>';
    return;
  }
  if (res.type === "error") { out.innerHTML = '<div class="need">出错了：' + escapeHtml(res.msg) + "</div>"; return; }
  const d = res.data;
  let html = '<div class="word">' + escapeHtml(d.word || word) + "</div>";
  if (d.uk || d.us) html += '<div class="phon">英 ' + escapeHtml(d.uk || "-") + "　美 " + escapeHtml(d.us || "-") + "</div>";
  if (d.defs && d.defs.length && !d.breakdown) {
    // 简明释义（离线词库 / 有道兜底）
    html += '<div class="sec"><h4>释义</h4><ul>' + d.defs.map(function (x) {
      return "<li>" + (x.pos ? "<b>" + escapeHtml(x.pos) + "</b> " : "") + escapeHtml(x.tran) + "</li>";
    }).join("") + "</ul></div>";
  } else if (d.breakdown) {
    html += '<div class="sec"><h4>词根词缀拆解</h4>' + escapeHtml(d.breakdown) + "</div>";
  }
  if (d.etymology) html += '<div class="sec"><h4>词源故事</h4>' + escapeHtml(d.etymology) + "</div>";
  if (d.mnemonics && d.mnemonics.length)
    html += '<div class="sec"><h4>联想记忆</h4><ul>' + d.mnemonics.map(function (m) { return "<li>" + escapeHtml(m) + "</li>"; }).join("") + "</ul></div>";
  if (d.related && d.related.length)
    html += '<div class="sec"><h4>同根词</h4><ul>' + d.related.map(function (r) {
      return "<li><b>" + escapeHtml(r.word) + "</b>" + (r.pos ? " <i>(" + escapeHtml(r.pos) + ")</i>" : "") + (r.tran ? "：" + escapeHtml(r.tran) : "") + "</li>";
    }).join("") + "</ul></div>";
  if (d.usages && d.usages.length)
    html += '<div class="sec"><h4>常见用法</h4><ul>' + d.usages.map(function (u) { return "<li>" + escapeHtml(u) + "</li>"; }).join("") + "</ul></div>";
  if (d.examples && d.examples.length)
    html += '<div class="sec"><h4>例句</h4>' + d.examples.map(function (e) { return "<div><b>" + escapeHtml(e.en) + "</b><br>" + escapeHtml(e.zh) + "</div>"; }).join("") + "</div>";
  const srcMap = { offline: "离线词库", youdao: "有道词典", llm: "AI 词源" };
  if (d.source && srcMap[d.source]) html += '<div style="margin-top:6px;color:#aaa;font-size:11px;">来源：' + srcMap[d.source] + "</div>";
  if (res.cached) html += '<div style="margin-top:6px;color:#aaa;font-size:11px;">（本地缓存）</div>';
  out.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", function () {
  const q = document.getElementById("q");
  const out = document.getElementById("out");

  // 生词本入口
  chrome.storage.local.get("vocab", function (o) {
    const n = (o.vocab || []).length;
    document.getElementById("vocabCnt").textContent = n ? "(" + n + ")" : "";
  });
  document.getElementById("openVocab").addEventListener("click", function () {
    chrome.tabs.create({ url: chrome.runtime.getURL("vocab.html") });
  });
  document.getElementById("openReader").addEventListener("click", function () {
    chrome.tabs.create({ url: chrome.runtime.getURL("reader.html") });
  });

  q.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      const word = q.value.trim();
      if (!word) return;
      out.innerHTML = '<div class="need">查询中…</div>';
      chrome.runtime.sendMessage({ type: "LOOKUP", word: word }, function (res) {
        render(out, word, res);
      });
    }
  });
});
