// Witkowo agrivoltaics 3D viewer (core). Units: metres, Y up. Scene facts and the module contract: CONTRACT.md.
// Simulation modules (lib/sky.js, power.js, water.js, growth.js) are optional: each one is imported and run inside
// try/catch, a missing or failing module is skipped and the viewer keeps working.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { t, setLang, onLang, applyDom } from './lib/i18n.js?v=202611181823';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
applyDom();
$$('.langs').forEach((g) => g.addEventListener('click', (e) => { const b = e.target.closest('button[data-lang]'); if (b) setLang(b.dataset.lang); }));

// runtime errors after the first frame: small note (before it, the bootstrap in index.html shows a full message + Retry)
const showErr = (m) => { if (!window.__boot || window.__boot.started) { const el = $('#err'); el.style.display = 'block'; el.textContent = t('err.prefix') + m; } };
addEventListener('error', (e) => { if (e.message) showErr(e.message); });
addEventListener('unhandledrejection', (e) => showErr(e.reason?.message || String(e.reason)));

// ---------------- quality tier ----------------
// low: <= 2 GB RAM, small GPUs, software GL, a slow first second (fps probe below), or ?q=low. ?q=high forces high.
// Phones start on the high tier (user asked why phones got reduced graphics); the fps probe drops them if needed.
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
const qp = new URLSearchParams(location.search).get('q');
const AUTO_KEY = 'q3dAutoLow:' + location.pathname;
const QUALITY = {
  low: qp === 'low' || (qp !== 'high' && ((!!navigator.deviceMemory && navigator.deviceMemory <= 2) || ssGet(AUTO_KEY) === '1')),
  forced: qp === 'low' || qp === 'high', software: false, gpu: '',
};
const markAutoLow = () => ssSet(AUTO_KEY, '1');
function refineQuality(r) {
  const was = QUALITY.low, gl = r.getContext();
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); QUALITY.gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) { /* hidden */ }
  QUALITY.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(QUALITY.gpu);
  if (!QUALITY.forced && (r.capabilities.maxTextureSize < 8192 || QUALITY.software)) QUALITY.low = true;
  if (QUALITY.software && !QUALITY.forced) markAutoLow();
  return QUALITY.low !== was;
}

// ---------------- renderer ----------------
const view = $('#view');
// no MSAA on the canvas: the high tier draws the scene into the composer's (non-multisampled) render target and
// only blits the result to the canvas, so a multisampled canvas cost memory + a resolve per frame for nothing;
// the low tier never had it
function makeRenderer() {
  for (const opts of [{ antialias: false, powerPreference: QUALITY.low ? 'default' : 'high-performance' }, { antialias: false, powerPreference: 'default' }]) {
    try { return new THREE.WebGLRenderer(opts); } catch (e) { console.warn('WebGL context failed', opts, e); }
  }
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#0d0d10;color:#ddd;font:15px/1.5 system-ui;z-index:99;padding:24px;text-align:center"><div style="max-width:460px"><h2 style="margin:0 0 8px;color:#d9ad57">${esc(t('gl.noneTitle'))}</h2>${esc(t('gl.none'))}</div></div>`);
  throw new Error('WebGL unavailable');
}
let renderer = makeRenderer();
if (refineQuality(renderer)) { renderer.dispose(); renderer.forceContextLoss(); renderer = makeRenderer(); }
// pixel ratio: <= 1.5 on low tier, <= 2 on high, never more than ~4.2 MP rendered
const pixelRatio = () => Math.max(1, Math.min(devicePixelRatio, QUALITY.low ? 1.5 : 2, Math.sqrt(4.2e6 / (innerWidth * innerHeight))));
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
view.appendChild(renderer.domElement);
// GPU reset: keep the page alive, show a note, reload when the context comes back (second loss within a minute -> low tier)
let glLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); glLost = true;
  if (!$('#glLost')) document.body.insertAdjacentHTML('beforeend', `<div id="glLost" style="position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:100;background:rgba(13,13,16,.92);color:#e8e0d0;font:14px/1.4 system-ui;padding:10px 16px;border-radius:8px;border:1px solid #3a3a40">${esc(t('gl.lost'))}</div>`);
  setTimeout(() => {
    const el = $('#glLost'); if (!glLost || !el) return;
    el.innerHTML = `${esc(t('gl.stopped'))} <a href="#" style="color:#d9ad57">${esc(t('gl.reloadLow'))}</a>`;
    el.querySelector('a').onclick = (ev) => { ev.preventDefault(); markAutoLow(); location.reload(); };
  }, 12000);
});
const GL_KEY = 'q3dGlLost:' + location.pathname;
renderer.domElement.addEventListener('webglcontextrestored', () => {
  const now = Date.now(), last = +ssGet(GL_KEY) || 0; ssSet(GL_KEY, now);
  if (now - last < 60000 && !QUALITY.low) markAutoLow();
  location.reload();
});
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
view.appendChild(labelRenderer.domElement);

// ---------------- scene + fallback lights ----------------
// sky.js owns sky, sun and lights. These fallback lights are removed once sky.js has added its own.
const SITE = { x0: -18, x1: 18, z0: -36, z1: 6 };
const C = new THREE.Vector3(0, 0, (SITE.z0 + SITE.z1) / 2); // (0, 0, -15)
const SIZE = Math.max(SITE.x1 - SITE.x0, SITE.z1 - SITE.z0); // 42
const scene = new THREE.Scene();
const DAY_BG = new THREE.Color(0x9fb8cf), NIGHT_BG = new THREE.Color(0x0b0f1a);
scene.background = DAY_BG.clone();
const fbHemi = new THREE.HemisphereLight(0xdfe9f5, 0x4a3f2a, 0.9);
const fbSun = new THREE.DirectionalLight(0xfff2dc, 2.4); fbSun.position.set(25, 40, 30); fbSun.target.position.copy(C);
scene.add(fbHemi, fbSun, fbSun.target);
// farmland beyond the reconstructed plot, so the site does not float in a void
const ground = new THREE.Mesh(new THREE.RingGeometry(30, 600, 64, 1), new THREE.MeshStandardMaterial({ color: 0x4d5733, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(C.x, -0.05, C.z); ground.receiveShadow = true; ground.name = 'Surroundings';
const groundIn = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), ground.material); groundIn.rotation.x = -Math.PI / 2; groundIn.position.set(C.x, -0.45, C.z);
scene.add(ground, groundIn);

// ---------------- cameras + controls ----------------
const persp = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.2, 3000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 200);
// plan: the whole site (36 x 42 m) plus a small margin fits both the height and the width of the screen
function fitOrtho() {
  const a = innerWidth / innerHeight, s = Math.max((SITE.z1 - SITE.z0) / 2 + 3, ((SITE.x1 - SITE.x0) / 2 + 1.5) / a);
  ortho.left = -s * a; ortho.right = s * a; ortho.top = s; ortho.bottom = -s; ortho.updateProjectionMatrix();
}
fitOrtho();
const orbitP = new OrbitControls(persp, renderer.domElement); orbitP.enableDamping = true; orbitP.maxPolarAngle = 1.5; orbitP.minDistance = 2.5; orbitP.maxDistance = 260;
const orbitO = new OrbitControls(ortho, renderer.domElement); orbitO.enableRotate = false; orbitO.screenSpacePanning = true; orbitO.enableDamping = true; orbitO.minZoom = 0.5; orbitO.maxZoom = 12;
orbitO.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
orbitO.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
orbitP.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
ortho.position.set(C.x, 60, C.z + 0.01); orbitO.target.copy(C); ortho.lookAt(C);
// same direction as the reference overview render (reference/Witkowo_overview.png)
const ISO_DIR = new THREE.Vector3(42, 29, 53).normalize();
// overview: pull back just far enough that every corner of the site box (x -18..18, z -36..6, y 0..5) is on
// screen with a small margin, for any aspect (portrait phones need a much longer distance than desktops)
function isoFitDist(dir = ISO_DIR, target = orbitP.target, freeFrac = 1) {
  const F = dir.clone().negate(), Rv = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize(), U = new THREE.Vector3().crossVectors(Rv, F);
  const tanV = Math.tan(THREE.MathUtils.degToRad(45 / 2)) * (matchMedia('(max-width: 820px), (max-height: 500px)').matches ? 0.8 : 0.9); // phones: top bar + HUD strip
  const tanH = Math.tan(THREE.MathUtils.degToRad(45 / 2)) * (innerWidth / innerHeight) * 0.94 * freeFrac, q = new THREE.Vector3();
  let d = 10;
  // portrait: fit the structures (canopies + cabinets), not the whole soil patch, so the farm is not tiny on phones
  const B = innerWidth < innerHeight ? { x0: -11.5, x1: 14.5, z0: -31.5, z1: 4 } : SITE;
  for (const x of [B.x0, B.x1]) for (const z of [B.z0, B.z1]) for (const y of [0, 5]) {
    q.set(x, y, z).sub(target); const fz = q.dot(F);
    d = Math.max(d, Math.abs(q.dot(Rv)) / tanH - fz, Math.abs(q.dot(U)) / tanV - fz);
  }
  return d;
}
// desktop: the side panel covers the left ~300 px, so fit the site into the free area right of it and shift the
// camera sideways so the farm is centred there (phones: the top bar does not cover the sides)
function isoHomePose() {
  const side = document.querySelector('#side')?.getBoundingClientRect();
  const left = side && innerWidth > 820 && innerHeight > 500 ? Math.min(innerWidth * 0.45, side.right + 8) : 0;
  const free = (innerWidth - left) / innerWidth;
  const target = new THREE.Vector3(C.x, 1, C.z), d = isoFitDist(ISO_DIR, target, free);
  const F = ISO_DIR.clone().negate(), Rv = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
  const halfW = d * Math.tan(THREE.MathUtils.degToRad(45 / 2)) * (innerWidth / innerHeight);
  target.addScaledVector(Rv, -(left / innerWidth) * halfW); // screen centre moves right by left/2 px
  return { target, pos: target.clone().addScaledVector(ISO_DIR, d) };
}
const isoHome = () => { const p = isoHomePose(); orbitP.target.copy(p.target); persp.position.copy(p.pos); };
isoHome();

// bloom on the high tier only; the low tier renders straight to the canvas
const composer = QUALITY.low ? null : new EffectComposer(renderer);
const renderPass = composer && new RenderPass(scene, persp);
const bloomPass = composer && new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.4, 1.1);
if (composer) { composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(new OutputPass()); }

// ---------------- model ----------------
const boot = window.__boot;
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync('./model/witkowo.glb', (e) => { if (e.total) boot?.progress?.(t('boot.model', { p: Math.round((e.loaded / e.total) * 100) })); });
const root = gltf.scene; scene.add(root);
// exact glTF node names (GLTFLoader sanitises "/" out of object.name, so look them up through the parser)
const byName = new Map(), byAlias = new Map();
{
  const json = gltf.parser.json, assoc = gltf.parser.associations;
  root.traverse((o) => {
    const a = assoc.get(o); const nm = (a && a.nodes !== undefined ? json.nodes[a.nodes]?.name : null) ?? o.userData.name;
    if (!nm) return; o.userData.nodeName = nm;
    if (!byName.has(nm)) byName.set(nm, []); byName.get(nm).push(o);
    if (o.name && o.name !== nm) { if (!byAlias.has(o.name)) byAlias.set(o.name, []); byAlias.get(o.name).push(o); }
  });
}
// exact glTF name first; the GLTFLoader-sanitised name ("Canopy_1__columns", "Cabbage_leaves_1") also works
const node = (name) => byName.get(name)?.[0] ?? byAlias.get(name)?.[0];
const nodes = (name) => byName.get(name) || byAlias.get(name) || [];
const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
const pickMeshes = [...meshes], PICK_LAYER = 3;
root.updateMatrixWorld(true);
const boxOf = (objs) => { const b = new THREE.Box3(); objs.forEach((o) => b.expandByObject(o)); return b; };
const GROUND_NODES = new Set(['Site / soil', 'Site / soil tiles', 'Grass margins', 'Cultivated rows', 'Drip irrigation']);

