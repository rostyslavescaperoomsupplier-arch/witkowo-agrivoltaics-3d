// lib/underground.js — geological cut-away under the farm + groundwater (agent SUBSURFACE, 2026-11-18).
//
// What it draws (all in one THREE.Group 'Underground', hidden until shown):
// - A 60 x 60 m block under the patch (x -30..30, z -45..15). Only its outer walls + bottom are meshes; the walls
//   are drawn right after the ground (renderOrder -0.5) with depthFunc = Always, so the side faces show THROUGH the
//   terrain in front of them ("x-ray cut-away"): no hole in geo.js's ground is needed and the camera may stay
//   above ground. The model (renderOrder 0) still depth-tests against the walls, so canopies stand in front.
//   Wall tops follow ctx.terrain.heightAt (flat 0 if no terrain).
// - Layer colours + procedural lithology patterns (dots = sand, dots+rings = gravelly sand, dashes+pebbles = till,
//   dashed lines = silt, lines = clay, bricks = marl/chalk, hatching = peat, seams = lignite, crosses = evaporites)
//   computed in the fragment shader from the TRUE depth of each fragment (one uniform table, no textures).
// - Depth scale (setDepthScale): 'full' = piecewise column 0-20 m true, 20-200 m x0.2, below 200 m log
//   (4.5 km -> ~119 m drawn) with zig-zag scale-break marks at 20 m and 200 m; 'true' = 0-100 m at true scale
//   (deeper layers collapse to the bottom, break mark at 100 m). Animated (the y mapping lives in the shaders).
// - Groundwater: main confined aquifer band (10-30 m at Witkowo) tinted blue with slow flowing streaks, weaker
//   tint on the other water-bearing layers, piezometric level line (6 m) + dashed range (1.2-14.5 m) on the walls.
// - Hypothetical irrigation well (dashed casing, screen 20-27 m) from the Field control cabinet into the aquifer,
//   drawn x-ray so it is visible inside the block.
// - Rain link: state.rainMmH > 0 -> infiltration points creeping down the walls into the top layers.
// - Labels: canvas-texture sprites (layer name + depth + age + confidence, PL/EN from <html lang>), depth ruler
//   (0, 2, 10, 30, 50, 82, 140, 175 m, 1 km, 2.5 km), water-table / scale-break / well / title tags. The label
//   column jumps to whichever block edge is the left silhouette for the current camera.
//
// API: init(ctx) -> { update(dt, state), info(), setVisible(b), setSite(site) (async), setDepthScale(v),
//   setLang(l), refresh(), group, ready }
//   ctx: { THREE, scene, renderer?, getCamera(), terrain? {heightAt(x,z), ready?, info?}, sitedata? {info(), ready?},
//          site? }
//   setDepthScale(v): 'full' | 'true' (also 1 / 0 or any 0..1 blend; true / 'shallow' = 'true').
//   state.show.underground (bool) wins over setVisible when present; state.undergroundScale ('full'|'true') too.
//   info().labels / info().ruler carry world anchors if main prefers CSS2D labels (then call setLabels(false)).

const PROFILE_URL = new URL('../data/geo/profile_witkowo.json', import.meta.url);
const FOOT = { x0: -30, x1: 30, z0: -45, z1: 15 };   // block footprint (scene metres), patch centre z = -15
const CX = (FOOT.x0 + FOOT.x1) / 2, CZ = (FOOT.z0 + FOOT.z1) / 2;
const WELL = { x: 14.75, z: -1.0, depth: 28, screen: [20, 27] }; // next to the Field control cabinet (x 13.6..14.2)
const TICKS = [0, 2, 10, 30, 50, 82, 140, 175, 1000, 2500];
const TRUE_MAX = 100;                                  // 'true' mode shows 0..100 m at 1:1
const MAXL = 16;
const WITKOWO = { lat: 53.2819, lon: 15.0762 };

// piecewise depth -> drawn metres (positive down). Must match GLSL yDrawn() below.
export function yFull(d) { return d <= 20 ? d : d <= 200 ? 20 + (d - 20) * 0.2 : 56 + 14 * Math.log2(d / 200); }
export function yTrue(d) { return Math.min(d, TRUE_MAX); }
const yDraw = (d, mix) => yTrue(d) + (yFull(d) - yTrue(d)) * mix;

const GLSL_MAP = /* glsl */`
uniform float uMix;
float yFullG(float d) { return d <= 20.0 ? d : (d <= 200.0 ? 20.0 + (d - 20.0) * 0.2 : 56.0 + 14.0 * log2(d / 200.0)); }
float yDrawnG(float d) { return mix(min(d, ${TRUE_MAX.toFixed(1)}), yFullG(d), uMix); }
`;

const PATTERNS = { none: 0, soil: 1, sand: 2, gravel_sand: 3, till: 4, silt: 5, clay: 6, marl: 7, peat: 8, lignite: 9,
  glauconite: 10, mudstone: 11, evaporite: 12, till_silt: 13 };

// ---------------------------------------------------------------- block shader
const BLOCK_VS = /* glsl */`
attribute float aTop; attribute float aD; attribute float aYT; attribute float aYF; attribute float aU;
uniform float uMix;
varying float vD; varying float vY; varying float vU; varying float vShade;
void main() {
  float yd = mix(aYT, aYF, uMix);
  vD = aD; vY = yd; vU = aU;
  vec3 n = normal;
  vShade = n.y < -0.5 ? 0.55 : (abs(n.x) > 0.5 ? 0.86 : 1.0);
  vec3 p = vec3(position.x, aTop - yd, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const BLOCK_FS = /* glsl */`
precision highp float;
#define MAXL ${MAXL}
uniform int uCount;
uniform float uTop[MAXL];
uniform float uTopY[MAXL];
uniform vec3 uCol[MAXL];
uniform float uPat[MAXL];
uniform float uAqL[MAXL];
uniform float uConf[MAXL];
uniform vec4 uAq;        // main aquifer: top, base (true m), strength, -
uniform vec4 uWT;        // water table drawn y, range lo/hi drawn y, on
uniform vec3 uBreakY;    // drawn y of scale breaks
uniform vec3 uBreakA;    // their opacity
uniform float uCell, uTime, uLight, uGeneral;
varying float vD; varying float vY; varying float vU; varying float vShade;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float dotAt(vec2 p, float r) {
  vec2 c = floor(p), f = fract(p) - 0.5;
  vec2 j = vec2(h21(c), h21(c + 7.1)) - 0.5;
  return 1.0 - smoothstep(r * 0.7, r, length(f - j * 0.5));
}
float ring(vec2 p, float r, float w) {
  vec2 c = floor(p), f = fract(p) - 0.5;
  float on = step(0.72, h21(c + 3.3));
  float d = abs(length(f) - r);
  return on * (1.0 - smoothstep(w * 0.5, w, d));
}
float hline(float y, float period, float w) { float f = abs(fract(y / period) - 0.5) * period; return 1.0 - smoothstep(w * 0.6, w, f); }
float dash(float x, float period, float duty) { return step(fract(x / period), duty); }

