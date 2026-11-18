# Witkowo: geology, soils and terrain

Reference pack for the underground cross-section in the Witkowo agrivoltaics 3D site.
Collected 2026-11-18 from public PIG-PIB and GUGiK services.

## Site reference point

| | value |
|---|---|
| Point used here | **53.2819 N, 15.0762 E** (Agrofirma Witkowo farmyard, OSM way 672230718) |
| PL-1992 (EPSG:2180) | N 609037, E 238527 |
| Village node (OSM) | Witkowo Pierwsze 53.28209 N, 15.07450 E |
| Admin | Witkowo Pierwsze, gmina Stargard, powiat stargardzki, zachodniopomorskie |
| Map sheets | SMGP 1:50 000 sheet **268 Dolice** (N-33-103-A); 1:100 000 sheet 84 Stargard Szczecinski |

The exact position of the PV canopies was not pinned here. The Geoportal orthophoto
predates the installation. Another agent is fixing the coordinates. The geology below
holds for anywhere within about 1.5 km of the point: the same upland till plain.

## Summary (PL)

Witkowo leży na falistej wysoczyźnie morenowej na pograniczu Równiny Pyrzyckiej
i Równiny Nowogardzkiej, na wysokości około 33-37 m n.p.m. Teren jest prawie płaski
(mediana nachylenia poniżej 1 stopnia). Pod cienką warstwą gleby (gleby brunatne
na glinach lekkich i piaskach gliniastych, kompleks 2 "pszenny dobry", klasy RIIIa-RIVa)
leżą piaski pylasto-żwirowe i glina zwałowa ostatniego zlodowacenia (Wisła, faza pomorska,
ok. 17-16 tys. lat temu). Niżej, na głębokości kilkudziesięciu metrów, występują
na przemian gliny zwałowe i piaski wodnolodowcowe starszych zlodowaceń. W piaskach
między glinami jest główny poziom wód podziemnych (GZWP nr 123 Stargard-Goleniów).
Osady czwartorzędowe mają tu około 80-100 m grubości. Pod nimi leżą piaski i mułki
z węglem brunatnym (miocen) i iły eocenu, a jeszcze głębiej setki metrów margli
i kredy piszącej z górnej kredy. Czarne ziemie Równiny Pyrzyckiej zaczynają się
kilka kilometrów na zachód i południowy zachód; przy samym Witkowie dominują gleby brunatne,
a w dolinkach na północ i wschód torfy i gleby murszowe pod łąkami.

## Summary (EN)

Witkowo sits on a gently rolling ground-moraine plain where the Pyrzyce Plain meets the
Nowogard Plain, about 33-37 m above sea level. Slopes are very gentle (median under
1 degree). Under a thin topsoil (brown earths on light loam and loamy sand, agricultural
complex 2 "good wheat soil", cadastral classes RIIIa-RIVa) lies a sheet of silty-gravelly
sand and glacial till left by the last ice sheet (Vistulian, Pomeranian phase, about
17-16 thousand years ago). Below that, tills from older glaciations alternate with
meltwater sands and gravels. The sands between the tills hold the main aquifer
(Major Groundwater Basin GZWP 123 Stargard-Goleniow). The Quaternary cover is about
80-100 m thick here. Beneath it come Miocene sands and silts with lignite, Eocene clays,
then several hundred metres of Late Cretaceous marl and chalk. The famous black earths
of the Pyrzyce Plain start a few km to the west and south-west. Around Witkowo itself the
fields are brown earths, with peat and muck soils under meadows in the low ground to the
north and east.

## Layered profile for the 3D cross-section

Ground level at the site: **~35.7 m n.p.m.** (GUGiK NMT at the reference point; Witkowo I
borehole collar 36.88 m). Depths are below ground. The ranges are realistic local
variation. "Model" is a single value to draw. Elevations use model depth and ground = 35.7 m.

