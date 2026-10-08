const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=st' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  for (let k = 0; k < 4; k++) console.log(await p.evaluate(() => { const B = __butian; B.startGame(); const c = B.player.pos; return [c.x, c.z, c.y.toFixed(1), B.player.yaw.toFixed(2), Math.min(...B.G.ores.map(o => Math.hypot(o.home.x - c.x, o.home.z - c.z))).toFixed(1)].join(' '); }));
  await p.evaluate(() => { const B = __butian; B.G.phase = 'play'; document.getElementById('cine').hidden = true; document.getElementById('keys') && (document.getElementById('keys').hidden = true); });
  await p.waitForTimeout(25000); await p.screenshot({ path: 's3/start.jpg', quality: 75, timeout: 300000 });
  console.log('errors:', errs.join(' | ')); await b.close();
})();
