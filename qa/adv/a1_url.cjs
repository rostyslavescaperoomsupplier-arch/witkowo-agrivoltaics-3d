const { open, launch, shot, W } = require('./h.cjs');
const CASES = [
  ['lat91', '?lat=91&lon=15'], ['latabc', '?lat=abc&lon=15'], ['border', '?lat=49.0&lon=24.2'], ['outside', '?lat=48&lon=2'],
  ['rotneg', '?lat=52.23&lon=21.01&rot=-720'], ['rotnan', '?lat=52.23&lon=21.01&rot=NaN'], ['rot1e308', '?lat=52.23&lon=21.01&rot=1e308'],
  ['seasonfoo', '?season=foo'], ['seasonwinter', '?season=winter'], ['qlow', '?q=low'], ['qhigh', '?q=high'], ['qfoo', '?q=foo'],
  ['sea', '?lat=54.8&lon=18.5'], ['rysy', '?lat=49.18&lon=20.09'], ['warszawa', '?lat=52.2297&lon=21.0122'],
  ['namexss', '?lat=52.23&lon=21.01&name=%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E'],
  ['longurl', '?lat=52.23&lon=21.01&name=' + 'A'.repeat(20000)],
  ['hexlat', '?lat=0x35&lon=15'], ['latInf', '?lat=Infinity&lon=15'], ['dup', '?lat=52&lat=53&lon=15&lon=16'],
  ['latonly', '?lat=52.2'], ['emptyvals', '?lat=&lon=&rot=&season=&q='],
];
(async () => {
  const b = await launch();
  const only = process.argv[2];
  for (const [n, q] of CASES) {
    if (only && !only.split(',').includes(n)) continue;
    let r;
    try {
      r = await open(b, q, { timeout: 60000 });
    } catch (e) { console.log(`== ${n} ${q.slice(0, 80)} BOOT FAIL ${e.message.slice(0, 120)}`); continue; }
    const { page, logs, ctx } = r;
    await page.waitForTimeout(n === 'sea' || n === 'rysy' || n === 'warszawa' || n.startsWith('rot') ? 25000 : 4000);
    const w = await W(page);
    const dom = await page.evaluate(() => ({ url: location.search.slice(0, 120), loc: document.querySelector('#locName')?.textContent?.slice(0, 80), coord: document.querySelector('#locCoord')?.textContent, xss: window.__xss || 0, title: document.title, q: window.__witkowo.QUALITY, glCanvasW: document.querySelector('canvas')?.width, note: document.querySelector('#locNote')?.innerText?.slice(0, 300) }));
    const bad = JSON.stringify(w.info).match(/NONFINITE[^"]*|null/g);
    console.log(`== ${n} ${q.slice(0, 80)}\n site=${JSON.stringify({ ...w.site, name: (w.site.name || '').slice(0, 30) })} season=${w.season} winter=${w.winter}\n dom=${JSON.stringify(dom)}\n terrain=${JSON.stringify(w.info.terrain && { el: w.info.terrain.elevationM, slope: w.info.terrain.slopePct, relief: w.info.terrain.reliefM, cut: w.info.terrain.cutM3, fill: w.info.terrain.fillM3, err: w.info.terrain.errors, src: w.info.terrain.source })}\n sky=${JSON.stringify(w.info.sky && { alt: w.info.sky.sunAltDeg, rise: w.info.sky.sunrise, set: w.info.sky.sunset, rot: w.info.sky.rotDeg })}\n nonfinite=${bad ? bad.filter((x) => x !== 'null').join(',') : ''}`);
    if (logs.length) console.log(' logs:\n  ' + logs.slice(0, 8).join('\n  '));
    await shot(page, 'url_' + n);
    await ctx.close();
  }
  await b.close();
})();
