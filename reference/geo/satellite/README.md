# Witkowo agri-PV: satellite and aerial reference

Collected 2026-11-18. Site: Agrofirma Witkowo, Witkowo Pierwsze, gmina Stargard, zachodniopomorskie.
Agri-PV pilot of ZUT + Energia Pomorze (AgrofarmaPV, NCBiR).

## Coordinates

| what | WGS84 lat, lon | EPSG:2180 (x=E, y=N) | EPSG:2176 (PL-2000 z.5) | UTM 33N (EPSG:32633) |
|---|---|---|---|---|
| plot centroid (S2-derived) | 53.28976, 15.06804 | 238032.0, 609943.6 | 5504537.0, 5906414.8 | 504535, 5904507 |
| phone GPS of trip photos/videos (2026-11-03) | 53.2886, 15.0688 | 238075.6, 609811.9 | | |

- The phone GPS comes from the EXIF/QuickTime metadata of the 17 trip files
  (`ZUT_Witkowo_media`, IMG_9400-9417). They all fall within about 100 m of each other,
  at the south corner of the plot by the Agrofirma parking lot.
- The plot was found on Sentinel-2 imagery. It is a new rectangular block in the field north of the Agrofirma
  buildings and parking lot, between the road (to the SW) and the railway (to the NE). It is absent through
  2025-07-01 and first visible on 2025-11-08 (construction). From 2026-05 on it is clearly distinct.
- Approximate outline: `agripv_plot_outline.geojson`. It was made by thresholding Sentinel-2 pixels from 2026-08-27
  and taking their convex hull. It covers about 2.3 ha of 10 m pixels, which matches the 2 ha first stage in
  the press reports. The long axis runs about 129 deg / 309 deg (NW-SE, parallel to the road) and measures about 250 x 95 m.
- Confidence: the location is high, within about 20 m. The phone GPS and the Sentinel-2 change agree. The outline and
  orientation are medium confidence: the pixels are 10 m and the hull includes the margins. These are not surveyed dimensions.
- **There is NO open high-resolution image that shows the installation.** The newest Geoportal orthophoto here
  was flown 2025-04-13, before construction. Esri World Imagery is a 2020-05-10 WV02 image. Google and Bing tiles,
  checked visually and not saved, also predate it. Only Sentinel-2 (10 m) shows the structure so far. Watch for a
  2026 Geoportal flight: the index layer `gugik:SkorowidzOrtofomapy2026` was empty for this point on 2026-11-18.

## Files

All crops are centred on the plot centroid. Each image has a world file (`.jgw` / `.pgw`) in its own CRS.
`sources.json` has the exact request URL, bbox, CRS and m/px for every file.

### Geoportal orthophoto (GUGiK), EPSG:2176, north-up

EPSG:2176 is used because its central meridian is 15 E. Grid north is true north to within 0.06 deg, and the units are metres.

| file | flight date | extent | m/px | note |
|---|---|---|---|---|
| `ortho_2025-04-13_1000m.jpg` | 2025-04-13 | 1000 m | 0.5 | current layer; site is still an empty field |
| `ortho_2025-04-13_400m_texture.jpg` | 2025-04-13 | 400 m | 0.25 | **best ground texture** (1600 px) |
| `ortho_2025-04-13_200m.jpg` | 2025-04-13 | 200 m | 0.25 | close-up of the plot area |
| `ortho_2023_1000m.jpg` | 2023-05-08 | 1000 m | 1.0 | historical, bare field |
| `ortho_2020_1000m.jpg` | 2020-09-12 | 1000 m | 0.5 | historical |
| `ortho_2014_1000m.jpg` | 2014-07-18 | 1000 m | 0.5 | historical (source 0.5 m) |
| `ortho_2012_1000m.jpg` | 2012-04-28 | 1000 m | 0.5 | historical; mosaic seam visible |

Sources:
- current images: WMS `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution`, layer `Raster`
- historical images: WMS `.../ORTO/WMS/StandardResolutionTime`, layer `Raster`, with
  `TIME=YYYY-01-01T00:00:00.000Z/YYYY-12-31T00:00:00.000Z`

Flight dates come from the WFS index `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WFS/Skorowidze`
(`gugik:SkorowidzOrtofomapyYYYY`, sheet N-33-103-A-a-4-1).

The 2017 0.25 m RGB sheet is not served by the time WMS, but the full GeoTIFF can be downloaded:
`https://opendata.geoportal.gov.pl/ortofotomapa/66582/66582_625290_N-33-103-A-a-4-1.tif`. The full 2025 RGB sheet is at
`https://opendata.geoportal.gov.pl/ortofotomapa/83832/83832_1513774_N-33-103-A-a-4-1.tif`. Both are large and were not downloaded.
The `HighResolution` service has a hole over this site (white), so don't use it here.

### Sentinel-2 L2A true colour (TCI), EPSG:32633 (UTM 33N, true north-up)

