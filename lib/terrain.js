// lib/terrain.js — elevation around any site in Poland + levelled farm pad (agent TERRAIN, 2026-11-18).
//
// Data (CORS checked 2026-11-18 from Origin http://localhost:8770):
// - PRIMARY: GUGiK NMT point service https://services.gugik.gov.pl/nmt/ (Access-Control-Allow-Origin: *).
//   request=GetHByPointList, POST application/x-www-form-urlencoded (a "simple" request, no preflight),
//   list = "N E,N E,..." in EPSG:2180 (geodetic order: x = northing, y = easting). Interpolated from the 1 m NMT,
//   answer "N E H,..." in m a.s.l. (PL-EVRF2007-NH), 0.1 m rounding. HARD LIMIT: only the first 1000 points of a
//   list get a height, so lists are chunked to 1000. ~1-1.5 s per request; 5 parallel requests cost the same.
//   Outside Poland the service answers 0.0 (treated as no-data when the area is clearly above sea level).
// - NOT usable in the browser: GUGiK WCS DigitalTerrainModelFormatTIFF (GetCoverage works, but no CORS header).
// - FALLBACK: Open-Meteo elevation API (Copernicus GLO-90, ~90 m, CORS *), 100 points per GET.
//
// Grids are sampled directly in SCENE axes (x, z; origin = site point, -z bearing = site.rotDeg), so heightAt is a
// plain bilinear lookup without reprojection. Three nested levels (GUGiK):
//   coarse 1.6 x 1.6 km @ 32 m (51 x 51), mid +-150 m @ 5 m (61 x 61), fine pad area @ 2 m (51 x 52)
//   = 6974 points = 9 requests (all in flight at once). Levels blend over their last 4 cells (no seams).
// Pad: the 36 x 42 m patch (x -18..18, z -36..6) is levelled to the height that balances cut and fill
// (side slopes 1:2 included). Modified surface = clamp(natural, pad - d/2, pad + d/2), d = distance to the pad
// rectangle -> exact 1:2 cut/fill slopes that end where they meet the natural ground.
//
// API: init(ctx) -> { update(), setSite(site) (async), heightAt(x,z), naturalHeightAt(x,z), grid, info(), ready,
//                     padRect, levels }
//   heightAt / naturalHeightAt: scene metres relative to the pad level (0 on the pad), no allocation.
//   grid: { w, h, sizeM, cellM, x0, z0, heights: Float32Array (modified surface, rel. to pad, row-major
//           index = j*w + i, x = x0 + i*cellM, z = z0 + j*cellM) } — 1.6 km @ 8 m, rebuilt on every site.
//   ready: Promise resolved when the current site's terrain is in (never rejects; failures -> info().errors).

