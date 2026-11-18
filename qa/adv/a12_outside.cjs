const { open, launch, shot } = require('./h.cjs');
(async () => {
  const b = await launch();
  for (const [n, q] of [['ukraine', '?lat=49.0&lon=24.2'], ['baltic', '?lat=54.8&lon=18.5'], ['prague', '?lat=50.08&lon=14.42']]) {
    const { page, logs, ctx } = await open(b, q);
    await page.waitForFunction(() => !/wczytuję|czeka/.test(document.querySelector('#locNote')?.innerText || ''), null, { timeout: 90000 }).catch(() => console.log(n, 'steps not done in 90 s'));
    await page.waitForTimeout(1500);
    const nf = await page.evaluate(() => { const out = []; const walk = (o, p, d) => { if (d > 6 || !o) return; for (const [k, v] of Object.entries(o)) { if (typeof v === 'number' && !Number.isFinite(v)) out.push(p + '.' + k + '=' + v); else if (v && typeof v === 'object') walk(v, p + '.' + k, d + 1); } }; walk(window.__witkowo.info, 'info', 0); return out; });
    await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
    await page.click('#bReport'); await page.waitForTimeout(2000);
    const txt = (await page.evaluate(() => document.querySelector('#panel').innerText)).replace(/\n+/g, ' | ');
    console.log(`== ${n}\n nonfinite: ${nf.join(', ')}\n report: ${txt.slice(0, 900)}`);
    await shot(page, 'outside_' + n + '_report');
    await page.click('#pclose'); await page.waitForTimeout(500); await shot(page, 'outside_' + n);
    await ctx.close();
  }
  await b.close();
})();
