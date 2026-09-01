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
import time
import hashlib
import zipfile
import subprocess

# --check：只校验已存在的 zip 是否与磁盘源码一致（用于发现「改了代码忘了重新打包」）
CHECK_ONLY = "--check" in sys.argv
TEXT_EXT = (".js", ".json", ".html", ".css")


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()

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

# ---- --check 模式：不重新打包，只报告 zip 与磁盘源码的差异 ----
if CHECK_ONLY:
    if not os.path.exists(OUT):
        print("未找到 %s，先运行 python store/build-zip.py" % OUT)
        sys.exit(1)
    zip_mtime = os.path.getmtime(OUT)
    stale = []
    for base, dirs, fs in os.walk(ROOT):
        parts = re.split(r"[\\/]+", os.path.relpath(base, ROOT))
        parts = [] if parts == ["."] else parts
        if any(p in EXCLUDE_DIRS for p in parts):
            dirs[:] = []
            continue
        for fn in fs:
            if fn in EXCLUDE_FILES or fn.startswith("."):
                continue
            if os.path.splitext(fn)[1].lower() not in INCLUDE_EXT:
                continue
            full = os.path.join(base, fn)
            if os.path.getmtime(full) > zip_mtime:
                stale.append(os.path.relpath(full, ROOT).replace(os.sep, "/"))
    if stale:
        print("zip 已过期，以下源文件在打包后被修改过（需重新运行 python store/build-zip.py）：")
        for s in sorted(stale):
            print("  -", s)
        sys.exit(1)
    print("zip 与磁盘源码一致（无文件在打包后被修改）")
    sys.exit(0)

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

# ---- 内容一致性 + 语法自检（防止「改了代码忘了重新打包」这类哑火事故）----
# 之前踩过：zip 内的 background.js 是三小时前的旧版，与磁盘完全不同，
# 装上去跑的是旧代码，报的行号对不上，排查成本极高。这里逐字节比对 + 逐个 node --check。
warnings = []
with zipfile.ZipFile(OUT) as z:
    for arc in z.namelist():
        if not arc.endswith(TEXT_EXT):
            continue
        full = os.path.join(ROOT, arc.replace("/", os.sep))
        if not os.path.exists(full):
            warnings.append("zip 内的 %s 在磁盘上不存在" % arc)
            continue
        if md5(full) != hashlib.md5(z.read(arc)).hexdigest():
            warnings.append("zip 内的 %s 与磁盘源码内容不一致（打包被中断或复用旧产物）" % arc)
            continue
        if arc.endswith(".js"):
            r = subprocess.run(["node", "--check", full], capture_output=True, text=True)
            if r.returncode != 0:
                warnings.append("%s 语法错误：%s" % (arc, r.stderr.strip().splitlines()[0] if r.stderr else "?"))

# ---- service worker 启动自检 ----
# 语法正确 ≠ 能启动。background.js 顶层一行抛异常，onMessage 就注册不上，扩展直接变砖，
# 且 Chrome 报的行号会误导排查。这里在模拟 SW 上下文里完整跑一遍 background.js：
#   · 正常场景：必须无异常且注册 onMessage
#   · 降级场景：强制 importScripts 抛 NetworkError，仍必须能注册 onMessage（不能变砖）
SW_TEST = os.path.join(ROOT, "tests", "sw-boot-test.js")
if os.path.exists(SW_TEST):
    r = subprocess.run(["node", SW_TEST], capture_output=True, text=True)
    if r.returncode != 0:
        bad = [ln for ln in (r.stdout or "").splitlines() if "FAIL" in ln]
        warnings.append("background.js 在 SW 上下文启动失败（%d 项）：%s"
                        % (len(bad), bad[0].strip() if bad else "无输出"))
else:
    warnings.append("缺少 SW 启动测试脚本：tests/sw-boot-test.js")

# ---- 上架前自检 ----
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
    print("上架前自检通过：icons / 长度 / 排除项 / 内容一致性 / JS 语法 / SW 启动 均 OK")
