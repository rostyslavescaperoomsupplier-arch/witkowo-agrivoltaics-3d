// CPU profile of page boot (navigation -> first frame): node qa/perf_boot.cjs [cpuRate] [baseUrl]
const PW = process.env.PW_CORE || require('child_process').execSync('ls -d ~/.npm/_npx/*/node_modules/playwright-core | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(PW);
const [rate = '4', BASE = 'http://localhost:8770/'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  await page.goto(BASE + '?q=high');
  await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 120000 });
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n])); const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const cnt = new Map(); let total = 0; profile.samples.forEach((id, i) => { cnt.set(id, (cnt.get(id) || 0) + (profile.timeDeltas[i] || 0)); total += profile.timeDeltas[i] || 0; });
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  const self = new Map(), incl = new Map();
  for (const [id, t] of cnt) { const k = key(byId.get(id)); self.set(k, (self.get(k) || 0) + t); const seen = new Set(); let cur = id; while (cur != null) { const kk = key(byId.get(cur)); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + t); } cur = parent.get(cur); } }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${(t / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n');
  console.log(`total ${(total / 1000).toFixed(0)} ms\n--- self ---\n${top(self, 20)}\n--- inclusive ---\n${top(incl, 45)}`);
  await browser.close();
})();
