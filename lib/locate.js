// lib/locate.js — location picker: choose where in Poland the farm stands.
//   const site = await openPicker(currentSite, 'pl');  // -> { lat, lon, rotDeg, name, source:'picker' } | null
// Self-contained: loads Leaflet 1.9.4 lazily (unpkg ESM, cdnjs script fallback), injects its own CSS (.loc-*),
// removes its DOM + Leaflet map on close. Base maps: GUGiK Geoportal ORTO (WMTS, matrix set EPSG:3857) and OSM.
// Search: GUGiK UUG geocoder while typing (debounced 600 ms); Nominatim only on an explicit search (Enter/button),
// max 1 request/s, per the OSMF usage policy (no autocomplete). Reverse geocode once after a move (debounced).
//
// Geometry: site lat/lon = scene origin (0,0,0). The modelled farm patch is scene x -18..18, z -36..6 (36 x 42 m),
// its centre is scene (0, -15). rotDeg = true bearing of the scene -z axis. Mapping (data/geo/site.json):
//   dE = x*cos(b) - z*sin(b), dN = -x*sin(b) - z*cos(b)
// Full plot (optional outline): the patch is the south corner of a ~95 x 250 m plot -> x -18..77, z -244..6.

const LEAFLET_ESM = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js';
const LEAFLET_CSS = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'];
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const ORTO_URL = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile' +
  '&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857' +
  '&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}';
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const UUG = 'https://services.gugik.gov.pl/uug/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/';
const PL_BOUNDS = [[49.0, 14.0], [55.0, 24.2]];
const WITKOWO = { lat: 53.2886348, lon: 15.0687030, rotDeg: 313, name: 'Witkowo, gm. Stargard' };
const PATCH = { x0: -18, x1: 18, z0: -36, z1: 6 }; // scene metres
const PLOT = { x0: -18, x1: 77, z0: -244, z1: 6 };
const CENTRE_Z = -15;
const HANDLE_PX = 64;

const STR = {
  pl: {
    title: 'Lokalizacja farmy', sub: 'Wybierz miejsce w Polsce: kliknij mapę lub przeciągnij farmę.',
    search: 'Szukaj miejscowości lub adresu', searchBtn: 'Szukaj', searching: 'Szukam...', none: 'Brak wyników',
    searchErr: 'Wyszukiwarka niedostępna', hintEnter: 'Enter: szukaj także w OpenStreetMap',
    orto: 'Ortofotomapa', osm: 'Mapa OSM', plot: 'Cała działka 250 x 95 m', layers: 'Podkład mapy',
    lat: 'Szer.', lon: 'Dł.', rot: 'Obrót', place: 'Miejsce', unknown: 'nieznane', locating: 'ustalam...',
    rotLabel: 'Obrót farmy (kierunek rzędów, stopnie od północy)', minus: 'Obróć o -5 stopni', plus: 'Obróć o +5 stopni',
    preset: 'Witkowo (domyślnie)', cancel: 'Anuluj', ok: 'Umieść farmę tutaj', close: 'Zamknij',
    centre: 'Środek farmy, przeciągnij aby przesunąć', handle: 'Uchwyt obrotu, przeciągnij aby obrócić',
    map: 'Mapa Polski. Kliknij, aby przenieść farmę.', loadErr: 'Nie udało się wczytać mapy (Leaflet). Sprawdź połączenie.',
    results: 'Wyniki wyszukiwania', outside: 'Poza granicami Polski',
  },
  en: {
    title: 'Farm location', sub: 'Pick a place in Poland: click the map or drag the farm.',
    search: 'Search for a town or address', searchBtn: 'Search', searching: 'Searching...', none: 'No results',
    searchErr: 'Search unavailable', hintEnter: 'Enter: also search OpenStreetMap',
    orto: 'Orthophoto', osm: 'OSM map', plot: 'Whole plot 250 x 95 m', layers: 'Base map',
    lat: 'Lat', lon: 'Lon', rot: 'Rotation', place: 'Place', unknown: 'unknown', locating: 'locating...',
    rotLabel: 'Farm rotation (row direction, degrees from north)', minus: 'Rotate by -5 degrees', plus: 'Rotate by +5 degrees',
    preset: 'Witkowo (default)', cancel: 'Cancel', ok: 'Place the farm here', close: 'Close',
    centre: 'Farm centre, drag to move', handle: 'Rotation handle, drag to rotate',
    map: 'Map of Poland. Click to move the farm.', loadErr: 'Could not load the map (Leaflet). Check the connection.',
    results: 'Search results', outside: 'Outside Poland',
  },
};

