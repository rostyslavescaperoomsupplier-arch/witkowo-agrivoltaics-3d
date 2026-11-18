const { open, launch, shot, W } = require('./h.cjs');
(async () => {
  const b = await launch();
  const t0 = Date.now();
  const { page, logs } = await open(b);
  console.log('boot ms', Date.now() - t0);
  await page.waitForTimeout(8000);
  const w = await W(page);
  console.log(JSON.stringify({ ...w, info: Object.keys(w.info) }));
  console.log(JSON.stringify(w.info, null, 0).slice(0, 3000));
  await shot(page, 'smoke');
  console.log(logs.join('\n'));
  await b.close();
})();
