import bpy, math, random, os
from mathutils import Vector
from collections import defaultdict
random.seed(41)
OUT=os.path.dirname(os.path.abspath(__file__));bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
materials={}
def mat(n,c,metal=0,rough=.55):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;materials[n]=m;return m
mat('Galvanized steel',(.47,.53,.55),.78,.33);mat('Aluminum edges',(.7,.75,.75),.8,.28);mat('PV cells',(.017,.027,.044),.42,.24);mat('Cell contacts',(.38,.46,.50),.7,.3);mat('Ballast gray',(.38,.43,.44));mat('Block recess',(.19,.24,.25));mat('Rubber and cables',(.018,.023,.023));mat('Robot green',(.19,.62,.023),.25,.32);mat('Robot chassis',(.39,.42,.39),.6,.37);mat('White enclosures',(.81,.83,.78),.1,.4);mat('Dark earth',(.235,.17,.10));mat('Soil',(.28,.21,.13));mat('Grass',(.18,.23,.075));mat('Leaf sage',(.23,.37,.27));mat('Leaf dark',(.12,.26,.17));mat('Cabbage core',(.37,.47,.28));mat('Blue pipe',(.03,.23,.43));mat('Yellow',(.92,.68,.035));mat('Screen',(.09,.29,.32),.25,.3)
# Noise on soil and galvanized surfaces; model also exports with base colors.
for name,scale,strength in [('Soil',95,.22),('Dark earth',65,.18),('Galvanized steel',28,.05),('Ballast gray',16,.08)]:
 m=materials[name];nt=m.node_tree;p=nt.nodes.get('Principled BSDF');noise=nt.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=scale;b=nt.nodes.new('ShaderNodeBump');b.inputs['Strength'].default_value=strength;b.inputs['Distance'].default_value=.06;nt.links.new(noise.outputs['Fac'],b.inputs['Height']);nt.links.new(b.outputs['Normal'],p.inputs['Normal'])
geo=defaultdict(lambda:[[],[]])
def mesh(n,m,verts,faces):
 v,f=geo[(n,m)];i=len(v);v.extend(verts);f.extend([tuple(i+j for j in face) for face in faces])
def box(n,m,c,s,rot=None):
 vs=[]
 for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:
  v=Vector((x*s[0]/2,y*s[1]/2,z*s[2]/2));v=rot@v if rot else v;vs.append(tuple(v+Vector(c)))
 mesh(n,m,vs,[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)])
def beam(n,m,a,b,w=.08,d=None):
 v=Vector(b)-Vector(a);box(n,m,(Vector(a)+Vector(b))/2,(w,d or w,v.length),v.to_track_quat('Z','Y').to_matrix())
def cyl(n,m,a,b,r,steps=10):
 a,b=Vector(a),Vector(b);q=(b-a).to_track_quat('Z','Y');vs=[]
 for p in [a,b]:
  for i in range(steps):vs.append(tuple(p+q@Vector((r*math.cos(i*math.tau/steps),r*math.sin(i*math.tau/steps),0))))
 faces=[tuple(range(steps-1,-1,-1)),tuple(range(steps,2*steps))]+[(i,(i+1)%steps,(i+1)%steps+steps,i+steps) for i in range(steps)];mesh(n,m,vs,faces)
def ibeam(n,a,b,h=.22,w=.15):
 v=Vector(b)-Vector(a);q=v.to_track_quat('Z','Y').to_matrix();c=(Vector(a)+Vector(b))/2
 box(n,'Galvanized steel',c,(.012,h,v.length),q)
 for d in [-1,1]:box(n,'Galvanized steel',c+q@Vector((0,d*(h/2-.008),0)),(w,.016,v.length),q)
def cable(n,pts,r=.012):
 for a,b in zip(pts,pts[1:]):cyl(n,'Rubber and cables',a,b,r,6)
def sphere(n,m,c,s,seg=12,rings=7):
 vs=[]
 for j in range(rings+1):
  t=math.pi*j/rings
  for i in range(seg):
   p=math.tau*i/seg;vs.append((c[0]+s[0]*math.sin(t)*math.cos(p),c[1]+s[1]*math.sin(t)*math.sin(p),c[2]+s[2]*math.cos(t)))
 mesh(n,m,vs,[(j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i) for j in range(rings) for i in range(seg)])
# A cut-out of the photographed farm. Coordinates and dimensions are estimated in meters.
box('Site / soil','Soil',(0,15,-.21),(36,42,.4))
for tx in range(-18,18):
 for ty in range(-6,36):box('Site / soil tiles','Soil',(tx+.5,ty+.5,-.009),(1,1,.018))
