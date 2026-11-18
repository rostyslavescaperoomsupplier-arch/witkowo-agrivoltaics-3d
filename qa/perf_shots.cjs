// Same-pose screenshots for the before/after visual check of performance work:
//   node qa/perf_shots.cjs <label> [baseUrl]  -> qa/out/perf_<label>_<shot>.png
// Sim paused at 13:00 (day 80, irrigation on); camera poses fixed. Animated overlays (pulses, drops, snow) still move
// with real time, so they differ a little between runs by design.
const path = require('path'), fs = require('fs');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const LABEL = process.argv[2] || 'run', BASE = process.argv[3] || 'http://localhost:8770/';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const SHOTS = [
  { id: 'desktop_overview', vp: [1440, 900], q: '', pose: { mode: 'iso', cam: { p: [30, 22, 22], t: [0, 1, -15] } } },
  { id: 'desktop_close_robot', vp: [1440, 900], q: '', pose: { mode: 'iso', cam: { p: [10, 4.5, 9], t: [5, 0.6, 2.5] } } },
  { id: 'desktop_close_canopy', vp: [1440, 900], q: '', pose: { mode: 'iso', cam: { p: [-3, 3.5, 6], t: [-8, 3.5, -6] } } },
  { id: 'desktop_walk', vp: [1440, 900], q: '', pose: { mode: 'walk', walk: { x: -5, z: 2, yaw: 0, pitch: -0.1 } } },
  { id: 'desktop_evening', vp: [1440, 900], q: '', pose: { hour: 18.5, mode: 'iso', cam: { p: [30, 22, 22], t: [0, 1, -15] } } },
  { id: 'desktop_winter', vp: [1440, 900], q: '&season=winter', pose: { hour: 12, mode: 'iso', cam: { p: [30, 22, 22], t: [0, 1, -15] } } },
  { id: 'desktop_flows', vp: [1440, 900], q: '', pose: { mode: 'iso', xray: true, cam: { p: [-23, 11, 13], t: [-8, 2.6, -5] } } },
  { id: 'desktop_night', vp: [1440, 900], q: '', pose: { hour: 23, mode: 'iso', cam: { p: [30, 22, 22], t: [0, 1, -15] } } },
  { id: 'phone_overview', vp: [390, 844], mobile: true, q: '', pose: { mode: 'iso', cam: { p: [40, 35, 35], t: [0, 1, -14] } } },
  { id: 'phone_walk', vp: [390, 844], mobile: true, q: '', pose: { mode: 'walk', walk: { x: 5, z: 5, yaw: 0.3, pitch: -0.15 } } },
];
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const errors = [];
  for (const s of SHOTS) {
    if (process.env.SHOT && !s.id.includes(process.env.SHOT)) continue;
    const ctx = await browser.newContext({ viewport: { width: s.vp[0], height: s.vp[1] }, deviceScaleFactor: s.mobile ? 3 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${s.id}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${s.id}] ${e.message}`));
    await page.goto(BASE + '?q=high' + s.q);
    await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 120000 });
    await page.evaluate(async (pose) => {
      const w = window.__witkowo;
      w.sim.playing = false; w.state.hour = pose.hour ?? 13; w.state.dayOfSeason = 80; w.sim.irrigation = 'on'; w.state.speed = 0;
      if (pose.mode) w.setMode(pose.mode);
      if (pose.xray) w.setXray(true);
      if (pose.mode === 'walk') Object.assign(w.walk, pose.walk);
      else if (pose.cam) { w.persp.position.set(...pose.cam.p); w.orbitP.target.set(...pose.cam.t); w.orbitP.update(); }
      await new Promise((r) => setTimeout(r, 5000)); // winter easing, robot parks/moves, safety shadow refresh
    }, s.pose);
    await page.screenshot({ path: path.join(OUT, `perf_${LABEL}_${s.id}.png`) });
    await ctx.close();
  }
  console.log('errors', errors.length ? errors.join('\n') : '(none)');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
