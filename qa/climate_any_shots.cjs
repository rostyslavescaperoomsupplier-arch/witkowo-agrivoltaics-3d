// QA climate any-site: node qa/climate_any_shots.cjs [base] -> qa/out/climate_any_*.png
// Live sites are spaced 65 s apart (Open-Meteo per-minute fair-use limit; the daily request is heavy).
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const BASE = process.argv[2] || 'http://localhost:8770';
const OUT = path.join(__dirname, 'out');
const SITES = (process.env.SITES || '49.30,19.95,Zakopane;54.60,18.80,Hel;54.10,22.93,Suwałki').split(';');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })).newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  page.setDefaultTimeout(200000);
  await page.goto(BASE + '/qa/climate.html');
  await page.waitForFunction(() => window.__climate, null, { timeout: 20000 });
  for (let k = 0; k < SITES.length; k++) {
    if (k) await new Promise((r) => setTimeout(r, 65000));
    const name = SITES[k].split(',')[2];
    const t0 = Date.now();
    const i = await page.evaluate((s) => window.__site(s), SITES[k]);
    const ms = Date.now() - t0;
    for (const [n, s] of [['summer', { winter: 0, hour: 14 }], ['winter', { winter: 1, hour: 6 }]]) {
      const j = await page.evaluate((s) => window.__set(s), s);
      console.log(name, n, JSON.stringify({ t: j.tempOutsideC, sunScale: j.sunScale, day: j.typicalDayKWhm2 }));
    }
    await page.evaluate((s) => window.__set(s), { winter: 0, hour: 14 });
    console.log(name, 'ms', ms, JSON.stringify({ site: i.site, errors: i.errors, trend: i.trendPerDecade, warm: i.warmingVsBaseline, mean: i.annualMean, base: i.baselineMean }));
    await page.screenshot({ path: path.join(OUT, `climate_any_${name.normalize('NFD').replace(/[^\w]/g, '').toLowerCase()}.png`) });
  }
  // back to Witkowo (static, instant) + a cached revisit
  for (const s of ['53.2886,15.0687,Witkowo', SITES[0]]) {
    const t0 = Date.now(); const i = await page.evaluate((s) => window.__site(s), s);
    console.log('revisit', s, Date.now() - t0, 'ms', i.site.status, JSON.stringify(i.site.fetch));
  }
  console.log('LOGS', logs.length ? [...new Set(logs)].join('\n') : 'none');
  await browser.close();
})();
