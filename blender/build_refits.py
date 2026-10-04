"""Blender-built hull refits and weapon assemblies, sharing the original ship's mesh tools.

    node blender/run.mjs build_refits.py [out.glb] [--no-bake]

Geometry is authored in ship coordinates, with surface-following armour, recessed machinery,
lathed bores, heat exchangers and vertex-colour AO. Extras drive the game's deploy animations.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Matrix
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_ship as ship
from build_ship import Body, Part, v, spar, frange, AXIS_X, BACK

WEAPONS = ('pulse', 'plasma', 'railgun', 'tesla', 'cryo', 'swarm', 'singularity')
ACCENTS = {
    'pulse': (1.0, 0.35, 0.08), 'plasma': (0.95, 0.12, 0.3),
    'railgun': (0.18, 0.85, 0.48), 'tesla': (0.55, 0.28, 1.0),
    'cryo': (0.15, 0.72, 1.0), 'swarm': (1.0, 0.65, 0.15),
    'singularity': (0.26, 0.35, 1.0),
}


def armour(p, body, size=0.65, ribs=0.85, pipes=True):
    """Use exactly the hull's original metal palette and layered surface treatment."""
    p.skin(body, 'Hull', seg=0.18, dx=0.3, tint=None)
    a, b = body.x0 + 0.12, body.x1 - 0.12
    p.plating(body, a, b, 0.0, 1.0, size=size, heights=(0.025, 0.075))
    p.frames(body, frange(a + 0.2, b - 0.2, ribs), 0.0, 1.0,
             height=(0.075, 0.14), width=0.08)
    if pipes:
        for t in (0.05, 0.45):
            p.pipe(body, t, a + 0.1, b - 0.1, 0.026, 0.06, 'Copper', sides=6)


def nacelle(p, y, z, x0, x1, radius):
    body = Body([(x0, radius * 0.78, radius * 0.76, z),
                 (x0 + 0.4, radius, radius * 0.92, z),
                 (x1 - 0.9, radius * 0.85, radius * 0.8, z),
                 (x1 - 0.25, radius * 0.42, radius * 0.46, z),
                 (x1, radius * 0.12, radius * 0.16, z)], n=2.6, y=y)
    armour(p, body, size=0.75, ribs=1.0)
    p.engine(v(x0, y, z), BACK, radius * 0.64, kind='nacelle')
    for x in (x0 + 0.6, x1 - 1.0):
        p.band(body, x, 0.16, 0.12, 'Trim')
    # Light stays inside narrow recessed vent channels, rather than covering the pod.
    for t in (0.14, 0.36):
        p.pipe(body, t, x0 + 0.7, x1 - 1.1, 0.018, 0.025, 'Matrix', sides=6)


def wing(p, side, outer, x, z):
    root = v(x + 1.1, side * 1.9, 1.0)
    tip = v(x - 1.0, side * outer, z)
    body = spar(root, tip, [(0, 1.2, 0.24), (0.18, 1.4, 0.3),
                           (0.65, 1.0, 0.24), (1, 0.48, 0.13)], n=3.2)
    armour(p, body, size=0.55, ribs=0.75)
    # Separate hydraulic spars and a nested root bearing give the fin a mechanical attachment.
    for dx in (-0.6, 0.6):
        p.sweep([root + v(dx, 0, -0.16), tip + v(dx * 0.4, 0, -0.16)], 0.075, 'HullDark')
    p.hatch(body, body.x1 * 0.45, 0.25, 0.18, 0.08)


