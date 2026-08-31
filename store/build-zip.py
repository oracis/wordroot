#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包 Chrome 扩展：排除 tests/、tts-relay/、analytics/、store/、样例文件等。
用法：  python store/build-zip.py
输出：  store/build/wordroot-<version>.zip
"""
import os
import re
import sys
import json
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, "build")
os.makedirs(BUILD, exist_ok=True)

# 打包时要排除的路径（相对 wordroot 根）
EXCLUDE_DIRS = {"tests", "tts-relay", "analytics", "store", ".git", "__pycache__", "node_modules"}
EXCLUDE_FILES = {
    "test.html", ".gitignore", "make-offline-dict.js",
    "sample.epub", "sample.pdf",
}
# 包含的扩展名（其它不进 zip）
INCLUDE_EXT = {
    ".js", ".json", ".html", ".css", ".png", ".jpg", ".jpeg", ".svg",
    ".md", ".txt", ".eot", ".ttf", ".woff", ".woff2",
    ".otf", ".pdf", ".epub",  # pdfjs/epubjs/dict 资源需要
}

# ---- 读 manifest.version ----
with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
    m = json.load(f)
VERSION = m.get("version", "0.0.0")
NAME = m.get("name", "wordroot").replace(" ", "_")
OUT = os.path.join(BUILD, "%s-%s.zip" % (NAME, VERSION))

# ---- 收集文件 ----
files = []
for base, dirs, fs in os.walk(ROOT):
    rel = os.path.relpath(base, ROOT)
    # 跳过排除目录
    parts = re.split(r"[\\/]+", rel) if rel != "." else []
    if any(p in EXCLUDE_DIRS for p in parts):
        dirs[:] = []
        continue
    for fn in fs:
        if fn in EXCLUDE_FILES:
            continue
        if fn.startswith("."):  # 隐藏文件
            continue
        ext = os.path.splitext(fn)[1].lower()
        if ext not in INCLUDE_EXT:
            continue
        full = os.path.join(base, fn)
        arc = os.path.relpath(full, ROOT).replace(os.sep, "/")
        files.append((full, arc))

files.sort(key=lambda x: x[1])

# ---- 写 zip ----
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for full, arc in files:
        z.write(full, arcname=arc)

size_kb = os.path.getsize(OUT) / 1024
print("打包完成：%s  (%.1f KB, %d 个文件)" % (OUT, size_kb, len(files)))

# ---- 上架前自检（最简化版）----
warnings = []
# 1) icons
icons = m.get("icons", {})
for sz in (16, 32, 48, 128):
    key = str(sz)
    if key not in icons:
        warnings.append("缺少 icons[%s]" % key)
    elif not os.path.exists(os.path.join(ROOT, icons[key])):
        warnings.append("icons[%s] 指向的文件不存在：%s" % (key, icons[key]))
# 2) description 长度
desc = m.get("description", "")
if len(desc) > 132:
    warnings.append("description 超过 132 字符（当前 %d）" % len(desc))
# 3) 不应在 zip 中出现敏感文件
with zipfile.ZipFile(OUT) as z:
    for n in z.namelist():
        for bad in ("tests/", "tts-relay/", "analytics/", "store/", "sample.pdf", "sample.epub"):
            if bad in n:
                warnings.append("zip 内出现应排除的路径：%s" % n)
                break

if warnings:
    print("\n上架前自检警告：")
    for w in warnings:
        print("  -", w)
    sys.exit(1)
else:
    print("上架前自检通过：icons / 长度 / 排除项均 OK")
