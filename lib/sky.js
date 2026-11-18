// lib/sky.js — sun, day/night cycle, sky dome, stars, fog, all scene lighting.
// Contract: init(ctx) -> { update(dt, state), info(), setVisible(bool) }. Writes state.sun (0..1).
//
// Sun: real solar position for Witkowo (53.4 N, 14.6 E), 21 June, CEST (UTC+2).
// Scene axes: north = -z, east = +x, up = +y. Azimuth is measured from north, clockwise.

// Fallback site (Witkowo) when state.site is missing. rotDeg = true bearing of scene -z (data/geo/site.json),
// so true north in the scene is NOT -z: a true azimuth A maps to scene bearing (A - rotDeg) measured from -z
// clockwise (towards +x).
const LAT = 53.4, LON = 14.6, ROT = 313;
// Summer = 21 June (CEST, UTC+2); winter = 21 December (CET, UTC+1). Blended by state.winter (0..1):
// declination, time zone and equation of time are interpolated, so the sun moves continuously.
const TZ = 2, TZ_W = 1;
const DECL = 23.44, DECL_W = -23.44;            // solar declination, deg
const EOT_MIN = -1.8, EOT_MIN_W = 1.9;          // equation of time, minutes
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// Site bounds (from CONTRACT.md): x -18..18, z -36..6
const SITE_CX = 0, SITE_CZ = -15;
const SHADOW_R = 29;                            // bounding radius of the site incl. canopy height
const SUN_DIST = 70;

// Sky colour keyframes by sun altitude (deg). Hex values are sRGB; THREE.Color converts to linear.
const KEYS = [
  //  alt   zenith     horizon    ground     sunLight   hemiSky    hemiGround fog
  [-90, 0x03060d, 0x0a1220, 0x070a12, 0x000000, 0x30456e, 0x15171c, 0x0a111d],
  [-14, 0x04080f, 0x0d1729, 0x080c15, 0x000000, 0x32476f, 0x16181d, 0x0c1422],
  [-7,  0x0d1a38, 0x2c406a, 0x161e30, 0x000000, 0x3f5480, 0x1c1f26, 0x1f2d4a],
  [-2,  0x22355c, 0x9a6a62, 0x3a3540, 0xff7a3a, 0x6a7ca6, 0x2c2824, 0x6a5a68],
  [2,   0x355384, 0xe59a62, 0x6a5448, 0xff9a4e, 0x93a2c4, 0x4a3c2c, 0xc08a6a],
  [7,   0x3f6aa8, 0xeeb985, 0x7a6a58, 0xffbf7d, 0xa6b6d4, 0x55473a, 0xd2b294],
  [16,  0x3a6fbe, 0xc9d3dc, 0x7d8478, 0xffe2bc, 0xa8c2e4, 0x584c3a, 0xbfcad6],
  [35,  0x2f69c8, 0xb2cfea, 0x76826f, 0xfff3e2, 0xa9c8ee, 0x5a4e3c, 0xb0c8e0],
  [90,  0x2a63c6, 0xa8c9ea, 0x737f6b, 0xfff8ee, 0xadcbf0, 0x5a4e3c, 0xa9c4e0],
];
// Winter (21 Dec): paler, colder, low contrast, slightly overcast; snow-white ground bounce;
// blue hour stretched over a wider altitude band.
const KEYS_W = [
  //  alt   zenith     horizon    ground     sunLight   hemiSky    hemiGround fog
  [-90, 0x04070d, 0x0c1320, 0x0b0f17, 0x000000, 0x34486e, 0x2c3344, 0x0c121d],
  [-17, 0x060b16, 0x121c30, 0x101624, 0x000000, 0x3a4f78, 0x323a4c, 0x111a2a],
  [-11, 0x14223f, 0x34486c, 0x2a344c, 0x000000, 0x4c628c, 0x4a5468, 0x2e3d5c],
  [-4,  0x2c4068, 0x7a8098, 0x5c6276, 0xff9a6a, 0x7a8cb0, 0x7c8494, 0x6c7290],
  [1,   0x4a6288, 0xc4aa9e, 0x9a9ca4, 0xffb088, 0x9eacc6, 0xaab0bc, 0xa8a4a8],
  [7,   0x6a82a6, 0xc9cdd4, 0xb4b8be, 0xffd2b0, 0xb4c0d4, 0xc8ced8, 0xc0c6ce],
  [18,  0x7a92b4, 0xd2d8de, 0xbcc0c6, 0xffe4cc, 0xbcc8da, 0xd4dae2, 0xc8ced6],
  [90,  0x7a92b4, 0xd2d8de, 0xbcc0c6, 0xffe4cc, 0xbcc8da, 0xd4dae2, 0xc8ced6],
];