// ---------------- objects (sidebar list, labels, picking) ----------------
const ITEMS = [
  { id: 'canopy1', grp: 'structure', color: '#9aa6ab', desc: 'desc.canopy', match: (n) => n.startsWith('Canopy 1 / ') },
  { id: 'canopy2', grp: 'structure', color: '#9aa6ab', desc: 'desc.canopy', match: (n) => n.startsWith('Canopy 2 / ') },
  { id: 'canopy3', grp: 'structure', color: '#9aa6ab', desc: 'desc.canopy', match: (n) => n.startsWith('Canopy 3 / ') },
  { id: 'tanks', grp: 'structure', color: '#7d8a8c', desc: 'desc.tanks', match: (n) => / \/ (molded water tanks|tank reinforcement belts|tank molded ribs)$/.test(n) },
  { id: 'pv', grp: 'energy', color: '#3b5b9a', desc: 'desc.pv', live: 'power', match: (n) => / \/ (photovoltaic cells|PV frames|cell busbars)$/.test(n) },
  { id: 'jbox', grp: 'energy', color: '#f2c94c', desc: 'desc.jbox', live: 'power', match: (n) => / \/ (junction boxes|hanging leads|cable trunk|blue conduits)$/.test(n) },
  { id: 'inverters', grp: 'energy', color: '#e8e6dd', desc: 'desc.inverters', live: 'power', match: (n) => ['Electrical rack', 'Inverter cabinets', 'Inverter cooling fins', 'Electrical wiring'].includes(n) },
  { id: 'cabinet', grp: 'field', color: '#cfd3cc', desc: 'desc.cabinet', live: 'water', match: (n) => n === 'Field control cabinet' },
  { id: 'drip', grp: 'field', color: '#5fb6e8', desc: 'desc.drip', live: 'water', match: (n) => n === 'Drip irrigation' },
  { id: 'cabbage', grp: 'field', color: '#8fcf6a', desc: 'desc.cabbage', live: 'growth', match: (n) => n === 'Cabbage heads' || n === 'Cabbage leaves' },
  { id: 'film', grp: 'winter', color: '#c9dbe6', desc: 'desc.film', match: () => false }, // objs = lib/winter.js film
  { id: 'farmdroid', grp: 'field', color: '#3d9e1e', desc: 'desc.farmdroid', match: (n) => n.startsWith('FarmDroid / ') },
];
const itemById = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
for (const it of ITEMS) it.objs = [...byName.entries()].filter(([n]) => it.match(n)).flatMap(([, os]) => os);
// pick owner: specific items (PV, cables) win over the canopy that contains them
const ownerOf = new Map();
for (const it of ITEMS) for (const o of it.objs) if (!ownerOf.has(o) || ownerOf.get(o).id.startsWith('canopy')) ownerOf.set(o, it);
// highlight boxes: one per "Canopy N" / "FarmDroid" prefix group, so PV panels show three boxes, not one site-wide box
for (const it of ITEMS) {
  const groups = new Map();
  for (const o of it.objs) { const k = (o.userData.nodeName.match(/^(.+?) \/ /) || [, it.id])[1]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  it.groups = [...groups.values()];
}
const nb = (n) => boxOf(nodes(n));
function labelAnchor(it) {
  const top = (b, dy = 0.35) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + dy, (b.min.z + b.max.z) / 2);
  switch (it.id) {
    case 'canopy1': case 'canopy2': case 'canopy3': { const n = it.id.slice(-1), b = nb(`Canopy ${n} / columns`), r = nb(`Canopy ${n} / photovoltaic cells`); return new THREE.Vector3((b.min.x + b.max.x) / 2, Math.max(b.max.y, r.max.y) + 0.6, b.max.z); }
    case 'tanks': { const b = nb('Canopy 2 / molded water tanks'); return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.35, b.min.z + 2.6); }
    case 'pv': return top(nb('Canopy 3 / photovoltaic cells'), 0.4);
    case 'jbox': return top(nb('Canopy 1 / junction boxes'), 0.5);
    case 'drip': { const b = nb('Drip irrigation'); return new THREE.Vector3(b.max.x - 3.4, b.max.y + 0.3, b.min.z + 8); } // inter-row x ~ +5
    case 'cabbage': { const b = boxOf(it.objs); return new THREE.Vector3(b.min.x + 3.6, b.max.y + 0.5, b.min.z + 9); } // inter-row x ~ -5
    case 'farmdroid': return top(boxOf(it.objs), 0.35);
    default: return top(boxOf(it.objs), 0.3);
  }
}
const labelsG = new THREE.Group(); scene.add(labelsG);
const labelEls = {};
for (const it of ITEMS) {
  if (!it.objs.length) { if (it.id !== 'film') console.warn('No nodes for', it.id); continue; }
  const el = document.createElement('div'); el.className = 'label';
  el.addEventListener('click', (e) => { e.stopPropagation(); select(it, true); });
  const lab = new CSS2DObject(el); lab.position.copy(labelAnchor(it)); labelsG.add(lab);
  it.label = lab; labelEls[it.id] = el;
}

// ---------------- shared state + module context ----------------
const smallMQ = matchMedia('(max-width: 820px), (max-height: 500px)');
const sideMQ = matchMedia('(max-height: 500px) and (orientation: landscape)');
const state = {
  hour: 12, sun: 0, dayOfSeason: 60, water: 0, speed: 600,
  // winter mode (greenhouse film): season is the UI choice, winter eases 0..1 over ~4 s of real time
  season: new URLSearchParams(location.search).get('season') === 'winter' ? 'winter' : 'summer', winter: 0,
  quality: QUALITY.low ? 'low' : 'high',
  show: { power: true, water: true, labels: !smallMQ.matches },
};
state.winter = state.season === 'winter' ? 1 : 0; // ?season=winter starts in full winter
const sim = { playing: true, irrigation: 'auto', autoSeason: false, rain: 'auto', rainLevel: 0.5, simDay: 0 };
// ---------------- site (any point in Poland) ----------------
// state.site = { lat, lon, rotDeg, name, source }: default Witkowo from data/geo/site.json, or ?lat=..&lon=..&rot=..
const QS = new URLSearchParams(location.search);
const DEFAULT_SITE = await fetch('./data/geo/site.json').then((r) => r.json())
  .then((j) => ({ lat: +j.lat, lon: +j.lon, rotDeg: +j.rotDeg, name: 'Witkowo', source: 'default' }))
  .catch(() => ({ lat: 53.2886348, lon: 15.068703, rotDeg: 313, name: 'Witkowo', source: 'default' }));
const inPoland = (lat, lon) => lat > 48.9 && lat < 55 && lon > 14 && lon < 24.3;
function siteFromUrl() {
  const lat = parseFloat(QS.get('lat')), lon = parseFloat(QS.get('lon')), rot = parseFloat(QS.get('rot'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inPoland(lat, lon)) return null;
  return { lat, lon, rotDeg: Number.isFinite(rot) ? ((rot % 360) + 360) % 360 : DEFAULT_SITE.rotDeg, name: QS.get('name') || '', source: 'url' };
}
state.site = siteFromUrl() || DEFAULT_SITE;
const isDefaultSite = (st) => Math.abs(st.lat - DEFAULT_SITE.lat) < 1e-5 && Math.abs(st.lon - DEFAULT_SITE.lon) < 1e-5;
state.show.underground = false; state.undergroundScale = 'full'; state.show.rays = true;
state.realClimate = false; state.rain = 0; state.irrigationLpm = 0;
let cam = persp;
const ctx = {
  THREE, scene, root, node, renderer, getCamera: () => cam,
  // extras beyond the contract (optional for modules): all objects with a name, bloom pass (null on low tier), state
  nodes, bloom: bloomPass || null, state,
  site: state.site, // terrain / geo / underground start on this site (set again on every site change)
};
const MOD_ORDER = ['sky', 'power', 'water', 'growth', 'winter', 'rain', 'terrain', 'geo', 'underground', 'climate', 'sitedata'];
const libs = {}; // module namespaces (extra exports such as rain.js autoRain / mmhFromRain)
const mods = {};
const modErr = (name, where, e) => console.warn(`[${name}] ${where} failed, module disabled:`, e);
boot?.progress?.(t('boot.modules'));
const lightsBefore = new Set(); scene.traverse((o) => { if (o.isLight) lightsBefore.add(o); });
{
  const loaded = await Promise.all(MOD_ORDER.map((n) => import(`./lib/${n}.js${new URL(import.meta.url).search}`).then((m) => m, (e) => { console.warn(`[${n}] not loaded:`, e.message || e); return null; })));
  MOD_ORDER.forEach((n, i) => {
    const m = loaded[i]; if (!m || typeof m.init !== 'function') return;
    libs[n] = m;
    try {
      const api = m.init(ctx);
      if (api && typeof api.update === 'function') {
        mods[n] = api;
        // later modules read these from ctx: geo / underground / sitedata use the terrain, underground the site report
        if (n === 'terrain') ctx.terrain = api;
        if (n === 'sitedata') ctx.sitedata = api;
      } else console.warn(`[${n}] init returned no update()`);
    }
    catch (e) { modErr(n, 'init', e); }
  });
}
// sky.js added its own lights: drop the fallback ones
{
  let skyLights = 0; scene.traverse((o) => { if (o.isLight && !lightsBefore.has(o)) skyLights++; });
  if (mods.sky && skyLights) { scene.remove(fbHemi, fbSun, fbSun.target); }
  // sky.js draws its own ground below the horizon (dome) and fog; the fallback farmland planes would show seams
  if (mods.sky || mods.geo) { scene.remove(ground, groundIn); ground.geometry.dispose(); groundIn.geometry.dispose(); }
}
const fallbackSky = !mods.sky || fbSun.parent === scene;
function callMod(n, fn, ...args) {
  const m = mods[n]; if (!m || typeof m[fn] !== 'function') return undefined;
  try { return m[fn](...args); } catch (e) { modErr(n, fn, e); delete mods[n]; return undefined; }
}
// lib/growth.js re-parents the FarmDroid nodes into one moving Group (and replaces the merged wheel meshes by
// per-wheel copies): select / fly to / collide with that group
{
  const robot = mods.growth?.robot;
  if (robot?.isObject3D) {
    const fd = itemById.farmdroid; fd.objs = [robot]; fd.groups = [[robot]];
    robot.traverse((o) => { if (o.isMesh) ownerOf.set(o, fd); });
  }
}
// greenhouse film from lib/winter.js: listed / labelled while winter > 0.5. It is left out of picking, so a click
// goes through the film to the canopy, crops or robot behind it (the film is selected from the list or its label).
const filmObj = mods.winter?.film?.isObject3D ? mods.winter.film : null;
const filmMeshes = new Set();
if (filmObj) {
  const fi = itemById.film; fi.objs = [filmObj]; fi.groups = [[filmObj]];
  filmObj.traverse((o) => { if (o.isMesh) filmMeshes.add(o); });
  const el = document.createElement('div'); el.className = 'label';
  el.addEventListener('click', (e) => { e.stopPropagation(); select(fi, true); });
  const lab = new CSS2DObject(el); lab.position.set(0, 5.6, 0.4); lab.visible = false; labelsG.add(lab);
  fi.label = lab; labelEls.film = el;
}
const filmOn = () => state.winter > 0.5;
// pick list: every model mesh, including meshes the modules added under root (unknown ones only occlude)
pickMeshes.length = 0; root.traverse((o) => { if (o.isMesh && !filmMeshes.has(o)) { pickMeshes.push(o); o.layers.enable(PICK_LAYER); } });
callMod('power', 'setVisible', state.show.power);
callMod('water', 'setVisible', state.show.water);
// performance, same pixels:
// - static model meshes: no per-frame matrix recompose (the FarmDroid subtree moves, so it keeps auto update)
// - additive, non-depth-writing, double-sided transparent materials (power ripples, sun rays): one pass instead of
//   three.js' back-then-front double pass. Additive blending is order independent, so the image is identical, and
//   the double pass bumped material.version twice per draw (program lookup on every frame).
{
  const robotSub = new Set(); mods.growth?.robot?.traverse?.((o) => robotSub.add(o));
  for (const m of meshes) if (!robotSub.has(m) && m.parent === root) { m.updateMatrix(); m.matrixAutoUpdate = false; }
  scene.traverse((o) => [].concat(o.material || []).forEach((m) => {
    if (m.transparent && m.side === THREE.DoubleSide && m.blending === THREE.AdditiveBlending && !m.depthWrite) m.forceSinglePass = true;
  }));
}
// Draw batches: static structure parts that share a material, an owner item (sidebar / picking) and a parent are
// drawn as one merged mesh instead of one draw call per glTF node (canopy steel 8 -> 1 per canopy, tanks 9 -> 1,
// cables 9 -> 1, robot chassis 5 -> 1 ...; about half of all draw calls). The original nodes stay in the scene
// exactly as before (names, node(), bounding boxes, picking on PICK_LAYER, world matrices for labels); they are only
// taken off camera layer 0, so the camera and the shadow pass draw the batch instead. If anything later hides one of
// them or swaps its material, its batch is dissolved and the originals are drawn again (syncBatches).
const BATCH_NODES = /^(Canopy \d \/ (columns|feet|anchors|knee braces|longitudinal braces|molded water tanks|tank reinforcement belts|tank molded ribs|blue conduits|connection plates|bolts|cross girders|longitudinal girders|cable trunk|PV frames|cell busbars|junction boxes|hanging leads|roof tension rods)|FarmDroid \/ (main body|lower battery|green roof rim|axle|wheel arms|control console|cultivation arms|tool discs|seed hopper|GNSS mast|GNSS antenna))$/;
const batches = [];
function buildBatches() {
  const groups = new Map();
  for (const m of meshes) {
    const nm = m.userData.nodeName;
    if (!BATCH_NODES.test(nm) || !m.visible || !m.parent || Array.isArray(m.material) || m.isInstancedMesh || m.isSkinnedMesh) continue;
    const it = ownerOf.get(m), k = `${m.parent.uuid}|${it ? it.id : '-'}|${m.material.uuid}|${/cell busbars|roof solar grid/.test(nm) ? 'nc' : 'c'}`;
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m);
  }
  const v = new THREE.Vector3(), rel = new THREE.Matrix4(), inv = new THREE.Matrix4(), nmat = new THREE.Matrix3();
  for (const src of groups.values()) {
    if (src.length < 2) continue;
    const parent = src[0].parent; parent.updateWorldMatrix(true, true); inv.copy(parent.matrixWorld).invert();
    let nv = 0, ni = 0;
    for (const m of src) { const g = m.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const m of src) {
      const g = m.geometry, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
      rel.multiplyMatrices(inv, m.matrixWorld); nmat.getNormalMatrix(rel);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(rel); P[(vo + i) * 3] = v.x; P[(vo + i) * 3 + 1] = v.y; P[(vo + i) * 3 + 2] = v.z;
        if (nor) { v.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize(); N[(vo + i) * 3] = v.x; N[(vo + i) * 3 + 1] = v.y; N[(vo + i) * 3 + 2] = v.z; }
      }
      if (idx) for (let i = 0; i < idx.count; i++) I[io++] = idx.getX(i) + vo; else for (let i = 0; i < pos.count; i++) I[io++] = i + vo;
      vo += pos.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const b = new THREE.Mesh(geo, src[0].material);
    b.name = 'Batch / ' + src.map((m) => m.userData.nodeName).join(', ');
    b.userData.batchOf = src; b.userData.canCast = !/cell busbars|roof solar grid/.test(src[0].userData.nodeName);
    b.renderOrder = src[0].renderOrder;
    parent.add(b); b.updateMatrix(); b.matrixAutoUpdate = parent === root ? false : b.matrixAutoUpdate;
    for (const m of src) m.layers.disable(0);
    batches.push(b);
  }
}
// x-ray (translucent, sorted per object back to front): draw the original nodes again so the blend order and
// layering stay exactly as they were; the batches are for the opaque look
function setBatchesActive(on) {
  for (const b of batches) { b.visible = on; for (const m of b.userData.batchOf) { if (on) m.layers.disable(0); else m.layers.enable(0); } }
  ctx.invalidateShadows?.();
}
function dissolveBatch(b) {
  for (const m of b.userData.batchOf) m.layers.enable(0);
  b.removeFromParent(); b.geometry.dispose(); batches.splice(batches.indexOf(b), 1);
  ctx.invalidateShadows?.();
}
function syncBatches() {
  for (let i = batches.length - 1; i >= 0; i--) {
    const b = batches[i];
    if (b.userData.batchOf.some((m) => !m.visible || m.material !== b.material || !m.parent)) dissolveBatch(b);
  }
}
try { buildBatches(); } catch (e) { console.warn('draw batching skipped:', e); for (const b of [...batches]) dissolveBatch(b); }

