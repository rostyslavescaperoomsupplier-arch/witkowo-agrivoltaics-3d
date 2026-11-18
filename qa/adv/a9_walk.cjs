// walk mode: drive into walls / tanks / site edge with keys, check we never end up inside a collider or off-site
const { open, launch, shot } = require('./h.cjs');
(async () => {
  const b = await launch();
  const { page, logs, ctx } = await open(b, process.argv[2] || '');
  await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
  await page.click('#modes button[data-mode="walk"]'); await page.waitForTimeout(500);
  const check = () => page.evaluate(() => {
    const w = window.__witkowo, x = w.walk.x, z = w.walk.z, R = 0.3;
    const inside = w.colliders.filter((c) => x > c.x0 - R && x < c.x1 + R && z > c.z0 - R && z < c.z1 + R).map((c) => [c.x0, c.z0, c.x1, c.z1].map((v) => +v.toFixed(2)));
    const wall = (w.mods.winter?.colliders || []).filter((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1).length;
    return { x: +x.toFixed(2), z: +z.toFixed(2), y: +w.persp.position.y.toFixed(2), offsite: x < -18 || x > 18 || z < -36 || z > 6, inside, wallCore: wall };
  });
  const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
  const setYaw = (y) => page.evaluate((y) => { window.__witkowo.walk.yaw = y; }, y);
  // focus the canvas so keys go to the scene
  await page.mouse.click(900, 450);
  const res = [];
  // run in 8 directions from the start, with Shift (fast) for 6 s each
  for (let i = 0; i < 8; i++) { await setYaw((i * Math.PI) / 4); await hold(['ShiftLeft', 'KeyW'], 6000); res.push(['dir' + i, await check()]); }
  // spin + diagonal strafe chaos
  for (let i = 0; i < 30; i++) { await setYaw(Math.random() * 6.28); await hold([['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyS'], ['ShiftLeft', 'KeyW', 'KeyD']][i % 4], 700); const c = await check(); if (c.offsite || c.inside.length) res.push(['chaos' + i, c]); }
  for (const r of res) console.log(JSON.stringify(r));
  await shot(page, 'walk_summer');
  // winter: greenhouse walls up, try to leave through the side walls
  await page.click('#seasons button[data-season="winter"]'); await page.waitForTimeout(6000);
  await page.evaluate(() => { const w = window.__witkowo; w.walk.x = -5; w.walk.z = -15; });
  const wres = [];
  for (const yaw of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) { await setYaw(yaw); await hold(['ShiftLeft', 'KeyW'], 8000); wres.push([yaw.toFixed(2), await check()]); }
  for (const r of wres) console.log('winter', JSON.stringify(r));
  console.log('winter colliders', JSON.stringify((await page.evaluate(() => window.__witkowo.mods.winter?.colliders))?.slice(0, 20)));
  await shot(page, 'walk_winter');
  // teleport inside a tank collider (e.g. robot drove onto you) then press keys: tryMove lets you move freely while inside
  const tank = await page.evaluate(() => { const w = window.__witkowo; const c = w.colliders[5]; w.walk.x = (c.x0 + c.x1) / 2; w.walk.z = (c.z0 + c.z1) / 2; return c; });
  await setYaw(0); await hold(['KeyW'], 300);
  console.log('started inside collider', JSON.stringify(tank), '->', JSON.stringify(await check()));
  // pointer/mouse look: drag to extreme pitch
  await page.mouse.move(900, 450); await page.mouse.down(); await page.mouse.move(900, 2000, { steps: 10 }); await page.mouse.up();
  console.log('pitch after drag down', await page.evaluate(() => window.__witkowo.walk.pitch));
  await page.mouse.down(); await page.mouse.move(900, -2000, { steps: 10 }); await page.mouse.up();
  console.log('pitch after drag up', await page.evaluate(() => window.__witkowo.walk.pitch));
  // walk mode on a sloped / non-default site: eye height vs terrain under the pad edge
  console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
  await b.close();
})();
