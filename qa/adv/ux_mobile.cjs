// UX critique screenshots for touch viewports. node qa/adv/ux_mobile.cjs <w> <h> <dpr>
const path = require('path');
const { open, launch, OUT } = require('./h.cjs');
const Wd = +process.argv[2] || 390, Hd = +process.argv[3] || 844, DPR = +process.argv[4] || 3, P = `ux_${Wd}x${Hd}_`;
const shot = (page, n) => page.screenshot({ path: path.join(OUT, P + n + '.png') });
const setR = (page, id, v) => page.evaluate(([id, v]) => { const r = document.querySelector(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const clk = (page, sel) => page.evaluate((sel) => { const i = document.querySelector(sel); const d = i && i.closest('details'); if (d) d.open = true; i && i.click(); }, sel);
(async () => {
  const b = await launch();
  const { ctx, page, logs } = await open(b, '', {}, { viewport: { width: Wd, height: Hd }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
  await page.waitForTimeout(2500);
  const step = async (n, fn, wait = 1500) => { try { await fn(); await page.waitForTimeout(wait); await shot(page, n); } catch (e) { console.log('FAIL', n, e.message.split('\n')[0]); } };
  await step('01_default', async () => {}, 10);
  await step('02_menu', () => page.tap('#menuBtn'), 800);
  await page.evaluate(() => { const d = document.querySelector('#drawer'); d.scrollTop = d.scrollHeight / 2; });
  await step('03_menu_mid', async () => {}, 300);
  await page.evaluate(() => { document.querySelectorAll('details.acc').forEach((d) => (d.open = true)); const d = document.querySelector('#drawer'); d.scrollTop = d.scrollHeight; });
  await step('04_menu_end', async () => {}, 300);
  // audit: small targets & small text in drawer + HUD
  const audit = await page.evaluate(() => {
    const small = [], tiny = [];
    document.querySelectorAll('button, input, select, label.tog, [role=button], summary, li.item, a').forEach((el) => {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      if (r.height < 44 || r.width < 44) small.push(`${el.tagName.toLowerCase()}#${el.id || ''}.${(el.className || '').toString().split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 18)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    const seen = new Set();
    document.querySelectorAll('body *').forEach((el) => {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); const r = el.getBoundingClientRect(); if (!r.width) return;
      if (fs < 12) { const k = `${fs}px ${cs.color} "${el.textContent.trim().slice(0, 30)}"`; if (!seen.has(k)) { seen.add(k); tiny.push(k); } }
    });
    return { small: small.slice(0, 60), nSmall: small.length, tiny: tiny.slice(0, 40), nTiny: tiny.length };
  });
  console.log(JSON.stringify(audit, null, 1));
  await page.evaluate(() => { const d = document.querySelector('#drawer'); d.scrollTop = 0; });
  await page.tap('#menuBtn').catch(() => {}); await page.waitForTimeout(700);
  await step('05_menu_closed', async () => {}, 200);
  await step('06_walk', () => clk(page, '#modes [data-mode=walk]'), 2500);
  await step('07_plan', () => clk(page, '#modes [data-mode=top]'), 2500);
  await clk(page, '#modes [data-mode=iso]'); await page.waitForTimeout(2000);
  await step('08_select', () => clk(page, '#objects li[data-id="pv"]'), 2500);
  await page.evaluate(() => document.querySelector('#pclose')?.click()); await page.waitForTimeout(800);
  await step('09_report', () => clk(page, '#bReport'), 4000);
  await page.evaluate(() => document.querySelector('#pclose')?.click()); await page.waitForTimeout(800);
  await step('10_xray', () => clk(page, '#tFlows'), 2000);
  await clk(page, '#tFlows');
  await step('11_winter', () => clk(page, '#seasons [data-season=winter]'), 3000);
  await step('12_under', () => clk(page, '#tUnder'), 4000);
  await clk(page, '#tUnder'); await page.waitForTimeout(1000);
  await step('13_picker', () => clk(page, '#bLoc'), 4000);
  console.log(logs.slice(0, 5).join('\n'));
  await b.close();
})();
