# 生成最小合法 EPUB3（含英文文本章节），用于验证 epub.js 渲染与划词
import zipfile, os, json

OUT = os.path.join(os.path.dirname(__file__), "sample.epub")

MIMETYPE = "application/epub+zip"

container = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

opf = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test-0001</dc:identifier>
    <dc:title>WordRoot Test Book</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-08-27T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>"""

nav = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Nav</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter 1</a></li></ol></nav></body>
</html>"""

chapter = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
  <h2>Chapter 1</h2>
  <p>The trajectory of a thrown object follows a predictable path. Its etymology comes from the Latin jacere, meaning to throw.</p>
  <p>A good project manager must know how to eject bad ideas quickly and inject energy into the team. Every subject deserves attention.</p>
  <p>Philosophical questions about knowledge have fascinated thinkers for centuries. Understanding your motives is the first step.</p>
  <p>Apple, language, knowledge, school, computer and teacher are all common words you will encounter in daily reading.</p>
</body>
</html>"""

with zipfile.ZipFile(OUT, "w") as z:
    zi = zipfile.ZipInfo("mimetype")
    zi.compress_type = zipfile.ZIP_STORED
    z.writestr(zi, MIMETYPE)
    z.writestr("META-INF/container.xml", container)
    z.writestr("OEBPS/content.opf", opf)
    z.writestr("OEBPS/nav.xhtml", nav)
    z.writestr("OEBPS/chapter1.xhtml", chapter)

print("wrote", OUT, os.path.getsize(OUT), "bytes")
