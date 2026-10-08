const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 200, height: 120 } });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=g' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 300000 });
  const out = await p.evaluate(() => { __butian.sp().visible = false; const rows = []; for (let z = 30; z >= -38; z -= 2) { let r = (z + '').padStart(4) + ' '; for (let x = -14; x <= 4; x += 1) { const y = __butian.gy(x, z); r += (y < -1 ? ' ~~' : y > 6 ? ' ##' : (Math.round(y) + '').padStart(3)); } rows.push(r); } return rows.join('\n'); });
  console.log('x: -14..4'); console.log(out); await b.close();
})();
