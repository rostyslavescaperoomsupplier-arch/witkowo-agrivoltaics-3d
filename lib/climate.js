// lib/climate.js — real climate of Witkowo (ERA5 1940-2025 via Open-Meteo, IMGW-PIB) driving the simulation.
// Contract: init(ctx) -> { update(dt, state), info(lang?), chartCanvas(kind, lang?, opts?), ready }.
// Data: data/geo/climate.json (built by qa/climate_build.py from reference/geo/climate/).
//
// When state.realClimate is true, update() writes every frame:
//   state.tempOutsideC  number, deg C. Typical 1991-2020 ERA5 2 m temperature at clock time state.hour,
//                       hourly mean of +-7 days around 21 Jun (CEST) blended linearly by state.winter with the same
//                       profile for 21 Dec (CET). Linear interpolation between the 24 hourly values, wraps at 24.
//   state.sunScale      number (~0.55 summer, ~0.5 winter). Multiply the clear-sky kW by it:
//                         kW = peakKW * state.sun * state.sunScale
//                       state.sun (sky.js) is clear-sky GHI normalised to 1 at the 21 Jun clear-sky noon, and
//                       power.js treats sun = 1 as STC 1000 W/m2. sunScale = typical daily GHI (ERA5 all-sky, Wh/m2)
//                       / (1000 W/m2 * integral of the sky.js clear-sky curve over the day, h), recomputed for the
//                       current blended declination. So the simulated kWhToday equals the real typical day:
//                       peakKW/1000 * typical GHI Wh/m2 (horizontal plane, no tilt / temperature losses).
// When state.realClimate is false: state.tempOutsideC = null and state.sunScale = 1 (modules use their own models).
// info() is always available once the JSON is loaded (null fields before).

const DECL_S = 23.44, DECL_W = -23.44;                     // keep in sync with lib/sky.js
const DEFAULT_LAT = 53.4;                                  // sky.js default site latitude
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const DATA_URL = new URL('../data/geo/climate.json', import.meta.url);

// sky.js clear-sky model (Meinel beam, Kasten-Young air mass), kW/m2 on the horizontal
function ghiModel(sinAlt) {
  if (sinAlt <= 0) return 0;
  const altDeg = Math.asin(sinAlt) * R2D;
  const am = 1 / (sinAlt + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364));
  return 1.1 * Math.pow(0.7, Math.pow(am, 0.678)) * sinAlt;
}
const sinAltAt = (lat, decDeg, H) => {
  const phi = lat * D2R, dec = decDeg * D2R;
  return Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
};
// integral over the day of state.sun (= ghiModel / clear-sky 21 Jun noon at this latitude, capped at 1), in hours
function sunHours(lat, decDeg) {
  const norm = ghiModel(Math.sin(Math.min(90, 90 - lat + DECL_S) * D2R));
  const N = 288; let s = 0;
  for (let i = 0; i < N; i++) {
    const H = ((i + 0.5) / N * 24 - 12) * 15 * D2R;
    s += Math.min(1, ghiModel(sinAltAt(lat, decDeg, H)) / norm);
  }
  return s * 24 / N;
}

// ---------------------------------------------------------------- live ERA5 (Open-Meteo archive) for any site
// Fair use: per new site 1 daily request (1961..last full year, 4 variables) + HOURLY_YEARS small hourly requests
// (14 Jun..28 Dec of each sample year, 2 variables). Hourly first: the daily request is heavy (weighted) and
// would trip the per-minute limit for anything sent after it. Result cached in sessionStorage per 0.01 deg.
const OM = 'https://archive-api.open-meteo.com/v1/archive';
const DAILY_FROM = 1961;
const HOURLY_YEARS = [2005, 2010, 2015, 2020];
const CACHE_KEY = 'witkowo3d:climate:v1:';
const TIMEOUT_MS = 90000;
const WITKOWO_CELL = [53.25, 15.0];                         // ERA5 0.25 deg cell of the static JSON
const cell = (v) => Math.round(v * 4) / 4;

const rnd = (v, n = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** n) / 10 ** n);
const avg = (a) => { let s = 0, n = 0; for (const v of a) if (v != null && Number.isFinite(v)) { s += v; n++; } return n ? s / n : null; };
function quant(a, p) {
  const b = a.filter(Number.isFinite).sort((x, y) => x - y); if (!b.length) return null;
  const k = (b.length - 1) * p, f = Math.floor(k), c = Math.min(f + 1, b.length - 1);
  return b[f] + (b[c] - b[f]) * (k - f);
}
function ols(xs, ys) {
  const n = xs.length, mx = avg(xs), my = avg(ys); let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxy / sxx; return [b, my - b * mx];
}
const doyNoLeap = (y, m, d) => {   // day of year in a 365-day calendar
  const t = Date.UTC(y, m - 1, d), d0 = Date.UTC(y, 0, 1); let k = Math.round((t - d0) / 864e5) + 1;
  if (y % 4 === 0 && m > 2) k -= 1; return k;
};
const DOY_JUN21 = 172, DOY_DEC21 = 355;
const inWin = (k, c) => Math.abs(k - c) <= 7;