const PAD = { x0: -18, x1: 18, z0: -36, z1: 6 };
const SLOPE_RUN = 2; // 1 vertical : 2 horizontal
const GUGIK = 'https://services.gugik.gov.pl/nmt/';
const OPENMETEO = 'https://api.open-meteo.com/v1/elevation';
const CHUNK = 1000, PARALLEL = 9, BLEND_CELLS = 4;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- EPSG:2180 (PUWG-1992) TM, Krueger n^3, GRS80
const A_ = 6378137.0, F_ = 1 / 298.257222101, E2 = F_ * (2 - F_);
const N_ = F_ / (2 - F_);
const AA = A_ / (1 + N_) * (1 + N_ * N_ / 4 + N_ ** 4 / 64);
const AL = [N_ / 2 - 2 * N_ * N_ / 3 + 5 * N_ ** 3 / 16, 13 * N_ * N_ / 48 - 3 * N_ ** 3 / 5, 61 * N_ ** 3 / 240];
const BE = [N_ / 2 - 2 * N_ * N_ / 3 + 37 * N_ ** 3 / 96, N_ * N_ / 48 + N_ ** 3 / 15, 17 * N_ ** 3 / 480];
const DE = [2 * N_ - 2 * N_ * N_ / 3 - 2 * N_ ** 3, 7 * N_ * N_ / 3 - 8 * N_ ** 3 / 5, 56 * N_ ** 3 / 15];
const L0 = 19, K0 = 0.9993, FE = 500000, FN = -5300000;
export function to2180(lat, lon) {
  const p = lat * D2R, L = (lon - L0) * D2R, s = 2 * Math.sqrt(N_) / (1 + N_);
  const t = Math.sinh(Math.atanh(Math.sin(p)) - s * Math.atanh(s * Math.sin(p)));
  const xi = Math.atan2(t, Math.cos(L)), eta = Math.atanh(Math.sin(L) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 0; j < 3; j++) {
    const k = 2 * (j + 1);
    E += AL[j] * Math.cos(k * xi) * Math.sinh(k * eta);
    N += AL[j] * Math.sin(k * xi) * Math.cosh(k * eta);
  }
  return [FE + K0 * AA * E, FN + K0 * AA * N]; // [easting, northing]
}
export function from2180(E, N) {
  const xi = (N - FN) / (K0 * AA), eta = (E - FE) / (K0 * AA);
  let xp = xi, ep = eta;
  for (let j = 0; j < 3; j++) {
    const k = 2 * (j + 1);
    xp -= BE[j] * Math.sin(k * xi) * Math.cosh(k * eta);
    ep -= BE[j] * Math.cos(k * xi) * Math.sinh(k * eta);
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let phi = chi;
  for (let j = 0; j < 3; j++) phi += DE[j] * Math.sin(2 * (j + 1) * chi);
  return [phi / D2R, L0 + Math.atan2(Math.sinh(ep), Math.cos(xp)) / D2R];
}

// scene (x, z) -> lat/lon around a site: true-north offsets (site.json "mapping"), then local ellipsoid radii.
// Error at 1 km < 1 cm, far below the DEM.
function makeSceneToLatLon(site) {
  const b = site.rotDeg * D2R, cb = Math.cos(b), sb = Math.sin(b);
  const sp = Math.sin(site.lat * D2R), w = Math.sqrt(1 - E2 * sp * sp);
  const Rn = A_ / w, Rm = A_ * (1 - E2) / (w * w * w), cl = Math.cos(site.lat * D2R);
  return (x, z, out) => {
    const dE = x * cb - z * sb, dN = -x * sb - z * cb;
    const lat = site.lat + dN / Rm / D2R, lon = site.lon + dE / (Rn * cl) / D2R;
    out[0] = lat; out[1] = lon; return out;
  };
}

// ---------------------------------------------------------------- grid level
function makeLevel(x0, z0, cell, nx, nz) {
  return { x0, z0, cell, nx, nz, x1: x0 + (nx - 1) * cell, z1: z0 + (nz - 1) * cell, h: new Float32Array(nx * nz).fill(NaN) };
}
function bilinear(L, x, z) {
  let fx = (x - L.x0) / L.cell, fz = (z - L.z0) / L.cell;
  if (fx < 0) fx = 0; else if (fx > L.nx - 1.000001) fx = L.nx - 1.000001;
  if (fz < 0) fz = 0; else if (fz > L.nz - 1.000001) fz = L.nz - 1.000001;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * L.nx + i, h = L.h;
  const a = h[k] + (h[k + 1] - h[k]) * tx, c = h[k + L.nx] + (h[k + L.nx + 1] - h[k + L.nx]) * tx;
  return a + (c - a) * tz;
}
// weight of a finer level at (x,z): 1 inside, 0 at/outside its border, smooth over BLEND_CELLS cells
function levelWeight(L, x, z) {
  const d = Math.min(x - L.x0, L.x1 - x, z - L.z0, L.z1 - z);
  if (d <= 0) return 0;
  const t = d / (L.cell * BLEND_CELLS);
  return t >= 1 ? 1 : t * t * (3 - 2 * t);
}
// fill NaN holes by repeated neighbour averaging (rare: no-data points)
function fillHoles(L, fallback) {
  const { nx, nz, h } = L;
  for (let pass = 0; pass < 200; pass++) {
    let holes = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (h[k] === h[k]) continue;
      let s = 0, n = 0;
      if (i > 0 && h[k - 1] === h[k - 1]) { s += h[k - 1]; n++; }
      if (i < nx - 1 && h[k + 1] === h[k + 1]) { s += h[k + 1]; n++; }
      if (j > 0 && h[k - nx] === h[k - nx]) { s += h[k - nx]; n++; }
      if (j < nz - 1 && h[k + nx] === h[k + nx]) { s += h[k + nx]; n++; }
      if (n) h[k] = s / n; else holes++;
    }
    if (!holes) return;
  }
  for (let k = 0; k < h.length; k++) if (h[k] !== h[k]) h[k] = fallback;
}

