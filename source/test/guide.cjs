const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=g' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { const B = __butian; B.startGame(); B.sp().visible = false; B.G.phase = 'play'; document.getElementById('cine').hidden = true; });
  await p.waitForTimeout(3000);
  for (const [name, off] of [['ahead', 0], ['behind', Math.PI], ['target-right', Math.PI / 2], ['target-left', -Math.PI / 2]]) {
    await p.evaluate(off => { const B = __butian; const lab = document.getElementById('guide-text').textContent; const o = B.G.ores.find(o => lab.includes(o.el.zh + '石')); const c = B.player.pos; B.player.yaw = Math.atan2(-(o.home.x - c.x), -(o.home.z - c.z)) + off; B.player.pitch = -0.1; }, off);
    await p.waitForTimeout(12000);
    console.log(name, await p.evaluate(() => { const g = document.getElementById('guide'); return [g.className, g.style.transform, document.getElementById('guide-arrow').style.transform, document.getElementById('guide-text').textContent]; }));
  }
  await b.close();
})();
