const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(process.env.URL || ('file://' + process.cwd() + '/dist/index.html'));
  await p.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 120000 });
  await p.click('#start'); await p.waitForTimeout(800);
  const views = JSON.parse(process.argv[2]);
  for (const [name, x, z, yaw, pitch, js] of views) {
    await p.evaluate(([x, z, yaw, pitch, js]) => { __butian.teleport(x, z); __butian.player.yaw = yaw; __butian.player.pitch = pitch; if (js) eval(js); }, [x, z, yaw, pitch, js || '']);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: 'test/v-' + name + '.png' });
  }
  console.log(errs.join('\n'));
  await b.close();
})();
