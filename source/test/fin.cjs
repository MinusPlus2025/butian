const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=f' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true; B.win(); });
  await p.waitForTimeout(3000);
  for (const [t, n] of [[24, 'birds'], [33.5, 'dissolve']]) {
    await p.evaluate(t => { const G = __butian.G; for (let k = 1; k < 5; k++) G['fin' + k] = 1; G.endT = t; }, t);
    await p.waitForFunction(t => __butian.G.endT > t + 0.6, t, { timeout: 600000 });
    await p.evaluate(() => { __butian.setPause(true); document.getElementById('pause').hidden = true; });
    await p.waitForTimeout(5000); await p.screenshot({ path: 's3/fin-' + n + '.jpg', quality: 75, timeout: 300000 });
    await p.evaluate(() => { __butian.setPause(false); document.getElementById('pause').hidden = true; });
  }
  console.log('errors:', errs.slice(0, 6).join(' | ')); await b.close();
})();
