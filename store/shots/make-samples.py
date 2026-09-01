# -*- coding: utf-8 -*-
"""生成截图素材：英文文章 HTML / 英文 PDF / 英文 EPUB。
所有文本刻意多用 ject 词族（reject/project/inject/object/subject/eject/adjective/trajectory），
离线词库自带拆解，划词即可展示词根词缀面板。
"""
import os
import uuid
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))

PARAS = [
    ("project", "Engineers project their models far into the future, yet every projection depends on assumptions that later prove fragile. A humble adjective, if you inspect its Latin root, reveals how language projects meaning across centuries."),
    ("inject", "A good teacher knows how to inject energy into a quiet classroom, while a manager might inject a sense of urgency into a sluggish team. Both acts are small interventions with large consequences."),
    ("reject", "When a committee chooses to reject a proposal, they do not merely disagree with its details; they object to its core assumptions and refuse to inject further resources into a failing experiment."),
    ("subject", "Every subject we study has a hidden story. Take the word reject: the prefix re- means back, and the root ject means to throw, so to reject is literally to throw something back at the sender."),
    ("trajectory", "The missile followed a precise trajectory before it hit its target. Pilots who must eject from a failing plane rely on this same family of words, rooted in the Latin iacere, to throw."),
    ("eject", "When a disc drive fails, the system may eject the disc automatically. Such interjections of technology into daily life are so common that we rarely stop to object to their presence."),
    ("adjective", "Even an adjective like dejected carries the trace of an ancient verb. Understanding word roots turns opaque vocabulary into a transparent, memorable system of building blocks."),
]

def make_article_html():
    body = "\n".join(
        '<p><span class="lead">{word}</span> — {sentence} For an English learner, the fastest way to absorb such words is to see their roots, to hear them spoken, and to save them for later review.</p>'.format(
            word=w, sentence=s)
        for w, s in PARAS
    )
    html = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The Hidden Roots of Everyday Words - A Short English Reading</title>
<style>
  body {{ max-width: 760px; margin: 0 auto; padding: 36px 28px; font-family: Georgia, 'Times New Roman', serif; line-height: 1.85; color: #1c1c1c; background: #fdfdfb; }}
  h1 {{ font-size: 26px; font-weight: 700; margin-bottom: 4px; }}
  .meta {{ color: #777; font-size: 13px; margin-bottom: 22px; border-bottom: 1px solid #e5e2d8; padding-bottom: 14px; }}
  h2 {{ font-size: 17px; color: #333; margin-top: 26px; }}
  p {{ font-size: 16.5px; margin: 14px 0; text-align: justify; }}
  .lead {{ font-weight: 700; }}
  .note {{ background: #f6f3ea; border-left: 4px solid #d9a441; padding: 10px 14px; font-size: 14px; color: #6b5b2e; margin-top: 24px; }}
</style>
</head>
<body>
<h1>The Hidden Roots of Everyday Words</h1>
<div class="meta">A short English reading · WordRoot demo page · 2026</div>
<h2>1. One family, many faces</h2>
{body}
<p class="note">Tip: select any word above (for example "reject" or "project") and the WordRoot panel will show its root breakdown, etymology, and mnemonic memory aids instantly.</p>
</body>
</html>""".format(body=body)
    with open(os.path.join(BASE, "sample-article.html"), "w", encoding="utf-8", newline="") as f:
        f.write(html)
    print("sample-article.html written")

def make_pdf():
    from fpdf import FPDF
    pdf = FPDF(format="letter")
    pdf.set_margins(25, 28, 25)
    pdf.add_page()
    pdf.set_font("Times", "B", 20)
    pdf.multi_cell(pdf.epw, 10, "The Hidden Roots of Everyday Words", align="C")
    pdf.ln(2)
    pdf.set_font("Times", "I", 11)
    pdf.set_text_color(110, 110, 110)
    pdf.multi_cell(pdf.epw, 6, "A short English reading for vocabulary practice - WordRoot demo", align="C")
    pdf.ln(6)
    pdf.set_text_color(28, 28, 28)
    for i, (w, s) in enumerate(PARAS, 1):
        pdf.set_font("Times", "B", 13)
        pdf.multi_cell(pdf.epw, 7, "%d. %s" % (i, w.capitalize()))
        pdf.set_font("Times", "", 12)
        pdf.multi_cell(pdf.epw, 7, s)
        pdf.ln(3)
    pdf.set_font("Times", "I", 10)
    pdf.set_text_color(140, 140, 140)
    pdf.multi_cell(pdf.epw, 6, "Select any word above with your mouse: the WordRoot extension shows root breakdown, etymology and mnemonics.", align="C")
    out = os.path.join(BASE, "sample.pdf")
    pdf.output(out)
    print("sample.pdf written")

def make_epub():
    uuid4 = str(uuid.uuid4())
    chapters = []
    for i, (w, s) in enumerate(PARAS, 1):
        chapters.append(
            '<h2>%d. %s</h2>\n<p>%s</p>' % (i, w.capitalize(), s)
        )
    chapter_xhtml = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
<title>Chapter 1</title>
<style>
body {{ font-family: Georgia, serif; line-height: 1.8; margin: 5%% 6%%; color: #222; }}
h1 {{ font-size: 1.5em; text-align: center; }}
h2 {{ font-size: 1.15em; margin-top: 1.2em; }}
p {{ text-align: justify; margin: 0.8em 0; }}
</style>
</head>
<body>
<h1>The Hidden Roots of Everyday Words</h1>
{chapters}
<p><em>Select any word: the WordRoot panel shows its root breakdown instantly.</em></p>
</body>
</html>""".format(chapters="\n".join(chapters))

    nav_xhtml = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>Nav</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter 1</a></li></ol></nav></body>
</html>"""

    container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""

    content_opf = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:%s</dc:identifier>
    <dc:title>The Hidden Roots of Everyday Words</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>WordRoot Demo</dc:creator>
    <meta property="dcterms:modified">2026-09-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>""" % uuid4

    out = os.path.join(BASE, "sample.epub")
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container_xml)
        z.writestr("OEBPS/content.opf", content_opf)
        z.writestr("OEBPS/nav.xhtml", nav_xhtml)
        z.writestr("OEBPS/chapter1.xhtml", chapter_xhtml)
    print("sample.epub written")

if __name__ == "__main__":
    make_article_html()
    make_pdf()
    make_epub()
