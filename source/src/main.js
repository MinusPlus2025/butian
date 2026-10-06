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
  vec3 grey = mix(vec3(pow(l, 1.15)) * vec3(0.86, 0.88, 0.91), col, 0.5);
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
let groundFn = terrainH, groundLow = null;
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
        vec3 grey = mix(vec3(pow(l, 1.12)) * vec3(0.88, 0.9, 0.94), c, ${(CFG.world?.stormColor ?? 0.5).toFixed(2)});
        vec3 outc = mix(grey, vivid, clamp(m, 0.0, 1.0));
        // lightning lights the whole valley for a moment, peaks and cloud more than the valley floor
        float fl = ${inputs.rb}.w;
        outc += outc * fl * (0.18 + 0.32 * smoothstep(0.0, 30.0, p.y)) + vec3(0.015, 0.02, 0.035) * fl;
        float op = ${inputs.gsplat}.rgba.a;
        for (int i = 0; i < 5; i++) {
          if (mend[i] <= 0.0) continue;
          float k = (1.0 - smoothstep(crk[i].w * 0.6, crk[i].w, distance(p, crk[i].xyz))) * mend[i];
          float bright = max(smoothstep(0.55, 0.8, l), smoothstep(0.25, 0.5, c.r - c.b)); // light, or the world's own lava-orange crack
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
    uResD.value.set(r[0], r[1], r[2], r[3]); uRes5.value.set(r[4], U.uAll.value, cm[4], Math.min(1.4, boltFlash)); uMend.value.set(cm[0], cm[1], cm[2], cm[3]);
    splatMesh.updateVersion();
  };
  await splatMesh.initialized; loadWorldB();
  if (W.collider) {
    const g = await loadGLB(W.collider);
    if (g) {
      // Marble collider GLBs carry their own Y-up root transform; only apply our placement + scale
      g.position.copy(splatMesh.position); g.scale.setScalar((W.transform && W.transform.colliderScale) || splatMesh.scale.x);
      if (W.showCollider) g.traverse(o => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }); });
      g.traverse(o => { if (o.isMesh) { if (!W.showCollider) o.material.visible = false; groundMeshes.push(o); } });
      scene.add(g); g.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
      groundFn = (x, z, fromY) => { ray.set(new THREE.Vector3(x, fromY ?? W.rayTop ?? 400, z), down); let h = ray.intersectObjects(groundMeshes, false)[0]; if (!h && fromY != null) { ray.set(new THREE.Vector3(x, W.rayTop ?? 400, z), down); h = ray.intersectObjects(groundMeshes, false)[0]; } return h ? h.point.y : (W.floor ?? 0); };
      groundLow = (x, z) => { ray.set(new THREE.Vector3(x, W.rayTop ?? 400, z), down); const hs = ray.intersectObjects(groundMeshes, false); return hs.length ? hs[hs.length - 1].point.y : (W.floor ?? 0); };
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
// muddy flood water, sampled from the world's own torrent: opaque silt, dull sheen
const waterMat = patchMat(new THREE.MeshStandardMaterial({ color: 0x9c8670, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.97 }));
// rolling flood: three wave trains displace the surface on the GPU; flat shading lets the light catch every crest
const waterT = { value: 0 };
waterMat.flatShading = true;
{ const base = waterMat.onBeforeCompile; waterMat.onBeforeCompile = sh => { base(sh); sh.uniforms.uWT = waterT;
  sh.vertexShader = 'uniform float uWT;\nvarying float vCrest;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float wx = position.x, wz = position.z;
    // the flood pours down the valley (+z): a fast travelling surge plus cross chop
    float surge = 0.22 * sin(wz * 0.55 - uWT * 3.4 + sin(wx * 0.35) * 1.5) + 0.1 * sin(wz * 1.3 - uWT * 5.2 + wx * 0.4);
    float chop = 0.12 * sin(wx * 0.45 + uWT * 1.3) + 0.05 * sin((wx + wz) * 1.6 + uWT * 3.1);
    transformed.y += surge + chop; vCrest = surge + chop;`);
  sh.fragmentShader = 'varying float vCrest;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.74, 0.64), smoothstep(0.24, 0.4, vCrest) * 0.45);`); }; }
const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1).rotateX(-Math.PI / 2), waterMat);
scene.add(water);

// ---------- game state ----------
const G = {
  phase: 'intro', t: 0, water: -2.6, rate: 0.034, failLevel: 9.5,
  carrying: null, forging: 0, forgeEl: null, chain: [], mistakes: 0,
  ores: [], furnace: null, villagers: [], restoreAnim: [0, 0, 0, 0, 0], endT: 0,
};
const player = { pos: new THREE.Vector3(START_POS.x, 0, START_POS.y), yaw: 0, pitch: 0.05, vy: 0 };

// ---------- Nüwa, played in third person ----------
const TP = CFG.world?.view !== 'first';
// gameplay is seen through Nüwa's eyes; her full body appears only when the camera leaves her: the mend flights and the ending
const FPV = TP && CFG.world?.view !== 'third';
const NUWA_H = CFG.world?.nuwaHeight ?? 2.3;
const avatar = new THREE.Group(); avatar.visible = false; scene.add(avatar);
const AV = { face: 0, speed: 0, fly: null, reach: 0, lx: 0, lz: 0, camPos: new THREE.Vector3(), camInit: false };
let nuwaBody = makeNuwaPlaceholder(), nuwaMixer = null; const nuwaActs = {}; avatar.add(nuwaBody);
{ const l = new THREE.PointLight(0xffe6c0, 6, 6); l.position.set(0, 2.2, 1); avatar.add(l); }
function makeNuwaPlaceholder() {
  // a robed goddess built from primitives, used until the Tripo model is supplied
  const g = new THREE.Group(), M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
  const red = M(0xa61e1a), white = M(0xf1e8d6), gold = M(0xd8b04a, { metalness: 0.7, roughness: 0.35 }), skin = M(0xeac7a6), hair = M(0x15110f, { roughness: 0.45 });
  const prof = [[0.02, 0], [0.7, 0.02], [0.62, 0.35], [0.46, 0.85], [0.33, 1.25], [0.26, 1.5], [0.2, 1.62]].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 28), red));
  const inner = new THREE.Mesh(new THREE.LatheGeometry(prof.map(v => new THREE.Vector2(v.x * 0.86, v.y * 0.98)), 28, -0.6, 1.2), white); inner.position.z = -0.03; inner.rotation.y = Math.PI; g.add(inner);
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.05, 8, 24), gold); sash.rotation.x = Math.PI / 2; sash.position.y = 1.18; g.add(sash);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10), skin); neck.position.y = 1.68; g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), skin); head.scale.set(0.92, 1.08, 0.96); head.position.y = 1.86; g.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.168, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hair); hairCap.position.y = 1.88; hairCap.rotation.x = 0.35; g.add(hairCap);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), hair); bun.position.set(0, 2.08, 0.06); g.add(bun);
  for (const s of [-1, 1]) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), gold); pin.position.set(s * 0.06, 2.1, 0.06); pin.rotation.z = s * 1.1; g.add(pin); }
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.28, 1.55, 0);
    const sleeve = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.75, 12, 1, true), red); sleeve.material = red; sleeve.rotation.x = Math.PI / 2 + 0.5; sleeve.position.set(0, -0.2, -0.28); arm.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin); hand.position.set(-s * 0.06, -0.38, -0.62); arm.add(hand);
    g.add(arm); g.userData['arm' + (s > 0 ? 'R' : 'L')] = arm;
  }
  // a silk ribbon (披帛) arching behind the shoulders
  const rc = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.75, 0.7, -0.1), new THREE.Vector3(-0.45, 1.45, 0.2), new THREE.Vector3(0, 1.65, 0.28), new THREE.Vector3(0.45, 1.45, 0.2), new THREE.Vector3(0.8, 0.6, -0.05)]);
  const rib = new THREE.Mesh(new THREE.TubeGeometry(rc, 40, 0.03, 6), M(0xf4d58a, { emissive: 0x3a2400 })); g.add(rib); g.userData.ribbon = rib;
  return g;
}
async function setupNuwa() {
  if (!CFG.assets?.nuwa) return;
  try {
    const bytes = await loadBin(CFG.assets.nuwa);
    const gl = await new Promise((res, rej) => gltf.parse(bytes.buffer, '', res, rej)); let m = gl.scene;
    // Tripo's auto-rig on this robe is broken, so a skinned export would render exploded: keep only the bind-pose mesh
    if (CFG.world?.nuwaStatic !== false) { const g = new THREE.Group(); m.traverse(o => { if (o.isMesh) { const geo = o.geometry.clone(); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); g.add(new THREE.Mesh(geo, o.material)); } }); m = g; gl.animations = []; }
    const b = new THREE.Box3().setFromObject(m), sz = b.getSize(new THREE.Vector3()); m.scale.multiplyScalar(NUWA_H / sz.y);
    const b2 = new THREE.Box3().setFromObject(m), c = b2.getCenter(new THREE.Vector3()); m.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
    const wrap = new THREE.Group(); wrap.add(m); wrap.rotation.y = CFG.world?.nuwaRot ?? Math.PI;
    avatar.remove(nuwaBody); nuwaBody = wrap; avatar.add(wrap);
    if (gl.animations?.length) {
      nuwaMixer = new THREE.AnimationMixer(m);
      for (const a of gl.animations) { const n = a.name.toLowerCase(); nuwaActs[/walk|run|move|locomot/.test(n) ? 'walk' : /idle|stand|breath/.test(n) ? 'idle' : n] = nuwaMixer.clipAction(a); }
      Object.values(nuwaActs).forEach(a => { a.play(); a.setEffectiveWeight(0); }); (nuwaActs.idle || Object.values(nuwaActs)[0]).setEffectiveWeight(1);
    }
  } catch (e) { console.warn('nuwa load failed', e); }
}
function nearestOreTP() { let best = null, bd = CFG.world?.pickRange ?? 4.5; for (const o of G.ores) { if (o.taken || o.used) continue; const d = Math.hypot(o.home.x - player.pos.x, o.home.z - player.pos.z); if (d < bd) { bd = d; best = o; } } return best; }
function furnaceDist() { return Math.hypot(FURNACE_POS.x - player.pos.x, FURNACE_POS.y - player.pos.z); }

const handL = new THREE.Group(); camera.add(handL); handL.visible = false;
async function setupHands() {
  if (!CFG.assets?.hand) { hand.children.forEach(c => { if (c.userData.sleeve) c.visible = FPV; else if (FPV && (c.geometry?.type === 'CylinderGeometry' || c.geometry?.type === 'TorusGeometry')) c.visible = false; }); return; }
  const m = await loadGLB(CFG.assets.hand); if (!m) return;
  const H = CFG.world?.hand || {};
  const box = new THREE.Box3().setFromObject(m), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  m.position.sub(c); const k = (H.size || 0.42) / Math.max(sz.x, sz.y, sz.z);
  const wrapR = new THREE.Group(); wrapR.add(m); wrapR.scale.setScalar(k); if (H.rot) wrapR.rotation.set(...H.rot);
  hand.children.forEach(ch => { if (!ch.isLight) ch.visible = false; }); hand.rotation.set(0, 0, 0); hand.add(wrapR);
  let wrapL;
  const ml = null;
  if (ml) { const bl = new THREE.Box3().setFromObject(ml), sl = bl.getSize(new THREE.Vector3()); ml.position.sub(bl.getCenter(new THREE.Vector3())); wrapL = new THREE.Group(); wrapL.add(ml); wrapL.scale.setScalar((H.size || 0.42) / Math.max(sl.x, sl.y, sl.z)); if (H.rot) wrapL.rotation.set(...H.rot); }
  else { wrapL = wrapR.clone(); wrapL.scale.x *= -1; } handL.add(wrapL); handL.add(new THREE.PointLight(0xfff0d0, 0.5, 2)); G.realHands = H.left !== false;
  G.handWrap = wrapR; G.palm = 0; if (H.tilt) hand.rotation.set(...H.tilt);
  if (FPV && H.autoPalm !== false) {
    // fingertips point forward (-z); the palm is the highest surface a little behind them
    hand.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(wrapR.matrix), v = new THREE.Vector3(), P = [];
    m.updateMatrixWorld(true); m.traverse(o => { if (!o.isMesh) return; const a = o.geometry.attributes.position, step = Math.max(1, Math.floor(a.count / 40000));
      for (let i = 0; i < a.count; i += step) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); hand.worldToLocal(v); P.push(v.x, v.y, v.z); } });
    // the upturned palm is the top of the model: average the highest few millimetres and rest the stone on it
    let yMax = -1e9; for (let i = 1; i < P.length; i += 3) yMax = Math.max(yMax, P[i]);
    let sx = 0, sz = 0, n = 0; for (let i = 0; i < P.length; i += 3) if (P[i + 1] > yMax - 0.025) { sx += P[i]; sz += P[i + 2]; n++; }
    if (n) { const r = (H.holdScale ?? 0.07) * 0.5; G.palmHold = [sx / n, yMax + r, sz / n]; }
  }
}
// a torn, glowing crack across the sky: jagged ribbons (white-hot core + red glow) that can tear open and heal
const ribTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 64); return new THREE.CanvasTexture(c); })();
function ribbon(pts, w, color, opacity, blending = THREE.AdditiveBlending, order = 999) {
  const pos = [], uv = [], idx = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    const t = i / (pts.length - 1), ww = w * (0.25 + 0.75 * Math.pow(Math.sin(t * Math.PI), 0.6)) * (0.7 + Math.random() * 0.6);
    const nx = -ty / l * ww / 2, ny = tx / l * ww / 2;
    pos.push(p.x + nx, p.y + ny, p.z, p.x - nx, p.y - ny, p.z); uv.push(t, 0, t, 1);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, map: ribTex, transparent: true, opacity, depthWrite: false, depthTest: false, blending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
  m.renderOrder = order; m.frustumCulled = false; return m;
}
function jag(a, b, n, amp) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, e = Math.sin(t * Math.PI); out.push(new THREE.Vector3(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 0.6, a.y + (b.y - a.y) * t + (Math.random() < 0.5 ? 1 : -1) * amp * Math.pow(Math.random(), 1.5) * (i && i < n ? 1 : 0.3), a.z + (b.z - a.z) * t + (Math.random() - 0.5) * 1.5 * e)); } return out; }
const bolts = [];
// ---------- the world breaking: tremors, falling rock, opening fissures, debris riding the flood ----------
// irregular boulders: a subdivided sphere pushed around by layered noise, a few shapes reused
const rockGeos = [0, 1, 2, 3].map(seed => { const g = new THREE.IcosahedronGeometry(1, 3), a = g.attributes.position, v = new THREE.Vector3(), col = [];
  const f = (x, y, z) => Math.sin(x * 1.7 + seed * 3.1) * Math.sin(y * 2.3 + seed) * Math.sin(z * 1.9 - seed * 2.2) * 0.22 + Math.sin(x * 4.1 + y * 3.7 + seed) * 0.07 + Math.sin(z * 5.3 - x * 2.9 + seed * 5) * 0.05;
  const sq = [0.8 + seed * 0.12, 0.65 + (seed % 2) * 0.2, 1.0];
  for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i); const d = 1 + f(v.x, v.y, v.z); v.multiplyScalar(d); v.set(v.x * sq[0], v.y * sq[1], v.z * sq[2]); if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3; a.setXYZ(i, v.x, v.y, v.z); const s2 = 0.75 + d * 0.3 + Math.sin(v.x * 9 + v.z * 7) * 0.04; col.push(0.3 * s2, 0.285 * s2, 0.27 * s2); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g; });
