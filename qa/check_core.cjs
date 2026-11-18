// QA for the core viewer: node qa/check_core.cjs [url]   (needs the server: python3 serve.py 8765)
// Screenshots -> qa/out/core-*.png. Prints console errors/warnings and simple functional checks.
const path = require('path');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const URL = process.argv[2] || 'http://localhost:8765/?q=high';
const OUT = path.join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });
const TAG = process.env.QA_TAG ? process.env.QA_TAG + '-' : ''; // e.g. QA_TAG=winter -> core-winter-*.png
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `core-${TAG}${n}.png`) });

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
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    await fn(page);
    await ctx.close();
  };
  const W = (page) => page.evaluate(() => { const w = window.__witkowo; return { mode: w.mode, hour: +w.state.hour.toFixed(2), sun: +w.state.sun.toFixed(3), water: w.state.water, day: +w.state.dayOfSeason.toFixed(1), mods: Object.keys(w.mods), winter: w.state.winter, walk: [+w.walk.x.toFixed(2), +w.walk.z.toFixed(2)], q: w.QUALITY.low ? 'low' : 'high', gpu: w.QUALITY.gpu }; });

  const joyWalk = async (page, label) => {
    const j = await page.locator('#joy').boundingBox();
    if (!j) { console.log(label, 'joystick not visible'); return; }
    const a = await W(page);
    const cx = j.x + j.width / 2, cy = j.y + j.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy - j.height * 0.45, { steps: 4 });
    await page.waitForTimeout(1500); await page.mouse.up();
    console.log(label, 'joystick walk', JSON.stringify(a.walk), '->', JSON.stringify((await W(page)).walk));
  };
  await run('desktop', { width: 1440, height: 900 }, async (page) => {
    console.log('start', JSON.stringify(await W(page)));
    console.log('season', await page.evaluate(() => { const w = window.__witkowo; return JSON.stringify({ season: w.state.season, winter: w.state.winter, hudWinter: document.querySelector('#hud').classList.contains('winter'), film: !!document.querySelector('#objects li[data-id="film"]'), filmOff: !!document.querySelector('#objects li[data-id="film"].off'), lang: document.documentElement.lang, title: document.title, cyr: /[\u0400-\u04FF]/.test(document.body.innerText) }); }));
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
    // flows: x-ray + presets + legend
    await page.click('label:has(#tFlows) .sw'); await page.waitForTimeout(400);
    await page.click('.fly[data-fly="water"]'); await page.waitForTimeout(1500);
    await shot(page, 'flows-water');
    await page.click('.fly[data-fly="power"]'); await page.waitForTimeout(1500);
    await shot(page, 'flows-power');
    console.log('flows', await page.evaluate(() => JSON.stringify({ xray: document.querySelector('#tFlows').checked, legend: getComputedStyle(document.querySelector('#hud .legend')).display })));
    await page.click('label:has(#tFlows) .sw'); await page.waitForTimeout(300);
    // ---- new controls: location, map, report, climate, underground, rain, rays
    console.log('controls', await page.evaluate(() => JSON.stringify(Object.fromEntries(['#bLoc', '#selYear', '#selLayer', '#rOpacity', '#bMapView', '#tGround', '#bReport', '#bClimate', '#tUnder', '#rainMode', '#tClimate', '#tRays']
      .map((s) => { const el = document.querySelector(s); return [s, !!el && el.offsetParent !== null && !el.disabled]; })))));
    await page.click('#bLoc'); await page.waitForTimeout(4000);
    await shot(page, 'picker');
    console.log('picker open', await page.evaluate(() => !!document.querySelector('[class*="loc-"]')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    console.log('picker closed', await page.evaluate(() => !document.querySelector('.loc-modal, .loc-backdrop, .loc-root')));
    console.log('loc', await page.evaluate(() => document.querySelector('#locName').textContent + ' | ' + document.querySelector('#locCoord').textContent));
    await page.selectOption('#selLayer', 'geology'); await page.waitForTimeout(400);
    await page.click('#bMapView'); await page.waitForTimeout(6000);
    await shot(page, 'mapview');
    console.log('mapview', await page.evaluate(() => { const w = window.__witkowo; return JSON.stringify({ dist: Math.round(w.persp.position.distanceTo(w.orbitP.target)), far: w.persp.far, maxD: w.orbitP.maxDistance, fog: [Math.round(w.ctx.scene.fog?.near), Math.round(w.ctx.scene.fog?.far)], geo: { layer: w.info.geo?.layer, year: w.info.geo?.year, err: w.info.geo?.error } }); }));
    await page.selectOption('#selLayer', 'none'); await page.click('#bMapView'); await page.waitForTimeout(1600);
    await page.click('#bReport'); await page.waitForTimeout(9000);
    await shot(page, 'report');
    console.log('report', await page.evaluate(() => { const r = window.__witkowo.info.sitedata; return JSON.stringify({ status: r?.status, errors: r?.errors?.length, light: !!document.querySelector('#panel .light'), rows: document.querySelectorAll('#panel .rep tr').length }); }));
    await page.click('#bClimate'); await page.waitForTimeout(1500);
    await shot(page, 'climate');
    console.log('climate charts', await page.evaluate(() => document.querySelectorAll('#panel canvas').length));
    await page.click('#pclose');
    await page.click('label:has(#tUnder) .sw'); await page.waitForTimeout(2500);
    await shot(page, 'underground');
    console.log('underground', await page.evaluate(() => { const w = window.__witkowo; return JSON.stringify({ on: w.state.show.underground, maxPolar: +w.orbitP.maxPolarAngle.toFixed(2), maxD: w.orbitP.maxDistance, views: document.querySelectorAll('#underViews button').length }); }));
    await page.click('#underScale button[data-scale="true"]'); await page.click('#underViews button[data-view="column"]'); await page.waitForTimeout(1800);
    await shot(page, 'underground-column');
    await page.click('label:has(#tUnder) .sw'); await page.waitForTimeout(300);
    await page.click('#rainMode button[data-rain="on"]'); await page.evaluate(() => { const r = document.querySelector('#rRain'); r.value = 0.8; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('label:has(#tClimate) .sw'); await page.click('#bPlay'); await page.waitForTimeout(3000);
    await page.evaluate(() => window.__witkowo.setMode('iso'));
    const homeBtn = await page.$('#objects li[data-id="tanks"]'); if (homeBtn) await homeBtn.click(); await page.waitForTimeout(1500);
    await shot(page, 'rain-tanks');
    console.log('rain', await page.evaluate(() => { const w = window.__witkowo; return JSON.stringify({ rain: +w.state.rain.toFixed(2), rainInfo: w.info.rain && { mmh: +w.info.rain.rainMmH.toFixed(2), level: +w.info.rain.tankLevel.toFixed(3), in: +w.info.rain.inflowLpm.toFixed(1) }, realClimate: w.state.realClimate, tOut: w.state.tempOutsideC, hudOut: document.querySelector('#hOut')?.textContent }); }));
    await page.click('#pclose'); await page.click('#rainMode button[data-rain="auto"]'); await page.click('label:has(#tClimate) .sw'); await page.click('#bPlay');
    await page.click('label:has(#tRays) .sw'); console.log('rays', await page.evaluate(() => window.__witkowo.state.show.rays)); await page.click('label:has(#tRays) .sw');
    // plan view really switches camera and framing
    await page.click('#modes button[data-mode="top"]'); await page.waitForTimeout(900);
    console.log('plan', await page.evaluate(() => { const w = window.__witkowo; return JSON.stringify({ mode: w.mode, ortho: w.cam.isOrthographicCamera, y: w.ortho.position.y, zoom: w.ortho.zoom }); }));
    await page.click('#modes button[data-mode="iso"]'); await page.waitForTimeout(400);
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
    if ((await page.evaluate(() => window.__witkowo.state.season)) === 'winter') {
      const film = await page.$('#objects li[data-id="film"]:not(.off)');
      if (film) { await film.click(); await page.waitForTimeout(1200); await shot(page, 'film-select'); await page.click('#pclose'); }
      console.log('winter info', JSON.stringify(await page.evaluate(() => window.__witkowo.info.winter)));
    }
    // night + language EN
    await page.click('#modes button[data-mode="iso"]');
    await page.evaluate(() => { const r = document.querySelector('#rClock'); r.value = 23; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#side header .langs button[data-lang="en"]');
    await page.waitForTimeout(1200);
    await shot(page, 'night-en');
    console.log('title', await page.title(), '| lang stored', await page.evaluate(() => localStorage.getItem('witkowo3d:lang')));
    await page.click('#side header .langs button[data-lang="pl"]');
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
    await joyWalk(page, 'portrait');
    await shot(page, 'mobile-walk');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log('mobile horizontal overflow:', ov);
    await page.click('#modes button[data-mode="top"]'); await page.waitForTimeout(800);
    await shot(page, 'mobile-plan');
  }, { hasTouch: true, isMobile: true });

  await run('landscape', { width: 844, height: 390 }, async (page) => {
    await shot(page, 'mobile-landscape');
    const r = await page.evaluate(() => Object.fromEntries(['#side', '#hud', '#hint'].map((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [s, [b.x, b.y, b.width, b.height].map(Math.round)]; })));
    console.log('landscape rects', JSON.stringify(r));
    await page.click('#menuBtn'); await page.waitForTimeout(500);
    await shot(page, 'mobile-landscape-drawer');
    await page.click('#objects li[data-id="tanks"]'); await page.waitForTimeout(1200);
    await shot(page, 'mobile-landscape-panel');
    await page.click('#pclose'); await page.waitForTimeout(300);
    await page.click('#modes button[data-mode="walk"]'); await page.waitForTimeout(600);
    await page.evaluate(() => document.body.classList.add('touch'));
    await joyWalk(page, 'landscape');
    await shot(page, 'mobile-landscape-walk');
  }, { hasTouch: true, isMobile: true });

  console.log('--- console errors/warnings ---\n' + (logs.join('\n') || '(none)'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
