"""Build climate history for Witkowo Pierwsze (gm. Stargard) from raw downloads.

Inputs (raw/):
  open-meteo/era5_daily_1940_2026.json          Open-Meteo archive API, model=era5, daily
  open-meteo/era5_hourly_YYYY_YYYY.json          hourly T2m + radiation + snow depth (UTC), 1991-2026
  open-meteo/era5_hourly_snowdepth_*.json        hourly snow depth 1940-1990
  imgw/synop_monthly/*.zip                       IMGW-PIB monthly synop (all stations) 1960-2024
  imgw/synop_daily_szczecin_205/*.zip            IMGW-PIB daily synop Szczecin 1966-2025 + all-station 2026 months
  imgw/klimat_monthly/*.zip                      IMGW-PIB monthly climate stations 1951-2024

Outputs: annual.csv, monthly_normals.csv, hourly_profiles.csv, imgw_stations_annual.csv,
         era5_daily.csv, charts/*.png, key_numbers.json

Run: <python with pandas+matplotlib> -I build_climate.py
"""
import glob
import io
import json
import os
import zipfile

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OM = os.path.join(RAW, "open-meteo")
IM = os.path.join(RAW, "imgw")
CH = os.path.join(HERE, "charts")
os.makedirs(CH, exist_ok=True)

LAST_FULL_YEAR = 2025
SZCZECIN = "353140205"
NEAR = {  # IMGW station code -> name (climate stations near the site)
    "353140205": "Szczecin (synop 12205)",
    "253150190": "Przelewice",
    "253149998": "Lipnik (Lipki)",
    "253140060": "Goleniow",
}


# ---------------------------------------------------------------- ERA5 daily
def load_era5_daily():
    with open(os.path.join(OM, "era5_daily_1940_2026.json")) as f:
        j = json.load(f)
    d = pd.DataFrame(j["daily"])
    d["time"] = pd.to_datetime(d["time"])
    d = d.set_index("time")
    d = d.rename(columns={
        "temperature_2m_mean": "tmean", "temperature_2m_max": "tmax", "temperature_2m_min": "tmin",
        "precipitation_sum": "precip_mm", "rain_sum": "rain_mm", "snowfall_sum": "snowfall_cm",
        "sunshine_duration": "sunshine_s", "daylight_duration": "daylight_s",
        "shortwave_radiation_sum": "sw_MJ", "et0_fao_evapotranspiration": "et0_mm",
        "wind_speed_10m_max": "wind_max_kmh"})
    d = d.dropna(subset=["tmean"])
    meta = {k: j[k] for k in ("latitude", "longitude", "elevation")}
    return d, meta


def load_era5_hourly():
    frames = []
    for p in sorted(glob.glob(os.path.join(OM, "era5_hourly_*.json"))):
        with open(p) as f:
            j = json.load(f)
        if "hourly" not in j:
            print("skip (error)", p)
            continue
        h = pd.DataFrame(j["hourly"])
        h["time"] = pd.to_datetime(h["time"])
        frames.append(h.set_index("time"))
    if not frames:
        return None
    h = pd.concat(frames).sort_index()
    h = h[~h.index.duplicated()]
    return h


# ---------------------------------------------------------------- growing season (ETCCDI GSL)
def gsl(tm):
    """tm: daily tmean Series for one year. Start = first day of first 6-day run with T>5 C
    (from 1 Jan); end = first day of first 6-day run with T<5 C after 1 July."""
    t = tm.values
    idx = tm.index
    n = len(t)
    start = None
    for i in range(n - 5):
        if np.all(t[i:i + 6] > 5):
            start = i
            break
    if start is None:
        return np.nan, None, None
    jul = np.searchsorted(idx, pd.Timestamp(idx[0].year, 7, 1))
    end = n
    for i in range(max(jul, start + 6), n - 5):
        if np.all(t[i:i + 6] < 5):
            end = i
            break
    return end - start, idx[start], (idx[end] if end < n else None)


def ols(x, y):
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    m = ~np.isnan(y)
    b, a = np.polyfit(x[m], y[m], 1)
    return a, b


