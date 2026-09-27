"""Builds the modular Continuum Clicker ship procedurally and exports it as glTF.

    npm run model                                   # finds Blender, builds, meshopt-compresses
    blender -b --factory-startup --python blender/build_ship.py -- [out.glb] [--no-bake]

The design follows the original 2014 artwork: two stacked engine barrels with clustered nozzles,
a neck ringed by drums, and a long tapering spine that forks into twin booms at the bow. Every
body is lofted from rounded superellipse sections and covered in layers of curved armour plates,
transverse ribs, slats, pipes and hatches that follow its surface, so the ship reads as dense and
organic rather than built from boxes.

The ship consists of a base hull plus one module per purchasable upgrade. Every module has up to
five tiers that become visible as more units of the upgrade are bought (see VISUAL_TIER_THRESHOLDS
in src/game/content.ts). Each tier is a separate mesh object whose glTF extras carry
`{"module": <upgrade id>, "tier": <1-5>}`, so the game can toggle it. The hull keeps low mounting
pads where modules will sit, so installed modules never clip through its greebles.

Engine exhausts are marked with empties (`{"nozzle": "main" | "rcs" | "nacelle", "radius": r}`)
whose local +Z axis points along the exhaust. The game attaches plume shaders and lights there;
the glowing throats themselves are real emissive geometry.

Blender coordinates: +X is forward, +Z is up. The glTF exporter converts to Y-up.
"""

from __future__ import annotations

import math
import random
import sys
from bisect import bisect_right
from dataclasses import dataclass, field
from functools import lru_cache
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
    "Hull": ((0.21, 0.205, 0.2), 0.45, 0.5, None, 0.0),
    "HullDark": ((0.06, 0.06, 0.058), 0.5, 0.6, None, 0.0),
    "Trim": ((0.25, 0.24, 0.23), 0.8, 0.36, None, 0.0),
    "Nozzle": ((0.07, 0.065, 0.06), 1.0, 0.3, None, 0.0),
    "Copper": ((0.55, 0.28, 0.12), 1.0, 0.3, None, 0.0),
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
# Math helpers
# --------------------------------------------------------------------------------------------


def v(x: float, y: float, z: float) -> Vector:
    return Vector((x, y, z))


def lerp(a: float, b: float, f: float) -> float:
    return a + (b - a) * f


def smoothstep(f: float) -> float:
    return f * f * (3 - 2 * f)


def frange(a: float, b: float, step: float) -> list[float]:
    """Evenly spaced values from a to b (inclusive), roughly `step` apart."""
    n = max(1, round(abs(b - a) / step))
    return [lerp(a, b, i / n) for i in range(n + 1)]


def aim(direction: Vector) -> Matrix:
    """Rotation that maps local +Z onto `direction`."""
    up = "Y" if abs(direction.normalized().z) > 0.9 else "Z"
    return direction.normalized().to_track_quat("Z", "X" if up == "Z" else "Y").to_matrix().to_4x4()


AXIS_X = aim(v(1, 0, 0))
AXIS_Y = aim(v(0, 1, 0))
BACK = v(-1, 0, 0)


def _superellipse(phi: float, a: float, b: float, n: float) -> tuple[float, float]:
    c, s = math.cos(phi), math.sin(phi)
    e = 2.0 / n
    return a * math.copysign(abs(c) ** e, c), b * math.copysign(abs(s) ** e, s)


@lru_cache(maxsize=8192)
def _arc_table(ratio: float, n: float) -> tuple[tuple[float, ...], tuple[float, ...], float]:
    """Normalised arc length against angle for a superellipse of half height 1 and width `ratio`."""
    steps = 360
    phis = tuple(2 * math.pi * i / steps for i in range(steps + 1))
    points = [_superellipse(phi, ratio, 1.0, n) for phi in phis]
    lengths = [0.0]
    for (y0, z0), (y1, z1) in zip(points, points[1:]):
        lengths.append(lengths[-1] + math.hypot(y1 - y0, z1 - z0))
    total = lengths[-1]
    return tuple(length / total for length in lengths), phis, total


def _angle(t: float, ratio: float, n: float) -> float:
    ts, phis, _ = _arc_table(ratio, n)
    t %= 1.0
    i = min(max(bisect_right(ts, t) - 1, 0), len(ts) - 2)
    span = ts[i + 1] - ts[i]
    return lerp(phis[i], phis[i + 1], (t - ts[i]) / span if span > 0 else 0.0)


# --------------------------------------------------------------------------------------------
# Bodies: lofted hull sections
# --------------------------------------------------------------------------------------------


class Body:
    """A hull body lofted along local X from rounded superellipse cross-sections.

    Surface points are addressed by (x, t, h): t runs once around the section by arc length,
    starting at +Y (t = 0), over the top (0.25), -Y (0.5) and the bottom (0.75); h is the height
    above the surface along its normal. `matrix` places the body in the ship.
    """

    def __init__(self, stations, n: float = 3.0, y: float = 0.0, matrix: Matrix | None = None):
        # Each station: (x, half width, half height, centre z[, exponent]).
        self.stations = [tuple(s) + (n,) * (5 - len(s)) for s in stations]
        self.y = y
        self.matrix = matrix if matrix is not None else Matrix.Identity(4)
        self.rot = self.matrix.to_3x3()
        self.x0, self.x1 = self.stations[0][0], self.stations[-1][0]

    def profile(self, x: float) -> tuple[float, float, float, float]:
        st = self.stations
        if x <= st[0][0]:
            return st[0][1:]
        for s0, s1 in zip(st, st[1:]):
            if x <= s1[0]:
                f = smoothstep((x - s0[0]) / (s1[0] - s0[0]))
                return tuple(lerp(p, q, f) for p, q in zip(s0[1:], s1[1:]))
        return st[-1][1:]

    def perimeter(self, x: float) -> float:
        a, b, _, n = self.profile(x)
        return _arc_table(round(a / b, 2), round(n, 2))[2] * b

    def _section(self, x: float, t: float):
        a, b, z, n = self.profile(x)
        yy, zz = _superellipse(_angle(t, round(a / b, 2), round(n, 2)), a, b, n)
        return a, b, z, n, yy, zz

    def _normal(self, x, a, b, n, yy, zz) -> Vector:
        # Gradient of |y/a|^n + |z/b|^n - 1, including the taper of a, b and z along x.
        d = 0.02
        a0, b0, z0, _ = self.profile(x - d)
        a1, b1, z1, _ = self.profile(x + d)
        da, db, dz = (a1 - a0) / (2 * d), (b1 - b0) / (2 * d), (z1 - z0) / (2 * d)
        u, w = yy / a, zz / b
        fy = n / a * abs(u) ** (n - 1) * math.copysign(1.0, u)
        fz = n / b * abs(w) ** (n - 1) * math.copysign(1.0, w)
        fx = -fy * u * da - fz * (dz + w * db)
        return Vector((fx, fy, fz)).normalized()

    def local_point(self, x: float, t: float, h: float = 0.0) -> Vector:
        a, b, z, n, yy, zz = self._section(x, t)
        p = Vector((x, self.y + yy, z + zz))
        if h:
            p += self._normal(x, a, b, n, yy, zz) * h
        return p

    def point(self, x: float, t: float, h: float = 0.0) -> Vector:
        return self.matrix @ self.local_point(x, t, h)

    def normal(self, x: float, t: float) -> Vector:
        a, b, _, n, yy, zz = self._section(x, t)
        return (self.rot @ self._normal(x, a, b, n, yy, zz)).normalized()

    def mount(self, x: float, t: float, h: float = 0.0) -> Matrix:
        """Frame on the surface: Z along the normal, X towards the body's front."""
        normal = self.normal(x, t)
        forward = self.rot @ v(1, 0, 0)
        forward = (forward - normal * forward.dot(normal)).normalized()
        frame = Matrix((forward, normal.cross(forward), normal)).transposed().to_4x4()
        frame.translation = self.point(x, t, h)
        return frame

    def find_t(self, x: float, y: float | None = None, z: float | None = None,
               lo: float = 0.0, hi: float = 1.0) -> float:
        """The t in [lo, hi] where the section passes closest to local `y` (or `z`)."""
        best, best_t = math.inf, lo
        for k in range(241):
            t = lerp(lo, hi, k / 240)
            p = self.local_point(x, t)
            d = abs(p.y - y) if y is not None else abs(p.z - z)
            if d < best:
                best, best_t = d, t
        return best_t


def top_t(body: Body, x: float, y: float) -> float:
    return body.find_t(x, y=y, lo=0.0, hi=0.5)


def bottom_t(body: Body, x: float, y: float) -> float:
    return body.find_t(x, y=y, lo=0.5, hi=1.0)


def flank_t(body: Body, x: float, z: float, side: int) -> float:
    return body.find_t(x, z=z, lo=-0.25, hi=0.25) if side > 0 else body.find_t(x, z=z, lo=0.25, hi=0.75)


