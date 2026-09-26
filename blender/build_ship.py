"""Builds the modular Continuum Clicker ship procedurally and exports it as glTF.

    pip install bpy==5.0.1          # Blender as a Python module
    python blender/build_ship.py [out.glb] [--render poster.png]

The ship consists of a base hull plus one module per purchasable upgrade. Every module has up to
five tiers that become visible as more units of the upgrade are bought (see VISUAL_TIER_THRESHOLDS
in src/game/content.ts). Each tier is a separate mesh object whose glTF extras carry
`{"module": <upgrade id>, "tier": <1-5>}`, so the game can toggle it.

Engine exhausts are marked with empties (`{"nozzle": "main" | "rcs" | "nacelle", "radius": r}`)
whose local +Z axis points along the exhaust. The game attaches plume shaders and lights there;
the glowing throats themselves are real emissive geometry.

Blender coordinates: +X is forward, +Z is up. The glTF exporter converts to Y-up.
"""

from __future__ import annotations

import math
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

import bpy  # must come first: it registers bmesh and mathutils
import bmesh  # noqa: E402
from mathutils import Euler, Matrix, Vector

SEED = 1701
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "blender" / "build" / "ship.raw.glb"

# --------------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------------

MATERIALS = {
    # name: (base color (linear), metallic, roughness, emission color, emission strength)
    "Hull": ((0.17, 0.17, 0.18), 0.75, 0.52, None, 0.0),
    "HullDark": ((0.05, 0.05, 0.055), 0.6, 0.6, None, 0.0),
    "Trim": ((0.36, 0.36, 0.37), 0.9, 0.35, None, 0.0),
    "Nozzle": ((0.10, 0.09, 0.085), 1.0, 0.32, None, 0.0),
    "Copper": ((0.62, 0.30, 0.12), 1.0, 0.3, None, 0.0),
    "EngineGlow": ((1.0, 0.62, 0.18), 0.0, 1.0, (1.0, 0.62, 0.18), 30.0),
    "Window": ((1.0, 0.82, 0.55), 0.0, 1.0, (1.0, 0.82, 0.55), 2.5),
    "Matrix": ((0.25, 0.8, 1.0), 0.0, 1.0, (0.25, 0.8, 1.0), 2.5),
    "Reactor": ((0.5, 0.78, 1.0), 0.0, 1.0, (0.5, 0.78, 1.0), 4.0),
}
EMISSIVE = {name for name, spec in MATERIALS.items() if spec[3] is not None}


def create_materials() -> None:
    for name, (color, metallic, roughness, emission, strength) in MATERIALS.items():
        mat = bpy.data.materials.new(name)
        # Closed hull geometry: skip back faces. Glow surfaces stay double-sided.
        mat.use_backface_culling = emission is None
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emission:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = strength


# --------------------------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------------------------


def v(x: float, y: float, z: float) -> Vector:
    return Vector((x, y, z))


def aim(direction: Vector) -> Matrix:
    """Rotation that maps local +Z onto `direction`."""
    up = "Y" if abs(direction.normalized().z) > 0.9 else "Z"
    return direction.normalized().to_track_quat("Z", "X" if up == "Z" else "Y").to_matrix().to_4x4()


AXIS_X = aim(v(1, 0, 0))
AXIS_Y = aim(v(0, 1, 0))


@dataclass
class Nozzle:
    kind: str
    position: Vector
    direction: Vector
    radius: float