These are window reads of the `visual` COG from Earth Search (Element84, AWS open data), tile 33UWV.

- `*_10m.png`: native pixels, 100 px for 1 km and 200 px for 2 km, snapped to the 10 m grid.
- `*_x8.png`: Lanczos upscale (1.25 m/px), for viewing only. It adds no detail.

| date | scene | state of the plot |
|---|---|---|
| 2024-05-17 | S2A_33UWV_20240517_0_L2A | field, nothing built |
| 2025-07-01 | S2C_33UWV_20250701_0_L2A | field, nothing built |
| 2025-11-08 | S2C_33UWV_20251108_0_L2A | rectangle appears (construction) |
| 2026-05-02 | S2B_33UWV_20260502_0_L2A | rectangle, two-tone (bare beds) |
| 2026-06-26 | S2C_33UWV_20260626_0_L2A | rectangle, crops under canopies |
| 2026-08-27 | S2A_33UWV_20260827_1_L2A | green plot inside a harvested field (clearest) |

`s2_timeline_1000m.jpg` is the before/after strip of the six 1 km crops.

Each COG URL follows this pattern:
`https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/33/U/WV/<yyyy>/<m>/<scene>/TCI.tif`.
`scripts/s2_stac_search.json` lists every scene with less than 5 % cloud from 2023-04 to 2026-11.

### Other files

- `agripv_plot_outline.geojson`: approximate plot polygon, centroid, and phone-GPS point (WGS84).
- `sources.json`: per-file URL, CRS, bbox, resolution and date.
- `scripts/`: `build_geo.py` (downloads everything; needs rasterio + pyproj), `outline.py` (makes the polygon), `puwg.py` (dependency-free EPSG:2180 forward/inverse).

## Best image for the 3D ground texture

Use `ortho_2025-04-13_400m_texture.jpg`: 1600 x 1600 px, 0.25 m/px, 400 x 400 m, north-up.

- Its centre is the plot centroid. Map it to a 400 x 400 m plane centred on the model origin.
- +x is east and -z is north. Rotate the model so its long axis follows a bearing of about 129 deg.
- It shows the actual field, road, trees and parking lot before construction, so the modelled canopies sit on empty ground.
- For a wider backdrop, use `ortho_2025-04-13_1000m.jpg` (0.5 m/px).
- Sentinel-2 is only useful as a "this is where it is now" inset.

## Licences and attribution

- **Geoportal / GUGiK orthophoto**: open data. Since 31.07.2020 (Prawo geodezyjne i kartograficzne, art. 40a ust. 2 pkt 1)
  orthophotos are free to use without a licence, commercial use included. Attribution:
  "Ortofotomapa: Główny Urząd Geodezji i Kartografii, geoportal.gov.pl" (short: "© GUGiK").
- **Sentinel-2**: Copernicus data is free, full and open (EU Reg. 1159/2013). Attribution:
  "Contains modified Copernicus Sentinel data 2024-2026". Distribution via the Earth Search / AWS Registry of Open Data needs no key.
- **Not saved and not reusable without a licence**: Esri World Imagery (Vantor/Maxar), Google and Bing tiles.
  Esri may be shown live in a map with "Esri, Vantor, Earthstar Geographics" attribution under Esri's terms.
  It is older than the installation anyway.

## Tile URLs usable directly from a web page (CORS checked 2026-11-18)

| source | URL template | CORS | notes |
|---|---|---|---|
| Geoportal ortho WMTS, Web Mercator (Leaflet `L.tileLayer`) | `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}` | `*` | standard Google z/x/y grid up to z19; attr "© GUGiK" |
| Geoportal ortho WMS (Leaflet `L.tileLayer.wms` or one GetMap for a three.js texture) | `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Raster&STYLES=&SRS=EPSG:2176&BBOX=5504337.03,5906214.81,5504737.03,5906614.81&WIDTH=2048&HEIGHT=2048&FORMAT=image/jpeg` | `*` | the BBOX is the 400 m texture; also takes EPSG:3857/4326/2180; image is cross-origin safe for WebGL (`crossOrigin='anonymous'`) |
| Geoportal historical WMS | `.../ORTO/WMS/StandardResolutionTime?...&LAYERS=Raster&TIME=2023-01-01T00:00:00.000Z/2023-12-31T00:00:00.000Z` | `*` | slow at large sizes; at most about 1000 px per request |
| Sentinel-2 COG (geotiff.js / georaster in browser) | `https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/33/U/WV/2026/8/S2A_33UWV_20260827_1_L2A/TCI.tif` | `*` | HTTP range requests work; 10 m |
| Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | `*` | 2020 imagery here; Esri terms |
| EOX Sentinel-2 cloudless | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg` | origin echoed | 2024 mosaic, predates the plot; CC BY-NC-SA 4.0 |

For a three.js ground texture, the safest choice is the local file. If you want it live, use one Geoportal WMS GetMap with the BBOX above.
