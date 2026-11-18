// lib/sitedata.js — site report for agrivoltaics at any point in Poland (agent SITEDATA).
//
// Contract: init(ctx) -> { update(), setSite(site, opts?), loadEpsh(opts?), info(), suitability(lang), services, linkOnly, clearCache() }
//   Nothing runs at import / init: no request is made until setSite() is called.
//   ePSH fields (hydro.mhpUnit, hydro.yield, hydro.balance) are LINK ONLY: never fetched at runtime (ePSH answers
//   without CORS intermittently -> unsilenceable console error); they come back as { value:null, linkOnly:true, link }.
//   loadEpsh() is a no-op kept for compatibility. SoilGrids fields are fetched only when the soil map has no data.
//   setSite({lat, lon, name?}) : async. Aborts the previous run, queries ~20 open public services IN PARALLEL from the
//                                browser (each with its own timeout, default 8 s), caches the result per site rounded
//                                to 4 decimals (~10 m, memory + sessionStorage). Resolves with the report (= info()).
//                                opts.onProgress(report) is called after every service finishes (progressive UI).
//                                opts.force = true skips the cache.
//   info()                     : report object (also valid while loading, fields fill in as services answer):
//     { site:{lat,lon,name}, status:'idle'|'loading'|'ready'|'aborted', startedAt, ms,
//       fields: { key: Field }, groups: [{ id, label_pl, label_en, keys:[...] }],
//       timing: { serviceId: { ms, ok, error?, n? } }, errors: [ 'serviceId: msg' ], linkOnly: [...] }
//     Field = { value, unit, label_pl, label_en, source, link, confidence: 'high'|'medium'|'low', error?,
//               value_en? (English text when the value is a Polish description), raw? (machine value) }
//     value === null + error => the service failed or timed out (graceful: the rest of the report is still valid).
//     value === null, no error => the service answered but has no data at this point.
//   suitability(lang='pl')     : [{ key, level:'green'|'amber'|'red'|'grey', text }]; item 0 is key 'overall'
//                                (traffic light = worst of the others, grey = no data). Reads slope from
//                                ctx.terrain?.info?.().slopePct if that module exists (optional).
//
// Every endpoint used here at runtime was checked on 2026-11-18 with `Origin: http://localhost:8770`:
// it answers with Access-Control-Allow-Origin '*' or the reflected origin. Services without CORS are listed in
// LINK_ONLY (shown as links, never fetched). No keys, no cookies (credentials: 'omit').

const D2R = Math.PI / 180;
const TIMEOUT_MS = 8000;

// ------------------------------------------------------------------ geometry helpers
// Transverse Mercator forward (Snyder series), GRS80. PL-1992 = EPSG:2180 (lon0 19, k0 0.9993, FE 500000, FN -5300000).
function tm(lat, lon, lon0 = 19, k0 = 0.9993, FE = 500000, FN = -5300000) {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const p = lat * D2R, l = (lon - lon0) * D2R, s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = l * c;
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * p - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * p)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * p) - (35 * e6 / 3072) * Math.sin(6 * p));
  const x = FE + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = FN + k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x, y]; // [E, N]
}
export const to2180 = (lat, lon) => tm(lat, lon);

export function distM(lat1, lon1, lat2, lon2) {
  const dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dl / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// distance (m) from (lat,lon) to an Esri polygon {rings:[[[lon,lat],...]]} in EPSG:4326; 0 when inside
function distToRings(lat, lon, rings) {
  const kx = 111320 * Math.cos(lat * D2R), ky = 110540;
  let inside = false, best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = (r[i][0] - lon) * kx, yi = (r[i][1] - lat) * ky, xj = (r[j][0] - lon) * kx, yj = (r[j][1] - lat) * ky;
      if ((yi > 0) !== (yj > 0) && 0 < (xj - xi) * (0 - yi) / (yj - yi) + xi) inside = !inside;
      const dx = xj - xi, dy = yj - yi, L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(xi + u * dx, yi + u * dy));
    }
  }
  return inside ? 0 : best;
}

// ------------------------------------------------------------------ static tables
// IMGW-PIB synoptic stations (ids/names: danepubliczne.imgw.pl/api/data/synop; coordinates/elevation: WMO station
// metadata via Meteostat stations list, ~1' precision). 12001 (Baltic platform) left out.
const STATIONS = [
  ['12100', 'Kołobrzeg', 54.1833, 15.5833, 3], ['12105', 'Koszalin', 54.2, 16.15, 32], ['12115', 'Ustka', 54.5833, 16.8667, 6],
  ['12120', 'Łeba', 54.75, 17.5333, 2], ['12125', 'Lębork', 54.55, 17.75, 17], ['12135', 'Hel', 54.6, 18.8167, 1],
  ['12155', 'Gdańsk', 54.3333, 18.9333, 7], ['12160', 'Elbląg', 54.1667, 19.4333, 40], ['12185', 'Kętrzyn', 54.0667, 21.3667, 108],
  ['12195', 'Suwałki', 54.1333, 22.95, 184], ['12200', 'Świnoujście', 53.9167, 14.2333, 6], ['12205', 'Szczecin', 53.4, 14.6167, 1],
  ['12210', 'Resko', 53.7667, 15.4167, 52], ['12215', 'Szczecinek', 53.7167, 16.6833, 137], ['12230', 'Piła', 53.1333, 16.75, 72],
  ['12235', 'Chojnice', 53.7, 17.55, 172], ['12250', 'Toruń', 53.0333, 18.5833, 69], ['12270', 'Mława', 53.1, 20.35, 147],
  ['12272', 'Olsztyn', 53.7667, 20.4167, 133], ['12280', 'Mikołajki', 53.7833, 21.5833, 127], ['12285', 'Ostrołęka', 53.0833, 21.5667, 95],
  ['12295', 'Białystok', 53.1, 23.1667, 148], ['12300', 'Gorzów Wlkp.', 52.75, 15.2833, 72], ['12310', 'Słubice', 52.35, 14.6, 21],
  ['12330', 'Poznań', 52.4167, 16.8333, 86], ['12345', 'Koło', 52.2, 18.6667, 115], ['12360', 'Płock', 52.5833, 19.7333, 106],
  ['12375', 'Warszawa', 52.1667, 20.9667, 106], ['12385', 'Siedlce', 52.1833, 22.2667, 146], ['12399', 'Terespol', 52.0667, 23.6167, 133],
  ['12400', 'Zielona Góra', 51.9333, 15.5333, 192], ['12415', 'Legnica', 51.2, 16.2, 122], ['12418', 'Leszno', 51.8333, 16.5333, 91],
  ['12424', 'Wrocław', 51.1, 16.8833, 120], ['12435', 'Kalisz', 51.7333, 18.0833, 140], ['12455', 'Wieluń', 51.2167, 18.5667, 200],
  ['12465', 'Łódź', 51.7333, 19.4, 187], ['12469', 'Sulejów', 51.35, 19.8667, 188], ['12488', 'Kozienice', 51.5667, 21.55, 107],
  ['12495', 'Lublin', 51.2167, 22.4, 238], ['12497', 'Włodawa', 51.55, 23.5333, 177], ['12500', 'Jelenia Góra', 50.9, 15.8, 342],
  ['12510', 'Śnieżka', 50.7333, 15.7333, 1603], ['12520', 'Kłodzko', 50.4333, 16.6167, 356], ['12530', 'Opole', 50.6667, 17.9667, 176],
  ['12540', 'Racibórz', 50.05, 18.2, 205], ['12550', 'Częstochowa', 50.8167, 19.1, 293], ['12560', 'Katowice', 50.2333, 19.0333, 284],
  ['12566', 'Kraków', 50.0833, 19.8, 237], ['12570', 'Kielce', 50.8167, 20.7, 260], ['12575', 'Tarnów', 50.0333, 20.9833, 209],
  ['12580', 'Rzeszów', 50.1, 22.05, 200], ['12585', 'Sandomierz', 50.7, 21.7167, 217], ['12595', 'Zamość', 50.7, 23.25, 212],
  ['12600', 'Bielsko-Biała', 49.8, 19.0, 398], ['12625', 'Zakopane', 49.3, 19.95, 857], ['12650', 'Kasprowy Wierch', 49.2333, 19.9833, 1991],
  ['12660', 'Nowy Sącz', 49.6167, 20.7, 292], ['12670', 'Krosno', 49.7069, 21.7692, 330], ['12690', 'Lesko', 49.4667, 22.3333, 420],
  ['12695', 'Przemyśl', 49.8, 22.7667, 279],
];

// CORINE Land Cover nomenclature (EEA / GIOŚ)
const CLC = {
  111: ['Zabudowa miejska zwarta', 'Continuous urban fabric'], 112: ['Zabudowa miejska luźna', 'Discontinuous urban fabric'],
  121: ['Tereny przemysłowe lub handlowe', 'Industrial or commercial units'], 122: ['Tereny komunikacyjne', 'Road and rail networks'],
  123: ['Porty', 'Port areas'], 124: ['Lotniska', 'Airports'], 131: ['Eksploatacja odkrywkowa', 'Mineral extraction sites'],
  132: ['Zwałowiska i hałdy', 'Dump sites'], 133: ['Budowy', 'Construction sites'], 141: ['Miejskie tereny zielone', 'Green urban areas'],
  142: ['Tereny sportowe i wypoczynkowe', 'Sport and leisure facilities'],
  211: ['Grunty orne poza zasięgiem urządzeń nawadniających', 'Non-irrigated arable land'], 212: ['Grunty stale nawadniane', 'Permanently irrigated land'],
  213: ['Pola ryżowe', 'Rice fields'], 221: ['Winnice', 'Vineyards'], 222: ['Sady i plantacje', 'Fruit trees and berry plantations'],
  223: ['Gaje oliwne', 'Olive groves'], 231: ['Łąki i pastwiska', 'Pastures'], 241: ['Uprawy jednoroczne z trwałymi', 'Annual crops with permanent crops'],
  242: ['Złożone systemy upraw i działek', 'Complex cultivation patterns'],
  243: ['Tereny rolnicze z dużym udziałem roślinności naturalnej', 'Agriculture with significant natural vegetation'],
  244: ['Tereny rolno-leśne', 'Agro-forestry areas'], 311: ['Lasy liściaste', 'Broad-leaved forest'], 312: ['Lasy iglaste', 'Coniferous forest'],
  313: ['Lasy mieszane', 'Mixed forest'], 321: ['Murawy i pastwiska naturalne', 'Natural grasslands'], 322: ['Wrzosowiska i zarośla', 'Moors and heathland'],
  323: ['Roślinność sklerofilowa', 'Sclerophyllous vegetation'], 324: ['Lasy i roślinność krzewiasta w stanie zmian', 'Transitional woodland-shrub'],
  331: ['Plaże, wydmy, piaski', 'Beaches, dunes, sands'], 332: ['Odsłonięte skały', 'Bare rocks'], 333: ['Roślinność rozproszona', 'Sparsely vegetated areas'],
  334: ['Pogorzeliska', 'Burnt areas'], 335: ['Lodowce i wieczne śniegi', 'Glaciers and perpetual snow'], 411: ['Bagna śródlądowe', 'Inland marshes'],
  412: ['Torfowiska', 'Peat bogs'], 421: ['Bagna słone', 'Salt marshes'], 422: ['Saliny', 'Salines'], 423: ['Strefa pływów', 'Intertidal flats'],
  511: ['Cieki', 'Water courses'], 512: ['Zbiorniki wodne', 'Water bodies'], 521: ['Laguny przybrzeżne', 'Coastal lagoons'],
  522: ['Ujścia rzek', 'Estuaries'], 523: ['Morza i oceany', 'Sea and ocean'],
};

