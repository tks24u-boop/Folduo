"""Claude Code Clamshell Dock - parametric model (build123d).

A vertical charging dock for MacBooks used in clamshell (closed-display) mode,
sized for a Bambu Lab P2S (build volume 256 x 256 x 256 mm).

Parts
  body              PLA/PETG, one piece, printed upright without supports
  liner_<model>     TPU 95A, two per dock; print the pair that matches your Mac
  foot_tpu          TPU 95A, four per dock (or use 12.7 mm urethane bumpers)
  cable_grommet_*   TPU 95A, grips one or two cables in the channel under the dock
  logo_*            Clawd, the Claude Code mascot, inlaid in the front face

Usage
  python3 clamshell_dock.py                 regenerate everything in ../print and ../step
  python3 clamshell_dock.py --liner 14.2    one extra liner for a 14.2 mm thick laptop
  python3 clamshell_dock.py --assembly DIR  placed meshes for render_blender.py / drawings.py

All dimensions are millimetres. Assembly coordinates: X along the dock (the
laptop's width), Y front(-)/back(+), Z up, desk at z = 0.
"""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path

import trimesh
from build123d import (
    Axis,
    Box,
    Cone,
    Cylinder,
    Kind,
    Part,
    Plane,
    Polygon,
    Pos,
    Rectangle,
    RectangleRounded,
    Rot,
    Sketch,
    Vector,
    chamfer,
    export_step,
    export_stl,
    extrude,
    fillet,
    mirror,
    offset,
)
from build123d import fillet as fillet2d

from clawd import CLAWD_ORANGE_HEX, clawd_sketches
from pixfont import text_sketch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


# --------------------------------------------------------------------------
# MacBook data from Apple's tech specs (height excludes the rubber feet, as
# Apple's MacBook Neo drawing shows; the feet sit outside the dock anyway)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Laptop:
    key: str
    label: str
    thickness: float
    width: float
    depth: float
    weight: float  # heaviest configuration, kg
    liner: str


LAPTOPS = [
    Laptop("neo", "MacBook Neo (2026)", 12.75, 297.5, 206.4, 1.23, "neo"),
    Laptop("air13", "MacBook Air 13 (M2-M5)", 11.3, 304.1, 215.0, 1.24, "air"),
    Laptop("air15", "MacBook Air 15 (M2-M5)", 11.5, 340.4, 237.6, 1.51, "air"),
    Laptop("air13m1", "MacBook Air 13 (M1, wedge)", 16.1, 304.1, 212.4, 1.29, "m1air"),
    Laptop("pro13", "MacBook Pro 13 (M1/M2)", 15.6, 304.1, 212.4, 1.40, "pro14"),
    Laptop("pro14", "MacBook Pro 14 (2021-2026)", 15.5, 312.6, 221.2, 1.63, "pro14"),
    Laptop("pro16", "MacBook Pro 16 (2021-2026)", 16.8, 355.7, 248.1, 2.20, "pro16"),
]

# liner -> (thickness at the liner floor the bumps are tuned for, front-wall lean in degrees)
# The M1 Air is a wedge (16.1 mm at the hinge, 4.1 mm at the front edge), so it goes in
# hinge-down with the lid towards the front and the front wall leans to follow it.
LINERS = {
    "air": (11.45, 0.0),
    "neo": (12.75, 0.0),
    "pro14": (15.55, 0.0),
    "pro16": (16.8, 0.0),
    "m1air": (16.05, math.degrees(math.atan(12.0 / 212.4))),
}


