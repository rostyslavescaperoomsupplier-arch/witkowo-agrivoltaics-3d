// Winter mode: the two crop bays (x -10..10) become a polyethylene greenhouse.
// - film: side walls on the outer column lines (just outside the water tanks, x = +-10.7), V roof film over both
//   bays sitting 2-3 cm under the PV frames (follows the butterfly roof: y = 4.39 + 0.21 * distance to the nearest
//   column line, flat with a light sag across the open gaps between canopies), gable end walls front/back with a
//   door opening in front of each bay (x = +-5) wide enough for the FarmDroid (3 m).
// - animation from state.winter 0..1: side walls rise from the ground (roll tube on top), roof slides in from the
//   edges, end walls drop from the roof last. Hidden at 0.
// - snow outside the greenhouse: ground shader blend on Soil / Grass / Dark earth (chained after water.js),
//   patchy snow on the PV modules, falling flakes (Points, camera-wrapped) outside only.
// - temperatures: outsideC from the hour, insideC = outside + greenhouse gain (sun).
//
// API: init(ctx) -> { update(dt, state), info(), setVisible(bool), film: Group, colliders: [{x0,z0,x1,z1}] }
// colliders are constant boxes (walls with door gaps); use them only while info().filmDeployed > 0.5.

// ---------- geometry constants (model v6, metres, three.js axes: z = -row direction) ----------
const COLS = [-10, 0, 10];
const XW = 10.7;            // side wall x (tanks reach |x| 10.59, knee braces/girders are the film's rafters)
const Z_FRONT = 0.55;       // front gable (girders end at +0.42)
const Z_BACK_LO = -30.24;   // back wall below the ledge (columns -30.095, back tanks start at -30.305)
const Z_BACK_HI = -30.5;    // back gable above the ledge (girders/cable trunks end at -30.42)
const Y_LEDGE = 4.0;        // ledge between the two back planes (cable trunk lowest y 4.076)
const ROOF_BASE = 4.39;     // film = ROOF_BASE + 0.21 d (junction boxes top 4.365, PV frames bottom 4.416)
const SLOPE = 0.21;
const HALF = 3.16;          // canopy half width
const GAP_SAG = 0.08;
const DOOR_HALF = 1.65, DOOR_H = 2.6, DOORS = [-5, 5];
const WALL_TOP = roofY(XW);
const Z_MID = (Z_FRONT + Z_BACK_HI) / 2;

function roofY(x) {
  let d = Infinity;
  for (const c of COLS) d = Math.min(d, Math.abs(x - c));
  if (d <= HALF) return ROOF_BASE + SLOPE * d;
  // gap between two canopies: x from edge to edge (3.68 m), slight sag
  const edgeY = ROOF_BASE + SLOPE * HALF;
  const ax = Math.abs(x), t = (ax - HALF) / (10 - 2 * HALF); // 0..1 across the gap
  return edgeY - GAP_SAG * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}
