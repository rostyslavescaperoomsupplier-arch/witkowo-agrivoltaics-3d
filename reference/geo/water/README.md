# Water resources: Witkowo Pierwsze (Agrofirma Witkowo, ZUT agrivoltaics)

Compiled 2026-11-18. All numbers below come from the files in this folder or from the live services listed. Each one names its source.

## Reference point

| | |
|---|---|
| Point used for all queries | **53.2821 N, 15.0745 E** (village node of Witkowo Pierwsze, OSM node 692620726, gmina Stargard, powiat stargardzki) |
| Ground elevation | about 35 m a.s.l. (Agrofirma wells: 34.8 to 35.2 m) |
| Agrivoltaic plot | Exact plot not located. Press reports say "on Agrofirma Witkowo land near Stargard". All values are for the village area. They hold for roughly 2 km around it, except where a unit boundary is noted below. |

## 1. Groundwater

### MHP 1:50 000 (Mapa hydrogeologiczna Polski, GUPW), sheet 268 Dolice (N-33-103-A)
Sources: the explanatory text `sources/mhpgupw0268_objasnienia_Dolice.pdf` (PIG 2004, P. Fuszara, J. Prażak; full text in `.txt`), plus GetFeatureInfo on the ePSH MHP WMS.

The village sits **on the boundary between two hydrogeological units**. It is about 5 km east of the 267/268 sheet edge. The Ina valley unit is 2 to 3 km north.

| | Unit north/east of village: **3 QIIb/Q** (WMS label "3 bQII/Q") | Unit south/west: text unit **1 QIIab/Tr** (WMS label "7 aQII/Tr") |
|---|---|---|
| Main usable aquifer (GUPW) | Quaternary intermorainic (upper), fine and medium sands, confined | Quaternary intermorainic (upper), fluvioglacial sands with gravel, confined |
| Static water level | 1.2 to 14.5 m bgl | 1.8 to 12.5 m bgl |
| Thickness (mean) | 11.2 m (5 to 23 m) | 15.6 m (5 to 34 m) |
| k (mean) / T | 24.0 m/d / 269 m2/d | 23.5 m/d / 367 m2/d (table 2) |
| Potential well yield | **70 to 120 m3/h** (WMS class >70) | **50 to 70 m3/h** north part, 30 to 50 m3/h south (WMS at village: 50 to 70) |
| Renewable resource modulus | 171 m3/d/km2 | 228 m3/d/km2 |
| Disposable resource modulus | 120 m3/d/km2 | 114 m3/d/km2 |
| Vulnerability (stopień zagrożenia) | low (good isolation) | medium (weak isolation) |
| Water quality class | **IIb** (medium quality; Fe and Mn elevated, needs simple treatment) | **IIb** (Fe, Mn) |
| Area | 39.4 km2 | 78.4 km2 |
| Secondary aquifer | lower intermorainic (isolated) | Tertiary (Miocene) |

The two unit numberings disagree. The WMS polygon south of the village carries the label "7 aQII/Tr". In the 2004 text, unit 7 is a 1.8 to 4.1 km2 unit in the Płonia valley, and the large unit that matches this position and its description is unit 1. Treat the column mapping as medium confidence.

Sheet-wide facts from the text:
- Regional renewable groundwater runoff is 285 m3/d/km2. The "inviolable" flow (NNq) is 64. The hydrological disposable modulus is 221 m3/d/km2.
- The Tertiary aquifer starts at 98 m in Witkowo (well 41). Mean thickness is 32.5 m and T is 933 m2/d sheet-wide.
- Groundwater flows NW and drains to the Ina.
- Agrofirma Witkowo owns several water intakes. Stargard's intake (ul. Warszawska, 23 wells) draws more than 10 000 m3/d (10 750 m3/d in 2002).

