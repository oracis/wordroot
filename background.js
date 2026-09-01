// MV3 service worker 用 importScripts 载入同扩展内脚本（不能挂 CDN：MV3 禁止远程代码）
//
// 必须 try/catch：扩展热重载 / 文件被占用 / SW 反复启停时，importScripts 会抛 NetworkError。
// 不加拦截的话异常会中断整个 background.js 的执行 —— 连 onMessage 都注册不上，扩展直接变砖。
// 这里捕获后降级为「全放行」的 stub，保证查词等核心功能不受埋点模块影响。
try {
  importScripts("license.js");
} catch (e) {
  console.warn("[WordRoot] license.js 加载失败，已降级为全放行模式：", e && e.message ? e.message : String(e));
}

// 兜底：确保 WR_LICENSE 始终存在（license.js 加载失败或未挂载到 self 时）
// 语义与 CONFIG.ENABLED=false 一致：只放行，不拦截。
if (typeof WR_LICENSE === "undefined") {
  var WR_LICENSE = {
    CONFIG: { ENABLED: false, DAILY_FREE_LOOKUPS: 15, FREE_VOCAB_LIMIT: 50, HISTORY_DAYS: 30 },
    FEATURE_NAMES: {},
    RULES: {},
    record: function () { return Promise.resolve(); },
    can: function () { return Promise.resolve({ allowed: true, code: "fallback", reason: "", left: null }); },
    getUsage: function () { return Promise.resolve({}); },
    getPaid: function () { return Promise.resolve({ paid: false }); },
    setPaid: function () { return Promise.resolve(); },
    refreshPaid: function () { return Promise.resolve({ paid: false }); },
    stats: function () { return Promise.resolve(null); },
    resetAll: function () { return Promise.resolve(null); },
    paywallHtml: function () { return ""; },
    openPaymentPage: function () { return Promise.resolve(false); }
  };
}

