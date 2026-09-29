"""TOGE (峠) - Claude Code clamshell dock, parametric model (build123d).

A vertical dock for a MacBook Air 13 (M2-M5) used lid-closed, printed on a
Bambu Lab P2S. One black PETG body shaped like a mountain pass: a low middle
where the Mac's hot hinge edge stays in open air, and two Fuji-profile peaks at
the ends that hold it. The Mac stands hinge-down in a felt-lined 90 deg V.

Printed parts
  body    black PETG, upright, no supports                    1_body_PETG.3mf
  badge   Clawd seal: 2 mm glow PLA face + 1 mm white PLA     2_clawd_badge.3mf
  gauge   optional fit test: horn slice and pad comb        0_fit_gauge_PETG.3mf
Bought: 2 mm self-adhesive felt (V strips and pad liners), four flat 12 x 2 mm feet.

Usage
  python3 clamshell_dock.py                  write the three 3MF files into ../print
  python3 clamshell_dock.py --c 0.4          another running clearance chosen on the gauge comb
  python3 clamshell_dock.py --assembly DIR   placed meshes for render_blender.py / drawings.py

Millimetres. X along the Mac (+x = the user's right, where the ports of a
hinge-down Mac land), Y front(-)/back(+), Z up, desk at z = 0. The printed
underside sits at z = P.zb because the feet protrude that much.
"""

from __future__ import annotations

import argparse
import json
import math
import tempfile
import zipfile
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import trimesh
from build123d import (
    Axis,
    Box,
    Circle,
    Cylinder,
    Edge,
    Face,
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
    Wire,
    chamfer,
    export_stl,
    extrude,
    fillet,
    loft,
    mirror,
    offset,
    revolve,
)

from clawd import clawd_sketches

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Laptop:
    label: str
    thickness: float
    width: float
    depth: float
    weight: float  # kg


AIR13 = Laptop("MacBook Air 13 (M2-M5)", 11.3, 304.1, 215.0, 1.23)


@dataclass
class P:
    # fit (chosen on the gauge; see README)
    mac_t: float = 11.3
    c: float = 0.6  # total running clearance between the Mac and the pad liners
    liner_t: float = 2.0  # pad liner: Daiso 2 mm felt; a thin sliding tape works too (--liner)
    felt_t: float = 2.0  # V strips
    v_offset: float = 0.0  # moves both pad pairs in +y if the Mac seats off-centre
    pad_sag: float = 0.05  # the Mac's weight bends the web and closes each pad gap this much (FE)
    # frame: the V stands on a 4.9 mm web under its grit floor, stiff enough that the
    # Mac's weight closes each pad gap by only pad_sag (a 3.4 mm web let it close 0.1 mm)
    za: float = 3.6  # virtual apex of the 45 deg V
    zg: float = 6.1  # grit floor at the bottom of the V
    gw: float = 2.5  # grit floor half width
    # section family: constant middle, smootherstep transition, constant horn
    x_mid: float = 42.0
    x_horn: float = 80.0
    x_end: float = 100.0
    h_mid: float = 24.0
    h_horn: float = 60.0
    yt_horn: float = 69.0  # toe tip half width at the horns (the stance)
    y_crest: float = 18.5  # outer corner of the crest
    r_crest: float = 2.5
    y_mouth: float = 15.5  # the trumpet mouth is +-15.5 at every x
    gap_mid: float = 6.35  # air gap from the Mac to the relief walls in the middle ...
    gap_horn: float = 2.1  # ... and at the horns
    kt_mid: float = 5.0  # trumpet height
    kt_horn: float = 6.7
    end_lean: float = 7.0  # end faces lean inward, so each peak tapers to a trapezoid
    end_chamfer: float = 1.5
    r_plan: float = 6.0  # toe-tip plan corners
    # pad lands on the horn relief walls, 33 mm above the V contact
    land_x0: float = 78.5
    land_x1: float = 91.5  # clear of the leaning, chamfered end face
    land_z0: float = 38.3
    land_ramp: float = 3.0  # tangent ramps from the relief wall to the land face
    land_rim: float = 0.5  # a felt pad stands this far proud of its pocket rim
    # V felt pockets
    vfelt_w: float = 6.4
    vfelt_end: float = 96.0  # the V felt pockets stop short of the end chamfer
    vfelt_depth: float = 0.4
    felt_set: float = 0.3  # compression of the V felt under the Mac
    # feet: flat stick-on feet in pockets
    foot_x: float = 90.0
    foot_y: float = 61.0
    foot_dia: float = 12.0
    foot_h: float = 2.0
    foot_depth: float = 0.8
    # Clawd seal on the front 45 deg face
    logo_u: float = 1.75  # 28 x 17.5 mm, leaving a 3.3 mm margin on the 24.5 mm face
    badge_t: float = 3.0
    glow_t: float = 2.0  # glow brightness levels off at about 2 mm
    badge_clr: float = 0.15  # badge outline inside its pocket, per side
    pin_clr: float = 0.10  # badge eye holes over the eye pins, per side (45 deg pins print fat)
    push_d: float = 2.5  # push-out hole from below
    # cable fairleads in the rear toe and plug docks in the end face, at the port end
    cable_z: float = 8.0
    cable_turn_x: float = 88.0
    cable_turn_y: float = 76.0
    usb_y: float = 23.0
    mag_y: float = 32.0
    thr_usb: float = 4.2  # snap throats; a cable that will not go in can be scraped wider
    thr_mag: float = 3.0
    cable_ends: tuple = (1,)  # +x: the ports' end when the Apple logo faces the user

    def __post_init__(self):
        if 0 < self.liner_t - self.land_rim < 0.2:
            raise ValueError(f"liner {self.liner_t} mm: use at most {self.land_rim} (no pocket) or at least {self.land_rim + 0.2}")
        for sy in (1, -1):
            if self.land_rise(sy) < 0.3:
                raise ValueError(f"pad land {self.land_rise(sy):.2f} mm proud of the wall: reduce c, liner or v_offset")

    @property
    def zb(self) -> float:
        """Printed underside above the desk: the part of each foot outside its pocket."""
        return self.foot_h - self.foot_depth

    @property
    def yr_mid(self) -> float:
        return self.mac_t / 2 + self.gap_mid

    @property
    def yr_horn(self) -> float:
        return self.mac_t / 2 + self.gap_horn

    @property
    def liner_pocket(self) -> float:
        """Felt sits in a pocket with its face land_rim proud of the rim; a thin tape needs none."""
        return max(self.liner_t - self.land_rim, 0.0)

    @property
    def land_y(self) -> float:
        """Land face, with the liner surface at mac_t/2 + c/2 + pad_sag (before v_offset),
        so that c/2 is left on each side once the Mac's weight has bent the web."""
        return self.mac_t / 2 + self.c / 2 + self.pad_sag + self.liner_t - self.liner_pocket

    def land_face(self, sy: int) -> float:
        return self.land_y + sy * self.v_offset

    def land_rise(self, sy: int) -> float:
        return self.yr_horn - self.land_face(sy)

    @property
    def land_z1(self) -> float:
        """Top of the land face: its ramp ends where the trumpet starts."""
        return self.h_horn - self.kt_horn - self.land_ramp

    @property
    def felt_surface_apex(self) -> float:
        """Virtual apex of the two felt surfaces in the V."""
        return self.za + (self.felt_t - self.vfelt_depth) * math.sqrt(2)

    def seat_z(self, edge_r: float = 2.5) -> float:
        """Height of the Mac's hinge edge when its two corner rounds rest on the V felt
        (the felt compresses normal to the 45 deg flank)."""
        return self.mac_t / 2 - 2 * edge_r + self.felt_surface_apex + (edge_r - self.felt_set) * math.sqrt(2)

    @property
    def vfelt_up(self) -> float:
        """V felt pocket centre, measured up the flank from the virtual apex: 0.8 mm below
        where the corner rounds land, which puts the pocket top at the end of the flank."""
        y_contact = self.mac_t / 2 - 2.5 + 2.5 / math.sqrt(2)
        return (2 * y_contact + self.felt_surface_apex - self.za) / math.sqrt(2) - 0.8


