// 终极验证：把扩展真实加载进 Chrome，访问 .pdf 链接，确认 DNR 自动重定向 + 渲染
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("C:/Users/DELL/WorkBuddy/2026-08-27-13-50-21/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 18732;
const EXT = ROOT; // wordroot 就是扩展根

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".pdf": "application/pdf" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/sample.pdf") p = path.join(__dirname, "sample.pdf");
  else p = path.join(ROOT, p === "/" ? "reader.html" : p);
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wr-ext-"));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-extensions-except=" + EXT,
      "--load-extension=" + EXT
    ]
  });

  // 从 service worker 的 URL 里拿扩展 id
  let extId = null;
  try {
    await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  } catch (e) {}
  const sws = ctx.serviceWorkers();
  for (const sw of sws) {
    const m = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (m) extId = m[1];
  }
  console.log("extension id:", extId || "(未拿到)");

  const logs = [];
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on("console", (m) => logs.push("[console." + m.type() + "] " + m.text()));
  page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));

  const pdfUrl = "http://localhost:" + PORT + "/sample.pdf";
  console.log("navigating to:", pdfUrl);
  await page.goto(pdfUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch((e) => logs.push("[goto] " + e.message));
  await page.waitForTimeout(6000);

  const state = await page.evaluate(() => ({
    url: location.href,
    hasCanvas: !!document.querySelector("#pdfContainer canvas"),
    spanText: (() => { let t = ""; document.querySelectorAll(".textLayer span").forEach((s) => (t += s.textContent + " ")); return t; })(),
    errText: (document.getElementById("err") && document.getElementById("err").textContent) || ""
  })).catch((e) => ({ url: "n/a", error: e.message }));

  console.log("=== PAGE STATE ===");
  console.log(JSON.stringify(state, null, 2));
  console.log("=== LOGS ===");
  console.log(logs.join("\n"));

  await ctx.close();
  server.close();
  process.exit(0);
});
