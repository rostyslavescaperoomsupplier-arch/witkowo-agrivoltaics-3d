// Irrigation water flow: Field control cabinet -> header pipe along the front of the beds (z +0.68, clear of
// the water tanks z <= -0.3 and the parked FarmDroid z >= 1.0) -> drip lines -> emitters next to each
// cabbage -> wet soil patches.
//
// Data sources (model v6, see reference/Rebuild_in_Blender.py):
//   drip lines   x = cx - 3.375 + i*0.75 (cx = -5, 5; i = 0..9), y 0.045, r 0.012, z 0 .. -30
//   plants       x = line x +-0.05, z = -(1 + iy*0.88) +-0.08 (seeded jitter), 32 per line
// At init the exact line x / z extent is measured from the `Drip irrigation` vertices and every emitter z is
// the centroid of one cabbage head in `Cabbage heads`. The parametric grid is only a fallback.

const SITE = { x0: -18, x1: 18, z0: -36, z1: 6 };   // wetness texture footprint (world metres)
const TEX_PPM = 16;                                  // texels per metre
const WET_R = 0.4;                                   // max wet patch radius (m)
const LPH_PER_EMITTER = 2;                           // litres per hour per emitter

const SRC = { x: 13.75, yTop: 0.36, z: -0.77 };      // pipe leaves the cabinet front face (z -0.8)
const HEADER_Y = 0.035, HEADER_R = 0.022, HEADER_Z = 0.68; // in front of the ballast blocks (z +-0.57)
const LINE_Y = 0.045, LINE_R = 0.012;