// ---- 内置离线词库（-ject 家族，未配 Key 也能演示完整词源格式）----
const OFFLINE_DICT = {
  trajectory: {
    word: "trajectory",
    uk: "/trəˈdʒektəri/",
    us: "/trəˈdʒektəri/",
    breakdown: "tra- (横穿/跨越) + ject (扔/抛) + -ory (名词后缀)",
    etymology:
      "ject 来自拉丁语 jacere，意思是“扔、抛”。tra- 来自 trans（横穿）。trajectory 字面即“被扔出去后横穿空间的轨迹”，引申为抛射物或飞行器的轨道、弹道。现代英语常用来打比方，指事业、经济、关系等的“发展轨迹”。",
    mnemonics: [
      "eject（弹出）：e(向外)+ject(扔)→扔出去",
      "project（投射/项目）：pro(向前)+ject(扔)→向前扔",
      "所以 trajectory = 被扔出后跨越的轨迹"
    ],
    usages: [
      "flight trajectory：飞行轨道",
      "career trajectory：职业发展轨迹",
      "on an upward/downward trajectory：处于上升/下降轨迹"
    ],
    examples: [
      { en: "The missile was programmed to follow a specific trajectory.", zh: "这枚导弹被设定为沿特定弹道飞行。" },
      { en: "Her career is on an upward trajectory.", zh: "她的事业正处于上升轨道。" }
    ]
  },
  eject: {
    word: "eject",
    uk: "/iˈdʒekt/",
    us: "/iˈdʒekt/",
    breakdown: "e- (ex, 向外) + ject (扔/抛)",
    etymology:
      "ject 来自拉丁语 jacere（扔）。e- = ex（向外）。eject 即“向外扔”，引申为弹出、驱逐，以及飞行员弹射逃生（eject from a plane）。",
    mnemonics: ["ject=扔；e=out → 扔出去", "对比 inject（注入）：in(进) vs e(出)", "trajectory 里也是 ject：都是“扔”"],
    usages: ["eject the CD：弹出光盘", "eject from a plane：弹射离机", "eject someone from a club：把人赶出俱乐部"],
    examples: [
      { en: "The pilot had to eject when the engine failed.", zh: "发动机故障时飞行员不得不弹射逃生。" },
      { en: "Press the button to eject the disk.", zh: "按按钮弹出磁盘。" }
    ]
  },
  project: {
    word: "project",
    uk: "/ˈprɒdʒekt/ (n) · /prəˈdʒekt/ (v)",
    us: "/ˈprɑːdʒekt/",
    breakdown: "pro- (向前) + ject (扔/抛)",
    etymology:
      "pro- = forward（向前）。project 原义“向前扔/抛出”：作动词指投射（光、影）、规划；作名词指被“抛出”的计划 → 项目、工程，也指投射出的影像 → 投影。",
    mnemonics: ["ject=扔；pro=forward → 向前扔", "projector 投影仪：把光向前扔", "对比 eject/out, inject/in"],
    usages: ["a research project：研究项目", "project an image：投影", "project confidence：展现出自信（把气质“抛出”）"],
    examples: [
      { en: "They are working on a new building project.", zh: "他们在做一个新的建筑工程。" },
      { en: "The lamp projected a soft glow.", zh: "灯投出柔和的光。" }
    ]
  },
  inject: {
    word: "inject",
    uk: "/ɪnˈdʒekt/",
    us: "/ɪnˈdʒekt/",
    breakdown: "in- (进入) + ject (扔/抛)",
    etymology:
      "in- = into（进入）。inject 即“扔进/投入”，本义注射（把药液扔进身体），引申为注入资金、活力、幽默。",
    mnemonics: ["ject=扔；in=into → 扔进去", "inject = 注射；对比 eject=弹出", "injection 名词：注射/注入"],
    usages: ["inject a drug：注射药物", "inject money into a firm：向公司注资", "inject humor into a speech：给演讲增添幽默"],
    examples: [
      { en: "The doctor injected the medicine into his arm.", zh: "医生把药注射进他的手臂。" },
      { en: "We need to inject new energy into the team.", zh: "我们需要给团队注入新活力。" }
    ]
  },
  object: {
    word: "object",
    uk: "/ˈɒbdʒɪkt/ (n) · /əbˈdʒekt/ (v)",
    us: "/ˈɑːbdʒekt/",
    breakdown: "ob- (against, 逆) + ject (扔/抛)",
    etymology:
      "ob- = against（对着、逆）。object 原义“扔到面前/摆在面前的东西” → 名词：物体、对象；作动词：反对（把异议“扔”到面前）。",
    mnemonics: ["ject=扔；ob=against → 扔到对面", "object = 物体 / 反对", "objection 名词：反对"],
    usages: ["a small object：一个小物体", "object to a plan：反对某项计划", "direct object：直接宾语"],
    examples: [
      { en: "He objected to the decision.", zh: "他反对这个决定。" },
      { en: "This is a heavy object.", zh: "这是一件重物。" }
    ]
  },
  subject: {
    word: "subject",
    uk: "/ˈsʌbdʒɪkt/ (n) · /səbˈdʒekt/ (v)",
    us: "/ˈsʌbdʒekt/",
    breakdown: "sub- (under, 在下) + ject (扔/抛)",
    etymology:
      "sub- = under（在…之下）。subject 原义“被扔到…之下/臣服于…” → 名词：臣民、主题、学科、主语；作动词：使臣服、使经受。",
    mnemonics: ["ject=扔；sub=under → 扔到下面→臣服", "subject = 主题/学科/主语", "subjective 主观的：从“自我（在下的我）”出发"],
    usages: ["the subject of a sentence：句子主语", "a school subject：学校学科", "be subjected to tests：经受测试"],
    examples: [
      { en: "Math is my favorite subject.", zh: "数学是我最喜欢的学科。" },
      { en: "He was subjected to harsh criticism.", zh: "他遭受了严厉的批评。" }
    ]
  },
  reject: {
    word: "reject",
    uk: "/rɪˈdʒekt/",
    us: "/rɪˈdʒekt/",
    breakdown: "re- (back, 回) + ject (扔/抛)",
    etymology: "re- = back（回）。reject 即“扔回去” → 拒绝、驳回、淘汰。",
    mnemonics: ["ject=扔；re=back → 扔回去", "reject = 拒绝；对比 eject=弹出", "rejection 名词：拒绝"],
    usages: ["reject an offer：拒绝提议", "reject a manuscript：退稿", "be rejected by a school：被学校拒收"],
    examples: [
      { en: "The committee rejected the proposal.", zh: "委员会驳回了该提案。" },
      { en: "She rejected the gift.", zh: "她拒收了礼物。" }
    ]
  },
  adjective: {
    word: "adjective",
    uk: "/ˈædʒɪktɪv/",
    us: "/ˈædʒɪktɪv/",
    breakdown: "ad- (to, 朝向) + ject (throw 扔) + -ive (形容词后缀)",
    etymology:
      "ad- = to（朝向）。adjective 字面“被扔到（名词）身上的词” → 形容词，即修饰名词的词。",
    mnemonics: ["ject=扔；ad=to → 扔到名词上", "形容词就是“贴”在名词上的词", "对比 object/subject 都含 ject"],
    usages: ["a possessive adjective：物主形容词", "use an adjective：使用形容词"],
    examples: [{ en: "‘Red’ is an adjective in ‘a red apple’.", zh: "在 a red apple 中，red 是形容词。" }]
  }
};

