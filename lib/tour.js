// Intro card, scene presets, guided tour, share link and PNG export for the Witkowo agrivoltaics viewer.
//
//   import { initTour, parseSceneFromUrl } from './lib/tour.js?v=202611182127';
//   const tour = initTour(window.__witkowo);   // -> { showIntro(force), startTour(), stopTour(), scenes, presets,
//                                               //      applyPreset(id), shareLink(), savePng(), isTourOn() }
//   const s = parseSceneFromUrl();             // scene object from ?m=..&h=.. (null when the URL has none)
//   if (s) app.applyScene(s); else tour.showIntro();   // showIntro() only opens on the first visit
//
// Scene object (the shape app.applyScene takes, app.getScene returns):
//   { mode: 'iso'|'top'|'walk', hour: 0..24, season: 'summer'|'winter', growth: 0..100, rain: 0..1|'auto',
//     layers: { power, water, labels, shadows, rays, xray, underground, map },   // missing keys = unchanged
//     camera: { pos: [x,y,z], target: [x,y,z] }, site: { lat, lon, rotDeg }, playing: bool }
// The module talks to the viewer only through `app` (window.__witkowo). When app.applyScene / getScene / flyHome /
// captureFrame are missing it falls back to the existing hooks and the side-panel controls (same events a click
// fires), so it works before CORE wires it and degrades if a control is absent.
// UI: PL (default) + EN from <html lang>, own CSS (prefix .tour-), no icon fonts.

const LS_KEY = 'witkowo3d:introSeen';

// ---------------------------------------------------------------- strings
const S = {
  pl: {
    introTitle: 'Agrowoltaika w Witkowie',
    introKicker: 'Model 3D',
    introBody: 'Nieoficjalna rekonstrukcja 3D fragmentu instalacji agrowoltaicznej AgrofarmaPV (ZUT i Energia Pomorze, projekt NCBiR) na polu Agrofirmy Witkowo pod Stargardem: panele fotowoltaiczne nad uprawą kapusty.',
    introBody2: 'Ruch słońca, przepływ prądu i wody, deszcz i wzrost roślin są symulowane. Wymiary i moc to szacunki z fotografii, a zimowa szklarnia to koncepcja.',
    introPick: 'Zacznij od widoku',
    tour: 'Wycieczka (1 min)',
    close: 'Zamknij',
    more: 'Więcej:',
    next: 'Dalej', back: 'Wstecz', exit: 'Zakończ', finish: 'Koniec',
    pause: 'Wstrzymaj autoodtwarzanie', play: 'Autoodtwarzanie',
    step: (i, n) => `Krok ${i} z ${n}`,
    stepGo: (i) => `Przejdź do kroku ${i}`,
    copied: 'Link skopiowany do schowka',
    copyFail: 'Skopiuj link ręcznie:',
    saved: 'Zapisano obraz PNG',
    saveFail: 'Nie udało się zapisać obrazu',
    dialog: 'Wprowadzenie',
  },
  en: {
    introTitle: 'Agrivoltaics at Witkowo',
    introKicker: '3D model',
    introBody: 'An unofficial 3D reconstruction of a fragment of the AgrofarmaPV agrivoltaic installation (ZUT and Energia Pomorze, an NCBiR project) on an Agrofirma Witkowo field near Stargard: solar panels above a cabbage crop.',
    introBody2: 'The sun, the flow of power and water, rain and crop growth are simulated. Dimensions and power are estimates from photos, and the winter greenhouse is a concept.',
    introPick: 'Start with a view',
    tour: 'Guided tour (1 min)',
    close: 'Close',
    more: 'More:',
    next: 'Next', back: 'Back', exit: 'Exit', finish: 'Done',
    pause: 'Pause autoplay', play: 'Autoplay',
    step: (i, n) => `Step ${i} of ${n}`,
    stepGo: (i) => `Go to step ${i}`,
    copied: 'Link copied to clipboard',
    copyFail: 'Copy the link manually:',
    saved: 'PNG image saved',
    saveFail: 'Could not save the image',
    dialog: 'Introduction',
  },
};
const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'pl');
const T = (k, ...a) => { const v = S[lang()][k] ?? S.pl[k]; return typeof v === 'function' ? v(...a) : v; };
const L = (o) => (o ? o[lang()] ?? o.pl : '');

// ---------------------------------------------------------------- scenes
// Scene coordinates: canopies x -13..13, rows along -z (z -30..0), roof y ~4.7-5.0, inverters front-left
// (x -12..-9, z ~1), FarmDroid at the entrance (x 3.5..6.5, z 1..4), farm centre (0, 0, -15).
const BASE = { power: true, water: true, labels: false, shadows: true, rays: true, xray: false, underground: false, map: true };
const lay = (o) => ({ ...BASE, ...o });