def spar(start: Vector, end: Vector, sections, n: float = 2.2) -> Body:
    """Body running from `start` to `end` (e.g. a pylon): sections are (f, half chord, half
    thickness) at fractions f of its length; the chord lies horizontally."""
    axis = (end - start).normalized()
    up = v(0, 0, 1)
    up = (up - axis * up.dot(axis)).normalized()
    frame = Matrix((axis, up.cross(axis), up)).transposed().to_4x4()
    frame.translation = start
    length = (end - start).length
    return Body([(f * length, a, b, 0.0) for f, a, b in sections], n=n, matrix=frame)


# --------------------------------------------------------------------------------------------
# Mesh building
# --------------------------------------------------------------------------------------------


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
    keepout: list = field(default_factory=list)

    def __post_init__(self) -> None:
        self.color = self.bm.loops.layers.float_color.new("Col")

    # -- bookkeeping ---------------------------------------------------------------------

    def shade(self, material: str, tint: float | None = None) -> tuple[float, float, float, float]:
        """Vertex colour: a grey level with a slight warm or cool cast, like weathered plating."""
        if material in EMISSIVE:
            return (1.0, 1.0, 1.0, 1.0)
        s = tint if tint is not None else self.rng.uniform(0.68, 1.0)
        warm = self.rng.uniform(-0.03, 0.05)
        return (s * (1 + warm), s, s * (1 - warm), 1.0)

    def paint(self, faces, material: str, color, smooth: bool = False):
        if material not in self.materials:
            self.materials.append(material)
        index = self.materials.index(material)
        for face in faces:
            face.material_index = index
            face.smooth = smooth
            for loop in face.loops:
                loop[self.color] = color
        return faces

    def _finish(self, verts, material: str, tint: float | None = None, smooth: bool = False):
        faces = list({f for vert in verts for f in vert.link_faces})
        return self.paint(faces, material, self.shade(material, tint), smooth)

    def _sharpen(self, faces, angle_deg: float = 40.0) -> None:
        limit = math.radians(angle_deg)
        for face in faces:
            for edge in face.edges:
                if len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) > limit:
                    edge.smooth = False

    @staticmethod
    def _orient(faces, expected: Vector, probe=None) -> None:
        """Flips consistently wound `faces` if `probe` (default: the first) faces away from
        `expected`."""
        face = probe or faces[0]
        face.normal_update()
        if face.normal.dot(expected) < 0:
            for f in faces:
                f.normal_flip()

    def blocked(self, body: Body, x0: float, x1: float, t0: float, t1: float) -> bool:
        """Whether the patch overlaps a site reserved for an upgrade module."""
        for kb, kx0, kx1, kt0, kt1 in self.keepout:
            if kb is not body or x1 <= kx0 or x0 >= kx1:
                continue
            for shift in (-1.0, 0.0, 1.0):
                if t1 > kt0 + shift and t0 < kt1 + shift:
                    return True
        return False

    # -- basic primitives ------------------------------------------------------------------

    def box(self, center, size, material="Hull", rot: Matrix | None = None, tint=None):
        matrix = Matrix.Translation(center) @ (rot or Matrix()) @ Matrix.Diagonal((*size, 1.0))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=matrix)["verts"]
        return self._finish(verts, material, tint)

    def torus(self, center, major, minor, orient: Matrix, material="Copper", seg=40, seg_minor=10):
        """Ring around the local Z axis."""
        orient = orient.to_3x3().to_4x4()
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

    def lathe(self, center: Vector, rot: Matrix, profile, material="Hull", segments=24, tint=None,
              smooth=True, sharp=40.0):
        """Surface of revolution around local Z of `rot`. The (r, z) profile runs
        counter-clockwise around the solid: outside surfaces upwards, bores downwards."""
        bm = self.bm
        rot = rot.to_3x3()
        angles = [2 * math.pi * k / segments for k in range(segments)]
        rings = []
        for r, z in profile:
            if r < 1e-6:
                rings.append([bm.verts.new(center + rot @ v(0, 0, z))])
            else:
                rings.append([bm.verts.new(center + rot @ v(r * math.cos(a), r * math.sin(a), z))
                              for a in angles])
        faces = []
        for (ra, za), (rb, zb), ring_a, ring_b in zip(profile, profile[1:], rings, rings[1:]):
            if len(ring_a) == 1 and len(ring_b) == 1:
                continue
            band = []
            for k in range(segments):
                k1 = (k + 1) % segments
                if len(ring_a) == 1:
                    verts = (ring_a[0], ring_b[k1], ring_b[k])
                elif len(ring_b) == 1:
                    verts = (ring_a[k], ring_a[k1], ring_b[0])
                else:
                    verts = (ring_a[k], ring_a[k1], ring_b[k1], ring_b[k])
                band.append(bm.faces.new(verts))
            mid = math.pi / segments
            self._orient(band, rot @ v((zb - za) * math.cos(mid), (zb - za) * math.sin(mid), ra - rb))
            faces += band
        self.paint(faces, material, self.shade(material, tint), smooth)
        if smooth:
            self._sharpen(faces, sharp)
        return faces

    def sweep(self, path: list[Vector], radius: float, material="HullDark", sides=8, caps=True,
              closed=False, tint=None):
        """Tube along a polyline, framed by parallel transport."""
        bm = self.bm
        count = len(path)
        tangents = []
        for k in range(count):
            a = path[k - 1] if (k > 0 or closed) else path[k]
            b = path[(k + 1) % count] if (k < count - 1 or closed) else path[k]
            tangents.append((b - a).normalized())
        ref = v(0, 0, 1) if abs(tangents[0].z) < 0.9 else v(1, 0, 0)
        normal = (ref - tangents[0] * ref.dot(tangents[0])).normalized()
        rings = []
        for p, tangent in zip(path, tangents):
            normal = (normal - tangent * normal.dot(tangent)).normalized()
            binormal = tangent.cross(normal)
            rings.append([bm.verts.new(p + (normal * math.cos(a) + binormal * math.sin(a)) * radius)
                          for a in (2 * math.pi * s / sides for s in range(sides))])
        faces = []
        pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
        for ra, rb in pairs:
            for s in range(sides):
                s1 = (s + 1) % sides
                faces.append(bm.faces.new((ra[s], ra[s1], rb[s1], rb[s])))
        probe = faces[0]
        self._orient(faces, probe.calc_center_median() - (path[0] + path[1]) / 2, probe)
        tube = len(faces)
        if caps and not closed:
            start, end = bm.faces.new(rings[0]), bm.faces.new(rings[-1])
            self._orient([start], -tangents[0])
            self._orient([end], tangents[-1])
            faces = faces + [start, end]
        self.paint(faces, material, self.shade(material, tint), smooth=True)
        for face in faces[tube:]:
            face.smooth = False
        return faces

    # -- body surfaces ---------------------------------------------------------------------

    def skin(self, body: Body, material="HullDark", seg=0.16, dx=0.3, tint=0.55, caps=True):
        """The bare lofted surface, closed at both ends."""
        bm = self.bm
        xs = sorted({round(x, 5) for x in [s[0] for s in body.stations]
                     + frange(body.x0, body.x1, dx)})
        nt = max(12, math.ceil(max(body.perimeter(x) for x in xs) / seg / 4) * 4)
        rings = [[bm.verts.new(body.point(x, j / nt)) for j in range(nt)] for x in xs]
        faces = [bm.faces.new((r0[j], r0[(j + 1) % nt], r1[(j + 1) % nt], r1[j]))
                 for r0, r1 in zip(rings, rings[1:]) for j in range(nt)]
        k = len(faces) // 2
        i, j = divmod(k, nt)
        self._orient(faces, body.normal((xs[i] + xs[i + 1]) / 2, (j + 0.5) / nt), faces[k])
        if caps:
            back, front = bm.faces.new(rings[0]), bm.faces.new(rings[-1])
            self._orient([back], body.rot @ v(-1, 0, 0))
            self._orient([front], body.rot @ v(1, 0, 0))
            faces += [back, front]
        self.paint(faces, material, self.shade(material, tint), smooth=True)
        self._sharpen(faces, 50.0)
        return faces

    def shell(self, body: Body, x0, x1, t0, t1, h0, h1, material="Hull", bevel=0.05, tint=None,
              seg=0.22, dx=0.9, smooth=True):
        """A curved plate following the body surface over [x0, x1] x [t0, t1], rising from height
        h0 to h1 with chamfered edges. A full turn (t1 - t0 >= 1) makes a closed band."""
        if x1 - x0 < 1e-4 or t1 - t0 < 1e-5:
            return []
        bm = self.bm
        closed = t1 - t0 >= 0.999
        if closed:
            t1 = t0 + 1.0
        per = body.perimeter((x0 + x1) / 2)
        arc = (t1 - t0) * per
        nt = max(12 if closed else 1, math.ceil(arc / seg))
        nx = max(1, math.ceil((x1 - x0) / dx))
        bx = min(bevel, (x1 - x0) * 0.35)
        bt = 0.0 if closed else min(bevel, arc * 0.35) / per
        xs = [lerp(x0 + bx, x1 - bx, i / nx) for i in range(nx + 1)]
        ts = [lerp(t0 + bt, t1 - bt, j / nt) for j in range(nt + 1)]
        cols = nt if closed else nt + 1
        grid = [[bm.verts.new(body.point(x, ts[j], h1)) for j in range(cols)] for x in xs]
        top = [bm.faces.new((grid[i][j], grid[i][(j + 1) % cols], grid[i + 1][(j + 1) % cols],
                             grid[i + 1][j])) for i in range(nx) for j in range(nt)]
        k = len(top) // 2
        i, j = divmod(k, nt)
        self._orient(top, body.normal((xs[i] + xs[i + 1]) / 2, (ts[j] + ts[j + 1]) / 2), top[k])

        where = {grid[i][j]: (i, j) for i in range(nx + 1) for j in range(cols)}
        base: dict = {}

        def lower(vert):
            if vert not in base:
                i, j = where[vert]
                x = x0 if i == 0 else x1 if i == nx else xs[i]
                t = ts[j] if closed else t0 if j == 0 else t1 if j == nt else ts[j]
                base[vert] = bm.verts.new(body.point(x, t, h0))
            return base[vert]

        rim = [(loop.vert, loop.link_loop_next.vert, loop.edge)
               for face in top for loop in face.loops if len(loop.edge.link_faces) == 1]
        walls = [bm.faces.new((b, a, lower(a), lower(b))) for a, b, _ in rim]
        for _, _, edge in rim:
            edge.smooth = False
        color = self.shade(material, tint)
        self.paint(top, material, color, smooth)
        self.paint(walls, material, color, False)
        return top + walls

    def band(self, body: Body, x: float, width: float, h: float, material="Trim", t0=0.0, t1=1.0,
             tint=None):
        return self.shell(body, x - width / 2, x + width / 2, t0, t1, -0.03, h, material,
                          bevel=min(0.04, width * 0.3), tint=tint)

    def hoop(self, body: Body, x: float, h: float, radius: float, material="Trim", t0=0.0, t1=1.0,
             sides=8):
        """Tube running around the section at x (a closed ring for a full turn)."""
        closed = t1 - t0 >= 0.999
        steps = max(8, math.ceil((t1 - t0) * body.perimeter(x) / 0.12))
        count = steps if closed else steps + 1
        path = [body.point(x, lerp(t0, t1, k / steps), h + radius) for k in range(count)]
        return self.sweep(path, radius, material, sides=sides, closed=closed)

    def pipe(self, body: Body, t: float, x0: float, x1: float, radius: float, h=0.0,
             material="HullDark", sides=8):
        """Tube running lengthwise along the surface."""
        path = [body.point(x, t, h + radius) for x in frange(x0, x1, 0.35)]
        return self.sweep(path, radius, material, sides=sides)

    # -- greebles --------------------------------------------------------------------------

    def plating(self, body: Body, x0, x1, t0, t1, base=0.0, depth=0, size=0.95,
                heights=(0.06, 0.18)):
        """Recursively splits a surface patch into panels and details each of them."""
        rng = self.rng
        per = body.perimeter((x0 + x1) / 2)
        wx, wt = x1 - x0, (t1 - t0) * per
        if (1 <= depth <= 4 and base == 0.0 and 0.9 < max(wx, wt) < 3.2 and min(wx, wt) > 0.6
                and rng.random() < 0.3 and not self.blocked(body, x0, x1, t0, t1)):
            # Raised armour platform: the patch is detailed again on top of it.
            gap = 0.03 / per
            raised = rng.uniform(0.1, 0.2)
            self.shell(body, x0 + 0.03, x1 - 0.03, t0 + gap, t1 - gap, -0.03, raised, bevel=0.09,
                       tint=rng.uniform(0.6, 0.85))
            inset = 0.09 / per
            self.plating(body, x0 + 0.1, x1 - 0.1, t0 + inset, t1 - inset, raised, depth + 1, size,
                         (heights[0] * 0.6, heights[1] * 0.6))
            return
        if depth < 9 and (max(wx, wt) > size or (max(wx, wt) > 0.4 and rng.random() < 0.55)):
            f = rng.choice((0.33, 0.5, 0.67)) + rng.uniform(-0.08, 0.08)
            if wx * rng.uniform(0.6, 1.4) > wt:
                xm = lerp(x0, x1, f)
                self.plating(body, x0, xm, t0, t1, base, depth + 1, size, heights)
                self.plating(body, xm, x1, t0, t1, base, depth + 1, size, heights)
            else:
                tm = lerp(t0, t1, f)
                self.plating(body, x0, x1, t0, tm, base, depth + 1, size, heights)
                self.plating(body, x0, x1, tm, t1, base, depth + 1, size, heights)
            return
        self.panel(body, x0, x1, t0, t1, base, heights)

    def panel(self, body: Body, x0, x1, t0, t1, base=0.0, heights=(0.06, 0.18), style=None):
        rng = self.rng
        per = body.perimeter((x0 + x1) / 2)
        gap = 0.022
        x0, x1, t0, t1 = x0 + gap, x1 - gap, t0 + gap / per, t1 - gap / per
        wx, wt = x1 - x0, (t1 - t0) * per
        if wx < 0.05 or wt < 0.05:
            return
        if self.blocked(body, x0, x1, t0, t1):
            # A low mounting pad where an upgrade module will sit.
            self.shell(body, x0, x1, t0, t1, base - 0.03, base + 0.035, bevel=0.02,
                       tint=rng.uniform(0.55, 0.8))
            return
        small = min(wx, wt)
        h = base + rng.uniform(*heights)
        roll = rng.random() if style is None else {"plate": 0.0, "ribs": 0.4, "slats": 0.65}[style]
        if roll < 0.2:
            # Armour plate, usually carrying more detail on top: layer upon layer.
            self.shell(body, x0, x1, t0, t1, base - 0.03, h, bevel=min(0.05, small * 0.2))
            if small > 0.22 and base < 0.2 and rng.random() < 0.75:
                fx, ft = rng.uniform(0.4, 0.85), rng.uniform(0.4, 0.85)
                ox, ot = rng.uniform(0, 1 - fx), rng.uniform(0, 1 - ft)
                self.panel(body, lerp(x0, x1, ox), lerp(x0, x1, ox + fx), lerp(t0, t1, ot),
                           lerp(t0, t1, ot + ft), h - 0.005, (0.025, 0.07))
        elif roll < 0.6:
            # Transverse ribs over a floor plate: the sliced look of the original.
            self.shell(body, x0, x1, t0, t1, base - 0.03, base + 0.025, bevel=0.01,
                       tint=rng.uniform(0.45, 0.65))
            count = max(1, round(wx / rng.uniform(0.07, 0.13)))
            pitch = wx / count
            peak = h + rng.uniform(0.04, 0.14)
            pattern = rng.choice(("flat", "alternate", "wave", "random"))
            notched = rng.random() < 0.4
            tint = rng.uniform(0.7, 1.0)
            for k in range(count):
                xc = x0 + (k + 0.5) * pitch
                hk = {
                    "flat": peak,
                    "alternate": peak if k % 2 else lerp(base, peak, 0.6),
                    "wave": lerp(base, peak, 0.6 + 0.4 * math.sin(k * 0.9)),
                    "random": lerp(base, peak, rng.uniform(0.5, 1.0)),
                }[pattern]
                a, b = t0, t1
                if notched and k % 3:
                    a, b = lerp(t0, t1, 0.15), lerp(t0, t1, 0.85)
                self.shell(body, xc - pitch * 0.3, xc + pitch * 0.3, a, b, base, hk, bevel=0.012,
                           tint=tint)
        elif roll < 0.7:
            # Lengthwise slats.
            self.shell(body, x0, x1, t0, t1, base - 0.03, base + 0.025, bevel=0.01,
                       tint=rng.uniform(0.45, 0.65))
            count = max(1, round(wt / rng.uniform(0.09, 0.15)))
            dt = (t1 - t0) / count
            peak = h + rng.uniform(0.0, 0.06)
            tint = rng.uniform(0.7, 1.0)
            stagger = rng.random() < 0.5
            for k in range(count):
                tc = t0 + (k + 0.5) * dt
                a, b = (x0, x1) if not (stagger and k % 2) else (lerp(x0, x1, 0.12), lerp(x0, x1, 0.88))
                self.shell(body, a, b, tc - dt * 0.3, tc + dt * 0.3, base, peak, bevel=0.012,
                           tint=tint)
        elif roll < 0.78:
            # Recessed bay with pipes and clamps.
            if base > 0:
                self.shell(body, x0, x1, t0, t1, base - 0.03, base + 0.01, bevel=0.01, tint=0.5)
            count = rng.randint(2, 4)
            r = rng.uniform(0.028, 0.05)
            material = rng.choice(("HullDark", "Trim", "Hull"))
            for k in range(count):
                tc = lerp(t0, t1, (k + 0.5) / count)
                self.pipe(body, tc, x0, x1, r, base, material, sides=6)
            for x in frange(x0 + 0.1, x1 - 0.1, 0.5)[1:-1] if wx > 0.5 else []:
                self.shell(body, x - 0.03, x + 0.03, t0, t1, base, base + 2.4 * r, "Trim", bevel=0.01)
        elif roll < 0.84:
            # Round hatch or port.
            self.shell(body, x0, x1, t0, t1, base - 0.03, base + 0.03, bevel=0.015)
            self.hatch(body, (x0 + x1) / 2, (t0 + t1) / 2, small * rng.uniform(0.3, 0.42), base + 0.03)
        else:
            # Stepped block.
            top = base
            for level in range(rng.randint(2, 3)):
                f = 0.16 * level
                a, b = lerp(x0, x1, f), lerp(x0, x1, 1 - f)
                c, d = lerp(t0, t1, f), lerp(t0, t1, 1 - f)
                raised = top + rng.uniform(0.04, 0.08)
                self.shell(body, a, b, c, d, top - 0.03, raised, bevel=0.03)
                top = raised

    def frames(self, body: Body, xs, t0, t1, height=(0.17, 0.3), width=0.16):
        """Tall transverse frames made of arcs with gaps: they break up the silhouette."""
        rng = self.rng
        for x in xs:
            t = t0
            while t < t1 - 0.02:
                end = min(t + rng.uniform(0.05, 0.16), t1)
                if rng.random() < 0.75 and not self.blocked(body, x - width, x + width, t, end):
                    self.shell(body, x - width / 2, x + width / 2, t, end, -0.03,
                               rng.uniform(*height), bevel=0.035)
                t = end + rng.uniform(0.008, 0.03)

    def hatch(self, body: Body, x: float, t: float, radius: float, h: float = 0.0, material="Trim"):
        m = body.mount(x, t, h)
        r = radius
        self.lathe(m.translation, m, [
            (r, -0.08), (r, 0.03), (0.9 * r, 0.06), (0.8 * r, 0.045), (0.76 * r, 0.02),
            (0.5 * r, 0.02), (0.44 * r, 0.06), (0.3 * r, 0.08), (0.0, 0.08),
        ], material, segments=max(12, min(32, int(r * 70))))

    # -- engines ---------------------------------------------------------------------------

    def engine(self, position: Vector, direction: Vector, radius: float, kind="main"):
        """Main engine: bulbous housing, bell with cooling bands and a glowing throat."""
        d = direction.normalized()
        rot = aim(d)
        R = radius
        seg = max(14, min(36, int(R * 60)))
        self.lathe(position, rot, [
            (1.4 * R, -0.25 * R), (1.42 * R, 0.12 * R), (1.34 * R, 0.3 * R), (1.16 * R, 0.4 * R),
            (1.02 * R, 0.38 * R), (0.96 * R, 0.14 * R), (0.9 * R, 0.06 * R),
        ], "Hull", segments=seg)
        self.lathe(position, rot, [
            (0.7 * R, 0.0), (0.74 * R, 0.36 * R), (0.86 * R, 0.8 * R), (1.0 * R, 1.12 * R),
            (1.04 * R, 1.2 * R), (0.98 * R, 1.2 * R), (0.86 * R, 0.9 * R), (0.7 * R, 0.46 * R),
            (0.6 * R, 0.16 * R),
        ], "Nozzle", segments=seg)
        for z, r in ((0.55, 0.8), (0.86, 0.9)):
            self.torus(position + d * z * R, r * R + 0.01, 0.035 * R, rot, "Trim", seg=seg, seg_minor=5)
        self.lathe(position, rot, [(0.62 * R, 0.16 * R), (0.0, 0.16 * R)], "EngineGlow", segments=seg,
                   tint=1.0)
        self.lathe(position, rot, [(0.5 * R, 0.18 * R), (0.1 * R, 0.62 * R)], "EngineGlow",
                   segments=seg, tint=1.0)
        self.nozzles.append(Nozzle(kind, position + d * 1.12 * R, d, 0.95 * R))

    def jet(self, position: Vector, direction: Vector, radius: float, kind="rcs"):
        """Small thruster bell without a housing."""
        d = direction.normalized()
        rot = aim(d)
        R = radius
        self.lathe(position, rot, [
            (0.55 * R, 0.0), (0.62 * R, 0.3 * R), (0.8 * R, 0.8 * R), (0.95 * R, 1.0 * R),
            (0.86 * R, 1.0 * R), (0.7 * R, 0.72 * R), (0.5 * R, 0.3 * R), (0.44 * R, 0.05 * R),
        ], "Nozzle", segments=12)
        self.lathe(position, rot, [(0.5 * R, 0.12 * R), (0.0, 0.12 * R)], "EngineGlow", segments=12,
                   tint=1.0)
        self.nozzles.append(Nozzle(kind, position + d * 0.92 * R, d, 0.88 * R))

    def socket(self, position: Vector, direction: Vector, radius: float):
        """Capped engine port, filled when the engine upgrade is installed."""
        R = radius
        self.lathe(position, aim(direction), [
            (1.36 * R, -0.05), (1.36 * R, 0.05), (1.26 * R, 0.1), (1.1 * R, 0.08), (1.06 * R, 0.03),
            (0.0, 0.03),
        ], "Trim", segments=28)

    def rcs(self, m: Matrix, s: float = 1.0):
        """Reaction control quad on a surface mount frame."""
        r3 = m.to_3x3()
        o = m.translation
        block = Body([(-0.3 * s, 0.1 * s, 0.1 * s, 0.0), (-0.2 * s, 0.2 * s, 0.18 * s, 0.0),
                      (0.2 * s, 0.2 * s, 0.18 * s, 0.0), (0.3 * s, 0.1 * s, 0.1 * s, 0.0)],
                     n=3.0, matrix=m @ Matrix.Translation((0, 0, 0.12 * s)))
        self.skin(block, "Hull", seg=0.05, dx=0.1, tint=None)
        self.shell(block, -0.08 * s, 0.08 * s, 0.0, 1.0, -0.01, 0.025, "Trim", bevel=0.01, seg=0.06)
        self.jet(o + r3 @ v(0, 0, 0.28 * s), r3 @ v(0, 0, 1), 0.1 * s)
        for sign in (1, -1):
            self.jet(o + r3 @ v(sign * 0.29 * s, 0, 0.12 * s), r3 @ v(sign, 0, 0), 0.075 * s)

    # -- equipment -------------------------------------------------------------------------

    def turret(self, m: Matrix, s: float = 1.0, barrels: int = 2):
        """Rounded turret with long barrels on a mount frame (X forward, Z up)."""
        r3 = m.to_3x3()
        o = m.translation
        self.lathe(o, r3, [(0.46 * s, -0.12 * s), (0.48 * s, 0.04 * s), (0.42 * s, 0.1 * s),
                           (0.3 * s, 0.12 * s), (0.0, 0.12 * s)], "Trim", segments=24)
        housing = Body([(-0.36 * s, 0.14 * s, 0.08 * s, 0.0), (-0.26 * s, 0.3 * s, 0.16 * s, 0.0),
                        (0.08 * s, 0.3 * s, 0.17 * s, 0.01 * s), (0.3 * s, 0.2 * s, 0.11 * s, -0.02 * s),
                        (0.38 * s, 0.1 * s, 0.06 * s, -0.03 * s)],
                       n=2.8, matrix=m @ Matrix.Translation((0, 0, 0.27 * s)))
        self.skin(housing, "Hull", seg=0.05 * s, dx=0.07 * s, tint=None)
        for x in (-0.2 * s, -0.08 * s):
            self.shell(housing, x - 0.02 * s, x + 0.02 * s, 0.02, 0.48, -0.01, 0.022 * s, "Trim",
                       bevel=0.004, seg=0.06 * s)
        self.shell(housing, -0.16 * s, 0.02 * s, 0.18, 0.32, -0.01, 0.03 * s, "Hull", bevel=0.01,
                   seg=0.06 * s)
        barrel = r3 @ AXIS_X.to_3x3()
        for i in range(barrels):
            offset = (i - (barrels - 1) / 2) * 0.15 * s
            self.lathe(o + r3 @ v(0.24 * s, offset, 0.27 * s), barrel, [
                (0.0, 0.0), (0.07 * s, 0.0), (0.07 * s, 0.18 * s), (0.042 * s, 0.22 * s),
                (0.04 * s, 0.9 * s), (0.058 * s, 0.93 * s), (0.058 * s, 1.06 * s), (0.028 * s, 1.06 * s),
                (0.028 * s, 0.98 * s),
            ], "HullDark", segments=10)

    def dish(self, m: Matrix, radius: float = 0.6, tilt: float = 0.5):
        """Sensor dish on a post, tilted towards the front."""
        r3 = m.to_3x3()
        o = m.translation
        self.lathe(o, r3, [(0.16, -0.08), (0.16, 0.06), (0.08, 0.12), (0.07, 0.34), (0.0, 0.34)],
                   "Trim", segments=16)
        facing = r3 @ Euler((0, tilt, 0)).to_matrix()
        center = o + r3 @ v(0, 0, 0.36)
        R = radius
        self.lathe(center, facing, [(0.0, -0.02), (0.5 * R, 0.03 * R), (R, 0.26 * R), (0.97 * R, 0.29 * R),
                                    (0.5 * R, 0.1 * R), (0.0, 0.06 * R)], "Trim", segments=32)
        feed = facing @ v(0, 0, 1)
        self.sweep([center, center + feed * 0.75 * R], 0.018, "HullDark", sides=6)
        self.sphere(center + feed * 0.78 * R, 0.05, "Matrix", segments=10, rings=6)


