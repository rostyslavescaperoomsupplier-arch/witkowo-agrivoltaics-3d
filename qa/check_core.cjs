// QA for the core viewer: node qa/check_core.cjs [url]   (needs the server: python3 serve.py 8765)
// Screenshots -> qa/out/core-*.png. Prints console errors/warnings and simple functional checks.
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const URL = process.argv[2] || 'http://localhost:8765/?q=high';
const OUT = path.join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `core-${n}.png`) });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const logs = [];
  const run = async (name, viewport, fn, extra = {}) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${name}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[${name}] pageerror: ${e.message}`));
    await page.goto(URL);
    await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    await fn(page);
    await ctx.close();
  };
  const W = (page) => page.evaluate(() => { const w = window.__witkowo; return { mode: w.mode, hour: +w.state.hour.toFixed(2), sun: +w.state.sun.toFixed(3), water: w.state.water, day: +w.state.dayOfSeason.toFixed(1), mods: Object.keys(w.mods), info: w.info, walk: [+w.walk.x.toFixed(2), +w.walk.z.toFixed(2)], q: w.QUALITY.low ? 'low' : 'high', gpu: w.QUALITY.gpu }; });

  await run('desktop', { width: 1440, height: 900 }, async (page) => {
    console.log('start', JSON.stringify(await W(page)));
    await shot(page, 'iso');
    // clock slider -> noon, pause
    await page.click('#bPlay');
    await page.evaluate(() => { const r = document.querySelector('#rClock'); r.value = 13; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.evaluate(() => { const r = document.querySelector('#rGrowth'); r.value = 90; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#irr button[data-irr="on"]');
    await page.waitForTimeout(1200);
    console.log('noon/on', JSON.stringify(await W(page)));
    await shot(page, 'iso-noon');
    // select via list
    await page.click('#objects li[data-id="inverters"]');
    await page.waitForTimeout(1200);
    await shot(page, 'select-inverters');
    // GPU pick at canvas centre after flying to PV
    await page.click('#objects li[data-id="pv"]'); await page.waitForTimeout(1200);
    const picked = await page.evaluate(() => window.__witkowo.pickAt(innerWidth / 2 + 120, innerHeight / 2)?.id || null);
    console.log('pick near centre after PV fly:', picked);
    await page.click('#pclose');
    // plan
    await page.click('#modes button[data-mode="top"]'); await page.waitForTimeout(900);
    await shot(page, 'plan');
    // walk: forward 2 s
    await page.click('#modes button[data-mode="walk"]'); await page.waitForTimeout(400);
    const w0 = await W(page);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2000); await page.keyboard.up('KeyW');
    const w1 = await W(page);
    console.log('walk', JSON.stringify(w0.walk), '->', JSON.stringify(w1.walk));
    await shot(page, 'walk');
    // walk into a column/ballast: from (-7,-2) heading -x toward canopy 1 column at x=-7?  just push for 3 s
    await page.evaluate(() => { const w = window.__witkowo.walk; w.x = -5.5; w.z = -6; w.yaw = Math.PI / 2; w.pitch = 0; });
    await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW');
    console.log('collision test (walk -x from -5.5,-6; column x=-10):', JSON.stringify((await W(page)).walk));
    await shot(page, 'walk-collide');
    // night + language EN
    await page.click('#modes button[data-mode="iso"]');
    await page.evaluate(() => { const r = document.querySelector('#rClock'); r.value = 23; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#side header .langs button[data-lang="en"]');
    await page.waitForTimeout(1200);
    await shot(page, 'night-en');
    console.log('title', await page.title(), '| lang stored', await page.evaluate(() => localStorage.getItem('witkowo3d:lang')));
    await page.click('#side header .langs button[data-lang="ru"]');
  });

  await run('mobile', { width: 390, height: 844 }, async (page) => {
    console.log('mobile', JSON.stringify(await W(page)));
    await shot(page, 'mobile');
    await page.click('#menuBtn'); await page.waitForTimeout(500);
    await shot(page, 'mobile-drawer');
    await page.click('#objects li[data-id="farmdroid"]'); await page.waitForTimeout(1200);
    await shot(page, 'mobile-panel');
    await page.click('#pclose'); await page.waitForTimeout(400);
    await page.click('#modes button[data-mode="walk"]'); await page.waitForTimeout(800);
    await shot(page, 'mobile-walk');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log('mobile horizontal overflow:', ov);
  }, { hasTouch: true, isMobile: true });

  console.log('--- console errors/warnings ---\n' + (logs.join('\n') || '(none)'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
