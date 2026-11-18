// QA winter: node qa/winter_shots.cjs [base]  -> qa/out/winter_*.png
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const BASE = process.argv[2] || 'http://localhost:8772';
const OUT = path.join(__dirname, 'out');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(BASE + '/qa/winter.html');
  await page.waitForFunction(() => window.__winter, null, { timeout: 60000 });
  const shots = [
    ['overview_030', 'over', { winter: 0.3 }], ['overview_060', 'over', { winter: 0.6 }], ['overview_100', 'over', { winter: 1 }],
    ['inside', 'inside', { winter: 1 }], ['door', 'door', { winter: 1 }], ['roof', 'roof', { winter: 1 }],
    ['back', 'back', { winter: 1 }], ['overview_000', 'over', { winter: 0 }], ['night', 'over', { winter: 1, hour: 2, sun: 0 }],
  ];
  for (const [n, v, s] of shots) {
    await page.evaluate(([v, s]) => { window.__view(v); window.__set(Object.assign({ hour: 12, sun: 0.35 }, s)); }, [v, s]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `winter_${n}.png`) });
    console.log(n, await page.evaluate(() => JSON.stringify(window.__winter.info())));
  }
  console.log('LOGS', logs.length ? [...new Set(logs)].slice(0, 15).join('\n') : 'none');
  await browser.close();
})();
