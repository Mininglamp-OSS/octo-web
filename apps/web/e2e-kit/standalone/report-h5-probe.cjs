// Behavioural probes for the three blocking findings on PR #1783 head.
// Drives the real build output against a stub server implementing the
// server contracts: one-time session resolve, auth-gated presign GET,
// auth-gated upload POST, POST /v1/reports.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BUILD = path.resolve(__dirname, '../../build');
// Prefer a caller-supplied browser (CI uses the Playwright-managed chromium via
// PLAYWRIGHT_BROWSERS_PATH=0); fall back to a locally installed Chrome so the
// script also runs on a dev box without the bundled browser.
const submissions = [];
const uploads = [];
let sessionConsumed = false;
let uploadDelayMs = 0;

function serve(port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

      if (u.pathname === '/v1/report/session/resolve') {
        if (sessionConsumed) return json({ status: 400, msg: 'invalid' }, 400);
        sessionConsumed = true;
        return json({ uid: 'u-1', token: 'tok-abc' });
      }
      if (u.pathname === '/v1/report/categories') {
        return json([{ category_no: '1', category_name: 'Cat A', parent_category_no: '', children: [] },
                     { category_no: '12', category_name: 'Cat B', parent_category_no: '', children: [] }]);
      }
      if (u.pathname === '/v1/file/upload' && req.method === 'GET') {
        if (!req.headers.token) return json({ status: 401, msg: 'token required' }, 401);
        return json({ url: `http://127.0.0.1:${port}/v1/file/upload?type=report&path=/u-1/x.png` });
      }
      if (u.pathname === '/v1/file/upload' && req.method === 'POST') {
        uploads.push({ token: req.headers.token, at: Date.now() });
        if (!req.headers.token) return json({ status: 401 }, 401);
        setTimeout(() => json({ path: 'report/u-1/LEAKED.png' }), uploadDelayMs);
        return;
      }
      if (u.pathname === '/v1/reports') {
        let body = ''; req.on('data', (c) => (body += c));
        req.on('end', () => { submissions.push(JSON.parse(body)); json({ status: 200 }); });
        return;
      }
      let p = u.pathname === '/' ? '/index.html' : u.pathname;
      const f = path.join(BUILD, p);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct }); res.end(fs.readFileSync(f));
      } else { res.writeHead(404); res.end('nf'); }
    });
    s.listen(port, () => resolve(s));
  });
}

async function openForm(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.categories && window.categories.length > 0, { timeout: 5000 });
  await page.evaluate(() => { window.location.hash = '#1'; });
  await page.waitForSelector('.reportContent', { state: 'visible', timeout: 5000 });
}

async function launchBrowser() {
  // Prefer the Playwright-managed browser (CI runs with
  // PLAYWRIGHT_BROWSERS_PATH=0); if it is not installed, fall back to a
  // system Chrome so the script still runs on a plain dev box.
  try {
    return await chromium.launch({});
  } catch (e) {
    const candidates = [
      process.env.REPORT_H5_CHROME,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) return chromium.launch({ executablePath: p });
    }
    throw e;
  }
}

(async () => {
  const results = [];
  const check = (name, cond, detail) => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

  const server = await serve(18933);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.IMJSBridge = { callHandler: (m, o, cb) => setTimeout(() => cb(JSON.stringify({ err_code: 200, channelID: 'ch-native', channelType: 1 })), 120) };
  });

  // ---------- Probe 1: double-tap files exactly one complaint ----------
  submissions.length = 0; sessionConsumed = false; uploadDelayMs = 0;
  await openForm(page, 'http://127.0.0.1:18933/report.html?session=S1&channel_id=ch-q&channel_type=2');
  await page.fill('.reportContent', 'single complaint');
  await page.evaluate(() => { const b = document.querySelector('.reportSubmit'); b.click(); b.click(); b.click(); });
  await page.waitForTimeout(1500);
  check('P1-A: three rapid taps → exactly one POST /v1/reports', submissions.length === 1, `got ${submissions.length}`);

  // ---------- Probe 2: withdrawn in-flight upload is not attached ----------
  submissions.length = 0; uploads.length = 0; sessionConsumed = false; uploadDelayMs = 900;
  await openForm(page, 'http://127.0.0.1:18933/report.html?session=S2&channel_id=ch-q&channel_type=2');
  // attach an image; its upload settles only after the category switch below
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'evidence.png', { type: 'image/png' }));
    const inp = document.querySelector('.imgItem .upload');
    Object.defineProperty(inp, 'files', { value: dt.files });
    inp.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.querySelectorAll('.imgs .imgItem').length >= 1, { timeout: 3000 });
  // switch category while the upload is still in flight → clearDetailContent
  await page.evaluate(() => { window.location.hash = ''; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.location.hash = '#12'; });
  await page.waitForSelector('.reportContent', { state: 'visible', timeout: 5000 });
  await page.fill('.reportContent', 'new draft - I attached NO photo');
  await page.waitForTimeout(1200); // stale upload lands in this window
  await page.evaluate(() => document.querySelector('.reportSubmit').click());
  await page.waitForTimeout(900);
  const imgs = submissions.length ? submissions[submissions.length - 1].imgs : null;
  check('P1-B: withdrawn in-flight upload is not attached to the next complaint',
    submissions.length === 1 && Array.isArray(imgs) && imgs.length === 0,
    `imgs=${JSON.stringify(imgs)} posts=${submissions.length}`);
  check('P1-B: upload POST carried the token header',
    uploads.length > 0 && uploads.every((u) => u.token === 'tok-abc'),
    `uploads=${uploads.length} tokens=${JSON.stringify(uploads.map((u) => u.token))}`);

  // ---------- Probe 3: CSP allows the bridge sentinel ----------
  const csp = fs.readFileSync(path.resolve(__dirname, '../../../../nginx.conf.template'), 'utf8');
  const m = csp.match(/frame-src ([^;]*);/);
  check('P1-C: frame-src includes the bridge sentinel', !!m && m[1].includes('https://__bridge_loaded__'), m ? m[1] : 'missing');
  check('P1-C: frame-src keeps self (same-origin iframes intact)', !!m && m[1].includes("'self'"), m ? m[1] : 'missing');
  check('P1-C: frame-src not widened to blanket https:', !!m && !/(^|\s)https:(\s|$)/.test(m[1]), m ? m[1] : 'missing');

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} probes passed`);
  process.exit(failed.length ? 1 : 0);
})();
