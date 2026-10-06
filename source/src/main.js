// 补天 · Mending the Sky — Tripothon S1
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh, dyno } from '@sparkjsdev/spark';

const CFG = Object.assign({
  assets: {},          // { wood, fire, earth, metal, water, furnace, villager } -> glb urls
  world: null,         // { spz, collider, regions, start, furnace, water, scale }
}, window.BUTIAN_CONFIG || {});

// ---------- 五行 ----------
const EL = [
  { key: 'wood',  zh: '木', name: '青石', en: 'Wood',  color: 0x4fa36a, note: 329.63, pos: [-62, 38] },
  { key: 'fire',  zh: '火', name: '赤石', en: 'Fire',  color: 0xd9472f, note: 392.00, pos: [72, 8] },
  { key: 'earth', zh: '土', name: '黄石', en: 'Earth', color: 0xdcae3c, note: 261.63, pos: [32, -28] },
  { key: 'metal', zh: '金', name: '白石', en: 'Metal', color: 0xeeeae0, note: 293.66, pos: [-34, -96] },
  { key: 'water', zh: '水', name: '黑石', en: 'Water', color: 0x2f5fb0, note: 440.00, pos: [30, 66] },
];
const NEXT = { wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' };
const REGION_R = 62;
const FURNACE_POS = new THREE.Vector2(8, 108);
const START_POS = new THREE.Vector2(0, 122);

// ---------- terrain (procedural fallback world) ----------
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) { let s = 0, a = 1, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); a *= 0.5; f *= 2.03; } return s / 1.875; }
const riverX = z => 26 * Math.sin(z * 0.018) + 10 * Math.sin(z * 0.045 + 1.3);
function bump(x, z, cx, cz, r, h) { const d = Math.hypot(x - cx, z - cz) / r; return d < 1 ? h * (1 - d * d) * (1 - d * d) : 0; }
function terrainH(x, z) {
  const dx = Math.abs(x - riverX(z));
  let h = Math.min(dx * dx * 0.0011, 16) + dx * 0.02;                 // gentle valley floor
  h += fbm(x * 0.03, z * 0.03) * 6 - 2.5;
  h += Math.max(0, -z - 85) * 0.7;                                     // north mountains
  h += Math.max(0, Math.abs(x) - 105) * 1.1;                           // side walls
  h += bump(x, z, 72, 8, 34, 6);                                       // fire ridge
  h += bump(x, z, -34, -96, 30, 4);
  h += bump(x, z, 32, -28, 30, 2.5);                                  // metal foothill
  h += bump(x, z, FURNACE_POS.x, FURNACE_POS.y, 26, 6);                // furnace terrace
  h += bump(x, z, START_POS.x, START_POS.y, 18, 3);
  if (dx < 10) h -= (10 - dx) * 0.55;                                  // riverbed
  return h;
}

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 3000);
scene.fog = new THREE.Fog(0xb9bcc0, 60, 420);
scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x5a5048, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(-80, 140, 60); scene.add(sun);

// shared restoration uniforms
const U = {
  uReg: { value: EL.map(e => new THREE.Vector4(e.pos[0], 0, e.pos[1], REGION_R)) },
  uRes: { value: [0, 0, 0, 0, 0] },
  uElc: { value: EL.map(e => new THREE.Color(e.color)) },
  uAll: { value: 0 },
};
const RESTORE_GLSL = /* glsl */`
  float m = uAll;
  vec3 rim = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    if (uRes[i] <= 0.0) continue;
    float r = uReg[i].w * uRes[i];
    float d = distance(vWP.xz, uReg[i].xz);
    m = max(m, 1.0 - smoothstep(r * 0.72, r, d));
    rim += uElc[i] * (smoothstep(r - 6.0, r, d) - smoothstep(r, r + 2.0, d)) * (1.0 - uRes[i] * uRes[i]) * 1.6;
  }
  vec3 col = gl_FragColor.rgb;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 grey = vec3(pow(l, 1.15)) * vec3(0.86, 0.88, 0.91);
  gl_FragColor.rgb = mix(grey, col, clamp(m, 0.0, 1.0)) + rim;
`;
function patchMat(mat) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <project_vertex>',
      `#include <project_vertex>
       vec4 wp4 = vec4(transformed, 1.0);
       #ifdef USE_INSTANCING
         wp4 = instanceMatrix * wp4;
       #endif
       vWP = (modelMatrix * wp4).xyz;`);
    sh.fragmentShader = 'varying vec3 vWP;\nuniform vec4 uReg[5];\nuniform float uRes[5];\nuniform vec3 uElc[5];\nuniform float uAll;\n' +
      sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + RESTORE_GLSL);
  };
  return mat;
}

// sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uSat: { value: 0 }, uT: { value: 0 } },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vD; uniform float uSat; uniform float uT;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      float y = clamp(vD.y, 0.0, 1.0);
      vec3 top = vec3(0.30, 0.52, 0.80), hor = vec3(0.98, 0.82, 0.62);
      vec3 c = mix(hor, top, pow(y, 0.55));
      vec2 uv = vD.xz / (vD.y + 0.25) * 2.0 + vec2(uT * 0.01, 0.0);
      float cl = smoothstep(0.55, 0.85, n(uv) * 0.6 + n(uv * 2.3) * 0.4);
      c = mix(c, vec3(1.0, 0.97, 0.93), cl * 0.55 * smoothstep(0.02, 0.3, vD.y));
      float l = dot(c, vec3(0.299,0.587,0.114));
      vec3 g = mix(vec3(l) * vec3(0.78,0.79,0.82), vec3(0.42,0.43,0.46), 0.35);
      gl_FragColor = vec4(mix(g, c, uSat), 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
scene.add(sky);

// ---------- the crack in the sky ----------
const crack = new THREE.Group(); scene.add(crack);
const crackSegs = [];
(function buildCrack() {
  const pts = [];
  const rnd = (i) => hash(i, 7.7) - 0.5;
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    const x = -420 + t * 840;
    const y = 230 + Math.sin(t * Math.PI) * 110 + (i % 2 ? 1 : -1) * (12 + Math.abs(rnd(i)) * 36);
    const z = -380 + rnd(i + 99) * 30;
    pts.push(new THREE.Vector3(x, y, z));
  }
  for (let s = 0; s < 5; s++) {
    const seg = pts.slice(s * 10, s * 10 + 11);
    const curve = new THREE.CatmullRomCurve3(seg, false, 'catmullrom', 0.05);
    const geo = new THREE.TubeGeometry(curve, 60, 9, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, fog: false, transparent: true });
    const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 26, 6, false),
      new THREE.MeshBasicMaterial({ color: 0xffe2b0, fog: false, transparent: true, opacity: 0.18, depthWrite: false }));
    const m = new THREE.Mesh(geo, mat);
    crack.add(m, glow);
    crackSegs.push({ mesh: m, glow, mended: 0, el: null, center: curve.getPoint(0.5) });
  }
})();