async function omFetch(params, signal, stats) {
  const url = OM + '?' + new URLSearchParams({ ...params, timezone: params.timezone || 'GMT', models: 'era5' });
  const t0 = performance.now();
  const r = await fetch(url, { signal });
  const txt = await r.text();
  stats.requests++; stats.bytes += txt.length; stats.ms += performance.now() - t0;
  let j; try { j = JSON.parse(txt); } catch { throw new Error(`Open-Meteo HTTP ${r.status}`); }
  if (!r.ok || j.error) throw new Error(`Open-Meteo ${r.status}: ${j.reason || 'error'}`);
  return j;
}

function gslYear(tm) {   // ETCCDI GSL on daily tmean of one year (array, index 0 = 1 Jan)
  const n = tm.length; let start = -1;
  for (let i = 0; i + 5 < n; i++) { let ok = true; for (let k = 0; k < 6; k++) if (!(tm[i + k] > 5)) { ok = false; break; } if (ok) { start = i; break; } }
  if (start < 0) return 0;
  let end = n;
  for (let i = Math.max(181, start + 6); i + 5 < n; i++) { let ok = true; for (let k = 0; k < 6; k++) if (!(tm[i + k] < 5)) { ok = false; break; } if (ok) { end = i; break; } }
  return end - start;
}