@dataclass
class Part:
    """A mesh under construction: one object in the exported scene."""

    name: str
    module: str | None = None
    tier: int = 0
    rng: random.Random = field(default_factory=lambda: random.Random(SEED))
    bm: bmesh.types.BMesh = field(default_factory=bmesh.new)
    materials: list[str] = field(default_factory=list)
    nozzles: list[Nozzle] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.color = self.bm.loops.layers.float_color.new("Col")

    # -- bookkeeping ---------------------------------------------------------------------

    def _finish(self, verts, material: str, tint: float | None = None, smooth: bool = False):
        if material not in self.materials:
            self.materials.append(material)
        index = self.materials.index(material)
        faces = {f for vert in verts for f in vert.link_faces}
        shade = tint if tint is not None else self.rng.uniform(0.72, 1.0)
        for face in faces:
            face.material_index = index
            face.smooth = smooth
            for loop in face.loops:
                loop[self.color] = (shade, shade, shade, 1.0)
        return faces

    def _sharpen(self, faces, angle_deg: float = 40.0) -> None:
        limit = math.radians(angle_deg)
        for face in faces:
            for edge in face.edges:
                if len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) > limit:
                    edge.smooth = False

    # -- primitives ------------------------------------------------------------------------

    def box(self, center, size, material="Hull", rot: Matrix | None = None, tint=None):
        matrix = Matrix.Translation(center) @ (rot or Matrix()) @ Matrix.Diagonal((*size, 1.0))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=matrix)["verts"]
        return self._finish(verts, material, tint)

    def cylinder(self, center, radius, depth, orient: Matrix, material="Hull", segments=16,
                 radius2=None, caps=True, tint=None):
        matrix = Matrix.Translation(center) @ orient
        verts = bmesh.ops.create_cone(
            self.bm, cap_ends=caps, segments=segments, radius1=radius,
            radius2=radius if radius2 is None else radius2, depth=depth, matrix=matrix,
        )["verts"]
        faces = self._finish(verts, material, tint, smooth=True)
        self._sharpen(faces)
        return faces

    def torus(self, center, major, minor, orient: Matrix, material="Copper", seg=40, seg_minor=10):
        """Ring around the local Z axis."""
        verts = []
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(seg_minor):
                b = 2 * math.pi * j / seg_minor
                r = major + minor * math.cos(b)
                local = v(r * math.cos(a), r * math.sin(a), minor * math.sin(b))
                vert = self.bm.verts.new(Matrix.Translation(center) @ orient @ local)
                ring.append(vert)
                verts.append(vert)
            rings.append(ring)
        for i in range(seg):
            for j in range(seg_minor):
                a, b = rings[i], rings[(i + 1) % seg]
                self.bm.faces.new((a[j], b[j], b[(j + 1) % seg_minor], a[(j + 1) % seg_minor]))
        return self._finish(verts, material, smooth=True)

    def sphere(self, center, radius, material, segments=20, rings=12):
        verts = bmesh.ops.create_uvsphere(
            self.bm, u_segments=segments, v_segments=rings, radius=radius,
            matrix=Matrix.Translation(center),
        )["verts"]
        return self._finish(verts, material, tint=1.0, smooth=True)

    def plated_box(self, center, size, material="Hull", cell=0.3, detail=1.0, skip=()):
        """Box whose faces are covered in a grid of raised, recessed and seamed hull plates."""
        cx, cy, cz = center
        sx, sy, sz = size
        faces_spec = {
            "+x": (v(cx + sx / 2, cy, cz), aim(v(1, 0, 0)), sy, sz),
            "-x": (v(cx - sx / 2, cy, cz), aim(v(-1, 0, 0)), sy, sz),
            "+y": (v(cx, cy + sy / 2, cz), aim(v(0, 1, 0)), sx, sz),
            "-y": (v(cx, cy - sy / 2, cz), aim(v(0, -1, 0)), sx, sz),
            "+z": (v(cx, cy, cz + sz / 2), aim(v(0, 0, 1)), sx, sy),
            "-z": (v(cx, cy, cz - sz / 2), aim(v(0, 0, -1)), sx, sy),
        }
        for key, (origin, rot, a, b) in faces_spec.items():
            if key in skip:
                continue
            # The grid's local axes after `aim` are arbitrary; measure them to size it correctly.
            ax = (rot @ v(1, 0, 0)).to_3d()
            ext_u = abs(ax.x) * sx + abs(ax.y) * sy + abs(ax.z) * sz
            ay = (rot @ v(0, 1, 0)).to_3d()
            ext_v = abs(ay.x) * sx + abs(ay.y) * sy + abs(ay.z) * sz
            # Coarse panels, each split into 1x1 up to 3x3 plates: big smooth plates next to
            # finely detailed areas read as a real hull instead of a uniform grid of cubes.
            coarse = cell * 2.6
            nu = max(1, round(ext_u / coarse))
            nv = max(1, round(ext_v / coarse))
            du, dv = ext_u / nu, ext_v / nv
            for i in range(nu):
                for j in range(nv):
                    local = v(-ext_u / 2 + du * (i + 0.5), -ext_v / 2 + dv * (j + 0.5), 0)
                    split = self.rng.choice((1, 1, 2, 2, 3, 3, 4))
                    su = max(1, round(split * du / dv)) if split > 1 else 1
                    sv = split
                    matrix = (Matrix.Translation(origin) @ rot @ Matrix.Translation(local)
                              @ Matrix.Diagonal((du / 2, dv / 2, 1, 1)))
                    verts = bmesh.ops.create_grid(self.bm, x_segments=su, y_segments=sv, size=1.0,
                                                  matrix=matrix)["verts"]
                    faces = self._finish(verts, material)
                    self._greeble(list(faces), min(du / su, dv / sv), detail)

    def _greeble(self, faces, cell, detail):
        rng = self.rng
        cell = min(cell, 0.5)  # keep relief shallow on large plates
        for face in faces:
            roll = rng.random()
            if roll < 0.3 * detail:
                bmesh.ops.inset_individual(self.bm, faces=[face], thickness=cell * rng.uniform(0.05, 0.14),
                                           depth=cell * rng.uniform(0.03, 0.16))
                if rng.random() < 0.5:
                    bmesh.ops.inset_individual(self.bm, faces=[face], thickness=cell * rng.uniform(0.06, 0.2),
                                               depth=cell * rng.uniform(-0.1, 0.12))
                self._tint(face, rng.uniform(0.8, 1.05))
            elif roll < 0.5 * detail:
                bmesh.ops.inset_individual(self.bm, faces=[face], thickness=cell * rng.uniform(0.08, 0.2),
                                           depth=-cell * rng.uniform(0.05, 0.18))
                self._tint(face, rng.uniform(0.45, 0.7))
            elif roll < 0.8:
                bmesh.ops.inset_individual(self.bm, faces=[face], thickness=cell * 0.04,
                                           depth=-cell * 0.02)
                self._tint(face, rng.uniform(0.75, 1.0))

    def _tint(self, face, shade):
        for loop in face.loops:
            loop[self.color] = (shade, shade, shade, 1.0)

    # -- compound parts ----------------------------------------------------------------------

    def scatter(self, center, u: Vector, normal: Vector, extent_u, extent_w, count,
                height=(0.08, 0.35), material="Hull"):
        """Pipes, vents and boxes scattered over a surface patch."""
        rng = self.rng
        w = normal.cross(u).normalized()
        rot = Matrix((u, w, normal)).transposed().to_4x4()
        for _ in range(count):
            p = center + u * rng.uniform(-extent_u, extent_u) * 0.5 + w * rng.uniform(-extent_w, extent_w) * 0.5
            kind = rng.random()
            h = rng.uniform(*height)
            if kind < 0.55:
                size = (rng.uniform(0.15, 0.7), rng.uniform(0.12, 0.45), h)
                self.box(p + normal * h / 2, size, material, rot=rot)
            elif kind < 0.8:
                r = rng.uniform(0.06, 0.16)
                length = rng.uniform(0.6, 2.2)
                self.cylinder(p + normal * r, r, length, rot @ AXIS_X, "HullDark", segments=8)
            else:
                r = rng.uniform(0.1, 0.25)
                self.cylinder(p + normal * h / 2, r, h, rot, "Trim", segments=10)

    def nozzle(self, position: Vector, direction: Vector, radius: float, kind="main", length=None):
        """Engine bell pointing along `direction` with an emissive throat."""
        d = direction.normalized()
        rot = aim(d)
        length = length or radius * 1.15
        # Mount collar and flange.
        self.cylinder(position - d * radius * 0.25, radius * 1.18, radius * 0.5, rot, "HullDark", segments=24)
        self.torus(position + d * 0.02, radius * 1.1, radius * 0.08, rot, "Trim", seg=32, seg_minor=6)
        # Bell: outer and inner surface (open cone), exit at the far end.
        bell_center = position + d * length / 2
        self.cylinder(bell_center, radius * 0.72, length, rot, "Nozzle", segments=28,
                      radius2=radius, caps=False)
        inner = self.cylinder(bell_center, radius * 0.66, length * 0.98, rot, "Nozzle", segments=28,
                              radius2=radius * 0.94, caps=False, tint=0.6)
        for face in inner:
            face.normal_flip()
        # Cooling rings on the bell.
        for t in (0.3, 0.62):
            self.torus(position + d * length * t, radius * (0.72 + 0.28 * t) + 0.015, radius * 0.035, rot,
                       "Trim", seg=28, seg_minor=5)
        # Glowing throat: a hot disc deep inside the bell plus an emissive inner cone.
        self.cylinder(position + d * radius * 0.06, radius * 0.66, radius * 0.08, rot, "EngineGlow",
                      segments=28, tint=1.0)
        self.cylinder(position + d * length * 0.28, radius * 0.5, length * 0.4, rot, "EngineGlow",
                      segments=20, radius2=radius * 0.12, tint=1.0)
        self.nozzles.append(Nozzle(kind, position + d * length * 0.9, d, radius * 0.92))

    def rcs(self, surface: Vector, direction: Vector, size=0.22):
        """Small reaction control thruster block mounted on a hull surface point."""
        d = direction.normalized()
        center = surface + d * size
        self.box(center, (size * 2, size * 2, size * 2), "HullDark", rot=aim(d))
        self.nozzle(center + d * size, d, size * 0.55, kind="rcs", length=size * 0.9)

    def windows(self, start: Vector, step: Vector, count: int, normal: Vector, size=(0.14, 0.09)):
        rot = Matrix((step.normalized(), normal.cross(step.normalized()), normal)).transposed().to_4x4()
        for i in range(count):
            self.box(start + step * i + normal * 0.012, (size[0], size[1], 0.03), "Window", rot=rot, tint=1.0)

    def frame(self, x, half_w, half_h, z, thickness=0.22, depth=0.35, material="Trim"):
        """U-shaped band around the sides and belly of the hull at position x."""
        t = thickness
        self.box(v(x, 0, z - half_h - t / 2), (depth, 2 * half_w + 2 * t, t), material)
        self.box(v(x, half_w + t / 2, z - t / 2), (depth, t, 2 * half_h + t), material)
        self.box(v(x, -half_w - t / 2, z - t / 2), (depth, t, 2 * half_h + t), material)

    def turret(self, position: Vector, up: Vector, scale=1.0, barrels=2):
        s = scale
        rot = aim(up)
        self.cylinder(position + up * 0.08 * s, 0.34 * s, 0.16 * s, rot, "Trim", segments=16)
        self.box(position + up * 0.28 * s, (0.62 * s, 0.46 * s, 0.26 * s), "Hull")
        for i in range(barrels):
            offset = (i - (barrels - 1) / 2) * 0.16 * s
            base = position + up * 0.3 * s + v(0.3 * s, offset, 0)
            self.cylinder(base + v(0.45 * s, 0, 0), 0.045 * s, 0.9 * s, AXIS_X, "HullDark", segments=8)

    def dish(self, position: Vector, facing: Vector, radius=0.8):
        rot = aim(facing)
        self.cylinder(position, radius, radius * 0.35, rot, "Trim", segments=28, radius2=radius * 0.15)
        self.cylinder(position + facing.normalized() * radius * 0.45, 0.03, radius * 0.9, rot, "HullDark",
                      segments=6)
        self.sphere(position + facing.normalized() * radius * 0.9, 0.06, "Matrix", segments=8, rings=6)

    def strut(self, a: Vector, b: Vector, radius=0.12, material="HullDark"):
        d = b - a
        self.cylinder((a + b) / 2, radius, d.length, aim(d), material, segments=10)