# --------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------
@dataclass
class P:
    # body
    length: float = 200.0  # shorter than every MacBook, so the side ports stay free
    depth: float = 116.0  # footprint across the slot: the tipping direction
    height: float = 46.0
    draft: float = 7.0  # side draft, degrees
    r_plan: float = 20.0
    r_top: float = 9.0
    ch_bottom: float = 1.2  # 45 deg foot chamfer, hides elephant foot
    # slot
    slot_w: float = 26.0
    z_floor: float = 11.0
    r_mouth: float = 3.0
    r_slot_end: float = 2.0
    # T-shaped cable channel under the slot, open to the desk. Its roof is two 45 deg
    # slopes meeting in a ridge, so the ceiling prints without any bridge.
    ch_w: float = 13.0
    ch_h: float = 8.9
    ch_chamfer: float = 6.4
    ch_turn_r: float = 9.0
    # liners
    liner_len: float = 48.0
    liner_x: float = 66.0
    liner_clr: float = 0.05  # per side between TPU liner and PLA slot
    liner_recess: float = 2.0
    liner_floor: float = 3.0
    membrane_t: float = 1.2
    air_gap: float = 0.8  # also the travel limit of the membranes
    rib_w: float = 2.0
    bump_r: float = 1.0
    bump_interference: float = 0.1  # per side at the tuned thickness
    lead_in: float = 0.8
    # snap pegs that hold the liners down
    peg_dx: float = 14.0
    peg_neck_d: float = 5.0
    peg_head_d: float = 6.1
    peg_h: float = 2.55
    # feet: pockets fit 12.7 mm urethane bumpers (3M SJ5312) or the TPU feet
    foot_pocket_d: float = 13.3
    foot_pocket_h: float = 1.5
    foot_d: float = 13.0
    foot_t: float = 3.0
    foot_inset_x: float = 22.0
    foot_inset_y: float = 18.0
    # Clawd logo (16u x 10u)
    logo_u: float = 2.5
    logo_z: float = 19.5
    logo_t: float = 2.4
    logo_clr: float = 0.2  # per side; the pocket ceiling on the vertical face can sag a little
    logo_eye_t: float = 0.6
    # 45 deg chamfer at the back of the pocket's top edges: without it the 30 mm
    # "ceiling" above the head would be printed as a bridge and could sag
    logo_back_chamfer: float = 1.4
    # engraving
    text_px: float = 0.9
    text_depth: float = 0.4

    @property
    def lift(self) -> float:
        """Height of the dock bottom above the desk when standing on the TPU feet."""
        return self.foot_t - self.foot_pocket_h

    @property
    def laptop_z(self) -> float:
        """Laptop edge height above the dock bottom."""
        return self.z_floor + self.liner_floor


def _ok(part: Part, name: str) -> Part:
    if not part.is_valid:
        raise RuntimeError(f"{name}: invalid solid")
    return part


def front_plane(p: P, z: float) -> Plane:
    """Plane on the drafted front face at height z, normal pointing out of the part."""
    th = math.radians(p.draft)
    n = Vector(0, -math.cos(th), math.sin(th))
    return Plane(origin=(0, -p.depth / 2 + z * math.tan(th), z), x_dir=(1, 0, 0), z_dir=n)


def _yz_prism(pts, x0: float, x1: float) -> Part:
    """Extrude a polygon given as (y, z) points from x0 to x1 (winding does not matter)."""
    return Pos(x0, 0, 0) * extrude(Plane.YZ * Polygon(*pts, align=None), x1 - x0, dir=(1, 0, 0))


# --------------------------------------------------------------------------
# body
# --------------------------------------------------------------------------
def channel_plan(p: P) -> Sketch:
    run = Rectangle(p.length + 20, p.ch_w)
    branch = Pos(0, p.depth / 4 + 5) * Rectangle(p.ch_w, p.depth / 2 + 10)
    sk = Sketch() + [run, branch]
    inner = [v for v in sk.vertices() if abs(v.Y - p.ch_w / 2) < 1e-6 and abs(abs(v.X) - p.ch_w / 2) < 1e-6]
    return fillet2d(inner, p.ch_turn_r) if inner else sk


def back_top_chamfer(part: Part, z_back: float, size: float) -> Part:
    """Chamfer the edges where upward-facing faces meet the back face (z = z_back)."""
    edges = [
        e
        for f in part.faces()
        if f.normal_at().Y > 0.99
        for e in f.edges()
        if abs(e.center().Z - z_back) < 1e-6
    ]
    return chamfer(edges, size) if edges else part