// ---- LLM 词源生成提示词（OpenAI 兼容）----
const SYSTEM_PROMPT = `你是一位英语词源学老师，擅长用词根词缀拆解 + 联想记忆讲单词。
用户会给你一个英文单词。请只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。
JSON 结构必须如下：
{
  "word": "单词原文",
  "uk": "英音音标，如 /trəˈdʒektəri/",
  "us": "美音音标",
  "breakdown": "词根词缀拆解，如 tra- (横穿) + ject (扔) + -ory (名词后缀)",
  "etymology": "词源故事：指出拉丁/希腊词根及其原始含义，并做自然联想讲解",
  "mnemonics": ["用同源词联想，如 eject: e(向外)+ject(扔)→扔出去", "..."],
  "usages": ["flight trajectory：飞行轨道", "..."],
  "examples": [{"en": "英文例句", "zh": "中文翻译"}, "..."]
}
要求：拆解到拉丁/希腊词根；给出 2-3 个同源词联想；常见用法 2-3 条；例句 2 条。`;

// SW 热重载时 chrome 上下文可能已失效（chrome.runtime 变 undefined），
// 加守卫避免未捕获异常打断后续 DNR 规则注册
if (chrome && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "LOOKUP") {
      handleLookup(msg.word).then(sendResponse).catch(function (e) {
        sendResponse({ type: "error", msg: "查询异常：" + (e && e.message ? e.message : String(e)) });
      });
      return true; // 异步返回
    }
    if (msg && msg.type === "TTS_ONLINE") {
      handleTts(msg.text, msg.relay)
        .then(function (buf) {
          const u8 = new Uint8Array(buf);
          // 传普通数组而非 ArrayBuffer：跨 runtime.sendMessage 的 structured clone 对 ArrayBuffer 不可靠
          sendResponse({ ok: true, audio: Array.from(u8), type: "audio/mpeg", bytes: u8.byteLength });
        })
        .catch(function (e) { sendResponse({ ok: false, error: e.message }); });
      return true; // 异步返回
    }
    if (msg && msg.type === "SET_AUTOPDF") {
      setAutoPdf(!!msg.value).then(function () { sendResponse({ ok: true }); });
      return true;
    }
  });
}

