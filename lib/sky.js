// lib/sky.js — sun, day/night cycle, sky dome, stars, fog, all scene lighting.
// Contract: init(ctx) -> { update(dt, state), info(), setVisible(bool) }. Writes state.sun (0..1).
//
// Sun: real solar position for Witkowo (53.4 N, 14.6 E), 21 June, CEST (UTC+2).
// Scene axes: north = -z, east = +x, up = +y. Azimuth is measured from north, clockwise.

const LAT = 53.4, LON = 14.6;
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
  const MOON_ALT = 24 * D2R, MOON_AZ = 150 * D2R; // low in the SSE, as on a short June night
  const moonDir = new THREE.Vector3(Math.sin(MOON_AZ) * Math.cos(MOON_ALT), Math.sin(MOON_ALT), -Math.cos(MOON_AZ) * Math.cos(MOON_ALT));
  moon.position.copy(moonDir).multiplyScalar(SUN_DIST).add(sun.target.position);
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
  const NOON_ALT = (90 - LAT + DECL) * D2R;
  const ghiNorm = ghi(Math.sin(NOON_ALT));
  const sunDir = uniforms.uSunDir.value;
  let visible = true;
  let lastQuality = null;
  const out = { sunAltDeg: 0, sunAzDeg: 0, phase: 'day', sun: 0, sunrise: '', sunset: '', winterDay: false, winter: 0 };
  // sunrise/sunset strings are rebuilt only when the minute changes (i.e. while state.winter is easing)
  let riseMin = -1, setMin = -1;
  const fmtMin = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  function riseSet(decDeg, tz, eot) {
    const phi = LAT * D2R, dec = decDeg * D2R;
    const cosH0 = (Math.sin(-0.833 * D2R) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    const H0 = Math.acos(Math.min(1, Math.max(-1, cosH0))) * R2D / 15;
    const noon = 12 + tz - LON / 15 - eot / 60;
    const r = Math.round((noon - H0) * 60), s = Math.round((noon + H0) * 60);
    if (r !== riseMin) { riseMin = r; out.sunrise = fmtMin(r); }
    if (s !== setMin) { setMin = s; out.sunset = fmtMin(s); }
  }
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

  function update(dt, state) {
    const hour = ((state.hour % 24) + 24) % 24;
    const w = Math.min(1, Math.max(0, +state.winter || 0));
    // --- solar position (date blended continuously June 21 -> Dec 21) ---
    const decDeg = DECL + (DECL_W - DECL) * w;
    const tz = TZ + (TZ_W - TZ) * w;
    const eot = EOT_MIN + (EOT_MIN_W - EOT_MIN) * w;
    const solarTime = hour - tz + LON / 15 + eot / 60;
    const H = (solarTime - 12) * 15 * D2R;
    const phi = LAT * D2R, dec = decDeg * D2R;
    const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
    const alt = Math.asin(sinAlt);
    const cosAlt = Math.cos(alt);
    // azimuth from north, clockwise
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
    const altDeg = alt * R2D;
    sunDir.set(Math.sin(az) * cosAlt, sinAlt, -Math.cos(az) * cosAlt);

    // --- irradiance (continuous, 0 below horizon) ---
    const irr = Math.min(1, ghi(sinAlt) / ghiNorm);
    state.sun = irr;

    sample(keys, altDeg, cur);
    if (w > 0) {
      sample(keysW, altDeg, curW);
      for (let k = 0; k < NC; k++) cur[k].lerp(curW[k], w);
    }

    // --- sun light ---
    // keep the light a bit above the horizon so shadows never become infinite
    const lightAlt = Math.max(alt, 4 * D2R);
    const lc = Math.cos(lightAlt);
    sun.position.set(SITE_CX + Math.sin(az) * lc * SUN_DIST, Math.sin(lightAlt) * SUN_DIST, SITE_CZ - Math.cos(az) * lc * SUN_DIST);
    const dayF = smooth(-1.5, 3, altDeg);
    sun.color.copy(cSun);
    sun.intensity = 3.0 * dayF * (0.5 + 0.5 * Math.sqrt(irr)) * (1 - 0.3 * w); // winter: thin overcast

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
    uniforms.uGlow.value = (0.25 + 1.1 * smooth(-8 - 4 * w, 1, altDeg) * (1 - 0.65 * smooth(8, 35, altDeg))) * (1 - 0.45 * w);
    uniforms.uDisc.value = smooth(-1.2, 0.5, altDeg) * (1 - 0.55 * w);
    uniforms.uMoon.value = nightF;
    starMat.opacity = 1 - smooth(-11 + 4 * w, -4 + 2.5 * w, altDeg); // winter: stars come out earlier
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
      if (ownFog) { scene.fog.near = 90 - 40 * w; scene.fog.far = 360 - 150 * w; }
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

    // --- info ---
    out.sunAltDeg = altDeg;
    out.sunAzDeg = az * R2D;
    out.sun = irr;
    out.winter = w;
    out.winterDay = w >= 0.5;
    riseSet(decDeg, tz, eot);
    out.phase = altDeg > 6 ? 'day' : altDeg < -6 ? 'night' : (hour < 13 ? 'dawn' : 'dusk');
  }

  return {
    update,
    info() { return out; },
    setVisible(v) { visible = !!v; skyGroup.visible = visible; },
    // handy for other modules: unit vector towards the sun (scene axes). Do not mutate.
    sunDirection: sunDir,
    sunLight: sun,
  };
}
