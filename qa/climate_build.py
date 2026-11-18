#!/usr/bin/env python3
"""Build data/geo/climate.json (web-ready, compact) from reference/geo/climate/.

Pure stdlib (no pandas). Re-run after the research agent adds more hourly files:
    python3 -I qa/climate_build.py

Inputs (read only): annual.csv, monthly_normals.csv, key_numbers.json, annual_irradiation_hourly.csv,
imgw_stations_annual.csv, raw/open-meteo/era5_hourly_*.json (UTC hourly, 1991-2020 used for profiles).
"""
import csv, glob, json, math, os, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'reference', 'geo', 'climate')
OUT = os.path.join(ROOT, 'data', 'geo', 'climate.json')

SITE_LAT, SITE_LON = 53.4, 14.6  # same as lib/sky.js


def num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def rows(name):
    with open(os.path.join(SRC, name), newline='') as f:
        return list(csv.DictReader(f))


def r(v, n=2):
    return None if v is None else round(v, n)


def ols(xs, ys):
    n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs); sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx
    return b, my - b * mx


def mean(a):
    a = [x for x in a if x is not None]
    return sum(a) / len(a) if a else None


# ---------------------------------------------------------------- annual series
key = json.load(open(os.path.join(SRC, 'key_numbers.json')))
ann = [a for a in rows('annual.csv') if a['complete'] == 'True']
years = [int(a['year']) for a in ann]
col = lambda c, n=2: [r(num(a[c]), n) for a in ann]
tmean = col('tmean')
slope, icpt = ols(years, tmean)
base = mean([t for y, t in zip(years, tmean) if 1961 <= y <= 1990])
recent = mean([t for y, t in zip(years, tmean) if y >= years[-1] - 9])

# partial current year (for info only, not in charts)
partial = [a for a in rows('annual.csv') if a['complete'] != 'True']

imgw = {}
for a in rows('imgw_stations_annual.csv'):
    v = num(a.get('Szczecin (synop 12205)_tmean'))
    if v is not None:
        imgw[int(a['year'])] = v

# ---------------------------------------------------------------- monthly normals
mn = {}
for m in rows('monthly_normals.csv'):
    p = m['period']
    d = mn.setdefault(p, {k: [] for k in ('tmean', 'tmin', 'tmax', 'precip', 'ghiMonth', 'ghiDay', 'sunshine', 'frostDays', 'hot30')})
    d['tmean'].append(r(num(m['tmean']))); d['tmin'].append(r(num(m['tmin_mean']))); d['tmax'].append(r(num(m['tmax_mean'])))
    d['precip'].append(r(num(m['precip_mm']), 1)); d['ghiMonth'].append(r(num(m['ghi_kWh_m2']), 1))
    d['ghiDay'].append(r(num(m['ghi_kWh_m2_day']))); d['sunshine'].append(r(num(m['sunshine_h']), 0))
    d['frostDays'].append(r(num(m['frost_days']), 1)); d['hot30'].append(r(num(m['hot_days_30']), 2))