// Soil-agricultural map 1:5000 (IUNG, GUGiK) legend
const KOMPLEKS = {
  1: ['pszenny bardzo dobry', 'very good wheat', 'good'], 2: ['pszenny dobry', 'good wheat', 'good'], 3: ['pszenny wadliwy', 'defective wheat', 'medium'],
  4: ['żytni bardzo dobry', 'very good rye', 'good'], 5: ['żytni dobry', 'good rye', 'medium'], 6: ['żytni słaby', 'weak rye', 'weak'],
  7: ['żytni bardzo słaby', 'very weak rye', 'weak'], 8: ['zbożowo-pastewny mocny', 'strong cereal-fodder', 'medium'],
  9: ['zbożowo-pastewny słaby', 'weak cereal-fodder', 'weak'], 10: ['pszenny górski', 'mountain wheat', 'good'],
  11: ['zbożowy górski', 'mountain cereal', 'medium'], 12: ['owsiano-ziemniaczany górski', 'mountain oat-potato', 'weak'],
  13: ['owsiano-pastewny górski', 'mountain oat-fodder', 'weak'], 14: ['grunty orne przeznaczone pod użytki zielone', 'arable land suited to grassland', 'weak'],
  '1z': ['użytki zielone bardzo dobre i dobre', 'very good and good grassland', 'good'], '2z': ['użytki zielone średnie', 'medium grassland', 'medium'],
  '3z': ['użytki zielone słabe i bardzo słabe', 'poor grassland', 'weak'],
  Ls: ['las', 'forest', null], Tz: ['tereny zabudowane', 'built-up', null], N: ['nieużytki', 'wasteland', null], W: ['wody', 'water', null],
};
const SOILTYPE = [ // prefix match, longest first
  ['Bw', 'brunatna wyługowana', 'leached brown soil'], ['Bk', 'brunatna kwaśna', 'acid brown soil'], ['B', 'brunatna właściwa', 'brown soil (eutric)'],
  ['Dz', 'czarna ziemia zdegradowana', 'degraded black earth'], ['Dw', 'czarna ziemia wyługowana', 'leached black earth'], ['D', 'czarna ziemia', 'black earth'],
  ['A', 'bielicowa / płowa', 'podzolic / lessive soil'], ['C', 'czarnoziem', 'chernozem'], ['F', 'mada', 'alluvial soil (fluvisol)'],
  ['G', 'glejowa', 'gley soil'], ['M', 'murszowo-mineralna / murszowata', 'muck-mineral soil'], ['E', 'organiczno-mineralna (mułowo-/murszowo-torfowa)', 'organic-mineral (peaty muck)'],
  ['T', 'torfowa', 'peat soil'], ['R', 'rędzina', 'rendzina'],
];
const TEXTURE = { // soil-agri map texture codes; trailing 'p' = silty
  pl: ['piasek luźny', 'loose sand'], ps: ['piasek słabogliniasty', 'slightly loamy sand'], pgl: ['piasek gliniasty lekki', 'light loamy sand'],
  pgm: ['piasek gliniasty mocny', 'strong loamy sand'], gl: ['glina lekka', 'light loam'], gs: ['glina średnia', 'medium loam'],
  gc: ['glina ciężka', 'heavy loam'], i: ['ił', 'clay'], pł: ['pył', 'silt'], płz: ['pył zwykły', 'silt'], l: ['less', 'loess'],
  ż: ['żwir', 'gravel'], T: ['torf', 'peat'], mt: ['mursz torfowy', 'peaty muck'],
};
function decodeTexture(code) {
  if (!code) return null;
  if (TEXTURE[code]) return TEXTURE[code];
  if (code.endsWith('p') && TEXTURE[code.slice(0, -1)]) { const [p, e] = TEXTURE[code.slice(0, -1)]; return [p + ' pylasta', 'silty ' + e]; }
  return null;
}

const GEO_SYS = { Q: ['czwartorzęd', 'Quaternary'], Tr: ['trzeciorzęd (paleogen-neogen)', 'Tertiary (Paleogene-Neogene)'], Ng: ['neogen', 'Neogene'],
  Pg: ['paleogen', 'Paleogene'], M: ['miocen', 'Miocene'], Ol: ['oligocen', 'Oligocene'], Cr: ['kreda', 'Cretaceous'], J: ['jura', 'Jurassic'],
  T: ['trias', 'Triassic'], P: ['perm', 'Permian'], C: ['karbon', 'Carboniferous'], D: ['dewon', 'Devonian'] };
function decodeMhpStrat(sym) { // e.g. "bQII/Q" -> main level Q (II), lower level Q
  const parts = String(sym).replace(/^[a-z]+/, '').split('/');
  const one = (s) => { const m = /^(Tr|Ng|Pg|Ol|Cr|Q|M|J|T|P|C|D)([IV]*)/.exec(s || ''); if (!m) return null;
    const g = GEO_SYS[m[1]]; return [g[0] + (m[2] ? ' (' + m[2] + ')' : ''), g[1] + (m[2] ? ' (' + m[2] + ')' : '')]; };
  const a = one(parts[0]), b = one(parts[1]);
  if (!a) return null;
  return b ? [a[0] + ', niżej ' + b[0], a[1] + ', below ' + b[1]] : a;
}

// cadastral land classes (EGiB "klasoużytki"): R arable, Ł meadow, Ps pasture, Ls forest... rank 1 (best) .. 9
const CLASS_RANK = { I: 1, II: 2, IIIa: 3, IIIb: 4, III: 3.5, IVa: 5, IVb: 6, IV: 5.5, V: 7, VI: 8, VIz: 9 };
function parseCadClasses(s) {
  const out = [];
  for (const tok of String(s || '').split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(R|Ł|Ps|Ls|Lz|Br|Wsr|S|N|W|B|dr|Tk|Ti|Tp|K)[- ]?(VIz|VI|V|IVa|IVb|IV|IIIa|IIIb|III|II|I)?$/.exec(tok);
    if (m) out.push({ tok, use: m[1], cls: m[2] || null, rank: m[2] ? CLASS_RANK[m[2]] : null });
    else out.push({ tok, use: tok, cls: null, rank: null });
  }
  return out;
}

