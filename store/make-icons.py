#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 Chrome 扩展图标与商店宣传素材。

图标设计：橙色渐变圆角方块 + 白色 W（WordRoot）+ 底部根须（Root / 词根）
输出：
  wordroot/icons/icon-16.png  32/48/128
  wordroot/store/assets/promo-small.png   440x280
  wordroot/store/assets/promo-marquee.png 1400x560
  wordroot/store/assets/screenshot-1280x800.png  占位底图（建议替换为真实截图）

用法：  python store/make-icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # wordroot/
ICON_DIR = os.path.join(ROOT, "icons")
ASSET_DIR = os.path.join(HERE, "assets")

# 品牌色：与 content.css 面板边框 #b06a2c 同源
C_TOP = (201, 122, 52)      # #c97a34
C_BOT = (138, 79, 24)       # #8a4f18
C_WHITE = (255, 255, 255)

FONT_BOLD = "C:/Windows/Fonts/arialbd.ttf"
FONT_UI = "C:/Windows/Fonts/segoeuib.ttf"
FONT_CN = "C:/Windows/Fonts/msyhbd.ttc"


# ---------- 基础绘制工具 ----------
def rounded_mask(size, radius_ratio=0.22, scale=4):
    """超采样生成圆角矩形 alpha mask，避免锯齿。"""
    s = size * scale
    r = int(size * radius_ratio * scale)
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def vgradient(size, top, bot, mask=None):
    """垂直渐变底。"""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = c + (255,)
    if mask:
        img.putalpha(mask)
    return img


def quad(p0, p1, p2, steps=40):
    """二次贝塞尔采样点。"""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def fit_font(path, text, target_w, target_h):
    """按目标宽高自动选字号。"""
    size = 8
    best = None
    while size < 400:
        try:
            f = ImageFont.truetype(path, size)
        except Exception:
            f = ImageFont.load_default()
        bb = f.getbbox(text)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        if w <= target_w and h <= target_h:
            best = (f, w, h, bb)
        else:
            break
        size += 1
    return best


# ---------- 图标主体 ----------
def make_icon(size):
    S = 128                       # 统一在 128 画布画，最后缩放，保证各尺寸一致
    img = vgradient(S, C_TOP, C_BOT, rounded_mask(S))
    d = ImageDraw.Draw(img)

    # 小尺寸走简化路径：去掉根须，让 W 居中更大更可读
    if size <= 24:
        target_w = int(S * 0.70)
        target_h = int(S * 0.55)
        res = fit_font(FONT_BOLD, "W", target_w, target_h)
        f, w, h, bb = res
        x = (S - w) / 2 - bb[0]
        y = (S - h) / 2 - bb[1]
        d.text((x, y), "W", font=f, fill=C_WHITE)
        if size != S:
            img = img.resize((size, size), Image.LANCZOS)
        return img

    # --- 白色 W ---
    target_w = int(S * 0.62)
    target_h = int(S * 0.40)
    res = fit_font(FONT_BOLD, "W", target_w, target_h)
    f, w, h, bb = res
    x = (S - w) / 2 - bb[0]
    y = int(S * 0.30) - h / 2 - bb[1]
    d.text((x, y), "W", font=f, fill=C_WHITE)

    # --- 根须：象征 root / 词根，从 W 底部垂下并分叉 ---
    w_pts = 6 if size >= 48 else 5
    root_top = int(S * 0.53)
    bottom = int(S * 0.855)

    def root(p0, p1, p2, width):
        pts = quad(p0, p1, p2)
        d.line(pts, fill=C_WHITE, width=width, joint="curve")

    cx = S / 2
    # 主根
    root((cx, root_top), (cx, bottom - S * 0.06), (cx, bottom), w_pts)
    # 左右主侧根
    root((cx, root_top + S * 0.02), (cx - S * 0.10, bottom - S * 0.07),
         (cx - S * 0.155, bottom - S * 0.02), w_pts - 1)
    root((cx, root_top + S * 0.02), (cx + S * 0.10, bottom - S * 0.07),
         (cx + S * 0.155, bottom - S * 0.02), w_pts - 1)
    # 两条细分叉（小尺寸下可忽略）
    if size >= 32:
        root((cx, bottom - S * 0.05), (cx - S * 0.05, bottom + S * 0.03),
             (cx - S * 0.075, bottom + S * 0.075), w_pts - 2)
        root((cx, bottom - S * 0.05), (cx + S * 0.05, bottom + S * 0.03),
             (cx + S * 0.075, bottom + S * 0.075), w_pts - 2)

    if size != S:
        img = img.resize((size, size), Image.LANCZOS)
    return img


