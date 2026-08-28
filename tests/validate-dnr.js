// 静态校验 background.js 里的 DNR 规则对象：防止 Chrome DNR 报错"Unexpected property"
// 用法： node validate-dnr.js  （在 tests/ 下运行，指向 ../background.js）
const fs = require("fs");
const path = require("path");

const BG = path.resolve(__dirname, "..", "background.js");
const src = fs.readFileSync(BG, "utf8");

// Chrome declarativeNetRequest.Rule 合法字段（白名单）
const RULE_KEYS = new Set(["id", "priority", "action", "condition"]);
const CONDITION_KEYS = new Set([
  "urlFilter", "regexFilter", "isUrlFilterCaseSensitive",
  "domains", "excludedDomains",
  "pageUrl", "excludedPageUrl",
  "resourceTypes", "excludedResourceTypes",
  "requestMethods", "excludedRequestMethods",
  "tabIds", "excludedTabIds",
  "initiatorDomains", "excludedInitiatorDomains"
]);
const ACTION_KEYS = new Set(["type", "redirect", "requestHeaders", "removeHeaders", "modifyHeaders"]);
const REDIRECT_KEYS = new Set(["url", "regexSubstitution", "transform"]);

// 抽出 pdfRules 函数体并 eval（文件其它部分含 chrome API 不能直接 require）
const m = src.match(/function pdfRules\(\)\s*\{([\s\S]*?)^\}/m);
if (!m) { console.error("未找到 pdfRules()"); process.exit(1); }
const rules = new Function("chrome", m[1] + "; return pdfRules();")({ runtime: { getURL: (p) => "chrome-extension://test-id/" + p } });

let bad = 0;
for (const r of rules) {
  console.log("rule id=" + r.id);
  for (const k of Object.keys(r)) {
    if (!RULE_KEYS.has(k)) { console.error("  ✗ rule 字段非法: " + k); bad++; }
  }
  if (!r.action || !ACTION_KEYS.has(r.action.type)) {
    console.error("  ✗ action.type 非法: " + (r.action && r.action.type));
    bad++;
  }
  if (r.action && r.action.redirect) {
    for (const k of Object.keys(r.action.redirect)) {
      if (!REDIRECT_KEYS.has(k)) { console.error("  ✗ redirect 字段非法: " + k); bad++; }
    }
  }
  if (r.condition) {
    for (const k of Object.keys(r.condition)) {
      if (!CONDITION_KEYS.has(k)) { console.error("  ✗ condition 字段非法: " + k); bad++; }
    }
  } else {
    console.error("  ✗ 缺少 condition"); bad++;
  }
}

if (bad) { console.error("FAIL: " + bad + " 处非法字段"); process.exit(1); }
console.log("PASS: " + rules.length + " 条规则字段全部合法");