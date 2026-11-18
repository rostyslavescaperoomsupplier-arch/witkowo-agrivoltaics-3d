// CPU sampling profile of the main thread: node qa/perf_profile.cjs <scenario overview|walk|winter|flows> [cpuRate] [w] [h] [baseUrl]
// Prints top functions by self time and by total (inclusive) time.
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const [sc = 'overview', rate = '4', W = '1440', H = '900', BASE = 'http://localhost:8770/'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const mobile = +W < 600;
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.goto(BASE + (sc === 'winter' ? '?q=high&season=winter' : '?q=high'));
  await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 120000 });
  await page.evaluate((sc) => { const w = window.__witkowo; if (sc === 'walk') { w.setMode('walk'); Object.assign(w.walk, { x: -5, z: 2, yaw: 0, pitch: -0.1 }); } if (sc === 'flows') { w.setXray(true); w.flyToFlow('power'); } }, sc);
  await page.waitForTimeout(2000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(6000);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map(); const dt = profile.timeDeltas; let total = 0;
  const cnt = new Map(); profile.samples.forEach((id, i) => { cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)); total += dt[i] || 0; });
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  for (const [id, t] of cnt) { const k = key(byId.get(id)); self.set(k, (self.get(k) || 0) + t); }
  // inclusive
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const incl = new Map();
  for (const [id, t] of cnt) { const seen = new Set(); let cur = id; while (cur != null) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + t); } cur = parent.get(cur); } }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${(t / 1000).toFixed(0).padStart(6)} ms ${(100 * t / total).toFixed(1).padStart(5)}%  ${k}`).join('\n');
  console.log(`total ${(total / 1000).toFixed(0)} ms\n--- self ---\n${top(self, 25)}\n--- inclusive ---\n${top(incl, 40)}`);
  await browser.close();
})();
