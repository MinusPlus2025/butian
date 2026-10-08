const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=t' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  await p.evaluate(() => { __butian.startGame(); });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const B = __butian; B.sp().visible = false; B.G.phase = 'play'; document.getElementById('keys') && (document.getElementById('keys').hidden = true); document.getElementById('cine') && (document.getElementById('cine').hidden = true);
    const order = ['wood','fire','earth','metal','water']; const ores = B.G.ores;
    order.forEach(k => { const o = ores.find(o => o.el.key === k); B.forgeDone(o); }); });
  const shotAt = async (t, name) => {
    await p.waitForFunction(t => __butian.AV.fly && __butian.AV.fly.t >= t, t, { timeout: 600000 });
    await p.evaluate(() => { __butian.setPause(true); __butian.sp().visible = true; document.getElementById('pause').hidden = true; });
    await p.waitForTimeout(9000); await p.screenshot({ path: 's3/' + name + '.jpg', quality: 70, timeout: 240000 });
    await p.evaluate(() => { __butian.sp().visible = false; __butian.setPause(false); document.getElementById('pause').hidden = true; });
    console.log(name, await p.evaluate(() => [__butian.AV.fly && __butian.AV.fly.t, __butian.G.water, __butian.G.healR].map(v => +(+v).toFixed(2))));
  };
  await shotAt(8.5, 'c-spread'); await shotAt(11, 'd-spreadend'); await shotAt(12.6, 'e-cool');
  await p.waitForFunction(() => __butian.G.phase === 'won', null, { timeout: 600000 });
  for (const [t, n] of [[3, 'f-won3'], [15, 'g-reed']]) {
    await p.waitForFunction(t => __butian.G.endT >= t, t, { timeout: 900000 });
    await p.evaluate(() => { __butian.setPause(true); __butian.sp().visible = true; document.getElementById('pause').hidden = true; });
    await p.waitForTimeout(9000); await p.screenshot({ path: 's3/' + n + '.jpg', quality: 70, timeout: 240000 });
    console.log(n, await p.evaluate(() => [__butian.G.endT, __butian.G.water].map(v => +(+v).toFixed(2))));
    await p.evaluate(() => { __butian.sp().visible = false; __butian.setPause(false); document.getElementById('pause').hidden = true; });
  }
  console.log(errs.slice(0, 8).join('\n')); await b.close();
})();
