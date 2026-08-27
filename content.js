(function () {
  console.log("[wordroot] content script build 2026-08-27e loaded");
  console.log("[wordroot] AudioContext available:", !!(window.AudioContext || window.webkitAudioContext));
  let panel = null;
  let pinned = false;
  let toastTimer = null;
  let lastLookup = null; // 最近一次 LOOKUP 结果，存生词时一并写入完整词条

  // ---- SpeechSynthesis 预热：中文 Windows 默认只有「中文在线语音」，离线静默失败 ----
  let cachedEnVoice = null;
  let currentU = null;
  (function warmVoices() {
    try {
      if (!("speechSynthesis" in window)) return;
      const pick = function () {
        const vs = speechSynthesis.getVoices() || [];
        cachedEnVoice =
          vs.find(function (v) { return /^en[-_]US/i.test(v.lang) && v.localService; }) ||
          vs.find(function (v) { return /^en[-_]GB/i.test(v.lang) && v.localService; }) ||
          vs.find(function (v) { return /^en/i.test(v.lang) && v.localService; }) ||
          vs.find(function (v) { return /^en[-_]US/i.test(v.lang); }) ||
          vs.find(function (v) { return /^en[-_]GB/i.test(v.lang); }) ||
          vs.find(function (v) { return /^en/i.test(v.lang); }) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick; // 异步加载完成后重新挑选
    } catch (e) {}
  })();

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "wordroot-panel";
    panel.style.display = "none";
    panel.innerHTML =
      '<span class="wr-close">×</span>' +
      '<div id="wordroot-body"></div>' +
      '<div class="wr-actions">' +
      '<button data-act="speak">朗读发音</button>' +
      '<button data-act="save">加入生词本</button>' +
      '<button data-act="pin">钉住</button>' +
      "</div>" +
      '<div class="wr-toast"></div>';
    document.body.appendChild(panel);
    panel.querySelector(".wr-close").addEventListener("click", hide);
    panel.querySelector('[data-act="speak"]').addEventListener("click", function (e) { e.stopPropagation(); speakWord(); });
    panel.querySelector('[data-act="save"]').addEventListener("click", function (e) { e.stopPropagation(); saveWord(); });
    panel.querySelector('[data-act="pin"]').addEventListener("click", function (e) { e.stopPropagation(); pinToggle(this); });
    return panel;
  }

  function hide() {
    if (!panel) return;
    panel.style.display = "none";
    panel.classList.remove("open");
    pinned = false;
  }

  function show(word, rect) {
    const p = ensurePanel();
    p.dataset.word = word;
    p.style.display = "block";
    const body = p.querySelector("#wordroot-body");
    body.innerHTML = '<div class="wr-loading">查询中…</div>';
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    if (mobile) {
      p.style.top = "";
      p.style.left = "";
      requestAnimationFrame(function () { p.classList.add("open"); });
    } else {
      p.classList.remove("open");
      let top = rect.top - p.offsetHeight - 8;
      if (top < 8) top = rect.bottom + 8;
      let left = rect.left;
      if (left + 340 > window.innerWidth - 8) left = window.innerWidth - 348;
      if (left < 8) left = 8;
      p.style.top = top + "px";
      p.style.left = left + "px";
    }
    // 10 秒超时兜底：避免 background 异常 / SW 未唤醒导致 panel 永远停在查询中
    let done = false;
    const fallback = setTimeout(function () {
      if (done) return;
      done = true;
      body.innerHTML = '<div class="wr-needkey">查询超时：扩展 Service Worker 未运行。请到 chrome://extensions 点「刷新」加载词源划词。</div>';
    }, 10000);
    // 防御：SW 未运行 / chrome.runtime 不可用时直接走降级，不再 stuck
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      clearTimeout(fallback);
      body.innerHTML = '<div class="wr-needkey">扩展未运行，请到 chrome://extensions 点「刷新」加载词源划词。</div>';
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "LOOKUP", word: word }, function (res) {
        if (done) return;
        done = true;
        clearTimeout(fallback);
        if (chrome.runtime.lastError) {
          body.innerHTML = '<div class="wr-loading">扩展未响应</div>';
          return;
        }
        lastLookup = res; // 缓存，供「加入生词本」写入完整词条
        render(body, word, res);
      });
    } catch (e) {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      body.innerHTML = '<div class="wr-needkey">扩展调用失败：' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    }
  }

  function render(body, word, res) {
    if (!res) {
      body.innerHTML = '<div class="wr-loading">扩展未响应</div>';
      return;
    }
    if (res.type === "need_key") {
      body.innerHTML =
        '<div class="wr-needkey">暂时查不到「' +
        escapeHtml(word) +
        '」（离线词库与有道在线都没有该词，可能拼写有误或网络不通）。</div>';
      return;
    }
    if (res.type === "error") {
      body.innerHTML = '<div class="wr-needkey">出错了：' + escapeHtml(res.msg || "") + "</div>";
      return;
    }
    const d = res.data;
    let html = '<div class="wr-word">' + escapeHtml(d.word || word) + "</div>";
    if (d.uk || d.us) {
      html += '<div class="wr-phon">英 ' + escapeHtml(d.uk || "-") + "　美 " + escapeHtml(d.us || "-") + "</div>";
    }
    if (d.defs && d.defs.length && !d.breakdown) {
      // 简明释义（离线词库 / 有道兜底）
      html += '<div class="wr-sec"><h4>释义</h4><ul>' + d.defs.map(function (x) {
        return "<li>" + (x.pos ? "<b>" + escapeHtml(x.pos) + "</b> " : "") + escapeHtml(x.tran) + "</li>";
      }).join("") + "</ul></div>";
    } else if (d.breakdown) {
      html += '<div class="wr-sec"><h4>词根词缀拆解</h4><div class="wr-breakdown">' + escapeHtml(d.breakdown) + "</div></div>";
    }
    if (d.etymology) {
      html += '<div class="wr-sec"><h4>词源故事</h4><div>' + escapeHtml(d.etymology) + "</div></div>";
    }
    if (d.mnemonics && d.mnemonics.length) {
      html += '<div class="wr-sec"><h4>联想记忆</h4><ul>' + d.mnemonics.map(function (m) { return "<li>" + escapeHtml(m) + "</li>"; }).join("") + "</ul></div>";
    }
    if (d.related && d.related.length) {
      html += '<div class="wr-sec"><h4>同根词</h4><ul>' + d.related.map(function (r) {
        return "<li><b>" + escapeHtml(r.word) + "</b>" + (r.pos ? " <i>(" + escapeHtml(r.pos) + ")</i>" : "") + (r.tran ? "：" + escapeHtml(r.tran) : "") + "</li>";
      }).join("") + "</ul></div>";
    }
    if (d.usages && d.usages.length) {
      html += '<div class="wr-sec"><h4>常见用法</h4><ul>' + d.usages.map(function (u) { return "<li>" + escapeHtml(u) + "</li>"; }).join("") + "</ul></div>";
    }
    if (d.examples && d.examples.length) {
      html += '<div class="wr-sec"><h4>例句</h4>' + d.examples.map(function (e) {
        return '<div class="wr-ex"><b>' + escapeHtml(e.en) + "</b><br>" + escapeHtml(e.zh) + "</div>";
      }).join("") + "</div>";
    }
    const srcMap = { offline: "离线词库", youdao: "有道词典", llm: "AI 词源" };
    if (d.source && srcMap[d.source]) {
      html += '<div style="margin-top:8px;color:#aaa;font-size:11px;">来源：' + srcMap[d.source] + "</div>";
    }
    if (res.cached) html += '<div style="margin-top:8px;color:#aaa;font-size:11px;">（本地缓存）</div>';
    body.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg) {
    const t = panel.querySelector(".wr-toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }

  // 必须在「点击手势的同步帧内」创建并 resume AudioContext，否则后续异步拿到 mp3 播放会被自动播放策略拦截
  function unlockAudio() {
    try {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === "suspended") ctx.resume();
    } catch (e) {}
  }

  function speakWord() {
    const w = panel.dataset.word;
    if (!w) return;
    unlockAudio(); // 先解锁，这一行必须跑在用户手势的同步调用里
    // 在线发音（有道/自建中转）优先（绕开 Chromium 本机 TTS 无声 bug）；其次 chrome.tts；最后 speechSynthesis 兜底
    chrome.storage.local.get(["ttsMode"], function (o) {
      const mode = o.ttsMode || "youdao";
      if (mode === "youdao" || mode === "online") { speakViaOnline(w); return; }
      if (chrome && chrome.tts && chrome.tts.speak) { speakViaChromeTts(w); return; }
      speakViaSpeechSynthesis(w); // 非扩展环境兜底
    });
  }

  // Web Audio 上下文（在用户手势内 resume 解锁播放，绕过 HTMLMediaElement 自动播放限制）
  let _audioCtx = null;
  function getAudioCtx() {
    if (_audioCtx) return _audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn("[wordroot] 无 AudioContext 构造器"); return null; }
    try {
      _audioCtx = new AC();
      console.log("[wordroot] AudioContext 创建成功 state=", _audioCtx.state);
    } catch (e) {
      console.error("[wordroot] AudioContext 构造失败:", e && e.message, e);
      _audioCtx = null;
    }
    return _audioCtx;
  }

  function speakViaOnline(w) {
    // 关键：在点击手势的同步调用里 resume AudioContext，解锁后续播放
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    chrome.storage.local.get(["ttsRelay"], function (o) {
      const relay = (o.ttsRelay || "http://localhost:8787").replace(/\/+$/, "");
      toast("🔊 在线朗读中…");
      chrome.runtime.sendMessage({ type: "TTS_ONLINE", text: w, relay: relay }, function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          const err = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "未知错误";
          toast("在线朗读失败：" + err);
          return;
        }
        // 中转返回的是普通数组，重建为真正的 ArrayBuffer 再交给 Web Audio
        if (!res.audio || !res.audio.length) {
          toast("⚠️ 未收到音频数据 (bytes=" + (res.bytes || 0) + ", type=" + (res.type || "?") + ")");
          return;
        }
        const ab = new Uint8Array(res.audio).buffer;
        playMp3(ab, ctx);
      });
    });
  }

  // 用 Web Audio 播放 mp3 字节（不受自动播放策略限制）；ctx 缺失时在播放前自救创建
  function playMp3(arrayBuffer, ctx) {
    console.log("[wordroot] playMp3: bytes=", arrayBuffer && arrayBuffer.byteLength, "ctx=", !!ctx, "audioType=", arrayBuffer && arrayBuffer.constructor && arrayBuffer.constructor.name);
    if (!arrayBuffer || !arrayBuffer.byteLength) { toast("未收到音频数据"); return; }
    // 兜底自救：ctx 为空或缺 decodeAudioData 时，现场再拿一次
    if (!ctx || !ctx.decodeAudioData) {
      try { ctx = getAudioCtx(); } catch (e) { console.error("[wordroot] getAudioCtx 自救失败", e); }
    }
    if (ctx && ctx.decodeAudioData) {
      try {
        toast("🔊 Web Audio 播放中…");
        if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
        const buf = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer;
        ctx.decodeAudioData(buf).then(function (decoded) {
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          src.start(0);
          console.log("[wordroot] Web Audio start 已调用");
        }).catch(function (e) {
          console.error("[wordroot] decodeAudioData 失败:", e);
          toast("音频解码失败：" + (e && e.message || e));
          showInlinePlay(arrayBuffer); // 解码失败也退回内联按钮
        });
        return;
      } catch (e) {
        console.error("[wordroot] Web Audio 同步异常:", e);
        toast("Web Audio 异常：" + (e && e.message || e));
      }
    } else {
      console.warn("[wordroot] Web Audio 不可用：ctx=", ctx ? "无decodeAudioData" : "null");
      toast("⚠️ Web Audio 不可用，改用内联播放");
    }
    // 终极兜底：内联「点此播放」按钮（点击本身是新用户手势，<audio>.play() 必被放行）
    showInlinePlay(arrayBuffer);
  }

  // 终极兜底：在浮层内放一个真实的 <audio> + 「点此播放」按钮；按钮点击即用户手势，必不被自动播放策略拦截
  function showInlinePlay(arrayBuffer) {
    try {
      const url = URL.createObjectURL(new Blob([arrayBuffer], { type: "audio/mpeg" }));
      const wrap = document.createElement("div");
      wrap.className = "wr-playback";
      wrap.innerHTML = '<span>🔇 浏览器拦截了自动播放</span><button type="button" class="wr-playbtn">▶ 点此播放</button>';
      const btn = wrap.querySelector(".wr-playbtn");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const a = new Audio(url);
        a.play().then(function () { console.log("[wordroot] 内联播放开始"); }).catch(function (err) { toast("仍无法播放：" + (err && err.message || err)); });
      });
      const body = panel && panel.querySelector(".wr-body");
      if (body) {
        const old = body.querySelector(".wr-playback");
        if (old) old.remove();
        body.appendChild(wrap);
      }
    } catch (e) {
      toast("音频播放失败：" + (e && e.message || e));
    }
  }

  let ttsEventBound = false;
  function ensureTtsEvents() {
    if (ttsEventBound) return;
    try {
      chrome.tts.onEvent.addListener(function (ev) {
        if (!ev) return;
        if (ev.type === "error") toast("朗读失败：" + (ev.errorMessage || "未知"));
      });
      ttsEventBound = true;
    } catch (e) {}
  }

  function speakViaChromeTts(w) {
    ensureTtsEvents();
    try {
      chrome.tts.getVoices(function (vs) {
        console.log("[wordroot] chrome.tts 可用语音:", (vs || []).map(function (v) { return v.voiceName + " (" + v.lang + (v.remote ? "/远程" : "/本地") + ")"; }));
        const en = (vs || []).filter(function (v) { return /^en/i.test(v.lang); });
        const v = en.find(function (x) { return !x.remote; }) || en[0] || null;
        const opts = { lang: "en-US", rate: 0.95, pitch: 1.0, volume: 1.0 };
        if (v && v.voiceName) opts.voiceName = v.voiceName;
        chrome.tts.stop();
        chrome.tts.speak(w, opts, function () {
          if (chrome.runtime.lastError) {
            toast("朗读失败：" + chrome.runtime.lastError.message);
          } else {
            toast("🔊 用 " + (v && v.voiceName ? v.voiceName : "系统语音") + " 朗读");
          }
        });
      });
    } catch (e) {
      speakViaSpeechSynthesis(w); // 极端情况下 chrome.tts 不可用，退回 Web API
    }
  }

  function speakViaSpeechSynthesis(w) {
    if (!("speechSynthesis" in window)) { toast("当前浏览器不支持朗读"); return; }
    const vsAll = speechSynthesis.getVoices() || [];
    console.log("[wordroot] 系统语音:", vsAll.map(function (v) { return v.name + " (" + v.lang + (v.localService ? "/本地" : "/在线") + ")"; }));
    if (!cachedEnVoice) {
      cachedEnVoice =
        vsAll.find(function (v) { return /^en[-_]US/i.test(v.lang) && v.localService; }) ||
        vsAll.find(function (v) { return /^en[-_]GB/i.test(v.lang) && v.localService; }) ||
        vsAll.find(function (v) { return /^en/i.test(v.lang) && v.localService; }) ||
        vsAll.find(function (v) { return /^en[-_]US/i.test(v.lang); }) ||
        vsAll.find(function (v) { return /^en[-_]GB/i.test(v.lang); }) ||
        vsAll.find(function (v) { return /^en/i.test(v.lang); }) || null;
    }
    if (!cachedEnVoice) {
      toast("系统未安装英文语音：Windows 设置 → 时间和语言 → 语音 → 添加 Microsoft Mark / David / Zira（美式英语）");
      return;
    }
    let attempts = 0;
    const fire = function () {
      if (currentU) { try { currentU.onerror = null; } catch (e) {} } // 清掉旧朗读的报错，避免残留误报
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(w);
      u.lang = "en-US";
      u.rate = 0.95;
      u.pitch = 1;
      u.voice = cachedEnVoice;
      let started = false;
      u.onstart = function () { started = true; toast("🔊 用 " + cachedEnVoice.name + " 朗读"); };
      u.onerror = function (ev) {
        const err = ev && ev.error;
        if (err === "interrupted") {
          // Chrome/Windows 首次 speak 偶发“假失败”：没真正开始就被 interrupted，重试一次
          if (!started && attempts < 2) { attempts++; setTimeout(fire, 150); }
          return; // 被新词打断属正常，不提示
        }
        if (err === "not-allowed") toast("朗读被浏览器阻止，请允许页面播放声音");
        else toast("朗读失败：" + (err || "未知错误"));
      };
      currentU = u;
      if (speechSynthesis.paused) { try { speechSynthesis.resume(); } catch (e) {} }
      speechSynthesis.speak(u);
    };
    fire();
  }

  function saveWord() {
    const w = panel.dataset.word;
    if (!w) return;
    const res = lastLookup;
    const d = res && res.data ? res.data : null;
    // 完整词条：有查询结果就存释义，否则只存单词（生词本页仍可点开重新查）
    const entry = {
      word: (d && d.word) || w,
      uk: d ? d.uk || "" : "",
      us: d ? d.us || "" : "",
      breakdown: d ? d.breakdown || "" : "",
      etymology: d ? d.etymology || "" : "",
      mnemonics: d ? d.mnemonics || [] : [],
      usages: d ? d.usages || [] : [],
      examples: d ? d.examples || [] : [],
      addedAt: Date.now()
    };
    chrome.storage.local.get("vocab", function (o) {
      const list = o.vocab || [];
      const exists = list.some(function (it) {
        return (typeof it === "string" ? it : it.word) === entry.word;
      });
      if (exists) { toast("已在生词本"); return; }
      list.push(entry);
      chrome.storage.local.set({ vocab: list }, function () { toast("已加入生词本 ✓"); });
    });
  }

  function pinToggle(btn) {
    pinned = !pinned;
    btn.classList.toggle("active", pinned);
    toast(pinned ? "已钉住（点击外部不关闭）" : "已取消钉住");
  }

  function isWord(s) {
    return /^[A-Za-z][A-Za-z'’-]{0,39}$/.test(s);
  }

  document.addEventListener("mouseup", function () {
    setTimeout(function () {
      const sel = window.getSelection();
      if (!sel) return;
      const text = sel.toString().trim();
      if (!text || !isWord(text)) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      show(text, rect);
    }, 10);
  });

  document.addEventListener("mousedown", function (e) {
    unlockAudio(); // 任意点击都先解锁 AudioContext，确保后续异步拿到 mp3 播放不被自动播放策略拦截
    if (panel && panel.style.display === "block" && !panel.contains(e.target)) {
      if (!pinned) hide();
    }
  });
})();