def containment(p, x, radius, z=0.0):
    """Armoured containment wheel: metal sectors, clamps and sparse inset emitters."""
    center = v(x, 0, z)
    p.lathe(center, AXIS_X, [(radius - 0.13, -0.17), (radius + 0.11, -0.17),
            (radius + 0.2, -0.1), (radius + 0.2, 0.1), (radius + 0.11, 0.17),
            (radius - 0.13, 0.17), (radius - 0.17, 0.08),
            (radius - 0.17, -0.08), (radius - 0.13, -0.17)], 'Hull', segments=64)
    for dx in (-0.16, 0.16):
        p.torus(center + v(dx, 0, 0), radius + 0.04, 0.035, AXIS_X, 'Trim', seg=64, seg_minor=6)
    for k in range(16):
        a = 2 * math.pi * k / 16
        r = radius + 0.17
        point = center + v(0, math.cos(a) * r, math.sin(a) * r)
        # Longitudinal collar teeth and service fasteners, all rounded rather than flat boxes.
        p.lathe(point, AXIS_X, [(0, -0.24), (0.095, -0.24), (0.13, -0.18),
                              (0.13, 0.18), (0.095, 0.24), (0, 0.24)], 'Trim', segments=10)
        if k % 2 == 0:
            p.sphere(center + v(0, math.cos(a) * (radius - 0.12), math.sin(a) * (radius - 0.12)),
                     0.055, 'Reactor', segments=10, rings=6)
        if k % 4 == 0:
            inner = center + v(-0.15, math.cos(a) * (radius * 0.62), math.sin(a) * (radius * 0.62))
            outer = center + v(0.15, math.cos(a) * (radius - 0.16), math.sin(a) * (radius - 0.16))
            support = spar(inner, outer, [(0, 0.17, 0.11), (1, 0.24, 0.1)])
            armour(p, support, size=0.38, ribs=0.6, pipes=False)


def refit(stage, p):
    if stage == 1:
        for side in (-1, 1):
            wing(p, side, 4.05, -4.0, 0.35)
            nacelle(p, side * 4.05, 0.35, -8.0, -2.0, 0.62)
    elif stage == 2:
        for side in (-1, 1):
            rail = Body([(2.5, 0.16, 0.18, 0.45), (3.0, 0.36, 0.32, 0.45),
                         (7.5, 0.29, 0.28, 0.35), (10.5, 0.1, 0.12, 0.25)],
                        n=2.8, y=side * 1.65)
            armour(p, rail, size=0.45, ribs=0.8)
            for x in (3.2, 5.2, 7.2):
                t = 0.02 if side > 0 else 0.48
                p.shell(ship.SPINE, x - 0.35, x + 0.35, t - 0.09, t + 0.09,
                        -0.02, 0.18, 'Trim', bevel=0.045)
    elif stage == 3:
        for side in (-1, 1):
            wing(p, side, 5.85, -4.0, 1.2)
            nacelle(p, side * 5.85, 1.2, -7.2, -0.6, 0.86)
        containment(p, 0.8, 2.35, 0.15)
    elif stage == 4:
        for tier, (a, b, width, height, z) in enumerate((
                (-3.4, -0.4, 0.9, 0.34, 3.05),
                (-2.85, -0.7, 0.7, 0.28, 3.65),
                (-2.45, -0.8, 0.58, 0.23, 4.12))):
            deck = Body([(a, width * 0.55, height * 0.6, z), (a + 0.3, width, height, z),
                         (b - 0.3, width, height, z), (b, width * 0.6, height * 0.65, z)], n=3.0)
            armour(p, deck, size=0.42, ribs=0.6, pipes=False)
            for t in (0.02, 0.48):
                dt = 0.03 / deck.perimeter((a + b) / 2)
                for x in frange(a + 0.38, b - 0.38, 0.2):
                    p.shell(deck, x - 0.06, x + 0.06, t - dt, t + dt, 0.0, 0.018,
                            'Window', bevel=0.005, tint=1.0)
        p.dish(Matrix.Translation(v(-3.0, 0.8, 3.5)), 0.36, tilt=0.4)
        for side in (-1, 1):
            for body in (ship.UPPER_POD, ship.LOWER_POD):
                t = 0.03 if side > 0 else 0.47
                p.plating(body, -6.9, -3.0, t - 0.075, t + 0.075,
                          base=0.15, size=0.6, heights=(0.09, 0.2))
    elif stage == 5:
        for side in (-1, 1):
            body = Body([(1.3, 0.16, 0.18, 1.2), (1.8, 0.48, 0.44, 1.2),
                         (7.8, 0.4, 0.36, 1.05), (9.2, 0.24, 0.22, 1.05)],
                        n=2.8, y=side * 2.5)
            armour(p, body, size=0.5, ribs=0.7)
            for x in (2.3, 5.0, 7.6):
                bridge = spar(v(x, side * 1.1, 0.7), v(x, side * 2.5, 1.05),
                              [(0, 0.35, 0.15), (1, 0.45, 0.16)])
                armour(p, bridge, size=0.38, ribs=0.5, pipes=False)
            barrel(p, v(9.1, side * 2.5, 1.05), 2.7, 0.18, 'Matrix')
    else:
        containment(p, -6.4, 3.7)
        containment(p, -3.3, 3.6)
        for side in (-1, 1):
            connector = spar(v(-4.8, side * 1.75, -1.45), v(-5.9, side * 4.55, -1.7),
                             [(0, 0.8, 0.24), (1, 0.65, 0.2)], n=3.0)
            armour(p, connector, size=0.55, ribs=0.7)
            nacelle(p, side * 4.55, -1.7, -8.3, -2.5, 0.72)