// ---------- world: procedural fallback ----------
const world = new THREE.Group(); scene.add(world);
let groundMeshes = [];
let groundFn = terrainH;
function buildProceduralWorld() {
  const W = 300, D = 340, SX = 150, SZ = 170;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; const cols = new Float32Array(p.count * 3); const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = terrainH(x, z); p.setY(i, y);
    const dx = Math.abs(x - riverX(z));
    if (y > 24) c.setHSL(0.6, 0.08, 0.86);                                 // snow / white stone (metal)
    else if (dx < 11) c.setHSL(0.11, 0.35, 0.62);                          // river sand
    else c.setHSL(0.27 - fbm(x * 0.05, z * 0.05) * 0.06, 0.45, 0.36 + fbm(x * .1, z * .1) * 0.08);
    const near = (k) => Math.max(0, 1 - Math.hypot(x - EL[k].pos[0], z - EL[k].pos[1]) / 55);
    c.lerp(new THREE.Color().setHSL(0.03, 0.55, 0.42), near(1) * 0.85);    // fire: red rock
    c.lerp(new THREE.Color().setHSL(0.12, 0.65, 0.55), near(2) * 0.8);     // earth: golden fields
    c.lerp(new THREE.Color().setHSL(0.33, 0.5, 0.30), near(0) * 0.6);      // wood: deep green
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, patchMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })));
  world.add(ground); groundMeshes = [ground];

  // trees
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 2.4, 5); trunk.translate(0, 1.2, 0);
  const crown = new THREE.ConeGeometry(2.2, 6.5, 6); crown.translate(0, 5.2, 0);
  const pine = mergeColored([[trunk, 0x5b3d2a], [crown, 0x2f7a46]]);
  const blossom = new THREE.IcosahedronGeometry(1.6, 0); blossom.translate(0, 4.4, 0);
  const plum = mergeColored([[trunk.clone(), 0x4a3426], [blossom, 0xe58ca0]]);
  scatter(pine, 520, (x, z, y) => y < 28 && Math.abs(x - riverX(z)) > 14 && Math.hypot(x - EL[0].pos[0], z - EL[0].pos[1]) < 58 || (hash(x, z) < 0.12 && y < 24 && Math.abs(x - riverX(z)) > 14));
  scatter(plum, 70, (x, z, y) => Math.abs(x - riverX(z)) < 20 && Math.abs(x - riverX(z)) > 11 && y > 1);
  // red rocks for fire ridge, white rocks for metal
  const rock = new THREE.DodecahedronGeometry(1.6, 0);
  scatter(colorize(rock.clone(), 0xb5432c), 140, (x, z) => Math.hypot(x - EL[1].pos[0], z - EL[1].pos[1]) < 45, [0.6, 2.2]);
  scatter(colorize(rock.clone(), 0xe9e6dc), 120, (x, z) => Math.hypot(x - EL[3].pos[0], z - EL[3].pos[1]) < 50, [0.8, 3]);
  // earth: wheat tufts
  const tuft = new THREE.ConeGeometry(0.5, 1.6, 4); tuft.translate(0, 0.8, 0);
  scatter(colorize(tuft, 0xe0b443), 900, (x, z) => Math.hypot(x - EL[2].pos[0], z - EL[2].pos[1]) < 42 && Math.abs(x - riverX(z)) > 12, [0.8, 1.4]);
  // far ranges
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, r = 420 + hash(i, 3) * 120;
    const m = new THREE.Mesh(new THREE.ConeGeometry(70 + hash(i, 1) * 60, 140 + hash(i, 2) * 160, 5),
      patchMat(new THREE.MeshStandardMaterial({ color: 0x51626e, roughness: 1, flatShading: true })));
    m.position.set(Math.cos(a) * r, 40, Math.sin(a) * r); world.add(m);
  }
}
function colorize(g, hex) { const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function mergeColored(parts) {
  const geos = parts.map(([g, c]) => colorize(g.toNonIndexed ? g.toNonIndexed() : g, c));
  let n = 0; geos.forEach(g => n += g.attributes.position.count);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  geos.forEach(g => { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.computeVertexNormals(); return out;
}
function scatter(geo, count, ok, scale = [0.8, 1.3]) {
  const mesh = new THREE.InstancedMesh(geo, patchMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true })), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  let n = 0, tries = 0;
  while (n < count && tries < count * 40) {
    tries++;
    const x = (hash(tries, count) - 0.5) * 290, z = (hash(count, tries * 1.7) - 0.5) * 330, y = terrainH(x, z);
    if (!ok(x, z, y)) continue;
    const k = scale[0] + hash(x, z) * (scale[1] - scale[0]);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(z, x) * 6.28); s.set(k, k, k); v.set(x, y - 0.2, z);
    mesh.setMatrixAt(n++, m.compose(v, q, s));
  }
  mesh.count = n; world.add(mesh); return mesh;
}

// ---------- world: Marble splat (optional) ----------
let splatMesh = null;
async function buildSplatWorld(W) {
  const spark = new SparkRenderer({ renderer }); scene.add(spark);
  const uRegD = EL.map(() => new dyno.DynoVec4({ value: new THREE.Vector4() }));
  const uCrk = [0, 1, 2, 3, 4].map(i => new dyno.DynoVec4({ value: new THREE.Vector4().fromArray(W.crack ? W.crack[i] : [0, -999, 0, 0]) }));
  const uResD = new dyno.DynoVec4({ value: new THREE.Vector4() });   // regions 1-4 restore
  const uRes5 = new dyno.DynoVec4({ value: new THREE.Vector4() });   // x: region 5, y: all, z: crack 5 mended
  const uMend = new dyno.DynoVec4({ value: new THREE.Vector4() });   // crack 1-4 mended
  const mod = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, r0: 'vec4', r1: 'vec4', r2: 'vec4', r3: 'vec4', r4: 'vec4', c0: 'vec4', c1: 'vec4', c2: 'vec4', c3: 'vec4', c4: 'vec4', ra: 'vec4', rb: 'vec4', mm: 'vec4' },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, r0: uRegD[0], r1: uRegD[1], r2: uRegD[2], r3: uRegD[3], r4: uRegD[4], c0: uCrk[0], c1: uCrk[1], c2: uCrk[2], c3: uCrk[3], c4: uCrk[4], ra: uResD, rb: uRes5, mm: uMend },
      statements: ({ inputs, outputs }) => dyno.unindentLines(`
        ${outputs.gsplat} = ${inputs.gsplat};
        vec4 regs[5] = vec4[5](${inputs.r0}, ${inputs.r1}, ${inputs.r2}, ${inputs.r3}, ${inputs.r4});
        vec4 crk[5] = vec4[5](${inputs.c0}, ${inputs.c1}, ${inputs.c2}, ${inputs.c3}, ${inputs.c4});
        float res[5] = float[5](${inputs.ra}.x, ${inputs.ra}.y, ${inputs.ra}.z, ${inputs.ra}.w, ${inputs.rb}.x);
        float mend[5] = float[5](${inputs.mm}.x, ${inputs.mm}.y, ${inputs.mm}.z, ${inputs.mm}.w, ${inputs.rb}.z);
        float m = ${inputs.rb}.y;
        vec3 p = ${inputs.gsplat}.center;
        for (int i = 0; i < 5; i++) {
          if (res[i] <= 0.0) continue;
          float r = regs[i].w * res[i];
          float dd = distance(p.xz, regs[i].xz);
          m = max(m, 1.0 - smoothstep(r * 0.72, r, dd));
        }
        vec3 c = ${inputs.gsplat}.rgba.rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        vec3 vivid = clamp(vec3(l) + (c - vec3(l)) * 2.4, 0.0, 1.0) * 1.08;
        vec3 grey = vec3(pow(l, 1.12)) * vec3(0.88, 0.9, 0.94);
        vec3 outc = mix(grey, vivid, clamp(m, 0.0, 1.0));
        float op = ${inputs.gsplat}.rgba.a;
        for (int i = 0; i < 5; i++) {
          if (mend[i] <= 0.0) continue;
          float k = (1.0 - smoothstep(crk[i].w * 0.6, crk[i].w, distance(p, crk[i].xyz))) * mend[i];
          float bright = smoothstep(0.55, 0.8, l);
          outc = mix(outc, vec3(0.62, 0.74, 0.9) * mix(0.75, 1.0, m), k * bright);
          op *= 1.0 - k * bright * 0.85;
        }
        ${outputs.gsplat}.rgba = vec4(outc, op);
      `),
    });
    return { gsplat: d.outputs.gsplat };
  });
  splatMesh = new SplatMesh({ fileBytes: await loadBin(W.spz), fileType: 'spz', worldModifier: mod });
  if (W.transform) {
    const t = W.transform; if (t.position) splatMesh.position.fromArray(t.position);
    splatMesh.quaternion.fromArray(t.quaternion || [1, 0, 0, 0]); if (t.scale) splatMesh.scale.setScalar(t.scale);
  } else splatMesh.quaternion.set(1, 0, 0, 0); // Marble exports are OpenCV-style (y down)
  scene.add(splatMesh);
  splatMesh.__sync = () => {
    EL.forEach((e, i) => uRegD[i].value.copy(U.uReg.value[i]));
    const r = U.uRes.value; const cm = crackSegs.map(c => c.mended);
    uResD.value.set(r[0], r[1], r[2], r[3]); uRes5.value.set(r[4], U.uAll.value, cm[4], 0); uMend.value.set(cm[0], cm[1], cm[2], cm[3]);
    splatMesh.updateVersion();
  };
  await splatMesh.initialized;
  if (W.collider) {
    const g = await loadGLB(W.collider);
    if (g) {
      // Marble collider GLBs carry their own Y-up root transform; only apply our placement + scale
      g.position.copy(splatMesh.position); g.scale.setScalar((W.transform && W.transform.colliderScale) || splatMesh.scale.x);
      if (W.showCollider) g.traverse(o => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }); });
      g.traverse(o => { if (o.isMesh) { if (!W.showCollider) o.material.visible = false; groundMeshes.push(o); } });
      scene.add(g); g.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
      groundFn = (x, z) => { ray.set(new THREE.Vector3(x, W.rayTop ?? 400, z), down); const h = ray.intersectObjects(groundMeshes, false)[0]; return h ? h.point.y : (W.floor ?? 0); };
    }
  } else groundFn = () => (W.floor ?? 0);
}