Agrofirma Witkowo wells from MHP table 1a are in `groundwater/mhp_agrofirma_witkowo_wells.csv`:
- Witkowo-4: 96 m deep, Q aquifer at 79.5 to 96 m, test 51.6 m3/h at 17.7 m drawdown.
- Witkowo-1A: 127 m deep, Miocene, test 34.5 m3/h.
- Przewłoki, Radziszewo, Morzyca: shallow Q wells 19 to 34 m, approved 32 to 55 m3/h.

The well 40 chemistry (2003) gives EC 612 uS/cm, pH 7.3, Fe about 1.9 mg/l, Mn about 0.13 mg/l, NO3 about 0.1 mg/l. These values were parsed from a broken PDF table, so check them against the PDF before you cite them.

### Resources (zasoby dyspozycyjne)
- **Balance area S-VI "Ina"** (ePSH `zasoby-obbil-wms`, as of 31.12.2025): 2506.42 km2, disposable resources **280 200 m3/d**.
- **Hydrogeological documentation CAG 415/2005** (zasoby dyspozycyjne of the Ina, Płonia and Gowienica catchments, together with GZWP 123; PROXIMA 2004; approved 28.06.2005): 4113.6 km2, **419 600 m3/d** (ePSH `zasoby-dh-wms`).
- Stargard resource area (300 km2, from the MHP text): Q = 4313 m3/h at s = 2 to 20 m, of which 2721 m3/h is infiltration water.

### GZWP (main groundwater reservoir)
- **GZWP 123 "Zbiornik międzymorenowy Stargard-Goleniów"**: Quaternary, porous. Documented 2004, with a 2011 addendum on protection areas. Area **378 km2**. Depth 15 to 58 m (mean 30 m). The MHP text cites estimated disposable resources of **38.4 thousand m3/d** (Kleczkowski 1990).
- The village is **outside it**, about 1.1 km from its southern tip (vertex distance). The polygon is in `groundwater/gzwp123.geojson`.
- The next nearest are GZWP 135 Barlinek (31 km), 122 Dolina kopalna Szczecin (38 km), 136 Dobiegniew (45 km) and 125 Wałcz-Piła (47 km).