const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.97 });
const rocks = [], fissures = [], logs = [];
const fisMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
function quake(big = 1) {
  if (!G.furnace) return;
  shake = Math.max(shake, 0.6 * big); noiseBurst(2.2, 90, 40, 0.5 * big, 'lowpass'); drum(0.7 * big); drum(0.5 * big, 0.25);
  const B = CFG.world?.bounds || [-14, 4, -38, 30];
  // dust shaken loose from the valley walls, well away from the player
  for (let i = 0; i < 6; i++) { const side = Math.random() < 0.5 ? B[0] - 3 : B[1] + 3, z = player.pos.z + (Math.random() - 0.5) * 50, y = groundFn(side, z) + 2 + Math.random() * 8; emit(new THREE.Vector3(side, y, z), 0x77706a, 40, 2.2, 1.2, 2.6); }
  say('山崩地裂！· The mountains are breaking!', 2200);
}
function updateQuake(dt) {
  if (G.phase === 'play' && !G.cut && !G.paused) {
    G.qT = (G.qT ?? 12) - dt;
    if (G.qT <= 0) { const fl = THREE.MathUtils.clamp((G.water - (CFG.world?.water?.water ?? -2.6)) / Math.max(0.1, G.failLevel - (CFG.world?.water?.water ?? -2.6)), 0, 1); quake(0.7 + fl * 0.8); G.qT = 22 - fl * 10 + Math.random() * 8; }
  }
  for (let i = rocks.length - 1; i >= 0; i--) {
    const r = rocks[i]; if (r.delay > 0) { r.delay -= dt; continue; }
    r.v.y -= 20 * dt; r.m.position.addScaledVector(r.v, dt); r.m.rotation.x += r.spin.x * dt; r.m.rotation.y += r.spin.y * dt;
    const gy = Math.max(groundFn(r.m.position.x, r.m.position.z), G.water);
    if (r.m.position.y < gy + r.m.scale.x * 0.5) {
      if (!r.hit) { r.hit = 1; const near = r.m.position.distanceTo(player.pos) < 14; emit(r.m.position, r.m.position.y <= G.water + 0.6 ? 0xcfc6b4 : 0x6a5e50, 30, 4, 3, 1.2); if (near) { shake = Math.max(shake, 0.3); noiseBurst(0.4, 300, 60, 0.3, 'lowpass'); } }
      r.v.multiplyScalar(0.5); r.v.y = Math.abs(r.v.y) * 0.25; r.m.position.y = gy + r.m.scale.x * 0.5; r.rest = (r.rest || 0) + dt;
      if (r.rest > 8) { scene.remove(r.m); rocks.splice(i, 1); }
    }
  }
  for (let i = fissures.length - 1; i >= 0; i--) {
    const f = fissures[i]; f.t += dt; f.m.material.opacity = Math.min(1, f.t * 2) * (f.t > 10 ? Math.max(0, 1 - (f.t - 10) / 4) : 1) * (0.75 + 0.25 * Math.sin(G.t * 6));
    if (Math.random() < dt * 6) { const p = f.pts[(Math.random() * f.pts.length) | 0]; emit(p, Math.random() < 0.5 ? 0xff7a2a : 0x555049, 2, 0.6, 2.2, 1); }
    if (f.t > 14) { scene.remove(f.m); f.m.geometry.dispose(); fissures.splice(i, 1); }
  }
  // broken timber and branches carried down the valley by the flood
  if (!logs.length && G.furnace) for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1 + Math.random() * 0.05, 0.14 + Math.random() * 0.05, 1.6 + Math.random() * 2, 12, 3).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b2c1f, roughness: 1 })); m.rotation.y = Math.random() * Math.PI; scene.add(m); logs.push({ m, x: (Math.random() - 0.5) * 40, z: (Math.random() - 0.5) * 140, sp: 2.5 + Math.random() * 2.5, ph: Math.random() * 6 }); }
  for (const l of logs) {
    l.z += l.sp * dt; if (l.z > 70) l.z -= 140;
    l.m.visible = water.visible && G.phase !== 'won' && G.phase !== 'title';
    l.m.position.set(l.x + Math.sin(G.t * 0.5 + l.ph) * 1.5, G.water + 0.1 + 0.25 * Math.sin(l.z * 0.55 - G.t * 3.4 + Math.sin(l.x * 0.35) * 1.5), l.z); l.m.rotation.y += dt * 0.3; l.m.rotation.x = Math.sin(G.t * 2 + l.ph) * 0.2;
  }
}
function spawnBolt() {
  const c = crackSegs[Math.floor(Math.random() * crackSegs.length)]; if (!c || !c.rib) return;
  const S = crackSegs[1].center.distanceTo(crackSegs[0].center) / 13;
  const start = c.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8 * S, 0, 0));
  const end = new THREE.Vector3(start.x + (Math.random() - 0.5) * 30 * S, 4, start.z + 10 + Math.random() * 20);
  const path = (a, b, n, amp) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push(new THREE.Vector3(a.x + (b.x - a.x) * t + (i && i < n ? (Math.random() - 0.5) * amp : 0), a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)); } return out; };
  const main = path(start, end, 30, 3 * S), grp = new THREE.Group(), mats = [];
  const add = (pts, w) => { const glow = ribbon(pts, w * 3.5, 0x9fb8ff, 0.45, THREE.AdditiveBlending, 1000), core = ribbon(pts, w, 0xffffff, 1, THREE.NormalBlending, 1001); grp.add(glow, core); mats.push(glow, core); };
  add(main, 0.28 * S);
  for (let k = 0; k < 3; k++) { const i = 4 + Math.floor(Math.random() * 18), from = main[i]; const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 14 * S, -(4 + Math.random() * 10) * S, (Math.random() - 0.5) * 4)); add(path(from, to, 12, 1.6 * S), 0.12 * S); }
  scene.add(grp); bolts.push({ grp, mats, t: 0 });
}
function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i]; b.t += dt; const on = b.t < 0.07 || (b.t > 0.12 && b.t < 0.2) || (b.t > 0.26 && b.t < 0.3);
    b.mats.forEach((m, j) => { m.material.opacity = on ? (j % 2 ? 1 : 0.4) : (j % 2 ? 0.15 : 0.05); });
    if (b.t > 0.45) { scene.remove(b.grp); b.mats.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); bolts.splice(i, 1); }
  }
}
function buildSkyCrack() {
  const C = crackSegs.map(c => c.center);
  crackSegs.forEach((s, i) => {
    const a = i ? C[i - 1].clone().lerp(C[i], 0.5) : C[i].clone().add(new THREE.Vector3(-(C[1].x - C[0].x) * 0.6, -2, 2));
    const b = i < C.length - 1 ? C[i].clone().lerp(C[i + 1], 0.5) : C[i].clone().add(new THREE.Vector3((C[i].x - C[i - 1].x) * 0.6, -2, 2));
    const S = C[1].distanceTo(C[0]) / 13, main = jag(a, b, 12, 1.4 * S), grp = new THREE.Group(), parts = [];
    const add = (pts, wc, wg) => { const dark = ribbon(pts, wc * 3.2, 0x1a0603, 0.85, THREE.NormalBlending, 997), glow = ribbon(pts, wg, 0xff4a20, 0.55, THREE.AdditiveBlending, 998), core = ribbon(pts, wc, 0xffe2b0, 0.95, THREE.NormalBlending, 999); grp.add(dark, glow, core); parts.push({ dark, glow, core }); };
    add(main, 0.7 * S, 6 * S);
    for (let k = 0; k < 3; k++) { const from = main[2 + Math.floor(Math.random() * (main.length - 4))]; const dir = new THREE.Vector3((Math.random() - 0.5) * 6 * S, (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4) * S, 0); add(jag(from, from.clone().add(dir), 5, 0.6 * S), 0.3 * S, 2.2 * S); }
    if (CFG.world?.crackRibbon !== 'full') grp.visible = false; // the world's own baked crack is the crack; flat glow strips on top only looked pasted on
    scene.add(grp); s.rib = { grp, parts }; s.open = 0; s.delay = i * 0.9;
  });
}
async function setupProps() {
  setupHands(); setupNuwa();
  const W = CFG.world;
  if (W) {
    if (W.regions) W.regions.forEach((p, i) => { EL[i].pos = p; U.uReg.value[i].set(p[0], 0, p[1], W.regionR || REGION_R); });
    if (W.furnace) FURNACE_POS.set(W.furnace[0], W.furnace[1]);
    if (W.start) START_POS.set(W.start[0], W.start[1]);
    if (W.water) Object.assign(G, W.water);
    sky.visible = false; scene.fog.near = 400; scene.fog.far = 2000;
    water.geometry.dispose(); water.geometry = new THREE.PlaneGeometry((W.waterRadius || 40) * 2, (W.waterRadius || 40) * 2, 220, 220).rotateX(-Math.PI / 2);
    if (W.crack) crackSegs.forEach((c, i) => {
      c.mesh.visible = false; c.glow.visible = false; c.center.fromArray(W.crack[i]);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(W.crack[i][3] * 0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      orb.position.copy(c.center); scene.add(orb); c.orb = orb;
    });
    if (W.crack) buildSkyCrack();
  }
  for (const el of EL) {
    const stone = await makeStone(el);
    const [x, z] = el.pos; const y = groundFn(x, z);
    stone.position.set(x, y, z); scene.add(stone);
    const bm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uCol: { value: new THREE.Color(el.color) }, uT: { value: 0 }, uOp: { value: 0.22 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uCol; uniform float uT, uOp; varying vec2 vUv;
        void main(){ float x = (vUv.x - 0.5) * 2.0, h = vUv.y;
          float core = exp(-x * x * 22.0), halo = exp(-x * x * 3.5) * 0.4;
          float vf = pow(1.0 - h, 1.8) * smoothstep(0.0, 0.02, h);
          float n = 0.7 + 0.3 * sin(h * 46.0 - uT * 3.2 + sin(h * 11.0 + uT * 0.7 + x * 3.0) * 2.0);
          float a = (core + halo) * vf * n * uOp * 2.8;
          gl_FragColor = vec4(mix(uCol * 1.3, vec3(1.0), core * 0.55), clamp(a, 0.0, 0.95)); }` });
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 60), bm);
    beam.position.set(x, y + 30, z); beam.onBeforeRender = (r, sc, cam) => { bm.uniforms.uOp.value = bm.opacity; bm.uniforms.uT.value = G.t; beam.rotation.y = Math.atan2(cam.position.x - beam.position.x, cam.position.z - beam.position.z); }; scene.add(beam);
    const light = new THREE.PointLight(el.color, 30, 18); light.position.set(x, y + 2, z); scene.add(light);
    G.ores.push({ el, stone, beam, light, home: new THREE.Vector3(x, y, z), taken: false, used: false });
  }
  const f = await makeFurnace();
  const fy = groundFn(FURNACE_POS.x, FURNACE_POS.y);
  f.position.set(FURNACE_POS.x, fy, FURNACE_POS.y); f.rotation.y = CFG.world?.furnaceRot ?? Math.PI / 2; scene.add(f);
  const fire = new THREE.PointLight(0xff8a3c, 60, 22); fire.position.set(FURNACE_POS.x, fy + 3.2, FURNACE_POS.y); scene.add(fire);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); ember.scale.y = 0.35;
  ember.position.set(FURNACE_POS.x, fy + (CFG.world?.furnaceSize ?? 3) * 0.78, FURNACE_POS.y); scene.add(ember);
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
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyL') document.querySelector('.langbtn')?.click(); if (e.code === 'KeyE' && !G.paused) handAction(); if (e.code === 'Space' && G.phase === 'play' && !G.paused && !G.cut && !(player.jy > 0.01)) { player.jv = 7.5; noiseBurst(0.12, 500, 250, 0.08, 'lowpass'); e.preventDefault(); } if ((e.code === 'Escape' || e.code === 'KeyP') && G.phase === 'play' && !locked) setPause(!G.paused); });
addEventListener('keyup', e => { keys[e.code] = false; });
let locked = false, dragging = false, lastX = 0, lastY = 0;
document.addEventListener('pointerlockchange', () => { const was = locked; locked = document.pointerLockElement === canvas; if (was && !locked && G.phase === 'play' && matchMedia('(pointer: fine)').matches) setPause(true); });
function setPause(on) {
  if (G.phase !== 'play') on = false;
  G.paused = on; $('pause').hidden = !on;
  if (AC) { if (on) AC.suspend?.(); else AC.resume?.(); }
  if (rainEl) { if (on) rainEl.pause(); else rainEl.play().catch(() => {}); }
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
let floodGain = null, rainHiss = null;
let rainEl = null, thunderEls = [];
function rainInit() {
  if (CFG.assets?.rain && !rainEl && AC) { rainEl = new Audio(CFG.assets.rain); rainEl.loop = true; rainEl.volume = 0.6; rainEl.play().catch(() => {}); rainHiss = { gain: { value: 0 } }; }
  if (!AC || rainHiss) return;
  // synthesized rain: stereo pink-noise wash + thousands of pre-rendered droplet ticks + a low body, with slow gusts
  const sr = AC.sampleRate, n = sr * 5, b = AC.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0, br = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; br = 0.995 * br + w * 0.02; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11 + br * 0.9; }
    for (let k = 0; k < 7000; k++) { const at = Math.floor(Math.random() * (n - 900)), f = 1800 + Math.random() * 5200, a = Math.pow(Math.random(), 3) * 0.55, kd = Math.exp(-1 / (sr * (0.0012 + Math.random() * 0.004))), w0 = 6.283 * f / sr; let e = a, ph = 0; for (let j = 0; j < 800 && e > 0.002; j++) { d[at + j] += Math.sin(ph) * e; ph += w0 * (1 - j / sr * 60); e *= kd; } }
    const fade = 2000; for (let i = 0; i < fade; i++) { const m = i / fade; d[i] = d[i] * m + d[n - fade + i] * (1 - m); } // seamless loop
  }
  const src = AC.createBufferSource(); src.buffer = b; src.loop = true; src.loopEnd = 5 - 2000 / sr;
  const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
  const gust = AC.createGain(); gust.gain.value = 0.85; const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.25; lfo.connect(lg).connect(gust.gain); lfo.start();
  rainHiss = AC.createGain(); rainHiss.gain.value = 0.3; src.connect(hp).connect(lp).connect(gust).connect(rainHiss).connect(AC.destination); src.start(); G.rainSynth = true; }
// synthesized thunder: a sharp crack, then a long rolling rumble built from random swells of brown noise
const thunderBufs = [];
function thunderSfx(near = 1) {
  if (!AC) return; const sr = AC.sampleRate, dur = 5 + Math.random() * 3, n = Math.floor(sr * dur);
  let b = thunderBufs.length >= 4 ? thunderBufs[Math.floor(Math.random() * 4)] : null; if (!b) { near = Math.max(near, 0.7); b = AC.createBuffer(2, n, sr); thunderBufs.push(b);
  const bumps = Array.from({ length: 5 + Math.floor(Math.random() * 5) }, (_, i) => [0.05 + Math.random() * dur * 0.6, 0.15 + Math.random() * 0.8, (0.4 + Math.random() * 0.6) * Math.exp(-i * 0.15)]);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let br = 0, br2 = 0, env = 0; const off = ch * 0.03;
    for (let i = 0; i < n; i++) {
      const t = i / sr, w = Math.random() * 2 - 1; br = 0.985 * br + w * 0.12; br2 = 0.9995 * br2 + w * 0.01;
      if ((i & 63) === 0) { env = 0; for (const [c, wd, a] of bumps) { const x = (t - c - off) / wd; env += a * (x < 0 ? Math.exp(-x * x * 8) : Math.exp(-x)); } env *= Math.exp(-t / (dur * 0.45)); }
      const crack = near > 0.6 ? Math.exp(-t / 0.05) * (t < 0.25 ? 1 : 0) * w * 0.9 * near : 0;
      d[i] = br * env * 1.6 + br2 * env * 3 + crack;
    }
  } }
  const src = AC.createBufferSource(); src.buffer = b; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; const t0 = AC.currentTime;
  lp.frequency.setValueAtTime(near > 0.6 ? 4000 : 900, t0); lp.frequency.exponentialRampToValueAtTime(180, t0 + 1.2);
  const g = AC.createGain(); g.gain.value = 0.9 * (0.5 + near * 0.5); src.connect(lp).connect(g).connect(AC.destination); src.start(t0);
}
// bronze clang for a stone landing in the cauldron
function clang(vol = 0.3) { if (!AC) return; const t = AC.currentTime; [[196, 1, 2.6], [196 * 2.32, 0.6, 1.8], [196 * 4.15, 0.35, 1.1], [196 * 5.96, 0.2, 0.7], [196 * 8.3, 0.12, 0.4]].forEach(([f, a, d]) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + 0.05); }); noiseBurst(0.12, 4000, 1200, vol * 0.5, 'bandpass'); }
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
function banner(big, small = '', color = '#ffe9a8') { const b = document.getElementById('banner'); b.querySelector('b').textContent = LANG === 'en' && small ? small : big; b.querySelector('i').textContent = LANG === 'both' ? small : ''; b.style.color = color; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); }
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
// recorded one-shots (ElevenLabs) when shipped, synth otherwise
function playSfx(key, vol = 1) { const src = CFG.assets?.[key]; if (!src) return null; try { const a = new Audio(src); a.volume = vol; a.play().catch(() => {}); return a; } catch (_) { return null; } }
function sfxForge() { drum(0.5); if (!playSfx('forge', 0.9)) noiseBurst(1.6, 150, 700, 0.18, 'lowpass'); }
let endingEl = null, introEl = null;
// recorded narration (one natural Chinese voice), queued so lines never talk over each other
const VO_DUR = [0, 7.4, 5.1, 5.6, 4.4, 7.6, 3.0, 3.2, 3.1, 1.9, 3.4, 4.2, 2.0, 4.5, 7.0, 5.7, 4.3, 5.9, 6.2, 3.8];
let voEl = null; const voQ = [];
function vo(n, { interrupt = false } = {}) {
  if (!CFG.assets?.voice || !n) return false;
  const play = k => { try { voEl = new Audio(`${CFG.assets.voice}v${String(k).padStart(2, '0')}.mp3`); voEl.volume = 1; voEl.onended = () => { voEl = null; if (voQ.length) play(voQ.shift()); }; voEl.play().catch(() => { voEl = null; }); } catch (_) { voEl = null; } };
  if (interrupt) { voQ.length = 0; if (voEl) { voEl.onended = null; voEl.pause(); voEl = null; } }
  if (voEl && !voEl.ended) voQ.push(n); else play(n);
  return true;
}
function voStop() { voQ.length = 0; if (voEl) { voEl.onended = null; voEl.pause(); voEl = null; } }
function endingMusic(on) {
  if (!on) { if (endingEl) { endingEl.pause(); endingEl = null; } return; }
  if (!CFG.assets?.ending) return;
  if (bgmEl) { const b = bgmEl, v0 = b.volume; let k = 0; const iv = setInterval(() => { k += 0.05; b.volume = Math.max(0, v0 * (1 - k)); if (k >= 1) { clearInterval(iv); b.pause(); b.volume = v0; } }, 100); }
  endingEl = playSfx('ending', 0.85);
}
function sfxCrash() { drum(0.8); drum(0.6, 0.25); noiseBurst(0.6, 1200, 200, 0.2, 'lowpass'); }
function sfxMend(note) { bell(note, 4, 0.2); bell(note * 1.5, 3.5, 0.12, 0.15); bell(note * 2, 3, 0.1, 0.3); }
// ---------- narrator (browser speech, low and slow) + tension bed ----------
let zhVoice = null; const VOICE = false;
function pickVoice() { const vs = speechSynthesis?.getVoices?.() || []; zhVoice = vs.find(v => /zh[-_]CN/i.test(v.lang) && /Tingting|Yu-?shu|Xiaoxiao|Yunxi|Kangkang|Google/i.test(v.name)) || vs.find(v => /^zh/i.test(v.lang)) || null; }
try { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } catch (_) {}
function narrate(text, { rate = 0.82, pitch = 0.55, interrupt = true } = {}) {
  const EN = { '石头碎了……洪水在咆哮。': 'The stone shatters… the flood roars.', '只剩最后一块了。': 'Only one stone left.', '水已经漫过一半山谷。快，时间不多了。': 'The water has swallowed half the valley. Hurry.', '洪水就要吞没一切！': 'The flood is about to swallow everything!', '洪水吞没了山谷。一切，都沉入了黑暗。': 'The flood took the valley. All sank into darkness.' };
  const en = EN[text] || (/^天补上了一角/.test(text) ? `A corner of the sky is mended. ${5 - G.chain.length} to go.` : '');
  const zh = text.replace(/([。！])(?=[^\s])/g, '$1\n');
  $('sub').innerHTML = ''; $('sub').append(zhSpan(zh)); if (en) { const sm = document.createElement('small'); sm.textContent = en; $('sub').append(sm); } $('sub').classList.add('on'); clearTimeout(narrate._t); narrate._t = setTimeout(() => $('sub').classList.remove('on'), 2500 + text.length * 260);
  const VN = { '石头碎了……洪水在咆哮。': 10, '只剩最后一块了。': 9, '水已经漫过一半山谷。快，时间不多了。': 11, '洪水就要吞没一切！': 12, '洪水吞没了山谷。一切，都沉入了黑暗。': 13, '天补上了一角。还差四块。': 6, '天补上了一角。还差三块。': 7, '天补上了一角。还差两块。': 8 };
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
// language: 'both' | 'zh' | 'en'. Bilingual strings are written '中文 · English'; L() keeps the half the player chose
let LANG = 'both'; try { LANG = localStorage.getItem('butian-lang') || 'both'; } catch (_) {}
const CJK = /[\u3400-\u9fff]/;
function L(t) { if (LANG === 'both' || !t || !t.includes(' · ')) return t; const parts = t.split(' · '); const keep = parts.filter(x => CJK.test(x) === (LANG === 'zh')); return (keep.length ? keep : parts).join(' · '); }
const zhSpan = t => Object.assign(document.createElement('span'), { className: 'zh-t', textContent: t });
function setLang(l) { LANG = l; try { localStorage.setItem('butian-lang', l); } catch (_) {} document.body.dataset.lang = l; document.querySelectorAll('.langbtn').forEach(b => b.textContent = { both: '中/EN', zh: '中文', en: 'EN' }[l]); }
document.querySelectorAll('.langbtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); setLang({ both: 'zh', zh: 'en', en: 'both' }[LANG]); try { hudRing(); } catch (_) {} }));
setLang(LANG);
function say(text, ms = 3200) { const el = $('msg'); el.textContent = L(text); el.classList.add('on'); clearTimeout(say._t); say._t = setTimeout(() => el.classList.remove('on'), ms); }
function hudRing() {
  const need = G.chain.length ? NEXT[G.chain[G.chain.length - 1]] : null;
  EL.forEach((e) => {
    const n = $('el-' + e.key);
    n.classList.toggle('done', G.chain.includes(e.key));
    n.classList.toggle('next', need === e.key);
  });
  $('ring-hint').textContent = L(G.chain.length === 0 ? '第一块，你来选 · Your first stone is free'
    : G.chain.length < 5 ? `下一块：${EL.find(e => e.key === need).zh} · Next: ${EL.find(e => e.key === need).en}` : '五石已炼成石浆 · The five stones are one');
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
  // Nüwa's wide hanfu sleeve: flares open at the wrist, white under-layer, gold hem (first-person only)
  const sl = new THREE.Group(); sl.userData.sleeve = 1; hand.add(sl);
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.08, 0.42, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xa3322a, roughness: 0.75, side: THREE.DoubleSide }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(0, -0.03, 0.33); sl.add(outer);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.07, 0.3, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.9, side: THREE.DoubleSide }));
  inner.rotation.x = -Math.PI / 2; inner.position.set(0, -0.02, 0.3); sl.add(inner);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 6, 24), new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.7, roughness: 0.35, emissive: 0x3a2400 }));
  hem.position.set(0, -0.03, 0.12); sl.add(hem);
  sl.visible = false;
  hand.add(new THREE.PointLight(0xfff0d0, 0.6, 2));
  hand.rotation.set(0.25, 0.15, 0.1);
  camera.add(hand);
}
const HAND_REST = new THREE.Vector3(...(CFG.world?.hand?.rest || [0.28, -0.2, -0.5]));
let reachT = 0;
function aimAt(target, maxD, loose = 1) {
  const d = tmpA.copy(target).sub(camera.position); const dist = d.length(); if (dist > maxD) return false;
  camera.getWorldDirection(tmpB); return d.normalize().dot(tmpB) > Math.cos((dist < 6 ? 0.5 : 0.3) * loose);
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const throws = [];
// the stone resting in the first-person palm draws over the hand, like any held item in a first-person game
// first person: a centred copy of the stone sits in Nüwa's palm as a child of the hand, sized in metres
function heldShow(o) {
  if (G.held?.o === o) return; heldHide();
  const c = o.stone.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.setScalar(1); c.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(c), sz = b.getSize(new THREE.Vector3()), ct = b.getCenter(new THREE.Vector3());
  const g = new THREE.Group(); c.position.sub(ct); g.add(c); g.scale.setScalar((CFG.world?.hand?.heldSize ?? 0.11) / Math.max(sz.x, sz.y, sz.z));
  const H = CFG.world?.hand || {}; g.position.fromArray(H.held || [-0.062, 0.2, -0.06]);
  c.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.depthTest = false; m.renderOrder = 2000; } });
  hand.add(g); G.held = { o, g };
}
function heldHide() { if (G.held) { hand.remove(G.held.g); G.held = null; } }
function setOnTop(o, on) { if (!!o.onTop === on) return; o.onTop = on; o.stone.traverse(m => { if (m.isMesh) { m.material.depthTest = !on; m.renderOrder = on ? 2000 : 0; } }); }
function handAction() {
  if (G.phase !== 'play' || G.paused || G.forging || throws.length || G.cut) return;
  if (TP) {
    AV.reach = 0.45; reachT = 0.35;
    if (!G.carrying) { const o = nearestOreTP(); if (o) { G.grabFrom = o.stone.position.clone(); G.grabT = 0; return interact(o); } say('走到发光的五行石旁边，再按 E 或左键 · Walk up to a glowing stone, then press E or click', 2400); }
    else if (furnaceDist() < (CFG.world?.throwRange ?? 7)) {
      const o = G.carrying; G.carrying = null; const fpos = new THREE.Vector3(FURNACE_POS.x, G.furnace.y + (CFG.world?.furnaceSize ?? 3) * 0.8, FURNACE_POS.y);
      if (G.held) { G.held.g.getWorldPosition(o.stone.position); heldHide(); } o.stone.visible = true; throws.push({ o, from: o.stone.position.clone(), to: fpos, t: 0 }); noiseBurst(0.35, 300, 900, 0.12, 'lowpass');
    } else say('带着石头走到铜炉旁边 · Carry it to the bronze furnace', 2000);
    return;
  }
  reachT = 0.35;
  if (!G.carrying) {
    let best = null, bd = 1e9;
    for (const o of G.ores) { if (o.taken || o.used) continue; const dd = o.stone.position.distanceTo(camera.position); if (dd < bd && (o === G.hover || aimAt(o.stone.position, 30))) { bd = dd; best = o; } }
    if (!best) { let bd2 = 7; for (const o of G.ores) { if (o.taken || o.used) continue; const d2 = Math.hypot(o.home.x - player.pos.x, o.home.z - player.pos.z); if (d2 < bd2) { bd2 = d2; best = o; } } }
    if (best) { G.grabFrom = best.stone.position.clone(); G.grabT = 0; return interact(best); }
    say('对准发光的原石，再点击抓取 · Aim at an ore and click', 1800);
  } else {
    const fpos = new THREE.Vector3(FURNACE_POS.x, G.furnace.y + (CFG.world?.furnaceSize ?? 3) * 0.8, FURNACE_POS.y);
    if (aimAt(fpos, 35) || Math.hypot(FURNACE_POS.x - player.pos.x, FURNACE_POS.y - player.pos.z) < 10) {
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
    if (o) { o.taken = true; o.beam.visible = false; o.light.visible = false; G.carrying = o; emit(o.stone.position, o.el.color, 50, 3, 2.5, 0.9); noiseBurst(0.16, 700, 140, 0.18, 'lowpass'); pluck(o.el.note, 1.2, 0.15); sfxPick(o.el.note); fovKick = 4; banner(`得 ${o.el.zh}`, `${o.el.en} ore`, '#' + new THREE.Color(o.el.color).getHexString()); if (G.tut < 1) { G.tut = 1; say(`第二步：带着${o.el.zh}回到铜炉，扔进去 · Bring it to the furnace and throw it in`, 6000); } else say(`拾起${o.el.name}（${o.el.zh}）· 带回炉中炼化`); pluck(o.el.note * 2, 0.8, 0.1, 0.12); return; }
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
    say(`${o.el.zh}不承${EL.find(e => e.key === G.chain[G.chain.length - 1]).zh}，石碎了，洪水上涨。需要：${needEl.zh} · Wrong order! Need ${needEl.en}`, 4200);
    o.taken = false; o.stone.visible = true; o.stone.scale.setScalar(1); o.stone.position.copy(o.home); o.beam.visible = true; o.light.visible = true;
    return;
  }
  // correct: the stone melts into the furnace and waits there; when all five are in, they fuse into one molten stone
  G.chain.push(o.el.key); o.used = true; o.stone.visible = false;
  whoosh(); emit(new THREE.Vector3(FURNACE_POS.x, G.furnace.y + 3, FURNACE_POS.y), o.el.color, 120, 5, 3, 1.6);
  furnaceGem(o.el); pluck(o.el.note, 3.2, 0.25);
  G.water = Math.max(CFG.world?.water?.water ?? -2.6, G.water - (CFG.world?.water?.drop ?? 1.2)); G.rate *= 0.9;
  hudRing();
  const left = 5 - G.chain.length;
  banner(`炼 入 ${o.el.zh}`, `${o.el.en} stone melted in · ${G.chain.length} / 5`, '#' + new THREE.Color(o.el.color).getHexString());
  if (left > 0) {
    const nx = EL.find(e => e.key === NEXT[o.el.key]);
    setTimeout(() => say(`${o.el.zh}石已熔入铜炉，还差 ${left} 块。下一块：${nx.zh} · ${left} to go. Next: ${nx.en}`, 6000), 1800);
    return;
  }
  setTimeout(fuseAndFly, 1600);
}
// the five molten stones inside the furnace, circling above its mouth
const gems = [];
function furnaceGem(el) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: el.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  scene.add(m); gems.push(m); G.furnace.ember.material.color.lerp(new THREE.Color(el.color), 0.35);
}
function updateGems(dt) {
  gems.forEach((m, i) => { const a = G.t * 1.6 + i * Math.PI * 2 / 5; m.visible = G.phase === 'play' || G.phase === 'cine'; m.position.set(FURNACE_POS.x + Math.cos(a) * 0.9, G.furnace.y + (CFG.world?.furnaceSize ?? 3) * 0.85 + Math.sin(G.t * 3 + i) * 0.15, FURNACE_POS.y + Math.sin(a) * 0.9); });
}
// five stones become one: a molten five-coloured slurry Nüwa carries to the sky in a single flight
const lavaMat = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float uT; varying vec3 vN; varying vec3 vP;
    void main(){ float a = atan(vP.z, vP.x) + uT * 0.8 + sin(vP.y * 3.0 + uT * 2.0);
      vec3 c = 0.5 + 0.5 * cos(6.2832 * (a / 6.2832 + vec3(0.0, 0.33, 0.67)));
      float rim = pow(1.0 - abs(vN.z), 1.6);
      gl_FragColor = vec4(mix(vec3(1.0, 0.92, 0.75), c, 0.55 + 0.35 * rim) * (1.1 + rim), 0.95); }` });
function fuseAndFly() {
  if (G.phase !== 'play') return;
  const top = new THREE.Vector3(FURNACE_POS.x, G.furnace.y + 3, FURNACE_POS.y);
  banner('五 石 合 炼', 'The five stones fuse into one', '#ffe2a0'); gong(); drum(0.8); shake = 0.6; flash(0xfff0d0);
  EL.forEach((e, k) => setTimeout(() => emit(top, e.color, 90, 5, 4, 1.8), k * 120));
  gems.forEach(m => scene.remove(m)); gems.length = 0;
  const orb = new THREE.Group(); const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 24), lavaMat); orb.add(core);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); orb.add(halo);
  { const pl = new THREE.PointLight(0xffe0b0, 12, 14); orb.add(pl); }
  orb.position.copy(top); scene.add(orb);
  say('五色石熔成了石浆。女娲托起它，飞向天裂 · The five stones melt into one. Nüwa carries it to the broken sky.', 5000);
  const mid = crackSegs[2].center;
  flights.push({ obj: orb, all: true, nuwa: true, from: avatar.position.clone(), t: 0, el: EL.find(e => e.key === G.chain[4]) });
  AV.fly = { t: 0, back: player.pos.clone(), yaw: Math.atan2(player.pos.x - mid.x, 18) }; G.cut = true;
  G.chain.forEach((k, n) => { crackSegs[n].el = EL.find(e => e.key === k); });
}
const flights = [];
let shake = 0;


