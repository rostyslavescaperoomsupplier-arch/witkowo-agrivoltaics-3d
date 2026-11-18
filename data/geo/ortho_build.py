#!/usr/bin/env python3
"""Build the web-ready ground textures in data/geo/ (agent MAP, 2026-11-18).

Downloads Geoportal (GUGiK) orthophoto crops centred on the modelled section and converts the
Sentinel-2 crops from reference/geo/satellite. Output: data/geo/ortho_*.jpg + data/geo/ortho_index.json
(bbox + CRS of every file; lib/geo.js reads it). Needs only Pillow. Run: python3 data/geo/ortho_build.py

Licences: GUGiK orthophoto = free use (Prawo geodezyjne art. 40a ust. 2 pkt 1), attribution
"Ortofotomapa: GUGiK, geoportal.gov.pl". Sentinel-2 = "Contains modified Copernicus Sentinel data 2024-2026".
"""
import io, json, os, sys, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SAT = os.path.join(REPO, 'reference', 'geo', 'satellite')

# download centre = scene (0, -15) = middle of the modelled patch, EPSG:2176 (PL-2000 zone 5), rounded
CE, CN = 5504570.0, 5906300.0
WMS_NOW = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution'
WMS_TIME = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolutionTime'

# year -> TIME range that returns that flight (checked 2026-11-18 by md5 of crops; 2023 must be the May range,
# a full-year 2023 range returns white). Flight dates from the README / WFS index.
YEARS = {
    2012: ('2012-01-01', '2012-12-31', '2012-04-28'),
    2014: ('2014-01-01', '2014-12-31', '2014-07-18'),
    2017: ('2017-01-01', '2017-12-31', '2017'),
    2020: ('2020-01-01', '2020-12-31', '2020-09-12'),
    2023: ('2023-05-01', '2023-05-31', '2023-05-08'),
    2025: (None, None, '2025-04-13'),
}
# tier -> (extent m, px). Time WMS is slow above ~1000 px, so every image is fetched as a grid of tiles.
TIERS = {'far': (3200, 2560), 'mid': (800, 1600), 'near': (400, 1600)}
TILE = 640


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'witkowo-3d-build/1.0'})
            data = urllib.request.urlopen(req, timeout=120).read()
            im = Image.open(io.BytesIO(data)).convert('RGB')
            return im
        except Exception as e:  # noqa
            print('  retry', i, e, file=sys.stderr); time.sleep(2 + 3 * i)
    raise RuntimeError(url)


def fetch(year, ext, px):
    t0, t1, _ = YEARS[year]
    n = max(1, round(px / TILE)); tp = px // n; m = ext / n
    out = Image.new('RGB', (tp * n, tp * n))
    x0, y1 = CE - ext / 2, CN + ext / 2
    jobs = []
    for r in range(n):
        for c in range(n):
            bb = (x0 + c * m, y1 - (r + 1) * m, x0 + (c + 1) * m, y1 - r * m)
            q = dict(SERVICE='WMS', VERSION='1.1.1', REQUEST='GetMap', LAYERS='Raster', STYLES='', SRS='EPSG:2176',
                     BBOX=','.join('%.2f' % v for v in bb), WIDTH=tp, HEIGHT=tp, FORMAT='image/jpeg')
            if t0: q['TIME'] = f'{t0}T00:00:00.000Z/{t1}T00:00:00.000Z'
            jobs.append((r, c, (WMS_TIME if t0 else WMS_NOW) + '?' + urllib.parse.urlencode(q)))
    with ThreadPoolExecutor(4) as ex:
        for (r, c, _), im in zip(jobs, ex.map(lambda j: get(j[2]), jobs)):
            out.paste(im, (c * tp, r * tp))
    return out, [x0, y1 - ext, x0 + ext, y1]


def save(im, name, q=82):
    p = os.path.join(HERE, name)
    while True:
        im.save(p, quality=q, optimize=True, progressive=True)
        if os.path.getsize(p) <= 1_900_000 or q < 50: break
        q -= 6
    print(name, im.size, os.path.getsize(p) // 1024, 'KB q', q)


def main():
    index = {'crs_note': 'bbox = [minE, minN, maxE, maxN] in crs, image north-up', 'ortho': {}, 's2': {}}
    for y in YEARS:
        tiers = ['far', 'mid'] + (['near'] if y == 2025 else [])
        index['ortho'][str(y)] = {'date': YEARS[y][2], 'tiers': {}}
        for t in tiers:
            name = f'ortho_{y}_{t}.jpg'
            ext, px = TIERS[t]
            if '--skip-existing' in sys.argv and os.path.exists(os.path.join(HERE, name)):
                bb = [CE - ext / 2, CN - ext / 2, CE + ext / 2, CN + ext / 2]
            else:
                im, bb = fetch(y, ext, px); save(im, name)
            index['ortho'][str(y)]['tiers'][t] = {'file': name, 'crs': 'EPSG:2176', 'bbox': bb}
    for d in ['2024-05-17', '2025-07-01', '2025-11-08', '2026-05-02', '2026-06-26', '2026-08-27']:
        src = os.path.join(SAT, f's2_{d}_2000m_x8.png')
        name = f'ortho_s2_{d}.jpg'
        save(Image.open(src).convert('RGB'), name, 88)
        w = [float(v) for v in open(src[:-4] + '.pgw').read().split()]
        W, H = Image.open(src).size
        minE, maxN = w[4] - w[0] / 2, w[5] - w[3] / 2
        index['s2'][d] = {'file': name, 'crs': 'EPSG:32633',
                          'bbox': [minE, maxN + w[3] * H, minE + w[0] * W, maxN]}
    json.dump(index, open(os.path.join(HERE, 'ortho_index.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
