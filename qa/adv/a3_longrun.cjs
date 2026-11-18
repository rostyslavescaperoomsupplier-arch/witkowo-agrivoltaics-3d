// long run at 600x (UI speed), all layers on, auto-season on: sample sim numbers in-page every 100 ms,
// heap + renderer.info every 30 s.  node a3_longrun.cjs <minutes>
const { open, launch, shot } = require('./h.cjs');
const MIN = +(process.argv[2] || 25);
(async () => {
  const b = await launch();
  const { page, logs, ctx } = await open(b);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
  for (const id of ['tLabels', 'tShadow']) { if (!(await page.locator('#' + id).isChecked())) await page.locator(`label:has(#${id}) .sw`).click(); }
  await page.locator('label:has(#tSeason) .sw').click(); // auto-season
  await page.locator('#speeds button[data-s="600"]').click();
  await page.evaluate(() => {
    const w = window.__witkowo; const S = (window.__samples = []); const issues = (window.__issues = []);
    let prev = null; const STG = { seedling: 0, vegetative: 1, heading: 2, harvest: 3 };
    setInterval(() => {
      const s = w.state, i = w.info, p = i.power || {}, wa = i.water || {}, r = i.rain || {}, wi = i.winter || {}, g = i.growth || {};
      const row = { t: performance.now(), day: w.sim.simDay, h: s.hour, kwh: p.kWhToday, kw: p.kW, L: wa.litresToday, lpm: wa.lpm, tank: r.tankLevel, tankL: r.tankLitres, rain: r.rainMmH, rainDay: r.rainTodayMm, out: wi.outsideC, ins: wi.insideC, dos: s.dayOfSeason, stage: g.stage, head: g.headDiameterCm, hudKWh: document.querySelector('#hKWh')?.textContent, hudTank: document.querySelector('#hTank')?.textContent };
      for (const [k, v] of Object.entries(row)) if (typeof v === 'number' && !Number.isFinite(v)) issues.push(['nonfinite', k, row]);
      if (row.L < 0 || row.kwh < 0 || row.tank < 0 || row.tank > 1 || row.tankL < 0) issues.push(['range', row]);
      if (row.out < -40 || row.out > 45 || row.ins < -40 || row.ins > 60) issues.push(['temp', row]);
      if (/NaN|undefined|Infinity/.test((row.hudKWh || '') + (row.hudTank || '') + document.querySelector('#hud')?.textContent)) issues.push(['hudtext', document.querySelector('#hud')?.textContent]);
      if (prev) {
        if (row.day > prev.day) issues.push(['midnight', { kwhBefore: prev.kwh, kwhAfter: row.kwh, Lbefore: prev.L, Lafter: row.L, rainBefore: prev.rainDay, rainAfter: row.rainDay, h: row.h }]);
        if (row.day === prev.day && row.kwh < prev.kwh - 1e-6) issues.push(['kwh-decrease', prev.kwh, row.kwh, row.h]);
        if (row.dos >= prev.dos && STG[row.stage] < STG[prev.stage]) issues.push(['stage-regress', prev.stage, row.stage, prev.dos, row.dos]);
      }
      if (S.length % 10 === 0) S.push(row);
      prev = row;
    }, 100);
  });
  const t0 = Date.now(); const mem = [];
  while (Date.now() - t0 < MIN * 60000) {
    await page.waitForTimeout(30000);
    const m = await page.evaluate(() => ({ heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), geo: window.__witkowo.ctx.renderer.info.memory.geometries, tex: window.__witkowo.ctx.renderer.info.memory.textures, prog: window.__witkowo.ctx.renderer.info.programs?.length, calls: window.__witkowo.ctx.renderer.info.render.calls, dom: document.getElementsByTagName('*').length, day: window.__witkowo.sim.simDay, h: +window.__witkowo.state.hour.toFixed(2), issues: window.__issues.length }));
    mem.push(m); console.log(((Date.now() - t0) / 60000).toFixed(1) + 'min', JSON.stringify(m));
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
  console.log('heap after GC', after);
  const res = await page.evaluate(() => ({ issues: window.__issues, samples: window.__samples }));
  const kinds = {}; for (const i of res.issues) kinds[i[0]] = (kinds[i[0]] || 0) + 1;
  console.log('issue kinds', JSON.stringify(kinds));
  for (const i of res.issues.filter((x) => x[0] === 'midnight')) console.log('midnight', JSON.stringify(i[1]));
  for (const k of Object.keys(kinds).filter((k) => k !== 'midnight')) console.log('first', k, JSON.stringify(res.issues.find((x) => x[0] === k)).slice(0, 600));
  // daily max/min tank, peak kWh per day
  const byDay = {}; for (const s of res.samples) { const d = (byDay[s.day] ||= { kwhMax: 0, Lmax: 0, tmin: 9, tmax: -9, outMin: 99, outMax: -99, rain: 0, dos0: s.dos, stage0: s.stage }); d.kwhMax = Math.max(d.kwhMax, s.kwh); d.Lmax = Math.max(d.Lmax, s.L); d.tmin = Math.min(d.tmin, s.tank); d.tmax = Math.max(d.tmax, s.tank); d.outMin = Math.min(d.outMin, s.out); d.outMax = Math.max(d.outMax, s.out); d.rain = Math.max(d.rain, s.rainDay); d.dos1 = s.dos; d.stage1 = s.stage; }
  for (const [d, v] of Object.entries(byDay)) console.log('day', d, JSON.stringify(v, (k, x) => (typeof x === 'number' ? +x.toFixed(2) : x)));
  require('fs').writeFileSync(__dirname + '/../out/adv_longrun.json', JSON.stringify({ mem, res }, null, 0));
  await shot(page, 'longrun_end');
  console.log('logs', logs.length, logs.slice(0, 15).join('\n'));
  await b.close();
})();
