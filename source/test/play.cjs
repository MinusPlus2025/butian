const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('file://' + process.cwd() + '/' + (process.argv[2] || 'dist/index.html'));
  await p.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 120000 });
  const out = process.argv[3] || 'test/shots';
  require('fs').mkdirSync(out, { recursive: true });
  await p.screenshot({ path: out + '/0-intro.png' });
  await p.evaluate(() => document.getElementById('start').click()); await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/1-start.png' });
  const order = (process.argv[4] || 'water,wood,fire,earth,metal').split(',');
  const look = async (yaw, pitch) => p.evaluate(([y, pt]) => { __butian.player.yaw = y; __butian.player.pitch = pt; }, [yaw, pitch]);
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const pos = await p.evaluate(k => __butian.EL.find(e => e.key === k).pos, k);
    await p.evaluate(([x, z]) => __butian.teleport(x, z + 9), pos); await look(0, -0.15); await p.waitForTimeout(400);
    if (i === 0) await p.screenshot({ path: out + `/2-ore-${k}.png` });
    await p.evaluate(([x, z]) => __butian.teleport(x, z + 2), pos); await p.waitForTimeout(200);
    await p.keyboard.press('KeyE'); await p.waitForTimeout(300);
    await p.evaluate(() => __butian.teleport(8, 113)); await look(0, 0.1); await p.waitForTimeout(300);
    await p.keyboard.press('KeyE'); await p.waitForFunction(n => __butian.G.chain.length >= n || __butian.G.mistakes > 0, i + 1, { timeout: 60000 }).catch(() => console.log('forge timeout'));
    if (i === 0) await p.screenshot({ path: out + `/3-forged.png` });
    await look(0, 0.55); await p.waitForFunction(() => __butian.G.restoreAnim.every((r, j) => r === 0 || r >= 1), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(500);
    if (i === 0 || i === 2) await p.screenshot({ path: out + `/4-mended-${i}.png` });
    await p.evaluate(([x, z]) => __butian.teleport(x, z + 30), pos); await look(0, -0.2); await p.waitForTimeout(3000);
    if (i < 3) await p.screenshot({ path: out + `/5-region-${k}.png` });
    console.log(k, await p.evaluate(() => ({ chain: __butian.G.chain.join(','), water: __butian.G.water.toFixed(2), phase: __butian.G.phase, miss: __butian.G.mistakes })));
  }
  await p.waitForFunction(() => !document.getElementById('end').hidden, null, { timeout: 120000 }).catch(() => console.log('no end screen'));
  await p.screenshot({ path: out + '/6-end.png' });
  console.log('final', await p.evaluate(() => ({ phase: __butian.G.phase, fail: __butian.G.failLevel })));
  console.log(errs.slice(0, 15).join('\n'));
  await b.close();
})();
