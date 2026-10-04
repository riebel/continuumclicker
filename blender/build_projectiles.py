"""Flight models: guided missile, plasma capsule and tungsten rail dart.

Machined bodies, recessed optical noses, deployable-style swept fins, cooling jackets,
nozzle throats and contact shadows share the ship's original Blender materials.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_ship as ship
from build_ship import Body, Part, v, AXIS_X


def fin(p, angle, x0=-0.67, x1=-0.14, reach=0.34):
    rotation = Matrix.Rotation(angle, 4, 'X')
    outline = [(x0, 0.115), (x0 + 0.09, reach), (x1, reach * 0.76), (x1 + 0.08, 0.12)]
    verts = [p.bm.verts.new(rotation @ v(x, y, z)) for z in (-0.011, 0.011) for x, y in outline]
    faces = [p.bm.faces.new(tuple(verts[:4][::-1])), p.bm.faces.new(tuple(verts[4:]))]
    for i in range(4):
        faces.append(p.bm.faces.new((verts[i], verts[(i + 1) % 4], verts[(i + 1) % 4 + 4], verts[i + 4])))
    p.paint(faces, 'Trim', p.shade('Trim', 0.9), False)
    edges = list({edge for face in faces for edge in face.edges})
    bevelled = bmesh.ops.bevel(p.bm, geom=edges, offset=0.005, segments=2, affect='EDGES')
    p.paint(bevelled['faces'], 'Trim', p.shade('Trim', 0.9), False)
    # An actual hinge and leading-edge rib, not a coloured triangle.
    p.sweep([rotation @ v(x0 + 0.04, 0.12, 0), rotation @ v(x1, 0.12, 0)], 0.018, 'HullDark', sides=10)
    p.sweep([rotation @ v(x0 + 0.12, reach - 0.015, 0), rotation @ v(x1 - 0.015, reach * 0.76 - 0.015, 0)], 0.009, 'Copper', sides=8)


def hydra(p):
    p.lathe(v(0, 0, 0), AXIS_X, [(0, -0.67), (0.1, -0.67), (0.13, -0.62),
        (0.14, -0.52), (0.14, 0.28), (0.12, 0.42), (0.09, 0.61), (0.058, 0.65), (0, 0.65)], 'Hull', segments=48)
    body = Body([(-0.51, 0.142, 0.142, 0), (0.25, 0.142, 0.142, 0), (0.43, 0.122, 0.122, 0)])
    for k in range(8):
        p.shell(body, -0.47, 0.22, k / 8 + 0.007, (k + 1) / 8 - 0.007,
                -0.004, 0.013, 'Trim' if k % 3 == 0 else 'Hull', bevel=0.008, seg=0.05, dx=0.16)
        for x in (-0.4, 0.16):
            point = body.point(x, (k + 0.5) / 8, 0.02)
            p.sphere(point, 0.008, 'Copper', segments=8, rings=5)
    for x in (-0.55, 0.28, 0.44):
        p.torus(v(x, 0, 0), 0.14 if x < 0.3 else 0.119, 0.012, AXIS_X, 'Copper', seg=40, seg_minor=6)
    # Dark seeker lens nested in a stepped front bezel.
    p.lathe(v(0.63, 0, 0), AXIS_X, [(0.05, 0), (0.069, 0), (0.064, 0.08), (0.035, 0.11), (0, 0.11)], 'Nozzle', segments=32)
    p.lathe(v(0.738, 0, 0), AXIS_X, [(0, 0), (0.032, 0), (0.029, 0.008), (0, 0.013)], 'SeekerGlass', segments=32)
    for k in range(4):
        fin(p, math.pi / 4 + k * math.pi / 2)
        rotation = Matrix.Rotation(math.pi / 4 + k * math.pi / 2, 4, 'X')
        for x in (-0.57, -0.25):
            p.box(rotation @ v(x, 0.14, 0), (0.06, 0.04, 0.065), 'HullDark', rot=rotation)
            p.sphere(rotation @ v(x, 0.165, 0), 0.012, 'Copper', segments=10, rings=6)
    # A ventilated motor collar, separate from the guidance and warhead panels.
    for k in range(12):
        rotation = Matrix.Rotation(k * math.pi / 6, 4, 'X')
        p.sweep([rotation @ v(-0.62, 0.137, 0), rotation @ v(-0.51, 0.147, 0)], 0.008, 'HullDark', sides=8)
    p.lathe(v(0, 0, 0), AXIS_X, [(0, -0.75), (0.055, -0.75), (0.075, -0.7), (0.095, -0.62), (0, -0.62)], 'Nozzle', segments=32)
    p.engine(v(-0.74, 0, 0), v(-1, 0, 0), 0.075, kind='nacelle')


def plasma(p):
    # Conductive sabot and an exposed emissive capsule protected by four metal petals.
    p.lathe(v(0, 0, 0), AXIS_X, [(0, -0.55), (0.13, -0.55), (0.2, -0.4),
        (0.2, -0.25), (0.14, -0.18), (0.12, 0.05), (0, 0.05)], 'Nozzle', segments=48)
    p.lathe(v(0.05, 0, 0), AXIS_X, [(0, -0.25), (0.12, -0.25), (0.16, -0.08),
        (0.17, 0.13), (0.14, 0.29), (0.08, 0.46), (0, 0.55)], 'PlasmaCore', segments=48)
    for x in (-0.4, -0.3, -0.2):
        p.torus(v(x, 0, 0), 0.2, 0.018, AXIS_X, 'Copper', seg=40, seg_minor=6)
    jacket = Body([(-0.25, 0.2, 0.2, 0), (0.05, 0.225, 0.225, 0), (0.34, 0.195, 0.195, 0)])
    for k in range(4):
        p.shell(jacket, -0.24, 0.32, k / 4 + 0.07, k / 4 + 0.18, -0.01, 0.012,
                'Trim', bevel=0.015, seg=0.04, dx=0.15)
        p.pipe(jacket, k / 4 + 0.125, -0.22, 0.3, 0.009, 0.02, 'Copper', sides=10)
    p.jet(v(-0.53, 0, 0), v(-1, 0, 0), 0.075, kind='nacelle')


def rail(p):
    p.lathe(v(0, 0, 0), AXIS_X, [(0, -0.7), (0.08, -0.7), (0.09, -0.62),
        (0.09, 0.12), (0.065, 0.39), (0.025, 0.75), (0, 0.87)], 'Trim', segments=40)
    for x in (-0.55, -0.35, -0.15):
        p.torus(v(x, 0, 0), 0.095, 0.011, AXIS_X, 'Copper', seg=32, seg_minor=5)
    p.lathe(v(-0.68, 0, 0), AXIS_X, [(0, 0), (0.065, 0), (0.065, 0.02), (0, 0.02)], 'RailIon', segments=24)
    for k in range(4):
        fin(p, k * math.pi / 2, x0=-0.66, x1=-0.4, reach=0.18)


def build(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ship.MATERIALS['SeekerGlass'] = ((0.025, 0.11, 0.16), 0.35, 0.12, (0.04, 0.4, 0.6), 0.5)
    ship.MATERIALS['PlasmaCore'] = ((0.4, 0.05, 0.2), 0.15, 0.2, (1.0, 0.12, 0.43), 4.0)
    ship.MATERIALS['RailIon'] = ((0.08, 0.3, 0.18), 0.1, 0.2, (0.3, 1, 0.55), 3.0)
    ship.EMISSIVE.update(('SeekerGlass', 'PlasmaCore', 'RailIon'))
    ship.create_materials()
    objects = []
    for name, builder in [('hydra_missile', hydra), ('plasma_capsule', plasma), ('rail_dart', rail)]:
        part = Part(name, rng=random.Random(name))
        builder(part)
        obj = ship.to_object(part, bpy.context.scene.collection)
        obj['projectile'] = name
        objects.append(obj)
    # Bake each flight model in isolation, preserving emissive throats/lenses.
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    ship.use_gpu()
    scene.cycles.samples = 64
    scene.world = bpy.data.worlds.new('Projectile World')
    scene.world.light_settings.distance = 0.15
    scene.render.bake.target = 'VERTEX_COLORS'
    for obj in objects:
        for other in objects:
            other.hide_render = other != obj
        mesh = obj.data
        ao = mesh.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        mesh.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO')
        emissive_mats = {i for i, m in enumerate(mesh.materials) if m.name in ship.EMISSIVE}
        emissive = {i for poly in mesh.polygons if poly.material_index in emissive_mats for i in poly.loop_indices}
        colors = mesh.color_attributes['Col']
        for i, (color, shade) in enumerate(zip(colors.data, ao.data)):
            if i not in emissive:
                factor = 0.4 + 0.6 * shade.color[0]
                color.color = (color.color[0] * factor, color.color[1] * factor, color.color[2] * factor, 1)
        mesh.color_attributes.remove(ao)
        mesh.color_attributes.active_color = colors
        print(f'Projectile: {obj.name}, {len(mesh.polygons)} polygons, 64-sample AO', flush=True)
    for obj in objects:
        obj.hide_render = False
    ship.export(Path(out))
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(out).with_suffix('.blend')))


if __name__ == '__main__':
    args = ship.script_args()
    build(args[0] if args else ship.ROOT / 'blender/build/projectiles.raw.glb')