// ---------------------------------------------------------------- geometry
const D2R = Math.PI / 180;
const A = 6378137, E2 = 0.00669437999014;
function radii(lat) {
  const s = Math.sin(lat * D2R), w = 1 - E2 * s * s;
  return { M: A * (1 - E2) / Math.pow(w, 1.5), N: A / Math.sqrt(w) };
}
// scene (x,z) relative to a site origin -> lat/lon
function sceneToLL(o, x, z) {
  const b = o.rotDeg * D2R, c = Math.cos(b), s = Math.sin(b);
  const dE = x * c - z * s, dN = -x * s - z * c;
  const { M, N } = radii(o.lat);
  return [o.lat + dN / M / D2R, o.lon + dE / (N * Math.cos(o.lat * D2R)) / D2R];
}
// move a point by (dE, dN) metres
function offsetLL(lat, lon, dE, dN) {
  const { M, N } = radii(lat);
  return [lat + dN / M / D2R, lon + dE / (N * Math.cos(lat * D2R)) / D2R];
}
// farm centre <-> site origin (origin is 15 m along +z from the centre)
function originFromCentre(cLat, cLon, rotDeg) {
  const b = rotDeg * D2R, z = -CENTRE_Z; // vector centre -> origin in scene = (0, +15)
  return offsetLL(cLat, cLon, -z * Math.sin(b), -z * Math.cos(b));
}
function centreFromOrigin(o) { return sceneToLL(o, 0, CENTRE_Z); }
function rectLL(o, r) { return [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].map(([x, z]) => sceneToLL(o, x, z)); }
const norm360 = (d) => ((Math.round(d) % 360) + 360) % 360;
const inPL = (lat, lon) => lat >= PL_BOUNDS[0][0] && lat <= PL_BOUNDS[1][0] && lon >= PL_BOUNDS[0][1] && lon <= PL_BOUNDS[1][1];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- loaders
let leafletP = null;
function loadCss(href) {
  return new Promise((res, rej) => {
    if (document.querySelector(`link[data-loc-css]`)) return res();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.locCss = '1'; l.crossOrigin = 'anonymous';
    l.onload = res; l.onerror = () => { l.remove(); rej(new Error('css')); };
    document.head.appendChild(l);
  });
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.appendChild(s);
  });
}
function loadLeaflet() {
  if (leafletP) return leafletP;
  leafletP = (async () => {
    const css = loadCss(LEAFLET_CSS[0]).catch(() => loadCss(LEAFLET_CSS[1])).catch(() => {});
    let L = null;
    if (window.L && window.L.map) L = window.L;
    if (!L) { try { const m = await import(/* @vite-ignore */ LEAFLET_ESM); L = m.map ? m : m.default; } catch (e) { L = null; } }
    if (!L || !L.map) { await loadScript(LEAFLET_JS); L = window.L; }
    await css;
    if (!L || !L.map) throw new Error('leaflet');
    return L;
  })();
  leafletP.catch(() => { leafletP = null; });
  return leafletP;
}
let defaultSiteP = null;
function loadDefaultSite() {
  if (!defaultSiteP) {
    defaultSiteP = fetch(new URL('../data/geo/site.json', import.meta.url), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && isFinite(j.lat) && isFinite(j.lon) ? { lat: +j.lat, lon: +j.lon, rotDeg: isFinite(j.rotDeg) ? +j.rotDeg : WITKOWO.rotDeg, name: WITKOWO.name } : { ...WITKOWO }))
      .catch(() => ({ ...WITKOWO }));
  }
  return defaultSiteP;
}