# --------------------------------------------------------------------------------------------
# Ship layout
# --------------------------------------------------------------------------------------------
#
#  Rear: two stacked engine barrels (the ship's bulk). Middle: a neck ringed by four drums.
#  Front: a long tapering spine with twin booms that fork past its nose.

UPPER_POD = Body([(-8.8, 2.02, 1.24, 1.55), (-8.5, 2.3, 1.45, 1.55), (-3.6, 2.3, 1.45, 1.55),
                  (-2.3, 1.95, 1.22, 1.35), (-1.3, 1.35, 0.9, 1.05)], n=3.2)
LOWER_POD = Body([(-8.0, 1.9, 1.24, -1.45), (-7.7, 2.15, 1.45, -1.45), (-3.2, 2.15, 1.45, -1.45),
                  (-2.0, 1.8, 1.2, -1.2), (-1.0, 1.2, 0.9, -0.9)], n=3.2)
WEB = Body([(-8.0, 1.6, 0.34, 0.05), (-2.6, 1.6, 0.34, 0.05)], n=4.0)  # fills the gap between pods
NECK = Body([(-3.0, 1.6, 1.9, 0.05), (-1.2, 1.6, 1.6, 0.1), (1.6, 1.55, 1.45, 0.15),
             (2.6, 1.45, 1.3, 0.2)], n=2.6)
