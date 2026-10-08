const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/warn|error/.test(m.type())) errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=hi' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  const setup = () => p.evaluate(() => { const B = __butian; B.G.phase = 'play'; B.G.paused = false; document.getElementById('cine').hidden = true; document.getElementById('hud').hidden = true; document.getElementById('keys') && (document.getElementById('keys').hidden = true); B.player.pos.set(-3, B.gy(-3, -8) + 1.6, -8); B.player.yaw = 0; B.player.pitch = 0.05; });
  await p.evaluate(() => { __butian.startGame(); window.__lo = __butian.sp(); });
  await setup(); await p.waitForTimeout(8000);
  await p.screenshot({ path: 's3/lo.jpg', quality: 80, timeout: 300000 });
  await p.waitForFunction(() => __butian.sp() !== window.__lo, null, { timeout: 600000, polling: 2000 });
  console.log('hi swapped');
  await setup(); await p.waitForTimeout(8000);
  await p.screenshot({ path: 's3/hi.jpg', quality: 80, timeout: 300000 });
  await p.waitForFunction(() => __butian.wb(), null, { timeout: 600000, polling: 2000 });
  console.log('B loaded');
  await p.evaluate(() => { const B = __butian; B.player.pos.set(2, B.gy(2, 14) + 4, 14); B.player.yaw = 0; B.player.pitch = 0.25; });
  for (const t of [2.2, 3.6, 5]) { await p.evaluate(t => __butian.revive(t), t); await p.waitForTimeout(6000); await p.screenshot({ path: `s3/rev${t}.jpg`, quality: 80, timeout: 300000 }); console.log('rev', t); }
  console.log('errors:', errs.slice(0, 8).join(' | ')); await b.close();
})();
