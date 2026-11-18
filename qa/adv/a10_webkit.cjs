const { open, launch, shot, W } = require('./h.cjs');
(async () => {
  for (const kind of ['webkit', 'firefox']) {
    let b; try { b = await launch(kind); } catch (e) { console.log(kind, 'launch fail', e.message.slice(0, 200)); continue; }
    try {
      const t0 = Date.now();
      const { page, logs, ctx } = await open(b, '', { timeout: 120000 });
      console.log(kind, 'booted', (Date.now() - t0) / 1000, 's');
      await page.waitForTimeout(8000);
      const w = await W(page); console.log(kind, JSON.stringify({ hour: w.hour, sun: w.sun, mods: Object.keys(w.info), q: await page.evaluate(() => window.__witkowo.QUALITY), terrainErr: w.info.terrain?.errors, geoErr: w.info.geo?.errors }));
      await shot(page, kind + '_boot');
      await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => { d.open = true; }));
      await page.click('#seasons button[data-season="winter"]'); await page.click('#rainMode button[data-rain="on"]'); await page.waitForTimeout(6000);
      await shot(page, kind + '_winter_rain');
      await page.click('#bLoc'); await page.waitForTimeout(5000); await shot(page, kind + '_picker'); await page.keyboard.press('Escape');
      await page.click('#bReport'); await page.waitForTimeout(3000); await shot(page, kind + '_report');
      await page.click('#pclose').catch(() => {});
      await page.click('#bClimate'); await page.waitForTimeout(2000); await shot(page, kind + '_climate');
      console.log(kind, 'logs', logs.length, logs.slice(0, 12).join('\n'));
    } catch (e) { console.log(kind, 'FAIL', e.message.slice(0, 400)); try { const p = b.contexts()[0]?.pages()[0]; if (p) { await p.screenshot({ path: require('path').join(require('./h.cjs').OUT, `adv_${kind}_fail.png`) }); console.log(kind, 'boot card:', await p.evaluate(() => document.querySelector('#boot')?.innerText)); } } catch (_) {} }
    await b.close();
  }
})();
