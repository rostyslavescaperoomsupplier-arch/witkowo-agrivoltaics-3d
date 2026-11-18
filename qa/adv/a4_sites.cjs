const { open, launch, shot, W } = require('./h.cjs');
const SITES = [
  { lat: 52.2297, lon: 21.0122, rotDeg: 0, name: 'Warszawa', source: 'qa' },
  { lat: 49.18, lon: 20.09, rotDeg: 45, name: 'Rysy', source: 'qa' },
  { lat: 54.8, lon: 18.5, rotDeg: 90, name: 'Baltyk', source: 'qa' },
  { lat: 53.73, lon: 21.6, rotDeg: 10, name: 'Sniardwy', source: 'qa' },
  { lat: 51.25, lon: 22.57, rotDeg: 200, name: 'Lublin', source: 'qa' },
];
const meminfo = async (page, cdp) => { await cdp.send('HeapProfiler.collectGarbage'); return page.evaluate(() => { const r = window.__witkowo.ctx.renderer.info; let meshes = 0, objs = 0; window.__witkowo.ctx.scene.traverse((o) => { objs++; if (o.isMesh) meshes++; }); return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), geo: r.memory.geometries, tex: r.memory.textures, prog: r.programs?.length, objs, meshes, calls: r.render.calls }; }); };
const steps = (page) => page.evaluate(() => document.querySelector('#locNote')?.innerText.replace(/\n/g, ' | '));
(async () => {
  const b = await launch();
  const which = process.argv[2] || 'all';
  if (which === 'all' || which === 'leak') {
    const { page, logs, ctx } = await open(b);
    const cdp = await ctx.newCDPSession(page); await cdp.send('HeapProfiler.enable');
    await page.waitForTimeout(8000);
    console.log('base', JSON.stringify(await meminfo(page, cdp)));
    for (const s of [...SITES, { lat: 53.2886348, lon: 15.068703, rotDeg: 313, name: 'Witkowo', source: 'default' }]) {
      const t0 = Date.now();
      await page.evaluate((s) => window.__witkowo.applySite(s), s);
      await page.waitForTimeout(2500);
      const w = await W(page);
      console.log(s.name, 'ms', Date.now() - t0, JSON.stringify(await meminfo(page, cdp)), 'terrain', JSON.stringify({ el: w.info.terrain?.elevationM, slope: w.info.terrain?.slopePct, relief: w.info.terrain?.reliefM, cut: w.info.terrain?.cutM3, fill: w.info.terrain?.fillM3, err: w.info.terrain?.errors }), 'steps', await steps(page));
      await shot(page, 'site_' + s.name);
    }
    // second loop to separate warm-up from leak
    for (const s of [...SITES, { lat: 53.2886348, lon: 15.068703, rotDeg: 313, name: 'Witkowo', source: 'default' }]) { await page.evaluate((s) => window.__witkowo.applySite(s), s); await page.waitForTimeout(1500); }
    console.log('after 2nd loop', JSON.stringify(await meminfo(page, cdp)));
    console.log('logs', logs.length, logs.slice(0, 20).join('\n'));
    await ctx.close();
  }
  if (which === 'all' || which === 'twice') {
    // two site changes within a second (race): last one should win everywhere
    const { page, logs, ctx } = await open(b);
    await page.evaluate((s) => { window.__witkowo.applySite(s[0]); setTimeout(() => window.__witkowo.applySite(s[1]), 400); }, [SITES[0], SITES[1]]);
    await page.waitForTimeout(45000);
    const w = await W(page);
    const per = await page.evaluate(() => { const i = window.__witkowo.info; const g = (o) => o && (o.site ? [o.site.lat, o.site.lon] : [o.lat, o.lon]); return { state: [window.__witkowo.state.site.lat, window.__witkowo.state.site.lon], terrain: g(i.terrain), geo: g(i.geo), sky: [i.sky?.lat, i.sky?.lon], climate: i.climate && [i.climate.lat ?? i.climate.site?.lat, i.climate.lon ?? i.climate.site?.lon], sitedata: i.sitedata && [i.sitedata.site?.lat ?? i.sitedata.lat, i.sitedata.site?.lon ?? i.sitedata.lon], under: i.underground && [i.underground.site?.lat, i.underground.site?.lon], locName: document.querySelector('#locName').textContent, elev: i.terrain?.elevationM }; });
    console.log('race result', JSON.stringify(per), 'steps', await steps(page));
    await shot(page, 'site_race');
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  if (which === 'all' || which === 'offline') {
    const { page, logs, ctx } = await open(b);
    await page.evaluate((s) => { window.__p = window.__witkowo.applySite(s); }, SITES[4]);
    await page.waitForTimeout(400);
    await ctx.setOffline(true);
    const t0 = Date.now();
    const done = await page.evaluate(() => Promise.race([window.__p.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('timeout 90s'), 90000))]));
    console.log('offline applySite ->', done, (Date.now() - t0) / 1000, 's; steps:', await steps(page));
    const w = await W(page); console.log('terrain', JSON.stringify(w.info.terrain && { el: w.info.terrain.elevationM, err: w.info.terrain.errors, src: w.info.terrain.source }), 'geo err', JSON.stringify(w.info.geo?.errors || w.info.geo?.error));
    await shot(page, 'site_offline');
    await page.evaluate(() => document.querySelector('#bReport').click()); await page.waitForTimeout(1500); await shot(page, 'site_offline_report');
    await ctx.setOffline(false);
    await page.evaluate((s) => window.__witkowo.applySite(s), SITES[0]).catch((e) => console.log('online again err', e.message));
    await page.waitForTimeout(3000);
    console.log('back online steps:', await steps(page));
    await shot(page, 'site_online_again');
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  await b.close();
})();
