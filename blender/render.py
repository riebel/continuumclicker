"""Renders stills of the ship with Cycles: previews, the PWA icons and the no-WebGL poster.

    python blender/render.py out.png [--tier N] [--size WxH] [--samples N] [--no-bake] [--icon]

`--tier N` shows every module up to tier N (0 = bare hull, default 5 = fully upgraded).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy  # noqa: F401  (registers mathutils)
from mathutils import Euler, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_ship  # noqa: E402


def arg(name: str, default: str) -> str:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def use_vertex_colors() -> None:
    """The exported glTF multiplies COLOR_0 into the base colour; mirror that for Cycles."""
    for mat in bpy.data.materials:
        if mat.name in build_ship.EMISSIVE:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes["Principled BSDF"]
        attr = nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["A"].default_value = bsdf.inputs["Base Color"].default_value
        links.new(attr.outputs["Color"], mix.inputs["B"])
        links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])


def add_light(name, kind, location, energy, color=(1, 1, 1), size=1.0, rotation=(0, 0, 0)):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    if kind == "AREA":
        data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(obj)
    return obj


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--") and not a[0].isdigit()]
    out = Path(args[0]) if args else Path("ship.png")
    max_tier = int(arg("--tier", "5"))
    width, height = (int(x) for x in arg("--size", "1280x800").split("x"))
    icon = "--icon" in sys.argv

    objects = build_ship.build(Path(bpy.app.tempdir) / "ship.glb", bake="--no-bake" not in sys.argv)
    use_vertex_colors()

    # Pose: nose up and to the right, engines towards the viewer's lower left.
    pivot = bpy.data.objects.new("pivot", None)
    bpy.context.scene.collection.objects.link(pivot)
    for obj in objects:
        tier = obj.get("tier", 0)
        obj.hide_render = tier > max_tier
        obj.parent = pivot
    pivot.rotation_euler = Euler((0, 0, 0))

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = int(arg("--samples", "48"))
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.film_transparent = not icon
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.color = (0.004, 0.005, 0.012)
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.004, 0.005, 0.012, 1)
        background.inputs["Strength"].default_value = 1.0

    # Cool key light from the upper front, warm engine light spilling from behind, rim light.
    add_light("key", "SUN", (0, 0, 0), 3.2, (0.85, 0.9, 1.0), rotation=(math.radians(50), 0, math.radians(35)))
    add_light("rim", "SUN", (0, 0, 0), 2.0, (0.6, 0.7, 1.0), rotation=(math.radians(-60), 0, math.radians(200)))
    add_light("fill", "AREA", (4, -14, -6), 1500, (0.5, 0.55, 0.7), size=12,
              rotation=(math.radians(110), 0, 0))

    camera_data = bpy.data.cameras.new("camera")
    camera_data.lens = 80
    camera = bpy.data.objects.new("camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    # Seen from behind and to the left so the engine faces are visible; the roll puts the hull on
    # a diagonal with the nose pointing to the upper right, like the original artwork.
    corners = [obj.matrix_world @ Vector(c) for obj in objects if not obj.hide_render and obj.type == "MESH"
               for c in obj.bound_box]
    low = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    high = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    target = (low + high) / 2
    radius = (high - low).length / 2
    view_angle = 2 * math.atan(18 / camera_data.lens)  # 36 mm sensor, shorter side for squares
    distance = radius / math.sin(view_angle / 2) * float(arg("--distance", "0.8"))
    camera.location = target + Vector((-19.0, -24.0, 9.0)).normalized() * distance
    look = (target - camera.location).to_track_quat("-Z", "Y")
    roll = Quaternion((0, 0, 1), math.radians(float(arg("--roll", "28"))))
    camera.rotation_euler = (look @ roll).to_euler()

    # Soft fill from the camera side so the engine faces are not lost in shadow, plus a warm
    # bounce as if from the exhaust.
    fill = add_light("camera-fill", "AREA", camera.location * 1.0, 14 * distance ** 2, (0.75, 0.8, 1.0),
                     size=distance * 0.8)
    fill.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    add_light("exhaust", "POINT", target + Vector((-radius * 1.1, 0, 0)), 400 * radius, (1.0, 0.6, 0.25))

    scene.render.filepath = str(out.resolve())
    bpy.ops.render.render(write_still=True)
    print(f"rendered {out}", flush=True)


if __name__ == "__main__":
    main()
