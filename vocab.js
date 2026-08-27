function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function norm(it) {
  if (typeof it === "string") {
    return { word: it, uk: "", us: "", breakdown: "", etymology: "", mnemonics: [], usages: [], examples: [], addedAt: 0 };
  }
  return {
    word: it.word || "",
    uk: it.uk || "",
    us: it.us || "",
    breakdown: it.breakdown || "",
    etymology: it.etymology || "",
    mnemonics: it.mnemonics || [],
    usages: it.usages || [],
    examples: it.examples || [],
    addedAt: it.addedAt || 0
  };
}

let ALL = [];

function load() {
  chrome.storage.local.get("vocab", function (o) {
    ALL = (o.vocab || []).map(norm);
    ALL.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    render();
  });
}

function render() {
  const kw = (document.getElementById("filter").value || "").trim().toLowerCase();
  const list = document.getElementById("list");
  const items = ALL.filter(function (e) {
    if (!kw) return true;
    const hay = [e.word, e.breakdown, e.etymology, (e.mnemonics || []).join(" "), (e.usages || []).join(" "), (e.examples || []).map(function (x) { return x.en + " " + x.zh; }).join(" "), (e.defs || []).map(function (x) { return (x.pos || "") + " " + x.tran; }).join(" ")]
      .join(" ").toLowerCase();
    return hay.indexOf(kw) >= 0;
  });
  document.getElementById("cnt").textContent = "共 " + ALL.length + " 个（显示 " + items.length + "）";
  if (!items.length) {
    list.innerHTML = '<div class="empty">还没有生词。去网页上划词，点「加入生词本」即可。<br>或到选项页配置 LLM Key 后，在弹窗里查词保存。</div>';
    return;
  }
  list.innerHTML = items.map(cardHtml).join("");
  list.querySelectorAll("[data-speak]").forEach(function (b) {
    b.addEventListener("click", function () { speak(b.getAttribute("data-speak")); });
  });
  list.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", function () {
      const w = b.getAttribute("data-del");
      ALL = ALL.filter(function (e) { return e.word !== w; });
      chrome.storage.local.set({ vocab: ALL }, render);
    });
  });
}

function cardHtml(e) {
  let h = '<div class="card"><div class="hd">';
  h += '<span class="w">' + escapeHtml(e.word) + "</span>";
  if (e.uk || e.us) h += '<span class="ph">英 ' + escapeHtml(e.uk || "-") + "　美 " + escapeHtml(e.us || "-") + "</span>";
  h += '<span class="date">' + (e.addedAt ? new Date(e.addedAt).toLocaleDateString() : "") + "</span>";
  h += '<span class="acts"><button data-speak="' + escapeHtml(e.word) + '">🔊</button><button data-del="' + escapeHtml(e.word) + '">删除</button></span>';
  h += "</div>";
  if (e.defs && e.defs.length && !e.breakdown) {
    // 简明释义（离线词库/有道保存的快照）
    h += '<div class="sec"><h4>释义</h4><ul>' + e.defs.map(function (x) {
      return "<li>" + (x.pos ? "<b>" + escapeHtml(x.pos) + "</b> " : "") + escapeHtml(x.tran) + "</li>";
    }).join("") + "</ul></div>";
  } else if (e.breakdown) {
    h += '<div class="sec"><h4>词根词缀拆解</h4>' + escapeHtml(e.breakdown) + "</div>";
  }
  if (e.etymology) h += '<div class="sec"><h4>词源故事</h4>' + escapeHtml(e.etymology) + "</div>";
  if (e.mnemonics && e.mnemonics.length) h += '<div class="sec"><h4>联想记忆</h4><ul>' + e.mnemonics.map(function (m) { return "<li>" + escapeHtml(m) + "</li>"; }).join("") + "</ul></div>";
  if (e.related && e.related.length) h += '<div class="sec"><h4>同根词</h4><ul>' + e.related.map(function (r) {
    return "<li><b>" + escapeHtml(r.word) + "</b>" + (r.pos ? " <i>(" + escapeHtml(r.pos) + ")</i>" : "") + (r.tran ? "：" + escapeHtml(r.tran) : "") + "</li>";
  }).join("") + "</ul></div>";
  if (e.usages && e.usages.length) h += '<div class="sec"><h4>常见用法</h4><ul>' + e.usages.map(function (u) { return "<li>" + escapeHtml(u) + "</li>"; }).join("") + "</ul></div>";
  if (e.examples && e.examples.length) h += '<div class="sec"><h4>例句</h4>' + e.examples.map(function (x) { return '<div class="ex"><b>' + escapeHtml(x.en) + "</b>　" + escapeHtml(x.zh) + "</div>"; }).join("") + "</div>";
  h += "</div>";
  return h;
}

