const { open, launch, shot, W, BASE } = require('./h.cjs');
(async () => {
  const b = await launch();
  const which = process.argv[2] || 'all';
  if (which === 'all' || which === 'ctxloss') {
    const { page, logs, ctx } = await open(b);
    let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
    const r = await page.evaluate(() => { const gl = window.__witkowo.ctx.renderer.getContext(); const ext = gl.getExtension('WEBGL_lose_context'); window.__ext = ext; ext.loseContext(); return !!ext; });
    await page.waitForTimeout(2000);
    const lostUi = await page.evaluate(() => document.querySelector('#glLost')?.innerText);
    console.log('lost ext', r, 'ui:', lostUi); await shot(page, 'ctxlost');
    await page.evaluate(() => window.__ext.restoreContext());
    await page.waitForTimeout(6000);
    console.log('navigations after restore', navs);
    await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 60000 }).catch((e) => console.log('no reboot', e.message));
    // second loss within a minute -> low tier?
    await page.evaluate(() => { const gl = window.__witkowo.ctx.renderer.getContext(); const ext = gl.getExtension('WEBGL_lose_context'); ext.loseContext(); setTimeout(() => ext.restoreContext(), 1000); });
    await page.waitForTimeout(6000);
    await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 60000 }).catch(() => {});
    console.log('after 2nd loss: navs', navs, 'quality', JSON.stringify(await page.evaluate(() => window.__witkowo?.QUALITY)), 'url', page.url());
    // state preserved across the reload? (site/season are not in URL unless non-default)
    await shot(page, 'ctxrestored');
    // loss without restore for 15 s -> message
    await page.evaluate(() => { const gl = window.__witkowo.ctx.renderer.getContext(); gl.getExtension('WEBGL_lose_context').loseContext(); });
    await page.waitForTimeout(14000);
    console.log('no restore 14 s ui:', await page.evaluate(() => document.querySelector('#glLost')?.innerText));
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  if (which === 'all' || which === 'hidden') {
    const { page, logs, ctx } = await open(b);
    const cdp = await ctx.newCDPSession(page);
    const before = await W(page);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await new Promise((r) => setTimeout(r, 60000));
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await page.waitForTimeout(3000);
    const after = await W(page);
    console.log('frozen 60 s: hour', before.hour, '->', after.hour, 'kWh', before.info.power.kWhToday.toFixed(1), '->', after.info.power.kWhToday.toFixed(1), 'quality', JSON.stringify(await page.evaluate(() => window.__witkowo.QUALITY)));
    // visibility hidden emulation via a second tab in front
    const p2 = await ctx.newPage(); await p2.goto('about:blank'); await p2.bringToFront();
    const vis = await page.evaluate(() => document.visibilityState);
    const h0 = (await W(page)).hour;
    await new Promise((r) => setTimeout(r, 30000));
    const h1 = (await W(page)).hour;
    await page.bringToFront(); await page.waitForTimeout(3000);
    const h2 = (await W(page)).hour;
    console.log('background tab: visibility', vis, 'hour', h0, '->', h1, '-> front', h2, 'quality', JSON.stringify(await page.evaluate(() => window.__witkowo.QUALITY)));
    await shot(page, 'after_background');
    console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
    await ctx.close();
  }
  if (which === 'all' || which === 'slow3g') {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage(); const logs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
    const t0 = Date.now(); await page.goto(BASE);
    const samples = [];
    for (let i = 0; i < 24; i++) { await page.waitForTimeout(5000); const s = await page.evaluate(() => ({ boot: !!document.querySelector('#boot'), h: document.querySelector('#boot h2')?.textContent, msg: document.querySelector('#boot .msg')?.textContent, btns: [...document.querySelectorAll('#boot .act button')].map((b) => b.textContent).join('/'), ready: !!window.__witkowo })); samples.push(((Date.now() - t0) / 1000).toFixed(0) + 's ' + JSON.stringify(s)); if (s.ready && !s.boot) break; }
    console.log('slow 3G boot:\n ' + samples.join('\n '));
    await page.screenshot({ path: require('path').join(require('./h.cjs').OUT, 'adv_slow3g.png') });
    const bytes = await page.evaluate(() => performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || 0), 0));
    console.log('transferred MB', (bytes / 1048576).toFixed(1), 'logs', logs.slice(0, 8).join(' | '));
    await ctx.close();
  }
  if (which === 'all' || which === 'block') {
    const hosts = ['cdn.jsdelivr.net', 'cdn.jsdelivr.net+unpkg.com', 'services.gugik.gov.pl', 'mapy.geoportal.gov.pl', 'archive-api.open-meteo.com', 'api.open-meteo.com', 'cbdgmapa.pgi.gov.pl', 'epsh.pgi.gov.pl', 'uldk.gugik.gov.pl', 'nominatim.openstreetmap.org', 'HANG:services.gugik.gov.pl', 'HANG:mapy.geoportal.gov.pl'];
    for (const h of hosts) {
      const hang = h.startsWith('HANG:'); const hs = h.replace('HANG:', '').split('+');
      const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.route((u) => hs.some((x) => u.hostname === x), (r) => (hang ? undefined : r.abort()));
      const page = await ctx.newPage(); const logs = [];
      page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
      const t0 = Date.now();
      await page.goto(BASE + '?lat=51.25&lon=22.57&rot=200&q=high');
      let st = 'boot timeout';
      try { await page.waitForFunction(() => window.__witkowo && !document.querySelector('#boot'), null, { timeout: 45000 }); st = 'booted ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'; }
      catch (e) { st += ' boot card: ' + (await page.evaluate(() => document.querySelector('#boot')?.innerText.replace(/\n/g, ' / '))); }
      await page.waitForTimeout(40000);
      const note = await page.evaluate(() => document.querySelector('#locNote')?.innerText.replace(/\n/g, ' | '));
      const terr = await page.evaluate(() => { const t = window.__witkowo?.info?.terrain; return t && { el: t.elevationM, err: t.errors, src: t.source, loading: t.loading }; });
      console.log(`block ${h}: ${st}\n   steps: ${note}\n   terrain: ${JSON.stringify(terr)}\n   mapStatus: ${await page.evaluate(() => document.querySelector('#mapStatus')?.textContent)}\n   ${logs.slice(0, 3).join(' | ')}`);
      await page.screenshot({ path: require('path').join(require('./h.cjs').OUT, 'adv_block_' + h.replace(/[^a-z0-9]+/gi, '_') + '.png') });
      await ctx.close();
    }
  }
  await b.close();
})();
