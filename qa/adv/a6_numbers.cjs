const { open, launch, shot, W } = require('./h.cjs');
const setRange = (page, id, v) => page.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
const endRange = (page, id) => page.evaluate((id) => document.getElementById(id).dispatchEvent(new Event('change', { bubbles: true })), id);
const nums = (page) => page.evaluate(() => { const i = window.__witkowo.info; return { h: +window.__witkowo.state.hour.toFixed(2), kWh: +(i.power?.kWhToday ?? NaN).toFixed(2), L: Math.round(i.water?.litresToday ?? NaN), lpm: i.water?.lpm, tank: +(i.rain?.tankLevel ?? NaN).toFixed(3), hudKWh: document.querySelector('#hKWh').textContent, hudL: document.querySelector('#hL').textContent, hudTank: document.querySelector('#hTank').textContent }; });
(async () => {
  const b = await launch();
  const { page, logs, ctx } = await open(b);
  await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
  await page.click('#bPlay'); // pause
  await page.click('#irr button[data-irr="on"]');
  await setRange(page, 'rClock', 6); await endRange(page, 'rClock'); await page.waitForTimeout(1500);
  console.log('start 06:00 irrigation ON, paused', JSON.stringify(await nums(page)));
  for (let i = 0; i < 50; i++) { await setRange(page, 'rClock', 16.9); await page.waitForTimeout(40); await setRange(page, 'rClock', 6); await page.waitForTimeout(40); }
  await endRange(page, 'rClock'); await page.waitForTimeout(500);
  const a = await nums(page);
  console.log('after 50 scrubs 06:00<->16:54 (clock still 06:00)', JSON.stringify(a), 'max physically possible for 24 h =', Math.round(a.lpm * 60 * 24));
  await shot(page, 'scrub_litres');
  // kWh: set irrigation auto, scrub to 20:00 slowly (small steps so power integrates), then jump back to 10:00
  await page.click('#irr button[data-irr="auto"]');
  for (let h = 6; h <= 20; h += 0.5) { await setRange(page, 'rClock', h); await page.waitForTimeout(30); }
  const k20 = await nums(page); console.log('slow scrub 06->20', JSON.stringify(k20));
  await setRange(page, 'rClock', 10); await endRange(page, 'rClock'); await page.waitForTimeout(500);
  const k10 = await nums(page); console.log('jump back to 10:00', JSON.stringify(k10));
  for (let h = 10; h <= 20; h += 0.5) { await setRange(page, 'rClock', h); await page.waitForTimeout(30); }
  console.log('slow scrub 10->20 again', JSON.stringify(await nums(page)));
  await shot(page, 'scrub_kwh');
  // midnight scrub: 23.9 -> 0.1 resets?
  await setRange(page, 'rClock', 23.9); await page.waitForTimeout(100); await setRange(page, 'rClock', 0.1); await page.waitForTimeout(300);
  console.log('23.9 -> 0.1', JSON.stringify(await nums(page)));
  // 24 boundary: slider max is 24
  await setRange(page, 'rClock', 24); await endRange(page, 'rClock'); await page.click('#bPlay'); await page.waitForTimeout(1500);
  console.log('slider=24 then play', JSON.stringify(await nums(page)), await page.evaluate(() => [document.querySelector('#vClock').textContent, window.__witkowo.sim.simDay]));
  // tank: rain on max for long + irrigation off -> 100% spill; then irrigation on, rain off -> drain
  await page.click('#rainMode button[data-rain="on"]'); await setRange(page, 'rRain', 1);
  await page.click('#irr button[data-irr="off"]');
  await page.evaluate(() => { window.__witkowo.state.speed = 600; });
  await page.waitForTimeout(20000);
  console.log('rain max 20 s', JSON.stringify(await nums(page)), JSON.stringify((await W(page)).info.rain));
  await page.click('#rainMode button[data-rain="off"]'); await page.click('#irr button[data-irr="on"]');
  await page.waitForTimeout(30000);
  console.log('drain 30 s', JSON.stringify(await nums(page)), JSON.stringify((await W(page)).info.rain));
  await shot(page, 'tank_drain');
  // growth slider extremes + winter temps
  await setRange(page, 'rGrowth', 0); await page.waitForTimeout(400); console.log('growth 0', JSON.stringify((await W(page)).info.growth));
  await setRange(page, 'rGrowth', 100); await page.waitForTimeout(400); console.log('growth 100', JSON.stringify((await W(page)).info.growth));
  await page.click('#seasons button[data-season="winter"]'); await page.waitForTimeout(5000);
  for (const h of [0, 4, 8, 12, 15, 20]) { await setRange(page, 'rClock', h); await page.waitForTimeout(600); const w = await W(page); console.log('winter', h, JSON.stringify(w.info.winter), 'sun', w.sun, 'kW', w.info.power.kW.toFixed(1), 'climate', JSON.stringify(w.info.climate && { t: w.info.climate.tempC ?? w.info.climate.outsideC })); }
  await page.click('label:has(#tClimate) .sw'); await page.waitForTimeout(1500);
  for (const h of [4, 13]) { await setRange(page, 'rClock', h); await page.waitForTimeout(800); const w = await W(page); console.log('winter+real', h, JSON.stringify(w.info.winter), JSON.stringify({ tOut: await page.evaluate(() => window.__witkowo.state.tempOutsideC), hudOut: await page.evaluate(() => document.querySelector('#hOut').textContent), hudIn: await page.evaluate(() => document.querySelector('#hIn').textContent) })); }
  await shot(page, 'winter_real');
  console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
  await b.close();
})();
