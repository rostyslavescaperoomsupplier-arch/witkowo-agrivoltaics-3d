const { open, launch, shot, W } = require('./h.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const camOk = (page) => page.evaluate(() => { const w = window.__witkowo, c = w.cam; const v = [c.position.x, c.position.y, c.position.z, w.orbitP.target.x, w.orbitP.target.y, w.orbitP.target.z]; return { finite: v.every(Number.isFinite), pos: v.map((x) => +x.toFixed(2)), mode: w.mode, fov: c.fov }; });
const fps = (page, ms = 2000) => page.evaluate((ms) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(+(n * 1000 / (performance.now() - t0)).toFixed(1)); }; requestAnimationFrame(f); }), ms);
(async () => {
  const b = await launch();
  const which = process.argv[2] || 'all';
  // 1) 200 random layer toggles
  if (which === 'all' || which === 'toggles') {
    const { page, logs, ctx } = await open(b);
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    console.log('fps before', await fps(page));
    const ids = ['tPower', 'tWater', 'tFlows', 'tLabels', 'tShadow', 'tRays', 'tGround', 'tUnder', 'tClimate'];
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 200; i++) {
      const id = ids[Math.floor(rnd() * ids.length)];
      const vis = await page.locator(`#${id}`).evaluate((el) => !!el.closest('label')?.offsetParent);
      if (!vis) continue;
      await page.locator(`label:has(#${id}) .sw`).click({ timeout: 2000 }).catch((e) => console.log('click fail', id, e.message.slice(0, 80)));
      if (rnd() < 0.15) await page.locator('#modes button').nth(Math.floor(rnd() * 3)).click();
      if (rnd() < 0.1) await page.locator('#seasons button').nth(Math.floor(rnd() * 2)).click();
      if (rnd() < 0.1) await page.locator('#rainMode button').nth(Math.floor(rnd() * 3)).click();
      if (rnd() < 0.05) await page.locator('#bMapView').click().catch(() => {});
    }
    await page.waitForTimeout(3000);
    const st = await page.evaluate(() => { const w = window.__witkowo; const ids = ['tPower', 'tWater', 'tFlows', 'tLabels', 'tShadow', 'tRays', 'tGround', 'tUnder', 'tClimate']; return { checks: Object.fromEntries(ids.map((i) => [i, document.getElementById(i).checked])), show: w.state.show, realClimate: w.state.realClimate, mode: w.mode, season: w.state.season, winter: w.state.winter, powerGroupVis: w.mods.power?.group?.visible, waterGroupVis: w.mods.water?.group?.visible }; });
    console.log('after 200 toggles', JSON.stringify(st));
    console.log('cam', JSON.stringify(await camOk(page)));
    console.log('fps after', await fps(page));
    await shot(page, 'toggles200');
    // turn everything off: expect plain view; then x-ray off
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  // 2) everything at once: x-ray + underground + map view + winter + rain on
  if (which === 'all' || which === 'combo') {
    const { page, logs, ctx } = await open(b);
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    await page.locator('#seasons button[data-season="winter"]').click();
    await page.locator('#rainMode button[data-rain="on"]').click();
    await page.locator('label:has(#tFlows) .sw').click();
    await page.locator('label:has(#tUnder) .sw').click();
    await page.locator('#bMapView').click();
    await page.waitForTimeout(6000);
    console.log('combo', JSON.stringify((await W(page)).info.winter), JSON.stringify(await camOk(page)));
    await shot(page, 'combo_all');
    await page.locator('#bMapView').click(); await page.waitForTimeout(2500);
    await shot(page, 'combo_all_mapback');
    await page.locator('#modes button[data-mode="walk"]').click(); await page.waitForTimeout(2000);
    await shot(page, 'combo_all_walk');
    await page.locator('#modes button[data-mode="top"]').click(); await page.waitForTimeout(2000);
    await shot(page, 'combo_all_top');
    // undo everything and compare to a fresh view
    await page.locator('label:has(#tFlows) .sw').click();
    await page.locator('label:has(#tUnder) .sw').click();
    await page.locator('#seasons button[data-season="summer"]').click();
    await page.locator('#rainMode button[data-rain="off"]').click();
    await page.locator('#modes button[data-mode="iso"]').click();
    await page.waitForTimeout(6000);
    await shot(page, 'combo_undone');
    console.log('combo undone', JSON.stringify(await camOk(page)), JSON.stringify((await W(page)).info.winter));
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  // 3) season spam mid-transition
  if (which === 'all' || which === 'season') {
    const { page, logs, ctx } = await open(b);
    for (let i = 0; i < 30; i++) { await page.locator(`#seasons button[data-season="${i % 2 ? 'summer' : 'winter'}"]`).click(); await page.waitForTimeout(80 + (i % 5) * 150); }
    // ends on summer (i=29 odd)
    const mid = await W(page); console.log('season spam end', mid.season, mid.winter, JSON.stringify(mid.info.winter));
    await page.waitForTimeout(6000);
    const end = await W(page); console.log('after settle', end.season, end.winter, JSON.stringify(end.info.winter));
    const film = await page.evaluate(() => ({ filmLi: document.querySelector('#objects li[data-id="film"]')?.className, hudWinter: document.querySelector('#hud').className }));
    console.log(JSON.stringify(film));
    await shot(page, 'season_spam');
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  // 4) mode spam + select during flyTo
  if (which === 'all' || which === 'modes') {
    const { page, logs, ctx } = await open(b);
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    for (let i = 0; i < 60; i++) await page.locator('#modes button').nth(i % 3).click({ delay: 0 });
    console.log('after mode spam', JSON.stringify(await camOk(page)));
    await page.locator('#modes button[data-mode="iso"]').click();
    const items = await page.$$eval('#objects li.item:not(.off)', (els) => els.map((e) => e.dataset.id));
    console.log('items', items.join(','));
    for (let r = 0; r < 3; r++) for (const id of items) { await page.click(`#objects li[data-id="${id}"]`); await page.waitForTimeout(60); }
    await page.waitForTimeout(1500);
    console.log('after select spam', JSON.stringify(await camOk(page)));
    await shot(page, 'select_spam');
    // select in top and walk modes
    for (const m of ['top', 'walk']) {
      await page.locator(`#modes button[data-mode="${m}"]`).click();
      for (const id of items) { await page.click(`#objects li[data-id="${id}"]`).catch(() => {}); await page.waitForTimeout(100); }
      await page.waitForTimeout(1500);
      console.log('select spam in', m, JSON.stringify(await camOk(page)), JSON.stringify(await page.evaluate(() => [window.__witkowo.walk.x, window.__witkowo.walk.z])));
      await shot(page, 'select_spam_' + m);
    }
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  // 5) language switch during loading
  if (which === 'all' || which === 'lang') {
    const { page, logs, ctx } = await open(b, '', { noWait: true });
    for (let i = 0; i < 40; i++) { await page.evaluate((i) => { const bs = document.querySelectorAll('.langs button[data-lang]'); const t = [...bs].find((x) => x.dataset.lang === (i % 2 ? 'pl' : 'en') && x.offsetParent); t?.click(); }, i).catch(() => {}); await sleep(100); }
    await page.evaluate(() => [...document.querySelectorAll('.langs button[data-lang="en"]')].find((x) => x.offsetParent)?.click());
    await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 90000 });
    await page.evaluate(() => [...document.querySelectorAll('.langs button[data-lang="en"]')].find((x) => x.offsetParent)?.click());
    await page.waitForTimeout(8000);
    const txt = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, body: document.body.innerText }));
    const plWords = (txt.body.match(/[^\n]*(?:ą|ę|ś|ć|ź|ż|ł|ó|ń|Przegląd|Warstwy|Pora|Wł\.|Wył\.)[^\n]*/g) || []).filter((l) => !/Witkowo|Gmina|Pomorsk|Szczeci|Zachodnio|Łobez|Resko/i.test(l));
    console.log('lang', txt.lang, txt.title, 'PL-looking lines in EN:', plWords.slice(0, 30));
    await shot(page, 'lang_during_boot');
    // switch to PL and check for english leftovers
    await page.evaluate(() => [...document.querySelectorAll('.langs button[data-lang="pl"]')].find((x) => x.offsetParent)?.click());
    await page.waitForTimeout(1000);
    const body2 = await page.evaluate(() => document.body.innerText);
    console.log('EN-looking lines in PL:', (body2.match(/[^\n]*\b(?:the|Power|Water|Layers|Season|Rain|loading|Inside|Outside|Tank)\b[^\n]*/g) || []).slice(0, 20));
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  // 6) resize / rotate
  if (which === 'all' || which === 'resize') {
    const { page, logs, ctx } = await open(b, '', {}, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    for (let i = 0; i < 20; i++) { await page.setViewportSize(i % 2 ? { width: 390, height: 844 } : { width: 844, height: 390 }); await page.waitForTimeout(150); }
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1500);
    const lay = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), getComputedStyle(e).display]; }; return { side: r('#side'), hud: r('#hud'), menu: r('#menuBtn'), canvas: r('canvas'), cw: document.querySelector('canvas').width, ch: document.querySelector('canvas').height, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
    console.log('landscape', JSON.stringify(lay)); await shot(page, 'rotate_land');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1500);
    await shot(page, 'rotate_port');
    await page.locator('#menuBtn').click(); await page.waitForTimeout(800); await shot(page, 'rotate_port_menu');
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1500); await shot(page, 'rotate_land_menu');
    const lay2 = await page.evaluate(() => ({ drawerOpen: document.querySelector('#drawer').classList.contains('open'), bodyCls: document.body.className, sw: document.documentElement.scrollWidth }));
    console.log('land after menu', JSON.stringify(lay2));
    // desktop rapid resize
    for (let i = 0; i < 30; i++) { await page.setViewportSize({ width: 300 + (i * 97) % 1700, height: 250 + (i * 53) % 900 }); await page.waitForTimeout(40); }
    await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(1500);
    console.log('after resize storm', JSON.stringify(await camOk(page)), await page.evaluate(() => [document.querySelector('canvas').width, document.querySelector('canvas').height, innerWidth, innerHeight]));
    await shot(page, 'resize_storm');
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  await b.close();
})();
