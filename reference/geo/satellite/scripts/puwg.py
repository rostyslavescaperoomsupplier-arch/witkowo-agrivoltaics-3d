import math, sys
# EPSG:2180 (PUWG 1992): GRS80, TM lon0=19, k0=0.9993, FE=500000, FN=-5300000
a = 6378137.0; f = 1/298.257222101
n = f/(2-f)
A = a/(1+n)*(1+n**2/4+n**4/64)
al = [n/2-2*n**2/3+5*n**3/16, 13*n**2/48-3*n**3/5, 61*n**3/240]
be = [n/2-2*n**2/3+37*n**3/96, n**2/48+n**3/15, 17*n**3/480]
e = math.sqrt(f*(2-f))
k0, lon0, FE, FN = 0.9993, 19.0, 500000.0, -5300000.0

def fwd(lat, lon):
    phi = math.radians(lat); lam = math.radians(lon-lon0)
    t = math.sinh(math.atanh(math.sin(phi)) - e*math.atanh(e*math.sin(phi)))
    xi = math.atan2(t, math.cos(lam)); eta = math.atanh(math.sin(lam)/math.sqrt(1+t*t))
    x = xi + sum(al[j]*math.sin(2*(j+1)*xi)*math.cosh(2*(j+1)*eta) for j in range(3))
    y = eta + sum(al[j]*math.cos(2*(j+1)*xi)*math.sinh(2*(j+1)*eta) for j in range(3))
    N = k0*A*x + FN; E = k0*A*y + FE
    return E, N  # easting(x in EPSG axis 'y'), northing

def inv(E, N):
    xi = (N-FN)/(k0*A); eta = (E-FE)/(k0*A)
    x = xi - sum(be[j]*math.sin(2*(j+1)*xi)*math.cosh(2*(j+1)*eta) for j in range(3))
    y = eta - sum(be[j]*math.cos(2*(j+1)*xi)*math.sinh(2*(j+1)*eta) for j in range(3))
    chi = math.asin(math.sin(x)/math.cosh(y))
    phi = chi
    for _ in range(10):
        phi = math.asin(math.tanh(math.atanh(math.sin(chi)) + e*math.atanh(e*math.sin(phi))))
    lam = math.atan2(math.sinh(y), math.cos(x))
    return math.degrees(phi), lon0+math.degrees(lam)

if __name__ == '__main__':
    lat, lon = float(sys.argv[1]), float(sys.argv[2])
    E, N = fwd(lat, lon); print('E(x)=%.2f N(y)=%.2f' % (E, N), 'back', inv(E, N))