# --------------------------------------------------------------------------
# section family S(x)
# --------------------------------------------------------------------------
def smooth(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * t * (t * (6 * t - 15) + 10)


def _dir(deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return math.cos(a), math.sin(a)


def section_pts(p: P, x: float) -> dict:
    """Right-half (y >= 0) control points of the section at station x. Every section
    parameter moves on the same smootherstep, so the ridge rises and the skirt spreads
    together and the body reads as one cast form."""
    s = smooth((abs(x) - p.x_mid) / (p.x_horn - p.x_mid))
    H = p.h_mid + (p.h_horn - p.h_mid) * s
    k = 3.0 - 2.4 * s  # 45 deg tuck under the toe: the float shadow line
    rt = 1.5 + 0.5 * s  # toe-tip round
    atab = 45.0 * (1 - s)  # toe tab slope
    ltab = 2.0 + 7.0 * s
    a0 = 45.0 - 25.0 * s  # flank slope at the foot ...
    a1 = 45.0 + 35.0 * s  # ... and at the crest: 45/45 in the middle, 20/80 (Fuji) at the horns
    yr = p.yr_mid + (p.yr_horn - p.yr_mid) * s
    kt = p.kt_mid + (p.kt_horn - p.kt_mid) * s
    # in the middle the toe tip is placed so that tab and flank form one straight 45 deg face
    band0 = 0.68
    yt0 = p.h_mid + p.y_crest + 1.5 - 1.5 * math.sqrt(2) - (p.zb + 3.0 + band0)
    yt = yt0 + (p.yt_horn - yt0) * s
    ze = p.zb + k + band0 + (4.2 - (p.zb + 0.6) - band0) * s

    c_tip = (yt - rt, ze)
    th_end = 90.0 - atab
    E = (c_tip[0] + rt * _dir(th_end)[0], c_tip[1] + rt * _dir(th_end)[1])
    tip_mid = (c_tip[0] + rt * _dir(th_end / 2)[0], c_tip[1] + rt * _dir(th_end / 2)[1])
    dt = _dir(180 - atab)
    T = (E[0] + ltab * dt[0], E[1] + ltab * dt[1])
    tl = p.r_crest * math.tan(math.radians(a1 / 2))
    d1 = _dir(180 - a1)
    C1 = (p.y_crest - tl * d1[0], H - tl * d1[1])
    C2 = (p.y_crest - tl, H)
    cc = (p.y_crest - tl, H - p.r_crest)
    cr_mid = (cc[0] + p.r_crest * _dir(90 - a1 / 2)[0], cc[1] + p.r_crest * _dir(90 - a1 / 2)[1])
    L = math.dist(T, C1)
    d0 = _dir(180 - a0)
    l0, l1 = L * (1 / 3 + 0.17 * s), L * (1 / 3 + 0.22 * s)
    Q1 = (T[0] + l0 * d0[0], T[1] + l0 * d0[1])
    Q2 = (C1[0] - l1 * d1[0], C1[1] - l1 * d1[1])
    return dict(
        s=s, H=H, yt=yt, bed=(yt - k, p.zb), tuck=(yt, p.zb + k), band=(yt, ze), tip_mid=tip_mid, E=E, T=T,
        Q1=Q1, Q2=Q2, C1=C1, cr_mid=cr_mid, C2=C2, M=(p.y_mouth, H), TR1=(yr, H), TR2=(yr, H - kt),
        V=(yr, p.za + yr), G=(p.gw, p.zg),
    )  # fmt: skip


def section_face(p: P, x: float) -> Face:
    """Closed 22-edge section at station x: bed, 45 deg tuck, toe band and round, tab,
    Bezier flank, crest round, crest flat, trumpet, relief wall, 45 deg V, grit floor.
    The topology never changes, which is what keeps the lofts well behaved."""
    q = section_pts(p, x)

    def pt(yz, sgn):
        return Vector(x, sgn * yz[0], yz[1])

    def side(sgn):
        return [
            Edge.make_line(pt(q["bed"], sgn), pt(q["tuck"], sgn)),
            Edge.make_line(pt(q["tuck"], sgn), pt(q["band"], sgn)),
            Edge.make_three_point_arc(pt(q["band"], sgn), pt(q["tip_mid"], sgn), pt(q["E"], sgn)),
            Edge.make_line(pt(q["E"], sgn), pt(q["T"], sgn)),
            Edge.make_bezier(pt(q["T"], sgn), pt(q["Q1"], sgn), pt(q["Q2"], sgn), pt(q["C1"], sgn)),
            Edge.make_three_point_arc(pt(q["C1"], sgn), pt(q["cr_mid"], sgn), pt(q["C2"], sgn)),
            Edge.make_line(pt(q["C2"], sgn), pt(q["M"], sgn)),
            Edge.make_bezier(pt(q["M"], sgn), pt(q["TR1"], sgn), pt(q["TR2"], sgn)),
            Edge.make_line(pt(q["TR2"], sgn), pt(q["V"], sgn)),
            Edge.make_line(pt(q["V"], sgn), pt(q["G"], sgn)),
        ]

    edges = [Edge.make_line(pt(q["bed"], -1), pt(q["bed"], 1))] + side(1)
    edges.append(Edge.make_line(pt(q["G"], 1), pt(q["G"], -1)))
    edges += list(reversed(side(-1)))
    return Face(Wire(edges))


def _ok(part: Part, name: str, solids: int = 1) -> Part:
    if not part.is_valid:
        raise RuntimeError(f"{name}: invalid solid")
    if len(part.solids()) != solids:
        raise RuntimeError(f"{name}: {len(part.solids())} separate solids, expected {solids}")
    return part


def _yz_face(x: float, pts: list, beziers: dict) -> Face:
    """Closed face in the plane x = const from (y, z) points; beziers maps a point index
    i to the two control points of a cubic from point i to point i + 1."""
    v = [Vector(x, y, z) for y, z in pts]
    edges = []
    for i in range(len(v)):
        a, b = v[i], v[(i + 1) % len(v)]
        if i in beziers:
            c1, c2 = (Vector(x, y, z) for y, z in beziers[i])
            edges.append(Edge.make_bezier(a, c1, c2, b))
        else:
            edges.append(Edge.make_line(a, b))
    return Face(Wire(edges))


# --------------------------------------------------------------------------
# body
# --------------------------------------------------------------------------
def make_shell(p: P) -> Part:
    """The lofted body without any features."""
    mid = extrude(section_face(p, -p.x_mid), 2 * p.x_mid)
    # 19 stations, closer at both ends, keep the skin within 0.01 mm of the section law;
    # with 10 the ridge sagged 0.4 mm just past x = 42 (check_fit measures this)
    fs = (0, 0.05, 0.10, 0.16, 0.22, 0.28, 0.34, 0.40, 0.46, 0.52, 0.58, 0.64, 0.70, 0.76, 0.82, 0.88, 0.93, 0.97, 1.0)
    stations = [p.x_mid + (p.x_horn - p.x_mid) * f for f in fs]
    body = mid
    for sx in (1, -1):
        body += loft([section_face(p, sx * xs) for xs in stations], ruled=False)
        horn = extrude(section_face(p, sx * p.x_horn), p.x_end - p.x_horn, dir=(sx, 0, 0))
        horn -= lean(p, sx) * (Pos(sx * (p.x_end + 100), 0, 0) * Box(200, 400, 400))
        end = horn.faces().sort_by(Axis.X)[-1 if sx > 0 else 0]
        # chamfer the end outline, before the plan cut; the plan corners round off the toe tips
        edges = [e for e in end.edges() if abs(e.center().Y) < p.yt_horn - 11]
        horn = chamfer(edges, p.end_chamfer)
        plan = Pos(sx * (p.x_end - 15), 0, 0) * RectangleRounded(30, 2 * p.yt_horn, p.r_plan)
        body += horn & extrude(plan, p.h_horn + 10)
    return body


def lean(p: P, sx: int) -> Pos:
    """Tilt about a line 2 mm under the bed at the x = sx * x_end end, by end_lean."""
    piv = Vector(sx * p.x_end, 0, p.zb - 2.0)
    return Pos(piv) * Rot(0, -sx * p.end_lean, 0) * Pos(-piv)


def seal_plane(p: P) -> Plane:
    """Centre of the flat 45 deg front face of the middle zone, normal pointing out."""
    q = section_pts(p, 0.0)
    cy, cz = (q["E"][0] + q["C1"][0]) / 2, (q["E"][1] + q["C1"][1]) / 2
    return Plane(origin=(0, -cy, cz), x_dir=(1, 0, 0), z_dir=Vector(0, -1, 1).normalized())


def fairlead_profile(p: P, r: float, throat: float, lead: float) -> Sketch:
    """Cable channel section: bore of radius r at cable_z with a 45 deg teardrop roof,
    a throat open to the underside that the cable snaps through, and a lead-in."""
    s2, zc, zb = math.sqrt(2), p.cable_z, p.zb
    # counter-clockwise, like the other pieces: a clockwise polygon extrudes the other way
    roof = Polygon((0, zc), (r / s2, zc + r / s2), (0, zc + r * s2), (-r / s2, zc + r / s2), align=None)
    neck = Pos(0, (zc + zb - 2) / 2) * Rectangle(throat, zc - (zb - 2))
    mouth = Polygon(
        (-lead / 2, zb - 2), (lead / 2, zb - 2), (lead / 2, zb), (throat / 2, zb + (lead - throat) / 2),
        (-throat / 2, zb + (lead - throat) / 2), (-lead / 2, zb), align=None,
    )  # fmt: skip
    return Sketch() + [Pos(0, zc) * Circle(r), roof, neck, mouth]


def cable_cutter(p: P, shell: Part) -> Part:
    """Bottom-loaded fairleads in the +x rear toe: a straight run from the end face,
    then a turn to the rear, wider than the cable's minimum bend radius. Where the rear
    skirt gets too thin over the roof, the channel opens into a vertical-walled gate
    instead of tearing through the skin at a slant. Plug docks in the end face hold
    each plug nose-out."""
    # y, bore radius, throat, lead-in, dock height, dock width: USB-C / Thunderbolt, then MagSafe 3
    channels = [(p.usb_y, 2.65, p.thr_usb, 6.2, 13.4, 7.8), (p.mag_y, 1.95, p.thr_mag, 5.0, 13.6, 4.9)]
    xt, yc = p.cable_turn_x, p.cable_turn_y
    axis = Axis((xt, yc, 0), (0, 0, 1))
    cut = None
    for y0, r, wt, wl, dh, dw in channels:
        prof = fairlead_profile(p, r, wt, wl)
        at_turn = Plane(origin=(xt, y0, 0), x_dir=(0, -1, 0), z_dir=(-1, 0, 0))
        pl = Plane(origin=(p.x_end + 3, y0, 0), x_dir=(0, -1, 0), z_dir=(-1, 0, 0))
        straight = extrude(pl * prof, p.x_end + 3 - xt)
        arc = revolve(at_turn * prof, axis, -90)
        # the gate starts a degree before the skin over the roof drops under 1.2 mm
        a0, roof, rad = 0.0, p.cable_z + r * math.sqrt(2) + 1.2, yc - y0
        while a0 < 89 and shell.is_inside(Vector(xt - rad * math.sin(math.radians(a0)), yc - rad * math.cos(math.radians(a0)), roof)):
            a0 += 0.5
        a0 = max(a0 - 1.0, 0.0)
        gate = Pos(xt, yc, 0) * Rot(0, 0, -a0) * Pos(-xt, -yc, 0) * (at_turn * (Pos(0, 14) * Rectangle(wl, 32)))
        dock = lean(p, 1) * (Pos(p.x_end, y0, p.cable_z - 0.6) * Box(4.0, dw, dh + 1.2))
        c = straight + arc + revolve(gate, axis, -(90 - a0)) + dock
        cut = c if cut is None else cut + c
    return cut


def land_solid(p: P, sx: int, sy: int) -> Part:
    """One pad land: a y-z profile rooted 0.6 mm inside the relief wall, with tangent
    ramps up to the land face and back, extruded along x. The Mac only ever slides past
    rounded ramps, never a crease."""
    w, f = section_pts(p, p.land_x0)["TR2"][0], p.land_face(sy)  # the wall, widest where the land starts
    z0, z1, r = p.land_z0, p.land_z1, p.land_ramp
    r0 = max(r, 2 * (w - f))  # the lower ramp overhangs: its steepest point is atan(2 rise / r0) <= 45 deg
    pts = [(w + 0.6, z0 - r0), (w, z0 - r0), (f, z0), (f, z1), (w, z1 + r), (w + 0.6, z1 + r)]
    ramps = {1: ((w, z0 - r0 / 2), (f, z0 - r0 / 2)), 3: ((f, z1 + r / 2), (w, z1 + r / 2))}
    face = _yz_face(p.land_x0, [(sy * y, z) for y, z in pts], {i: tuple((sy * y, z) for y, z in c) for i, c in ramps.items()})
    land = extrude(face, p.land_x1 - p.land_x0, dir=(1, 0, 0))
    return land if sx > 0 else mirror(land, Plane.YZ)


def pad_pocket(p: P, sx: int, sy: int) -> Part:
    """Felt pocket in a land face with a 45 deg ceiling, so nothing overhangs."""
    d, f = p.liner_pocket, p.land_face(sy)
    zb0, zt = p.land_z0 + 0.5, p.land_z1 - 0.5
    pts = [(f - 0.01, zb0), (f + d, zb0), (f + d, zt - d), (f - 0.01, zt + 0.01)]
    face = _yz_face(p.land_x0 + 1, [(sy * y, z) for y, z in pts], {})
    pocket = extrude(face, p.land_x1 - p.land_x0 - 2, dir=(1, 0, 0))
    return pocket if sx > 0 else mirror(pocket, Plane.YZ)


def push_hole(p: P, floor_centre: Vector, z_from: float) -> Part:
    """Vertical push-out hole from z_from up through the sloping floor of the seal pocket."""
    top = floor_centre.Z + p.push_d / 2 + 0.6  # clears the floor across the whole hole
    return Pos(0, floor_centre.Y, (z_from + top) / 2) * Cylinder(p.push_d / 2, top - z_from)


def make_body(p: P) -> Part:
    shell = make_shell(p)
    body = shell

    for sx in (1, -1):
        for sy in (1, -1):
            body += land_solid(p, sx, sy)
            if p.liner_pocket > 0:
                body -= pad_pocket(p, sx, sy)

    # felt pockets on both V flanks, closed short of the chamfered ends
    for sy in (1, -1):
        n, t = Vector(0, -sy, 1).normalized(), Vector(0, sy, 1).normalized()
        centre = Vector(0, 0, p.za) + t * p.vfelt_up
        body -= Plane(origin=centre, x_dir=(1, 0, 0), z_dir=n) * Box(2 * p.vfelt_end, p.vfelt_w, 2 * p.vfelt_depth)

    for sx in (1, -1):
        for sy in (1, -1):
            pocket_d = p.foot_dia + 0.4
            body -= Pos(sx * p.foot_x, sy * p.foot_y, p.zb + p.foot_depth / 2 - 0.01) * Cylinder(pocket_d / 2, p.foot_depth + 0.02)

    # Clawd seal: pocket, black eye pins that show through the badge, push-out hole. Both
    # are exact; the clearances are in the badge, a five-minute reprint.
    pl = seal_plane(p)
    outline, _, eyes = clawd_sketches(p.logo_u)
    body -= extrude(pl * outline, -p.badge_t)
    floor = pl.offset(-p.badge_t)
    body += extrude(floor * eyes, p.badge_t)
    body -= push_hole(p, floor.origin, p.zb - 1)

    cut = cable_cutter(p, shell)
    for sx in p.cable_ends:  # the other end keeps a clean Fuji section
        body -= cut if sx > 0 else mirror(cut, Plane.YZ)
    return _ok(body, "body")


# --------------------------------------------------------------------------
# badge and gauge
# --------------------------------------------------------------------------
def make_badge_parts(p: P) -> dict[str, Part]:
    """Badge in print orientation, face down: glow layers first, then white. The eye
    holes go through both, so the black PETG pins become the eyes. It carries both fit
    clearances, so a tight or loose badge is fixed by reprinting only the badge."""
    outline, _, eyes = clawd_sketches(p.logo_u)
    sk = offset(outline, -p.badge_clr, kind=Kind.INTERSECTION) - offset(eyes, p.pin_clr, kind=Kind.INTERSECTION)
    glow = extrude(sk, p.glow_t)
    white = Pos(0, 0, p.glow_t) * extrude(sk, p.badge_t - p.glow_t)
    return {"badge_glow": _ok(glow, "badge glow"), "badge_white": _ok(white, "badge white")}


def place_badge(p: P, part: Part) -> Part:
    """Move a badge part from print orientation into the seal pocket."""
    return seal_plane(p) * (Rot(0, 180, 0) * part)


GAUGE_C = (0.2, 0.4, 0.6, 0.8, 1.0)


def make_gauge(p: P) -> dict[str, Part]:
    """Fit test for what only a body reprint could fix, each piece in print orientation:
    - slice: 8 mm of the real horn, lying on its cut face, with the V, felt pockets and
      pad lands: stand the Mac's hinge edge in it
    - comb: five felt-lined slots, c = 0.2 / 0.4 / 0.6 / 0.8 / 1.0 (1-5 notches): slide it
      along the top edge of the standing Mac
    The badge fit is set in the badge itself and the cable throats can be scraped wider,
    so neither needs a test piece."""
    out = {}
    body = make_body(p)
    xs = (p.land_x0 + p.land_x1) / 2
    s = body & Pos(xs, 0, 40) * Box(8, 36, 90)
    s = Rot(0, -90, 0) * s  # the inner cut face goes down
    out["slice"] = to_bed(s)

    # comb: slots open at the top and both ends, so it slides along the edge of the
    # standing Mac; felt goes into open-topped pockets in the slot walls
    w_max = p.mac_t + max(GAUGE_C) + 2 * (p.liner_t - p.liner_pocket)
    pitch = w_max + 2 * p.liner_pocket + 4.0
    floor, top = 2.5, 12.5
    comb = Pos(0, 0, top / 2) * Box(len(GAUGE_C) * pitch + 4, 22, top)
    for i, c in enumerate(GAUGE_C):
        w = p.mac_t + c + 2 * (p.liner_t - p.liner_pocket)  # bare land-to-land width
        x = (i - (len(GAUGE_C) - 1) / 2) * pitch
        comb -= Pos(x, 0, (floor + top + 0.01) / 2) * Box(w, 22.02, top - floor + 0.01)
        if p.liner_pocket > 0:
            for sy in (1, -1):
                comb -= Pos(x + sy * (w / 2 + p.liner_pocket / 2), 0, (floor + 1 + top + 0.01) / 2) * Box(
                    p.liner_pocket, 20, top - floor - 1 + 0.01
                )
        for k in range(i + 1):  # 1-5 tally notches in the front of the floor, under the slot
            comb -= Pos(x + 2.0 * (k - i / 2), -11, floor / 2) * Box(1.0, 2.0, 1.4)
    out["comb"] = comb

    return out


# --------------------------------------------------------------------------
# liners, feet and a Mac stand-in (checks and renders)
# --------------------------------------------------------------------------
def pad_size(p: P) -> tuple[float, float]:
    """Pad liner to cut (x by z): fits the pocket's short back edge with 0.3 mm to spare."""
    h = p.land_z1 - p.land_z0 - 1 - p.liner_pocket - 0.3 if p.liner_pocket > 0 else p.land_z1 - p.land_z0 - 1
    return p.land_x1 - p.land_x0 - 2.5, h


def liners(p: P) -> dict[str, Part]:
    """The felt as the README says to cut it: two V strips and four pads."""
    out = {}
    for sy in (1, -1):
        n, t = Vector(0, -sy, 1).normalized(), Vector(0, sy, 1).normalized()
        thick = p.felt_t - p.felt_set
        centre = Vector(0, 0, p.za) + t * p.vfelt_up + n * (thick / 2 - p.vfelt_depth)
        box = Box(2 * p.vfelt_end - 0.4, p.vfelt_w - 0.4, thick)
        out[f"felt_v{'r' if sy > 0 else 'l'}"] = Plane(origin=centre, x_dir=(1, 0, 0), z_dir=n) * box
    xc = (p.land_x0 + p.land_x1) / 2
    px, pz = pad_size(p)
    zc = p.land_z0 + 0.5 + 0.15 + pz / 2
    for sx in (1, -1):
        for sy in (1, -1):
            y = sy * (p.land_face(sy) + p.liner_pocket - p.liner_t / 2)
            out[f"pad_{'r' if sx > 0 else 'l'}{'b' if sy > 0 else 'f'}"] = Pos(sx * xc, y, zc) * Box(px, p.liner_t, pz)
    return out


def make_foot(p: P) -> Part:
    """Flat stick-on foot, top face at z = 0."""
    foot = Pos(0, 0, -p.foot_h / 2) * Cylinder(p.foot_dia / 2, p.foot_h)
    return fillet(foot.edges().group_by(Axis.Z)[0], 0.5)


def make_laptop(lp: Laptop, edge_r: float = 2.5, r_plan: float = 13.0) -> Part:
    body = extrude(RectangleRounded(lp.width, lp.depth, r_plan), lp.thickness)
    body = fillet(body.edges().group_by(Axis.Z)[0], edge_r)
    body = fillet(body.edges().group_by(Axis.Z)[-1], edge_r)
    ring = extrude(RectangleRounded(lp.width + 2, lp.depth + 2, r_plan + 1), 0.35) - extrude(
        RectangleRounded(lp.width - 0.6, lp.depth - 0.6, r_plan - 0.3), 0.35
    )
    return body - Pos(0, 0, lp.thickness * 0.68) * ring


def mac_for(p: P) -> Laptop:
    """The Air 13 at the thickness the dock was built for (--mac-t)."""
    return replace(AIR13, thickness=p.mac_t)


def place_laptop(p: P, lp: Laptop, part: Part, edge_r: float = 2.5) -> Part:
    """Stand the Mac hinge-down in the V, lid towards the user."""
    return Pos(0, 0, p.seat_z(edge_r)) * Rot(90, 0, 0) * Pos(0, lp.depth / 2, -lp.thickness / 2) * part


# --------------------------------------------------------------------------
# reports
# --------------------------------------------------------------------------
def stability(p: P, lp: Laptop, dock_kg: float, dock_cg_z: float) -> dict:
    """Tipping across the slot, pushed at the Mac's top edge. Flat rubber feet press
    evenly, so the far feet lift once the moment reaches their centres (y = foot_y); the
    dock only falls after rocking onto the near feet's outer edges. The Mac first leans
    through its pad gap and the pad felt, which moves its weight toward the pivot.
    Also: the tilt and the earthquake acceleration that lift the feet, and the sideways
    pull at the fairlead height that would tip the dock."""
    g, m, z0 = 9.81, lp.weight + dock_kg, p.seat_z()
    top = z0 + lp.depth
    cg = (lp.weight * (z0 + lp.depth / 2) + dock_kg * dock_cg_z) / m
    lean = (p.c / 2 + p.felt_set) / ((p.land_z0 + p.land_z1) / 2 - z0)  # rad, pivoting in the V
    lost = lp.weight * g * lean * lp.depth / 2 / top
    b0, b1 = p.foot_y, p.foot_y + p.foot_dia / 2 - 0.5
    return {
        "liftoff_N": round(m * g * b0 / top - lost, 2),
        "tipover_N": round(m * g * b1 / top - lost, 2),
        "tilt_deg": round(math.degrees(math.atan(b0 / cg)), 1),
        "quake_g": round(b0 / cg, 2),
        "cable_pull_N": round(m * g * b0 / p.cable_z),
    }


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------
def stl_mesh(part: Part, path: Path, tol: float) -> trimesh.Trimesh:
    """Export an STL and read it back as a merged mesh; refuse leaky meshes."""
    export_stl(part, str(path), tolerance=tol, angular_tolerance=0.15)
    m = trimesh.load(path)
    if not (m.is_watertight and m.is_winding_consistent and m.volume > 0):
        raise RuntimeError(f"{path.name}: mesh is not a closed solid")
    return m


@dataclass
class Obj3mf:
    name: str
    parts: list  # [(part name, mesh, extruder or None)]
    at: tuple  # (x, y) on the 256 mm plate
    settings: dict  # Bambu Studio process settings for this object


def write_3mf(path: Path, title: str, objects: list[Obj3mf]) -> None:
    """3MF core file plus Bambu Studio's Metadata/model_settings.config, which Bambu
    Studio and OrcaSlicer also read from other programs' files: per-object process
    settings (walls, infill) and a filament per part. An object with several parts
    loads as one object; PrusaSlicer ignores the settings and splits such an object."""
    res, build, cfg, oid = [], [], [], 1
    for ob in objects:
        ids = []
        for pname, mesh, _ in ob.parts:
            v = "".join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in mesh.vertices)
            t = "".join(f'<triangle v1="{i}" v2="{j}" v3="{k}"/>' for i, j, k in mesh.faces)
            res.append(f'<object id="{oid}" type="model" name="{pname}"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>')
            ids.append(oid)
            oid += 1
        top = ids[0]
        if len(ids) > 1:
            comps = "".join(f'<component objectid="{i}"/>' for i in ids)
            res.append(f'<object id="{oid}" type="model" name="{ob.name}"><components>{comps}</components></object>')
            top = oid
            oid += 1
        build.append(f'<item objectid="{top}" transform="1 0 0 0 1 0 0 0 1 {ob.at[0]:.3f} {ob.at[1]:.3f} 0"/>')
        meta = "".join(f'<metadata key="{k}" value="{v}"/>' for k, v in {"name": ob.name, **ob.settings}.items())
        parts = ""
        for i, (pname, _, extruder) in zip(ids, ob.parts):
            ex = f'<metadata key="extruder" value="{extruder}"/>' if extruder else ""
            parts += f'<part id="{i}" subtype="normal_part"><metadata key="name" value="{pname}"/>{ex}</part>'
        cfg.append(f'<object id="{top}">{meta}{parts}</object>')
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        f'<metadata name="Title">{title}</metadata>'
        '<metadata name="Designer">Claude Code Clamshell Dock</metadata>'
        f"<resources>{''.join(res)}</resources><build>{''.join(build)}</build></model>"
    )
    settings = '<?xml version="1.0" encoding="UTF-8"?>\n<config>' + "".join(cfg) + "</config>"
    types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '<Default Extension="config" ContentType="text/xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
    )
    files = (("[Content_Types].xml", types), ("_rels/.rels", rels), ("3D/3dmodel.model", model), ("Metadata/model_settings.config", settings))
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))  # fixed stamp: rebuilds give identical files
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)