# --------------------------------------------------------------------------------------------
# Ship layout
# --------------------------------------------------------------------------------------------
#
#  Rear: two stacked engine pods (the ship's bulk), front: a long tapering spine.
#  Upper pod rear face at x = -8.8, lower pod rear face at x = -8.0.

UPPER = dict(center=v(-5.2, 0, 1.55), size=(7.2, 4.6, 2.9))
LOWER = dict(center=v(-4.6, 0, -1.45), size=(6.8, 4.2, 2.9))
UPPER_REAR = UPPER["center"].x - UPPER["size"][0] / 2
LOWER_REAR = LOWER["center"].x - LOWER["size"][0] / 2
BACK = v(-1, 0, 0)

SPINE = [  # (center x, length, half width, half height, center z)
    (-0.6, 3.2, 1.6, 1.5, 0.2),
    (2.4, 3.2, 1.3, 1.15, 0.25),
    (5.4, 3.0, 1.1, 0.95, 0.25),
    (8.2, 2.8, 0.9, 0.75, 0.2),
]


def build_hull() -> Part:
    p = Part("hull")
    p.plated_box(UPPER["center"], UPPER["size"])
    p.plated_box(LOWER["center"], LOWER["size"])
    # Heat shielding and conduits between the engines on the rear faces.
    p.scatter(v(UPPER_REAR, 0, 1.55), v(0, 1, 0), BACK, 4.2, 2.6, 18, height=(0.04, 0.14))
    p.scatter(v(LOWER_REAR, 0, -1.45), v(0, 1, 0), BACK, 3.8, 2.6, 18, height=(0.04, 0.14))
    # Armoured flank bulges break up the silhouette.
    for side in (1, -1):
        p.plated_box(v(-5.6, side * 2.55, 1.9), (4.6, 0.5, 1.6), cell=0.36)
        p.plated_box(v(-3.9, side * 2.35, -1.7), (3.8, 0.5, 1.4), cell=0.36)
        p.plated_box(v(-2.3, side * 1.9, 0.1), (1.6, 0.9, 2.0), cell=0.36)

    for cx, length, hw, hh, cz in SPINE:
        p.plated_box(v(cx, 0, cz), (length, 2 * hw, 2 * hh), cell=0.36)
    # Dorsal ridge and keel.
    p.plated_box(v(3.6, 0, 1.55), (8.6, 1.0, 0.45), cell=0.3)
    p.plated_box(v(2.0, 0, -1.2), (6.0, 0.8, 0.4), cell=0.3)
    # Bow: tapered wedge.
    p.box(v(10.1, 0, 0.18), (1.2, 1.3, 1.1), "Hull")
    p.cylinder(v(11.0, 0, 0.18), 0.55, 0.9, AXIS_X, "Trim", segments=6, radius2=0.12)

    # Surface clutter: pipes, vents, tanks along the hull.
    x_axis = v(1, 0, 0)
    p.scatter(v(-5.2, 0, 3.0), x_axis, v(0, 0, 1), 6.4, 3.8, 60)
    p.scatter(v(-4.6, 0, -2.9), x_axis, v(0, 0, -1), 6.0, 3.4, 45)
    for side in (1, -1):
        n = v(0, side, 0)
        p.scatter(v(-5.0, side * 2.3, 0.6), x_axis, n, 5.5, 0.7, 20, height=(0.05, 0.2))
        p.scatter(v(4.0, side * 1.1, 0.2), x_axis, n, 7.0, 1.0, 36, height=(0.04, 0.16))
    p.scatter(v(4.5, 0, 1.2), x_axis, v(0, 0, 1), 8.0, 1.6, 44, height=(0.05, 0.22))

    # Base main engines: one large nozzle per pod.
    p.nozzle(v(UPPER_REAR, 0, 1.55), BACK, 0.9)
    p.nozzle(v(LOWER_REAR, 0, -1.45), BACK, 0.9)
    return p