def make_peg(p: P) -> Part:
    """Snap peg: the TPU liner pops over the head and is held down."""
    n, h = p.peg_neck_d / 2, p.peg_head_d / 2
    z1, z2, z3 = 0.9, 0.9 + (h - n), 2.0
    peg = Pos(0, 0, z1 / 2) * Cylinder(n, z1)
    peg += Pos(0, 0, (z1 + z2) / 2) * Cone(n, h, z2 - z1)
    peg += Pos(0, 0, (z2 + z3) / 2) * Cylinder(h, z3 - z2)
    peg += Pos(0, 0, (z3 + p.peg_h) / 2) * Cone(h, n, p.peg_h - z3)
    return peg


def make_body(p: P, logo: bool = True) -> Part:
    body = extrude(RectangleRounded(p.length, p.depth, p.r_plan), p.height, taper=p.draft)
    body = fillet(body.edges().group_by(Axis.Z)[-1], p.r_top)
    body = chamfer(body.edges().group_by(Axis.Z)[0], p.ch_bottom)

    # through slot with a rounded mouth
    body -= Pos(0, 0, p.z_floor + (p.height + 5) / 2) * Box(p.length + 20, p.slot_w, p.height + 5)
    mouth = [
        e
        for e in body.edges().filter_by(Axis.X)
        if e.center().Z > p.height - 15 and abs(abs(e.center().Y) - p.slot_w / 2) < 0.5
    ]
    body = fillet(mouth, p.r_mouth)
    ends = [
        e
        for e in body.edges().filter_by(Axis.Z)
        if abs(abs(e.center().Y) - p.slot_w / 2) < 0.5 and abs(e.center().X) > p.length / 2 - 8
    ]
    try:
        body = fillet(ends, p.r_slot_end)
    except Exception:  # OCCT occasionally refuses; a sharp edge is harmless here
        pass

    # cable channel, open to the desk, with a 45 deg ridge roof
    h1 = p.ch_h - p.ch_chamfer
    body -= Pos(0, 0, -0.01) * extrude(channel_plan(p), h1 + 0.01)
    body -= Pos(0, 0, h1) * extrude(channel_plan(p), p.ch_chamfer, taper=45)

    # liner snap pegs
    peg = make_peg(p)
    for sx in (-1, 1):
        for dx in (-p.peg_dx, p.peg_dx):
            body += Pos(sx * p.liner_x + dx, 0, p.z_floor) * peg

    # foot pockets
    for sx in (-1, 1):
        for sy in (-1, 1):
            x = sx * (p.length / 2 - p.foot_inset_x)
            y = sy * (p.depth / 2 - p.foot_inset_y)
            body -= Pos(x, y, p.foot_pocket_h / 2 - 0.01) * Cylinder(p.foot_pocket_d / 2, p.foot_pocket_h + 0.02)

    # Clawd pocket in the front face
    if logo:
        outline, _, _ = clawd_sketches(p.logo_u)
        pocket = offset(outline, p.logo_clr, kind=Kind.INTERSECTION)
        cutter = back_top_chamfer(extrude(pocket, -p.logo_t), -p.logo_t, p.logo_back_chamfer)
        pl = front_plane(p, p.logo_z)
        body -= pl * cutter
        body -= pl * extrude(pocket, 3.0)

    # engraving under the base, mirrored so it reads from below
    for txt, dy in (("CLAUDE CODE", 24), ("CLAMSHELL DOCK", 14)):
        sk = mirror(text_sketch(txt, p.text_px), about=Plane.YZ)
        body -= Pos(0, -p.depth / 2 + dy, -0.01) * extrude(sk, p.text_depth + 0.01)

    return _ok(body, "body")


# --------------------------------------------------------------------------
# TPU liner with compliant "air cushion" membranes
# --------------------------------------------------------------------------
def liner_gap(p: P, t: float) -> float:
    """Gap between the two membrane faces when the liner is tuned for thickness t."""
    return t - 2 * p.bump_interference + 2 * p.bump_r


def liner_height(p: P) -> float:
    return p.height - p.z_floor - p.liner_recess