export function init(ctx) {
  const THREE = ctx.THREE;
  const root = ctx.root;
  root.updateMatrixWorld(true);

  // ---------------------------------------------------------------- geometry facts from the GLB
  const lineInfo = measureLineXs(THREE, findNode(ctx, 'Drip irrigation'));
  const lineXs = lineInfo.xs;
  const LZ0 = Math.min(0, lineInfo.zMax), LZ1 = lineInfo.zMin;   // drip lines run from z ~0 to z ~-30
  const lineLen = LZ0 - LZ1;
  const emitters = measureEmitters(THREE, findNode(ctx, 'Cabbage heads'), lineXs); // [{x,z,line,side}]

  const headerX1 = Math.min(...lineXs);              // header ends at the farthest drip line
  const dRiser = SRC.yTop - HEADER_Y;
  const dRunner = HEADER_Z - SRC.z;
  const dHeader0 = dRiser + dRunner;                 // flow distance at header start (x = SRC.x)
  const headerDist = (x) => dHeader0 + (SRC.x - x);
  const lineStartDist = (x) => headerDist(x) + HEADER_Z; // distance at z = 0 on a drip line (lines start at z ~0)
  let maxDist = 0;
  for (const e of emitters) {
    e.dist = lineStartDist(e.x) - e.z;
    if (e.dist > maxDist) maxDist = e.dist;
  }
  for (const x of lineXs) maxDist = Math.max(maxDist, lineStartDist(x) + lineLen);

  const group = new THREE.Group();
  group.name = 'Irrigation water';
  ctx.scene.add(group);

  // ---------------------------------------------------------------- physical pipe (always visible)
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x15191a, roughness: 0.55, metalness: 0 });
  const segs = [];
  segs.push([SRC.x, SRC.yTop, SRC.z, SRC.x, HEADER_Y, SRC.z, HEADER_R]);
  segs.push([SRC.x, HEADER_Y, SRC.z, SRC.x, HEADER_Y, HEADER_Z, HEADER_R]);
  segs.push([SRC.x, HEADER_Y, HEADER_Z, headerX1 - 0.05, HEADER_Y, HEADER_Z, HEADER_R]);
  for (const x of lineXs) segs.push([x, LINE_Y, HEADER_Z, x, LINE_Y, 0, LINE_R]);
  const pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
  const pipes = new THREE.InstancedMesh(pipeGeo, pipeMat, segs.length + lineXs.length + 2);
  pipes.name = 'Irrigation header';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), va = new THREE.Vector3(), vb = new THREE.Vector3();
  const vs = new THREE.Vector3(), vy = new THREE.Vector3(0, 1, 0), vd = new THREE.Vector3();
  let k = 0;
  for (const s of segs) {
    va.set(s[0], s[1], s[2]); vb.set(s[3], s[4], s[5]);
    vd.subVectors(vb, va); const len = vd.length() + s[6] * 2; vd.normalize();
    q.setFromUnitVectors(vy, vd); va.add(vb).multiplyScalar(0.5); vs.set(s[6], len, s[6]);
    pipes.setMatrixAt(k++, m4.compose(va, q, vs));
  }
  // tees on the header + an inline valve and filter at the cabinet
  q.identity();
  for (const x of lineXs) pipes.setMatrixAt(k++, m4.compose(va.set(x, HEADER_Y, HEADER_Z), q, vs.set(0.032, 0.05, 0.032)));
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x0b4f8f, roughness: 0.45 });
  pipes.setMatrixAt(k++, m4.compose(va.set(SRC.x, 0.25, SRC.z), q, vs.set(0.04, 0.09, 0.04)));
  pipes.setMatrixAt(k++, m4.compose(va.set(SRC.x, 0.12, SRC.z), q, vs.set(0.035, 0.07, 0.035)));
  pipes.count = k;
  pipes.castShadow = true; pipes.receiveShadow = true;
  pipes.instanceMatrix.needsUpdate = true;
  group.add(pipes);
  const valve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.07), blueMat);
  valve.position.set(SRC.x, 0.25, SRC.z);
  valve.name = 'Irrigation valve';
  group.add(valve);

  // ---------------------------------------------------------------- water overlay tubes (scrolling pulses)
  const tubePos = [], tubeDist = [], tubeIdx = [];
  const addTube = (ax, ay, az, bx, by, bz, r, da, db, sides) => {
    va.set(ax, ay, az); vb.set(bx, by, bz); vd.subVectors(vb, va).normalize();
    const u = new THREE.Vector3(), w = new THREE.Vector3();
    u.set(0, 1, 0); if (Math.abs(vd.y) > 0.9) u.set(1, 0, 0);
    w.crossVectors(vd, u).normalize(); u.crossVectors(w, vd).normalize();
    const base = tubePos.length / 3;
    for (let end = 0; end < 2; end++) {
      const p = end ? vb : va, d = end ? db : da;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2, c = Math.cos(a) * r, sn = Math.sin(a) * r;
        tubePos.push(p.x + u.x * c + w.x * sn, p.y + u.y * c + w.y * sn, p.z + u.z * c + w.z * sn);
        tubeDist.push(d);
      }
    }
    for (let i = 0; i < sides; i++) {
      const i1 = (i + 1) % sides;
      tubeIdx.push(base + i, base + sides + i, base + i1, base + i1, base + sides + i, base + sides + i1);
    }
  };
  const HR = HEADER_R + 0.006, LR = LINE_R + 0.006;
  addTube(SRC.x, SRC.yTop, SRC.z, SRC.x, HEADER_Y, SRC.z, HR, 0, dRiser, 8);
  addTube(SRC.x, HEADER_Y, SRC.z, SRC.x, HEADER_Y, HEADER_Z, HR, dRiser, dHeader0, 8);
  addTube(SRC.x, HEADER_Y, HEADER_Z, headerX1, HEADER_Y, HEADER_Z, HR, dHeader0, headerDist(headerX1), 8);
  for (const x of lineXs) {
    const d0 = headerDist(x), d1 = lineStartDist(x);
    addTube(x, LINE_Y, HEADER_Z, x, LINE_Y, 0, LR, d0, d1, 6);
    addTube(x, LINE_Y, LZ0, x, LINE_Y, LZ1, LR, d1, d1 + lineLen, 6);
  }
  const tubeGeo = new THREE.BufferGeometry();
  tubeGeo.setAttribute('position', new THREE.Float32BufferAttribute(tubePos, 3));
  tubeGeo.setAttribute('aDist', new THREE.Float32BufferAttribute(tubeDist, 1));
  tubeGeo.setIndex(tubeIdx);
  tubeGeo.computeBoundingSphere();

  const U = {
    uScroll: { value: 0 }, uFront: { value: 0 }, uFlow: { value: 0 },
    uDrop: { value: 0 }, uPx: { value: 600 },
  };
  const tubeMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aDist; varying float vDist;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() { vDist = aDist; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uScroll, uFront, uFlow; varying float vDist;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        if (vDist > uFront || uFlow < 0.01) discard;
        float ph = fract((vDist - uScroll) / 1.4);
        float pulse = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.22, 0.45, ph));
        float tip = 1.0 - smoothstep(0.0, 1.2, uFront - vDist);
        vec3 col = mix(vec3(0.05, 0.42, 1.0), vec3(0.75, 0.97, 1.0) * 1.8, max(pulse, tip));
        gl_FragColor = vec4(col, uFlow * mix(0.8, 1.0, max(pulse, tip)));
      }`,
  });
  const tubes = new THREE.Mesh(tubeGeo, tubeMat);
  tubes.name = 'Irrigation flow';
  tubes.renderOrder = 2;
  tubes.frustumCulled = false;

  // ---------------------------------------------------------------- drops at emitters (Points)
  const n = emitters.length;
  const dPos = new Float32Array(n * 3), dDist = new Float32Array(n), dPhase = new Float32Array(n);
  const dSide = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const e = emitters[i];
    dPos[i * 3] = e.x; dPos[i * 3 + 1] = LINE_Y; dPos[i * 3 + 2] = e.z;
    dDist[i] = e.dist; dPhase[i] = rnd(); dSide[i] = e.side;
  }
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dropGeo.setAttribute('aDist', new THREE.BufferAttribute(dDist, 1));
  dropGeo.setAttribute('aPhase', new THREE.BufferAttribute(dPhase, 1));
  dropGeo.setAttribute('aSide', new THREE.BufferAttribute(dSide, 1));
  const dropMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      uniform float uDrop, uFront, uFlow, uPx;
      attribute float aDist, aPhase, aSide;
      varying float vA;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        float t = fract(uDrop + aPhase);
        float grow = clamp(t / 0.7, 0.0, 1.0);
        float fall = clamp((t - 0.7) / 0.3, 0.0, 1.0);
        vec3 p = position;
        p.x += aSide * 0.024;                       // bead forms on the plant side of the line
        p.y += 0.004 - fall * fall * 0.05;          // falls to the soil
        float size = 0.016 + 0.022 * sqrt(grow);    // metres
        vA = uFlow * step(aDist, uFront - 0.2) * (1.0 - fall * 0.85);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * uPx / max(-mv.z, 0.05), 1.5, 48.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c);
        if (r2 > 1.0 || vA < 0.01) discard;
        float hl = smoothstep(0.35, 0.0, length(c - vec2(-0.35, -0.35)));
        vec3 col = mix(vec3(0.16, 0.5, 0.9), vec3(0.85, 0.96, 1.0), hl + 0.25 * (1.0 - r2));
        gl_FragColor = vec4(col, vA * (0.75 + 0.25 * (1.0 - r2)));
      }`,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.name = 'Irrigation drops';
  drops.renderOrder = 3;
  drops.frustumCulled = false;

  const flowGroup = new THREE.Group();
  flowGroup.add(tubes, drops);
  group.add(flowGroup);

  // ---------------------------------------------------------------- wet soil (RG8 texture + shader patch)
  const TW = Math.round((SITE.x1 - SITE.x0) * TEX_PPM), TH = Math.round((SITE.z1 - SITE.z0) * TEX_PPM);
  const texData = new Uint8Array(TW * TH * 2);
  const rad = Math.ceil(WET_R * 1.3 * TEX_PPM);
  for (let i = 0; i < n; i++) {
    const e = emitters[i];
    const cx = (e.x + e.side * 0.04 - SITE.x0) * TEX_PPM, cz = (e.z - SITE.z0) * TEX_PPM;
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, g = Math.round((e.dist / maxDist) * 255);
    const ix0 = Math.max(0, Math.floor(cx - rad)), ix1 = Math.min(TW - 1, Math.ceil(cx + rad));
    const iz0 = Math.max(0, Math.floor(cz - rad)), iz1 = Math.min(TH - 1, Math.ceil(cz + rad));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = (ix + 0.5 - cx) / TEX_PPM, dz = (iz + 0.5 - cz) / TEX_PPM;
        const a = Math.atan2(dz, dx * 1.15);
        const rr = WET_R * (1 + 0.13 * Math.sin(3 * a + p1) + 0.08 * Math.sin(5 * a + p2));
        const v = 1 - Math.hypot(dx * 1.15, dz) / rr;    // slightly elongated along the line
        if (v <= 0) continue;
        const o = (iz * TW + ix) * 2, val = Math.round(v * 255);
        if (val > texData[o]) { texData[o] = val; texData[o + 1] = g; }
      }
    }
  }
  const wetTex = new THREE.DataTexture(texData, TW, TH, THREE.RGFormat, THREE.UnsignedByteType);
  wetTex.magFilter = THREE.LinearFilter; wetTex.minFilter = THREE.LinearFilter;
  wetTex.needsUpdate = true;
  const WU = {
    uWetTex: { value: wetTex }, uWet: { value: 0 }, uWetFront: { value: 0 },
    uWetMax: { value: maxDist },
    uWetSite: { value: new THREE.Vector4(SITE.x0, SITE.z0, SITE.x1 - SITE.x0, SITE.z1 - SITE.z0) },
  };
  const patched = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || patched.has(m) || (m.name !== 'Soil' && m.name !== 'Dark earth')) continue;
      patched.add(m);
      patchSoil(m, WU);
    }
  });

  // ---------------------------------------------------------------- simulation state
  const st = {
    flow: 0, front: 0, scroll: 0, dropClock: 0, wet: 0, wetFront: 0,
    lastHour: null, litresToday: 0, lpm: 0, visible: true,
  };
  const out = { lpm: 0, litresToday: 0, wetness: 0, emitters: n, lines: lineXs.length };
  const bufSize = new THREE.Vector2();

  function update(dt, state) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const target = Math.min(Math.max(state.water || 0, 0), 1);
    // valve ramp ~1 s
    st.flow += Math.max(-dt, Math.min(dt, target - st.flow));

    // simulated time step from state.hour (reset on 24 -> 0 wrap)
    let dh = 0;
    if (st.lastHour !== null) {
      dh = state.hour - st.lastHour;
      if (dh < -12) { st.litresToday = 0; dh += 24; }
      else if (dh < 0) dh = 0;
    }
    st.lastHour = state.hour;

    st.lpm = (n * LPH_PER_EMITTER / 60) * target;
    st.litresToday += st.lpm * dh * 60;

    // animation pace: natural at 1x, gently faster at high sim speed, frozen when paused
    const sp = state.speed == null ? 1 : state.speed;
    const pace = sp <= 0 ? 0 : Math.min(2.5, 1 + 0.6 * Math.log10(Math.max(sp, 1)));
    const v = 3.0 * pace;                                // m/s of the visual water front
    if (st.flow > 0.01) st.front = Math.min(maxDist + 2, st.front + v * dt * st.flow);
    else st.front = Math.max(0, st.front - v * 0.5 * dt * pace);
    st.scroll += v * 0.45 * dt * st.flow;
    st.dropClock += dt * pace * 0.6;
    if (st.scroll > 1e4) st.scroll -= 1e4 - (1e4 % 1.4);
    if (st.dropClock > 1e4) st.dropClock -= 1e4;

    // soil wetness: grows while water is on, dries slowly (faster in sun)
    const sun = state.sun || 0;
    if (target > 0.01) st.wet += target * (1 - st.wet) * (dt / 7 + dh / 0.4);
    st.wet -= st.wet * (dt / 90 + dh * (0.25 + 0.5 * sun)) * (target > 0.01 ? 0.15 : 1);
    st.wet = Math.min(1, Math.max(0, st.wet));
    if (st.front > st.wetFront) st.wetFront = st.front;
    if (st.wet < 0.01 && target < 0.01) st.wetFront = st.front;

    U.uFront.value = st.front;
    U.uFlow.value = st.flow;
    U.uScroll.value = st.scroll;
    U.uDrop.value = st.dropClock;
    WU.uWet.value = st.wet;
    WU.uWetFront.value = st.wetFront;

    const cam = ctx.getCamera && ctx.getCamera();
    if (cam && cam.isPerspectiveCamera && ctx.renderer) {
      ctx.renderer.getDrawingBufferSize(bufSize);
      U.uPx.value = bufSize.y * cam.projectionMatrix.elements[5] * 0.5;
    }
    const show = !state.show || state.show.water !== false;
    flowGroup.visible = st.visible && show && st.flow > 0.005;
  }

  return {
    update,
    info() {
      out.lpm = st.lpm;
      out.litresToday = st.litresToday;
      out.wetness = st.wet;
      return out;
    },
    setVisible(b) { st.visible = !!b; },
    // for QA / other modules
    emitters, lineXs, maxDist, group,
  };
}

