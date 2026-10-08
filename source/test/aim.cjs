const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=a' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true; B.interact(B.G.ores[0]); const F = B.FP(); B.teleport(F.x, F.y + 4); const c = B.player.pos; B.player.yaw = Math.atan2(-(F.x - c.x), -(F.y - c.y)) + 0.6; B.player.pitch = 0.3; });
  await p.waitForTimeout(5000);
  const before = await p.evaluate(() => [__butian.player.yaw.toFixed(2), __butian.player.pitch.toFixed(2), document.getElementById('prompt').textContent]);
  await p.keyboard.press('KeyE'); await p.waitForTimeout(20000);
  const after = await p.evaluate(() => { const B = __butian, F = B.FP(), c = B.player.pos; return [B.player.yaw.toFixed(2), Math.atan2(-(F.x - c.x), -(F.y - c.y)).toFixed(2), B.player.pitch.toFixed(2), B.G.chain.length, B.G.forging]; });
  console.log(before, after, 'errors:', errs.join(' | ')); await b.close();
})();
