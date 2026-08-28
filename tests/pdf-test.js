// 真实浏览器验证：用系统 Chrome 加载 reader.html?src=本地PDF，确认能渲染 + 文本层可划词弹框
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/DELL/WorkBuddy/2026-08-27-13-50-21/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 18731;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".pdf": "application/pdf", ".json": "application/json" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/reader.html";
  let file;
  if (p === "/sample.pdf") {
    file = path.join(__dirname, "sample.pdf"); // 测试样本在本目录
  } else {
    file = path.join(ROOT, p);
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, async () => {
  const logs = [];
  const browser = await chromium.launch({
    channel: "chrome",
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--allow-file-access-from-files"]
  });
  const page = await browser.newPage();
  page.on("console", (m) => logs.push("[console." + m.type() + "] " + m.text()));
  page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));

  // 在非扩展环境给 content.js 一个 chrome 桩，验证划词弹框 UI 是否能出来
  await page.addInitScript(() => {
    if (!window.chrome) window.chrome = {};
    window.chrome.runtime = {
      getURL: (u) => u,
      lastError: null,
      onMessage: { addListener: function () {} },
      sendMessage: function (msg, cb) {
        if (msg && msg.type === "LOOKUP") {
          cb({ type: "ok", cached: false, data: { word: msg.word, uk: "/ə/", us: "/ə/", breakdown: "ject(扔)+ory", etymology: "测试词源", mnemonics: ["x"], usages: ["y"], examples: [{ en: "a", zh: "b" }] } });
        } else cb({});
      }
    };
    window.chrome.storage = { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } };
  });

  const src = "http://localhost:" + PORT + "/sample.pdf";
  // DNR 重定向实际使用 #src= 形式（fragment 传递原始 URL），这里按该形式验证
  await page.goto("http://localhost:" + PORT + "/reader.html#src=" + src, { waitUntil: "load" });

  // 等待 canvas 与文本层
  try {
    await page.waitForSelector("#pdfContainer canvas", { timeout: 15000 });
  } catch (e) { logs.push("[wait] canvas 未出现: " + e.message); }
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const cv = document.querySelector("#pdfContainer canvas");
    const spans = document.querySelectorAll(".textLayer span");
    let nonBlank = false, text = "";
    if (cv) {
      try {
        const ctx = cv.getContext("2d");
        const d = ctx.getImageData(0, 0, Math.min(cv.width, 200), Math.min(cv.height, 200)).data;
        for (let i = 0; i < d.length; i += 4) { if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) { nonBlank = true; break; } }
      } catch (e) {}
    }
    spans.forEach((s) => (text += s.textContent + " "));
    return {
      hasCanvas: !!cv,
      canvasW: cv ? cv.width : 0,
      canvasH: cv ? cv.height : 0,
      nonBlank,
      spanCount: spans.length,
      textHasTrajectory: /trajectory/i.test(text)
    };
  });

  // 模拟划词：选中 span 里的第一个单词 "trajectory" 并派发 mouseup
  let popupShown = false;
  try {
    popupShown = await page.evaluate(() => {
      const span = document.querySelector(".textLayer span");
      if (!span || !span.firstChild) return false;
      const r = span.getBoundingClientRect();
      const sel = window.getSelection();
      const range = document.createRange();
      // 只选第一个单词 trajectory（10 个字符）
      range.setStart(span.firstChild, 0);
      range.setEnd(span.firstChild, 10);
      sel.removeAllRanges();
      sel.addRange(range);
      const ev = new MouseEvent("mouseup", { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 });
      document.dispatchEvent(ev);
      return true;
    });
    await page.waitForTimeout(1200);
    const panel = await page.evaluate(() => {
      const el = document.getElementById("wordroot-panel");
      return el ? { exists: true, visible: el.style.display !== "none" && getComputedStyle(el).display !== "none", text: (el.innerText || "").slice(0, 80) } : { exists: false };
    });
    popupShown = panel;
  } catch (e) { logs.push("[popup] " + e.message); }

  console.log("=== RENDER RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("=== POPUP ===");
  console.log(JSON.stringify(popupShown, null, 2));
  console.log("=== LOGS ===");
  console.log(logs.join("\n"));

  await browser.close();
  server.close();
  process.exit(0);
});
