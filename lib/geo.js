// lib/geo.js — real-map ground under the 3D farm, any point in Poland (agent MAP, 2026-11-18).
//
// - Site: { lat, lon, rotDeg, name } = geodetic position of scene (0,0,0) and the true bearing of scene -z.
//   Default = Witkowo (data/geo/site.json, measured from the on-site photo GPS + compass heading at the inverters).
//   setSite(site) rebuilds everything for any point: projections (local grid = the nearest PL-2000 zone,
//   EPSG:2176..2179, near-north-up), live GUGiK orthophoto, archival years (probed lazily), live overlays.
// - Ground: terrain-draped LOD rings (2 m cells to 120 m from the patch centre, 8 m to 480 m, 32 m to 1.9 km,
//   400 m to 8 km), heights from terrain.heightAt(x,z) (scene metres relative to the levelled pad). Vertices are
//   rewritten in place on a site / terrain change (no new geometry). Cut / fill (heightAt - naturalHeightAt) is
//   painted in earth colours; the pad edge is drawn as a line. The colour comes from a shader that samples three
//   orthophoto tiers (far / mid / near) + one overlay, each placed via the exact TM projections (2180 maps,
//   rotated vs the local grid, land correctly).
// - Default site only: pre-downloaded images (offline: 2012..2025 ortho + Sentinel-2 2024-2026 that show the real
//   installation), the Sentinel-2 plot outline, GZWP 123 / JCWPd 7 boundary lines. Other sites: live only; if a
//   service fails the ground falls back to a neutral colour and info().errors says why.
// - Overlay layers (CORS checked 2026-11-18): Geoportal ORTO, PIG-PIB geology SMGP 1:50k (ArcGIS export),
//   MhP 1:50k GUPW (ePSH WMS), GZWP (PIG-PIB ArcGIS). No soil map with CORS / coverage exists.
// - The model's own Soil / Grass / Dark earth materials get a 4.5 m edge fade into the photo (chained
//   onBeforeCompile after water.js / winter.js).
//
// API: init(ctx) -> { update(dt, state), info(), setSite(site, {terrain}?), setTerrain(t), refreshTerrain(),
//   setVisible(b), setYear(id), setLayer(id), setOpacity(v), setSoilBlend(b), setOutline(b), setBoundaries(b),
//   years (array, replaced in place on setSite), layers, boundaries, ready, GEO, group }
// ctx.terrain (optional) = { heightAt(x,z), naturalHeightAt?(x,z), ready?: Promise, pad?: {x0,z0,x1,z1}, info?() }
// Helpers (exported): GEO, sceneToLatLon, latLonToScene, sceneToCRS, crsToScene, tmForward, tmInverse, zoneFor.

const DATA = new URL('../data/geo/', import.meta.url);

