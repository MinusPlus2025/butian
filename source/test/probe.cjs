const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 400, height: 300 } });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto('http://localhost:8765/?v=p' + Date.now());
  await p.waitForFunction(() => window.__butian && !document.getElementById('start').disabled, null, { timeout: 240000 });
  const r = await p.evaluate(() => { const sp = __butian.sp(); sp.visible = false; const ps = sp.packedSplats; const s = sp.scale.x;
    const H = {}; let n = 0, ys = [1e9, -1e9];
    ps.forEachSplat((i, c, sc, q, op, col) => { const y = c.y * s, x = c.x * s, z = c.z * s; n++; ys[0] = Math.min(ys[0], y); ys[1] = Math.max(ys[1], y);
      if (y < 12) return; const d = col.r - col.b; const near = Math.abs(x + 1) < 10 ? 'near' : 'far'; const k = near + (Math.round(d * 10) / 10); H[k] = (H[k] || 0) + 1; });
    return { n, ys, H, scale: s, q: sp.quaternion.toArray() }; });
  console.log(JSON.stringify(r)); await b.close();
})();