SPINE = Body([(1.8, 1.58, 1.42, 0.2), (4.2, 1.43, 1.25, 0.25), (6.6, 1.23, 1.06, 0.25),
              (8.6, 1.05, 0.9, 0.2), (10.4, 0.83, 0.7, 0.15), (11.7, 0.5, 0.43, 0.1),
              (12.5, 0.13, 0.13, 0.05)], n=3.4)
BOOMS = {side: Body([(5.0, 0.22, 0.28, 0.6), (5.8, 0.38, 0.44, 0.65), (11.4, 0.36, 0.42, 0.6),
                     (12.3, 0.32, 0.36, 0.55), (12.9, 0.1, 0.12, 0.55)], n=3.0, y=side * 1.12)
         for side in (1, -1)}
DRUMS = [Body([(-1.5, 0.48, 0.48, z), (-1.35, 0.64, 0.64, z), (1.55, 0.64, 0.64, z), (1.7, 0.48, 0.48, z)],
              n=2.0, y=side * 1.52) for z in (1.62, -1.3) for side in (1, -1)]
DRUM_RIBS = [-1.35, -0.75, -0.15, 0.45, 1.05, 1.55]
DRUM_BAYS = [(a + b) / 2 for a, b in zip(DRUM_RIBS, DRUM_RIBS[1:])]
CAGE = Body([(5.4, 0.38, 0.38, -1.05), (5.55, 0.52, 0.52, -1.05), (7.45, 0.52, 0.52, -1.05),
             (7.6, 0.38, 0.38, -1.05)], n=2.0)

