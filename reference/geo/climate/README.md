# Climate history: Witkowo Pierwsze (gm. Stargard)

Built 2026-11-18 by `build_climate.py` from the raw downloads in `raw/`.

## Location

- Witkowo Pierwsze village (OSM node 692620726): **53.2821 N, 15.0745 E**, gmina Stargard, powiat stargardzki, zachodniopomorskie. This point was used for every Open-Meteo request.
- The OSM "Agrofirma Witkowo" farmyard polygon sits at 53.348 N, 15.063 E (on the Stargard side, Przedmieście Barnimowskie). It is about 7 km north of the village and inside the same ERA5 cell neighbourhood, so the numbers apply to both.
- ERA5 snaps to the 0.25° cell centred at **53.25 N, 15.00 E** (model elevation 38 m). ERA5-Land (snow depth only) uses 0.1° cells.

## Key numbers (ERA5, last full year 2025)

| | 1961-1990 | 1991-2020 | 2016-2025 |
|---|---|---|---|
| Annual mean temperature | 8.28 °C | 9.32 °C | 10.17 °C |
| Frost days (Tmin < 0) | 87.8 | 76.7 | 64.1 |
| Hot days (Tmax >= 30), ERA5 | 1.8 | 4.8 | 7.0 |
| Hot days (Tmax >= 30), IMGW Szczecin | n/a (daily from 1966) | 7.6 | 9.8 |
| Growing season length (ETCCDI, Tmean > 5 °C) | 235 d | 251 d | 266 d |
| Precipitation, ERA5 | 667 mm | 633 mm | 645 mm |
| Precipitation, IMGW Szczecin gauge | | 567 mm | |
| GHI (global horizontal irradiation) | 1006 kWh/m² | 1065 kWh/m² | 1091 kWh/m² |
| Snow-cover days (>= 1 cm), ERA5-Land | 81 | 63 | 44 |
| Snow-cover days (>= 1 cm), IMGW Szczecin | | 24 | |
| Sunshine, IMGW Szczecin (heliograph) | | 1739 h | |

- **Warming:** 2016-2025 averaged +1.9 °C above 1961-1990.
- **Trends (OLS on annual means):** 1940-2025 +0.28 °C/decade; 1961-2025 +0.37; 1981-2025 +0.46; 1991-2025 +0.52. The IMGW Szczecin station gives +0.38 °C/decade for 1961-2025, which matches ERA5.
- **Warmest years:** 2024 (11.16 °C), 2019 (10.70), 2020 (10.49), 2014 (10.36), 2018 (10.35). **Coldest years:** 1940 (5.85), 1941, 1956, 1942, 1996 (7.00).
- **Extremes in the ERA5 cell:** highest Tmax 37.0 °C (1992); lowest Tmin -27.3 °C (1942). Grid-cell extremes are smoother than station extremes.
- **Agro (1991-2020):** GDD base 5 °C ~2105, base 10 °C ~1055; 31 summer days (Tmax >= 25 °C); 23 ice days; ET0 (FAO) ~696 mm/yr. ET0 is higher than precipitation, so the site has a summer water deficit.
- **Monthly normals 1991-2020 (ERA5 Tmean):** Jan 0.2, Feb 1.1, Mar 3.9, Apr 9.0, May 13.4, Jun 16.6, Jul 18.8, Aug 18.5, Sep 14.2, Oct 9.4, Nov 4.7, Dec 1.5 °C.
- **PV irradiation 1991-2020 (from hourly ERA5):** GHI 1065 kWh/m²/yr, of which beam-horizontal 592 and diffuse 473, so the diffuse fraction is 0.44. DNI is 1171 kWh/m²/yr. GHI by month runs from 15 kWh/m² in December to 162 kWh/m² in June, which is 0.49 to 5.4 kWh/m²/day. Recent years are about 1090-1110 kWh/m²/yr, with 2018 the highest at 1176.
- **Solstice daily cycle (1991-2020, ±7 days):**
  - 21 June: minimum about 12.5 °C around 04-05 CEST, maximum about 20.2 °C around 15-16 CEST, GHI peaks around 560 W/m² at about 13 CEST.
  - 21 December: almost flat, about 0.6 °C at night and 2.3 °C at 14 CET, GHI peaks around 100 W/m².
- **2026 so far (1 Jan to 17 Nov, 316 days):** mean 10.56 °C. This is a partial year, so it is not comparable with annual means. It is flagged `complete=False`, and its sums are blanked in `annual.csv`.

## Files

