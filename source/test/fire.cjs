const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=f' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 300000 });
  for (let k = 0; k < 5; k++) console.log(await p.evaluate(() => { const B = __butian; B.startGame(); const c = B.player.pos; return c.x + ',' + c.z + ' | ' + B.G.ores.map(o => o.el.key[0] + o.home.x.toFixed(1) + ',' + o.home.z.toFixed(1)).join(' '); }));
  await p.evaluate(() => { const B = __butian; B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true; ['hud','guide','keys'].forEach(i => document.getElementById(i) && (document.getElementById(i).hidden = true));
    const F = B.FP(); B.player.pos.set(F.x, B.gy(F.x, F.y + 5) , F.y + 5); B.player.yaw = 0; B.player.pitch = 0.1; B.setPause(false); });
  await p.waitForTimeout(6000); await p.screenshot({ path: 's3/fire_idle.jpg', quality: 80, timeout: 300000 });
  await p.evaluate(() => { const B = __butian, o = B.G.ores[1]; o.taken = true; o.stone.visible = true; B.G.forgeEl = o; B.G.forging = 0.5; });
  await p.waitForTimeout(1500); await p.screenshot({ path: 's3/fire_forge.jpg', quality: 80, timeout: 300000 });
  console.log('errors:', errs.join(' | ')); await b.close();
})();
