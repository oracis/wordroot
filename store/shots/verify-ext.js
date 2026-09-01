// 验证：自动化 Chrome 加载 wordroot 扩展 → 本地文章页划词 → 浮层出词根拆解
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const EXT_PATH = 'c:\\Users\\DELL\\WorkBuddy\\2026-08-27-13-50-21\\wordroot';
const SHOTS = path.join(EXT_PATH, 'store', 'shots');
const PORT = 8765;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
};

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

// 在页面里选中指定单词并触发 mouseup（与真人划词等价）
async function selectWord(page, word) {
  const ok = await page.evaluate((w) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent || '';
      const i = t.indexOf(w);
      if (i >= 0) { node = walker.currentNode; node._idx = i; break; }
    }
    if (!node) return false;
    const range = document.createRange();
    range.setStart(node, node._idx);
    range.setEnd(node, node._idx + w.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    return true;
  }, word);
  return ok;
}

(async () => {
  const server = await serve();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-ext-'));
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
    // 等扩展 SW 起来
    let swUrl = null;
    for (let i = 0; i < 10; i++) {
      const sws = context.serviceWorkers();
      if (sws.length) { swUrl = sws[0].url(); break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log('SW:', swUrl || 'NOT FOUND');
    const extId = swUrl ? new URL(swUrl).host : null;
    console.log('EXT_ID:', extId);

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://127.0.0.1:${PORT}/sample-article.html`, { waitUntil: 'load' });
    await page.waitForTimeout(800); // 等 content script

    const injected = await page.evaluate(() => typeof window.__wordroot_panel_marker !== 'undefined' ? 'marker' : (document.querySelector('#wordroot-panel') ? 'panel-exists' : 'no-panel'));
    console.log('content script 注入状态:', injected);

    // 划词 reject
    const selected = await selectWord(page, 'reject');
    console.log('已选中 reject:', selected);

    // 等面板出现且内容渲染完成（不是"查询中…"）
    let panelText = '';
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const st = await page.evaluate(() => {
        const p = document.querySelector('#wordroot-panel');
        if (!p || p.style.display === 'none') return null;
        const body = p.querySelector('#wordroot-body');
        return body ? body.innerText : '';
      });
      if (st && st.length > 0 && !st.includes('查询中')) { panelText = st; break; }
    }
    console.log('面板内容:\n' + (panelText || '(未出现)'));

    if (panelText.includes('词根词缀拆解')) {
      console.log('VERIFY PASS: 词根拆解已渲染');
      await page.screenshot({ path: path.join(SHOTS, '_verify.png') });
      console.log('验证截图已存 _verify.png');
    } else {
      console.log('VERIFY FAIL');
    }
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    if (context) await context.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})();