# Rear faces: a large centre engine per pod plus four corner ports for the engine upgrade.
CENTRE_R, CORNER_R = 0.58, 0.34
CORNER_Y, CORNER_Z = 1.25, 0.62

# Lengthwise channels left free of plating for the field-matrix conduits.
CHANNEL = 0.075  # half width
SPINE_CHANNELS = (0.03, 0.47)
UPPER_CHANNEL = flank_t(UPPER_POD, -5.0, 1.72, 1)
LOWER_CHANNEL = flank_t(LOWER_POD, -5.0, -1.6, 1)


def mirrored(t: float) -> tuple[float, float]:
    return t, 0.5 - t


# Module sites (see the upgrade modules below).
TURRETS = {  # tier: [(body, x, y, scale, on top)]
    1: [(SPINE, 5.3, 0.0, 1.0, True), (SPINE, 7.6, 0.0, 0.9, True)],
    2: [(SPINE, 6.45, 0.5, 0.75, True), (SPINE, 6.45, -0.5, 0.75, True)],
    3: [(UPPER_POD, -6.25, 1.35, 1.05, True), (UPPER_POD, -6.25, -1.35, 1.05, True)],
    4: [(LOWER_POD, -5.0, 1.0, 1.0, False), (LOWER_POD, -5.0, -1.0, 1.0, False)],
}
DECKS = {1: (2.4, 4.6, 0.8, 0.3), 2: (2.75, 4.2, 0.6, 0.25), 3: (3.05, 3.85, 0.42, 0.2),
         4: (8.4, 9.9, 0.6, 0.22)}
GALLERY = (5.2, 7.6, -0.2)  # x0, x1, z of the flank galleries
GALLERY_Y = SPINE.profile(6.4)[0] - 0.02
REACTOR_X, SMALL_REACTORS = -4.4, (-6.9, -5.6)
CONDUIT_Y, CONDUIT_X = 0.75, (-7.4, -4.95)
BANKS = [(UPPER_POD, -6.9, 1.12), (UPPER_POD, -4.6, 1.12), (LOWER_POD, -6.2, -0.98),
         (LOWER_POD, -4.0, -0.98), (UPPER_POD, -7.0, 2.3)]
RCS = [(SPINE, 10.4, (0.125, 0.375)), (UPPER_POD, -8.1, (0.1, 0.4)), (LOWER_POD, -7.3, (0.6, 0.9)),
       (SPINE, 6.9, (0.625, 0.875)), (UPPER_POD, -2.6, (0.08, 0.42))]
GENERATORS = [2.2, 2.8, 3.4, 4.0, 4.6]
GENERATOR_T = (0.38, 1.12)  # leaves the dorsal decks clear
NACELLES = {1: (3.95, -1.75, -6.8, -0.8, LOWER_POD), 3: (4.1, 2.35, -7.6, -1.6, UPPER_POD)}
MAST_X, DISH_X, VENTRAL_DISH_X = 0.4, 10.6, -2.6
CANNON = (9.2, 11.9)


def site(body: Body, x: float, t: float, rx: float, rw: float):
    """Keep-out rectangle of half length rx and half width rw (world units) around (x, t)."""
    dt = rw / body.perimeter(x)
    return (body, x - rx, x + rx, t - dt, t + dt)


def keepouts() -> list:
    sites = []
    for mounts in TURRETS.values():
        for body, x, y, s, on_top in mounts:
            t = top_t(body, x, y) if on_top else bottom_t(body, x, y)
            sites.append(site(body, x, t, 0.55 * s, 0.55 * s))
    for tier, (x0, x1, a, _) in DECKS.items():
        if tier in (1, 4):
            sites.append(site(SPINE, (x0 + x1) / 2, 0.25, (x1 - x0) / 2 + 0.1, a + 0.1))
    for side in (1, -1):
        x0, x1, z = GALLERY
        sites.append(site(SPINE, (x0 + x1) / 2, flank_t(SPINE, x0, z, side), (x1 - x0) / 2 + 0.1, 0.3))
    sites.append(site(UPPER_POD, REACTOR_X, 0.25, 0.75, 0.75))
    sites += [site(UPPER_POD, x, 0.25, 0.45, 0.45) for x in SMALL_REACTORS]
    for y in (CONDUIT_Y, -CONDUIT_Y):
        x = sum(CONDUIT_X) / 2
        sites.append(site(UPPER_POD, x, top_t(UPPER_POD, x, y), (CONDUIT_X[1] - CONDUIT_X[0]) / 2, 0.16))
    for body, x, z in BANKS:
        for side in (1, -1):
            sites.append(site(body, x, flank_t(body, x, z, side), 1.0, 0.55))
    for body, x, ts in RCS:
        sites += [site(body, x, t, 0.35, 0.35) for t in ts]
    for x in GENERATORS:
        sites.append((SPINE, x - 0.2, x + 0.2, *GENERATOR_T))
    for y, z, x0, x1, pod in NACELLES.values():
        xm = (x0 + x1) / 2
        for side in (1, -1):
            sites.append(site(pod, xm, flank_t(pod, xm, z, side), 0.95, 0.3))
    sites.append(site(NECK, MAST_X, 0.25, 0.3, 0.3))
    sites.append(site(SPINE, DISH_X, 0.25, 0.5, 0.5))
    sites.append(site(LOWER_POD, VENTRAL_DISH_X, 0.75, 0.5, 0.5))
    sites.append(site(SPINE, sum(CANNON) / 2, 0.75, (CANNON[1] - CANNON[0]) / 2, 0.35))
    for side, boom in BOOMS.items():
        sites.append(site(boom, 12.1, 0.0 if side > 0 else 0.5, 0.35, 0.3))
    return sites