export const PRESETS = [
  { id: 'noon', big: true, name: { pl: 'Lato w południe', en: 'Summer noon' },
    scene: { mode: 'iso', hour: 12.5, season: 'summer', growth: 70, rain: 0, playing: false, layers: lay({ rays: false }),
      camera: { pos: [31, 17, 19], target: [0, 1.5, -14] } } },
  { id: 'dawn', big: true, name: { pl: 'Świt i promienie słońca', en: 'Dawn and sun rays' },
    scene: { mode: 'iso', hour: 5.6, season: 'summer', growth: 55, rain: 0, playing: false, layers: lay({ rays: true }),
      camera: { pos: [-26, 9, -44], target: [2, 2, -12] } } },
  { id: 'xray', big: true, name: { pl: 'Rentgen: prąd i woda', en: 'X-ray: power and water' },
    scene: { mode: 'iso', hour: 12, season: 'summer', growth: 60, rain: 0, playing: true, layers: lay({ xray: true, rays: false, shadows: false }),
      camera: { pos: [-22, 15, 15], target: [-3, 1.5, -9] } } },
  { id: 'storm', big: true, name: { pl: 'Ulewa i zbiorniki', en: 'Downpour and tanks' },
    scene: { mode: 'iso', hour: 15, season: 'summer', growth: 65, rain: 0.9, playing: true, layers: lay({ rays: false }),
      camera: { pos: [7, 5.5, -41], target: [0, 1, -25] } } },
  { id: 'winter', big: true, name: { pl: 'Zimowa noc w szklarni (koncepcja)', en: 'Winter night in the greenhouse (concept)' },
    scene: { mode: 'iso', hour: 18.5, season: 'winter', growth: 35, rain: 0, playing: false, layers: lay({ rays: false, labels: false }),
      camera: { pos: [27, 13, 18], target: [0, 2, -14] } } },
  { id: 'under', name: { pl: 'Pod ziemią: geologia i woda', en: 'Underground: geology and water' },
    scene: { mode: 'iso', hour: 12, season: 'summer', growth: 60, rain: 0, playing: false, layers: lay({ underground: true, rays: false }),
      camera: { pos: [70, 38, 70], target: [0, -18, -15] } } },
  { id: 'map', name: { pl: 'Mapa okolicy', en: 'Map of the area' },
    scene: { mode: 'iso', hour: 12, season: 'summer', growth: 60, rain: 0, playing: false, layers: lay({ map: true, rays: false, shadows: false }),
      camera: { pos: [340, 590, 400], target: [0, 0, -15] } } },
];

// Guided tour: ~60 s, 8 steps. Facts: reference/README_RU.txt (model v6), reference/geo/*/README.md.
export const TOUR = [
  { title: { pl: 'Panele i ogniwa', en: 'Panels and cells' },
    text: { pl: 'Trzy zadaszenia po 30 m. Na każdym dwa rzędy modułów z osobnymi ogniwami i szczelinami między nimi, więc część światła trafia na uprawę. Ogniwa zakrywają ok. 27% powierzchni (szacunek z rekonstrukcji).',
      en: 'Three 30 m canopies, each with two rows of modules made of separate cells with gaps between them, so part of the light reaches the crop. Cells cover about 27% of the area (estimate from the reconstruction).' },
    scene: { mode: 'iso', hour: 12.5, season: 'summer', growth: 70, rain: 0, playing: false, layers: lay({ rays: false }),
      camera: { pos: [21, 9.5, 6], target: [7, 4, -9] } } },
  { title: { pl: 'Światło pod panelami', en: 'Light under the panels' },
    text: { pl: 'Godz. 9:00. Promienie przechodzą przez szczeliny między ogniwami, a cień przesuwa się po grządkach w ciągu dnia. Słońce liczone dla położenia farmy, ok. 53,3° N.',
      en: '9:00. Sunlight passes through the gaps between the cells and the shadows sweep across the beds during the day. The sun is computed for the farm location, about 53.3° N.' },
    scene: { mode: 'iso', hour: 9, season: 'summer', growth: 70, rain: 0, playing: false, layers: lay({ rays: true, shadows: true }),
      camera: { pos: [16, 3.5, -2], target: [0, 1.2, -18] } } },
  { title: { pl: 'Prąd: DC do AC', en: 'Power: DC to AC' },
    text: { pl: 'Ogniwa dają prąd stały (DC). Kable biegną wzdłuż dachu i w dół słupa do trzech falowników w narożniku, które zamieniają go na prąd przemienny (AC). Moc w modelu jest szacunkowa.',
      en: 'The cells produce direct current (DC). Cables run along the roof and down a column to three inverters in the corner, which turn it into alternating current (AC). Power figures are estimates.' },
    scene: { mode: 'iso', hour: 12, season: 'summer', growth: 60, rain: 0, playing: true, layers: lay({ xray: true, power: true, water: false, rays: false, shadows: false }),
      camera: { pos: [-22, 15, 15], target: [-3, 1.5, -9] } } },
  { title: { pl: 'Kroplówka i zbiorniki', en: 'Drip lines and tanks' },
    text: { pl: 'Kapusta rośnie w dwóch międzyrzędach z linią kroplującą przy każdym rzędzie. Szare zbiorniki to balast wypełniony wodą. W symulacji zbierają deszcz z dachów i zasilają nawadnianie (uproszczony model).',
      en: 'Cabbage grows in two inter-rows with a drip line along every row. The grey tanks are water-filled ballast. In the simulation they collect rain from the roofs and feed the irrigation (simplified model).' },
    scene: { mode: 'iso', hour: 15, season: 'summer', growth: 65, rain: 0.7, playing: true, layers: lay({ water: true, power: false, rays: false }),
      camera: { pos: [13, 6, 7], target: [3, 0.6, -8] } } },
  { title: { pl: 'Robot FarmDroid', en: 'FarmDroid robot' },
    text: { pl: 'Autonomiczny robot polowy z panelem słonecznym na dachu, prowadzony przez GNSS. Sieje i odchwaszcza mechanicznie między roślinami, bez chemii. Model uproszczony.',
      en: 'An autonomous field robot with a solar panel on its roof, guided by GNSS. It sows and weeds mechanically between the plants, without chemicals. Simplified model.' },
    focus: 'farmdroid',
    scene: { mode: 'iso', hour: 11, season: 'summer', growth: 30, rain: 0, playing: false, layers: lay({ rays: false }),
      camera: { pos: [11, 3.6, 10], target: [5, 0.7, 2.5] } } },
  { title: { pl: 'Zimą szklarnia (koncepcja)', en: 'Greenhouse in winter (concept)' },
    text: { pl: 'Pomysł do sprawdzenia: zimą folia rozpięta między słupami zamienia zadaszenie w szklarnię. Na prawdziwej instalacji tego nie ma, a temperatury w modelu są szacunkowe.',
      en: 'An idea to explore: in winter, film stretched between the columns turns the canopy into a greenhouse. The real installation has no such mode, and the temperatures shown are estimates.' },
    scene: { mode: 'iso', hour: 13, season: 'winter', growth: 35, rain: 0, playing: false, layers: lay({ rays: false }),
      camera: { pos: [27, 12, 19], target: [0, 2, -14] } } },
  { title: { pl: 'Gleba i woda pod ziemią', en: 'Soil and groundwater' },
    text: { pl: 'Pod uprawą cienka gleba brunatna, niżej piaski i glina zwałowa z ostatniego zlodowacenia. Głębiej, w piaskach między glinami, leży poziom wodonośny. Profil wg map PIG-PIB, głębokości przybliżone.',
      en: 'Under the crop: a thin brown-earth soil, then sands and glacial till from the last ice sheet. Deeper, in the sands between the tills, lies the aquifer. Profile from PIG-PIB maps, depths approximate.' },
    scene: { mode: 'iso', hour: 12, season: 'summer', growth: 60, rain: 0, playing: false, layers: lay({ underground: true, rays: false }),
      camera: { pos: [70, 38, 70], target: [0, -18, -15] } } },
  { title: { pl: 'Prawdziwe miejsce', en: 'The real location' },
    text: { pl: 'Pole Agrofirmy Witkowo koło Stargardu, ok. 53,29° N, 15,07° E. Na ortofotomapie z kwietnia 2025 r. instalacji jeszcze nie ma; widać ją na zdjęciach Sentinel-2 od listopada 2025 r.',
      en: 'An Agrofirma Witkowo field near Stargard, about 53.29° N, 15.07° E. The April 2025 orthophoto predates the installation; it shows up on Sentinel-2 images from November 2025.' },
    scene: { mode: 'iso', hour: 12, season: 'summer', growth: 60, rain: 0, playing: false, layers: lay({ map: true, rays: false, shadows: false }),
      camera: { pos: [340, 590, 400], target: [0, 0, -15] } } },
];
const STEP_MS = 7500; // 8 x 7.5 s = 60 s

