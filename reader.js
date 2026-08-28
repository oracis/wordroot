(function () {
  const container = document.getElementById("pdfContainer");
  const drop = document.getElementById("drop");
  const errBox = document.getElementById("err");
  const info = document.getElementById("info");
  const zoomLabel = document.getElementById("zoom");
  const fileInput = document.getElementById("file");
  const stage = document.getElementById("stage");

  function showErr(msg) {
    if (errBox) { errBox.style.display = "block"; errBox.textContent = msg; }
    console.error("[reader]", msg);
  }
  function clearErr() { if (errBox) { errBox.style.display = "none"; errBox.textContent = ""; } }

  // 判定运行环境：扩展页有 chrome.runtime；直接双击 file:// 打开则没有（仍尝试让 pdf 能渲染，只是不能划词）
  const isExt = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL);
  const base = isExt ? chrome.runtime.getURL("") : "";

  let pdfjsOk = !!window.pdfjsLib;
  if (!pdfjsOk) {
    showErr(
      "pdf.js 未加载（window.pdfjsLib 为空）。\n" +
      "常见原因：新增了 reader.html / pdfjs/ 文件后没有在扩展管理页点「刷新」。\n" +
      "请到 chrome://extensions 找到「词源划词 WordRoot」→ 点刷新图标，再重新打开本页。"
    );
  } else {
    try {
      // 优先用独立 worker；失败时 pdf.js 会自动退回主线程 fake worker，仍能打开
      pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdfjs/pdf.worker.min.js";
      console.log("[reader] pdf.js 版本:", pdfjsLib.version, "workerSrc:", pdfjsLib.GlobalWorkerOptions.workerSrc);
    } catch (e) {
      showErr("设置 pdf.js worker 失败：" + (e && e.message ? e.message : e));
    }
  }

  let pdfDoc = null;
  let pageNum = 1;
  let scale = 1.3;

  // 自动接管模式：URL 带 ?src= 或 #src=<PDF原始地址> 时，由扩展页（有 <all_urls> host 权限）fetch 后渲染
  function tryLoadFromSrc() {
    try {
      let src = null;
      const qs = new URLSearchParams(location.search);
      if (qs.get("src")) {
        src = qs.get("src");
      } else {
        // DNR 重定向用的是 #src=...（fragment 里可安全包含 ? / &）
        const m = location.hash.match(/^#src=(.*)$/);
        if (m) src = decodeURIComponent(m[1]);
      }
      if (src) {
        drop.style.display = "none";
        loadFromUrl(src);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function loadFromUrl(url) {
    clearErr();
    const isEpub = /\.epub(\?|#|$)/i.test(url || "");
    if (window.WR_LICENSE) WR_LICENSE.record(isEpub ? "epub" : "pdf");
    if (!isEpub && !pdfjsOk) {
      showErr("pdf.js 未加载，无法打开 PDF。请先在扩展管理页点「刷新」后重试。");
      return;
    }
    const info = document.getElementById("info");
    if (info) info.textContent = "加载中… " + url;
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " " + r.statusText);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        if (isEpub) {
          // 传 ArrayBuffer（Uint8Array 会让 epub.js 解析挂起）
          loadEpub(buf, url.split("/").pop());
          return null;
        }
        return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      })
      .then(function (pdf) {
        if (!pdf) return;
        pdfDoc = pdf;
        setToolbarMode("pdf");
        renderPage(1);
      })
      .catch(function (e) {
        showErr(
          "远程文件加载失败：" + (e && e.message ? e.message : e) +
          "\n可能原因：该地址需要登录/cookie，或扩展无访问权限。\n可改用本页「打开 PDF / EPUB」按钮选择本地文件。"
        );
      });
  }

  function updateInfo() {
    info.textContent = "第 " + pageNum + " / " + (pdfDoc ? pdfDoc.numPages : 0) + " 页";
    zoomLabel.textContent = Math.round(scale * 100) + "%";
  }

  function buildTextLayer(textContent, viewport, pageEl) {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    layer.style.width = viewport.width + "px";
    layer.style.height = viewport.height + "px";
    const items = textContent.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.str) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const angle = Math.atan2(tx[1], tx[0]);
      const span = document.createElement("span");
      span.style.left = tx[4] + "px";
      span.style.top = tx[5] - fontHeight + "px";
      span.style.fontSize = fontHeight + "px";
      span.style.fontFamily = it.font;
      span.style.transform = "rotate(" + angle + "rad)";
      span.textContent = it.str;
      layer.appendChild(span);
    }
    pageEl.appendChild(layer);
  }

  function renderPage(num) {
    if (!pdfDoc) return;
    pageNum = Math.min(Math.max(1, num), pdfDoc.numPages);
    updateInfo();
    container.innerHTML = "";
    pdfDoc.getPage(pageNum).then(function (page) {
      const viewport = page.getViewport({ scale: scale });
      const pageEl = document.createElement("div");
      pageEl.className = "page";
      pageEl.style.width = viewport.width + "px";
      pageEl.style.height = viewport.height + "px";
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      pageEl.appendChild(canvas);
      container.appendChild(pageEl);

      const ctx = canvas.getContext("2d");
      const task = page.render({ canvasContext: ctx, viewport: viewport });
      task.promise.then(function () {
        return page.getTextContent();
      }).then(function (tc) {
        buildTextLayer(tc, viewport, pageEl);
      }).catch(function (e) {
        console.error("[reader] render failed:", e);
      });
    }).catch(function (e) {
      showErr("渲染页面失败：" + (e && e.message ? e.message : e));
    });
  }

  function loadFile(file) {
    if (!file) return;
    clearErr();
    const isEpub = /\.epub$/i.test(file.name || "");
    if (window.WR_LICENSE) WR_LICENSE.record(isEpub ? "epub" : "pdf");
    drop.textContent = "解析中…";
    const reader = new FileReader();
    reader.onerror = function () { showErr("读取文件失败：" + (reader.error && reader.error.message ? reader.error.message : "未知")); drop.style.display = "block"; };
    reader.onload = function () {
      try {
        const data = new Uint8Array(reader.result);
        if (isEpub) {
          // 必须传 ArrayBuffer：epub.js 对 Uint8Array 解析会静默挂起
          loadEpub(reader.result, file.name);
        } else {
          if (!pdfjsOk) { showErr("pdf.js 未加载，无法打开 PDF。请先在扩展管理页点「刷新」后重试。"); return; }
          pdfjsLib.getDocument({ data: data }).promise.then(function (pdf) {
            pdfDoc = pdf;
            drop.style.display = "none";
            setToolbarMode("pdf");
            renderPage(1);
          }).catch(function (e) {
            drop.style.display = "block";
            drop.textContent = "把 PDF / EPUB 文件拖到这里，或点「打开 PDF / EPUB」";
            showErr("PDF 解析失败：" + (e && e.message ? e.message : e));
          });
        }
      } catch (e) {
        showErr("打开失败：" + (e && e.message ? e.message : e));
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ---- 工具栏/容器：PDF / EPUB 模式按钮互斥显示 + 各自绑定事件 ----
  function setToolbarMode(mode) {
    const pdfBtns = document.querySelectorAll(".pdfonly");
    const epubBtns = document.querySelectorAll(".epubonly");
    // 容器互斥显示
    document.getElementById("pdfContainer").style.display = mode === "pdf" ? "" : "none";
    document.getElementById("epubContainer").style.display = mode === "epub" ? "block" : "none";
    if (mode === "epub") {
      pdfBtns.forEach(function (el) { el.style.display = "none"; });
      epubBtns.forEach(function (el) { el.style.display = ""; });
    } else {
      epubBtns.forEach(function (el) { el.style.display = "none"; });
      pdfBtns.forEach(function (el) { el.style.display = ""; });
    }
  }

  // ---- EPUB（epub.js）----
  let epubBook = null;
  let epubRendition = null;
  let epubFontSize = 100;

  function loadEpub(u8, name) {
    if (typeof ePub === "undefined") { showErr("epub.js 未加载，无法打开 EPUB。请先在扩展管理页点「刷新」后重试。"); return; }
    try {
      if (epubBook) { try { epubRendition && epubRendition.destroy(); } catch (e) {} epubBook = null; }
      const epubEl = document.getElementById("epubContainer");
      // epub.js 需要容器有确定尺寸才渲染（display:none / 纯 CSS calc 会挂起）：先显示并给固定像素高度
      epubEl.style.display = "block";
      epubEl.style.height = Math.max(320, (window.innerHeight || 800) - 120) + "px";
      epubEl.style.overflow = "auto";
      // loading 占位：必须用 id，display() 完成后精确 remove（renderTo 是 append 不是 replace）
      epubEl.innerHTML = '<div id="wr-epub-loading" style="padding:40px;text-align:center;color:#9a8a72">加载 EPUB…</div>';
      setToolbarMode("epub"); // 立刻切换工具栏避免 PDF 按钮误导
      epubBook = ePub(u8);
      const rendition = epubBook.renderTo(epubEl, {
        width: "100%", height: "100%", spread: "none", flow: "scrolled-doc",
        allowScriptedContent: true // 关键：否则章节 iframe sandbox 禁脚本，注入的 content.js 无法执行
      });
      epubRendition = rendition;
      rendition.display().then(function () {
        // 移除 loading 占位（epub-container 已在 loading div 后面 append）
        const ld = epubEl.querySelector("#wr-epub-loading");
        if (ld) ld.remove();
        drop.style.display = "none";
        let title = "";
        try { title = (epubBook.package && epubBook.package.metadata && epubBook.package.metadata.title) || ""; } catch (e) {}
        document.getElementById("info").textContent = "EPUB：" + (title || name || "");
        document.getElementById("zoom").textContent = "";
      }).catch(function (e) {
        const ld = epubEl.querySelector("#wr-epub-loading");
        if (ld) ld.remove();
        drop.style.display = "block";
        drop.textContent = "把 PDF / EPUB 文件拖到这里，或点「打开 PDF / EPUB」";
        showErr("EPUB 解析失败：" + (e && e.message ? e.message : e));
      });
      // 每次章节渲染（iframe 重建）后注入 content.js 实现划词
      rendition.on("rendered", function (section, view) {
        injectContentScript(view && view.iframe);
      });
    } catch (e) {
      showErr("EPUB 打开失败：" + (e && e.message ? e.message : e));
    }
  }

  // EPUB 翻页 / 字号
  function epubPrev() { if (epubRendition && epubRendition.prev) epubRendition.prev(); }
  function epubNext() { if (epubRendition && epubRendition.next) epubRendition.next(); }
  function epubZoom(delta) {
    if (!epubRendition) return;
    epubFontSize = Math.max(60, Math.min(220, epubFontSize + delta));
    // scrolled-doc 模式下 themes.fontSize 对章节 iframe 几乎不生效；直接改所有章节 html 字号（必生效）
    document.querySelectorAll("#epubContainer iframe").forEach(function (f) {
      try { f.contentDocument.documentElement.style.fontSize = epubFontSize + "%"; } catch (e) {}
    });
    // themes 兜底（对 paginated 模式有效）
    try { if (epubRendition.themes && epubRendition.themes.fontSize) epubRendition.themes.fontSize(epubFontSize + "%"); } catch (e) {}
    const el = document.getElementById("epubZoom");
    if (el) el.textContent = epubFontSize + "%";
  }

  function injectContentScript(iframe) {
    if (!iframe) return;
    const tryInject = function () {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        // 1) 注入 content.css：EPUB iframe 内无扩展样式表，面板/划词样式裸着 → 与正文融在一起
        if (!doc.querySelector('link[data-wr-css]')) {
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = new URL('content.css', document.baseURI).href;
          link.setAttribute('data-wr-css', '1');
          (doc.head || doc.documentElement).appendChild(link);
        }
        // 2) 注入 content.js：attach mouseup + 创建面板（用上面注入的样式）
        if (!doc.querySelector('script[data-wr-injected]')) {
          const s = doc.createElement('script');
          s.dataset.wrInjected = '1';
          // 用绝对 URL：epub.js 会给 iframe 设 OEBPS base，相对路径会解析错位
          s.src = new URL('content.js', document.baseURI).href;
          (doc.body || doc.documentElement).appendChild(s);
          console.log('[reader] 已注入 content.js+css 到 EPUB 章节');
        }
      } catch (e) { console.error('[reader] 注入失败:', e); }
    };
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") { tryInject(); }
      else iframe.addEventListener("load", tryInject);
    } catch (e) { console.error("[reader] iframe 访问失败:", e); }
  }

  fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  });
  document.getElementById("prev").addEventListener("click", function () { renderPage(pageNum - 1); });
  document.getElementById("next").addEventListener("click", function () { renderPage(pageNum + 1); });
  document.getElementById("zoomIn").addEventListener("click", function () { scale = Math.min(3, scale + 0.1); if (pdfDoc) renderPage(pageNum); });
  document.getElementById("zoomOut").addEventListener("click", function () { scale = Math.max(0.5, scale - 0.1); if (pdfDoc) renderPage(pageNum); });
  // EPUB 翻页 / 字号
  document.getElementById("epubPrev").addEventListener("click", epubPrev);
  document.getElementById("epubNext").addEventListener("click", epubNext);
  document.getElementById("epubZoomIn").addEventListener("click", function () { epubZoom(+10); });
  document.getElementById("epubZoomOut").addEventListener("click", function () { epubZoom(-10); });

  // 拖放：阻止浏览器默认「在标签页打开 PDF」，改由本页解析
  ["dragover", "drop"].forEach(function (ev) {
    window.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    stage.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  stage.addEventListener("dragleave", function (e) { e.preventDefault(); drop.classList.remove("over"); });
  stage.addEventListener("drop", function (e) {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // 启动时若是自动接管模式（带 ?src=），直接加载
  tryLoadFromSrc();

  // EPUB 章节 iframe（about:srcdoc）内无 chrome.runtime：content.js 通过 postMessage 桥接到这里查词
  window.addEventListener("message", function (ev) {
    const d = ev.data || {};
    if (!d || d.type !== "wr-lookup-req") return;
    const reply = function (res) {
      try { ev.source.postMessage({ type: "wr-lookup-res", id: d.id, res: res }, "*"); } catch (e) {}
    };
    try {
      chrome.runtime.sendMessage({ type: "LOOKUP", word: d.word }, function (res) {
        if (chrome.runtime.lastError) { reply({ type: "error", msg: "扩展未响应" }); return; }
        reply(res);
      });
    } catch (e) {
      reply({ type: "error", msg: e && e.message ? e.message : String(e) });
    }
  });
})();