# ---------------------------------------------------------------- IMGW readers
def read_zip_csvs(path, prefix):
    out = []
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            b = os.path.basename(n)
            if b.startswith(prefix) and not b.startswith(prefix + "t_") and "_t_" not in b:
                raw = z.read(n).decode("cp1250")
                out.append(pd.read_csv(io.StringIO(raw), header=None, dtype=str))
    return out


def num(s):
    return pd.to_numeric(s, errors="coerce")


def imgw_monthly():
    """Monthly STM/TMXS/TMNS/SUMM(/SUUS) for near stations. Status '8' = missing."""
    rows = []
    for p in sorted(glob.glob(os.path.join(IM, "synop_monthly", "*.zip"))):
        for df in read_zip_csvs(p, "s_m_d"):
            df = df[df[0].isin([SZCZECIN])]
            for _, r in df.iterrows():
                rows.append(dict(code=r[0], year=int(r[2]), month=int(r[3]), src="synop",
                                 tmean=np.nan if r[13] == "8" else num(r[12]),
                                 tmax_mean=np.nan if r[7] == "8" else num(r[6]),
                                 tmin_mean=np.nan if r[11] == "8" else num(r[10]),
                                 precip=np.nan if r[17] == "8" else num(r[16]),
                                 sunshine_h=np.nan if r[23] == "8" else num(r[22])))
    for p in sorted(glob.glob(os.path.join(IM, "klimat_monthly", "*.zip"))):
        for df in read_zip_csvs(p, "k_m_d"):
            df = df[df[0].isin(list(NEAR))]
            for _, r in df.iterrows():
                rows.append(dict(code=r[0], year=int(r[2]), month=int(r[3]), src="klimat",
                                 tmean=np.nan if r[13] == "8" else num(r[12]),
                                 tmax_mean=np.nan if r[7] == "8" else num(r[6]),
                                 tmin_mean=np.nan if r[11] == "8" else num(r[10]),
                                 precip=np.nan if r[17] == "8" else num(r[16]),
                                 sunshine_h=np.nan))
    m = pd.DataFrame(rows)
    # Szczecin: prefer synop file where both exist
    m = m.sort_values("src", key=lambda s: s.map({"synop": 0, "klimat": 1}))
    m = m.drop_duplicates(["code", "year", "month"]).sort_values(["code", "year", "month"])
    return m


def imgw_daily_szczecin():
    frames = []
    for p in sorted(glob.glob(os.path.join(IM, "synop_daily_szczecin_205", "*.zip"))):
        for df in read_zip_csvs(p, "s_d_"):
            df = df[df[0] == SZCZECIN]
            if len(df) == 0 or df.shape[1] < 22:
                continue
            frames.append(df)
    d = pd.concat(frames)
    out = pd.DataFrame({
        "date": pd.to_datetime(dict(year=num(d[2]), month=num(d[3]), day=num(d[4]))),
        "tmax": np.where(d[6] == "8", np.nan, num(d[5])),
        "tmin": np.where(d[8] == "8", np.nan, num(d[7])),
        "tmean": np.where(d[10] == "8", np.nan, num(d[9])),
        "precip": np.where(d[14] == "8", np.nan, num(d[13]).fillna(0)),
        "snow_cm": np.where(d[17] == "8", np.nan, num(d[16]).fillna(0)),
        "sunshine_h": np.where(d[21] == "8", np.nan, num(d[20])),
    }).drop_duplicates("date").set_index("date").sort_index()
    return out