def barrel(p, origin, length, radius, accent):
    """Metal stepped barrel with a real dark bore and a small recessed emitter."""
    r, l = radius, length
    p.lathe(origin, AXIS_X, [(0, 0), (r * 1.65, 0), (r * 1.65, 0.15),
            (r * 1.25, 0.22), (r, l - 0.25), (r * 1.42, l - 0.2),
            (r * 1.42, l), (r * 0.65, l), (r * 0.65, l - 0.18)], 'Nozzle', segments=24)
    for x in frange(0.25, l - 0.32, 0.24):
        p.torus(origin + v(x, 0, 0), r * 1.15, r * 0.15, AXIS_X, 'Trim', seg=20, seg_minor=6)
    p.lathe(origin + v(l - 0.14, 0, 0), AXIS_X,
            [(r * 0.6, 0), (r * 0.4, 0), (r * 0.4, 0.03), (r * 0.6, 0.03)],
            accent, segments=24, tint=1.0)


def weapon_base(p, weapon):
    center = v(9.3, 0, ship.SPINE.point(9.3, 0.25).z + 0.05)
    p.lathe(center, Matrix.Identity(4), [(0, -0.12), (0.65, -0.12), (0.73, -0.04),
            (0.73, 0.14), (0.6, 0.23), (0.5, 0.26), (0, 0.26)], 'Trim', segments=32)
    m = Matrix.Translation(center + v(0, 0, 0.48))
    housing = Body([(-0.95, 0.28, 0.18, 0), (-0.65, 0.62, 0.34, 0),
                    (0.5, 0.59, 0.32, 0), (1.0, 0.3, 0.2, 0)], n=2.8, matrix=m)
    armour(p, housing, size=0.32, ribs=0.45)
    p.hatch(housing, -0.28, 0.25, 0.2, 0.1)
    # Recessed service indicators retain each weapon's colour without washing out its metal.
    for side in (-1, 1):
        p.sweep([m @ v(-0.7, side * 0.62, 0), m @ v(0.2, side * 0.56, 0)],
                0.035, 'HullDark')
        p.sphere(m @ v(-0.6, side * 0.62, 0.05), 0.035, f'Weapon-{weapon}', segments=10, rings=6)
    return m


