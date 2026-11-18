// Performance measurement: node qa/perf.cjs <label> [baseUrl]   -> qa/perf_<label>.json + qa/out/perfrun_<label>_*.png
// Profiles: desktop 1440x900 (no throttle), laptop-4x (1440x900, CPU 4x), phone-4x (390x844, DPR 3, touch, CPU 4x).
// Scenarios (~10 s each, sim playing at default speed): overview, walk, winter (?season=winter), flows (x-ray on).
// Frame time = rAF-to-rAF interval; cpu = time spent inside the page's rAF callbacks (JS main thread per frame).
const path = require('path'), fs = require('fs');
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const LABEL = process.argv[2] || 'run';
const BASE = process.argv[3] || 'http://localhost:8770/';
const SECS = +(process.env.PERF_SECS || 10);
const ONLY = process.env.PERF_ONLY ? process.env.PERF_ONLY.split(',') : null;
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });

const INIT = () => {
  window.__perf = { frames: [], cpu: [], calls: [], tris: [], long: [], firstFrame: 0, rec: false };
  const P = window.__perf, raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    const r = window.__witkowo?.ctx?.renderer;
    if (r) { r.info.autoReset = false; r.info.reset(); }
    const s = performance.now();
    cb(t);
    const e = performance.now();
    if (!P.firstFrame && window.__witkowo) P.firstFrame = e;
    if (P.rec) {
      if (last) P.frames.push(t - last);
      P.cpu.push(e - s);
      if (r) { P.calls.push(r.info.render.calls); P.tris.push(r.info.render.triangles); }
    }
    last = t;
  });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* no longtask */ }
};

const stats = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: a.length, median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) };
};

const PROFILES = [
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, cpu: 1 },
  { name: 'laptop-4x', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, cpu: 4 },
  { name: 'phone-4x', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, cpu: 4 },
].filter((p) => !ONLY || ONLY.includes(p.name));

