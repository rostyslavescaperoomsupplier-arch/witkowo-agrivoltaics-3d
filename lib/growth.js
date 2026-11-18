// Cabbage growth (vertex-shader scaling of every plant about its own base) + FarmDroid robot motion.
// Owner: agent GROWTH. Interface: init(ctx) -> { robot, update(dt, state), info(), setVisible(bool), patchPickMaterial(mat) }.
//
// Plant centres: every crop node is one merged, non-indexed mesh. On load the triangles are joined into
// connected components (vertices welded by their exact quantized position): each component is one head
// sphere or one leaf strip. Head components give the plant centres; each leaf component is assigned to a
// plant through its lowest vertex (the leaf base, 4 cm from the centre), both via the generator grid from
// reference/Rebuild_in_Blender.py (model v6: inter-row cx -5/+5, x = cx-3.375+ix*0.75 (ix 0..9), z = -(1+iy*0.88)).
// A per-vertex attribute aGrow = (plant base xyz in mesh-local space, per-plant day offset) drives the shader.

const HEADS = 'Cabbage heads';
const LEAVES = 'Cabbage leaves';
const ROBOT_PREFIX = 'FarmDroid / ';
const WHEEL_PARTS = ['FarmDroid / tires', 'FarmDroid / wheel rims', 'FarmDroid / tire lugs'];

// Robot geometry (generator v6: rx=5, ry=-2.8 -> three z = +2.8; wheels at +-1.22 x, +-0.78 z, r .43)
const ROBOT_HOME_X = 5, ROBOT_HOME_Z = 2.8;
const WHEEL_DX = 1.22, WHEEL_DZ = 0.78, WHEEL_Y = 0.43, WHEEL_R = 0.42;
const HEADLAND_Z = ROBOT_HOME_Z; // turn lane at the entrance (robot parks on it); columns/tanks start at z ~0.2
const FAR_Z = -27.6;       // pivot z where the tool discs reach z ~ -29.4 (crops end at z -28.7)
// Passes over the two cabbage inter-rows (centres x -5/+5, plant rows at +-1.625 + k*0.75). Lane centres are
// chosen so both wheels (+-1.22) run between plant rows, 3 passes (~2 m tool width) per inter-row. Robot
// width +-1.5 keeps >= 0.4 m from the tanks on the column axes x 0 / +-10 (tanks x +-0.6).
const LANES = [3.125, 5.375, 7.625, -7.625, -5.375, -3.125];
const BASE_SPEED = 0.3;    // m/s at state.speed = 1 (real FarmDroid ~0.25 m/s)
const MAX_SPEED = 1.5;     // m/s cap so it never jumps visibly
const SUN_ON = 0.15;

// modelled heads are ~31 cm; real white cabbage at harvest is ~15-25 cm -> full head scaled to ~21 cm
const HEAD_FULL = 0.68;
const STAGES = ['seedling', 'vegetative', 'heading', 'harvest'];

// ---------------------------------------------------------------- shader chunks
const VERT_DECL = /* glsl */`
attribute vec4 aGrow;
uniform float uDay;
varying float vGrow;
`;
// One vertex patch for every crop mesh (heads and leaves), so a single material - e.g. main's shared pick
// material - works on all of them. aGrow.w = per-plant day offset, +1000 marks a head vertex.
// leaves: radial size + "opening" (young leaves upright, flatten out during vegetative stage)
// heads: hidden (collapsed to one point = zero area) until ~46 days, full size (HEAD_FULL) by ~95
const VERT_GROW = /* glsl */`
{
  float off = aGrow.w;
  bool isHead = off > 500.0;
  if (isHead) off -= 1000.0;
  float d = clamp(uDay + off, 0.0, 100.0);
  vGrow = d;
  vec3 p = transformed - aGrow.xyz;
  if (isHead) {
    p *= ${HEAD_FULL.toFixed(3)} * smoothstep(46.0, 95.0, d);
  } else {
    float sR = 0.13 + 0.15 * smoothstep(0.0, 15.0, d) + 0.57 * smoothstep(15.0, 50.0, d) + 0.15 * smoothstep(50.0, 85.0, d);
    float open = smoothstep(8.0, 50.0, d);
    float sY = min(1.0, sR * mix(1.7, 1.0, open));
    p.xz *= sR; p.y *= sY;
  }
  transformed = aGrow.xyz + p;
}
`;
const VERT_KEY = 'growth-v1';
function patchVertex(sh, uniforms) {
  sh.uniforms.uDay = uniforms.uDay;
  if (sh.vertexShader.includes('attribute vec4 aGrow;')) return; // already patched
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_DECL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_GROW);
}
const FRAG_DECL = /* glsl */`
uniform vec3 uYoung;
uniform vec3 uRipe;
varying float vGrow;
`;
const FRAG_LEAF = /* glsl */`
diffuseColor.rgb = mix(diffuseColor.rgb, uYoung, 0.6 * (1.0 - smoothstep(4.0, 32.0, vGrow)));
diffuseColor.rgb = mix(diffuseColor.rgb, uRipe, 0.22 * smoothstep(82.0, 100.0, vGrow));
`;
const FRAG_HEAD = /* glsl */`
diffuseColor.rgb = mix(diffuseColor.rgb, uYoung, 0.5 * (1.0 - smoothstep(55.0, 85.0, vGrow)));
diffuseColor.rgb = mix(diffuseColor.rgb, uRipe, 0.6 * smoothstep(82.0, 100.0, vGrow));
`;

