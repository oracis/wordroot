// 端到端验证：生词本卡片点击补全词源（vocab.html + 桩）
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/DELL/WorkBuddy/2026-08-27-13-50-21/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 18735;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]) || "/vocab.html";
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
  page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));

  // 桩：storage 预置一个简版词条；LOOKUP 返回完整 LLM 词源
  const savedVocab = [];
  await page.addInitScript(() => {
    const stored = { vocab: [{ word: "apple", uk: "/ˈæpl/", us: "/ˈæpl/", defs: [{ pos: "n.", tran: "苹果" }], breakdown: "", etymology: "", addedAt: Date.now() }] };
    window.chrome = {
      runtime: {
        getURL: (u) => u, lastError: null,
        onMessage: { addListener: function () {} },
        sendMessage: function (msg, cb) {
          if (msg && msg.type === "LOOKUP") {
            cb({ type: "ok", cached: false, data: {
              word: msg.word, uk: "/ˈæpl/", us: "/ˈæpl/",
              breakdown: "apple（苹果）—— 词源：古英语 æppel",
              etymology: "apple 源自古英语 æppel，与德语 Apfel 同源，原始印欧语 ab(e)l- 意为“果实”。",
              mnemonics: ["ap+ple → 苹果"],
              usages: ["apple pie：苹果派"],
              examples: [{ en: "An apple a day keeps the doctor away.", zh: "一天一苹果，医生远离我。" }],
              source: "llm"
            } });
          } else cb({});
        }
      },
      storage: {
        local: {
          get: (k, cb) => cb({ vocab: stored.vocab }),
          set: (o, cb) => { stored.vocab = o.vocab; window.__saved = JSON.parse(JSON.stringify(o.vocab)); cb && cb(); }
        }
      }
    };
  });

  await page.goto("http://localhost:" + PORT + "/vocab.html", { waitUntil: "load" });
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => {
    const card = document.querySelector(".card");
    return { cardExists: !!card, hasTag: !!(card && card.querySelector(".tag")), tagText: card && card.querySelector(".tag") ? card.querySelector(".tag").textContent : "", hasIncomplete: !!(card && card.classList.contains("incomplete")), hasDefs: !!(card && /苹果/.test(card.innerText)), body: card ? card.innerText.slice(0, 120) : "" };
  });

  // 点击卡片本体（非按钮）
  await page.evaluate(() => {
    const card = document.querySelector(".card");
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.x + 30, clientY: rect.y + 30 }));
  });
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => {
    const card = document.querySelector(".card");
    const saved = window.__saved && window.__saved[0];
    return {
      hasBreakdown: /词根词缀拆解/.test(card.innerText),
      hasEtymology: /apple 源自古英语/.test(card.innerText),
      hasExample: /An apple a day/.test(card.innerText),
      tagGone: !card.querySelector(".tag"),
      savedHasBreakdown: !!(saved && saved.breakdown),
      savedSource: saved && saved.source
    };
  });

  const ok = before.cardExists && before.hasTag && before.hasIncomplete && before.hasDefs &&
    after.hasBreakdown && after.hasEtymology && after.hasExample && after.tagGone &&
    after.savedHasBreakdown && after.savedSource === "llm";
  console.log("BEFORE:", JSON.stringify(before, null, 1));
  console.log("AFTER :", JSON.stringify(after, null, 1));
  console.log("=== 卡片补全:", ok ? "PASS" : "FAIL", "===");
  if (logs.length) console.log("logs:", logs.join(" | "));

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
});