// ---------------------------------------------------------------- URL encoding
// m=i|t|w  h=hour(0.1)  s=s|w  L=layer bitmask  c=x,y,z,tx,ty,tz (0.1 m)  g=growth  r=rain(0.01)
// lat/lon/rot use the same names main.js already reads for the site (?lat=..&lon=..&rot=..).
const BITS = ['power', 'water', 'labels', 'shadows', 'rays', 'xray', 'underground', 'map'];
const MODE_CODE = { iso: 'i', top: 't', walk: 'w' }, CODE_MODE = { i: 'iso', t: 'top', w: 'walk' };
const r1 = (v) => Math.round(v * 10) / 10;
const n1 = (v) => String(r1(v)).replace(/\.0$/, '');

export function encodeScene(sc) {
  const p = new URLSearchParams();
  if (!sc) return p;
  if (sc.mode && MODE_CODE[sc.mode]) p.set('m', MODE_CODE[sc.mode]);
  if (Number.isFinite(sc.hour)) p.set('h', n1(sc.hour));
  if (sc.season) p.set('s', sc.season === 'winter' ? 'w' : 's');
  if (sc.layers) {
    let b = 0; BITS.forEach((k, i) => { if (sc.layers[k]) b |= 1 << i; }); p.set('L', String(b));
  }
  const c = sc.camera;
  if (c?.pos?.length === 3 && c?.target?.length === 3) p.set('c', [...c.pos, ...c.target].map(n1).join(','));
  if (Number.isFinite(sc.growth)) p.set('g', String(Math.round(sc.growth)));
  if (Number.isFinite(sc.rain)) p.set('r', String(Math.round(sc.rain * 100) / 100));
  const st = sc.site;
  if (st && Number.isFinite(st.lat) && Number.isFinite(st.lon) && st.source !== 'default') {
    p.set('lat', st.lat.toFixed(5)); p.set('lon', st.lon.toFixed(5));
    if (Number.isFinite(st.rotDeg)) p.set('rot', n1(st.rotDeg));
  }
  return p;
}

// Returns a scene object (only the fields present in the URL) or null when the URL carries no scene params.
export function parseSceneFromUrl(search = location.search) {
  const q = new URLSearchParams(search), sc = {};
  const num = (k) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? v : null; };
  if (CODE_MODE[q.get('m')]) sc.mode = CODE_MODE[q.get('m')];
  const h = num('h'); if (h != null) sc.hour = Math.min(24, Math.max(0, h));
  if (q.get('s') === 'w' || q.get('s') === 's') sc.season = q.get('s') === 'w' ? 'winter' : 'summer';
  const b = num('L');
  if (b != null && b >= 0) { sc.layers = {}; BITS.forEach((k, i) => { sc.layers[k] = !!(b & (1 << i)); }); }
  const c = (q.get('c') || '').split(',').map(Number);
  if (c.length === 6 && c.every(Number.isFinite)) sc.camera = { pos: c.slice(0, 3), target: c.slice(3) };
  const g = num('g'); if (g != null) sc.growth = Math.min(100, Math.max(0, g));
  const r = num('r'); if (r != null) sc.rain = Math.min(1, Math.max(0, r));
  const lat = num('lat'), lon = num('lon'), rot = num('rot');
  if (lat != null && lon != null) sc.site = { lat, lon, rotDeg: rot ?? undefined, source: 'url' };
  const keys = Object.keys(sc).filter((k) => k !== 'site');
  if (!keys.length) return null;
  if (sc.hour != null) sc.playing = false; // a shared view keeps its time of day
  return sc;
}

