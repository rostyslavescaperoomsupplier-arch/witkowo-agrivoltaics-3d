"""Build satellite/ortho reference set for Witkowo agri-PV. Run with scratch venv python -I."""
import os, json, urllib.request, urllib.parse, io
import numpy as np, rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer
from PIL import Image, ImageDraw

OUT = '/Users/rostyslav/witkowo-agrivoltaics-3d/reference/geo/satellite'
os.makedirs(OUT, exist_ok=True)
LAT, LON = 53.28976, 15.06804          # S2-derived centroid of the agri-PV plot
os.environ['AWS_NO_SIGN_REQUEST'] = 'YES'
meta = []

to2176 = Transformer.from_crs('EPSG:4326', 'EPSG:2176', always_xy=True)
to2180 = Transformer.from_crs('EPSG:4326', 'EPSG:2180', always_xy=True)
E, N = to2176.transform(LON, LAT)
WMS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/'

def worldfile(path, x0, y1, px):
    ext = {'.jpg': '.jgw', '.png': '.pgw'}[os.path.splitext(path)[1]]
    with open(os.path.splitext(path)[0] + ext, 'w') as f:
        f.write('%.6f\n0\n0\n%.6f\n%.4f\n%.4f\n' % (px, -px, x0 + px/2, y1 - px/2))

def ortho(name, svc, half, px, year=None, layer='Raster'):
    x0, y0, x1, y1 = E-half, N-half, E+half, N+half
    q = dict(SERVICE='WMS', VERSION='1.1.1', REQUEST='GetMap', LAYERS=layer, STYLES='', SRS='EPSG:2176',
             BBOX='%.2f,%.2f,%.2f,%.2f' % (x0, y0, x1, y1), WIDTH=px, HEIGHT=px, FORMAT='image/jpeg')
    if year:
        q['TIME'] = '%s-01-01T00:00:00.000Z/%s-12-31T00:00:00.000Z' % (year, year)
    url = WMS + svc + '?' + urllib.parse.urlencode(q)
    data = urllib.request.urlopen(url, timeout=300).read()
    im = Image.open(io.BytesIO(data)).convert('RGB')
    a = np.asarray(im)
    white = float(((a > 250).all(axis=2)).mean())
    p = os.path.join(OUT, name)
    im.save(p, quality=92)
    worldfile(p, x0, y1, 2*half/px)
    meta.append(dict(file=name, url=url, crs='EPSG:2176', bbox=[x0, y0, x1, y1], m_per_px=2*half/px, white_frac=white))
    print(name, im.size, 'white %.2f' % white)

def s2(item_href, date, half, tag):
    with rasterio.open(item_href) as ds:
        t = Transformer.from_crs('EPSG:4326', ds.crs, always_xy=True)
        x, y = t.transform(LON, LAT)
        # snap to the 10 m grid so pixels are not resampled
        x0 = round((x-half - ds.transform.c)/10)*10 + ds.transform.c
        y1 = round((y+half - ds.transform.f)/10)*10 + ds.transform.f
        w = from_bounds(x0, y1-2*half, x0+2*half, y1, ds.transform)
        a = ds.read(window=w)
        crs = str(ds.crs)
    im = Image.fromarray(np.transpose(a, (1, 2, 0)))
    base = 's2_%s_%s' % (date, tag)
    p = os.path.join(OUT, base + '_10m.png'); im.save(p); worldfile(p, x0, y1, 10)
    big = im.resize((im.width*8, im.height*8), Image.LANCZOS)
    p2 = os.path.join(OUT, base + '_x8.png'); big.save(p2); worldfile(p2, x0, y1, 1.25)
    meta.append(dict(file=base + '_10m.png / _x8.png', url=item_href, crs=crs, bbox=[x0, y1-2*half, x0+2*half, y1], m_per_px=10, date=date))
    print(base, im.size)
    return big

if __name__ == '__main__':
    # Geoportal orthophoto, current (2025-04-13 flight), EPSG:2176 = north-up metres at 15 E
    ortho('ortho_2025-04-13_1000m.jpg', 'StandardResolution', 500, 2000)
    ortho('ortho_2025-04-13_400m_texture.jpg', 'StandardResolution', 200, 1600)
    ortho('ortho_2025-04-13_200m.jpg', 'StandardResolution', 100, 800)
    for y in (2023, 2020, 2014, 2012):
        ortho('ortho_%d_1000m.jpg' % y, 'StandardResolutionTime', 500, 2000, year=y)
    stac = json.load(open(os.path.join(os.path.dirname(__file__), 's2_stac_search.json')))
    feats = {f['id']: f for f in stac['features']}
    ids = ['S2A_33UWV_20240517_0_L2A', 'S2C_33UWV_20250701_0_L2A', 'S2C_33UWV_20251108_0_L2A',
           'S2B_33UWV_20260502_0_L2A', 'S2C_33UWV_20260626_0_L2A', 'S2A_33UWV_20260827_1_L2A']
    tiles = []
    for i in ids:
        f = feats[i]; d = f['properties']['datetime'][:10]
        tiles.append((d, s2(f['assets']['visual']['href'], d, 500, '1000m')))
        s2(f['assets']['visual']['href'], d, 1000, '2000m')
    # before/after montage of S2 1 km crops
    W = Image.new('RGB', (len(tiles)*400, 430), 'white'); dr = ImageDraw.Draw(W)
    for k, (d, im) in enumerate(tiles):
        W.paste(im.resize((400, 400), Image.LANCZOS), (k*400, 30)); dr.text((k*400+8, 8), 'Sentinel-2 ' + d, fill='black')
    W.save(os.path.join(OUT, 's2_timeline_1000m.jpg'), quality=92)
    json.dump(dict(center_wgs84=[LAT, LON], center_2176=[E, N], center_2180=list(to2180.transform(LON, LAT)), items=meta),
              open(os.path.join(OUT, 'sources.json'), 'w'), indent=1)
