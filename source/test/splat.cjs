const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(process.env.URL);
  await p.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 120000 });
  await p.evaluate(() => document.getElementById('start').click()); await p.waitForTimeout(500);
  const info = await p.evaluate(() => ({ fail: __butian.G.failLevel, ores: __butian.G.ores.map(o => [o.el.key, o.home.x, o.home.y.toFixed(1), o.home.z]), start: __butian.player.pos.toArray().map(v=>v.toFixed(1)) }));
  console.log(JSON.stringify(info));
  const shots = JSON.parse(process.argv[2]);
  for (const [name, js] of shots) { await p.evaluate(js); await p.waitForTimeout(2500); await p.screenshot({ path: 'test/s-' + name + '.png', timeout: 120000 }); }
  console.log(errs.slice(0, 8).join('\n')); await b.close();
})();
