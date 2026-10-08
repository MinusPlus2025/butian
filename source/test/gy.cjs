const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 200 } });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=y' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  console.log(await p.evaluate(() => { const B = __butian, out = []; for (let z = -36; z <= 28; z += 4) { let row = 'z' + z + ':'; for (let x = -14; x <= 4; x += 2) row += ' ' + B.gy(x, z).toFixed(1); out.push(row); } return out.join('\n'); }));
  await b.close();
})();