// ---------- props ----------
const gltf = new GLTFLoader();
// binary assets ship as base64 text chunks (artifact hosting only serves text/web types)
async function loadBin(src) {
  if (typeof src === 'string' && src.startsWith('b64:')) { const bin = atob(src.slice(4)); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  if (Array.isArray(src) && src[0] && src[0].startsWith('b64:')) src = 'b64:' + src.map(s => s.slice(4)).join('');
  if (typeof src === 'string' && src.startsWith('b64:')) return loadBin(src);
  const parts = Array.isArray(src) ? src : [src];
  if (!/\.txt$/.test(parts[0])) { const r = await fetch(parts[0]); return new Uint8Array(await r.arrayBuffer()); }
  const bufs = await Promise.all(parts.map(async u => { const t = (await (await fetch(u)).text()).trim(); const bin = atob(t); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }));
  const out = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0)); let o = 0; bufs.forEach(b => { out.set(b, o); o += b.length; }); return out;
}
async function loadGLB(url) {
  try { const bytes = await loadBin(url); return await new Promise((res, rej) => gltf.parse(bytes.buffer, '', g => res(g.scene), rej)); }
  catch (e) { console.warn('glb load failed', url, e); return null; }
}
function fitTo(obj, size) {
  const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new THREE.Vector3());
  const k = size / Math.max(s.x, s.y, s.z); obj.scale.multiplyScalar(k);
  const b2 = new THREE.Box3().setFromObject(obj), c = b2.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  const wrap = new THREE.Group(); wrap.add(obj); return wrap;
}
function placeholderStone(el) {
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(0.7, 0); geo.scale(1, 1.5, 1);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: el.color, roughness: 0.25, metalness: 0.1, emissive: el.color, emissiveIntensity: 0.35, flatShading: true }));
  m.position.y = 1.05; g.add(m);
  const s2 = m.clone(); s2.scale.setScalar(0.55); s2.position.set(0.55, 0.6, 0.2); s2.rotation.z = 0.6; g.add(s2);
  return g;
}
async function makeStone(el) {
  const url = CFG.assets[el.key];
  const o = url ? await loadGLB(url) : null;
  return o ? fitTo(o, CFG.world?.stoneSize || 1.8) : placeholderStone(el);
}
async function makeFurnace() {
  const o = CFG.assets.furnace ? await loadGLB(CFG.assets.furnace) : null;
  if (o) return fitTo(o, CFG.world?.furnaceSize || 4.2);
  const g = new THREE.Group(); const bronze = new THREE.MeshStandardMaterial({ color: 0x7a5a32, metalness: 0.7, roughness: 0.45 });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.25, 1.9, 16, 1, true), bronze); bowl.position.y = 2.3; g.add(bowl);
  const base = new THREE.Mesh(new THREE.CircleGeometry(1.25, 16), bronze); base.rotation.x = -Math.PI / 2; base.position.y = 1.36; g.add(base);
  const lid = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.14, 6, 24), bronze); lid.rotation.x = Math.PI / 2; lid.position.y = 3.25; g.add(lid);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.5, 6), bronze); leg.position.set(Math.cos(a) * 0.95, 0.7, Math.sin(a) * 0.95); g.add(leg); }
  for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 6, 12, Math.PI), bronze); ear.position.set(s * 1.3, 3.5, 0); g.add(ear); }
  return g;
}
function makeVillager(i) {
  const g = new THREE.Group();
  const robe = [0xb5523b, 0x3c6e8f, 0xd2a54a, 0x5d8a4e, 0xe8e1d0][i % 5];
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.3, 7), new THREE.MeshStandardMaterial({ color: robe, roughness: 0.8 })); body.position.y = 0.65; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe9c9a8, roughness: 0.7 })); head.position.y = 1.48; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1d1a18 })); hair.position.set(0, 1.68, -0.04); g.add(hair);
  return g;
}

// ---------- water ----------
const waterMat = patchMat(new THREE.MeshStandardMaterial({ color: 0x3d6d86, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 }));
const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1).rotateX(-Math.PI / 2), waterMat);
scene.add(water);

// ---------- game state ----------
const G = {
  phase: 'intro', t: 0, water: -2.6, rate: 0.034, failLevel: 9.5,
  carrying: null, forging: 0, forgeEl: null, chain: [], mistakes: 0,
  ores: [], furnace: null, villagers: [], restoreAnim: [0, 0, 0, 0, 0], endT: 0,
};
const player = { pos: new THREE.Vector3(START_POS.x, 0, START_POS.y), yaw: 0, pitch: 0.05, vy: 0 };

const handL = new THREE.Group(); camera.add(handL); handL.visible = false;
async function setupHands() {
  if (!CFG.assets?.hand) return;
  const m = await loadGLB(CFG.assets.hand); if (!m) return;
  const H = CFG.world?.hand || {};
  const box = new THREE.Box3().setFromObject(m), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  m.position.sub(c); const k = (H.size || 0.42) / Math.max(sz.x, sz.y, sz.z);
  const wrapR = new THREE.Group(); wrapR.add(m); wrapR.scale.setScalar(k); if (H.rot) wrapR.rotation.set(...H.rot);
  hand.children.forEach(ch => { if (!ch.isLight) ch.visible = false; }); hand.rotation.set(0, 0, 0); hand.add(wrapR);
  const wrapL = wrapR.clone(); wrapL.scale.x *= -1; handL.add(wrapL); handL.add(new THREE.PointLight(0xfff0d0, 0.5, 2)); G.realHands = true;
}
async function setupProps() {
  setupHands();
  const W = CFG.world;
  if (W) {
    if (W.regions) W.regions.forEach((p, i) => { EL[i].pos = p; U.uReg.value[i].set(p[0], 0, p[1], W.regionR || REGION_R); });
    if (W.furnace) FURNACE_POS.set(W.furnace[0], W.furnace[1]);
    if (W.start) START_POS.set(W.start[0], W.start[1]);
    if (W.water) Object.assign(G, W.water);
    sky.visible = false; scene.fog.near = 400; scene.fog.far = 2000;
    water.geometry.dispose(); water.geometry = new THREE.CircleGeometry(W.waterRadius || 40, 48).rotateX(-Math.PI / 2);
    if (W.crack) crackSegs.forEach((c, i) => {
      c.mesh.visible = false; c.glow.visible = false; c.center.fromArray(W.crack[i]);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(W.crack[i][3] * 0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      orb.position.copy(c.center); scene.add(orb); c.orb = orb;
    });
  }
  for (const el of EL) {
    const stone = await makeStone(el);
    const [x, z] = el.pos; const y = groundFn(x, z);
    stone.position.set(x, y, z); scene.add(stone);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 140, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: el.color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.set(x, y + 70, z); scene.add(beam);
    const light = new THREE.PointLight(el.color, 30, 18); light.position.set(x, y + 2, z); scene.add(light);
    G.ores.push({ el, stone, beam, light, home: new THREE.Vector3(x, y, z), taken: false, used: false });
  }
  const f = await makeFurnace();
  const fy = groundFn(FURNACE_POS.x, FURNACE_POS.y);
  f.position.set(FURNACE_POS.x, fy, FURNACE_POS.y); scene.add(f);
  const fire = new THREE.PointLight(0xff8a3c, 60, 22); fire.position.set(FURNACE_POS.x, fy + 3.2, FURNACE_POS.y); scene.add(fire);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
  ember.position.set(FURNACE_POS.x, fy + 2.9, FURNACE_POS.y); scene.add(ember);
  G.furnace = { obj: f, fire, ember, y: fy };
  if (!W || W.failLevel == null) G.failLevel = fy + 0.6;
  for (let i = 0; i < 14; i++) {
    const v = makeVillager(i); v.visible = false; scene.add(v);
    const a = i * 2.39, r = 6 + (i % 4) * 4;
    const vs = CFG.world?.villagers; v.userData.spot = vs ? [vs[0] + Math.cos(a) * r * vs[2], vs[1] + Math.sin(a) * r * vs[2]] : [FURNACE_POS.x + Math.cos(a) * r, FURNACE_POS.y - 14 + Math.sin(a) * r * 0.6];
    G.villagers.push(v);
  }
}

// ---------- input ----------
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyE' && !G.paused) handAction(); if (e.code === 'Space' && G.phase === 'play' && !G.paused && !(player.jy > 0.01)) { player.jv = 7.5; noiseBurst(0.12, 500, 250, 0.08, 'lowpass'); e.preventDefault(); } if ((e.code === 'Escape' || e.code === 'KeyP') && G.phase === 'play' && !locked) setPause(!G.paused); });
addEventListener('keyup', e => { keys[e.code] = false; });
let locked = false, dragging = false, lastX = 0, lastY = 0;
document.addEventListener('pointerlockchange', () => { const was = locked; locked = document.pointerLockElement === canvas; if (was && !locked && G.phase === 'play' && matchMedia('(pointer: fine)').matches) setPause(true); });
function setPause(on) {
  if (G.phase !== 'play') on = false;
  G.paused = on; $('pause').hidden = !on;
  if (AC) { if (on) AC.suspend?.(); else AC.resume?.(); }
  if (on) document.exitPointerLock?.();
}
function quitToTitle() { setPause(false); G.phase = 'title'; $('hud').hidden = true; $('act').hidden = true; $('end').hidden = true; $('lose').hidden = true; $('intro').hidden = false; $('guide').hidden = true; if (droneG && AC) droneG.gain.value = 0; }
canvas.addEventListener('mousedown', e => {
  if (G.phase !== 'play' || G.paused) return;
  if (e.button === 0 && G.started) handAction();
  if (!locked && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', e => {
  if (G.phase !== 'play') return;
  let dx = 0, dy = 0;
  if (locked) { dx = e.movementX; dy = e.movementY; } else if (dragging) { dx = e.clientX - lastX; dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; }
  player.yaw -= dx * 0.0022; player.pitch = THREE.MathUtils.clamp(player.pitch - dy * 0.0022, -1.2, 1.35);
});
// touch: left half = move stick, right half = look
const touch = { move: null, look: null, mx: 0, my: 0 };
canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && !touch.move) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
    else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.mx = THREE.MathUtils.clamp((t.clientX - touch.move.x) / 60, -1, 1); touch.my = THREE.MathUtils.clamp((t.clientY - touch.move.y) / 60, -1, 1); }
    if (touch.look && t.identifier === touch.look.id) { player.yaw -= (t.clientX - touch.look.x) * 0.005; player.pitch = THREE.MathUtils.clamp(player.pitch - (t.clientY - touch.look.y) * 0.005, -1.2, 1.35); touch.look.x = t.clientX; touch.look.y = t.clientY; }
  }
}, { passive: true });
canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.my = 0; }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
}, { passive: true });
document.getElementById('act').addEventListener('click', () => interact());

