// UI strings: PL (default), EN. t(key, vars) -> string; {name} placeholders are filled from vars.
// The chosen language is remembered in localStorage (wrapped in try/catch: storage may be blocked).
const KEY = 'witkowo3d:lang';
export const LANGS = ['pl', 'en'];

const S = {
  pl: {
    'layer.flows': 'Przepływy (rentgen)',
    'layer.flyHint': 'Kliknij nazwę, aby zobaczyć sieć z bliska',
    'legend.title': 'Legenda',
    'legend.dc': 'DC prąd stały',
    'legend.ac': 'AC prąd przemienny',
    'legend.water': 'Woda / nawadnianie',
    'sim.season': 'Pora roku',
    'season.summer': 'Lato',
    'season.winter': 'Zima',
    'irr.autoHintWinter': 'Auto (zima): 10:00–11:00',
    'hud.outside': 'Na zewnątrz',
    'hud.inside': 'W szklarni',
    'unit.c': '°C',
    'obj.film': 'Folia szklarni',
    'grp.winter': 'Zima',
    'desc.film': 'Folia polietylenowa rozpięta na słupach. Zimą zamienia wiatę agrowoltaiczną w szklarnię: ściany boczne na skrajnych liniach słupów, dach pod modułami PV i ściany szczytowe z drzwiami przed każdym przęsłem.',
    'film.off': 'widoczna tylko zimą',
    'page.title': 'Witkowo — agrowoltaika 3D',
    'app.eyebrow': 'ZUT · Witkowo',
    'app.title': 'Agrowoltaika Witkowo',
    'app.footer': 'Rekonstrukcja ze zdjęć, wymiary szacunkowe',
    'boot.loading': 'Ładowanie modelu 3D…',
    'boot.model': 'Ładowanie modelu… {p}%',
    'boot.modules': 'Uruchamianie symulacji…',
    'boot.fail': 'Nie udało się wczytać modelu',
    'err.prefix': 'Błąd: ',
    'gl.lost': 'Ponowne łączenie 3D…',
    'gl.stopped': 'Widok 3D zatrzymany (reset grafiki).',
    'gl.reloadLow': 'Przeładuj w trybie lekkim',
    'gl.none': 'Przeglądarka nie udostępniła WebGL. Zamknij inne karty 3D, włącz akcelerację sprzętową i przeładuj stronę.',
    'gl.noneTitle': 'Widok 3D nie wystartował',
    'slow.notice': '3D działało wolno ({fps} kl./s), włączono tryb lekki.',
    'slow.full': 'Pełna jakość',
    'ok': 'OK',
    'menu': 'Menu',
    'lang': 'Język',

    'sec.view': 'Widok',
    'mode.iso': 'Przegląd',
    'mode.top': 'Plan',
    'mode.walk': 'Spacer',

    'sec.sim': 'Symulacja',
    'sim.clock': 'Pora dnia',
    'sim.play': 'Start',
    'sim.pause': 'Pauza',
    'sim.speed': 'Prędkość',
    'sim.growth': 'Wzrost kapusty',
    'sim.autoSeason': 'Auto-sezon',
    'sim.irrigation': 'Nawadnianie',
    'irr.auto': 'Auto',
    'irr.on': 'Wł.',
    'irr.off': 'Wył.',
    'irr.autoHint': 'Auto: 5:00–7:00 i 19:00–21:00',
    'day': 'dzień {d}',

    'sec.layers': 'Warstwy',
    'layer.power': 'Przepływ energii',
    'layer.water': 'Przepływ wody',
    'layer.labels': 'Etykiety',
    'layer.shadows': 'Cienie od słońca',
    'layer.shadowsPrep': 'Przygotowanie cieni…',

    'sec.objects': 'Obiekty',
    'close': 'Zamknij',
    'est': 'Wymiary oszacowane na podstawie zdjęć i filmów, to nie są pomiary.',
    'prop.size': 'Wymiary (szacunek)',
    'prop.parts': 'Elementy modelu',

    'hud.title': 'Teraz',
    'hud.time': 'Godzina',
    'hud.sun': 'Słońce',
    'hud.pv': 'Moc PV',
    'hud.energy': 'Energia dziś',
    'hud.water': 'Nawadnianie',
    'hud.litres': 'Woda dziś',
    'hud.crop': 'Kapusta',
    'hud.na': '—',
    'hud.night': 'noc',
    'unit.kw': 'kW',
    'unit.kwh': 'kWh',
    'unit.lpm': 'l/min',
    'unit.l': 'l',
    'unit.cm': 'cm',
    'stage.seedling': 'rozsada',
    'stage.vegetative': 'wzrost liści',
    'stage.heading': 'zawiązywanie główki',
    'stage.harvest': 'zbiór',

    'hint.iso': 'Przeciągnij, aby obracać, prawy przycisk przesuwa, kółko przybliża. Kliknij obiekt, aby zobaczyć opis.',
    'hint.top': 'Przeciągnij, aby przesuwać, kółko przybliża. Kliknij obiekt, aby zobaczyć opis.',
    'hint.walk': '<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> chodzenie, przeciągnij, aby się rozglądać, <kbd>Shift</kbd> szybciej.',
    'hint.isoTouch': 'Palec obraca, dwa palce przybliżają i przesuwają. Dotknij obiekt, aby zobaczyć opis.',
    'hint.topTouch': 'Palec przesuwa plan, uszczypnięcie przybliża.',
    'hint.walkTouch': 'Joystick do chodzenia, przeciągnij ekran, aby się rozglądać.',

    'obj.canopy1': 'Wiata 1',
    'obj.canopy2': 'Wiata 2',
    'obj.canopy3': 'Wiata 3',
    'obj.tanks': 'Zbiorniki z wodą (balast)',
    'obj.pv': 'Panele fotowoltaiczne',
    'obj.jbox': 'Puszki przyłączeniowe i kable',
    'obj.inverters': 'Falowniki',
    'obj.cabinet': 'Szafka sterująca polem',
    'obj.drip': 'Nawadnianie kropelkowe',
    'obj.cabbage': 'Grządki kapusty',
    'obj.farmdroid': 'Robot FarmDroid',
    'grp.structure': 'Konstrukcja',
    'grp.energy': 'Energia',
    'grp.field': 'Pole',

    'desc.canopy': 'Stalowa rama z dwuteowników z jednym środkowym rzędem słupów (co 6 m) i dachem w kształcie V: dźwigary poprzeczne wznoszą się od słupa ku krawędziom do ok. 5 m. Zastrzały z obu stron, dźwigary podłużne i ściągi. Bez fundamentu, wiatę dociążają zbiorniki z wodą przy słupach. Szerokość ok. 6,3 m, długość 30 m.',
    'desc.tanks': 'Formowane plastikowe zbiorniki z wodą na osi słupów, po jednym przy każdym słupie, przesunięte o 1,1 m wzdłuż rzędu, z opaskami i żebrami. Napełnione wodą działają jak balast i dociskają wiatę do ziemi bez betonowego fundamentu.',
    'desc.pv': 'Na każdej wiacie dwa podłużne rzędy po 20 modułów wzdłuż uniesionych krawędzi dachu, razem ok. 120 modułów 1,5 × 1,46 m. Moduł ma 6 × 8 osobnych ogniw z prześwitami: ogniwa zajmują ok. 56% powierzchni modułu i ok. 27% powierzchni wiaty, więc wiata jest półprzezroczysta i pod nią zostaje rozproszone światło.',
    'desc.jbox': 'Każdy moduł ma puszkę przyłączeniową, z której przewody schodzą do tras kablowych wzdłuż dźwigarów podłużnych. Niebieska rura osłonowa sprowadza kable po środkowym słupie do ziemi.',
    'desc.inverters': 'Trzy białe falowniki na stalowym stelażu przy wjeździe. Zamieniają prąd stały z modułów na przemienny dla sieci lub gospodarstwa.',
    'desc.cabinet': 'Biała szafka po prawej przy wjeździe. W modelu to pompa, zawór i sterownik nawadniania: według harmonogramu otwiera zawór, a woda płynie rurą zbiorczą wzdłuż przedniej krawędzi pola do linii kroplujących.',
    'desc.drip': 'Linie kroplujące wzdłuż rzędów kapusty w obu międzyrzędziach między wiatami (środki x = −5 i +5 m). Woda trafia prosto do korzeni, bez zbędnego parowania.',
    'desc.cabbage': 'Kapusta głowiasta w dwóch międzyrzędziach między wiatami, po 10 rzędów roślin w każdym. Krawędzie wiat dają częściowy cień, który ogranicza przegrzewanie i parowanie latem.',
    'desc.farmdroid': 'Autonomiczny robot polowy zasilany słońcem (panel na dachu). Prowadzony przez GNSS, sieje i mechanicznie odchwaszcza między roślinami bez chemii. Model uproszczony.',
  },

  en: {
    'layer.flows': 'Flows (x-ray)',
    'layer.flyHint': 'Click a name to fly to that network',
    'legend.title': 'Legend',
    'legend.dc': 'DC direct current',
    'legend.ac': 'AC alternating current',
    'legend.water': 'Water / irrigation',
    'sim.season': 'Season',
    'season.summer': 'Summer',
    'season.winter': 'Winter',
    'irr.autoHintWinter': 'Auto (winter): 10:00–11:00',
    'hud.outside': 'Outside',
    'hud.inside': 'In greenhouse',
    'unit.c': '°C',
    'obj.film': 'Greenhouse film',
    'grp.winter': 'Winter',
    'desc.film': 'Polyethylene film stretched on the columns. In winter it turns the agrivoltaic canopy into a greenhouse: side walls on the outer column lines, a roof under the PV modules and end walls with a door in front of each bay.',
    'film.off': 'shown in winter only',
    'page.title': 'Witkowo — agrivoltaics 3D',
    'app.eyebrow': 'ZUT · Witkowo',
    'app.title': 'Witkowo agrivoltaics',
    'app.footer': 'Reconstructed from photos, dimensions are estimates',
    'boot.loading': 'Loading 3D model…',
    'boot.model': 'Loading model… {p}%',
    'boot.modules': 'Starting simulation…',
    'boot.fail': 'The model could not load',
    'err.prefix': 'Error: ',
    'gl.lost': 'Reconnecting 3D…',
    'gl.stopped': '3D view stopped (graphics reset).',
    'gl.reloadLow': 'Reload in light mode',
    'gl.none': 'The browser did not allow WebGL. Close other 3D tabs, turn on hardware acceleration, then reload.',
    'gl.noneTitle': '3D view could not start',
    'slow.notice': '3D was running slowly ({fps} fps), so light mode is on.',
    'slow.full': 'Full quality',
    'ok': 'OK',
    'menu': 'Menu',
    'lang': 'Language',

    'sec.view': 'View',
    'mode.iso': 'Overview',
    'mode.top': 'Plan',
    'mode.walk': 'Walk',

    'sec.sim': 'Simulation',
    'sim.clock': 'Time of day',
    'sim.play': 'Play',
    'sim.pause': 'Pause',
    'sim.speed': 'Speed',
    'sim.growth': 'Cabbage growth',
    'sim.autoSeason': 'Auto season',
    'sim.irrigation': 'Irrigation',
    'irr.auto': 'Auto',
    'irr.on': 'On',
    'irr.off': 'Off',
    'irr.autoHint': 'Auto: 5:00–7:00 and 19:00–21:00',
    'day': 'day {d}',

    'sec.layers': 'Layers',
    'layer.power': 'Power flow',
    'layer.water': 'Water flow',
    'layer.labels': 'Labels',
    'layer.shadows': 'Sun shadows',
    'layer.shadowsPrep': 'Preparing shadows…',

    'sec.objects': 'Objects',
    'close': 'Close',
    'est': 'Dimensions are estimated from photos and video, not measured.',
    'prop.size': 'Size (estimate)',
    'prop.parts': 'Model parts',

    'hud.title': 'Now',
    'hud.time': 'Time',
    'hud.sun': 'Sun',
    'hud.pv': 'PV power',
    'hud.energy': 'Energy today',
    'hud.water': 'Irrigation',
    'hud.litres': 'Water today',
    'hud.crop': 'Cabbage',
    'hud.na': '—',
    'hud.night': 'night',
    'unit.kw': 'kW',
    'unit.kwh': 'kWh',
    'unit.lpm': 'l/min',
    'unit.l': 'l',
    'unit.cm': 'cm',
    'stage.seedling': 'seedling',
    'stage.vegetative': 'leaf growth',
    'stage.heading': 'heading',
    'stage.harvest': 'harvest',

    'hint.iso': 'Drag to orbit, right-drag to pan, scroll to zoom. Click an object for details.',
    'hint.top': 'Drag to pan, scroll to zoom. Click an object for details.',
    'hint.walk': '<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> move, drag to look, <kbd>Shift</kbd> faster.',
    'hint.isoTouch': 'Drag to orbit, two fingers to zoom and pan. Tap an object for details.',
    'hint.topTouch': 'Drag to pan, pinch to zoom.',
    'hint.walkTouch': 'Joystick to move, drag to look.',

    'obj.canopy1': 'Canopy 1',
    'obj.canopy2': 'Canopy 2',
    'obj.canopy3': 'Canopy 3',
    'obj.tanks': 'Water tanks (ballast)',
    'obj.pv': 'PV panels',
    'obj.jbox': 'Junction boxes and cables',
    'obj.inverters': 'Inverters',
    'obj.cabinet': 'Field control cabinet',
    'obj.drip': 'Drip irrigation',
    'obj.cabbage': 'Cabbage beds',
    'obj.farmdroid': 'FarmDroid robot',
    'grp.structure': 'Structure',
    'grp.energy': 'Energy',
    'grp.field': 'Field',

    'desc.canopy': 'Steel I-beam frame with one central row of columns (6 m apart) and a V-shaped roof: the cross girders rise from the column to the edges, up to about 5 m. Knee braces on both sides, longitudinal girders and tension rods. No foundation; water tanks next to the columns hold it down. About 6.3 m wide, 30 m long.',
    'desc.tanks': 'Moulded plastic water tanks on the column line, one next to each column, offset 1.1 m along the row, with reinforcement belts and ribs. Filled with water they act as ballast and hold the canopy down without a concrete foundation.',
    'desc.pv': 'Each canopy carries two longitudinal rows of 20 modules along the raised roof edges, about 120 modules of 1.5 x 1.46 m in total. Each module has 6 x 8 separate cells with gaps between them: cells cover about 56% of the module and about 27% of the canopy area, so the canopy is semi-transparent and diffuse light reaches the ground.',
    'desc.jbox': 'Each module has a junction box; leads hang from it to cable trunks along the longitudinal girders. A blue conduit brings the cables down the central column to the ground.',
    'desc.inverters': 'Three white inverters on a steel rack by the entrance. They turn the DC from the modules into AC for the grid or the farm.',
    'desc.cabinet': 'White cabinet on the right by the entrance. In this model it holds the pump, valve and irrigation controller: on schedule it opens the valve and water runs along a header pipe at the front edge of the field to the drip lines.',
    'desc.drip': 'Drip lines along the cabbage rows in both inter-rows between the canopies (centred at x = -5 and +5 m). Water goes straight to the roots with little evaporation.',
    'desc.cabbage': 'White cabbage in the two inter-rows between the canopies, 10 plant rows in each. The canopy edges give partial shade, which reduces overheating and evaporation in summer.',
    'desc.farmdroid': 'Autonomous solar-powered field robot (panel on the roof). GNSS-guided, it sows and weeds mechanically between plants without chemicals. Simplified model.',
  },
};

// an old stored 'ru' (Russian was removed) or anything unknown falls back to Polish
function load() { try { const v = localStorage.getItem(KEY); return LANGS.includes(v) ? v : null; } catch (e) { return null; } }
let lang = load() || 'pl';
const subs = new Set();

export function getLang() { return lang; }
export function t(key, vars) {
  let s = S[lang][key] ?? S.pl[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
export function setLang(l) {
  if (!LANGS.includes(l) || l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch (e) { /* storage blocked */ }
  applyDom();
  subs.forEach((fn) => { try { fn(l); } catch (e) { console.warn(e); } });
}
export function onLang(fn) { subs.add(fn); return () => subs.delete(fn); }
// static DOM: data-i18n (textContent), data-i18n-html (innerHTML), data-i18n-title / -aria (attributes)
export function applyDom(root = document) {
  document.documentElement.lang = lang;
  document.title = t('page.title');
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  root.querySelectorAll('.langs button').forEach((b) => { const on = b.dataset.lang === lang; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
}