def make_liner(p: P, t: float, lean: float = 0.0, label: str = "", coupon: bool = False) -> Part:
    """U-shaped liner. Each wall is a 1.2 mm membrane backed by an air gap, so the
    four contact bumps per side give way instead of squeezing the laptop.
    lean > 0 tilts the front wall (for the wedge-shaped M1 MacBook Air).
    coupon=True makes a 16 mm slice with one bump per side and no snap holes:
    a quick print to feel the fit on your Mac before printing the real pair."""
    lx = 16.0 if coupon else p.liner_len
    wy, hz, f = p.slot_w - 2 * p.liner_clr, liner_height(p), p.liner_floor
    g0 = liner_gap(p, t)
    need = p.membrane_t + p.air_gap + 1.2
    if (wy - g0) / 2 < need:
        raise ValueError(f"slot_w too small for a {t} mm laptop")

    part = Pos(0, 0, hz / 2) * Box(lx, wy, hz)
    if coupon:
        bays = [(-lx / 2 + p.rib_w, lx / 2 - p.rib_w)]
    else:
        bays = [(-lx / 2 + p.rib_w, -p.rib_w / 2), (p.rib_w / 2, lx / 2 - p.rib_w)]
    zt = hz - p.lead_in
    for s in (-1, 1):
        tan_a = math.tan(math.radians(lean)) if s < 0 else 0.0

        def face(z, s=s, tan_a=tan_a):
            return s * (g0 / 2 - (z - f) * tan_a)

        # half cavity with a 45 deg lead-in flare at the top
        top = face(zt) + s * p.lead_in
        cav = [(0, f), (face(f), f), (face(zt), zt), (top, hz), (top, hz + 1), (0, hz + 1)]
        part -= _yz_prism(cav, -lx / 2 - 1, lx / 2 + 1)
        # air gaps behind the membrane, open at the top
        za, zb = f + 1.0, hz + 1
        gap = [
            (face(za) + s * p.membrane_t, za),
            (face(za) + s * (p.membrane_t + p.air_gap), za),
            (face(zb) + s * (p.membrane_t + p.air_gap), zb),
            (face(zb) + s * p.membrane_t, zb),
        ]
        for x0, x1 in bays:
            part -= _yz_prism(gap, x0, x1)
        # contact bumps in the middle of each bay, ramped at the top
        z0, z1, ramp = f + 1.0, zt - 0.3, 5.0
        for x0, x1 in bays:
            xc = (x0 + x1) / 2
            b = Pos(xc, face(f), (z0 + z1 - ramp) / 2) * Cylinder(p.bump_r, z1 - z0 - ramp)
            b += Pos(xc, face(f), z1 - ramp / 2) * Cone(p.bump_r, 0.05, ramp)
            if lean and s < 0:
                pivot = Vector(0, face(f), f)
                b = Pos(pivot) * Rot(-lean, 0, 0) * Pos(-pivot) * b
            part += b

    # snap holes for the pegs: narrow lip at the bottom, wider pocket above
    for dx in () if coupon else (-p.peg_dx, p.peg_dx):
        part -= Pos(dx, 0, 0.5) * Cylinder(p.peg_neck_d / 2 + 0.2, 1.02)
        part -= Pos(dx, 0, 1.0 + (f - 1.0) / 2 + 0.05) * Cylinder(p.peg_head_d / 2 + 0.25, f - 1.0 + 0.1)

    if label:
        sk = mirror(text_sketch(label, 0.6 if not coupon else 0.5), about=Plane.YZ)
        if coupon:  # the label runs across the floor of the short coupon
            sk = Rot(0, 0, 90) * sk
            part -= Pos(-lx / 2 + 2.6, 0, -0.01) * extrude(sk, 0.41)
        else:
            part -= Pos(0, -wy / 2 + 3.4, -0.01) * extrude(sk, 0.41)
    return _ok(part, f"liner {label or t}")


# --------------------------------------------------------------------------
# small TPU parts and the logo
# --------------------------------------------------------------------------
def make_foot(p: P) -> Part:
    foot = Pos(0, 0, p.foot_t / 2) * Cylinder(p.foot_d / 2, p.foot_t)
    return _ok(chamfer(foot.edges().group_by(Axis.Z)[-1], 0.6), "foot")


