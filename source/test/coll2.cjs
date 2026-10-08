const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=k' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true; B.interact(B.G.ores[0]); const F = B.FP(); B.teleport(F.x + 4, F.y); B.player.yaw = Math.PI / 2; });
  await p.keyboard.down('KeyW'); await p.waitForTimeout(12000); await p.keyboard.up('KeyW'); await p.evaluate(() => { __butian.sp().visible = true; __butian.player.pitch = -0.35; }); await p.waitForTimeout(20000); await p.screenshot({ path: 's3/furnace3m.jpg', quality: 70, timeout: 300000 });
  console.log(await p.evaluate(() => { const B = __butian, F = B.FP(); return [Math.hypot(B.player.pos.x - F.x, B.player.pos.z - F.y).toFixed(2), document.getElementById('prompt').textContent, B.G.t.toFixed(1)]; }));
  console.log('errors:', errs.join(' | ')); await b.close();
})();