// ------------------------------------------------------------------ helpers

// Drip line x positions: cluster the `Drip irrigation` vertices by x (gap > 0.2 m starts a new line).
// Also returns the z extent of the lines. Fallback = v6 generator grid (cx = -5, 5; 10 lines each).
function measureLineXs(THREE, node) {
  const fallback = [];
  for (const cx of [-5, 5]) for (let i = 0; i < 10; i++) fallback.push(+(cx - 3.375 + i * 0.75).toFixed(3));
  const res = { xs: fallback, zMin: -30, zMax: 0 };
  const mesh = firstMesh(node);
  if (!mesh) return res;
  const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
  const xs = new Float32Array(pos.count);
  let zMin = 1e9, zMax = -1e9;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    xs[i] = v.x; if (v.z < zMin) zMin = v.z; if (v.z > zMax) zMax = v.z;
  }
  xs.sort();
  const out = [];
  let sum = 0, cnt = 0;
  for (let i = 0; i < xs.length; i++) {
    if (cnt && xs[i] - xs[i - 1] > 0.2) { out.push(sum / cnt); sum = 0; cnt = 0; }
    sum += xs[i]; cnt++;
  }
  if (cnt) out.push(sum / cnt);
  if (out.length) { res.xs = out; res.zMin = zMin; res.zMax = zMax; }
  return res;
}

