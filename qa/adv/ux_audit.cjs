// a11y/IA audit at 390x844 touch: small targets, small/low-contrast text, reduced motion, home-reset behaviour
const { open, launch } = require('./h.cjs');
(async () => {
  const b = await launch();
  const { page } = await open(b, '', {}, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await page.tap('#menuBtn'); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll('details.acc').forEach((d) => (d.open = true)));
  const r = await page.evaluate(() => {
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (el) => { while (el) { const c = getComputedStyle(el).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m[3] === undefined || +m[3] > 0.5)) return c; el = el.parentElement; } return 'rgb(17,19,23)'; };
    const small = []; const seen = new Set();
    document.querySelectorAll('#side button, #side input, #side select, #side summary, #side li.item, #side .fly, #side label.tog, #hud *, #pclose').forEach((el) => {
      const q = el.getBoundingClientRect(); if (!q.width || !q.height || q.bottom < 0 || q.top > 5000) return;
      if (q.height < 44) { const k = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.dataset.mode ? '[' + el.dataset.mode + ']' : ''}${el.dataset.s ? '[s' + el.dataset.s + ']' : ''} ${Math.round(q.width)}x${Math.round(q.height)}`; if (!seen.has(k)) { seen.add(k); small.push(k); } }
    });
    const txt = []; const s2 = new Set();
    document.querySelectorAll('body *').forEach((el) => {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const q = el.getBoundingClientRect(); if (!q.width) return;
      const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); const c = cr(cs.color, bgOf(el));
      if (fs < 12 || c < 4.5) { const k = `${fs}px cr=${c.toFixed(2)} "${el.textContent.trim().slice(0, 28)}"`; if (!s2.has(k)) { s2.add(k); txt.push(k); } }
    });
    return { small, txt, reducedMotionCSS: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.media && /reduced-motion/.test(r.media.mediaText)); } catch (e) { return false; } }) };
  });
  console.log('SMALL TARGETS (<44px high):', r.small.length); r.small.forEach((x) => console.log('  ', x));
  console.log('SMALL/LOW-CONTRAST TEXT:', r.txt.length); r.txt.slice(0, 45).forEach((x) => console.log('  ', x));
  console.log('prefers-reduced-motion CSS rule present:', r.reducedMotionCSS);
  console.log('speed after reduced-motion boot:', await page.evaluate(() => document.querySelector('#speeds .on')?.dataset.s), 'rays:', await page.evaluate(() => document.querySelector('#tRays').checked));
  await b.close();
  // desktop: does clicking active "Przegląd" reset camera after a fly-to?
  const b2 = await launch();
  const { page: p } = await open(b2);
  const cam = () => p.evaluate(() => { const c = window.__witkowo.cam.position; return [c.x, c.y, c.z].map((v) => +v.toFixed(1)); });
  const c0 = await cam();
  await p.evaluate(() => { const d = document.querySelector('details[data-acc=objects]'); d.open = true; document.querySelector('#objects li[data-id="inverters"]').click(); });
  await p.waitForTimeout(2000); await p.evaluate(() => document.querySelector('#pclose')?.click());
  const c1 = await cam();
  await p.click('#modes [data-mode=iso]'); await p.waitForTimeout(2000);
  console.log('cam start', c0, 'after fly', c1, 'after clicking Przeglad', await cam());
  await p.keyboard.press('Escape'); await p.waitForTimeout(1500); console.log('after Esc', await cam());
  await p.keyboard.press('h'); await p.waitForTimeout(1500); console.log('after h', await cam());
  await b2.close();
})();