// GLTFLoader sanitises node names ("FarmDroid / tires" -> "FarmDroid__tires"); the original is in userData.name
const nameOf = (o) => (o.userData && o.userData.name) || o.name || '';

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function hash01(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

// plant grid key from a world-space point (generator layout, see header)
function gridKey(x, z) {
  const c = x < 0 ? 0 : 1, cx = c ? 5 : -5;
  const ix = Math.round((x - cx + 3.375) / 0.75), iy = Math.round((-z - 1) / 0.88);
  if (ix < 0 || ix > 9 || iy < 0 || iy > 31) return -1;
  return (c * 10 + ix) * 32 + iy;
}

// Union-find of vertices welded by exact (quantized) position + triangle connectivity. -> Int32Array comp id
function components(geometry) {
  const pos = geometry.attributes.position, n = pos.count;
  const q = pos.normalized ? 32767 : 10000;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const ny = Math.round((bb.max.y - bb.min.y) * q) + 1, nz = Math.round((bb.max.z - bb.min.z) * q) + 1;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = (Math.round((pos.getX(i) - bb.min.x) * q) * ny + Math.round((pos.getY(i) - bb.min.y) * q)) * nz
      + Math.round((pos.getZ(i) - bb.min.z) * q);
    const j = seen.get(key);
    if (j === undefined) seen.set(key, i); else union(j, i);
  }
  const index = geometry.index;
  const tris = index ? index.count / 3 : n / 3;
  for (let t = 0; t < tris; t++) {
    const a = index ? index.getX(3 * t) : 3 * t, b = index ? index.getX(3 * t + 1) : 3 * t + 1, c = index ? index.getX(3 * t + 2) : 3 * t + 2;
    union(a, b); union(a, c);
  }
  const comp = new Int32Array(n), ids = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let id = ids.get(r);
    if (id === undefined) { id = ids.size; ids.set(r, id); }
    comp[i] = id;
  }
  return { comp, count: ids.size };
}