// outward bulge of the side walls between columns (0 at the columns, the ground and the top)
function bulge(z, y) {
  if (z > 0 || z < -30) return 0;
  const f = ((-z) % 6) / 6;
  return 0.13 * Math.sin(Math.PI * f) * Math.sin(Math.PI * Math.min(1, y / WALL_TOP));
}
// roof x samples: kinks at columns / canopy edges, a few in the gaps for the sag
function roofXs() {
  const xs = new Set([-XW, XW]);
  for (const c of COLS) for (const o of [-HALF, -2.79, -1.3, 0, 1.3, 2.79, HALF]) {
    const x = c + o; if (x >= -XW && x <= XW) xs.add(+x.toFixed(4));
  }
  for (const g of [-5, 5]) for (let i = -4; i <= 4; i++) xs.add(+(g + i * 0.42).toFixed(4));
  return [...xs].filter((x) => x >= -XW && x <= XW).sort((a, b) => a - b);
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function init(ctx) {
  const { THREE, scene } = ctx;
  const renderer = ctx.renderer;

  // ================= film geometry (one indexed mesh, attribute aPart: 0 side, 1 roof, 2 end) =================
  const pos = [], part = [], idx = [];
  const vtx = (x, y, z, p) => { pos.push(x, y, z); part.push(p); return part.length - 1; };
  const grid = (nu, nv, fn, p) => { // fn(i, j) -> [x,y,z]; (nu+1) x (nv+1) vertices
    const base = part.length;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const q = fn(i, j); vtx(q[0], q[1], q[2], p); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  const shape = (contour, z, p) => { // contour: [[x,y]...] in the x/y plane at depth z
    const v2 = contour.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(v2, []);
    const base = part.length;
    for (const [x, y] of contour) vtx(x, y, z, p);
    for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
  };

  // side walls
  const NZ = 62, NY = 8;
  for (const s of [-1, 1]) grid(NZ, NY, (i, j) => {
    const z = Z_FRONT + (Z_BACK_HI - Z_FRONT) * (i / NZ), y = WALL_TOP * (j / NY);
    return [s * (XW + bulge(z, y)), y, z];
  }, 0);
  // roof
  const XS = roofXs();
  grid(XS.length - 1, 1, (i, j) => [XS[i], roofY(XS[i]), j ? Z_BACK_HI : Z_FRONT], 1);
  // front gable with door notches
  {
    const c = [[-XW, 0]];
    for (const dx of DOORS) c.push([dx - DOOR_HALF, 0], [dx - DOOR_HALF, DOOR_H], [dx + DOOR_HALF, DOOR_H], [dx + DOOR_HALF, 0]);
    c.push([XW, 0]);
    for (let i = XS.length - 1; i >= 0; i--) c.push([XS[i], roofY(XS[i])]);
    shape(c, Z_FRONT, 2);
  }
  // back: lower plane, ledge, upper gable
  shape([[-XW, 0], [XW, 0], [XW, Y_LEDGE], [-XW, Y_LEDGE]], Z_BACK_LO, 2);
  grid(1, 1, (i, j) => [i ? XW : -XW, Y_LEDGE, j ? Z_BACK_HI : Z_BACK_LO], 2);
  {
    const c = [[-XW, Y_LEDGE], [XW, Y_LEDGE]];
    for (let i = XS.length - 1; i >= 0; i--) c.push([XS[i], roofY(XS[i])]);
    shape(c, Z_BACK_HI, 2);
  }
  const filmGeo = new THREE.BufferGeometry();
  filmGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  filmGeo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  filmGeo.setIndex(idx);
  filmGeo.computeVertexNormals();

  // ================= ropes / battens (thin ribbons on the film, same reveal) =================
  const rp = [], rpart = [], ridx = [];
  const ribbon = (pts, w, p) => { // pts: [[x,y,z]...], w: [wx,wy,wz] half-width offset
    const base = rpart.length;
    for (const q of pts) {
      rp.push(q[0] - w[0], q[1] - w[1], q[2] - w[2], q[0] + w[0], q[1] + w[1], q[2] + w[2]);
      rpart.push(p, p);
    }
    for (let i = 0; i < pts.length - 1; i++) { const a = base + 2 * i; ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };
  const OFF = 0.014;
  for (const s of [-1, 1]) {
    for (const h of [1.25, 2.45, 3.55]) { // horizontal ropes following the bulge
      const pts = [];
      for (let i = 0; i <= NZ; i++) { const z = Z_FRONT + (Z_BACK_HI - Z_FRONT) * (i / NZ); pts.push([s * (XW + bulge(z, h) + OFF), h, z]); }
      ribbon(pts, [0, 0.018, 0], 0);
    }
    for (let zc = 0; zc >= -30; zc -= 6) ribbon([[s * (XW + OFF), 0, zc], [s * (XW + OFF), WALL_TOP, zc]], [0, 0, 0.035], 0);
  }
  for (let zc = 0; zc >= -30; zc -= 6) ribbon(XS.map((x) => [x, roofY(x) + OFF, zc]), [0, 0, 0.03], 1);
  for (const g of [-5, 5]) ribbon([[g, roofY(g) + OFF, Z_FRONT], [g, roofY(g) + OFF, Z_BACK_HI]], [0.03, 0, 0], 1);
  ribbon(XS.map((x) => [x, roofY(x) - 0.03, Z_FRONT + OFF]), [0, 0.03, 0], 2); // gable edge
  ribbon(XS.map((x) => [x, roofY(x) - 0.03, Z_BACK_HI - OFF]), [0, 0.03, 0], 2);
  for (const dx of DOORS) { // door frames (front, outside face)
    const zf = Z_FRONT + OFF, l = dx - DOOR_HALF, r = dx + DOOR_HALF;
    ribbon([[l, 0, zf], [l, DOOR_H, zf]], [0.04, 0, 0], 2);
    ribbon([[r, 0, zf], [r, DOOR_H, zf]], [0.04, 0, 0], 2);
    ribbon([[l - 0.04, DOOR_H, zf], [r + 0.04, DOOR_H, zf]], [0, 0.04, 0], 2);
  }
  for (const h of [1.3, 2.7]) ribbon([[-XW, h, Z_BACK_LO - OFF], [XW, h, Z_BACK_LO - OFF]], [0, 0.018, 0], 2);
  const ropeGeo = new THREE.BufferGeometry();
  ropeGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  ropeGeo.setAttribute('aPart', new THREE.Float32BufferAttribute(rpart, 1));
  ropeGeo.setIndex(ridx);
  ropeGeo.computeVertexNormals();

  // ================= materials =================
  const FU = { uWall: { value: 0 }, uRoof: { value: 0 }, uEnd: { value: 0 } };
  const revealPatch = (mat, key, fresnel) => {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, FU);
      sh.vertexShader = 'attribute float aPart;\nvarying float vFilmPart;\nvarying vec3 vFilmWP;\n' +
        sh.vertexShader.replace('#include <project_vertex>',
          '#include <project_vertex>\n vFilmPart = aPart; vFilmWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uWall, uRoof, uEnd;\nvarying float vFilmPart;\nvarying vec3 vFilmWP;\n' +
        sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vFilmPart < 0.5) { if (vFilmWP.y > uWall * ${(WALL_TOP + 0.06).toFixed(3)}) discard; }
          else if (vFilmPart < 1.5) { if (abs(vFilmWP.x) < ${(XW + 0.05).toFixed(2)} * (1.0 - uRoof) - 0.001) discard; }
          else { if (vFilmWP.y < (1.0 - uEnd) * 5.2) discard; }`);
      if (fresnel) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
            diffuseColor.a = clamp(diffuseColor.a * (0.8 + 1.6 * fr), 0.0, 0.8);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), 0.35 * fr); }`);
      }
    };
    mat.customProgramCacheKey = () => key;
  };
  const filmMat = new THREE.MeshStandardMaterial({
    name: 'Greenhouse film', color: 0xdce8ee, roughness: 0.32, metalness: 0, transparent: true, opacity: 0.28,
    side: THREE.DoubleSide, depthWrite: false, emissive: 0x0e1418,
  });
  revealPatch(filmMat, 'winter-film', true);
  const ropeMat = new THREE.MeshStandardMaterial({ name: 'Greenhouse ropes', color: 0xc8cdd0, roughness: 0.7, side: THREE.DoubleSide });
  revealPatch(ropeMat, 'winter-rope', false);

  const film = new THREE.Group(); film.name = 'Greenhouse film';
  film.userData.name = 'Greenhouse film';
  const filmMesh = new THREE.Mesh(filmGeo, filmMat);
  filmMesh.name = 'Greenhouse film / sheet'; filmMesh.renderOrder = 2; filmMesh.frustumCulled = false;
  const ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
  ropeMesh.name = 'Greenhouse film / ropes'; ropeMesh.frustumCulled = false;
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xb9c3c8, roughness: 0.45, metalness: 0.3 });
  const tubeGeo = new THREE.CylinderGeometry(0.05, 0.05, Z_FRONT - Z_BACK_HI, 12, 1);
  tubeGeo.rotateX(Math.PI / 2);
  const tubes = [-1, 1].map((s) => { const m = new THREE.Mesh(tubeGeo, tubeMat); m.name = 'Greenhouse film / roll bar'; m.position.set(s * (XW + 0.03), 0, Z_MID); film.add(m); return m; });
  film.add(filmMesh, ropeMesh);
  film.visible = false;
  scene.add(film);

  // ================= snow on the ground (patch Soil / Grass / Dark earth, chained) =================
  const SU = { uSnow: { value: 0 } };
  const SNOW_GLSL = `
    varying vec3 vSnowWP;
    uniform float uSnow;
    float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float snowNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(snowHash(i), snowHash(i + vec2(1, 0)), f.x), mix(snowHash(i + vec2(0, 1)), snowHash(i + vec2(1, 1)), f.x), f.y);
    }
    float snowCover() {
      float inside = smoothstep(${(XW + 0.45).toFixed(2)}, ${(XW - 0.05).toFixed(2)}, abs(vSnowWP.x))
        * smoothstep(${(Z_FRONT + 0.4).toFixed(2)}, ${(Z_FRONT - 0.05).toFixed(2)}, vSnowWP.z)
        * smoothstep(${(Z_BACK_HI - 0.4).toFixed(2)}, ${(Z_BACK_HI + 0.05).toFixed(2)}, vSnowWP.z);
      float n = snowNoise(vSnowWP.xz * 0.8) * 0.6 + snowNoise(vSnowWP.xz * 3.7) * 0.4;
      return clamp(uSnow * 1.5 - n * 0.55, 0.0, 1.0) * (1.0 - inside);
    }
`;
  const patched = new Set();
  const patchGround = (mat) => {
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (shader, r) {
      if (prev) prev.call(this, shader, r);
      Object.assign(shader.uniforms, SU);
      shader.vertexShader = 'varying vec3 vSnowWP;\n' + shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n vSnowWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = SNOW_GLSL + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float wSnow = snowCover();
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93) * (0.93 + 0.07 * snowNoise(vSnowWP.xz * 9.0)), wSnow);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.85, wSnow);');
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|winter-snow'; };
    mat.needsUpdate = true;
  };
  ctx.root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || patched.has(m) || !['Soil', 'Grass', 'Dark earth'].includes(m.name)) continue;
      patched.add(m); patchGround(m);
    }
  });

  // ================= snow on the PV modules (one InstancedMesh, patchy, more at the lower edge) =================
  const pvGeo = new THREE.PlaneGeometry(1.48, 1.44); pvGeo.rotateX(-Math.PI / 2);
  const pvMat = new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.85 });
  pvMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SU);
    sh.vertexShader = 'varying vec3 vSnowWP;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n vSnowWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = SNOW_GLSL + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { float d = min(min(abs(vSnowWP.x + 10.0), abs(vSnowWP.x)), abs(vSnowWP.x - 10.0));
        float low = clamp((2.8 - d) / 1.5, 0.0, 1.0);   // 1 at the lower (inner) edge of the module
        float n = snowNoise(vSnowWP.xz * 2.3) * 0.65 + snowNoise(vSnowWP.xz * 7.0) * 0.35;
        if (n * 0.7 + (1.0 - low) * 0.6 > uSnow * 0.62) discard; }`);
  };
  pvMat.customProgramCacheKey = () => 'winter-pvsnow';
  const pvSnow = new THREE.InstancedMesh(pvGeo, pvMat, 120);
  pvSnow.name = 'Winter / PV snow'; pvSnow.frustumCulled = false;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    const ax = new THREE.Vector3(0, 0, 1);
    let k = 0;
    for (const cx of COLS) for (const s of [-1, 1]) for (let j = 0; j < 20; j++) {
      p.set(cx + s * 2.05, 4.458 + SLOPE * 2.05, -0.75 - j * 1.5);
      q.setFromAxisAngle(ax, s * Math.atan(SLOPE));
      pvSnow.setMatrixAt(k++, m.compose(p, q, sc));
    }
    pvSnow.instanceMatrix.needsUpdate = true;
  }
  pvSnow.visible = false;
  scene.add(pvSnow);

  // ================= falling snowflakes (outside the greenhouse only) =================
  const NFLAKE = 3000, BOX = [56, 26, 56];
  const fpos = new Float32Array(NFLAKE * 3), frnd = new Float32Array(NFLAKE);
  let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < NFLAKE; i++) { fpos[3 * i] = rnd() * BOX[0]; fpos[3 * i + 1] = rnd() * BOX[1]; fpos[3 * i + 2] = rnd() * BOX[2]; frnd[i] = rnd(); }
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  flakeGeo.setAttribute('aRnd', new THREE.BufferAttribute(frnd, 1));
  flakeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const flakeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector3(...BOX) },
      uCam: { value: new THREE.Vector3() }, uScale: { value: 500 }, uOrtho: { value: 0 }, uAlpha: { value: 0 },
      uLight: { value: 1 },
    },
    vertexShader: `
      attribute float aRnd;
      uniform float uTime, uScale, uOrtho, uAlpha;
      uniform vec3 uOrigin, uSize, uCam;
      varying float vA;
      void main() {
        vec3 p = position;
        float sp = 0.75 + 0.6 * aRnd;
        p.y -= uTime * sp;
        p.x += uTime * 0.35 + 0.35 * sin(uTime * (0.6 + aRnd) + aRnd * 40.0);
        p.z += 0.3 * cos(uTime * (0.5 + aRnd * 0.7) + aRnd * 17.0);
        vec3 wp = uOrigin + mod(p - uOrigin, uSize);
        bool inGh = abs(wp.x) < ${(XW + 0.15).toFixed(2)} && wp.z < ${(Z_FRONT + 0.15).toFixed(2)} && wp.z > ${(Z_BACK_HI - 0.15).toFixed(2)} && wp.y < 5.15;
        vec3 rel = (wp - uOrigin) / uSize;            // 0..1 inside the wrap box: fade at its faces
        vec3 e = min(rel, 1.0 - rel);
        float fade = smoothstep(0.0, 0.12, min(min(e.x, e.y), e.z));
        if (inGh || wp.y < 0.0 || uAlpha <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = (0.045 + 0.035 * aRnd) * (uOrtho > 0.5 ? uScale : uScale / max(0.1, -mv.z));
        gl_PointSize = clamp(s, 1.2, 9.0);
        vA = uAlpha * fade * clamp(s / 1.5, 0.35, 1.0);
      }`,
    fragmentShader: `
      uniform float uLight;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.15, length(c)) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.94, 0.96, 1.0) * uLight, a);
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const flakes = new THREE.Points(flakeGeo, flakeMat);
  flakes.name = 'Winter / snowflakes'; flakes.frustumCulled = false; flakes.renderOrder = 3; flakes.visible = false;
  scene.add(flakes);

  // ================= colliders (walls with door gaps), 0.1 m thick =================
  const T = 0.06;
  const colliders = [
    { x0: -XW - 0.2, z0: Z_BACK_HI, x1: -XW + T, z1: Z_FRONT },
    { x0: XW - T, z0: Z_BACK_HI, x1: XW + 0.2, z1: Z_FRONT },
    { x0: -XW, z0: Z_BACK_LO - T, x1: XW, z1: Z_BACK_LO + T },
  ];
  { // front wall split by the doors
    const xs = [-XW];
    for (const d of DOORS) xs.push(d - DOOR_HALF, d + DOOR_HALF);
    xs.push(XW);
    for (let i = 0; i < xs.length; i += 2) colliders.push({ x0: xs[i], z0: Z_FRONT - T, x1: xs[i + 1], z1: Z_FRONT + T });
  }

  // ================= state =================
  const out = { outsideC: 20, insideC: 20, filmDeployed: 0, snowCm: 0 };
  let visibleAll = true, time = 0;

  function update(dt, state) {
    const w = Math.min(1, Math.max(0, state.winter || 0));
    const wall = smooth(0, 0.45, w), roof = smooth(0.3, 0.75, w), end = smooth(0.6, 1, w);
    const snow = smooth(0.25, 0.95, w);
    FU.uWall.value = wall; FU.uRoof.value = roof; FU.uEnd.value = end;
    film.visible = visibleAll && w > 0.001;
    for (const t of tubes) t.position.y = wall * WALL_TOP + 0.02;
    SU.uSnow.value = visibleAll ? snow : 0;
    pvSnow.visible = visibleAll && snow > 0.02;

    // flakes
    const cam = ctx.getCamera && ctx.getCamera();
    const fl = state.quality === 'low' ? 900 : NFLAKE;
    flakes.visible = visibleAll && snow > 0.02 && !!cam;
    if (flakes.visible) {
      time += dt;
      const u = flakeMat.uniforms;
      u.uTime.value = time;
      u.uAlpha.value = Math.min(1, snow * 1.3);
      u.uLight.value = 0.35 + 0.65 * Math.min(1, (state.sun || 0) * 2.5 + 0.15);
      cam.getWorldPosition(u.uCam.value);
      // wrap box centred on the camera, kept above the ground
      u.uOrigin.value.set(u.uCam.value.x - BOX[0] / 2, Math.max(-2, u.uCam.value.y - BOX[1] * 0.55), u.uCam.value.z - BOX[2] / 2);
      const h = renderer ? renderer.domElement.height : 800;
      if (cam.isOrthographicCamera) { u.uOrtho.value = 1; u.uScale.value = h * cam.zoom / Math.max(1e-3, cam.top - cam.bottom); }
      else { u.uOrtho.value = 0; u.uScale.value = h / (2 * Math.tan((cam.fov || 50) * Math.PI / 360)); }
      flakeGeo.setDrawRange(0, fl);
    }

    // temperatures: cosine day curve with the max at 14:00
    const c = Math.cos(((state.hour || 0) - 14) / 24 * 2 * Math.PI);
    const winterC = -2.5 + 3.5 * c, summerC = 20 + 6 * c;
    out.outsideC = summerC + (winterC - summerC) * w;
    out.filmDeployed = (wall + roof + end) / 3;
    const gain = (5 + 9 * Math.min(1, (state.sun || 0) * 1.6)) * out.filmDeployed;
    out.insideC = out.outsideC + gain;
    out.snowCm = 15 * snow;
  }

  return {
    update,
    info: () => out,
    setVisible(v) { visibleAll = !!v; if (!v) { film.visible = pvSnow.visible = flakes.visible = false; SU.uSnow.value = 0; } },
    film,
    colliders,
  };
}