const MON = (ms) => { if (!ms) return null; const d = new Date(+ms); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
const r1 = (v) => Math.round(v * 10) / 10;
const kmTxt = (m) => (m < 1000 ? Math.round(m) + ' m' : r1(m / 1000) + ' km');

// ------------------------------------------------------------------ fields (labels, units)
const F = (label_pl, label_en, unit = null) => ({ label_pl, label_en, unit });
const FIELD_DEFS = {
  'admin.voivodeship': F('Województwo', 'Voivodeship'), 'admin.county': F('Powiat', 'County'), 'admin.commune': F('Gmina', 'Commune (gmina)'),
  'admin.precinct': F('Obręb ewidencyjny', 'Cadastral precinct'), 'admin.teryt': F('TERYT gminy', 'Commune TERYT code'),
  'admin.parcel': F('Działka ewidencyjna', 'Cadastral parcel'),
  'terrain.elevation': F('Wysokość terenu', 'Ground elevation', 'm n.p.m.'), 'terrain.slope': F('Nachylenie terenu', 'Terrain slope', '%'),
  'geo.lithology': F('Utwory powierzchniowe (SMGP 1:50 000)', 'Surface deposits (SMGP 1:50 000)'), 'geo.genesis': F('Geneza', 'Genesis'),
  'geo.age': F('Wiek (stratygrafia)', 'Age (stratigraphy)'), 'geo.sheet': F('Arkusz SMGP', 'SMGP map sheet'),
  'geo.regional': F('Geologia regionalna (MGP 1:500 000)', 'Regional geology (1:500 000)'),
  'geo.engineering': F('Warunki gruntowe (MGI 1:500 000)', 'Ground conditions (engineering geology 1:500 000)'),
  'geo.landslide': F('Osuwiska (SOPO)', 'Landslides (SOPO)'),
  'hydro.mhpUnit': F('Jednostka hydrogeologiczna MHP', 'MHP hydrogeological unit'), 'hydro.yield': F('Wydajność potencjalna studni (GUPW)', 'Potential well yield (main aquifer)', 'm³/h'),
  'hydro.waterTable': F('Zwierciadło wody gruntowej (najbliższy punkt monitoringu PSH)', 'Water table depth (nearest PSH monitoring well)', 'm p.p.t.'),
  'hydro.aquiferTop': F('Strop warstwy wodonośnej (najbliższy otwór monitoringu)', 'Aquifer top depth (nearest monitoring well)', 'm p.p.t.'),
  'hydro.wells': F('Studnie i otwory CBDH w promieniu 2 km', 'Water wells / boreholes (CBDH) within 2 km'),
  'hydro.gzwp': F('GZWP (główny zbiornik wód podziemnych)', 'Major groundwater basin (GZWP)'),
  'hydro.gzwpNearest': F('Najbliższy GZWP', 'Nearest GZWP', 'km'), 'hydro.jcwpd': F('JCWPd (jednolita część wód podziemnych)', 'Groundwater body (JCWPd)'),
  'hydro.balance': F('Obszar bilansowy, zasoby dyspozycyjne', 'Balance area, disposable resources', 'm³/d'),
  'hydro.gwFlood': F('Podtopienia (wody gruntowe)', 'Groundwater flooding area'),
  'soil.complex': F('Kompleks przydatności rolniczej', 'Agricultural suitability complex'), 'soil.type': F('Typ gleby', 'Soil type'),
  'soil.texture': F('Uziarnienie (mapa glebowo-rolnicza)', 'Texture (soil-agricultural map)'),
  'soil.cadastre': F('Klasy bonitacyjne działki (EGiB)', 'Cadastral soil classes of the parcel'),
  'soil.sand': F('Piasek 0-30 cm (SoilGrids)', 'Sand 0-30 cm (SoilGrids)', '%'), 'soil.silt': F('Pył 0-30 cm (SoilGrids)', 'Silt 0-30 cm (SoilGrids)', '%'),
  'soil.clay': F('Ił 0-30 cm (SoilGrids)', 'Clay 0-30 cm (SoilGrids)', '%'), 'soil.soc': F('Węgiel organiczny 0-30 cm', 'Organic carbon 0-30 cm', 'g/kg'),
  'soil.ph': F('pH (H₂O) 0-30 cm', 'pH (H₂O) 0-30 cm'),
  'lc.clc': F('Pokrycie terenu (CORINE 2018)', 'Land cover (CORINE 2018)'),
  'prot.np': F('Park narodowy', 'National park'), 'prot.reserve': F('Rezerwat przyrody', 'Nature reserve'), 'prot.n2k': F('Natura 2000', 'Natura 2000'),
  'prot.lp': F('Park krajobrazowy', 'Landscape park'), 'prot.ochk': F('Obszar chronionego krajobrazu', 'Protected landscape area'),
  'prot.n2kNearest': F('Najbliższy obszar Natura 2000', 'Nearest Natura 2000 site', 'km'),
  'flood.fluvial': F('Zagrożenie powodzią rzeczną (MZP)', 'River flood hazard (MZP)'), 'flood.sea': F('Zagrożenie powodzią od morza', 'Sea flood hazard'),
  'climate.station': F('Najbliższa stacja synoptyczna IMGW-PIB', 'Nearest IMGW-PIB synoptic station', 'km'),
  'climate.now': F('Pomiar bieżący na stacji', 'Latest observation at the station'),
};
const GROUPS = [
  ['admin', 'Lokalizacja', 'Location', ['admin.voivodeship', 'admin.county', 'admin.commune', 'admin.precinct', 'admin.teryt', 'admin.parcel']],
  ['terrain', 'Teren', 'Terrain', ['terrain.elevation', 'terrain.slope']],
  ['geology', 'Geologia', 'Geology', ['geo.lithology', 'geo.genesis', 'geo.age', 'geo.sheet', 'geo.regional', 'geo.engineering', 'geo.landslide']],
  ['hydro', 'Wody podziemne', 'Groundwater', ['hydro.mhpUnit', 'hydro.yield', 'hydro.waterTable', 'hydro.aquiferTop', 'hydro.wells', 'hydro.gzwp', 'hydro.gzwpNearest', 'hydro.jcwpd', 'hydro.balance', 'hydro.gwFlood']],
  ['soil', 'Gleba', 'Soil', ['soil.complex', 'soil.type', 'soil.texture', 'soil.cadastre', 'soil.sand', 'soil.silt', 'soil.clay', 'soil.soc', 'soil.ph']],
  ['landcover', 'Pokrycie terenu', 'Land cover', ['lc.clc']],
  ['protected', 'Ochrona przyrody', 'Nature protection', ['prot.np', 'prot.reserve', 'prot.n2k', 'prot.lp', 'prot.ochk', 'prot.n2kNearest']],
  ['flood', 'Powódź', 'Flood', ['flood.fluvial', 'flood.sea']],
  ['climate', 'Klimat', 'Climate', ['climate.station', 'climate.now']],
].map(([id, label_pl, label_en, keys]) => ({ id, label_pl, label_en, keys }));

// ------------------------------------------------------------------ endpoints
const PIG = 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/';
const EPSH_MHP = 'https://epsh.pgi.gov.pl/mhpgupw-kompozycja-wydajnosc-wms/service.svc/get';
const EPSH_BIL = 'https://epsh.pgi.gov.pl/zasoby-obbil-wms/service.svc/get';
const GUGIK_SOIL = 'https://mapy.geoportal.gov.pl/wss/service/pub/guest/MapaGlebowoRolnicza/MapServer/WMSServer';
const KIEG = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow';
const GDOS = 'https://sdi.gdos.gov.pl/wms';
const ISOK = 'https://wody.isok.gov.pl/wss/INSPIRE/INSPIRE_NZ_HY_MZPMRP_WMS';
const EEA_N2K = 'https://bio.discomap.eea.europa.eu/arcgis/rest/services/ProtectedSites/Natura2000Sites/MapServer/';
const EEA_CLC = 'https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC2018_WM/MapServer/identify';

const LINKS = {
  smgp: 'https://geologia.pgi.gov.pl/mapy/', smgpTxt: (n) => `https://bazadata.pgi.gov.pl/data/smgp/arkusze_txt/smgp${String(n).padStart(4, '0')}.pdf`,
  epsh: 'https://epsh.pgi.gov.pl/epsh/', jcwpd: (n) => `https://bazadata.pgi.gov.pl/data/hydro/jcwpd/jcwpd${n}.pdf`,
  geoportal: 'https://mapy.geoportal.gov.pl/imap/', parcel: (id) => `https://mapy.geoportal.gov.pl/mobile/?identifyParcel=${encodeURIComponent(id)}`,
  isok: 'https://wody.isok.gov.pl/imap_kzgw/?gpmap=gpMZP', gdos: 'https://geoserwis.gdos.gov.pl/mapy/',
  n2k: (c) => `https://natura2000.eea.europa.eu/Natura2000/SDF.aspx?site=${c}`, clc: 'https://land.copernicus.eu/en/products/corine-land-cover/clc2018',
  soilgrids: 'https://soilgrids.org/', imgw: 'https://danepubliczne.imgw.pl/', uldk: 'https://uldk.gugik.gov.pl/',
  sopo: 'https://geoportal.pgi.gov.pl/portal/page/portal/SOPO', psh: 'https://www.pgi.gov.pl/psh.html', nmt: 'https://www.geoportal.gov.pl/',
};

export const LINK_ONLY = [
  { id: 'mhp-text', label_pl: 'MHP 1:50 000 — objaśnienia arkusza (głębokość, miąższość, jakość, zagrożenie GUPW)', label_en: 'MHP 1:50 000 sheet text (depth, thickness, quality, vulnerability of the main aquifer)',
    url: 'https://epsh.pgi.gov.pl/epsh/', why: 'Atrybuty tylko w PDF (bazadata.pgi.gov.pl, Imperva); WMS ePSH podaje wyłącznie jednostkę i wydajność / attributes only in PDFs; the ePSH WMS returns unit + yield only' },
  { id: 'gzwp-wms', label_pl: 'ePSH GZWP WMS', label_en: 'ePSH GZWP WMS', url: 'https://epsh.pgi.gov.pl/gzwp-wms/service.svc/get', why: 'brak CORS / no CORS (ArcGIS REST PIG używany zamiast / PIG ArcGIS REST used instead)' },
  { id: 'iung-smsr', label_pl: 'IUNG-PIB System Monitoringu Suszy Rolniczej', label_en: 'IUNG-PIB agricultural drought monitoring', url: 'https://susza.iung.pulawy.pl/', why: 'brak CORS / no CORS' },
  { id: 'cbdg-api', label_pl: 'CBDG — karty otworów (profile)', label_en: 'CBDG borehole cards (profiles)', url: 'https://otworywiertnicze.pgi.gov.pl/', why: '403 dla obcego Origin, limit 429 / 403 on foreign Origin, rate-limited' },
  { id: 'imgw-archive', label_pl: 'IMGW-PIB archiwum danych pomiarowych', label_en: 'IMGW-PIB measurement archive', url: 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/', why: 'ZIP bez CORS / ZIP files, no CORS' },
  { id: 'mgsp', label_pl: 'Mapa geośrodowiskowa Polski 1:50 000', label_en: 'Geoenvironmental map of Poland 1:50 000', url: 'https://geoportal.pgi.gov.pl/', why: 'tylko teksty PDF / PDF texts only' },
  { id: 'mpzp', label_pl: 'Miejscowe plany (MPZP) — Krajowa Integracja MPZP', label_en: 'Local zoning plans (MPZP)', url: 'https://mapy.geoportal.gov.pl/imap/?gpmap=gp0', why: 'dane rastrowe gmin, brak atrybutów punktowych / raster per gmina, no point attributes' },
];

// ------------------------------------------------------------------ fetch helpers
function combineSignals(outer, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new DOMException('timeout ' + ms / 1000 + ' s', 'TimeoutError')), ms);
  const onAbort = () => ac.abort(outer.reason || new DOMException('aborted', 'AbortError'));
  if (outer) { if (outer.aborted) onAbort(); else outer.addEventListener('abort', onAbort, { once: true }); }
  return { signal: ac.signal, done: () => { clearTimeout(t); outer && outer.removeEventListener('abort', onAbort); } };
}
async function get(url, signal, kind = 'json') {
  const r = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (kind === 'text') return r.text();
  const j = await r.json();
  if (j && j.error) throw new Error('ArcGIS ' + (j.error.code || '') + ' ' + (j.error.message || ''));
  return j;
}
const sleep = (ms, sig) => new Promise((res, rej) => { const t = setTimeout(res, ms);
  sig?.addEventListener('abort', () => { clearTimeout(t); rej(sig.reason); }, { once: true }); });
// a few attempts with their own short timeouts (inside the outer signal); cache-busting param = new request
async function getRetry(url, sig, tries) {
  let last;
  for (let i = 0; i < tries.length; i++) {
    const { signal, done } = combineSignals(sig, tries[i]);
    try { return await get(url + (i ? '&_r=' + i : ''), signal); } catch (e) { last = e; if (sig.aborted) throw e; } finally { done(); }
  }
  throw last;
}
const qs = (o) => new URLSearchParams(o).toString();
const arcQuery = (path, lat, lon, extra = {}) => PIG + path + '/query?' + qs({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: 4326,
  spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false', f: 'json', ...extra });
// WMS 1.3.0 GetFeatureInfo at the point: EPSG:4326/4258 axis order is lat,lon; 101x101 px, centre pixel
function gfiUrl(base, layers, lat, lon, fmt, { half = 0.0005, crs = 'EPSG:4326', extra = {} } = {}) {
  return base + '?' + qs({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: layers, QUERY_LAYERS: layers, STYLES: '',
    CRS: crs, BBOX: [lat - half, lon - half, lat + half, lon + half].join(','), WIDTH: 101, HEIGHT: 101, I: 50, J: 50,
    INFO_FORMAT: fmt, FEATURE_COUNT: 20, ...extra });
}
// GeoServer text/plain GetFeatureInfo -> [{type, props}]
function parseGeoserverPlain(txt) {
  const out = []; let cur = null, type = '';
  for (const line of txt.split('\n')) {
    const mt = /^Results for FeatureType '([^']+)'/.exec(line);
    if (mt) { type = mt[1]; continue; }
    if (/^-{10,}/.test(line)) { if (cur && Object.keys(cur).length) out.push({ type, props: cur }); cur = {}; continue; }
    const m = /^([^=]+?) = (.*)$/.exec(line);
    if (m && cur) cur[m[1].trim()] = m[2].trim();
  }
  if (cur && Object.keys(cur).length) out.push({ type, props: cur });
  return out;
}
// Intergraph (ePSH) text/xml GetFeatureInfo -> [{layer, attrs}]
function parseIntergraphXml(txt) {
  const doc = new DOMParser().parseFromString(txt, 'text/xml');
  return [...doc.getElementsByTagNameNS('*', 'Layer')].map((L) => {
    const attrs = {};
    for (const a of L.getElementsByTagNameNS('*', 'Attribute')) attrs[a.getAttribute('Name')] = a.textContent;
    return { layer: L.getAttribute('Name'), attrs };
  });
}