const VERT = /* glsl */`
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // keep the dome at the far plane
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunColor;
uniform vec3 uSunDir, uMoonDir;
uniform float uGlow, uDisc, uMoon;
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  col = mix(col, uGround, smoothstep(0.0, -0.3, h));
  float s = max(dot(d, uSunDir), 0.0);
  // broad halo around the sun + warm band along the horizon on the sun side
  float band = exp(-abs(h) * 7.0);
  col += uSunColor * (pow(s, 6.0) * 0.35 + pow(s, 2.0) * band * 0.45) * uGlow;
  col += uSunColor * pow(s, 400.0) * 1.2 * uDisc;
  col += uSunColor * smoothstep(0.99955, 0.99975, s) * 6.0 * uDisc;
  // moon disc + faint halo
  float m = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.75, 0.8, 0.9) * (smoothstep(0.99935, 0.9996, m) * 1.4 + pow(m, 120.0) * 0.06) * uMoon;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function init(ctx) {
  const { THREE, scene, renderer } = ctx;
  const node = ctx.node || (() => undefined);

  // ---------- keyframe colours (linear) ----------
  const keys = KEYS.map(k => ({ alt: k[0], c: k.slice(1).map(h => new THREE.Color(h)) }));
  const keysW = KEYS_W.map(k => ({ alt: k[0], c: k.slice(1).map(h => new THREE.Color(h)) }));
  const NC = 7;
  const cur = Array.from({ length: NC }, () => new THREE.Color());
  const curW = Array.from({ length: NC }, () => new THREE.Color());
  const [cZenith, cHorizon, cGround, cSun, cHemiSky, cHemiGround, cFog] = cur;

  // ---------- lights ----------
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.name = 'Sky / sun';
  sun.castShadow = true; // only matters when renderer.shadowMap.enabled
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_R; sc.right = SHADOW_R; sc.top = SHADOW_R; sc.bottom = -SHADOW_R;
  sc.near = SUN_DIST - SHADOW_R - 5; sc.far = SUN_DIST + SHADOW_R + 5;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(SITE_CX, 0, SITE_CZ);
  scene.add(sun, sun.target);

  const moon = new THREE.DirectionalLight(0x9fb4e0, 0);
  moon.name = 'Sky / moon';
  const MOON_ALT = 24 * D2R, MOON_AZ = 150 * D2R; // low in the SSE (true azimuth), as on a short June night
  const moonDir = new THREE.Vector3();
  function placeMoon(rotDeg) {
    const b = MOON_AZ - rotDeg * D2R;
    moonDir.set(Math.sin(b) * Math.cos(MOON_ALT), Math.sin(MOON_ALT), -Math.cos(b) * Math.cos(MOON_ALT));
    moon.position.copy(moonDir).multiplyScalar(SUN_DIST).add(sun.target.position);
  }
  placeMoon(ROT);
  moon.target = sun.target;
  scene.add(moon);

  const hemi = new THREE.HemisphereLight(0xadcbf0, 0x4b4233, 1);
  hemi.name = 'Sky / hemisphere';
  scene.add(hemi);

  // ---------- night lamps + status LEDs ----------
  // Lights stay in the scene all the time (intensity 0 by day) so the light count never changes
  // and materials are never recompiled.
  const bInv = new THREE.Box3(), bFld = new THREE.Box3();
  const nInv = node('Inverter cabinets'), nFld = node('Field control cabinet');
  if (nInv) bInv.setFromObject(nInv); else bInv.set(new THREE.Vector3(-12.21, 1.22, 0.86), new THREE.Vector3(-9.79, 2.08, 1.14));
  if (nFld) bFld.setFromObject(nFld); else bFld.set(new THREE.Vector3(13.6, 0, -1.2), new THREE.Vector3(14.2, 1.42, -0.8));

  const lampWarm = new THREE.Color(0xffb35c);
  const lampInv = new THREE.PointLight(lampWarm, 0, 7, 1.6);
  lampInv.name = 'Sky / lamp inverters';
  lampInv.position.set((bInv.min.x + bInv.max.x) / 2, bInv.max.y + 0.45, bInv.max.z + 0.45);
  const lampFld = new THREE.PointLight(lampWarm, 0, 5.5, 1.6);
  lampFld.name = 'Sky / lamp field cabinet';
  lampFld.position.set((bFld.min.x + bFld.max.x) / 2, bFld.max.y + 0.35, bFld.max.z + 0.4);
  scene.add(lampInv, lampFld);

  const fixtures = new THREE.Group();
  fixtures.name = 'Sky / night fixtures';
  const lampGeo = new THREE.BoxGeometry(0.22, 0.05, 0.12);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false });
  for (const L of [lampInv, lampFld]) {
    const m = new THREE.Mesh(lampGeo, lampMat);
    m.position.copy(L.position).setY(L.position.y + 0.03);
    fixtures.add(m);
  }
  const ledGeo = new THREE.BoxGeometry(0.035, 0.035, 0.012);
  const ledOn = new THREE.MeshBasicMaterial({ color: 0x0d3a14, toneMapped: false });   // green "running"
  const ledAmb = new THREE.MeshBasicMaterial({ color: 0x3a2a08, toneMapped: false });  // amber "standby"
  const invW = (bInv.max.x - bInv.min.x) / 3;
  for (let i = 0; i < 3; i++) {
    const x = bInv.min.x + invW * (i + 0.5) + invW * 0.3;
    const y = bInv.max.y - 0.07;
    const a = new THREE.Mesh(ledGeo, ledOn); a.position.set(x, y, bInv.max.z + 0.007); fixtures.add(a);
    const b = new THREE.Mesh(ledGeo, ledAmb); b.position.set(x - 0.06, y, bInv.max.z + 0.007); fixtures.add(b);
  }
  const fLed = new THREE.Mesh(ledGeo, ledOn);
  fLed.position.set(bFld.max.x - 0.12, bFld.max.y - 0.15, bFld.max.z + 0.007);
  fixtures.add(fLed);
  scene.add(fixtures);
  const ledOnDay = new THREE.Color(0x1f7a2c), ledOnNight = new THREE.Color(0x5dff7a);
  const ledAmbDay = new THREE.Color(0x6a4a10), ledAmbNight = new THREE.Color(0xffb02a);
  const lampOff = new THREE.Color(0x2a2a2a), lampOn = new THREE.Color(0xfff0c8);

  // ---------- sky dome ----------
  const skyGroup = new THREE.Group();
  skyGroup.name = 'Sky / dome';
  const uniforms = {
    uZenith: { value: cZenith }, uHorizon: { value: cHorizon }, uGround: { value: cGround },
    uSunColor: { value: cSun }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: moonDir }, uGlow: { value: 1 }, uDisc: { value: 1 }, uMoon: { value: 0 },
  };
  const domeMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  skyGroup.add(dome);

  // stars: upper hemisphere, deterministic pseudo-random
  const N_STARS = 1400;
  const sp = new Float32Array(N_STARS * 3), scol = new Float32Array(N_STARS * 3);
  let seed = 53769;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N_STARS; i++) {
    const y = 0.04 + 0.96 * Math.pow(rnd(), 0.8);
    const a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    sp[i * 3] = Math.cos(a) * r * 0.97; sp[i * 3 + 1] = y * 0.97; sp[i * 3 + 2] = Math.sin(a) * r * 0.97;
    const b = 0.35 + 0.65 * Math.pow(rnd(), 3), t = rnd();
    scol[i * 3] = b * (0.85 + 0.15 * t); scol[i * 3 + 1] = b * 0.92; scol[i * 3 + 2] = b * (1.0 - 0.12 * t);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  const starMat = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0,
    depthWrite: false, fog: false, toneMapped: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  skyGroup.add(stars);
  scene.add(skyGroup);

  // ---------- fog ----------
  const ownFog = !scene.fog;
  if (ownFog) scene.fog = new THREE.Fog(0xa9c4e0, 90, 360);
  const bgColor = new THREE.Color();
  const prevBackground = scene.background;

  // ---------- PV sheen ----------
  // power.js clones 'PV cells' per canopy and drives emissive/emissiveIntensity, so the sheen goes into the
  // base colour instead (nobody else writes it). Re-collected on first update and whenever the set changes.
  const pvRoot = ctx.root || scene;
  const pvMats = [], pvBase = [];
  const pvSheen = new THREE.Color(0x2a4f86);
  let pvSeen = 0, pvStale = true;
  const isPv = m => m && typeof m.name === 'string' && m.name.startsWith('PV cells') && m.color;
  const pvCheck = o => {
    if (!o.isMesh) return;
    const ms = o.material;
    if (Array.isArray(ms)) { for (let i = 0; i < ms.length; i++) if (isPv(ms[i])) { pvSeen++; if (pvMats.indexOf(ms[i]) < 0) pvStale = true; } }
    else if (isPv(ms)) { pvSeen++; if (pvMats.indexOf(ms) < 0) pvStale = true; }
  };
  const pvCollect = o => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (isPv(m) && pvMats.indexOf(m) < 0) { pvMats.push(m); pvBase.push(m.color.clone()); }
  };
  let pvLastSeen = -1;
  function refreshPv() {
    pvSeen = 0;
    pvRoot.traverse(pvCheck);
    if (!pvStale && pvSeen === pvLastSeen) return;
    pvMats.length = 0; pvBase.length = 0;
    pvRoot.traverse(pvCollect);
    pvLastSeen = pvSeen; pvStale = false;
  }

  // ---------- state ----------
  // irradiance normalisation: clear-sky global horizontal at solar noon
  // site (lat/lon/rotDeg); irradiance normalised to clear-sky summer noon at that latitude
  let siteLat = LAT, siteLon = LON, siteRot = ROT, ghiNorm = 1;
  function applySite(lat, lon, rot) {
    siteLat = Number.isFinite(lat) ? lat : LAT;
    siteLon = Number.isFinite(lon) ? lon : LON;
    siteRot = Number.isFinite(rot) ? rot : ROT;
    ghiNorm = ghi(Math.sin((90 - siteLat + DECL) * D2R));
    placeMoon(siteRot);
    riseMin = setMin = -1; // force sunrise/sunset strings to refresh
  }
  const sunDir = uniforms.uSunDir.value;
  let visible = true;
  let lastQuality = null;
  const out = { sunAltDeg: 0, sunAzDeg: 0, phase: 'day', sun: 0, sunrise: '', sunset: '', winterDay: false, winter: 0,
    raysToPanels: 0, raysToCrops: 0, raysToSoil: 0, sunSceneAzDeg: 0, lat: LAT, lon: LON, rotDeg: ROT, overcast: 0 };
  const rays = createRays(THREE, scene);
  const drawSize = new THREE.Vector2();
  // sunrise/sunset strings are rebuilt only when the minute changes (i.e. while state.winter is easing)
  let riseMin = -1, setMin = -1;
  const fmtMin = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  function riseSet(decDeg, tz, eot) {
    const phi = siteLat * D2R, dec = decDeg * D2R;
    const cosH0 = (Math.sin(-0.833 * D2R) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    const H0 = Math.acos(Math.min(1, Math.max(-1, cosH0))) * R2D / 15;
    const noon = 12 + tz - siteLon / 15 - eot / 60;
    const r = Math.round((noon - H0) * 60), s = Math.round((noon + H0) * 60);
    if (r !== riseMin) { riseMin = r; out.sunrise = fmtMin(r); }
    if (s !== setMin) { setMin = s; out.sunset = fmtMin(s); }
  }
  applySite(LAT, LON, ROT);
  riseSet(DECL, TZ, EOT_MIN);

  function ghi(sinAlt) {
    // Meinel clear-sky beam with Kasten-Young air mass + 10% diffuse, times sin(alt)
    if (sinAlt <= 0) return 0;
    const altDeg = Math.asin(sinAlt) * R2D;
    const am = 1 / (sinAlt + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364));
    return 1.1 * Math.pow(0.7, Math.pow(am, 0.678)) * sinAlt;
  }

  function sample(ks, altDeg, dst) {
    let i = 0;
    while (i < ks.length - 2 && altDeg > ks[i + 1].alt) i++;
    const a = ks[i], b = ks[i + 1];
    const t = Math.min(1, Math.max(0, (altDeg - a.alt) / (b.alt - a.alt)));
    const s = t * t * (3 - 2 * t);
    for (let k = 0; k < NC; k++) dst[k].copy(a.c[k]).lerp(b.c[k], s);
  }

  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // --- rain / overcast (state.rainMmH from lib/rain.js), eased over ~3 s ---
  // cloud: cover 0..1, full at 0.5 mm/h; heavy: log-scaled intensity 0..1 (10 mm/h = 1)
  let cloud = 0, heavy = 0;
  const LOG11 = Math.log1p(10);
  function overcast(c, amt, dark) {
    if (amt <= 0) return;
    const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    c.r += (l * 0.92 * dark - c.r) * amt;
    c.g += (l * 0.96 * dark - c.g) * amt;
    c.b += (l * 1.04 * dark - c.b) * amt;
  }

  function update(dt, state) {
    const hour = ((state.hour % 24) + 24) % 24;
    const st = state.site;
    if (st) { if (st.lat !== siteLat || st.lon !== siteLon || (st.rotDeg ?? ROT) !== siteRot) applySite(st.lat, st.lon, st.rotDeg ?? ROT); }
    const w = Math.min(1, Math.max(0, +state.winter || 0));
    // --- solar position (date blended continuously June 21 -> Dec 21) ---
    const decDeg = DECL + (DECL_W - DECL) * w;
    const tz = TZ + (TZ_W - TZ) * w;
    const eot = EOT_MIN + (EOT_MIN_W - EOT_MIN) * w;
    const solarTime = hour - tz + siteLon / 15 + eot / 60;
    const H = (solarTime - 12) * 15 * D2R;
    const phi = siteLat * D2R, dec = decDeg * D2R;
    const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
    const alt = Math.asin(sinAlt);
    const cosAlt = Math.cos(alt);
    // azimuth from north, clockwise
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
    const altDeg = alt * R2D;
    const b = az - siteRot * D2R; // scene bearing from -z, clockwise towards +x
    sunDir.set(Math.sin(b) * cosAlt, sinAlt, -Math.cos(b) * cosAlt);

    // --- irradiance (continuous, 0 below horizon) ---
    const irrClear = Math.min(1, ghi(sinAlt) / ghiNorm);
    const mm = Math.max(0, +state.rainMmH || 0);
    const kr = 1 - Math.exp(-Math.max(dt, 0) / 0.9);
    cloud += (Math.min(1, mm / 0.5) - cloud) * kr;
    heavy += (Math.min(1, Math.log1p(mm) / LOG11) - heavy) * kr;
    // overcast irradiance: ~0.4 of clear in light rain, ~0.15 at 10 mm/h
    const irr = irrClear * (1 - 0.55 * cloud) * (1 - 0.65 * heavy);
    state.sun = irr;

    sample(keys, altDeg, cur);
    if (w > 0) {
      sample(keysW, altDeg, curW);
      for (let k = 0; k < NC; k++) cur[k].lerp(curW[k], w);
    }
    if (cloud > 0.001) {
      const dark = 1 - 0.18 * cloud - 0.3 * heavy;
      overcast(cZenith, 0.85 * cloud, dark); overcast(cHorizon, 0.8 * cloud, dark);
      overcast(cGround, 0.6 * cloud, dark); overcast(cFog, 0.85 * cloud, dark);
      overcast(cHemiSky, 0.8 * cloud, 1 - 0.15 * heavy); overcast(cHemiGround, 0.4 * cloud, 1);
      overcast(cSun, 0.6 * cloud, 1);
    }

    // --- sun light ---
    // keep the light a bit above the horizon so shadows never become infinite
    const lightAlt = Math.max(alt, 4 * D2R);
    const lc = Math.cos(lightAlt);
    sun.position.set(SITE_CX + Math.sin(b) * lc * SUN_DIST, Math.sin(lightAlt) * SUN_DIST, SITE_CZ - Math.cos(b) * lc * SUN_DIST);
    const dayF = smooth(-1.5, 3, altDeg);
    sun.color.copy(cSun);
    sun.intensity = 3.0 * dayF * (0.5 + 0.5 * Math.sqrt(irrClear)) * (1 - 0.3 * w) // winter: thin overcast
      * (1 - 0.3 * cloud) * (1 - 0.5 * heavy); // rain: ~35% at 10 mm/h

    // --- moon + hemisphere ---
    const nightF = 1 - smooth(-12 - 3 * w, -1, altDeg);
    moon.intensity = 0.9 * nightF;
    hemi.color.copy(cHemiSky);
    hemi.groundColor.copy(cHemiGround);
    hemi.intensity = 0.9 + 0.5 * smooth(-4, 25 - 13 * w, altDeg) + 0.4 * nightF;

    // --- sky ---
    const q = state.quality === 'low' ? 'low' : 'high';
    if (q !== lastQuality) {
      lastQuality = q;
      dome.visible = q === 'high';
      sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    uniforms.uGlow.value = (0.25 + 1.1 * smooth(-8 - 4 * w, 1, altDeg) * (1 - 0.65 * smooth(8, 35, altDeg))) * (1 - 0.45 * w) * (1 - 0.85 * cloud);
    uniforms.uDisc.value = smooth(-1.2, 0.5, altDeg) * (1 - 0.55 * w) * (1 - cloud);
    uniforms.uMoon.value = nightF * (1 - cloud);
    moon.intensity *= 1 - 0.6 * cloud;
    starMat.opacity = (1 - smooth(-11 + 4 * w, -4 + 2.5 * w, altDeg)) * (1 - cloud); // winter: stars come out earlier
    stars.visible = starMat.opacity > 0.01;

    const cam = ctx.getCamera && ctx.getCamera();
    if (cam) {
      skyGroup.position.copy(cam.position);
      skyGroup.scale.setScalar(Math.min(cam.far * 0.9, 2000));
    }
    if (q === 'low') {
      bgColor.copy(cHorizon).lerp(cZenith, 0.35);
      scene.background = bgColor;
    } else if (scene.background === bgColor) {
      scene.background = prevBackground || null;
    }

    if (scene.fog) {
      scene.fog.color.copy(cFog);
      if (ownFog) { const fd = 1 - 0.25 * cloud - 0.25 * heavy; scene.fog.near = (90 - 40 * w) * fd; scene.fog.far = (360 - 150 * w) * fd; }
    }

    // --- exposure: open up a little at night so the model stays readable ---
    renderer.toneMappingExposure = 1.0 + 0.35 * nightF + 0.1 * (1 - dayF) * (1 - nightF);

    // --- night fixtures ---
    const lampF = 1 - smooth(0.0, 0.05, irr) * smooth(-3, 1, altDeg);
    lampInv.intensity = 2.2 * lampF;
    lampFld.intensity = 1.6 * lampF;
    lampMat.color.copy(lampOff).lerp(lampOn, lampF);
    ledOn.color.copy(ledOnDay).lerp(ledOnNight, lampF);
    ledAmb.color.copy(ledAmbDay).lerp(ledAmbNight, lampF);

    // --- PV sheen ---
    refreshPv();
    for (let i = 0; i < pvMats.length; i++) pvMats[i].color.copy(pvBase[i]).lerp(pvSheen, 0.22 * irr);

    // --- sun rays layer ---
    const raysOn = !(state.show && state.show.rays === false) && altDeg > 0.5 && cloud < 0.97;
    renderer.getDrawingBufferSize(drawSize);
    rays.update(dt, sunDir, irrClear * (1 - cloud), raysOn, cam, drawSize.y);
    out.raysToPanels = rays.stats.panel; out.raysToCrops = rays.stats.crop; out.raysToSoil = rays.stats.soil;

    // --- info ---
    out.sunAltDeg = altDeg;
    out.sunAzDeg = az * R2D;          // true azimuth
    out.sunSceneAzDeg = (b * R2D + 360) % 360; // bearing in the scene from -z towards +x
    out.lat = siteLat; out.lon = siteLon; out.rotDeg = siteRot;
    out.sun = irr;
    out.overcast = cloud;
    out.winter = w;
    out.winterDay = w >= 0.5;
    riseSet(decDeg, tz, eot);
    out.phase = altDeg > 6 ? 'day' : altDeg < -6 ? 'night' : (hour < 13 ? 'dawn' : 'dusk');
  }

  return {
    update,
    info() { return out; },
    setVisible(v) { visible = !!v; skyGroup.visible = visible; },
    setRaysVisible(v) { rays.setVisible(v); },
    // site = { lat, lon, rotDeg }; only updates cached values (sun, moon, rays and shadows follow on next update)
    setSite(site) { if (site) applySite(+site.lat, +site.lon, site.rotDeg == null ? ROT : +site.rotDeg); },
    // handy for other modules: unit vector towards the sun (scene axes). Do not mutate.
    sunDirection: sunDir,
    sunLight: sun,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Sun rays: how sunlight travels through the agrivoltaic roof. Soft additive shafts along the sun direction,
// slow photon motes, a soft glow where a ray lands on a PV row (-> power) and a warm patch where it slips
// between the rows down to the crops / soil. Geometry is re-traced only when the sun moves > 1 deg; endpoints
// are eased, so nothing jumps or flickers.
const RAY_CANOPIES = [-10, 0, 10];
const PV_DX = 2.05, PV_HALF = 0.75, PV_LIFT = 0.21, PV_Z0 = -30, PV_Z1 = 0;
const PV_YC = 4.86;                                           // strip centre height (glTF node y)
const PV_B = PV_YC - PV_LIFT * PV_DX;                         // y = PV_B + PV_LIFT * |x - cx|
const ROOF_Y = 4.86, CROP_Y = 0.32, SOIL_Y = 0.03, TOP_Y = 9.5;
const PHOTON_SPEED = 1.25;                                    // m/s, real time

const RAY_VERT = /* glsl */`
attribute vec3 aA; attribute vec3 aB; attribute vec2 aP;
uniform vec3 uCam;
varying vec2 vUv; varying float vKind;
void main() {
  vUv = uv; vKind = aP.x;
  vec3 p;
  if (aP.x < 0.5) {
    vec3 axis = aB - aA;
    vec3 m = mix(aA, aB, uv.y);
    vec3 side = cross(axis, uCam - m);
    float l = length(side);
    side = l > 1e-5 ? side / l : vec3(1.0, 0.0, 0.0);
    p = m + side * (uv.x - 0.5) * aP.y;
  } else {
    vec3 n = normalize(aB);
    vec3 t = normalize(abs(n.y) > 0.9 ? cross(n, vec3(0.0, 0.0, 1.0)) : cross(n, vec3(0.0, 1.0, 0.0)));
    vec3 b = cross(n, t);
    p = aA + n * 0.035 + (t * (uv.x - 0.5) + b * (uv.y - 0.5)) * aP.y;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAY_FRAG = /* glsl */`
uniform vec3 uShaft, uPanel, uCrop;
uniform float uI;
varying vec2 vUv; varying float vKind;
void main() {
  float a; vec3 c;
  if (vKind < 0.5) {
    float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float edge = x * x * (3.0 - 2.0 * x); edge *= edge;
    float along = smoothstep(0.0, 0.7, vUv.y) * (1.0 - 0.4 * smoothstep(0.93, 1.0, vUv.y));
    a = edge * along * along * 0.10; c = uShaft;
  } else {
    float r = length(vUv - 0.5) * 2.0;
    a = exp(-r * r * 3.5) * (1.0 - smoothstep(0.75, 1.0, r)) * (vKind < 1.5 ? 0.42 : 0.5);
    c = vKind < 1.5 ? uPanel : uCrop;
  }
  gl_FragColor = vec4(c, a * uI);
  #include <colorspace_fragment>
}`;
const MOTE_VERT = /* glsl */`
attribute float aF; attribute float aIdx;
uniform float uCount, uI, uSize, uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale / max(-mv.z, 0.5), 1.0, 14.0);
  vA = uI * clamp(uCount - aIdx, 0.0, 1.0) * smoothstep(0.0, 0.3, aF) * (1.0 - smoothstep(0.85, 1.0, aF));
}`;
const MOTE_FRAG = /* glsl */`
uniform vec3 uCol;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-r * r * 3.0) * (1.0 - smoothstep(0.7, 1.0, r));
  gl_FragColor = vec4(uCol, a * vA * 0.55);
  #include <colorspace_fragment>
}`;

function createRays(THREE, scene) {
  // ray entry points on the roof plane: per canopy 2 over the PV rows, 2 through the central gap,
  // plus the aisles; 3 positions along z
  const entries = [];
  const ZS = [-25, -15, -5];
  for (const z of ZS) {
    for (const cx of RAY_CANOPIES) for (const dx of [-PV_DX, -0.55, 0.55, PV_DX]) entries.push(cx + dx, z);
    for (const x of [-5, 5]) entries.push(x, z + 2.5);
  }
  const N = entries.length / 2;                 // shafts (= patches)
  const NI = N * 2;
  const geo = new THREE.PlaneGeometry(1, 1);
  const aA = new Float32Array(NI * 3), aB = new Float32Array(NI * 3), aP = new Float32Array(NI * 2);
  const attA = new THREE.InstancedBufferAttribute(aA, 3), attB = new THREE.InstancedBufferAttribute(aB, 3);
  attA.setUsage(THREE.DynamicDrawUsage); attB.setUsage(THREE.DynamicDrawUsage);
  const attP = new THREE.InstancedBufferAttribute(aP, 2); attP.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aA', attA); geo.setAttribute('aB', attB); geo.setAttribute('aP', attP);
  const uCam = new THREE.Vector3();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: uCam }, uI: { value: 0 },
      uShaft: { value: new THREE.Color(1.0, 0.9, 0.68) },
      uPanel: { value: new THREE.Color(1.0, 0.86, 0.52) },
      uCrop: { value: new THREE.Color(1.0, 0.78, 0.42) },
    },
    vertexShader: RAY_VERT, fragmentShader: RAY_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, NI);
  mesh.name = 'Sky / sun rays';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  // current (eased) and target endpoints: shaft start S, end E, end normal Nn, end kind K
  const S = new Float32Array(N * 3), E = new Float32Array(N * 3), Nn = new Float32Array(N * 3);
  const tS = new Float32Array(N * 3), tE = new Float32Array(N * 3), tN = new Float32Array(N * 3);
  const K = new Float32Array(N), tK = new Float32Array(N), Kw = new Float32Array(N); // Kw: patch fade 0..1
  const len = new Float32Array(N);

  // photons
  const NM = 200;
  const F0 = 0.4;                               // photons appear 40% down the shaft, near the roof
  const mPos = new Float32Array(NM * 3), mF = new Float32Array(NM), mIdx = new Float32Array(NM);
  const mRay = new Uint16Array(NM);
  let seed = 9173;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // shuffle the index so that a partial count is spread over all rays
  for (let i = 0; i < NM; i++) { mRay[i] = i % N; mF[i] = rnd(); mIdx[i] = i; }
  for (let i = NM - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = mIdx[i]; mIdx[i] = mIdx[j]; mIdx[j] = t; }
  const mGeo = new THREE.BufferGeometry();
  const attPos = new THREE.BufferAttribute(mPos, 3); attPos.setUsage(THREE.DynamicDrawUsage);
  const attF = new THREE.BufferAttribute(mF, 1); attF.setUsage(THREE.DynamicDrawUsage);
  mGeo.setAttribute('position', attPos); mGeo.setAttribute('aF', attF);
  mGeo.setAttribute('aIdx', new THREE.BufferAttribute(mIdx, 1));
  const mMat = new THREE.ShaderMaterial({
    uniforms: { uCount: { value: 0 }, uI: { value: 0 }, uSize: { value: 0.12 }, uScale: { value: 500 },
      uCol: { value: new THREE.Color(1.0, 0.93, 0.72) } },
    vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
  });
  const motes = new THREE.Points(mGeo, mMat);
  motes.name = 'Sky / sun photons';
  motes.frustumCulled = false;
  motes.renderOrder = 6;

  const group = new THREE.Group();
  group.name = 'Sky / sun rays layer';
  group.add(mesh, motes);
  scene.add(group);

  const lastDir = new THREE.Vector3(0, -1, 0);
  const COS1 = Math.cos(1 * Math.PI / 180);
  let traced = false, userVisible = true, I = 0, countF = 0;
  const stats = { panel: 0, crop: 0, soil: 0 };

  function groundY(x, z) {
    if (z < -29 || z > -0.5) return SOIL_Y;
    for (let c = 0; c < RAY_CANOPIES.length; c++) if (Math.abs(x - RAY_CANOPIES[c]) < 2.9) return CROP_Y;
    return SOIL_Y;
  }

  // trace every ray once for the current sun direction (init-time-like cost, ~40 rays x 6 strips)
  function trace(d) {
    stats.panel = stats.crop = stats.soil = 0;
    for (let i = 0; i < N; i++) {
      const ex = entries[i * 2], ez = entries[i * 2 + 1];
      // line: P(t) = Entry + d * t (t > 0 towards the sun)
      // start at TOP_Y (max 40 m along the ray)
      const tTop = Math.min((TOP_Y - ROOF_Y) / Math.max(d.y, 1e-3), 40);
      // ground end (two passes: crop height depends on where it lands)
      let gy = SOIL_Y, tG = (gy - ROOF_Y) / Math.max(d.y, 1e-3);
      gy = groundY(ex + d.x * tG, ez + d.z * tG);
      tG = (gy - ROOF_Y) / Math.max(d.y, 1e-3);
      // topmost PV strip hit in (tG, tTop)
      let best = -Infinity, bs = 0;
      for (let c = 0; c < RAY_CANOPIES.length; c++) {
        const cx = RAY_CANOPIES[c];
        for (let s = -1; s <= 1; s += 2) {
          // plane y = PV_B + PV_LIFT * s * (x - cx)
          const den = d.y - PV_LIFT * s * d.x;
          if (Math.abs(den) < 1e-6) continue;
          const t = (PV_B + PV_LIFT * s * (ex - cx) - ROOF_Y) / den;
          if (t <= tG || t >= tTop || t <= best) continue;
          const x = ex + d.x * t, z = ez + d.z * t;
          const off = s * (x - cx);
          if (off < PV_DX - PV_HALF || off > PV_DX + PV_HALF || z < PV_Z0 || z > PV_Z1) continue;
          best = t; bs = s;
        }
      }
      const j = i * 3;
      tS[j] = ex + d.x * tTop; tS[j + 1] = ROOF_Y + d.y * tTop; tS[j + 2] = ez + d.z * tTop;
      if (best > -Infinity) {
        tE[j] = ex + d.x * best; tE[j + 1] = ROOF_Y + d.y * best; tE[j + 2] = ez + d.z * best;
        const nl = Math.hypot(PV_LIFT, 1);
        tN[j] = -PV_LIFT * bs / nl; tN[j + 1] = 1 / nl; tN[j + 2] = 0;
        tK[i] = 1; stats.panel++;
      } else {
        tE[j] = ex + d.x * tG; tE[j + 1] = gy; tE[j + 2] = ez + d.z * tG;
        tN[j] = 0; tN[j + 1] = 1; tN[j + 2] = 0;
        tK[i] = gy > 0.1 ? 2 : 3; if (gy > 0.1) stats.crop++; else stats.soil++;
      }
    }
    if (!traced) { S.set(tS); E.set(tE); Nn.set(tN); K.set(tK); Kw.fill(1); traced = true; }
  }

  function update(dt, sunDir, irr, on, cam, viewH) {
    // ease global intensity (~1 s) and photon count
    const target = on && userVisible ? Math.min(1, irr / 0.12) : 0;
    const k = 1 - Math.exp(-Math.max(dt, 0) * 3.0);
    I += (target - I) * k;
    countF += ((on && userVisible ? 0.25 + 0.75 * irr : 0) - countF) * k;
    const vis = I > 0.003;
    group.visible = vis;
    if (sunDir.y > 0.02 && (!traced || sunDir.dot(lastDir) < COS1)) { trace(sunDir); lastDir.copy(sunDir); }
    if (!vis || !traced) return;

    // ease endpoints towards the traced targets; when a ray switches target kind, fade its patch out and back in
    const ke = 1 - Math.exp(-Math.max(dt, 0) * 2.5);
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      for (let c = 0; c < 3; c++) {
        S[j + c] += (tS[j + c] - S[j + c]) * ke;
        E[j + c] += (tE[j + c] - E[j + c]) * ke;
        Nn[j + c] += (tN[j + c] - Nn[j + c]) * ke;
      }
      if (K[i] !== tK[i]) { Kw[i] -= dt * 2; if (Kw[i] <= 0) { Kw[i] = 0; K[i] = tK[i]; } }
      else if (Kw[i] < 1) Kw[i] = Math.min(1, Kw[i] + dt * 1.5);
      len[i] = Math.hypot(E[j] - S[j], E[j + 1] - S[j + 1], E[j + 2] - S[j + 2]);
      // shaft instance i, patch instance N + i
      aA[j] = S[j]; aA[j + 1] = S[j + 1]; aA[j + 2] = S[j + 2];
      aB[j] = E[j]; aB[j + 1] = E[j + 1]; aB[j + 2] = E[j + 2];
      aP[i * 2] = 0; aP[i * 2 + 1] = 0.6;
      const p = (N + i) * 3;
      aA[p] = E[j]; aA[p + 1] = E[j + 1]; aA[p + 2] = E[j + 2];
      aB[p] = Nn[j]; aB[p + 1] = Nn[j + 1]; aB[p + 2] = Nn[j + 2];
      aP[(N + i) * 2] = K[i]; aP[(N + i) * 2 + 1] = (K[i] === 1 ? 1.3 : 1.7) * Kw[i];
    }
    attA.needsUpdate = attB.needsUpdate = attP.needsUpdate = true;

    // photons drift from the start of their shaft to its end
    const step = PHOTON_SPEED * Math.min(Math.max(dt, 0), 0.1);
    for (let m = 0; m < NM; m++) {
      const i = mRay[m], j = i * 3;
      let f = mF[m] + step / Math.max(len[i] * (1 - F0), 1);
      if (f >= 1) f -= 1;
      mF[m] = f;
      const q = m * 3, g = F0 + (1 - F0) * f;
      mPos[q] = S[j] + (E[j] - S[j]) * g;
      mPos[q + 1] = S[j + 1] + (E[j + 1] - S[j + 1]) * g;
      mPos[q + 2] = S[j + 2] + (E[j + 2] - S[j + 2]) * g;
    }
    attPos.needsUpdate = attF.needsUpdate = true;

    mat.uniforms.uI.value = I;
    mMat.uniforms.uI.value = I;
    mMat.uniforms.uCount.value = countF * NM;
    if (cam) {
      uCam.setFromMatrixPosition(cam.matrixWorld);
      const fov = cam.isPerspectiveCamera ? cam.fov : 45;
      mMat.uniforms.uScale.value = viewH * 0.5 / Math.tan(fov * Math.PI / 360);
    }
  }

  return { update, setVisible(v) { userVisible = !!v; }, stats, group };
}
