const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => console.log('C', m.type(), m.text().slice(0, 200)));
  p.on('requestfinished', r => { if (/spz/.test(r.url())) console.log('got', r.url().split('/').pop(), Date.now() % 1e6); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=ph' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { __butian.startGame(); window.__lo = __butian.sp(); __butian.sp().visible = false; });
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(10000); const s = await p.evaluate(() => [__butian.sp() !== window.__lo, !!__butian.wb()]); console.log(i, s); if (s[1]) break; }
  await b.close();
})();
