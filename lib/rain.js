// lib/rain.js: rain, roof runoff into the 18 moulded water tanks, visible tank water level, wet look and puddles.
//
// - Rain: one indexed mesh of camera-facing streak quads, all motion in the vertex shader (world-anchored, wrapped
//   in a box that follows the camera; 3 box presets by camera height so walk view is dense). Drops die on the PV
//   rows (measured from `Canopy N / PV frames`) and on the tank lids; the open valley strip over the column axis and
//   the gaps between canopies get rain. Splash rings (GPU-only, recycled by time) on the ground, the tank lids and
//   the PV modules.
// - Runoff: the butterfly (V) roof drains to the inner, low edge of each PV row. The model has no gutters, so this
//   module adds a slim gutter under every inner PV edge plus a spout at each tank (`rain.gutters`, always visible,
//   CORE may hide it). Animated streams fall from the spouts into a hatch in each tank lid, thickness ~ inflow.
//   Overflow above 100 % shows a water sheet down the front end of every tank.
// - Tanks: one cloned + patched material for `molded water tanks` / `tank reinforcement belts` / `tank molded ribs`.
//   While state.show.water is on, a window opens in both long sides and a hatch in the lid (shader discard, the tank
//   stays an opaque material, so x-ray / picking in main.js keep working); a blue water body (InstancedMesh, 18)
//   with an animated surface shows the level. Ice layer on the surface when it freezes.
// - Wet look: chained onBeforeCompile on Soil / Dark earth / Grass (darker + glossier, dry strips under the PV rows,
//   puddles in the FarmDroid wheel tracks x = +-3.5, +-6.5 and in low spots, sky reflection + rain ripples),
//   Galvanized steel and the tank material (darker + glossier). Existing patches (water.js, winter.js, geo.js) run
//   first; customProgramCacheKey is extended.
// - Water balance (simulated time from state.hour like power.js / water.js; backwards or > 1 h jumps ignored):
//   inflow  L/min = rainMmH * catchment m2 / 60 * RUNOFF   (catchment = PV plan area measured from the GLB)
//   outflow L/min = state.irrigationLpm while level > 5 %
//   level clamps at 100 %; the surplus is spilled (info().spillLpm). Start level 60 %. If anybody else writes
//   state.tankLevel (a slider), the module adopts that value.
//
// API: init(ctx) -> { update(dt, state), info(), setVisible(bool), tanks, gutters, group }
//   reads  state.rain 0..1, state.irrigationLpm, state.hour, state.winter, state.sun, state.quality,
//          state.show.water, state.tempOutsideC (if finite), state.tankLevel (external override)
//   writes state.tankLevel 0..1, state.rainMmH
//   info() -> { rainMmH, rainTodayMm, tankLevel, tankLitres, tankCapacityL, inflowLpm, outflowLpm, spillLpm,
//               catchmentM2, tanks, wetness, puddles }
//   tanks = [{ cx, cz, hx, hz, y0, y1 }] (18 boxes, world metres), gutters = Object3D
// Extra exports: RAIN_AUTO (climate hint), mmhFromRain(r), rainFromMmH(mmh), autoRain(day, hour, winter).

// ---------------------------------------------------------------- climate hint for main's "Auto" rain
// From reference/geo/climate/era5_daily.csv, 1991-2020, ERA5 cell 53.25 N 15.00 E (Witkowo Pierwsze):
//   June     900 days: 36.4 % with precipitation >= 1 mm, mean 5.26 mm on those days (monthly normal 60.2 mm)
//   December 930 days: 35.5 % with precipitation >= 1 mm (mean 4.20 mm), but only 28.6 % with RAIN >= 1 mm
//            (the rest falls as snow -> winter.js); winterChance uses the rain share.
// The daily files have no precipitation hours, so intensity assumes a typical wet spell of ~4 h in summer
// (showers / convective) and ~8 h in winter (frontal drizzle): 5.26 / 4 = 1.3 mm/h, 4.2 / 8 = 0.5 mm/h.
export const RAIN_AUTO = {
  summerChance: 0.36,     // share of June days with >= 1 mm
  winterChance: 0.29,     // share of December days with >= 1 mm of rain (not snow)
  typicalMmH: 1.3,        // June: mean wet-day total 5.26 mm over ~4 h
  typicalMmHWinter: 0.5,  // December: 4.2 mm over ~8 h
  wetDayMm: { summer: 5.26, winter: 4.2 },
  spellHours: { summer: 4, winter: 8 },
  source: 'ERA5 daily 1991-2020 via Open-Meteo (CC BY 4.0), reference/geo/climate/era5_daily.csv',
};

// state.rain 0..1 <-> mm/h on a log scale: 0 = dry, 0.001 = 0.2 mm/h drizzle, 0.5 = 1.4 mm/h, 1 = 10 mm/h downpour
const MMH_MIN = 0.2, MMH_MAX = 10;
export function mmhFromRain(r) { return !(r > 0.001) ? 0 : MMH_MIN * Math.pow(MMH_MAX / MMH_MIN, Math.min(1, r)); }
export function rainFromMmH(m) { return !(m > 0) ? 0 : Math.min(1, Math.max(0.0011, Math.log(m / MMH_MIN) / Math.log(MMH_MAX / MMH_MIN))); }

// Deterministic "Auto" rain for main: day = any integer day counter, hour 0..24, winter 0..1 -> state.rain 0..1.
// A wet day (chance from RAIN_AUTO) gets one spell starting 5..19 h, 0.6-1.4 x the typical length and intensity
// 0.4-2.4 x typical (so some summer showers reach ~3 mm/h), soft 25 min edges.
const hash1 = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
export function autoRain(day, hour, winter = 0) {
  const w = Math.min(1, Math.max(0, winter || 0));
  const chance = RAIN_AUTO.summerChance + (RAIN_AUTO.winterChance - RAIN_AUTO.summerChance) * w;
  if (hash1(day * 1.731 + 0.37) >= chance) return 0;
  const start = 5 + hash1(day + 11.1) * 14;
  const dur = (RAIN_AUTO.spellHours.summer + (RAIN_AUTO.spellHours.winter - RAIN_AUTO.spellHours.summer) * w) * (0.6 + 0.8 * hash1(day + 3.3));
  const t = hour - start;
  if (t <= 0 || t >= dur) return 0;
  const env = Math.min(1, t / 0.4, (dur - t) / 0.4);
  const typ = RAIN_AUTO.typicalMmH + (RAIN_AUTO.typicalMmHWinter - RAIN_AUTO.typicalMmH) * w;
  const h = hash1(day + 7.7);
  return rainFromMmH(typ * (0.4 + 2.0 * h * h) * env);
}

