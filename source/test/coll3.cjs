const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=k' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true; B.interact(B.G.ores[0]); const F = B.FP(); B.teleport(F.x + 4, F.y); B.player.yaw = Math.PI / 2; });
  await p.keyboard.down('KeyW'); await p.waitForTimeout(12000); await p.keyboard.up('KeyW'); console.log(await p.evaluate(() => { const B = __butian, F = B.FP(); return { py: B.player.pos.y, fy: B.G.furnace.y, gyF: B.gy(F.x, F.y), gyP: B.gy(B.player.pos.x, B.player.pos.z), cam: B.pick(0, 0) }; }));
  console.log(await p.evaluate(() => { const B = __butian, F = B.FP(); return [Math.hypot(B.player.pos.x - F.x, B.player.pos.z - F.y).toFixed(2), document.getElementById('prompt').textContent, B.G.t.toFixed(1)]; }));
  console.log('errors:', errs.join(' | ')); await b.close();
})();
