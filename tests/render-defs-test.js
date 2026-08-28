// 验证 content.js 的「简明释义」渲染分支（defs 数据 → 面板显示 释义+来源）
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/DELL/WorkBuddy/2026-08-27-13-50-21/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 18734;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/render-test.html";
  if (p === "/render-test.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><p style="font-size:28px;padding:40px">trajectory project eject object</p><script src="/content.js"></script></body></html>');
    return;
  }
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, async () => {
  const browser = await chromium.launch({ channel: "chrome", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));

  await page.addInitScript(() => {
    if (!window.chrome) window.chrome = {};
    window.chrome.runtime = {
      getURL: (u) => u, lastError: null,
      onMessage: { addListener: function () {} },
      sendMessage: function (msg, cb) {
        if (msg && msg.type === "LOOKUP") {
          cb({ type: "ok", cached: false, data: {
            word: msg.word, uk: "/trəˈdʒektəri/", us: "/trəˈdʒektəri/",
            defs: [{ pos: "n.", tran: "（物体射向或抛向空中形成的）轨道，轨迹；（事业等的）发展轨迹" }, { pos: "v.", tran: "抛射，沿轨道运动" }],
            etymology: "源自古法语，由 tra-（横穿）与 ject（投掷）组合构成，指被抛出后跨越的路径。",
            related: [{ word: "eject", pos: "v.", tran: "弹出" }, { word: "project", pos: "n./v.", tran: "项目；投射" }],
            examples: [{ en: "It was the extraordinary trajectory of his life.", zh: "这是他独特的生活轨迹。" }],
            source: "youdao"
          } });
        } else cb({});
      }
    };
    window.chrome.storage = { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } };
  });

  await page.goto("http://localhost:" + PORT + "/render-test.html", { waitUntil: "load" });
  await page.waitForTimeout(600);

  // 选中页面里的 "trajectory" 并派发 mouseup
  const sel = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const idx = n.textContent.indexOf("trajectory");
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(n, idx);
        range.setEnd(n, idx + 10);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        const rect = range.getBoundingClientRect();
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.x + 2, clientY: rect.y + 2 }));
        return { found: true };
      }
    }
    return { found: false };
  });
  await page.waitForTimeout(1500);

  const panel = await page.evaluate(() => {
    const el = document.getElementById("wordroot-panel");
    if (!el) return { exists: false };
    return { exists: true, visible: el.style.display !== "none", text: (el.innerText || "").slice(0, 600) };
  });

  const t = (panel.text || "");
  const ok = sel.found && panel.exists && panel.visible &&
    t.includes("释义") && t.includes("轨道") && t.includes("来源：有道词典") &&
    t.includes("词源") && t.includes("tra-（横穿）") &&
    t.includes("同根词") && t.includes("eject") &&
    t.includes("例句") && t.includes("extraordinary trajectory");
  console.log("selection found:", sel.found);
  console.log("panel:", JSON.stringify(panel, null, 2));
  console.log("=== defs 渲染:", ok ? "PASS" : "FAIL", "===");
  console.log("logs:", logs.filter((l) => !/favicon/.test(l)).slice(0, 8).join(" | "));

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
});
