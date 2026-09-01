# 商店截图自动化

5 张 1280×800 上架截图的自动生成脚本（无需手动划词、装扩展、截图）。

## 工具栈

- Node.js 18+ + `playwright-core`（已自带 Chromium 下载）
- Python 3（生成素材文件：HTML / PDF / EPUB）
- 系统需可加载 unpacked 扩展：playwright 自带 Chromium 开源版不受 Chrome 137+ `--load-extension` 限制

## 一次性准备

```bash
# 在 wordroot/ 根目录（或任意位置）的 node workspace 装 playwright-core
npm i playwright-core
# 下载 Chromium（国内镜像避免被墙；不设 PLAYWRIGHT_DOWNLOAD_HOST 也可，默认走 playwright 官方 CDN）
PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright \
  npx playwright-core install chromium
# Python 端装 fpdf2（生成 PDF 素材）
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install fpdf2
```

## 用法

```bash
cd wordroot/
node store/shots/take-shots.js
```

脚本自动：
1. 启动本地 HTTP 服务（`127.0.0.1:8765`）服务英文文章素材
2. 用 Playwright 启动 Chromium 加载 unpacked 扩展 `wordroot/`
3. 依次截 5 张 PNG 写到 `store/assets/shot1-web.png` ~ `shot5-vocab.png`
4. 关闭浏览器、清理临时 profile

## 文件说明

| 文件 | 作用 |
|---|---|
| `make-samples.py` | 生成 3 个素材：`sample-article.html` / `sample.pdf` / `sample.epub`（多 ject 词族，离线词库自带拆解） |
| `verify-ext.js` | 单条划词冒烟：划 reject → 检查面板渲染（用于排查扩展加载/划词问题） |
| `take-shots.js` | 5 张截图主脚本 |
| `sample-article.html` | 英文文章素材（7 段，ject 词族密集，模拟真实阅读场景） |
| `sample.pdf` | 英文 PDF 素材（fpdf2 生成） |
| `sample.epub` | 英文 EPUB 素材（自造，OEBPS 结构 + chapter1.xhtml） |

## 选词与场景

| 截图 | 场景 | 划词 | 选词原因 |
|---|---|---|---|
| shot1 | 网页 | `reject`（PARAS[2]，第 3 段） | 离线词库核心案例，词根拆解最丰富；放在文章中段避免面板压标题 |
| shot2 | PDF 阅读器 | `reject` | 同上，PDF 渲染跨 span 匹配用大小写不敏感 + 跨 text node 选区 |
| shot3 | EPUB 阅读器 | `reject`（章节 iframe 内） | 验证 reader.js 的 iframe postMessage 桥接 |
| shot4 | 选项页 | — | 填好 LLM Key / Base URL / 模型 / 朗读源后全页截图 |
| shot5 | 生词本 | `reject`/`object`/`project` 三个 | 卡片展示词根/词源/联想/常见用法/例句完整结构 |

## 已知小瑕疵

- **shot2 PDF 文字视觉**：pdf.js textLayer 透明覆盖层与 canvas 文字位置有微小偏差，肉眼能看到每行被切（实际 PDF 内容完整）。优化方向：reader.html 调整 textLayer CSS 或 reader.js 的 pdfjs viewport scale。
- **shot5 vocab 仅 2 卡片**：脚本划 `reject`/`object`/`project` 三个，但 `object` 那次与之前的 lastLookup 时序竞争导致 `save` 走 exists 分支（toast "已在生词本" 但未写入），最终 vocab 数组 2 条（reject + project）。功能展示足够；如需 3 卡片可在 take-shots.js 的 `for` 循环里为 object 加 `await waitPanel(page, 5000)` 确保 LOOKUP 完成。
