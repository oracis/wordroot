// 端到端验证：EPUB（epub.js）渲染 + 章节 iframe 内划词弹框
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/DELL/WorkBuddy/2026-08-27-13-50-21/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 18736;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".epub": "application/epub+zip" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/reader.html";
  if (p === "/sample.epub") p = path.join(__dirname, "sample.epub");
  else p = path.join(ROOT, p);
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, async () => {
  const browser = await chromium.launch({ channel: "chrome", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const logs = [];
  page.on("response", (r) => { if (r.status() >= 400) logs.push("[HTTP " + r.status() + "] " + r.url().slice(0, 120)); });
  page.on("console", (m) => { if (m.type() === "error") logs.push("[console.error] " + m.text()); });
  page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));

  await page.addInitScript(() => {
    // 只在顶层注入 chrome：EPUB 章节 iframe（about:srcdoc）不注入，让 content.js 走 postMessage 桥接路径
    if (window.top !== window.self) return;
    if (!window.chrome) window.chrome = {};
    window.chrome.runtime = {
      getURL: (u) => u, lastError: null,
      onMessage: { addListener: function () {} },
      sendMessage: function (msg, cb) {
        if (msg && msg.type === "LOOKUP") {
          cb({ type: "ok", cached: false, data: { word: msg.word, uk: "/x/", us: "/x/", defs: [{ pos: "n.", tran: "测试释义 " + msg.word }], source: "youdao" } });
        } else cb({});
      }
    };
    window.chrome.storage = { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } };
  });

  const epubUrl = "http://localhost:" + PORT + "/sample.epub";
  await page.goto("http://localhost:" + PORT + "/reader.html#src=" + epubUrl, { waitUntil: "load" });

  // 等待 EPUB iframe 渲染 + 文本出现
  let frame = null;
  try {
    await page.waitForFunction(() => {
      const els = document.querySelectorAll("#epubContainer iframe");
      for (const el of els) {
        try {
          const d = el.contentDocument;
          if (d && d.body && /trajectory/.test(d.body.innerText || "")) return true;
        } catch (e) {}
      }
      return false;
    }, { timeout: 15000 });
  } catch (e) { logs.push("[wait] EPUB 文本未出现: " + e.message); }

  // 找含文本的 frame
  for (const f of page.frames()) {
    try {
      const txt = await f.evaluate(() => document.body && document.body.innerText || "");
      if (/trajectory/.test(txt)) { frame = f; break; }
    } catch (e) {}
  }

  let result = { frameFound: !!frame };
  if (frame) {
    // 断言 loading 占位被清掉（#wr-epub-loading 不应存在）
    result.loadingCleared = await frame.evaluate(() => !document.getElementById("wr-epub-loading"));
    // 检查 content.js 是否已注入
    result.injected = await frame.evaluate(() => !!document.querySelector("script[data-wr-injected]"));
    // 在 frame 内选中 trajectory 并派发 mouseup
    result.selection = await frame.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const idx = n.textContent.indexOf("trajectory");
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(n, idx); range.setEnd(n, idx + 10);
          const sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(range);
          const r = range.getBoundingClientRect();
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.x + 2, clientY: r.y + 2 }));
          return { found: true };
        }
      }
      return { found: false };
    });
    await page.waitForTimeout(1500);
    result.panel = await frame.evaluate(() => {
      const el = document.getElementById("wordroot-panel");
      if (!el) return { exists: false };
      // 顺便断言面板有视觉边界 + 位置不超出视口右边界（避右滚动条遮）
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { exists: true, visible: el.style.display !== "none", text: (el.innerText || "").slice(0, 80),
               bg: cs.backgroundColor, borderRadius: cs.borderRadius,
               right: r.right, viewportW: window.innerWidth };
    });
  }

  const ok = result.frameFound && result.loadingCleared && result.injected && result.selection && result.selection.found &&
    result.panel && result.panel.exists && result.panel.visible && (result.panel.text || "").includes("测试释义") &&
    result.panel.bg && result.panel.bg !== "rgba(0, 0, 0, 0)" && result.panel.bg !== "transparent" &&
    result.panel.right + 30 < result.panel.viewportW; // 留 30px 给滚动条+阴影
  console.log("=== EPUB 渲染+划词 ===", ok ? "PASS" : "FAIL", "===");
  console.log(JSON.stringify(result, null, 2));
  console.log("logs:", logs.slice(0, 6).join(" | "));

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
});