// ---- 自动接管 PDF：把 .pdf 链接重定向到本扩展的 pdf.js 阅读器，从而能在 PDF 上划词 ----
const PDF_RULE_IDS = [9001, 9002];
function pdfRules() {
  const base = chrome.runtime.getURL("reader.html");
  // 用 #src= 传原 URL：fragment 不会因 ? / & 破坏 reader.html 的参数
  // 两条规则：分别匹配 .pdf（小写）与 .PDF（大写），RE2 不支持 (?i)，只能多写一条
  return [
    {
      id: 9001,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: base + "#src=\\1" } },
      condition: {
        regexFilter: "^(https?://.+\\.pdf(?:\\?.*)?(?:#.*)?)$",
        resourceTypes: ["main_frame"]
      }
    },
    {
      id: 9002,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: base + "#src=\\1" } },
      condition: {
        regexFilter: "^(https?://.+\\.PDF(?:\\?.*)?(?:#.*)?)$",
        resourceTypes: ["main_frame"]
      }
    }
  ];
}
function setAutoPdf(on) {
  return new Promise(function (resolve) {
    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds: PDF_RULE_IDS, addRules: on ? pdfRules() : [] },
      function () {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || "";
          console.error("[wordroot] DNR 规则注册失败：", msg);
          // "No SW" / Service worker not running：SW 启动可能延迟，1.5s 后重试一次
          if (/No SW|service worker/i.test(msg)) {
            console.warn("[wordroot] SW 未运行，1.5s 后重试注册 DNR");
            setTimeout(function () {
              chrome.declarativeNetRequest.updateDynamicRules(
                { removeRuleIds: PDF_RULE_IDS, addRules: on ? pdfRules() : [] },
                function () { resolve(); }
              );
            }, 1500);
            return;
          }
        } else {
          console.log("[wordroot] DNR 规则已" + (on ? "注册" : "移除"));
        }
        resolve();
      }
    );
  });
}
function ensurePdfRule() {
  chrome.storage.local.get("autoPdf", function (o) {
    // 默认开启
    if (o.autoPdf === undefined || o.autoPdf === true) {
      setAutoPdf(true);
    } else {
      setAutoPdf(false);
    }
  });
}
// 同样守卫：SW 上下文失效时静默跳过，避免整个脚本中断（会导致查词等核心功能不可用）
if (chrome && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(ensurePdfRule);
}
if (chrome && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(ensurePdfRule);
}

// edge-tts 在线中转：请求本机/公网中转服务拿到 mp3 的 ArrayBuffer，交回 content 用 <audio> 播放
// 本地地址由 host_permissions 的 <all_urls> 覆盖，无需动态申请
async function handleTtsOnline(relay, text) {
  const url = (relay || "http://localhost:8787").replace(/\/+$/, "") + "/tts";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text, voice: "en-US-JennyNeural" })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error("中转 " + resp.status + ": " + t.slice(0, 200));
  }
  return await resp.arrayBuffer();
}

// 发音分流：默认有道在线（免服务器免 Key），可选本机/自建 edge-tts 中转
async function handleTts(text, relayFromContent) {
  const s = await getTtsSettings();
  const mode = s.ttsMode || "youdao";
  if (mode === "online") {
    // 自建中转：优先用 storage 地址，content 传参兜底
    const relay = (s.ttsRelay || relayFromContent || "http://localhost:8787").replace(/\/+$/, "");
    return await handleTtsOnline(relay, text);
  }
  // 默认 youdao：dict.youdao.com/dictvoice，type=1 美音 / type=2 英音
  const url = "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(text) + "&type=1";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("有道 " + resp.status);
  return await resp.arrayBuffer();
}

function getTtsSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(["ttsMode", "ttsRelay"], function (o) {
      resolve({ ttsMode: o.ttsMode || "youdao", ttsRelay: o.ttsRelay || "" });
    });
  });
}

// ---- 离线高频词库（wordroot/dict/offline.json，COCA 前 3000 词 × 有道简明释义）----
let OFFLINE_HIGH = null; // lazy 加载，null=未加载，{} 空=加载失败
function loadOfflineDict() {
  return new Promise(function (resolve) {
    if (OFFLINE_HIGH) { resolve(OFFLINE_HIGH); return; }
    fetch(chrome.runtime.getURL("dict/offline.json"))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        OFFLINE_HIGH = j || {};
        resolve(OFFLINE_HIGH);
      })
      .catch(function () { OFFLINE_HIGH = {}; resolve(OFFLINE_HIGH); });
  });
}