GROMMETS = {
    # name: [(x, y, hole diameter)] in the grommet's cross-section, y = 0 on the desk side
    "cable_grommet_1x": [(0.0, 3.0, 4.2)],  # one 4-6 mm cable (USB-C / Thunderbolt)
    "cable_grommet_2x": [(-3.05, 2.2, 3.6), (3.05, 2.2, 3.6)],  # two 3.5-4.5 mm cables
}


def make_grommet(p: P, holes) -> Part:
    """TPU plug that pushes up into the channel at the end you use and grips the cable
    so it cannot slide away when the laptop is lifted out. Modelled in print
    orientation: the axis of the holes is Z."""
    w, h, ln = p.ch_w + 0.3, p.ch_h - 0.2, 12.0
    g = Pos(0, h / 2, ln / 2) * Box(w, h, ln)
    g = chamfer(g.edges().filter_by(Axis.Z).filter_by_position(Axis.Y, h - 0.1, h + 0.1), p.ch_chamfer + 0.2)
    for x, y, d in holes:
        g -= Pos(x, y, ln / 2) * Cylinder(d / 2, ln + 1)
        g -= Pos(x, y / 2 - 0.25, ln / 2) * Box(0.8, y + 0.5, ln + 1)  # slit: push the cable in from below
    return _ok(g, "grommet")


def make_logo_parts(p: P) -> dict[str, Part]:
    """Logo parts in print orientation: the visible face lies on the plate (z = 0)."""
    outline, body_sk, eyes_sk = clawd_sketches(p.logo_u)
    c = p.logo_back_chamfer + 0.3
    eyes = extrude(eyes_sk, p.logo_eye_t)
    orange = back_top_chamfer(extrude(outline, p.logo_t), p.logo_t, c) - eyes
    single = back_top_chamfer(extrude(body_sk, p.logo_t), p.logo_t, c)
    peg = Pos(0, 0, p.logo_t / 2) * Box(p.logo_u - 0.1, 2 * p.logo_u - 0.1, p.logo_t)
    return {
        "logo_orange": _ok(orange, "logo orange"),
        "logo_eyes": _ok(eyes, "logo eyes"),
        "logo_single_color": _ok(single, "logo single"),
        "logo_eye_peg": _ok(peg, "eye peg"),
    }


def place_logo(p: P, part: Part) -> Part:
    """Move a logo part from print orientation into the body's pocket."""
    return front_plane(p, p.logo_z) * (Rot(0, 180, 0) * part)


def place_liner(p: P, part: Part, side: int) -> Part:
    return Pos(side * p.liner_x, 0, p.z_floor) * part


# --------------------------------------------------------------------------
# laptop stand-in for fit checks and renders
# --------------------------------------------------------------------------
def make_laptop(lp: Laptop, r_plan: float = 13.0, r_edge: float = 3.0) -> Part:
    body = extrude(RectangleRounded(lp.width, lp.depth, r_plan), lp.thickness)
    body = fillet(body.edges().group_by(Axis.Z)[0], r_edge)
    body = fillet(body.edges().group_by(Axis.Z)[-1], min(r_edge, 2.0))
    zs = lp.thickness * 0.68
    ring = extrude(RectangleRounded(lp.width + 2, lp.depth + 2, r_plan + 1), 0.35) - extrude(
        RectangleRounded(lp.width - 0.6, lp.depth - 0.6, r_plan - 0.3), 0.35
    )
    return body - Pos(0, 0, zs) * ring


def place_laptop(p: P, lp: Laptop, part: Part) -> Part:
    """Stand the laptop on its long edge in the slot (bottom case towards the back)."""
    return Pos(0, 0, p.laptop_z) * Rot(90, 0, 0) * Pos(0, lp.depth / 2, -lp.thickness / 2) * part


