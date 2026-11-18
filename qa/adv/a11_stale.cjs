// a live service fails during a site change: does the UI present the previous site's data as the new site's?
const { open, launch, shot, W } = require('./h.cjs');
(async () => {
  const b = await launch();
  const { page, logs, ctx } = await open(b);
  await page.waitForTimeout(3000);
  const c0 = await page.evaluate(() => { const c = window.__witkowo.info.climate; return { annualMean: c?.annualMean, baseline: c?.baselineMean, t: c?.tempOutsideC, site: c?.site }; });
  await ctx.route((u) => /open-meteo\.com$/.test(u.hostname), (r) => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":true,"reason":"Minutely API request limit exceeded"}' }));
  await page.evaluate(() => window.__witkowo.applySite({ lat: 49.2992, lon: 19.9496, rotDeg: 0, name: 'Zakopane', source: 'qa' }));
  await page.waitForTimeout(2000);
  const c1 = await page.evaluate(() => { const c = window.__witkowo.info.climate; return { annualMean: c?.annualMean, baseline: c?.baselineMean, t: c?.tempOutsideC, site: c?.site, errors: c?.errors }; });
  console.log('Witkowo climate', JSON.stringify(c0));
  console.log('Zakopane w/ Open-Meteo 429', JSON.stringify(c1));
  console.log('steps', await page.evaluate(() => [...document.querySelectorAll('#locNote li, #locNote div')].map((e) => e.innerText.replace(/\n/g, ' ') + (e.querySelector('[title]')?.title ? ' {title=' + e.querySelector('[title]').title.slice(0, 120) + '}' : '')).join(' | ').slice(0, 900)));
  await page.click('#bClimate').catch(async () => { await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; })); await page.click('#bClimate'); });
  await page.waitForTimeout(2000);
  console.log('climate panel', (await page.evaluate(() => document.querySelector('#panel').innerText)).replace(/\n+/g, ' | ').slice(0, 1200));
  await shot(page, 'stale_climate_panel');
  console.log('logs', logs.length, logs.slice(0, 5).join('\n'));
  await b.close();
})();