float pattern(float t, vec2 p) {
  float ink = 0.0;
  if (t < 0.5) return 0.0;
  if (t < 1.5) { // soil: dark specks + humus
    ink = dotAt(p * 1.6, 0.16) * step(0.35, h21(floor(p * 1.6) + 1.7)) + 0.35 * dotAt(p * 3.1 + 2.0, 0.12);
  } else if (t < 2.5) { // sand
    ink = dotAt(p * 1.5, 0.11);
  } else if (t < 3.5) { // gravelly sand
    ink = dotAt(p * 1.5, 0.11) + ring(p * 0.55, 0.22, 0.07);
  } else if (t < 4.5 || (t > 12.5 && t < 13.5)) { // till (13: till + silt)
    float row = floor(p.y * 0.9);
    float x = p.x * 0.55 + 0.5 * mod(row, 2.0) + h21(vec2(row, 1.0));
    ink = hline(p.y * 0.9, 1.0, 0.07) * dash(x, 1.0, 0.42);
    ink += ring(p * 0.32 + 0.37, 0.12, 0.07) * step(0.55, h21(floor(p * 0.32 + 0.37) + 9.1));
    if (t > 12.5) ink = max(ink * step(0.0, sin(p.y * 0.35)), hline(p.y * 1.8, 1.0, 0.08) * dash(p.x * 1.4 + floor(p.y * 1.8) * 0.5, 1.0, 0.75) * step(sin(p.y * 0.35), 0.0));
  } else if (t < 5.5) { // silt
    ink = hline(p.y * 1.8, 1.0, 0.08) * dash(p.x * 1.4 + floor(p.y * 1.8) * 0.5, 1.0, 0.75);
  } else if (t < 6.5) { // clay
    ink = hline(p.y * 1.6, 1.0, 0.07);
  } else if (t < 7.5) { // marl / chalk: bricks
    float row = floor(p.y * 0.8);
    float bx = fract(p.x * 0.4 + 0.5 * mod(row, 2.0));
    ink = max(hline(p.y * 0.8, 1.0, 0.06), (1.0 - smoothstep(0.02, 0.05, min(bx, 1.0 - bx))));
  } else if (t < 8.5) { // peat: crossed hatching
    ink = max(hline(p.x + p.y, 0.9, 0.08), hline(p.x - p.y, 0.9, 0.08) * 0.6);
  } else if (t < 9.5) { // Miocene sand + lignite seams
    ink = dotAt(p * 1.4, 0.11);
    float s = sin(p.y * 0.21 + 1.3) * sin(p.y * 0.077);
    ink = max(ink, step(0.82, s) * 2.0);
  } else if (t < 10.5) { // glauconitic clay
    ink = max(hline(p.y * 1.6, 1.0, 0.07), dotAt(p * 1.2 + 0.4, 0.12) * 1.4);
  } else if (t < 11.5) { // mudstone / sandstone
    float row = floor(p.y * 1.1);
    ink = mod(row, 2.0) < 1.0 ? hline(p.y * 1.1, 1.0, 0.07) * dash(p.x * 0.9 + row * 0.37, 1.0, 0.6) : dotAt(p * vec2(1.2, 1.1), 0.1);
  } else if (t < 12.5) { // evaporite: crosses
    vec2 f = abs(fract(p * 0.7) - 0.5);
    ink = (1.0 - smoothstep(0.03, 0.06, min(f.x, f.y))) * step(max(f.x, f.y), 0.22);
  }
  return clamp(ink, 0.0, 1.0);
}

void main() {
  int li = 0;
  for (int i = 1; i < MAXL; i++) { if (i < uCount && vD >= uTop[i] - 1e-4) li = i; }
  vec3 base = uCol[li];
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(base, vec3(lum), 0.28 * (1.0 - uConf[li]));
  vec2 p = vec2(vU, vY) / uCell;
  vec2 fw = fwidth(p);
  float fade = 1.0 - smoothstep(0.22, 0.55, max(fw.x, fw.y));
  float ink = pattern(uPat[li], p) * fade;
  vec3 inkC = lum < 0.28 ? base * 1.9 + 0.12 : base * 0.42;
  vec3 col = mix(base, inkC, ink * 0.85);

  // groundwater: main aquifer band + weaker tint on other water-bearing layers
  float aq = max(uAq.z * step(uAq.x, vD) * step(vD, uAq.y), uAqL[li] * 0.45);
  if (aq > 0.0) {
    float s = fract(vU * 0.045 / max(uCell, 0.5) - uTime * 0.035 + 0.25 * sin(vY * 0.9 / max(uCell, 0.5)) + h21(vec2(floor(vY / max(uCell, 0.5) * 1.3), 2.0)));
    float streak = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.04, 0.32, s));
    col = mix(col, vec3(0.10, 0.38, 0.85), 0.5 * aq);
    col += vec3(0.30, 0.60, 0.95) * streak * 0.45 * aq;
  }

  // layer boundaries
  float fy = fwidth(vY);
  for (int i = 1; i < MAXL; i++) {
    if (i >= uCount) break;
    float d = abs(vY - uTopY[i]);
    col = mix(col, vec3(0.08, 0.07, 0.06), 0.75 * (1.0 - smoothstep(fy * 0.6, fy * 1.6, d)));
  }

  // piezometric level (solid) + range (dashed)
  if (uWT.w > 0.5) {
    float d0 = abs(vY - uWT.x);
    col = mix(col, vec3(0.20, 0.85, 1.0), 1.0 - smoothstep(fy * 1.2, fy * 2.4, d0));
    float dsh = dash(vU, 1.6 * max(uCell, 0.4), 0.55);
    float d1 = min(abs(vY - uWT.y), abs(vY - uWT.z));
    col = mix(col, vec3(0.45, 0.9, 1.0), dsh * (1.0 - smoothstep(fy * 0.7, fy * 1.6, d1)) * 0.9);
  }

  // scale-break zig-zags (double line, paper gap)
  for (int k = 0; k < 3; k++) {
    float a = uBreakA[k];
    if (a <= 0.001) continue;
    float per = 3.0 * max(uCell, 0.5), amp = 0.55 * max(uCell, 0.5);
    float tri = abs(fract(vU / per) - 0.5) * 2.0 - 0.5;
    float z = uBreakY[k] + tri * amp * 2.0;
    float d = abs(vY - z), g = 0.32 * max(uCell, 0.5);
    float paper = 1.0 - smoothstep(g - fy, g, d);
    float line = (1.0 - smoothstep(fy * 0.8, fy * 1.8, abs(d - g)));
    col = mix(col, vec3(0.94, 0.92, 0.86), paper * a);
    col = mix(col, vec3(0.1), line * a);
  }

  col *= vShade * uLight;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- helpers
const fmtNum = (v, lang) => {
  const s = (Math.round(v * 10) / 10).toString();
  return lang === 'en' ? s : s.replace('.', ',');
};
const fmtDepth = (d, lang) => (d >= 1000 ? fmtNum(d / 1000, lang) + ' km' : fmtNum(d, lang) + ' m');
const CONF = { pl: { high: 'pewność wysoka', medium: 'pewność średnia', low: 'pewność niska' },
  en: { high: 'confidence high', medium: 'confidence medium', low: 'confidence low' } };