def rear_face(p: Part, pod: Body) -> None:
    """Engine face of a pod: centre engine, corner ports, collars and small domes."""
    x0 = pod.x0
    zc = pod.profile(x0)[2]
    rot = aim(BACK)
    p.engine(v(x0, 0, zc), BACK, CENTRE_R)
    for sy in (1, -1):
        for sz in (1, -1):
            p.socket(v(x0, sy * CORNER_Y, zc + sz * CORNER_Z), BACK, CORNER_R)
    for y, z, r in ((0, 0.98, 0.15), (0, -0.98, 0.15), (1.75, 0.0, 0.14), (-1.75, 0.0, 0.14)):
        p.lathe(v(x0, y, zc + z), rot, [(r, -0.05), (r, 0.04), (0.8 * r, 0.12), (0.4 * r, 0.16),
                                         (0.0, 0.17)], "Trim", segments=16)
    for y in (0.62, -0.62):  # braces between the ports
        p.sweep([v(x0 - 0.04, y, zc + 0.95), v(x0 - 0.04, y, zc - 0.95)], 0.045, "HullDark", sides=6)


def pod_ranges(pod: Body, channel: float, hidden: tuple[float, float], upper: bool):
    """Plating t-ranges around the conduit channels, skipping the face hidden against the other
    pod."""
    dt = CHANNEL / pod.perimeter(-5.0)
    a, b = mirrored(channel)
    if upper:
        return [(a + dt, b - dt), (b + dt, hidden[0]), (hidden[1], 1 + a - dt)]
    return [(hidden[1], b - dt), (b + dt, 1 + a - dt), (1 + a + dt, 1 + hidden[0])]


def build_hull() -> Part:
    p = Part("hull")
    p.keepout = keepouts()
    rng = p.rng
    for body in (UPPER_POD, LOWER_POD, WEB, NECK, SPINE, *BOOMS.values(), *DRUMS, CAGE):
        p.skin(body)

    # Engine pods.
    pods = (
        (UPPER_POD, UPPER_CHANNEL, pod_ranges(UPPER_POD, UPPER_CHANNEL, (0.66, 0.84), True), -1.7),
        (LOWER_POD, LOWER_CHANNEL, pod_ranges(LOWER_POD, LOWER_CHANNEL, (0.16, 0.34), False), -1.4),
    )
    for pod, channel, ranges, front in pods:
        x0 = pod.x0
        p.shell(pod, x0 - 0.01, x0 + 0.3, 0, 1, -0.03, 0.09, "Trim", bevel=0.07)
        p.shell(pod, x0 + 0.36, x0 + 0.52, 0, 1, -0.03, 0.22, "Hull", bevel=0.04)
        for t0, t1 in ranges:
            p.plating(pod, x0 + 0.56, front, t0, t1)
            p.frames(pod, frange(x0 + 1.2, front - 0.6, 0.7), t0, t1, height=(0.2, 0.38))
        for t in mirrored(channel):
            for x in frange(x0 + 0.8, front - 0.4, 0.75):
                dt = CHANNEL * 1.3 / pod.perimeter(x)
                p.shell(pod, x - 0.04, x + 0.04, t - dt, t + dt, -0.03, 0.11, "Trim", bevel=0.01)
        rear_face(p, pod)
    # Heat-sink comb on top of the upper pod, as on the original.
    for t0 in (0.17, 0.23, 0.29):
        p.panel(UPPER_POD, -8.35, -7.55, t0, t0 + 0.05, style="ribs", heights=(0.1, 0.16))
    for x in (-3.3, -2.85):  # conduits arching over the top
        p.hoop(UPPER_POD, x, 0.2, 0.05, "Trim", 0.06, 0.44)
    for side in (1, -1):
        for x in (-6.9, -5.5):
            p.hatch(LOWER_POD, x, flank_t(LOWER_POD, x, -2.05, side), 0.34, 0.08)
    # Pipes in the crease between the pods.
    for side in (1, -1):
        for dy, dz, r, material in ((1.86, 0.12, 0.07, "Trim"), (1.9, -0.06, 0.06, "HullDark"),
                                    (1.8, -0.2, 0.05, "Hull")):
            p.sweep([v(x, side * dy, dz) for x in frange(-7.9, -2.4, 0.5)], r, material, sides=8)
        for x in frange(-7.4, -2.9, 0.9):
            p.box(v(x, side * 1.86, -0.04), (0.08, 0.2, 0.42), "HullDark")

    # Neck and its drums.
    p.plating(NECK, -1.3, 2.4, 0.0, 1.0, size=1.0)
    for x in (-0.5, 0.8):
        for side in (1, -1):
            p.hatch(NECK, x, 0.0 if side > 0 else 0.5, 0.3, 0.1)
    for drum in DRUMS:
        phase = rng.random()
        p.band(drum, drum.x0 + 0.08, 0.16, 0.08)
        p.band(drum, drum.x1 - 0.08, 0.16, 0.08)
        for x in DRUM_RIBS[1:-1]:
            p.band(drum, x, 0.2, 0.06, "Trim")
            for k in range(3):  # gear ring made of three arcs
                t0 = phase + k / 3 + 0.03
                p.shell(drum, x - 0.06, x + 0.06, t0, t0 + 1 / 3 - 0.06, -0.03, 0.17, "Hull", bevel=0.03)
        for x in DRUM_BAYS:
            p.shell(drum, x - 0.2, x + 0.2, 0.0, 1.0, -0.02, 0.022, "HullDark", bevel=0.01, tint=0.5)

    # Spine.
    dt = CHANNEL / SPINE.perimeter(6.0)
    ch = SPINE_CHANNELS
    for t0, t1 in ((ch[0] + dt, ch[1] - dt), (ch[1] + dt, 1 + ch[0] - dt)):
        p.plating(SPINE, 2.0, 11.9, t0, t1)
        p.frames(SPINE, frange(2.7, 11.2, 0.8), t0, t1, height=(0.16, 0.3))
    for t in ch:
        for x in frange(2.3, 10.8, 0.7):
            dtx = CHANNEL * 1.3 / SPINE.perimeter(x)
            p.shell(SPINE, x - 0.04, x + 0.04, t - dtx, t + dtx, -0.03, 0.1, "Trim", bevel=0.01)
    p.lathe(v(12.35, 0, 0.05), AXIS_X, [(0.0, -0.1), (0.2, -0.1), (0.2, 0.08), (0.13, 0.3),
                                         (0.05, 0.62), (0.0, 0.7)], "Trim", segments=16)
    # Ventral cage drum.
    for k in range(16):
        t = k / 16
        p.shell(CAGE, 5.65, 7.35, t - 0.012, t + 0.012, -0.02, 0.09, "Trim", bevel=0.01)
    for x in (5.6, 6.5, 7.4):
        p.band(CAGE, x, 0.12, 0.12, "Hull")

    # Forward booms.
    for side, boom in BOOMS.items():
        c = 0.0 if side > 0 else 0.5
        dt = CHANNEL / boom.perimeter(9.0)
        p.plating(boom, 5.9, 12.2, c + dt, c + 1 - dt, size=0.9, heights=(0.03, 0.09))
        p.frames(boom, frange(6.5, 11.9, 1.1), c + dt, c + 1 - dt, height=(0.1, 0.18), width=0.12)
        p.lathe(v(12.8, side * 1.12, 0.55), AXIS_X, [(0.0, -0.1), (0.14, -0.1), (0.14, 0.06),
                                                     (0.08, 0.3), (0.0, 0.42)], "Trim", segments=14)
    return p


# --------------------------------------------------------------------------------------------
# Upgrade modules: MODULES[upgrade id] = builder(tier, part)
# --------------------------------------------------------------------------------------------


def avidyne_engine(tier: int, p: Part) -> None:
    """Additional main engines in the rear ports, then flank boosters."""
    if tier <= 4:
        pod, sz = [(UPPER_POD, -1), (LOWER_POD, 1), (UPPER_POD, 1), (LOWER_POD, -1)][tier - 1]
        zc = pod.profile(pod.x0)[2]
        for sy in (1, -1):
            p.engine(v(pod.x0, sy * CORNER_Y, zc + sz * CORNER_Z), BACK, CORNER_R)
        return
    for side in (1, -1):
        booster = Body([(-8.4, 0.28, 0.28, -0.02), (-8.1, 0.36, 0.36, -0.02), (-5.8, 0.36, 0.36, -0.02),
                        (-5.1, 0.16, 0.16, -0.02)], n=2.4, y=side * 2.25)
        p.skin(booster, "Hull", tint=None)
        p.plating(booster, -8.0, -5.4, 0.0, 1.0, size=0.6, heights=(0.02, 0.06))
        p.band(booster, -8.3, 0.14, 0.08)
        p.engine(v(-8.4, side * 2.25, -0.02), BACK, 0.26)