for x in [-10,0,10]:box('Grass margins','Grass',(x,15,.013),(1.35,40,.028))
# finely modeled parallel cultivation furrows
for i in range(166):
 x=-17+i*.205
 if any(abs(x-g)<.70 for g in [-10,0,10]):continue
 beam('Cultivated rows','Dark earth',(x,-5,.014),(x,35,.014),.019,.025)
# 3 canopies, each six meters wide, with an open cultivation aisle between them.
for row,cx in enumerate([-10,0,10]):
 label=f'Canopy {row+1}'
 for y in range(0,31,6):
  for side in [1]:
   x=cx
   # vertical I section: explicit web and flanges
   box(label+' / columns','Galvanized steel',(x,y,2.08),(.19,.016,4.16))
   for dx in [-.091,.091]:box(label+' / columns','Galvanized steel',(x+dx,y,2.08),(.018,.19,4.16))
   box(label+' / feet','Galvanized steel',(x,y,.065),(.38,.36,.065))
   for dx in [-.13,.13]:
    for dy in [-.12,.12]:cyl(label+' / anchors','Aluminum edges',(x+dx,y+dy,.08),(x+dx,y+dy,.13),.023,6)
   for direction in [-1,1]:ibeam(label+' / knee braces',(x,y,3.15),(x+direction*1.35,y,4.12),.115,.075)
   for sy in [-1,1]:
    if 0<=y+sy*1.15<=30:ibeam(label+' / longitudinal braces',(x,y,3.14),(x,y+sy*1.15,4.08),.10,.065)
   # molded stacked counterweights beside the post, pronounced horizontal bands / vertical ribs
   bx=x-side*.93
   # Single molded reservoir with two genuine through-bores and recessed mouths.
   for hx in [-.3875,.3875]:
    vs=[];N=32
    for ring in range(6):
     for ii in range(N):
      t=ii*math.tau/N;cc=math.cos(t);ss=math.sin(t)
      outer=min(.3875/max(abs(cc),1e-9),.55/max(abs(ss),1e-9))
      rr=outer if ring in [0,5] else (.24 if ring in [1,4] else .125)
      yy=[-.57,-.57,-.38,.38,.57,.57][ring]
      vs.append((bx+hx+rr*cc,y+yy,.55+rr*ss))
    faces=[]
    for ring in range(5):
     for ii in range(N):faces.append((ring*N+ii,ring*N+(ii+1)%N,(ring+1)*N+(ii+1)%N,(ring+1)*N+ii))
    for ii in range(N):faces.append((5*N+ii,5*N+(ii+1)%N,(ii+1)%N,ii))
    mesh(label+' / molded water tanks','Ballast gray',vs,faces)
   for zz in [.22,.87]:box(label+' / tank reinforcement belts','Ballast gray',(bx,y,zz),(1.59,1.18,.075))
   for dx in [-.66,-.33,0,.33,.66]:
    for dy in [-.58,.58]:
     for zz in [.10,1.0]:box(label+' / tank molded ribs','Ballast gray',(bx+dx,y+dy,zz),(.035,.03,.19))
   cyl(label+' / blue conduits','Blue pipe',(x+.22,y,.05),(x+.22,y,1.45),.028)
   box(label+' / connection plates','Galvanized steel',(x,y-.106,3.94),(.24,.024,.38))
   for dx in [-.075,.075]:
    for z in [3.81,4.03]:cyl(label+' / bolts','Aluminum edges',(x+dx,y-.125,z),(x+dx,y-.15,z),.021,6)
  for direction in [-1,1]:ibeam(label+' / cross girders',(cx,y,4.16),(cx+direction*3.16,y,4.16),.21,.14)
 for x in [cx-2.75,cx,cx+2.75]:
  ibeam(label+' / longitudinal girders',(x,-.42,4.22),(x,30.42,4.22),.23,.14)
  cable(label+' / cable trunk',[(x+.09,-.4,4.08),(x+.09,30.4,4.08)],.022)
 # Sparse semi-transparent modules, three across each roof strip. Cells are real individual polygons.
 for j in range(20):
  y=.75+j*1.5
  for k in range(2):
   px=cx+(-2.05 if k==0 else 2.05)
   # slight tilt; cell plane slopes across narrow dimension
   def z(yy):return 4.43
   for xx in [px-.735,px+.735]:beam(label+' / PV frames','Aluminum edges',(xx,y-.73,z(y-.73)),(xx,y+.73,z(y+.73)),.028,.035)
   for yy in [y-.73,y+.73]:beam(label+' / PV frames','Aluminum edges',(px-.75,yy,z(yy)),(px+.75,yy,z(yy)),.028,.035)
   for a in range(6):
    for b in range(8):
     xx=px-.5875+a*.235;yy=y-.6125+b*.175;zz=z(yy)
     box(label+' / photovoltaic cells','PV cells',(xx,yy,zz),(.17,.15,.008))
     # silver busbar thin line, visible on top and bottom
     box(label+' / cell busbars','Cell contacts',(xx,yy,zz+.0045),(.002,.145,.001))
   box(label+' / junction boxes','Rubber and cables',(px,y,4.34),(.13,.17,.05))
   cable(label+' / hanging leads',[(px,y,4.34),(px+.13,y+.12,4.05),(px+.3,y+.4,3.99),(px+.45,y+.62,4.08)],.009)
 for y in range(0,30,6):
  for x in [cx-2.8,cx+2.8]:beam(label+' / roof tension rods','Galvanized steel',(x,y,4.29),(2*cx-x,y+6,4.29),.014)