// ---------------------------------------------------------------- geocoders
let lastNominatim = 0;
async function nominatimGate(signal) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r, j) => { const t = setTimeout(r, wait); signal?.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('aborted', 'AbortError')); }); });
  lastNominatim = Date.now();
}
async function uugSearch(q, signal) {
  const r = await fetch(`${UUG}?request=GetAddress&srid=4326&address=${encodeURIComponent(q)}`, { signal });
  if (!r.ok) throw new Error('uug ' + r.status);
  const j = await r.json();
  return Object.values(j.results || {}).map((o) => {
    const lon = +o.x, lat = +o.y;
    const main = o.street ? `${o.city}, ${o.street} ${o.number || ''}`.trim() : (o.number ? `${o.city} ${o.number}` : o.city);
    const sub = [o.commune && o.commune !== o.city ? 'gm. ' + o.commune : '', o.county ? 'pow. ' + o.county : '', o.voivodeship].filter(Boolean).join(', ');
    return { lat, lon, name: main, sub, src: 'GUGiK', zoom: o.street ? 18 : (j.type === 'city' ? 14 : 16) };
  }).filter((o) => isFinite(o.lat) && isFinite(o.lon));
}
function nominatimName(a, fallback) {
  if (!a) return fallback;
  const place = a.village || a.town || a.city || a.hamlet || a.suburb || a.municipality || a.county;
  const gm = a.municipality && a.municipality !== place ? a.municipality.replace(/^gmina /i, 'gm. ') : '';
  return [place, gm].filter(Boolean).join(', ') || fallback;
}
async function nominatimSearch(q, lang, signal) {
  await nominatimGate(signal);
  const r = await fetch(`${NOMINATIM}search?format=jsonv2&countrycodes=pl&addressdetails=1&limit=8&accept-language=${lang}&q=${encodeURIComponent(q)}`, { signal });
  if (!r.ok) throw new Error('nominatim ' + r.status);
  const j = await r.json();
  return j.map((o) => {
    const parts = String(o.display_name || '').split(', ');
    return { lat: +o.lat, lon: +o.lon, name: o.name || parts[0], sub: parts.slice(1, 4).join(', '), src: 'OSM', zoom: o.place_rank >= 26 ? 18 : o.place_rank >= 16 ? 15 : 13, bbox: o.boundingbox };
  }).filter((o) => isFinite(o.lat) && isFinite(o.lon));
}
async function reverseName(lat, lon, lang, signal) {
  try {
    const r = await fetch(`${UUG}?request=GetAddressReverse&srid=4326&location=POINT(${lon.toFixed(6)}%20${lat.toFixed(6)})`, { signal });
    if (r.ok) {
      const j = await r.json();
      const o = j.results && Object.values(j.results)[0];
      if (o && o.city) return { name: o.street ? `${o.city}, ${o.street} ${o.number || ''}`.trim() : `${o.city} ${o.number || ''}`.trim(), src: 'GUGiK' };
    }
  } catch (e) { if (e.name === 'AbortError') throw e; }
  await nominatimGate(signal);
  const r = await fetch(`${NOMINATIM}reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=${lang}&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, { signal });
  if (!r.ok) throw new Error('reverse ' + r.status);
  const j = await r.json();
  return { name: nominatimName(j.address, j.name || ''), src: 'OSM' };
}

// ---------------------------------------------------------------- CSS
const CSS = `
.loc-root{position:fixed;inset:0;z-index:10000;display:flex;align-items:stretch;justify-content:center;background:rgba(6,7,9,.62);
  font:13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8e4da;padding:24px;box-sizing:border-box;
  animation:loc-fade .16s ease-out}
.loc-root *{box-sizing:border-box}
@keyframes loc-fade{from{opacity:0}to{opacity:1}}
.loc-dlg{position:relative;display:flex;flex-direction:column;width:min(1180px,100%);height:100%;background:rgba(17,19,23,.92);
  border:1px solid #262a31;border-radius:12px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.55);backdrop-filter:blur(8px)}
.loc-head{display:flex;gap:14px;align-items:center;padding:12px 14px;border-bottom:1px solid #262a31;flex-wrap:wrap}
.loc-ttl{flex:0 1 auto;min-width:0}
.loc-ttl h2{margin:0;font-size:15px;font-weight:600;letter-spacing:.01em}
.loc-ttl p{margin:2px 0 0;color:#8f939c;font-size:12px}
.loc-search{position:relative;flex:1 1 320px;min-width:0;display:flex;gap:6px}
.loc-search input{flex:1;min-width:0;height:34px;border-radius:8px;border:1px solid #262a31;background:#0d0f12;color:#e8e4da;
  padding:0 10px;font:inherit;outline:none}
.loc-search input:focus{border-color:#d9ad57}
.loc-btn{height:34px;padding:0 12px;border-radius:8px;border:1px solid #262a31;background:#1c1f25;color:#e8e4da;font:inherit;
  cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.loc-btn:hover{border-color:#3a3f48;background:#22262d}
.loc-btn:focus-visible,.loc-x:focus-visible,.loc-res button:focus-visible,.loc-seg button:focus-visible,.loc-chk input:focus-visible{outline:2px solid #d9ad57;outline-offset:1px}
.loc-btn.loc-pri{background:#d9ad57;border-color:#d9ad57;color:#15130e;font-weight:600}
.loc-btn.loc-pri:hover{background:#e4bb68}
.loc-btn.loc-sq{width:34px;padding:0}
.loc-x{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:8px;border:1px solid transparent;background:none;
  color:#8f939c;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.loc-root svg{flex:none}
.loc-x:hover{color:#e8e4da;border-color:#262a31}
.loc-head{padding-right:50px;position:relative;z-index:2}
.loc-res{position:absolute;left:0;right:0;top:40px;z-index:1000;margin:0;padding:4px;list-style:none;background:#14161b;border:1px solid #262a31;
  border-radius:8px;max-height:min(320px,50vh);overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.loc-res[hidden]{display:none}
.loc-res li{margin:0}
.loc-res button{display:block;width:100%;text-align:left;border:0;background:none;color:#e8e4da;font:inherit;padding:7px 9px;border-radius:6px;cursor:pointer}
.loc-res button:hover,.loc-res button.loc-on{background:#22262d}
.loc-res small{display:block;color:#8f939c;font-size:11.5px}
.loc-res .loc-src{float:right;color:#8f939c;font-size:10.5px;letter-spacing:.04em;margin-left:8px}
.loc-res .loc-msg{padding:7px 9px;color:#8f939c}
.loc-body{position:relative;flex:1;min-height:0;z-index:0;isolation:isolate}
.loc-map{position:absolute;inset:0;background:#0d0f12}
.loc-map:focus-visible{outline:2px solid #d9ad57;outline-offset:-2px}
.loc-tools{position:absolute;top:10px;right:10px;z-index:800;display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.loc-seg{display:flex;background:rgba(17,19,23,.92);border:1px solid #262a31;border-radius:8px;padding:2px}
.loc-seg button{border:0;background:none;color:#8f939c;font:inherit;font-size:12px;padding:5px 9px;border-radius:6px;cursor:pointer}
.loc-seg button[aria-pressed="true"]{background:#2a2d33;color:#e8e4da}
.loc-chk{display:flex;align-items:center;gap:6px;background:rgba(17,19,23,.92);border:1px solid #262a31;border-radius:8px;padding:5px 9px;
  font-size:12px;color:#e8e4da;cursor:pointer;user-select:none}
.loc-chk input{accent-color:#d9ad57;margin:0}
.loc-err{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8f939c;padding:20px;text-align:center}
.loc-foot{display:flex;gap:10px 16px;align-items:center;padding:10px 14px;border-top:1px solid #262a31;flex-wrap:wrap}
.loc-info{display:flex;gap:4px 14px;flex-wrap:wrap;flex:1 1 300px;min-width:0;font-variant-numeric:tabular-nums}
.loc-info span{color:#8f939c}
.loc-info b{font-weight:500;color:#e8e4da}
.loc-info .loc-place{flex-basis:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.loc-rot{display:flex;align-items:center;gap:6px;flex:0 1 auto}
.loc-rot input[type=range]{width:150px;accent-color:#d9ad57}
.loc-rot output{min-width:38px;text-align:right;font-variant-numeric:tabular-nums}
.loc-acts{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
.loc-attr{padding:0 14px 8px;color:#8f939c;font-size:11px}
.loc-attr a{color:#b9a27a}
.loc-pin{position:relative;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#d9ad57;border:2px solid #15130e;
  box-shadow:0 0 0 2px rgba(217,173,87,.35),0 2px 8px rgba(0,0,0,.5);cursor:grab}
.loc-pin::after{content:"";position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#15130e}
.loc-hdl{width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:#15130e;border:2px solid #d9ad57;cursor:grab;
  display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.loc-hdl svg{display:block}
.loc-root .leaflet-container{font:inherit;background:#0d0f12}
.loc-root .leaflet-bar a{background:rgba(17,19,23,.92);color:#e8e4da;border-color:#262a31}
.loc-root .leaflet-bar a:hover{background:#22262d}
.loc-root .leaflet-bar{border:1px solid #262a31}
.loc-root .leaflet-control-attribution{background:rgba(17,19,23,.8);color:#8f939c;font-size:10.5px}
.loc-root .leaflet-control-attribution a{color:#b9a27a}
.loc-root .leaflet-control-scale-line{background:rgba(17,19,23,.75);color:#e8e4da;border-color:#8f939c}
@media (max-width:640px){
  .loc-root{padding:0}
  .loc-dlg{border-radius:0;border:0}
  .loc-head{padding:10px 12px;gap:8px;padding-right:46px}
  .loc-ttl p{display:none}
  .loc-search{flex-basis:100%}
  .loc-foot{padding:8px 12px;gap:8px}
  .loc-info{flex-basis:100%;gap:2px 10px;font-size:12px}
  .loc-rot{flex:1 1 100%}
  .loc-rot input[type=range]{flex:1;width:auto}
  .loc-acts{flex:1 1 100%;margin-left:0}
  .loc-acts .loc-btn{flex:1 1 auto}
  .loc-acts .loc-pri{flex-basis:100%;order:-1}
  .loc-attr{padding:0 12px 6px;font-size:10px}
  .loc-tools{top:8px;right:8px}
}
@media (prefers-reduced-motion:reduce){.loc-root{animation:none}}
`;
function injectCss() {
  if (document.getElementById('loc-style')) return;
  const s = document.createElement('style');
  s.id = 'loc-style'; s.textContent = CSS;
  document.head.appendChild(s);
}

const SVG_X = '<svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const SVG_ROT = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 4.2A4 4 0 1 0 10 7" fill="none" stroke="#d9ad57" stroke-width="1.5" stroke-linecap="round"/><path d="M10.4 1.6v3h-3" fill="none" stroke="#d9ad57" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_SEARCH = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9.2 9.2L12.6 12.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

// ---------------------------------------------------------------- picker
let active = null;

export async function openPicker(currentSite, lang = 'pl') {
  if (active) return active;
  active = run(currentSite, lang === 'en' ? 'en' : 'pl').finally(() => { active = null; });
  return active;
}

async function run(currentSite, lang) {
  const T = STR[lang];
  injectCss();
  const def = await loadDefaultSite();
  const start = currentSite && isFinite(currentSite.lat) && isFinite(currentSite.lon) ? currentSite : def;
  // state: farm centre + rotation; origin derived
  let rot = norm360(isFinite(start.rotDeg) ? start.rotDeg : def.rotDeg);
  let [cLat, cLon] = centreFromOrigin({ lat: +start.lat, lon: +start.lon, rotDeg: rot });
  let placeName = start.name || '';
  let showPlot = false;

  const prevFocus = document.activeElement;
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const root = document.createElement('div');
  root.className = 'loc-root';
  const uid = 'loc' + Math.random().toString(36).slice(2, 7);
  root.innerHTML = `
  <div class="loc-dlg" role="dialog" aria-modal="true" aria-labelledby="${uid}-t" aria-describedby="${uid}-s">
    <div class="loc-head">
      <div class="loc-ttl"><h2 id="${uid}-t">${esc(T.title)}</h2><p id="${uid}-s">${esc(T.sub)}</p></div>
      <form class="loc-search" role="search" autocomplete="off">
        <input type="search" name="q" placeholder="${esc(T.search)}" aria-label="${esc(T.search)}" title="${esc(T.hintEnter)}"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${uid}-r" spellcheck="false">
        <button type="submit" class="loc-btn loc-sq" aria-label="${esc(T.searchBtn)}" title="${esc(T.searchBtn)}">${SVG_SEARCH}</button>
        <ul class="loc-res" id="${uid}-r" role="listbox" aria-label="${esc(T.results)}" hidden></ul>
      </form>
      <button type="button" class="loc-x" aria-label="${esc(T.close)}" title="${esc(T.close)}">${SVG_X}</button>
    </div>
    <div class="loc-body">
      <div class="loc-map" tabindex="0" role="application" aria-label="${esc(T.map)}"></div>
      <div class="loc-tools">
        <div class="loc-seg" role="group" aria-label="${esc(T.layers)}">
          <button type="button" data-l="orto" aria-pressed="true">${esc(T.orto)}</button>
          <button type="button" data-l="osm" aria-pressed="false">${esc(T.osm)}</button>
        </div>
        <label class="loc-chk"><input type="checkbox" class="loc-plot"> ${esc(T.plot)}</label>
      </div>
    </div>
    <div class="loc-foot">
      <div class="loc-info" aria-live="polite">
        <div><span>${esc(T.lat)}</span> <b class="loc-lat"></b></div>
        <div><span>${esc(T.lon)}</span> <b class="loc-lon"></b></div>
        <div><span>${esc(T.rot)}</span> <b class="loc-rotv"></b></div>
        <div class="loc-place"><span>${esc(T.place)}</span> <b class="loc-name"></b></div>
      </div>
      <div class="loc-rot">
        <button type="button" class="loc-btn loc-sq" data-d="-5" aria-label="${esc(T.minus)}" title="${esc(T.minus)}">-5</button>
        <input type="range" min="0" max="359" step="1" aria-label="${esc(T.rotLabel)}" title="${esc(T.rotLabel)}">
        <button type="button" class="loc-btn loc-sq" data-d="5" aria-label="${esc(T.plus)}" title="${esc(T.plus)}">+5</button>
        <output aria-hidden="true"></output>
      </div>
      <div class="loc-acts">
        <button type="button" class="loc-btn loc-preset">${esc(T.preset)}</button>
        <button type="button" class="loc-btn loc-cancel">${esc(T.cancel)}</button>
        <button type="button" class="loc-btn loc-pri loc-ok">${esc(T.ok)}</button>
      </div>
    </div>
    <div class="loc-attr">${lang === 'pl' ? 'Wyszukiwanie' : 'Search'}: <a href="https://services.gugik.gov.pl/uug/" target="_blank" rel="noopener">GUGiK UUG</a>,
      <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener">Nominatim</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></div>
  </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const dlg = $('.loc-dlg'), mapEl = $('.loc-map'), input = $('.loc-search input'), resUl = $('.loc-res');
  const range = $('.loc-rot input'), out = $('.loc-rot output');

  let resolveFn;
  const done = new Promise((r) => { resolveFn = r; });
  let closed = false;
  const ctrls = new Set(); // AbortControllers
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

  let L = null, map = null, rect = null, plot = null, pin = null, hdl = null, hline = null, layers = {};

  function close(result) {
    if (closed) return;
    closed = true;
    ctrls.forEach((c) => c.abort()); ctrls.clear();
    timers.forEach(clearTimeout); timers.clear();
    document.removeEventListener('keydown', onKey, true);
    try { map && map.remove(); } catch (e) { /* ignore */ }
    map = null;
    root.remove();
    document.body.style.overflow = prevOverflow;
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
    resolveFn(result);
  }

  // ---- info footer
  function origin() { const [lat, lon] = originFromCentre(cLat, cLon, rot); return { lat, lon, rotDeg: rot }; }
  function renderInfo() {
    const o = origin();
    $('.loc-lat').textContent = o.lat.toFixed(5);
    $('.loc-lon').textContent = o.lon.toFixed(5);
    $('.loc-rotv').textContent = rot + '°';
    $('.loc-name').textContent = inPL(o.lat, o.lon) ? (placeName || T.unknown) : T.outside;
    range.value = String(rot);
    out.textContent = rot + '°';
    $('.loc-ok').disabled = !inPL(o.lat, o.lon);
  }

  // ---- reverse geocode after a move (debounced, one in flight)
  let revTimer = 0, revCtrl = null;
  function scheduleReverse() {
    placeName = '';
    $('.loc-name').textContent = T.locating;
    clearTimeout(revTimer); timers.delete(revTimer);
    revCtrl?.abort();
    revTimer = later(async () => {
      const o = origin();
      if (!inPL(o.lat, o.lon)) { renderInfo(); return; }
      revCtrl = new AbortController(); ctrls.add(revCtrl);
      const c = revCtrl;
      try {
        const r = await reverseName(o.lat, o.lon, lang, c.signal);
        if (!closed && c === revCtrl) { placeName = r.name; renderInfo(); }
      } catch (e) {
        if (e.name !== 'AbortError' && !closed) { placeName = ''; renderInfo(); }
      } finally { ctrls.delete(c); }
    }, 900);
  }

  // ---- footprint drawing
  function handleLatLng() {
    // outside the footprint: far edge is 21 m from the centre along -z, keep the handle >= 26 px beyond it
    const cp = map.latLngToLayerPoint([cLat, cLon]);
    const [eLat, eLon] = offsetLL(cLat, cLon, 0, PATCH.z1 - CENTRE_Z + 3);
    const edgePx = cp.distanceTo(map.latLngToLayerPoint([eLat, eLon]));
    const r = Math.max(HANDLE_PX, edgePx + 26);
    const b = rot * D2R;
    return map.layerPointToLatLng(L.point(cp.x + Math.sin(b) * r, cp.y - Math.cos(b) * r));
  }
  function draw() {
    if (!map) return;
    const o = origin();
    rect.setLatLngs(rectLL(o, PATCH));
    plot.setLatLngs(rectLL(o, PLOT));
    pin.setLatLng([cLat, cLon]);
    if (!hdl._loc_drag) hdl.setLatLng(handleLatLng());
    hline.setLatLngs([[cLat, cLon], hdl.getLatLng()]);
    renderInfo();
  }
  function setRot(r, reverse = false) { rot = norm360(r); draw(); if (reverse) scheduleReverse(); }
  function moveCentre(lat, lon, { pan = false, zoom = null } = {}) {
    cLat = Math.min(PL_BOUNDS[1][0], Math.max(PL_BOUNDS[0][0], lat));
    cLon = Math.min(PL_BOUNDS[1][1], Math.max(PL_BOUNDS[0][1], lon));
    draw();
    if (zoom != null) map.setView([cLat, cLon], zoom); else if (pan) map.panTo([cLat, cLon]);
    scheduleReverse();
  }

  // ---- search
  let typeTimer = 0, searchCtrl = null, results = [], sel = -1;
  function showResults(list, msg) {
    results = list; sel = -1;
    resUl.innerHTML = msg ? `<li class="loc-msg" role="presentation">${esc(msg)}</li>` :
      list.map((r, i) => `<li role="presentation"><button type="button" role="option" id="${uid}-o${i}" data-i="${i}" aria-selected="false">` +
        `<span class="loc-src">${esc(r.src)}</span>${esc(r.name)}<small>${esc(r.sub)}</small></button></li>`).join('');
    resUl.hidden = !msg && !list.length;
    input.setAttribute('aria-expanded', String(!resUl.hidden));
  }
  function hideResults() { resUl.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function mergeResults(a, b) {
    const outL = a.slice();
    for (const r of b) if (!outL.some((x) => Math.abs(x.lat - r.lat) < 0.01 && Math.abs(x.lon - r.lon) < 0.01)) outL.push(r);
    return outL.slice(0, 10);
  }
  async function doSearch(q, withOsm) {
    q = q.trim();
    if (q.length < 2) { hideResults(); return; }
    searchCtrl?.abort();
    const c = searchCtrl = new AbortController(); ctrls.add(c);
    showResults([], T.searching);
    let list = [], failed = 0;
    try {
      try { list = await uugSearch(q, c.signal); } catch (e) { if (e.name === 'AbortError') throw e; failed++; }
      if (withOsm || (!list.length && failed)) {
        try { list = mergeResults(list, await nominatimSearch(q, lang, c.signal)); } catch (e) { if (e.name === 'AbortError') throw e; failed++; }
      }
      if (closed || c !== searchCtrl) return;
      list = list.filter((r) => inPL(r.lat, r.lon));
      if (list.length) showResults(list);
      else showResults([], failed && !list.length ? T.searchErr : (withOsm ? T.none : T.none + '. ' + T.hintEnter));
    } catch (e) {
      if (e.name !== 'AbortError' && !closed) showResults([], T.searchErr);
    } finally { ctrls.delete(c); }
  }
  function pick(i) {
    const r = results[i];
    if (!r) return;
    hideResults();
    input.value = r.name;
    moveCentre(r.lat, r.lon, { zoom: Math.max(r.zoom || 15, 15) });
    // centre set; name from the search result is nicer than a reverse lookup of a town centre
    later(() => { if (!placeName) { placeName = r.name; renderInfo(); } }, 2500);
  }
  function highlight(i) {
    const btns = resUl.querySelectorAll('button[role=option]');
    if (!btns.length) return;
    sel = (i + btns.length) % btns.length;
    btns.forEach((b, k) => { b.classList.toggle('loc-on', k === sel); b.setAttribute('aria-selected', String(k === sel)); });
    input.setAttribute('aria-activedescendant', btns[sel].id);
    btns[sel].scrollIntoView({ block: 'nearest' });
  }
  input.addEventListener('input', () => {
    clearTimeout(typeTimer); timers.delete(typeTimer);
    const q = input.value;
    if (q.trim().length < 2) { searchCtrl?.abort(); hideResults(); return; }
    typeTimer = later(() => doSearch(q, false), 600);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(sel - 1); }
    else if (e.key === 'Enter' && sel >= 0 && !resUl.hidden) { e.preventDefault(); e.stopPropagation(); pick(sel); }
  });
  $('.loc-search').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(typeTimer); timers.delete(typeTimer);
    doSearch(input.value, true);
  });
  resUl.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) pick(+b.dataset.i); });
  root.addEventListener('pointerdown', (e) => { if (!e.target.closest('.loc-search')) hideResults(); });

  // ---- buttons
  $('.loc-x').addEventListener('click', () => close(null));
  $('.loc-cancel').addEventListener('click', () => close(null));
  $('.loc-ok').addEventListener('click', confirm);
  $('.loc-preset').addEventListener('click', () => {
    rot = norm360(def.rotDeg);
    const [la, lo] = centreFromOrigin({ lat: def.lat, lon: def.lon, rotDeg: rot });
    cLat = la; cLon = lo;
    if (map) { draw(); map.setView([cLat, cLon], 17); }
    placeName = def.name; renderInfo();
  });
  root.querySelectorAll('.loc-rot button').forEach((b) => b.addEventListener('click', () => setRot(rot + +b.dataset.d, false)));
  range.addEventListener('input', () => setRot(+range.value, false));
  $('.loc-plot').addEventListener('change', (e) => {
    showPlot = e.target.checked;
    if (map) { if (showPlot) plot.addTo(map); else plot.remove(); if (showPlot) map.fitBounds(plot.getBounds(), { padding: [40, 40], maxZoom: 17 }); }
  });
  root.querySelectorAll('.loc-seg button').forEach((b) => b.addEventListener('click', () => {
    if (!map) return;
    root.querySelectorAll('.loc-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    Object.entries(layers).forEach(([k, l]) => { if (k === b.dataset.l) l.addTo(map); else l.remove(); });
  }));

  function confirm() {
    const o = origin();
    if (!inPL(o.lat, o.lon)) return;
    close({ lat: +o.lat.toFixed(7), lon: +o.lon.toFixed(7), rotDeg: rot, name: placeName || `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}`, source: 'picker' });
  }

  // ---- keyboard: Esc cancels, Enter confirms, Tab trapped
  function focusables() {
    return [...dlg.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"]),a[href]')]
      .filter((el) => el.offsetParent !== null && !el.closest('[hidden]') && !el.closest('.leaflet-control-container'));
  }
  function onKey(e) {
    if (closed) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (!resUl.hidden) { hideResults(); input.focus(); return; }
      close(null);
    } else if (e.key === 'Enter') {
      const t = e.target;
      if (t === input || (t.tagName === 'BUTTON' && dlg.contains(t)) || t.tagName === 'A') return; // their own action
      e.preventDefault(); e.stopPropagation();
      confirm();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  renderInfo();
  input.focus();

  // ---- map
  try {
    L = await loadLeaflet();
  } catch (e) {
    if (!closed) mapEl.insertAdjacentHTML('beforeend', `<div class="loc-err">${esc(T.loadErr)}</div>`);
    return done;
  }
  if (closed) return done;
  const maxB = L.latLngBounds([PL_BOUNDS[0][0] - 0.6, PL_BOUNDS[0][1] - 1.2], [PL_BOUNDS[1][0] + 0.6, PL_BOUNDS[1][1] + 1.2]);
  map = L.map(mapEl, { zoomControl: true, attributionControl: true, maxBounds: maxB, maxBoundsViscosity: 0.8, minZoom: 6, maxZoom: 19,
    worldCopyJump: false, keyboard: true, zoomSnap: 1 });
  map.attributionControl.setPrefix(false);
  layers.orto = L.tileLayer(ORTO_URL, { maxZoom: 19, maxNativeZoom: 19, bounds: maxB, crossOrigin: false,
    attribution: 'Ortofotomapa &copy; <a href="https://www.geoportal.gov.pl" target="_blank" rel="noopener">GUGiK / Geoportal</a>' });
  layers.osm = L.tileLayer(OSM_URL, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' });
  layers.orto.addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.setView([cLat, cLon], 17);

  plot = L.polygon([], { color: '#d9ad57', weight: 2, opacity: 0.95, dashArray: '6 6', fillColor: '#d9ad57', fillOpacity: 0.08, interactive: false });
  rect = L.polygon([], { color: '#d9ad57', weight: 2, opacity: 1, fillColor: '#d9ad57', fillOpacity: 0.28, interactive: false }).addTo(map);
  hline = L.polyline([], { color: '#d9ad57', weight: 1.5, opacity: 0.85, dashArray: '3 4', interactive: false }).addTo(map);
  pin = L.marker([cLat, cLon], { draggable: true, keyboard: true, title: T.centre, alt: T.centre, zIndexOffset: 1000,
    icon: L.divIcon({ className: '', html: '<div class="loc-pin"></div>', iconSize: [0, 0] }) }).addTo(map);
  hdl = L.marker([cLat, cLon], { draggable: true, keyboard: true, title: T.handle, alt: T.handle, zIndexOffset: 900,
    icon: L.divIcon({ className: '', html: `<div class="loc-hdl">${SVG_ROT}</div>`, iconSize: [0, 0] }) }).addTo(map);
  [pin, hdl].forEach((m) => { const el = m.getElement(); if (el) { el.setAttribute('role', 'button'); el.setAttribute('aria-label', m.options.title); } });

  pin.on('drag', (e) => { const p = e.target.getLatLng(); cLat = p.lat; cLon = p.lng; draw(); });
  pin.on('dragend', () => { moveCentre(cLat, cLon); });
  hdl.on('dragstart', () => { hdl._loc_drag = true; });
  hdl.on('drag', (e) => {
    const c = map.latLngToLayerPoint([cLat, cLon]), h = map.latLngToLayerPoint(e.target.getLatLng());
    rot = norm360(Math.atan2(h.x - c.x, -(h.y - c.y)) / D2R);
    draw();
  });
  hdl.on('dragend', () => { hdl._loc_drag = false; draw(); scheduleReverse(); });
  // keyboard on the pin: arrows nudge 5 m; on the handle: arrows rotate
  pin.getElement()?.addEventListener('keydown', (e) => {
    const d = { ArrowUp: [0, 5], ArrowDown: [0, -5], ArrowLeft: [-5, 0], ArrowRight: [5, 0] }[e.key];
    if (!d) return; e.preventDefault(); e.stopPropagation();
    const [la, lo] = offsetLL(cLat, cLon, d[0], d[1]); moveCentre(la, lo, { pan: true });
  });
  hdl.getElement()?.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!d) return; e.preventDefault(); e.stopPropagation(); setRot(rot + d * (e.shiftKey ? 15 : 5));
  });
  map.on('click', (e) => { if (inPL(e.latlng.lat, e.latlng.lng)) moveCentre(e.latlng.lat, e.latlng.lng); });
  map.on('zoomend viewreset', draw);
  draw();
  if (!placeName) scheduleReverse(); else renderInfo();
  // the dialog may have resized while Leaflet loaded
  later(() => map && map.invalidateSize(), 50);

  // test hook (QA only, harmless): expose the live map
  root.__loc = { get map() { return map; }, get state() { return { cLat, cLon, rot, placeName, origin: origin() }; } };
  return done;
}