# --------------------------------------------------------------------------------------------
# Upgrade modules: MODULES[upgrade id] = [tier 1 builder, tier 2 builder, ...]
# --------------------------------------------------------------------------------------------


def avidyne_engine(tier: int, p: Part) -> None:
    """Additional main engines crowding the rear faces."""
    slots = {
        1: [(UPPER_REAR, 1.62, 1.55, 0.55)],
        2: [(LOWER_REAR, 1.5, -1.45, 0.55)],
        3: [(UPPER_REAR, 1.62, 2.55, 0.36)],
        4: [(LOWER_REAR, 1.5, -2.45, 0.36)],
        5: [(UPPER_REAR, 0.0, 2.72, 0.26), (LOWER_REAR, 0.0, -2.62, 0.26)],
    }[tier]
    for x, y, z, r in slots:
        for side in ((1, -1) if y else (1,)):
            p.nozzle(v(x, side * y, z), v(-1, side * 0.04, 0), r)


def accelerator_generator(tier: int, p: Part) -> None:
    """Copper-cored generator bands around the spine."""
    x = [1.3, 2.9, 4.2, 5.6, 8.0][tier - 1]
    seg = next(s for s in SPINE if abs(x - s[0]) <= s[1] / 2 + 0.01)
    _, _, hw, hh, cz = seg
    p.frame(x, hw + 0.02, hh + 0.02, cz, thickness=0.2, depth=0.4, material="Trim")
    p.frame(x, hw + 0.2, hh + 0.2, cz, thickness=0.06, depth=0.22, material="Copper")
    for side in (1, -1):
        p.box(v(x, side * (hw + 0.3), cz), (0.1, 0.06, hh * 0.9), "Matrix", tint=1.0)


