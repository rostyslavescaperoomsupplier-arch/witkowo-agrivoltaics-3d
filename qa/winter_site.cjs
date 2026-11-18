// QA winter inside the full site: node qa/winter_site.cjs [url] -> qa/out/winter_site_*.png
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const URL = process.argv[2] || 'http://localhost:8770/';
const OUT = path.join(__dirname, 'out');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__witkowo && window.__witkowo.mods, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  console.log('mods', await page.evaluate(() => Object.keys(window.__witkowo.mods).join(',')));
  await page.screenshot({ path: path.join(OUT, 'winter_site_summer.png') });
  const btn = await page.$('#seasons button[data-season="winter"]');
  if (btn) { await btn.click(); console.log('clicked winter toggle'); } else await page.evaluate(() => { window.__witkowo.state.season = 'winter'; });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(OUT, 'winter_site_transition.png') });
  await page.waitForTimeout(4000);
  await page.evaluate(() => { const s = window.__witkowo.state; s.hour = 12; s.speed = 0; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'winter_site_full.png') });
  console.log('info', await page.evaluate(() => JSON.stringify({ w: window.__witkowo.state.winter, i: window.__witkowo.mods.winter && window.__witkowo.mods.winter.info() })));
  console.log('LOGS', logs.length ? [...new Set(logs)].slice(0, 20).join('\n') : 'none');
  await browser.close();
})();
