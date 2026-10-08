const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=s' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  for (let k = 0; k < 3; k++) console.log(await p.evaluate(() => { __butian.startGame(); __butian.sp().visible = false; return __butian.G.ores.map(o => o.el.zh + ':' + o.home.x.toFixed(0) + ',' + o.home.z.toFixed(0) + ',' + o.home.y.toFixed(1)).join(' '); }));
  await p.evaluate(() => { const B = __butian; B.G.phase = 'play'; B.G.t0 = B.G.t - 125; B.win(); B.G.endT = 50; });
  await p.waitForTimeout(4000);
  console.log(await p.evaluate(() => ['end-time', 'end-best', 'end-miss'].map(i => document.getElementById(i).textContent)));
  console.log('errors:', errs.join(' | ')); await b.close();
})();
