"""Additive ship hardpoints: plated sponsons, paired guns and outboard missile batteries.

Every vertex is authored in Blender using the original hull's lofts, plate bevels and metals.
Fixed roots and independently aimed assemblies are exported separately. No alternative loadouts.
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
from build_ship import Body, Part, v, spar, AXIS_X
from build_refits import ACCENTS, armour, barrel, weapon_model

# X forward, Y port/starboard, Z up. Armaments remain clear of the seven hull forms.
HARDPOINTS = [
    ('pulse', 'prow', (9.3, 0, 1.1), 1.0, False),
    ('plasma', 'port-shoulder', (6.1, 2.5, 1.45), 0.95, False),
    ('plasma', 'starboard-shoulder', (6.1, -2.5, 1.45), 0.95, False),
    ('railgun', 'ventral-spine', (8.8, 0, -1.05), 1.1, True),
    ('tesla', 'port-coils', (2.65, 2.3, 1.9), 0.92, False),
    ('tesla', 'starboard-coils', (2.65, -2.3, 1.9), 0.92, False),
    ('cryo', 'port-coolant', (4.25, 2.7, -0.65), 0.92, True),
    ('cryo', 'starboard-coolant', (4.25, -2.7, -0.65), 0.92, True),
    ('swarm', 'port-battery', (-1.45, 3.6, 0.8), 1.0, False),
    ('swarm', 'starboard-battery', (-1.45, -3.6, 0.8), 1.0, False),
    ('singularity', 'aft-projector', (-6.65, 0, 4.2), 1.12, False),
]
SEAT = v(9.3, 0, ship.SPINE.point(9.3, 0.25).z + 0.05)


def fixed_root(p, weapon, position, inverted):
    x, y, z = position
    # Root saddles follow the hull surface, with plated outriggers and separate hydraulic braces.
    body = ship.UPPER_POD if x < -3 else ship.NECK if x < 1.8 else ship.SPINE
    if abs(y) > 0:
        side = 1 if y > 0 else -1
        root = body.point(x, 0.08 if side > 0 else 0.42)
        p.shell(body, x - 0.55, x + 0.55, (0.08 if side > 0 else 0.42) - 0.07,
                (0.08 if side > 0 else 0.42) + 0.07, -0.02, 0.16, 'Trim', bevel=0.04)
        end = v(x, y, z)
        bridge = spar(root, end, [(0, 0.46, 0.2), (0.25, 0.52, 0.24),
                                 (0.8, 0.35, 0.19), (1, 0.3, 0.14)], n=3.0)
        armour(p, bridge, size=0.3, ribs=0.4, pipes=False)
        for dx in (-0.38, 0.38):
            p.sweep([root + v(dx, 0, -0.12), end + v(dx * 0.65, 0, -0.12)],
                    0.055, 'Copper', sides=10)
        p.sweep([root + v(-0.25, 0, -0.18), end + v(-0.25, 0, -0.18)],
                0.09, 'HullDark', sides=10)
    else:
        t = 0.75 if inverted else 0.25
        root = body.point(x, t)
        p.shell(body, x - 0.62, x + 0.62, t - 0.09, t + 0.09,
                -0.01, 0.12, 'Hull', bevel=0.045)
        if (root - v(x, y, z)).length > 0.2:
            stem = spar(root, v(x, y, z), [(0, 0.48, 0.36), (0.65, 0.32, 0.25), (1, 0.34, 0.25)])
            armour(p, stem, size=0.27, ribs=0.4, pipes=False)
    normal = v(0, 0, -1 if inverted else 1)
    orientation = Matrix.Rotation(math.pi, 4, 'X') if inverted else Matrix.Identity(4)
    p.lathe(v(x, y, z), orientation, [(0.48, -0.14), (0.75, -0.14), (0.8, -0.06),
            (0.8, 0.03), (0.68, 0.1), (0.48, 0.1), (0.48, -0.14)], 'HullDark', segments=40)
    for k in range(8):
        a = k * math.pi / 4
        c = v(x + 0.69 * math.cos(a), y + 0.69 * math.sin(a), z) + normal * 0.05
        p.lathe(c, orientation, [(0, 0), (0.035, 0), (0.048, 0.025), (0.03, 0.04), (0, 0.04)],
                'Copper', segments=8)


def missile_cell(p, x, y, z, accent):
    # A machined launch sleeve, dark recess and an actual metallic missile nose inside it.
    barrel(p, v(x, y, z), 0.38, 0.13, accent)
    p.lathe(v(x + 0.25, y, z), AXIS_X,
            [(0, -0.09), (0.075, -0.09), (0.082, 0.01), (0.065, 0.12), (0.012, 0.23), (0, 0.24)],
            'Trim', segments=20)
    p.torus(v(x + 0.27, y, z), 0.08, 0.008, AXIS_X, 'Copper', seg=20, seg_minor=5)


def missile_battery(p, level):
    accent = 'Weapon-swarm'
    if level == 1:
        pod = Body([(-1.0, 0.28, 0.36, 0.46), (-0.7, 0.61, 0.68, 0.46),
                    (0.65, 0.61, 0.68, 0.46), (1.1, 0.53, 0.62, 0.46)], n=3.4)
        armour(p, pod, size=0.28, ribs=0.4)
        p.hatch(pod, -0.35, 0.25, 0.25, 0.1)
        for yy in (-0.25, 0.25):
            for zz in (0.05, 0.46, 0.87):
                missile_cell(p, 1.08, yy, zz, accent)
        # Armoured magazine spine and service hinges along both sides.
        for side in (-1, 1):
            for x in (-0.55, 0.05, 0.65):
                p.lathe(v(x, side * 0.63, 0.46), AXIS_X,
                        [(0, -0.06), (0.055, -0.06), (0.07, -0.02), (0.07, 0.02), (0, 0.06)],
                        'Copper', segments=12)
            p.sweep([v(-0.65, side * 0.61, 0.85), v(0.45, side * 0.61, 0.85)], 0.022, accent)
        return [v(1.47, -0.25, 0.46), v(1.47, 0.25, 0.46)]
    # Each upgrade adds a physical two-cell cassette in its own bay, never replacing the bank.
    yy, zz = {2: (0, 1.36), 3: (0, -0.46), 4: (0.89, 0.46), 5: (-0.89, 0.46)}[level]
    cassette = Body([(-0.65, 0.17, 0.16, zz), (-0.4, 0.33, 0.22, zz),
                     (0.85, 0.33, 0.22, zz), (1.02, 0.29, 0.2, zz)], n=3.1, y=yy)
    armour(p, cassette, size=0.23, ribs=0.32, pipes=False)
    for dy in (-0.15, 0.15):
        missile_cell(p, 1.0, yy + dy, zz, accent)
    for x in (-0.3, 0.6):
        p.sweep([v(x, yy, zz), v(x, yy * 0.3, 0.46)], 0.045, 'HullDark', sides=8)
    return []


def bake(objects, hull):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    ship.use_gpu()
    scene.cycles.samples = 32
    scene.world = bpy.data.worlds.new('Arsenal AO world')
    scene.world.light_settings.distance = 0.7
    scene.render.bake.target = 'VERTEX_COLORS'
    # All banks coexist. Only levels above the current tier must not cast early shadows.
    for obj in objects:
        tier = obj.get('weaponTier', 1)
        for other in objects:
            other.hide_render = other.get('weaponTier', 1) > tier
        hull.hide_render = False
        mesh = obj.data
        ao = mesh.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        mesh.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO')
        lit = {i for i, mat in enumerate(mesh.materials) if mat.name in ship.EMISSIVE}
        emissive = {i for poly in mesh.polygons if poly.material_index in lit for i in poly.loop_indices}
        col = mesh.color_attributes['Col']
        for i, (c, a) in enumerate(zip(col.data, ao.data)):
            if i not in emissive:
                k = 0.3 + 0.7 * a.color[0]
                c.color = (c.color[0] * k, c.color[1] * k, c.color[2] * k, 1)
        mesh.color_attributes.remove(ao)
        mesh.color_attributes.active_color = col
        print(f'Baked AO: {obj.name}', flush=True)
    for obj in objects:
        obj.hide_render = False


def build(out, ao=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for weapon, color in ACCENTS.items():
        ship.MATERIALS[f'Weapon-{weapon}'] = (color, 0.15, 0.45, color, 1.8)
        ship.EMISSIVE.add(f'Weapon-{weapon}')
    ship.create_materials()
    collection = bpy.context.scene.collection
    objects = []
    for weapon, name, coordinates, scale, inverted in HARDPOINTS:
        seat = v(*coordinates)
        mount_id = f'{weapon}-{name}'
        root = Part(f'root__{mount_id}', rng=random.Random(mount_id))
        fixed_root(root, weapon, seat, inverted)
        root_obj = ship.to_object(root, collection)
        root_obj['weapon'], root_obj['weaponTier'], root_obj['fixedMount'] = weapon, 1, True
        objects.append(root_obj)
        mount = bpy.data.objects.new(f'mount__{mount_id}', None)
        mount.location = seat
        mount['weaponMount'], mount['weaponSystem'] = mount_id, weapon
        collection.objects.link(mount)
        rotation = Matrix.Rotation(math.pi, 4, 'X') if inverted else Matrix.Identity(4)
        transform = Matrix.Translation(seat) @ rotation @ Matrix.Scale(scale, 4)
        for tier in range(1, 2 if weapon == 'pulse' else 6):
            part = Part(f'arsenal__{mount_id}__{tier}', rng=random.Random(f'{mount_id}-{tier}'))
            if weapon == 'swarm':
                muzzles = missile_battery(part, tier)
            else:
                muzzle = weapon_model(part, weapon, tier)
                bmesh.ops.transform(part.bm, matrix=Matrix.Translation(-SEAT), verts=list(part.bm.verts))
                muzzles = [] if muzzle is None else [muzzle - SEAT]
            bmesh.ops.transform(part.bm, matrix=transform, verts=list(part.bm.verts))
            obj = ship.to_object(part, collection)
            obj['weapon'], obj['weaponTier'], obj['mount'] = weapon, tier, mount_id
            objects.append(obj)
            for i, muzzle in enumerate(muzzles):
                marker = bpy.data.objects.new(f'muzzle__{mount_id}__{i}', None)
                marker.location = transform @ muzzle
                marker['muzzle'] = weapon
                marker.parent = obj
                collection.objects.link(marker)
    if ao:
        context = Part('Hull AO context')
        for body in (ship.UPPER_POD, ship.LOWER_POD, ship.WEB, ship.NECK, ship.SPINE, *ship.BOOMS.values()):
            context.skin(body, 'Hull', seg=0.4, dx=0.5)
        hull = ship.to_object(context, collection)
        bake(objects, hull)
        bpy.data.objects.remove(hull, do_unlink=True)
    print(f'Arsenal: {len(HARDPOINTS)} hardpoints, {len(objects)} meshes, '
          f'{sum(len(o.data.polygons) for o in objects)} polygons', flush=True)
    ship.export(Path(out))
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(out).with_suffix('.blend')))


if __name__ == '__main__':
    argv = ship.script_args()
    args = [a for a in argv if not a.startswith('--')]
    build(args[0] if args else ship.ROOT / 'blender/build/arsenal.raw.glb', ao='--no-bake' not in argv)