# Butterfly canopies: central low line over a single row of posts.
# Rise 0.65 m over a 3.1 m half-span, estimated from reference profile.
for (gn,gm),(verts,faces) in geo.items():
 if gn.startswith('Canopy '):
  ci=int(gn.split()[1])-1;cx=[-10,0,10][ci]
  if not any(t in gn for t in ['columns','feet','anchors','water tanks','tank ','blue conduits','connection plates','bolts']):
   for vi,(xx,yy,zz) in enumerate(verts):
    factor=max(0,min(1,(zz-3.15)/(4.08-3.15)))
    verts[vi]=(xx,yy,zz+abs(xx-cx)*.21*factor)
# Rotate each tank and its ribs 90 degrees in plan, preserving its center.
for (gn,gm),(verts,faces) in geo.items():
 if gn.startswith('Canopy ') and any(tag in gn for tag in ['water tanks','tank reinforcement','tank molded']):
  cx=[-10,0,10][int(gn.split()[1])-1]-.93
  for vi,(xx,yy,zz) in enumerate(verts):
   cy=round(yy/6)*6
   verts[vi]=(cx+.93-(yy-cy),cy+1.10+(xx-cx),zz)
# aisle tie members, photographed overhead links
for y in range(0,31,6):
 for x in [-5,5]:beam('Aisle overhead ties','Galvanized steel',(x-2,y,4.80),(x+2,y,4.80),.065)
# Inverter rack at the entrance
for x in [-12.3,-9.4]:beam('Electrical rack','Galvanized steel',(x,-.85,0),(x,-.85,2.25),.07)
for z in [1.2,2.12]:beam('Electrical rack','Galvanized steel',(-12.4,-.85,z),(-9.3,-.85,z),.065)
for x in [-11.9,-11.0,-10.1]:
 box('Inverter cabinets','White enclosures',(x,-1,1.65),(.62,.28,.86))
 for z in [1.42,1.48,1.54,1.60,1.66,1.72,1.78,1.84,1.9]:box('Inverter cooling fins','Aluminum edges',(x,-1.147,z),(.51,.008,.012))
 cable('Electrical wiring',[(x,-1,.23),(x,-1,1.15),(x+.12,-1,1.23)],.021)
box('Field control cabinet','White enclosures',(13.9,1,.75),(.6,.4,1.35))
# Cabbage foliage: irregular folded leaf surfaces around central heads.
for row,cx in enumerate([-5,5]):
 for ix in range(10):
  for iy in range(32):
   x=cx-3.375+ix*.75+random.uniform(-.05,.05);y=1+iy*.88+random.uniform(-.08,.08)
   s=random.uniform(.82,1.12);sphere('Cabbage heads','Cabbage core',(x,y,.22*s),(.16*s,.16*s,.19*s),10,6)
   for l in range(7):
    ang=l*math.tau/7+random.random()*.35;vs=[]
    for t in range(5):
     u=t/4;rad=.04+u*.36*s;width=math.sin(math.pi*u)*.17*s
     for v in [-1,0,1]:
      rr=rad;zz=.12+.17*math.sin(u*math.pi*.9)+.06*u*u+.045*abs(v)*math.sin(u*math.pi)+random.uniform(-.018,.018)
      vs.append((x+math.cos(ang)*rr-math.sin(ang)*width*v,y+math.sin(ang)*rr+math.cos(ang)*width*v,zz*s))
    mesh('Cabbage leaves','Leaf sage' if l%2 else 'Leaf dark',vs,[(t*3+k,t*3+k+1,(t+1)*3+k+1,(t+1)*3+k) for t in range(4) for k in range(2)])
# drip lines under cabbage
for cx in [-5,5]:
 for i in range(10):cable('Drip irrigation',[(cx-3.375+i*.75,0,.045),(cx-3.375+i*.75,30,.045)],.012)