// fixed pose for screenshots: paused, 13:00, growth 80, irrigation on
const fixPose = (page, pose) => page.evaluate(async (pose) => {
  const w = window.__witkowo;
  w.sim.playing = false; w.state.hour = pose.hour ?? 13; w.state.dayOfSeason = 80; w.sim.irrigation = 'on';
  if (pose.mode) w.setMode(pose.mode);
  if (pose.mode === 'walk') { Object.assign(w.walk, pose.walk); }
  else if (pose.cam) { w.persp.position.set(...pose.cam.p); w.orbitP.target.set(...pose.cam.t); w.orbitP.update(); }
  await new Promise((r) => setTimeout(r, 2500));
}, pose);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const result = { label: LABEL, date: new Date().toISOString(), base: BASE, secs: SECS, glb: {}, profiles: {} };
  const errors = [];
  for (const prof of PROFILES) {
    result.profiles[prof.name] = {};
    const scen = [
      { id: 'overview', q: '?q=high', setup: async () => {} },
      { id: 'walk', q: '?q=high', setup: (p) => p.evaluate(() => { const w = window.__witkowo; w.setMode('walk'); Object.assign(w.walk, { x: -5, z: 2, yaw: 0, pitch: -0.1 }); }) },
      { id: 'winter', q: '?q=high&season=winter', setup: async () => {} },
      { id: 'flows', q: '?q=high', setup: (p) => p.evaluate(() => { const w = window.__witkowo; w.setXray(true); w.flyToFlow('power'); }) },
    ];
    for (const sc of scen.filter((x) => !process.env.PERF_SCEN || process.env.PERF_SCEN.split(',').includes(x.id))) {
      const ctx = await browser.newContext(prof.ctx);
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${prof.name}/${sc.id}] ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`[${prof.name}/${sc.id}] pageerror: ${e.message}`));
      await page.addInitScript(INIT);
      const cdp = await ctx.newCDPSession(page);
      if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
      const t0 = Date.now();
      await page.goto(BASE + sc.q);
      await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot') && window.__perf.firstFrame, null, { timeout: 180000 });
      const load = await page.evaluate(() => ({ firstFrameMs: Math.round(window.__perf.firstFrame), glbMs: Math.round(performance.getEntriesByType('resource').find((e) => e.name.includes('witkowo.glb'))?.duration || 0) }));
      load.wallMs = Date.now() - t0;
      const longBoot = await page.evaluate(() => window.__perf.long.filter((l) => l.t < window.__perf.firstFrame).map((l) => Math.round(l.d)));
      await sc.setup(page);
      await page.waitForTimeout(2000);
      await page.evaluate(() => { const P = window.__perf; P.frames.length = P.cpu.length = P.calls.length = P.tris.length = 0; P.long.length = 0; P.rec = true; });
      await page.waitForTimeout(SECS * 1000);
      const d = await page.evaluate(() => {
        const P = window.__perf; P.rec = false; const r = window.__witkowo.ctx.renderer;
        return { frames: P.frames, cpu: P.cpu, calls: P.calls, tris: P.tris, long: P.long, programs: r.info.programs?.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures, quality: window.__witkowo.QUALITY.low ? 'low' : 'high', pr: r.getPixelRatio(), gpu: window.__witkowo.QUALITY.gpu };
      });
      const rec = {
        frameMs: stats(d.frames), cpuMs: stats(d.cpu), fps: d.frames.length ? +(1000 / stats(d.frames).mean).toFixed(1) : 0,
        drawCalls: stats(d.calls)?.median, triangles: stats(d.tris)?.median, programs: d.programs, geometries: d.geometries, textures: d.textures,
        longTasks: { n: d.long.length, totalMs: Math.round(d.long.reduce((a, l) => a + l.d, 0)), max: Math.round(Math.max(0, ...d.long.map((l) => l.d))) },
        load, bootLongTasks: { n: longBoot.length, totalMs: longBoot.reduce((a, b) => a + b, 0), max: Math.max(0, ...longBoot) },
        quality: d.quality, pixelRatio: d.pr,
      };
      result.profiles[prof.name][sc.id] = rec;
      if (!result.gpu) result.gpu = d.gpu;
      console.log(prof.name.padEnd(10), sc.id.padEnd(9), `frame med ${rec.frameMs?.median} p95 ${rec.frameMs?.p95} | cpu med ${rec.cpuMs?.median} p95 ${rec.cpuMs?.p95} | calls ${rec.drawCalls} tris ${rec.triangles} prog ${rec.programs} | firstFrame ${load.firstFrameMs} ms | long ${rec.longTasks.n}/${rec.longTasks.totalMs}ms | q ${rec.quality} pr ${rec.pixelRatio}`);
      // screenshot at a fixed pose (unthrottled for speed)
      if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      if (prof.name !== 'laptop-4x' && !process.env.PERF_NOSHOT) {
        const poses = {
          overview: { mode: 'iso', cam: prof.name === 'desktop' ? { p: [30, 22, 22], t: [0, 1, -15] } : { p: [40, 35, 35], t: [0, 1, -14] } },
          walk: { mode: 'walk', walk: { x: -5, z: 2, yaw: 0, pitch: -0.1 } },
          winter: { mode: 'iso', cam: prof.name === 'desktop' ? { p: [30, 22, 22], t: [0, 1, -15] } : { p: [40, 35, 35], t: [0, 1, -14] } },
          flows: { mode: 'iso', cam: { p: [-23, 11, 13], t: [-8, 2.6, -5] } },
        };
        await fixPose(page, poses[sc.id]);
        await page.screenshot({ path: path.join(OUT, `perfrun_${LABEL}_${prof.name}_${sc.id}.png`) });
      }
      await ctx.close();
    }
  }
  // GLB size + decode time (desktop, unthrottled and 4x)
  if (!process.env.PERF_NOSHOT) {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage(); await page.goto(BASE + '?q=high');
    await page.waitForFunction(() => window.__witkowo, null, { timeout: 180000 });
    const cdp = await ctx.newCDPSession(page);
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      result.glb['decode_cpu' + rate] = await page.evaluate(async () => {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
        const buf = await (await fetch('./model/witkowo.glb')).arrayBuffer();
        const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
        const t = []; for (let i = 0; i < 3; i++) { const s = performance.now(); const g = await l.parseAsync(buf.slice(0), './model/'); t.push(performance.now() - s); g.scene.traverse((o) => o.geometry?.dispose()); }
        let verts = 0, meshes = 0, indexed = 0; const g = await l.parseAsync(buf.slice(0), './model/'); g.scene.traverse((o) => { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; if (o.geometry.index) indexed++; } });
        return { bytes: buf.byteLength, decodeMs: t.map(Math.round), meshes, verts, indexed };
      });
    }
    await ctx.close();
  }
  result.consoleErrors = errors;
  fs.writeFileSync(path.join(__dirname, `perf_${LABEL}.json`), JSON.stringify(result, null, 1));
  console.log('GLB', JSON.stringify(result.glb));
  console.log('errors', errors.length ? errors.join('\n') : '(none)');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