const CONF_V = { high: 1, medium: 0.6, low: 0.25 };

function classify(text) {
  const s = (text || '').toLowerCase();
  const R = [
    [/torf|peat|mursz/, 'peat', '#4a3b2a', 'Torfy i namuły', 'Peat and mud'],
    [/less|loess/, 'silt', '#d6bf86', 'Lessy', 'Loess'],
    [/glin|till|boulder|morena|moraine/, 'till', '#a8794e', 'Gliny zwałowe', 'Glacial till'],
    [/\bił|iły|ilast|clay/, 'clay', '#8a7d6b', 'Iły', 'Clay'],
    [/mułk|mułow|silt|mad[ya]/, 'silt', '#9a8f7a', 'Mułki / mady', 'Silt / alluvial loam'],
    [/piaskow|sandstone|flisz|flysch/, 'mudstone', '#b3a184', 'Piaskowce / flisz', 'Sandstone / flysch'],
    [/wapie|limestone|margl|marl|kreda|chalk|dolomit/, 'marl', '#e3e0cf', 'Wapienie / margle', 'Limestone / marl'],
    [/granit|gnejs|łupk|schist|gneiss|krystal|crystal|bazalt|basalt/, 'evaporite', '#9b8f99', 'Skały krystaliczne', 'Crystalline rock'],
    [/żwir|zwir|gravel/, 'gravel_sand', '#cdb27a', 'Piaski i żwiry', 'Sand and gravel'],
    [/piask|sand/, 'sand', '#e0cc8f', 'Piaski', 'Sand'],
  ];
  for (const [re, pattern, color, pl, en] of R) if (re.test(s)) return { pattern, color, pl, en, rock: /mudstone|marl|evaporite/.test(pattern) && !/glin|piask|żwir/.test(s) };
  return { pattern: 'sand', color: '#d9c68e', pl: 'Osady powierzchniowe', en: 'Surface deposits', rock: false };
}

// walk any sitedata report and pull out a surface-geology string + groundwater depth/thickness (format-tolerant)
function scanSitedata(rep) {
  const out = { geology: null, gwDepth: null, aqThick: null, sources: [] };
  const num = (v) => { if (typeof v === 'number') return v; if (typeof v === 'string') { const m = v.match(/(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?/); if (m) { const a = +m[1].replace(',', '.'), b = m[2] ? +m[2].replace(',', '.') : a; return (a + b) / 2; } } return null; };
  const seen = new Set();
  const walk = (o, path, depth) => {
    if (!o || typeof o !== 'object' || depth > 5 || seen.has(o)) return;
    seen.add(o);
    for (const k of Object.keys(o)) {
      const v = o[k], p = (path + '.' + k).toLowerCase();
      const val = v && typeof v === 'object' && 'value' in v ? v.value : v;
      if (v && typeof v === 'object' && v.source && /geolog|hydro|gupw|water|wod/.test(p)) out.sources.push(v.source);
      if (!out.geology && typeof val === 'string' && /geolog|lithol|litolog|smgp/.test(p) && !/source|url|error|unit$/.test(p) && val.length > 2) out.geology = val;
      if (out.gwDepth == null && /(gupw|groundwater|hydro|water|wod|zwierc)/.test(p) && /(depth|głęb|gleb|level|zwierc)/.test(p) && !/source|unit|url/.test(p)) { const n = num(val); if (n != null && n > 0 && n < 300) out.gwDepth = n; }
      if (out.aqThick == null && /(thick|miąższ|miazsz)/.test(p) && !/source|unit|url/.test(p)) { const n = num(val); if (n != null && n > 0 && n < 300) out.aqThick = n; }
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path + '.' + k, depth + 1);
    }
  };
  walk(rep, '', 0);
  return out;
}

function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r);
  return R * Math.hypot(dLat, dLon);
}