# ================================================================ main
def main():
    d, meta = load_era5_daily()
    d["year"] = d.index.year
    d["month"] = d.index.month
    d["sunshine_h"] = d["sunshine_s"] / 3600
    d["sw_kWh"] = d["sw_MJ"] / 3.6
    h = load_era5_hourly()

    # daily snow depth (max of hourly, cm) - ERA5 single-level snow_depth is null in Open-Meteo,
    # so it comes from ERA5-Land (0.1 deg, 1950+)
    if h is not None and "snow_depth" in h:
        h = h.drop(columns="snow_depth")
    sfr = []
    for p in sorted(glob.glob(os.path.join(OM, "era5land_hourly_snowdepth_*.json"))):
        with open(p) as f:
            j = json.load(f)
        if "hourly" in j:
            x = pd.DataFrame(j["hourly"])
            x["time"] = pd.to_datetime(x["time"])
            sfr.append(x.set_index("time")["snow_depth"])
    if sfr:
        s = pd.concat(sfr).sort_index()
        s = s[~s.index.duplicated()]
        sd = (s.resample("D").max() * 100).rename("snow_depth_cm")
        d = d.join(sd, how="left")
    d.drop(columns=["sunshine_s", "daylight_s"]).round(3).to_csv(os.path.join(HERE, "era5_daily.csv"),
                                                                    index_label="date")

    # ------------------------------------------------ station data
    im = imgw_monthly()
    sd_ = imgw_daily_szczecin()
    # extend Szczecin monthly with daily-derived months not in monthly files (2025-2026)
    have = set(zip(im.loc[im.code == SZCZECIN, "year"], im.loc[im.code == SZCZECIN, "month"]))
    g = sd_.groupby([sd_.index.year, sd_.index.month])
    extra = []
    for (y, mo), x in g:
        if (y, mo) in have or x["tmean"].count() < 28:
            continue
        extra.append(dict(code=SZCZECIN, year=y, month=mo, src="synop_daily",
                          tmean=round(x.tmean.mean(), 1), tmax_mean=round(x.tmax.mean(), 1),
                          tmin_mean=round(x.tmin.mean(), 1), precip=round(x.precip.sum(), 1),
                          sunshine_h=round(x.sunshine_h.sum(), 1)))
    im = pd.concat([im, pd.DataFrame(extra)]).sort_values(["code", "year", "month"])
    im["station"] = im["code"].map(NEAR)
    im.to_csv(os.path.join(HERE, "imgw_stations_monthly.csv"), index=False)

    def st_annual(code):
        x = im[im.code == code].groupby("year")
        a = pd.DataFrame({"tmean": x.tmean.mean(), "n": x.tmean.count(), "precip": x.precip.sum(min_count=12),
                          "pn": x.precip.count()})
        a.loc[a.n < 12, "tmean"] = np.nan
        a.loc[a.pn < 12, "precip"] = np.nan
        return a

    st_ann = {c: st_annual(c) for c in NEAR}
    sa = pd.DataFrame({f"{NEAR[c]}_tmean": st_ann[c]["tmean"].round(2) for c in NEAR})
    sa["Szczecin_precip_mm"] = st_ann[SZCZECIN]["precip"].round(0)
    sa.index.name = "year"
    sa.dropna(how="all").to_csv(os.path.join(HERE, "imgw_stations_annual.csv"))

    # Szczecin daily indices
    sz = sd_.copy()
    sz["year"] = sz.index.year
    szy = sz.groupby("year").agg(n=("tmean", "count"), sz_frost=("tmin", lambda s: (s < 0).sum()),
                                 sz_hot30=("tmax", lambda s: (s >= 30).sum()),
                                 sz_sunshine_h=("sunshine_h", "sum"),
                                 sz_snow_days_1cm=("snow_cm", lambda s: (s >= 1).sum()))
    szy = szy[szy.n >= 360].drop(columns="n")

    # ------------------------------------------------ annual (ERA5)
    rows = []
    for y, x in d.groupby("year"):
        L, gs, ge = gsl(x["tmean"])
        row = dict(year=y, days=len(x),
                   tmean=x.tmean.mean(), tmax_mean=x.tmax.mean(), tmin_mean=x.tmin.mean(),
                   tmax_abs=x.tmax.max(), tmin_abs=x.tmin.min(),
                   frost_days=(x.tmin < 0).sum(), ice_days=(x.tmax < 0).sum(),
                   summer_days_25=(x.tmax >= 25).sum(), hot_days_30=(x.tmax >= 30).sum(),
                   tropical_nights_20=(x.tmin >= 20).sum(),
                   gsl_days=L, gs_start=gs.strftime("%m-%d") if gs is not None else "",
                   gs_end=ge.strftime("%m-%d") if ge is not None else "",
                   gdd5=(x.tmean - 5).clip(lower=0).sum(), gdd10=(x.tmean - 10).clip(lower=0).sum(),
                   precip_mm=x.precip_mm.sum(), snowfall_cm=x.snowfall_cm.sum(),
                   sunshine_h=x.sunshine_h.sum(), ghi_kWh_m2=x.sw_kWh.sum(), et0_mm=x.et0_mm.sum())
        if "snow_depth_cm" in x and x.snow_depth_cm.notna().sum() > 300:
            row["snow_cover_days_1cm"] = (x.snow_depth_cm >= 1).sum()
        rows.append(row)
    an = pd.DataFrame(rows).set_index("year")
    an["complete"] = an["days"] >= 365
    base6190 = an.loc[1961:1990, "tmean"].mean()
    base9120 = an.loc[1991:2020, "tmean"].mean()
    an["anom_vs_1961_1990"] = an["tmean"] - base6190
    an["anom_vs_1991_2020"] = an["tmean"] - base9120
    an = an.join(szy, how="left")
    an = an.join(sa[[f"{NEAR[SZCZECIN]}_tmean", "Szczecin_precip_mm"]].rename(
        columns={f"{NEAR[SZCZECIN]}_tmean": "imgw_szczecin_tmean", "Szczecin_precip_mm": "imgw_szczecin_precip_mm"}),
        how="left")
    for c in an.columns:
        if an[c].dtype.kind == "f":
            an[c] = an[c].round(2)
    # partial year: zero out sums that are misleading
    an.loc[~an.complete, ["precip_mm", "snowfall_cm", "sunshine_h", "ghi_kWh_m2", "et0_mm", "gdd5", "gdd10"]] = np.nan
    an.to_csv(os.path.join(HERE, "annual.csv"))

    full = an[an.complete & (an.index <= LAST_FULL_YEAR)]
    trends = {}
    for a0, a1 in [(1940, LAST_FULL_YEAR), (1961, LAST_FULL_YEAR), (1981, LAST_FULL_YEAR), (1991, LAST_FULL_YEAR)]:
        s = full.loc[a0:a1]
        _, b = ols(s.index, s.tmean)
        trends[f"era5_{a0}_{a1}"] = round(b * 10, 3)
    s_sz = an.loc[1961:LAST_FULL_YEAR, "imgw_szczecin_tmean"].dropna()
    trends[f"imgw_szczecin_{s_sz.index.min()}_{LAST_FULL_YEAR}"] = round(ols(s_sz.index, s_sz.values)[1] * 10, 3)

    # ------------------------------------------------ monthly normals
    mrows = []
    for per, (a0, a1) in {"1961-1990": (1961, 1990), "1991-2020": (1991, 2020)}.items():
        x = d[(d.year >= a0) & (d.year <= a1)]
        g = x.groupby("month")
        nyr = a1 - a0 + 1
        szm = im[(im.code == SZCZECIN) & (im.year >= a0) & (im.year <= a1)].groupby("month")
        for mo in range(1, 13):
            xm = x[x.month == mo]
            mrows.append(dict(period=per, month=mo,
                              tmean=xm.tmean.mean(), tmax_mean=xm.tmax.mean(), tmin_mean=xm.tmin.mean(),
                              tmax_abs=xm.tmax.max(), tmin_abs=xm.tmin.min(),
                              frost_days=(xm.tmin < 0).sum() / nyr, hot_days_30=(xm.tmax >= 30).sum() / nyr,
                              precip_mm=xm.precip_mm.sum() / nyr, sunshine_h=xm.sunshine_h.sum() / nyr,
                              ghi_kWh_m2=xm.sw_kWh.sum() / nyr, ghi_kWh_m2_day=xm.sw_kWh.mean(),
                              snow_cover_days=((xm.snow_depth_cm >= 1).sum() / nyr) if "snow_depth_cm" in xm and xm.snow_depth_cm.notna().any() else np.nan,
                              imgw_szczecin_tmean=szm.tmean.mean().get(mo, np.nan),
                              imgw_szczecin_tmax_mean=szm.tmax_mean.mean().get(mo, np.nan),
                              imgw_szczecin_tmin_mean=szm.tmin_mean.mean().get(mo, np.nan),
                              imgw_szczecin_precip_mm=szm.precip.mean().get(mo, np.nan),
                              imgw_szczecin_sunshine_h=szm.sunshine_h.mean().get(mo, np.nan)))
        # annual row
    mn = pd.DataFrame(mrows).round(2)
    mn.to_csv(os.path.join(HERE, "monthly_normals.csv"), index=False)

    # ------------------------------------------------ hourly profiles (1991-2020)
    hp_out = None
    if h is not None:
        hh = h.loc["1991-01-01":"2020-12-31"].copy()
        if len(hh) > 200000:
            res = []
            for label, (mo, dy), tz_off in [("21-Jun", (6, 21), 2), ("21-Dec", (12, 21), 1)]:
                loc = hh.copy()
                loc.index = loc.index + pd.Timedelta(hours=tz_off)  # local clock (CEST / CET)
                doy_c = pd.Timestamp(2001, mo, dy).day_of_year
                doy = loc.index.day_of_year - (loc.index.is_leap_year & (loc.index.month > 2)).astype(int)
                exact = loc[(loc.index.month == mo) & (loc.index.day == dy)]
                win = loc[np.abs(doy - doy_c) <= 7]
                for hr in range(24):
                    e = exact[exact.index.hour == hr]
                    w = win[win.index.hour == hr]
                    res.append(dict(day=label, local_hour=hr, utc_offset=tz_off,
                                    t2m_mean=e.temperature_2m.mean(), t2m_p10=e.temperature_2m.quantile(.1),
                                    t2m_p90=e.temperature_2m.quantile(.9),
                                    t2m_mean_pm7d=w.temperature_2m.mean(),
                                    ghi_Wm2=e.shortwave_radiation.mean(), ghi_Wm2_pm7d=w.shortwave_radiation.mean(),
                                    dni_Wm2_pm7d=w.direct_normal_irradiance.mean(),
                                    dhi_Wm2_pm7d=w.diffuse_radiation.mean(),
                                    cloud_cover_pct_pm7d=w.cloud_cover.mean(), n_years=e.temperature_2m.count()))
            hp_out = pd.DataFrame(res).round(2)
            hp_out.to_csv(os.path.join(HERE, "hourly_profiles.csv"), index=False)
        # PV: annual irradiation components from hourly (W/m2 hour-mean -> Wh)
        pv = h.resample("YE").agg({"shortwave_radiation": "sum", "direct_radiation": "sum",
                                    "diffuse_radiation": "sum", "direct_normal_irradiance": "sum",
                                    "temperature_2m": "count"})
        pv.index = pv.index.year
        pv = pv[pv.temperature_2m >= 8760] / 1000
        pv = pv.drop(columns="temperature_2m").round(1)
        pv.columns = ["ghi_kWh_m2", "bhi_kWh_m2", "dhi_kWh_m2", "dni_kWh_m2"]
        pv.index.name = "year"
        pv.to_csv(os.path.join(HERE, "annual_irradiation_hourly.csv"))
    else:
        pv = None

    # ------------------------------------------------ key numbers
    def r(v, n=2):
        return None if pd.isna(v) else round(float(v), n)

    k = dict(
        era5_gridpoint=meta, last_full_year=LAST_FULL_YEAR,
        tmean_1961_1990=r(base6190), tmean_1991_2020=r(base9120),
        tmean_2016_2025=r(full.loc[2016:2025, "tmean"].mean()),
        warming_2016_2025_vs_1961_1990=r(full.loc[2016:2025, "tmean"].mean() - base6190),
        trends_C_per_decade=trends,
        warmest_years=full["tmean"].sort_values(ascending=False).head(5).round(2).to_dict(),
        coldest_years=full["tmean"].sort_values().head(5).round(2).to_dict(),
        frost_days_1961_1990=r(full.loc[1961:1990, "frost_days"].mean(), 1),
        frost_days_1991_2020=r(full.loc[1991:2020, "frost_days"].mean(), 1),
        frost_days_2016_2025=r(full.loc[2016:2025, "frost_days"].mean(), 1),
        hot30_1961_1990=r(full.loc[1961:1990, "hot_days_30"].mean(), 1),
        hot30_1991_2020=r(full.loc[1991:2020, "hot_days_30"].mean(), 1),
        hot30_2016_2025=r(full.loc[2016:2025, "hot_days_30"].mean(), 1),
        gsl_1961_1990=r(full.loc[1961:1990, "gsl_days"].mean(), 0),
        gsl_1991_2020=r(full.loc[1991:2020, "gsl_days"].mean(), 0),
        gsl_2016_2025=r(full.loc[2016:2025, "gsl_days"].mean(), 0),
        precip_1961_1990=r(full.loc[1961:1990, "precip_mm"].mean(), 0),
        precip_1991_2020=r(full.loc[1991:2020, "precip_mm"].mean(), 0),
        precip_2016_2025=r(full.loc[2016:2025, "precip_mm"].mean(), 0),
        imgw_szczecin_precip_1991_2020=r(an.loc[1991:2020, "imgw_szczecin_precip_mm"].mean(), 0),
        sunshine_h_1991_2020=r(full.loc[1991:2020, "sunshine_h"].mean(), 0),
        imgw_szczecin_frost_days_1991_2020=r(szy.loc[1991:2020, "sz_frost"].mean(), 1),
        imgw_szczecin_hot30_1991_2020=r(szy.loc[1991:2020, "sz_hot30"].mean(), 1),
        imgw_szczecin_hot30_2016_2025=r(szy.loc[2016:2025, "sz_hot30"].mean(), 1),
        imgw_szczecin_snow_days_1991_2020=r(szy.loc[1991:2020, "sz_snow_days_1cm"].mean(), 0),
        imgw_szczecin_sunshine_h_1991_2020=r(szy.loc[1991:2020, "sz_sunshine_h"].mean(), 0),
        ghi_kWh_m2_1991_2020=r(full.loc[1991:2020, "ghi_kWh_m2"].mean(), 0),
        ghi_kWh_m2_2016_2025=r(full.loc[2016:2025, "ghi_kWh_m2"].mean(), 0),
        ghi_kWh_m2_1961_1990=r(full.loc[1961:1990, "ghi_kWh_m2"].mean(), 0),
        era5_minus_imgw_szczecin_tmean_1991_2020=r((full.loc[1991:2020, "tmean"] - an.loc[1991:2020, "imgw_szczecin_tmean"]).mean()),
        imgw_szczecin_tmean_1961_1990=r(an.loc[1961:1990, "imgw_szczecin_tmean"].mean()),
        imgw_szczecin_tmean_1991_2020=r(an.loc[1991:2020, "imgw_szczecin_tmean"].mean()),
    )
    if "snow_cover_days_1cm" in full:
        k["snow_cover_days_1961_1990"] = r(full.loc[1961:1990, "snow_cover_days_1cm"].mean(), 0)
        k["snow_cover_days_1991_2020"] = r(full.loc[1991:2020, "snow_cover_days_1cm"].mean(), 0)
        k["snow_cover_days_2016_2025"] = r(full.loc[2016:2025, "snow_cover_days_1cm"].mean(), 0)
    if pv is not None:
        p = pv.loc[1991:2020]
        k["pv_hourly_1991_2020"] = {c: r(p[c].mean(), 0) for c in p.columns}
        k["diffuse_fraction_1991_2020"] = r(p.dhi_kWh_m2.mean() / p.ghi_kWh_m2.mean(), 3)
    with open(os.path.join(HERE, "key_numbers.json"), "w") as f:
        json.dump(k, f, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(json.dumps(k, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))

    # ------------------------------------------------ charts
    stripes = LinearSegmentedColormap.from_list("stripes", [
        "#08306b", "#08519c", "#2171b5", "#4292c6", "#6baed6", "#9ecae1", "#c6dbef", "#deebf7",
        "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"])
    a = full["anom_vs_1961_1990"]
    lim = max(abs(a.min()), abs(a.max()))
    fig = plt.figure(figsize=(12, 3))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.bar(a.index, 1, width=1, color=stripes((a.values + lim) / (2 * lim)), align="edge")
    ax.set_xlim(a.index.min(), a.index.max() + 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    fig.savefig(os.path.join(CH, "warming_stripes_1940_2025.png"), dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(11, 4.8))
    ax.bar(a.index, full.tmean - base6190, bottom=base6190,
           color=stripes((a.values + lim) / (2 * lim)), width=0.85, alpha=0.9,
           label="ERA5 annual mean (bar = anomaly vs 1961-1990)")
    roll = full.tmean.rolling(11, center=True, min_periods=6).mean()
    ax.plot(roll.index, roll, color="black", lw=2, label="ERA5 11-year running mean")
    for a0, c in [(1940, "#555555"), (1981, "#c0392b")]:
        s = full.loc[a0:]
        ia, b = ols(s.index, s.tmean)
        ax.plot(s.index, ia + b * s.index, ls="--", color=c, lw=1.5,
                label=f"trend {a0}-{LAST_FULL_YEAR}: {b*10:+.2f} °C/decade")
    szt = an.loc[:LAST_FULL_YEAR, "imgw_szczecin_tmean"].dropna()
    ax.plot(szt.index, szt.values, "o", ms=3, color="#1f4e79", label="IMGW-PIB Szczecin station")
    ax.axhline(base6190, color="grey", lw=0.8)
    ax.text(1941, base6190 + 0.05, f"1961-1990 mean {base6190:.1f} °C", fontsize=8, color="grey")
    ax.set_ylabel("°C")
    ax.set_title(f"Witkowo Pierwsze ({meta['latitude']}N {meta['longitude']}E ERA5 cell) - annual mean temperature 1940-{LAST_FULL_YEAR}")
    ax.legend(fontsize=8, loc="upper left", ncol=2)
    ax.set_xlim(1939, LAST_FULL_YEAR + 1)
    ax.grid(alpha=0.3)
    fig.text(0.99, 0.01, "Data: ERA5 via Open-Meteo (CC BY 4.0); Źródło: IMGW-PIB", ha="right", fontsize=7, color="grey")
    fig.tight_layout()
    fig.savefig(os.path.join(CH, "annual_mean_trend.png"), dpi=150)
    plt.close(fig)

    # monthly climatology chart
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax2 = ax.twinx()
    mon = "JFMAMJJASOND"
    for per, c in [("1961-1990", "#2171b5"), ("1991-2020", "#cb181d")]:
        x = mn[mn.period == per]
        ax.plot(x.month, x.tmean, "-o", color=c, label=f"Tmean {per}")
        ax.fill_between(x.month, x.tmin_mean, x.tmax_mean, color=c, alpha=0.12)
    x = mn[mn.period == "1991-2020"]
    ax2.bar(x.month, x.precip_mm, color="#4a90a4", alpha=0.35, width=0.6, label="precip 1991-2020")
    ax.set_xticks(range(1, 13), list(mon))
    ax.set_ylabel("°C (band = mean Tmin..Tmax)")
    ax2.set_ylabel("mm / month")
    ax.set_zorder(ax2.get_zorder() + 1)
    ax.patch.set_visible(False)
    h1, l1 = ax.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax.legend(h1 + h2, l1 + l2, fontsize=8, loc="upper left")
    ax.set_title("Witkowo Pierwsze - monthly climatology (ERA5)")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(CH, "monthly_climatology.png"), dpi=150)
    plt.close(fig)

    if hp_out is not None:
        fig, ax = plt.subplots(figsize=(9, 4.2))
        ax2 = ax.twinx()
        for lab, c in [("21-Jun", "#d95f02"), ("21-Dec", "#1b9e77")]:
            x = hp_out[hp_out.day == lab]
            ax.plot(x.local_hour, x.t2m_mean_pm7d, "-o", ms=3, color=c, label=f"T2m {lab} (±7 d, local time)")
            ax.fill_between(x.local_hour, x.t2m_p10, x.t2m_p90, color=c, alpha=0.12)
            ax2.plot(x.local_hour, x.ghi_Wm2_pm7d, ":", color=c, label=f"GHI {lab}")
        ax.set_xlabel("local clock hour (hour-ending; CEST in June, CET in December)")
        ax.set_ylabel("°C (band = P10-P90 on the exact date)")
        ax2.set_ylabel("GHI W/m²")
        h1, l1 = ax.get_legend_handles_labels()
        h2, l2 = ax2.get_legend_handles_labels()
        ax.legend(h1 + h2, l1 + l2, fontsize=8, loc="center left")
        ax.set_title("Typical solstice daily cycle 1991-2020 (ERA5)")
        ax.set_xticks(range(0, 24, 2))
        ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(os.path.join(CH, "solstice_daily_cycle.png"), dpi=150)
        plt.close(fig)


if __name__ == "__main__":
    main()