// 简易英文词形还原（lemma）：有道 jsonapi 的音标只挂在原型上，变形词（models/children/went...）需回填
// 不规则表（高频），规则后缀补齐大部分
function simpleLemma(w) {
  w = (w || "").toLowerCase();
  const irregs = {
    children: "child", men: "man", women: "woman", people: "person", mice: "mouse", geese: "goose",
    teeth: "tooth", feet: "foot", data: "datum", criteria: "criterion",
    analyses: "analysis", crises: "crisis", theses: "thesis", diagnoses: "diagnosis",
    went: "go", gone: "go", came: "come", said: "say", took: "take", taken: "take",
    made: "make", given: "give", seen: "see", known: "know", written: "write",
    spoken: "speak", broken: "break", chosen: "choose", driven: "drive", eaten: "eat",
    was: "be", were: "be", been: "be",
    better: "good", best: "good", worse: "bad", worst: "bad",
    has: "have", does: "do"
  };
  if (irregs[w]) return irregs[w];
  if (w.length <= 3) return w;
  // -ies → -y（parties → party）
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  // -ing / -ed 粗略：去后缀后查 offline
  if (w.endsWith("ing") && w.length > 4) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 3) return w.slice(0, -1);
  // -es（boxes→box, watches→watch, buses→bus）
  if (w.endsWith("es") && w.length > 3) return w.slice(0, -2);
  // -s（models→model, cats→cat）
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
}

function phoneticOf(v) {
  if (!v) return "";
  let p = typeof v === "string" ? v : (v[0] && v[0].phonetic) || "";
  p = (p || "").trim();
  return p ? "/" + p + "/" : "";
}
function defsOf(trs) {
  const defs = [];
  (trs || []).forEach(function (t) {
    const i = t && t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i && t.tr[0].l.i[0];
    if (!i) return;
    const m = /^([A-Za-z]+\.)\s*(.*)$/.exec(i);
    defs.push(m ? { pos: m[1], tran: m[2] } : { pos: "", tran: i });
  });
  return defs;
}

// 有道词典在线兜底：免费、无需 Key、国内可访问；含 释义+词源+同根词+双语例句
async function fetchYoudao(word) {
  const url = "https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(word) + "&le=en&keyfrom=dict.index";
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Referer: "https://dict.youdao.com/"
    }
  });
  if (!resp.ok) throw new Error("有道 " + resp.status);
  const j = await resp.json();
  const ec = j.ec && j.ec.word && j.ec.word[0];
  if (!ec) throw new Error("有道无释义");
  const defs = defsOf(ec.trs);
  if (!defs.length) throw new Error("有道无释义");
  const d = {
    word: word,
    uk: phoneticOf(ec.ukphone || (j["uk-phonetic"] && j["uk-phonetic"][0]) || ""),
    us: phoneticOf(ec.usphone || (j["us-phonetic"] && j["us-phonetic"][0]) || ""),
    defs: defs,
    source: "youdao"
  };
  // 词源段落（etym.etyms.zh[0].value）
  try {
    const et = j.etym && j.etym.etyms && j.etym.etyms.zh && j.etym.etyms.zh[0];
    if (et && et.value) d.etymology = et.value.replace(/\n{2,}/g, "\n").trim();
  } catch (e) {}
  // 同根词（rel_word.rels[].rel.words[]）
  try {
    const rw = j.rel_word && j.rel_word.rels;
    if (rw && rw.length) {
      const seen = {}, list = [];
      rw.forEach(function (r) {
        const rel = r.rel || {};
        (rel.words || []).forEach(function (w) {
          const wd = (w.word || "").trim();
          if (!wd || seen[wd]) return;
          seen[wd] = 1;
          list.push({ word: wd, tran: (w.tran || "").trim(), pos: rel.pos || "" });
        });
      });
      if (list.length) d.related = list.slice(0, 8);
    }
  } catch (e) {}
  // 双语例句（blng_sents_part["sentence-pair"]）
  try {
    const sp = j.blng_sents_part && j.blng_sents_part["sentence-pair"];
    if (sp && sp.length) {
      d.examples = sp.slice(0, 2).map(function (s) {
        return { en: (s.sentence || "").trim(), zh: (s["sentence-translation"] || "").trim() };
      }).filter(function (x) { return x.en; });
    }
  } catch (e) {}
  return d;
}

