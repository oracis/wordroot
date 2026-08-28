// 验证 EPUB/PDF 模式工具栏按钮互斥：EPUB 模式下 .pdfonly 隐藏、.epubonly 显示
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/DELL/WorkBuddy/2026-08-27-13-50-21/node_modules/playwright");
const ROOT = path.resolve(__dirname, "..");
const PORT = 18741;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".pdf": "application/pdf", ".epub": "application/epub+zip" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/sample.epub") p = path.join(__dirname, "sample.epub");
  else p = path.join(ROOT, p === "/" ? "reader.html" : p);
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(buf);
  });
});
server.listen(PORT, async () => {
  const browser = await chromium.launch({ channel: "chrome", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 150)));
  await page.addInitScript(() => {
    window.chrome = { runtime: { getURL: (u) => u, lastError: null, onMessage: { addListener() {} }, sendMessage: (m, cb) => cb && cb({ type: "ok", data: { word: m.word, defs: [{ pos: "n.", tran: "x" }] } }) }, storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
  });
  await page.goto("http://localhost:" + PORT + "/reader.html#src=http://localhost:" + PORT + "/sample.epub", { waitUntil: "load" });
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); if (!el) return null; const s = getComputedStyle(el).display; return { id, display: s, visible: s !== "none" }; };
    return {
      pdfPrev: vis("prev"), pdfNext: vis("next"), pdfZoomOut: vis("zoomOut"), pdfZoomIn: vis("zoomIn"),
      epubPrev: vis("epubPrev"), epubNext: vis("epubNext"), epubZoomOut: vis("epubZoomOut"), epubZoomIn: vis("epubZoomIn")
    };
  });
  console.log(JSON.stringify(r, null, 2));
  const ok = r.pdfPrev.visible === false && r.pdfNext.visible === false && r.pdfZoomOut.visible === false && r.pdfZoomIn.visible === false &&
              r.epubPrev.visible === true && r.epubNext.visible === true && r.epubZoomOut.visible === true && r.epubZoomIn.visible === true;
  console.log("=== 工具栏模式切换:", ok ? "PASS" : "FAIL", "===");
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
});