function measureEmitters(THREE, node, lineXs) {
  const NY = 34, res = [];
  const mesh = firstMesh(node);
  const L = lineXs.length;
  const sumX = new Float64Array(L * NY), sumZ = new Float64Array(L * NY), cnt = new Uint32Array(L * NY);
  if (mesh) {
    const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      let li = 0, best = 1e9;
      for (let k = 0; k < lineXs.length; k++) { const d = Math.abs(v.x - lineXs[k]); if (d < best) { best = d; li = k; } }
      if (best > 0.3) continue;
      const iy = Math.round((-v.z - 1) / 0.88);
      if (iy < 0 || iy >= NY) continue;
      const k = li * NY + iy; sumX[k] += v.x; sumZ[k] += v.z; cnt[k]++;
    }
  }
  for (let li = 0; li < lineXs.length; li++) {
    for (let iy = 0; iy < NY; iy++) {
      const k = li * NY + iy;
      if (mesh) {
        if (!cnt[k]) continue;
        const px = sumX[k] / cnt[k], pz = sumZ[k] / cnt[k];
        res.push({ x: lineXs[li], z: pz, line: li, side: px >= lineXs[li] ? 1 : -1, dist: 0 });
      } else if (iy < 32) {
        res.push({ x: lineXs[li], z: -(1 + iy * 0.88), line: li, side: 1, dist: 0 });
      }
    }
  }
  return res;
}