// fallback sun (sky.js missing): sunrise 6, sunset 20, max altitude ~60 deg (lat 53.4 N, summer); south = +z
const _sunDir = new THREE.Vector3();
let fbAlt = 0;
function fallbackSkyUpdate() {
  const h = state.hour, s = Math.sin(Math.PI * (h - 6) / 14);
  state.sun = Math.max(0, s); fbAlt = 60 * s;
  if (fbSun.parent !== scene) return;
  const alt = Math.max(0.05, s) * (Math.PI / 3), az = ((h - 13) / 7) * (Math.PI / 2);
  _sunDir.set(-Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));
  fbSun.position.copy(C).addScaledVector(_sunDir, 80);
  fbSun.intensity = 2.6 * state.sun; fbHemi.intensity = 0.18 + 0.7 * state.sun;
  scene.background.copy(NIGHT_BG).lerp(DAY_BG, clamp(s * 2 + 0.3, 0, 1));
}

// ---------------- modes ----------------
let mode = 'iso', isoPose = null, tween = null, camTouched = false;
const EYE = 1.7, R_WALK = 0.3;
const walk = { yaw: 0, pitch: -0.04, keys: new Set(), x: -5, z: 4.5, joy: { x: 0, y: 0 } };
let touchSeen = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', touchSeen);
let labelsDirty = true;
function setHint() {
  const k = mode === 'walk' ? 'walk' : mode === 'top' ? 'top' : 'iso';
  $('#hint').innerHTML = t('hint.' + k + (touchSeen ? 'Touch' : ''));
}
function setMode(m) {
  const prev = mode;
  if (prev === 'iso' && m !== 'iso') isoPose = { p: persp.position.clone(), t: orbitP.target.clone() };
  if (m !== prev) tween = null;
  mode = m;
  $$('#modes button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-pressed', b.dataset.mode === m); });
  cam = m === 'top' ? ortho : persp; if (renderPass) renderPass.camera = cam;
  orbitO.enabled = m === 'top'; orbitP.enabled = m === 'iso';
  if (m === 'walk') { persp.rotation.order = 'YXZ'; if (blocked(walk.x, walk.z)) [walk.x, walk.z] = freeNear(walk.x, walk.z); }
  else if (m === 'iso' && prev === 'walk' && isoPose) { persp.position.copy(isoPose.p); orbitP.target.copy(isoPose.t); persp.lookAt(orbitP.target); }
  persp.fov = m === 'walk' ? 70 : 45; persp.updateProjectionMatrix();
  document.body.classList.toggle('walk', m === 'walk'); walk.joy.x = walk.joy.y = 0; labelsDirty = true;
  setHint();
  if (touchSeen) { const h = $('#hint'); h.classList.remove('fade'); clearTimeout(setMode.t); setMode.t = setTimeout(() => h.classList.add('fade'), 5000); }
}
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setMode(b.dataset.mode); if (smallMQ.matches && $('#drawer').classList.contains('open')) setDrawer(false); });

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function flyTo(target, dist, zoom) {
  camTouched = true;
  if (mode === 'top') tween = { k: 0, d: 0.7, from: orbitO.target.clone(), to: target.clone().setY(0), z0: ortho.zoom, z1: zoom, top: true };
  else if (mode === 'iso') {
    const dir = persp.position.clone().sub(orbitP.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
    tween = { k: 0, d: 0.8, from: orbitP.target.clone(), to: target.clone(), p0: persp.position.clone(), p1: target.clone().addScaledVector(dir, dist) };
  }
}
function stepTween(dt) {
  if (!tween) return; tween.k = Math.min(1, tween.k + dt / tween.d); const k = ease(tween.k);
  if (tween.top) { const p = tween.from.clone().lerp(tween.to, k); orbitO.target.copy(p); ortho.position.set(p.x, 60, p.z + 0.01); ortho.zoom = tween.z0 + (tween.z1 - tween.z0) * k; ortho.updateProjectionMatrix(); }
  else { orbitP.target.copy(tween.from).lerp(tween.to, k); persp.position.copy(tween.p0).lerp(tween.p1, k); }
  if (tween.k >= 1) tween = null;
}

// ---------------- walk-mode collision ----------------
// Axis-aligned footprints (x0, z0, x1, z1) of everything at body height. Columns and water tanks are merged into one
// mesh per canopy, so they are split back into pieces by gaps along z (clusterBoxes): one box per central column
// and per moulded tank (+ its belts / ribs). Plus the inverter rack, the field cabinet and the FarmDroid robot
// (its box is refreshed while lib/growth.js drives it around).
const colliders = [];
const addBox = (b, m = 0) => colliders.push({ x0: b.min.x - m, z0: b.min.z - m, x1: b.max.x + m, z1: b.max.z + m });
function clusterBoxes(objs, gap = 0.2, maxY = 2.2) {
  const pts = [], v = new THREE.Vector3();
  for (const o of objs) {
    if (!o.isMesh) continue; o.updateWorldMatrix(true, false);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.y <= maxY) pts.push(v.x, v.z); }
  }
  const idx = []; for (let i = 0; i < pts.length; i += 2) idx.push(i);
  idx.sort((a, b) => pts[a + 1] - pts[b + 1]);
  const out = []; let cur = null, lastZ = -Infinity;
  for (const i of idx) {
    const x = pts[i], z = pts[i + 1];
    if (!cur || z - lastZ > gap) { cur = new THREE.Box3(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 0, z)); out.push(cur); }
    else { cur.min.x = Math.min(cur.min.x, x); cur.max.x = Math.max(cur.max.x, x); cur.max.z = z; }
    lastZ = z;
  }
  return out;
}
for (const n of [1, 2, 3]) {
  for (const b of clusterBoxes(nodes(`Canopy ${n} / columns`))) addBox(b, 0.02);
  for (const b of clusterBoxes(['molded water tanks', 'tank reinforcement belts', 'tank molded ribs'].flatMap((k) => nodes(`Canopy ${n} / ${k}`)))) addBox(b, 0.02);
}
for (const n of ['Electrical rack', 'Field control cabinet']) { const b = nb(n); if (!b.isEmpty()) addBox(b, 0.05); }
{ const b = boxOf([...nodes('Inverter cabinets'), ...nodes('Electrical wiring')]); if (!b.isEmpty()) addBox(b, 0.05); }
const robotCol = { x0: 0, z0: 0, x1: 0, z1: 0 }; colliders.push(robotCol);
function refreshRobot() { const b = boxOf(itemById.farmdroid.objs); if (b.isEmpty()) return; robotCol.x0 = b.min.x; robotCol.z0 = b.min.z; robotCol.x1 = b.max.x; robotCol.z1 = b.max.z; }
refreshRobot();
let winterWalls = null; // lib/winter.js colliders while info().filmDeployed > 0.5 (set in the HUD tick)
function blocked(x, z, r = R_WALK) {
  if (x < SITE.x0 + r || x > SITE.x1 - r || z < SITE.z0 + r || z > SITE.z1 - r) return true;
  for (const c of colliders) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  // greenhouse walls (with door gaps) once the film is up
  if (winterWalls) for (const c of winterWalls) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  return false;
}
function freeNear(x, z) {
  for (let r = 0; r <= 12; r += 0.25) for (let k = 0, n = r ? 24 : 1; k < n; k++) {
    const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (!blocked(px, pz)) return [px, pz];
  }
  return [x, z];
}
function tryMove(dx, dz) {
  const { x, z } = walk;
  if (!blocked(x + dx, z + dz)) { walk.x += dx; walk.z += dz; return true; }
  if (dx && !blocked(x + dx, z)) { walk.x += dx; return true; } // slide along the obstacle
  if (dz && !blocked(x, z + dz)) { walk.z += dz; return true; }
  if (blocked(x, z)) { walk.x += dx; walk.z += dz; return true; } // started inside an obstacle (robot drove in, walls went up): let the walker out
  return false;
}
function stepWalk(dt) {
  const k = walk.keys, sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? 4.2 : 1.6) * dt;
  let f = -walk.joy.y, s = walk.joy.x;
  if (k.has('KeyW') || k.has('ArrowUp')) f += 1; if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) s += 1; if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
  const m = Math.hypot(f, s); if (m > 1.8) { f *= 1.8 / m; s *= 1.8 / m; }
  const sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
  const dx = (-sy * f + cy * s) * sp, dz = (-cy * f - sy * s) * sp, n = Math.ceil(Math.hypot(dx, dz) / 0.08);
  for (let i = 0; i < n; i++) if (!tryMove(dx / n, dz / n)) break;
  persp.position.set(walk.x, EYE, walk.z); persp.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
}
// where to stand to look at an object: in front of it (+z, the entrance side), else toward the walker, else around it
function walkSpotFor(b) {
  const c = b.getCenter(new THREE.Vector3()), hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2;
  const toMe = Math.atan2(walk.x - c.x, walk.z - c.z);
  for (const a of [0, toMe, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI]) {
    const ux = Math.sin(a), uz = Math.cos(a);
    const ext = Math.min(Math.abs(ux) > 1e-3 ? hx / Math.abs(ux) : Infinity, Math.abs(uz) > 1e-3 ? hz / Math.abs(uz) : Infinity);
    for (const extra of [2.2, 3.2, 4.5]) { const x = c.x + ux * (ext + extra), z = c.z + uz * (ext + extra); if (!blocked(x, z)) return [x, z]; }
  }
  return freeNear(c.x, b.max.z + 2);
}

// ---------------- sidebar: objects ----------------
function renderList() {
  let html = '', grp = null;
  for (const it of ITEMS) {
    if (!it.objs.length) continue;
    if (it.grp !== grp) { grp = it.grp; html += `<li class="grp">${esc(t('grp.' + grp))}</li>`; }
    const off = it.id === 'film' && !filmOn();
    html += `<li class="item${selected === it ? ' on' : ''}${off ? ' off' : ''}" data-id="${it.id}" tabindex="${off ? -1 : 0}" role="button"${off ? ' aria-disabled="true"' : ''}><span class="dot" style="background:${it.color}"></span>${esc(t('obj.' + it.id))}${off ? `<span class="sub2">${esc(t('film.off'))}</span>` : ''}</li>`;
  }
  $('#objects').innerHTML = html;
  for (const it of ITEMS) if (labelEls[it.id]) labelEls[it.id].textContent = t('obj.' + it.id);
}
$('#objects').addEventListener('click', (e) => { const li = e.target.closest('li.item'); if (li && !li.classList.contains('off')) select(itemById[li.dataset.id], true); });
$('#objects').addEventListener('keydown', (e) => { const li = e.target.closest('li.item'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); li.click(); } });