// ---------------------------------------------------------------- constants
const RUNOFF = 0.9;            // PV glass runoff coefficient
const WALL = 0.04;             // moulded tank wall thickness (m) for the inner volume
const LOW_LEVEL = 0.05;        // irrigation stops drawing below 5 %
const COLS = [-10, 0, 10];     // fallback geometry (model v6)
const N_DROPS = { high: 6000, low: 2000 };
const N_SPLASH = { high: 900, low: 300 };
const BOXES = [ // rain volume presets by camera height: [horizontal, vertical], with hysteresis
  { maxY: 4.5, xz: 14, y: 9 },
  { maxY: 14, xz: 26, y: 16 },
  { maxY: 1e9, xz: 44, y: 26 },
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- GLSL shared pieces
const GLSL_GEOM = /* glsl */`
  uniform vec4 uPV[6];      // PV row: x at the inner (low) edge, x at the outer edge, z0, z1
  uniform vec2 uPVY[6];     // y at the inner edge, y at the outer edge (top of the frames)
  uniform vec4 uTank[18];   // cx, cz, hx, hz
  uniform float uTankTop;
  float rainRoofAt(vec2 xz) {
    for (int i = 0; i < 6; i++) {
      vec4 r = uPV[i];
      float lo = min(r.x, r.y), hi = max(r.x, r.y);
      if (xz.x > lo && xz.x < hi && xz.y > r.z && xz.y < r.w) return mix(uPVY[i].x, uPVY[i].y, (xz.x - r.x) / (r.y - r.x));
    }
    return -1.0;
  }
  float rainInTank(vec2 xz) {
    for (int i = 0; i < 18; i++) {
      vec4 t = uTank[i];
      if (abs(xz.x - t.x) < t.z && abs(xz.y - t.y) < t.w) return 1.0;
    }
    return 0.0;
  }
  float rainHash(float n) { return fract(sin(n) * 43758.5453); }
`;

const DROP_VS = /* glsl */`
  uniform float uTime, uSpeed, uLen, uWidth, uOpacity;
  uniform vec3 uCenter, uBox;
  uniform vec2 uWind;
  attribute vec4 aSeed;
  attribute vec2 aCorner;
  varying vec2 vC;
  varying float vA;
  ${GLSL_GEOM}
  void main() {
    float sp = uSpeed * (0.8 + 0.4 * aSeed.w);
    vec3 vel = vec3(uWind.x, -sp, uWind.y);
    vec3 org = vec3(uCenter.x - 0.5 * uBox.x, -0.3, uCenter.z - 0.5 * uBox.z);
    vec3 p = mod(aSeed.xyz * uBox + vel * uTime - org, uBox) + org;
    float roof = rainRoofAt(p.xz);
    bool dead = p.y < 0.0 || (roof > 0.0 && p.y < roof) || (p.y < uTankTop && rainInTank(p.xz) > 0.5);
    vec3 tail = p - normalize(vel) * uLen * (0.7 + 0.6 * aSeed.w);
    vec4 h = viewMatrix * vec4(p, 1.0);
    vec4 t = viewMatrix * vec4(tail, 1.0);
    vec2 d = t.xy - h.xy;
    vec2 n = length(d) > 1e-5 ? normalize(vec2(-d.y, d.x)) : vec2(1.0, 0.0);
    float w = max(uWidth, 0.0015 * -h.z);
    vec4 v = mix(h, t, aCorner.y);
    v.xy += n * aCorner.x * w;
    gl_Position = dead ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * v;
    vC = aCorner;
    float edge = smoothstep(0.5 * uBox.x, 0.32 * uBox.x, max(abs(p.x - uCenter.x), abs(p.z - uCenter.z)));
    float top = smoothstep(uBox.y - 0.3, uBox.y - 2.5, p.y);
    // drops seen end-on (looking up / down the fall line) collapse to dots: fade them by streak length / width
    float endOn = smoothstep(1.5, 6.0, length(d) / w);
    vA = dead ? 0.0 : uOpacity * edge * top * endOn * smoothstep(0.7, 2.2, -h.z) * (0.6 + 0.4 * aSeed.w);
  }
`;
const DROP_FS = /* glsl */`
  uniform vec3 uColor;
  varying vec2 vC;
  varying float vA;
  void main() {
    float a = vA * (1.0 - abs(vC.x)) * mix(1.0, 0.2, vC.y);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const SPLASH_VS = /* glsl */`
  uniform float uTime, uRate, uOpacity, uRadius;
  uniform vec3 uCenter;
  attribute vec4 aSeed;   // x,y random, z phase, w rate jitter
  attribute vec3 aInfo;   // kind (0 ground, 1 tank lid, 2 PV), index (tank 0..17 / row 0..5), corner id unused
  attribute vec2 aCorner;
  varying vec2 vUv;
  varying float vA, vF;
  ${GLSL_GEOM}
  void main() {
    float ph = uTime * uRate * (0.7 + 0.6 * aSeed.w) + aSeed.z;
    float cyc = floor(ph), f = fract(ph);
    float s = aSeed.x * 173.3 + aSeed.y * 31.7 + cyc * 3.71;
    vec2 rnd = vec2(rainHash(s), rainHash(s + 1.7));
    vec3 p;
    float dead = 0.0, size = 1.0;
    int idx = int(aInfo.y + 0.5);
    if (aInfo.x < 0.5) {
      float a = rnd.x * 6.28318, r = sqrt(rnd.y) * uRadius;
      p = vec3(uCenter.x + cos(a) * r, 0.03, uCenter.z + sin(a) * r);
      if (rainRoofAt(p.xz) > 0.0 || rainInTank(p.xz) > 0.5) dead = 1.0;
    } else if (aInfo.x < 1.5) {
      vec4 t = uTank[idx];
      p = vec3(t.x + (rnd.x - 0.5) * 1.8 * t.z, uTankTop + 0.012, t.y + (rnd.y - 0.5) * 1.8 * t.w);
      size = 0.8;
    } else {
      vec4 r = uPV[idx];
      float k = rnd.x;
      p = vec3(mix(r.x, r.y, k), mix(uPVY[idx].x, uPVY[idx].y, k) + 0.02, mix(r.z, r.w, rnd.y));
      size = 0.6;
    }
    if (cameraPosition.y < p.y + 0.05) dead = 1.0;   // rings lie on top of a surface: never seen from below
    float rad = mix(0.012, 0.075, f) * size;
    vec3 wp = p + vec3(aCorner.x, 0.0, aCorner.y) * rad;
    gl_Position = dead > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
    vUv = aCorner; vF = f;
    vA = (1.0 - dead) * uOpacity * (1.0 - f);
  }
`;
const SPLASH_FS = /* glsl */`
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vA, vF;
  void main() {
    float d = length(vUv);
    float ring = smoothstep(0.62, 0.86, d) * smoothstep(1.0, 0.88, d);
    float blob = (1.0 - smoothstep(0.0, 0.5, d)) * (1.0 - smoothstep(0.0, 0.25, vF));
    float a = vA * max(ring, blob);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const STREAM_VS = /* glsl */`
  uniform float uFlow, uOver;
  attribute vec3 aA, aB;    // top, bottom of the stream centre line
  attribute vec2 aCorner;   // x -1..1 across, y 0 top .. 1 bottom
  attribute vec2 aInfo;     // kind (0 spout stream, 1 overflow sheet), seed
  varying vec2 vUv;
  varying float vLen, vSeed, vA, vKind;
  void main() {
    vec3 c = mix(aA, aB, aCorner.y);
    vec4 v;
    float on;
    if (aInfo.x < 0.5) {
      on = uFlow;
      vec4 h = viewMatrix * vec4(aA, 1.0), t = viewMatrix * vec4(aB, 1.0);
      vec2 d = t.xy - h.xy;
      vec2 n = length(d) > 1e-5 ? normalize(vec2(-d.y, d.x)) : vec2(1.0, 0.0);
      v = viewMatrix * vec4(c, 1.0);
      v.xy += n * aCorner.x * max(mix(0.004, 0.022, uFlow), 0.0009 * -v.z);
    } else {
      on = uOver;
      v = viewMatrix * vec4(c + vec3(aCorner.x * 0.42, 0.0, 0.0), 1.0);
    }
    gl_Position = on < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * v;
    vUv = aCorner; vLen = distance(aA, aB); vSeed = aInfo.y; vA = on; vKind = aInfo.x;
  }
`;
const STREAM_FS = /* glsl */`
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vLen, vSeed, vA, vKind;
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float y = vUv.y * vLen;                       // metres from the top
    if (vKind > 0.5) {                            // overflow: rivulets running down the tank end face
      float cx = (vUv.x * 0.5 + 0.5) * 9.0, col = floor(cx), fx = fract(cx);
      float riv = smoothstep(0.45, 0.08, abs(fx - 0.5)) * step(0.25, h1(col + vSeed * 7.0));
      float pulse = fract((y - uTime * (1.2 + h1(col) * 0.8)) * 2.5 + h1(col * 3.1));
      float ra = riv * (0.3 + 0.55 * smoothstep(0.6, 1.0, pulse)) * min(1.0, vA * 2.0) * smoothstep(1.0, 0.85, abs(vUv.x));
      ra *= smoothstep(0.0, 0.03, vUv.y);
      if (ra < 0.004) discard;
      gl_FragColor = vec4(uColor * 1.1, ra);
      return;
    }
    float speed = vKind < 0.5 ? 5.5 : 1.6;
    float u = (y - uTime * speed) * (vKind < 0.5 ? 4.0 : 9.0) + vSeed * 17.0;
    float cell = floor(u), fr = fract(u);
    float blob = step(h1(cell + vSeed) , 0.35 + 0.65 * vA) * smoothstep(0.0, 0.25, fr) * smoothstep(1.0, 0.6, fr);
    float across = vKind < 0.5 ? 1.0 - vUv.x * vUv.x : smoothstep(1.0, 0.7, abs(vUv.x));
    float cont = vKind < 0.5 ? smoothstep(0.35, 0.9, vA) : 0.45 + 0.3 * fract(vUv.x * 3.7 + vSeed);
    float a = clamp(max(blob, cont), 0.0, 1.0) * across * (vKind < 0.5 ? 0.75 : 0.7 * min(1.0, vA * 2.0));
    a *= smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.97, vUv.y);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * (0.85 + 0.3 * h1(cell * 1.3)), a);
  }
`;

// ---------------------------------------------------------------- helpers
function meshesOf(obj) { const out = []; obj?.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) out.push(o); }); return out; }