async function buildLive(lat, lon, signal) {
  const stats = { requests: 0, bytes: 0, ms: 0, t0: performance.now() };
  const lastYear = new Date().getUTCFullYear() - 1;
  // ---- hourly samples (shape of the 21 Jun / 21 Dec day)
  const H = [];
  for (const y of HOURLY_YEARS) {
    const j = await omFetch({ latitude: lat, longitude: lon, start_date: `${y}-06-13`, end_date: `${y}-12-29`,
      hourly: 'temperature_2m,shortwave_radiation' }, signal, stats);
    H.push(j.hourly);
  }
  // ---- daily 1961..last full year
  const dj = await omFetch({ latitude: lat, longitude: lon, start_date: `${DAILY_FROM}-01-01`, end_date: `${lastYear}-12-31`,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum', timezone: 'Europe/Warsaw' }, signal, stats);
  const d = dj.daily, nd = d.time.length;

  // per-year and per-month accumulators
  const years = [], A = { tmean: [], tmin: [], tmax: [], frostDays: [], hot30: [], gsl: [], precip: [], ghi: [] };
  const per = { '1961-1990': [1961, 1990], '1991-2020': [1991, 2020] };
  const M = {};   // M[period][month] = {tmean:[], ... per year values}
  for (const p in per) M[p] = Array.from({ length: 12 }, () => ({ t: [], tn: [], tx: [], pr: [], gh: [], fr: [], hot: [] }));
  const winMid = { s: [], w: [] }, winGhi = { s: [], w: [] };
  let i = 0;
  while (i < nd) {
    const y = +d.time[i].slice(0, 4); let j = i;
    while (j < nd && +d.time[j].slice(0, 4) === y) j++;
    const tm = [], mon = Array.from({ length: 12 }, () => ({ t: [], tn: [], tx: [], pr: 0, gh: 0, fr: 0, hot: 0, n: 0 }));
    let ok = true, fr = 0, hot = 0, pr = 0, gh = 0;
    for (let k = i; k < j; k++) {
      const tx = d.temperature_2m_max[k], tn = d.temperature_2m_min[k];
      if (tx == null || tn == null) { ok = false; continue; }
      const t = (tx + tn) / 2, m = +d.time[k].slice(5, 7) - 1, dd = +d.time[k].slice(8, 10);
      tm.push(t); if (tn < 0) fr++; if (tx >= 30) hot++;
      pr += d.precipitation_sum[k] || 0; gh += (d.shortwave_radiation_sum[k] || 0) / 3.6;
      const o = mon[m]; o.t.push(t); o.tn.push(tn); o.tx.push(tx); o.pr += d.precipitation_sum[k] || 0;
      o.gh += (d.shortwave_radiation_sum[k] || 0) / 3.6; o.n++; if (tn < 0) o.fr++; if (tx >= 30) o.hot++;
      if (y >= 1991 && y <= 2020) {
        const q = doyNoLeap(y, m + 1, dd);
        if (inWin(q, DOY_JUN21)) { winMid.s.push(t); winGhi.s.push(d.shortwave_radiation_sum[k] / 3.6 * 1000); }
        if (inWin(q, DOY_DEC21)) { winMid.w.push(t); winGhi.w.push(d.shortwave_radiation_sum[k] / 3.6 * 1000); }
      }
    }
    if (ok && j - i >= 365) {
      years.push(y); A.tmean.push(rnd(avg(tm))); A.tmin.push(rnd(avg(d.temperature_2m_min.slice(i, j))));
      A.tmax.push(rnd(avg(d.temperature_2m_max.slice(i, j)))); A.frostDays.push(fr); A.hot30.push(hot);
      A.gsl.push(gslYear(tm)); A.precip.push(Math.round(pr)); A.ghi.push(Math.round(gh));
      for (const p in per) if (y >= per[p][0] && y <= per[p][1]) for (let m = 0; m < 12; m++) {
        const o = mon[m], X = M[p][m]; X.t.push(avg(o.t)); X.tn.push(avg(o.tn)); X.tx.push(avg(o.tx)); X.pr.push(o.pr);
        X.gh.push(o.gh); X.fr.push(o.fr); X.hot.push(o.hot);
      }
    }
    i = j;
  }
  if (years.length < 30) throw new Error('ERA5 daily: too few complete years');
  const normals = {};
  for (const p in per) {
    const Z = M[p]; normals[p] = {
      tmean: Z.map((x) => rnd(avg(x.t))), tmin: Z.map((x) => rnd(avg(x.tn))), tmax: Z.map((x) => rnd(avg(x.tx))),
      precip: Z.map((x) => rnd(avg(x.pr), 1)), ghiMonth: Z.map((x) => rnd(avg(x.gh), 1)),
      ghiDay: Z.map((x, m) => rnd(avg(x.gh) / [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m])),
      sunshine: Z.map(() => null), frostDays: Z.map((x) => rnd(avg(x.fr), 1)), hot30: Z.map((x) => rnd(avg(x.hot), 2)),
    };
  }
  const [slope, icpt] = ols(years, A.tmean);
  const pm = (a, y0, y1) => avg(a.filter((_, k) => years[k] >= y0 && years[k] <= y1));
  const base = pm(A.tmean, 1961, 1990), recent = pm(A.tmean, lastYear - 9, lastYear);

  // ---- hourly profiles: shape from HOURLY_YEARS, level corrected to the 1991-2020 daily window mean
  function profile(c, tz, key) {
    const T = Array.from({ length: 24 }, () => []), G = Array.from({ length: 24 }, () => []), mids = [];
    for (const h of H) {
      const dayT = {};
      for (let k = 0; k < h.time.length; k++) {
        const u = Date.parse(h.time[k] + 'Z') + tz * 36e5, dt = new Date(u);
        const y = dt.getUTCFullYear(), q = doyNoLeap(y, dt.getUTCMonth() + 1, dt.getUTCDate());
        if (!inWin(q, c)) continue;
        const hr = dt.getUTCHours();
        if (h.temperature_2m[k] != null) { T[hr].push(h.temperature_2m[k]); (dayT[q] ||= []).push(h.temperature_2m[k]); }
        if (h.shortwave_radiation[k] != null) G[hr].push(h.shortwave_radiation[k]);
      }
      for (const q in dayT) if (dayT[q].length === 24) mids.push((Math.max(...dayT[q]) + Math.min(...dayT[q])) / 2);
    }
    // sample years' mean (tmax+tmin)/2 vs the 30-year daily one -> offset (keeps the 30-year level)
    const off = (avg(key === 's' ? winMid.s : winMid.w) ?? avg(mids)) - avg(mids);
    const ghi = G.map((g) => avg(g)), ghi90 = G.map((g) => quant(g, 0.9));
    return {
      t: T.map((x) => rnd(avg(x) + off)), p10: T.map((x) => rnd(quant(x, 0.1) + off, 1)), p90: T.map((x) => rnd(quant(x, 0.9) + off, 1)),
      ghi: ghi.map((v) => rnd(v, 0)), ghiP90: ghi90.map((v) => rnd(v, 0)),
      dayWh: rnd(avg(key === 's' ? winGhi.s : winGhi.w), 0), dayWhP90: rnd(ghi90.reduce((s, v) => s + (v || 0), 0), 0),
      years: [1991, 2020], nYears: 30, shapeYears: HOURLY_YEARS, levelOffsetC: rnd(off),
    };
  }
  const jun21 = profile(DOY_JUN21, 2, 's'), dec21 = profile(DOY_DEC21, 1, 'w');
  stats.ms = Math.round(performance.now() - stats.t0);
  return {
    version: 1, generated: new Date().toISOString().slice(0, 10), live: true,
    site: { lat, lon }, gridpoint: { latitude: dj.latitude, longitude: dj.longitude, elevation: dj.elevation },
    baseline: { period: '1961-1990', tmean: rnd(base) },
    trend: { perDecade: rnd(slope * 10, 3), period: `${years[0]}-${years[years.length - 1]}`, intercept: rnd(icpt, 4) },
    warming: { recentPeriod: `${lastYear - 9}-${lastYear}`, recentTmean: rnd(recent), vsBaseline: rnd(recent - base),
      tmean_1991_2020: rnd(pm(A.tmean, 1991, 2020)) },
    annual: { years, ...A },
    normals,
    normalsNote: 'Live ERA5 via Open-Meteo. tmean = (tmax+tmin)/2 of each day (the static Witkowo file uses the ERA5 daily mean, ~0.1-0.3 C apart).',
    indices: Object.fromEntries([['1961_1990', 1961, 1990], ['1991_2020', 1991, 2020], ['recent', lastYear - 9, lastYear]].map(([k, a, b]) =>
      [k, { frostDays: rnd(pm(A.frostDays, a, b), 1), hot30: rnd(pm(A.hot30, a, b), 1), gsl: rnd(pm(A.gsl, a, b), 0),
        precip: rnd(pm(A.precip, a, b), 0), ghi: rnd(pm(A.ghi, a, b), 0) }])),
    pv: { annualGhi_1991_2020_daily: rnd(pm(A.ghi, 1991, 2020), 0), typicalDayKWh: normals['1991-2020'].ghiDay },
    hourly: { note: `Shape from ERA5 hourly ${HOURLY_YEARS.join(', ')} (+-7 d), level shifted to the 1991-2020 daily mean; dayWh = 1991-2020 daily mean.`, jun21, dec21 },
    fetch: { requests: stats.requests, bytes: stats.bytes, ms: stats.ms },
  };
}

// ---------------------------------------------------------------- text
const TXT = {
  pl: {
    months: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
    monthsLong: ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'],
    stripes: 'Paski ocieplenia, {name} {a}–{b}',
    stripesNote: 'odchylenie od średniej 1961–1990',
    annual: 'Średnia roczna temperatura, °C',
    trend: 'trend {v} °C/dekadę',
    base: 'średnia 1961–1990: {v} °C',
    monthly: 'Normy miesięczne 1991–2020',
    tLegend: 'temp. śr. (min–max), °C',
    pLegend: 'opad, mm',
    loading: 'Ładowanie danych klimatycznych…',
    src: 'ERA5 / Copernicus via Open-Meteo (CC BY 4.0) · Źródło: IMGW-PIB',
  },
  en: {
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    stripes: 'Warming stripes, {name} {a}–{b}',
    stripesNote: 'anomaly vs 1961–1990 mean',
    annual: 'Annual mean temperature, °C',
    trend: 'trend {v} °C/decade',
    base: '1961–1990 mean: {v} °C',
    monthly: 'Monthly normals 1991–2020',
    tLegend: 'mean temp. (min–max), °C',
    pLegend: 'precipitation, mm',
    loading: 'Loading climate data…',
    src: 'ERA5 / Copernicus via Open-Meteo (CC BY 4.0) · Source: IMGW-PIB',
  },
};
const L = (lang) => TXT[lang] || TXT.pl;
const fmt = (v, d, lang) => {
  const s = (Math.abs(v) < 1e-9 ? 0 : v).toFixed(d);
  return lang === 'en' ? s : s.replace('.', ',');
};
const signed = (v, d, lang) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d, lang);
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);