| # | Depth model (m) | Range of base (m) | Elevation m n.p.m. | Lithology (EN) | PL | Age | Conf. |
|---|---|---|---|---|---|---|---|
| 1 | 0 - 0.3 | 0.25-0.4 | 35.7 to 35.4 | Brown-earth topsoil (plough layer) | Gleba brunatna (poziom orny) | Holocene | high |
| 2 | 0.3 - 2 | 1-5 | 35.4 to 33.7 | Silty-gravelly glacial (ablation) sand | Piaski pyłowato-żwirowe lodowcowe (ablacyjne) | Pleistocene, Vistulian, Pomeranian phase (~17-16 ka) | high |
| 3 | 2 - 10 | 4-20 | 33.7 to 25.7 | Upper glacial till (boulder clay) | Glina zwałowa górna | Pleistocene, Vistulian, Pomeranian phase | high |
| 4 | 10 - 30 | 15-45 | 25.7 to 5.7 | Meltwater sand and gravel (upper inter-till aquifer) (aquifer) | Piaski i żwiry wodnolodowcowe (górny poziom międzyglinowy) | Pleistocene, Vistulian | medium |
| 5 | 30 - 50 | 40-60 | 5.7 to -14.3 | Older till and ice-dammed lake silt | Glina zwałowa i mułki zastoiskowe (zlodowacenia Wisły / Warty) | Pleistocene, Vistulian middle stadial to Saalian (Warta) | medium |
| 6 | 50 - 62 | 55-75 | -14.3 to -26.3 | Meltwater sand (lower inter-till aquifer) (aquifer) | Piaski wodnolodowcowe (dolny poziom międzyglinowy) | Pleistocene, Saalian | low |
| 7 | 62 - 82 | 50-100 | -26.3 to -46.3 | Grey basal till (Odra/Saalian) | Glina zwałowa szara (zlodowacenie Odry) | Pleistocene, Saalian (Odra) | low |
| 8 | 82 - 140 | top 48-100 | -46.3 to -104.3 | Miocene sands and silts with lignite seams (aquifer) | Piaski, mułki i węgiel brunatny (miocen) | Neogene, Miocene (~20-12 Ma) | medium |
| 9 | 140 - 175 | few-30 m thick, may be absent | -104.3 to -139.3 | Glauconitic marine clays and sands (Eocene, Oligocene) | Iły i piaski glaukonitowe (eocen, oligocen) | Paleogene (~50-28 Ma) | low |
| 10 | 175 - 1100 | top 150-200, base ~1000-1500 | -139.3 to -1064.3 | Late Cretaceous marl, marly limestone and chalk | Margle, wapienie margliste i kreda pisząca (kreda górna) | Cretaceous, Cenomanian-Maastrichtian (~100-70 Ma) | low |
| 11 | 1100 - 2700 | regional | -1064.3 to -2664.3 | Jurassic mudstones and sandstones; Lower Jurassic sandstone = Stargard geothermal aquifer (~2.5 km) | Mułowce i piaskowce (jura); piaskowce jury dolnej = zbiornik geotermalny Stargardu (~2,5 km) | Jurassic (~200-160 Ma) | low |
| 12 | 2700 - 4500 | regional | -2664.3 to -4464.3 | Triassic, Zechstein salt at the base | Trias (retyk i starsze), u spągu sole cechsztynu | Triassic-Permian (~260-200 Ma) | low |

Same data with colours: `data/profile_layers.json`.

Notes for the website:
- Top 100 m: drawn to scale, this is what a 3D cut under the canopies should show.
  Below that, compress the scale or use a break symbol.
- The upper till is the "floor" under the crops. It is fairly impermeable, so the
  aquifer below is confined (water rises in wells to a few metres below ground).
- Low ground and drained meadows east and north of the farm (Ina/Krapiel valley side)
  have peat 1-3 m thick over gyttja and lacustrine chalk. The documented lacustrine
  chalk deposit "Witkowo" lies there (MGSP text).
- A drumlin (pink on the SMGP crop) runs NW-SE about 1-2 km west of the farm. Mapped
  as till of drumlins (SMGP text: "W okolicach Kluczewa i Witkowa wystepuja trzy drumliny").

## Glacial history (short)

1. Mesozoic sea: Late Cretaceous marls and chalk (Cenomanian-Maastrichtian),
   850-900 m thick in this area. Below: Jurassic mudstones, Lower Jurassic
   sandstones (geothermal aquifer of Stargard, ~2.5 km), Triassic, Zechstein salt (~4-4.5 km base).
2. Paleogene-Neogene: Eocene glauconitic marine clays and sands, Oligocene septarian clays
   (eroded in places), Miocene river-and-swamp sands, silts and lignite.
3. Pre-Quaternary erosion cut the deep NW-SE Maszewo-Barlinek depression (floor ~144 m
   below sea level) east of Witkowo. Witkowo lies at its western rim, so the
   Quaternary is thinner here (tens of metres near Kluczewo, ~100 m at Witkowo, up to 200 m at Krapiel).
4. Elsterian (South-Polish) glaciations: till and ice-dammed lake silts in hollows.
5. Holsteinian (Mazovian) interglacial: river and lake sands and silts.
6. Saalian (Odra, Warta): two tills with meltwater sands and lake silts between them.
7. Vistulian: middle-stadial till, Grudziadz interstadial lake silts, then the Pomeranian
   phase ice sheet left the surface till, eskers, kames and drumlins. Ice stagnated on
   the Szczecin subphase line and the large ice-dammed lake of Pyrzyce (zastoisko pyrzyckie)
   formed to the west. Its silts are the parent material of the Pyrzyce black earths.