# --------------------------------------------------------------------------
# reports
# --------------------------------------------------------------------------
def fit_report(p: P) -> list[dict]:
    rows = []
    for lp in LAPTOPS:
        t, lean = LINERS[lp.liner]
        bump_gap = liner_gap(p, t) - 2 * p.bump_r
        squeeze = (lp.thickness - bump_gap) / 2
        rows.append(
            {
                "model": lp.label,
                "thickness": lp.thickness,
                "liner": lp.liner,
                "bump_gap_at_floor": round(bump_gap, 2),
                "squeeze_per_side": round(squeeze, 3),
                "membrane_travel_left": round(p.air_gap - squeeze, 3),
                "port_side_overhang": round((lp.width - p.length) / 2, 1),
                "top_above_desk": round(p.lift + p.laptop_z + lp.depth, 1),
            }
        )
    return rows


def stability_report(p: P, dock_kg: float) -> list[dict]:
    """Static tip angle across the slot and the sideways push at the laptop's top edge
    that starts tipping the dock (rigid laptop, feet at the footprint edge)."""
    half = p.depth / 2 - p.ch_bottom
    rows = []
    for lp in LAPTOPS:
        m = lp.weight + dock_kg
        z_lap = p.lift + p.laptop_z + lp.depth / 2
        cg = (lp.weight * z_lap + dock_kg * (p.lift + 17)) / m
        top = p.lift + p.laptop_z + lp.depth
        rows.append(
            {
                "model": lp.label,
                "tip_angle_deg": round(math.degrees(math.atan(half / cg)), 1),
                "push_at_top_N": round(m * 9.81 * half / top, 1),
            }
        )
    return rows


# --------------------------------------------------------------------------
# export helpers
# --------------------------------------------------------------------------
def stl_mesh(part: Part, path: Path, tol: float) -> trimesh.Trimesh:
    """Export an STL and read it back as a merged mesh; refuse leaky meshes."""
    export_stl(part, str(path), tolerance=tol, angular_tolerance=0.15)
    m = trimesh.load(path)
    if not (m.is_watertight and m.is_winding_consistent and m.volume > 0):
        raise RuntimeError(f"{path.name}: mesh is not a closed solid")
    return m


def write_3mf(path: Path, title: str, items: list[dict]) -> None:
    """Plain 3MF core file that Bambu Studio, OrcaSlicer and PrusaSlicer open.
    items: {"name", "parts": [(part_name, mesh)], "at": (x, y)} on a 256 mm plate.
    A multi-part item becomes one object whose parts can take different filaments."""
    res, build, oid = [], [], 1
    for it in items:
        ids = []
        for pname, mesh in it["parts"]:
            v = "".join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in mesh.vertices)
            t = "".join(f'<triangle v1="{i}" v2="{j}" v3="{k}"/>' for i, j, k in mesh.faces)
            res.append(
                f'<object id="{oid}" type="model" name="{pname}">'
                f"<mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>"
            )
            ids.append(oid)
            oid += 1
        if len(ids) > 1:
            comps = "".join(f'<component objectid="{i}"/>' for i in ids)
            res.append(f'<object id="{oid}" type="model" name="{it["name"]}"><components>{comps}</components></object>')
            top = oid
            oid += 1
        else:
            top = ids[0]
        x, y = it["at"]
        build.append(f'<item objectid="{top}" transform="1 0 0 0 1 0 0 0 1 {x:.3f} {y:.3f} 0"/>')
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        f'<metadata name="Title">{title}</metadata>'
        '<metadata name="Designer">Claude Code Clamshell Dock</metadata>'
        '<metadata name="Application">clamshell_dock.py (build123d)</metadata>'
        f"<resources>{''.join(res)}</resources><build>{''.join(build)}</build></model>"
    )
    types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
    )
    with zipfile.ZipFile(path, "w") as z:
        for name, data in (("[Content_Types].xml", types), ("_rels/.rels", rels), ("3D/3dmodel.model", model)):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))  # fixed stamp: rebuilds give identical files
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)


# --------------------------------------------------------------------------
# build everything
# --------------------------------------------------------------------------
STEP_PARTS = {"body", "liner_air", "liner_neo", "liner_pro14", "liner_pro16", "liner_m1air", "logo_orange"}


