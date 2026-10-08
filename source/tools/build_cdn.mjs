import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'esm', write: false, target: 'es2020',
  external: ['three', 'three/*', '@sparkjsdev/spark'] });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const im = { imports: { three: 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js', 'three/examples/jsm/': 'https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/', '@sparkjsdev/spark': 'https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@2.3.1/dist/spark.module.js' } };
let html = fs.readFileSync('src/shell.html', 'utf8');
html = html.replace('<!--SCRIPT-->', () => `<script type="importmap">${JSON.stringify(im)}</script>\n<script type="module">${js}</script>`);
fs.writeFileSync('dist/template_cdn.html', html);
console.log('template', html.length);