8. Holocene: peat, gyttja, lacustrine chalk and alluvium in the valleys. Brown-earth soils formed on the upland.

## Soils

Source: IUNG soil-agricultural map 1:5 000 (Mgr5000), served by GUGiK
(vectorised from 1950s-70s sheets). Sampled on a 7 x 7 grid, 400 m spacing, around the
reference point (`data/soil_agri_map_grid_7x7_400m.json`).

| Count (of 49) | Agricultural complex | Soil type | Typical texture |
|---|---|---|---|
| 15 | **2 - pszenny dobry** (good wheat) | B / Bw brown earths (typical / leached) | glp, gl: light silty loam / light loam |
| 11 | 2z - grassland, medium | T low peat (n = niski) | peat |
| 8 | 5 - zytni dobry (good rye) | Bw/B brown earth | pglp on pgm/gl: light loamy sand over strong loamy sand / loam |
| 5 | 4 - zytni bardzo dobry (very good rye) | Bw | pgm over gl |
| 2 | 2z - grassland, medium | E (organic-mineral, mt = peaty muck) | muck |
| 1 | 8 - zbozowo-pastewny mocny (strong cereal-fodder, wet) | A (podzolic/lessive) | pgmp over gl |
| 7 | Tz, N, Ls | built-up, wasteland, forest | |

Plain reading: the arable upland around the farm is good wheat land (complex 2, brown
earths on loam), with lighter complex 4-5 patches. No black earths (D, "czarne ziemie")
appear in the 2.4 x 2.4 km sample. They belong to the Pyrzyce lake basin further W/SW.
MGSP sheet text: soils of the area are "mainly black earths on lacustrine deposits of the
Pyrzyce basin, plus brown and lessive soils on loamy sands and tills", farmland of high
bonitation classes II-IVa.

Cadastral (EGiB) classification contours on the large farm parcels around the point
(KIEG WMS GetFeatureInfo): arable **RIIIa, RIIIb, RIVa, RIVb** (plus Br- tree-covered
arable), grassland **LIII-LIV, PsIII-PsIV** on the low ground, small RV / LsV. So arable land is
mostly class III-IV. One 89 ha parcel north-west of the point has a "Bi" (other built-up) contour.
This may be the PV area. Not verified.

## Terrain

GUGiK NMT point service, 41 x 41 grid at 50 m (2 x 2 km) centred on the reference point
(`data/dem_grid_2km_50m.json`, `.csv`, PL-EVRF2007-NH heights):

- reference point 35.7 m; grid min 19.4 m (valley floor N/NE), max 45.9 m, mean 31.1 m
- slope (central differences, 50 m cells): median 0.9 deg, 90th percentile 2.8 deg, max 11.6 deg (valley edges, pits)
- MGSP text: moraine upland of the Pyrzyce Plain at 30-40 m, lake-basin terraces 20-28 m.

## Boreholes (CBDG)

BOREHOLE_PLACEHOLDER

## Files

| File | What |
|---|---|
| `maps/smgp50k_4km.png` | SMGP 1:50 000 geology, 4 x 4 km, centre = reference point, EPSG:2180, 1200 px (3.33 m/px) |
| `maps/smgp50k_with_boreholes_4km.png` | same + CBDG borehole symbols, red ring = reference point |
| `maps/cbdg_boreholes_overlay_4km.png` | transparent borehole layer only |
| `maps/soil_agri_map_4km.png` | IUNG/GUGiK soil-agricultural map (complexes) |
| `maps/nmt_shaded_relief_4km.png` | GUGiK NMT 1 m shaded relief |
| `maps/orto_4km.png` | GUGiK orthophoto (standard resolution), pre-installation |
| `data/dem_grid_2km_50m.json/.csv` | elevation grid + slope stats |
| `data/soil_agri_map_grid_7x7_400m.json` | soil complex/type/texture per grid point |
| `data/cbdg_boreholes_within_10km.csv` | 252 CBDG boreholes within 10 km (id, depth, collar height, bottom age, coords, card URL) |
| `data/boreholes/*.json` | CBDG stratigraphic/lithologic profiles of the key boreholes |
| `data/profile_layers.json` | the profile table above as JSON for the 3D code |
| `docs/SMGP_268_Dolice_objasnienia_2004.pdf` | SMGP sheet explanation text (Sochan, Piotrowski 2004) |
| `docs/MGSP_268_Dolice_objasnienia_2009.pdf` | Geoenvironmental map sheet text (Madry et al. 2009) |

All map crops: BBOX (EPSG:2180, WMS 1.3.0 axis order N,E) = `607037,236527,611037,240527`,
i.e. 4 km square, north up, 1200 x 1200 px.