export function init(ctx) {
  const { THREE, root } = ctx;
  root.updateMatrixWorld(true);
  const uniforms = { uDay: { value: 0 } };

  // ------------------------------------------------------------ crops
  const heads = [], leaves = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = nameOf(o);
    if (n === HEADS) heads.push(o);
    else if (n === LEAVES || n.startsWith('Cabbage_leaves') || n.startsWith(LEAVES)) leaves.push(o);
  });

  // plants: world base x/z, per-plant day offset
  const plantKey = new Map();
  const plantX = [], plantZ = [], plantOff = [], headDiam = [];
  const v = new THREE.Vector3();

  for (const mesh of heads) {
    const { comp, count } = components(mesh.geometry);
    const mn = new Float32Array(count * 3).fill(Infinity), mx = new Float32Array(count * 3).fill(-Infinity);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const c = comp[i] * 3;
      if (v.x < mn[c]) mn[c] = v.x; if (v.x > mx[c]) mx[c] = v.x;
      if (v.y < mn[c + 1]) mn[c + 1] = v.y; if (v.y > mx[c + 1]) mx[c + 1] = v.y;
      if (v.z < mn[c + 2]) mn[c + 2] = v.z; if (v.z > mx[c + 2]) mx[c + 2] = v.z;
    }
    const compPlant = new Int32Array(count);
    for (let c = 0; c < count; c++) {
      const x = (mn[3 * c] + mx[3 * c]) / 2, z = (mn[3 * c + 2] + mx[3 * c + 2]) / 2;
      const k = gridKey(x, z);
      let p = plantKey.get(k);
      if (p === undefined || k < 0) {
        p = plantX.length;
        if (k >= 0) plantKey.set(k, p);
        const ix = k >= 0 ? Math.floor(k / 32) % 10 : 4.5;
        // rows in the middle of the inter-row (x ~ +-5, open sky between canopies, least shade) up to
        // 3 days ahead of the rows under the canopy edges; random spread +-5 days
        const edge = 3 * (1 - Math.abs(ix - 4.5) / 4.5);
        plantX.push(x); plantZ.push(z);
        plantOff.push((hash01(k >= 0 ? k : c + 5000) - 0.5) * 10 + edge);
        headDiam.push(mx[3 * c] - mn[3 * c]);
      }
      compPlant[c] = p;
    }
    mesh.userData.growthCompPlant = compPlant; mesh.userData.growthComp = comp;
  }
  const plants = plantX.length;

  function nearestPlant(x, z) {
    let best = -1, bd = Infinity;
    for (let p = 0; p < plants; p++) {
      const d = (plantX[p] - x) ** 2 + (plantZ[p] - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  for (const mesh of leaves) {
    const { comp, count } = components(mesh.geometry);
    const lowY = new Float32Array(count).fill(Infinity), lowX = new Float32Array(count), lowZ = new Float32Array(count);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const c = comp[i];
      if (v.y < lowY[c]) { lowY[c] = v.y; lowX[c] = v.x; lowZ[c] = v.z; }
    }
    const compPlant = new Int32Array(count);
    for (let c = 0; c < count; c++) {
      const p = plantKey.get(gridKey(lowX[c], lowZ[c]));
      compPlant[c] = p !== undefined ? p : nearestPlant(lowX[c], lowZ[c]);
    }
    mesh.userData.growthCompPlant = compPlant; mesh.userData.growthComp = comp;
  }

  const fullHeadCm = plants ? 100 * headDiam.reduce((a, b) => a + b, 0) / plants : 31;

  const col = (hex) => new THREE.Color(hex);
  const crops = [];
  // Apply the growth vertex patch (shared uDay uniform) to any material used on the crop meshes - e.g. main's
  // pick materials - so picking matches what is drawn. Chains an existing onBeforeCompile/customProgramCacheKey.
  // The material only works on meshes carrying the aGrow attribute (the crop meshes). Returns mat.
  function patchPickMaterial(mat) {
    if (!mat || mat.userData.growthPatched) return mat;
    mat.userData.growthPatched = true;
    const prevCompile = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (prevCompile) prevCompile.call(this, sh, r);
      patchVertex(sh, uniforms);
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|' + VERT_KEY; };
    mat.needsUpdate = true;
    return mat;
  }
  function patchCrop(mesh, kind) {
    const comp = mesh.userData.growthComp, compPlant = mesh.userData.growthCompPlant;
    delete mesh.userData.growthComp; delete mesh.userData.growthCompPlant;
    const n = mesh.geometry.attributes.position.count;
    const arr = new Float32Array(n * 4);
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const baseLocal = new Float32Array(plants * 3);
    for (let p = 0; p < plants; p++) {
      // heads grow from the rosette centre (~10 cm up) so the smaller head still sits on top of the leaves
      v.set(plantX[p], kind === 'head' ? 0.10 : 0, plantZ[p]).applyMatrix4(inv);
      baseLocal[3 * p] = v.x; baseLocal[3 * p + 1] = v.y; baseLocal[3 * p + 2] = v.z;
    }
    for (let i = 0; i < n; i++) {
      const p = compPlant[comp[i]];
      arr[4 * i] = baseLocal[3 * p]; arr[4 * i + 1] = baseLocal[3 * p + 1]; arr[4 * i + 2] = baseLocal[3 * p + 2];
      arr[4 * i + 3] = plantOff[p] + (kind === 'head' ? 1000 : 0);
    }
    mesh.geometry.setAttribute('aGrow', new THREE.BufferAttribute(arr, 4));

    const frag = kind === 'head' ? FRAG_HEAD : FRAG_LEAF;
    const dark = kind === 'leaf' && mesh.material.color && mesh.material.color.g < 0.1;
    const young = kind === 'head' ? col(0x9bb25a) : col(dark ? 0x6fa548 : 0x8cbf5c);
    const ripe = kind === 'head' ? col(0x8fb3aa) : col(0x6f9690);
    const mat = mesh.material.clone();
    mat.onBeforeCompile = (sh) => {
      patchVertex(sh, uniforms);
      sh.uniforms.uYoung = { value: young };
      sh.uniforms.uRipe = { value: ripe };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + frag);
    };
    mat.customProgramCacheKey = () => 'growth-' + kind;
    mesh.material = mat;

    // shadow casters use the same displacement (works whether or not main enables castShadow on crops)
    mesh.customDepthMaterial = patchPickMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    mesh.customDistanceMaterial = patchPickMaterial(new THREE.MeshDistanceMaterial());
    crops.push(mesh);
  }
  for (const m of heads) patchCrop(m, 'head');
  for (const m of leaves) patchCrop(m, 'leaf');

  // ------------------------------------------------------------ robot
  const robotNodes = [];
  root.traverse((o) => { const n = nameOf(o); if (n.startsWith(ROBOT_PREFIX) || n.startsWith('FarmDroid__')) robotNodes.push(o); });
  const robot = new THREE.Group();
  robot.name = 'FarmDroid';
  robot.position.set(ROBOT_HOME_X, 0, ROBOT_HOME_Z);
  const robotParent = robotNodes.length ? robotNodes[0].parent : root;
  robotParent.add(robot);
  robot.updateMatrixWorld(true);
  for (const o of robotNodes) robot.attach(o);

  // split each wheel part (all 4 wheels merged) into 4 meshes parented to spinning hubs
  const hubs = [];
  for (let k = 0; k < 4; k++) {
    const hub = new THREE.Group();
    hub.name = 'FarmDroid / wheel ' + (k + 1);
    hub.position.set((k & 1 ? 1 : -1) * WHEEL_DX, WHEEL_Y, (k & 2 ? 1 : -1) * WHEEL_DZ);
    hub.userData.side = k & 1 ? 1 : -1; // +1 = right wheel (+x)
    robot.add(hub); hubs.push(hub);
  }
  const wheelMeshes = [];
  let wheelsOk = true;
  for (const name of WHEEL_PARTS) {
    const src = robotNodes.find((o) => nameOf(o) === name && o.isMesh);
    if (!src || src.geometry.index) { wheelsOk = false; continue; }
    src.updateMatrix();
    const m = src.matrix, nm = new THREE.Matrix3().getNormalMatrix(m);
    const pos = src.geometry.attributes.position, nor = src.geometry.attributes.normal;
    const tri = pos.count / 3, which = new Uint8Array(tri), cnt = [0, 0, 0, 0];
    const a = new THREE.Vector3();
    for (let t = 0; t < tri; t++) {
      a.set(0, 0, 0);
      for (let j = 0; j < 3; j++) a.add(v.fromBufferAttribute(pos, 3 * t + j).applyMatrix4(m));
      const k = (a.x > 0 ? 1 : 0) | (a.z > 0 ? 2 : 0);
      which[t] = k; cnt[k]++;
    }
    for (let k = 0; k < 4; k++) {
      const P = new Float32Array(cnt[k] * 9), N = nor ? new Float32Array(cnt[k] * 9) : null;
      let w = 0;
      for (let t = 0; t < tri; t++) {
        if (which[t] !== k) continue;
        for (let j = 0; j < 3; j++) {
          const i = 3 * t + j;
          v.fromBufferAttribute(pos, i).applyMatrix4(m).sub(hubs[k].position);
          P[w] = v.x; P[w + 1] = v.y; P[w + 2] = v.z;
          if (N) { v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[w] = v.x; N[w + 1] = v.y; N[w + 2] = v.z; }
          w += 3;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (N) g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); else g.computeVertexNormals();
      const wm = new THREE.Mesh(g, src.material);
      wm.name = name;
      wm.userData.wheelOf = src;
      hubs[k].add(wm); wheelMeshes.push(wm);
    }
    src.visible = false;
    src.userData.replacedByWheels = true;
  }

  // route: closed loop of drive / turn segments starting and ending at the parking pose (model position)
  // seg layout: x0 z0 yaw0 x1 z1 yaw1 len dir(+1 fwd, -1 reverse, 0 turn) work(1 cultivating)
  const segList = [];
  let cx = ROBOT_HOME_X, cz = ROBOT_HOME_Z, cyaw = 0;
  const drive = (x, z, dir, work) => { segList.push([cx, cz, cyaw, x, z, cyaw, Math.hypot(x - cx, z - cz), dir, work]); cx = x; cz = z; };
  const turn = (yaw) => { segList.push([cx, cz, cyaw, cx, cz, yaw, Math.abs(yaw - cyaw) * 1.0, 0, 0]); cyaw = yaw; };
  // move along the headland to x (turn to face it, drive, turn back to face -z)
  const shift = (x) => {
    if (Math.abs(x - cx) < 1e-6) return;
    turn(x > cx ? -Math.PI / 2 : Math.PI / 2); // -pi/2 faces +x
    drive(x, HEADLAND_Z, 1, 0);
    turn(0);
  };
  for (const lane of LANES) {
    shift(lane);
    drive(lane, FAR_Z, 1, 1);
    drive(lane, HEADLAND_Z, -1, 0);
  }
  shift(ROBOT_HOME_X);
  const SEGS = segList.length, seg = new Float32Array(SEGS * 9), segStart = new Float32Array(SEGS + 1);
  for (let i = 0; i < SEGS; i++) { seg.set(segList[i], i * 9); segStart[i + 1] = segStart[i] + segList[i][6]; }
  const loopLen = segStart[SEGS];

  let s = 0;          // arc position on the loop [0, loopLen)
  let vel = 0;        // signed path velocity (m/s), eased
  let segIdx = 0;
  let mode = 'parked';
  let wheelL = 0, wheelR = 0;
  let robotVisible = true, shadowSynced = false;

  function locate(sv) {
    let i = segIdx;
    if (sv < segStart[i] || sv > segStart[i + 1]) { i = 0; while (i < SEGS - 1 && sv > segStart[i + 1]) i++; }
    segIdx = i;
    return i;
  }
  function applyPose() {
    const i = locate(s), o = i * 9, len = seg[o + 6];
    const t = len > 0 ? (s - segStart[i]) / len : 0;
    robot.position.x = seg[o] + (seg[o + 3] - seg[o]) * t;
    robot.position.z = seg[o + 1] + (seg[o + 4] - seg[o + 1]) * t;
    robot.rotation.y = seg[o + 2] + (seg[o + 5] - seg[o + 2]) * t;
  }

  function update(dt, state) {
    if (!state) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    uniforms.uDay.value = state.dayOfSeason ?? 0;

    if (!shadowSynced) { // copy shadow flags set by main onto the split wheel meshes (once)
      shadowSynced = true;
      for (const wm of wheelMeshes) { wm.castShadow = wm.userData.wheelOf.castShadow; wm.receiveShadow = wm.userData.wheelOf.receiveShadow; }
    }
    if (!robotVisible) return;

    const day = (state.sun ?? 1) > SUN_ON;
    const vmax = Math.min(BASE_SPEED * Math.max(state.speed ?? 1, 0), MAX_SPEED);
    let target;
    if (day) { target = vmax; mode = 'working'; }
    else {
      // head home along the loop (either direction, whichever is shorter), reversing is fine for the robot
      const toEnd = loopLen - s;
      if (s < 1e-3 || toEnd < 1e-3) { s = 0; target = 0; mode = 'parked'; }
      else {
        const dist = Math.min(s, toEnd);
        target = Math.min(vmax * 1.5, MAX_SPEED, 0.6 * dist + 0.05) * (s < toEnd ? -1 : 1);
        mode = 'returning';
      }
    }
    vel += (target - vel) * Math.min(1, dt * 2.5);
    let ds = vel * dt;
    if (!day) { // never overshoot the park point
      if (vel < 0 && s + ds < 0) { ds = -s; vel = 0; }
      if (vel > 0 && s + ds > loopLen) { ds = loopLen - s; vel = 0; }
    }
    if (ds === 0) return;
    const i = locate(s), o = i * 9, dir = seg[o + 7];
    if (dir === 0) { // turning in place: wheels counter-rotate
      const dyaw = (seg[o + 5] > seg[o + 2] ? 1 : -1) * ds; // segment len == |dyaw| * 1.0
      wheelL -= -dyaw * WHEEL_DX / WHEEL_R;
      wheelR -= dyaw * WHEEL_DX / WHEEL_R;
    } else {
      const fwd = ds * dir;
      wheelL -= fwd / WHEEL_R; wheelR -= fwd / WHEEL_R;
    }
    s += ds;
    if (s >= loopLen) s -= loopLen;
    if (s < 0) s += loopLen;
    applyPose();
    if (wheelsOk) for (let k = 0; k < 4; k++) hubs[k].rotation.x = hubs[k].userData.side > 0 ? wheelR : wheelL;
  }

  function info() {
    const d = uniforms.uDay.value;
    const stage = STAGES[d < 15 ? 0 : d < 50 ? 1 : d < 85 ? 2 : 3];
    return {
      stage,
      headDiameterCm: Math.round(fullHeadCm * HEAD_FULL * smoothstep(46, 95, d)),
      plants,
      robot: mode, // 'working' | 'returning' | 'parked'
    };
  }

  // setVisible: shows/hides the FarmDroid (crops always stay; growth then just follows dayOfSeason)
  function setVisible(on) { robotVisible = !!on; robot.visible = robotVisible; }

  applyPose();
  return { robot, update, info, setVisible, patchPickMaterial };
}
