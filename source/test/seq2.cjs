const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 180 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 150)); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=q2' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled && __butian.wb(), null, { timeout: 600000, polling: 2000 });
  await p.evaluate(() => { const w = __butian.wbo(); window.__wbv = false; Object.defineProperty(w, 'visible', { get() { return false; }, set(v) { window.__wbv = v; } }); });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true;
    ['wood','fire','earth','metal','water'].forEach(k => B.forgeDone(B.G.ores.find(o => o.el.key === k))); });
  const t0 = Date.now();
  await p.waitForFunction(() => __butian.G.rev, null, { timeout: 1800000, polling: 1000 }); console.log('rev started', (Date.now() - t0) / 1000, await p.evaluate(() => [__butian.G.phase, window.__wbv]));
  await p.waitForFunction(() => __butian.G.phase === 'won', null, { timeout: 1800000, polling: 1000 }); console.log('won', (Date.now() - t0) / 1000, await p.evaluate(() => JSON.stringify({ live: __butian.G.rev.live, t: __butian.G.rev.t.toFixed(1) })));
  await p.waitForFunction(() => !__butian.G.rev.live, null, { timeout: 1800000, polling: 1000 });
  console.log('rev done', await p.evaluate(() => [window.__wbv, __butian.sp().visible, __butian.G.endT.toFixed(1)]));
  console.log('errors:', [...new Set(errs)].filter(e => !/Clock|ERR_FAILED/.test(e)).slice(0, 8).join(' | ')); await b.close();
})();
