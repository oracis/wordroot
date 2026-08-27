# 词源划词 WordRoot

划词即出词根词缀拆解与联想记忆的英语词典浏览器扩展（Chrome MV3）。

## 功能

- **划词即查**：网页、PDF（自动接管 `.pdf` 链接）中选中单词，弹出词源面板
- **三级词源**：离线高频词库（COCA 前 3000 × 有道）→ 有道在线兜底（释义/词源/同根词/例句）→ LLM 词源故事（可选，自带 Key）
- **朗读发音**：默认有道在线（免服务器免 Key）；可选本机语音 / 自建 edge-tts 中继
- **生词本**：收藏、搜索、朗读、导出单词列表与背词卡（Anki 格式）

## 使用

1. 打开 `chrome://extensions` → 开启开发者模式 → 「加载已解压的扩展程序」→ 选择本目录
2. 网页划词即可体验；不配置 LLM Key 也能查词（离线 + 有道兜底）
3. 可选：选项页配置 LLM Key（OpenAI 兼容），解锁结构化词根拆解与联想记忆

## 目录

```
background.js   查询链路（缓存→离线→LLM/有道）+ TTS + DNR PDF 接管
content.js      划词浮层（选区、弹框、朗读、生词本）
reader.html/js  PDF 阅读器（pdf.js，自动接管 .pdf 链接）
dict/           离线高频词库（offline.json）
vocab.*         生词本管理页
options.*       设置（LLM Key / 发音源 / PDF 接管开关）
tts-relay/      自建 edge-tts 中继（高级选项，可选）
```

## 数据源

- 离线词库：wordfreq（COCA）前 3000 词 × 有道词典（`tests-wordroot/make-offline-dict.js` 生成）
- 在线兜底：有道词典 jsonapi（免费、无需 Key）
- LLM：用户自带 Key，词源缓存本地