// ---------------------------------------------------------------- Transverse Mercator (Krueger n^3), GRS80
const A_ = 6378137.0, F_ = 1 / 298.257222101;
const N_ = F_ / (2 - F_);
const AA = A_ / (1 + N_) * (1 + N_ * N_ / 4 + N_ ** 4 / 64);
const AL = [N_ / 2 - 2 * N_ * N_ / 3 + 5 * N_ ** 3 / 16, 13 * N_ * N_ / 48 - 3 * N_ ** 3 / 5, 61 * N_ ** 3 / 240];
const BE = [N_ / 2 - 2 * N_ * N_ / 3 + 37 * N_ ** 3 / 96, N_ * N_ / 48 + N_ ** 3 / 15, 17 * N_ ** 3 / 480];
const DE = [2 * N_ - 2 * N_ * N_ / 3 - 2 * N_ ** 3, 7 * N_ * N_ / 3 - 8 * N_ ** 3 / 5, 56 * N_ ** 3 / 15];
// [lon0, k0, falseE, falseN]; UTM 33N uses WGS84 (difference to GRS80 << 1 mm here)
const CRS = {
  'EPSG:2176': [15, 0.999923, 5500000, 0],   // PL-2000 zones: the local grid of the site (nearest meridian)
  'EPSG:2177': [18, 0.999923, 6500000, 0],
  'EPSG:2178': [21, 0.999923, 7500000, 0],
  'EPSG:2179': [24, 0.999923, 8500000, 0],
  'EPSG:2180': [19, 0.9993, 500000, -5300000],
  'EPSG:32633': [15, 0.9996, 500000, 0],
};
const D2R = Math.PI / 180;
export function tmForward(lat, lon, crs) {
  const [l0, k0, FE, FN] = CRS[crs];
  const p = lat * D2R, L = (lon - l0) * D2R, s = 2 * Math.sqrt(N_) / (1 + N_);
  const t = Math.sinh(Math.atanh(Math.sin(p)) - s * Math.atanh(s * Math.sin(p)));
  const xi = Math.atan2(t, Math.cos(L)), eta = Math.atanh(Math.sin(L) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 0; j < 3; j++) {
    const k = 2 * (j + 1);
    E += AL[j] * Math.cos(k * xi) * Math.sinh(k * eta);
    N += AL[j] * Math.sin(k * xi) * Math.cosh(k * eta);
  }
  return [FE + k0 * AA * E, FN + k0 * AA * N];
}
export function tmInverse(E, N, crs) {
  const [l0, k0, FE, FN] = CRS[crs];
  const xi = (N - FN) / (k0 * AA), eta = (E - FE) / (k0 * AA);
  let xp = xi, ep = eta;
  for (let j = 0; j < 3; j++) {
    const k = 2 * (j + 1);
    xp -= BE[j] * Math.sin(k * xi) * Math.cosh(k * eta);
    ep -= BE[j] * Math.cos(k * xi) * Math.sinh(k * eta);
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let phi = chi;
  for (let j = 0; j < 3; j++) phi += DE[j] * Math.sin(2 * (j + 1) * chi);
  return [phi / D2R, l0 + Math.atan2(Math.sinh(ep), Math.cos(xp)) / D2R];
}

// ---------------------------------------------------------------- scene <-> geodetic (current site)
export function zoneFor(lon) {
  return lon < 16.5 ? 'EPSG:2176' : lon < 19.5 ? 'EPSG:2177' : lon < 22.5 ? 'EPSG:2178' : 'EPSG:2179';
}
// live object, updated by setSite (keep the reference)
export const GEO = { lat: 53.2886348, lon: 15.068703, rotDeg: 313, name: 'Witkowo', crs: 'EPSG:2176',
  E: 0, N: 0, x2180: 0, y2180: 0, convDeg: 0, isDefault: true };
let cosB = 1, sinB = 0; // grid bearing of scene -z in the local zone (true bearing - meridian convergence)
function setGeoSite(s) {
  GEO.lat = +s.lat; GEO.lon = +s.lon; GEO.rotDeg = +(s.rotDeg ?? 0); GEO.name = s.name || '';
  GEO.crs = zoneFor(GEO.lon);
  [GEO.E, GEO.N] = tmForward(GEO.lat, GEO.lon, GEO.crs);
  [GEO.x2180, GEO.y2180] = tmForward(GEO.lat, GEO.lon, 'EPSG:2180');
  GEO.convDeg = (GEO.lon - CRS[GEO.crs][0]) * Math.sin(GEO.lat * D2R);
  const gb = (GEO.rotDeg - GEO.convDeg) * D2R; cosB = Math.cos(gb); sinB = Math.sin(gb);
}
// scene (x, z) -> local zone metres and back
function sceneToLocal(x, z) { return [GEO.E + x * cosB - z * sinB, GEO.N - x * sinB - z * cosB]; }
function fromLocal(E, N) {
  const dE = E - GEO.E, dN = N - GEO.N;
  return [dE * cosB - dN * sinB, -dE * sinB - dN * cosB];
}
export function sceneToLatLon(x, z) { const [E, N] = sceneToLocal(x, z); return tmInverse(E, N, GEO.crs); }
export function latLonToScene(lat, lon) { const [E, N] = tmForward(lat, lon, GEO.crs); return fromLocal(E, N); }
export function sceneToCRS(x, z, crs) {
  if (crs === GEO.crs) return sceneToLocal(x, z);
  const [la, lo] = sceneToLatLon(x, z); return tmForward(la, lo, crs);
}
export function crsToScene(E, N, crs) {
  if (crs === GEO.crs) return fromLocal(E, N);
  const [la, lo] = tmInverse(E, N, crs); return latLonToScene(la, lo);
}
setGeoSite(GEO);

// affine scene(x,z) -> image uv for a north-up image with bbox [minE,minN,maxE,maxN] in crs (flipY texture: v=0 at
// the bottom = minN). Exact at three points 1 km apart; TM is conformal, error over 3 km < 1 cm.
function uvAffine(bbox, crs, outU, outV) {
  const [x0, y0, x1, y1] = bbox;
  const P = [[0, 0], [1000, 0], [0, 1000]].map(([x, z]) => {
    const [E, N] = sceneToCRS(x, z, crs); return [(E - x0) / (x1 - x0), (N - y0) / (y1 - y0)];
  });
  // u = a x + b z + c
  outU.set((P[1][0] - P[0][0]) / 1000, (P[2][0] - P[0][0]) / 1000, P[0][0]);
  outV.set((P[1][1] - P[0][1]) / 1000, (P[2][1] - P[0][1]) / 1000, P[0][1]);
}

// ---------------------------------------------------------------- GLSL shared by the ground and the soil fade
const GEO_GLSL = /* glsl */`
  varying vec2 vGeoXZ;
  uniform sampler2D tGeoFar, tGeoMid, tGeoNear, tGeoOver;
  uniform vec3 uGeoFarU, uGeoFarV, uGeoMidU, uGeoMidV, uGeoNearU, uGeoNearV, uGeoOverU, uGeoOverV;
  uniform vec4 uGeoHas;          // far, mid, near, overlay available (0/1)
  uniform float uGeoOverOpacity, uGeoGain, uGeoSnow, uGeoSoilBlend, uGeoOn;
  uniform vec3 uGeoFallback;
  uniform vec4 uGeoSoilBox;      // x0, z0, x1, z1 of the modelled soil patch
  float geoIn(vec2 uv, float f) {
    vec2 a = smoothstep(vec2(0.0), vec2(f), uv) * smoothstep(vec2(0.0), vec2(f), 1.0 - uv);
    return a.x * a.y;
  }
  float geoData(vec3 t) { return 1.0 - smoothstep(0.8, 0.93, min(t.r, min(t.g, t.b))); }
  vec2 geoUV(vec3 U, vec3 V, vec2 p) { return vec2(dot(U, vec3(p, 1.0)), dot(V, vec3(p, 1.0))); }
  float geoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float geoNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(geoHash(i), geoHash(i + vec2(1, 0)), f.x), mix(geoHash(i + vec2(0, 1)), geoHash(i + vec2(1, 1)), f.x), f.y);
  }
  vec3 geoColor(vec2 p) {
    vec3 c = uGeoFallback, t; vec2 uv;
    // pure white = no data in that flight (2012 mosaic gap): fall through to the coarser tier
    uv = geoUV(uGeoFarU, uGeoFarV, p);   t = texture2D(tGeoFar, uv).rgb;  c = mix(c, t, geoIn(uv, 0.05) * uGeoHas.x * geoData(t));
    uv = geoUV(uGeoMidU, uGeoMidV, p);   t = texture2D(tGeoMid, uv).rgb;  c = mix(c, t, geoIn(uv, 0.08) * uGeoHas.y * geoData(t));
    uv = geoUV(uGeoNearU, uGeoNearV, p); t = texture2D(tGeoNear, uv).rgb; c = mix(c, t, geoIn(uv, 0.1) * uGeoHas.z * geoData(t));
    c *= uGeoGain;
    uv = geoUV(uGeoOverU, uGeoOverV, p);
    vec4 o = texture2D(tGeoOver, uv);
    c = mix(c, o.rgb, o.a * uGeoOverOpacity * geoIn(uv, 0.01) * uGeoHas.w);
    // winter: snow on the open field (same palette as winter.js), patchy, fades with the overlay on
    float n = geoNoise(p * 0.8) * 0.6 + geoNoise(p * 0.05) * 0.4;
    float s = clamp(uGeoSnow * 1.5 - n * 0.55, 0.0, 1.0) * (1.0 - uGeoHas.w * uGeoOverOpacity * 0.8);
    c = mix(c, vec3(0.86, 0.89, 0.93) * (0.93 + 0.07 * geoNoise(p * 9.0)), s);
    return c;
  }
`;
const VARY_VS = 'varying vec2 vGeoXZ;\n';
const PROJ_VS = '#include <project_vertex>\n vGeoXZ = (modelMatrix * vec4(transformed, 1.0)).xz;';

// ---------------------------------------------------------------- catalog
const ATTR_ORTHO = 'Ortofotomapa: GUGiK, geoportal.gov.pl';
const ATTR_S2 = 'Contains modified Copernicus Sentinel data 2024–2026';
const WMS_NOW = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution';
const WMS_TIME = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolutionTime';
function orthoUrl(bbox, px, crs, yearOrNull) {
  const q = { SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: 'Raster', STYLES: '', SRS: crs,
    BBOX: bbox.map((v) => v.toFixed(2)).join(','), WIDTH: px, HEIGHT: px, FORMAT: 'image/jpeg' };
  if (yearOrNull) q.TIME = `${yearOrNull}-01-01T00:00:00.000Z/${yearOrNull}-12-31T00:00:00.000Z`;
  return (yearOrNull ? WMS_TIME : WMS_NOW) + '?' + new URLSearchParams(q);
}

// default (Witkowo) offline years
const DEFAULT_YEARS = [
  { id: 2012, kind: 'ortho', date: '2012-04-28' },
  { id: 2014, kind: 'ortho', date: '2014-07-18' },
  { id: 2017, kind: 'ortho', date: '2017' },
  { id: 2020, kind: 'ortho', date: '2020-09-12' },
  { id: 2023, kind: 'ortho', date: '2023-05-08' },
  { id: 2025, kind: 'ortho', date: '2025-04-13' },
  { id: 's2-2024-05-17', kind: 's2', date: '2024-05-17' },
  { id: 's2-2025-07-01', kind: 's2', date: '2025-07-01' },
  { id: 's2-2025-11-08', kind: 's2', date: '2025-11-08' },
  { id: 's2-2026-05-02', kind: 's2', date: '2026-05-02' },
  { id: 's2-2026-06-26', kind: 's2', date: '2026-06-26' },
  { id: 's2-2026-08-27', kind: 's2', date: '2026-08-27' },
];
for (const y of DEFAULT_YEARS) {
  if (y.kind === 'ortho') {
    y.label_pl = `Ortofotomapa ${y.date}`; y.label_en = `Orthophoto ${y.date}`;
  } else {
    const built = y.date >= '2025-11';
    y.label_pl = `Sentinel-2 ${y.date} (10 m)${built ? ' – instalacja widoczna' : ' – przed budową'}`;
    y.label_en = `Sentinel-2 ${y.date} (10 m)${built ? ' – installation visible' : ' – before construction'}`;
  }
}
const LIVE_CURRENT = { id: 'current', kind: 'live', date: 'aktualna',
  label_pl: 'Ortofotomapa aktualna (Geoportal)', label_en: 'Current orthophoto (Geoportal)' };
// archival years tried by the probe (the time service returns the newest flight up to the end of the range, so a
// repeated image = no new flight that year; the label is the first year that returns it, i.e. the flight year
// or at most one year later)
const PROBE_YEARS = [2004, 2006, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025];

const OVER_EXT = 4000; // overlay square (m) around the patch centre
const LAYERS = [
  { id: 'none', label_pl: 'Brak nakładki', label_en: 'No overlay', attribution: '', opacity: 0 },
  { id: 'orto', label_pl: 'Ortofotomapa aktualna (Geoportal, na żywo)', label_en: 'Current orthophoto (Geoportal, live)',
    attribution: ATTR_ORTHO, opacity: 1, crs: 'local', ext: 3200, px: 2048, cors: '*',
    url: (b, px, crs) => orthoUrl(b, px, crs, null) },
  { id: 'geology', label_pl: 'Mapa geologiczna SMGP 1:50 000 (PIG-PIB)', label_en: 'Geological map SMGP 1:50,000 (PIG-PIB)',
    attribution: 'Szczegółowa Mapa Geologiczna Polski 1:50 000: PIG-PIB, cbdgmapa.pgi.gov.pl',
    opacity: 0.75, crs: 'EPSG:2180', ext: OVER_EXT, px: 2048, cors: 'origin echoed',
    legend: 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/legend?f=pjson',
    atDefault: { pl: 'Piaski pyłowato-żwirowate na glinach zwałowych (osady lodowcowe, stadiał górny); ark. 268',
      en: 'Silty-gravelly sands on glacial till (glacial deposits, upper stadial); sheet 268' },
    // ArcGIS REST export: the WMS endpoint of the same service draws only the boundaries, not the fills
    url: (b, px) => 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/export?' + new URLSearchParams({
      bbox: b.map((v) => v.toFixed(1)).join(','), bboxSR: '2180', imageSR: '2180', size: `${px},${px}`,
      layers: 'show:2,3,4,5', format: 'png32', transparent: 'true', f: 'image' }) },
  { id: 'hydro', label_pl: 'Mapa hydrogeologiczna MhP 1:50 000 – GUPW (PIG-PIB)',
    label_en: 'Hydrogeological map MhP 1:50,000 – main aquifer (PIG-PIB)',
    attribution: 'Mapa hydrogeologiczna Polski 1:50 000 (GUPW): PIG-PIB / PSH, epsh.pgi.gov.pl',
    opacity: 0.6, crs: 'EPSG:2180', ext: OVER_EXT, px: 400, cors: '*',
    // the service draws nothing below 1:35 000, i.e. it needs >= ~10 m/px: 4 km at 400 px
    url: (b, px) => 'https://epsh.pgi.gov.pl/mhpgupw-kompozycja-wydajnosc-wms/service.svc/get?' + new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', STYLES: '', CRS: 'EPSG:2180',
      LAYERS: 'Brak_GUPW,Wydajność_potencjalna__10,Wydajność_potencjalna_10-30,Wydajność_potencjalna_30-50,'
        + 'Wydajność_potencjalna_50-70,Wydajność_potencjalna__70,Zbiorniki_wodne,Rzeki,Hydroizohipsy,'
        + 'Jednostka_hydrogeologiczna,Symbol_jednostki',
      // WMS 1.3.0 + EPSG:2180: axis order is northing, easting
      BBOX: [b[1], b[0], b[3], b[2]].map((v) => v.toFixed(1)).join(','),
      WIDTH: px, HEIGHT: px, FORMAT: 'image/png', TRANSPARENT: 'TRUE' }) },
  { id: 'gzwp', label_pl: 'Główne Zbiorniki Wód Podziemnych – GZWP (PIG-PIB)',
    label_en: 'Major groundwater reservoirs – GZWP (PIG-PIB)',
    attribution: 'GZWP: PIG-PIB (PSH), cbdgmapa.pgi.gov.pl',
    opacity: 0.55, crs: 'EPSG:2180', ext: 8000, px: 1024, cors: 'origin echoed',
    atDefault: { pl: 'Poza GZWP 123 Stargard-Goleniów (granica ok. 1 km na N)', en: 'Outside GZWP 123 Stargard-Goleniów (boundary ~1 km N)' },
    url: (b, px) => 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/hydrogeologia/gzwp/MapServer/export?' + new URLSearchParams({
      bbox: b.map((v) => v.toFixed(1)).join(','), bboxSR: '2180', imageSR: '2180', size: `${px},${px}`,
      format: 'png32', transparent: 'true', f: 'image' }) },
];
// vector boundaries for the default site (data/geo/*.geojson, copied from reference/geo/water/groundwater);
// other sites: the gzwp overlay layer shows the same information live
const BOUNDARIES = [
  { id: 'gzwp123', file: 'gzwp123.geojson', color: 0x5ec8e6, label_pl: 'GZWP 123 Stargard-Goleniów', label_en: 'GZWP 123 Stargard-Goleniów' },
  { id: 'jcwpd7', file: 'jcwpd7.geojson', color: 0xb48cf0, label_pl: 'JCWPd 7 (PLGW60007)', label_en: 'Groundwater body JCWPd 7 (PLGW60007)' },
];
// soil map: integracja.gugik.gov.pl/cgi-bin/MapaGlebowoRolnicza only has mazowieckie / podlaskie /
// swietokrzyskie / opolskie (no CORS either); IUNG maps.iung.pulawy.pl did not answer -> not offered.