# ---------- 商店宣传素材 ----------
def make_promo_small():
    """440x280 小宣传图：左图右文。"""
    W, H = 440, 280
    img = Image.new("RGB", (W, H), (250, 247, 242))
    d = ImageDraw.Draw(img)

    # 左侧深色块
    d.rectangle([0, 0, 168, H], fill=(58, 61, 64))
    icon = make_icon(128)
    img.paste(icon, (20, 60), icon)

    f_title = ImageFont.truetype(FONT_CN, 26)
    f_sub = ImageFont.truetype(FONT_CN, 14)
    f_body = ImageFont.truetype(FONT_CN, 13)

    d.text((192, 52), "词源划词 WordRoot", font=f_title, fill=(43, 43, 43))
    d.text((192, 88), "划词即出词根词缀拆解", font=f_sub, fill=(176, 106, 44))

    lines = ["· 网页 / PDF / EPUB 都能划词", "· 联想记忆 · 同根词 · 例句",
             "· 不配 Key 也能用", "· 一键导出 Anki 卡片"]
    y = 122
    for ln in lines:
        d.text((192, y), ln, font=f_body, fill=(90, 90, 90))
        y += 26
    return img


def make_promo_marquee():
    """1400x560 顶部宣传图。"""
    W, H = 1400, 560
    img = Image.new("RGB", (W, H), (58, 61, 64))
    d = ImageDraw.Draw(img)

    # 右侧暖色斜块
    d.polygon([(980, 0), (W, 0), (W, H), (860, H)], fill=(176, 106, 44))

    icon = make_icon(220)
    img.paste(icon, (80, 150), icon)

    f_h1 = ImageFont.truetype(FONT_CN, 54)
    f_h2 = ImageFont.truetype(FONT_CN, 24)
    f_p = ImageFont.truetype(FONT_CN, 20)

    d.text((360, 140), "单词记不住，是因为不认识词根词缀", font=f_h1, fill=(255, 255, 255))
    d.text((360, 218), "选中一个词，拆解、联想、同根词、例句即刻浮现", font=f_h2, fill=(255, 226, 199))

    items = ["网页 / PDF / EPUB 全支持", "离线 2984 词，断网可用",
             "三级词源层层兜底", "导出 Anki 背词卡"]
    y = 290
    for it in items:
        d.ellipse([366, y + 8, 374, y + 16], fill=(255, 255, 255))
        d.text((388, y), it, font=f_p, fill=(230, 228, 225))
        y += 40

    d.text((1000, 460), "词源划词  WordRoot", font=f_h2, fill=(255, 255, 255))
    return img


def make_screenshot_placeholder():
    """1280x800 截图位：给出构图模板，建议用真实截图替换。"""
    W, H = 1280, 800
    img = Image.new("RGB", (W, H), (246, 243, 238))
    d = ImageDraw.Draw(img)
    f_cn = ImageFont.truetype(FONT_CN, 34)
    f_cn2 = ImageFont.truetype(FONT_CN, 20)

    # 模拟浏览器窗口
    d.rounded_rectangle([60, 60, W - 60, H - 60], radius=14, fill=(255, 255, 255),
                        outline=(216, 212, 206), width=2)
    d.rectangle([60, 60, W - 60, 108], fill=(238, 236, 233))
    for i, cx in enumerate([92, 120, 148]):
        d.ellipse([cx, 78, cx + 14, 92], fill=(205, 200, 194))
    d.rounded_rectangle([178, 76, W - 200, 94], radius=9, fill=(255, 255, 255))

    # 正文占位条
    y = 160
    for _ in range(9):
        w = 900 if _ % 3 else 720
        d.rectangle([140, y, 140 + w, y + 14], fill=(232, 229, 224))
        y += 30

    # 划词高亮
    d.rectangle([140, 250, 320, 274], fill=(255, 226, 168))

    # 弹出的词源面板
    px, py, pw, ph = 400, 250, 640, 400
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=12, fill=(255, 255, 255),
                        outline=(176, 106, 44), width=3)
    d.rectangle([px, py, px + pw, py + 62], fill=(255, 251, 246))
    d.text((px + 24, py + 18), "inspector", font=f_cn, fill=(43, 43, 43))

    rows = ["in-  向内", "spect  看（词根）", "-or  表示「人」",
            "→ 向内看的人 → 检查员", "", "同根词：respect / prospect / retrospect"]
    yy = py + 92
    for r in rows:
        d.text((px + 24, yy), r, font=f_cn2, fill=(90, 90, 90) if not r.startswith("→") else (176, 106, 44))
        yy += 46

    d.text((140, H - 96), "替换建议：把此图换成扩展真实使用截图（划词面板弹出效果）",
           font=f_cn2, fill=(170, 130, 90))
    return img


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(ASSET_DIR, exist_ok=True)

    for s in (16, 32, 48, 128):
        p = os.path.join(ICON_DIR, "icon-%d.png" % s)
        make_icon(s).save(p)
        print("icon", s, "->", p)

    make_promo_small().save(os.path.join(ASSET_DIR, "promo-small-440x280.png"))
    make_promo_marquee().save(os.path.join(ASSET_DIR, "promo-marquee-1400x560.png"))
    make_screenshot_placeholder().save(os.path.join(ASSET_DIR, "screenshot-1280x800.png"))
    print("promo/screenshot ->", ASSET_DIR)


if __name__ == "__main__":
    main()