def driver_coil(tier: int, p: Part) -> None:
    """Heavy copper coils wrapped around the neck."""
    x = [-1.35, -0.8, -0.25, 0.3, 0.85][tier - 1]
    p.torus(v(x, 0, 0.2), 2.3, 0.15, AXIS_X, "Copper", seg=56, seg_minor=10)
    p.torus(v(x, 0, 0.2), 2.3, 0.19, AXIS_X, "HullDark", seg=56, seg_minor=4)
    for angle in range(0, 360, 90):  # spokes holding the coil
        a = math.radians(angle + 45)
        p.box(v(x, 1.95 * math.cos(a), 0.2 + 1.95 * math.sin(a)), (0.16, 0.2, 0.75), "Trim",
              rot=Euler((a - math.pi / 2, 0, 0)).to_matrix().to_4x4())


def impulse_capacitance_cell(tier: int, p: Part) -> None:
    """Capacitor banks on the pod flanks. Spec: (x, hull surface y, top z)."""
    x, hull_y, z = [(-6.9, 2.8, 2.45), (-4.4, 2.8, 2.45), (-6.6, 2.1, -0.95), (-6.4, 2.3, 0.95),
                    (-4.2, 2.3, 0.95)][tier - 1]
    y = hull_y + 0.45
    for side in (1, -1):
        for i in range(3):
            cz = z - i * 0.34
            p.cylinder(v(x, side * y, cz), 0.15, 1.8, AXIS_X, "Trim", segments=12)
            p.box(v(x + 0.95, side * y, cz), (0.12, 0.36, 0.3), "HullDark")
            p.box(v(x - 0.95, side * y, cz), (0.12, 0.36, 0.3), "HullDark")
            p.box(v(x, side * (y + 0.15), cz), (1.2, 0.03, 0.05), "Matrix", tint=1.0)
        p.box(v(x, side * (hull_y + 0.15), z - 0.34), (1.9, 0.3, 1.0), "HullDark")


