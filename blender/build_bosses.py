"""Native boss assets: an abyssal organism and a hostile siege dreadnought.

Shared ship metal tools, sculpted shell anatomy, independently rigged tendrils,
recessed weak points, physical weapon/engine markers and Cycles vertex AO.
    npm run model:bosses
"""
from __future__ import annotations
import math
import random
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector, noise
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_ship as ship
from build_ship import Part, Body, v, AXIS_X, BACK, spar, frange
from build_refits import armour, nacelle, containment


def tube(p, path, radii, material, sides=16):
    """Variable-radius organic tube with parallel-transport frames and closed tips."""
    if 2<len(path)<12:
        controls=path
        widths=radii
        path=[]
        radii=[]
        # Smooth sculpted tendons and teeth, with no angular joins between control points.
        for k in range(len(controls)-1):
            a,b,c,d=controls[max(0,k-1)],controls[k],controls[k+1],controls[min(len(controls)-1,k+2)]
            for j in range(8):
                t=j/8
                point=.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
                path.append(point)
                radii.append(widths[k]*(1-t)+widths[k+1]*t)
        path.append(controls[-1])
        radii.append(widths[-1])
    rings = []
    previous = v(0, 0, 1)
    for i, (point, radius) in enumerate(zip(path, radii)):
        tangent = (path[min(i+1, len(path)-1)]-path[max(0, i-1)]).normalized()
        normal = (previous-tangent*previous.dot(tangent)).normalized()
        if normal.length < .1:
            normal = tangent.cross(v(0, 1, 0)).normalized()
        previous = normal
        other = tangent.cross(normal)
        rings.append([p.bm.verts.new(point+radius*(normal*math.cos(k*math.tau/sides)+other*math.sin(k*math.tau/sides))) for k in range(sides)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            j = (k+1)%sides
            faces.append(p.bm.faces.new((a[k],a[j],b[j],b[k])))
    p._orient(faces, faces[0].calc_center_median()-(path[0]+path[1])*.5)
    p.paint(faces, material, p.shade(material), smooth=True)
    for ring, direction in ((rings[0], path[0]-path[1]), (rings[-1], path[-1]-path[-2])):
        face = p.bm.faces.new(ring)
        p._orient([face], direction)
        p.paint([face], material, p.shade(material))


def leviathan():
    parts = []
    body = Part('leviathan_carapace')
    # A ridged, asymmetrical mantle rather than a primitive sphere.
    mantle = Body([(-3.5,.14,.16,0),(-2.7,1.4,1.1,0),(-1.7,2.4,1.9,.15),
                   (0,2.65,2.25,.08),(1.1,2.1,1.9,0),(1.65,1.6,1.5,0)], n=2.05)
    body.skin(mantle,'Flesh',seg=.11,dx=.12,tint=.9)
    # Overlapping mineral chitin plates, segmented along natural body curvature.
    for k in range(14):
        t = k/14
        for j, x in enumerate((-2.55,-1.75,-.8,.15,.95)):
            body.shell(mantle,x,x+.72,t+.009,t+.061,.03,.15+.04*math.sin(k+j),
                       'Chitin',bevel=.035,seg=.11,dx=.18)
        path = [mantle.point(x,t+.032,.2) for x in frange(-2.4,1.3,.15)]
        tube(body,path,[.075+.022*math.sin(i*.8+k) for i in range(len(path))],'Bone',10)
        # Bioluminescent veins sit below armour ribs.
        body.pipe(mantle,t+.071,-1.8,1.25,.017,.03,'Vein',sides=7)
    # Fine sculpt displacement breaks perfect symmetry and catches grazing light.
    for vertex in body.bm.verts:
        point = vertex.co.copy()
        rough = noise.fractal(point*3.8,1,2.1,3)*.018
        vertex.co += point.normalized()*rough
    parts.append((body,'body',None))
    jaw = Part('leviathan_crown')
    for k in range(12):
        angle = k*math.tau/12
        radial = v(0,math.cos(angle),math.sin(angle))
        path = [v(1.1,0,0)+radial*1.82,v(1.6,0,0)+radial*1.69,
                v(2.15,0,0)+radial*1.44,v(2.45,0,0)+radial*1.02,
                v(2.05,0,0)+radial*.86]
        tube(jaw,path,[.22,.24,.19,.12,.018],'Bone',16)
        for j in range(3):
            a = angle+(j-1)*.047
            r = v(0,math.cos(a),math.sin(a))
            tube(jaw,[v(1.55,0,0)+r*1.75,v(2,0,0)+r*1.58,v(2.28,0,0)+r*1.2],
                 [.025,.025,.007],'Chitin',6)
    jaw.lathe(v(1.65,0,0),AXIS_X,[(.9,0),(1.38,0),(1.55,.15),(1.48,.38),(.92,.45),(.9,0)],'Flesh',segments=80)
    parts.append((jaw,'crown',None))
    eye = Part('leviathan_oculus')
    # Nested wet iris, dark pupil, radiating tendons; physical concave eye socket.
    eye.lathe(v(1.8,0,0),AXIS_X,[(0,0),(.24,.02),(.65,.11),(.88,.18),(.96,.15),(.9,0),(0,0)],'Iris',segments=80)
    eye.lathe(v(1.8,0,0),AXIS_X,[(0,.02),(.19,.04),(.24,.055),(.2,.065),(0,.045)],'Pupil',segments=64)
    for k in range(168):
        a=k*math.tau/168
        path=[]
        for j in range(7):
            r=.27+j*.1
            angle=a+.014*math.sin(j*1.7+k*.31)
            path.append(v(1.82+(r-.24)*.25,math.cos(angle)*r,math.sin(angle)*r))
        tube(eye,path,[.002,.003,.004,.003,.003,.002,.001],'Vein' if k%11==0 else 'Bone',6)
    parts.append((eye,'weakpoint',None))
    for k in range(8):
        a = k*math.tau/8+.12
        radial = v(0,math.cos(a),math.sin(a))
        pivot = v(-.7,0,0)+radial*1.9
        tendril = Part(f'leviathan_tendril_{k}')
        path = []
        radii = []
        for i in range(49):
            t = i/48
            r = 1.9+4.6*t-1.8*t*t
            twist = a+.5*math.sin(t*3.5+k*.3)*t
            path.append(v(-.7+1.2*t+1.7*math.sin(t*math.pi),math.cos(twist)*r,math.sin(twist)*r))
            radii.append(.25*(1-t)**1.1+.009)
        tube(tendril,path,radii,'Flesh',18)
        # Armoured dorsal scutes and recessed suckers follow each curved limb.
        for j in range(3,43,4):
            tangent = (path[j+1]-path[j-1]).normalized()
            direction = path[j].normalized()
            tendril.sphere(path[j]+direction*radii[j]*.7,radii[j]*.95,'Chitin',16,8)
            inward = path[j]-direction*radii[j]*.9
            tendril.torus(inward,radii[j]*.57,.022,ship.aim(direction),'Bone',seg=20,seg_minor=6)
            tendril.sphere(inward-direction*.012,radii[j]*.35,'Vein',12,6)
        # Raised nerve strands parallel the limb and terminate before the tip.
        nerve = [point-v(0,0,.08)*(1-i/len(path)) for i,point in enumerate(path[:-3])]
        tube(tendril,nerve,[.018]*len(nerve),'Vein',6)
        parts.append((tendril,'tendril',pivot))
    return parts


def dreadnought():
    parts = []
    hull = Part('dreadnought_hull')
    body = Body([(-6.2,1.25,.72,0),(-5,1.65,1.05,0),(-1,1.4,.9,0),
                 (3,1.05,.65,0),(5.4,.35,.27,.1),(6,.05,.08,.1)],n=3.3)
    armour(hull,body,size=.52,ribs=.62)
    for side in (-1,1):
        # Swept siege shoulders, broadside armour and deeply recessed hangar slats.
        wing = spar(v(-1.8,side*1.2,.05),v(-4.6,side*4.4,-.2),
                    [(0,1.8,.42),(.25,2,.5),(.8,1.4,.38),(1,.65,.22)],n=3.8)
        armour(hull,wing,size=.45,ribs=.55)
        nacelle(hull,side*4.3,-.22,-6.2,-2.1,.57)
        rail = Body([(0,.16,.2,.35),(1,.33,.31,.35),(5.9,.19,.18,.27),(6.6,.06,.1,.18)],n=3.1,y=side*.96)
        armour(hull,rail,size=.4,ribs=.55)
        for x in frange(-4.8,-2.2,.24):
            hull.box(v(x,side*1.55,.12),(.09,.1,.38),'Trim')
        for x in (-4.8,-3.4,-2):
            hull.pipe(body,.12 if side>0 else .38,x,x+.65,.021,.09,'HostileGlow',sides=6)
    for y in (-.72,0,.72):
        hull.engine(v(-6.25,y,0),BACK,.34,kind='main')
    command = Body([(-4.8,.8,.12,1),(-4.4,.83,.3,1.35),(-2.5,.63,.5,1.35),(-1.4,.28,.16,1.15)],n=3.8)
    armour(hull,command,size=.35,ribs=.45)
    for side in (-1,1):
        hull.pipe(command,.07 if side>0 else .43,-4.3,-2.3,.027,.1,'HostileGlow',sides=8)
    for x in (-4.3,-3.3,-2.3):
        hull.lathe(v(x,0,2),Matrix(),[(0,0),(.07,0),(.05,.6),(0,.7)],'Trim',segments=12)
    parts.append((hull,'body',None))
    core = Part('dreadnought_reactor')
    containment(core,.35,1.02,1.65)
    core.lathe(v(.4,0,1.65),AXIS_X,[(0,0),(.61,0),(.7,.1),(.59,.3),(0,.3)],'HostileGlow',segments=64)
    for k in range(12):
        a = k*math.tau/12
        point = v(.62,math.cos(a)*.86,1.65+math.sin(a)*.86)
        core.lathe(point,AXIS_X,[(0,0),(.07,0),(.1,.16),(.07,.26),(0,.26)],'Copper',segments=12)
    parts.append((core,'weakpoint',None))
    for side in (-1,1):
        for i,x in enumerate((-3.8,-1.3,1.1)):
            turret = Part(f'dreadnought_turret_{side}_{i}')
            pivot = v(x,side*1.1,1.05)
            turret.lathe(pivot,Matrix(),[(0,0),(.33,0),(.38,.08),(.3,.2),(0,.2)],'Nozzle',segments=32)
            jacket = Body([(x-.3,.28,.18,1.43),(x+.35,.3,.22,1.43),(x+1.5,.13,.14,1.43)],n=3.2,y=side*1.1)
            armour(turret,jacket,size=.23,ribs=.35,pipes=False)
            for yy in (-.1,.1):
                muzzle = v(x+1.6,side*1.1+yy,1.43)
                turret.lathe(muzzle,AXIS_X,[(.055,-.1),(.1,-.1),(.105,0),(.075,.1),(.045,.1),(.045,-.1),(.055,-.1)],'Trim',segments=24)
            parts.append((turret,'turret',pivot))
    return parts


def organic_maps(objects):
    """Cycles-baked PBR atlases: mottled skin, chitin laminae, pores and worn bone.

    UVs are packed together but meshes remain separate for the exported tendril rig.
    Normal/roughness atlases use linear data; colour is saved as an sRGB JPEG.
    """
    organic=[obj for obj in objects if obj.parent.name=='leviathan']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in organic:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=organic[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(72),island_margin=.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    materials=[]
    for name in ('Flesh','Chitin','Bone','Iris'):
        material=bpy.data.materials[name]
        nodes=material.node_tree.nodes
        links=material.node_tree.links
        bsdf=nodes['Principled BSDF']
        coordinates=nodes.new('ShaderNodeTexCoord')
        grain=nodes.new('ShaderNodeTexNoise')
        grain.inputs['Scale'].default_value=28 if name!='Iris' else 90
        grain.inputs['Detail'].default_value=5
        grain.inputs['Roughness'].default_value=.72
        links.new(coordinates.outputs['Generated'],grain.inputs['Vector'])
        ramp=nodes.new('ShaderNodeValToRGB')
        palette={
            'Flesh':((.015,.005,.018),(.11,.026,.042)),
            'Chitin':((.055,.035,.065),(.25,.17,.19)),
            'Bone':((.13,.08,.055),(.52,.41,.3)),
            'Iris':((.04,.012,.006),(.72,.24,.07)),
        }[name]
        for element,color in zip(ramp.color_ramp.elements,palette):
            element.color=(*color,1)
        links.new(grain.outputs['Fac'],ramp.inputs['Fac'])
        links.new(ramp.outputs['Color'],bsdf.inputs['Base Color'])
        pores=nodes.new('ShaderNodeTexNoise')
        pores.inputs['Scale'].default_value=150
        pores.inputs['Detail'].default_value=3
        links.new(coordinates.outputs['Generated'],pores.inputs['Vector'])
        bump=nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value=.28
        bump.inputs['Distance'].default_value=.018
        links.new(pores.outputs['Fac'],bump.inputs['Height'])
        links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
        rough=nodes.new('ShaderNodeMapRange')
        rough.inputs['To Min'].default_value=.3 if name in ('Flesh','Iris') else .45
        rough.inputs['To Max'].default_value=.58 if name in ('Flesh','Iris') else .76
        links.new(grain.outputs['Fac'],rough.inputs['Value'])
        links.new(rough.outputs['Result'],bsdf.inputs['Roughness'])
        target=nodes.new('ShaderNodeTexImage')
        nodes.active=target
        materials.append((material,target))
    scene=bpy.context.scene
    scene.render.bake.margin=8
    scene.render.bake.target='IMAGE_TEXTURES'
    scene.render.bake.use_pass_direct=False
    scene.render.bake.use_pass_indirect=False
    scene.render.bake.use_pass_color=True
    atlases={}
    for channel,size,bake in (('colour',2048,'DIFFUSE'),('normal',1024,'NORMAL'),('roughness',1024,'ROUGHNESS')):
        image=bpy.data.images.new(f'Leviathan {channel}',width=size,height=size,alpha=False)
        image.colorspace_settings.name='sRGB' if channel=='colour' else 'Non-Color'
        for _,target in materials:
            target.image=image
        # Active image targets are also required on other material slots while baking a mesh.
        extras=[]
        for name in ('Vein','Pupil'):
            material=bpy.data.materials[name]
            target=material.node_tree.nodes.new('ShaderNodeTexImage')
            target.image=image
            material.node_tree.nodes.active=target
            extras.append((material,target))
        for i,obj in enumerate(organic):
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active=obj
            scene.render.bake.use_clear=i==0
            bpy.ops.object.bake(type=bake)
        image.file_format='JPEG' if channel=='colour' else 'PNG'
        image.filepath_raw=str(ship.ROOT/f'blender/build/leviathan-{channel}.{"jpg" if channel=="colour" else "png"}')
        image.save()
        atlases[channel]=image
        for material,target in extras:
            material.node_tree.nodes.remove(target)
        print(f'Cycles PBR atlas: {channel}, {size}px',flush=True)
    for material,target in materials:
        nodes=material.node_tree.nodes
        links=material.node_tree.links
        bsdf=nodes['Principled BSDF']
        for socket in ('Base Color','Normal','Roughness'):
            for link in list(bsdf.inputs[socket].links):
                links.remove(link)
        target.image=atlases['colour']
        links.new(target.outputs['Color'],bsdf.inputs['Base Color'])
        normal=nodes.new('ShaderNodeTexImage')
        normal.image=atlases['normal']
        convert=nodes.new('ShaderNodeNormalMap')
        convert.inputs['Strength'].default_value=.6
        links.new(normal.outputs['Color'],convert.inputs['Color'])
        links.new(convert.outputs['Normal'],bsdf.inputs['Normal'])
        rough=nodes.new('ShaderNodeTexImage')
        rough.image=atlases['roughness']
        links.new(rough.outputs['Color'],bsdf.inputs['Roughness'])
        if material.name=='Iris':
            links.new(target.outputs['Color'],bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value=.7


def build(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ship.MATERIALS.update({
        'Flesh':((.035,.018,.048),.12,.44,None,0),
        'Chitin':((.13,.105,.14),.22,.46,None,0),
        'Bone':((.39,.32,.27),.05,.6,None,0),
        'Iris':((.16,.032,.02),.15,.16,(.8,.08,.025),1.8),
        'Pupil':((.002,.001,.003),.05,.16,None,0),
        'Vein':((.12,.035,.08),.1,.35,(.65,.08,.22),1.6),
        'HostileGlow':((.3,.025,.01),.15,.26,(1,.055,.01),3),
    })
    ship.EMISSIVE.update(('Iris','Vein','HostileGlow'))
    ship.create_materials()
    objects=[]
    for boss,builder in (('leviathan',leviathan),('dreadnought',dreadnought)):
        root = bpy.data.objects.new(boss,None)
        bpy.context.scene.collection.objects.link(root)
        root['boss']=boss
        marker=bpy.data.objects.new(f'{boss}_weakpoint',None)
        bpy.context.scene.collection.objects.link(marker)
        marker.parent=root
        marker.location=v(1.94,0,0) if boss=='leviathan' else v(.72,0,1.65)
        marker['bossWeakpoint']=boss
        for part,role,pivot in builder():
            obj=ship.to_object(part,bpy.context.scene.collection)
            obj['bossPart']=role
            if pivot is not None:
                for vertex in obj.data.vertices:
                    vertex.co-=pivot
                obj.location=pivot
                obj['rigIndex']=len(objects)
            obj.parent=root
            if role=='turret':
                for side in (-1,1):
                    muzzle=bpy.data.objects.new(f'{obj.name}_muzzle_{side}',None)
                    bpy.context.scene.collection.objects.link(muzzle)
                    muzzle.parent=obj
                    muzzle.location=v(1.7,side*.1,.38)
                    muzzle['bossMuzzle']=boss
            objects.append(obj)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    ship.use_gpu()
    scene.cycles.samples=48
    scene.render.bake.target='VERTEX_COLORS'
    scene.world=bpy.data.worlds.new('Abyss')
    for obj in objects:
        for other in objects:
            other.hide_render=other.parent!=obj.parent
        mesh=obj.data
        ao=mesh.color_attributes.new('AO','FLOAT_COLOR','CORNER')
        mesh.color_attributes.active_color=ao
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.bake(type='AO')
        glowing={i for i,m in enumerate(mesh.materials) if m.name in ship.EMISSIVE}
        emissive={i for poly in mesh.polygons if poly.material_index in glowing for i in poly.loop_indices}
        for i,(c,a) in enumerate(zip(mesh.color_attributes['Col'].data,ao.data)):
            if i not in emissive:
                k=.38+.62*a.color[0]
                c.color=(c.color[0]*k,c.color[1]*k,c.color[2]*k,1)
        mesh.color_attributes.remove(ao)
        mesh.color_attributes.active_color=mesh.color_attributes['Col']
        print(f'Boss part: {obj.name}, {len(mesh.polygons)} polygons, 48-sample AO',flush=True)
    for obj in objects:
        obj.hide_render=False
    organic_maps(objects)
    ship.export(Path(out))
    # Side-by-side editable authoring scene after exporting origin-centred runtime prototypes.
    bpy.data.objects['leviathan'].location.y=-8
    bpy.data.objects['dreadnought'].location.y=8
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(out).with_suffix('.blend')))


if __name__=='__main__':
    args=ship.script_args()
    build(args[0] if args else ship.ROOT/'blender/build/bosses.raw.glb')