def make_parts(p: P) -> dict[str, Part]:
    parts = {"body": make_body(p), "body_no_logo": make_body(p, logo=False)}
    for key, (t, lean) in LINERS.items():
        parts[f"liner_{key}"] = make_liner(p, t, lean, f"{key.upper()} {t:g}")
        parts[f"liner_{key}_test"] = make_liner(p, t, lean, key.upper(), coupon=True)
    parts["foot_tpu"] = make_foot(p)
    for name, holes in GROMMETS.items():
        parts[name] = make_grommet(p, holes)
    parts.update(make_logo_parts(p))
    return parts


def build_all(p: P, out: Path, step: bool = True) -> dict:
    stl_dir, mf_dir, step_dir = out / "print" / "stl", out / "print" / "3mf", out / "step"
    for d in (stl_dir, mf_dir, step_dir):
        d.mkdir(parents=True, exist_ok=True)
    parts = make_parts(p)
    meshes: dict[str, trimesh.Trimesh] = {}
    report: dict = {"params": asdict(p), "parts": {}}
    for name, part in parts.items():
        tol = 0.01 if name.startswith(("logo", "cable")) else 0.02
        mesh = stl_mesh(part, stl_dir / f"{name}.stl", tol)
        meshes[name] = mesh
        report["parts"][name] = {
            "volume_cm3": round(part.volume / 1000, 2),
            "size_mm": [round(v, 2) for v in mesh.extents],
            "watertight": bool(mesh.is_watertight),
        }
        if step and name in STEP_PARTS:
            export_step(part, str(step_dir / f"{name}.step"))

    c = 128.0  # plate centre
    write_3mf(mf_dir / "1_body_PLA.3mf", "Clamshell dock body", [{"name": "body", "parts": [("body", meshes["body"])], "at": (c, c)}])
    write_3mf(
        mf_dir / "1b_body_no_logo_PLA.3mf",
        "Clamshell dock body without logo pocket",
        [{"name": "body_no_logo", "parts": [("body_no_logo", meshes["body_no_logo"])], "at": (c, c)}],
    )
    write_3mf(
        mf_dir / "2_logo_clawd_2color_AMS.3mf",
        "Clawd logo insert (2 colours)",
        [{"name": "Clawd logo", "parts": [("clawd_orange", meshes["logo_orange"]), ("clawd_eyes_black", meshes["logo_eyes"])], "at": (c, c)}],
    )
    write_3mf(
        mf_dir / "2b_logo_clawd_single_color.3mf",
        "Clawd logo insert (single colour + eye pegs)",
        [
            {"name": "clawd_single", "parts": [("clawd_single", meshes["logo_single_color"])], "at": (c, c)},
            {"name": "eye_peg_1", "parts": [("eye_peg", meshes["logo_eye_peg"])], "at": (c - 6, c - 25)},
            {"name": "eye_peg_2", "parts": [("eye_peg", meshes["logo_eye_peg"])], "at": (c + 6, c - 25)},
        ],
    )
    write_3mf(
        mf_dir / "0_TPU_fit_test_all_liners.3mf",
        "16 mm test slices of every liner",
        [
            {"name": f"test_{k}", "parts": [(f"liner_{k}_test", meshes[f"liner_{k}_test"])], "at": (c - 80 + 40 * i, c)}
            for i, k in enumerate(LINERS)
        ],
    )
    for key in LINERS:
        items = [
            {"name": f"liner_{key}_A", "parts": [(f"liner_{key}", meshes[f"liner_{key}"])], "at": (c - 32, c + 20)},
            {"name": f"liner_{key}_B", "parts": [(f"liner_{key}", meshes[f"liner_{key}"])], "at": (c + 32, c + 20)},
        ]
        items += [{"name": f"foot_{i}", "parts": [("foot", meshes["foot_tpu"])], "at": (c - 30 + 20 * i, c - 25)} for i in range(4)]
        items += [
            {"name": g, "parts": [(g, meshes[g])], "at": (c - 12 + 24 * i, c - 50)} for i, g in enumerate(GROMMETS)
        ]
        write_3mf(mf_dir / f"3_TPU_liners_{key}_feet_grommets.3mf", f"TPU parts for {key}", items)

    report["fit"] = fit_report(p)
    report["logo_colour"] = CLAWD_ORANGE_HEX
    return report