def impulse_control_system(tier: int, p: Part) -> None:
    """Sensors and antennae."""
    if tier == 1:
        p.cylinder(v(7.6, 0, 2.3), 0.06, 1.4, Matrix(), "Trim", segments=6)
        for h in (0.4, 0.8):
            p.box(v(7.6, 0, 1.8 + h), (0.05, 0.9 - h * 0.5, 0.04), "Trim")
        p.sphere(v(7.6, 0, 3.02), 0.07, "Matrix", segments=8, rings=6)
    elif tier == 2:
        p.dish(v(8.9, 0, 0.98), v(1, 0, 1.2), radius=0.6)
    elif tier == 3:
        for side in (1, -1):
            p.plated_box(v(9.1, side * 0.95, 0.2), (1.0, 0.3, 0.8), cell=0.2)
            p.box(v(9.62, side * 0.95, 0.2), (0.04, 0.24, 0.6), "Matrix", tint=1.0)
    elif tier == 4:
        p.dish(v(-2.6, 0, -2.95), v(0.4, 0, -1), radius=0.6)
    else:
        for side in (1, -1):
            p.cylinder(v(11.9, side * 0.3, 0.2), 0.025, 2.2, AXIS_X, "Trim", segments=6)
            p.sphere(v(13.0, side * 0.3, 0.2), 0.05, "Matrix", segments=8, rings=6)


def impulse_deck(tier: int, p: Part) -> None:
    """Superstructure decks with lit windows."""
    decks = {
        1: (v(2.6, 0, 1.72), (2.0, 1.6, 0.64)),
        2: (v(5.3, 0, 1.5), (1.8, 1.3, 0.6)),
        3: (v(2.9, 0, 2.34), (1.2, 1.2, 0.6)),
        4: (v(3.1, 0, 2.84), (0.8, 0.9, 0.4)),
        5: (v(-6.2, 0, 3.25), (2.6, 2.0, 0.5)),
    }
    center, size = decks[tier]
    p.plated_box(center, size, cell=0.25, detail=0.6)
    for side in (1, -1):
        start = center + v(-size[0] / 2 + 0.25, side * size[1] / 2, 0.02)
        count = int((size[0] - 0.4) / 0.24)
        p.windows(start, v(0.24, 0, 0), count, v(0, side, 0))
    if tier == 4:  # bridge windows facing forward
        p.windows(center + v(0.41, -0.35, 0.02), v(0, 0.14, 0), 6, v(1, 0, 0), size=(0.1, 0.08))


def impulse_jet(tier: int, p: Part) -> None:
    """Reaction control thrusters. Spec: (x, flank y, flank z, top/bottom z)."""
    x, y, z, vz = [(7.2, 0.9, 0.2, 0.95), (-8.2, 2.3, 2.5, 3.0), (-7.6, 2.1, -2.3, -2.9),
                   (6.5, 1.1, 0.25, 1.2), (-1.8, 1.6, -1.15, -1.3)][tier - 1]
    for side in (1, -1):
        p.rcs(v(x, side * y, z), v(0, side, 0))
    p.rcs(v(x + 0.5, 0.0, vz), v(0, 0, 1 if vz > 0 else -1))


def impulse_matrix(tier: int, p: Part) -> None:
    """Glowing field-matrix conduits along the hull."""
    if tier <= 3:
        cx, length, hw, hh, cz = SPINE[tier]
        for side in (1, -1):
            for dz in (-0.35, 0.35):
                p.box(v(cx, side * (hw + 0.02), cz + dz * hh), (length * 0.85, 0.04, 0.05), "Matrix",
                      tint=1.0)
            for k in range(4):
                x = cx - length * 0.35 + k * length * 0.23
                p.box(v(x, side * (hw + 0.02), cz), (0.05, 0.04, 0.7 * hh), "Matrix", tint=1.0)
    elif tier == 4:
        for side in (1, -1):
            p.box(v(-5.6, side * 2.82, 1.3), (4.4, 0.04, 0.06), "Matrix", tint=1.0)
            p.box(v(-4.6, side * 2.12, -0.5), (6.0, 0.04, 0.06), "Matrix", tint=1.0)
    else:
        p.box(v(3.6, 0, 1.8), (8.0, 0.08, 0.05), "Matrix", tint=1.0)
        p.box(v(-5.2, 0, 3.02), (6.0, 0.08, 0.05), "Matrix", tint=1.0)


