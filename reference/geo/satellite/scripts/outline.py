import os, json, numpy as np, rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer
os.environ['AWS_NO_SIGN_REQUEST']='YES'
lat,lon=53.2886,15.0688
href='https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/33/U/WV/2026/8/S2A_33UWV_20260827_1_L2A/TCI.tif'
with rasterio.open(href) as ds:
    x,y=Transformer.from_crs('EPSG:4326',ds.crs,always_xy=True).transform(lon,lat)
    w=from_bounds(x-500,y-500,x+500,y+500,ds.transform); a=ds.read(window=w).astype(float); tr=ds.window_transform(w); crs=ds.crs
m=(a[1]-a[0])>0
lab=np.zeros_like(m); st=[(37,46)]
while st:
    r,c=st.pop()
    if 0<=r<m.shape[0] and 0<=c<m.shape[1] and m[r,c] and not lab[r,c]:
        lab[r,c]=1; st+=[(r+1,c),(r-1,c),(r,c+1),(r,c-1)]
rs,cs=np.nonzero(lab)
pts=[]
for r,c in zip(rs,cs):
    for dr in (0,1):
        for dc in (0,1): pts.append((tr.c+(c+dc)*10, tr.f-(r+dr)*10))
pts=sorted(set(pts))
def cross(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
lo=[];up=[]
for p in pts:
    while len(lo)>=2 and cross(lo[-2],lo[-1],p)<=0: lo.pop()
    lo.append(p)
for p in reversed(pts):
    while len(up)>=2 and cross(up[-2],up[-1],p)<=0: up.pop()
    up.append(p)
hull=lo[:-1]+up[:-1]; hull.append(hull[0])
inv=Transformer.from_crs(crs,'EPSG:4326',always_xy=True)
ring=[[round(v,6) for v in inv.transform(*p)] for p in hull]
gj={"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Witkowo agri-PV plot (approx. outline)","source":"Sentinel-2 L2A S2A_33UWV_20260827_1, 10 m pixels, vegetation-contrast mask + convex hull","pixel_area_m2":int(len(rs)*100),"accuracy":"+/- 10-20 m; includes plot margins; not a survey"},"geometry":{"type":"Polygon","coordinates":[ring]}},
 {"type":"Feature","properties":{"name":"phone GPS of on-site photos/videos 2026-11-03 (south corner, by Agrofirma parking)"},"geometry":{"type":"Point","coordinates":[15.0688,53.2886]}},
 {"type":"Feature","properties":{"name":"plot centroid"},"geometry":{"type":"Point","coordinates":[15.06804,53.28976]}}]}
json.dump(gj,open('/Users/rostyslav/witkowo-agrivoltaics-3d/reference/geo/satellite/agripv_plot_outline.geojson','w'),indent=1)
print(len(ring), ring)