// ---------------------------------------------------------------- CSS
const CSS = `
.tour-root{--tour-panel:rgba(17,19,23,.92);--tour-line:#262a31;--tour-text:#e8e4da;--tour-muted:#8f939c;--tour-accent:#d9ad57;--tour-accent-dim:rgba(217,173,87,.16);
  font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--tour-text)}
.tour-root *,.tour-root *::before,.tour-root *::after{box-sizing:border-box}
.tour-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 14px;border:1px solid var(--tour-line);border-radius:8px;background:#15181d;color:var(--tour-text);font-weight:500;transition:background .15s,border-color .15s,color .15s}
.tour-btn:hover{border-color:#3a3f48;background:#1b1f25}
.tour-btn:focus-visible,.tour-preset:focus-visible,.tour-dot:focus-visible,.tour-link:focus-visible,.tour-x:focus-visible{outline:2px solid var(--tour-accent);outline-offset:2px}
.tour-btn.tour-primary{background:var(--tour-accent);border-color:var(--tour-accent);color:#17140d;font-weight:600}
.tour-btn.tour-primary:hover{background:#e6bd6c}
.tour-btn:disabled{opacity:.4;cursor:default}
.tour-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(6,7,9,.55);opacity:0;transition:opacity .2s ease}
.tour-overlay.tour-in{opacity:1}
.tour-card{width:min(560px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--tour-panel);border:1px solid var(--tour-line);border-radius:12px;padding:22px 22px 18px;box-shadow:0 18px 50px rgba(0,0,0,.45);transform:translateY(8px);transition:transform .2s ease;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.tour-overlay.tour-in .tour-card{transform:none}
.tour-kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--tour-accent);font-weight:600;margin:0 0 4px}
.tour-card h2{margin:0 0 10px;font-size:22px;line-height:1.2;font-weight:650;letter-spacing:-.01em;text-transform:none;color:var(--tour-text)}
.tour-cap h3,.tour-card h2{text-transform:none;letter-spacing:normal}
.tour-card p{margin:0 0 8px;color:#cfcbc2}
.tour-card p.tour-note{color:var(--tour-muted);font-size:13px}
.tour-sub{margin:16px 0 8px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--tour-muted);font-weight:600}
.tour-presets{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.tour-preset{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:flex-end;min-height:68px;padding:24px 12px 10px;border:1px solid var(--tour-line);border-radius:9px;background:#14171c;color:var(--tour-text);font-weight:550;line-height:1.25;position:relative;overflow:hidden;transition:border-color .15s,background .15s}
.tour-preset::before{content:"";position:absolute;left:12px;top:11px;width:18px;height:3px;border-radius:2px;background:var(--tour-sw,#d9ad57)}
.tour-preset:hover{border-color:#4a4536;background:#1a1d22}
.tour-more{margin-top:8px;font-size:13px;color:var(--tour-muted)}
.tour-link{all:unset;cursor:pointer;color:var(--tour-accent);text-decoration:underline;text-underline-offset:3px;margin-left:6px}
.tour-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}
.tour-cap{position:fixed;left:50%;bottom:22px;z-index:55;width:min(520px,calc(100vw - 32px));transform:translate(-50%,10px);opacity:0;transition:opacity .2s ease,transform .2s ease;background:var(--tour-panel);border:1px solid var(--tour-line);border-radius:12px;padding:14px 16px 12px;box-shadow:0 12px 36px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.tour-cap.tour-in{opacity:1;transform:translate(-50%,0)}
.tour-cap-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:4px}
.tour-cap h3{margin:0;font-size:16px;font-weight:650;line-height:1.25}
.tour-count{font-size:12px;color:var(--tour-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.tour-cap p{margin:0;color:#cfcbc2;min-height:3em}
.tour-cap-foot{display:flex;align-items:center;gap:8px;margin-top:10px}
.tour-dots{display:flex;gap:2px;flex:1;align-items:center}
.tour-dot{all:unset;cursor:pointer;width:18px;height:22px;display:flex;align-items:center;justify-content:center}
.tour-dot::before{content:"";width:7px;height:7px;border-radius:50%;background:#3a3f48;transition:background .15s,transform .15s}
.tour-dot.tour-done::before{background:#7c6a44}
.tour-dot.tour-on::before{background:var(--tour-accent);transform:scale(1.25)}
.tour-bar{height:2px;background:var(--tour-line);border-radius:2px;margin-top:10px;overflow:hidden}
.tour-bar i{display:block;height:100%;width:0;background:var(--tour-accent)}
.tour-cap .tour-btn{min-height:36px;padding:0 12px}
.tour-cap-foot .tour-sp{flex:1}
.tour-x{all:unset;cursor:pointer;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;color:var(--tour-muted);border:1px solid var(--tour-line)}
.tour-x:hover{color:var(--tour-text);border-color:#3a3f48}
.tour-x svg{width:14px;height:14px}
.tour-toast{position:fixed;left:50%;top:18px;z-index:70;transform:translate(-50%,-8px);opacity:0;transition:opacity .2s,transform .2s;background:var(--tour-panel);border:1px solid var(--tour-line);border-left:3px solid var(--tour-accent);border-radius:8px;padding:9px 14px;max-width:calc(100vw - 32px);word-break:break-all;pointer-events:none}
.tour-toast.tour-in{opacity:1;transform:translate(-50%,0)}
body.tour-on #hud{opacity:.35;transition:opacity .2s}
@media (max-width:820px),(max-height:500px){
  .tour-card{padding:18px 16px 14px}
  .tour-card h2{font-size:19px}
  .tour-presets{grid-template-columns:1fr 1fr}
  .tour-preset{min-height:60px;font-size:13px;padding:22px 10px 9px}
  .tour-cap{bottom:12px;padding:12px 12px 10px}
  .tour-cap p{font-size:13px;min-height:0}
  .tour-cap-foot{flex-wrap:wrap;row-gap:6px}
  .tour-dots{flex-basis:100%;justify-content:center}
  body.tour-on #hud{opacity:0;pointer-events:none}
}
@media (max-width:380px){.tour-presets{grid-template-columns:1fr}.tour-preset{min-height:50px}}
@media (prefers-reduced-motion:reduce){.tour-overlay,.tour-card,.tour-cap,.tour-toast,.tour-dot::before{transition:none}}
`;
const SWATCH = { noon: '#f2c94c', dawn: '#f0a35e', xray: '#8fb4e8', storm: '#5fb6e8', winter: '#c9dbe6', under: '#b08a5a', map: '#8a9a5b' };
const X_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