// cluster world-space vertices of meshes by gaps along one axis (0 = x, 2 = z), returning boxes
function clusterBoxes(THREE, meshes, axis, gap) {
  const pts = [], v = new THREE.Vector3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); pts.push(v.x, v.y, v.z); }
  }
  const n = pts.length / 3, idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i * 3;
  idx.sort((a, b) => pts[a + axis] - pts[b + axis]);
  const out = []; let cur = null, last = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = idx[k], x = pts[i], y = pts[i + 1], z = pts[i + 2], a = pts[i + axis];
    if (!cur || a - last > gap) { cur = { x0: x, x1: x, y0: y, y1: y, z0: z, z1: z }; out.push(cur); }
    cur.x0 = Math.min(cur.x0, x); cur.x1 = Math.max(cur.x1, x);
    cur.y0 = Math.min(cur.y0, y); cur.y1 = Math.max(cur.y1, y);
    cur.z0 = Math.min(cur.z0, z); cur.z1 = Math.max(cur.z1, z);
    last = a;
  }
  return out;
}

// chain an onBeforeCompile patch after any existing one
function chainPatch(mat, key, fn) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, r) { if (prev) prev.call(this, shader, r); fn(shader); };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|' + key; };
  mat.needsUpdate = true;
}
const addWorldPosVarying = (shader, name) => {
  shader.vertexShader = `varying vec3 ${name};\n` + shader.vertexShader.replace('#include <project_vertex>',
    `#include <project_vertex>\n ${name} = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
};

// ---------------------------------------------------------------- module
export function init(ctx) {
  const { THREE, scene } = ctx;
  const root = ctx.root || scene;
  root.updateMatrixWorld(true);
  const node = (n) => (typeof ctx.node === 'function' ? ctx.node(n) : null);

  // ================= measure tanks + PV rows from the GLB =================
  const tanks = [];
  const tankMeshes = [];
  for (let c = 1; c <= 3; c++) {
    const main = meshesOf(node(`Canopy ${c} / molded water tanks`));
    tankMeshes.push(...main, ...meshesOf(node(`Canopy ${c} / tank reinforcement belts`)), ...meshesOf(node(`Canopy ${c} / tank molded ribs`)));
    for (const b of clusterBoxes(THREE, main, 2, 0.2)) {
      tanks.push({ cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, hx: (b.x1 - b.x0) / 2, hz: (b.z1 - b.z0) / 2, y0: b.y0, y1: b.y1 });
    }
  }
  if (tanks.length !== 18) { // parametric fallback (model v6)
    if (tanks.length) console.warn(`[rain] found ${tanks.length} tanks, expected 18; using v6 layout`);
    tanks.length = 0;
    for (const cx of COLS) for (let k = 0; k < 6; k++) tanks.push({ cx, cz: -1.1 - 6 * k, hx: 0.57, hz: 0.775, y0: 0, y1: 1.1 });
  }
  const TANK_TOP = tanks.reduce((m, t) => Math.max(m, t.y1), 0);
  const tankInnerL = (t) => (2 * t.hx - 2 * WALL) * (t.y1 - t.y0 - 2 * WALL) * (2 * t.hz - 2 * WALL) * 1000;
  const CAP = Math.round(tanks.reduce((s, t) => s + tankInnerL(t), 0) / 10) * 10; // all 18 tanks, litres
  const CAP_EACH = Math.round(CAP / tanks.length);

  // PV rows: cluster the frames of each canopy across x into the 2 longitudinal rows
  const rows = [];
  for (let c = 1; c <= 3; c++) {
    const frames = meshesOf(node(`Canopy ${c} / PV frames`));
    if (!frames.length) continue;
    const bs = clusterBoxes(THREE, frames, 0, 0.3).filter((b) => b.x1 - b.x0 > 0.8);
    const cx = tanks.length ? tanks[(c - 1) * 6].cx : COLS[c - 1];
    for (const b of bs) {
      const innerLeft = Math.abs(b.x0 - cx) < Math.abs(b.x1 - cx);
      rows.push({ xIn: innerLeft ? b.x0 : b.x1, xOut: innerLeft ? b.x1 : b.x0, z0: b.z0, z1: b.z1, yIn: b.y0 + 0.03, yOut: b.y1, cx });
    }
  }
  if (rows.length !== 6) {
    if (rows.length) console.warn(`[rain] found ${rows.length} PV rows, expected 6; using v6 layout`);
    rows.length = 0;
    for (const cx of COLS) for (const s of [-1, 1]) rows.push({ xIn: cx + s * 1.3, xOut: cx + s * 2.8, z0: -30, z1: 0, yIn: 4.72, yOut: 5.03, cx });
  }
  const CATCH = rows.reduce((s, r) => s + Math.abs(r.xOut - r.xIn) * (r.z1 - r.z0), 0); // plan area m2
  const LPM_PER_MMH = CATCH * RUNOFF / 60;

  // shared geometry uniforms
  const GU = {
    uPV: { value: rows.map((r) => new THREE.Vector4(r.xIn, r.xOut, r.z0, r.z1)) },
    uPVY: { value: rows.map((r) => new THREE.Vector2(r.yIn, r.yOut)) },
    uTank: { value: tanks.map((t) => new THREE.Vector4(t.cx, t.cz, t.hx, t.hz)) },
    uTankTop: { value: TANK_TOP },
  };

  const group = new THREE.Group(); group.name = 'Rain';
  scene.add(group);

  // ================= rain streaks =================
  const NMAX = N_DROPS.high;
  const dropGeo = new THREE.BufferGeometry();
  {
    const seed = new Float32Array(NMAX * 4 * 4), corner = new Float32Array(NMAX * 4 * 2), index = new Uint16Array(NMAX * 6);
    const CS = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
    let s = 1;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < NMAX; i++) {
      const a = rnd(), b = rnd(), c = rnd(), d = rnd();
      for (let k = 0; k < 4; k++) {
        const j = i * 4 + k;
        seed.set([a, b, c, d], j * 4); corner.set(CS[k], j * 2);
      }
      index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    }
    dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NMAX * 4 * 3), 3)); // unused, required
    dropGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    dropGeo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    dropGeo.setIndex(new THREE.BufferAttribute(index, 1));
    dropGeo.setDrawRange(0, 0);
  }
  const DU = {
    uTime: { value: 0 }, uSpeed: { value: 8 }, uLen: { value: 0.45 }, uWidth: { value: 0.006 }, uOpacity: { value: 0.3 },
    uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(26, 16, 26) }, uWind: { value: new THREE.Vector2(1.1, 0.5) },
    uColor: { value: new THREE.Color(0.78, 0.83, 0.9) }, ...GU,
  };
  const dropMat = new THREE.ShaderMaterial({ uniforms: DU, vertexShader: DROP_VS, fragmentShader: DROP_FS,
    transparent: true, depthWrite: false });
  const drops = new THREE.Mesh(dropGeo, dropMat);
  drops.name = 'Rain / drops'; drops.frustumCulled = false; drops.renderOrder = 3;
  group.add(drops);

  // ================= splash rings =================
  const SMAX = N_SPLASH.high;
  const splashGeo = new THREE.BufferGeometry();
  {
    const seed = new Float32Array(SMAX * 16), info = new Float32Array(SMAX * 12), corner = new Float32Array(SMAX * 8), index = new Uint16Array(SMAX * 6);
    const CS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < SMAX; i++) {
      // interleave kinds so a partial draw range keeps the mix: 0..9 -> 6 ground, 2 tank, 2 PV
      const m = i % 10, kind = m < 6 ? 0 : m < 8 ? 1 : 2;
      const id = kind === 1 ? Math.floor(rnd() * 18) % 18 : kind === 2 ? Math.floor(rnd() * 6) % 6 : 0;
      const a = rnd(), b = rnd(), c = rnd(), d = rnd();
      for (let k = 0; k < 4; k++) {
        const j = i * 4 + k;
        seed.set([a, b, c, d], j * 4); info.set([kind, id, k], j * 3); corner.set(CS[k], j * 2);
      }
      index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    }
    splashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMAX * 12), 3));
    splashGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    splashGeo.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    splashGeo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    splashGeo.setIndex(new THREE.BufferAttribute(index, 1));
    splashGeo.setDrawRange(0, 0);
  }
  const SPU = {
    uTime: { value: 0 }, uRate: { value: 1.6 }, uOpacity: { value: 0.5 }, uRadius: { value: 12 },
    uCenter: DU.uCenter, uColor: { value: new THREE.Color(0.85, 0.9, 0.95) }, ...GU,
  };
  const splashMat = new THREE.ShaderMaterial({ uniforms: SPU, vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const splashes = new THREE.Mesh(splashGeo, splashMat);
  splashes.name = 'Rain / splashes'; splashes.frustumCulled = false; splashes.renderOrder = 2;
  group.add(splashes);

  // ================= gutters + spouts (model has none) =================
  const gutters = new THREE.Group(); gutters.name = 'Rain / gutters';
  const spoutEnds = []; // [{x,y,z}] where a stream leaves a spout, per tank and side
  {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const gMat = new THREE.MeshStandardMaterial({ color: 0x9ba4aa, metalness: 0.55, roughness: 0.42, name: 'Rain gutter' });
    const nInst = rows.length + tanks.length * 2;
    const im = new THREE.InstancedMesh(box, gMat, nInst);
    im.name = 'Rain / gutters + spouts';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), zAx = new THREE.Vector3(0, 0, 1);
    let k = 0;
    const gut = rows.map((r) => {
      const toC = Math.sign(r.cx - r.xIn) || 1;
      const gx = r.xIn + toC * 0.03, gy = r.yIn - 0.1;
      p.set(gx, gy, (r.z0 + r.z1) / 2); sc.set(0.11, 0.07, r.z1 - r.z0 + 0.25); q.identity();
      im.setMatrixAt(k++, m.compose(p, q, sc));
      return { gx, gy, toC, cx: r.cx };
    });
    for (const t of tanks) for (const s of [-1, 1]) {
      const g = gut.find((g) => Math.abs(g.cx - t.cx) < 1 && Math.sign(g.gx - t.cx) === s) || gut[0];
      const ex = t.cx + s * 0.2, ey = Math.min(g.gy - 0.32, 4.42);
      const dx = ex - g.gx, dy = ey - (g.gy - 0.03), len = Math.hypot(dx, dy);
      p.set((g.gx + ex) / 2, (g.gy - 0.03 + ey) / 2, t.cz);
      q.setFromAxisAngle(zAx, Math.atan2(dy, dx));
      sc.set(len, 0.045, 0.045);
      im.setMatrixAt(k++, m.compose(p, q, sc));
      spoutEnds.push({ x: ex, y: ey, z: t.cz });
    }
    im.count = k; im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    gutters.add(im);
  }
  group.add(gutters);

  // ================= streams (spouts -> tank hatch) + overflow sheets =================
  const nStreams = spoutEnds.length + tanks.length;
  const streamGeo = new THREE.BufferGeometry();
  {
    const A = new Float32Array(nStreams * 12), B = new Float32Array(nStreams * 12), corner = new Float32Array(nStreams * 8),
      info = new Float32Array(nStreams * 8), index = new Uint16Array(nStreams * 6);
    const CS = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
    const put = (i, a, b, kind, seed) => {
      for (let k = 0; k < 4; k++) {
        const j = i * 4 + k;
        A.set(a, j * 3); B.set(b, j * 3); corner.set(CS[k], j * 2); info.set([kind, seed], j * 2);
      }
      index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    };
    let i = 0;
    for (const e of spoutEnds) put(i++, [e.x, e.y, e.z], [e.x, TANK_TOP - 0.02, e.z], 0, (i * 0.618) % 1);
    for (const t of tanks) put(i++, [t.cx, t.y1 + 0.005, t.cz + t.hz + 0.012], [t.cx, 0.0, t.cz + t.hz + 0.03], 1, (i * 0.377) % 1);
    streamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nStreams * 12), 3));
    streamGeo.setAttribute('aA', new THREE.BufferAttribute(A, 3));
    streamGeo.setAttribute('aB', new THREE.BufferAttribute(B, 3));
    streamGeo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    streamGeo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
    streamGeo.setIndex(new THREE.BufferAttribute(index, 1));
  }
  const STU = { uTime: { value: 0 }, uFlow: { value: 0 }, uOver: { value: 0 }, uColor: { value: new THREE.Color(0.72, 0.84, 0.95) } };
  const streamMat = new THREE.ShaderMaterial({ uniforms: STU, vertexShader: STREAM_VS, fragmentShader: STREAM_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const streams = new THREE.Mesh(streamGeo, streamMat);
  streams.name = 'Rain / runoff streams'; streams.frustumCulled = false; streams.renderOrder = 3;
  group.add(streams);

  // ================= water inside the tanks =================
  const WU = { uTime: { value: 0 }, uIce: { value: 0 }, uRipple: { value: 0 } };
  const waterGeo = new THREE.BoxGeometry(1, 1, 1); waterGeo.translate(0, 0.5, 0);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a7fc4, roughness: 0.12, metalness: 0.0, emissive: 0x0d4a86,
    emissiveIntensity: 0.55, transparent: true, opacity: 0.9, name: 'Rain tank water' });
  waterMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WU);
    sh.vertexShader = 'varying vec3 vTwWP; varying float vTwTop;\n' + sh.vertexShader.replace('#include <project_vertex>',
      `#include <project_vertex>
       vTwWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
       vTwTop = step(0.5, normal.y);`);
    sh.fragmentShader = 'varying vec3 vTwWP; varying float vTwTop; uniform float uTime, uIce, uRipple;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float twIce = uIce * vTwTop;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.92, 0.97), twIce * 0.85);
        diffuseColor.a = mix(diffuseColor.a, 0.97, twIce);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.35, twIce);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vTwTop > 0.5) {
          vec2 q = vTwWP.xz;
          float k = (1.0 - uIce) * (0.35 + uRipple);
          vec2 g = vec2(cos(q.x * 11.0 + uTime * 2.3) + 0.6 * cos(q.x * 7.0 - q.y * 9.0 + uTime * 3.1),
                        cos(q.y * 13.0 - uTime * 2.7) + 0.6 * cos(q.y * 5.0 + q.x * 8.0 + uTime * 1.9)) * 0.12 * k;
          normal = normalize(normal + (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= mix(1.0, 0.25, twIce);`);
  };
  waterMat.customProgramCacheKey = () => 'rain-tankwater';
  const water = new THREE.InstancedMesh(waterGeo, waterMat, tanks.length);
  water.name = 'Rain / tank water'; water.frustumCulled = false; water.visible = false; water.renderOrder = 1;
  group.add(water);
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  let lastWaterH = -1;
  const setWaterLevel = (lv) => {
    const h = Math.max(0.004, lv * (TANK_TOP - 2 * WALL - 0.03));
    if (Math.abs(h - lastWaterH) < 1e-4) return;
    lastWaterH = h;
    for (let i = 0; i < tanks.length; i++) {
      const t = tanks[i];
      _p.set(t.cx, t.y0 + WALL, t.cz); _s.set(2 * (t.hx - WALL - 0.01), h, 2 * (t.hz - WALL - 0.01));
      water.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    water.instanceMatrix.needsUpdate = true;
  };

  // ================= material patches =================
  const RU = {
    uRainWet: { value: 0 }, uPuddle: { value: 0 }, uRainNow: { value: 0 }, uRainTime: { value: 0 },
    uRainSky: { value: new THREE.Color(0.62, 0.68, 0.76) }, uTankWin: { value: 0 }, ...GU,
  };
  const SHELTER_GLSL = `
    float rainShelter(vec2 xz) {
      float s = 0.0;
      for (int i = 0; i < 6; i++) {
        vec4 r = uPV[i];
        float lo = min(r.x, r.y) + 0.2, hi = max(r.x, r.y) - 0.2;
        float sx = smoothstep(lo - 0.45, lo, xz.x) * smoothstep(hi + 0.45, hi, xz.x);
        float sz = smoothstep(r.z - 0.4, r.z + 0.2, xz.y) * smoothstep(r.w + 0.4, r.w - 0.2, xz.y);
        s = max(s, sx * sz);
      }
      return s;
    }
  `;
  const GROUND_GLSL = `
    varying vec3 vRainWP;
    uniform float uRainWet, uPuddle, uRainNow, uRainTime;
    uniform vec3 uRainSky;
    ${GLSL_GEOM}
    ${SHELTER_GLSL}
    float rainH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float rainNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(rainH2(i), rainH2(i + vec2(1, 0)), f.x), mix(rainH2(i + vec2(0, 1)), rainH2(i + vec2(1, 1)), f.x), f.y);
    }
    // puddle mask 0..1: FarmDroid wheel tracks (x = +-3.5, +-6.5, along the beds and out to the entrance) + low spots
    float rainPuddleMask(vec2 xz) {
      float rut = 0.0;
      rut = max(rut, smoothstep(0.2, 0.06, abs(abs(xz.x) - 3.5)));
      rut = max(rut, smoothstep(0.2, 0.06, abs(abs(xz.x) - 6.5)));
      rut *= step(-30.5, xz.y) * step(xz.y, 6.0);
      float n = rainNoise(xz * vec2(2.5, 0.9) + 3.1) * 0.65 + rainNoise(xz * 3.1) * 0.35;
      float low = rainNoise(xz * 0.23 + 7.3) * 0.7 + rainNoise(xz * 1.1 + 1.3) * 0.3;
      return max(rut * smoothstep(0.3, 0.8, n), smoothstep(0.68, 0.9, low) * 0.8);
    }
    float rainRipples(vec2 xz) {
      vec2 g = xz * 2.6, c = floor(g), f = fract(g);
      float ph = fract(uRainTime * 1.1 + rainH2(c));
      vec2 o = vec2(rainH2(c + 3.1), rainH2(c + 7.7)) * 0.5 + 0.25;
      float d = length(f - o);
      return smoothstep(0.05, 0.0, abs(d - ph * 0.45)) * (1.0 - ph);
    }
  `;
  const patchGround = (mat) => chainPatch(mat, 'rain-ground', (sh) => {
    Object.assign(sh.uniforms, RU);
    addWorldPosVarying(sh, 'vRainWP');
    sh.fragmentShader = GROUND_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rShel = rainShelter(vRainWP.xz);
        float rWet = uRainWet * (1.0 - 0.85 * rShel);
        float rPud = 0.0;
        if (uPuddle > 0.001) {
          float th = 1.02 - 0.78 * uPuddle;
          rPud = smoothstep(th, th + 0.05, rainPuddleMask(vRainWP.xz)) * (1.0 - rShel);
        }
        diffuseColor.rgb *= mix(1.0, 0.6, rWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.32 + vec3(0.018, 0.022, 0.028), rPud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, rWet);
        roughnessFactor = mix(roughnessFactor, 0.04, rPud);`)
      .replace('#include <opaque_fragment>', `
        if (rPud > 0.001) {
          float rFres = pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), 3.0);
          float rRip = uRainNow > 0.01 ? rainRipples(vRainWP.xz) * uRainNow : 0.0;
          outgoingLight = mix(outgoingLight, uRainSky * 0.62, rPud * clamp(0.08 + 0.5 * rFres + 0.5 * rRip, 0.0, 0.6));
        }
        #include <opaque_fragment>`);
  });
  const patchSteel = (mat) => chainPatch(mat, 'rain-steel', (sh) => {
    Object.assign(sh.uniforms, RU);
    sh.fragmentShader = 'uniform float uRainWet;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(1.0, 0.8, uRainWet);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uRainWet);');
  });
  // tank skin: wet look + cut-away window in both long sides and a hatch in the lid while uTankWin > 0
  const patchTank = (mat) => chainPatch(mat, 'rain-tank', (sh) => {
    Object.assign(sh.uniforms, RU);
    addWorldPosVarying(sh, 'vTkWP');
    sh.fragmentShader = `varying vec3 vTkWP; uniform float uRainWet, uTankWin;\n${GLSL_GEOM}\n` + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float tkRim = 0.0;
        if (uTankWin > 0.001) {
          for (int i = 0; i < 18; i++) {
            vec4 t = uTank[i];
            vec2 d = abs(vTkWP.xz - t.xy);
            if (d.x > t.z + 0.08 || d.y > t.w + 0.08) continue;
            float yTop = uTankTop;
            // side window: long faces (|x - cx| close to hx), opens from the middle with uTankWin
            float hz = (t.w - 0.24) * uTankWin, y0 = 0.14 + (1.0 - uTankWin) * 0.4, y1 = yTop - 0.12 - (1.0 - uTankWin) * 0.4;
            // camera-side half: cut the near wall and the moulded-in tunnels, keep the far wall as a backdrop
            float xr = (vTkWP.x - t.x) * (cameraPosition.x > t.x ? 1.0 : -1.0);
            bool side = xr > -(t.z - 0.13) && d.y < hz && vTkWP.y > y0 && vTkWP.y < y1;
            // lid hatch
            bool lid = vTkWP.y > yTop - 0.07 && d.x < 0.3 * uTankWin && d.y < 0.45 * uTankWin;
            if (side || lid) discard;
            if (xr > t.z - 0.13 && d.y < hz + 0.035 && vTkWP.y > y0 - 0.035 && vTkWP.y < y1 + 0.035) tkRim = 1.0;
            if (vTkWP.y > yTop - 0.07 && d.x < 0.3 * uTankWin + 0.03 && d.y < 0.45 * uTankWin + 0.03) tkRim = 1.0;
            break;
          }
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.8, uRainWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.24), tkRim * 0.85);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, uRainWet);');
  });

  const patched = new Set();
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || patched.has(m)) continue;
      if (m.name === 'Soil' || m.name === 'Dark earth' || m.name === 'Grass') { patched.add(m); patchGround(m); }
      else if (m.name === 'Galvanized steel') { patched.add(m); patchSteel(m); }
    }
  });
  // one clone of the tank material(s), shared by the 9 tank / belt / rib meshes
  const tankMatClones = new Map();
  for (const mesh of tankMeshes) {
    const src = mesh.material;
    if (!src || Array.isArray(src)) continue;
    let c = tankMatClones.get(src);
    if (!c) {
      c = src.clone(); c.name = src.name; c.side = THREE.DoubleSide; // interior visible through the window
      patchTank(c); tankMatClones.set(src, c);
    }
    mesh.material = c;
  }

  // ================= state =================
  const S = {
    first: true, lastHour: null, litres: CAP * 0.6, wrote: -1, rainTodayMm: 0, puddleMm: 0, wet: 0,
    rainVis: 0, flowVis: 0, overVis: 0, levelVis: 0.6, win: 0, ice: 0, time: 0,
    inflow: 0, outflow: 0, spill: 0, mmh: 0, visible: true, boxIdx: 1,
  };
  const out = { rainMmH: 0, rainTodayMm: 0, tankLevel: 0.6, tankLitres: 0, tankCapacityL: CAP, tankCapacityEachL: CAP_EACH,
    inflowLpm: 0, outflowLpm: 0, spillLpm: 0, catchmentM2: Math.round(CATCH * 10) / 10, tanks: tanks.length, wetness: 0, puddles: 0 };
  const _dir = new THREE.Vector3(), _cp = new THREE.Vector3();
  const _sky = new THREE.Color();
  setWaterLevel(0.6);

  function update(dt, state) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    S.time += dt;
    const w = clamp01(+state.winter || 0);
    const sun = clamp01(+state.sun || 0);
    const rIn = clamp01(+state.rain || 0);
    const fadeW = 1 - smooth(0.35, 0.85, w);
    const mmh = mmhFromRain(rIn) * fadeW;
    S.mmh = mmh;
    state.rainMmH = mmh;

    // ---- external tankLevel (slider) or first frame
    if (S.first) {
      S.first = false;
      if (Number.isFinite(state.tankLevel)) S.litres = clamp01(state.tankLevel) * CAP;
      S.levelVis = S.litres / CAP;
    } else if (Number.isFinite(state.tankLevel) && Math.abs(state.tankLevel - S.wrote) > 1e-6) {
      S.litres = clamp01(state.tankLevel) * CAP;
    }

    // ---- simulated time
    let dh = 0;
    if (S.lastHour !== null && Number.isFinite(state.hour)) {
      dh = state.hour - S.lastHour;
      if (dh < -12) { dh += 24; S.rainTodayMm = 0; }
      if (dh < 0 || dh >= 1) dh = 0;   // backwards scrubs and >= 1 h jumps do not count (same rule as power.js)
    }
    S.lastHour = Number.isFinite(state.hour) ? state.hour : S.lastHour;

    // ---- water balance
    const irr = Math.max(0, +state.irrigationLpm || 0);
    S.inflow = mmh * LPM_PER_MMH;
    S.outflow = S.litres / CAP > LOW_LEVEL ? irr : 0;
    S.litres += (S.inflow - S.outflow) * dh * 60;
    S.spill = 0;
    if (S.litres >= CAP) { S.spill = Math.max(0, S.inflow - S.outflow); S.litres = CAP; }
    if (S.litres < 0) S.litres = 0;
    const level = S.litres / CAP;
    state.tankLevel = level; S.wrote = level;
    S.rainTodayMm += mmh * dh;

    // ---- wetness + puddles (sim time, plus a slow real-time part so a paused clock still reacts)
    if (mmh > 0) S.wet += (1 - S.wet) * Math.min(1, (dt / 15 + dh / 0.25) * (0.3 + rIn));
    else S.wet -= S.wet * Math.min(1, dt / 150 + dh * (0.25 + 0.6 * sun));
    S.puddleMm += mmh * (dh + dt / 300);
    S.puddleMm -= Math.min(S.puddleMm, (0.25 + 1.2 * sun) * (dh + dt / 900) * (mmh > 0 ? 0.3 : 1));
    S.puddleMm = Math.min(S.puddleMm, 14);

    // ---- visual easing
    const rTarget = rIn * fadeW;
    S.rainVis += (rTarget - S.rainVis) * Math.min(1, dt * 1.5);
    const flowT = S.visible ? clamp01(mmh / 6) : 0;
    S.flowVis += (flowT - S.flowVis) * Math.min(1, dt * (flowT > S.flowVis ? 0.6 : 1.2)); // runoff lags the rain
    S.overVis += ((S.spill > 0.01 && S.visible ? 1 : 0) - S.overVis) * Math.min(1, dt * 1.2);
    S.levelVis += (level - S.levelVis) * Math.min(1, dt * 3);
    const showWater = S.visible && (state.show ? state.show.water !== false : true);
    S.win += ((showWater ? 1 : 0) - S.win) * Math.min(1, dt * 2.5);
    if (Math.abs(S.win - (showWater ? 1 : 0)) < 0.002) S.win = showWater ? 1 : 0;
    const freezing = Number.isFinite(state.tempOutsideC) ? state.tempOutsideC < 0 : w > 0.5;
    S.ice += ((freezing ? 1 : 0) - S.ice) * Math.min(1, dt * 0.5);

    // ---- uniforms
    const wetVis = S.visible ? S.wet * (1 - w) : 0;
    RU.uRainWet.value = wetVis;
    RU.uPuddle.value = S.visible ? clamp01(S.puddleMm / 5) * (1 - smooth(0.2, 0.7, w)) : 0;
    RU.uRainNow.value = S.visible ? S.rainVis : 0;
    RU.uRainTime.value = S.time;
    RU.uTankWin.value = S.win;
    const fogC = scene.fog?.color || (scene.background?.isColor ? scene.background : null);
    if (fogC) _sky.copy(fogC); else _sky.setRGB(0.62, 0.68, 0.76);
    RU.uRainSky.value.copy(_sky).multiplyScalar(0.55 + 0.45 * sun);

    const light = 0.18 + 0.82 * Math.max(sun, 0.05);
    const sleet = smooth(0.15, 0.7, w);
    const rv = S.visible ? S.rainVis : 0;
    const nDrops = state.quality === 'low' ? N_DROPS.low : N_DROPS.high;
    const nSpl = state.quality === 'low' ? N_SPLASH.low : N_SPLASH.high;
    drops.visible = rv > 0.003;
    splashes.visible = rv > 0.003 && w < 0.9;
    if (drops.visible) {
      const cam = ctx.getCamera?.();
      if (cam) {
        cam.getWorldDirection(_dir); cam.getWorldPosition(_cp);
        const cy = _cp.y;
        // box preset with hysteresis
        let b = S.boxIdx;
        while (b > 0 && cy < BOXES[b - 1].maxY - 0.8) b--;
        while (b < BOXES.length - 1 && cy > BOXES[b].maxY + 0.8) b++;
        S.boxIdx = b;
        const B = BOXES[b];
        const ahead = cam.isOrthographicCamera ? 0 : Math.min(B.xz * 0.35, Math.max(3, cy * 0.9));
        DU.uCenter.value.set(_cp.x + _dir.x * ahead, 0, _cp.z + _dir.z * ahead);
        DU.uBox.value.set(B.xz, B.y, B.xz);
        SPU.uRadius.value = B.xz * 0.45;
        // density per volume: smaller boxes get the same drops -> denser near the walker, cap count for big ones
        const k = Math.pow(rv, 0.75);
        dropGeo.setDrawRange(0, Math.round(nDrops * (0.06 + 0.94 * k)) * 6);
        splashGeo.setDrawRange(0, Math.round(nSpl * (0.08 + 0.92 * k)) * 6);
      }
      DU.uTime.value = S.time; SPU.uTime.value = S.time;
      DU.uSpeed.value = (5.5 + 3.5 * rv) * (1 - 0.35 * sleet);
      DU.uLen.value = (0.28 + 0.32 * rv) * (1 - 0.5 * sleet);
      DU.uOpacity.value = (0.16 + 0.22 * rv) * (0.55 + 0.45 * light) * (1 + 0.4 * sleet);
      DU.uWind.value.set(0.6 + 1.2 * rv, 0.25 + 0.4 * rv);
      DU.uColor.value.setRGB(0.74 + 0.2 * sleet, 0.8 + 0.15 * sleet, 0.88 + 0.1 * sleet).multiplyScalar(0.45 + 0.55 * light);
      SPU.uRate.value = 1.2 + 1.2 * rv;
      SPU.uOpacity.value = (0.3 + 0.35 * rv) * (0.5 + 0.5 * light) * (1 - sleet);
      SPU.uColor.value.setRGB(0.86, 0.9, 0.95).multiplyScalar(0.45 + 0.55 * light);
    }
    streams.visible = S.flowVis > 0.01 || S.overVis > 0.01;
    STU.uTime.value = S.time; STU.uFlow.value = S.flowVis; STU.uOver.value = S.overVis;
    STU.uColor.value.setRGB(0.72, 0.84, 0.95).multiplyScalar(0.45 + 0.55 * light);

    water.visible = S.win > 0.01;
    if (water.visible) {
      setWaterLevel(S.levelVis);
      WU.uTime.value = S.time; WU.uIce.value = S.ice; WU.uRipple.value = S.flowVis * 1.5 + rv * 0.5;
      waterMat.emissiveIntensity = 0.25 + 0.45 * (1 - sun);
    }

    // ---- info
    out.rainMmH = mmh; out.rainTodayMm = S.rainTodayMm; out.tankLevel = level; out.tankLitres = S.litres;
    out.inflowLpm = S.inflow; out.outflowLpm = S.outflow; out.spillLpm = S.spill;
    out.wetness = S.wet; out.puddles = clamp01(S.puddleMm / 5);
  }

  return {
    update,
    info() { return out; },
    setVisible(v) { S.visible = !!v; if (!v) { drops.visible = splashes.visible = streams.visible = false; } },
    tanks, gutters, group,
  };
}
