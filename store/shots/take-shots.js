// 一键生成商店 5 张截图（1280x800）
// shot1-web / shot2-pdf / shot3-epub / shot4-options / shot5-vocab
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const EXT_PATH = 'c:\\Users\\DELL\\WorkBuddy\\2026-08-27-13-50-21\\wordroot';
const SHOTS = path.join(EXT_PATH, 'store', 'shots');
const OUT = SHOTS; // 截图输出目录
const PORT = 8765;
const MIME = { '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let fp = path.join(SHOTS, urlPath);
    if (urlPath === '/' || urlPath === '') fp = path.join(SHOTS, 'sample-article.html');
    if (path.extname(fp) === '') fp += '.html';
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在 page 或 frame 内选中指定单词并触发 mouseup（支持跨 text node：PDF/EPUB 文本层会把单词拆到多个 span）
const SELECT_WORD_FN = `
(target) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n; while ((n = walker.nextNode())) nodes.push(n);
  if (!nodes.length) return false;
  const offsets = []; let merged = '';
  for (const nd of nodes) {
    const t = nd.textContent;
    offsets.push({ node: nd, start: merged.length });
    merged += t;
    offsets[offsets.length - 1].end = merged.length;
  }
  // 大小写不敏感定位（PDF/EPUB 文本层可能首字母大写 "Reject"）
  const lower = merged.toLowerCase();
  const tLower = target.toLowerCase();
  const idx = lower.indexOf(tLower);
  if (idx < 0) return false;
  const endIdx = idx + target.length;
  let startNode, startOff, endNode, endOff;
  for (const o of offsets) {
    if (startNode == null && idx >= o.start && idx <= o.end) { startNode = o.node; startOff = idx - o.start; }
    if (endNode == null && endIdx >= o.start && endIdx <= o.end) { endNode = o.node; endOff = endIdx - o.start; }
    if (startNode && endNode) break;
  }
  if (!startNode || !endNode) return false;
  const r = document.createRange();
  r.setStart(startNode, startOff);
  r.setEnd(endNode, endOff);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  return true;
}`;

async function selectWord(f, word) {
  return f.evaluate(`(${SELECT_WORD_FN})(${JSON.stringify(word)})`);
}

// 等待浮层出现且内容渲染完成，返回面板文本
async function waitPanel(f, timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await f.evaluate(() => {
      const p = document.querySelector('#wordroot-panel');
      if (!p || p.style.display === 'none') return null;
      const body = p.querySelector('#wordroot-body');
      return body ? body.innerText : null;
    }).catch(() => null);
    if (st && st.length > 0 && !st.includes('查询中') && !st.includes('扩展未响应')) return st;
    await sleep(250);
  }
  return null;
}

async function clickPanelAction(page, act) {
  await page.evaluate((a) => {
    const btn = document.querySelector('#wordroot-panel [data-act="' + a + '"]');
    if (btn) btn.click();
  }, act);
  await sleep(700);
}