// ------------------------------------------------------------------ services
// Each: { id, label, host, keys: [field keys it fills], timeout?, run(lat, lon, signal) -> { key: partialField } }
const S = (o) => o;
const SERVICES = [
  S({ id: 'uldk', label: 'GUGiK ULDK (PRG)', keys: ['admin.voivodeship', 'admin.county', 'admin.commune', 'admin.precinct', 'admin.teryt'],
    async run(lat, lon, sig) {
      const t = await get('https://uldk.gugik.gov.pl/?' + qs({ request: 'GetRegionByXY', xy: `${lon},${lat},4326`, result: 'teryt,region,commune,county,voivodeship' }), sig, 'text');
      const lines = t.trim().split('\n');
      if (lines[0].trim() !== '0' || !lines[1]) return { _empty: lines.join(' ').slice(0, 120) };
      const [teryt, region, commune, county, voiv] = lines[1].split('|');
      const src = 'GUGiK ULDK (PRG, EGiB)', link = LINKS.uldk, c = 'high';
      const gm = teryt.split('.')[0];
      const typ = { 1: 'gmina miejska', 2: 'gmina wiejska', 3: 'gmina miejsko-wiejska', 4: 'miasto w gm. miejsko-wiejskiej', 5: 'obszar wiejski gm. miejsko-wiejskiej', 8: 'dzielnica', 9: 'delegatura' }[gm.split('_')[1]];
      const typEn = { 1: 'urban', 2: 'rural', 3: 'urban-rural', 4: 'town in urban-rural', 5: 'rural part of urban-rural', 8: 'district', 9: 'delegation' }[gm.split('_')[1]];
      return {
        'admin.voivodeship': { value: voiv, source: src, link, confidence: c },
        'admin.county': { value: county, source: src, link, confidence: c },
        'admin.commune': { value: commune + (typ ? ` (${typ})` : ''), value_en: commune + (typEn ? ` (${typEn})` : ''), source: src, link, confidence: c },
        'admin.precinct': { value: region, source: src, link, confidence: c },
        'admin.teryt': { value: gm, raw: teryt, source: src, link, confidence: c },
      };
    } }),
  S({ id: 'kieg', label: 'GUGiK KIEG (EGiB)', keys: ['admin.parcel', 'soil.cadastre'],
    async run(lat, lon, sig) {
      const html = await get(gfiUrl(KIEG, 'dzialki', lat, lon, 'text/html', { half: 0.0001 }), sig, 'text');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const row = {};
      for (const tr of doc.querySelectorAll('table.getfeatureinfo-egib tr')) { const td = tr.querySelectorAll('td'); if (td.length >= 2) row[td[0].textContent.trim()] = td[1].textContent.trim(); }
      const id = row['Identyfikator działki'];
      if (!id) return {};
      const area = parseFloat(row['Pole pow. w ewidencji gruntów (ha)']);
      const kont = row['Oznaczenie konturu'] || '', uz = row['Oznaczenie użytku'] || '';
      const cls = parseCadClasses(kont || uz);
      const src = 'GUGiK Krajowa Integracja Ewidencji Gruntów (starostwa)';
      return {
        'admin.parcel': { value: id + (isFinite(area) ? ` (${area} ha)` : ''), raw: { id, areaHa: isFinite(area) ? area : null, group: row['Grupa rejestrowa'] }, source: src, link: LINKS.parcel(id), confidence: 'high' },
        'soil.cadastre': { value: kont || uz || null, raw: cls, source: src + ' — kontury klasyfikacyjne działki', link: LINKS.parcel(id), confidence: kont ? 'high' : 'low',
          note: kont ? undefined : 'starostwo nie publikuje konturów / county does not publish contours' },
      };
    } }),
  S({ id: 'nmt', label: 'GUGiK NMT (wysokość)', keys: ['terrain.elevation'],
    async run(lat, lon, sig) {
      const [E, N] = to2180(lat, lon);
      try {
        const t = await get(`https://services.gugik.gov.pl/nmt/?request=GetHbyXY&x=${N.toFixed(2)}&y=${E.toFixed(2)}`, sig, 'text');
        const h = parseFloat(t);
        if (isFinite(h)) return { 'terrain.elevation': { value: r1(h), raw: h, source: 'GUGiK NMT (PL-EVRF2007-NH)', link: LINKS.nmt, confidence: 'high' } };
      } catch (e) { if (sig.aborted) throw e; }
      const j = await get(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, sig);
      const h = j.elevation && j.elevation[0];
      return { 'terrain.elevation': { value: isFinite(h) ? r1(h) : null, raw: h, source: 'Open-Meteo elevation (Copernicus DEM 90 m)', link: 'https://open-meteo.com/en/docs/elevation-api', confidence: 'medium' } };
    } }),
  S({ id: 'smgp50k', label: 'PIG-PIB SMGP 1:50 000', keys: ['geo.lithology', 'geo.genesis', 'geo.age', 'geo.sheet'],
    async run(lat, lon, sig) {
      const [u, s] = await Promise.all([get(arcQuery('kartografia/smgp50k/MapServer/5', lat, lon), sig),
        get(arcQuery('kartografia/smgp50k/MapServer/0', lat, lon, { outFields: 'NR_ARK,NAZWA,AUTOR_ARK,ROK_DRUK_ARK' }), sig)]);
      const a = u.features?.[0]?.attributes, sh = s.features?.[0]?.attributes;
      const src = 'PIG-PIB, Szczegółowa mapa geologiczna Polski 1:50 000';
      const link = sh ? LINKS.smgpTxt(sh.NR_ARK) : LINKS.smgp;
      const out = {
        'geo.sheet': sh ? { value: `${sh.NR_ARK} ${sh.NAZWA}` + (sh.ROK_DRUK_ARK ? ` (${sh.ROK_DRUK_ARK})` : ''), raw: sh, source: src, link, confidence: 'high' }
          : { value: null, source: src, link: LINKS.smgp, confidence: 'high', note: 'brak arkusza / no sheet' },
      };
      if (a) {
        const strip = (v) => (v && v.trim() ? v.trim() : null);
        out['geo.lithology'] = { value: strip(a.NAZWA), raw: a, source: src, link, confidence: 'high' };
        out['geo.genesis'] = { value: strip(a.GENEZA) + (strip(a.FORMA) ? ', ' + a.FORMA.trim() : ''), source: src, link, confidence: 'high' };
        out['geo.age'] = { value: strip(a.WIEK_OPIS), source: src, link, confidence: 'high' };
      } else {
        const note = sh ? 'arkusz bez wektorowej treści w usłudze / sheet not vectorised in the service' : 'brak arkusza 1:50 000 / no 1:50 000 sheet';
        for (const k of ['geo.lithology', 'geo.genesis', 'geo.age']) out[k] = { value: null, source: src, link, confidence: 'high', note };
      }
      return out;
    } }),
  S({ id: 'mgp500k', label: 'PIG-PIB MGP 1:500 000', keys: ['geo.regional'],
    // this service stalls when it arrives in the same burst as the other cbdgmapa calls (fast when alone):
    // start it 1.2 s later and retry once with a fresh request
    async run(lat, lon, sig) {
      await sleep(1200, sig);
      const u = arcQuery('kartografia/mgp500k/MapServer/0', lat, lon, { outFields: 'LEGE_PL,LEGE_EN,STRAT_OD,STRAT_DO,STRAT_EN_OD,STRAT_EN_DO' });
      const j = await getRetry(u, sig, [3000, 3500]);
      const a = j.features?.[0]?.attributes;
      if (!a) return {};
      const st = (x, y) => [x, y].filter((v) => v && v.trim()).join(' – ');
      return { 'geo.regional': { value: `${a.LEGE_PL} (${st(a.STRAT_OD, a.STRAT_DO)})`, value_en: `${a.LEGE_EN} (${st(a.STRAT_EN_OD, a.STRAT_EN_DO)})`,
        raw: a, source: 'PIG-PIB, Mapa geologiczna Polski 1:500 000', link: LINKS.smgp, confidence: 'medium' } };
    } }),
  S({ id: 'mgip500k', label: 'PIG-PIB MGI 1:500 000 + SOPO', keys: ['geo.engineering', 'geo.landslide'],
    async run(lat, lon, sig) {
      const d = 0.01;
      const [g, so] = await Promise.all([get(arcQuery('geoinz/mgip500k/MapServer/15', lat, lon), sig),
        get(PIG + 'geozagrozenia/sopo_obszary/MapServer/identify?' + qs({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', sr: 4326,
          layers: 'all:14,12', tolerance: 2, mapExtent: [lon - d, lat - d, lon + d, lat + d].join(','), imageDisplay: '400,400,96', returnGeometry: 'false', f: 'json' }), sig)]);
      const a = g.features?.[0]?.attributes;
      const out = {};
      if (a) out['geo.engineering'] = { value: `${a.NR} ${a.OBSZAR}: ${a.OPIS}`, value_en: `${a.NR} ${a.AREAS}: ${a.DESCRIPTION || ''}`.trim(), raw: { nr: a.NR, area: a.OBSZAR },
        source: 'PIG-PIB, Mapa geologiczno-inżynierska Polski 1:500 000 (1994)', link: LINKS.smgp, confidence: 'low' };
      const res = so.results || [];
      const slide = res.find((r) => r.layerId === 14), zone = res.find((r) => r.layerId === 12);
      out['geo.landslide'] = { value: slide ? 'osuwisko' : zone ? 'teren zagrożony ruchami masowymi' : 'brak w SOPO',
        value_en: slide ? 'landslide' : zone ? 'area at risk of mass movements' : 'none mapped in SOPO', raw: slide ? 'slide' : zone ? 'zone' : 'none',
        source: 'PIG-PIB, System Osłony Przeciwosuwiskowej (SOPO)', link: LINKS.sopo, confidence: slide || zone ? 'high' : 'medium' };
      return out;
    } }),
  S({ id: 'mhp', epsh: true, label: 'PIG-PIB ePSH MHP GUPW (WMS)', keys: ['hydro.mhpUnit', 'hydro.yield'],
    async run(lat, lon, sig) {
      const L = ['Wydajność_potencjalna__10', 'Wydajność_potencjalna_10-30', 'Wydajność_potencjalna_30-50', 'Wydajność_potencjalna_50-70',
        'Wydajność_potencjalna__70', 'Brak_GUPW', 'Jednostka_hydrogeologiczna', 'Numer_arkusza_MhP'].join(',');
      // the Intergraph service answers only at small scales: 0.01 deg box / 101 px (~11 m per pixel)
      const xml = await get(gfiUrl(EPSH_MHP, L, lat, lon, 'text/xml', { half: 0.005 }), sig, 'text');
      const items = parseIntergraphXml(xml);
      const unit = items.find((i) => i.layer === 'Jednostka_hydrogeologiczna')?.attrs;
      const y = items.find((i) => i.layer.startsWith('Wydajność'))?.attrs;
      const none = items.find((i) => i.layer === 'Brak_GUPW');
      const src = 'PIG-PIB / PSH, Mapa hydrogeologiczna Polski 1:50 000 — GUPW (ePSH)', link = LINKS.epsh;
      const out = {};
      if (unit) {
        const dec = decodeMhpStrat(unit.SYMBOL);
        out['hydro.mhpUnit'] = { value: `${unit.NR_NA_MAPIE} ${unit.SYMBOL} (arkusz MHP ${unit.NR_MAPY})` + (dec ? ` — ${dec[0]}` : ''),
          value_en: `${unit.NR_NA_MAPIE} ${unit.SYMBOL} (MHP sheet ${unit.NR_MAPY})` + (dec ? ` — ${dec[1]}` : ''), raw: unit, source: src, link, confidence: 'medium' };
      } else out['hydro.mhpUnit'] = { value: null, source: src, link, confidence: 'medium' };
      if (y) {
        const v = y.WYDAJNOSC; const m = /(\d+)\D+(\d+)/.exec(v);
        out['hydro.yield'] = { value: v, raw: m ? [+m[1], +m[2]] : v.startsWith('>') ? [+v.slice(1), null] : v.startsWith('<') ? [0, +v.slice(1)] : v,
          source: src, link, confidence: 'medium' };
      } else out['hydro.yield'] = { value: none ? 'brak GUPW' : null, value_en: none ? 'no main usable aquifer' : null, raw: none ? [0, 0] : null, source: src, link, confidence: 'medium' };
      return out;
    } }),
  S({ id: 'mwp', label: 'PIG-PIB PSH monitoring (MWP)', keys: ['hydro.waterTable', 'hydro.aquiferTop'],
    async run(lat, lon, sig) {
      const j = await get(arcQuery('hydrogeologia/mwp/MapServer/0', lat, lon, { distance: 25000, units: 'esriSRUnit_Meter', returnGeometry: 'true', outSR: 4326,
        outFields: 'NR_PKT_MONIT_ILOSC,MIEJSCOWOSC,CHARAKTER_PUNKTU,RODZAJ_OTWORU,AKTUALNIE_OBSERWOWANY,RZEDNA_TERENU,GLEBOKOSC_OTWORU,GLEBOKOSC_W_OD,GLEBOKOSC_W_DO,ZWIERCIADLO_SWOBODNE,LITOLOGIA,DATA_POMIARU,GLEBOKOSC_ZWIERCIADLA' }), sig);
      const pts = (j.features || []).map((f) => ({ ...f.attributes, d: distM(lat, lon, f.geometry.y, f.geometry.x) })).sort((a, b) => a.d - b.d);
      const src = 'PIG-PIB / PSH, monitoring wód podziemnych (MWP)', link = LINKS.psh;
      const free = pts.find((p) => p.CHARAKTER_PUNKTU === 'Zwierciadło swobodne' && p.GLEBOKOSC_ZWIERCIADLA != null);
      const top = pts.find((p) => p.GLEBOKOSC_W_OD != null);
      const name = (p) => `${p.MIEJSCOWOSC} ${p.NR_PKT_MONIT_ILOSC && p.NR_PKT_MONIT_ILOSC !== '__' ? p.NR_PKT_MONIT_ILOSC.replace(/_/g, '/') : ''}`.trim();
      const conf = (d) => (d < 3000 ? 'medium' : 'low');
      return {
        'hydro.waterTable': free ? { value: free.GLEBOKOSC_ZWIERCIADLA, raw: { depth: free.GLEBOKOSC_ZWIERCIADLA, date: MON(free.DATA_POMIARU), distM: Math.round(free.d), point: name(free), lith: free.LITOLOGIA },
          detail: `${name(free)}, ${kmTxt(free.d)}, ${MON(free.DATA_POMIARU) || '?'}`, source: src, link, confidence: conf(free.d) }
          : { value: null, source: src, link, confidence: 'low', note: 'brak punktu ze zwierciadłem swobodnym w 25 km / no unconfined well within 25 km' },
        'hydro.aquiferTop': top ? { value: top.GLEBOKOSC_W_OD, raw: { from: top.GLEBOKOSC_W_OD, to: top.GLEBOKOSC_W_DO, distM: Math.round(top.d), point: name(top), type: top.CHARAKTER_PUNKTU },
          detail: `${top.GLEBOKOSC_W_OD}–${top.GLEBOKOSC_W_DO ?? '?'} m, ${top.CHARAKTER_PUNKTU || ''}, ${name(top)}, ${kmTxt(top.d)}`, source: src, link, confidence: conf(top.d) }
          : { value: null, source: src, link, confidence: 'low' },
      };
    } }),
  S({ id: 'cbdh', label: 'PIG-PIB CBDH otwory', keys: ['hydro.wells'],
    async run(lat, lon, sig) {
      const j = await get(arcQuery('hydrogeologia/cbdh_otwory/MapServer/0', lat, lon, { distance: 2000, units: 'esriSRUnit_Meter', returnGeometry: 'true', outSR: 4326,
        outFields: 'NAZWA,GLEBOKOSC,STRATYGRAFIA_NA_DNIE,PRZEZNACZENIE_OTWORU,MIEJSCOWOSC,ZLIKWIDOWANY' }), sig);
      const w = (j.features || []).map((f) => ({ ...f.attributes, d: distM(lat, lon, f.geometry.y, f.geometry.x) })).sort((a, b) => a.d - b.d);
      const src = 'PIG-PIB, Centralny Bank Danych Hydrogeologicznych (CBDH)';
      if (!w.length) return { 'hydro.wells': { value: 0, unit: 'szt.', detail: 'brak otworów w 2 km / none within 2 km', raw: { n: 0 }, source: src, link: LINKS.epsh, confidence: 'medium' } };
      const dep = w.map((x) => x.GLEBOKOSC).filter((x) => x > 0).sort((a, b) => a - b);
      const med = dep.length ? dep[dep.length >> 1] : null, n = w[0];
      return { 'hydro.wells': { value: w.length, unit: 'szt.', raw: { n: w.length, medianDepth: med, minDepth: dep[0], maxDepth: dep[dep.length - 1], nearest: { name: n.NAZWA, depth: n.GLEBOKOSC, distM: Math.round(n.d), strat: n.STRATYGRAFIA_NA_DNIE } },
        detail: `głęb. ${dep[0] ?? '?'}–${dep[dep.length - 1] ?? '?'} m (mediana ${med ?? '?'} m); najbliższy: ${n.NAZWA} ${n.GLEBOKOSC ?? '?'} m, ${kmTxt(n.d)}`,
        detail_en: `depth ${dep[0] ?? '?'}–${dep[dep.length - 1] ?? '?'} m (median ${med ?? '?'} m); nearest: ${n.NAZWA} ${n.GLEBOKOSC ?? '?'} m, ${kmTxt(n.d)}`,
        source: src, link: LINKS.epsh, confidence: 'medium' } };
    } }),
  S({ id: 'gzwp', label: 'PIG-PIB GZWP', keys: ['hydro.gzwp', 'hydro.gzwpNearest'],
    async run(lat, lon, sig) {
      const of = 'NR_GZWP,NAZWA,POW_KM2,STRATYGRAFIA,TYP_OSRODKA,GL_SR_M,GL_OD_M,GL_DO_M';
      const [inP, near] = await Promise.all([get(arcQuery('hydrogeologia/gzwp/MapServer/0', lat, lon, { outFields: of }), sig),
        get(arcQuery('hydrogeologia/gzwp/MapServer/0', lat, lon, { outFields: of, distance: 60000, units: 'esriSRUnit_Meter', returnGeometry: 'true', outSR: 4326, maxAllowableOffset: 0.002, geometryPrecision: 4 }), sig)]);
      const src = 'PIG-PIB / PSH, GZWP (udokumentowane)', link = LINKS.epsh;
      const a = inP.features?.[0]?.attributes;
      const out = { 'hydro.gzwp': a ? { value: `GZWP ${a.NR_GZWP} ${a.NAZWA}`, raw: a, detail: [a.STRATYGRAFIA, a.TYP_OSRODKA, a.GL_SR_M > 0 ? `głęb. śr. ${a.GL_SR_M} m` : null, a.GL_DO_M > 0 ? `${a.GL_OD_M ?? '?'}–${a.GL_DO_M} m` : null,
          a.POW_KM2 ? Math.round(a.POW_KM2) + ' km²' : null].filter(Boolean).join(', '),
        source: src, link, confidence: 'high' } : { value: 'poza GZWP', value_en: 'outside any GZWP', raw: null, source: src, link, confidence: 'high' } };
      const ds = (near.features || []).map((f) => ({ ...f.attributes, d: distToRings(lat, lon, f.geometry?.rings || []) })).filter((x) => !a || x.NR_GZWP !== a.NR_GZWP).sort((x, y) => x.d - y.d);
      const n = ds[0];
      out['hydro.gzwpNearest'] = n ? { value: r1(n.d / 1000), raw: { nr: n.NR_GZWP, name: n.NAZWA, distM: Math.round(n.d) }, detail: `GZWP ${n.NR_GZWP} ${n.NAZWA}` + (a ? ' (inny niż bieżący / other than the current one)' : ''),
        source: src, link, confidence: 'medium' } : { value: null, detail: 'brak w 60 km / none within 60 km', source: src, link, confidence: 'medium' };
      return out;
    } }),
  S({ id: 'jcwpd', label: 'PIG-PIB JCWPd 2028-2033', keys: ['hydro.jcwpd'],
    async run(lat, lon, sig) {
      const j = await get(arcQuery('hydrogeologia/jcwpd/MapServer/5', lat, lon), sig);
      const a = j.features?.[0]?.attributes;
      if (!a) return {};
      return { 'hydro.jcwpd': { value: `JCWPd ${a.NR_JCWPD} (${a.KOD_UE})`, raw: a,
        detail: `${a.DORZECZE}, stan ogólny 2022: ${a.STAN_OGOLNY_2022} (chem. ${a.STAN_CHEMICZNY_2022}, ilośc. ${a.STAN_ILOSCIOWY_2022}), ryzyko 2025: ${a.RYZYKO_2025}`,
        source: 'PIG-PIB / PSH, JCWPd cykl 2028-2033', link: LINKS.jcwpd(a.NR_JCWPD), confidence: 'high' } };
    } }),
  S({ id: 'obbil', epsh: true, label: 'PIG-PIB ePSH obszary bilansowe', keys: ['hydro.balance'],
    async run(lat, lon, sig) {
      const it = parseIntergraphXml(await get(gfiUrl(EPSH_BIL, 'Obszary_bilansowe', lat, lon, 'text/xml', { half: 0.005 }), sig, 'text'))[0]?.attrs;
      if (!it) return {};
      return { 'hydro.balance': { value: +it.ZASOBY_DYSPOZYCYJNE, raw: it, detail: `${it.OZNACZENIE_OBBIL} ${it.NAZWA_OBBIL}, ${it.POWIERZCHNIA} km², stan na ${it.STAN_NA}`,
        source: 'PIG-PIB / PSH, obszary bilansowe (ePSH)', link: LINKS.epsh, confidence: 'high' } };
    } }),
  S({ id: 'podtopienia', label: 'PIG-PIB podtopienia', keys: ['hydro.gwFlood'],
    async run(lat, lon, sig) {
      const a = (await get(arcQuery('hydrogeologia/podtopienia/MapServer/0', lat, lon), sig)).features?.[0]?.attributes;
      return { 'hydro.gwFlood': { value: a ? 'tak — ' + a.OPIS : 'nie', value_en: a ? 'yes — ' + a.DESCRIPT : 'no', raw: !!a,
        source: 'PIG-PIB / PSH, obszary zagrożone podtopieniami', link: LINKS.epsh, confidence: 'medium' } };
    } }),
  S({ id: 'soilmap', label: 'GUGiK mapa glebowo-rolnicza', keys: ['soil.complex', 'soil.type', 'soil.texture'],
    async run(lat, lon, sig) {
      const j = await get(gfiUrl(GUGIK_SOIL, '0', lat, lon, 'application/geo+json', { half: 0.0002 }), sig);
      const p = j.features?.[0]?.properties;
      const src = 'IUNG-PIB / GUGiK, mapa glebowo-rolnicza 1:5 000 (Mgr5000)', link = LINKS.geoportal;
      if (!p) return {};
      const nn = (v) => (v && v !== 'Null' && v !== 'missing' ? v : null);
      const k = nn(p.KOMPLEKS), kd = k && KOMPLEKS[k];
      const t = nn(p.TYPPODTYP), td = t && SOILTYPE.find(([c]) => t.startsWith(c));
      const tex = [1, 2, 3, 4, 5].map((i) => nn(p['PODLOZE' + i])).filter(Boolean);
      const texDec = tex.map((c) => decodeTexture(c));
      const conf = 'medium'; // vectorised 1950s-80s sheets
      return {
        'soil.complex': { value: k ? `${k} — ${kd ? kd[0] : '?'}` : null, value_en: k ? `${k} — ${kd ? kd[1] : '?'}` : null, raw: { code: k, quality: kd ? kd[2] : null },
          source: src, link, confidence: conf, note: nn(p.UWAGI) || undefined },
        'soil.type': { value: t ? `${t} — ${td ? td[1] : '?'}` : null, value_en: t ? `${t} — ${td ? td[2] : '?'}` : null, raw: t, source: src, link, confidence: conf },
        'soil.texture': { value: tex.length ? tex.map((c, i) => c + (texDec[i] ? ` (${texDec[i][0]})` : '')).join(' / ') : null,
          value_en: tex.length ? tex.map((c, i) => c + (texDec[i] ? ` (${texDec[i][1]})` : '')).join(' / ') : null, raw: tex, source: src, link, confidence: conf },
      };
    } }),
  // SoilGrids (global model, 250 m) only where the Polish soil map has nothing: it is slow and sometimes resets the
  // connection (unsilenceable console error), so it is not called when the authoritative map answered.
  S({ id: 'soilgrids', label: 'ISRIC SoilGrids 2.0', keys: ['soil.sand', 'soil.silt', 'soil.clay', 'soil.soc', 'soil.ph'], timeout: 12000,
    link: 'https://soilgrids.org/', fallback: { when: (r) => r.fields['soil.complex'].value == null && r.fields['soil.type'].value == null,
      note: 'nie pobierano: jest mapa glebowo-rolnicza / not fetched: soil-agricultural map available' },
    async run(lat, lon, sig) {
      const u = 'https://rest.isric.org/soilgrids/v2.0/properties/query?' + [`lon=${lon.toFixed(5)}`, `lat=${lat.toFixed(5)}`,
        ...['sand', 'silt', 'clay', 'soc', 'phh2o'].map((p) => 'property=' + p), ...['0-5cm', '5-15cm', '15-30cm'].map((d) => 'depth=' + d), 'value=mean'].join('&');
      const j = await get(u, sig);
      const W = { '0-5cm': 5, '5-15cm': 10, '15-30cm': 15 };
      const v = {};
      for (const L of j.properties?.layers || []) {
        let s = 0, w = 0;
        for (const d of L.depths) { const m = d.values?.mean; if (m != null) { s += m * W[d.label]; w += W[d.label]; } }
        v[L.name] = w ? s / w / (L.unit_measure?.d_factor || 1) : null;
      }
      const src = 'ISRIC SoilGrids 2.0 (250 m, model, CC BY 4.0)', link = LINKS.soilgrids, c = 'low';
      const f = (x, k = 1) => (x == null ? null : Math.round(x * k * 10) / 10);
      return { // mapped value / d_factor = target units (sand/silt/clay %, soc g/kg, pH)
        'soil.sand': { value: f(v.sand), source: src, link, confidence: c }, 'soil.silt': { value: f(v.silt), source: src, link, confidence: c },
        'soil.clay': { value: f(v.clay), source: src, link, confidence: c }, 'soil.soc': { value: f(v.soc), source: src, link, confidence: c },
        'soil.ph': { value: f(v.phh2o), source: src, link, confidence: c },
      };
    } }),
  S({ id: 'clc', label: 'EEA CORINE Land Cover 2018', keys: ['lc.clc'],
    async run(lat, lon, sig) {
      const d = 0.005;
      const j = await get(EEA_CLC + '?' + qs({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', sr: 4326, layers: 'all:0', tolerance: 0,
        mapExtent: [lon - d, lat - d, lon + d, lat + d].join(','), imageDisplay: '400,400,96', returnGeometry: 'false', f: 'json' }), sig);
      const code = +(j.results?.[0]?.attributes?.Code_18);
      if (!code) return {};
      const l = CLC[code] || ['?', '?'];
      return { 'lc.clc': { value: `${code} ${l[0]}`, value_en: `${code} ${l[1]}`, raw: code, source: 'Copernicus CLMS / EEA, CORINE Land Cover 2018 (MMU 25 ha)', link: LINKS.clc, confidence: 'medium' } };
    } }),
  S({ id: 'gdos', label: 'GDOŚ formy ochrony przyrody', keys: ['prot.np', 'prot.reserve', 'prot.n2k', 'prot.lp', 'prot.ochk'],
    async run(lat, lon, sig) {
      const L = 'GDOS:ParkiNarodowe,GDOS:Rezerwaty,GDOS:SpecjalneObszaryOchrony,GDOS:ObszarySpecjalnejOchrony,GDOS:ParkiKrajobrazowe,GDOS:ObszaryChronionegoKrajobrazu';
      const items = parseGeoserverPlain(await get(gfiUrl(GDOS, L, lat, lon, 'text/plain', { half: 0.0002 }), sig, 'text'));
      const pick = (t) => items.filter((i) => i.type.endsWith(t)).map((i) => i.props);
      const src = 'GDOŚ, Centralny Rejestr Form Ochrony Przyrody (WMS)', link = LINKS.gdos, c = 'high';
      const names = (arr, code) => (arr.length ? arr.map((p) => p.nazwa + (code && p.kod ? ` (${p.kod})` : '')).join('; ') : null);
      const n2k = [...pick('SpecjalneObszaryOchrony').map((p) => ({ ...p, t: 'SOO' })), ...pick('ObszarySpecjalnejOchrony').map((p) => ({ ...p, t: 'OSO' }))];
      const n2kU = [...new Map(n2k.map((p) => [p.kod + p.t, p])).values()];
      const no = ['nie', 'no'];
      const fld = (arr, code) => { const v = names(arr, code); return { value: v || no[0], value_en: v || no[1], raw: arr.length, source: src, link, confidence: c }; };
      return {
        'prot.np': fld(pick('ParkiNarodowe')), 'prot.reserve': fld(pick('Rezerwaty')),
        'prot.n2k': { ...fld(n2kU.map((p) => ({ nazwa: `${p.nazwa} [${p.t === 'SOO' ? 'siedliskowy' : 'ptasi'}]`, kod: p.kod })), true), raw: n2kU.length },
        'prot.lp': fld(pick('ParkiKrajobrazowe')), 'prot.ochk': fld(pick('ObszaryChronionegoKrajobrazu')),
      };
    } }),
  S({ id: 'n2kNear', label: 'EEA Natura 2000 (distance)', keys: ['prot.n2kNearest'],
    async run(lat, lon, sig) {
      const q = (l) => get(EEA_N2K + l + '/query?' + qs({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: 4326, distance: 15000, units: 'esriSRUnit_Meter',
        outFields: 'SITECODE,SITENAME,SITETYPE', returnGeometry: 'true', outSR: 4326, maxAllowableOffset: 0.0005, geometryPrecision: 5, f: 'json' }), sig);
      const all = (await Promise.all([0, 1, 2].map(q))).flatMap((j) => j.features || []);
      const ds = all.map((f) => ({ ...f.attributes, d: distToRings(lat, lon, f.geometry?.rings || []) })).sort((a, b) => a.d - b.d);
      const src = 'EEA, Natura 2000 (end 2023+)', n = ds[0];
      if (!n) return { 'prot.n2kNearest': { value: null, detail: 'brak w 15 km / none within 15 km', raw: { distM: Infinity }, source: src, link: LINKS.gdos, confidence: 'medium' } };
      return { 'prot.n2kNearest': { value: r1(n.d / 1000), raw: { code: n.SITECODE, name: n.SITENAME, distM: Math.round(n.d) }, detail: `${n.SITECODE} ${n.SITENAME}` + (n.d === 0 ? ' (wewnątrz / inside)' : ''),
        source: src, link: LINKS.n2k(n.SITECODE), confidence: 'medium' } };
    } }),
  S({ id: 'isok', label: 'Wody Polskie ISOK MZP/MRP', keys: ['flood.fluvial', 'flood.sea'],
    async run(lat, lon, sig) {
      const txt = await get(gfiUrl(ISOK, 'NZ.Fluvial,NZ.SeaWater', lat, lon, 'text/plain', { half: 0.0005, crs: 'EPSG:4258' }), sig, 'text');
      const items = parseGeoserverPlain(txt);
      const src = 'PGW Wody Polskie, mapy zagrożenia powodziowego (ISOK, INSPIRE NZ, cykl 2022)', link = LINKS.isok;
      const res = (kind) => items.filter((i) => (i.props.hazardcategory || '').includes(kind) || i.type.includes(kind === 'fluvial' ? 'Fluvial' : 'SeaWater'))
        .map((i) => +i.props.loo_ql_returnperiod).filter((x) => x > 0).sort((a, b) => a - b);
      const lbl = (T) => (T <= 10 ? ['Q10% (raz na 10 lat) — obszar szczególnego zagrożenia', 'Q10% (1 in 10 years) — special flood hazard area']
        : T <= 100 ? ['Q1% (raz na 100 lat) — obszar szczególnego zagrożenia', 'Q1% (1 in 100 years) — special flood hazard area']
          : ['Q0,2% (raz na 500 lat)', 'Q0.2% (1 in 500 years)']);
      const fl = res('fluvial'), se = res('sea');
      const one = (arr) => (arr.length ? { value: lbl(arr[0])[0], value_en: lbl(arr[0])[1], raw: arr[0] } : { value: 'poza strefą', value_en: 'outside mapped zones', raw: null });
      return { 'flood.fluvial': { ...one(fl), source: src, link, confidence: 'high' }, 'flood.sea': { ...one(se), source: src, link, confidence: 'high' } };
    } }),
  S({ id: 'imgw', label: 'IMGW-PIB synop (nearest station)', keys: ['climate.station', 'climate.now'],
    async run(lat, lon, sig) {
      const st = STATIONS.map(([id, name, la, lo, h]) => ({ id, name, la, lo, h, d: distM(lat, lon, la, lo) })).sort((a, b) => a.d - b.d);
      const n = st[0];
      const out = { 'climate.station': { value: r1(n.d / 1000), raw: { id: n.id, name: n.name, lat: n.la, lon: n.lo, elevM: n.h, distM: Math.round(n.d) },
        detail: `${n.name} (${n.id}), ${n.h} m n.p.m.`, source: 'IMGW-PIB, wykaz stacji synoptycznych (tabela statyczna)', link: LINKS.imgw, confidence: 'high' } };
      const j = await get('https://danepubliczne.imgw.pl/api/data/synop/id/' + n.id, sig);
      out['climate.now'] = { value: j.temperatura != null ? +j.temperatura : null, unit: '°C', raw: j,
        detail: `${j.data_pomiaru} ${j.godzina_pomiaru}:00 UTC; wiatr ${j.predkosc_wiatru} m/s; wilg. ${j.wilgotnosc_wzgledna}%; opad ${j.suma_opadu} mm`,
        detail_en: `${j.data_pomiaru} ${j.godzina_pomiaru}:00 UTC; wind ${j.predkosc_wiatru} m/s; RH ${j.wilgotnosc_wzgledna}%; precip ${j.suma_opadu} mm`,
        source: 'IMGW-PIB dane publiczne (API synop)', link: LINKS.imgw, confidence: 'high' };
      return out;
    } }),
];

