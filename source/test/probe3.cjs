const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=p' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; B.win(); B.crackSegs.forEach(s => { s.orb.material.opacity = 1; s.orb.material.color.set(0x00ff00); s.orb.scale.setScalar(0.3); }); });
  await p.waitForFunction(() => __butian.G.endT > 9.5, null, { timeout: 900000 });
  const shot = async (n, fn) => { await p.evaluate(fn); await p.evaluate(() => { __butian.setPause(true); document.getElementById('pause').hidden = true; document.getElementById('cine').hidden = true; });
    await p.waitForTimeout(8000); await p.screenshot({ path: 's3/' + n + '.jpg', quality: 70, timeout: 240000 }); };
  await shot('p-heal', () => { __butian.G.healR = 999; });
  
  console.log(await p.evaluate(() => __butian.crackSegs.map(s => s.center.toArray().map(v => +v.toFixed(1)))));
  await b.close();
})();