def weapon_model(p, weapon, level):
    accent = f'Weapon-{weapon}'
    center = v(9.3, 0, ship.SPINE.point(9.3, 0.25).z + 0.53)
    if level > 1:
        # Additional heat exchangers and armoured capacitor collars occupy distinct bays.
        x = 8.55 + (level - 2) * 0.36
        for side in (-1, 1):
            c = v(x, side * 0.67, center.z - 0.05)
            p.lathe(c, AXIS_X, [(0, -0.1), (0.16, -0.1), (0.2, -0.06),
                    (0.2, 0.06), (0.16, 0.1), (0, 0.1)], 'Copper', segments=16)
            p.torus(c, 0.205, 0.018, AXIS_X, 'Trim', seg=20, seg_minor=5)
            p.sphere(c + v(0, side * 0.2, 0), 0.028, accent, segments=8, rings=6)
        return None
    m = weapon_base(p, weapon)
    local = lambda x, y=0, z=0: m @ v(x, y, z)
    muzzle = local(2.8)
    if weapon in ('pulse', 'plasma', 'cryo'):
        radius = {'pulse': 0.1, 'plasma': 0.25, 'cryo': 0.14}[weapon]
        length = {'pulse': 1.7, 'plasma': 1.6, 'cryo': 2.1}[weapon]
        barrel(p, local(0.8), length, radius, accent)
        muzzle = local(0.8 + length)
        if weapon == 'plasma':
            for x in (-0.45, -0.05, 0.35):
                p.torus(local(x), 0.4, 0.045, AXIS_X, 'Copper', seg=28, seg_minor=6)
            for side in (-1, 1):
                cooler = Body([(-0.75, 0.07, 0.1, 0), (-0.55, 0.16, 0.25, 0),
                               (0.5, 0.16, 0.25, 0), (0.65, 0.07, 0.1, 0)],
                              n=3.0, matrix=m @ Matrix.Translation((0, side * 0.65, 0)))
                armour(p, cooler, size=0.25, ribs=0.3, pipes=False)
        elif weapon == 'cryo':
            for side in (-1, 1):
                c = local(-0.5, side * 0.76, 0.0)
                p.lathe(c, AXIS_X, [(0, -0.55), (0.16, -0.55), (0.22, -0.38),
                        (0.22, 0.35), (0.16, 0.48), (0, 0.5)], 'Trim', segments=24)
                for dx in (-0.3, 0, 0.3):
                    p.torus(c + v(dx, 0, 0), 0.23, 0.026, AXIS_X, 'Copper', seg=24, seg_minor=6)
                p.sweep([c + v(0.4, 0, 0), local(0.95, side * 0.25, 0), local(1.2, side * 0.14, 0)],
                        0.035, 'HullDark')
    elif weapon == 'railgun':
        for side in (-1, 1):
            rail = Body([(0.55, 0.08, 0.1, 0), (0.85, 0.16, 0.15, 0),
                         (2.8, 0.12, 0.12, 0), (3.2, 0.08, 0.08, 0)],
                        n=3.0, matrix=m @ Matrix.Translation((0, side * 0.27, 0)))
            armour(p, rail, size=0.28, ribs=0.3, pipes=False)
            for x in frange(1.0, 2.85, 0.24):
                p.band(rail, x, 0.05, 0.045, 'Copper')
            p.pipe(rail, 0.0 if side < 0 else 0.5, 1, 2.8, 0.012, 0, accent, sides=6)
        muzzle = local(3.2)
    elif weapon == 'tesla':
        for side in (-1, 1):
            c = local(1.75, side * 0.43, 0.12)
            barrel(p, local(0.6, side * 0.43, 0.12), 1.08, 0.1, accent)
            p.sphere(c, 0.16, 'Trim', segments=24, rings=16)
            p.torus(c, 0.18, 0.024, AXIS_X, 'Copper', seg=28, seg_minor=6)
            p.sphere(c + v(0.13, 0, 0), 0.067, accent, segments=16, rings=10)
            for x in frange(0.75, 1.5, 0.15):
                p.torus(local(x, side * 0.43, 0.12), 0.14, 0.022, AXIS_X, 'Copper', seg=20, seg_minor=6)
        muzzle = local(1.95)
    elif weapon == 'swarm':
        for side in (-1, 1):
            pod = Body([(-0.5, 0.22, 0.22, 0), (-0.3, 0.34, 0.46, 0),
                        (1.1, 0.34, 0.46, 0), (1.3, 0.3, 0.41, 0)],
                       n=3.2, matrix=m @ Matrix.Translation((0, side * 0.62, 0)))
            armour(p, pod, size=0.3, ribs=0.4, pipes=False)
            for z in (-0.27, 0, 0.27):
                barrel(p, local(1.22, side * 0.62, z), 0.3, 0.11, accent)
        muzzle = local(1.52)
    else:
        c = local(1.5)
        # Machined emitter ring with an open aperture, radial stators and armoured side supports.
        p.lathe(c, AXIS_X, [(0.43, -0.2), (0.65, -0.2), (0.74, -0.1), (0.74, 0.1),
                (0.65, 0.2), (0.43, 0.2), (0.4, 0.12), (0.4, -0.12), (0.43, -0.2)],
                'Hull', segments=48)
        for x in (-0.16, 0.16):
            p.torus(c + v(x, 0, 0), 0.62, 0.035, AXIS_X, 'Copper', seg=48, seg_minor=6)
        for k in range(12):
            a = k * math.pi / 6
            position = c + v(0, 0.69 * math.cos(a), 0.69 * math.sin(a))
            p.lathe(position, AXIS_X, [(0, -0.24), (0.06, -0.24), (0.1, -0.18),
                    (0.1, 0.18), (0.06, 0.24), (0, 0.24)], 'Trim', segments=12)
            if k % 2 == 0:
                p.sphere(c + v(0.18, 0.44 * math.cos(a), 0.44 * math.sin(a)),
                         0.036, accent, segments=10, rings=6)
        for side in (-1, 1):
            p.sweep([local(0.5, side * 0.4, -0.2), local(1.4, side * 0.7, -0.15)], 0.08, 'Trim')
        muzzle = c + v(0.24, 0, 0)
    return muzzle