// ------------------------------------------------------------------ text for suitability
const TX = {
  pl: {
    overall: { green: 'Lokalizacja wygląda dobrze dla agri-PV', amber: 'Agri-PV możliwe, ale są punkty do sprawdzenia', red: 'Poważne przeszkody dla agri-PV', grey: 'Za mało danych' },
    slopeNA: 'Nachylenie: brak danych',
    slope: (v, s) => (v < 5 ? `Nachylenie ${s}% — teren płaski, standardowa konstrukcja` : v < 10 ? `Nachylenie ${s}% — wymaga wyższych słupów lub tarasowania rzędów` : `Nachylenie ${s}% — strome, drogie fundamenty i erozja`),
    floodQ: (q) => `W strefie zagrożenia powodzią ${q} — obszar szczególnego zagrożenia, zabudowa praktycznie wykluczona`,
    flood02: 'W zasięgu wody Q0,2% (raz na 500 lat) — inwerter i rozdzielnice wysoko',
    floodNone: 'Poza mapowanymi strefami zagrożenia powodzią',
    floodNA: 'Powódź: brak danych', protNA: 'Ochrona przyrody: brak danych',
    gwWells: (n, d) => `Woda: ${n} studni/otworów w promieniu 2 km` + (d ? `, typowa głębokość ~${d} m` : '') + ' — wydajność sprawdzić na mapie MHP (ePSH)',
    gwGzwp: (g) => `Woda: teren w ${g} — wydajność sprawdzić na mapie MHP (ePSH)`,
    lowland: (h) => `Teren ${h} m n.p.m. — depresja/polder, zależność od pomp i wałów`,
    gwFlood: 'Obszar zagrożony podtopieniami — wysokie wody gruntowe',
    np: (n) => `Park narodowy (${n}) — budowa wykluczona`, res: (n) => `Rezerwat (${n}) — budowa wykluczona`,
    n2k: (n) => `Natura 2000 (${n}) — potrzebna ocena oddziaływania na środowisko`,
    lp: (n) => `Park krajobrazowy / OChK (${n}) — ograniczenia w planie ochrony, sprawdzić uchwałę`,
    protNone: (d) => 'Poza formami ochrony przyrody' + (d != null ? `; najbliższa Natura 2000 ${d} km` : ''),
    gwGood: (y, d) => `Woda do nawadniania: wydajność studni ${y} m³/h` + (d ? `, studnie w okolicy ~${d} m` : ''),
    gwMid: (y) => `Woda: wydajność ${y} m³/h — wystarczy na nawadnianie kroplowe, nie na deszczownie`,
    gwLow: 'Słaba lub brak użytkowej warstwy wodonośnej — oprzeć się na retencji deszczówki ze stołów',
    gwNA: 'Wody podziemne: brak danych MHP',
    wt: (v) => `Zwierciadło wody w najbliższym piezometrze ${v} m p.p.t. — podmokłe, fundamenty i dojazd`,
    soilGood: (s) => `Dobra gleba (${s}) — argument za agri-PV: rolnictwo pod panelami trwa, a zwykła farma PV na klasach I-III jest ograniczona`,
    soilMid: (s) => `Średnia gleba (${s}) — agri-PV utrzymuje produkcję, dobre warunki`,
    soilWeak: (s) => `Słaba gleba (${s}) — agri-PV z wypasem lub uprawą zielonki; zwykła PV też możliwa`,
    soilOrg: 'Gleba organiczna/torf — słaba nośność, dłuższe pale, emisja CO₂ przy osuszaniu',
    soilNA: 'Gleba: brak danych mapy glebowej',
    lcBad: (l) => `Pokrycie terenu: ${l} — nie jest to grunt rolny`, lcAmber: (l) => `Pokrycie terenu: ${l} — sprawdzić przeznaczenie`, lcOk: (l) => `Grunt rolny (${l})`,
    slide: 'Osuwisko w SOPO — wykluczone bez badań geotechnicznych', slideZone: 'Teren zagrożony ruchami masowymi (SOPO) — badania geotechniczne',
  },
  en: {
    overall: { green: 'Site looks good for agrivoltaics', amber: 'Agrivoltaics possible, some points to check', red: 'Serious obstacles for agrivoltaics', grey: 'Not enough data' },
    slopeNA: 'Slope: no data',
    slope: (v, s) => (v < 5 ? `Slope ${s}% — flat, standard structure` : v < 10 ? `Slope ${s}% — needs taller posts or terraced rows` : `Slope ${s}% — steep, costly foundations and erosion`),
    floodQ: (q) => `Inside the ${q} flood zone — special flood hazard area, building practically excluded`,
    flood02: 'Inside the Q0.2% (1 in 500 years) flood extent — keep inverters and switchgear high',
    floodNone: 'Outside mapped flood hazard zones',
    floodNA: 'Flood: no data', protNA: 'Nature protection: no data',
    gwWells: (n, d) => `Water: ${n} wells/boreholes within 2 km` + (d ? `, typically ~${d} m deep` : '') + ' — check the yield on the MHP map (ePSH)',
    gwGzwp: (g) => `Water: site inside ${g} — check the yield on the MHP map (ePSH)`,
    lowland: (h) => `Ground at ${h} m a.s.l. — depression/polder, depends on pumps and dikes`,
    gwFlood: 'Groundwater flooding area — high water table',
    np: (n) => `National park (${n}) — building excluded`, res: (n) => `Nature reserve (${n}) — building excluded`,
    n2k: (n) => `Natura 2000 (${n}) — environmental impact assessment needed`,
    lp: (n) => `Landscape park / protected landscape (${n}) — restrictions in the protection plan, check the resolution`,
    protNone: (d) => 'Outside nature protection areas' + (d != null ? `; nearest Natura 2000 ${d} km` : ''),
    gwGood: (y, d) => `Irrigation water: well yield ${y} m³/h` + (d ? `, local wells ~${d} m deep` : ''),
    gwMid: (y) => `Water: yield ${y} m³/h — enough for drip irrigation, not for sprinklers`,
    gwLow: 'Weak or no usable aquifer — rely on rainwater harvested from the canopies',
    gwNA: 'Groundwater: no MHP data',
    wt: (v) => `Water table in the nearest piezometer ${v} m below ground — wet ground, foundations and access`,
    soilGood: (s) => `Good soil (${s}) — the agri-PV argument: farming continues under the panels, while plain ground PV on classes I-III is restricted`,
    soilMid: (s) => `Medium soil (${s}) — agri-PV keeps the land productive`,
    soilWeak: (s) => `Weak soil (${s}) — agri-PV with grazing or forage; plain PV also possible`,
    soilOrg: 'Organic/peat soil — low bearing capacity, longer piles, CO₂ release if drained',
    soilNA: 'Soil: no soil-map data',
    lcBad: (l) => `Land cover: ${l} — not farmland`, lcAmber: (l) => `Land cover: ${l} — check the zoning`, lcOk: (l) => `Farmland (${l})`,
    slide: 'Landslide mapped in SOPO — excluded without geotechnical survey', slideZone: 'Area at risk of mass movements (SOPO) — geotechnical survey needed',
  },
};
const RANK = { grey: 0, green: 1, amber: 2, red: 3 };
const NF = { pl: new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }), en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }) };