// GLTFLoader sanitises node names ("Canopy 1 / x" -> "Canopy_1__x"); the original lives in userData.name.
function findNode(ctx, name) {
  let hit = null;
  ctx.root.traverse((o) => { if (!hit && o.userData && o.userData.name === name) hit = o; });
  if (hit) return hit;
  hit = ctx.node ? ctx.node(name) : null;
  if (hit) return hit;
  const clean = name.replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');
  return ctx.root.getObjectByName(clean) || null;
}

function firstMesh(node) {
  if (!node) return null;
  if (node.isMesh) return node;
  let m = null;
  node.traverse((o) => { if (!m && o.isMesh) m = o; });
  return m;
}

function patchSoil(mat, WU) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, WU);
    shader.vertexShader = 'varying vec3 vWaterWP;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n vWaterWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `
      varying vec3 vWaterWP;
      uniform sampler2D uWetTex; uniform float uWet, uWetFront, uWetMax; uniform vec4 uWetSite;
      float waterWetness() {
        vec2 uv = (vWaterWP.xz - uWetSite.xy) / uWetSite.zw;
        vec2 s = texture2D(uWetTex, uv).rg;
        float local = uWet * clamp((uWetFront - s.g * uWetMax) / 3.0, 0.0, 1.0);
        float edge = 1.0 - local;
        return s.r > 0.0 ? smoothstep(edge, edge + 0.18, s.r) * (0.8 + 0.2 * s.r) : 0.0;
      }
    ` + shader.fragmentShader
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n float wWater = waterWetness();\n diffuseColor.rgb *= mix(1.0, 0.5, wWater);')
      .replace('#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.32, wWater);');
  };
  mat.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : '') + '|water-wet';
  };
  mat.needsUpdate = true;
}