// ---------- audio (五音: 角木 徵火 宫土 商金 羽水) ----------
let AC = null, windGain = null;
function audioInit() {
  if (AC) return; try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return; }
  const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  windGain = AC.createGain(); windGain.gain.value = 0.05;
  src.connect(f).connect(windGain).connect(AC.destination); src.start();
  const s2 = AC.createBufferSource(); s2.buffer = buf; s2.loop = true; s2.playbackRate.value = 0.5;
  const f2 = AC.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 220;
  floodGain = AC.createGain(); floodGain.gain.value = 0;
  s2.connect(f2).connect(floodGain).connect(AC.destination); s2.start();
}
let floodGain = null;
function pluck(freq, dur = 2.2, vol = 0.22, delay = 0) {
  if (!AC) return; const t0 = AC.currentTime + delay;
  [1, 2, 3.01].forEach((h, k) => {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = k ? 'sine' : 'triangle'; o.frequency.value = freq * h;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol / (k + 1), t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / (k + 1));
    o.connect(g).connect(AC.destination); o.start(t0); o.stop(t0 + dur);
  });
}
function thud() { if (!AC) return; const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(120, AC.currentTime); o.frequency.exponentialRampToValueAtTime(40, AC.currentTime + 0.6); g.gain.setValueAtTime(0.5, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.8); o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.8); }

// ---------- particles ----------
const PMAX = 1600;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.5, map: pTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
particles.frustumCulled = false; scene.add(particles);
let pNext = 0;
function emit(pos, color, n, speed = 3, up = 2, life = 1.4) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const k = pNext++ % PMAX;
    pPos[k * 3] = pos.x; pPos[k * 3 + 1] = pos.y; pPos[k * 3 + 2] = pos.z;
    const a = Math.random() * 6.283, e = Math.random() * 2 - 1, v = speed * (0.4 + Math.random() * 0.6);
    pVel[k * 3] = Math.cos(a) * Math.sqrt(1 - e * e) * v; pVel[k * 3 + 1] = e * v + up; pVel[k * 3 + 2] = Math.sin(a) * Math.sqrt(1 - e * e) * v;
    pCol[k * 3] = c.r; pCol[k * 3 + 1] = c.g; pCol[k * 3 + 2] = c.b; pLife[k] = life * (0.6 + Math.random() * 0.4);
  }
}
function updateParticles(dt) {
  for (let k = 0; k < PMAX; k++) {
    if (pLife[k] <= 0) continue;
    pLife[k] -= dt; const f = pLife[k] <= 0 ? 0 : Math.min(1, pLife[k]);
    pVel[k * 3 + 1] -= dt * 1.5; pVel[k * 3] *= 0.985; pVel[k * 3 + 2] *= 0.985;
    pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
    if (pLife[k] <= 0) { pPos[k * 3 + 1] = -9999; }
    pCol[k * 3] *= 0.995 + 0.005 * f; pCol[k * 3 + 1] *= 0.995 + 0.005 * f; pCol[k * 3 + 2] *= 0.995 + 0.005 * f;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
function banner(big, small = '', color = '#ffe9a8') { const b = document.getElementById('banner'); b.querySelector('b').textContent = big; b.querySelector('i').textContent = small; b.style.color = color; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); }
let fovKick = 0;
function noiseBurst(dur, f0, f1, vol, type = 'bandpass', delay = 0) {
  if (!AC) return; const t = AC.currentTime + delay; const n = Math.floor(AC.sampleRate * dur); const buf = AC.createBuffer(1, n, AC.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.5);
  const s = AC.createBufferSource(); s.buffer = buf; const f = AC.createBiquadFilter(); f.type = type; f.Q.value = 1.2; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = AC.createGain(); g.gain.value = vol; s.connect(f).connect(g).connect(AC.destination); s.start(t);
}
function bell(f, dur, vol, delay = 0) { if (!AC) return; const t = AC.currentTime + delay; [[1, 1], [2.76, 0.4], [5.4, 0.18], [8.9, 0.08]].forEach(([h, a]) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f * h; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / h * 1.5); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur * 1.6); }); }
function drum(vol = 0.6, delay = 0) { if (!AC) return; const t = AC.currentTime + delay; const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.35); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 1); noiseBurst(0.08, 900, 300, vol * 0.25, 'lowpass', delay); }
function sfxPick(note) { bell(note * 2, 1.6, 0.14); bell(note * 3, 1.2, 0.07, 0.09); }
function sfxForge() { drum(0.5); noiseBurst(1.6, 150, 700, 0.18, 'lowpass'); }
function sfxCrash() { drum(0.8); drum(0.6, 0.25); noiseBurst(0.6, 1200, 200, 0.2, 'lowpass'); }
function sfxMend(note) { bell(note, 4, 0.2); bell(note * 1.5, 3.5, 0.12, 0.15); bell(note * 2, 3, 0.1, 0.3); }
// ---------- narrator (browser speech, low and slow) + tension bed ----------
let zhVoice = null; const VOICE = false;
function pickVoice() { const vs = speechSynthesis?.getVoices?.() || []; zhVoice = vs.find(v => /zh[-_]CN/i.test(v.lang) && /Tingting|Yu-?shu|Xiaoxiao|Yunxi|Kangkang|Google/i.test(v.name)) || vs.find(v => /^zh/i.test(v.lang)) || null; }
try { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } catch (_) {}
function narrate(text, { rate = 0.82, pitch = 0.55, interrupt = true } = {}) {
  $('sub').textContent = text; $('sub').classList.add('on'); clearTimeout(narrate._t); narrate._t = setTimeout(() => $('sub').classList.remove('on'), 2500 + text.length * 260);
  if (!VOICE) return;
  try { if (interrupt) speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; if (zhVoice) u.voice = zhVoice; u.rate = rate; u.pitch = pitch; u.volume = 1; speechSynthesis.speak(u); } catch (_) {}
}
let hbT = 0;
function heartbeat(vol) { if (!AC) return; const t = AC.currentTime; [0, 0.22].forEach((d, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(70 - i * 12, t + d); o.frequency.exponentialRampToValueAtTime(35, t + d + 0.18); g.gain.setValueAtTime(vol * (i ? 0.7 : 1), t + d); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25); o.connect(g).connect(AC.destination); o.start(t + d); o.stop(t + d + 0.3); }); }
function stinger() { drum(0.7); drum(0.5, 0.45); return; if (!AC) return; const t = AC.currentTime; [55, 58.3, 82.4].forEach(f => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sawtooth'; o.frequency.value = f; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(200, t); lp.frequency.linearRampToValueAtTime(900, t + 2); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 4); o.connect(lp).connect(g).connect(AC.destination); o.start(t); o.stop(t + 4.1); }); noiseBurst(3, 400, 4000, 0.08); }
function flash(color) { const el = document.getElementById('flash'); el.style.background = '#' + new THREE.Color(color).getHexString(); el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }

// ---------- music: slow pentatonic guqin-like phrases over a drone ----------
const PENTA = [130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0];
let musicT = 0, droneG = null, musicBus = null, verb = null, mStep = 0;
// guqin-like plucked string: Karplus-Strong rendered once per pitch, played through a hall reverb
const ksCache = {};
function ksBuf(f) {
  const k = Math.round(f * 10); if (ksCache[k]) return ksCache[k];
  const sr = AC.sampleRate, n = Math.floor(sr * 4), buf = AC.createBuffer(1, n, sr), d = buf.getChannelData(0);
  const P = Math.max(2, Math.round(sr / f)); const line = new Float32Array(P);
  for (let i = 0; i < P; i++) line[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(Math.PI * i / P));
  let idx = 0, prev = 0;
  for (let i = 0; i < n; i++) { const cur = line[idx]; const nv = 0.996 * (0.5 * (cur + prev)); prev = cur; line[idx] = nv; d[i] = cur; idx = (idx + 1) % P; }
  return (ksCache[k] = buf);
}
function qin(f, vol = 0.25, delay = 0, slide = 0) {
  if (!AC || !musicBus) return; const t = AC.currentTime + delay;
  const s = AC.createBufferSource(); s.buffer = ksBuf(f); if (slide) { s.playbackRate.setValueAtTime(1, t + 0.25); s.playbackRate.linearRampToValueAtTime(Math.pow(2, slide / 12), t + 0.7); }
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; const g = AC.createGain(); g.gain.value = vol;
  s.connect(lp).connect(g).connect(musicBus); s.start(t);
}
function makeVerb() {
  const sr = AC.sampleRate, n = sr * 3.5, ir = AC.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.8); }
  const cv = AC.createConvolver(); cv.buffer = ir; return cv;
}
// D minor pentatonic (D F G A C), slow phrase; 0 = rest
const QF = [0, 146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0, 440.0];
const PHRASE = [6, 0, 5, 4, 0, 0, 4, 3, 2, 0, 1, 0, 0, 0, 3, 4, 6, 0, 7, 6, 5, 0, 4, 0, 3, 0, 2, 3, 1, 0, 0, 0];
function musicInit() {
  if (!AC || droneG) return;
  musicBus = AC.createGain(); musicBus.gain.value = 0.9; verb = makeVerb(); const wet = AC.createGain(); wet.gain.value = 0.45;
  musicBus.connect(AC.destination); musicBus.connect(verb).connect(wet).connect(AC.destination);
  droneG = AC.createGain(); droneG.gain.value = 0.0; const dl = AC.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 300; droneG.connect(dl).connect(musicBus);
  [73.42, 110.0, 73.6].forEach(f => { const o = AC.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = AC.createGain(); g.gain.value = 0.3; o.connect(g).connect(droneG); o.start(); });
  droneG.gain.linearRampToValueAtTime(0.06, AC.currentTime + 4);
}
let bgmEl = null;
function bgmPlay() { if (!CFG.assets?.bgm) return; if (!bgmEl) { bgmEl = new Audio(CFG.assets.bgm); bgmEl.loop = true; bgmEl.volume = 0.7; } bgmEl.currentTime = 0; bgmEl.play().catch(() => {}); }
function musicTick(dt, tension) {
  if (!AC || !droneG) return;
  if (bgmEl) { droneG.gain.value = 0; return; }
  musicT -= dt;
  if (musicT <= 0) {
    const n = PHRASE[mStep % PHRASE.length];
    if (n) qin(QF[n], 0.32, 0, (mStep % 16 === 2) ? -2 : 0);
    if (mStep % 8 === 0) qin(QF[1] / 2, 0.22);
    if (mStep % 16 === 0 || (tension > 0.5 && mStep % 4 === 0)) drum(0.18 + tension * 0.3);
    mStep++; musicT = 0.62 - tension * 0.28;
  }
}
function step() { if (!AC) return; const t = AC.currentTime; const b = AC.createBufferSource(); const len = AC.sampleRate * 0.08; const buf = AC.createBuffer(1, len, AC.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len); b.buffer = buf; const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const g = AC.createGain(); g.gain.value = 0.08; b.connect(f).connect(g).connect(AC.destination); b.start(t); }
function whoosh() { if (!AC) return; noiseBurst(1.8, 300, 1200, 0.1, 'lowpass'); return; const t = AC.currentTime; const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + 2.8); const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 2.8); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0); o.connect(f).connect(g).connect(AC.destination); o.start(t); o.stop(t + 3.1); }
function gong() { if (!AC) return; [1, 2.76, 5.4].forEach((h, i) => pluck(98 * h, 5 - i, 0.18 / (i + 1))); }