// the molten stone is pressed into one stretch of the crack
function mendSeg(seg, el, n) {
  emit(seg.center, el.color, 220, 9, 0, 2.4); emit(seg.center, 0xffffff, 60, 5, 0, 1.6); flash(el.color); gong(); sfxMend(el.note); shake = 0.3; fovKick = 6;
  banner(`补天 ${['一', '二', '三', '四', '五'][n]}`, `${n + 1} / 5 sealed`, '#' + new THREE.Color(el.color).getHexString());
  seg.mended = 0.001; G.restoreAnim[EL.indexOf(el)] = 0.001;
}
// a stone reaches the crack: seal that stretch of sky
function mendArrive(f) {
  setTimeout(() => scene.remove(f.obj), 100);
  f.obj.visible = false; emit(f.seg.center, f.el.color, 260, 9, 0, 2.4); emit(f.seg.center, 0xffffff, 80, 5, 0, 1.6); flash(f.el.color); gong(); sfxMend(f.el.note); shake = 0.35; fovKick = 10;
  banner(`补天 ${['一', '二', '三', '四', '五'][G.chain.length - 1] || ''}`, `${G.chain.length} / 5 mended`, '#' + new THREE.Color(f.el.color).getHexString());
  f.seg.mended = 0.001; G.restoreAnim[EL.indexOf(f.el)] = 0.001;
  say(`${f.el.name}补上了天。${f.el.zh}气归于大地。 · The ${f.el.en} stone seals the sky.`);
  if (G.chain.length === 5 && !f.nuwa) setTimeout(win, 1800);
}
// Nüwa gathers herself, soars to the crack with the molten stone above her head, seals it, then glides back down
function nuwaFlightAll(f, i, dt) {
  const A = AV.fly; A.t += dt; const up = 1.2, rise = 3.8, per = 1.7, hold = 1.4, down = 2.8, C = crackSegs.map(c => c.center);
  const ground = () => Math.max(groundFn(A.back.x, A.back.z), G.water) + 0.35;
  const off = c => tmpB.copy(c).add(new THREE.Vector3(0, -NUWA_H - 1, 6));
  lavaMat.uniforms.uT.value = G.t;
  const tSweep = up + rise, tHold = tSweep + per * (C.length - 1), tDown = tHold + hold;
  if (A.t < up) { avatar.position.y += dt * 0.4; f.obj.position.lerp(tmpA.copy(avatar.position).add(tmpV.set(0, NUWA_H + 0.6, 0)), Math.min(1, dt * 3)); if (Math.random() < 0.7) emit(f.obj.position, EL[(Math.random() * 5) | 0].color, 2, 1, 1, 1); }
  else if (A.t < tSweep) {
    if (!f.from2) f.from2 = avatar.position.clone();
    const k = (A.t - up) / rise, e = k * k * (3 - 2 * k); const to = off(C[0]);
    avatar.position.lerpVectors(f.from2, to, e); avatar.position.y = THREE.MathUtils.lerp(f.from2.y, to.y, Math.sin(e * Math.PI / 2));
    AV.face = THREE.MathUtils.lerp(AV.face, Math.atan2(-(to.x - f.from2.x), -(to.z - f.from2.z)), dt * 4);
  } else if (A.t < tHold + 0.001) {
    const q = Math.min(C.length - 1, (A.t - tSweep) / per), n = Math.floor(q), k = q - n;
    f.sealed = f.sealed || 0; while (f.sealed <= n) { mendSeg(crackSegs[f.sealed], crackSegs[f.sealed].el, f.sealed); f.sealed++; }
    if (n < C.length - 1) { const e = k * k * (3 - 2 * k); avatar.position.lerpVectors(off(C[n]).clone(), off(C[n + 1]), e); AV.face = THREE.MathUtils.lerp(AV.face, Math.atan2(-(C[n + 1].x - C[n].x), -(C[n + 1].z - C[n].z)), dt * 4); }
  } else if (A.t < tDown) { if (f.sealed < C.length) { mendSeg(crackSegs[C.length - 1], crackSegs[C.length - 1].el, C.length - 1); f.sealed = C.length; } f.obj.scale.multiplyScalar(Math.max(0, 1 - dt * 2)); avatar.position.y += Math.sin(A.t * 2) * 0.003; if (!f.top) f.top = avatar.position.clone(); }
  else {
    if (f.obj.parent) scene.remove(f.obj);
    const k = Math.min(1, (A.t - tDown) / down), e = k * k * (3 - 2 * k);
    avatar.position.lerpVectors(f.top, tmpV.set(A.back.x, ground(), A.back.z), e);
    if (k >= 1) { flights.splice(i, 1); AV.fly = null; G.cut = false; player.pos.copy(A.back); win(); return; }
  }
  if (A.t >= up && A.t < tHold + 0.5) { f.obj.position.copy(avatar.position).add(tmpV.set(0, NUWA_H + 0.6, 0)); f.obj.rotation.y += dt * 2; if (Math.random() < 0.8) emit(f.obj.position, EL[(Math.random() * 5) | 0].color, 3, 0.6, -1, 1.2); }
  avatar.rotation.y = AV.face; avatar.rotation.x = THREE.MathUtils.lerp(avatar.rotation.x, A.t > up && A.t < tHold ? -0.3 : 0, Math.min(1, dt * 3)); avatar.rotation.z = Math.sin(A.t * 1.3) * 0.05;
  // camera: off to the side and below, travelling with her along the crack
  const tgt = tmpA.copy(avatar.position).add(tmpB.set(0, 1.2, 0));
  const want = new THREE.Vector3(tgt.x + 10, tgt.y - 2.5, tgt.z + 6);
  want.y = Math.max(want.y, groundFn(want.x, want.z) + 1, G.water + 1);
  AV.camPos.lerp(want, Math.min(1, dt * 2.5)); camera.position.copy(AV.camPos); camera.lookAt(tgt);
}
function nuwaFlight(f, i, dt) {
  const A = AV.fly; A.t += dt; const up = 0.9, rise = 3.6, hold = 1.6, down = 2.6;
  const ground = () => Math.max(groundFn(A.back.x, A.back.z), G.water) + 0.35;
  if (A.t < up) { avatar.position.y += dt * 0.4; if (Math.random() < 0.6) emit(avatar.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 2, (Math.random() - 0.5) * 1.5)), f.el.color, 2, 1.2, 2, 1); f.obj.position.copy(avatar.position).add(tmpV.set(0, NUWA_H + 0.5, 0)); f.obj.scale.setScalar(0.5); if (!A.whoosh) { A.whoosh = 1; whoosh(); } }
  else if (A.t < up + rise) {
    const k = (A.t - up) / rise, e = k * k * (3 - 2 * k);
    avatar.position.lerpVectors(f.from, f.to, e); avatar.position.y = THREE.MathUtils.lerp(f.from.y, f.to.y, Math.sin(e * Math.PI / 2));
    f.obj.position.copy(avatar.position).add(tmpV.set(0, NUWA_H + 0.5, 0)); f.obj.scale.setScalar(0.5 + e * 1.2); f.obj.rotation.y += dt * 4;
    emit(avatar.position.clone().add(tmpV.set(0, 1, 0)), f.el.color, 4, 0.6, -1, 1.4); emit(f.obj.position, 0xfff0c0, 2, 0.4, 0, 0.8);
    AV.face = THREE.MathUtils.lerp(AV.face, Math.atan2(-(f.to.x - f.from.x), -(f.to.z - f.from.z)), dt * 4);
  } else if (!f.done) { f.done = true; f.obj.position.copy(f.seg.center); mendArrive(f); }
  else if (A.t < up + rise + hold) { avatar.position.y = f.to.y + Math.sin(A.t * 2) * 0.2; }
  else {
    const k = Math.min(1, (A.t - up - rise - hold) / down), e = k * k * (3 - 2 * k);
    avatar.position.lerpVectors(f.to, tmpV.set(A.back.x, ground(), A.back.z), e);
    if (k >= 1) { flights.splice(i, 1); AV.fly = null; G.cut = false; player.pos.copy(A.back); player.yaw = A.yaw; player.pitch = 0.05; AV.blend = 1; AV.blendPos = camera.position.clone(); AV.blendQ = camera.quaternion.clone(); if (G.chain.length === 5) win(); }
  }
  avatar.rotation.y = AV.face; avatar.rotation.x = THREE.MathUtils.lerp(avatar.rotation.x, A.t > up && A.t < up + rise ? -0.35 : 0, Math.min(1, dt * 3)); avatar.rotation.z = Math.sin(A.t * 1.3) * 0.05; // a static model still drifts and banks a little
  // camera: behind and below Nüwa, keeping the crack in frame
  const tgt = tmpA.copy(avatar.position).add(tmpB.set(0, 1.2, 0));
  const want = new THREE.Vector3(tgt.x + Math.sin(A.yaw) * 11, tgt.y - 2.5, tgt.z + Math.cos(A.yaw) * 11);
  want.y = Math.max(want.y, groundFn(want.x, want.z) + 1, G.water + 1);
  AV.camPos.lerp(want, Math.min(1, dt * 3)); camera.position.copy(AV.camPos); camera.lookAt(tgt.lerp(f.seg.center, 0.25));
}
// third-person: Nüwa hovers where the player is, faces where she moves; the camera trails behind her shoulder
function updateAvatar(dt, eye) {
  avatar.visible = true;
  const dx = player.pos.x - AV.lx, dz = player.pos.z - AV.lz; AV.lx = player.pos.x; AV.lz = player.pos.z;
  const sp = dt > 0 ? Math.hypot(dx, dz) / dt : 0; AV.speed = THREE.MathUtils.lerp(AV.speed, Math.min(sp, 15), Math.min(1, dt * 8));
  if (!AV.fly) {
    if (sp > 0.3) { let want = Math.atan2(-dx, -dz), d = want - AV.face; d = Math.atan2(Math.sin(d), Math.cos(d)); AV.face += d * Math.min(1, dt * 10); }
    const base = Math.max(player.pos.y, G.water) + 0.3 + (player.jy || 0) * 1.6;
    avatar.position.set(player.pos.x, base + Math.sin(G.t * 1.7) * 0.07, player.pos.z);
    avatar.rotation.set(-Math.min(0.25, AV.speed * 0.02), AV.face, 0);
  }
  // robe sway, arms reach for a pickup, ribbon flutter
  AV.reach = Math.max(0, AV.reach - dt);
  const ud = nuwaBody.userData, rk = Math.sin(Math.min(1, (0.45 - AV.reach) / 0.45) * Math.PI) * (AV.reach > 0 ? 1 : 0);
  if (ud.armL) { const lift = G.carrying ? 0.7 : 0.15 + rk * 0.9; ud.armL.rotation.x = lift + Math.sin(G.t * 1.3) * 0.05; ud.armR.rotation.x = lift + Math.sin(G.t * 1.3 + 1) * 0.05; }
  if (ud.ribbon) { ud.ribbon.rotation.x = 0.15 + Math.sin(G.t * 2.1) * 0.08 + AV.speed * 0.03; ud.ribbon.rotation.z = Math.sin(G.t * 1.4) * 0.06; }
  if (nuwaMixer) { nuwaMixer.update(dt); const w = Math.min(1, AV.speed / 5); nuwaActs.walk?.setEffectiveWeight(w); nuwaActs.idle?.setEffectiveWeight(1 - w); }
  if (AV.fly) { nuwaBody.visible = true; return; } // the flight drives the camera
  if (FPV) {
    nuwaBody.visible = false; AV.face = player.yaw;
    camera.position.set(player.pos.x, eye + Math.abs(Math.sin(G.walkT || 0)) * 0.06, player.pos.z);
    camera.rotation.order = 'YXZ'; camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    if (AV.blend > 0) { // glide back from the flight camera into Nüwa's eyes instead of cutting
      AV.blend = Math.max(0, AV.blend - dt * 1.4); const k = 1 - AV.blend, e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(AV.blendPos, tmpB.copy(camera.position), e); camera.quaternion.slerpQuaternions(AV.blendQ, tmpQ.copy(camera.quaternion), e);
    }
    AV.camPos.copy(camera.position); AV.camInit = true; return;
  }
  const phi = THREE.MathUtils.clamp(0.28 - player.pitch * 0.8, -0.15, 1.1), dist = CFG.world?.camDist ?? 6;
  const tgt = tmpA.set(avatar.position.x, avatar.position.y + NUWA_H * 0.78, avatar.position.z);
  const rx = Math.cos(player.yaw) * 0.7, rz = -Math.sin(player.yaw) * 0.7;
  const want = tmpB.set(tgt.x + Math.sin(player.yaw) * Math.cos(phi) * dist + rx, tgt.y + Math.sin(phi) * dist, tgt.z + Math.cos(player.yaw) * Math.cos(phi) * dist + rz);
  want.y = Math.max(want.y, groundFn(want.x, want.z) + 0.6, G.water + 0.5);
  if (!AV.camInit) { AV.camPos.copy(want); AV.camInit = true; } else AV.camPos.lerp(want, Math.min(1, dt * 12));
  camera.position.copy(AV.camPos); camera.lookAt(tgt.x + rx, tgt.y, tgt.z + rz);
}
// the ending, after the fifth stone, told after 《淮南子·览冥训》:
// the turtle's legs become four pillars, the black dragon is slain, reed ash stills the flood, the world returns, and Nüwa gives herself back to heaven and earth
function caption(zh, en, ms) {
  const CN = [['天补好了', 14], ['黑龙', 15], ['她又烧起', 16], ['苍天补', 17], ['天地复原', 18], ['这片山河', 19]].find(([k]) => zh.startsWith(k));
  if (CN) vo(CN[1]);
  const c = $('cine'), line = $('cine-line'); c.hidden = false; c.classList.add('soft'); c.onclick = null; line.classList.remove('on');
  setTimeout(() => { line.innerHTML = ''; line.append(zhSpan(zh), Object.assign(document.createElement('small'), { textContent: en })); line.classList.add('on'); }, 250);
  clearTimeout(caption._t); caption._t = setTimeout(() => line.classList.remove('on'), ms);
}
const pillars = [];
function finaleTick(dt) {
  const t = G.endT, once = (k, at, fn) => { if (t > at && !G['fin' + k]) { G['fin' + k] = 1; fn(); } };
  once(1, 2.5, () => {
    caption('天补好了　却没有支柱\n女娲斩下巨鳌的四足　立起天的四极', 'The sky was whole but unpropped; Nüwa took the great turtle\'s four legs as pillars for the four corners.', 5600);
    const B = CFG.world?.bounds || [-40, 40, -40, 40], pts = [[B[0] + 4, B[2] + 4], [B[1] - 4, B[2] + 4], [B[0] + 4, B[3] - 4], [B[1] - 4, B[3] - 4]];
    pts.forEach(([x, z], i) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 1, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); m.position.set(x, groundFn(x, z), z); m.scale.y = 0.01; scene.add(m); pillars.push({ m, d: i * 0.5 }); drum(0.5, i * 0.5); });
  });
  pillars.forEach(p => { const k = THREE.MathUtils.clamp((t - 2.8 - p.d) / 2.2, 0, 1); const h = 140 * (1 - Math.pow(1 - k, 3)); p.m.scale.y = Math.max(0.01, h); p.m.position.y = groundFn(p.m.position.x, p.m.position.z) + h / 2; if (k > 0 && k < 1) emit(new THREE.Vector3(p.m.position.x, groundFn(p.m.position.x, p.m.position.z) + 0.5, p.m.position.z), 0xffd27a, 3, 3, 2, 1.2); });
  once(2, 8.5, () => { caption('黑龙兴风作浪\n女娲斩杀黑龙　风浪平息', 'The black dragon churned the flood; Nüwa slew it, and the waves fell still.', 5000); playSfx('dragon', 1); stinger(); setTimeout(() => { flash(0xffffff); thunderSfx(1); gong(); shake = 1.2; emit(new THREE.Vector3(player.pos.x, G.water + 1, player.pos.z - 25), 0x111111, 300, 14, 4, 2.5); emit(new THREE.Vector3(player.pos.x, G.water + 1, player.pos.z - 25), 0xffe8b0, 120, 10, 6, 1.6); }, 1600); });
  once(3, 14, () => { caption('她又烧起芦苇　积起芦灰\n挡住了洪水', 'She burned the reeds and piled their ash to stop the flood.', 5600); });
  if (t > 14 && t < 21) for (let k = 0; k < 5; k++) emit(new THREE.Vector3(player.pos.x + (Math.random() - 0.5) * 70, 16 + Math.random() * 12, player.pos.z - 15 + (Math.random() - 0.5) * 70), Math.random() < 0.6 ? 0xb0a080 : 0xffc870, 1, 0.4, -1.6, 5);
  G.water = THREE.MathUtils.lerp(G.water, t > 14 ? (CFG.world?.water?.water ?? -2.6) - 4 : G.water, dt * 0.35);
  once(4, 20.5, () => { flash(0xffffff); if (worldB) { worldB.visible = true; water.visible = false; if (splatMesh) splatMesh.visible = false; if (G.furnace) G.furnace.obj.visible = false; G.villagers.forEach(v => v.visible = false); } EL.forEach((e, i) => pluck(e.note, 5, 0.16, i * 0.3)); });
  once(5, 22, () => caption('苍天补　四极正\n淫水涸　冀州平', 'The sky was mended and the four pillars stood upright; the flood dried and the land was at peace.', 6500));
  once(6, 29.5, () => caption('天地复原　百姓重生\n女娲耗尽了力量　身归天地', 'Heaven and earth were restored and the people lived on. Spent, Nüwa gave herself back to the world.', 7000));
  // the whole world is her gift: the title page's 礼 seal comes down on it, full size
  once(7, 36.5, () => caption('这片山河　是女娲留给人间的礼物', 'This world is the gift Nüwa left to us.', 6000));
  if (t > 31 && t < 37) { const k = (t - 31) / 6; nuwaBody.scale.setScalar(Math.max(0.001, 1 - k)); if (Math.random() < 0.8) emit(avatar.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * NUWA_H, (Math.random() - 0.5) * 1.2)), Math.random() < 0.5 ? 0xffe0a0 : EL[Math.floor(Math.random() * 5)].color, 3, 1.2, 3, 2.5); }
}
let worldB = null;
async function loadWorldB() {
  const W = CFG.world; if (!W?.spzB) return;
  try { worldB = new SplatMesh({ fileBytes: await loadBin(W.spzB), fileType: 'spz' }); const t = W.transformB || W.transform || {}; if (t.position) worldB.position.fromArray(t.position); worldB.quaternion.fromArray(t.quaternion || [1, 0, 0, 0]); if (t.scale) worldB.scale.setScalar(t.scale); worldB.visible = false; scene.add(worldB); }
  catch (e) { console.warn('world B failed', e); worldB = null; }
}
// ---------- loop ----------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
function update(dt) {
  if (!(TP && (G.phase === 'play' || G.phase === 'won'))) avatar.visible = false;
  if (G.phase !== 'play' || G.paused) $('reticle')?.classList.remove('on');
  G.t += dt; skyMat.uniforms.uT.value = G.t;
  // flood
  if (G.phase === 'play' && !G.cut) {
    G.rate += dt * 0.00009;
    G.water += G.rate * dt;
    if (G.water >= G.failLevel) lose();
  } else if (G.phase === 'won') {
    G.water = THREE.MathUtils.lerp(G.water, -4, dt * 0.4);
  }
  water.position.y = G.water; updateQuake(dt);
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
  if (G.phase === 'play' && !G.cut) {
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1; if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1;
    fx += touch.mx; fz += touch.my;
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      fx /= Math.max(1, len); fz /= Math.max(1, len);
      // cast from just above the head so overhangs and stray collider shards overhead don't count as ground
      const head = player.pos.y + 2.5, gy = groundFn(player.pos.x, player.pos.z, head);
      const depth = G.water - gy;
      let sp = (keys.ShiftLeft || keys.ShiftRight) ? (CFG.world?.run ?? 15) : (CFG.world?.walk ?? 9.5);
      if (depth > 1.3) sp *= 0.32; else if (depth > 0.25) sp *= 0.55;
      const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
      const nx = player.pos.x + (fx * c + fz * s) * sp * dt, nz = player.pos.z + (-fx * s + fz * c) * sp * dt;
      const ny = groundFn(nx, nz, head);
      // a slope too steep blocks you, but never for long: after a moment you are let through so nobody gets trapped
      if (ny - gy < 2.2 * Math.max(dt * 10, 0.4) || ny < gy || (G.stuckT = (G.stuckT || 0) + dt) > 0.6) { player.pos.x = nx; player.pos.z = nz; if (ny - gy < 1) G.stuckT = 0; }
      G.walkT = (G.walkT || 0) + dt * sp * 0.9; if (Math.floor(G.walkT / Math.PI) !== G.lastStep) { G.lastStep = Math.floor(G.walkT / Math.PI); step(); if (depth > 0.2) emit(new THREE.Vector3(player.pos.x, G.water + 0.05, player.pos.z), 0xcfe3f0, 6, 1.2, 1.2, 0.6); }
    }
    const lim = CFG.world?.bounds || [-140, 140, -160, 160];
    player.pos.x = THREE.MathUtils.clamp(player.pos.x, lim[0], lim[1]); player.pos.z = THREE.MathUtils.clamp(player.pos.z, lim[2], lim[3]);
  }
  const gy = groundFn(player.pos.x, player.pos.z, Number.isFinite(player.pos.y) ? player.pos.y + 2.5 : undefined);
  player.pos.y = THREE.MathUtils.lerp(player.pos.y || gy, gy, Math.min(1, dt * 12));
  if (player.jv || player.jy) { player.jv = (player.jv || 0) - 22 * dt; player.jy = (player.jy || 0) + player.jv * dt; if (player.jy <= 0) { if (player.jv < -6) { step(); shake = 0.12; } player.jy = 0; player.jv = 0; } }
  const eye = Math.max(player.pos.y + 1.7, G.water + 0.6) + (player.jy || 0);

  if (G.phase === 'cine') {
    G.cineT = (G.cineT || 0) + dt; const k = Math.min(1, G.cineT / 24);
    const c = crackSegs[2].center; const a = 0.6 + k * 1.4, r = 22 - k * 8;
    camera.position.set(START_POS.x + Math.sin(a) * r * 0.6, groundFn(START_POS.x, START_POS.y) + 4 + k * 3, START_POS.y + Math.cos(a) * r * 0.5);
    camera.lookAt(THREE.MathUtils.lerp(c.x, START_POS.x, 0.4), THREE.MathUtils.lerp(c.y, camera.position.y, 0.35 + k * 0.3), THREE.MathUtils.lerp(c.z, START_POS.y, 0.4));
    G.water = (CFG.world?.water?.water ?? -2.6) + Math.sin(G.t * 0.5) * 0.15; water.position.y = G.water;
  } else if (G.phase === 'lost') {
    G.loseT += dt; const t = G.loseT;
    G.water = G.loseY + Math.min(t, 3) * 1.4; water.position.y = G.water;
    const up = THREE.MathUtils.smoothstep(t, 2.2, 6), base = new THREE.Vector3(player.pos.x, eye, player.pos.z);
    camera.position.set(base.x, THREE.MathUtils.lerp(player.pos.y + 1.7, G.water + 22, up), base.z + up * 18);
    camera.rotation.order = 'YXZ'; camera.rotation.set(THREE.MathUtils.lerp(player.pitch, -0.55, up), player.yaw * (1 - up), 0, 'YXZ');
    $('drown').style.opacity = camera.position.y < G.water ? 0.85 : Math.max(0, 0.85 - (camera.position.y - G.water) * 0.3);
    shake = Math.max(shake, 0.15 * (1 - up)); if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake; }
  } else if (G.phase !== 'won' && TP) {
    updateAvatar(dt, eye);
    fovKick *= Math.pow(0.02, dt); const fv = (FPV && !AV.fly ? 70 : 62) + fovKick; if (Math.abs(camera.fov - fv) > 0.01) { camera.fov = fv; camera.updateProjectionMatrix(); }
    if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
  } else if (G.phase !== 'won') {
    camera.position.set(player.pos.x, eye + Math.abs(Math.sin(G.walkT || 0)) * 0.06, player.pos.z);
    camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
    fovKick *= Math.pow(0.02, dt); const fv = 70 + fovKick; if (Math.abs(camera.fov - fv) > 0.01) { camera.fov = fv; camera.updateProjectionMatrix(); }
    if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
  } else {
    G.endT += dt; if (G.endShowT != null) { const k = Math.min(1, (G.endT - G.endShowT) / 2.6); $('end').style.opacity = k * k * (3 - 2 * k); }
    const k = Math.min(1, G.endT / 9), e = k * k * (3 - 2 * k);
    if (TP) { nuwaBody.visible = true; finaleTick(dt); const FC = CFG.world?.finaleCam; // a narrow canyon needs a hand-placed camera: [x,y,z] from/to and a look target
      if (FC) { const P = FC.to, L = FC.look; camera.position.set(THREE.MathUtils.lerp(player.pos.x, P[0], e), THREE.MathUtils.lerp(eye + 1.5, P[1], e), THREE.MathUtils.lerp(player.pos.z + 4, P[2], e)); camera.lookAt(THREE.MathUtils.lerp(player.pos.x, L[0], e), THREE.MathUtils.lerp(eye + 1, L[1], e), THREE.MathUtils.lerp(player.pos.z - 10, L[2], e)); }
      else { camera.position.set(player.pos.x + Math.sin(player.yaw) * (6 + e * 40), THREE.MathUtils.lerp(eye + 2, eye + 45, e), player.pos.z + Math.cos(player.yaw) * (6 + e * 40)); camera.lookAt(THREE.MathUtils.lerp(player.pos.x, 0, e), THREE.MathUtils.lerp(eye, 30, e), THREE.MathUtils.lerp(player.pos.z, -60, e)); } avatar.position.set(player.pos.x, Math.max(groundFn(player.pos.x, player.pos.z), G.water) + 0.35 + Math.sin(G.t * 1.6) * 0.08, player.pos.z); avatar.visible = true; }
    else { camera.position.set(player.pos.x, THREE.MathUtils.lerp(eye, eye + 70, e), player.pos.z + e * 60);
    camera.rotation.order = 'YXZ'; camera.rotation.y = THREE.MathUtils.lerp(player.yaw, 0, e); camera.rotation.x = THREE.MathUtils.lerp(player.pitch, -0.18, e); }
  }

  updateAmbience(dt); updateParticles(dt); if (G.phase === 'play') musicTick(dt, fl);
  // hand: idle sway, walk bob, reach on click, hidden outside play
  hand.visible = G.phase === 'play' && !CFG.world?.hideHands && (!TP || (FPV && !AV.fly && !G.cut)); handL.visible = hand.visible && !!G.realHands;
  reachT = Math.max(0, reachT - dt);
  const rk = Math.sin(Math.min(1, (0.35 - reachT) / 0.35) * Math.PI) * (reachT > 0 ? 1 : 0);
  hand.position.set(HAND_REST.x - rk * (FPV ? 0.04 : 0.12) + Math.sin(G.t * 1.3) * 0.006, HAND_REST.y + rk * (FPV ? 0.04 : 0.12) + Math.abs(Math.sin(G.walkT || 0)) * -0.025 + (G.carrying ? 0.05 : 0), HAND_REST.z - rk * (FPV ? 0.12 : 0.35));
  if (G.realHands) handL.position.set(-HAND_REST.x + rk * 0.04 - Math.sin(G.t * 1.1) * 0.006, HAND_REST.y + Math.abs(Math.sin((G.walkT || 0) + 1.5)) * -0.025 + (G.carrying ? 0.03 : -0.04), HAND_REST.z + 0.04);
  if (G.handWrap && FPV) { G.handWrap.rotation.z = -rk * 0.15; }
  else if (G.handWrap) { const H = CFG.world?.hand || {}; G.palm += ((G.carrying && G.grabT > 0.5 ? 1 : 0) - G.palm) * Math.min(1, dt * 9); const a = H.idleY ?? -1.5708, b = H.holdY ?? 0; G.handWrap.rotation.y = a + (b - a) * G.palm; G.handWrap.rotation.z = Math.sin(G.palm * Math.PI) * 0.35 - rk * 0.25; }
  else if (!G.realHands) hand.children.forEach(c => { if (c.userData.f) c.rotation.x = Math.PI / 2 - (G.carrying ? 1.1 : 0.35 + rk * 0.8); });
  for (let i = throws.length - 1; i >= 0; i--) {
    const th = throws[i]; th.t += dt / 0.7; const k = Math.min(1, th.t);
    th.o.stone.position.lerpVectors(th.from, th.to, k); th.o.stone.position.y += Math.sin(k * Math.PI) * 2.5; th.o.stone.scale.setScalar(THREE.MathUtils.lerp(0.16, 0.5, k)); th.o.stone.rotation.x += dt * 10; emit(th.o.stone.position, th.o.el.color, 3, 0.3, 0.2, 0.7);
    if (k >= 1) { throws.splice(i, 1); th.o.stone.visible = false; clang(0.28); emit(th.to, th.o.el.color, 60, 4, 4, 1.2); emit(th.to, 0xffa040, 80, 5, 3, 1); shake = 0.25; G.forging = 0.001; G.forgeEl = th.o; say(`炼石中…… ${th.o.el.zh} · Forging ${th.o.el.en}`); sfxForge(); fovKick = 6; }
  }
  // ores bob, carried stone follows
  for (const o of G.ores) {
    if (o.used) continue;
    if (o === G.carrying) {
      camera.getWorldDirection(tmpV);
      const ho = CFG.world?.hand?.hold || [0, 0.12, -0.12]; const hp = FPV && !AV.fly ? hand.localToWorld(G.palmHold ? tmpA.fromArray(G.palmHold) : G.handWrap ? tmpA.set(ho[0], ho[1], ho[2]) : tmpA.set(0, 0.11, -0.1)) : TP ? avatar.localToWorld(tmpA.set(0, NUWA_H * 0.62 + Math.sin(G.t * 3) * 0.05, -0.75)) : hand.localToWorld(tmpA.set(ho[0], ho[1], ho[2]));
      if (G.grabT < 1) { G.grabT = Math.min(1, (G.grabT || 0) + dt * 4); o.stone.position.lerpVectors(G.grabFrom, hp, easeOut(G.grabT)); o.stone.scale.setScalar(THREE.MathUtils.lerp(1, (FPV && !AV.fly ? (CFG.world?.hand?.holdScale ?? 0.11) : TP ? 0.38 : CFG.world?.hand?.holdScale ?? 0.16), G.grabT)); }
      else { o.stone.position.copy(hp); o.stone.scale.setScalar((FPV && !AV.fly ? (CFG.world?.hand?.holdScale ?? 0.11) : TP ? 0.38 : CFG.world?.hand?.holdScale ?? 0.16)); if (TP && Math.random() < dt * 20) emit(hp, o.el.color, 1, 0.3, 0.4, 0.6); }
      o.stone.rotation.y += dt;
      if (FPV && !AV.fly && G.grabT >= 1) { heldShow(o); o.stone.visible = false; G.held.g.rotation.y += dt * 0.6; } else if (G.held) { heldHide(); o.stone.visible = true; }
    } else if (!o.taken) { setOnTop(o, false); const hv = o === G.hover; o.stone.rotation.y += dt * (hv ? 2.2 : 0.5); o.stone.position.y = o.home.y + Math.sin(G.t * 1.6 + o.home.x) * 0.15 + (hv ? 0.25 : 0); o.stone.scale.setScalar(THREE.MathUtils.lerp(o.stone.scale.x, hv ? 1.18 + Math.sin(G.t * 8) * 0.04 : 1, Math.min(1, dt * 10))); o.beam.material.opacity = hv ? 0.42 : 0.16 + Math.sin(G.t * 2 + o.home.z) * 0.06; if (Math.random() < dt * 5) emit(tmpA.set(o.home.x + (Math.random() - 0.5) * 0.8, o.home.y + 0.3, o.home.z + (Math.random() - 0.5) * 0.8), o.el.color, 1, 0.15, 3, 2.2); }
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
    if (flights[i].all) { nuwaFlightAll(flights[i], i, dt); continue; }
    if (flights[i].nuwa) { nuwaFlight(flights[i], i, dt); continue; }
    const f = flights[i]; f.t += dt / 3.2; const k = Math.min(1, f.t), e = 1 - Math.pow(1 - k, 3);
    f.obj.position.lerpVectors(f.from, f.to, e); emit(f.obj.position, f.el.color, 3, 0.8, 0, 1.2); f.obj.position.y += Math.sin(k * Math.PI) * (CFG.world?.arc ?? 40); f.obj.scale.setScalar(1 + e * (CFG.world?.grow ?? 14)); f.obj.rotation.y += dt * 3;
    if (k >= 1) { flights.splice(i, 1); mendArrive(f); }
  }
  // crack mending + region restoration
  crackSegs.forEach(s => {
    if (s.mended > 0 && s.mended < 1) s.mended = Math.min(1, s.mended + dt / 2.5);
    const flick = 0.85 + Math.sin(G.t * 7 + s.center.x) * 0.15;
    if (s.el) { s.mesh.material.color.lerpColors(new THREE.Color(0xfff6e0), new THREE.Color(s.el.color), s.mended); }
    s.mesh.material.opacity = (1 - s.mended * 0.85) * flick;
    s.glow.material.opacity = 0.18 * (1 - s.mended) * flick;
    if (s.rib) {
      if (G.phase === 'cine' || G.phase === 'play') { if (s.delay > 0) s.delay -= dt; else if (s.open < 1) { const was = s.open; s.open = Math.min(1, s.open + dt * 0.6); if (was === 0 && !(G.phase === 'cine' && introEl)) { noiseBurst(0.9, 2400, 200, 0.12, 'bandpass'); drum(0.2); } } }
      const tear = s.open, hot = s.el ? 0 : 1, m = Math.min(1, s.mended), bf = boltFlash || 0;
      const n1 = 0.75 + 0.25 * Math.sin(G.t * 23 + s.center.x) * Math.sin(G.t * 9.7 + s.center.y);
      s.rib.parts.forEach((pp, j) => {
        const cnt = pp.core.geometry.index.count, show = Math.floor(cnt * Math.min(1, tear * (j ? 1.6 : 1.15) - (j ? 0.5 : 0)) / 6) * 6;
        pp.core.geometry.setDrawRange(0, Math.max(0, show)); pp.glow.geometry.setDrawRange(0, Math.max(0, show)); pp.dark.geometry.setDrawRange(0, Math.max(0, show)); pp.dark.material.opacity = hot ? 0.85 : THREE.MathUtils.lerp(0.85, 0, m);
        if (s.el) { pp.core.material.color.lerpColors(new THREE.Color(0xffe2b0), new THREE.Color(s.el.color), m); pp.glow.material.color.set(s.el.color); }
        pp.core.material.opacity = hot ? (0.85 * n1 + bf * 0.3) : THREE.MathUtils.lerp(0.95, G.phase === 'won' ? 0.25 : 0.4, m);
        pp.glow.material.opacity = (hot ? (0.45 + 0.25 * Math.sin(G.t * 2.2 + j + s.center.x) + bf * 0.5) : THREE.MathUtils.lerp(0.8, 0.12, m)) * (pp.core.visible ? 1 : 0.45);
      });
      if (!s.el && tear >= 1 && Math.random() < dt * 0.4) { s.open = 0.75; } // the crack keeps ripping open again
    }
    if (s.orb && !s.el && (G.phase === 'play' || G.phase === 'cine')) {
      const pul = 0.5 + 0.5 * Math.sin(G.t * 3.1 + s.center.x) * Math.sin(G.t * 7.3 + s.center.z);
      s.orb.material.color.setRGB(1, 0.35 + pul * 0.5, 0.25 + pul * 0.3); s.orb.material.blending = THREE.AdditiveBlending; s.orb.material.opacity = s.rib ? 0 : 0.25 + pul * 0.45; s.orb.scale.set(1.6 + pul * 0.5, 0.35 + pul * 0.15, 1.6 + pul * 0.5);
      if (Math.random() < dt * 2.5) emit(s.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, -1, (Math.random() - 0.5) * 3)), Math.random() < 0.5 ? 0xff7a3a : 0x777777, 6, 1.5, -6, 2.5);
    } else if (s.orb && !s.el) s.orb.material.opacity = 0;
    if (s.orb && s.el) { s.orb.material.color.set(s.el.color); s.orb.material.opacity = Math.sin(Math.min(1, s.mended) * Math.PI) * (s.rib ? 0.3 : 0.9); s.orb.material.blending = THREE.AdditiveBlending; s.orb.scale.setScalar(0.4 + s.mended * 1.6); }
  });
  G.restoreAnim.forEach((r, i) => { if (r > 0 && r < 1) G.restoreAnim[i] = Math.min(1, r + dt / 3.5); U.uRes.value[i] = easeOut(G.restoreAnim[i]); });
  const prog = G.restoreAnim.reduce((a, b) => a + b, 0) / 5;
  if (G.phase === 'won') {
    U.uAll.value = Math.min(1, U.uAll.value + dt / 4);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, 1.45, dt * 0.6);
    rainbow.visible = true; rainbow.material.opacity = Math.min(0.55, rainbow.material.opacity + dt * 0.12);
    sunLight.intensity = Math.min(3, sunLight.intensity + dt);
    if (Math.random() < dt * 25) emit(new THREE.Vector3(camera.position.x + (Math.random() - 0.5) * 40, camera.position.y + 10 + Math.random() * 8, camera.position.z + (Math.random() - 0.5) * 40), [0xffc0d0, 0xffe08a, 0xffffff][Math.floor(Math.random() * 3)], 1, 0.6, -1.2, 7);
    if (Math.random() < dt * 0.8) bell(PENTA[5 + Math.floor(Math.random() * 5)] * 2, 2, 0.05);
  } else if (rainbow.visible) { rainbow.visible = false; rainbow.material.opacity = 0; sunLight.intensity = 0; }
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
    else if (TP && G.cut) p = '';
    else if (TP && G.carrying && furnaceDist() < (CFG.world?.throwRange ?? 7)) p = `按 E 或左键，把${G.carrying.el.zh}石投入铜炉 · E / click: into the furnace`;
    else if (TP && G.carrying) p = `托着${G.carrying.el.zh}石，回到铜炉 · Carry it to the furnace`;
    else if (TP) { const o = nearestOreTP(); if (o) p = `按 E 或左键拾起${o.el.zh}石 · E / click: pick up ${o.el.en}`; }
    else if (G.carrying && nearFurnace()) p = `对准铜炉，点击扔进去 · Click to throw it in`;
    else if (G.carrying) p = `携带：${G.carrying.el.name}（${G.carrying.el.zh}）· 回到炉边`;
    else { const o = nearestOre(); if (o) p = `对准${o.el.name}，点击抓取 · Click to grab`; }
    $('prompt').textContent = L(p); $('prompt').classList.toggle('on', !!p);
    // reticle: a dot that blooms into a coloured ring on whatever a click would act on
    let rc = null, rl = '';
    if (!G.forging && !throws.length) {
      if (FPV) {
        if (!G.carrying) { rc = nearestOreTP(); G.hover = rc; if (rc) rl = `E 拾起 ${rc.el.zh}石 · Pick up`; }
        else { G.hover = null; if (furnaceDist() < (CFG.world?.throwRange ?? 7)) { rc = G.carrying; rl = `E 投入铜炉 · Into the furnace`; } }
      } else if (!G.carrying) {
        let bd = 1e9; for (const o of G.ores) { if (o.taken || o.used) continue; const dd = o.home.distanceTo(camera.position); if (dd < bd && aimAt(o.home, 30, o === G.lastRc ? 1.5 : 1)) { bd = dd; rc = o; } }
        G.hover = rc; if (rc) rl = `抓取 ${rc.el.zh} · Grab`;
      } else {
        G.hover = null;
        const fp = tmpV.set(FURNACE_POS.x, G.furnace.y + (CFG.world?.furnaceSize ?? 3) * 0.8, FURNACE_POS.y);
        if (aimAt(fp, 35) || Math.hypot(FURNACE_POS.x - player.pos.x, FURNACE_POS.y - player.pos.z) < 10) { rc = G.carrying; rl = `投入铜炉 · Throw`; }
      }
    } else G.hover = null;
    const R = $('reticle'); R.classList.toggle('on', !TP || (FPV && !G.cut)); R.classList.toggle('hot', !!rc);
    if (rc) R.style.setProperty('--rc', '#' + new THREE.Color(rc.el.color).getHexString());
    R.querySelector('span').textContent = L(rl);
    if (rc && rc !== G.lastRc) pluck(rc.el.note * 2, 0.4, 0.05, 0.06);
    G.lastRc = rc;
    $('act').hidden = !p || !!G.forging;
    $('timer').textContent = fmt(G.t - G.t0);
  }
}
// ---------- ambience: rain, drifting ash, lightning ----------
const RAIN_N = 3200;
const rainGeo = new THREE.BufferGeometry(); const rainPos = new Float32Array(RAIN_N * 6);
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
rain.frustumCulled = false; scene.add(rain);
const rainSeed = Array.from({ length: RAIN_N }, () => [Math.random() * 40 - 20, Math.random() * 25, Math.random() * 40 - 20, 18 + Math.random() * 10]);
let boltT = 4, boltFlash = 0;
function updateAmbience(dt) {
  waterT.value = G.t;
  updateBolts(dt); updateGems(dt);
  rainInit();
  const amt = G.phase === 'won' ? 0 : 1 - (G.chain?.length || 0) / 6; rain.material.opacity = 0.55 * amt; if (rainEl) rainEl.volume = Math.min(1, 0.7 * amt); if (rainHiss) rainHiss.gain.value = 0.3 * amt; if (!rainEl && !G.rainSynth && AC && amt > 0.05 && G.phase !== 'title') for (let k = 0; k < 2; k++) if (Math.random() < dt * 18 * amt) noiseBurst(0.03, 1500 + Math.random() * 3000, 800, 0.05 + Math.random() * 0.06, 'bandpass', Math.random() * 0.05); rain.visible = amt > 0.02;
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  for (let i = 0; i < RAIN_N; i++) {
    const r = rainSeed[i]; r[1] -= r[3] * dt; if (r[1] < -4) { r[1] = 20 + Math.random() * 5; r[0] = Math.random() * 40 - 20; r[2] = Math.random() * 40 - 20; }
    const x = cx + r[0] + r[1] * 0.12, y = cy + r[1] - 6, z = cz + r[2]; const o = i * 6;
    rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z; rainPos[o + 3] = x - 0.08; rainPos[o + 4] = y - 1.1; rainPos[o + 5] = z;
  }
  rainGeo.attributes.position.needsUpdate = true;
  if (G.phase === 'play' || G.phase === 'cine') {
    boltT -= dt;
    if (boltT <= 0) { boltT = (6 + Math.random() * 6) * (0.8 + (G.chain?.length || 0) * 0.3); boltFlash = 1.4; spawnBolt(); if (Math.random() < 0.4) setTimeout(spawnBolt, 140); setTimeout(() => { boltFlash = 1; }, 120); const near = Math.random(); setTimeout(() => { if (CFG.assets?.thunder) { const L = [].concat(CFG.assets.thunder); const t = new Audio(L[Math.floor(Math.random() * L.length)]); t.volume = 0.45 + near * 0.55; t.play().catch(() => {}); } else thunderSfx(near); shake = Math.max(shake, 0.2); }, 150 + (1 - near) * 1600);
      const c = crackSegs[Math.floor(Math.random() * crackSegs.length)]; if (c && !c.mended) emit(c.center, 0xdfe8ff, 60, 6, 0, 1.2); }
  }
  if ((G.phase === 'play' || (G.phase === 'cine' && !introEl)) && Math.random() < dt * 0.12 * (1 - (G.chain?.length || 0) / 5)) { shake = Math.max(shake, 0.35); drum(0.25); noiseBurst(1.5, 120, 50, 0.25, 'lowpass'); say('天又裂开一道口子…… · The sky cracks further…', 2200); }
  boltFlash = Math.max(0, boltFlash - dt * 3); renderer.toneMappingExposure = 1.05 + boltFlash * 0.25;
  if (G.t % 0.15 < dt && (G.phase === 'play' || G.phase === 'cine')) emit(new THREE.Vector3(cx + (Math.random() - 0.5) * 30, cy + Math.random() * 6, cz + (Math.random() - 0.5) * 30), 0x8a8478, 2, 0.4, 0.2, 4);
}
const rainbow = new THREE.Group(); rainbow.visible = false;
{ const cols = [0xff4040, 0xff9a30, 0xffe040, 0x50d060, 0x40a0ff, 0x6050ff, 0xb050ff]; const mat = new THREE.MeshBasicMaterial({ vertexColors: false, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  rainbow.material = mat; cols.forEach((c, i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(60 - i * 1.4, 0.7, 6, 80, Math.PI), mat.clone()); m.material.color.set(c); m.onBeforeRender = () => { m.material.opacity = mat.opacity; }; rainbow.add(m); }); }
rainbow.position.set(START_POS.x, 0, START_POS.y - 70); scene.add(rainbow);
const sunLight = new THREE.DirectionalLight(0xffe6b0, 0); sunLight.position.set(30, 80, 20); scene.add(sunLight);
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
  if (G.carrying) { tx = FURNACE_POS.x; tz = FURNACE_POS.y; label = '铜炉 · Furnace'; }
  else {
    const need = G.chain.length ? NEXT[G.chain[G.chain.length - 1]] : null; let bd = 1e9, best = null;
    for (const o of G.ores) { if (o.taken || o.used || (need && o.el.key !== need)) continue; const d = Math.hypot(o.home.x - player.pos.x, o.home.z - player.pos.z); if (d < bd) { bd = d; best = o; } }
    if (!best) { g.hidden = true; trail.visible = false; return; }
    tx = best.home.x; tz = best.home.z; label = `${best.el.zh}石 · ${best.el.en}`;
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
  $('guide-text').textContent = `${L(label)} · ${Math.round(dist)}m`;
}
const easeOut = x => 1 - Math.pow(1 - x, 2);
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function win() {
  if (G.phase !== 'play') return;
  G.phase = 'won'; G.endT = 0; for (let k = 1; k < 8; k++) G['fin' + k] = 0; G.ores.forEach(o => { o.beam.visible = false; o.light.visible = false; }); $('hud').hidden = true; $('keys') && ($('keys').hidden = true); say('天，合上了。人间，回来了。 · The sky is whole. The world returns.', 6000); document.exitPointerLock?.();
  $('prompt').classList.remove('on'); $('act').hidden = true; endingMusic(true);
  EL.forEach((e, i) => pluck(e.note, 5, 0.16, i * 0.35)); EL.forEach(e => pluck(e.note / 2, 6, 0.1, 2));
  crackSegs.forEach(s => { s.mended = 1; emit(s.center, 0xfff2c0, 120, 12, 0, 3); }); flash(0xfff2c0); if (droneG) droneG.gain.linearRampToValueAtTime(0.09, AC.currentTime + 4);
  if (!TP) G.villagers.forEach((v, i) => setTimeout(() => {
    v.visible = true; const [x, z] = v.userData.spot; v.position.set(x, groundFn(x, z), z); v.rotation.y = Math.PI + (hash(i, 2) - 0.5);
  }, 2500 + i * 180));
  // the end card waits on the finale's own clock, so slow machines still see every beat
  const iv = setInterval(() => { if (G.phase !== 'won') return clearInterval(iv); if (G.endT < (TP ? 42 : 12)) return; clearInterval(iv); (() => {
    $('end-time').textContent = fmt(G.t - G.t0); $('end-miss').textContent = G.mistakes;
    $('end-order').textContent = G.chain.map(k => EL.find(e => e.key === k).zh).join(' → ');
    const E = $('end'); E.classList.remove('show'); E.style.opacity = 0; E.hidden = false; G.endShowT = G.endT;
  })(); }, 200);
}
function lose() {
  G.phase = 'lost'; document.exitPointerLock?.(); stinger(); narrate('洪水吞没了山谷。一切，都沉入了黑暗。', { rate: 0.7, pitch: 0.4 }); thud();
  $('prompt').classList.remove('on'); $('act').hidden = true;
  $('lose-n').textContent = $('lose-n-en').textContent = G.chain.length; G.loseT = 0; G.loseY = G.water; $('hud').hidden = true;
  // the flood closes over you first; the card comes once the valley is seen drowned
  setTimeout(() => { if (G.phase === 'lost') { $('lose').hidden = false; $('drown').style.opacity = 0; } }, 6500);
}

function resetGame() {
  heldHide(); gems.forEach(m => scene.remove(m)); gems.length = 0; if (G.furnace) G.furnace.ember.material.color.set(0xff7a20); flights.forEach(f => f.obj.parent && scene.remove(f.obj)); flights.length = 0;
  $('drown').style.opacity = 0; endingMusic(false); $('giftseal').hidden = true; G.paused = false; $('pause').hidden = true; G.tut = 0; $('guide').hidden = false;
  G.phase = 'play'; G.qT = 12; G.water = CFG.world?.water?.water ?? -2.6; G.rate = CFG.world?.water?.rate ?? 0.034; G.carrying = null; G.forging = 0; G.forgeEl = null;
  G.chain = []; G.mistakes = 0; throws.length = 0; G.restoreAnim = [0, 0, 0, 0, 0]; U.uAll.value = 0; G.t0 = G.t; flights.length = 0;
  for (const o of G.ores) { o.taken = false; o.used = false; o.stone.visible = true; o.stone.scale.setScalar(1); o.stone.position.copy(o.home); o.beam.visible = true; o.light.visible = true; }
  crackSegs.forEach(s => { s.mended = 0; s.el = null; s.mesh.material.color.set(0xfff6e0); if (s.rib) s.rib.parts.forEach(pp => { pp.core.material.color.set(0xffe2b0); pp.glow.material.color.set(0xff4a20); }); });
  G.villagers.forEach(v => v.visible = false); G.cut = false; AV.fly = null; AV.camInit = false; nuwaBody.scale.setScalar(1); pillars.splice(0).forEach(p => scene.remove(p.m)); if (worldB) { worldB.visible = false; water.visible = true; if (splatMesh) splatMesh.visible = true; if (G.furnace) G.furnace.obj.visible = true; }
  player.pos.set(START_POS.x, groundFn(START_POS.x, START_POS.y), START_POS.y); player.yaw = 0; player.pitch = 0.12;
  G.endShowT = null; $('end').style.opacity = ''; $('end').hidden = true; $('lose').hidden = true; $('intro').hidden = true; $('hud').hidden = false;
  G.n50 = G.n80 = 0; hudRing(); say(TP ? '第一步：跟着金色光点走到发光的石头旁，按 E 或左键拾起 · Follow the golden dots to a glowing stone, then press E or click' : '第一步：跟着金色光点找到原石，点击抓起 · Follow the golden lights and grab an ore', 7000);
}
function startGame() { audioInit(); musicInit(); bgmPlay(); resetGame(); G.started = false; setTimeout(() => G.started = true, 400); }
let seenIntro = false;
async function cinematic() {
  audioInit(); musicInit(); introEl = playSfx('intro', 0.9); if (!introEl) bgmPlay(); G.phase = 'cine'; G.cineT = 0; $('intro').hidden = true; const c = $('cine'); c.hidden = false; const line = $('cine-line');
  const lines = TP ? [['远古之时　共工与颛顼争夺帝位\n共工战败　怒而撞向不周山', 'In the remote past Gonggong fought Zhuanxu for heaven\'s throne, lost, and in his rage struck Mount Buzhou.', 5200], ['天柱折断　天塌了一角\n大地裂开深沟', 'The pillar of heaven broke; a corner of the sky fell in and the earth split open.', 4800], ['天火不灭　洪水不息\n猛兽毒虫残害百姓', 'Fire would not die, the flood would not stop, and beasts and venomous creatures preyed on the people.', 5000], ['女娲看见人间受苦\n决心修补苍天', 'Nüwa saw the people suffer and resolved to mend the sky.', 4400], ['她走遍山川　拣选五色石\n按五行相生　木　火　土　金　水', 'She roamed the land for five-coloured stones, to be forged in the generating cycle of the Five Phases: wood, fire, earth, metal, water.', 5200]]
    : [['往古之时\n四极废　九州裂', 'In ancient times, the four pillars broke and the nine lands split.', 4500], ['天　塌了', 'The sky fell.', 3200], ['洪水从天的裂缝里倾泻而下\n世界失去了颜色', 'A flood poured through the crack, and the world lost its colour.', 5500], ['只有你　女娲\n能把天补上', 'Only you, Nüwa, can mend the sky.', 4200], ['在洪水吞没山谷之前\n找到五行之石', 'Find the five elemental stones before the flood takes the valley.', 4800]];
  let skip = false; c.onclick = () => { skip = true; };
  let li = 0; const hasVo = TP && !!CFG.assets?.voice; if (hasVo && introEl) introEl.volume = 0.5;
  for (let [t, en, ms] of lines) {
    if (skip) break; li++; if (hasVo) { vo(li, { interrupt: true }); ms = Math.max(ms, VO_DUR[li] * 1000 + 450); } line.classList.remove('on'); await new Promise(r => setTimeout(r, 300)); line.innerHTML = ''; line.append(zhSpan(t), Object.assign(document.createElement('small'), { textContent: en })); line.classList.add('on');
    if (!introEl) { stinger(); heartbeat(0.5); } // the recorded overture carries the drama on its own
    for (let k = 0; k < ms / 100 && !skip; k++) await new Promise(r => setTimeout(r, 100));
  }
  try { speechSynthesis.cancel(); } catch (_) {} if (skip) voStop();
  if (introEl) { const a = introEl; introEl = null; let k = 0; const v0 = a.volume; const iv = setInterval(() => { k += 0.08; a.volume = Math.max(0, v0 * (1 - k)); if (k >= 1) { clearInterval(iv); a.pause(); } }, 100); bgmPlay(); }
  c.hidden = true; $('sub').classList.remove('on'); seenIntro = true; audioInit(); musicInit(); resetGame(); G.started = false; setTimeout(() => G.started = true, 400);
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
window.__butian = { sp: () => splatMesh, forgeDone, gy: (x, z) => groundFn(x, z), bolt: () => { boltT = 0; }, quake, pick: (nx, ny) => { const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(nx, ny), camera); return [camera.position.toArray().map(v => +v.toFixed(1)), ...r.intersectObjects(groundMeshes, false).slice(0, 3).map(h => h.point.toArray().map(v => +v.toFixed(1)))]; }, NEXT, AV, wb: () => worldB && { vis: worldB.visible, ready: !!worldB.isInitialized || true }, crackSegs, hand, handL, FP: () => FURNACE_POS, setPause, G, player, EL, interact, startGame, win, U, teleport: (x, z) => { player.pos.x = x; player.pos.z = z; } };