# FARM DROID, approximated from front and side reference images
rx,ry=5,-2.8
def rb(n,m,c,s):box('FarmDroid / '+n,m,(c[0]+rx,c[1]+ry,c[2]),s)
rb('main body','Robot chassis',(0,0,.91),(1.9,1.52,.50));rb('lower battery','Robot chassis',(0,-.1,.59),(1.3,1.1,.28))
rb('green roof rim','Robot green',(0,0,1.48),(3.0,2.45,.18))
rb('solar roof','PV cells',(0,0,1.578),(2.9,2.35,.025))
for i in range(13):rb('roof solar grid','Cell contacts',(-1.43+i*.238,0,1.594),(.009,2.34,.002))
for i in range(11):rb('roof solar grid','Cell contacts',(0,-1.15+i*.23,1.594),(2.88,.009,.002))
for x in [-1.22,1.22]:
 for y in [-.78,.78]:
  cyl('FarmDroid / tires','Rubber and cables',(rx+x-.16,ry+y,.43),(rx+x+.16,ry+y,.43),.42,32)
  for side in [-1,1]:cyl('FarmDroid / wheel rims','Robot chassis',(rx+x+side*.164,ry+y,.43),(rx+x+side*.18,ry+y,.43),.255,24)
  cyl('FarmDroid / axle','Galvanized steel',(rx+x-.23,ry+y,.43),(rx+x+.23,ry+y,.43),.075)
  for j in range(18):
   ang=j*math.tau/18
   for side in [-1,1]:
    p=(rx+x+side*.08,ry+y+math.sin(ang)*.411,.43+math.cos(ang)*.411)
    box('FarmDroid / tire lugs','Rubber and cables',p,(.16,.07,.06),Vector((0,math.sin(ang),math.cos(ang))).to_track_quat('Z','Y').to_matrix())
  beam('FarmDroid / wheel arms','Robot chassis',(rx+x,ry+y,.47),(rx+x*.63,ry+y*.68,1.04),.12)
rb('control console','Robot chassis',(0,-.90,1.03),(.62,.25,.29));rb('display','Screen',(-.07,-1.033,1.07),(.31,.012,.15));rb('red stop button','Yellow',(.22,-1.045,1.08),(.07,.03,.07))
for x in [-.83,-.5,-.17,.17,.5,.83]:
 beam('FarmDroid / cultivation arms','Galvanized steel',(rx+x,ry+.5,.7),(rx+x,ry+1.8,.19),.035)
 cyl('FarmDroid / tool discs','Robot chassis',(rx+x-.035,ry+1.6,.18),(rx+x+.035,ry+1.6,.18),.15,12)
 rb('seed hopper','White enclosures',(x,.45,1.09),(.25,.32,.31))
beam('FarmDroid / GNSS mast','Galvanized steel',(rx,ry,1.6),(rx,ry,1.88),.025)
sphere('FarmDroid / GNSS antenna','White enclosures',(rx,ry,1.89),(.105,.105,.04))
# white brand lettering on front rim
bpy.ops.object.text_add(location=(rx-1.12,ry-1.232,1.43),rotation=(math.pi/2,0,0));txt=bpy.context.object;txt.name='FarmDroid / lettering';txt.data.body='FARMDROID';txt.data.size=.20;txt.data.extrude=.001;txt.data.materials.append(materials['White enclosures'])
# Generate grouped meshes, allowing the main components to be edited separately.
for (name,m),(vs,fs) in geo.items():
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.materials.append(materials[m]);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
# camera and natural soft light
world=bpy.data.worlds.new('Overcast daylight');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.63,.72,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.65
bpy.ops.object.light_add(type='SUN',location=(0,0,20));sun=bpy.context.object;sun.name='Soft afternoon sun';sun.rotation_euler=(.42,-.55,-.4);sun.data.energy=2.2;sun.data.angle=.22
bpy.ops.object.camera_add();cam=bpy.context.object;cam.name='Overview';bpy.context.scene.camera=cam

def camera(loc,target,lens=43):
 cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=lens
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.unit_settings.system='METRIC'
camera((42,-39,30),(0,14,1.1),43)
# Convenient viewport state on open.
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   area.spaces.active.region_3d.view_distance=57;area.spaces.active.region_3d.view_location=(0,14,1.5);area.spaces.active.clip_end=1000
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/Witkowo_Farm.blend')
bpy.ops.export_scene.gltf(filepath=OUT+'/Witkowo_Farm.glb',export_format='GLB',export_cameras=False,export_lights=False)
scene.render.filepath=OUT+'/Witkowo_overview.png';bpy.ops.render.render(write_still=True)
camera((4.8,-8,2.25),(1,19,2.15),25);scene.render.filepath=OUT+'/Witkowo_ground_view.png';bpy.ops.render.render(write_still=True)
camera((-5,-4,2.9),(-8,6,2.6),28);scene.render.filepath=OUT+'/Witkowo_structure_detail.png';bpy.ops.render.render(write_still=True)
print('MODEL_COMPLETE')
