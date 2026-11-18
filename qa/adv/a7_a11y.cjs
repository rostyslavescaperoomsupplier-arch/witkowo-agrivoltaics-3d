const { open, launch, shot } = require('./h.cjs');
(async () => {
  const b = await launch();
  const { page, logs, ctx } = await open(b, '', {}, { reducedMotion: 'reduce' });
  // 1) keyboard-only: Tab through everything, record focus + whether a visible focus indicator exists
  const seen = [];
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return { tag: 'BODY' };
      const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      // for checkboxes the visual is the sibling .sw
      const sw = e.matches('input[type=checkbox]') ? e.nextElementSibling : null; const cs2 = sw ? getComputedStyle(sw) : null;
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' || (cs2 && cs2.outlineStyle !== 'none' && parseFloat(cs2.outlineWidth) > 0);
      const name = e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.innerText || e.title || e.value || '';
      return { tag: e.tagName.toLowerCase(), id: e.id, cls: String(e.className).slice(0, 30), name: name.trim().slice(0, 40), ring, vis: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, inView: r.top >= 0 && r.bottom <= innerHeight };
    });
    seen.push(f);
  }
  const uniq = []; const keys = new Set(); for (const f of seen) { const k = f.tag + f.id + f.cls + f.name; if (keys.has(k)) break; keys.add(k); uniq.push(f); }
  console.log('tab stops until wrap:', uniq.length);
  for (const f of uniq) if (!f.ring || !f.vis || !f.name) console.log('  PROBLEM', JSON.stringify(f));
  console.log('  first 12:', uniq.slice(0, 12).map((f) => `${f.tag}#${f.id}.${f.cls}[${f.name}]`).join(' | '));
  // can the 3D objects / HUD / canvas be reached? Is the scene operable via keyboard in iso mode?
  // 2) unnamed controls
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, select, [role=button], a[href], [tabindex]:not([tabindex="-1"])')].filter((e) => e.offsetParent !== null).filter((e) => { const n = (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.innerText || e.labels?.[0]?.innerText || e.innerText || e.title || e.getAttribute('alt') || '').trim(); return !n; }).map((e) => e.outerHTML.slice(0, 140)));
  console.log('visible controls without accessible name:', unnamed.length, unnamed.slice(0, 10));
  // 3) aria snapshot of the panel + HUD
  const snap = await page.locator('body').ariaSnapshot().catch((e) => 'ERR ' + e.message);
  require('fs').writeFileSync('/private/tmp/claude-501/-Users-rostyslav/e9d98f65-876b-4988-aca3-31dabbdb439e/scratchpad/aria.txt', snap);
  console.log('aria snapshot lines', snap.split('\n').length);
  // 4) small-text contrast (approximate: effective bg = first opaque-ish ancestor bg, panel alpha composited on #000 worst-case)
  const low = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 20, g: 20, b: 24, a: 1 }; };
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const done = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue; const e = n.parentElement; if (!e || done.has(e)) continue; done.add(e);
      if (e.closest('#boot') || e.offsetParent === null) continue;
      const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); const c = parse(cs.color); if (!c) continue;
      const bg = bgOf(e); const op = parseFloat(cs.opacity);
      const fg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) };
      const L1 = lum(fg), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
      if (cr < (large ? 3 : 4.5) || fs < 11) out.push({ txt: n.textContent.trim().slice(0, 40), fs, cr: +cr.toFixed(2), color: cs.color, sel: (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0] + ' in ' + (e.closest('[id]')?.id || '') });
    }
    return out;
  });
  console.log('low-contrast or <11px text:', low.length); for (const l of low.slice(0, 40)) console.log('  ', JSON.stringify(l));
  // 5) reduced motion: is the sim auto-playing, do camera moves tween?
  const rm = await page.evaluate(async () => {
    const w = window.__witkowo; const mq = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const p0 = w.persp.position.clone(); w.select(w.ITEMS.find((i) => i.id === 'inverters'), true);
    await new Promise((r) => setTimeout(r, 120)); const mid = w.persp.position.clone();
    await new Promise((r) => setTimeout(r, 1500)); const p1 = w.persp.position.clone();
    return { mq, playing: w.sim.playing, speed: w.state.speed, tweenFramesVisible: mid.distanceTo(p0) > 0.01 && mid.distanceTo(p1) > 0.01 };
  });
  console.log('reduced motion', JSON.stringify(rm));
  // 6) HUD live region and panel when selecting via keyboard
  console.log('hud aria-live', await page.getAttribute('#hud', 'aria-live'), 'panel role', await page.getAttribute('#panel', 'role'));
  // 7) Escape closes info panel? focus returns?
  await page.focus('#objects li[data-id="pv"]').catch(() => {}); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  const f1 = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  console.log('panel after Enter on PV', f1, 'after Esc panel open?', await page.evaluate(() => document.querySelector('#panel').classList.contains('open')));
  await shot(page, 'a11y_focus');
  console.log('logs', logs.length, logs.slice(0, 10).join('\n'));
  await b.close();
})();