// ---------------- small screens: drawer + bottom sheets ----------------
function syncSheets() {
  const d = $('#drawer').classList.contains('open'), p = $('#panel').classList.contains('open');
  document.body.classList.toggle('drawer', d); document.body.classList.toggle('sheet', smallMQ.matches && (d || p));
  // desktop: an open info / report panel and the HUD share the right edge, so the HUD shrinks to its key rows
  document.body.classList.toggle('panelopen', p && !smallMQ.matches);
  const hud = $('#hud'); if (hud && !smallMQ.matches) document.documentElement.style.setProperty('--hudh', hud.offsetHeight + 'px');
}
function setDrawer(open) {
  $('#drawer').classList.toggle('open', open); $('#menuBtn').setAttribute('aria-expanded', open);
  if (open && $('#panel').classList.contains('open') && !sideMQ.matches) select(null);
  syncSheets();
}
$('#menuBtn').addEventListener('click', () => setDrawer(!$('#drawer').classList.contains('open')));
smallMQ.addEventListener('change', () => { if (!smallMQ.matches) setDrawer(false); syncSheets(); });
function sheetDrag(sheet, handleSel, close) {
  let s = null;
  sheet.addEventListener('pointerdown', (e) => {
    if (!smallMQ.matches || sideMQ.matches || e.target.closest('button, a, input') || !e.target.closest(handleSel)) return;
    s = { id: e.pointerId, y: e.clientY, dy: 0, t: performance.now() }; sheet.classList.add('drag'); sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener('pointermove', (e) => { if (!s || e.pointerId !== s.id) return; s.dy = Math.max(0, e.clientY - s.y); sheet.style.transform = `translateY(${s.dy}px)`; });
  const end = (e) => {
    if (!s || e.pointerId !== s.id) return; sheet.classList.remove('drag'); sheet.style.transform = '';
    const fast = s.dy / Math.max(1, performance.now() - s.t) > 0.5; if (s.dy > 90 || (fast && s.dy > 30)) close(); s = null;
  };
  sheet.addEventListener('pointerup', end); sheet.addEventListener('pointercancel', end);
}
sheetDrag($('#drawer'), '.grab', () => setDrawer(false));
sheetDrag($('#panel'), '.grab, .top', () => select(null));

// ---------------- selection + info panel ----------------
let selected = null;
const selG = new THREE.Group(); scene.add(selG);
const selHelpers = [];
function selBoxes() {
  if (!selected) return;
  selected.groups.forEach((g, i) => {
    let h = selHelpers[i];
    if (!h) { h = new THREE.Box3Helper(new THREE.Box3(), 0xd9ad57); h.material.depthTest = false; h.material.transparent = true; h.material.opacity = 0.9; h.renderOrder = 10; selG.add(h); selHelpers[i] = h; }
    h.box.makeEmpty(); g.forEach((o) => h.box.expandByObject(o)); h.box.expandByScalar(0.05); h.visible = true;
  });
  for (let i = selected.groups.length; i < selHelpers.length; i++) selHelpers[i].visible = false;
}
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? t('hud.na') : Number(v).toFixed(d).replace('.', document.documentElement.lang === 'en' ? '.' : ','));
function liveHtml(it) {
  if (it.live === 'power') { const i = info.power; return i ? `${fmt(i.kW)} ${t('unit.kw')} · ${fmt(i.kWhToday)} ${t('unit.kwh')}` : null; }
  if (it.live === 'water') { const i = info.water; return i ? `${fmt(i.lpm)} ${t('unit.lpm')} · ${fmt(i.litresToday, 0)} ${t('unit.l')}` : null; }
  if (it.live === 'growth') { const i = info.growth; return i ? `${esc(stageName(i.stage))} · Ø ${fmt(i.headDiameterCm, 0)} ${t('unit.cm')}` : null; }
  return null;
}
function renderPanel() {
  const it = selected, panel = $('#panel'); if (!it) return;
  const b = boxOf(it.objs), sz = b.getSize(new THREE.Vector3()), live = liveHtml(it);
  const liveLabel = { power: t('hud.pv'), water: t('hud.water'), growth: t('hud.crop') }[it.live];
  panel.innerHTML = `<div class="grab" aria-hidden="true"></div>
    <div class="top"><div><div class="eyebrow">${esc(t('grp.' + it.grp))}</div><h3>${esc(t('obj.' + it.id))}</h3></div><button type="button" class="close" id="pclose">${esc(t('close'))}</button></div>
    <p>${esc(t(it.desc))}</p>
    ${live != null ? `<div class="prop"><b>${esc(liveLabel)}</b><span id="plive">${live}</span></div>` : ''}
    <div class="prop"><b>${esc(t('prop.size'))}</b>${fmt(sz.x)} × ${fmt(sz.z)} m, h ${fmt(sz.y)} m</div>
    <p class="est">${esc(t('est'))}</p>`;
  $('#pclose').onclick = () => select(null);
}
function select(it, fly = false) {
  selected = it || null; const panel = $('#panel');
  Object.entries(labelEls).forEach(([id, el]) => el.classList.toggle('on', !!it && id === it.id));
  $$('#objects li.item').forEach((li) => li.classList.toggle('on', !!it && li.dataset.id === it.id));
  if (!it) { selHelpers.forEach((h) => (h.visible = false)); panel.classList.remove('open', 'wide'); panel.dataset.kind = ''; syncSheets(); return; }
  panel.dataset.kind = 'item'; panel.classList.remove('wide');
  if (smallMQ.matches) setDrawer(false); // landscape phones too: drawer + panel together would hide the scene
  selBoxes(); renderPanel(); panel.classList.add('open'); panel.scrollTop = 0; syncSheets();
  if (fly) {
    const b = boxOf(it.objs), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3()), big = Math.max(sz.x, sz.z, sz.y);
    if (mode === 'walk') {
      const [x, z] = walkSpotFor(b), d = Math.hypot(x - c.x, z - c.z) || 1;
      walk.x = x; walk.z = z; walk.yaw = Math.atan2(x - c.x, z - c.z); walk.pitch = clamp(Math.atan2(c.y - EYE, d), -0.8, 0.5);
    } else if (mode === 'top') flyTo(c, 0, clamp((SIZE * 1.2) / (Math.max(sz.x, sz.z) * 1.5), 1, 8));
    else flyTo(c, clamp(big * 1.25 + 3, 7, 75));
  }
}