def accelerator_generator(tier: int, p: Part) -> None:
    """Generator collars clamped around the spine, with copper windings and glowing vents."""
    x = GENERATORS[tier - 1]
    t0, t1 = GENERATOR_T
    p.shell(SPINE, x - 0.17, x + 0.17, t0, t1, -0.03, 0.24, "Trim", bevel=0.05)
    p.shell(SPINE, x - 0.075, x + 0.075, t0 + 0.01, t1 - 0.01, 0.2, 0.31, "Copper", bevel=0.02)
    dt = 0.08 / SPINE.perimeter(x)
    for tc in (0.5, 0.75, 1.0):
        p.shell(SPINE, x - 0.13, x + 0.13, tc - dt, tc + dt, 0.2, 0.27, "Matrix", bevel=0.005, tint=1.0)


def driver_coil(tier: int, p: Part) -> None:
    """Copper windings in one bay of each drum."""
    x = DRUM_BAYS[tier - 1]
    for drum in DRUMS:
        for dx in (-0.12, 0.0, 0.12):
            p.hoop(drum, x + dx, 0.0, 0.055, "Copper", sides=8)
        p.band(drum, x, 0.035, 0.13, "Matrix", tint=1.0)


def impulse_capacitance_cell(tier: int, p: Part) -> None:
    """Capacitor banks on the pod flanks."""
    body, x, z = BANKS[tier - 1]
    for side in (1, -1):
        t = flank_t(body, x, z, side)
        dt = 0.42 / body.perimeter(x)
        p.shell(body, x - 0.95, x + 0.95, t - dt, t + dt, -0.03, 0.12, "HullDark", bevel=0.05)
        m = body.mount(x, t, 0.12)
        axis = m.to_3x3() @ AXIS_X.to_3x3()
        for i in (-1, 0, 1):
            c = m @ v(0, i * 0.27, 0.13)
            p.lathe(c, axis, [(0.0, -0.9), (0.1, -0.9), (0.13, -0.86), (0.13, 0.86), (0.1, 0.9),
                              (0.0, 0.9)], "Trim", segments=14)
            for z in (-0.55, 0.0, 0.55):
                p.lathe(c + axis @ v(0, 0, z), axis, [(0.145, -0.05), (0.145, 0.05)], "Matrix",
                        segments=14, tint=1.0)
        for dx in (-0.8, 0.8):
            p.box(m @ v(dx, 0, 0.13), (0.1, 0.84, 0.2), "Hull", rot=m.to_3x3().to_4x4())


def impulse_control_system(tier: int, p: Part) -> None:
    """Masts, dishes and sensor pods."""
    if tier == 1:
        m = NECK.mount(MAST_X, 0.25, 0.04)
        r3 = m.to_3x3()
        o = m.translation
        p.lathe(o, r3, [(0.22, -0.1), (0.22, 0.08), (0.1, 0.2), (0.05, 1.3), (0.0, 1.3)], "Trim",
                segments=12)
        for h, w in ((0.6, 0.45), (0.9, 0.3)):
            p.sweep([o + r3 @ v(0, -w, h), o + r3 @ v(0, w, h)], 0.02, "Trim", sides=6)
        p.sphere(o + r3 @ v(0, 0, 1.34), 0.07, "Matrix", segments=10, rings=6)
    elif tier == 2:
        p.dish(SPINE.mount(DISH_X, 0.25, 0.04), 0.55, tilt=0.6)
    elif tier == 3:
        for side, boom in BOOMS.items():
            m = boom.mount(12.1, 0.0 if side > 0 else 0.5, 0.05)
            axis = m.to_3x3() @ AXIS_X.to_3x3()
            c = m @ v(0, 0, 0.12)
            p.lathe(c + axis @ v(0, 0, -0.35), axis, [(0.0, 0.0), (0.1, 0.02), (0.13, 0.2), (0.13, 0.55),
                                                      (0.1, 0.68), (0.0, 0.7)], "Hull", segments=14)
            p.sphere(c + axis @ v(0, 0, 0.36), 0.06, "Matrix", segments=10, rings=6)
    elif tier == 4:
        p.dish(LOWER_POD.mount(VENTRAL_DISH_X, 0.75, 0.04), 0.55, tilt=-0.4)
    else:
        for side in (1, -1):
            start = v(12.3, side * 0.12, 0.08)
            p.sweep([start, start + v(1.6, 0, 0)], 0.022, "Trim", sides=6)
            p.sphere(start + v(1.62, 0, 0), 0.045, "Matrix", segments=8, rings=6)


def deck_body(tier: int) -> Body:
    x0, x1, a, b = DECKS[tier]
    if tier in (1, 4):
        def floor(x):
            return SPINE.point(x, 0.25).z - 0.1
    else:
        below = deck_body(tier - 1)

        def floor(x):
            return below.point(x, 0.25).z - 0.06
    xs = (x0, x0 + 0.35, x1 - 0.45, x1)
    scale = ((0.55, 0.6), (1, 1), (1, 1), (0.5, 0.55))
    return Body([(x, a * sa, b * sb, floor(x) + b * 0.45) for x, (sa, sb) in zip(xs, scale)], n=3.3)


def impulse_deck(tier: int, p: Part) -> None:
    """Superstructure decks with lit windows, then galleries along the flanks."""
    if tier <= 4:
        deck = deck_body(tier)
        x0, x1 = deck.x0, deck.x1
        p.skin(deck, "Hull", tint=None)
        p.plating(deck, x0 + 0.4, x1 - 0.45, 0.12, 0.38, size=0.6, heights=(0.02, 0.05))
        p.band(deck, x0 + 0.37, 0.08, 0.05)
        dt = 0.045 / deck.perimeter((x0 + x1) / 2)
        for t in (0.03, 0.47):
            for x in frange(x0 + 0.45, x1 - 0.55, 0.2):
                p.shell(deck, x - 0.055, x + 0.055, t - dt, t + dt, -0.01, 0.012, "Window", bevel=0.005,
                        tint=1.0)
        if tier == 3:  # bridge windows looking forward
            dt = 0.03 / deck.perimeter(x1 - 0.25)
            for k in range(-3, 4):
                t = 0.25 + k * 0.035
                p.shell(deck, x1 - 0.32, x1 - 0.2, t - dt, t + dt, -0.01, 0.012, "Window", bevel=0.005,
                        tint=1.0)
        return
    x0, x1, z = GALLERY
    for side in (1, -1):
        gallery = Body([(x0, 0.08, 0.1, z), (x0 + 0.3, 0.17, 0.22, z), (x1 - 0.3, 0.17, 0.22, z),
                        (x1, 0.08, 0.1, z)], n=3.0, y=side * GALLERY_Y)
        p.skin(gallery, "Hull", tint=None)
        t = 0.0 if side > 0 else 0.5
        dt = 0.05 / gallery.perimeter(6.0)
        for x in frange(x0 + 0.4, x1 - 0.4, 0.18):
            p.shell(gallery, x - 0.05, x + 0.05, t - dt, t + dt, -0.01, 0.012, "Window", bevel=0.005,
                    tint=1.0)
        for x in frange(x0 + 0.3, x1 - 0.3, 0.8):
            p.band(gallery, x, 0.06, 0.04)


def impulse_jet(tier: int, p: Part) -> None:
    """Reaction control quads."""
    body, x, ts = RCS[tier - 1]
    for t in ts:
        p.rcs(body.mount(x, t, 0.02))


def conduit(p: Part, body: Body, t: float, x0: float, x1: float, radius: float = 0.035) -> None:
    p.pipe(body, t, x0, x1, radius, 0.0, "Matrix", sides=6)
    for x in frange(x0 + 0.2, x1 - 0.2, 0.6):
        dt = 0.07 / body.perimeter(x)
        p.shell(body, x - 0.035, x + 0.035, t - dt, t + dt, -0.02, 2.6 * radius, "Trim", bevel=0.01)


def impulse_matrix(tier: int, p: Part) -> None:
    """Glowing field-matrix conduits in the hull channels."""
    if tier <= 3:
        x0, x1 = [(2.05, 5.0), (5.0, 7.9), (7.9, 10.9)][tier - 1]
        for t in SPINE_CHANNELS:
            conduit(p, SPINE, t, x0, x1)
    elif tier == 4:
        for pod, channel, front in ((UPPER_POD, UPPER_CHANNEL, -2.2), (LOWER_POD, LOWER_CHANNEL, -1.9)):
            for t in mirrored(channel):
                conduit(p, pod, t, pod.x0 + 0.6, front, 0.045)
    else:
        for side, boom in BOOMS.items():
            conduit(p, boom, 0.0 if side > 0 else 0.5, 6.0, 12.2, 0.03)