const SOIL_BOX = [-18, -36, 18, 6];
const CENTRE_Z = -15;                 // patch centre (scene) = centre of tiers, rings and overlays
const FAR_TINT = [0.36, 0.40, 0.30];  // linear fallback colour beyond the far tier / when nothing loaded
// LOD rings: [half extent m, cell m]. Each ring skips the cells covered by the finer ring (one cell overlap).
const RINGS = [[120, 2], [480, 8], [1920, 32], [8000, 400]];
const LIVE_TIERS = { near: [400, 1600], mid: [1000, 2000], far: [4000, 2048] };   // current flight [m, px]
const TIME_TIERS = { mid: [1000, 1000], far: [4000, 1000] };                     // archival (slow service)

export function init(ctx) {
  const { THREE, scene, renderer } = ctx;
  const group = new THREE.Group(); group.name = 'Geo ground';
  scene.add(group);

  const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 0]), 1, 1); blank.needsUpdate = true;
  const U = {
    tGeoFar: { value: blank }, tGeoMid: { value: blank }, tGeoNear: { value: blank }, tGeoOver: { value: blank },
    uGeoFarU: { value: new THREE.Vector3() }, uGeoFarV: { value: new THREE.Vector3() },
    uGeoMidU: { value: new THREE.Vector3() }, uGeoMidV: { value: new THREE.Vector3() },
    uGeoNearU: { value: new THREE.Vector3() }, uGeoNearV: { value: new THREE.Vector3() },
    uGeoOverU: { value: new THREE.Vector3() }, uGeoOverV: { value: new THREE.Vector3() },
    uGeoHas: { value: new THREE.Vector4(0, 0, 0, 0) },
    uGeoOverOpacity: { value: 0 }, uGeoGain: { value: 0.95 }, uGeoSnow: { value: 0 },
    uGeoSoilBlend: { value: 1 }, uGeoOn: { value: 1 }, uGeoCutShow: { value: 1 },
    uGeoFallback: { value: new THREE.Color().setRGB(...FAR_TINT) },
    uGeoSoilBox: { value: new THREE.Vector4(...SOIL_BOX) },
  };

  // ---------------- terrain-draped ground: LOD rings, vertices rewritten in place per site
  const rings = [];
  const makeMat = (i) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: 1 + i, polygonOffsetUnits: 2 + 3 * i });
    m.name = 'Geo ground';
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'attribute float aCut;\nvarying float vGeoCut;\n' + VARY_VS
        + sh.vertexShader.replace('#include <project_vertex>', PROJ_VS + '\n vGeoCut = aCut;');
      sh.fragmentShader = GEO_GLSL + 'varying float vGeoCut;\nuniform float uGeoCutShow;\n'
        + sh.fragmentShader.replace('#include <map_fragment>', `
          vec3 gc = geoColor(vGeoXZ);
          // cut (vGeoCut < 0): pale subsoil; fill (> 0): dark loose earth
          vec3 earth = vGeoCut < 0.0 ? vec3(0.42, 0.31, 0.19) : vec3(0.24, 0.17, 0.11);
          gc = mix(gc, earth * (0.9 + 0.1 * geoNoise(vGeoXZ * 3.0)), min(1.0, abs(vGeoCut)) * 0.9 * uGeoCutShow);
          diffuseColor.rgb *= gc;`);
    };
    m.customProgramCacheKey = () => 'geo-ground';
    return m;
  };
  RINGS.forEach(([half, step], i) => {
    const n = Math.round(2 * half / step), nv = (n + 1) * (n + 1);
    const pos = new Float32Array(nv * 3), cut = new Float32Array(nv);
    const x0 = -half, z0 = CENTRE_Z - half;
    for (let j = 0, k = 0; j <= n; j++) for (let ii = 0; ii <= n; ii++, k++) {
      pos[k * 3] = x0 + ii * step; pos[k * 3 + 1] = -0.03; pos[k * 3 + 2] = z0 + j * step;
    }
    const inner = i > 0 ? RINGS[i - 1][0] - step : 0; // skip cells fully inside (finer ring minus one cell)
    const idx = [];
    for (let j = 0; j < n; j++) for (let ii = 0; ii < n; ii++) {
      const cx0 = x0 + ii * step, cx1 = cx0 + step, cz0 = z0 + j * step - CENTRE_Z, cz1 = cz0 + step;
      if (inner > 0 && cx0 >= -inner && cx1 <= inner && cz0 >= -inner && cz1 <= inner) continue;
      const a = j * (n + 1) + ii, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('aCut', new THREE.BufferAttribute(cut, 1));
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    const mesh = new THREE.Mesh(g, makeMat(i));
    mesh.name = `Geo ground ring ${i}`; mesh.receiveShadow = i < 2; mesh.frustumCulled = false; mesh.renderOrder = -1;
    group.add(mesh); rings.push(mesh);
  });

  // pad edge (levelled platform outline) — drawn when the terrain is not flat
  const padMat = new THREE.LineDashedMaterial({ color: 0xe8e0d0, dashSize: 1.2, gapSize: 0.8, transparent: true,
    opacity: 0.85, depthWrite: false });
  const padLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 4 * 24 }, () => new THREE.Vector3())), padMat);
  padLine.name = 'Farm pad edge'; padLine.renderOrder = 2; padLine.visible = false;
  group.add(padLine);

  // ---------------- model soil / grass / rows: fade the rim into the photo (chained after water / winter)
  const patched = new Set();
  ctx.root?.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || patched.has(m) || !['Soil', 'Grass', 'Dark earth'].includes(m.name)) continue;
      patched.add(m);
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = function (sh, r) {
        if (prev) prev.call(this, sh, r);
        Object.assign(sh.uniforms, U);
        sh.vertexShader = VARY_VS + sh.vertexShader.replace('#include <project_vertex>', PROJ_VS);
        sh.fragmentShader = GEO_GLSL + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          {
            float dEdge = min(min(vGeoXZ.x - uGeoSoilBox.x, uGeoSoilBox.z - vGeoXZ.x),
                              min(vGeoXZ.y - uGeoSoilBox.y, uGeoSoilBox.w - vGeoXZ.y));
            float wPhoto = 0.92 * (1.0 - smoothstep(0.0, 4.5, dEdge)) * uGeoSoilBlend * uGeoOn * uGeoHas.y;
            diffuseColor.rgb = mix(diffuseColor.rgb, geoColor(vGeoXZ), wPhoto);
          }`);
      };
      m.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|geo-fade'; };
      m.needsUpdate = true;
    }
  });

  // ---------------- default-site extras: plot outline + groundwater boundaries
  const outlineMat = new THREE.LineDashedMaterial({ color: 0xd9ad57, dashSize: 4, gapSize: 2.5, transparent: true,
    opacity: 0.9, depthWrite: false, fog: true });
  const outline = new THREE.LineLoop(new THREE.BufferGeometry(), outlineMat);
  outline.name = 'Agri-PV plot outline (approx.)'; outline.renderOrder = 2; outline.visible = false;
  group.add(outline);
  const boundMat = BOUNDARIES.map((b) => new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0,
    depthWrite: false, fog: false }));
  const boundGroup = new THREE.Group(); boundGroup.name = 'Groundwater boundaries'; group.add(boundGroup);
  let showBounds = true, showOutline = true;
  let defaultGeo = null; // parsed default-site GeoJSON (lon/lat), re-projected on every default-site setSite
  let outlineLonLat = null;

  // ---------------- texture loading (lazy, cached per URL, released on year / site change)
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 1;
  const cache = new Map(); // url -> Promise<Texture>
  const tmpCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const meanColor = new Map();
  function load(url, { mean = false, aniso = maxAniso } = {}) {
    if (cache.has(url)) return cache.get(url);
    const p = new Promise((res, rej) => loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      if (mean && tmpCanvas) {
        try {
          tmpCanvas.width = tmpCanvas.height = 8;
          const g = tmpCanvas.getContext('2d', { willReadFrequently: true });
          g.drawImage(t.image, 0, 0, 8, 8);
          const d = g.getImageData(0, 0, 8, 8).data; const s = [0, 0, 0]; let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) continue; // no-data white
            s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++;
          }
          if (n) meanColor.set(url, s.map((v) => v / n / 255));
        } catch (e) { /* tainted canvas: keep default */ }
      }
      res(t);
    }, undefined, () => { cache.delete(url); rej(new Error('load failed (network / CORS / service): ' + url.slice(0, 90))); }));
    cache.set(url, p);
    return p;
  }
  function release(url) {
    const p = cache.get(url); if (!p) return;
    cache.delete(url); meanColor.delete(url); p.then((t) => t.dispose(), () => {});
  }

  // ---------------- state
  let index = null, defaultSite = null, isDefault = true;
  let terrain = ctx.terrain || null;
  let year = 2025, layerId = 'none', visible = true, opacity = null, loading = 0;
  let token = 0, overToken = 0, siteToken = 0, curLayer = null, overUrl = '';
  const errors = [];
  const pushErr = (msg) => { errors.push(msg); if (errors.length > 12) errors.shift(); console.warn('[geo]', msg); };
  const years = [];             // public list, replaced in place on setSite
  const liveYears = new Map();  // id -> {year} for the current non-default site
  let probeState = 'idle';      // idle | running | done | failed
  const activeUrls = new Set();
  const loaded = { far: false, mid: false, near: false, overlay: false };
  const tierSlots = { far: ['tGeoFar', 'uGeoFarU', 'uGeoFarV', 0], mid: ['tGeoMid', 'uGeoMidU', 'uGeoMidV', 1],
    near: ['tGeoNear', 'uGeoNearU', 'uGeoNearV', 2] };
  const hasArr = [0, 0, 0, 0];
  const pushHas = () => U.uGeoHas.value.set(hasArr[0], hasArr[1], hasArr[2], hasArr[3]);
  const tierBBox = (ext) => { const [E, N] = sceneToLocal(0, CENTRE_Z), h = ext / 2; return [E - h, N - h, E + h, N + h]; };

  function plan(y) {
    // -> { far, mid, near } each {url, bbox, crs} or null
    if (isDefault && index) {
      const o = index.ortho, base = o['2025'].tiers;
      const t = (e) => e && { url: new URL(e.file, DATA).href, bbox: e.bbox, crs: e.crs };
      if (typeof y === 'string' && y.startsWith('s2-')) return { far: t(base.far), mid: t(index.s2[y.slice(3)]), near: null };
      if (y === 'current') y = 2025;
      const e = o[String(y)]; if (!e) return null;
      return { far: t(e.tiers.far), mid: t(e.tiers.mid), near: t(e.tiers.near) };
    }
    const crs = GEO.crs, mk = (spec, yr) => {
      const bb = tierBBox(spec[0]); return { url: orthoUrl(bb, spec[1], crs, yr), bbox: bb, crs };
    };
    if (y === 'current' || y === undefined) return { far: mk(LIVE_TIERS.far), mid: mk(LIVE_TIERS.mid), near: mk(LIVE_TIERS.near) };
    if (typeof y === 'number') return { far: mk(TIME_TIERS.far, y), mid: mk(TIME_TIERS.mid, y), near: null };
    return null;
  }

  async function applyYear(y) {
    const p = plan(y); if (!p) throw new Error('unknown year ' + y);
    const my = ++token; year = y;
    const want = new Set(Object.values(p).filter(Boolean).map((e) => e.url));
    loading++;
    const fails = [];
    try {
      await Promise.all(['near', 'mid', 'far'].map(async (k) => {
        const slot = tierSlots[k], e = p[k];
        if (!e) { if (my === token) { hasArr[slot[3]] = 0; loaded[k] = false; pushHas(); } return; }
        let tex;
        try { tex = await load(e.url, { mean: k === 'far' }); } catch (err) {
          fails.push(`ortho ${k} (${y}): ${err.message}`);
          if (my === token) { hasArr[slot[3]] = 0; loaded[k] = false; pushHas(); }
          return;
        }
        if (my !== token) return;
        U[slot[0]].value = tex; uvAffine(e.bbox, e.crs, U[slot[1]].value, U[slot[2]].value);
        hasArr[slot[3]] = 1; loaded[k] = true; pushHas();
        if (k === 'far' && meanColor.has(e.url)) {
          const m = meanColor.get(e.url);
          U.uGeoFallback.value.setRGB(m[0], m[1], m[2], THREE.SRGBColorSpace);
        }
      }));
    } finally { loading--; }
    for (const f of fails) pushErr(f);
    if (my !== token) return;
    // dispose what this year does not use (default site keeps the 2025 base tiers: S2 mode reuses its far tier)
    const keep = new Set(want);
    if (isDefault && index) for (const e of Object.values(plan(2025))) if (e) keep.add(e.url);
    for (const u of activeUrls) if (!keep.has(u)) { release(u); activeUrls.delete(u); }
    for (const u of want) activeUrls.add(u);
    if (fails.length && fails.length === Object.values(p).filter(Boolean).length) throw new Error(fails[0]);
  }

  // ---- archival-year probe for live sites: 32 px thumbnails, dedup by content, white = no data
  async function probeYears(mySite) {
    probeState = 'running';
    const bb = tierBBox(240), crs = GEO.crs;
    const sig = async (yr) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.src = orthoUrl(bb, 32, crs, yr);
      await img.decode();
      tmpCanvas.width = tmpCanvas.height = 16;
      const g = tmpCanvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let white = 0, h = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) white++;
        h = (h * 31 + (d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3)) >>> 0;
      }
      return white > 200 ? 'white' : String(h);
    };
    const res = new Map();
    let i = 0, fails = 0;
    const worker = async () => {
      while (i < PROBE_YEARS.length) {
        const yr = PROBE_YEARS[i++];
        try { res.set(yr, await sig(yr)); } catch (e) { fails++; res.set(yr, 'err'); }
        if (mySite !== siteToken) return;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (mySite !== siteToken) return;
    let prev = null;
    const found = [];
    for (const yr of PROBE_YEARS) {
      const s = res.get(yr);
      if (s === 'white' || s === 'err') { prev = s; continue; }
      if (s !== prev) found.push(yr);
      prev = s;
    }
    for (const yr of found) {
      liveYears.set(yr, { year: yr });
      years.push({ id: yr, kind: 'live-time', date: String(yr),
        label_pl: `Ortofotomapa archiwalna ${yr} (ok.)`, label_en: `Archival orthophoto ${yr} (approx.)` });
    }
    probeState = fails === PROBE_YEARS.length ? 'failed' : 'done';
    if (probeState === 'failed') pushErr('archival ortho probe failed (time WMS unreachable)');
  }

  function overlayBBox(L) {
    const crs = L.crs === 'local' ? GEO.crs : L.crs;
    const [E, N] = sceneToCRS(0, CENTRE_Z, crs), h = L.ext / 2;
    return [[E - h, N - h, E + h, N + h], crs];
  }
  async function applyLayer(id) {
    const L = LAYERS.find((l) => l.id === id); if (!L) throw new Error('unknown layer ' + id);
    layerId = id; curLayer = L; const my = ++overToken;
    if (opacity === null || id !== 'none') U.uGeoOverOpacity.value = opacity ?? L.opacity;
    if (id === 'none') { hasArr[3] = 0; loaded.overlay = false; pushHas(); if (overUrl) { release(overUrl); overUrl = ''; } return; }
    const [bb, crs] = overlayBBox(L), url = L.url(bb, L.px, crs);
    loading++;
    try {
      const tex = await load(url, { aniso: Math.min(4, maxAniso) });
      if (my !== overToken) { release(url); return; }
      if (L.px < 1000) { tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true; }
      if (overUrl && overUrl !== url) release(overUrl);
      overUrl = url;
      U.tGeoOver.value = tex; uvAffine(bb, crs, U.uGeoOverU.value, U.uGeoOverV.value);
      hasArr[3] = 1; loaded.overlay = true; pushHas();
    } catch (e) {
      if (my === overToken) { hasArr[3] = 0; loaded.overlay = false; pushHas(); }
      pushErr(`layer ${id}: ${e?.message || 'load failed'}`); throw e;
    } finally { loading--; }
  }

  // ---- terrain heights -> ring vertices (in place)
  let terrainStats = { source: 'flat', minY: 0, maxY: 0, cutMax: 0 };
  async function refreshTerrain() {
    const t = terrain, mySite = siteToken;
    if (t && t.ready && typeof t.ready.then === 'function') {
      // never block the ground on a slow / not yet started terrain: build flat-ish now, rebuild when it lands
      let timedOut = false;
      try {
        await Promise.race([t.ready, new Promise((r) => setTimeout(() => { timedOut = true; r(); }, 12000))]);
      } catch (e) { pushErr('terrain: ' + (e?.message || e)); }
      if (timedOut) t.ready.then(() => { if (mySite === siteToken && terrain === t) refreshTerrain(); }, () => {});
    }
    const hAt = t && typeof t.heightAt === 'function' ? t.heightAt.bind(t) : null;
    const nAt = t && typeof t.naturalHeightAt === 'function' ? t.naturalHeightAt.bind(t) : null;
    let minY = Infinity, maxY = -Infinity, cutMax = 0;
    for (const mesh of rings) {
      const g = mesh.geometry, pos = g.attributes.position.array, cut = g.attributes.aCut.array;
      for (let k = 0, v = 0; k < pos.length; k += 3, v++) {
        const x = pos[k], z = pos[k + 2];
        let h = 0;
        if (hAt) { h = +hAt(x, z); if (!Number.isFinite(h)) h = 0; }
        pos[k + 1] = h - 0.03;
        let c = 0;
        if (nAt) {
          const n = +nAt(x, z);
          if (Number.isFinite(n)) { const d = h - n; c = Math.sign(d) * Math.min(1, Math.max(0, (Math.abs(d) - 0.05) / 0.45)); }
        }
        cut[v] = c;
        if (h < minY) minY = h; if (h > maxY) maxY = h; if (Math.abs(c) > cutMax) cutMax = Math.abs(c);
      }
      g.attributes.position.needsUpdate = true; g.attributes.aCut.needsUpdate = true;
      g.computeVertexNormals(); g.computeBoundingSphere();
    }
    // pad edge: terrain.pad or the soil box, following heightAt
    const pad = t?.padRect || t?.pad || null;
    const [px0, pz0, px1, pz1] = pad ? [pad.x0, pad.z0, pad.x1, pad.z1] : SOIL_BOX;
    const pp = padLine.geometry.attributes.position, seg = 24;
    const corners = [[px0, pz1], [px1, pz1], [px1, pz0], [px0, pz0]];
    for (let s = 0, k = 0; s < 4; s++) {
      const [ax, az] = corners[s], [bx, bz] = corners[(s + 1) % 4];
      for (let q = 0; q < seg; q++, k++) {
        const x = ax + (bx - ax) * q / seg, z = az + (bz - az) * q / seg;
        pp.setXYZ(k, x, (hAt ? hAt(x, z) : 0) + 0.06, z);
      }
    }
    pp.needsUpdate = true; padLine.computeLineDistances();
    padLine.visible = !!hAt && (maxY - minY > 0.5 || cutMax > 0.1);
    terrainStats = { source: hAt ? (t.info?.()?.source || 'terrain') : 'flat', minY, maxY, cutMax };
    placeDefaultLines();
  }

  function placeDefaultLines() {
    const hAt = terrain && typeof terrain.heightAt === 'function' ? terrain.heightAt.bind(terrain) : () => 0;
    // outline
    outline.visible = isDefault && showOutline && !!outlineLonLat;
    if (outline.visible) {
      const pts = outlineLonLat.slice(0, -1).map(([lo, la]) => {
        const [x, z] = latLonToScene(la, lo); return new THREE.Vector3(x, hAt(x, z) + 0.12, z);
      });
      outline.geometry.dispose(); outline.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      outline.computeLineDistances();
    }
    for (const l of [...boundGroup.children]) { l.geometry.dispose(); boundGroup.remove(l); }
    if (!isDefault || !defaultGeo) return;
    defaultGeo.forEach((gj, i) => {
      if (!gj) return;
      for (const f of gj.features) {
        const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) {
          const v = poly[0].map(([lo, la]) => { const [x, z] = latLonToScene(la, lo); return new THREE.Vector3(x, hAt(x, z) + 0.6, z); });
          const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(v), boundMat[i]);
          line.name = BOUNDARIES[i].label_en; line.frustumCulled = false; line.renderOrder = 3; boundGroup.add(line);
        }
      }
    });
  }

  function sameSite(a, b) {
    if (!a || !b) return false;
    const dy = (a.lat - b.lat) * 111320, dx = (a.lon - b.lon) * 111320 * Math.cos(a.lat * D2R);
    return Math.hypot(dx, dy) < 3 && Math.abs(((a.rotDeg ?? 0) - (b.rotDeg ?? 0) + 540) % 360 - 180) < 0.5;
  }

  async function setSite(site, opts = {}) {
    if (!site || !Number.isFinite(+site.lat) || !Number.isFinite(+site.lon)) throw new Error('setSite: lat/lon required');
    const my = ++siteToken;
    if (opts.terrain) terrain = opts.terrain;
    setGeoSite(site);
    isDefault = sameSite(site, defaultSite);
    GEO.isDefault = isDefault;
    // drop all textures of the previous site
    ++token; ++overToken;
    for (const u of activeUrls) release(u); activeUrls.clear();
    if (overUrl) { release(overUrl); overUrl = ''; }
    for (const k of Object.keys(loaded)) loaded[k] = false;
    hasArr.fill(0); pushHas();
    U.uGeoFallback.value.setRGB(...FAR_TINT);
    errors.length = 0;
    // years
    years.length = 0; liveYears.clear(); probeState = 'idle';
    if (isDefault) years.push(...DEFAULT_YEARS); else years.push(LIVE_CURRENT);
    const terrainP = refreshTerrain();
    const yearP = applyYear(isDefault ? 2025 : 'current').catch((e) => pushErr(String(e?.message || e)));
    const layerP = layerId !== 'none' ? applyLayer(layerId).catch(() => {}) : null;
    await Promise.all([terrainP, yearP, layerP]);
    if (my !== siteToken) return;
    if (!isDefault && tmpCanvas) probeYears(my).catch((e) => { probeState = 'failed'; pushErr('probe: ' + e.message); });
  }

  const ready = (async () => {
    const [s, idx] = await Promise.all([
      fetch(new URL('site.json', DATA)).then((r) => r.json()),
      fetch(new URL('ortho_index.json', DATA)).then((r) => r.json()),
    ]);
    index = idx;
    defaultSite = { lat: s.lat, lon: s.lon, rotDeg: s.rotDeg, name: 'Witkowo', confidence: s.confidence };
    outlineLonLat = s.plotOutline?.lonlat || null;
    defaultGeo = await Promise.all(BOUNDARIES.map((b) => fetch(new URL(b.file, DATA)).then((r) => r.json()).catch(() => null)));
    await setSite(ctx.site || defaultSite);
  })();
  ready.catch((e) => pushErr('init: ' + (e?.message || e)));

  // ---------------- API
  const infoObj = { site: null, extentM: 3200, lat: 0, lon: 0, rotDeg: 0, crs: '', isDefault: true, year: 0,
    yearLabel: '', years: years, probe: 'idle', layer: '', loaded, loading: false, attribution: '', errors,
    error: '', overlay: null, confidence: null, terrain: null, recommended: null };
  const recommended = { cameraFar: 9000, maxDistance: 1800, fogNear: 1400, fogFar: 7000,
    note: 'ground rings to 8 km; ortho tiers: near 400 m (0.25 m/px), mid 1 km, far 4 km (live) / 3.2 km (Witkowo offline)' };
  let attrKey = '', attrStr = '';
  function attribution() {
    const key = year + '|' + layerId + '|' + isDefault;
    if (key === attrKey) return attrStr;
    attrKey = key;
    const a = [];
    const y = years.find((v) => v.id === year);
    a.push(y?.kind === 's2' ? `${ATTR_S2}; ${ATTR_ORTHO}` : `${ATTR_ORTHO}${y ? ` (${y.date})` : ''}`);
    const L = LAYERS.find((l) => l.id === layerId);
    if (L && L.attribution && L.id !== 'orto') a.push(L.attribution);
    attrStr = a.join(' · ');
    return attrStr;
  }
  const siteInfo = { lat: 0, lon: 0, rotDeg: 0, name: '', crs: '', isDefault: true };

  return {
    group, ready, GEO, years, layers: LAYERS, boundaries: BOUNDARIES,
    sceneToLatLon, latLonToScene, sceneToCRS, crsToScene,
    setSite,
    setTerrain(t) { terrain = t; return refreshTerrain(); },
    refreshTerrain,
    update(dt, state) {
      U.uGeoSnow.value = state && state.winter ? state.winter : 0;
      // boundaries (default site): invisible near the farm, fully visible from ~600 m out
      const cam = ctx.getCamera ? ctx.getCamera() : null;
      if (cam && boundGroup.children.length) {
        const p = cam.position, d = Math.hypot(p.x, p.y, p.z - CENTRE_Z);
        const a = showBounds ? Math.min(1, Math.max(0, (d - 180) / 420)) * 0.95 : 0;
        for (let i = 0; i < boundMat.length; i++) boundMat[i].opacity = a;
        boundGroup.visible = a > 0.01;
      }
    },
    info() {
      if (infoObj.year !== year) infoObj.yearLabel = years.find((v) => v.id === year)?.date || '';
      siteInfo.lat = GEO.lat; siteInfo.lon = GEO.lon; siteInfo.rotDeg = GEO.rotDeg; siteInfo.name = GEO.name;
      siteInfo.crs = GEO.crs; siteInfo.isDefault = isDefault;
      infoObj.site = siteInfo;
      infoObj.lat = GEO.lat; infoObj.lon = GEO.lon; infoObj.rotDeg = GEO.rotDeg; infoObj.crs = GEO.crs;
      infoObj.isDefault = isDefault; infoObj.year = year; infoObj.probe = probeState;
      infoObj.layer = layerId; infoObj.loading = loading > 0;
      infoObj.attribution = attribution(); infoObj.error = errors.length ? errors[errors.length - 1] : '';
      infoObj.confidence = isDefault ? defaultSite?.confidence || null : null;
      infoObj.overlay = isDefault ? curLayer?.atDefault || null : null;
      infoObj.terrain = terrainStats; infoObj.recommended = recommended;
      return infoObj;
    },
    setVisible(b) {
      visible = !!b; group.visible = visible; U.uGeoOn.value = visible ? 1 : 0;
    },
    setYear(y) {
      if (typeof y === 'string' && /^\d{4}$/.test(y)) y = +y;
      return ready.then(() => applyYear(y));
    },
    setLayer(id) { return ready.then(() => applyLayer(id)); },
    setOpacity(v) { opacity = Math.min(1, Math.max(0, +v)); U.uGeoOverOpacity.value = opacity; },
    setSoilBlend(b) { U.uGeoSoilBlend.value = b ? 1 : 0; },
    setCutFill(b) { U.uGeoCutShow.value = b ? 1 : 0; },
    setOutline(b) { showOutline = !!b; outline.visible = isDefault && showOutline && !!outlineLonLat; },
    setBoundaries(b) { showBounds = !!b; },
    setGain(v) { U.uGeoGain.value = v; },
  };
}