// ---------------- picking (GPU id buffer: exact, and cheap on the 1.1 M-vertex triangle soup) ----------------
const pickRT = new THREE.WebGLRenderTarget(1, 1);
const pickBuf = new Uint8Array(4);
const pickMats = ITEMS.map((it, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB((i + 1) * 20 / 255, 0, 0, THREE.LinearSRGBColorSpace), toneMapped: false, side: THREE.DoubleSide }));
const occluder = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: THREE.DoubleSide });
function pickAt(x, y) {
  const c = cam, bg = scene.background, au = renderer.shadowMap.autoUpdate, nu = renderer.shadowMap.needsUpdate, mask = c.layers.mask, saved = [];
  const list = pickMeshes.filter((m) => m.visible && m.material); // growth.js hides the original merged wheel meshes
  for (const m of list) { saved.push(m.material); const it = ownerOf.get(m); m.material = it ? pickMats[ITEMS.indexOf(it)] : occluder; }
  scene.background = null; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; c.layers.set(PICK_LAYER);
  c.setViewOffset(innerWidth, innerHeight, Math.floor(x), Math.floor(y), 1, 1);
  const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearAlpha();
  try {
    renderer.setRenderTarget(pickRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, c);
    renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
  } finally {
    renderer.setRenderTarget(prevRT); renderer.setClearAlpha(prevClear);
    c.clearViewOffset(); c.layers.mask = mask; scene.background = bg; renderer.shadowMap.autoUpdate = au; renderer.shadowMap.needsUpdate = nu;
    list.forEach((m, i) => (m.material = saved[i]));
  }
  const idx = Math.round(pickBuf[0] / 20) - 1;
  return pickBuf[3] > 0 && idx >= 0 && idx < ITEMS.length ? ITEMS[idx] : null;
}
// labels have pointer-events:none on small screens (never block gestures): taps are hit-tested here
function labelAt(x, y) {
  if (!labelsG.visible) return null;
  const pad = touchSeen ? 10 : 2; let best = null, bd = Infinity;
  for (const [id, el] of Object.entries(labelEls)) {
    const r = el.getBoundingClientRect(); if (!r.width || el.style.display === 'none') continue;
    if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
    const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2); if (d < bd) { bd = d; best = id; }
  }
  return best && itemById[best];
}
let down = null; const activePtrs = new Set();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !touchSeen) { touchSeen = true; document.body.classList.add('touch'); setHint(); }
  if (e.isPrimary) activePtrs.clear();
  activePtrs.add(e.pointerId);
  if (activePtrs.size > 1) { if (down) down.multi = true; return; }
  down = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: walk.yaw, pitch: walk.pitch, touch: e.pointerType === 'touch', moved: 0 };
  if (mode === 'walk') renderer.domElement.setPointerCapture(e.pointerId);
  tween = null; camTouched = true;
});
const endPtr = (e) => {
  activePtrs.delete(e.pointerId);
  if (!down || e.pointerId !== down.id) return;
  const tap = !down.multi && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < (down.touch ? 10 : 5) && down.moved < (down.touch ? 14 : 8);
  if (tap && e.target === renderer.domElement) { select(labelAt(e.clientX, e.clientY) || pickAt(e.clientX, e.clientY)); if (smallMQ.matches && $('#drawer').classList.contains('open')) setDrawer(false); }
  down = null;
};
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr);
const tip = $('#tip'); let hoverT = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (down && e.pointerId === down.id) {
    down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
    if (mode === 'walk' && !down.multi) { const sens = down.touch ? 0.006 : 0.004; walk.yaw = down.yaw - (e.clientX - down.x) * sens; walk.pitch = clamp(down.pitch - (e.clientY - down.y) * sens, -1.3, 1.3); }
  }
  if (e.pointerType === 'touch') return;
  const now = performance.now(); if (down || now - hoverT < 90) return; hoverT = now;
  const it = pickAt(e.clientX, e.clientY); renderer.domElement.style.cursor = it ? 'pointer' : '';
  if (it) { tip.textContent = t('obj.' + it.id); tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 12 + 'px'; tip.style.opacity = 1; }
  else tip.style.opacity = 0;
});
renderer.domElement.addEventListener('wheel', () => { camTouched = true; }, { passive: true });
renderer.domElement.addEventListener('pointerleave', () => (tip.style.opacity = 0));
addEventListener('keydown', (e) => {
  if (!e.target.matches?.('input[type=text], input[type=search], textarea, select')) walk.keys.add(e.code);
  if (e.key === 'Escape') {
    if ($('#drawer').classList.contains('open')) { setDrawer(false); $('#menuBtn').focus(); }
    else if (selected) select(null);
  }
});
addEventListener('keyup', (e) => walk.keys.delete(e.code));
addEventListener('blur', () => walk.keys.clear());
// walk-mode virtual joystick (touch)
{
  const joy = $('#joy'), knob = joy.querySelector('.knob'); let jid = null, c = null;
  const upd = (e) => {
    const R = joy.offsetWidth / 2 - 10; let dx = e.clientX - c.x, dy = e.clientY - c.y; const L = Math.hypot(dx, dy);
    if (L > R) { dx *= R / L; dy *= R / L; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, L / R), dead = 0.12, g = m < dead ? 0 : ((m - dead) / (1 - dead)) * (m > 0.95 ? 1.8 : 1.15) / (m || 1);
    walk.joy.x = dx / R * g; walk.joy.y = dy / R * g;
  };
  joy.addEventListener('pointerdown', (e) => { e.preventDefault(); jid = e.pointerId; joy.setPointerCapture(jid); const r = joy.getBoundingClientRect(); c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; upd(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) upd(e); });
  const rel = (e) => { if (e.pointerId !== jid) return; jid = null; walk.joy.x = walk.joy.y = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', rel); joy.addEventListener('pointercancel', rel); joy.addEventListener('lostpointercapture', rel);
}

// ---------------- simulation controls ----------------
const ICON_PLAY = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z" fill="currentColor"/></svg>';
const rClock = $('#rClock'), rGrowth = $('#rGrowth');
const hhmm = (h) => { const m = Math.floor(((h % 24) + 24) % 24 * 60); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const fillRange = (r) => r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
let clockDrag = false, growthDrag = false;
function syncPlay() {
  const b = $('#bPlay'); b.innerHTML = sim.playing ? ICON_PAUSE : ICON_PLAY; b.classList.toggle('on', sim.playing);
  b.setAttribute('aria-pressed', sim.playing); b.setAttribute('aria-label', t(sim.playing ? 'sim.pause' : 'sim.play')); b.title = t(sim.playing ? 'sim.pause' : 'sim.play');
}
function syncClock() { if (!clockDrag) rClock.value = state.hour.toFixed(2); fillRange(rClock); $('#vClock').textContent = hhmm(state.hour); }
function syncGrowth() { if (!growthDrag) rGrowth.value = state.dayOfSeason.toFixed(1); fillRange(rGrowth); $('#vGrowth').textContent = Math.round(state.dayOfSeason) + '%'; }
$('#bPlay').addEventListener('click', () => { sim.playing = !sim.playing; syncPlay(); });
rClock.addEventListener('input', () => { clockDrag = true; state.hour = +rClock.value; syncClock(); });
rClock.addEventListener('change', () => { clockDrag = false; });
rClock.addEventListener('pointerup', () => { clockDrag = false; });
rGrowth.addEventListener('input', () => { growthDrag = true; state.dayOfSeason = +rGrowth.value; syncGrowth(); });
rGrowth.addEventListener('change', () => { growthDrag = false; });
rGrowth.addEventListener('pointerup', () => { growthDrag = false; });
$('#speeds').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-s]'); if (!b) return; state.speed = +b.dataset.s;
  $$('#speeds button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#tSeason').addEventListener('change', (e) => { sim.autoSeason = e.target.checked; });
$('#irr').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-irr]'); if (!b) return; sim.irrigation = b.dataset.irr;
  $$('#irr button').forEach((x) => x.classList.toggle('on', x === b));
});
// summer: 5-7 and 19-21; winter (greenhouse): 10-11 only
const irrSchedule = (h) => (state.season === 'winter' ? h >= 10 && h < 11 : (h >= 5 && h < 7) || (h >= 19 && h < 21));
function syncSeason() {
  $$('#seasons button').forEach((b) => { const on = b.dataset.season === state.season; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const h = $('#irrHint'); h.dataset.i18n = state.season === 'winter' ? 'irr.autoHintWinter' : 'irr.autoHint'; h.textContent = t(h.dataset.i18n);
}
$('#seasons').addEventListener('click', (e) => { const b = e.target.closest('button[data-season]'); if (!b) return; state.season = b.dataset.season; syncSeason(); });
syncSeason();
$('#tPower').addEventListener('change', (e) => { state.show.power = e.target.checked; callMod('power', 'setVisible', state.show.power); syncLegend(); });
$('#tWater').addEventListener('change', (e) => { state.show.water = e.target.checked; callMod('water', 'setVisible', state.show.water); syncLegend(); });
$('#tLabels').checked = state.show.labels; labelsG.visible = state.show.labels;
$('#tLabels').addEventListener('change', (e) => { state.show.labels = labelsG.visible = e.target.checked; labelsDirty = true; });

// ---------------- flows: x-ray focus, legend, camera presets ----------------
// X-ray: every model material (root + greenhouse film; the power / water overlays live in their own groups on the
// scene) is greyed, dimmed and made translucent in place, so shader patches (growth.js vertex scaling) keep working
// and nothing recompiles. The original values are stored and written back when the toggle goes off.
const XRAY = { on: false, saved: new Map() };
const _grey = new THREE.Color();
function xrayMaterials() {
  const set = new Set();
  const add = (o) => o.traverse((m) => { if (m.isMesh || m.isLine || m.isPoints) [].concat(m.material || []).forEach((mm) => set.add(mm)); });
  add(root); if (filmObj) add(filmObj);
  for (const g of [mods.power?.group, mods.water?.group]) if (g) g.traverse((m) => [].concat(m.material || []).forEach((mm) => set.delete(mm)));
  return set;
}
function setXray(on) {
  if (on === XRAY.on) return; XRAY.on = on;
  setBatchesActive(!on);
  if (on) {
    for (const m of xrayMaterials()) {
      XRAY.saved.set(m, { color: m.color?.clone(), emissive: m.emissive?.clone(), ei: m.emissiveIntensity, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite, fsp: m.forceSinglePass });
      if (m.color) { const l = m.color.r * 0.3 + m.color.g * 0.59 + m.color.b * 0.11; m.color.copy(_grey.setScalar(0.12 + l * 0.35)); }
      if (m.emissive) m.emissive.setScalar(0);
      m.opacity = Math.min(m.opacity, 0.22); m.transparent = true; m.depthWrite = false;
      // one pass for the double-sided model materials: three's transparent double-sided path draws every mesh
      // twice (back, then front) and flags the material for a program lookup before each of the two draws, which
      // made x-ray cost ~4x the CPU of the normal view. Grey at 22 % opacity looks the same in either order.
      m.forceSinglePass = true;
      m.needsUpdate = true; // 'transparent' is part of the program (OPAQUE define): re-resolve the program once
    }
  } else {
    for (const [m, v] of XRAY.saved) {
      if (v.color) m.color.copy(v.color); if (v.emissive) m.emissive.copy(v.emissive);
      m.emissiveIntensity = v.ei; m.opacity = v.opacity; m.transparent = v.transparent; m.depthWrite = v.depthWrite; m.forceSinglePass = v.fsp; m.needsUpdate = true;
    }
    XRAY.saved.clear();
  }
  $('#tFlows').checked = on; syncLegend();
}
function syncLegend() {
  const hud = $('#hud'); if (!hud) return;
  hud.classList.toggle('flows', state.show.power || state.show.water);
  $('#lgDC')?.classList.toggle('off', !state.show.power); $('#lgAC')?.classList.toggle('off', !state.show.power);
  $('#lgW')?.classList.toggle('off', !state.show.water);
}
$('#tFlows').addEventListener('change', (e) => setXray(e.target.checked));
// camera presets that show each network best (overview mode)
const FLOW_VIEWS = {
  power: { target: new THREE.Vector3(-8, 2.6, -5), pos: new THREE.Vector3(-23, 11, 13) },  // inverter corner, front left
  water: { target: new THREE.Vector3(1, 0, -13), pos: new THREE.Vector3(2, 30, 9) },       // high above the beds
};
function flyToFlow(k) {
  const v = FLOW_VIEWS[k]; if (!v) return;
  const box = k === 'power' ? $('#tPower') : $('#tWater');
  if (!box.checked) { box.checked = true; box.dispatchEvent(new Event('change')); }
  if (mode !== 'iso') setMode('iso');
  camTouched = true;
  tween = { k: 0, d: 1.0, from: orbitP.target.clone(), to: v.target.clone(), p0: persp.position.clone(), p1: v.pos.clone() };
  if (smallMQ.matches) setDrawer(false);
}
$$('.tog .fly').forEach((el) => {
  el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); flyToFlow(el.dataset.fly); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flyToFlow(el.dataset.fly); } });
});

// ---------------- sun shadows (high tier; off and hidden on the low tier) ----------------
function sunLights() { const out = []; scene.traverse((o) => { if (o.isDirectionalLight && o.visible) out.push(o); }); return out; }
// detail that sits flat on a bigger caster (contact lines on the PV cells / robot roof, lugs on the tyres): its
// shadow is inside that caster's shadow or below one shadow-map texel (~3 cm), so it is left out of the shadow pass
// (Canopy busbars alone are 207 k of the model's 1 M vertices). It still receives shadows.
const NO_CAST = /^(Canopy \d \/ cell busbars|FarmDroid \/ roof solar grid|FarmDroid \/ tire lugs)$/;
function applyShadows(on) {
  renderer.shadowMap.enabled = on; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  for (const L of sunLights()) {
    L.castShadow = on;
    if (on && L.shadow.camera.right === 5) { // untouched defaults: cover the whole site (~80 x 80 m)
      const sc = L.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 0.5; sc.far = 400; sc.updateProjectionMatrix();
      L.shadow.mapSize.set(2048, 2048); L.shadow.bias = -0.0004; L.shadow.normalBias = 0.04;
      L.shadow.map?.dispose(); L.shadow.map = null;
    }
  }
  for (const m of meshes) { m.castShadow = on && !GROUND_NODES.has(m.userData.nodeName) && !NO_CAST.test(m.userData.nodeName); m.receiveShadow = on; }
  for (const b of batches) { b.castShadow = on && b.userData.canCast; b.receiveShadow = on; }
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((mm) => (mm.needsUpdate = true)); });
  SHADOW.force = true;
}
// The sun's shadow map is re-rendered only when it would change (it was a full extra pass over the ~1 M-vertex
// model on every frame, ~1/3 of the frame's CPU): when a shadow light turned far enough to move the tip of the
// shadow of the 5 m roof by ~3 cm (= one shadow texel; 0.25 deg at midday, a fraction of that for the long low-sun
// shadows, where it means every frame at 600x), when the crops grew (growth.js scales them in the depth shader) or the winter transition runs, when a
// visible caster moved / appeared / hid (FarmDroid driving: at most every 30 ms, i.e. the robot's shadow trails it by
// < 5 cm), and at least once a second as a safety net. Nothing while the sun is down (the map is not used then).
// Other code can force a refresh with ctx.invalidateShadows().
const SHADOW = { dirs: new Map(), sig: NaN, t: 0, force: true, lights: [] };
// allowed turn (rad) for a light at altitude a: shadow length of height h is h / tan(a), its tip moves by
// h * da / sin^2(a) (altitude) or h * da / sin(a) (azimuth); keep that under 3 cm for h = 5 m, at most 0.25 deg
const sunStepCos = (sinAlt) => Math.cos(Math.min(THREE.MathUtils.degToRad(0.25), (0.03 / 5) * Math.max(sinAlt, 0.02) ** 2));
const _ld = new THREE.Vector3();
renderer.shadowMap.autoUpdate = false;
ctx.invalidateShadows = () => { SHADOW.force = true; };
function shadowSignature() {
  let s = 0, k = 0;
  scene.traverseVisible((o) => {
    if (!o.castShadow || !(o.isMesh || o.isPoints || o.isLine)) return;
    const e = o.matrixWorld.elements; k++;
    s += k * (e[0] + 2 * e[1] + 3 * e[2] + 5 * e[4] + 7 * e[5] + 11 * e[6] + 13 * e[8] + 17 * e[9] + 19 * e[10] + 23 * e[12] + 29 * e[13] + 31 * e[14]);
  });
  return s + k * 1e-3;
}
function updateShadowsIfNeeded(now) {
  if (!renderer.shadowMap.enabled) return;
  const L = SHADOW.lights; L.length = 0;
  scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow && o.visible) L.push(o); });
  let need = SHADOW.force || SHADOW.crop !== state.dayOfSeason || SHADOW.winter !== state.winter, lit = false;
  for (const o of L) {
    if (!o.shadow.map) need = lit = true;
    if (o.intensity > 0) lit = true;
    _ld.subVectors(o.position, o.target.position).normalize();
    const d = SHADOW.dirs.get(o);
    if (!d || d.dot(_ld) < sunStepCos(_ld.y)) need = true;
  }
  if (!lit) { SHADOW.force ||= need; return; }
  scene.updateMatrixWorld(); // the renderer does this again; cheap, static meshes are skipped
  const sig = shadowSignature();
  if (sig !== SHADOW.sig && now - SHADOW.t >= 30) need = true;
  if (!need && now - SHADOW.t < 1000) return;
  renderer.shadowMap.needsUpdate = true;
  SHADOW.force = false; SHADOW.t = now; SHADOW.sig = sig; SHADOW.crop = state.dayOfSeason; SHADOW.winter = state.winter;
  for (const o of L) { const d = SHADOW.dirs.get(o) || new THREE.Vector3(); d.subVectors(o.position, o.target.position).normalize(); SHADOW.dirs.set(o, d); }
}
const hideShadowToggle = () => { $('#tShadow').checked = false; $('#lShadow').style.display = 'none'; };
$('#tShadow').addEventListener('change', (e) => applyShadows(e.target.checked && !QUALITY.low));
if (QUALITY.low) hideShadowToggle();
else { $('#tShadow').checked = true; applyShadows(true); }

