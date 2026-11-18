# Witkowo agrivoltaics 3D — module contract

Static site for GitHub Pages. three.js **0.170.0** via import map (`three`, `three/addons/`), same bootstrap
as `~/escaperoomsupplier/fairy-tale-onyx-3d/index.html` (CDN jsdelivr -> unpkg fallback, loading card, Retry).
Serve locally with `python3 serve.py 8765` (no-store; ES modules cache hard otherwise). No build step.

Model: `model/witkowo.glb` (meshopt-compressed, needs `MeshoptDecoder` from
`three/addons/libs/meshopt_decoder.module.js`). Units = metres, Y up. Original uncompressed: `model/src.glb`.
Geometry is indexed since the perf pass (welded, see PERFORMANCE below) except the FarmDroid wheel parts and
`Drip irrigation` (still triangle soup); every node is one mesh, names below are exact `node.name`.

## Scene facts (bounds = [min x,y,z] .. [max x,y,z])
- Site soil: x -18..18, z -36..6, y 0. Grass margins / "Cultivated rows" (dark earth strips) on the ground.
- 3 canopies, each 6 m wide, 30 m long along -z (z -30..0), columns every 6 m, roof y ~4.4-4.5:
  Canopy 1 x -13..-7, Canopy 2 x -3..3, Canopy 3 x 7..13. Aisles between them x -7..-3 and 3..7.
  Per canopy nodes: `Canopy N / columns|feet|anchors|knee braces|longitudinal braces|ballast blocks|ballast ribs|
  lifting sockets|blue conduits|connection plates|bolts|cross girders|longitudinal girders|cable trunk|PV frames|
  photovoltaic cells|cell busbars|junction boxes|hanging leads|roof tension rods`.
  - `photovoltaic cells` y 4.39-4.47, `junction boxes` y ~4.34 (along z -30..0), `cable trunk` y ~4.08 along z,
    `hanging leads` y 3.98-4.34, `blue conduits` y 0.05-1.45 (conduit down a column to ground, z ~0).
- `Aisle overhead ties` y 4.14-4.2 between canopies at x -7..7.
- Electrical corner (front-left, z ~ +1): `Electrical rack` x -12.4..-9.3 y 0..2.25 z 0.81..0.88,
  `Inverter cabinets` (3 white boxes) x -12.21..-9.79 y 1.22..2.08 z 0.86..1.14, `Inverter cooling fins`,
  `Electrical wiring` x -11.92..-9.97 y 0.23..1.25 z ~1.0.
- `Field control cabinet` white box x 13.6..14.2, y 0..1.42, z -1.2..-0.8 (front-right) — use as the water
  source / irrigation controller.
- Crops under canopies: `Cabbage heads` (124 800 verts), two `Cabbage leaves` nodes (dark + sage). x -12.8..12.6,
  z -28.7..-0.5, y 0..0.46. All plants of one node are merged into one mesh.
- `Drip irrigation` thin lines y 0.03-0.06, x -12.4..12.2, z -30..0 (running along z under the crops).
- FarmDroid robot: nodes `FarmDroid / *` around x -1.8..1.2, z -3..0 (in canopy 2 front). Faces -z (cultivation
  arms at z -3). Drives along rows (z axis).
- Reference renders + original Blender generator (all geometry parameters, row spacing, plant grid) in
  `reference/` — read `reference/Rebuild_in_Blender.py` for exact plant / drip line / cable positions.

## Files and owners
- `index.html`, `main.js`, `lib/i18n.js`  — core viewer (agent CORE)
- `lib/sky.js`    — sun, day/night, sky, lights (agent SKY)
- `lib/power.js`  — electricity flow (agent POWER)
- `lib/water.js`  — irrigation water flow (agent WATER)
- `lib/growth.js` — cabbage growth + FarmDroid motion (agent GROWTH)
Do not edit files you don't own. Test your module with your own page `qa/<module>.html` that loads the GLB and
calls your module with a fake state (a slider is enough).

## Module interface (every lib/*.js simulation module)
```js
export function init(ctx) { ...; return { update(dt, state) {}, info?(): object, setVisible?(bool) {} } }
```
`ctx = { THREE, scene, root /* gltf.scene */, node(name) /* -> Object3D|undefined */, renderer, getCamera() }`

