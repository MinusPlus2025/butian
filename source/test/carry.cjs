const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=c' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true; B.interact(B.G.ores[0]); });
  for (const off of [0, 0.6, 1.0, Math.PI]) {
    await p.evaluate(off => { const B = __butian, F = B.FP(); B.teleport(F.x + 3, F.y + 3); const c = B.player.pos; B.player.yaw = Math.atan2(-(F.x - c.x), -(F.y - c.y)) + off; }, off);
    await p.waitForTimeout(10000);
    console.log(off, await p.evaluate(() => [document.getElementById('prompt').textContent, document.getElementById('guide-text').textContent]));
  }
  console.log('errors:', errs.join(' | ')); await b.close();
})();