// ---------------- HUD ----------------
const stageName = (s) => (s ? t('stage.' + s) : t('hud.na'));
const info = Object.fromEntries(MOD_ORDER.map((n) => [n, null]));
function readInfo() {
  const lang = document.documentElement.lang;
  for (const n of MOD_ORDER) info[n] = mods[n] && typeof mods[n].info === 'function' ? callMod(n, 'info', lang) ?? null : null;
}
function hudTemplate() {
  $('#hud').innerHTML = `<h2><span>${esc(t('hud.title'))}</span><span class="clk" id="hClock"></span></h2>
    <dl>
      <dt class="mob-only" style="display:none"></dt>
      <dt class="tm"><i style="background:var(--accent)"></i>${esc(t('hud.time'))}</dt><dd class="tm" id="hTime"></dd>
      <dt class="full"><i style="background:#f6d77a"></i>${esc(t('hud.sun'))}</dt><dd class="full" id="hSun"></dd>
      <div class="bar"><b id="hSunBar" style="background:#f6d77a"></b></div>
      <dt><i style="background:var(--power)"></i>${esc(t('hud.pv'))}</dt><dd id="hKW"></dd>
      <dt class="full"><i style="background:var(--power)"></i>${esc(t('hud.energy'))}</dt><dd class="full" id="hKWh"></dd>
      <dt><i style="background:var(--water)"></i>${esc(t('hud.water'))}</dt><dd id="hLpm"></dd>
      <dt class="full"><i style="background:var(--water)"></i>${esc(t('hud.litres'))}</dt><dd class="full" id="hL"></dd>
      <dt class="full wint"><i style="background:#9ec9ea"></i>${esc(t('hud.outside'))}</dt><dd class="full wint" id="hOut"></dd>
      <dt class="wint inrow"><i style="background:#f0a35e"></i>${esc(t('hud.inside'))}</dt><dd class="wint inrow" id="hIn"></dd>
      <dt class="full rainrow"><i style="background:#7fb3e6"></i>${esc(t('hud.rain'))}</dt><dd class="full rainrow" id="hRain"></dd>
      <dt class="full rainrow"><i style="background:#3d9be9"></i>${esc(t('hud.tank'))}</dt><dd class="full rainrow" id="hTank"></dd>
      <dt class="full rainrow"><i style="background:#3d9be9"></i>${esc(t('hud.flow'))}</dt><dd class="full rainrow" id="hTankFlow"></dd>
      <div class="bar rainrow"><b id="hTankBar" style="background:#3d9be9"></b></div>
      <dt class="crop"><i style="background:var(--leaf)"></i>${esc(t('hud.crop'))}</dt><dd class="crop" id="hCrop"></dd>
      <div class="bar"><b id="hCropBar" style="background:var(--leaf)"></b></div>
    </dl>
    <div class="legend" aria-label="${esc(t('legend.title'))}">
      <span id="lgDC"><i style="background:#ffb43a"></i>${esc(t('legend.dc'))}</span>
      <span id="lgAC"><i style="background:#4fd8f0"></i>${esc(t('legend.ac'))}</span>
      <span id="lgW"><i style="background:#3d9be9"></i>${esc(t('legend.water'))}</span>
    </div>`;
  $('#hud .mob-only').remove();
}
function updateHud() {
  readInfo();
  const sk = info.sky, pw = info.power, wa = info.water, gr = info.growth;
  const alt = sk && isFinite(sk.sunAltDeg) ? sk.sunAltDeg : fallbackSky ? fbAlt : null;
  $('#hClock').textContent = hhmm(state.hour);
  $('#hTime').textContent = hhmm(state.hour);
  $('#hSun').textContent = alt == null ? t('hud.na') : alt <= 0 ? t('hud.night') : fmt(alt, 0) + '°';
  $('#hSunBar').style.transform = `scaleX(${clamp(state.sun, 0, 1)})`;
  $('#hKW').innerHTML = pw ? `${fmt(pw.kW)}<small>${t('unit.kw')}</small>` : t('hud.na');
  $('#hKWh').innerHTML = pw ? `${fmt(pw.kWhToday)}<small>${t('unit.kwh')}</small>` : t('hud.na');
  $('#hLpm').innerHTML = wa ? `${fmt(wa.lpm)}<small>${t('unit.lpm')}</small>` : t('hud.na');
  $('#hL').innerHTML = wa ? `${fmt(wa.litresToday, 0)}<small>${t('unit.l')}</small>` : t('hud.na');
  $('#hCrop').innerHTML = gr ? `${esc(stageName(gr.stage))}${isFinite(gr.headDiameterCm) && gr.headDiameterCm > 0 ? `<small>Ø ${fmt(gr.headDiameterCm, 0)} ${t('unit.cm')}</small>` : ''}` : `${Math.round(state.dayOfSeason)}%`;
  $('#hCropBar').style.transform = `scaleX(${clamp(state.dayOfSeason, 0, 100) / 100})`;
  const wi = info.winter, inWinter = !!wi && (state.season === 'winter' || state.winter > 0);
  const realT = state.realClimate && Number.isFinite(state.tempOutsideC);
  const hud = $('#hud'); hud.classList.toggle('winter', inWinter || realT); hud.classList.toggle('noin', !inWinter);
  if (inWinter || realT) {
    $('#hOut').innerHTML = `${fmt(realT ? state.tempOutsideC : wi.outsideC)}<small>${t('unit.c')}</small>`;
    $('#hIn').innerHTML = wi ? `${fmt(wi.insideC)}<small>${t('unit.c')}</small>` : t('hud.na');
  }
  const ri = info.rain; hud.classList.toggle('rain', !!ri);
  if (ri) {
    $('#hRain').innerHTML = `${fmt(ri.rainMmH)}<small>${t('unit.mmh')}</small>`;
    $('#hTank').innerHTML = `${fmt((ri.tankLevel || 0) * 100, 0)}<small>%</small> · ${fmt((ri.tankLitres || 0) / 1000)}<small>m³</small>`;
    $('#hTankFlow').innerHTML = `+${fmt(ri.inflowLpm)} / −${fmt(ri.outflowLpm)}<small>${t('unit.lpm')}</small>`;
    $('#hTankBar').style.transform = `scaleX(${clamp(ri.tankLevel || 0, 0, 1)})`;
    $('#vRain').textContent = ri.rainMmH > 0.05 ? `${fmt(ri.rainMmH)} ${t('unit.mmh')}` : t('irr.off');
  }
  renderYears(); syncAttr(); syncMapView();
  if (!smallMQ.matches) document.documentElement.style.setProperty('--hudh', hud.offsetHeight + 'px'); // info panel stops above the HUD
  if (info.geo) { const g = info.geo; $('#mapStatus').textContent = g.loading ? t('map.loading') : g.error || ''; }
  { const n = siteName(); if ($('#locName').textContent !== n) renderLoc(); }
  syncLegend();
  winterWalls = wi && wi.filmDeployed > 0.5 && Array.isArray(mods.winter?.colliders) ? mods.winter.colliders : null;
  const on = state.water > 0.01;
  $('#vIrr').textContent = on ? t('irr.on') : t('irr.off');
  if (selected) { const l = liveHtml(selected), el = $('#plive'); if (el && l != null) el.innerHTML = l; }
}

// ---------------- side-panel accordions (open state remembered per viewer) ----------------
{
  const KEY = 'witkowo3d:acc';
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  $$('details.acc').forEach((d) => {
    if (d.dataset.acc in saved) d.open = !!saved[d.dataset.acc];
    else if (smallMQ.matches && d.dataset.acc !== 'sim') d.open = false;
    d.addEventListener('toggle', () => { saved[d.dataset.acc] = d.open; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* storage blocked */ } });
  });
}
const L2 = () => (document.documentElement.lang === 'en' ? 'en' : 'pl');
const lbl = (o) => (o ? (L2() === 'en' ? o.label_en || o.label_pl : o.label_pl || o.label_en) || o.label || '' : '');
const num = (v, d = 1) => (v == null || !Number.isFinite(+v) ? t('hud.na') : Number(v).toFixed(d).replace('.', L2() === 'en' ? '.' : ','));

// ---------------- camera limits for the map / the geological section ----------------
const ORBIT_BASE = { maxDistance: orbitP.maxDistance, maxPolarAngle: orbitP.maxPolarAngle };
const geoRec = (() => { try { return mods.geo?.info?.()?.recommended || null; } catch (e) { return null; } })();
let geoOn = !!mods.geo;
if (mods.geo) { persp.far = geoRec?.cameraFar || 9000; persp.updateProjectionMatrix(); }
function syncOrbitLimits() {
  if (state.show.underground) { orbitP.maxPolarAngle = Math.PI - 0.05; orbitP.maxDistance = info.underground?.camera?.maxDistance || 420; }
  else { orbitP.maxPolarAngle = ORBIT_BASE.maxPolarAngle; orbitP.maxDistance = geoOn ? geoRec?.maxDistance || 1800 : ORBIT_BASE.maxDistance; }
}
// fog: sky.js sets a near fog every frame (90..360 m); zoomed out over the real map it is pushed out to the map's
// recommended range, so the photo ground stays visible to the horizon
function mapFog() {
  if (!geoOn || !scene.fog || cam !== persp || mode === 'walk') return;
  const d = persp.position.distanceTo(orbitP.target), k = clamp((d - 120) / 480, 0, 1);
  if (k <= 0) return;
  const near = geoRec?.fogNear || 1400, far = geoRec?.fogFar || 7000;
  scene.fog.near += (near - scene.fog.near) * k; scene.fog.far += (far - scene.fog.far) * k;
}
function flyPose(pos, target, d = 1.1) {
  if (mode !== 'iso') setMode('iso');
  camTouched = true;
  tween = { k: 0, d, from: orbitP.target.clone(), to: target.clone(), p0: persp.position.clone(), p1: pos.clone() };
  if (smallMQ.matches) setDrawer(false);
}
syncOrbitLimits();

// ---------------- map: ground photo, year, overlay, map view ----------------
const selYear = $('#selYear'), selLayer = $('#selLayer'), rOpacity = $('#rOpacity');
let yearsSig = '';
function yearLabel(y) {
  const k = String(y.kind || ''), d = y.date || String(y.id);
  return /s2|sentinel/i.test(k) || /^s2/i.test(String(y.id)) ? `Sentinel-2 ${d}` : /live/.test(k) ? `${d} (Geoportal)` : d;
}
function renderYears(force) {
  const g = mods.geo; if (!g || !Array.isArray(g.years)) return;
  const sig = g.years.map((y) => y.id).join('|') + L2();
  if (!force && sig === yearsSig) return; yearsSig = sig;
  const cur = String(info.geo?.year ?? '');
  selYear.innerHTML = g.years.map((y) => `<option value="${esc(y.id)}"${String(y.id) === cur ? ' selected' : ''}>${esc(yearLabel(y))}</option>`).join('');
  selYear.disabled = !g.years.length;
}
function renderLayers() {
  const g = mods.geo; if (!g || !Array.isArray(g.layers)) return;
  const cur = info.geo?.layer ?? 'none';
  selLayer.innerHTML = g.layers.map((l) => `<option value="${esc(l.id)}"${l.id === cur ? ' selected' : ''}>${esc(lbl(l))}</option>`).join('');
}
function syncOpacity() { fillRange(rOpacity); $('#vOpacity').textContent = Math.round(rOpacity.value * 100) + '%'; }
if (mods.geo) {
  selYear.addEventListener('change', () => { const y = mods.geo.years.find((v) => String(v.id) === selYear.value); if (y) Promise.resolve(callMod('geo', 'setYear', y.id)).catch((e) => console.warn('geo.setYear', e)); });
  selLayer.addEventListener('change', () => {
    const l = mods.geo.layers.find((v) => v.id === selLayer.value);
    if (l && Number.isFinite(l.opacity) && l.opacity > 0) { rOpacity.value = l.opacity; callMod('geo', 'setOpacity', l.opacity); syncOpacity(); }
    Promise.resolve(callMod('geo', 'setLayer', selLayer.value)).catch((e) => console.warn('geo.setLayer', e));
  });
  rOpacity.addEventListener('input', () => { callMod('geo', 'setOpacity', +rOpacity.value); syncOpacity(); });
  $('#tGround').addEventListener('change', (e) => { geoOn = e.target.checked; callMod('geo', 'setVisible', geoOn); syncOrbitLimits(); ctx.invalidateShadows(); });
  syncOpacity();
} else { $('#accMap').querySelectorAll('input, select').forEach((el) => (el.disabled = true)); }
// "Map view": pull back to ~800 m over the real map; pressed again (or when already far out): back to the farm
const mapFar = () => cam === persp && persp.position.distanceTo(orbitP.target) > 300;
$('#bMapView').addEventListener('click', () => {
  if (mapFar()) { const p = isoHomePose(); flyPose(p.pos, p.target, 1.4); return; }
  if (!geoOn && mods.geo) { $('#tGround').checked = true; $('#tGround').dispatchEvent(new Event('change')); }
  if (state.show.underground) { $('#tUnder').checked = false; $('#tUnder').dispatchEvent(new Event('change')); }
  const target = new THREE.Vector3(C.x, 0, C.z), dir = new THREE.Vector3(0.45, 0.78, 0.55).normalize();
  flyPose(target.clone().addScaledVector(dir, 800), target, 1.6);
});
function syncMapView() { const b = $('#bMapView'), far = mapFar(); b.textContent = t(far ? 'map.home' : 'map.view'); }

