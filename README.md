# Witkowo — agrivoltaics 3D

Interactive 3D model of the agrivoltaic farm section at Witkowo (ZUT trip, Nov 2026): solar canopies over
cabbage beds with a FarmDroid robot. Simulates the sun over a summer day, power flow from the PV modules to the
inverters, drip irrigation, and crop growth from planting to harvest.

Geometry is a manual reconstruction from photos and video (model v6, see `reference/README_RU.txt`);
dimensions and power figures are estimates.

- `index.html`, `main.js`, `lib/i18n.js`: viewer (overview / plan / walk, RU / PL / EN)
- `lib/sky.js`, `lib/power.js`, `lib/water.js`, `lib/growth.js`: simulation modules (contract in `CONTRACT.md`)
- `model/witkowo.glb`: meshopt-compressed model
- Local: `python3 serve.py 8765`. Before each commit: `python3 tools/stamp.py` (cache-busts ES module imports).