// ------------------------------------------------------------------ module
export function init(ctx = {}) {
  const cache = new Map();
  let ac = null, report = emptyReport(null, 'idle');

  function emptyReport(site, status) {
    const fields = {};
    for (const [k, d] of Object.entries(FIELD_DEFS)) fields[k] = { value: null, unit: d.unit, label_pl: d.label_pl, label_en: d.label_en, source: null, link: null, confidence: null, pending: status === 'loading' };
    return { site, status, startedAt: Date.now(), ms: null, fields, groups: GROUPS, timing: {}, errors: [], linkOnly: LINK_ONLY };
  }
  const keyOf = (s) => `${(+s.lat).toFixed(4)},${(+s.lon).toFixed(4)}`;
  function loadSession(k) { try { const t = sessionStorage.getItem('sitedata:' + k); return t ? JSON.parse(t) : null; } catch { return null; } }
  function saveSession(k, r) { try { sessionStorage.setItem('sitedata:' + k, JSON.stringify(r)); } catch { /* quota / private mode */ } }

  // ePSH (epsh.pgi.gov.pl, Intergraph WMS behind Imperva) sometimes answers without a CORS header; the browser then
  // logs an error a catch cannot hide. No CORS REST copy of MHP / balance areas exists (checked 2026-11-18:
  // cbdgmapa hydrogeologia has none, baza.pgi.gov.pl is behind an Incapsula challenge, cbdgmapa/inspire needs a token).
  // So ePSH is opt-in: setSite(site, {epsh:true}) or loadEpsh() (call it when the user opens the report), and after
  // one ePSH failure it is not called again in this browser session (fields become "link only").
  // 2026-11-18 (coordinator): even the opt-in call logged CORS errors from localhost -> no runtime ePSH fetch at all.
  const EPSH_FETCH = false;
  let epshDisabled = false, lastProgress = null;
  function epshOff() { if (epshDisabled) return true; try { return sessionStorage.getItem('sitedata:epshOff') === '1'; } catch { return false; } }
  function disableEpsh() { epshDisabled = true; try { sessionStorage.setItem('sitedata:epshOff', '1'); } catch { /* */ } }
  function markEpshLinkOnly(r, svc) {
    for (const key of svc.keys) r.fields[key] = { ...r.fields[key], value: null, pending: false, linkOnly: true, error: undefined,
      source: 'PIG-PIB / PSH (ePSH) — tylko link / link only', link: LINKS.epsh, confidence: null,
      note: 'ePSH bez stabilnego CORS — otwórz mapę MHP w przeglądarce ePSH / ePSH has no reliable CORS — open the MHP map in the ePSH viewer' };
    r.timing[svc.id] = { label: svc.label, ms: 0, ok: true, skipped: true, linkOnly: true };
  }
  async function runService(svc, r, lat, lon, outer) {
    const s0 = performance.now();
    const { signal, done } = combineSignals(outer, svc.timeout || TIMEOUT_MS);
    try {
      const res = await svc.run(lat, lon, signal);
      if (outer.aborted) return;
      for (const key of svc.keys) {
        const base = r.fields[key];
        const v = res[key] || { value: null };
        r.fields[key] = { ...base, ...v, unit: v.unit !== undefined ? v.unit : base.unit, pending: false, linkOnly: false, note: v.note };
      }
      r.timing[svc.id] = { label: svc.label, ms: Math.round(performance.now() - s0), ok: true };
    } catch (e) {
      if (outer.aborted) return;
      const msg = e?.name === 'TimeoutError' || /timeout/.test(String(e?.message || e)) ? 'timeout' : String(e?.message || e).slice(0, 160);
      if (svc.epsh) { disableEpsh(); markEpshLinkOnly(r, svc); r.timing[svc.id] = { ...r.timing[svc.id], ok: false, error: msg }; return; }
      for (const key of svc.keys) r.fields[key] = { ...r.fields[key], value: null, error: msg, pending: false };
      r.timing[svc.id] = { label: svc.label, ms: Math.round(performance.now() - s0), ok: false, error: msg };
      r.errors.push(`${svc.id}: ${msg}`);
    } finally { done(); }
  }
  // explicit, user-triggered: fetch the ePSH fields (MHP unit + yield, balance area) for the current report
  async function loadEpsh(opts = {}) {
    const r = report;
    if (!EPSH_FETCH || !r.site || epshOff()) return r; // disabled: kept so callers do not break
    const todo = SERVICES.filter((s) => s.epsh && r.fields[s.keys[0]]?.linkOnly);
    if (!todo.length) return r;
    const onP = opts.onProgress || lastProgress, sig = (ac || new AbortController()).signal;
    for (const svc of todo) for (const key of svc.keys) r.fields[key] = { ...r.fields[key], pending: true };
    onP?.(r);
    // one at a time: the second is skipped if the first fails (no second CORS error in the console)
    for (const svc of todo) {
      if (epshOff()) { markEpshLinkOnly(r, svc); continue; }
      await runService(svc, r, r.site.lat, r.site.lon, sig);
      if (sig.aborted || r !== report) return report;
      onP?.(r);
    }
    const k = keyOf(r.site), slim = JSON.parse(JSON.stringify(r));
    cache.set(k, slim); if (!r.errors.length) saveSession(k, slim);
    return r;
  }

  async function setSite(site, opts = {}) {
    if (!site || !isFinite(site.lat) || !isFinite(site.lon)) throw new Error('setSite: lat/lon required');
    const lat = +site.lat, lon = +site.lon, k = keyOf(site);
    if (ac) ac.abort(new DOMException('site changed', 'AbortError'));
    if (!opts.force) {
      const hit = cache.get(k) || loadSession(k);
      if (hit) { report = { ...hit, site: { lat, lon, name: site.name || hit.site?.name }, cached: true }; cache.set(k, hit); lastProgress = opts.onProgress || null;
        opts.onProgress?.(report); return report; }
    }
    const my = (ac = new AbortController());
    const r = (report = emptyReport({ lat, lon, name: site.name || null }, 'loading'));
    const t0 = performance.now();
    lastProgress = opts.onProgress || null;
    const runOne = async (svc) => { await runService(svc, r, lat, lon, my.signal); if (!my.signal.aborted) opts.onProgress?.(r); };
    await Promise.allSettled(SERVICES.map(async (svc) => {
      if (svc.epsh) { markEpshLinkOnly(r, svc); return; }   // ePSH: link only, never fetched (see EPSH_FETCH)
      if (svc.fallback) return;                              // run below only if its primary source had no data
      await runOne(svc);
    }));
    await Promise.allSettled(SERVICES.filter((svc) => svc.fallback && !my.signal.aborted).map(async (svc) => {
      if (svc.fallback.when(r)) await runOne(svc);
      else { for (const key of svc.keys) r.fields[key] = { ...r.fields[key], pending: false, linkOnly: true, source: svc.label, link: svc.link, note: svc.fallback.note };
        r.timing[svc.id] = { label: svc.label, ms: 0, ok: true, skipped: true }; }
    }));
    if (!my.signal.aborted) opts.onProgress?.(r);
    if (my.signal.aborted) { r.status = 'aborted'; return r; }
    r.status = 'ready'; r.ms = Math.round(performance.now() - t0); ac = null;
    // cache only when the important services answered (errors are retried on the next visit)
    const slim = JSON.parse(JSON.stringify(r));
    cache.set(k, slim);
    if (!r.errors.length) saveSession(k, slim);
    return r;
  }

  function slopeField() {
    let si = null;
    try { si = ctx.terrain?.info?.(); } catch { si = null; }
    const v = si && isFinite(si.slopePct) ? r1(si.slopePct) : null;
    return { ...report.fields['terrain.slope'], pending: false, value: v, source: v != null ? 'lib/terrain.js (' + (si.source || 'NMT') + ')' : null, confidence: v != null ? 'medium' : null };
  }
  function info() {
    const f = report.fields;
    f['terrain.slope'] = slopeField();
    // SMGP 1:50 000 missing at the point -> surface geology falls back to the 1:500 000 map
    const lit = f['geo.lithology'], reg = f['geo.regional'];
    if ((lit.value == null || lit.fallback) && !lit.pending && !lit.error && reg.value != null) {
      f['geo.lithology'] = { ...lit, value: reg.value, value_en: reg.value_en, source: reg.source, link: reg.link, confidence: 'low', fallback: true,
        note: 'brak SMGP 1:50 000 w punkcie — MGP 1:500 000 / no 1:50 000 polygon here — 1:500 000 map' };
    }
    return report;
  }

  function suitability(lang = 'pl') {
    const T = TX[lang] || TX.pl, f = info().fields, L = (fld) => (lang === 'en' && fld.value_en ? fld.value_en : fld.value);
    const nf = NF[lang] || NF.pl, N = (v) => (v == null ? v : nf.format(v));
    const notes = [];
    const add = (key, level, text) => notes.push({ key, level, text });
    // slope
    const sl = f['terrain.slope'].value;
    if (sl == null) add('slope', 'grey', T.slopeNA); else add('slope', sl < 5 ? 'green' : sl < 10 ? 'amber' : 'red', T.slope(sl, N(sl)));
    // landslides
    const ls = f['geo.landslide'].raw;
    if (ls === 'slide') add('landslide', 'red', T.slide); else if (ls === 'zone') add('landslide', 'amber', T.slideZone);
    // flood
    const fl = f['flood.fluvial'], se = f['flood.sea'], h = f['terrain.elevation'].value;
    const rp = Math.min(fl.raw || Infinity, se.raw || Infinity);
    if (fl.value == null && se.value == null) add('flood', 'grey', T.floodNA);
    else if (rp <= 100) add('flood', 'red', T.floodQ(rp <= 10 ? 'Q10%' : 'Q1%'));
    else if (rp <= 500) add('flood', 'amber', T.flood02);
    else add('flood', 'green', T.floodNone);
    if (h != null && h < 2) add('lowland', 'amber', T.lowland(N(h)));
    if (f['hydro.gwFlood'].raw === true) add('gwflood', 'amber', T.gwFlood);
    // protection
    const P = (k) => (f[k].raw > 0 ? L(f[k]) : null);
    const n2kD = f['prot.n2kNearest'].raw?.distM;
    if (f['prot.np'].value == null || f['prot.n2k'].value == null) add('protected', 'grey', T.protNA);
    else if (P('prot.np')) add('protected', 'red', T.np(P('prot.np')));
    else if (P('prot.reserve')) add('protected', 'red', T.res(P('prot.reserve')));
    else if (P('prot.n2k')) add('protected', 'amber', T.n2k(P('prot.n2k')));
    else if (P('prot.lp') || P('prot.ochk')) add('protected', 'amber', T.lp([P('prot.lp'), P('prot.ochk')].filter(Boolean).join('; ')));
    else add('protected', 'green', T.protNone(isFinite(n2kD) ? N(n2kD / 1000) : null));
    // groundwater for irrigation wells
    const y = f['hydro.yield'].raw, wellD = f['hydro.wells'].raw?.medianDepth;
    const wn = f['hydro.wells'].raw?.n, gz = f['hydro.gzwp'].raw;
    if (!y && wn > 0) add('groundwater', 'green', T.gwWells(wn, N(wellD)));
    else if (!y && gz) add('groundwater', 'green', T.gwGzwp(f['hydro.gzwp'].value));
    else if (!y) add('groundwater', 'grey', T.gwNA);
    else if (Array.isArray(y) && y[0] >= 30) add('groundwater', 'green', T.gwGood(f['hydro.yield'].value, N(wellD)));
    else if (Array.isArray(y) && y[0] >= 10) add('groundwater', 'amber', T.gwMid(f['hydro.yield'].value));
    else add('groundwater', 'amber', T.gwLow);
    const wt = f['hydro.waterTable'];
    if (wt.value != null && wt.value < 1 && (wt.raw?.distM ?? 1e9) < 5000) add('watertable', 'amber', T.wt(N(wt.value)));
    // soil
    const kc = f['soil.complex'].raw, cad = f['soil.cadastre'].raw, st = f['soil.type'].raw || '';
    const best = Array.isArray(cad) ? cad.filter((c) => c.rank && /^(R|Ł|Ps)$/.test(c.use)).sort((a, b) => a.rank - b.rank)[0] : null;
    const label = [kc?.code ? (lang === 'en' ? 'complex ' : 'kompleks ') + kc.code : null, best ? (lang === 'en' ? 'class ' : 'klasa ') + best.tok : null].filter(Boolean).join(', ');
    const lith = (f['geo.lithology'].value || '').toLowerCase();
    if (/^(T|E|M)/.test(st) || /torf/.test(lith)) add('soil', 'amber', T.soilOrg);
    let q = kc?.quality || null;
    if (best) q = best.rank <= 4 ? 'good' : best.rank <= 6 ? (q === 'good' ? 'good' : 'medium') : (q || 'weak');
    if (!q && !label) add('soilclass', 'grey', T.soilNA);
    else if (q === 'good') add('soilclass', 'green', T.soilGood(label));
    else if (q === 'medium') add('soilclass', 'green', T.soilMid(label));
    else add('soilclass', 'green', T.soilWeak(label || '?'));
    // land cover
    const c = f['lc.clc'].raw;
    if (c) { const l = L(f['lc.clc']); if (c >= 300) add('landcover', 'red', T.lcBad(l)); else if (c < 200) add('landcover', 'amber', T.lcAmber(l)); else add('landcover', 'green', T.lcOk(l)); }
    // overall
    const worst = notes.reduce((m, n) => (RANK[n.level] > RANK[m] ? n.level : m), 'grey');
    const known = notes.filter((n) => n.level !== 'grey').length;
    const overall = known < 3 ? 'grey' : worst; // too few known notes -> 'Za mało danych'
    return [{ key: 'overall', level: overall, text: T.overall[overall] }, ...notes];
  }

  return {
    update() {}, // no per-frame work
    setSite, info, suitability, loadEpsh,
    get epshAvailable() { return !epshOff(); },
    clearCache() { cache.clear(); try { for (const k of Object.keys(sessionStorage)) if (k.startsWith('sitedata:')) sessionStorage.removeItem(k); } catch { /* */ } },
    services: SERVICES.map((s) => ({ id: s.id, label: s.label, keys: s.keys, timeoutMs: s.timeout || TIMEOUT_MS })),
    linkOnly: LINK_ONLY,
  };
}