(async () => {
  const server = await serve();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-shots-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-first-run',
      ],
    });

    // 等 SW 拿扩展 ID
    let extId = null;
    for (let i = 0; i < 20; i++) {
      const sws = context.serviceWorkers();
      if (sws.length) { extId = new URL(sws[0].url()).host; break; }
      await sleep(500);
    }
    console.log('EXT_ID:', extId);
    if (!extId) throw new Error('扩展未加载（SW 未出现）');
    const page = context.pages()[0] || (await context.newPage());
    const ext = (p) => `chrome-extension://${extId}/${p}`;

    // ============ SHOT 4: 选项页 ============
    console.log('--- shot4 options ---');
    await page.goto(ext('options.html'), { waitUntil: 'load' });
    await sleep(600);
    await page.fill('#apiKey', 'sk-••••••••••••••••');
    await page.fill('#baseURL', 'https://api.openai.com/v1');
    await page.fill('#model', 'gpt-4o-mini');
    await page.selectOption('#ttsMode', 'youdao');
    await page.click('#save');
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'shot4-options.png') });
    console.log('shot4 saved');

    // ============ SHOT 1: 网页划词 ============
    console.log('--- shot1 web ---');
    await page.goto(`http://127.0.0.1:${PORT}/sample-article.html`, { waitUntil: 'load' });
    await sleep(1000);
    const sel1 = await selectWord(page, 'reject');
    console.log('select reject:', sel1);
    const panel1 = await waitPanel(page);
    console.log('panel1:', panel1 ? 'OK' : 'FAIL');
    if (panel1) await page.screenshot({ path: path.join(OUT, 'shot1-web.png') });

    // 为 shot5 存 3 个词
    for (const w of ['reject', 'object', 'project']) {
      await selectWord(page, w);
      await waitPanel(page);
      await clickPanelAction(page, 'save');
      const saved = await page.evaluate(() => {
        const t = document.querySelector('#wordroot-panel .wr-toast');
        return t ? t.textContent : '';
      });
      console.log('save', w, '->', saved || '?');
    }

    // ============ SHOT 2: PDF 阅读器 ============
    console.log('--- shot2 pdf ---');
    await page.goto(ext('reader.html'), { waitUntil: 'load' });
    await sleep(600);
    await page.setInputFiles('#file', path.join(SHOTS, 'sample.pdf'));
    // 等 textLayer 出现
    let textReady = false;
    for (let i = 0; i < 60; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('#pdfContainer .textLayer span').length).catch(() => 0);
      if (n > 10) { textReady = true; break; }
      await sleep(300);
    }
    console.log('pdf textLayer ready:', textReady);
    if (textReady) {
      await sleep(500);
      const sel2 = await selectWord(page, 'reject');
      console.log('pdf select reject:', sel2);
      if (!sel2) {
        const dbg = await page.evaluate(() => {
          const spans = document.querySelectorAll('#pdfContainer .textLayer span');
          const texts = Array.from(spans).map(s => s.textContent).filter(Boolean);
          const joined = texts.join('|').slice(0, 800);
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
          const merged = nodes.map(x=>x.textContent).join('');
          return { spanCount: spans.length, joined, mergedHasReject: merged.indexOf('reject')>=0, mergedHasCommittee: merged.indexOf('committee')>=0, mergedHasProposal: merged.indexOf('proposal')>=0, mergedLen: merged.length, mergedHead: merged.slice(0,300) };
        });
        console.log('PDF DEBUG:', JSON.stringify(dbg, null, 2));
      }
      const panel2 = await waitPanel(page);
      console.log('panel2:', panel2 ? 'OK' : 'FAIL');
      if (panel2) await page.screenshot({ path: path.join(OUT, 'shot2-pdf.png') });
    }

    // ============ SHOT 3: EPUB 阅读器 ============
    console.log('--- shot3 epub ---');
    // 重新加载 reader 页面，清掉 shot2 残留面板
    await page.goto(ext('reader.html'), { waitUntil: 'load' });
    await sleep(800);
    await page.setInputFiles('#file', path.join(SHOTS, 'sample.epub'));
    let iframe = null;
    try {
      const handle = await page.waitForSelector('#epubContainer iframe', { timeout: 20000 });
      iframe = await handle.contentFrame();
      console.log('epub iframe via contentFrame:', iframe ? iframe.url() : 'NULL');
    } catch (e) {
      console.log('epub contentFrame err:', e.message);
    }
    if (!iframe) {
      // 兜底：遍历 page.frames() 找子 frame
      for (let i = 0; i < 30; i++) {
        const f = page.frames().find((x) => x !== page.mainFrame());
        if (f) { iframe = f; break; }
        await sleep(300);
      }
      console.log('epub iframe via frames fallback:', iframe ? iframe.url() : 'NOT FOUND');
    }
    if (iframe) {
      // content.js 注入后面板是懒创建（划词才创建），直接划词触发
      await sleep(800);
      const sel3 = await selectWord(iframe, 'reject');
      console.log('epub select reject:', sel3);
      const panel3 = await waitPanel(iframe);
      console.log('panel3:', panel3 ? 'OK' : 'FAIL');
      if (panel3) await page.screenshot({ path: path.join(OUT, 'shot3-epub.png') });
    }

    // ============ SHOT 5: 生词本 ============
    console.log('--- shot5 vocab ---');
    await page.goto(ext('vocab.html'), { waitUntil: 'load' });
    await sleep(800);
    const cards = await page.evaluate(() => document.querySelectorAll('#vocab .card, .vocab-card, [class*=card]').length).catch(() => 0);
    console.log('vocab cards:', cards);
    await page.screenshot({ path: path.join(OUT, 'shot5-vocab.png') });
    console.log('shot5 saved');

    console.log('ALL DONE');
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    if (context) await context.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})();
