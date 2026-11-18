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
import { t, setLang, onLang, applyDom } from './lib/i18n.js?v=202611181551';

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
// low: phones/tablets (coarse pointer), small screens, <= 4 GB RAM, small GPUs, software GL, or ?q=low. ?q=high forces high.
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
const qp = new URLSearchParams(location.search).get('q');
const AUTO_KEY = 'q3dAutoLow:' + location.pathname;
const QUALITY = {
  low: qp === 'low' || (qp !== 'high' && (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600
    || (!!navigator.deviceMemory && navigator.deviceMemory <= 4) || ssGet(AUTO_KEY) === '1')),
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
function makeRenderer() {
  for (const opts of [{ antialias: !QUALITY.low, powerPreference: QUALITY.low ? 'default' : 'high-performance' }, { antialias: false, powerPreference: 'default' }]) {
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
const narrow = () => Math.max(1, 1.05 / (innerWidth / innerHeight)); // portrait: widen so the whole plan fits
function fitOrtho() { const a = innerWidth / innerHeight, s = SIZE * 0.6 * narrow(); ortho.left = -s * a; ortho.right = s * a; ortho.top = s; ortho.bottom = -s; ortho.updateProjectionMatrix(); }
fitOrtho();
const orbitP = new OrbitControls(persp, renderer.domElement); orbitP.enableDamping = true; orbitP.maxPolarAngle = 1.5; orbitP.minDistance = 2.5; orbitP.maxDistance = 260;
const orbitO = new OrbitControls(ortho, renderer.domElement); orbitO.enableRotate = false; orbitO.screenSpacePanning = true; orbitO.enableDamping = true; orbitO.minZoom = 0.5; orbitO.maxZoom = 12;
orbitO.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
orbitO.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
orbitP.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
ortho.position.set(C.x, 60, C.z + 0.01); orbitO.target.copy(C); ortho.lookAt(C);
// same direction as the reference overview render (reference/Witkowo_overview.png)
const ISO_DIR = new THREE.Vector3(42, 29, 53).normalize();
const isoHome = () => { orbitP.target.set(C.x, 1, C.z); persp.position.copy(orbitP.target).addScaledVector(ISO_DIR, 62 * Math.min(1.7, narrow())); };
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
  if (!it.objs.length) { console.warn('No nodes for', it.id); continue; }
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
  quality: QUALITY.low ? 'low' : 'high',
  show: { power: true, water: true, labels: !smallMQ.matches },
};
const sim = { playing: true, irrigation: 'auto', autoSeason: false };
let cam = persp;
const ctx = {
  THREE, scene, root, node, renderer, getCamera: () => cam,
  // extras beyond the contract (optional for modules): all objects with a name, bloom pass (null on low tier), state
  nodes, bloom: bloomPass || null, state,
};
const MOD_ORDER = ['sky', 'power', 'water', 'growth'];
const mods = {};
const modErr = (name, where, e) => console.warn(`[${name}] ${where} failed, module disabled:`, e);
boot?.progress?.(t('boot.modules'));
const lightsBefore = new Set(); scene.traverse((o) => { if (o.isLight) lightsBefore.add(o); });
{
  const loaded = await Promise.all(MOD_ORDER.map((n) => import(`./lib/${n}.js${new URL(import.meta.url).search}`).then((m) => m, (e) => { console.warn(`[${n}] not loaded:`, e.message || e); return null; })));
  MOD_ORDER.forEach((n, i) => {
    const m = loaded[i]; if (!m || typeof m.init !== 'function') return;
    try { const api = m.init(ctx); if (api && typeof api.update === 'function') mods[n] = api; else console.warn(`[${n}] init returned no update()`); }
    catch (e) { modErr(n, 'init', e); }
  });
}
// sky.js added its own lights: drop the fallback ones
{
  let skyLights = 0; scene.traverse((o) => { if (o.isLight && !lightsBefore.has(o)) skyLights++; });
  if (mods.sky && skyLights) { scene.remove(fbHemi, fbSun, fbSun.target); }
  // sky.js draws its own ground below the horizon (dome) and fog; the fallback farmland planes would show seams
  if (mods.sky) { scene.remove(ground, groundIn); ground.geometry.dispose(); groundIn.geometry.dispose(); }
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
// pick list: every model mesh, including meshes the modules added under root (unknown ones only occlude)
pickMeshes.length = 0; root.traverse((o) => { if (o.isMesh) { pickMeshes.push(o); o.layers.enable(PICK_LAYER); } });
callMod('power', 'setVisible', state.show.power);
callMod('water', 'setVisible', state.show.water);

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
let mode = 'iso', isoPose = null, tween = null;
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
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function flyTo(target, dist, zoom) {
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
function blocked(x, z, r = R_WALK) {
  if (x < SITE.x0 + r || x > SITE.x1 - r || z < SITE.z0 + r || z > SITE.z1 - r) return true;
  for (const c of colliders) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
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
    html += `<li class="item${selected === it ? ' on' : ''}" data-id="${it.id}" tabindex="0" role="button"><span class="dot" style="background:${it.color}"></span>${esc(t('obj.' + it.id))}</li>`;
  }
  $('#objects').innerHTML = html;
  for (const it of ITEMS) if (labelEls[it.id]) labelEls[it.id].textContent = t('obj.' + it.id);
}
$('#objects').addEventListener('click', (e) => { const li = e.target.closest('li.item'); if (li) select(itemById[li.dataset.id], true); });
$('#objects').addEventListener('keydown', (e) => { const li = e.target.closest('li.item'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); li.click(); } });

// ---------------- small screens: drawer + bottom sheets ----------------
function syncSheets() {
  const d = $('#drawer').classList.contains('open'), p = $('#panel').classList.contains('open');
  document.body.classList.toggle('drawer', d); document.body.classList.toggle('sheet', smallMQ.matches && (d || p));
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
  if (!it) { selHelpers.forEach((h) => (h.visible = false)); panel.classList.remove('open'); syncSheets(); return; }
  if (smallMQ.matches && !sideMQ.matches) setDrawer(false);
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
  const c = cam, bg = scene.background, au = renderer.shadowMap.autoUpdate, mask = c.layers.mask, saved = [];
  const list = pickMeshes.filter((m) => m.visible && m.material); // growth.js hides the original merged wheel meshes
  for (const m of list) { saved.push(m.material); const it = ownerOf.get(m); m.material = it ? pickMats[ITEMS.indexOf(it)] : occluder; }
  scene.background = null; renderer.shadowMap.autoUpdate = false; c.layers.set(PICK_LAYER);
  c.setViewOffset(innerWidth, innerHeight, Math.floor(x), Math.floor(y), 1, 1);
  const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearAlpha();
  try {
    renderer.setRenderTarget(pickRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, c);
    renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
  } finally {
    renderer.setRenderTarget(prevRT); renderer.setClearAlpha(prevClear);
    c.clearViewOffset(); c.layers.mask = mask; scene.background = bg; renderer.shadowMap.autoUpdate = au;
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
  tween = null;
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
const irrSchedule = (h) => (h >= 5 && h < 7) || (h >= 19 && h < 21);
$('#tPower').addEventListener('change', (e) => { state.show.power = e.target.checked; callMod('power', 'setVisible', state.show.power); });
$('#tWater').addEventListener('change', (e) => { state.show.water = e.target.checked; callMod('water', 'setVisible', state.show.water); });
$('#tLabels').checked = state.show.labels; labelsG.visible = state.show.labels;
$('#tLabels').addEventListener('change', (e) => { state.show.labels = labelsG.visible = e.target.checked; labelsDirty = true; });

// ---------------- sun shadows (high tier; off and hidden on the low tier) ----------------
function sunLights() { const out = []; scene.traverse((o) => { if (o.isDirectionalLight && o.visible) out.push(o); }); return out; }
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
  for (const m of meshes) { m.castShadow = on && !GROUND_NODES.has(m.userData.nodeName); m.receiveShadow = on; }
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((mm) => (mm.needsUpdate = true)); });
}
const hideShadowToggle = () => { $('#tShadow').checked = false; $('#lShadow').style.display = 'none'; };
$('#tShadow').addEventListener('change', (e) => applyShadows(e.target.checked && !QUALITY.low));
if (QUALITY.low) hideShadowToggle();
else { $('#tShadow').checked = true; applyShadows(true); }

// ---------------- HUD ----------------
const stageName = (s) => (s ? t('stage.' + s) : t('hud.na'));
const info = { sky: null, power: null, water: null, growth: null };
function readInfo() { for (const n of MOD_ORDER) info[n] = mods[n] && typeof mods[n].info === 'function' ? callMod(n, 'info') ?? null : null; }
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
      <dt><i style="background:var(--leaf)"></i>${esc(t('hud.crop'))}</dt><dd id="hCrop"></dd>
      <div class="bar"><b id="hCropBar" style="background:var(--leaf)"></b></div>
    </dl>`;
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
  const on = state.water > 0.01;
  $('#vIrr').textContent = on ? t('irr.on') : t('irr.off');
  if (selected) { const l = liveHtml(selected), el = $('#plive'); if (el && l != null) el.innerHTML = l; }
}

// ---------------- language switch: re-render dynamic text ----------------
function relabel() {
  renderList(); hudTemplate(); updateHud(); syncPlay(); setHint();
  if (selected) renderPanel();
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
let hudT = 0, uiT = 0, frameN = 0;
const robotLabelAt = node('FarmDroid / GNSS antenna');
const _v = new THREE.Vector3();
function frame() {
  const raw = clock.getDelta(), dt = Math.min(0.05, raw), now = performance.now();
  probeFrame(raw);
  // simulated clock
  if (sim.playing && !clockDrag) {
    const dh = (dt * state.speed) / 3600;
    state.hour += dh; if (state.hour >= 24) state.hour -= 24;
    if (sim.autoSeason && !growthDrag) { state.dayOfSeason += dh * SEASON_PER_SIM_HOUR; if (state.dayOfSeason > 100) state.dayOfSeason = 0; }
  }
  const target = sim.irrigation === 'on' ? 1 : sim.irrigation === 'off' ? 0 : irrSchedule(state.hour) ? 1 : 0;
  state.water += clamp(target - state.water, -dt * 2, dt * 2); // valve opens / closes over ~0.5 s
  // simulation modules: sky -> power -> water -> growth
  if (mods.sky) callMod('sky', 'update', dt, state);
  if (fallbackSky) fallbackSkyUpdate();
  callMod('power', 'update', dt, state);
  callMod('water', 'update', dt, state);
  callMod('growth', 'update', dt, state);
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
  if (selected && (selected.id === 'farmdroid' || selected.id === 'cabbage')) selBoxes();
  if (now - uiT > 100) { uiT = now; syncClock(); if (sim.autoSeason) syncGrowth(); }
  if (now - hudT > 250) { hudT = now; updateHud(); }
  if (!glLost) { if (composer) composer.render(); else renderer.render(scene, cam); }
  renderLabels();
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  persp.aspect = innerWidth / innerHeight; persp.updateProjectionMatrix(); fitOrtho();
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
updateHud();
frame();
requestAnimationFrame(() => boot?.done());
if (QUALITY.software && !QUALITY.forced) notice(esc(t('slow.notice', { fps: '<10' })), 15000);
window.__witkowo = { colliders, state, sim, mods, ctx, info, setMode, select, ITEMS, walk, persp, orbitP, ortho, pickAt, QUALITY, get mode() { return mode; }, get cam() { return cam; } };