NACELLE = {1: (-3.6, 4.0, -1.9), 3: (-4.4, 4.1, 2.4)}


def impulse_nacelle(tier: int, p: Part) -> None:
    """Outboard nacelles with their own engines."""
    if tier in NACELLE:
        x, y, z = NACELLE[tier]
        for side in (1, -1):
            c = v(x, side * y, z)
            p.plated_box(c, (6.0, 0.95, 0.95), cell=0.3)
            p.cylinder(c + v(3.2, 0, 0), 0.47, 0.5, AXIS_X, "Trim", segments=16, radius2=0.3)
            for dx in (-1.6, 1.2):
                a = c + v(dx, -side * 0.45, 0)
                b = v(c.x + dx, side * 2.3, c.z)
                p.strut(a, b, 0.14)
                p.box((a + b) / 2, (0.5, abs(a.y - b.y) * 0.8, 0.16), "Hull")
            p.box(c + v(0, side * 0.49, 0), (5.0, 0.03, 0.08), "Matrix", tint=1.0)
            p.nozzle(c + v(-3.0, 0, 0), BACK, 0.42, kind="nacelle")
    elif tier in (2, 4):
        x, y, z = NACELLE[tier - 1]
        for side in (1, -1):
            p.sphere(v(x + 3.5, side * y, z), 0.3, "Reactor", segments=20, rings=12)
            p.torus(v(x + 3.45, side * y, z), 0.34, 0.06, AXIS_X, "Trim", seg=24, seg_minor=6)
    else:
        for x, y, z in NACELLE.values():
            for side in (1, -1):
                p.box(v(x - 2.2, side * (y + 0.6), z), (1.6, 0.36, 0.44), "Hull")
                p.nozzle(v(x - 3.0, side * (y + 0.6), z), BACK, 0.17, kind="nacelle")


def impulse_reactor(tier: int, p: Part) -> None:
    """Exposed reactor core in a containment cage."""
    core = v(-2.4, 0, 3.45)
    if tier == 1:
        p.sphere(core, 0.42, "Reactor", segments=28, rings=16)
        p.cylinder(core - v(0, 0, 0.45), 0.7, 0.3, Matrix(), "HullDark", segments=24)
        p.torus(core, 0.62, 0.07, Matrix(), "Trim", seg=40, seg_minor=8)
    elif tier == 2:
        p.torus(core, 0.62, 0.05, AXIS_X, "Trim", seg=40, seg_minor=8)
        p.torus(core, 0.62, 0.05, AXIS_Y, "Trim", seg=40, seg_minor=8)
    elif tier == 3:
        for side in (1, -1):  # plasma conduits feeding the engines
            p.cylinder(v(-5.5, side * 1.2, 3.12), 0.09, 6.2, AXIS_X, "Reactor", segments=10)
            p.cylinder(v(-5.5, side * 1.2, 3.12), 0.13, 5.6, AXIS_X, "Trim", segments=10, caps=False)
    elif tier == 4:
        for x in (-8.1, -4.3):
            c = v(x, 0, 3.35)
            p.sphere(c, 0.3, "Reactor", segments=20, rings=12)
            p.torus(c, 0.44, 0.05, Matrix(), "Trim", seg=32, seg_minor=6)
            p.cylinder(c - v(0, 0, 0.3), 0.46, 0.2, Matrix(), "HullDark", segments=20)
    else:
        p.torus(core, 1.05, 0.045, Euler((0.5, 0.3, 0)).to_matrix().to_4x4(), "Reactor", seg=56, seg_minor=6)
        p.torus(core, 1.2, 0.03, Euler((-0.4, 0.6, 0)).to_matrix().to_4x4(), "Matrix", seg=56, seg_minor=6)