def bake_ao(objects, tags, hull):
    """Bake mutually exclusive loadouts separately; later hull forms cannot shadow earlier ones."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    ship.use_gpu()
    scene.cycles.samples = 32
    scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = 0.8
    scene.render.bake.target = 'VERTEX_COLORS'
    for obj, tag in zip(objects, tags):
        for other, other_tag in zip(objects, tags):
            if 'form' in tag:
                other.hide_render = other_tag.get('form', 99) > tag['form']
            else:
                other.hide_render = not (other_tag.get('weapon') == tag['weapon'] and
                                         other_tag.get('weaponTier', 99) <= tag['weaponTier'])
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
        print(f'  baked AO: {obj.name}', flush=True)
    for obj in objects:
        obj.hide_render = False


def build(out, bake=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for weapon, color in ACCENTS.items():
        ship.MATERIALS[f'Weapon-{weapon}'] = (color, 0.15, 0.45, color, 1.8)
        ship.EMISSIVE.add(f'Weapon-{weapon}')
    ship.create_materials()
    collection = bpy.context.scene.collection
    mount = bpy.data.objects.new('weapon_mount', None)
    mount.location = v(9.3, 0, ship.SPINE.point(9.3, 0.25).z + 0.05)
    mount['weaponMount'] = True
    collection.objects.link(mount)
    objects, tags = [], []
    for stage in range(1, 7):
        p = Part(f'refit__{stage}', rng=random.Random(f'1701-refit-{stage}'))
        refit(stage, p)
        obj = ship.to_object(p, collection)
        obj['form'] = stage
        objects.append(obj)
        tags.append({'form': stage})
    for weapon in WEAPONS:
        for level in range(1, 2 if weapon == 'pulse' else 6):
            p = Part(f'weapon__{weapon}__{level}', rng=random.Random(f'1701-weapon-{weapon}-{level}'))
            muzzle = weapon_model(p, weapon, level)
            obj = ship.to_object(p, collection)
            obj['weapon'], obj['weaponTier'] = weapon, level
            if muzzle is not None:
                marker = bpy.data.objects.new(f'muzzle__{weapon}', None)
                marker.location = muzzle
                marker['muzzle'] = weapon
                marker.parent = obj
                collection.objects.link(marker)
            objects.append(obj)
            tags.append({'weapon': weapon, 'weaponTier': level})
    print(f'Built {len(objects)} Blender meshes, {sum(len(o.data.polygons) for o in objects)} polygons', flush=True)
    if bake:
        context = Part('AO context')
        for body in (ship.UPPER_POD, ship.LOWER_POD, ship.WEB, ship.NECK, ship.SPINE, *ship.BOOMS.values()):
            context.skin(body, 'Hull', seg=0.4, dx=0.5)
        hull = ship.to_object(context, collection)
        bake_ao(objects, tags, hull)
        bpy.data.objects.remove(hull, do_unlink=True)
    ship.export(Path(out))
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(out).with_suffix('.blend')))
    print(f'Exported {out} and Blender source scene', flush=True)


if __name__ == '__main__':
    argv = ship.script_args()
    args = [a for a in argv if not a.startswith('--')]
    build(args[0] if args else ship.ROOT / 'blender/build/refits.raw.glb', bake='--no-bake' not in argv)
