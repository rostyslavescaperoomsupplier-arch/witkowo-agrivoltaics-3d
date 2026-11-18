// shared harness for adversarial QA
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const pw = require(PW);
const BASE = process.env.BASE || 'http://localhost:8770/';
const OUT = path.join(__dirname, '..', 'out');
async function open(browser, q = '', opts = {}, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...ctxOpts });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message} ${(e.stack || '').split('\n').slice(1, 3).join(' | ')}`));
  if (opts.before) await opts.before(page, ctx);
  await page.goto(BASE + q);
  if (opts.noWait) return { ctx, page, logs };
  await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: opts.timeout || 90000 });
  await page.waitForTimeout(1000);
  return { ctx, page, logs };
}
const launch = (kind = 'chromium') => pw[kind].launch({ headless: true, args: kind === 'chromium' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] : [] });
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `adv_${n}.png`) });
const W = (page) => page.evaluate(() => { const w = window.__witkowo; const s = w.state; return { mode: w.mode, hour: +s.hour.toFixed(2), sun: +(+s.sun).toFixed(3), day: +s.dayOfSeason.toFixed(1), winter: +s.winter.toFixed(2), season: s.season, site: s.site, simDay: w.sim.simDay, info: JSON.parse(JSON.stringify(w.info, (k, v) => (typeof v === 'number' && !isFinite(v) ? 'NONFINITE:' + v : v))) }; });
module.exports = { pw, BASE, OUT, open, launch, shot, W };