// ---------------------------------------------------------------- module
export function init(ctx) {
  const { THREE, scene } = ctx;
  const group = new THREE.Group(); group.name = 'Underground'; group.visible = false;
  scene.add(group);

  let manualVisible = false, visible = false, lang = 'pl', labelsOn = true;
  let mix = 1, mixTarget = 1, time = 0, rainF = 0;
  let profile = null, profileKind = 'none', witkowoJSON = null, siteRef = null, sitedataSig = '', errors = [];
  let maxDepth = 4500, siteName = 'Witkowo';
  const terrainH = (x, z) => { const t = ctx.terrain; if (!t || !t.heightAt) return 0; const h = t.heightAt(x, z); return Number.isFinite(h) ? h : 0; };
  let terrainSig = '';

  // ---------- block material
  const U = {
    uCount: { value: 0 }, uTop: { value: new Float32Array(MAXL) }, uTopY: { value: new Float32Array(MAXL) },
    uCol: { value: Array.from({ length: MAXL }, () => new THREE.Color()) }, uPat: { value: new Float32Array(MAXL) },
    uAqL: { value: new Float32Array(MAXL) }, uConf: { value: new Float32Array(MAXL).fill(1) },
    uAq: { value: new THREE.Vector4(10, 30, 1, 0) }, uWT: { value: new THREE.Vector4(6, 1.2, 14.5, 1) },
    uBreakY: { value: new THREE.Vector3(20, 56, 100) }, uBreakA: { value: new THREE.Vector3(1, 1, 0) },
    uCell: { value: 1 }, uTime: { value: 0 }, uLight: { value: 1 }, uGeneral: { value: 0 }, uMix: { value: 1 },
  };
  const blockMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: BLOCK_VS, fragmentShader: BLOCK_FS,
    depthFunc: THREE.AlwaysDepth, depthWrite: true, side: THREE.FrontSide });
  const block = new THREE.Mesh(new THREE.BufferGeometry(), blockMat);
  block.name = 'Underground / block'; block.renderOrder = -0.5; block.frustumCulled = false;
  block.castShadow = false; block.receiveShadow = false;
  group.add(block);

  // ---------- rain infiltration points
  const NP = 1400;
  const rainGeo = new THREE.BufferGeometry();
  { const pos = new Float32Array(NP * 3), top = new Float32Array(NP), r = new Float32Array(NP * 3);
    rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainGeo.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    rainGeo.setAttribute('aR', new THREE.BufferAttribute(r, 3));
    const P = 2 * (FOOT.x1 - FOOT.x0 + FOOT.z1 - FOOT.z0);
    for (let i = 0; i < NP; i++) {
      const s = Math.random() * P; const [x, z, nx, nz] = perimPoint(s);
      pos.set([x + nx * 0.12, 0, z + nz * 0.12], i * 3);
      r.set([Math.random(), 0.6 + Math.random() * 0.8, Math.random()], i * 3);
    } }
  const RU = { uMix: U.uMix, uTime: { value: 0 }, uRain: { value: 0 }, uInf: { value: 10 }, uPx: { value: 1 } };
  const rainMat = new THREE.ShaderMaterial({ uniforms: RU, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aTop; attribute vec3 aR;
      uniform float uTime, uRain, uInf, uPx;
      varying float vA;
      ${GLSL_MAP}
      void main() {
        float f = fract(aR.x + uTime * 0.018 * aR.y);
        float d = uInf * pow(f, 1.8);
        vA = (aR.z < uRain ? 1.0 : 0.0) * smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(0.75, 1.0, f));
        vec4 mv = modelViewMatrix * vec4(position.x, aTop - yDrawnG(d), position.z, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(160.0 / -mv.z, 1.5, 6.0) * uPx * (vA > 0.0 ? 1.0 : 0.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r = length(c);
        if (r > 0.5 || vA <= 0.0) discard;
        gl_FragColor = vec4(0.25, 0.62, 1.0, vA * (1.0 - smoothstep(0.25, 0.5, r)));
        #include <colorspace_fragment>
      }` });
  const rainPts = new THREE.Points(rainGeo, rainMat);
  rainPts.name = 'Underground / infiltration'; rainPts.frustumCulled = false; rainPts.renderOrder = 2; rainPts.visible = false;
  group.add(rainPts);

  // ---------- hypothetical well (x-ray, dashed)
  const wellGeo = new THREE.CylinderGeometry(0.32, 0.32, 1, 12, WELL.depth + 1, false);
  { const p = wellGeo.attributes.position, n = p.count, aD = new Float32Array(n), aTop = new Float32Array(n);
    for (let i = 0; i < n; i++) { aD[i] = -1 + (0.5 - p.getY(i)) * (WELL.depth + 1); p.setX(i, p.getX(i) + WELL.x); p.setZ(i, p.getZ(i) + WELL.z); }
    wellGeo.setAttribute('aD', new THREE.BufferAttribute(aD, 1));
    wellGeo.setAttribute('aTop', new THREE.BufferAttribute(aTop, 1)); }
  const WU = { uMix: U.uMix, uWTd: { value: 6 }, uScr: { value: new THREE.Vector2(...WELL.screen) }, uTime: U.uTime };
  const wellMat = new THREE.ShaderMaterial({ uniforms: WU, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aD; attribute float aTop;
      varying float vD; varying float vS;
      ${GLSL_MAP}
      void main() {
        vD = aD;
        float y = aD < 0.0 ? aTop - aD : aTop - yDrawnG(aD);
        vS = 0.6 + 0.4 * normalize(normalMatrix * normal).x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, y, position.z, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uWTd; uniform vec2 uScr;
      varying float vD; varying float vS;
      void main() {
        bool scr = vD >= uScr.x && vD <= uScr.y;
        if (vD > 0.0 && !scr && fract(vD / 1.6) > 0.62) discard;
        vec3 c = vD < 0.0 ? vec3(0.85, 0.87, 0.9) : (vD < uWTd ? vec3(0.92, 0.9, 0.86) : vec3(0.35, 0.7, 1.0));
        if (scr) c = mix(vec3(0.15, 0.4, 0.9), vec3(0.85, 0.95, 1.0), step(0.5, fract(vD * 3.0)));
        gl_FragColor = vec4(c * vS, 0.95);
        #include <colorspace_fragment>
      }` });
  const well = new THREE.Mesh(wellGeo, wellMat);
  well.name = 'Underground / hypothetical well'; well.frustumCulled = false; well.renderOrder = 8;
  group.add(well);

  // ---------- labels (canvas sprites) + ruler + leaders
  const labelG = new THREE.Group(); labelG.name = 'Underground / labels'; group.add(labelG);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xd9ad57, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
  const rulerMat = new THREE.LineBasicMaterial({ color: 0xf2efe6, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const leaderGeo = new THREE.BufferGeometry(); leaderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXL * 4 * 3 + 12), 3));
  const rulerGeo = new THREE.BufferGeometry(); rulerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((TICKS.length + 1) * 2 * 3 + 6), 3));
  const leaders = new THREE.LineSegments(leaderGeo, lineMat); leaders.renderOrder = 19; leaders.frustumCulled = false;
  const ruler = new THREE.LineSegments(rulerGeo, rulerMat); ruler.renderOrder = 19; ruler.frustumCulled = false;
  labelG.add(leaders, ruler);
  let sprites = { layers: [], ticks: [], wt: null, breaks: [], well: null, title: null };
  let layoutKey = '', edge = null;

  function makeLabel(lines, opt = {}) {
    const fs = 30, pad = 12, lh = fs * 1.25, sw = opt.swatch ? fs * 0.9 + 10 : 0;
    const cv = document.createElement('canvas'), g = cv.getContext('2d');
    const fonts = lines.map((l, i) => `${i === 0 ? 600 : 400} ${i === 0 ? fs : fs * 0.78}px system-ui, -apple-system, "Segoe UI", sans-serif`);
    let w = 0; lines.forEach((l, i) => { g.font = fonts[i]; w = Math.max(w, g.measureText(l).width); });
    cv.width = Math.ceil(w + pad * 2 + sw); cv.height = Math.ceil(lines.length * lh + pad * 1.4 - (lines.length > 1 ? fs * 0.2 : 0));
    if (!opt.bare) {
      g.fillStyle = opt.bg || 'rgba(17,19,23,0.86)';
      const r = 10; g.beginPath(); g.roundRect ? g.roundRect(0, 0, cv.width, cv.height, r) : g.rect(0, 0, cv.width, cv.height); g.fill();
      if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = 3; g.stroke(); }
    }
    if (opt.swatch) { g.fillStyle = opt.swatch; g.fillRect(pad, pad * 0.7 + 4, fs * 0.9, fs * 0.9); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.strokeRect(pad, pad * 0.7 + 4, fs * 0.9, fs * 0.9); }
    lines.forEach((l, i) => {
      g.font = fonts[i]; g.textBaseline = 'top';
      g.fillStyle = i === 0 ? (opt.color || '#f3efe6') : (opt.color2 || '#b9b4a8');
      if (opt.bare) { g.lineWidth = 6; g.strokeStyle = 'rgba(10,12,14,.85)'; g.strokeText(l, pad + sw, pad * 0.7 + i * lh); }
      g.fillText(l, pad + sw, pad * 0.7 + i * lh);
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    const s = new THREE.Sprite(m); s.renderOrder = 20; s.userData.aspect = cv.width / cv.height; s.userData.lines = lines.length;
    labelG.add(s);
    return s;
  }
  function disposeSprite(s) { if (!s) return; s.material.map.dispose(); s.material.dispose(); labelG.remove(s); }
  function clearLabels() {
    sprites.layers.forEach(disposeSprite); sprites.ticks.forEach(disposeSprite); sprites.breaks.forEach(disposeSprite);
    disposeSprite(sprites.wt); disposeSprite(sprites.well); disposeSprite(sprites.title);
    sprites = { layers: [], ticks: [], wt: null, breaks: [], well: null, title: null };
  }

  function buildLabels() {
    clearLabels();
    if (!profile) return;
    const L = lang === 'en' ? 'en' : 'pl';
    profile.layers.forEach((ly) => {
      const name = L === 'en' ? (ly.short_en || ly.name_en) : (ly.short_pl || ly.name_pl);
      const age = L === 'en' ? ly.age : (ly.age_pl || ly.age);
      const l2 = `${age} · ${CONF[L][ly.confidence] || ''}`;
      const lines = [`${fmtDepth(ly.top_m, L)} – ${fmtDepth(ly.base_m, L)}   ${name}`, l2];
      if (ly.aquifer) lines.push(ly.main_aquifer ? (L === 'en' ? 'main aquifer (confined)' : 'główny poziom wodonośny (napięty)') : (L === 'en' ? 'water-bearing' : 'warstwa wodonośna'));
      sprites.layers.push(makeLabel(lines, { swatch: ly.color, border: ly.main_aquifer ? 'rgba(80,170,255,.9)' : null }));
    });
    TICKS.forEach((d) => sprites.ticks.push(makeLabel([fmtDepth(d, L)], { bare: true, color: '#f3efe6' })));
    if (profile.water && profile.water.wt != null) {
      const w = profile.water;
      const rng = w.range ? (L === 'en' ? `; range ${fmtNum(w.range[0], L)}–${fmtNum(w.range[1], L)} m` : `; zakres ${fmtNum(w.range[0], L)}–${fmtNum(w.range[1], L)} m`) : '';
      sprites.wt = makeLabel([
        (L === 'en' ? `▽ groundwater level ~${fmtNum(w.wt, L)} m bgl` : `▽ zwierciadło wody ~${fmtNum(w.wt, L)} m p.p.t.`),
        (w.confined ? (L === 'en' ? 'piezometric (confined)' : 'piezometryczne (napięte)') : (L === 'en' ? 'generalised' : 'uogólnione')) + rng,
      ], { color: '#7fdcff', border: 'rgba(80,200,255,.8)' });
    }
    sprites.breaks = [
      makeLabel([L === 'en' ? 'scale break: x0.2 below 20 m' : 'przerwa skali: x0,2 poniżej 20 m'], { color: '#f3efe6' }),
      makeLabel([L === 'en' ? 'log scale below 200 m' : 'skala logarytmiczna poniżej 200 m'], { color: '#f3efe6' }),
      makeLabel([L === 'en' ? `true scale to 100 m; column continues to ${fmtDepth(maxDepth, L)}` : `skala 1:1 do 100 m; dalej do ${fmtDepth(maxDepth, L)}`], { color: '#f3efe6' }),
    ];
    if (profile.well) sprites.well = makeLabel([L === 'en' ? 'hypothetical well' : 'hipotetyczna studnia',
      L === 'en' ? `~${WELL.depth} m, screen ${WELL.screen[0]}–${WELL.screen[1]} m` : `~${WELL.depth} m, filtr ${WELL.screen[0]}–${WELL.screen[1]} m`], { color: '#9fd8ff' });
    const gen = profileKind !== 'witkowo';
    sprites.title = makeLabel([
      gen ? (L === 'en' ? `GENERALISED profile – ${siteName}` : `Profil UOGÓLNIONY – ${siteName}`) : (L === 'en' ? 'Geological cross-section – Witkowo' : 'Przekrój geologiczny – Witkowo'),
      gen ? (L === 'en' ? 'low confidence: surface geology at the point, deeper layers assumed' : 'niska pewność: geologia powierzchni w punkcie, głębsze warstwy przyjęte')
        : (L === 'en' ? 'PIG-PIB: SMGP 268 Dolice, CBDG boreholes, MHP' : 'Dane: PIG-PIB (SMGP 268 Dolice, CBDG, MHP)'),
    ], { color: gen ? '#ffb86b' : '#d9ad57', border: gen ? 'rgba(255,170,90,.8)' : 'rgba(217,173,87,.7)' });
    layoutKey = '';
  }

  // edge = { cx, cz, away:[ax,az] (unit, along the face, pointing away from the block), other:{...} }
  function edgesFor(cam) {
    const sx = Math.sign(cam.x - CX) || 1, sz = Math.sign(cam.z - CZ) || 1;
    const hx = (FOOT.x1 - FOOT.x0) / 2, hz = (FOOT.z1 - FOOT.z0) / 2;
    const a = { x: CX - sx * hx, z: CZ + sz * hz, ax: -sx, az: 0 };   // far end of the camera-facing z-face
    const b = { x: CX + sx * hx, z: CZ - sz * hz, ax: 0, az: -sz };   // far end of the camera-facing x-face
    return [a, b];
  }
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();

  function layout(cam, H) {
    if (!profile) return;
    const [a, b] = edgesFor(cam);
    _v.set(a.x, 0, a.z).project(cam); _w.set(b.x, 0, b.z).project(cam);
    const L = _v.x <= _w.x ? a : b, R = L === a ? b : a;   // ruler + wall tags on the screen-left edge, layer labels right
    edge = { L, R };
    const topL = terrainH(L.x, L.z), topR = terrainH(R.x, R.z);
    const at = (e, off, y) => [e.x + e.ax * off, y, e.z + e.az * off];
    const lp = leaderGeo.attributes.position.array; let li = 0;
    const rp = rulerGeo.attributes.position.array; let ri = 0;
    const push = (arr, i, p) => { arr[i] = p[0]; arr[i + 1] = p[1]; arr[i + 2] = p[2]; return i + 3; };
    const yBot = topL - yDraw(maxDepth, mix);
    // ruler
    ri = push(rp, ri, at(L, 0.15, topL)); ri = push(rp, ri, at(L, 0.15, yBot));
    let lastTickY = Infinity;
    TICKS.forEach((d, i) => {
      const s = sprites.ticks[i]; if (!s) return;
      const show = d <= maxDepth + 1e-6 && (d <= TRUE_MAX || mix > 0.5);
      const y = topL - yDraw(Math.min(d, maxDepth), mix);
      const roomy = lastTickY - y > 0.62 * H;          // drop a tick label that would overlap the one above
      if (show && roomy) lastTickY = y;
      ri = push(rp, ri, at(L, 0.15, y)); ri = push(rp, ri, at(L, 0.15 + (show ? 0.45 * H : 0), y));
      s.visible = show && roomy && labelsOn; s.center.set(1, 0.5);
      s.position.set(...at(L, 0.75 * H, y)); s.scale.set(H * 0.62 * s.userData.aspect, H * 0.62, 1);
    });
    for (; ri < rp.length; ri++) rp[ri] = 0;
    rulerGeo.attributes.position.needsUpdate = true;
    // layer labels on the screen-right edge, extending away (right); pushed down to avoid overlaps
    const col = 2.2 * H; let prev = topR + H * 0.2;
    profile.layers.forEach((ly, i) => {
      const s = sprites.layers[i]; if (!s) return;
      const yt = topR - yDraw(ly.top_m, mix), yb = topR - yDraw(Math.min(ly.base_m, maxDepth), mix);
      const hS = H * (0.5 + 0.42 * s.userData.lines) * 0.62;
      const collapsed = yt - yb < 0.05;
      let y = (yt + yb) / 2;
      if (y > prev - hS / 2 - 0.12 * H) y = prev - hS / 2 - 0.12 * H;
      s.visible = labelsOn; s.material.opacity = collapsed ? 0.45 : 1;
      s.center.set(0, 0.5); s.position.set(...at(R, col, y)); s.scale.set(hS * s.userData.aspect, hS, 1);
      prev = y - hS / 2;
      const ym = (yt + yb) / 2;
      li = push(lp, li, at(R, col - 0.1 * H, y)); li = push(lp, li, at(R, 0.9 * H, ym));
      li = push(lp, li, at(R, 0.9 * H, ym)); li = push(lp, li, at(R, 0.1, ym));
      ly._anchor = [R.x, ym, R.z]; ly._label = s.position.toArray();
    });
    // well leader
    if (profile.well && sprites.well) {
      const top = terrainH(WELL.x, WELL.z);
      sprites.well.center.set(0.5, 0); sprites.well.position.set(WELL.x, top + 1.6 + H * 0.3, WELL.z);
      const hS = H * 0.75; sprites.well.scale.set(hS * sprites.well.userData.aspect, hS, 1); sprites.well.visible = labelsOn;
      li = push(lp, li, [WELL.x, top + 0.1, WELL.z]); li = push(lp, li, [WELL.x, top + 1.6 + H * 0.3, WELL.z]);
    } else if (sprites.well) sprites.well.visible = false;
    for (; li < lp.length; li++) lp[li] = 0;
    leaderGeo.attributes.position.needsUpdate = true;
    // water table + scale-break tags sit ON the left wall, just inside the left edge, above their line
    if (sprites.wt) {
      const y = topL - yDraw(profile.water.wt, mix), hS = H * 0.8;
      sprites.wt.center.set(0, -0.15); sprites.wt.position.set(...at(L, -1.2, y)); sprites.wt.scale.set(hS * sprites.wt.userData.aspect, hS, 1);
      sprites.wt.visible = labelsOn;
    }
    const bk = [[20, mix * (maxDepth > 20 ? 1 : 0)], [200, mix * (maxDepth > 200 ? 1 : 0)], [TRUE_MAX, (1 - mix) * (maxDepth > TRUE_MAX ? 1 : 0)]];
    bk.forEach(([d, a], k) => {
      const s = sprites.breaks[k]; if (!s) return;
      const y = topL - yDraw(d, mix), hS = H * 0.6;
      s.center.set(0, k === 2 ? 1.6 : -0.9); s.position.set(...at(L, -1.2, y)); s.scale.set(hS * s.userData.aspect, hS, 1);
      s.visible = labelsOn && a > 0.5; s.material.opacity = Math.min(1, a * 1.5);
    });
    if (sprites.title) {
      const hS = H * 0.95; sprites.title.center.set(0, 0);
      sprites.title.position.set(...at(R, 0.3 * H, Math.max(topR, 0) + H * 1.2)); sprites.title.scale.set(hS * sprites.title.userData.aspect, hS, 1);
      sprites.title.visible = labelsOn;
    }
  }

  function perimPoint(s) {
    const W = FOOT.x1 - FOOT.x0, D = FOOT.z1 - FOOT.z0;
    if (s < W) return [FOOT.x0 + s, FOOT.z1, 0, 1];
    s -= W; if (s < D) return [FOOT.x1, FOOT.z1 - s, 1, 0];
    s -= D; if (s < W) return [FOOT.x1 - s, FOOT.z0, 0, -1];
    s -= W; return [FOOT.x0, FOOT.z0 + Math.min(s, D), -1, 0];
  }

  // ---------- geometry
  function depthSamples() {
    const S = new Set([0, 20, TRUE_MAX, 200, maxDepth]);
    profile.layers.forEach((l) => { S.add(l.top_m); S.add(Math.min(l.base_m, maxDepth)); });
    if (profile.water) { if (profile.water.aqTop != null) S.add(profile.water.aqTop); if (profile.water.aqBase != null) S.add(profile.water.aqBase); }
    for (let i = 1; i < 48 && maxDepth > 200; i++) S.add(200 * Math.pow(maxDepth / 200, i / 48));
    return [...S].filter((d) => d >= 0 && d <= maxDepth).sort((a, b) => a - b);
  }
  function buildBlock() {
    const ds = depthSamples();
    const walls = [[FOOT.x0, FOOT.z1, FOOT.x1, FOOT.z1, 0, 0, 1], [FOOT.x1, FOOT.z1, FOOT.x1, FOOT.z0, 1, 0, 0],
      [FOOT.x1, FOOT.z0, FOOT.x0, FOOT.z0, 0, 0, -1], [FOOT.x0, FOOT.z0, FOOT.x0, FOOT.z1, -1, 0, 0]];
    const pos = [], nor = [], aTop = [], aD = [], aYT = [], aYF = [], aU = [], idx = [];
    let u0 = 0;
    for (const [xa, za, xb, zb, nx, ny, nz] of walls) {
      const len = Math.hypot(xb - xa, zb - za), nH = Math.ceil(len / 2);
      const base = pos.length / 3;
      for (let i = 0; i <= nH; i++) {
        const t = i / nH, x = xa + (xb - xa) * t, z = za + (zb - za) * t, top = terrainH(x, z);
        for (const d of ds) { pos.push(x, 0, z); nor.push(nx, ny, nz); aTop.push(top); aD.push(d); aYT.push(yTrue(d)); aYF.push(yFull(d)); aU.push(u0 + t * len); }
      }
      const nD = ds.length;
      for (let i = 0; i < nH; i++) for (let j = 0; j < nD - 1; j++) {
        const a = base + i * nD + j, b = a + 1, c = a + nD, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      u0 += len;
    }
    // bottom (normal down): corners A(x0,z1) B(x1,z1) C(x1,z0) D(x0,z0)
    const bb = pos.length / 3, md = maxDepth;
    [[FOOT.x0, FOOT.z1], [FOOT.x1, FOOT.z1], [FOOT.x1, FOOT.z0], [FOOT.x0, FOOT.z0]].forEach(([x, z]) => {
      pos.push(x, 0, z); nor.push(0, -1, 0); aTop.push(terrainH(x, z)); aD.push(md - 1e-3); aYT.push(yTrue(md)); aYF.push(yFull(md)); aU.push(x + z);
    });
    idx.push(bb, bb + 3, bb + 1, bb + 1, bb + 3, bb + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(aTop, 1));
    g.setAttribute('aD', new THREE.Float32BufferAttribute(aD, 1));
    g.setAttribute('aYT', new THREE.Float32BufferAttribute(aYT, 1));
    g.setAttribute('aYF', new THREE.Float32BufferAttribute(aYF, 1));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(aU, 1));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    block.geometry.dispose(); block.geometry = g;
  }
  function refreshTops() {
    const g = block.geometry, p = g.attributes.position, t = g.attributes.aTop;
    if (p) { for (let i = 0; i < p.count; i++) t.array[i] = terrainH(p.getX(i), p.getZ(i)); t.needsUpdate = true; }
    const rp = rainGeo.attributes.position, rt = rainGeo.attributes.aTop;
    for (let i = 0; i < NP; i++) rt.array[i] = terrainH(rp.getX(i), rp.getZ(i));
    rt.needsUpdate = true;
    const wt = wellGeo.attributes.aTop.array.fill(terrainH(WELL.x, WELL.z)); wellGeo.attributes.aTop.needsUpdate = true; void wt;
    layoutKey = '';
  }
  function terrainSignature() {
    const t = ctx.terrain; if (!t) return 'flat';
    try { const i = t.info ? t.info() : {}; return `${i.padLevelM}|${i.elevationM}|${i.source}|${terrainH(FOOT.x0, FOOT.z1).toFixed(2)}|${terrainH(FOOT.x1, FOOT.z0).toFixed(2)}`; }
    catch (e) { return 'err'; }
  }

  function applyProfile() {
    const ls = profile.layers.slice(0, MAXL);
    U.uCount.value = ls.length;
    ls.forEach((l, i) => {
      U.uTop.value[i] = l.top_m; U.uCol.value[i].set(l.color); U.uPat.value[i] = PATTERNS[l.pattern] ?? 2;
      U.uAqL.value[i] = l.aquifer && !l.main_aquifer ? 1 : 0; U.uConf.value[i] = CONF_V[l.confidence] ?? 0.5;
    });
    const w = profile.water || {};
    if (w.aqTop != null) U.uAq.value.set(w.aqTop, w.aqBase, 1, 0); else U.uAq.value.set(0, 0, 0, 0);
    U.uWT.value.set(w.wt ?? 0, w.range ? w.range[0] : -1e3, w.range ? w.range[1] : -1e3, w.wt != null ? 1 : 0);
    WU.uWTd.value = w.wt ?? 6;
    RU.uInf.value = Math.min(w.aqTop ?? 10, 12);
    U.uGeneral.value = profileKind === 'witkowo' ? 0 : 1;
    well.visible = !!profile.well;
    buildBlock(); refreshTops(); buildLabels();
    terrainSig = terrainSignature();
  }

  // ---------- profiles
  function witkowoProfile(j) {
    const layers = j.layers.map((l) => ({ ...l, main_aquifer: l.id === 'fg_sand_upper' }));
    const gw = j.groundwater || {};
    return { kind: 'witkowo', layers, maxDepth: layers[layers.length - 1].base_m,
      water: { wt: gw.piezometric_level_m?.model ?? 6, range: gw.piezometric_level_m?.range ?? [1.2, 14.5], confined: true,
        aqTop: gw.aquifer_top_m ?? 10, aqBase: gw.aquifer_base_m ?? 30, note: gw.main_aquifer },
      well: true, sources: j.sources || [], attribution: j.attribution };
  }
  function genericProfile(rep) {
    const sc = scanSitedata(rep || {});
    const c = classify(sc.geology);
    const qBase = c.rock ? 1.5 : 60;
    const layers = [
      { id: 'soil', top_m: 0, base_m: 0.3, name_pl: 'Gleba', name_en: 'Topsoil', short_pl: 'Gleba', short_en: 'Topsoil', age: 'Holocene', age_pl: 'holocen', color: '#5b4632', pattern: 'soil', confidence: 'medium' },
    ];
    if (c.rock) {
      layers.push({ id: 'regolith', top_m: 0.3, base_m: qBase, short_pl: 'Zwietrzelina', short_en: 'Weathered rock', name_pl: 'Zwietrzelina', name_en: 'Weathered rock', age: 'Quaternary', age_pl: 'czwartorzęd', color: '#a99474', pattern: 'gravel_sand', confidence: 'low' });
      layers.push({ id: 'bedrock', top_m: qBase, base_m: 300, short_pl: c.pl + ' (podłoże)', short_en: c.en + ' (bedrock)', name_pl: c.pl, name_en: c.en, age: 'pre-Quaternary, age unknown', age_pl: 'podczwartorzędowe, wiek nieznany', color: c.color, pattern: c.pattern, confidence: 'low' });
    } else {
      const surfBase = 8;
      layers.push({ id: 'surface', top_m: 0.3, base_m: surfBase, short_pl: c.pl + (sc.geology ? '' : ' (?)'), short_en: c.en + (sc.geology ? '' : ' (?)'), name_pl: sc.geology || c.pl, name_en: c.en, age: 'Quaternary (surface map)', age_pl: 'czwartorzęd (mapa powierzchni)', color: c.color, pattern: c.pattern, confidence: sc.geology ? 'medium' : 'low' });
      layers.push({ id: 'quaternary', top_m: surfBase, base_m: qBase, short_pl: 'Czwartorzęd nierozdzielony', short_en: 'Undivided Quaternary', name_pl: 'Gliny, piaski i żwiry czwartorzędu (miąższość nieznana)', name_en: 'Quaternary tills, sands and gravels (thickness unknown)', age: 'Quaternary, thickness unknown', age_pl: 'czwartorzęd, miąższość nieznana', color: '#b49a72', pattern: 'till_silt', confidence: 'low' });
      layers.push({ id: 'bedrock', top_m: qBase, base_m: 300, short_pl: 'Podłoże podczwartorzędowe', short_en: 'Pre-Quaternary bedrock', name_pl: 'Utwory podczwartorzędowe (nieznane)', name_en: 'Pre-Quaternary bedrock (unknown)', age: 'Neogene or older, unknown', age_pl: 'neogen lub starsze, nieznane', color: '#857f77', pattern: 'mudstone', confidence: 'low' });
    }
    let water = null;
    if (sc.gwDepth != null) {
      const th = sc.aqThick ?? 10;
      water = { wt: sc.gwDepth, range: null, confined: false, aqTop: sc.gwDepth, aqBase: Math.min(sc.gwDepth + th, 295) };
    }
    return { kind: 'generalised', layers, maxDepth: 300, water, well: false, sources: sc.sources, scan: sc };
  }

  async function loadWitkowo() {
    if (witkowoJSON) return witkowoJSON;
    const r = await fetch(PROFILE_URL); if (!r.ok) throw new Error(`profile ${r.status}`);
    witkowoJSON = await r.json(); return witkowoJSON;
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(res, ms))]);

  let seq = 0;
  async function setSite(site) {
    const my = ++seq; errors = [];
    siteRef = site || null; siteName = site?.name || (site ? `${(+site.lat).toFixed(3)}, ${(+site.lon).toFixed(3)}` : 'Witkowo');
    const isWitkowo = !site || distKm(site, WITKOWO) < 4;
    if (ctx.terrain?.ready) await withTimeout(Promise.resolve(ctx.terrain.ready).catch(() => {}), 20000);
    if (my !== seq) return info();
    if (isWitkowo) {
      try { const j = await loadWitkowo(); if (my !== seq) return info(); profile = witkowoProfile(j); profileKind = 'witkowo'; siteName = 'Witkowo'; }
      catch (e) { errors.push(`profile_witkowo.json: ${e.message}`); profile = genericProfile(null); profileKind = 'generalised'; }
    } else {
      if (ctx.sitedata?.ready) await withTimeout(Promise.resolve(ctx.sitedata.ready).catch(() => {}), 15000);
      if (my !== seq) return info();
      let rep = null;
      try { rep = ctx.sitedata?.info ? ctx.sitedata.info() : null; } catch (e) { errors.push(`sitedata.info: ${e.message}`); }
      if (!ctx.sitedata) errors.push('sitedata module not available: surface geology unknown');
      profile = genericProfile(rep); profileKind = 'generalised';
      sitedataSig = JSON.stringify(profile.scan);
    }
    maxDepth = profile.maxDepth;
    applyProfile();
    return info();
  }

  // ---------- public
  function setDepthScale(v) {
    if (v === 'true' || v === 'shallow' || v === true || v === 0 || v === 'real') mixTarget = 0;
    else if (v === 'full' || v === 1 || v === false) mixTarget = 1;
    else if (typeof v === 'number') mixTarget = Math.min(1, Math.max(0, v));
  }
  function setVisible(b) { manualVisible = !!b; }
  function setLang(l) { if (l && l !== lang) { lang = l; buildLabels(); } }

  let sdTimer = 0, tTimer = 0;
  const camPos = new THREE.Vector3();
  function update(dt, state = {}) {
    const vis = state.show && typeof state.show.underground === 'boolean' ? state.show.underground : manualVisible;
    if (vis !== visible) { visible = vis; group.visible = vis; layoutKey = ''; }
    if (state.undergroundScale) setDepthScale(state.undergroundScale);
    if (!visible || !profile) return;
    dt = Math.min(dt || 0, 0.1);
    time += dt; U.uTime.value = time; RU.uTime.value = time;
    const l = (state.lang || (typeof document !== 'undefined' && document.documentElement.lang) || 'pl').slice(0, 2);
    if (l !== lang) setLang(l);
    if (mix !== mixTarget) { const s = Math.sign(mixTarget - mix); mix += s * dt * 1.2; if ((mixTarget - mix) * s <= 0) mix = mixTarget; layoutKey = ''; }
    U.uMix.value = mix;
    const ys = [20, 200, TRUE_MAX].map((d) => yDraw(d, mix));
    U.uBreakY.value.set(ys[0], ys[1], ys[2] - 0.6);
    U.uBreakA.value.set(maxDepth > 20 ? mix : 0, maxDepth > 200 ? mix : 0, maxDepth > TRUE_MAX ? 1 - mix : 0);
    for (let i = 0; i < U.uCount.value; i++) U.uTopY.value[i] = yDraw(U.uTop.value[i], mix);
    U.uLight.value = 0.82 + 0.18 * (state.sun ?? 1);
    // rain infiltration
    const want = Math.min(1, Math.max(0, (state.rainMmH || 0) / 4));
    rainF += (want - rainF) * Math.min(1, dt * 0.8);
    RU.uRain.value = rainF; rainPts.visible = rainF > 0.01;
    RU.uPx.value = ctx.renderer ? ctx.renderer.getPixelRatio() : 1;
    // camera-dependent pattern cell + label size + label edge
    const cam = ctx.getCamera ? ctx.getCamera() : null;
    if (cam) {
      cam.getWorldPosition(camPos);
      const dist = camPos.distanceTo(_v.set(CX, -yDraw(Math.min(maxDepth, 40), mix) * 0.5, CZ));
      U.uCell.value = Math.min(5, Math.max(0.3, dist / 90));
      const H = Math.min(14, Math.max(0.9, dist * 0.034));
      const [a, b] = edgesFor(camPos);
      const key = `${a.x},${a.z}|${(Math.log(H) * 12) | 0}|${mix.toFixed(3)}|${lang}|${labelsOn}`;
      if (key !== layoutKey) { layoutKey = key; cam.updateMatrixWorld(); layout(cam, H); }
    }
    // terrain / sitedata changes after the build
    tTimer += dt; sdTimer += dt;
    if (tTimer > 1) { tTimer = 0; const s = terrainSignature(); if (s !== terrainSig) { terrainSig = s; refreshTops(); } }
    if (profileKind !== 'witkowo' && ctx.sitedata?.info && sdTimer > 2) {
      sdTimer = 0;
      try { const p = genericProfile(ctx.sitedata.info()); const sig = JSON.stringify(p.scan); if (sig !== sitedataSig) { sitedataSig = sig; profile = p; maxDepth = p.maxDepth; applyProfile(); } } catch (e) { /* keep */ }
    }
  }

  function info() {
    const L = lang === 'en' ? 'en' : 'pl';
    const top0 = terrainH(FOOT.x0, FOOT.z1);
    return {
      visible, site: siteName, profile: profileKind,
      confidence: profileKind === 'witkowo' ? 'high (0-10 m), medium (10-140 m), low (deeper)' : 'low (generalised)',
      depthScale: mix > 0.5 ? 'full' : 'true', depthScaleMix: +mix.toFixed(3), maxDepthM: maxDepth,
      footprint: { ...FOOT }, drawnBottomY: +(top0 - yDraw(maxDepth, mix)).toFixed(2),
      layers: profile ? profile.layers.map((l) => ({ id: l.id, topM: l.top_m, baseM: l.base_m, namePl: l.name_pl, nameEn: l.name_en,
        agePl: l.age_pl || l.age, ageEn: l.age, confidence: l.confidence, aquifer: !!l.aquifer, color: l.color, pattern: l.pattern,
        yTop: +(top0 - yDraw(l.top_m, mix)).toFixed(2), yBase: +(top0 - yDraw(Math.min(l.base_m, maxDepth), mix)).toFixed(2),
        anchor: l._anchor || null, labelAt: l._label || null })) : [],
      water: profile?.water ? { tableM: profile.water.wt, rangeM: profile.water.range, confined: profile.water.confined,
        aquiferM: [profile.water.aqTop, profile.water.aqBase], y: +(top0 - yDraw(profile.water.wt, mix)).toFixed(2) } : null,
      well: profile?.well ? { x: WELL.x, z: WELL.z, depthM: WELL.depth, screenM: WELL.screen, hypothetical: true,
        label: L === 'en' ? 'hypothetical well' : 'hipotetyczna studnia' } : null,
      ruler: TICKS.filter((d) => d <= maxDepth).map((d) => ({ depthM: d, label: fmtDepth(d, L), y: +(top0 - yDraw(d, mix)).toFixed(2) })),
      labelEdge: edge ? { left: [edge.L.x, edge.L.z], right: [edge.R.x, edge.R.z] } : null,
      infiltration: +rainF.toFixed(2),
      camera: { allowBelowGround: true, minY: +(top0 - yDraw(maxDepth, mix) - 30).toFixed(1), maxDistance: 420,
        views: {
          oblique: { pos: [70, 38, 70], target: [0, -18, -15] },
          shallow: { pos: [52, 6, 48], target: [8, -14, -5] },
          column: { pos: [190, 30, 170], target: [0, -60, -15] },
        } },
      attribution: profileKind === 'witkowo' ? (profile?.attribution || 'PIG-PIB') : 'PIG-PIB (sitedata, if available); deeper layers assumed',
      sources: profile?.sources || [],
      errors,
    };
  }

  // initial: ctx.site or default Witkowo
  const ready = setSite(ctx.site || null).catch((e) => { errors.push(e.message); return info(); });

  return {
    update, info, setVisible, setSite, setDepthScale, setLang,
    setLabels(b) { labelsOn = !!b; labelG.visible = labelsOn; layoutKey = ''; },
    refresh() { refreshTops(); },
    group, ready,
    dispose() { clearLabels(); block.geometry.dispose(); blockMat.dispose(); rainGeo.dispose(); rainMat.dispose(); wellGeo.dispose(); wellMat.dispose(); leaderGeo.dispose(); rulerGeo.dispose(); scene.remove(group); },
  };
}
