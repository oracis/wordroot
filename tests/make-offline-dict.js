// 生成离线高频词库：wordfreq 前 3000 词 → 有道 jsonapi 抓音标+简明释义 → wordroot/dict/offline.json
// 用法: node make-offline-dict.js   (延时 150ms/词，全量约 10 分钟)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// 1) 用 venv python 拿 wordfreq 前 3000 词
const PY = "C:/Users/DELL/.workbuddy/binaries/python/envs/default/Scripts/python.exe";
const out = spawnSync(PY, ["-c", "import json; from wordfreq import top_n_list; print(json.dumps(top_n_list('en', 3000)))"], { encoding: "utf8" });
if (out.status !== 0) { console.error("wordfreq failed:", out.stderr); process.exit(1); }
const words = JSON.parse(out.stdout);
console.log("待抓取词数:", words.length);

const OUT_DIR = path.resolve(__dirname, "..", "dict");
fs.mkdirSync(OUT_DIR, { recursive: true });

function phonetic(v) {
  // 兼容 ukphone 字符串 与 uk-phonetic:[{phonetic}] 数组
  if (!v) return "";
  let p = typeof v === "string" ? v : (v[0] && v[0].phonetic) || "";
  p = (p || "").trim();
  return p ? "/" + p + "/" : "";
}
function parseDefs(trs) {
  const defs = [];
  (trs || []).forEach(function (t) {
    const i = t && t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i && t.tr[0].l.i[0];
    if (!i) return;
    const m = /^([A-Za-z]+\.)\s*(.*)$/.exec(i);
    defs.push(m ? { pos: m[1], tran: m[2] } : { pos: "", tran: i });
  });
  return defs;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchWord(w) {
  const url = "https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(w) + "&le=en&keyfrom=dict.index";
  const resp = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://dict.youdao.com/" } });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const j = await resp.json();
  const ec = j.ec && j.ec.word && j.ec.word[0];
  if (!ec) return null;
  const uk = phonetic(ec.ukphone || (j["uk-phonetic"] && j["uk-phonetic"][0]) || "");
  const us = phonetic(ec.usphone || (j["us-phonetic"] && j["us-phonetic"][0]) || "");
  const defs = parseDefs(ec.trs);
  if (!defs.length) return null;
  return { uk, us, defs };
}

(async () => {
  const dict = {};
  let ok = 0, skip = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let data = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try { data = await fetchWord(w); } catch (e) { /* retry */ }
      if (!data) await sleep(600);
    }
    if (data) { dict[w] = data; ok++; } else { skip++; }
    if (i % 100 === 0 || i === words.length - 1) {
      console.log(`进度 ${i + 1}/${words.length} 成功=${ok} 跳过=${skip}`);
      fs.writeFileSync(OUT_DIR + "/offline.json", JSON.stringify(dict));
      fs.writeFileSync(OUT_DIR + "/offline.progress", ok + "/" + words.length);
    }
    await sleep(150);
  }
  const outFile = OUT_DIR + "/offline.json";
  fs.writeFileSync(outFile, JSON.stringify(dict));
  console.log("DONE ok=", ok, "skip=", skip, "size=", fs.statSync(outFile).size, "bytes");
  process.exit(0);
})();
