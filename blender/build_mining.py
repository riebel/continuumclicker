"""Sculpted asteroid variants and salvage fragments, authored and AO-baked in Blender.

    npm run model:mining

The game reuses these meshes; no geometry is generated on each click. The saved .blend retains
the sculpted crust, crater rims, mineral strata and faceted crystal for further art changes.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector, noise

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_ship as ship


def material(name, color, metallic=0.08, roughness=0.93, glow=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    if glow:
        shader.inputs['Emission Color'].default_value = (*glow, 1)
        shader.inputs['Emission Strength'].default_value = 1.6
    return mat


def sculpt(seed, subdivisions, name, mat):
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1)
    obj = bpy.context.object
    obj.name = name
    mesh = obj.data
    offset = Vector((rng.random()*40, rng.random()*40, rng.random()*40))
    stretch = Vector((1.05+rng.random()*.3, .73+rng.random()*.22, .83+rng.random()*.2))
    craters = [(Vector((rng.uniform(-1,1), rng.uniform(-1,1), rng.uniform(-1,1))).normalized(),
                rng.uniform(.17,.43), rng.uniform(.06,.16)) for _ in range(7)]
    for vertex in mesh.vertices:
        direction = vertex.co.normalized()
        n = noise.fractal(direction*2.1+offset, 1.0, 2.1, 4)
        r = .94 + n*.2
        for axis, width, depth in craters:
            distance = (direction-axis).length/width
            if distance < 1:
                r -= depth*(1-distance*distance)**2
            r += .022*math.exp(-((distance-.97)/.13)**2)
        # Fine fracture shelves give silhouette detail without spiky random vertices.
        shelf = noise.noise(direction*8+offset, noise_basis='PERLIN_ORIGINAL')
        r += shelf*.023
        vertex.co = Vector((direction.x*stretch.x, direction.y*stretch.y, direction.z*stretch.z))*r
    radius = max(v.co.length for v in mesh.vertices)
    for vertex in mesh.vertices:
        vertex.co /= radius
    mesh.materials.append(mat)
    col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    mesh.color_attributes.active_color = col
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for index in polygon.loop_indices:
            pos = mesh.vertices[mesh.loops[index].vertex_index].co
            grain = noise.noise(pos*19+offset)*.08
            strata = math.sin(pos.z*22+noise.noise(pos*3+offset)*5)*.04
            c = .72+grain+strata+noise.noise(pos*3.7+offset)*.18
            col.data[index].color = (c*1.03, c*.97, c*.89, 1)
    obj['rockVariant'] = seed
    return obj


def crystal(mat):
    verts, faces = [], []
    # Hexagonal prism, offset shoulders and asymmetric pointed terminations.
    for z, radius, turn in ((-.8,0,0),(-.55,.7,0),(.48,.82,.12),(.78,.62,.12),(1.15,0,0)):
        for i in range(6):
            a = i*math.tau/6+turn
            verts.append((math.cos(a)*radius, math.sin(a)*radius, z))
    for row in range(4):
        for i in range(6):
            j = (i+1)%6
            faces.append((row*6+i,row*6+j,(row+1)*6+j,(row+1)*6+i))
    mesh = bpy.data.meshes.new('mineral_crystal')
    mesh.from_pydata(verts,[],faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new('mineral_crystal',mesh)
    bpy.context.scene.collection.objects.link(obj)
    col = mesh.color_attributes.new('Col','FLOAT_COLOR','CORNER')
    mesh.color_attributes.active_color = col
    for polygon in mesh.polygons:
        c = .72+(polygon.index%6)*.045
        for index in polygon.loop_indices:
            col.data[index].color=(c,c,1,1)
    return obj


def build(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rock_mat = material('Asteroid crust',(.32,.29,.25),.1,.94)
    crystal_mat = material('Mineral crystal',(.3,.7,.84),.26,.23, (.1,.56,.72))
    rocks = [sculpt(1701+i*97,5,f'asteroid_{i}',rock_mat) for i in range(4)]
    shard = sculpt(1021,2,'rock_fragment',rock_mat)
    gem = crystal(crystal_mat)
    # Baking each isolated rock prevents other variants leaving phantom shadows.
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    ship.use_gpu()
    scene.cycles.samples = 32
    scene.render.bake.target = 'VERTEX_COLORS'
    objects = rocks+[shard,gem]
    for obj in rocks+[shard]:
        for other in objects:
            other.hide_render = other is not obj
        mesh = obj.data
        ao = mesh.color_attributes.new('AO','FLOAT_COLOR','CORNER')
        mesh.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO')
        col = mesh.color_attributes['Col']
        for c,a in zip(col.data,ao.data):
            k = .35+.65*a.color[0]
            c.color = (c.color[0]*k,c.color[1]*k,c.color[2]*k,1)
        mesh.color_attributes.remove(ao)
        mesh.color_attributes.active_color = col
        print(f'Baked sculpted crust: {obj.name}',flush=True)
    for obj in objects:
        obj.hide_render = False
    ship.export(out)
    bpy.ops.wm.save_as_mainfile(filepath=str(out.with_suffix('.blend')))


if __name__ == '__main__':
    args = ship.script_args()
    build(Path(args[0]) if args else ship.ROOT/'blender/build/mining.raw.glb')