// ---- 朗读（与 content.js 同逻辑：在线中转优先，否则 chrome.tts）----
let _audioCtx = null;
function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { _audioCtx = new AC(); } catch (e) { return null; }
  return _audioCtx;
}
function playMp3(ab) {
  const ctx = getAudioCtx();
  if (ctx && ctx.decodeAudioData) {
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    ctx.decodeAudioData(ab instanceof ArrayBuffer ? ab : ab.buffer).then(function (dec) {
      const s = ctx.createBufferSource(); s.buffer = dec; s.connect(ctx.destination); s.start(0);
    }).catch(function () { fallbackPlay(ab); });
  } else { fallbackPlay(ab); }
}
function fallbackPlay(ab) {
  const url = URL.createObjectURL(new Blob([ab], { type: "audio/mpeg" }));
  const a = new Audio(url); a.play().catch(function () {});
}
function speak(w) {
  chrome.storage.local.get(["ttsMode", "ttsRelay"], function (o) {
    const mode = o.ttsMode || "youdao";
    if (mode === "youdao" || mode === "online") {
      const relay = (o.ttsRelay || "http://localhost:8787").replace(/\/+$/, "");
      chrome.runtime.sendMessage({ type: "TTS_ONLINE", text: w, relay: relay }, function (res) {
        if (chrome.runtime.lastError || !res || !res.ok || !res.audio || !res.audio.length) return;
        playMp3(new Uint8Array(res.audio).buffer);
      });
    } else if (chrome.tts && chrome.tts.speak) {
      chrome.tts.getVoices(function (vs) {
        const en = (vs || []).filter(function (v) { return /^en/i.test(v.lang); });
        const v = en.find(function (x) { return !x.remote; }) || en[0] || null;
        const opts = { lang: "en-US", rate: 0.95 };
        if (v && v.voiceName) opts.voiceName = v.voiceName;
        chrome.tts.speak(w, opts);
      });
    } else if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(w); u.lang = "en-US"; speechSynthesis.speak(u);
    }
  });
}

// ---- 导出 ----
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function definitionText(e) {
  if (e.defs && e.defs.length) {
    // 简明释义（离线词库/有道）
    let s = e.defs.map(function (x) { return (x.pos ? x.pos + " " : "") + x.tran; }).join("；");
    if (e.related && e.related.length) s += "　同根词：" + e.related.map(function (r) { return r.word; }).join("、");
    if (e.examples && e.examples.length) s += "　例：" + e.examples.map(function (x) { return x.en + "（" + x.zh + "）"; }).join("；");
    return s;
  }
  const parts = [];
  if (e.breakdown) parts.push("【词根】" + e.breakdown);
  if (e.etymology) parts.push("【词源】" + e.etymology);
  if (e.mnemonics && e.mnemonics.length) parts.push("【联想】" + e.mnemonics.join("；"));
  if (e.usages && e.usages.length) parts.push("【用法】" + e.usages.join("；"));
  if (e.examples && e.examples.length) parts.push("【例句】" + e.examples.map(function (x) { return x.en + "（" + x.zh + "）"; }).join("；"));
  return parts.join("\n");
}
document.getElementById("exportTxt").addEventListener("click", function () {
  download("wordroot-vocab.txt", ALL.map(function (e) { return e.word; }).join("\n") + "\n");
});
document.getElementById("exportAnki").addEventListener("click", function () {
  // 制表符分隔两列：单词 \t 释义（Anki 导入选「字段分隔符=Tab」）
  const lines = ALL.map(function (e) {
    return e.word + "\t" + definitionText(e).replace(/\t/g, " ").replace(/\n/g, " / ");
  });
  download("wordroot-vocab-anki.txt", lines.join("\n") + "\n");
});
document.getElementById("clear").addEventListener("click", function () {
  if (!ALL.length) return;
  if (!confirm("确定清空全部 " + ALL.length + " 个生词？此操作不可撤销。")) return;
  ALL = [];
  chrome.storage.local.set({ vocab: [] }, render);
});
document.getElementById("filter").addEventListener("input", render);

load();
