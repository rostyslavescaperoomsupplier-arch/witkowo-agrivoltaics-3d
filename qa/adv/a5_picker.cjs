const { open, launch, shot, W } = require('./h.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch();
  const which = process.argv[2] || 'all';
  if (which === 'all' || which === 'openclose') {
    const { page, logs, ctx } = await open(b);
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      await page.click('#bLoc');
      await page.waitForSelector('.loc-root', { timeout: 10000 });
      if (i % 3 === 0) await page.waitForTimeout(600); // let leaflet start
      if (i % 2) await page.keyboard.press('Escape'); else await page.click('.loc-x');
      await page.waitForTimeout(i % 4 === 0 ? 0 : 100);
    }
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ roots: document.querySelectorAll('.loc-root').length, overflow: document.body.style.overflow, leafletStyles: document.querySelectorAll('link[href*="leaflet"]').length, locStyles: document.querySelectorAll('style').length, focus: document.activeElement?.id || document.activeElement?.tagName }));
    console.log('20x open/close', (Date.now() - t0) / 1000, 's', JSON.stringify(st));
    // double click opening
    await page.click('#bLoc'); await page.click('#bLoc', { force: true }).catch(() => {}); await page.waitForTimeout(800);
    console.log('double open roots', await page.evaluate(() => document.querySelectorAll('.loc-root').length));
    // keyboard: tab order inside dialog
    const order = [];
    for (let i = 0; i < 18; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const e = document.activeElement; return `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''}[${e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)}]${e.closest('.loc-root') ? '' : ' OUTSIDE'}`; })); }
    console.log('tab order', order.join(' -> '));
    // focus-visible ring check on the map
    await page.focus('.loc-map'); await page.keyboard.press('ArrowRight');
    await shot(page, 'picker_kbd');
    // keyboard move the pin
    const pinFocus = await page.evaluate(() => { const p = document.querySelector('.loc-pin')?.closest('.leaflet-marker-icon'); p?.focus(); return !!p && document.activeElement === p; });
    const s0 = await page.evaluate(() => document.querySelector('.loc-root').__loc?.state);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
    const s1 = await page.evaluate(() => document.querySelector('.loc-root').__loc?.state);
    console.log('pin focus', pinFocus, 'moved', JSON.stringify(s0?.origin), '->', JSON.stringify(s1?.origin));
    // pick: sea, Kaliningrad (RU), Prague (CZ), Lviv (UA), Görlitz (DE): does the OK button accept?
    for (const [n, lat, lon] of [['baltic', 54.8, 18.5], ['kaliningrad', 54.71, 20.51], ['prague', 50.08, 14.42], ['lviv', 49.84, 24.03], ['goerlitz_DE', 51.155, 14.99], ['grodno_BY', 53.68, 23.83], ['sniardwy_lake', 53.75, 21.73]]) {
      await page.evaluate(([lat, lon]) => { const m = document.querySelector('.loc-root').__loc.map; m.setView([lat, lon], 12); m.fire('click', { latlng: { lat, lng: lon } }); }, [lat, lon]);
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => ({ ok: !document.querySelector('.loc-ok').disabled, name: document.querySelector('.loc-name').textContent, lat: document.querySelector('.loc-lat').textContent, lon: document.querySelector('.loc-lon').textContent }));
      console.log('pick', n, JSON.stringify(r));
      if (n === 'kaliningrad' || n === 'baltic') await shot(page, 'picker_' + n);
    }
    // confirm Kaliningrad and inspect the site report
    await page.evaluate(() => { const m = document.querySelector('.loc-root').__loc.map; m.fire('click', { latlng: { lat: 54.71, lng: 20.51 } }); });
    await page.waitForTimeout(2500);
    await page.click('.loc-ok');
    await page.waitForTimeout(40000);
    const w = await W(page);
    console.log('kaliningrad applied', JSON.stringify(w.site), 'terrain', JSON.stringify(w.info.terrain && { el: w.info.terrain.elevationM, slope: w.info.terrain.slopePct, err: w.info.terrain.errors, src: w.info.terrain.source }), 'climate', JSON.stringify(w.info.climate && Object.fromEntries(Object.entries(w.info.climate).filter(([k, v]) => typeof v !== 'object').slice(0, 12))));
    console.log('steps', await page.evaluate(() => document.querySelector('#locNote')?.innerText.replace(/\n/g, ' | ')));
    await page.click('#bReport'); await page.waitForTimeout(2500);
    console.log('report text', (await page.evaluate(() => document.querySelector('#panel').innerText)).replace(/\n+/g, ' | ').slice(0, 2500));
    await shot(page, 'report_kaliningrad');
    // second change within seconds -> throttle notice
    await page.click('#pclose').catch(() => {});
    await page.click('#bLoc'); await page.waitForTimeout(1200);
    console.log('2nd change within 60s: picker open?', await page.evaluate(() => document.querySelectorAll('.loc-root').length), 'notice', await page.evaluate(() => [...document.querySelectorAll('#err, .notice, #locNote')].map((e) => e.innerText).join(' || ').slice(0, 300)));
    await shot(page, 'throttle');
    console.log('logs', logs.length, logs.slice(0, 15).join('\n'));
    await ctx.close();
  }
  if (which === 'all' || which === 'noleaflet') {
    const { page, logs, ctx } = await open(b, '', { before: async (p, c) => { await c.route(/leaflet/i, (r) => r.abort()); } });
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    await page.click('#bLoc'); await page.waitForTimeout(8000);
    console.log('leaflet blocked:', JSON.stringify(await page.evaluate(() => ({ roots: document.querySelectorAll('.loc-root').length, err: document.querySelector('.loc-err')?.textContent, ok: !document.querySelector('.loc-ok')?.disabled }))));
    await shot(page, 'picker_noleaflet');
    // search still works? type a query
    await page.fill('.loc-search input', 'Kraków'); await page.keyboard.press('Enter'); await page.waitForTimeout(4000);
    console.log('search w/o leaflet', await page.evaluate(() => document.querySelector('.loc-res')?.innerText.slice(0, 300)));
    await page.click('.loc-res button[role=option]').catch((e) => console.log('no result to click'));
    await page.waitForTimeout(1000);
    console.log('after pick w/o map', JSON.stringify(await page.evaluate(() => ({ name: document.querySelector('.loc-name')?.textContent, lat: document.querySelector('.loc-lat')?.textContent }))));
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  if (which === 'all' || which === 'search') {
    const { page, logs, ctx } = await open(b);
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    await page.click('#bLoc'); await page.waitForTimeout(2000);
    const reqs = []; page.on('request', (r) => { if (/nominatim|uug|geocod/i.test(r.url())) reqs.push(Date.now()); });
    // type fast, char by char (debounce + 1 req/s)
    await page.type('.loc-search input', 'Szczecin Pomorzany ulica', { delay: 30 });
    await page.waitForTimeout(4000);
    await page.fill('.loc-search input', '<img src=x onerror=window.__xss2=1>'); await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
    await page.fill('.loc-search input', 'zzzzqqqxx'); await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
    console.log('geocoder requests', reqs.length, 'gaps ms', reqs.slice(1).map((t, i) => t - reqs[i]).join(','), 'res', await page.evaluate(() => document.querySelector('.loc-res')?.innerText.slice(0, 200)), 'xss2', await page.evaluate(() => window.__xss2 || 0));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    console.log('roots after Esc Esc', await page.evaluate(() => document.querySelectorAll('.loc-root').length));
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  await b.close();
})();