// ---------------------------------------------------------------- fetchers
async function poolRun(tasks, n) {
  const out = new Array(tasks.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) { const k = next++; out[k] = await tasks[k](); }
  }));
  return out;
}
async function fetchRetry(url, opts, tries = 2) {
  let err;
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) { if (e.name === 'AbortError') throw e; err = e; }
  }
  throw err;
}
// pts: Float64Array [N0,E0,N1,E1,...] (EPSG:2180). Returns Float32Array heights (NaN = no answer).
async function gugikHeights(pts, signal, stats) {
  const n = pts.length / 2, out = new Float32Array(n).fill(NaN), tasks = [];
  for (let s = 0; s < n; s += CHUNK) {
    const e = Math.min(n, s + CHUNK);
    tasks.push(async () => {
      let list = '';
      for (let k = s; k < e; k++) list += (k > s ? ',' : '') + pts[2 * k].toFixed(1) + ' ' + pts[2 * k + 1].toFixed(1);
      const body = 'request=GetHByPointList&list=' + encodeURIComponent(list);
      stats.requests++;
      const r = await fetchRetry(GUGIK, { method: 'POST', body, signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const txt = await r.text();
      const items = txt.split(',');
      if (items.length < e - s) throw new Error('GUGiK NMT: short answer (' + items.length + '/' + (e - s) + ')');
      for (let k = 0; k < e - s; k++) {
        const f = items[k].trim().split(/\s+/);
        if (f.length >= 3) { const v = parseFloat(f[2]); if (Number.isFinite(v)) out[s + k] = v; }
      }
    });
  }
  await poolRun(tasks, PARALLEL);
  return out;
}
// latlon: Float64Array [lat0,lon0,...]
async function openMeteoHeights(latlon, signal, stats) {
  const n = latlon.length / 2, out = new Float32Array(n).fill(NaN), tasks = [];
  for (let s = 0; s < n; s += 100) {
    const e = Math.min(n, s + 100);
    tasks.push(async () => {
      const la = [], lo = [];
      for (let k = s; k < e; k++) { la.push(latlon[2 * k].toFixed(6)); lo.push(latlon[2 * k + 1].toFixed(6)); }
      stats.requests++;
      const r = await fetchRetry(`${OPENMETEO}?latitude=${la.join(',')}&longitude=${lo.join(',')}`, { signal });
      const j = await r.json();
      if (!j.elevation) throw new Error('Open-Meteo: ' + (j.reason || 'no elevation'));
      for (let k = 0; k < e - s; k++) { const v = j.elevation[k]; if (Number.isFinite(v)) out[s + k] = v; }
    });
  }
  await poolRun(tasks, 3);
  return out;
}

// ---------------------------------------------------------------- terrain build for one site
const LEVELS_GUGIK = [
  { name: 'coarse', x0: -800, z0: -800, cell: 32, nx: 51, nz: 51 },
  { name: 'mid', x0: -150, z0: -165, cell: 5, nx: 61, nz: 61 },  // +-150 m around the pad centre (0,-15)
  { name: 'fine', x0: -50, z0: -66, cell: 2, nx: 51, nz: 52 },    // pad x -18..18 z -36..6 + 32/30 m
];
const LEVELS_OM = [
  { name: 'coarse', x0: -800, z0: -800, cell: 100, nx: 17, nz: 17 },
  { name: 'mid', x0: -150, z0: -165, cell: 30, nx: 11, nz: 11 },
];

async function buildSite(site, signal) {
  const t0 = performance.now();
  const stats = { requests: 0 }, errors = [];
  const toLL = makeSceneToLatLon(site), ll = [0, 0];
  const sample = async (defs, source) => {
    const levels = defs.map((d) => Object.assign(makeLevel(d.x0, d.z0, d.cell, d.nx, d.nz), { name: d.name }));
    const total = levels.reduce((s, L) => s + L.nx * L.nz, 0);
    const buf = new Float64Array(total * 2);
    let p = 0;
    for (const L of levels) for (let j = 0; j < L.nz; j++) for (let i = 0; i < L.nx; i++) {
      toLL(L.x0 + i * L.cell, L.z0 + j * L.cell, ll);
      if (source === 'gugik') { const [E, N] = to2180(ll[0], ll[1]); buf[p++] = N; buf[p++] = E; }
      else { buf[p++] = ll[0]; buf[p++] = ll[1]; }
    }
    const h = source === 'gugik' ? await gugikHeights(buf, signal, stats) : await openMeteoHeights(buf, signal, stats);
    // GUGiK answers exactly 0.0 outside Poland: drop zeros when the area is clearly above sea level
    if (source === 'gugik') {
      const sorted = Float32Array.from(h.filter((v) => v === v)).sort();
      const med = sorted.length ? sorted[sorted.length >> 1] : NaN;
      if (!(med === med)) throw new Error('GUGiK NMT: no heights');
      let zeros = 0;
      if (med > 5) for (let k = 0; k < h.length; k++) if (h[k] === 0) { h[k] = NaN; zeros++; }
      if (zeros) errors.push(`GUGiK NMT: ${zeros} points without data (outside Poland?) filled from neighbours`);
      if (zeros > h.length * 0.5) throw new Error('GUGiK NMT: mostly outside coverage');
    }
    p = 0;
    for (const L of levels) { L.h.set(h.subarray(p, p + L.h.length)); p += L.h.length; }
    const allMed = (() => { const s = Float32Array.from(h.filter((v) => v === v)).sort(); return s.length ? s[s.length >> 1] : 0; })();
    for (const L of levels) fillHoles(L, allMed);
    return levels;
  };
  let levels, source, resolutionM;
  try {
    levels = await sample(LEVELS_GUGIK, 'gugik');
    source = 'GUGiK NMT (1 m LIDAR DTM, services.gugik.gov.pl/nmt GetHByPointList)';
    resolutionM = 2;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    errors.push('GUGiK NMT failed: ' + e.message + ' -> Open-Meteo fallback');
    try {
      levels = await sample(LEVELS_OM, 'om');
      source = 'Open-Meteo elevation API (Copernicus DEM GLO-90, CC BY 4.0)';
      resolutionM = 90;
    } catch (e2) {
      if (e2.name === 'AbortError') throw e2;
      errors.push('Open-Meteo failed: ' + e2.message + ' -> flat ground');
      const L = Object.assign(makeLevel(-800, -800, 1600, 2, 2), { name: 'flat' }); L.h.fill(0);
      levels = [L]; source = 'none (flat, offline)'; resolutionM = null;
    }
  }
  return { site, levels, source, resolutionM, errors, requests: stats.requests, fetchMs: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- module
export function init(ctx = {}) {
  const cache = new Map(); // key -> built terrain (last 3)
  let cur = null;          // { levels, pad (a.s.l.), ...info }
  let abort = null, seq = 0;
  let readyResolve, ready = new Promise((r) => (readyResolve = r));
  const grid = { w: 201, h: 201, sizeM: 1600, cellM: 8, x0: -800, z0: -800, heights: new Float32Array(201 * 201) };

  // natural height a.s.l. (blended levels)
  function naturalAbs(x, z) {
    const lv = cur.levels;
    let h = bilinear(lv[0], x, z);
    for (let k = 1; k < lv.length; k++) {
      const w = levelWeight(lv[k], x, z);
      if (w > 0) h += (bilinear(lv[k], x, z) - h) * w;
    }
    return h;
  }
  function padDist(x, z) {
    const dx = x < PAD.x0 ? PAD.x0 - x : x > PAD.x1 ? x - PAD.x1 : 0;
    const dz = z < PAD.z0 ? PAD.z0 - z : z > PAD.z1 ? z - PAD.z1 : 0;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function modify(hn, d, P) {
    const r = d / SLOPE_RUN;
    return hn > P + r ? P + r : hn < P - r ? P - r : hn;
  }
  function naturalHeightAt(x, z) { return cur ? naturalAbs(x, z) - cur.padLevelM : 0; }
  function heightAt(x, z) {
    if (!cur) return 0;
    const P = cur.padLevelM;
    return modify(naturalAbs(x, z), padDist(x, z), P) - P;
  }

  function analyse(t) {
    cur = { levels: t.levels, padLevelM: 0 };
    // sample the natural surface at 1 m over the pad + slope margin (inside the finest level)
    const fine = t.levels[t.levels.length - 1];
    const step = Math.min(1, fine.cell);
    const mx0 = Math.max(fine.x0, PAD.x0 - 30), mx1 = Math.min(fine.x1, PAD.x1 + 30);
    const mz0 = Math.max(fine.z0, PAD.z0 - 30), mz1 = Math.min(fine.z1, PAD.z1 + 30);
    const nx = Math.floor((mx1 - mx0) / step) + 1, nz = Math.floor((mz1 - mz0) / step) + 1;
    const hn = new Float32Array(nx * nz), dd = new Float32Array(nx * nz);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = mx0 + i * step, z = mz0 + j * step, k = j * nx + i;
      hn[k] = naturalAbs(x, z); dd[k] = padDist(x, z);
      if (dd[k] === 0) { if (hn[k] < lo) lo = hn[k]; if (hn[k] > hi) hi = hn[k]; }
    }
    const A = step * step;
    const vol = (P) => {
      let cut = 0, fill = 0;
      for (let k = 0; k < hn.length; k++) {
        const m = modify(hn[k], dd[k], P), diff = hn[k] - m;
        if (diff > 0) cut += diff; else fill -= diff;
      }
      return [cut * A, fill * A];
    };
    // balance cut = fill (monotonic in P): bisection
    let a = lo, b = hi;
    for (let it = 0; it < 40 && b - a > 1e-4; it++) {
      const m = (a + b) / 2, [c, f] = vol(m);
      if (c > f) a = m; else b = m;
    }
    const P = (a + b) / 2, [cutM3, fillM3] = vol(P);
    cur.padLevelM = P;

    // slope / aspect over the pad (natural, central differences, 2 m)
    let gx = 0, gz = 0, gm = 0, n = 0;
    for (let z = PAD.z0; z <= PAD.z1; z += 2) for (let x = PAD.x0; x <= PAD.x1; x += 2) {
      const sx = (naturalAbs(x + 1, z) - naturalAbs(x - 1, z)) / 2, sz = (naturalAbs(x, z + 1) - naturalAbs(x, z - 1)) / 2;
      gx += sx; gz += sz; gm += Math.hypot(sx, sz); n++;
    }
    gx /= n; gz /= n; gm /= n;
    // downslope direction (-grad) as a true bearing: scene -z = rotDeg, +x = rotDeg + 90
    const aspectDeg = ((t.site.rotDeg + Math.atan2(-gx, gz) / D2R) % 360 + 360) % 360;
    // relief within 200 m of the site point (all levels, natural)
    let rmin = Infinity, rmax = -Infinity;
    for (let z = -200; z <= 200; z += 4) for (let x = -200; x <= 200; x += 4) {
      if (x * x + z * z > 40000) continue;
      const h = naturalAbs(x, z); if (h < rmin) rmin = h; if (h > rmax) rmax = h;
    }
    // padded patch extent incl. slopes: max distance where modified != natural
    let slopeReach = 0;
    for (let k = 0; k < hn.length; k++) if (dd[k] > 0 && Math.abs(modify(hn[k], dd[k], P) - hn[k]) > 0.01 && dd[k] > slopeReach) slopeReach = dd[k];

    Object.assign(cur, {
      site: t.site,
      elevationM: +naturalAbs(0, 0).toFixed(2),
      slopePct: +(gm * 100).toFixed(2),
      aspectDeg: gm < 0.002 ? null : Math.round(aspectDeg),
      reliefM: +(rmax - rmin).toFixed(2),
      padLevelM: +P.toFixed(2),
      padNaturalMinM: +lo.toFixed(2), padNaturalMaxM: +hi.toFixed(2),
      cutM3: Math.round(cutM3), fillM3: Math.round(fillM3),
      slopeReachM: +slopeReach.toFixed(1),
      source: t.source, resolutionM: t.resolutionM,
      requests: t.requests, fetchMs: t.fetchMs,
      errors: t.errors.slice(),
    });
    if (slopeReach > 27) cur.errors.push(`pad side slopes reach ${slopeReach.toFixed(0)} m: beyond the 30 m cut/fill window, volumes underestimated`);
    cur.padLevelM = P; // keep exact value for heightAt (info rounds)
    cur.padLevelRounded = +P.toFixed(2);

    // composite grid (modified surface relative to the pad)
    const H = grid.heights;
    for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) H[j * grid.w + i] = heightAt(grid.x0 + i * grid.cellM, grid.z0 + j * grid.cellM);
    grid.version = (grid.version || 0) + 1;
  }

  async function setSite(site) {
    if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return ready;
    site = { lat: +site.lat, lon: +site.lon, rotDeg: Number.isFinite(+site.rotDeg) ? +site.rotDeg : 0, name: site.name };
    const key = site.lat.toFixed(6) + ',' + site.lon.toFixed(6) + ',' + site.rotDeg.toFixed(2);
    const my = ++seq;
    if (abort) abort.abort();
    abort = null;
    // a new ready promise for this site (the previous one resolves too, with whatever is current)
    const prevResolve = readyResolve;
    ready = new Promise((r) => (readyResolve = r));
    api.ready = ready;
    let t = cache.get(key);
    if (!t) {
      const ac = new AbortController(); abort = ac;
      try { t = await buildSite(site, ac.signal); }
      catch (e) { if (e.name === 'AbortError' || my !== seq) { prevResolve(info()); return ready; } throw e; }
      if (my !== seq) { prevResolve(info()); return ready; }
      abort = null;
      cache.set(key, t);
      while (cache.size > 3) cache.delete(cache.keys().next().value);
    } else {
      cache.delete(key); cache.set(key, t); // LRU touch
      t = Object.assign({}, t, { requests: 0, fetchMs: 0, cached: true });
    }
    if (my !== seq) return ready;
    analyse(t);
    if (t.cached) cur.cached = true;
    prevResolve(info());
    readyResolve(info());
    return ready;
  }

  function info() {
    if (!cur || !cur.site) return { loading: true, errors: [] };
    const { levels, padLevelRounded, ...rest } = cur;
    return { ...rest, padLevelM: padLevelRounded, levels: levels.map((L) => `${L.name} ${L.nx}x${L.nz} @ ${L.cell} m`) };
  }

  const api = {
    update() {},
    setSite, heightAt, naturalHeightAt, info, grid, ready,
    padRect: { ...PAD }, slopeRun: SLOPE_RUN,
    get levels() { return cur ? cur.levels : []; },
  };

  // initial site: ctx.site, ctx.state.site, else data/geo/site.json (Witkowo)
  const first = ctx.site || ctx.state?.site;
  if (first) setSite(first);
  else if (ctx.autoSite !== false) {
    fetch(new URL('../data/geo/site.json', import.meta.url)).then((r) => r.json())
      .then((s) => { if (!cur && seq === 0) setSite({ lat: s.lat, lon: s.lon, rotDeg: s.rotDeg, name: 'Witkowo' }); })
      .catch((e) => console.warn('terrain: site.json', e));
  }
  return api;
}