| File | Content |
|---|---|
| `annual.csv` | One row per year 1940-2026. Columns: ERA5 tmean/tmax/tmin, absolute extremes, frost/ice/summer/hot days, tropical nights, GSL with start/end dates, GDD5/GDD10, precip, snowfall, ERA5 sunshine, GHI kWh/m², ET0, snow-cover days, anomalies vs 1961-1990 and 1991-2020, plus IMGW Szczecin (`sz_*` from daily data 1966+, `imgw_szczecin_tmean`/`precip` from monthly data 1951+) |
| `monthly_normals.csv` | Normals for 1961-1990 and 1991-2020 per month: ERA5 T, extremes, frost/hot days, precip, sunshine, GHI (monthly and per day), snow-cover days, and the matching IMGW Szczecin normals |
| `hourly_profiles.csv` | 24 h profiles for 21-Jun (CEST) and 21-Dec (CET), 1991-2020. Exact-date mean with P10/P90, a ±7-day window mean, GHI/DNI/DHI and cloud cover |
| `annual_irradiation_hourly.csv` | Annual GHI/BHI/DHI/DNI sums from hourly ERA5, 1991-2025 |
| `era5_daily.csv` | Cleaned daily ERA5 series 1940-01-01 to 2026-11-17, with ERA5-Land snow depth from 1950 |
| `imgw_stations_monthly.csv`, `imgw_stations_annual.csv` | IMGW monthly and annual data for Szczecin (synop 353140205 / WMO 12205, 1951-2026), Przelewice (1956-2014), Lipnik/Lipki (1961-1980) and Goleniów (1982-2024) |
| `key_numbers.json` | Every headline number above, in machine-readable form |
| `charts/warming_stripes_1940_2025.png` | Warming stripes (anomaly vs 1961-1990) |
| `charts/annual_mean_trend.png` | Annual mean bars, 11-year running mean, trends 1940+ and 1981+, IMGW Szczecin dots |
| `charts/monthly_climatology.png` | Monthly T band and precipitation, 1961-1990 vs 1991-2020 |
| `charts/solstice_daily_cycle.png` | 21 June and 21 December hourly temperature and GHI |
| `raw/open-meteo/` | `era5_daily_1940_2026.json`, `era5_hourly_*` (1991-2026: T2m, GHI, direct, diffuse, DNI, cloud cover; UTC), `era5land_hourly_snowdepth_*` (1950-2026) |
| `raw/imgw/` | Original IMGW-PIB zips: `synop_monthly/` (all stations 1960-2024), `klimat_monthly/` (all climate stations 1951-2024), `synop_daily_szczecin_205/` (Szczecin 1966-2025 plus all-station monthly files Jan-Oct 2026), and the format description files |

To rebuild, use any Python 3 with pandas, numpy and matplotlib and run `python -I build_climate.py`.

## Caveats and data gaps

- **ERA5 vs station:** for 1991-2020, ERA5 annual mean temperature is 0.17 °C below Szczecin. The nearby climate stations run colder than Szczecin, which is an urban station: Przelewice is 0.44 °C colder, Lipnik near Stargard 0.43 °C, and Goleniów 0.71 °C. ERA5 sits between them, so it is a reasonable rural estimate for Witkowo.
- **Hot days:** ERA5 smooths extremes and undercounts days at 30 °C or more (4.8 vs 7.6 per year at Szczecin). Use the station count for heat stress.
- **Snow:** the ERA5 single-level `snow_depth` comes back null from Open-Meteo, so snow depth uses ERA5-Land instead. ERA5-Land overestimates how long snow lies here (63 days vs 24 at Szczecin for 1991-2020). Use the IMGW number; the ERA5-Land series is only good for showing the trend.
- **Sunshine:** the Open-Meteo `sunshine_duration` field is a DNI > 120 W/m² estimate and is far too high (about 2780 h). The real figure is the Szczecin heliograph value, 1739 h/yr for 1991-2020. Radiation (GHI) is the variable to use for PV.
- **Precipitation:** ERA5 is about 10% wetter than the Szczecin gauge.
- **IMGW coverage:** monthly synop files end in 2024. Station months for 2025 and Jan-Oct 2026 were rebuilt from daily files. The klimat stations closest to the site have closed: Lipnik in 1980 and Przelewice in 2014. There is no IMGW station in Stargard itself, and no IMGW actinometric (radiation) station in the Szczecin region; the nearest are Gorzów Wielkopolski and Kołobrzeg.
- **Hourly profiles:** hours are local clock time. Temperature is the instantaneous value at the hour. Radiation is the mean over the preceding hour, which is the Open-Meteo convention.

## Sources and licences

- **Open-Meteo Historical Weather API** (https://archive-api.open-meteo.com/v1/archive), models `era5` and `era5_land`. Licence: **CC BY 4.0**. Attribution: "Weather data by Open-Meteo.com" (https://open-meteo.com/). The underlying data is Copernicus ERA5 / ERA5-Land: Hersbach et al. (2020), ERA5 hourly data, Copernicus Climate Change Service (C3S) Climate Data Store; Muñoz Sabater (2019), ERA5-Land. It contains modified Copernicus Climate Change Service information 2026.
- **IMGW-PIB public data** (https://danepubliczne.imgw.pl/, `dane_pomiarowo_obserwacyjne/dane_meteorologiczne`: `miesieczne/synop`, `miesieczne/klimat`, `dobowe/synop`). Any reuse must carry the attribution **"Źródło: Instytut Meteorologii i Gospodarki Wodnej - Państwowy Instytut Badawczy"** (short form **"Źródło: IMGW-PIB"**). Data processed here is marked as processed.
- **Location:** OpenStreetMap Nominatim, © OpenStreetMap contributors, ODbL.
