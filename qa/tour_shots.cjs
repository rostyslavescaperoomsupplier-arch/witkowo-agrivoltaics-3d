// QA for lib/tour.js: node qa/tour_shots.cjs [url]  -> qa/out/tour_*.png
// Imports the module into the live page when main.js has not wired it yet (window.__tour).
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const URL = process.argv[2] || 'http://localhost:8770/';
const OUT = path.join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY || '';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const logs = [];
  const open = async (name, viewport, url = URL) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /tour/.test(m.text()))) logs.push(`[${name}] ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[${name}] pageerror: ${e.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    const hooks = await page.evaluate(() => ['applyScene', 'getScene', 'flyHome', 'captureFrame', 'tour'].filter((k) => k in window.__witkowo));
    console.log(name, 'CORE hooks present:', hooks.join(',') || 'none');
    await page.evaluate(async () => {
      if (window.__tour) return;
      const m = await import('/lib/tour.js?t=' + Date.now());
      window.__tourMod = m; window.__tour = m.initTour(window.__witkowo);
    });
    return { ctx, page };
  };
  const shot = (page, n) => page.screenshot({ path: path.join(OUT, `tour_${n}.png`) });

  // desktop
  {
    const { ctx, page } = await open('desktop', { width: 1440, height: 900 });
    const opened = await page.evaluate(() => window.__tour.showIntro());
    console.log('intro first visit opened:', opened);
    await page.waitForTimeout(500); await shot(page, 'intro_desktop');
    // Esc closes + remembers
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    console.log('after Esc: overlay=', await page.evaluate(() => !!document.querySelector('.tour-overlay')), 'second showIntro():', await page.evaluate(() => window.__tour.showIntro()));
    // focus trap check
    await page.evaluate(() => window.__tour.showIntro(true)); await page.waitForTimeout(300);
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    console.log('focus inside dialog after 12 Tabs:', await page.evaluate(() => !!document.activeElement.closest('.tour-card')));
    await page.evaluate(() => { document.documentElement.lang = 'en'; }); await page.waitForTimeout(200);
    await shot(page, 'intro_desktop_en');
    await page.evaluate(() => { document.documentElement.lang = 'pl'; });
    await page.keyboard.press('Escape');

    if (!ONLY || ONLY === 'presets') for (const p of await page.evaluate(() => window.__tour.presets.map((x) => x.id))) {
      await page.evaluate((id) => window.__tour.applyPreset(id), p);
      await page.waitForTimeout(p === 'under' || p === 'map' ? 4500 : 3000);
      await shot(page, 'preset_' + p);
    }
    // tour
    await page.evaluate(() => window.__tour.startTour()); await page.waitForTimeout(2600); await shot(page, 'tour_step1');
    for (let i = 2; i <= 8; i++) {
      await page.click('.tour-cap [data-act="next"]'); await page.waitForTimeout(i >= 7 ? 4000 : 2800); await shot(page, 'tour_step' + i);
    }
    await page.click('.tour-cap [data-act="exit"]'); await page.waitForTimeout(1500);
    // share link round trip
    await page.evaluate(() => window.__tour.applyPreset('dawn')); await page.waitForTimeout(1500);
    const url = await page.evaluate(() => window.__tour.shareLink());
    console.log('share url:', url);
    console.log('parsed:', JSON.stringify(await page.evaluate((u) => window.__tourMod.parseSceneFromUrl(new URL(u).search), url)));
    // png
    const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    const name = await page.evaluate(() => window.__tour.savePng());
    const d = await dl;
    if (d) { const p = path.join(OUT, 'tour_savepng.png'); await d.saveAs(p); console.log('savePng ->', name, require('fs').statSync(p).size, 'bytes'); } else console.log('savePng: no download', name);
    await ctx.close();
    // open the shared url fresh, apply parsed scene
    const s2 = await open('shared', { width: 1440, height: 900 }, url);
    await s2.page.evaluate(() => { const sc = window.__tourMod.parseSceneFromUrl(); window.__tour.applyScene(sc); });
    await s2.page.waitForTimeout(2500); await shot(s2.page, 'shared_url');
    await s2.ctx.close();
  }
  // phone
  {
    const { ctx, page } = await open('phone', { width: 390, height: 844 });
    await page.evaluate(() => window.__tour.showIntro(true)); await page.waitForTimeout(500); await shot(page, 'intro_390');
    await page.click('.tour-card [data-act="tour"]'); await page.waitForTimeout(2600); await shot(page, 'tour_390_step1');
    await page.click('.tour-cap [data-act="next"]'); await page.click('.tour-cap [data-act="next"]'); await page.waitForTimeout(2600); await shot(page, 'tour_390_step3');
    await ctx.close();
  }
  console.log(logs.length ? logs.join('\n') : 'no console errors');
  await browser.close();
})();