def impulse_response_filter(tier: int, p: Part) -> None:
    """Weapon turrets and finally a spinal cannon."""
    up, down = v(0, 0, 1), v(0, 0, -1)
    if tier == 1:
        p.turret(v(4.0, 0, 1.78), up)
        p.turret(v(6.6, 0, 1.78), up, 0.85)
    elif tier == 2:
        for side in (1, -1):
            p.turret(v(4.9, side * 0.85, 1.2), up, 0.75)
    elif tier == 3:
        for side in (1, -1):
            p.turret(v(-6.2, side * 1.75, 3.0), up, 1.1)
    elif tier == 4:
        for side in (1, -1):
            p.turret(v(-5.2, side * 1.3, -2.9), down, 1.0)
    else:
        p.cylinder(v(11.6, 0, -0.35), 0.16, 3.2, AXIS_X, "Trim", segments=14)
        p.cylinder(v(10.4, 0, -0.35), 0.28, 1.0, AXIS_X, "HullDark", segments=14)
        for t in range(4):
            p.torus(v(11.0 + t * 0.45, 0, -0.35), 0.2, 0.04, AXIS_X, "Matrix", seg=20, seg_minor=5)
        p.sphere(v(13.22, 0, -0.35), 0.1, "Reactor", segments=12, rings=8)


MODULES = {
    "avidyne-engine": avidyne_engine,
    "accelerator-generator": accelerator_generator,
    "driver-coil": driver_coil,
    "impulse-capacitance-cell": impulse_capacitance_cell,
    "impulse-control-system": impulse_control_system,
    "impulse-deck": impulse_deck,
    "impulse-jet": impulse_jet,
    "impulse-matrix": impulse_matrix,
    "impulse-nacelle": impulse_nacelle,
    "impulse-reactor": impulse_reactor,
    "impulse-response-filter": impulse_response_filter,
}
TIERS = 5


# --------------------------------------------------------------------------------------------
# Scene assembly, ambient occlusion bake and export
# --------------------------------------------------------------------------------------------


def to_object(part: Part, collection) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(part.name)
    part.bm.normal_update()
    part.bm.to_mesh(mesh)
    part.bm.free()
    for name in part.materials:
        mesh.materials.append(bpy.data.materials[name])
    mesh.color_attributes.active_color = mesh.color_attributes["Col"]
    mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
    obj = bpy.data.objects.new(part.name, mesh)
    collection.objects.link(obj)
    if part.module:
        obj["module"] = part.module
        obj["tier"] = part.tier
    for i, nozzle in enumerate(part.nozzles):
        empty = bpy.data.objects.new(f"{part.name}__nozzle{i}", None)
        empty.empty_display_type = "SINGLE_ARROW"
        empty.matrix_world = Matrix.Translation(nozzle.position) @ aim(nozzle.direction)
        empty["nozzle"] = nozzle.kind
        empty["radius"] = round(nozzle.radius, 4)
        empty.parent = obj
        collection.objects.link(empty)
    return obj


def bake_ambient_occlusion(objects, hull) -> None:
    """Bakes AO into a temporary colour attribute and multiplies it into the plate tints."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.light_settings.distance = 1.2
    scene.render.bake.target = "VERTEX_COLORS"

    for obj in objects:
        # The bare hull is baked alone so hidden modules leave no shadows on it.
        for other in objects:
            other.hide_render = obj is hull and other is not hull
        mesh = obj.data
        ao = mesh.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
        mesh.color_attributes.active_color = ao
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO")

        col = mesh.color_attributes["Col"]
        emissive = {i for i, m in enumerate(mesh.materials) if m.name in EMISSIVE}
        loop_emissive = [False] * len(mesh.loops)
        for poly in mesh.polygons:
            if poly.material_index in emissive:
                for li in poly.loop_indices:
                    loop_emissive[li] = True
        for i, (c, a) in enumerate(zip(col.data, ao.data)):
            if loop_emissive[i]:
                c.color = (1.0, 1.0, 1.0, 1.0)
            else:
                k = 0.3 + 0.7 * a.color[0]
                c.color = (c.color[0] * k, c.color[1] * k, c.color[2] * k, 1.0)
        mesh.color_attributes.remove(mesh.color_attributes["AO"])
        mesh.color_attributes.active_color = mesh.color_attributes["Col"]
        print(f"  baked AO: {obj.name}", flush=True)
    for obj in objects:
        obj.hide_render = False


def export(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )


def build(out: Path, bake: bool = True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    create_materials()
    collection = bpy.context.scene.collection

    parts = [build_hull()]
    for module, builder in MODULES.items():
        for tier in range(1, TIERS + 1):
            part = Part(f"{module}__{tier}", module, tier,
                        rng=random.Random(f"{SEED}-{module}-{tier}"))
            builder(tier, part)
            parts.append(part)

    objects = [to_object(part, collection) for part in parts]
    total = sum(len(o.data.polygons) for o in objects)
    print(f"built {len(objects)} objects, {total} polygons", flush=True)
    if bake:
        bake_ambient_occlusion(objects, objects[0])
    export(out)
    print(f"exported {out}", flush=True)
    return objects


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    build(Path(args[0]) if args else DEFAULT_OUT, bake="--no-bake" not in sys.argv)
