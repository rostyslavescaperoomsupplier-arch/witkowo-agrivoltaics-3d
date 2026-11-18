# Witkowo agrivoltaics 3D — module contract

Static site for GitHub Pages. three.js **0.170.0** via import map (`three`, `three/addons/`), same bootstrap
as `~/escaperoomsupplier/fairy-tale-onyx-3d/index.html` (CDN jsdelivr -> unpkg fallback, loading card, Retry).
Serve locally with `python3 serve.py 8765` (no-store; ES modules cache hard otherwise). No build step.

Model: `model/witkowo.glb` (meshopt-compressed, needs `MeshoptDecoder` from
`three/addons/libs/meshopt_decoder.module.js`). Units = metres, Y up. Original uncompressed: `model/src.glb`.
Geometry is NOT indexed (flat triangle soup); every node is one mesh, names below are exact `node.name`.

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
icon sets; tiny inline SVG only. UI languages: RU (default), PL, EN via `lib/i18n.js` `t(key)`.
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
