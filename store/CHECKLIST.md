# Chrome Web Store 上架清单

## 0. 一次性准备（已就绪）

- [x] **开发者账号**：到 https://chrome.google.com/webstore/devconsole 注册，需付 $5 一次性费用（约 ¥35）
- [x] **manifest.json**：补了 icons/version/minimum_chrome_version、精简了权限
- [x] **图标 16/32/48/128**：橙色 W+根须，已生成
- [x] **隐私权说明 PRIVACY.md**：逐权限与数据流说明，已在仓库公开
- [x] **打包脚本 store/build-zip.py**：自动排除 tests/、tts-relay/、analytics/、store/、样例
- [x] **测试全 PASS**：license/lookup-chain/tts-router 4 套件 49 个用例全过
- [x] **本地加载验证**：在 chrome://extensions 加载 `wordroot/` 目录完整运行过

## 1. 上传前最后自检

在 `wordroot/` 根目录跑：

```bash
python store/build-zip.py
```

应输出"打包完成：… 869 KB, 25 个文件"与"上架前自检通过"。

zip 路径：`store/build/词源划词_WordRoot-1.0.0.zip`

## 2. 商店开发者后台填写

路径：https://chrome.google.com/webstore/devconsole → New Item → 上传 zip

| 字段 | 填什么 | 来源 |
|---|---|---|
| **Name** | 词源划词 WordRoot | manifest.json |
| **Summary**（≤132 字符） | 划词即出词根词缀拆解与联想记忆的英语词典扩展，网页 / PDF / EPUB 全支持 | manifest.json |
| **Category** | 教育（Education） | 手动选 |
| **Language** | 简体中文 | 手动选 |
| **Detailed description** | 复制 `store/STORE.md` 整段（去掉最后"商店单字段映射"表） | 文件 |
| **Icon** | 上传 `icons/icon-128.png` | 文件 |
| **Small promo tile (440×280)** | 上传 `store/assets/promo-small-440x280.png` | 文件 |
| **Marquee promo (1400×560)** | 上传 `store/assets/promo-marquee-1400x560.png` | 文件 |
| **Screenshots (1280×800, 至少 1 张，建议 3-5)** | 当前 `store/assets/screenshot-1280x800.png` 是占位模板，**请用真实使用截图替换** | 需要手动截 |
| **Privacy policy URL** | `https://github.com/oracis/wordroot/blob/main/PRIVACY.md`（把代码推上 GitHub 后生效） | 仓库 URL |
| **Justification - Single purpose** | "查词工具：划词即出词根词缀拆解" | 自填 |
| **Justification - Permission: storage** | "保存设置项（API Key、模型、朗读源）、生词本、查词缓存、使用统计" | 自填 |
| **Justification - Permission: tts** | "调用浏览器内置 chrome.tts 朗读查到的英文单词" | 自填 |
| **Justification - Permission: declarativeNetRequest** | "把浏览器中点开的 .pdf 链接自动重定向到本扩展内置的 pdf.js 阅读器，从而在 PDF 上也能划词" | 自填 |
| **Justification - Host permission: <all_urls>** | "Limited Use Justification：content script 必须在用户访问的任意英文网页上监听划词（核心功能），且 DNR 规则匹配 .pdf 链接需全 URL 模式。未用于收集浏览历史、注入广告、跨站跟踪或行为画像。" | 自填 |
| **Justification - Optional host: localhost** | "高级 TTS 自建中转功能（用户自部署 tts-relay 后填地址）" | 自填 |

## 3. 截图（必做，逐步指引见 SCREENSHOTS.md）

> **详细逐步操作指引（打开方式 / 选什么词 / 怎么截 / 尺寸）已单列在 `store/SCREENSHOTS.md`，照着做即可。**

真实截图比模板有力 10 倍。至少做这 5 张（对应 SCREENSHOTS.md 的 5 节）：

1. **网页划词浮动面板**（核心卖点）：英文 Wikipedia 选 "reject"，浮层显示「词根词缀拆解 / 词源 / 联想记忆」—— 离线词库自带拆解，不用设 LLM Key
2. **PDF 阅读器划词**：本扩展打开本地英文 PDF，划词出面板
3. **EPUB 阅读器划词**：打开英文 epub，划词出面板
4. **选项页**：填好 LLM Key 等设置（**截图前把 Key 打码/清空**）
5. **生词本**：先划词「加入生词本」存几个词，再打开生词本列表

尺寸要求：**1280×800**（最小 640×400）。截完替换 `store/assets/screenshot-1280x800.png` 占位图，并在后台 Screenshots 字段传 3–5 张。

截屏工具：`Win + Shift + S` 框选，或 F12 → 设备工具栏设 1280×800 → 右上「⋯」→ Capture screenshot。

## 4. 提交后

- 审核一般 1–3 个工作日
- 通过后会发邮件，链接到 Chrome 商店页面
- 拒绝时邮件会说明原因（最常见：<all_urls> 用途未充分说明 → 按本文"Justification"段细化后重交）

## 5. 上线后

- 每周去 devconsole 看 Weekly Users、评分、评论
- 前 2 周每天回评论（Chrome 商店评论回复率与搜索排名强相关）
- 3 个月内不要做任何破坏性更新（已收藏用户的 rating 会重置）

## 6. 后续版本节奏建议

- v1.0.0 - 1.x：基础体验打磨 + 用户反馈修复
- v1.x：解锁「导出 Anki」的更多格式（CSV / JSON）
- v2.0.0：在 WAU 稳定 500+ 后考虑开付费墙（当前 license.js 已埋好 paywallHits 统计，但 CONFIG.ENABLED=false）
- 期间保持周活增长比任何功能都重要

## 7. 关键文件索引

```
wordroot/
├── manifest.json              1.0.0，icons 已配，权限已精简
├── PRIVACY.md                 隐私权说明（推到 GitHub 后挂商店）
├── icons/icon-16/32/48/128.png  应用图标
├── dict/offline.json          离线词库（956K，必须打包）
├── pdfjs/ epubjs/             PDF/EPUB 阅读器核心库
├── store/
│   ├── make-icons.py          图标生成脚本
│   ├── build-zip.py           打包脚本
│   ├── STORE.md               商店描述文案
│   ├── CHECKLIST.md           本文件
│   ├── assets/                小宣传图、顶部宣传图、截图位
│   └── build/                 打包输出
└── RECOMMEND.md               推荐文案（已可用作社区分享）
```