// ---------------- location (any point in Poland) ----------------
const SITE_GAP_MS = 60000; // Open-Meteo: ~6-7 new sites an hour; one new site per minute at most
let lastSiteAt = 0, siteBusy = false;
const STEP_IDS = ['terrain', 'geo', 'sky', 'climate', 'sitedata', 'underground'];
const steps = {};
const fmtCoord = (st) => `${Math.abs(st.lat).toFixed(4)}° ${st.lat >= 0 ? 'N' : 'S'}, ${Math.abs(st.lon).toFixed(4)}° ${st.lon >= 0 ? 'E' : 'W'}`;
function siteName() {
  const st = state.site; if (st.name) return st.name;
  const rep = info.sitedata, f = rep?.fields || {};
  const parts = ['admin.commune', 'admin.county'].map((k) => f[k]?.value).filter(Boolean);
  return parts.length ? String(parts[0]) : t('loc.title');
}
function renderLoc() {
  $('#locName').textContent = siteName(); $('#locCoord').textContent = fmtCoord(state.site);
  const note = $('#locNote'), list = STEP_IDS.filter((k) => steps[k]);
  if (!list.length) { note.hidden = true; return; }
  note.hidden = false;
  const bad = list.filter((k) => steps[k].st === 'err');
  const head = siteBusy ? t('loc.loading') : bad.length ? t('loc.partial', { list: bad.map((k) => t('mod.' + k)).join(', ') }) : t('loc.done');
  note.innerHTML = `<div>${esc(head)}</div><ul>${list.map((k) => {
    const s = steps[k], cls = { wait: 'st-wait', run: 'st-run', ok: 'st-ok', err: 'st-err', skip: 'st-skip' }[s.st];
    const txt = { wait: t('loc.pending'), run: t('loc.running'), ok: t('loc.ok'), err: t('loc.err'), skip: t('loc.skip') }[s.st];
    return `<li><span>${esc(t('mod.' + k))}</span><span class="${cls}" title="${esc(s.msg || '')}">${esc(txt)}</span></li>`;
  }).join('')}</ul>`;
}
let reportT = 0;
function onReport() { const now = performance.now(); if (panelKind() === 'report' && now - reportT > 300) { reportT = now; readInfo(); renderReport(); } }
async function runStep(k, fn) {
  if (!mods[k]) { steps[k] = { st: 'skip' }; renderLoc(); return; }
  steps[k] = { st: 'run' }; renderLoc();
  try {
    const r = await fn();
    const errs = (() => { try { return mods[k]?.info?.()?.errors || []; } catch (e) { return []; } })();
    steps[k] = { st: 'ok', msg: Array.isArray(errs) ? errs.slice(-2).join('; ') : '' }; void r;
  } catch (e) { console.warn(`[${k}] setSite failed:`, e); steps[k] = { st: 'err', msg: e?.message || String(e) }; }
  renderLoc();
}
// order: terrain first (geo drapes the ground on it), then geo, sky; climate + site report in parallel; underground
// last (it reads the site report for the surface geology)
async function applySite(site, { initial = false } = {}) {
  siteBusy = true;
  state.site = site; ctx.site = site;
  for (const k of STEP_IDS) steps[k] = { st: mods[k] ? 'wait' : 'skip' };
  renderLoc();
  if (initial) { // terrain / geo / underground were started on this site by init(ctx.site): just follow them
    await runStep('terrain', () => mods.terrain.ready);
    await runStep('geo', () => mods.geo.ready);
    await runStep('sky', () => mods.sky.setSite?.(site));
  } else {
    await runStep('terrain', () => mods.terrain.setSite(site));
    await runStep('geo', () => mods.geo.setSite(site, { terrain: mods.terrain }));
    await runStep('sky', () => mods.sky.setSite?.(site));
  }
  await Promise.all([
    runStep('climate', () => mods.climate.setSite?.(site)),
    runStep('sitedata', () => (reportP = mods.sitedata.setSite(site, { onProgress: onReport }))),
  ]);
  await runStep('underground', () => (initial ? mods.underground.ready : mods.underground.setSite?.(site)));
  siteBusy = false; renderLoc(); readInfo(); renderYears(true); renderLayers();
  ctx.invalidateShadows();
  if (panelKind() === 'report') renderReport();
  if (panelKind() === 'climate') renderClimate();
  setTimeout(() => { if (!siteBusy && !STEP_IDS.some((k) => steps[k]?.st === 'err')) { for (const k of STEP_IDS) delete steps[k]; renderLoc(); } }, 8000);
}
function setSiteUrl(site) {
  const u = new URL(location.href);
  if (isDefaultSite(site)) { u.searchParams.delete('lat'); u.searchParams.delete('lon'); u.searchParams.delete('rot'); u.searchParams.delete('name'); }
  else { u.searchParams.set('lat', site.lat.toFixed(6)); u.searchParams.set('lon', site.lon.toFixed(6)); u.searchParams.set('rot', String(Math.round(site.rotDeg ?? 0))); if (site.name) u.searchParams.set('name', site.name); else u.searchParams.delete('name'); }
  history.replaceState(history.state, '', u.href);
}
$('#bLoc').addEventListener('click', async () => {
  const wait = SITE_GAP_MS - (Date.now() - lastSiteAt);
  if (siteBusy || wait > 0) { notice(esc(t('loc.throttle', { s: Math.max(1, Math.ceil(wait / 1000)) })), 9000); return; }
  let site = null;
  try { const m = await import(`./lib/locate.js${new URL(import.meta.url).search}`); site = await m.openPicker({ ...state.site }, L2()); }
  catch (e) { console.warn('locate', e); notice(esc(t('loc.pickerFail', { m: e?.message || e })), 9000); return; }
  if (!site || !Number.isFinite(+site.lat) || !Number.isFinite(+site.lon)) return;
  site = { lat: +site.lat, lon: +site.lon, rotDeg: Number.isFinite(+site.rotDeg) ? +site.rotDeg : state.site.rotDeg, name: site.name || '', source: site.source || 'picker' };
  lastSiteAt = Date.now(); setSiteUrl(site);
  applySite(site);
});

// ---------------- info panel: site report + climate ----------------
const panelKind = () => ($('#panel').classList.contains('open') ? $('#panel').dataset.kind || 'item' : null);
function openPanel(kind) {
  select(null);
  const p = $('#panel'); p.dataset.kind = kind; p.classList.add('wide');
  if (kind === 'report') renderReport(); else renderClimate();
  p.classList.add('open'); p.scrollTop = 0; syncSheets();
  if (smallMQ.matches) setDrawer(false);
}
const panelHead = (eyebrow, title, sub) => `<div class="grab" aria-hidden="true"></div>
  <div class="top"><div><div class="eyebrow">${esc(eyebrow)}</div><h3>${esc(title)}</h3>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</div><button type="button" class="close" id="pclose">${esc(t('close'))}</button></div>`;
function bindClose() { $('#pclose').onclick = () => { const p = $('#panel'); p.classList.remove('open', 'wide'); p.dataset.kind = ''; syncSheets(); }; }
function fieldValue(f) {
  if (!f) return null;
  if (f.pending) return `<span class="pend">${esc(t('report.loading'))}</span>`;
  if (f.value == null) return f.error ? `<span class="fail" title="${esc(f.error)}">${esc(t('report.failed'))}</span>` : `<span class="pend">${esc(t('report.nodata'))}</span>`;
  const v = L2() === 'en' && f.value_en ? f.value_en : f.value;
  return esc(typeof v === 'number' ? num(v, Math.abs(v) >= 100 ? 0 : 1) : v) + (f.unit ? ' ' + esc(f.unit) : '');
}
const safeHref = (u) => (/^https?:\/\//.test(u || '') ? esc(u) : '');
function renderReport() {
  const p = $('#panel'); if (p.dataset.kind !== 'report') return;
  const sd = mods.sitedata, rep = info.sitedata || (sd ? callMod('sitedata', 'info') : null);
  const suit = sd ? callMod('sitedata', 'suitability', L2()) || [] : [];
  const ti = info.terrain || (mods.terrain ? callMod('terrain', 'info') : null);
  let html = panelHead(t('sec.data'), t('report.title'), `${siteName()} · ${fmtCoord(state.site)}`);
  if (suit.length) {
    const o = suit[0];
    html += `<div class="light"><span class="bulb lv-${esc(o.level)}"></span><div><b>${esc(t('report.suit'))}</b><div>${esc(o.text)}</div></div></div>
      <ul class="suit">${suit.slice(1).map((n) => `<li><i class="lv-${esc(n.level)}"></i><span>${esc(n.text)}</span></li>`).join('')}</ul>`;
  }
  if (ti && !ti.loading) {
    const row = (k, v) => `<tr><td>${esc(t(k))}</td><td>${v}</td></tr>`;
    html += `<h4>${esc(t('report.terrain'))}</h4><table class="rep">
      ${row('report.elev', `${num(ti.elevationM)} m`)}${row('report.slope', `${num(ti.slopePct)} %`)}${Number.isFinite(ti.aspectDeg) ? row('report.aspect', `${num(ti.aspectDeg, 0)}°`) : ''}
      ${row('report.relief', `${num(ti.reliefM)} m`)}${row('report.pad', `${num(ti.padLevelM)} m`)}
      ${row('report.cut', `${num(ti.cutM3, 0)} m³`)}${row('report.fill', `${num(ti.fillM3, 0)} m³`)}
      <tr><td>${esc(t('report.src'))}</td><td><span class="s">${esc(ti.source || '')}</span></td></tr></table>`;
  } else if (mods.terrain) html += `<h4>${esc(t('report.terrain'))}</h4><p class="est">${esc(t('report.loading'))}</p>`;
  if (!rep) html += `<p class="est">${esc(t('report.none'))}</p>`;
  else {
    for (const g of rep.groups || []) {
      const rows = (g.keys || []).map((k) => [k, rep.fields?.[k]]).filter(([, f]) => f);
      if (!rows.length) continue;
      html += `<h4>${esc(lbl(g))}</h4><table class="rep">${rows.map(([, f]) => {
        const src = f.source ? (safeHref(f.link) ? `<a href="${safeHref(f.link)}" target="_blank" rel="noopener">${esc(f.source)}</a>` : esc(f.source)) : '';
        const conf = f.confidence ? ` · ${esc(t('report.conf.' + f.confidence))}` : '';
        return `<tr><td>${esc(lbl(f))}</td><td>${fieldValue(f)}${src || conf ? `<span class="s">${src}${conf}</span>` : ''}</td></tr>`;
      }).join('')}</table>`;
    }
    if (rep.linkOnly?.length) html += `<h4>${esc(t('report.links'))}</h4><table class="rep">${rep.linkOnly.map((l) => `<tr><td colspan="2">${safeHref(l.url) ? `<a href="${safeHref(l.url)}" target="_blank" rel="noopener">${esc(lbl(l))}</a>` : esc(lbl(l))}</td></tr>`).join('')}</table>`;
    if (rep.errors?.length) html += `<p class="est" title="${esc(rep.errors.join('\n'))}">${esc(t('report.errors', { n: rep.errors.length }))}</p>`;
  }
  html += `<p class="est">${esc(t('est'))}</p>`;
  const top = p.scrollTop; p.innerHTML = html; p.scrollTop = top; bindClose();
}
function renderClimate() {
  const p = $('#panel'); if (p.dataset.kind !== 'climate') return;
  const c = mods.climate, ci = c ? callMod('climate', 'info', L2()) : null;
  let html = panelHead(t('sec.data'), t('climate.title'), `${siteName()} · ${fmtCoord(state.site)}`);
  if (!c) { p.innerHTML = html + `<p class="est">${esc(t('climate.none'))}</p>`; bindClose(); return; }
  const sgn = (v) => (v > 0 ? '+' : '') + num(v);
  html += `<dl class="kv">
    <dt>${esc(t('climate.annual'))}${ci?.annualMeanPeriod ? ` (${esc(ci.annualMeanPeriod)})` : ''}</dt><dd>${num(ci?.annualMean)} °C</dd>
    <dt>${esc(t('climate.base'))}</dt><dd>${num(ci?.baselineMean)} °C</dd>
    <dt>${esc(t('climate.warming'))}</dt><dd>${ci?.warmingVsBaseline != null ? sgn(ci.warmingVsBaseline) : t('hud.na')} °C</dd>
    <dt>${esc(t('climate.trend'))}</dt><dd>${ci?.trendPerDecade != null ? sgn(ci.trendPerDecade) : t('hud.na')} ${esc(t('unit.perDecade'))}</dd>
    <dt>${esc(t('climate.ghi'))}</dt><dd>${num(ci?.typicalDayKWhm2, 2)} ${esc(t('unit.kwhm2'))}</dd>
    <dt>${esc(t('climate.now'))}</dt><dd>${num(ci?.tempOutsideC)} °C</dd>
  </dl><div id="climCharts"></div><p class="est">${esc(t('climate.caveat'))}</p><p class="est">${esc(ci?.source || '')}</p>`;
  p.innerHTML = html; bindClose();
  const box = $('#climCharts'), w = Math.max(260, Math.min(560, p.clientWidth - 36));
  for (const k of ['stripes', 'annual', 'monthly']) { const cv = callMod('climate', 'chartCanvas', k, L2(), { width: w, height: k === 'stripes' ? 90 : 170 }); if (cv) box.appendChild(cv); }
}
// the default site's report is fetched only when asked for (~20 public services); other sites load it on arrival
// ePSH (MHP unit + yield, balance area) is opt-in in sitedata.js: fetched only once the user opens the report
let reportP = null;
async function ensureReport() {
  if (!mods.sitedata) return;
  try {
    const st = callMod('sitedata', 'info')?.status;
    if (!reportP || st === 'idle' || st === 'aborted') reportP = mods.sitedata.setSite(state.site, { onProgress: onReport });
    await reportP;
    if (typeof mods.sitedata.loadEpsh === 'function') await mods.sitedata.loadEpsh({ onProgress: onReport });
  } catch (e) { console.warn('sitedata', e); }
  readInfo(); renderReport(); renderLoc();
}
$('#bReport').addEventListener('click', () => { ensureReport(); openPanel('report'); });
$('#bClimate').addEventListener('click', () => openPanel('climate'));
if (!mods.sitedata && !mods.terrain) $('#bReport').disabled = true;
if (!mods.climate) $('#bClimate').disabled = true;

// ---------------- geological section ----------------
const UV_LABEL = { oblique: 'under.v.oblique', shallow: 'under.v.shallow', column: 'under.v.column' };
function renderUnderViews() {
  const v = info.underground?.camera?.views || (mods.underground ? callMod('underground', 'info')?.camera?.views : null) || {};
  const box = $('#underViews'), keys = Object.keys(v);
  box.style.gridTemplateColumns = `repeat(${Math.max(1, keys.length)}, 1fr)`;
  box.innerHTML = keys.map((k) => `<button type="button" data-view="${esc(k)}">${esc(UV_LABEL[k] ? t(UV_LABEL[k]) : k)}</button>`).join('');
}
$('#underViews').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]'); if (!b) return;
  const v = (info.underground || callMod('underground', 'info'))?.camera?.views?.[b.dataset.view]; if (!v) return;
  flyPose(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target), 1.2);
});
$('#tUnder').addEventListener('change', (e) => {
  state.show.underground = e.target.checked; $('#underCtl').hidden = !e.target.checked;
  callMod('underground', 'setVisible', e.target.checked); syncOrbitLimits(); ctx.invalidateShadows();
  if (e.target.checked) { renderUnderViews(); const v = callMod('underground', 'info')?.camera?.views?.oblique; if (v) flyPose(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target), 1.2); }
});
$('#underScale').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-scale]'); if (!b) return; state.undergroundScale = b.dataset.scale;
  $$('#underScale button').forEach((x) => x.classList.toggle('on', x === b)); ctx.invalidateShadows();
});
if (!mods.underground) $('#lUnder').style.display = 'none';