// ---------- HUD ----------
const $ = id => document.getElementById(id);
function say(text, ms = 3200) { const el = $('msg'); el.textContent = text; el.classList.add('on'); clearTimeout(say._t); say._t = setTimeout(() => el.classList.remove('on'), ms); }
function hudRing() {
  const need = G.chain.length ? NEXT[G.chain[G.chain.length - 1]] : null;
  EL.forEach((e) => {
    const n = $('el-' + e.key);
    n.classList.toggle('done', G.chain.includes(e.key));
    n.classList.toggle('next', need === e.key);
  });
  $('ring-hint').textContent = G.chain.length === 0 ? '第一块，你来选 · Your first stone is free'
    : G.chain.length < 5 ? `下一块：${EL.find(e => e.key === need).zh} · Next: ${EL.find(e => e.key === need).en}` : '天已补全 · The sky is whole';
}

// ---------- first-person hand ----------
scene.add(camera);
const hand = new THREE.Group();
{
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a27c, roughness: 0.65 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x8a2b22, roughness: 0.8 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.18), skin); hand.add(palm);
  const fingerGeo = new THREE.CapsuleGeometry(0.018, 0.08, 4, 8);
  [-0.055, -0.018, 0.018, 0.055].forEach((x, i) => { const f = new THREE.Mesh(fingerGeo, skin); f.rotation.x = Math.PI / 2 - 0.35; f.position.set(x, 0.01, -0.13 + Math.abs(i - 1.5) * 0.012); f.userData.f = 1; hand.add(f); });
  const th = new THREE.Mesh(fingerGeo, skin); th.position.set(-0.1, 0.01, -0.02); th.rotation.set(Math.PI / 2, 0, 0.9); hand.add(th);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.22, 12), sleeve); arm.rotation.x = Math.PI / 2; arm.position.set(0, -0.01, 0.2); hand.add(arm);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 8, 16), new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.8, roughness: 0.3 })); cuff.position.set(0, -0.01, 0.1); hand.add(cuff);
  hand.add(new THREE.PointLight(0xfff0d0, 0.6, 2));
  hand.rotation.set(0.25, 0.15, 0.1);
  camera.add(hand);
}
const HAND_REST = new THREE.Vector3(0.3, -0.32, -0.6);
let reachT = 0;
function aimAt(target, maxD) {
  const d = tmpA.copy(target).sub(camera.position); const dist = d.length(); if (dist > maxD) return false;
  camera.getWorldDirection(tmpB); return d.normalize().dot(tmpB) > Math.cos(dist < 4 ? 0.6 : 0.28);
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const throws = [];
function handAction() {
  if (G.phase !== 'play' || G.paused || G.forging || throws.length) return;
  reachT = 0.35;
  if (!G.carrying) {
    let best = null, bd = 1e9;
    for (const o of G.ores) { if (o.taken || o.used) continue; const dd = o.stone.position.distanceTo(camera.position); if (dd < bd && aimAt(o.stone.position, 14)) { bd = dd; best = o; } }
    if (!best) { let bd2 = 7; for (const o of G.ores) { if (o.taken || o.used) continue; const d2 = Math.hypot(o.home.x - player.pos.x, o.home.z - player.pos.z); if (d2 < bd2) { bd2 = d2; best = o; } } }
    if (best) { G.grabFrom = best.stone.position.clone(); G.grabT = 0; return interact(best); }
    say('对准发光的原石，再点击抓取 · Aim at an ore and click', 1800);
  } else {
    const fpos = new THREE.Vector3(FURNACE_POS.x, G.furnace.y + (CFG.world?.furnaceSize ?? 3) * 0.8, FURNACE_POS.y);
    if (aimAt(fpos, 18) || Math.hypot(FURNACE_POS.x - player.pos.x, FURNACE_POS.y - player.pos.z) < 10) {
      const o = G.carrying; G.carrying = null; o.stone.scale.setScalar(1);
      throws.push({ o, from: o.stone.position.clone(), to: fpos, t: 0 }); noiseBurst(0.35, 300, 900, 0.12, 'lowpass');
    } else say('对准铜炉，再点击把石头扔进去 · Aim at the furnace and click', 1800);
  }
}

// ---------- interaction ----------
function nearestOre() {
  let best = null, bd = 7;
  for (const o of G.ores) { if (o.taken || o.used) continue; const d = Math.hypot(o.home.x - player.pos.x, o.home.z - player.pos.z); if (d < bd) { bd = d; best = o; } }
  return best;
}
function nearFurnace() { return Math.hypot(FURNACE_POS.x - player.pos.x, FURNACE_POS.y - player.pos.z) < (CFG.world?.reach ?? 4.3) * 1.5; }
function interact(pick) {
  if (G.phase !== 'play') return;
  if (!G.carrying) {
    const o = pick || nearestOre();
    if (o) { o.taken = true; o.beam.visible = false; o.light.visible = false; G.carrying = o; pluck(o.el.note, 1.2, 0.15); sfxPick(o.el.note); fovKick = 4; banner(`得 ${o.el.zh}`, `${o.el.en} ore`, '#' + new THREE.Color(o.el.color).getHexString()); if (G.tut < 1) { G.tut = 1; say(`第二步：拿到了${o.el.zh}。跟着金色光点跑回铜炉，对准炉口点击，把石头扔进去`, 6000); } else say(`拾起${o.el.name}（${o.el.zh}）· 带回炉中炼化`); pluck(o.el.note * 2, 0.8, 0.1, 0.12); return; }
  } else if (nearFurnace() && !G.forging) {
    const o = G.carrying; G.carrying = null; G.forging = 0.001; G.forgeEl = o;
    say(`炼石中…… ${o.el.zh}`); sfxForge(); fovKick = 6; return;
  }
}
function forgeDone(o) {
  const need = G.chain.length ? NEXT[G.chain[G.chain.length - 1]] : null;
  if (need && need !== o.el.key) {
    // wrong order: the stone shatters, the flood surges, the ore returns home
    G.mistakes++; G.water += 1.4; stinger(); setTimeout(() => narrate('石头碎了……洪水在咆哮。'), 400); sfxCrash(); shake = 0.9; fovKick = -8; banner('石 碎', 'Wrong order · the flood surges', '#ff7a6a'); emit(new THREE.Vector3(FURNACE_POS.x, G.furnace.y + 3, FURNACE_POS.y), 0x555555, 140, 7, 2, 1.4); flash(0x223344);
    const needEl = EL.find(e => e.key === need);
    say(`${o.el.zh}不承${EL.find(e => e.key === G.chain[G.chain.length - 1]).zh}，石碎了。洪水上涨。需要：${needEl.zh}`, 4200);
    o.taken = false; o.stone.visible = true; o.stone.scale.setScalar(1); o.stone.position.copy(o.home); o.beam.visible = true; o.light.visible = true;
    return;
  }
  // correct: send the stone into the sky
  G.chain.push(o.el.key); o.used = true;
  const seg = crackSegs[G.chain.length - 1]; seg.el = o.el;
  whoosh(); emit(new THREE.Vector3(FURNACE_POS.x, G.furnace.y + 3, FURNACE_POS.y), o.el.color, 120, 5, 3, 1.6);
  o.stone.visible = true; o.stone.scale.setScalar(1); flights.push({ obj: o.stone, from: new THREE.Vector3(FURNACE_POS.x, G.furnace.y + 3, FURNACE_POS.y), to: seg.center.clone(), t: 0, seg, el: o.el });
  pluck(o.el.note, 3.2, 0.25);
  G.water = Math.max(CFG.world?.water?.water ?? -2.6, G.water - (CFG.world?.water?.drop ?? 2.0)); G.rate *= 0.84;
  hudRing();
  const left = 5 - G.chain.length; if (left > 0) setTimeout(() => narrate(left === 1 ? '只剩最后一块了。' : `天补上了一角。还差${['','一','二','三','四'][left]}块。`, { pitch: 0.7 }), 3200);
  if (G.tut < 2) { G.tut = 2; setTimeout(() => say(`补上了一块天，这片土地恢复了颜色。下一块必须是「${EL.find(e => e.key === NEXT[o.el.key]).zh}」（看屏幕上方）`, 7000), 2600); }
}
const flights = [];
let shake = 0;

// ---------- loop ----------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
function update(dt) {
  G.t += dt; skyMat.uniforms.uT.value = G.t;
  // flood
  if (G.phase === 'play') {
    G.rate += dt * 0.00009;
    G.water += G.rate * dt;
    if (G.water >= G.failLevel) lose();
  } else if (G.phase === 'won') {
    G.water = THREE.MathUtils.lerp(G.water, -4, dt * 0.4);
  }
  water.position.y = G.water;
  const W0 = CFG.world?.water?.water ?? -2.6; const fl = THREE.MathUtils.clamp((G.water - W0) / (G.failLevel - W0), 0, 1);
  $('flood-fill').style.height = (fl * 100).toFixed(1) + '%';
  $('flood').classList.toggle('danger', fl > 0.75);
  if (floodGain) floodGain.gain.value = G.phase === 'play' ? 0.04 + fl * 0.35 : 0;
  updateGuide();
  if (G.phase === 'play' && dt > 0) {
    hbT -= dt; if (hbT <= 0) { hbT = 1.3 - fl * 0.8; heartbeat(0.15 + fl * 0.45); }
    if (fl > 0.5 && !G.n50) { G.n50 = 1; stinger(); narrate('水已经漫过一半山谷。快，时间不多了。'); }
    if (fl > 0.8 && !G.n80) { G.n80 = 1; stinger(); narrate('洪水就要吞没一切！'); }
  }

  if (DEMO && dt > 0) autopilot(dt);
  // movement
  if (G.phase === 'play') {
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1; if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1;
    fx += touch.mx; fz += touch.my;
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      fx /= Math.max(1, len); fz /= Math.max(1, len);
      const gy = groundFn(player.pos.x, player.pos.z);
      const depth = G.water - gy;
      let sp = (keys.ShiftLeft || keys.ShiftRight) ? (CFG.world?.run ?? 15) : (CFG.world?.walk ?? 9.5);
      if (depth > 1.3) sp *= 0.32; else if (depth > 0.25) sp *= 0.55;
      const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
      const nx = player.pos.x + (fx * c + fz * s) * sp * dt, nz = player.pos.z + (-fx * s + fz * c) * sp * dt;
      const ny = groundFn(nx, nz);
      if (ny - gy < 2.2 * Math.max(dt * 10, 0.4) || ny < gy) { player.pos.x = nx; player.pos.z = nz; }
      G.walkT = (G.walkT || 0) + dt * sp * 0.9; if (Math.floor(G.walkT / Math.PI) !== G.lastStep) { G.lastStep = Math.floor(G.walkT / Math.PI); step(); if (depth > 0.2) emit(new THREE.Vector3(player.pos.x, G.water + 0.05, player.pos.z), 0xcfe3f0, 6, 1.2, 1.2, 0.6); }
    }
    const lim = CFG.world?.bounds || [-140, 140, -160, 160];
    player.pos.x = THREE.MathUtils.clamp(player.pos.x, lim[0], lim[1]); player.pos.z = THREE.MathUtils.clamp(player.pos.z, lim[2], lim[3]);
  }
  const gy = groundFn(player.pos.x, player.pos.z);
  player.pos.y = THREE.MathUtils.lerp(player.pos.y || gy, gy, Math.min(1, dt * 12));
  if (player.jv || player.jy) { player.jv = (player.jv || 0) - 22 * dt; player.jy = (player.jy || 0) + player.jv * dt; if (player.jy <= 0) { if (player.jv < -6) { step(); shake = 0.12; } player.jy = 0; player.jv = 0; } }
  const eye = Math.max(player.pos.y + 1.7, G.water + 0.6) + (player.jy || 0);

  if (G.phase !== 'won') {
    camera.position.set(player.pos.x, eye + Math.abs(Math.sin(G.walkT || 0)) * 0.06, player.pos.z);
    camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
    fovKick *= Math.pow(0.02, dt); const fv = 70 + fovKick; if (Math.abs(camera.fov - fv) > 0.01) { camera.fov = fv; camera.updateProjectionMatrix(); }
    if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
  } else {
    G.endT += dt;
    const k = Math.min(1, G.endT / 9), e = k * k * (3 - 2 * k);
    camera.position.set(player.pos.x, THREE.MathUtils.lerp(eye, eye + 70, e), player.pos.z + e * 60);
    camera.rotation.order = 'YXZ'; camera.rotation.y = THREE.MathUtils.lerp(player.yaw, 0, e); camera.rotation.x = THREE.MathUtils.lerp(player.pitch, -0.18, e);
  }

  updateParticles(dt); if (G.phase === 'play') musicTick(dt, fl);
  // hand: idle sway, walk bob, reach on click, hidden outside play
  hand.visible = G.phase === 'play'; handL.visible = hand.visible && !!G.realHands;
  if (G.realHands) handL.position.set(-HAND_REST.x + rk * 0.04 - Math.sin(G.t * 1.1) * 0.006, HAND_REST.y + Math.abs(Math.sin((G.walkT || 0) + 1.5)) * -0.025 + (G.carrying ? 0.03 : -0.04), HAND_REST.z + 0.04);
  reachT = Math.max(0, reachT - dt);
  const rk = Math.sin(Math.min(1, (0.35 - reachT) / 0.35) * Math.PI) * (reachT > 0 ? 1 : 0);
  hand.position.set(HAND_REST.x - rk * 0.12 + Math.sin(G.t * 1.3) * 0.006, HAND_REST.y + rk * 0.12 + Math.abs(Math.sin(G.walkT || 0)) * -0.025 + (G.carrying ? 0.05 : 0), HAND_REST.z - rk * 0.35);
  if (!G.realHands) hand.children.forEach(c => { if (c.userData.f) c.rotation.x = Math.PI / 2 - (G.carrying ? 1.1 : 0.35 + rk * 0.8); });
  for (let i = throws.length - 1; i >= 0; i--) {
    const th = throws[i]; th.t += dt / 0.7; const k = Math.min(1, th.t);
    th.o.stone.position.lerpVectors(th.from, th.to, k); th.o.stone.position.y += Math.sin(k * Math.PI) * 2.5; th.o.stone.scale.setScalar(THREE.MathUtils.lerp(0.16, 0.5, k)); th.o.stone.rotation.x += dt * 10;
    if (k >= 1) { throws.splice(i, 1); th.o.stone.visible = false; emit(th.to, 0xffa040, 80, 5, 3, 1); shake = 0.25; G.forging = 0.001; G.forgeEl = th.o; say(`炼石中…… ${th.o.el.zh}`); sfxForge(); fovKick = 6; }
  }
  // ores bob, carried stone follows
  for (const o of G.ores) {
    if (o.used) continue;
    if (o === G.carrying) {
      camera.getWorldDirection(tmpV);
      const hp = hand.localToWorld(tmpA.set(0, 0.12, -0.12));
      if (G.grabT < 1) { G.grabT = Math.min(1, (G.grabT || 0) + dt * 4); o.stone.position.lerpVectors(G.grabFrom, hp, easeOut(G.grabT)); o.stone.scale.setScalar(THREE.MathUtils.lerp(1, 0.16, G.grabT)); }
      else { o.stone.position.copy(hp); o.stone.scale.setScalar(0.16); }
      o.stone.rotation.y += dt;
    } else if (!o.taken) { o.stone.rotation.y += dt * 0.5; o.stone.position.y = o.home.y + Math.sin(G.t * 1.6 + o.home.x) * 0.15; o.beam.material.opacity = 0.16 + Math.sin(G.t * 2 + o.home.z) * 0.06; }
  }
  // forging
  if (G.forging) {
    G.forging += dt; const o = G.forgeEl; emit(new THREE.Vector3(FURNACE_POS.x, G.furnace.y + 2.6, FURNACE_POS.y), Math.random() < 0.5 ? 0xffa040 : o.el.color, 6, 2.5, 3, 1.2);
    o.stone.position.set(FURNACE_POS.x, G.furnace.y + 3 + G.forging * 0.6, FURNACE_POS.y); o.stone.rotation.y += dt * 6;
    G.furnace.fire.intensity = 60 + Math.sin(G.t * 40) * 30 + G.forging * 60;
    if (G.forging > 1.6) { G.forging = 0; G.forgeEl = null; forgeDone(o); }
  } else if (G.furnace) { G.furnace.fire.intensity = 50 + Math.sin(G.t * 9) * 12; if (Math.random() < dt * 14) emit(new THREE.Vector3(FURNACE_POS.x + (Math.random() - .5), G.furnace.y + 2.4, FURNACE_POS.y + (Math.random() - .5)), 0xff9a3c, 1, 0.6, 1.6, 1.6); }
  // flights to the sky
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i]; f.t += dt / 3.2; const k = Math.min(1, f.t), e = 1 - Math.pow(1 - k, 3);
    f.obj.position.lerpVectors(f.from, f.to, e); emit(f.obj.position, f.el.color, 3, 0.8, 0, 1.2); f.obj.position.y += Math.sin(k * Math.PI) * (CFG.world?.arc ?? 40); f.obj.scale.setScalar(1 + e * (CFG.world?.grow ?? 14)); f.obj.rotation.y += dt * 3;
    if (k >= 1) {
      f.obj.visible = false; flights.splice(i, 1); emit(f.to, f.el.color, 260, 9, 0, 2.4); emit(f.to, 0xffffff, 80, 5, 0, 1.6); flash(f.el.color); gong(); sfxMend(f.el.note); shake = 0.35; fovKick = 10; banner(`补天 ${['一','二','三','四','五'][G.chain.length - 1] || ''}`, `${G.chain.length} / 5 mended`, '#' + new THREE.Color(f.el.color).getHexString());
      f.seg.mended = 0.001; const idx = EL.indexOf(f.el); G.restoreAnim[idx] = 0.001;
      say(`${f.el.name}补上了天。${f.el.zh}气归于大地。`);
      if (G.chain.length === 5) setTimeout(win, 1800);
    }
  }
  // crack mending + region restoration
  crackSegs.forEach(s => {
    if (s.mended > 0 && s.mended < 1) s.mended = Math.min(1, s.mended + dt / 2.5);
    const flick = 0.85 + Math.sin(G.t * 7 + s.center.x) * 0.15;
    if (s.el) { s.mesh.material.color.lerpColors(new THREE.Color(0xfff6e0), new THREE.Color(s.el.color), s.mended); }
    s.mesh.material.opacity = (1 - s.mended * 0.85) * flick;
    s.glow.material.opacity = 0.18 * (1 - s.mended) * flick;
    if (s.orb && s.el) { s.orb.material.color.set(s.el.color); s.orb.material.opacity = Math.sin(Math.min(1, s.mended) * Math.PI) * 0.9; s.orb.scale.setScalar(0.4 + s.mended * 1.6); }
  });
  G.restoreAnim.forEach((r, i) => { if (r > 0 && r < 1) G.restoreAnim[i] = Math.min(1, r + dt / 3.5); U.uRes.value[i] = easeOut(G.restoreAnim[i]); });
  const prog = G.restoreAnim.reduce((a, b) => a + b, 0) / 5;
  if (G.phase === 'won') U.uAll.value = Math.min(1, U.uAll.value + dt / 4);
  skyMat.uniforms.uSat.value = Math.max(prog * 0.75, U.uAll.value);
  scene.fog.color.lerpColors(new THREE.Color(0xb9bcc0), new THREE.Color(0xf1d9bc), skyMat.uniforms.uSat.value);
  if (splatMesh && splatMesh.__sync) splatMesh.__sync();
  if (windGain) windGain.gain.value = 0.03 + fl * 0.09;

  // villagers on win
  G.villagers.forEach((v, i) => {
    if (!v.visible) return; v.userData.t = (v.userData.t || 0) + dt;
    v.position.y = groundFn(v.position.x, v.position.z) + Math.max(0, Math.sin(v.userData.t * 6 + i)) * 0.25 * Math.min(1, v.userData.t);
  });

  // prompt
  if (G.phase === 'play') {
    let p = '';
    if (G.forging) p = '炼石中…… · Forging';
    else if (G.carrying && nearFurnace()) p = `对准铜炉，点击扔进去 · Click to throw it in`;
    else if (G.carrying) p = `携带：${G.carrying.el.name}（${G.carrying.el.zh}）· 回到炉边`;
    else { const o = nearestOre(); if (o) p = `对准${o.el.name}，点击抓取 · Click to grab`; }
    $('prompt').textContent = p; $('prompt').classList.toggle('on', !!p);
    $('act').hidden = !p || !!G.forging;
    $('timer').textContent = fmt(G.t - G.t0);
  }
}
const DEMO = /[?&]demo/.test(location.search);
const AP = { stuckT: 0, last: null, wait: 0, wrongDone: false };
function autopilot(dt) {
  keys.KeyW = false; keys.ShiftLeft = false;
  if (G.phase !== 'play' || G.forging || throws.length || flights.length) return;
  if (AP.wait > 0) { AP.wait -= dt; return; }
  let tx, tz, near;
  if (G.carrying) { tx = FURNACE_POS.x; tz = FURNACE_POS.y; near = 7; }
  else {
    let need = G.chain.length ? NEXT[G.chain[G.chain.length - 1]] : 'water';
    if (G.chain.length === 1 && !AP.wrongDone) need = NEXT[NEXT[G.chain[0]]];
    const o = G.ores.find(o => !o.taken && !o.used && o.el.key === need) || G.ores.find(o => !o.taken && !o.used);
    if (!o) return; tx = o.home.x; tz = o.home.z; near = 4;
  }
  const dx = tx - player.pos.x, dz = tz - player.pos.z, dist = Math.hypot(dx, dz);
  const want = Math.atan2(-dx, -dz); let dy = want - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  player.yaw += dy * Math.min(1, dt * 3); player.pitch += ((G.carrying ? 0.02 : -0.12) - player.pitch) * Math.min(1, dt * 2);
  if (dist > near) {
    if (Math.abs(dy) < 0.6) { keys.KeyW = true; keys.ShiftLeft = dist > 15; }
    if (AP.last && Math.hypot(player.pos.x - AP.last[0], player.pos.z - AP.last[1]) < 0.02) AP.stuckT += dt; else AP.stuckT = 0;
    if (AP.stuckT > 1.2) { player.pos.x += dx / dist * 3; player.pos.z += dz / dist * 3; AP.stuckT = 0; }
    AP.last = [player.pos.x, player.pos.z];
  } else if (Math.abs(dy) < 0.25) {
    if (!G.carrying && G.chain.length === 1 && !AP.wrongDone) AP.wrongDone = true;
    handAction(); AP.wait = 1.2;
  }
}
const gV = new THREE.Vector3();
const TRAIL_N = 40;
const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.9, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }), TRAIL_N);
trail.frustumCulled = false; scene.add(trail); const tM = new THREE.Matrix4();
function updateGuide() {
  const g = $('guide');
  if (G.phase !== 'play' || G.forging) { g.hidden = true; trail.visible = false; return; }
  let tx, tz, label;
  if (G.carrying) { tx = FURNACE_POS.x; tz = FURNACE_POS.y; label = '铜炉 Furnace'; }
  else {
    const need = G.chain.length ? NEXT[G.chain[G.chain.length - 1]] : null; let bd = 1e9, best = null;
    for (const o of G.ores) { if (o.taken || o.used || (need && o.el.key !== need)) continue; const d = Math.hypot(o.home.x - player.pos.x, o.home.z - player.pos.z); if (d < bd) { bd = d; best = o; } }
    if (!best) { g.hidden = true; trail.visible = false; return; }
    tx = best.home.x; tz = best.home.z; label = `${best.el.zh}石 ${best.el.en}`;
  }
  const dist = Math.hypot(tx - player.pos.x, tz - player.pos.z);
  gV.set(tx, groundFn(tx, tz) + 2, tz).project(camera);
  const on = gV.z < 1 && Math.abs(gV.x) < 0.85 && Math.abs(gV.y) < 0.85;
  let x, y, ang;
  if (on) { x = (gV.x + 1) / 2 * innerWidth; y = (1 - gV.y) / 2 * innerHeight - 40 + Math.sin(G.t * 4) * 8; ang = 180; }
  else { let ax = gV.x, ay = gV.y; if (gV.z >= 1) { ax = -ax; ay = -ay; } const a = Math.atan2(-ay, ax); const r = Math.min(innerWidth, innerHeight) * 0.38; x = innerWidth / 2 + Math.cos(a) * r; y = innerHeight / 2 + Math.sin(a) * r; ang = a * 180 / Math.PI + 90; }
  // glowing dots flowing along the ground toward the target
  const dx = tx - player.pos.x, dz = tz - player.pos.z; const step = 1.6; const n = Math.min(TRAIL_N, Math.floor(dist / step));
  for (let i = 0; i < TRAIL_N; i++) {
    if (i >= n || dist < 3) { tM.makeScale(0, 0, 0); trail.setMatrixAt(i, tM); continue; }
    const f = ((i + (G.t * 2.5) % 1) * step + 1.5) / dist; const x = player.pos.x + dx * f, z = player.pos.z + dz * f;
    const sc = (1 - i / TRAIL_N) * (0.7 + 0.3 * Math.sin(G.t * 6 - i));
    tM.makeScale(sc, sc, sc).setPosition(x, Math.max(groundFn(x, z), G.water) + 0.25, z); trail.setMatrixAt(i, tM);
  }
  trail.instanceMatrix.needsUpdate = true; trail.visible = true;
  g.hidden = false; g.classList.toggle('edge', !on); g.style.transform = `translate(${x}px, ${y}px)`;
  $('guide-arrow').style.transform = `rotate(${ang}deg)`;
  $('guide-text').textContent = `${label} · ${Math.round(dist)}m`;
}
const easeOut = x => 1 - Math.pow(1 - x, 2);
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function win() {
  if (G.phase !== 'play') return;
  G.phase = 'won'; G.endT = 0; setTimeout(() => narrate('天，合上了。水退了。人间，回来了。', { rate: 0.75, pitch: 0.8 }), 1500); document.exitPointerLock?.();
  $('prompt').classList.remove('on'); $('act').hidden = true;
  EL.forEach((e, i) => pluck(e.note, 5, 0.16, i * 0.35)); EL.forEach(e => pluck(e.note / 2, 6, 0.1, 2));
  crackSegs.forEach(s => { s.mended = 1; emit(s.center, 0xfff2c0, 120, 12, 0, 3); }); flash(0xfff2c0); if (droneG) droneG.gain.linearRampToValueAtTime(0.09, AC.currentTime + 4);
  G.villagers.forEach((v, i) => setTimeout(() => {
    v.visible = true; const [x, z] = v.userData.spot; v.position.set(x, groundFn(x, z), z); v.rotation.y = Math.PI + (hash(i, 2) - 0.5);
  }, 2500 + i * 180));
  setTimeout(() => {
    $('end-time').textContent = fmt(G.t - G.t0); $('end-miss').textContent = G.mistakes;
    $('end-order').textContent = G.chain.map(k => EL.find(e => e.key === k).zh).join(' → ');
    $('end').hidden = false;
  }, 7000);
}
function lose() {
  G.phase = 'lost'; document.exitPointerLock?.(); stinger(); narrate('洪水吞没了山谷。一切，都沉入了黑暗。', { rate: 0.7, pitch: 0.4 }); thud();
  $('prompt').classList.remove('on'); $('act').hidden = true;
  $('lose-n').textContent = G.chain.length; $('lose').hidden = false;
}