def export_assembly(p: P, out: Path, laptop_key: str = "pro14") -> None:
    """Placed meshes for renders: assembled and exploded, plus a manifest the
    Blender script reads (material name per mesh)."""
    out.mkdir(parents=True, exist_ok=True)
    lp = next(l for l in LAPTOPS if l.key == laptop_key)
    t, lean = LINERS[lp.liner]
    liner = make_liner(p, t, lean)
    logo = make_logo_parts(p)
    foot, grommet = make_foot(p), make_grommet(p, GROMMETS["cable_grommet_1x"])
    lift = Pos(0, 0, p.lift)
    n = front_plane(p, p.logo_z).z_dir
    feet = [
        Pos(sx * (p.length / 2 - p.foot_inset_x), sy * (p.depth / 2 - p.foot_inset_y), -(p.foot_t - p.foot_pocket_h))
        for sx in (-1, 1)
        for sy in (-1, 1)
    ]
    # grommet sits in the channel just inside the right-hand end (print Z -> world X)
    g_at = Plane(origin=(p.length / 2 - 14, 0, 0), x_dir=(0, 1, 0), z_dir=(1, 0, 0))
    sets = {
        "assembled": {"shift": {}, "laptop": True},
        "dock": {"shift": {}, "laptop": False},
        "exploded": {
            "shift": {"liner": (0, 0, 45), "logo": tuple(n * 60), "foot": (0, 0, -22), "grommet": (48, 0, -14)},
            "laptop": False,
            "raise": 30.0,
        },
    }
    for set_name, cfg in sets.items():
        items = [("body", make_body(p), "body")]
        items += [(f"liner_{i}", place_liner(p, liner, s), "tpu") for i, s in enumerate((-1, 1))]
        items += [("logo_orange", place_logo(p, logo["logo_orange"]), "orange"), ("logo_eyes", place_logo(p, logo["logo_eyes"]), "black")]
        items += [(f"foot_{i}", loc * foot, "tpu") for i, loc in enumerate(feet)]
        items += [("grommet", g_at * grommet, "tpu")]
        if cfg["laptop"]:
            items += [("laptop", place_laptop(p, lp, make_laptop(lp)), "laptop")]
        manifest = []
        for name, part, mat in items:
            key = name.split("_")[0]
            dx, dy, dz = cfg["shift"].get(key, (0, 0, 0))
            part = Pos(dx, dy, dz + cfg.get("raise", 0.0)) * lift * part
            fn = out / f"{set_name}__{name}.stl"
            export_stl(part, str(fn), tolerance=0.02, angular_tolerance=0.15)
            manifest.append({"file": fn.name, "material": mat})
        (out / f"{set_name}.json").write_text(json.dumps(manifest, indent=1))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT), help="output root (default: the project folder)")
    ap.add_argument("--no-step", action="store_true", help="skip STEP export")
    ap.add_argument("--liner", type=float, metavar="MM", help="only make a liner for a laptop this thick")
    ap.add_argument("--lean", type=float, default=0.0, help="front wall lean for --liner, degrees")
    ap.add_argument("--assembly", metavar="DIR", help="only write placed meshes for renders into DIR")
    args = ap.parse_args()
    p = P()
    if args.assembly:
        export_assembly(p, Path(args.assembly))
        return
    if args.liner:
        part = make_liner(p, args.liner, args.lean, f"{args.liner:g}")
        dst = Path(args.out) / "print" / "stl" / f"liner_custom_{args.liner:g}mm.stl"
        dst.parent.mkdir(parents=True, exist_ok=True)
        export_stl(part, str(dst), tolerance=0.02, angular_tolerance=0.15)
        print(f"wrote {dst}")
        return
    report = build_all(p, Path(args.out), step=not args.no_step)
    Path(args.out, "print", "build_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report["parts"], indent=1))
    print(json.dumps(report["fit"], indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