## WMS / services usable from a browser

CORS checked 2026-11-18 with an `Origin` header. "reflect" = the server echoes the
request origin, which works for `fetch`/WebGL textures.

| Service | URL | Layers | CORS |
|---|---|---|---|
| SMGP 1:50 000 (PIG-PIB) | `https://cbdgmapa.pgi.gov.pl/arcgis/services/kartografia/smgp50k/MapServer/WMSServer` | 0 units, 1 areas, 2 boundaries, 3 lines, 4 points, 5 sheet index | reflect |
| SMGP REST (identify/query, JSON) | `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/smgp50k/MapServer/5/query` | unit name/genesis/age | reflect |
| CBDG boreholes WMS | `https://cbdgmapa.pgi.gov.pl/arcgis/services/cbdg_otwory/MapServer/WMSServer` | 0 | reflect |
| CBDG boreholes features (JSON) | `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/cbdg_otwory_web/FeatureServer/0/query` | attributes incl. depth, collar, bottom age | reflect |
| Geological map 1:500 000 (2022) | `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/mgp500k_2022/MapServer` | Quaternary, Paleogene-Neogene, pre-Cenozoic | reflect (same host) |
| Map without Cenozoic 1:1M | `https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/kartografia/mgpbk1000k/MapServer` | at site: Maastrichtian (Km) | reflect (same host) |
| Soil-agricultural map (GUGiK, IUNG data) | `https://mapy.geoportal.gov.pl/wss/service/pub/guest/MapaGlebowoRolnicza/MapServer/WMSServer` | 0 KONTURY_GLEBOWE, 1 range, 2 soil pits; GetFeatureInfo `application/geo+json` works | reflect |
| Cadastre incl. classification contours (KIEG) | `https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow` | dzialki, kontury, uzytki, ... | `*` |
| NMT shaded relief | `https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WMS/ShadedRelief` | Raster | `*` |
| NMT point heights (text) | `https://services.gugik.gov.pl/nmt/?request=GetHbyXY&x=<N>&y=<E>` (EPSG:2180; also `GetHByPointList&list=N E,N E`) | | `*` |
| Orthophoto | `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution` | Raster | `*` |

Caveats: cbdgmapa.pgi.gov.pl and bazadata.pgi.gov.pl sit behind Imperva. Plain `curl`
works for the map services, but the PDF archive needs a real browser. The
CBDG borehole API (`otworywiertnicze.pgi.gov.pl/boreholes/<id>/...`) has no CORS
for other origins (403 on Origin) and is rate-limited hard (HTTP 429). Don't call it
from the website; use the JSON copies here.

Example GetMap (copy into a browser):
```
https://cbdgmapa.pgi.gov.pl/arcgis/services/kartografia/smgp50k/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&CRS=EPSG:2180&BBOX=607037,236527,611037,240527&WIDTH=1200&HEIGHT=1200&LAYERS=0,1,2,3,4&STYLES=&FORMAT=image/png
```

## Sources and licences

- Sochan A., Piotrowski A., 2004. *Objasnienia do Szczegolowej mapy geologicznej Polski 1:50 000, ark. Dolice (268)*. PIG, Warszawa.
  https://bazadata.pgi.gov.pl/data/smgp/arkusze_txt/smgp0268.pdf
- Madry S. et al., 2009. *Objasnienia do Mapy geosrodowiskowej Polski 1:50 000, ark. Dolice (268)*. PIG-PIB.
  https://bazadata.pgi.gov.pl/data/mgsp/txt/mgsp0268.pdf
- CBDG boreholes: https://otworywiertnicze.pgi.gov.pl (card per borehole: `/details/<id>`).
- PIG-PIB map services: https://cbdgmapa.pgi.gov.pl/arcgis/rest/services
- PIG-PIB terms: free use of geological information with attribution "PIG-PIB"
  (https://www.pgi.gov.pl/rejestry-i-bazy-danych-geologicznych/zasady-korzystania-z-isp.html).
  Cite the source on the website: "Dane geologiczne: PIG-PIB (SMGP 1:50 000, CBDG)".
- GUGiK (Geoportal) data: soil-agricultural map, NMT, orthophoto, EGiB are open under the 2020
  amendment of the Geodetic and Cartographic Law (free, attribution "GUGiK" / "geoportal.gov.pl").
  The soil-agricultural map is marked "illustrative" by GUGiK.
- Stargard geothermal (Lower Jurassic sandstones ~2.5 km): globenergia.pl,
  https://globenergia.pl/jak-feniks-z-popiolow-czyli-krotka-historia-geotermii-stargard/
- AgrofarmaPV / ZUT project context: https://www.gramwzielone.pl/?p=20368278

## Confidence

CONFIDENCE_PLACEHOLDER