def to_bed(part: Part) -> Part:
    """Drop a part so its lowest point is on the print bed."""
    return Pos(0, 0, -part.bounding_box().min.Z) * part


# seams at the back: on the rear faces and inside the slot, away from the viewer
PETG_SETTINGS = {"wall_loops": "5", "sparse_infill_density": "20%", "sparse_infill_pattern": "gyroid", "seam_position": "back"}
# the body also gets 0.16 mm layers: finer terraces on the shallow skirts, about 1.2 h longer
BODY_SETTINGS = {**PETG_SETTINGS, "layer_height": "0.16"}
GAUGE_LAYOUT = {"slice": (128, 160), "comb": (128, 80)}  # plate positions of the gauge pieces


def build(p: P, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        body = stl_mesh(to_bed(make_body(p)), tmp / "body.stl", 0.02)
        badge = {k: stl_mesh(v, tmp / f"{k}.stl", 0.01) for k, v in make_badge_parts(p).items()}
        gauge = {k: stl_mesh(Pos(-v.center().X, -v.center().Y, 0) * v, tmp / f"{k}.stl", 0.02) for k, v in make_gauge(p).items()}
    write_3mf(out / "1_body_PETG.3mf", "TOGE dock body", [Obj3mf("TOGE body", [("body", body, None)], (128, 128), BODY_SETTINGS)])
    write_3mf(
        out / "2_clawd_badge.3mf",
        "Clawd badge",
        [Obj3mf("Clawd badge", [("badge_glow", badge["badge_glow"], 1), ("badge_white", badge["badge_white"], 2)], (128, 128),
                {"sparse_infill_density": "100%"})],
    )  # fmt: skip
    write_3mf(
        out / "0_fit_gauge_PETG.3mf",
        "TOGE fit gauge",
        [Obj3mf(f"gauge_{k}", [(k, m, None)], GAUGE_LAYOUT[k], PETG_SETTINGS) for k, m in gauge.items()],
    )
    gap = p.mac_t + p.c
    print(f"{gap + 2 * p.pad_sag:.2f} mm between the pad liners ({gap:.2f} under the Mac), body {body.volume / 1000:.1f} cm3, wrote {out}")


def export_assembly(p: P, out: Path) -> None:
    """Placed meshes for renders plus a manifest the Blender script reads, and the
    parameters the drawing uses."""
    out.mkdir(parents=True, exist_ok=True)
    badge = make_badge_parts(p)
    items = [("body", make_body(p), "petg")]
    items += [("badge_glow", place_badge(p, badge["badge_glow"]), "glow"), ("badge_white", place_badge(p, badge["badge_white"]), "white")]
    items += [(name, part, "felt") for name, part in liners(p).items()]
    feet = [(sx * p.foot_x, sy * p.foot_y) for sx in (1, -1) for sy in (1, -1)]
    items += [(f"foot_{i}", Pos(x, y, p.zb + p.foot_depth) * make_foot(p), "rubber") for i, (x, y) in enumerate(feet)]
    for set_name, with_laptop in (("assembled", True), ("dock", False)):
        manifest = []
        extra = [("laptop", place_laptop(p, mac_for(p), make_laptop(mac_for(p))), "laptop")] if with_laptop else []
        for name, part, mat in items + extra:
            fn = out / f"{set_name}__{name}.stl"
            export_stl(part, str(fn), tolerance=0.02, angular_tolerance=0.08)  # fine enough to show real creases
            manifest.append({"file": fn.name, "material": mat})
        (out / f"{set_name}.json").write_text(json.dumps(manifest, indent=1))
    (out / "params.json").write_text(json.dumps(asdict(p), indent=1))


def add_p_args(ap: argparse.ArgumentParser) -> None:
    """The fit parameters the owner may change after printing the gauge."""
    ap.add_argument("--c", type=float, default=0.6, help="running clearance picked on the gauge comb, mm")
    ap.add_argument("--liner", type=float, default=2.0, help="pad liner thickness: 2.0 felt, or a thin sliding tape")
    ap.add_argument("--v-offset", type=float, default=0.0, help="shift of the pads in y, from the gauge slice")
    ap.add_argument("--mac-t", type=float, default=11.3, help="measured Mac thickness (add a case if you use one)")
    ap.add_argument("--pin-clr", type=float, default=0.10, help="badge eye holes over the pins: larger if tight (reprint the badge)")
    ap.add_argument("--badge-clr", type=float, default=0.15, help="badge outline in its pocket: larger if tight (reprint the badge)")
    ap.add_argument("--thr-usb", type=float, default=4.2, help="USB-C snap throat, mm")
    ap.add_argument("--thr-mag", type=float, default=3.0, help="MagSafe snap throat, mm")
    ap.add_argument("--cables", choices=("right", "left", "both"), default="right",
                    help="end with the cable channels and plug docks: right (+x) when the Apple logo faces you")


def p_from_args(a: argparse.Namespace) -> P:
    ends = {"right": (1,), "left": (-1,), "both": (1, -1)}[a.cables]
    return P(mac_t=a.mac_t, c=a.c, liner_t=a.liner, v_offset=a.v_offset, pin_clr=a.pin_clr, badge_clr=a.badge_clr,
             thr_usb=a.thr_usb, thr_mag=a.thr_mag, cable_ends=ends)  # fmt: skip


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_p_args(ap)
    ap.add_argument("--out", default=str(ROOT / "print"), help="folder for the 3MF files")
    ap.add_argument("--assembly", metavar="DIR", help="only write placed meshes for renders into DIR")
    a = ap.parse_args()
    p = p_from_args(a)
    if a.assembly:
        export_assembly(p, Path(a.assembly))
        return
    build(p, Path(a.out))


if __name__ == "__main__":
    main()
