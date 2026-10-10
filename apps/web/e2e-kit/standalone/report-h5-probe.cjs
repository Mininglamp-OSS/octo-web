// Behavioural probes for the three blocking findings on PR #1783 head.
// Drives the real build output against a stub server implementing the
// server contracts: one-time session resolve, auth-gated presign GET,
// auth-gated upload POST, POST /v1/reports.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Defaults to the plain `vite build` output; overridable so CI can point at
// whatever build directory that job produced.
const BUILD = path.resolve(process.env.REPORT_H5_BUILD || path.join(__dirname, '../../build'));
if (!fs.existsSync(path.join(BUILD, 'report.html'))) {
  console.error(`report.html not found under ${BUILD} — run the web build first`);
  process.exit(2);
}
// Prefer a caller-supplied browser (CI uses the Playwright-managed chromium via
// PLAYWRIGHT_BROWSERS_PATH=0); fall back to a locally installed Chrome so the
// script also runs on a dev box without the bundled browser.
const submissions = [];
const uploads = [];
let sessionConsumed = false;
let uploadDelayMs = 0;
// Presign GET (#P2-1): delay its answer, or ignore the request entirely to
// model a proxy that accepts the connection but never responds.
let presignDelayMs = 0;
let presignHang = false;

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
        // Nested 3-level tree so the parent-category navigation path is exercised:
        // A(1) > B(12) > C(121), plus a flat sibling D(2).
        return json([
          { category_no: '1', category_name: 'Cat A', parent_category_no: '',
            children: [ { category_no: '12', category_name: 'Cat B', parent_category_no: '1',
                          children: [ { category_no: '121', category_name: 'Cat C', parent_category_no: '12', children: [] } ] } ] },
          { category_no: '2', category_name: 'Cat D', parent_category_no: '', children: [] },
        ]);
      }
      if (u.pathname === '/v1/file/upload' && req.method === 'GET') {
        if (!req.headers.token) return json({ status: 401, msg: 'token required' }, 401);
        if (presignHang) return; // hold the connection open, never answer
        return setTimeout(() => json({ url: `http://127.0.0.1:${port}/v1/file/upload?type=report&path=/u-1/x.png` }), presignDelayMs);
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
  // #2 is a leaf (Cat D): the form only renders for a leaf category.
  await page.evaluate(() => { window.location.hash = '#2'; });
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
  // #2 (Cat D) is a leaf, so the form renders there for the next draft.
  await page.evaluate(() => { window.location.hash = '#2'; });
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

  // ---------- Probe 2b: withdrawing during presign never starts the upload ----------
  // Isolates the cancel/abort protection from the targetPaths snapshot. Hold the
  // presign GET open, then withdraw the draft before it answers: the withdrawal
  // must mark the tile 'cancelled' so uploadImage()'s `status !== 'pending'`
  // guard skips xhr.send(). If only clearDetailContent()'s cancel is reverted
  // (snapshot kept), the tile stays 'pending' and the upload POST fires — this
  // assertion is the one that goes red for that single mutation.
  submissions.length = 0; uploads.length = 0; sessionConsumed = false; uploadDelayMs = 0;
  presignDelayMs = 800; presignHang = false;
  await openForm(page, 'http://127.0.0.1:18933/report.html?session=S2b&channel_id=ch-q&channel_type=2');
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['y'], 'withdrawn.png', { type: 'image/png' }));
    const inp = document.querySelector('.imgItem .upload');
    Object.defineProperty(inp, 'files', { value: dt.files });
    inp.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.querySelectorAll('.imgs .imgItem').length >= 1, { timeout: 3000 });
  await page.waitForTimeout(150); // presign still in flight
  await page.evaluate(() => { window.location.hash = ''; }); // withdraw → clearDetailContent
  await page.waitForTimeout(1500); // past presignDelayMs; upload POST would have landed by now
  check('P1-B-abort: withdrawing during presign never starts the upload POST',
    uploads.length === 0, `uploads=${uploads.length}`);
  presignDelayMs = 0;

  // ---------- Probe 4: submitting freezes the draft (no bypass during bridge wait) ----------
  submissions.length = 0; uploads.length = 0; sessionConsumed = false; uploadDelayMs = 900;
  await openForm(page, 'http://127.0.0.1:18933/report.html?session=S3&channel_id=ch-q&channel_type=2');
  // bridge already resolves at 120ms; submit, then try to attach + switch category
  // during that window. The draft must be frozen and the payload must reflect the
  // state validated at submit time.
  await page.fill('.reportContent', 'frozen draft');
  await page.evaluate(() => document.querySelector('.reportSubmit').click());
  // immediately try to add an image (the picker should be pointer-events:none)
  await page.evaluate(() => {
    const inp = document.querySelector('.imgItem .upload');
    if (inp) {
      const dt = new DataTransfer(); dt.items.add(new File(['x'], 'late.png', { type: 'image/png' }));
      Object.defineProperty(inp, 'files', { value: dt.files });
      inp.dispatchEvent(new Event('change'));
    }
  });
  await page.waitForTimeout(1200);
  const frozenImgs = submissions.length ? submissions[submissions.length - 1].imgs : null;
  // Safe outcomes: either the re-validation refused (no POST), or a POST went out
  // with a payload that does not omit evidence that was uploading. The unsafe case
  // (the one this guards) is a POST with empty imgs while an upload was in flight.
  const filedWithoutEvidence = submissions.some((s) => Array.isArray(s.imgs) && s.imgs.length === 0) && uploads.length > 0;
  check('P1-C: an image started during the submit window cannot be silently omitted',
    !filedWithoutEvidence,
    `posts=${submissions.length} uploads=${uploads.length} imgs=${JSON.stringify(frozenImgs)}`);

  // ---------- Probe 5: three-level category navigation includes the tapped node ----------
  submissions.length = 0; sessionConsumed = false; uploadDelayMs = 0;
  await openForm(page, 'http://127.0.0.1:18933/report.html?session=S4&channel_id=ch-q&channel_type=2');
  // open A (has children) → should land on its children list with hash #1
  await page.evaluate(() => { window.location.hash = '#1'; });
  await page.waitForTimeout(400);
  // tap B (has children) → hash must become #1-12 (NOT #1)
  await page.evaluate(() => {
    const lis = Array.from(document.querySelectorAll('.categoryBox .item ul li'));
    const b = lis.find((li) => li.querySelector('label') && li.querySelector('label').textContent === 'Cat B');
    if (b) b.dispatchEvent(new Event('touchend'));
  });
  await page.waitForTimeout(400);
  const hashAfterB = await page.evaluate(() => window.location.hash);
  check('P1-D: tapping a nested parent keeps the tapped node in the path',
    hashAfterB === '#1-12', `hash=${hashAfterB} (expected #1-12)`);
  // now tap C (leaf) → #1-12-121, root-first
  await page.evaluate(() => {
    const lis = Array.from(document.querySelectorAll('.categoryBox .item ul li'));
    const c = lis.find((li) => li.querySelector('label') && li.querySelector('label').textContent === 'Cat C');
    if (c) c.dispatchEvent(new Event('touchend'));
  });
  await page.waitForTimeout(400);
  const hashAfterC = await page.evaluate(() => window.location.hash);
  check('P1-D: leaf path is root-first and complete', hashAfterC === '#1-12-121', `hash=${hashAfterC} (expected #1-12-121)`);

  // ---------- Probe 6: presign GET that never answers → removable failure tile ----------
  // Models a proxy that accepts the presign GET but never responds. Before the
  // timeout fix the tile stays 'pending' forever (submit answers "图片还在上传中"
  // with no visible exit); after it, the tile becomes removable and submit is
  // reachable again.
  submissions.length = 0; uploads.length = 0; sessionConsumed = false; uploadDelayMs = 0;
  presignDelayMs = 0; presignHang = true;
  const presignDialogs = [];
  page.on('dialog', (d) => { presignDialogs.push(d.message()); d.dismiss(); });
  await openForm(page, 'http://127.0.0.1:18933/report.html?session=S5&channel_id=ch-q&channel_type=2');
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['z'], 'stuck.png', { type: 'image/png' }));
    const inp = document.querySelector('.imgItem .upload');
    Object.defineProperty(inp, 'files', { value: dt.files });
    inp.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.querySelectorAll('.imgs .imgItem').length >= 1, { timeout: 3000 });
  // while stuck, submit is refused and no complaint goes out (the pre-fix state)
  await page.evaluate(() => document.querySelector('.reportSubmit').click());
  await page.waitForTimeout(300);
  check('P2-1(pre): a hung presign blocks submit with no POST',
    submissions.length === 0 && presignDialogs.some((m) => /还在上传中/.test(m)),
    `posts=${submissions.length} dialogs=${JSON.stringify(presignDialogs)}`);
  // past the 10s presign timeout the tile must become a removable failure
  await page.waitForTimeout(11000);
  const failedTileVisible = await page.evaluate(() => !!document.querySelector('.imgs .imgItem.upload-failed .uploadRemove'));
  check('P2-1: timed-out presign renders a removable failure tile', failedTileVisible, `failedTile=${failedTileVisible}`);
  // remove the failed tile → submit is unblocked and posts
  await page.evaluate(() => {
    const el = document.querySelector('.uploadRemove');
    if (el) el.click();
  });
  await page.waitForTimeout(100);
  await page.fill('.reportContent', 'after removing the stuck tile');
  await page.evaluate(() => document.querySelector('.reportSubmit').click());
  await page.waitForTimeout(900);
  check('P2-1: after removing the timed-out tile, submit posts the complaint',
    submissions.length === 1, `posts=${submissions.length}`);
  presignHang = false;

  // ---------- Probe 7: bridge present but silent → submit lock is released ----------
  // The review repro: window.IMJSBridge exists but never invokes its callback.
  // Before the fix the await hangs with pointer-events:none and no prompt; after
  // it, the 5s timeout fires, alerts, and unlocks the button.
  const silentDialogs = [];
  const silentPage = await browser.newPage();
  await silentPage.addInitScript(() => {
    window.IMJSBridge = { callHandler: () => {} };
  });
  silentPage.on('dialog', (d) => { silentDialogs.push(d.message()); d.dismiss(); });
  submissions.length = 0; uploads.length = 0; sessionConsumed = false; uploadDelayMs = 0;
  presignDelayMs = 0; presignHang = false;
  await openForm(silentPage, 'http://127.0.0.1:18933/report.html?session=S6&channel_id=ch-q&channel_type=2');
  await silentPage.fill('.reportContent', 'silent bridge');
  await silentPage.evaluate(() => document.querySelector('.reportSubmit').click());
  await silentPage.waitForTimeout(3000); // below the 5s timeout: still locked (the pre-fix state)
  check('P2-2(pre): within the bridge timeout the submit is still locked',
    submissions.length === 0 &&
    (await silentPage.evaluate(() => getComputedStyle(document.querySelector('.reportSubmit')).pointerEvents)) === 'none',
    `posts=${submissions.length}`);
  await silentPage.waitForTimeout(3000); // past the 5s bridge timeout
  const unlocked = await silentPage.evaluate(() => getComputedStyle(document.querySelector('.reportSubmit')).pointerEvents);
  check('P2-2: a silent bridge releases the lock and shows a visible prompt',
    silentDialogs.some((m) => /超时/.test(m)) && unlocked !== 'none' && submissions.length === 0,
    `dialogs=${JSON.stringify(silentDialogs)} pointerEvents=${unlocked} posts=${submissions.length}`);
  await silentPage.close();

  // ---------- Probe 8: navigation during the bridge wait can't alter the payload ----------
  // The review repro: enter text in a leaf category, submit with a slow bridge,
  // then hit the footer Back control. Before the fix the post-await re-read filed
  // the complaint against the navigated-to state (empty category, discarded
  // remark) and still showed the success page. Now: navigation is ignored while
  // submitting, and the payload is the snapshot taken before the await.
  submissions.length = 0; uploads.length = 0; sessionConsumed = false; uploadDelayMs = 0;
  presignDelayMs = 0; presignHang = false;
  const navPage = await browser.newPage();
  await navPage.addInitScript(() => {
    // slow bridge: 500ms, matching the review's reproduction
    window.IMJSBridge = { callHandler: (m, o, cb) => setTimeout(() => cb(JSON.stringify({ err_code: 200, channelID: 'ch-native', channelType: 1 })), 500) };
  });
  navPage.on('dialog', (d) => d.dismiss());
  await openForm(navPage, 'http://127.0.0.1:18933/report.html?session=S7&channel_id=ch-q&channel_type=2');
  await navPage.fill('.reportContent', 'KEEP');
  // submit, then immediately drive the footer Back control during the bridge wait
  await navPage.evaluate(() => document.querySelector('.reportSubmit').click());
  await navPage.waitForTimeout(100); // inside the 500ms bridge round trip
  await navPage.evaluate(() => {
    const back = document.querySelector('.back');
    if (back) back.dispatchEvent(new Event('touchend'));
  });
  await navPage.waitForTimeout(1200);
  const navPayload = submissions.length ? submissions[submissions.length - 1] : null;
  check('P1-E: footer Back during the bridge wait cannot blank the submitted draft',
    !!navPayload && navPayload.category_no === '2' && navPayload.remark === 'KEEP',
    `payload=${JSON.stringify(navPayload)}`);
  await navPage.close();

  // ---------- Probe 9: browser back (onhashchange) during the bridge wait ----------
  // The OS/browser back gesture is not reachable by CSS, so it is guarded in
  // onhashchange instead. Hash navigation during submit must not swap the draft.
  submissions.length = 0; uploads.length = 0; sessionConsumed = false;
  const hashPage = await browser.newPage();
  await hashPage.addInitScript(() => {
    window.IMJSBridge = { callHandler: (m, o, cb) => setTimeout(() => cb(JSON.stringify({ err_code: 200, channelID: 'ch-native', channelType: 1 })), 500) };
  });
  hashPage.on('dialog', (d) => d.dismiss());
  await openForm(hashPage, 'http://127.0.0.1:18933/report.html?session=S8&channel_id=ch-q&channel_type=2');
  await hashPage.fill('.reportContent', 'HASH-KEEP');
  await hashPage.evaluate(() => document.querySelector('.reportSubmit').click());
  await hashPage.waitForTimeout(100);
  // simulate a hash navigation / back landing on the category root mid-submit
  await hashPage.evaluate(() => { window.location.hash = ''; });
  await hashPage.waitForTimeout(1200);
  const hashPayload = submissions.length ? submissions[submissions.length - 1] : null;
  // Safe outcomes: either the navigation cancelled the submit (no POST), or a
  // POST went out with the intact pre-await draft. The unsafe outcome — a POST
  // carrying the navigated-to (blank) category/remark — must not happen.
  const hashUnsafe = !!hashPayload && (hashPayload.category_no !== '2' || hashPayload.remark !== 'HASH-KEEP');
  check('P1-E: hash navigation during the bridge wait cannot file a wrong draft',
    !hashUnsafe,
    `payload=${JSON.stringify(hashPayload)}`);
  await hashPage.close();

  // ---------- Probe 3: CSP must not carry the inert bridge source ----------
  const csp = fs.readFileSync(path.resolve(__dirname, '../../../../nginx.conf.template'), 'utf8');
  const cspMatch = csp.match(/Content-Security-Policy "([^"]*)"/);
  const directive = cspMatch ? cspMatch[1] : '';
  const frameSrc = directive.match(/frame-src ([^;]*);/);
  check('P1-C: CSP does not assert the inert __bridge_loaded__ source',
    !directive.includes('__bridge_loaded__'), directive.includes('__bridge_loaded__') ? 'still present' : 'clean');
  check('P1-C: frame-src is absent, or not widened to a scheme source',
    !frameSrc || !/(^|\s)https:(\s|$)/.test(frameSrc[1]), frameSrc ? frameSrc[1] : '(no frame-src)');

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} probes passed`);
  process.exit(failed.length ? 1 : 0);
})();
