// Electricity flow: PV cells -> junction boxes -> hanging leads -> roof cable trunks -> front column conduit ->
// ground run -> inverter wiring (DC, amber) ; inverters -> rack rail -> rack post -> grid at x -18 (AC, cyan).
// Path coordinates follow reference/Rebuild_in_Blender.py; Blender (x, y, z) maps to three (x, z, -y).
// Model v6: cross-checked against GLB bounds (cable trunk y 4.08..4.70, junction boxes y 4.73..4.81,
// hanging leads y 4.31..4.78, conduit x cx+0.19..0.25, wiring z ~1.0).

const DC_RGB = [2.2, 1.25, 0.32];   // ~#ffb43a pushed into HDR so UnrealBloom picks it up
const AC_RGB = [0.35, 1.7, 2.3];    // cyan
const KW_PER_M2 = 0.2, SYS_EFF = 0.8;
// v6: 40 modules per canopy x 6x8 cells x 0.17x0.15 m = 48.96 m2 of cells per canopy
const NOMINAL_CELL_AREA = 40 * 48 * 0.17 * 0.15;
const CANOPY_CX = [-10, 0, 10];
const INV_X = [-11.9, -11.0, -10.1];

export function init(ctx) {
  const { THREE, scene } = ctx;
  // GLTFLoader sanitises node names ("Canopy 1 / x" -> "Canopy_1__x", original kept in userData.name),
  // so try the exact name, the sanitised one, then a userData.name scan.
  const node = (name) => {
    let o = ctx.node && (ctx.node(name) || ctx.node(THREE.PropertyBinding.sanitizeNodeName(name)));
    if (!o && ctx.root) ctx.root.traverse(c => { if (!o && (c.userData && c.userData.name === name)) o = c; });
    return o;
  };
  const group = new THREE.Group();
  group.name = 'Power flow';
  scene.add(group);

  // ---------- path building ----------
  // b(x, y, z) converts Blender coords to three coords.
  const b = (x, y, z) => [x, z, -y];
  const dcPaths = [], acPaths = [];
  const kindOfPath = []; // 0 = lead, 1 = trunk, 2 = ac

  // Model v6 "butterfly" roof: the generator lifts every roof vertex by |x-cx|*0.21 (full above z 4.08, fading
  // to 0 at z 3.15). v(cx, x, y, z) applies the same lift so the paths land on the deformed cables.
  const v = (cx, x, y, z) => b(x, y, z + Math.abs(x - cx) * 0.21 * Math.max(0, Math.min(1, (z - 3.15) / 0.93)));

  for (let ci = 0; ci < 3; ci++) {
    const cx = CANOPY_CX[ci];
    // outer cable trunks (x+0.09 of the outer longitudinal girders); the centre trunk gets no leads in v6
    const trunkX = [cx - 2.75 + 0.09, cx + 2.75 + 0.09];
    // 1) junction box -> hanging lead -> short hop onto the trunk on the same side.
    //    2 module rows at cx -/+ 2.05, 20 modules each at y = 0.75 + j*1.5; lead ends at px+0.45.
    for (let j = 0; j < 20; j++) {
      const y = 0.75 + j * 1.5;
      for (let k = 0; k < 2; k++) {
        const px = cx + (k === 0 ? -2.05 : 2.05);
        const ty = Math.min(y + 0.62, 30.4);
        dcPaths.push([
          v(cx, px, y, 4.34), v(cx, px + 0.13, y + 0.12, 4.05), v(cx, px + 0.3, y + 0.4, 3.99),
          v(cx, px + 0.45, y + 0.62, 4.08), v(cx, trunkX[k], ty, 4.08),
        ]);
        kindOfPath.push(0);
      }
    }
    // 2) each outer trunk: rear end -> front end -> collector in front of the y=0 cross girder (following the V)
    //    -> blue conduit by the centre column (x = cx+0.22) -> ground -> forward to the rack -> inverter wiring.
    const condX = cx + 0.22;
    const groundY = 0.65 + ci * 0.06;  // Blender -y, i.e. three z 0.65..0.77 (in front of tanks, behind rack)
    const inv = INV_X[ci];
    for (let t = 0; t < 2; t++) {
      const tx = trunkX[t];
      const path = [v(cx, tx, 30.4, 4.08), v(cx, tx, -0.3, 4.08)];
      if (t === 0) path.push(v(cx, cx, -0.3, 4.08));         // across the V valley
      path.push(v(cx, condX, -0.3, 4.08), b(condX, 0, 3.85),
        b(condX, 0, 1.45), b(condX, 0, 0.06), b(condX, -groundY, 0.06), b(inv, -groundY, 0.06),
        b(inv, -1, 0.06), b(inv, -1, 0.23), b(inv, -1, 1.15), b(inv + 0.12, -1, 1.23));
      dcPaths.push(path);
      kindOfPath.push(1);
    }
  }
  // 3) AC out: top of each inverter -> top rack rail -> left rack post -> ground -> west site edge
  for (let i = 0; i < 3; i++) {
    const x = INV_X[i];
    acPaths.push([
      b(x, -1, 2.08), b(x, -0.85, 2.12), b(-12.3, -0.85, 2.12), b(-12.3, -0.85, 0.06), b(-18, -0.85 + i * 0.06, 0.06),
    ]);
  }

  // Flatten paths: pts (xyz), cumulative lengths, per-segment quaternion (z axis along segment).
  function pack(paths) {
    let nPts = 0; for (const p of paths) nPts += p.length;
    const pts = new Float32Array(nPts * 3), cum = new Float32Array(nPts), quat = new Float32Array(nPts * 4);
    const start = new Int32Array(paths.length), cnt = new Int32Array(paths.length), len = new Float32Array(paths.length);
    const q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1), d = new THREE.Vector3();
    let o = 0;
    paths.forEach((p, pi) => {
      start[pi] = o; cnt[pi] = p.length; let L = 0;
      for (let i = 0; i < p.length; i++) {
        pts.set(p[i], (o + i) * 3);
        if (i > 0) {
          d.set(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]);
          L += d.length();
          q.setFromUnitVectors(z, d.normalize());
          quat.set([q.x, q.y, q.z, q.w], (o + i - 1) * 4);
        }
        cum[o + i] = L;
      }
      len[pi] = L; o += p.length;
    });
    return { pts, cum, quat, start, cnt, len, n: paths.length };
  }
  const DC = pack(dcPaths), AC = pack(acPaths);

  // ---------- static energised cable glow (thin lines) ----------
  function lines(P, rgb) {
    let segs = 0; for (let i = 0; i < P.n; i++) segs += P.cnt[i] - 1;
    const pos = new Float32Array(segs * 6); let o = 0;
    for (let i = 0; i < P.n; i++) for (let k = P.start[i]; k < P.start[i] + P.cnt[i] - 1; k++) {
      pos.set(P.pts.subarray(k * 3, k * 3 + 6), o); o += 6;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ color: new THREE.Color(rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5),
      transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.renderOrder = 2; group.add(l); return l;
  }
  const dcLines = lines(DC, DC_RGB), acLines = lines(AC, AC_RGB);

  // ---------- pulses ----------
  const pulseGeo = new THREE.SphereGeometry(1, 8, 6);
  function pulses(P, perM, minPer, rgb, radius) {
    const list = [];
    for (let i = 0; i < P.n; i++) {
      const n = Math.max(minPer, Math.round(P.len[i] * perM));
      for (let k = 0; k < n; k++) list.push([i, (k + Math.random() * 0.4) / n, Math.random()]);
    }
    list.sort((a, c) => a[2] - c[2]); // random rank: truncating .count thins evenly everywhere
    const N = list.length, path = new Int32Array(N), phase = new Float32Array(N);
    list.forEach((e, k) => { path[k] = e[0]; phase[k] = e[1]; });
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]), toneMapped: false,
      transparent: true, opacity: 1, depthWrite: false });
    const mesh = new THREE.InstancedMesh(pulseGeo, mat, N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 3; group.add(mesh);
    return { P, mesh, path, phase, N, radius };
  }
  const dcPulses = pulses(DC, 0.9, 2, DC_RGB, 0.022);
  const acPulses = pulses(AC, 1.6, 4, AC_RGB, 0.03);

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function placePulses(S, travel, count) {
    const { P, mesh, path, phase, radius } = S;
    _s.set(radius, radius, radius * 3.2);
    for (let k = 0; k < count; k++) {
      const pi = path[k], L = P.len[pi], st = P.start[pi], n = P.cnt[pi];
      let d = (phase[k] * L + travel) % L;
      // binary search the segment containing distance d
      let lo = st, hi = st + n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.cum[mid] <= d) lo = mid; else hi = mid; }
      const segL = P.cum[hi] - P.cum[lo], f = segL > 1e-6 ? (d - P.cum[lo]) / segL : 0;
      const a = lo * 3, c = hi * 3;
      _p.set(P.pts[a] + (P.pts[c] - P.pts[a]) * f, P.pts[a + 1] + (P.pts[c + 1] - P.pts[a + 1]) * f,
        P.pts[a + 2] + (P.pts[c + 2] - P.pts[a + 2]) * f);
      _q.set(P.quat[lo * 4], P.quat[lo * 4 + 1], P.quat[lo * 4 + 2], P.quat[lo * 4 + 3]);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
    }
    mesh.count = count;
    if (count) mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- PV area, shimmer materials ----------
  // Cell area = sum of the up-facing (top) triangles of each cell box, in world space.
  function upFacingArea(obj) {
    let area = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
    obj.updateWorldMatrix(true, true);
    obj.traverse(m => {
      if (!m.isMesh || !m.geometry) return;
      const pos = m.geometry.attributes.position, idx = m.geometry.index;
      const tri = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < tri; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        A.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
        B.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
        C.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
        N.crossVectors(B.sub(A), C.sub(A));
        const l = N.length();
        if (l > 0 && N.y / l > 0.5) area += l / 2;
      }
    });
    return area;
  }
  const perCanopyArea = [0, 0, 0];
  const pvMats = [];
  for (let ci = 0; ci < 3; ci++) {
    const n = node(`Canopy ${ci + 1} / photovoltaic cells`);
    if (n) {
      const measured = upFacingArea(n);
      // sanity guard: fall back to the nominal value if the mesh is not what we expect
      perCanopyArea[ci] = measured > NOMINAL_CELL_AREA * 0.7 && measured < NOMINAL_CELL_AREA * 1.3 ? measured : NOMINAL_CELL_AREA;
      if (n.isMesh && n.material && 'emissive' in n.material) {
        n.material = n.material.clone();
        n.material.emissive = new THREE.Color(0.35, 0.5, 0.9);
        n.material.emissiveIntensity = 0;
        pvMats.push(n.material);
      } else pvMats.push(null);
    } else { perCanopyArea[ci] = NOMINAL_CELL_AREA; pvMats.push(null); }
  }
  const peakPerCanopy = perCanopyArea.map(a => a * KW_PER_M2 * SYS_EFF);
  const peakKW = peakPerCanopy[0] + peakPerCanopy[1] + peakPerCanopy[2];

  // ---------- state ----------
  let travelDC = 0, travelAC = 0, time = 0, sunNow = 0, kWhToday = 0, lastHour = null;
  const perCanopyKW = [0, 0, 0];
  const out = { kW: 0, kWhToday: 0, perCanopyKW, peakKW, cellAreaM2: perCanopyArea[0] + perCanopyArea[1] + perCanopyArea[2] };
  let visible = true;

  function setVisible(v) {
    visible = !!v; group.visible = visible;
    if (!visible) for (const m of pvMats) if (m) m.emissiveIntensity = 0;
  }

  function update(dt, state) {
    const sun = Math.max(0, Math.min(1, state.sun || 0));
    sunNow = sun;
    // energy integration over simulated time
    const h = state.hour;
    if (typeof h === 'number') {
      if (lastHour !== null) {
        let dh = h - lastHour;
        if (dh < -12) { kWhToday = 0; dh = h; }           // wrapped past midnight
        if (dh > 0 && dh < 1) kWhToday += peakKW * sun * dh; // ignore manual scrubs / backwards jumps
      }
      lastHour = h;
    }
    for (let i = 0; i < 3; i++) perCanopyKW[i] = peakPerCanopy[i] * sun;
    out.kW = peakKW * sun; out.kWhToday = kWhToday;

    const show = state.show ? state.show.power !== false : true;
    if (show !== visible) setVisible(show);
    if (!visible) return;

    time += dt;
    const speed = sun > 0.005 ? 0.6 + 3.4 * sun : 0;     // m/s along the cable
    travelDC += speed * dt; travelAC += speed * 1.3 * dt;
    if (travelDC > 1e5) travelDC -= 1e5;
    if (travelAC > 1e5) travelAC -= 1e5;
    const dens = sun > 0.005 ? Math.min(1, 0.15 + 0.85 * Math.pow(sun, 0.8)) : 0;
    placePulses(dcPulses, travelDC, Math.floor(dcPulses.N * dens));
    placePulses(acPulses, travelAC, Math.floor(acPulses.N * dens));
    dcPulses.mesh.material.opacity = acPulses.mesh.material.opacity = Math.min(1, 0.35 + sun);
    dcLines.material.opacity = 0.45 * sun; acLines.material.opacity = 0.55 * sun;

    for (let i = 0; i < 3; i++) {
      const m = pvMats[i]; if (!m) continue;
      m.emissiveIntensity = sun * (0.05 + 0.04 * Math.sin(time * 1.7 + i * 2.1));
    }
  }

  return { update, info: () => out, setVisible, group };
}