`state` (single shared object, mutated by main.js each frame):
```js
{
  hour: 0..24,        // clock time of the simulated day (sunrise ~6, sunset ~20, summer, lat 53.4 N)
  sun: 0..1,          // irradiance factor, written by sky.js update() (0 at night) — others read it
  dayOfSeason: 0..100,// crop growth progress: 0 = just planted, 100 = harvest
  water: 0..1,        // irrigation valve open (0 off, 1 fully on); main toggles / schedules it
  speed: number,      // sim speed multiplier (main uses it to advance hour); modules may use for animation
  quality: 'low'|'high',
  show: { power: bool, water: bool, labels: bool },
}
```
Order each frame: sky.update -> power.update -> water.update -> growth.update. `sky` MUST set `state.sun`.
`info()` returns live numbers for the HUD, e.g. power `{ kW, kWhToday }`, water `{ lpm, litresToday }`,
growth `{ stage: 'seedling'|'vegetative'|'heading'|'harvest', headDiameterCm }`, sky `{ sunAltDeg }`.

Style: dark UI like the escape-room viewer (accent amber #d9ad57, panel rgba(17,19,23,.9)). No emoji, no stock
icon sets; tiny inline SVG only. UI languages: PL (default) + EN via `lib/i18n.js` `t(key)`. NO Russian anywhere in the UI (user, 2026-11-18).
Performance: target 60 fps on a laptop iGPU; scene already has ~1.1 M vertices — prefer InstancedMesh /
Points / shader tricks over many objects; no per-frame allocations.

## MODEL v6 (2026-11-18 15:46) — replaces the geometry above where it differs
`model/witkowo.glb` / `model/src.glb` are now version 6. Old v3 generator + renders kept in `reference/v3/`.
New `reference/Rebuild_in_Blender.py` + `reference/README_RU.txt` (see "ВЕРСИЯ 4/5/6" notes) are the source of truth.
- Each canopy now has ONE central row of columns: x = -10, 0, 10 (was two rows at cx±3). V-shaped roof: cross
  girders go from the centre column out to cx±3.16 and rise; knee braces both sides. Roof height y 4.7–5.0
  (PV cells y 4.72–5.01, junction boxes y ~4.73–4.81 at z -29.33..-0.67, cable trunk y 4.08–4.7,
  hanging leads y 4.31–4.78, tension rods y ~4.88, aisle ties y ~4.8).
- PV: 2 longitudinal rows per canopy at cx ± 2.05, 20 modules each (1.5 x 1.46 m, step 1.5 m, z -0.75-j*1.5),
  each 6 x 8 cells. Peak power must be recomputed from the new cell area.
- Ballast blocks / ribs / lifting sockets are GONE. New nodes per canopy: `molded water tanks`,
  `tank reinforcement belts`, `tank molded ribs` (Ballast gray), on the column axis x = cx ± 0.6, offset 1.10 m
  along the row from each column (z -31.9..-0.3). Blue conduit now at x = cx + 0.19..0.25 (single, by centre column).
- Grass strips under the column axes x = -10, 0, 10 (1.35 m wide).
- Cabbages + drip irrigation moved into the TWO inter-rows centred x = -5 and x = +5, 10 plant rows each
  (heads x -8.6..8.6, z -28.5..-0.8; drip lines x -8.39..8.39, z -30..0). Count plants/lines from the GLB.
- FarmDroid moved to the entrance in front of the beds: x 3.5..6.5, z 1.0..4.0 (faces -z, tool discs at z ~1.1).
- Electrical rack / inverters / wiring / Field control cabinet: unchanged.

## WINTER MODE (greenhouse) — added 2026-11-18
User: "режим зима — между столбами натягивается плёнка и это становится теплицей".
New state fields (main.js owns them):
- `state.season`: 'summer' | 'winter' (UI toggle Лето / Зима).
- `state.winter`: 0..1 transition, eased by main over ~4 s real time (0 = summer, 1 = full winter). Modules
  animate from this value, never jump.
Module owners:
- `lib/winter.js` (agent WINTER, new): greenhouse film + snow + temperature. Film stretched between the
  column lines x = -10, 0, 10: vertical side walls on x = -10 and x = 10 (outer), roof film spanning the two bays
  (x -10..0 and 0..10) under/around the PV rows, end walls at z ~ +0.3 and z ~ -30.3 with a door opening in front
  of each bay. Film unrolls with state.winter. Snow on the ground OUTSIDE the greenhouse and on the roof/PV,
  snowflakes outside only. info(): { outsideC, insideC, filmDeployed 0..1, snowCm }. Exposes `film` (Object3D)
  and `colliders` ([{x0,z0,x1,z1}] wall boxes with door gaps) for main's walk collision and selection.
- `lib/sky.js`: winter sun = 21 Dec (sunrise ~8:20, sunset ~15:40, noon alt ~13 deg), blended by state.winter;
  colder palette.
- `main.js` / `index.html` / `lib/i18n.js` (CORE): season toggle, easing state.winter, HUD temps from winter.info(),
  object "Плёнка теплицы", walk colliders from winter.colliders, irrigation auto schedule in winter 10:00–11:00 only.
Module order each frame: sky -> power -> water -> growth -> winter.

## REAL MAP + DATA OVERLAY — added 2026-11-18 (user 2026-11-18 later: push after every agent — supersedes LOCAL ONLY)
User: overlay the farm on the real map with all collected data (satellite, geology, water, climate).
Research data lands in `reference/geo/{satellite,geology,water,climate}/` (README.md in each; agents still
writing some of them). Builders read them, never edit them. Copy what the site needs into `data/geo/`
(small web-ready files: JPG <= 2 MB each, JSON) — `reference/` is not loaded by the site.
New modules / owners:
- `lib/geo.js` (agent MAP): georeference the 3D farm (site origin lat/lon, EPSG:2180 x/y, rotation of the
  canopies vs north, measured on the orthophoto) -> exports `GEO = {lat, lon, x2180, y2180, rotDeg}` in
  `data/geo/site.json`; real-map ground: orthophoto texture under/around the farm (default), year switcher
  (2012/2014/2020/2023/2025 ortho = before/after), optional live WMS/WMTS tiles (Geoportal ORTO, geology,
  soil, hydrogeology) for a large "Mapa" zoom-out (~2 km) with the 3D farm in place; layer opacity.
  init(ctx) -> { update, info, setLayer(id), setYear(y), layers:[{id,label,legend?}] }.
- `lib/underground.js` (agent SUBSURFACE): cut-away cross-section under the site from geology profile
  (layers with depths, lithology colours, labels) + groundwater table / aquifer from water research; toggle;
  camera can look below ground (main allows it when on).
  init(ctx) -> { update, info, setVisible }.
- `lib/climate.js` + `data/geo/climate.json` (agent CLIMATE): real climate drives the sim when
  state.realClimate: hourly temperature profile per season for winter.js/HUD, real irradiation scaling for
  power (state.sunScale), warming stripes / annual-mean chart rendered to a canvas for the info panel.
  init(ctx) -> { update, info, chartCanvas(kind) }.
- CORE (main.js/index.html/i18n.js): new side-panel section "Mapa i dane" (PL/EN): layer switcher, year,
  opacity, underground toggle, real-climate toggle, data cards with sources/attribution (IMGW-PIB,
  Open-Meteo CC BY 4.0, GUGiK/Geoportal, PIG-PIB, Copernicus). Module order: sky, power, water, growth,
  winter, geo, underground, climate. Attribution line always visible when a real-map layer is on.

## RAIN + TANK WATER LEVEL — added 2026-11-18 (push allowed, see above)
User: "добавь дождь, уровень воды в баках и т.п."
- `lib/rain.js` (agent RAIN, new): rain, runoff from the roof into the 18 `molded water tanks` (they are water-
  filled ballast), visible water level inside each tank, puddles / wet look, rain->snow handled by winter.js
  (rain.js fades out as state.winter -> 1, or shows sleet). Reads: state.rain 0..1 (main sets: Auto from climate
  normals / On / Off), state.irrigationLpm (main copies water.info().lpm), state.hour, state.speed, state.winter.
  Writes: state.tankLevel 0..1 (shared level, persists across the day), state.rainMmH.
  info(): { rainMmH, rainTodayMm, tankLevel, tankLitres, tankCapacityL, inflowLpm, outflowLpm }.
  Model: roof catchment = PV + roof area of the 3 canopies, gutters to the tanks; irrigation draws from tanks
  (state.irrigationLpm) when level > 5%; overflow above 100% shown as spill.

## ANY LOCATION IN POLAND — added 2026-11-18 (push allowed, see above)
User: "place the farm at ANY point in Poland, taking geology, elevation differences etc. into account".
Site object (main owns): `state.site = { lat, lon, rotDeg, name, source }`; default = Witkowo from
data/geo/site.json. URL: `?lat=..&lon=..&rot=..`. When it changes, main calls `await mod.setSite?.(site)` on every
module (in module order) and shows a loading note; modules must cope with a site change at any time (dispose old
textures/meshes, no leaks) and must work offline-ish: if a live service fails, fall back gracefully + report it
in info().errors. Scene origin (0,0,0) = the site point at ground level after levelling (see terrain).
Owners:
- `lib/locate.js` (agent LOCATE, new): self-contained location picker (modal 2D map: Leaflet 1.9.4 from cdnjs/unpkg
  with GUGiK Geoportal ORTO WMTS + OSM base, Poland bounds), place search (GUGiK UUG geocoder or Nominatim with
  proper usage: debounce, 1 req/s, no bulk), click/drag a farm footprint (36x42 m, rotatable handle), "use
  Witkowo" preset, returns a site object. API: `openPicker(currentSite, lang) -> Promise<site|null>`. Injects its
  own CSS matching the UI (dark panel, accent #d9ad57), PL/EN strings inside the module.
- `lib/terrain.js` (agent TERRAIN, new): elevation around the site (GUGiK NMT WCS/WMS 1 m or 5 m grid if CORS
  allows; fallback Open-Meteo elevation API / Copernicus DEM), ~1.6 km x 1.6 km grid (fine near the farm, coarse
  far). API: `setSite(site)`, `heightAt(x,z)` in scene metres relative to the pad, `grid` {w,h,sizeM,heights},
  info(): { elevationM (a.s.l.), slopePct, aspectDeg, reliefM (max-min within 200 m), padLevelM, cutM3, fillM3,
  source }. Farm pad: levelled platform under the 36x42 m patch with cut/fill computed; terrain mesh itself is
  built by geo.js using heightAt (terrain.js does not own the ground mesh).
- `lib/geo.js` (agent MAP): becomes location-agnostic: live ortho (GUGiK WMS GetMap for any point, current +
  archival years where available), live overlays (geology PIG SMGP, hydro MHP, GZWP), draped on a terrain mesh
  displaced by terrain.heightAt; pad edges with cut/fill slopes; Witkowo pre-downloaded images stay as offline
  fallback for the default site.
- `lib/sitedata.js` (agent SITEDATA, new): point queries for the site: geology at point (PIG-PIB identify),
  hydrogeology (MHP: GUPW depth, thickness, yield, quality), GZWP / JCWPd membership, soil if any service exists,
  nearest IMGW station, land cover (CORINE/BDOT if CORS), protected areas (Natura 2000, GDOŚ WMS), flood risk
  (ISOK / Wody Polskie hazard maps) — whatever has a CORS-friendly API. API: setSite(site), info() -> report
  object with fields {value, unit, source, confidence}, and `suitability()` -> short agrivoltaics suitability
  notes (slope, flood, protected area, groundwater depth, soil class).
- `lib/climate.js` (agent CLIMATE): add `setSite(site)`: fetch Open-Meteo archive (ERA5) for the new point live
  (1991–2020 daily + hourly profile days), compute the same JSON schema as data/geo/climate.json in the browser
  (cache in sessionStorage), charts update; default site keeps the static JSON.
- `lib/sky.js` (agent SKY): sun from state.site lat/lon (and scene rotation rotDeg: scene -z bearing) instead of
  the hard-coded Witkowo.
- CORE (later, after PERF): "Lokalizacja" UI (button opens locate.openPicker, URL param, loading state, site
  report card from sitedata + terrain + climate), wire setSite across modules, camera/fog for terrain.

## PERFORMANCE (2026-11-18) — read before adding geometry
- `model/witkowo.glb` is rebuilt from `model/src.glb` by `node tools/optimize_glb.cjs` (weld = index identical
  position+normal corners, then meshopt 'medium', same quantisation as before). Code that reads geometry must handle
  `geometry.index` (all current modules do). Node names / tree / materials unchanged.
- Shadow map is NOT re-rendered every frame (`renderer.shadowMap.autoUpdate = false`). main.js refreshes it when
  the sun turns, a visible shadow caster's world matrix / visibility changes, `state.dayOfSeason` / `state.winter`
  change, and once a second. If your module changes a caster's SHAPE without moving it (vertex shader, geometry
  edit), call `ctx.invalidateShadows()`.
- Draw batching: static structure nodes (canopy steel/bolts/tanks/cables/PV frames/busbars, FarmDroid body parts)
  are drawn through merged meshes named `Batch / ...`; the original nodes stay in the scene (node(), boxes, picking)
  but are off camera layer 0. Hiding an original or swapping its material dissolves its batch automatically.
- Static model meshes have `matrixAutoUpdate = false`: to move one, call `obj.updateMatrix()` after changing it
  (or set matrixAutoUpdate back to true).
- Additive, depthWrite:false, DoubleSide transparent materials get `forceSinglePass = true` at start (same image).
- Measurement: `node qa/perf.cjs <label> [url]`, `zsh qa/perf_ab.sh <beforeUrl> <afterUrl>`, profiles with
  `qa/perf_profile.cjs` / `qa/perf_boot.cjs`, same-pose screenshots with `qa/perf_shots.cjs`.