function resetGame() {
  G.paused = false; $('pause').hidden = true; G.tut = 0; $('guide').hidden = false;
  G.phase = 'play'; G.water = CFG.world?.water?.water ?? -2.6; G.rate = CFG.world?.water?.rate ?? 0.034; G.carrying = null; G.forging = 0; G.forgeEl = null;
  G.chain = []; G.mistakes = 0; throws.length = 0; G.restoreAnim = [0, 0, 0, 0, 0]; U.uAll.value = 0; G.t0 = G.t; flights.length = 0;
  for (const o of G.ores) { o.taken = false; o.used = false; o.stone.visible = true; o.stone.scale.setScalar(1); o.stone.position.copy(o.home); o.beam.visible = true; o.light.visible = true; }
  crackSegs.forEach(s => { s.mended = 0; s.el = null; s.mesh.material.color.set(0xfff6e0); });
  G.villagers.forEach(v => v.visible = false);
  player.pos.set(START_POS.x, groundFn(START_POS.x, START_POS.y), START_POS.y); player.yaw = 0; player.pitch = 0.12;
  $('end').hidden = true; $('lose').hidden = true; $('intro').hidden = true; $('hud').hidden = false;
  G.n50 = G.n80 = 0; hudRing(); say('第一步：跟着地上的金色光点，跑到发光的原石旁，对准它点击鼠标，用手抓起来', 7000);
}
function startGame() { audioInit(); musicInit(); bgmPlay(); resetGame(); G.started = false; setTimeout(() => G.started = true, 400); }
let seenIntro = false;
async function cinematic() {
  audioInit(); $('intro').hidden = true; const c = $('cine'); c.hidden = false; const line = $('cine-line');
  const lines = [['往古之时，四极废，九州裂。', 4200], ['天，塌了。', 3000], ['洪水从天的裂缝里倾泻而下，淹没了大地，世界失去了颜色。', 6200], ['只有你，女娲，能把天补上。', 4200], ['在洪水吞没山谷之前，找到五行之石。', 4500]];
  let skip = false; c.onclick = () => { skip = true; };
  for (const [t, ms] of lines) {
    if (skip) break; line.classList.remove('on'); await new Promise(r => setTimeout(r, 300)); line.textContent = t; line.classList.add('on');
    narrate(t, { rate: 0.78, pitch: 0.45 }); stinger(); heartbeat(0.5);
    for (let k = 0; k < ms / 100 && !skip; k++) await new Promise(r => setTimeout(r, 100));
  }
  try { speechSynthesis.cancel(); } catch (_) {}
  c.hidden = true; $('sub').classList.remove('on'); seenIntro = true; startGame();
}
$('start').addEventListener('click', () => seenIntro ? startGame() : cinematic());
$('resume').addEventListener('click', () => setPause(false));
$('restart').addEventListener('click', () => { setPause(false); startGame(); });
$('quit').addEventListener('click', quitToTitle);
$('pausebtn').addEventListener('click', () => setPause(true));
$('again').addEventListener('click', startGame);
$('retry').addEventListener('click', startGame);

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- boot ----------
(async () => {
  try {
    if (CFG.world && CFG.world.spz) await buildSplatWorld(CFG.world); else buildProceduralWorld();
  } catch (err) { console.error('world load failed, using fallback', err); groundFn = terrainH; buildProceduralWorld(); }
  await setupProps();
  player.pos.set(START_POS.x, groundFn(START_POS.x, START_POS.y), START_POS.y);
  player.yaw = 0; player.pitch = 0.12;
  $('loading').hidden = true; $('start').disabled = false;
  renderer.setAnimationLoop(() => { const dt = Math.min(clock.getDelta(), 0.05); update(G.paused ? 0 : dt); renderer.render(scene, camera); });
})();

// test / recording hooks
window.__butian = { FP: () => FURNACE_POS, setPause, G, player, EL, interact, startGame, win, U, teleport: (x, z) => { player.pos.x = x; player.pos.z = z; } };