# ---------------------------------------------------------------- hourly profiles from raw ERA5 hourly
def local_profile(hours, month, day, tz):
    """mean / p10 / p90 temperature and mean GHI per local clock hour, +-7 days around month/day, 1991-2020."""
    c = dt.date(2001, month, day).timetuple().tm_yday
    T = [[] for _ in range(24)]; G = [[] for _ in range(24)]; Gx = [[] for _ in range(24)]
    yrs = set()
    for t, temp, ghi in hours:
        lt = t + dt.timedelta(hours=tz)
        if not (1991 <= lt.year <= 2020):
            continue
        doy = lt.timetuple().tm_yday
        if lt.year % 4 == 0 and lt.month > 2:
            doy -= 1
        if abs(doy - c) > 7:
            continue
        yrs.add(lt.year)
        if temp is not None: T[lt.hour].append(temp)
        if ghi is not None: G[lt.hour].append(ghi)
    def q(a, p):
        a = sorted(a); k = (len(a) - 1) * p; f = math.floor(k); cc = min(f + 1, len(a) - 1)
        return a[f] + (a[cc] - a[f]) * (k - f)
    # GHI in Open-Meteo is the mean of the PRECEDING hour -> daily sum = sum of the 24 hourly means (Wh/m2)
    ghi = [mean(g) for g in G]
    ghi90 = [q(g, 0.9) if g else None for g in G]  # p90 hour ~ clear-ish sky
    return {
        't': [r(mean(x), 2) for x in T],
        'p10': [r(q(x, .1), 1) for x in T],
        'p90': [r(q(x, .9), 1) for x in T],
        'ghi': [r(g, 0) for g in ghi],
        'ghiP90': [r(g, 0) for g in ghi90],
        'dayWh': r(sum(g for g in ghi if g), 0),
        'dayWhP90': r(sum(g for g in ghi90 if g), 0),
        'years': [min(yrs), max(yrs)] if yrs else None, 'nYears': len(yrs),
    }


hours = []
files = sorted(glob.glob(os.path.join(SRC, 'raw', 'open-meteo', 'era5_hourly_[0-9]*_[0-9]*.json')))
used = []
for p in files:
    try:
        j = json.load(open(p))
    except Exception:
        continue
    h = j.get('hourly')
    if not h or 'temperature_2m' not in h:
        continue
    used.append(os.path.basename(p))
    for t, temp, ghi in zip(h['time'], h['temperature_2m'], h.get('shortwave_radiation') or [None] * len(h['time'])):
        hours.append((dt.datetime.fromisoformat(t), temp, ghi))

hourly = None
if hours:
    hourly = {
        'note': 'ERA5 hourly 2 m temperature and GHI, mean of +-7 days around the date, local clock time '
                '(21 Jun CEST UTC+2, 21 Dec CET UTC+1), index = local hour 0..23. ghi = mean of the preceding hour (W/m2).',
        'files': used,
        'jun21': local_profile(hours, 6, 21, 2),
        'dec21': local_profile(hours, 12, 21, 1),
    }

# fallback (and cross-check): standard diurnal curve from monthly tmin/tmax
def diurnal(tmin, tmax, sunrise, tmax_h=15):
    """Sine rise sunrise->tmax_h, exponential-ish cosine decay to next sunrise. Standard Parton-Logan style."""
    out = []
    for hr in range(24):
        if sunrise <= hr <= tmax_h:
            f = math.sin(math.pi / 2 * (hr - sunrise) / (tmax_h - sunrise))
        else:
            dh = (hr - tmax_h) % 24; span = (sunrise - tmax_h) % 24
            f = math.cos(math.pi / 2 * dh / span)
        out.append(round(tmin + (tmax - tmin) * f, 2))
    return out


n9120 = mn['1991-2020']
fallback = {
    'note': 'Derived from 1991-2020 monthly tmin/tmax (June, December) with a standard sine/cosine diurnal curve '
            '(min at sunrise, max at 15:00). Used only when hourly ERA5 is missing.',
    'jun21': diurnal(n9120['tmin'][5], n9120['tmax'][5], 5),
    'dec21': diurnal(n9120['tmin'][11], n9120['tmax'][11], 8),
}

# ---------------------------------------------------------------- PV irradiation
pvh = rows('annual_irradiation_hourly.csv')
pv_years = [int(a['year']) for a in pvh]