// ---------------------------------------------------------------- colours (UI theme)
const C = {
  panel: 'rgba(17,19,23,.9)', text: '#e8e4da', muted: 'rgba(232,228,218,.6)', faint: 'rgba(232,228,218,.35)',
  grid: 'rgba(232,228,218,.10)', accent: '#d9ad57', cold: '#7fa8d1', band: 'rgba(217,173,87,.18)', precip: 'rgba(127,168,209,.45)',
};
// diverging stripes palette (ColorBrewer RdBu, as in Ed Hawkins' stripes)
const STRIPES = ['#08306b', '#08519c', '#2171b5', '#4292c6', '#6baed6', '#9ecae1', '#c6dbef', '#deebf7',
  '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function init(ctx = {}) {
  let D = null;
  let profS = null, profW = null, rangeS = null, rangeW = null, dayWhS = 0, dayWhW = 0, profileSource = '';
  let lastW = -1, sunScale = 1, sunH = 1, siteLat = DEFAULT_LAT;
  let staticData = null, ctrl = null, siteSeq = 0, dataName = 'Witkowo';
  const charts = new Set();   // every canvas handed out; redrawn when the data changes (disconnected ones pruned)
  const out = {
    tempOutsideC: null, tempP10: null, tempP90: null, sunScale: 1, clearSkyIndex: null, typicalDayKWhm2: null,
    normalMonth: null, annualMean: null, annualMeanPeriod: null, lastYear: null, trendPerDecade: null,
    warmingVsBaseline: null, baselineMean: null, profileSource: '', source: TXT.pl.src,
    site: { lat: DEFAULT_LAT, lon: 14.6, name: 'Witkowo', status: 'loading', live: false, gridpoint: null, fetch: null },
    errors: [],
  };

  function applyData(j) {
    D = j; lastW = -1;
    dataName = out.site.name || `${out.site.lat.toFixed(2)}° N ${out.site.lon.toFixed(2)}° E`;   // charts label the data, not the requested site
    if (j.hourly && j.hourly.jun21 && j.hourly.jun21.t.every(Number.isFinite)) {
      profS = j.hourly.jun21.t; profW = j.hourly.dec21.t;
      rangeS = [j.hourly.jun21.p10, j.hourly.jun21.p90]; rangeW = [j.hourly.dec21.p10, j.hourly.dec21.p90];
      dayWhS = j.hourly.jun21.dayWh; dayWhW = j.hourly.dec21.dayWh;
      profileSource = j.live ? `ERA5 live: 1991–2020 daily level, hourly shape ${HOURLY_YEARS.join('/')}, ±7 d`
        : `ERA5 hourly ${j.hourly.jun21.years.join('–')}, ±7 d`;
    } else {   // fallback: diurnal curve from monthly tmin/tmax, daily GHI from June / December normals
      profS = j.hourlyFallback.jun21; profW = j.hourlyFallback.dec21; rangeS = rangeW = null;
      dayWhS = j.normals['1991-2020'].ghiDay[5] * 1000; dayWhW = j.normals['1991-2020'].ghiDay[11] * 1000;
      profileSource = 'diurnal curve from monthly tmin/tmax 1991–2020';
    }
    out.trendPerDecade = j.trend.perDecade;
    out.warmingVsBaseline = j.warming.vsBaseline;
    out.annualMean = j.warming.recentTmean;
    out.annualMeanPeriod = j.warming.recentPeriod;
    out.baselineMean = j.baseline.tmean;
    const n = j.annual.years.length - 1;
    out.lastYear = { year: j.annual.years[n], tmean: j.annual.tmean[n] };
    out.profileSource = profileSource;
    out.site.gridpoint = j.gridpoint || null;
    out.site.live = !!j.live;
    out.site.fetch = j.fetch || null;
    redrawAll();
  }
  function redrawAll() {
    for (const c of charts) {
      if (!c.cv.isConnected && c.drawn) { charts.delete(c); continue; }
      draw(c.cv, D ? c.kind : 'loading', c.lang, c.w, c.h); c.drawn = true;
    }
  }

  const ready = fetch(DATA_URL, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('climate.json HTTP ' + r.status);
    return r.json();
  }).then((j) => {
    staticData = j;
    if (siteSeq === 0) { applyData(j); out.site.status = 'ok'; }   // no setSite yet -> default Witkowo
    return j;
  }).catch((e) => { console.warn('[climate]', e); out.errors.push('static climate.json: ' + e.message); out.site.status = 'error'; return null; });

  // site = { lat, lon, rotDeg?, name? }. Resolves when the climate for that site is applied (or failed -> keeps the
  // previous data, error in info().errors). Same ERA5 0.25 deg cell as Witkowo -> the static JSON, no network.
  async function setSite(site) {
    if (!site || !Number.isFinite(+site.lat) || !Number.isFinite(+site.lon)) return;
    const lat = +site.lat, lon = +site.lon, seq = ++siteSeq;
    if (ctrl) ctrl.abort();
    ctrl = null;
    siteLat = lat; lastW = -1;
    out.site = { lat, lon, name: site.name || '', status: 'loading', live: false, gridpoint: null, fetch: null };
    out.errors = [];
    if (cell(lat) === WITKOWO_CELL[0] && cell(lon) === WITKOWO_CELL[1]) {
      const j = staticData || await ready;
      if (seq !== siteSeq) return;
      if (j) { applyData(j); out.site.status = 'ok'; } else out.site.status = 'error';
      return;
    }
    const key = CACHE_KEY + lat.toFixed(2) + ',' + lon.toFixed(2);
    let j = null;
    try { const c = sessionStorage.getItem(key); if (c) j = JSON.parse(c); } catch { j = null; }
    if (!j) {
      const ac = new AbortController(); ctrl = ac;
      const to = setTimeout(() => ac.abort(new Error('timeout ' + TIMEOUT_MS / 1000 + ' s')), TIMEOUT_MS);
      try {
        j = await buildLive(lat, lon, ac.signal);
        j.sources = staticData?.sources; j.attribution = staticData?.attribution;
        try { sessionStorage.setItem(key, JSON.stringify(j)); } catch { /* storage full / blocked */ }
      } catch (e) {
        if (seq !== siteSeq) return;    // superseded by a newer setSite
        const msg = e?.name === 'AbortError' ? 'Open-Meteo: ' + (ac.signal.reason?.message || 'aborted') : (e?.message || String(e));
        out.errors.push('climate live ERA5: ' + msg + (D ? ' (showing previous site data)' : ''));
        out.site.status = 'error';
        return;
      } finally { clearTimeout(to); if (ctrl === ac) ctrl = null; }
    } else j.fetch = { ...(j.fetch || {}), cached: true };
    if (seq !== siteSeq) return;
    applyData(j);
    out.site.status = 'ok';
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  function profileAt(p, hour) {
    const h = ((hour % 24) + 24) % 24, i = Math.floor(h), f = h - i;
    return lerp(p[i], p[(i + 1) % 24], f);
  }

  function update(dt, state) {
    if (!D) { if (state) { state.sunScale = 1; if (!('tempOutsideC' in state)) state.tempOutsideC = null; } return; }
    const w = Math.min(1, Math.max(0, +state.winter || 0));
    const hour = +state.hour || 0;
    if (w !== lastW) {          // only while the season is easing
      lastW = w;
      sunH = sunHours(siteLat, lerp(DECL_S, DECL_W, w));
      const dayWh = lerp(dayWhS, dayWhW, w);
      sunScale = sunH > 0 ? dayWh / (1000 * sunH) : 1;
      out.typicalDayKWhm2 = Math.round(dayWh) / 1000;
      if (D.hourly) {
        const cs = lerp(D.hourly.jun21.dayWhP90, D.hourly.dec21.dayWhP90, w);
        out.clearSkyIndex = cs > 0 ? Math.round(dayWh / cs * 100) / 100 : null;
      }
      const m = w < 0.5 ? 5 : 11, N = D.normals['1991-2020'];
      out.normalMonth = {
        month: m + 1, tmean: N.tmean[m], tmin: N.tmin[m], tmax: N.tmax[m], precip: N.precip[m],
        ghiDay: N.ghiDay[m], sunshine: N.sunshine[m], frostDays: N.frostDays[m], period: '1991-2020',
      };
    }
    const t = lerp(profileAt(profS, hour), profileAt(profW, hour), w);
    out.tempOutsideC = Math.round(t * 10) / 10;
    if (rangeS) {
      out.tempP10 = Math.round(lerp(profileAt(rangeS[0], hour), profileAt(rangeW[0], hour), w) * 10) / 10;
      out.tempP90 = Math.round(lerp(profileAt(rangeS[1], hour), profileAt(rangeW[1], hour), w) * 10) / 10;
    }
    out.sunScale = Math.round(sunScale * 1000) / 1000;
    if (state.realClimate) {
      state.tempOutsideC = t;
      state.sunScale = sunScale;
    } else {
      state.tempOutsideC = null;
      state.sunScale = 1;
    }
  }

  function info(lang = 'pl') {
    out.source = L(lang).src;
    return out;
  }

  // ---------------------------------------------------------------- charts
  function chartCanvas(kind, lang = 'pl', opts = {}) {
    const w = opts.width || 600, h = opts.height || 160;
    const cv = document.createElement('canvas');
    const dpr = Math.min(3, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.style.maxWidth = '100%'; cv.style.height = 'auto';
    cv.dataset.kind = kind;
    draw(cv, D ? kind : 'loading', lang, w, h);
    charts.add({ cv, kind, lang, w, h, drawn: false });
    return cv;
  }

  function draw(cv, kind, lang, W, H) {
    const g = cv.getContext('2d');
    const s = cv.width / W;
    g.setTransform(s, 0, 0, s, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.panel;
    roundRect(g, 0, 0, W, H, 8); g.fill();
    const T = L(lang);
    if (kind === 'loading' || !D) { text(g, T.loading, W / 2, H / 2, C.muted, 12, 'center', 'middle'); return; }
    if (kind === 'stripes') drawStripes(g, W, H, T, lang);
    else if (kind === 'annual') drawAnnual(g, W, H, T, lang);
    else if (kind === 'monthly') drawMonthly(g, W, H, T, lang);
    else text(g, 'unknown chart: ' + kind, 12, H / 2, C.muted, 12, 'left', 'middle');
  }

  function drawStripes(g, W, H, T, lang) {
    const A = D.annual, n = A.years.length, base = D.baseline.tmean;
    const pad = 12, top = 30, bottom = H - 22;
    text(g, fill(T.stripes, { name: dataName, a: A.years[0], b: A.years[n - 1] }), pad, 18, C.text, 13, 'left', 'alphabetic', 600);
    if (W >= 420) text(g, T.stripesNote, W - pad, 18, C.muted, 11, 'right');
    const x0 = pad, x1 = W - pad, bw = (x1 - x0) / n;
    // colour scale: +-2.2 deg C around the baseline (covers 1940 -2.4 and 2024 +2.9 with saturation at the ends)
    const R = 2.2;
    for (let i = 0; i < n; i++) {
      const a = (A.tmean[i] - base) / R;
      const k = Math.max(0, Math.min(STRIPES.length - 1, Math.floor((a + 1) / 2 * STRIPES.length)));
      g.fillStyle = STRIPES[k];
      g.fillRect(x0 + i * bw, top, Math.ceil(bw + 0.5), bottom - top);
    }
    const y0 = A.years[0], ticks = (W >= 420 ? [1940, 1960, 1980, 2000] : [1940, 1980]).filter((y) => y > y0 + 4);
    for (const y of [y0, ...ticks]) {
      const i = A.years.indexOf(y); if (i < 0) continue;
      const x = x0 + (i + 0.5) * bw;
      g.fillStyle = C.faint; g.fillRect(Math.round(x), bottom, 1, 4);
      text(g, String(y), x, H - 6, C.muted, 11, 'center');
    }
    text(g, String(A.years[n - 1]), x1, H - 6, C.muted, 11, 'right');
  }

  function drawAnnual(g, W, H, T, lang) {
    const A = D.annual, n = A.years.length, base = D.baseline.tmean;
    const left = 34, right = W - 12, top = 30, bottom = H - 22;
    text(g, T.annual, 12, 18, C.text, 13, 'left', 'alphabetic', 600);
    const lo = Math.floor(Math.min(...A.tmean)), hi = Math.ceil(Math.max(...A.tmean));
    const X = (y) => left + (y - A.years[0]) / (A.years[n - 1] - A.years[0]) * (right - left);
    const Y = (t) => bottom - (t - lo) / (hi - lo) * (bottom - top);
    g.lineWidth = 1;
    for (let t = lo; t <= hi; t++) {
      g.fillStyle = C.grid; g.fillRect(left, Math.round(Y(t)), right - left, 1);
      if ((hi - lo) <= 6 || t % 2 === 0) text(g, String(t), left - 6, Y(t) + 4, C.muted, 11, 'right');
    }
    for (const y of (W >= 420 ? [1940, 1960, 1980, 2000, 2020] : [1940, 1980, 2020]).filter((y) => y >= A.years[0] && y <= A.years[n - 1])) text(g, String(y), X(y), H - 6, C.muted, 11, 'center');
    // baseline 1961-1990
    g.strokeStyle = C.faint; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(X(1961), Y(base)); g.lineTo(X(1990), Y(base)); g.stroke(); g.setLineDash([]);
    // series: thin line + dots coloured by anomaly sign
    g.strokeStyle = 'rgba(232,228,218,.45)'; g.beginPath();
    A.years.forEach((y, i) => (i ? g.lineTo(X(y), Y(A.tmean[i])) : g.moveTo(X(y), Y(A.tmean[i])))); g.stroke();
    A.years.forEach((y, i) => {
      g.fillStyle = A.tmean[i] >= base ? '#e0795e' : C.cold;
      g.beginPath(); g.arc(X(y), Y(A.tmean[i]), 1.9, 0, Math.PI * 2); g.fill();
    });
    // OLS trend
    const b = D.trend.perDecade / 10, a = D.trend.intercept;
    g.strokeStyle = C.accent; g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(A.years[0]), Y(a + b * A.years[0])); g.lineTo(X(A.years[n - 1]), Y(a + b * A.years[n - 1])); g.stroke();
    // legend (top right)
    const tr = fill(T.trend, { v: signed(D.trend.perDecade, 2, lang) });
    g.font = `600 11px ${FONT}`;
    const wTr = g.measureText(tr).width;
    const ly = W >= 420 ? 18 : bottom - 6;   // small: legend inside the plot, bottom right (no data there)
    g.fillStyle = C.accent; g.fillRect(right - wTr - 18, ly - 5, 12, 2);
    text(g, tr, right, ly, C.accent, 11, 'right', 'alphabetic', 600);
    if (W >= 420) text(g, fill(T.base, { v: fmt(base, 1, lang) }), right - wTr - 28, 18, C.muted, 11, 'right');
  }

  function drawMonthly(g, W, H, T, lang) {
    const N = D.normals['1991-2020'];
    const left = 30, right = W - 34, top = 30, bottom = H - 22;
    text(g, T.monthly, 12, 18, C.text, 13, 'left', 'alphabetic', 600);
    // legends (full width only)
    if (W >= 420) {
    g.font = `11px ${FONT}`;
    const lp = T.pLegend, lt = T.tLegend;
    const wp = g.measureText(lp).width, wt = g.measureText(lt).width;
    let x = W - 12;
    text(g, lp, x, 18, C.muted, 11, 'right'); x -= wp + 6;
    g.fillStyle = C.precip; g.fillRect(x - 9, 10, 9, 9); x -= 22;
    text(g, lt, x, 18, C.muted, 11, 'right'); x -= wt + 6;
    g.fillStyle = C.accent; g.fillRect(x - 12, 13, 12, 2);
    }

    const tlo = Math.floor(Math.min(...N.tmin) / 5) * 5, thi = Math.ceil(Math.max(...N.tmax) / 5) * 5;
    const pmax = Math.ceil(Math.max(...N.precip) / 20) * 20;
    const cw = (right - left) / 12;
    const Xc = (m) => left + (m + 0.5) * cw;
    const Yt = (t) => bottom - (t - tlo) / (thi - tlo) * (bottom - top);
    const Yp = (p) => bottom - p / pmax * (bottom - top);
    for (let t = tlo; t <= thi; t += 5) {
      g.fillStyle = t === 0 ? 'rgba(232,228,218,.22)' : C.grid; g.fillRect(left, Math.round(Yt(t)), right - left, 1);
      if (H >= 140 || t % 10 === 0) text(g, String(t), left - 5, Yt(t) + 4, C.muted, 11, 'right');
    }
    for (let p = 0; p <= pmax; p += pmax / (H >= 140 ? 4 : 2)) text(g, String(Math.round(p)), right + 5, Yp(p) + 4, C.cold, 10, 'left');
    // precipitation bars
    for (let m = 0; m < 12; m++) {
      const bw = cw * 0.5;
      g.fillStyle = C.precip;
      g.fillRect(Xc(m) - bw / 2, Yp(N.precip[m]), bw, bottom - Yp(N.precip[m]));
      text(g, W >= 420 ? T.months[m] : T.months[m][0].toUpperCase(), Xc(m), H - 6, C.muted, 11, 'center');
    }
    // tmin-tmax band
    g.fillStyle = C.band; g.beginPath();
    for (let m = 0; m < 12; m++) (m ? g.lineTo(Xc(m), Yt(N.tmax[m])) : g.moveTo(Xc(m), Yt(N.tmax[m])));
    for (let m = 11; m >= 0; m--) g.lineTo(Xc(m), Yt(N.tmin[m]));
    g.closePath(); g.fill();
    // tmean line + values
    g.strokeStyle = C.accent; g.lineWidth = 2; g.beginPath();
    for (let m = 0; m < 12; m++) (m ? g.lineTo(Xc(m), Yt(N.tmean[m])) : g.moveTo(Xc(m), Yt(N.tmean[m]))); g.stroke();
    for (let m = 0; m < 12; m++) {
      g.fillStyle = C.accent; g.beginPath(); g.arc(Xc(m), Yt(N.tmean[m]), 2.4, 0, Math.PI * 2); g.fill();
    }
  }

  function text(g, s, x, y, color, size, align = 'left', base = 'alphabetic', weight = 400) {
    g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
    g.fillText(s, x, y);
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  return { update, info, chartCanvas, setSite, ready, get data() { return D; } };
}