// ---------------- weather: rain, real climate, sun rays ----------------
const rRain = $('#rRain');
function syncRainUi() {
  $$('#rainMode button').forEach((b) => { const on = b.dataset.rain === sim.rain; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('#rainInt').hidden = sim.rain !== 'on'; $('#rainHint').hidden = sim.rain !== 'auto'; fillRange(rRain);
}
$('#rainMode').addEventListener('click', (e) => { const b = e.target.closest('button[data-rain]'); if (!b) return; sim.rain = b.dataset.rain; syncRainUi(); });
rRain.addEventListener('input', () => { sim.rainLevel = +rRain.value; fillRange(rRain); });
if (!mods.rain) $('#rainCtl').style.display = 'none';
syncRainUi();
$('#tClimate').addEventListener('change', (e) => { state.realClimate = e.target.checked; });
if (!mods.climate) $('#lClimate').style.display = 'none';
$('#tRays').addEventListener('change', (e) => { state.show.rays = e.target.checked; callMod('sky', 'setRaysVisible', e.target.checked); });
if (!mods.sky?.setRaysVisible) $('#lRays').style.display = 'none';

// ---------------- data attribution (always visible) ----------------
function syncAttr() {
  const parts = [];
  const add = (s) => { s = String(s || '').trim(); if (s && !parts.includes(s)) parts.push(s); };
  if (geoOn) add(info.geo?.attribution);
  if (mods.climate) add(info.climate?.source);
  if (state.show.underground) add(info.underground?.attribution);
  const srcs = new Set(); for (const f of Object.values(info.sitedata?.fields || {})) if (f?.source && f.value != null && !/^lib\//.test(f.source)) srcs.add(f.source);
  [...srcs].slice(0, 8).forEach(add);
  const el = $('#attr'), txt = parts.length ? `${t('attr.label')}: ${parts.join(' · ')}` : '';
  if (el.textContent !== txt) { el.textContent = txt; el.title = txt; }
}
$('#attr').addEventListener('click', () => $('#attr').classList.toggle('open'));

// ---------------- language switch: re-render dynamic text ----------------
function relabel() {
  renderList(); hudTemplate(); updateHud(); syncPlay(); setHint(); syncSeason();
  renderYears(true); renderLayers(); renderLoc(); syncRainUi(); if (state.show.underground) renderUnderViews();
  callMod('underground', 'setLang', L2());
  if (selected) renderPanel();
  if (panelKind() === 'report') renderReport();
  if (panelKind() === 'climate') renderClimate();
  labelsDirty = true;
}
onLang(relabel);

// ---------------- main loop ----------------
const clock = new THREE.Clock();
const SEASON_PER_SIM_HOUR = 100 / 72; // auto season: planting to harvest in 3 simulated days (time-lapse)
const lastCamM = new THREE.Matrix4(), lastProjM = new THREE.Matrix4(); let lastCam = null;
function renderLabels() {
  if (!labelsG.visible) { if (labelsDirty) { labelRenderer.render(scene, cam); labelsDirty = false; } return; }
  if (!labelsDirty && cam === lastCam && lastCamM.equals(cam.matrixWorld) && lastProjM.equals(cam.projectionMatrix)) return;
  labelsDirty = false; lastCam = cam; lastCamM.copy(cam.matrixWorld); lastProjM.copy(cam.projectionMatrix);
  labelRenderer.render(scene, cam);
}
// slow-GPU probe: median frame time of frames 10-40 above 40 ms on the high tier -> drop bloom, pixel ratio, shadows
const probe = { n: 0, dts: [], done: QUALITY.low || QUALITY.forced };
function notice(html, ms = 12000) {
  $('#note')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="note" class="panel" role="status"><div>${html}</div><button type="button" class="close">${esc(t('ok'))}</button></div>`);
  const el = $('#note'); el.querySelector('button').onclick = () => el.remove(); setTimeout(() => el.remove(), ms);
}
function goLow(fps) {
  if (QUALITY.low) return; QUALITY.low = true; state.quality = 'low'; markAutoLow();
  if (bloomPass) bloomPass.enabled = false;
  renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
  if ($('#tShadow').checked) applyShadows(false); hideShadowToggle();
  notice(`${esc(t('slow.notice', { fps }))} <a href="?q=high" style="color:var(--accent)">${esc(t('slow.full'))}</a>`);
}
function probeFrame(raw) {
  if (probe.done) return;
  if (document.hidden || raw > 1) { probe.n = 0; probe.dts.length = 0; return; }
  if (++probe.n > 10) probe.dts.push(raw);
  if (probe.dts.length >= 30) { probe.done = true; const med = probe.dts.sort((a, b) => a - b)[15] * 1000; if (med > 40) goLow(Math.round(1000 / med)); }
}
let hudT = 0, uiT = 0, frameN = 0, lastFilmOn = null;
const robotLabelAt = node('FarmDroid / GNSS antenna');
const _v = new THREE.Vector3();
function frame() {
  const raw = clock.getDelta(), dt = Math.min(0.05, raw), now = performance.now();
  probeFrame(raw);
  // simulated clock
  if (sim.playing && !clockDrag) {
    const dh = (dt * state.speed) / 3600;
    state.hour += dh; if (state.hour >= 24) { state.hour -= 24; sim.simDay++; }
    if (sim.autoSeason && !growthDrag) { state.dayOfSeason += dh * SEASON_PER_SIM_HOUR; if (state.dayOfSeason > 100) state.dayOfSeason = 0; }
  }
  const target = sim.irrigation === 'on' ? 1 : sim.irrigation === 'off' ? 0 : irrSchedule(state.hour) ? 1 : 0;
  state.water += clamp(target - state.water, -dt * 2, dt * 2); // valve opens / closes over ~0.5 s
  const wt = state.season === 'winter' ? 1 : 0;
  state.winter += clamp(wt - state.winter, -dt / 4, dt / 4); // ~4 s transition
  if (filmOn() !== lastFilmOn) {
    lastFilmOn = filmOn(); renderList(); if (itemById.film.label) { itemById.film.label.visible = lastFilmOn; labelsDirty = true; }
    if (!lastFilmOn && selected === itemById.film) select(null);
  }
  // simulation modules: sky -> power -> water -> growth -> winter
  if (mods.sky) callMod('sky', 'update', dt, state);
  if (fallbackSky) fallbackSkyUpdate();
  callMod('power', 'update', dt, state);
  callMod('water', 'update', dt, state);
  callMod('growth', 'update', dt, state);
  callMod('winter', 'update', dt, state);
  // rain: Auto (climate-normal wet days, deterministic per simulated day) / Off / On (slider)
  state.rain = sim.rain === 'off' ? 0 : sim.rain === 'on' ? sim.rainLevel : libs.rain?.autoRain ? libs.rain.autoRain(sim.simDay, state.hour, state.winter) : 0;
  if (mods.rain) {
    state.irrigationLpm = mods.water ? (callMod('water', 'info')?.lpm || 0) : 0;
    // the tank cut-away windows open only while the water layer is on AND the tanks are selected
    const w = state.show.water; state.show.water = w && selected === itemById.tanks;
    callMod('rain', 'update', dt, state);
    state.show.water = w;
  }
  callMod('terrain', 'update', dt, state);
  callMod('geo', 'update', dt, state);
  callMod('underground', 'update', dt, state);
  callMod('climate', 'update', dt, state);
  callMod('sitedata', 'update', dt, state);
  mapFog();
  { const far = cam === persp && mode !== 'walk' && persp.position.distanceTo(orbitP.target) > 260; const v = state.show.labels && !far; if (labelsG.visible !== v) { labelsG.visible = v; labelsDirty = true; } }
  // camera
  stepTween(dt);
  if (mode === 'walk') stepWalk(dt); else if (mode === 'iso') orbitP.update(); else orbitO.update();
  // things that move (FarmDroid)
  if (++frameN % 10 === 0) {
    refreshRobot();
    if (robotLabelAt && itemById.farmdroid.label) {
      robotLabelAt.getWorldPosition(_v); _v.y += 0.35;
      if (_v.distanceToSquared(itemById.farmdroid.label.position) > 1e-4) { itemById.farmdroid.label.position.copy(_v); labelsDirty = true; }
    }
  }
  if (selected && (selected.id === 'farmdroid' || selected.id === 'cabbage' || selected.id === 'film')) selBoxes();
  if (now - uiT > 100) { uiT = now; syncClock(); if (sim.autoSeason) syncGrowth(); }
  if (now - hudT > 250) { hudT = now; updateHud(); }
  if (batches.length) syncBatches();
  if (!glLost) { updateShadowsIfNeeded(now); if (composer) composer.render(); else renderer.render(scene, cam); }
  renderLabels();
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  persp.aspect = innerWidth / innerHeight; persp.updateProjectionMatrix(); fitOrtho();
  if (mode === 'iso' && !camTouched) isoHome();
  renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
  labelRenderer.setSize(innerWidth, innerHeight); labelsDirty = true;
});

// ---------------- start ----------------
renderList(); hudTemplate(); syncPlay(); syncClock(); syncGrowth();
setMode('iso');
// compile every shader program before the first frame without blocking (KHR_parallel_shader_compile); with the
// composer the scene is drawn into a render target, which is part of the program key, so compile for that target
{
  const prev = renderer.getRenderTarget(); let p;
  try { renderer.setRenderTarget(composer ? composer.readBuffer : null); p = renderer.compileAsync(scene, persp); }
  catch (e) { console.warn('compile failed', e); } finally { renderer.setRenderTarget(prev); }
  try { await p; } catch (e) { console.warn('compileAsync failed', e); }
}
updateHud(); renderYears(true); renderLayers(); renderLoc();
if (!isDefaultSite(state.site)) applySite(state.site, { initial: true });
else if (mods.geo) Promise.resolve(mods.geo.ready).catch(() => {}).then(() => { ctx.invalidateShadows(); renderYears(true); });
frame();
requestAnimationFrame(() => boot?.done());
if (QUALITY.software && !QUALITY.forced) notice(esc(t('slow.notice', { fps: '<10' })), 15000);
window.__witkowo = { applySite, openPanel, libs, colliders, setXray, flyToFlow, state, sim, mods, ctx, info, setMode, select, ITEMS, walk, persp, orbitP, ortho, pickAt, QUALITY, get mode() { return mode; }, get cam() { return cam; } };