data = {
    'version': 1,
    'generated': dt.date.today().isoformat(),
    'site': {'name': 'Witkowo Pierwsze (gm. Stargard)', 'lat': SITE_LAT, 'lon': SITE_LON},
    'gridpoint': key.get('era5_gridpoint'),
    'sources': [
        {'id': 'era5', 'name': 'ERA5 reanalysis (Copernicus Climate Change Service / ECMWF) via Open-Meteo Historical Weather API',
         'attribution': 'Open-Meteo.com (CC BY 4.0), ERA5: Copernicus Climate Change Service',
         'license': 'CC BY 4.0', 'url': 'https://open-meteo.com/en/docs/historical-weather-api'},
        {'id': 'imgw', 'name': 'IMGW-PIB public data (synop Szczecin 12205 + climate stations)',
         'attribution': 'Źródło: IMGW-PIB', 'url': 'https://danepubliczne.imgw.pl/'},
    ],
    'attribution': {
        'pl': 'Dane: ERA5 / Copernicus Climate Change Service via Open-Meteo.com (CC BY 4.0); Źródło: IMGW-PIB',
        'en': 'Data: ERA5 / Copernicus Climate Change Service via Open-Meteo.com (CC BY 4.0); Source: IMGW-PIB (Źródło: IMGW-PIB)',
    },
    'baseline': {'period': '1961-1990', 'tmean': r(base)},
    'trend': {
        'perDecade': r(slope * 10, 3), 'period': f'{years[0]}-{years[-1]}', 'intercept': r(icpt, 4),
        'byPeriod': key.get('trends_C_per_decade'),
    },
    'warming': {
        'recentPeriod': f'{years[-1] - 9}-{years[-1]}', 'recentTmean': r(recent),
        'vsBaseline': r(recent - base), 'tmean_1991_2020': key.get('tmean_1991_2020'),
    },
    'annual': {
        'years': years, 'tmean': tmean, 'tmin': col('tmin_mean'), 'tmax': col('tmax_mean'),
        'frostDays': [int(x) for x in col('frost_days', 0)], 'hot30': [int(x) for x in col('hot_days_30', 0)],
        'gsl': [int(x) for x in col('gsl_days', 0)], 'precip': col('precip_mm', 0), 'ghi': col('ghi_kWh_m2', 0),
        'imgwSzczecinTmean': [r(imgw.get(y)) for y in years],
    },
    'partialYear': [{'year': int(a['year']), 'days': int(a['days']), 'tmean': r(num(a['tmean']))} for a in partial],
    'extremes': {'warmest': key.get('warmest_years'), 'coldest': key.get('coldest_years')},
    'normals': mn,  # '1961-1990' and '1991-2020', arrays index 0 = January
    'normalsNote': 'ERA5 grid point; tmin/tmax = monthly mean of daily min/max; ghiMonth kWh/m2 per month, '
                   'ghiDay kWh/m2/day (horizontal); frostDays = days with tmin < 0; hot30 = days with tmax >= 30.',
    'indices': {
        p: {'frostDays': key.get(f'frost_days_{p}'), 'hot30': key.get(f'hot30_{p}'), 'gsl': key.get(f'gsl_{p}'),
            'precip': key.get(f'precip_{p}'), 'ghi': key.get(f'ghi_kWh_m2_{p}')}
        for p in ('1961_1990', '1991_2020', '2016_2025')
    },
    'pv': {
        'annualGhi_1991_2020_daily': key.get('ghi_kWh_m2_1991_2020'),
        'annualHourly': key.get('pv_hourly_1991_2020'),
        'annualHourlyYears': [min(pv_years), max(pv_years)] if pv_years else None,
        'diffuseFraction': key.get('diffuse_fraction_1991_2020'),
        'typicalDayKWh': n9120['ghiDay'],
        'note': 'Horizontal irradiation (GHI). annualHourly = sums of ERA5 hourly components for the years listed.',
    },
    'hourly': hourly,
    'hourlyFallback': fallback,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print(OUT, os.path.getsize(OUT), 'bytes; hourly files:', used)
print('trend/dec', r(slope * 10, 3), 'base', r(base), 'recent', r(recent))
if hourly:
    for k in ('jun21', 'dec21'):
        p = hourly[k]; print(k, p['years'], p['nYears'], 'min', min(p['t']), 'max', max(p['t']), 'dayWh', p['dayWh'], 'p90', p['dayWhP90'])
print('fallback jun', min(fallback['jun21']), max(fallback['jun21']), 'dec', min(fallback['dec21']), max(fallback['dec21']))