async function handleLookup(word) {
  try {
    return await handleLookupInner(word);
  } catch (e) {
    // 外层兜底：任何 await 异常（storage/fetch/JSON 解析等）都不能让 panel 永远"查询中"
    console.error("[wordroot] handleLookup 未捕获异常:", e && e.message, e);
    return { type: "error", msg: "查询失败：" + (e && e.message ? e.message : String(e)) };
  }
}
async function handleLookupInner(word) {
  const key = word.toLowerCase();
  // 付费闸门（ENABLED=false 时恒通过，只埋点不拦截）
  const gate = await WR_LICENSE.can("lookup");
  if (!gate.allowed) {
    return { type: "paywall", feature: "lookup", reason: gate.reason, code: gate.code };
  }
  const cached = await getCache(key);
  if (cached) return { type: "ok", data: cached, cached: true };
  // 缓存命中不计数（同一个词反复看不该消耗额度），其余都记一次真实查词
  WR_LICENSE.record("lookup");
  // 1) 内置 -ject 词典
  if (OFFLINE_DICT[key]) return { type: "ok", data: OFFLINE_DICT[key], cached: false };
  // 2) 离线高频词库（COCA 前 3000，含音标+简明释义）
  const offline = await loadOfflineDict();
  if (offline[key]) {
    let d = Object.assign({ word: word }, offline[key]);
    // 变形词常无音标：有道 jsonapi 只在原型挂音标；回填同词库的原型音标
    if (!d.uk && !d.us) {
      const lemma = simpleLemma(key);
      if (lemma !== key && offline[lemma] && (offline[lemma].uk || offline[lemma].us)) {
        d.uk = offline[lemma].uk;
        d.us = offline[lemma].us;
        d._lemma = lemma; // 标记用了原型音标
      }
    }
    d.source = "offline";
    return { type: "ok", data: d, cached: false };
  }
  const settings = await getSettings();
  // 3) 配了 Key：LLM 词源优先；LLM 失败降级有道
  if (settings.apiKey) {
    try {
      WR_LICENSE.record("llm"); // 只统计，不拦截（用的是用户自己的 Key）
      const data = await callLLM(settings, word);
      await setCache(key, data);
      return { type: "ok", data: data, cached: false };
    } catch (e) {
      try {
        const d = await fetchYoudao(word);
        await setCache(key, d);
        return { type: "ok", data: d, cached: false };
      } catch (e2) {
        return { type: "error", msg: "词源生成失败：" + e.message + "\n兜底释义失败：" + e2.message };
      }
    }
  }
  // 4) 未配 Key：有道在线兜底（任何词都能查）
  try {
    const d = await fetchYoudao(word);
    await setCache(key, d);
    return { type: "ok", data: d, cached: false };
  } catch (e) {
    return { type: "need_key", msg: e.message };
  }
}

async function callLLM(settings, word) {
  const base = (settings.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + settings.apiKey
    },
    body: JSON.stringify({
      model: settings.model || "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: word }
      ]
    })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error("API " + resp.status + ": " + t.slice(0, 200));
  }
  const j = await resp.json();
  const content = j.choices && j.choices[0] && j.choices[0].message.content;
  return parseJSON(content);
}

function parseJSON(s) {
  s = (s || "").trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end >= 0) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

function getCache(k) {
  return new Promise(function (resolve) {
    chrome.storage.local.get("ety:" + k, function (o) {
      resolve(o["ety:" + k] || null);
    });
  });
}

function setCache(k, v) {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ ["ety:" + k]: v }, resolve);
  });
}

function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(["apiKey", "baseURL", "model"], function (o) {
      resolve({ apiKey: o.apiKey || "", baseURL: o.baseURL || "", model: o.model || "" });
    });
  });
}
