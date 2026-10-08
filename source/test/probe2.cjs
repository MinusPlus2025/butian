const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 400, height: 300 } });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=p' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  const r = await p.evaluate(() => { const sp = __butian.sp(); sp.visible = false; const ps = sp.packedSplats; const s = sp.scale.x;
    const B = {};
    ps.forEachSplat((i, c, sc, q, op, col) => { const y = c.y * s, x = c.x * s, z = c.z * s; const d = col.r - col.b; if (y < 12 || d < 0.3 || op < 0.2) return;
      const k = 'z' + Math.round(z / 10) * 10; const o = B[k] || (B[k] = { n: 0, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }); o.n++; o.x0 = Math.min(o.x0, x); o.x1 = Math.max(o.x1, x); o.y0 = Math.min(o.y0, y); o.y1 = Math.max(o.y1, y); });
    return B; });
console.log(JSON.stringify(r)); await b.close();
})();