// ---------------------------------------------------------------- init
export function initTour(app = window.__witkowo) {
  if (!document.getElementById('tour-css')) {
    const st = document.createElement('style'); st.id = 'tour-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const root = document.createElement('div'); root.className = 'tour-root'; document.body.appendChild(root);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const $ = (s) => document.querySelector(s);

  // ---------- scene bridge: CORE hooks first, fallback to the existing controls ----------
  const fire = (node, type) => node && node.dispatchEvent(new Event(type, { bubbles: true }));
  const setCheck = (id, v) => {
    const c = document.getElementById(id); if (!c || v == null || c.disabled) return;
    const lbl = c.closest('label'); if (lbl && lbl.style.display === 'none') return; // control hidden: feature absent
    if (c.checked !== !!v) { c.checked = !!v; fire(c, 'change'); }
  };
  const clickSeg = (sel) => { const b = $(sel); if (b && !b.classList.contains('on')) b.click(); };
  let camAnim = 0;
  function flyCam(cam) {
    const P = app.persp, O = app.orbitP; if (!P || !O || !cam?.pos || !cam?.target) return;
    const p0 = P.position.clone(), t0 = O.target.clone();
    const p1 = p0.clone().set(...cam.pos), t1 = t0.clone().set(...cam.target);
    const far = p0.distanceTo(p1) > 200 ? 1.6 : 1.1, t0ms = performance.now(), id = ++camAnim;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = (now) => {
      if (id !== camAnim) return;
      const k = reduce ? 1 : Math.min(1, (now - t0ms) / (far * 1000)), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      P.position.lerpVectors(p0, p1, e); O.target.lerpVectors(t0, t1, e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function fallbackApply(sc) {
    const st = app.state, sim = app.sim;
    if (sc.mode && app.setMode && app.mode !== sc.mode) app.setMode(sc.mode);
    if (sc.season) clickSeg(`#seasons button[data-season="${sc.season}"]`);
    if (Number.isFinite(sc.hour) && st) st.hour = sc.hour;
    if (sc.playing != null && sim && sim.playing !== sc.playing) $('#bPlay')?.click();
    if (Number.isFinite(sc.growth) && st) {
      const r = $('#rGrowth'); if (r) { r.value = sc.growth; fire(r, 'input'); fire(r, 'change'); } else st.dayOfSeason = sc.growth;
    }
    if (sc.rain === 'auto' || (sc.rain == null && sc.layers?.rain === 'auto')) clickSeg('#rainMode button[data-rain="auto"]');
    else if (Number.isFinite(sc.rain)) {
      if (sc.rain <= 0) clickSeg('#rainMode button[data-rain="off"]');
      else { clickSeg('#rainMode button[data-rain="on"]'); const r = $('#rRain'); if (r) { r.value = sc.rain; fire(r, 'input'); } }
    }
    const Ly = sc.layers || {};
    setCheck('tPower', Ly.power); setCheck('tWater', Ly.water); setCheck('tLabels', Ly.labels);
    setCheck('tShadow', Ly.shadows); setCheck('tRays', Ly.rays); setCheck('tGround', Ly.map);
    if (Ly.xray != null) { if (app.setXray) app.setXray(!!Ly.xray); else setCheck('tFlows', Ly.xray); }
    if (Ly.underground != null) setCheck('tUnder', Ly.underground);
    if (sc.site && app.applySite && st?.site && (Math.abs(sc.site.lat - st.site.lat) > 1e-5 || Math.abs(sc.site.lon - st.site.lon) > 1e-5)) {
      try { app.applySite({ lat: sc.site.lat, lon: sc.site.lon, rotDeg: sc.site.rotDeg ?? st.site.rotDeg, name: '', source: 'url' }); } catch (e) { console.warn('[tour] applySite', e); }
    }
    if (sc.camera && (sc.mode || app.mode) === 'iso') flyCam(sc.camera);
  }
  // main.js applyScene takes the rain MODE as layers.rain ('auto'|'on'|'off') and has no growth / rain level:
  // normalise both ways, then set what it does not cover through the side-panel controls
  function applyScene(sc) {
    if (!sc) return;
    sc = { ...sc, layers: sc.layers ? { ...sc.layers } : undefined };
    if (sc.rain === 'auto' || Number.isFinite(sc.rain)) { sc.layers = sc.layers || {}; sc.layers.rain = sc.rain === 'auto' ? 'auto' : sc.rain > 0 ? 'on' : 'off'; }
    if (typeof app.applyScene === 'function') {
      try {
        app.applyScene(sc);
        if (Number.isFinite(sc.growth)) { const r = $('#rGrowth'); if (r) { r.value = sc.growth; fire(r, 'input'); fire(r, 'change'); } else if (app.state) app.state.dayOfSeason = sc.growth; }
        if (Number.isFinite(sc.rain) && sc.rain > 0) { const r = $('#rRain'); if (r) { r.value = sc.rain; fire(r, 'input'); } else if (app.sim) app.sim.rainLevel = sc.rain; }
        return;
      } catch (e) { console.warn('[tour] app.applyScene failed, using fallback', e); }
    }
    fallbackApply(sc);
  }
  function getScene() {
    if (typeof app.getScene === 'function') {
      try {
        const s = app.getScene();
        if (s) {
          const st = app.state || {}, sim = app.sim || {}, mode = s.layers?.rain ?? sim.rain;
          if (s.growth == null && Number.isFinite(st.dayOfSeason)) s.growth = st.dayOfSeason;
          if (s.rain == null) s.rain = mode === 'off' ? 0 : mode === 'on' ? sim.rainLevel : 'auto';
          if (s.site && st.site?.source) s.site.source = st.site.source;
          return s;
        }
      } catch (e) { console.warn('[tour] app.getScene', e); }
    }
    const st = app.state || {}, sim = app.sim || {}, chk = (id) => !!document.getElementById(id)?.checked;
    const sc = {
      mode: app.mode || 'iso', hour: st.hour, season: st.season, growth: st.dayOfSeason,
      rain: sim.rain === 'off' ? 0 : sim.rain === 'on' ? sim.rainLevel : 'auto', playing: sim.playing,
      layers: { power: chk('tPower'), water: chk('tWater'), labels: chk('tLabels'), shadows: chk('tShadow'), rays: chk('tRays'),
        xray: chk('tFlows'), underground: chk('tUnder'), map: chk('tGround') },
      site: st.site ? { lat: st.site.lat, lon: st.site.lon, rotDeg: st.site.rotDeg, source: st.site.source } : undefined,
    };
    if (app.persp && app.orbitP) sc.camera = { pos: app.persp.position.toArray(), target: app.orbitP.target.toArray() };
    return sc;
  }
  function flyHome() {
    if (typeof app.flyHome === 'function') { try { return app.flyHome(); } catch (e) { console.warn('[tour] app.flyHome', e); } }
    if (app.setMode && app.mode !== 'iso') app.setMode('iso');
    flyCam({ pos: [38, 27, 35], target: [0, 1, -15] });
  }

  // ---------- toast ----------
  const toast = el('div', 'tour-toast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); root.appendChild(toast);
  let toastT = 0;
  function say(msg, ms = 2400) { toast.textContent = msg; toast.classList.add('tour-in'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('tour-in'), ms); }

  // ---------- presets ----------
  // preset / tour cameras are framed for a landscape screen: on portrait phones pull the camera back along its view
  // ray (vertical FOV is fixed, so a narrow screen loses the sides). Shared links keep their exact camera.
  function fitPortrait(sc) {
    const a = innerWidth / innerHeight, c = sc.camera;
    if (a >= 1 || !c?.pos || !c?.target) return sc;
    const k = Math.min(1.9, Math.pow(1 / a, 0.7));
    c.pos = c.pos.map((v, i) => c.target[i] + (v - c.target[i]) * k);
    return sc;
  }
  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id); if (!p) return false;
    applyScene(fitPortrait(structuredClone(p.scene))); return true;
  }

  // ---------- focus trap helper ----------
  const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  function trap(container, e) {
    if (e.key !== 'Tab') return;
    const f = [...container.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---------- intro card ----------
  let intro = null, introPrevFocus = null;
  const seen = () => { try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; } };
  const markSeen = () => { try { localStorage.setItem(LS_KEY, '1'); } catch (e) { /* storage blocked */ } };
  function renderIntro() {
    if (!intro) return;
    const fa = document.activeElement, keep = intro.contains(fa) ? (fa.dataset.preset ? `[data-preset="${fa.dataset.preset}"]` : fa.dataset.act ? `[data-act="${fa.dataset.act}"]` : null) : null;
    renderIntroBody();
    if (keep) intro.querySelector(keep)?.focus();
  }
  function renderIntroBody() {
    const big = PRESETS.filter((p) => p.big), small = PRESETS.filter((p) => !p.big);
    const card = intro.querySelector('.tour-card');
    card.setAttribute('aria-label', T('dialog'));
    card.innerHTML = `
      <p class="tour-kicker">${esc(T('introKicker'))}</p>
      <h2 id="tour-intro-h">${esc(T('introTitle'))}</h2>
      <p>${esc(T('introBody'))}</p>
      <p class="tour-note">${esc(T('introBody2'))}</p>
      <div class="tour-sub">${esc(T('introPick'))}</div>
      <div class="tour-presets">${big.map((p) => `<button type="button" class="tour-preset" data-preset="${p.id}" style="--tour-sw:${SWATCH[p.id]}">${esc(L(p.name))}</button>`).join('')}</div>
      <div class="tour-more">${esc(T('more'))}${small.map((p) => `<button type="button" class="tour-link" data-preset="${p.id}">${esc(L(p.name))}</button>`).join('')}</div>
      <div class="tour-actions">
        <button type="button" class="tour-btn" data-act="close">${esc(T('close'))}</button>
        <button type="button" class="tour-btn tour-primary" data-act="tour">${esc(T('tour'))}</button>
      </div>`;
  }
  function closeIntro() {
    if (!intro) return;
    markSeen();
    const o = intro; intro = null; o.classList.remove('tour-in');
    setTimeout(() => o.remove(), 220);
    if (introPrevFocus && document.contains(introPrevFocus)) try { introPrevFocus.focus(); } catch (e) { /* ignore */ }
  }
  function showIntro(force = false) {
    if (intro) return true;
    if (!force && seen()) return false;
    if (tourOn) stopTour(false);
    introPrevFocus = document.activeElement;
    intro = el('div', 'tour-overlay');
    const card = el('div', 'tour-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tour-intro-h');
    intro.appendChild(card); root.appendChild(intro); renderIntro();
    intro.addEventListener('click', (e) => {
      if (e.target === intro) { closeIntro(); return; }
      const p = e.target.closest('[data-preset]'); if (p) { closeIntro(); applyPreset(p.dataset.preset); return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'close') closeIntro();
      else if (a.dataset.act === 'tour') { closeIntro(); startTour(); }
    });
    requestAnimationFrame(() => { intro?.classList.add('tour-in'); intro?.querySelector('[data-act="tour"]')?.focus(); });
    return true;
  }

  // ---------- guided tour ----------
  let tourOn = false, idx = 0, auto = true, cap = null, before = null, stepT0 = 0, raf = 0, paused = 0;
  function focusRobot(step) {
    // FarmDroid is driven by lib/growth.js: aim at where the robot is now
    const r = app.mods?.growth?.robot; if (!r?.isObject3D || !app.persp) return;
    const THREE = app.ctx?.THREE, c = THREE ? new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()) : r.getWorldPosition(app.persp.position.clone());
    applyScene(fitPortrait({ camera: { pos: [c.x + 6.5, 3.6, c.z + 8], target: [c.x, 0.5, c.z] } }));
    void step;
  }
  function renderCap() {
    if (!cap) return;
    const s = TOUR[idx], n = TOUR.length, last = idx === n - 1;
    cap.querySelector('h3').textContent = L(s.title);
    cap.querySelector('.tour-count').textContent = T('step', idx + 1, n);
    cap.querySelector('p').textContent = L(s.text);
    cap.querySelector('.tour-dots').innerHTML = TOUR.map((_, i) => `<button type="button" class="tour-dot${i === idx ? ' tour-on' : i < idx ? ' tour-done' : ''}" data-go="${i}" aria-label="${esc(T('stepGo', i + 1))}"${i === idx ? ' aria-current="step"' : ''}></button>`).join('');
    const back = cap.querySelector('[data-act="back"]'), next = cap.querySelector('[data-act="next"]'), ap = cap.querySelector('[data-act="auto"]');
    back.textContent = T('back'); back.disabled = idx === 0;
    next.textContent = last ? T('finish') : T('next');
    ap.innerHTML = auto
      ? '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2.5" width="2.6" height="9" rx=".6" fill="currentColor"/><rect x="8.4" y="2.5" width="2.6" height="9" rx=".6" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.5v9l7.5-4.5z" fill="currentColor"/></svg>';
    ap.setAttribute('aria-label', auto ? T('pause') : T('play')); ap.title = ap.getAttribute('aria-label'); ap.setAttribute('aria-pressed', String(auto));
    cap.querySelector('[data-act="exit"]').setAttribute('aria-label', T('exit'));
    cap.querySelector('[data-act="exit"]').title = T('exit');
  }
  function go(i) {
    idx = Math.max(0, Math.min(TOUR.length - 1, i));
    const s = TOUR[idx];
    applyScene(fitPortrait(structuredClone(s.scene)));
    if (s.focus === 'farmdroid') setTimeout(() => { if (tourOn && TOUR[idx] === s) focusRobot(s); }, 60);
    stepT0 = performance.now(); paused = 0; followUntilUser = true;
    renderCap();
  }
  // FarmDroid step: the robot keeps driving (lib/growth.js), so after the fly-in the camera follows it
  let followUntilUser = true;
  function follow(now) {
    const s = TOUR[idx]; if (s.focus !== 'farmdroid' || !followUntilUser || now - stepT0 < 1500) return;
    const r = app.mods?.growth?.robot, THREE = app.ctx?.THREE, P = app.persp, O = app.orbitP;
    if (!r?.isObject3D || !THREE || !P || !O || app.mode !== 'iso') return;
    const c = (follow.c ||= new THREE.Vector3()), d = (follow.d ||= new THREE.Vector3());
    new THREE.Box3().setFromObject(r).getCenter(c); c.y = 0.5;
    d.subVectors(c, O.target); if (d.lengthSq() < 1e-6) return;
    d.multiplyScalar(0.08); O.target.add(d); P.position.add(d);
  }
  function tick(now) {
    if (!tourOn) return;
    follow(now);
    const bar = cap?.querySelector('.tour-bar i');
    if (auto) {
      const k = Math.min(1, (now - stepT0) / STEP_MS);
      if (bar) bar.style.width = (k * 100).toFixed(1) + '%';
      if (k >= 1) { if (idx < TOUR.length - 1) go(idx + 1); else { auto = false; renderCap(); } }
    } else if (bar) bar.style.width = '0%';
    raf = requestAnimationFrame(tick);
  }
  function onTourKey(e) {
    if (!tourOn || intro) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'Escape') { e.preventDefault(); stopTour(); }
    else if (e.key === 'ArrowRight' && cap?.contains(document.activeElement)) { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' && cap?.contains(document.activeElement)) { e.preventDefault(); if (idx > 0) go(idx - 1); }
  }
  function next() { if (idx < TOUR.length - 1) go(idx + 1); else stopTour(); }
  function startTour(from = 0) {
    if (intro) closeIntro();
    if (!tourOn) before = getScene();
    tourOn = true; auto = true; document.body.classList.add('tour-on');
    if (!cap) {
      cap = el('section', 'tour-cap');
      cap.setAttribute('role', 'region'); cap.setAttribute('aria-live', 'polite');
      cap.innerHTML = `<div class="tour-cap-head"><h3></h3><span class="tour-count"></span></div><p></p>
        <div class="tour-cap-foot"><div class="tour-dots"></div>
          <button type="button" class="tour-x" data-act="auto"></button>
          <button type="button" class="tour-btn" data-act="back"></button>
          <button type="button" class="tour-btn tour-primary" data-act="next"></button>
          <button type="button" class="tour-x" data-act="exit">${X_SVG}</button></div>
        <div class="tour-bar"><i></i></div>`;
      cap.addEventListener('click', (e) => {
        const d = e.target.closest('[data-go]'); if (d) { go(+d.dataset.go); return; }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'next') next();
        else if (a.dataset.act === 'back') go(idx - 1);
        else if (a.dataset.act === 'exit') stopTour();
        else if (a.dataset.act === 'auto') { auto = !auto; stepT0 = performance.now(); renderCap(); }
      });
      // user takes over the camera: stop auto-advance (they can resume with the play button)
      app.ctx?.renderer?.domElement?.addEventListener('pointerdown', () => { followUntilUser = false; if (tourOn && auto) { auto = false; renderCap(); } });
      root.appendChild(cap);
    }
    cap.setAttribute('aria-label', lang() === 'en' ? 'Guided tour' : 'Wycieczka');
    go(from);
    requestAnimationFrame(() => cap?.classList.add('tour-in'));
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    setTimeout(() => cap?.querySelector('[data-act="next"]')?.focus({ preventScroll: true }), 50);
  }
  function stopTour(restore = true) {
    if (!tourOn) return;
    tourOn = false; cancelAnimationFrame(raf); document.body.classList.remove('tour-on');
    const c = cap; cap = null;
    if (c) { c.classList.remove('tour-in'); setTimeout(() => c.remove(), 220); }
    if (restore && before) { const b = before; before = null; applyScene(b); } else before = null;
  }
  document.addEventListener('keydown', onTourKey);
  // intro keys on the document: a language switch re-renders the card and drops focus to <body>
  document.addEventListener('keydown', (e) => {
    if (!intro) return;
    const card = intro.querySelector('.tour-card');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeIntro(); return; }
    if (e.key === 'Tab' && !card.contains(document.activeElement)) { e.preventDefault(); card.querySelector(FOCUSABLE)?.focus(); return; }
    trap(card, e);
  }, true);

  // ---------- language changes ----------
  const mo = new MutationObserver(() => { renderIntro(); renderCap(); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // ---------- share link ----------
  function buildUrl(sc = getScene()) {
    const u = new URL(location.href);
    // keep unrelated params (q=high etc.), replace scene ones
    for (const k of ['m', 'h', 's', 'L', 'c', 'g', 'r', 'lat', 'lon', 'rot', 'season', 'name']) u.searchParams.delete(k);
    for (const [k, v] of encodeScene(sc)) u.searchParams.set(k, v);
    u.hash = '';
    return u.toString();
  }
  async function shareLink() {
    const url = buildUrl();
    let ok = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch (e) { /* denied */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (e) { ok = false; }
    }
    say(ok ? T('copied') : `${T('copyFail')} ${url}`, ok ? 2400 : 9000);
    return url;
  }

  // ---------- save PNG ----------
  function download(blob) {
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const name = `witkowo-agrofarmapv-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return name;
  }
  function savePng() {
    return new Promise((resolve) => {
      const done = (blob) => { if (blob) { const n = download(blob); say(T('saved')); resolve(n); } else { say(T('saveFail')); resolve(null); } };
      if (typeof app.captureFrame === 'function') {
        Promise.resolve().then(() => app.captureFrame()).then((r) => {
          if (r instanceof Blob) done(r);
          else if (r?.toBlob) r.toBlob(done, 'image/png');
          else if (typeof r === 'string' && r.startsWith('data:')) fetch(r).then((x) => x.blob()).then(done, () => done(null));
          else done(null);
        }, () => done(null));
        return;
      }
      const canvas = app.ctx?.renderer?.domElement || document.querySelector('canvas');
      if (!canvas) { done(null); return; }
      // main.js renders inside its own rAF callback, registered before this one: by the time ours runs in the same
      // frame the drawing buffer holds the finished (composer) frame and has not been presented/cleared yet.
      requestAnimationFrame(() => { try { canvas.toBlob(done, 'image/png'); } catch (e) { console.warn('[tour] toBlob', e); done(null); } });
    });
  }

  return {
    showIntro, closeIntro, startTour, stopTour, next, isTourOn: () => tourOn,
    scenes: PRESETS, presets: PRESETS, tour: TOUR,
    applyPreset, applyScene, getScene, flyHome, shareLink, shareUrl: buildUrl, savePng,
  };
}