def nacelle_body(tier: int, side: int) -> Body:
    y, z, x0, x1, _ = NACELLES[tier]
    return Body([(x0, 0.4, 0.4, z), (x0 + 0.3, 0.55, 0.55, z), (x1 - 1.4, 0.55, 0.55, z),
                 (x1 - 0.4, 0.42, 0.42, z), (x1, 0.16, 0.16, z)], n=2.3, y=side * y)


def impulse_nacelle(tier: int, p: Part) -> None:
    """Outboard nacelles on pylons with their own engines, then glowing field bulbs."""
    if tier in NACELLES:
        y, z, x0, x1, pod = NACELLES[tier]
        for side in (1, -1):
            nacelle = nacelle_body(tier, side)
            p.skin(nacelle, "Hull", tint=None)
            p.plating(nacelle, x0 + 0.35, x1 - 0.5, 0.0, 1.0, size=0.9, heights=(0.03, 0.09))
            p.frames(nacelle, frange(x0 + 0.9, x1 - 1.4, 1.2), 0.0, 1.0, height=(0.1, 0.18), width=0.12)
            p.band(nacelle, x0 + 0.15, 0.2, 0.08)
            p.engine(v(x0, side * y, z), BACK, 0.4, kind="nacelle")
            xm = (x0 + x1) / 2
            start = pod.point(xm, flank_t(pod, xm, z, side), -0.2)
            pylon = spar(start, v(xm, side * (y - 0.3), z), [(0.0, 0.8, 0.12), (1.0, 0.55, 0.09)])
            p.skin(pylon, "Hull", seg=0.1, dx=0.25, tint=None)
            p.plating(pylon, 0.3, pylon.x1 - 0.1, 0.0, 1.0, size=0.5, heights=(0.02, 0.05))
    elif tier in (2, 4):
        y, z, x0, x1, _ = NACELLES[tier - 1]
        for side in (1, -1):
            nacelle = nacelle_body(tier - 1, side)
            p.sphere(v(x1 - 0.05, side * y, z), 0.3, "Reactor", segments=20, rings=12)
            p.band(nacelle, x1 - 0.42, 0.14, 0.12, "Trim")
            p.hoop(nacelle, x1 - 0.2, 0.02, 0.04, "Trim")
    else:
        for y, z, x0, x1, _ in NACELLES.values():
            for side in (1, -1):
                c = v(x0 + 0.9, side * (y + 0.62), z)
                p.lathe(c, AXIS_X, [(0.0, -0.75), (0.14, -0.75), (0.22, -0.55), (0.22, 0.45),
                                    (0.12, 0.8), (0.0, 0.85)], "Hull", segments=16)
                p.sweep([c + v(0.2, -side * 0.1, 0), c + v(0.2, -side * 0.5, 0)], 0.06, "HullDark")
                p.engine(c + v(-0.75, 0, 0), BACK, 0.17, kind="nacelle")


def impulse_reactor(tier: int, p: Part) -> None:
    """Exposed reactor cores on the upper pod."""
    m = UPPER_POD.mount(REACTOR_X, 0.25, 0.03)
    r3 = m.to_3x3()
    o = m.translation
    if tier == 1:
        p.lathe(o, r3, [(0.66, -0.1), (0.68, 0.1), (0.6, 0.22), (0.52, 0.2), (0.46, 0.08), (0.0, 0.08)],
                "Trim", segments=32)
        p.sphere(o + r3 @ v(0, 0, 0.45), 0.4, "Reactor", segments=28, rings=16)
    elif tier == 2:
        for k in range(6):  # containment cage
            a = 2 * math.pi * k / 6
            path = [o + r3 @ v(0.52 * math.cos(a) * math.sin(b), 0.52 * math.sin(a) * math.sin(b),
                               0.45 - 0.52 * math.cos(b)) for b in frange(0.5, math.pi - 0.35, 0.2)]
            p.sweep(path, 0.035, "Trim", sides=6)
        p.torus(o + r3 @ v(0, 0, 0.45), 0.54, 0.04, m, "Trim", seg=40, seg_minor=6)
        p.lathe(o + r3 @ v(0, 0, 0.9), r3, [(0.16, -0.04), (0.16, 0.04), (0.08, 0.1), (0.0, 0.12)],
                "Trim", segments=16)
    elif tier == 3:
        for y in (CONDUIT_Y, -CONDUIT_Y):
            t = top_t(UPPER_POD, -6.0, y)
            p.pipe(UPPER_POD, t, CONDUIT_X[0], CONDUIT_X[1], 0.06, 0.0, "Reactor", sides=8)
            for x in frange(CONDUIT_X[0] + 0.2, CONDUIT_X[1] - 0.2, 0.45):
                dt = 0.12 / UPPER_POD.perimeter(x)
                p.shell(UPPER_POD, x - 0.1, x + 0.1, t - dt, t + dt, -0.02, 0.16, "Trim", bevel=0.03)
    elif tier == 4:
        for x in SMALL_REACTORS:
            mm = UPPER_POD.mount(x, 0.25, 0.03)
            c = mm.translation
            rr = mm.to_3x3()
            p.lathe(c, rr, [(0.42, -0.1), (0.44, 0.08), (0.38, 0.16), (0.3, 0.14), (0.0, 0.14)], "Trim",
                    segments=24)
            p.sphere(c + rr @ v(0, 0, 0.3), 0.24, "Reactor", segments=20, rings=12)
            p.torus(c + rr @ v(0, 0, 0.3), 0.3, 0.03, mm, "Trim", seg=28, seg_minor=6)
    else:
        c = o + r3 @ v(0, 0, 0.45)
        p.torus(c, 0.95, 0.04, m @ Euler((0.5, 0.3, 0)).to_matrix().to_4x4(), "Reactor", seg=56, seg_minor=6)
        p.torus(c, 1.1, 0.028, m @ Euler((-0.4, 0.6, 0)).to_matrix().to_4x4(), "Matrix", seg=56,
                seg_minor=6)


def impulse_response_filter(tier: int, p: Part) -> None:
    """Weapon turrets and finally a spinal cannon."""
    if tier <= 4:
        for body, x, y, s, on_top in TURRETS[tier]:
            t = top_t(body, x, y) if on_top else bottom_t(body, x, y)
            p.turret(body.mount(x, t, 0.02), s)
        return
    x0, x1 = CANNON
    z = SPINE.point(10.6, 0.75).z - 0.12
    housing = Body([(x0, 0.08, 0.08, z + 0.08), (x0 + 0.5, 0.3, 0.24, z), (x1 - 0.7, 0.26, 0.22, z),
                    (x1, 0.14, 0.12, z)], n=2.6)
    p.skin(housing, "Hull", tint=None)
    p.plating(housing, x0 + 0.5, x1 - 0.6, 0.5, 1.0, size=0.5, heights=(0.02, 0.05))
    p.lathe(v(x1 - 0.05, 0, z), AXIS_X, [(0.0, 0.0), (0.12, 0.0), (0.12, 0.3), (0.09, 0.36), (0.09, 1.7),
                                          (0.14, 1.76), (0.14, 1.9), (0.06, 1.9), (0.06, 1.8)], "Trim",
            segments=16)
    for k in range(4):
        p.torus(v(x1 + 0.45 + k * 0.3, 0, z), 0.11, 0.025, AXIS_X, "Matrix", seg=16, seg_minor=5)
    p.sphere(v(x1 + 1.82, 0, z), 0.07, "Reactor", segments=12, rings=8)


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


def use_gpu() -> None:
    """Runs Cycles on the first available GPU backend, if any."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        devices = [d for d in prefs.devices if d.type == backend]
        if devices:
            for device in prefs.devices:
                device.use = device.type == backend
            bpy.context.scene.cycles.device = "GPU"
            print(f"Cycles on {backend}: {', '.join(d.name for d in devices)}", flush=True)
            return
    bpy.context.scene.cycles.device = "CPU"


def bake_ambient_occlusion(objects, hull) -> None:
    """Bakes AO into a temporary colour attribute and multiplies it into the plate tints."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    use_gpu()
    scene.cycles.samples = 48
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.light_settings.distance = 1.0
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
                k = 0.25 + 0.75 * a.color[0]
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
    polygons = sum(len(o.data.polygons) for o in objects)
    triangles = sum(len(p.vertices) - 2 for o in objects for p in o.data.polygons)
    print(f"built {len(objects)} objects, {polygons} polygons, {triangles} triangles "
          f"(hull {len(objects[0].data.polygons)} polygons)", flush=True)
    if bake:
        bake_ambient_occlusion(objects, objects[0])
    export(out)
    print(f"exported {out}", flush=True)
    return objects


def script_args() -> list[str]:
    """Script arguments: those after `--` when run by the Blender executable, whose own options
    fill the rest of argv, otherwise (Blender as a Python module) the usual argv."""
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    return [] if Path(sys.argv[0]).stem.lower().startswith("blender") else sys.argv[1:]


if __name__ == "__main__":
    argv = script_args()
    args = [a for a in argv if not a.startswith("--")]
    build(Path(args[0]) if args else DEFAULT_OUT, bake="--no-bake" not in argv)
