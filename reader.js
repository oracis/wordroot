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
    if (!pdfjsOk) {
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
        const data = new Uint8Array(buf);
        return pdfjsLib.getDocument({ data: data }).promise;
      })
      .then(function (pdf) {
        pdfDoc = pdf;
        renderPage(1);
      })
      .catch(function (e) {
        showErr(
          "远程 PDF 加载失败：" + (e && e.message ? e.message : e) +
          "\n可能原因：该地址需要登录/cookie，或扩展无访问权限。\n可改用本页「打开 PDF」按钮选择本地文件。"
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
    if (!pdfjsOk) {
      showErr("pdf.js 未加载，无法打开 PDF。请先在扩展管理页点「刷新」后重试。");
      return;
    }
    drop.textContent = "解析中…";
    const reader = new FileReader();
    reader.onerror = function () { showErr("读取文件失败：" + (reader.error && reader.error.message ? reader.error.message : "未知")); drop.style.display = "block"; };
    reader.onload = function () {
      try {
        const data = new Uint8Array(reader.result);
        pdfjsLib.getDocument({ data: data }).promise.then(function (pdf) {
          pdfDoc = pdf;
          drop.style.display = "none";
          renderPage(1);
        }).catch(function (e) {
          drop.style.display = "block";
          drop.textContent = "把 PDF 文件拖到这里，或点「打开 PDF」";
          showErr("PDF 解析失败：" + (e && e.message ? e.message : e));
        });
      } catch (e) {
        showErr("打开失败：" + (e && e.message ? e.message : e));
      }
    };
    reader.readAsArrayBuffer(file);
  }

  fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  });
  document.getElementById("prev").addEventListener("click", function () { renderPage(pageNum - 1); });
  document.getElementById("next").addEventListener("click", function () { renderPage(pageNum + 1); });
  document.getElementById("zoomIn").addEventListener("click", function () { scale = Math.min(3, scale + 0.1); if (pdfDoc) renderPage(pageNum); });
  document.getElementById("zoomOut").addEventListener("click", function () { scale = Math.max(0.5, scale - 0.1); if (pdfDoc) renderPage(pageNum); });

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
})();