### JCWPd (groundwater body)
- **JCWPd 7 (PLGW60007)**, 2328 to 2330 km2, Odra basin, Lower Odra and West Pomerania water region. Status in the 2028-2033 cycle (assessment 2022) is **good** for chemical, quantitative and overall status, and the 2025 risk assessment is **not at risk**. The 2016-2021 cycle also rates it good on all counts.
- Factsheet (old cycle, https://bazadata.pgi.gov.pl/data/hydro/jcwpd/jcwpd7.pdf): registered abstraction 2011 was 11 225.63 thousand m3/yr. Resources available for development are **255 346 m3/d** (12 % used).
- The village is only about 1 to 2 km from the boundary with **JCWPd 24 (PLGW600024)**: 1310 km2, good status, not at risk, 130 254 m3/d available, 11 % used (https://bazadata.pgi.gov.pl/data/hydro/jcwpd/jcwpd24.pdf).
- The JCWPd 7 polygon is in `groundwater/jcwpd7_2028_2033.geojson`.
- The factsheet PDFs could not be saved (browser blocks the second download from bazadata). Open the links above directly.

### PSH monitoring wells (MWP) and water-table series
39 points within 30 km are in `groundwater/mwp_wells_30km.csv` and `.geojson`. The relevant ones:

| Point | Distance | Type | Notes |
|---|---|---|---|
| **II/1831/1 Kurcewo** (CBDH 2680229, PLGW60007_010) | 3.1 km SSW | piezometer, 20.3 m, unconfined, Quaternary | Observed since 2015, weekly. Latest: 6.47 m bgl on 2026-09-07 and 2026-09-14. Only the last 2 readings are public. |
| **II/1103/1 Koszewko** (2670089) | 10.1 km W | piezometer 16 m, unconfined, automatic since 2005 | **Hourly series 2026 downloaded** |
| **II/1761/1 Trzebień** (2680225) | 9.2 km SE | piezometer 25 m, confined, automatic since 2012 | **Hourly series 2026 downloaded** |
| II/1541/1 Kłęby | 8.2 km SSW | piezometer 20 m, confined | latest 1.80 m bgl (2026-09) |
| II/432/2, II/432/3 Rogowo | 13.9 km NW | closed 2022 | |

Time series (CSV: date, depth_m_bgl, level_m_asl):
- `groundwater/psh_II-1103-1_Koszewko_daily_2026.csv`: 2025-12-31 to 2026-11-18. Depth is 6.23 to 6.43 m bgl, level about 19.4 to 19.6 m a.s.l. (ground 25.8 m).
- `groundwater/psh_II-1761-1_Trzebien_daily_2026.csv`: depth 11.37 to 11.91 m bgl (ground 46.8 m).
- The raw hourly files (`*_hourly_raw_2026.csv`) are **unvalidated** PIG-PIB data ("dane pomiarowe bez walidacji"). The service only keeps the current year.

Drought indicators (niżówki hydrogeologiczne): no free per-well historical series or niżówka thresholds were found. PSG publishes monthly "Ostrzeżenie hydrogeologiczne" notices (for example nr 6/2026 for July 2026) on pgi.gov.pl under PSH. The validated multi-year series (Koszewko since 2005, Kurcewo since 2015) are held in the restricted "Baza Danych Monitoringu Ilościowego" and are available on request from PSH.

## 2. Surface water

Hydrography (OSM, way-centre distances): Kanał Rzepliński 0.9 km, **Mała Ina** about 2 km, **Ina** about 3.6 km, **Krąpiel** about 5.5 km. **Miedwie lake** (Szczecin's main drinking-water reservoir) is about 10 km W and lies in the Płonia catchment. The village is in the **Ina catchment**, an Odra tributary 129 km long. The MHP text rated the Ina and Mała Ina "pozaklasowe" (below class) in 2004, and the Krąpiel class III.

IMGW-PIB stations used (codes from danepubliczne.imgw.pl):

| Station | River | Distance | Data |
|---|---|---|---|
| 153150010 Stargard | Ina | 7.9 km N | H, Q |
| 153150020 Morzyca | Mała Ina | 9.5 km SE (upstream) | H, Q |
| 153150040 Gogolewo | Krąpiel | 12.9 km NE | Q only to 2013, again from 2024 |
| 153140200 Morzyczyn | jez. Miedwie | 13 km NW | lake level H since 2018 |
| 153140090 Goleniów | Ina | 35 km NNW | closing profile of the Ina |
| 153140100 Żelewo | Płonia | 14 km W | H, Q |

Flow characteristics 1991-2020 (`surface/imgw_flow_characteristics_1991_2020.csv`):
- I computed these from the IMGW monthly min, mean and max data. SNQ is the mean of annual minima of monthly minimum flow.

| Station | NNQ | SNQ | SSQ (mean flow) | SWQ |
|---|---|---|---|---|
| Ina Stargard | 0.63 | 2.62 | **8.91 m3/s** | 28.1 |
| Mała Ina Morzyca | 0.028 | 0.18 | 1.05 | 4.0 |
| Krąpiel Gogolewo | 0.049 | 0.51 | 3.04 | 14.3 |
| Ina Goleniów | 1.94 | 5.84 | 13.16 | 34.1 |
| Płonia Żelewo | 0.09 | 0.69 | 2.30 | 5.3 |

Recent dry years:
- The Ina at Stargard averaged 5.5 to 6.0 m3/s in 2019-2023, which is about 65 % of SSQ.
- Days below SNQ at Stargard by hydrological year: 92 in 2021, 88 in 2022, **146 in 2023**, 17 in 2024 and 52 in 2025.
- The Mała Ina fell to 0.03 to 0.04 m3/s in 2020, 2021 and 2023.
- The Miedwie level (gauge) ranged 45 to 111 cm over HY2021-2025.

Files:
- `surface/imgw_daily_hy2021-2025.csv`: date, station, H_cm, Q_m3s. Covers 2020-11-01 to 2025-10-31 (hydrological years).
- `surface/imgw_monthly_1951_2025.csv`: month, station, stat (min/mean/max), H_cm, Q_m3s.

## 3. Agricultural drought (IUNG-PIB SMSR)

`iung_drought_gmina_stargard_2020_2026.csv` contains the share of gmina Stargard (TERYT 3214102, rural) area at drought risk, in %, per crop and per 60-day KBW period 1 to 14 (21 March to 30 September). Source: https://susza.iung.pulawy.pl/wykazy/{year},3214102/

Maximum share per year:

| Year | Spring cereals | Maize | Rapeseed | Fruit bushes |
|---|---|---|---|---|
| 2020 | 45 % | 57 % | 81 % | 68 % |
| 2021 | 63 % | 9 % | 16 % | 47 % |
| 2022 | 73 % | 19 % | 0 % | 15 % |
| **2023** | **99.6 %** | 75 % | 96 % | 96 % |
| 2024 | 4 % | 0.6 % | 13 % | 0.4 % |
| 2025 | 22 % | 0 % | 3 % | 1 % |
| 2026 | 4 % | 4 % | 0 % | 0 % |

KBW (klimatyczny bilans wodny) is only published as national raster PNGs, not as gmina numbers. The maps in `maps/iung_KBW_2023_06.png`, `iung_KBW_2023_10.png` and `iung_KBW_2026_14.png` have no legend. URL pattern: `https://susza.iung.pulawy.pl/static/smsr_maps/{year}/KBW_{year}_{period}.png`.

## 4. Map crops (`maps/`)
All crops are centred on the reference point, in EPSG:3857, 1024 x 1024 px. Box size is in ground km, and the bbox is in EPSG:3857 metres.

| File | Content | BBOX |
|---|---|---|
| mhp_gupw_yield_box10km.png | MHP GUPW yield classes, units, hydroisohypses | 1669723,7026987,1686449,7043713 |
| mhp_gupw_units_box30km.png | MHP units with labels, sheet grid | 1652997,7010261,1703174,7060439 |
| orto_box10km.png | GUGiK orthophoto (StandardResolution) | 1669723,7026987,1686449,7043713 |
| mwp_wells_box40km.png | PSH monitoring points | 1644634,7001898,1711537,7068802 |
| gzwp_box50km.png | GZWP (123 visible, N of centre) | 1636271,6993535,1719900,7077165 |
| jcwpd_2028_box80km.png | JCWPd 2028-2033 (7 / 24 boundary near centre) | 1611182,6968447,1744989,7102254 |
| obszar_bilansowy_box120km.png | groundwater balance areas | 1577730,6934995,1778441,7135706 |

## 5. Endpoints usable from a browser (CORS checked 2026-11-18 with an `Origin` header)

| Service | URL | Layers | CORS |
|---|---|---|---|
| MHP GUPW yield (ePSH) | https://epsh.pgi.gov.pl/mhpgupw-kompozycja-wydajnosc-wms/service.svc/get | `Wydajność_potencjalna_*`, `Brak_GUPW`, `Jednostka_hydrogeologiczna`, `Symbol_jednostki`, `Hydroizohipsy`, `Rzeki`; GetFeatureInfo text/html, text/xml | `*` (caps + GetMap) |
| Balance areas (ePSH) | https://epsh.pgi.gov.pl/zasoby-obbil-wms/service.svc/get | `Obszary_bilansowe` | `*` |
| Resource documentations (ePSH) | https://epsh.pgi.gov.pl/zasoby-dh-wms/service.svc/get | `Dokumentacje_hydrogeologiczne` | not checked separately (same host) |
| GZWP (ePSH) | https://epsh.pgi.gov.pl/gzwp-wms/service.svc/get | `GZWP_udokumentowane`, ... | **none** (GetMap came back blank at 50 km in my test) |
| GZWP (ArcGIS) | https://cbdgmapa.pgi.gov.pl/arcgis/services/hydrogeologia/gzwp/MapServer/WMSServer | `0,1,2` | reflects Origin (OK) |
| JCWPd | https://cbdgmapa.pgi.gov.pl/arcgis/services/hydrogeologia/jcwpd/MapServer/WMSServer | WMS `0`=2028-33, `1`=2022-27, `2`=2016-21, `3`=2010-15 (REST ids differ: 5,2,1,0) | reflects Origin |
| Monitoring wells | https://cbdgmapa.pgi.gov.pl/arcgis/services/hydrogeologia/mwp/MapServer/WMSServer | `0` | reflects Origin |
| ArcGIS REST (JSON/GeoJSON queries) | https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/hydrogeologia/{gzwp,jcwpd,mwp,mwp_auto}/MapServer | mwp table 1 = last 2 readings; mwp_auto table 2 = hourly current year (`where=PSH_MONITORING_ID=2228`) | reflects Origin |
| IMGW live hydro API | https://danepubliczne.imgw.pl/api/data/hydro/ | JSON, current H/Q | `*` |
| IMGW archive | https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_hydrologiczne/ | zip CSV | none (download server-side) |
| GUGiK orthophoto | https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution | `Raster` | `*` |
| IUNG SMSR | https://susza.iung.pulawy.pl/ | HTML tables, PNG | none |

Plain `<img>` WMS tiles work everywhere. CORS only matters for `fetch`, canvas readback and WebGL textures. For three.js textures, use the endpoints marked `*` or "reflects Origin".

The bazadata.pgi.gov.pl PDFs sit behind Incapsula bot protection: curl gets a JS challenge, so download them in a normal browser.

## 6. Licences / attribution
- **PIG-PIB / PSH** (MHP, GZWP, JCWPd, MWP): published free of charge on PIG-PIB geoportals. Attribute "Źródło: PIG-PIB (PSH)". I found no formal open licence on these services, so check before redistributing.
  - The MHP explanatory text is © PIG / Ministerstwo Środowiska 2004 and is included here for reference only.
  - The mwp_auto data is unvalidated.
- **IMGW-PIB**: public data under the IMGW-PIB terms of use for "dane publiczne". The required attribution is "Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy", and processed data must be marked as processed. The monthly, daily and characteristics files here are processed (filtered and converted).
- **GUGiK orthophoto**: free use (PZGiK, open since 2020). Attribute "GUGiK".
- **IUNG-PIB SMSR**: © IUNG-PIB. No explicit open licence. Cite "System Monitoringu Suszy Rolniczej, IUNG-PIB".
- **OpenStreetMap** (geocode, waterways): ODbL, "© OpenStreetMap contributors".

## 7. Gaps and confidence
- **High confidence**: GZWP 123 attributes and distance, JCWPd 7 status, balance-area resources, IMGW flows, IUNG shares, MHP unit parameters as written in the text.
- **Medium confidence**:
  - Which MHP unit the actual agrivoltaic plot falls in, because the plot location is unknown and the village sits on a boundary.
  - The WMS-to-text unit-number mapping.
  - Well chemistry parsed from the PDF tables.
- **Missing**:
  - Long-term validated groundwater-level series and niżówka thresholds for PSH wells (restricted, need a data request).
  - Gmina-level KBW numbers (IUNG only shows maps; you could compute them from IMGW synop data at Szczecin plus Penman PET).
  - The JCWPd factsheet PDFs were not saved locally.
  - IMGW daily data before HY2021 was not downloaded. Monthly data covers 1951-2025.
  - No surface-water quality data newer than the MHP 2004 text (GIOŚ PMŚ would be the source).
