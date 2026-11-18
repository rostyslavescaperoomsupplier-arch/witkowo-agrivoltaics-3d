// QA climate: node qa/climate_shots.cjs [base]  -> qa/out/climate_*.png
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const BASE = process.argv[2] || 'http://localhost:8770';
const OUT = path.join(__dirname, 'out');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const logs = [];
  for (const [lang, dpr] of [['pl', 2], ['en', 1]]) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: dpr })).newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
    await page.goto(BASE + '/qa/climate.html?lang=' + lang);
    await page.waitForFunction(() => window.__climate, null, { timeout: 20000 });
    const steps = lang === 'pl'
      ? [['summer_14', { winter: 0, hour: 14 }], ['summer_04', { winter: 0, hour: 4 }], ['mid_12', { winter: 0.5, hour: 12 }], ['winter_14', { winter: 1, hour: 14 }], ['winter_06', { winter: 1, hour: 6 }]]
      : [['summer_14', { winter: 0, hour: 14 }]];
    for (const [n, s] of steps) {
      const i = await page.evaluate((s) => window.__set(s), s);
      console.log(lang, n, JSON.stringify({ t: i.tempOutsideC, p10: i.tempP10, p90: i.tempP90, sunScale: i.sunScale, csi: i.clearSkyIndex, day: i.typicalDayKWhm2, month: i.normalMonth.month }));
      if (n === 'summer_14' || n === 'winter_14') await page.screenshot({ path: path.join(OUT, `climate_${lang}_${n}.png`) });
    }
    if (lang === 'pl') {
      for (const k of ['stripes', 'annual', 'monthly']) {
        await page.locator(`#charts canvas[data-kind=${k}]`).screenshot({ path: path.join(OUT, `climate_chart_${k}.png`) });
      }
    }
    await page.close();
  }
  console.log('LOGS', logs.length ? [...new Set(logs)].join('\n') : 'none');
  await browser.close();
})();
