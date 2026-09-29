"""TOGE (峠) - Claude Code clamshell dock, parametric model (build123d).

A vertical dock for a MacBook Air 13 (M2-M5) used lid-closed, printed on a
Bambu Lab P2S. One black PETG body shaped like a mountain pass: a low middle
where the Mac's hot hinge edge stays in open air, and two Fuji-profile peaks at
the ends that hold it. The Mac stands hinge-down in a felt-lined 90 deg V.

Printed parts
  body    black PETG, upright, no supports                    1_body_PETG.3mf
  badge   Clawd seal: 2 mm glow PLA face + 1 mm white PLA     2_clawd_badge.3mf
  gauge   optional fit test: horn slice, slot comb, seal      0_fit_gauge_PETG.3mf
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
from dataclasses import dataclass
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
    liner_t: float = 2.0  # pad liner: Daiso 2 mm felt (0.7 for velvet/flock sheet)
    felt_t: float = 2.0  # V strips
    v_offset: float = 0.0  # moves both pad pairs in y if the Mac seats off-centre
    # frame
    zb: float = 1.2  # printed underside above the desk (foot protrusion)
    za: float = 2.1  # virtual apex of the 45 deg V
    zg: float = 4.6  # grit floor at the bottom of the V
    gw: float = 2.5  # grit floor half width
    # section family: constant middle, smootherstep transition, constant horn
    x_mid: float = 42.0
    x_horn: float = 80.0
    x_end: float = 100.0
    h_mid: float = 24.0
    h_horn: float = 66.0
    yt_horn: float = 69.0  # toe tip half width at the horns (the stance)
    y_crest: float = 18.5  # outer corner of the crest
    r_crest: float = 2.5
    y_mouth: float = 15.5  # the trumpet mouth is +-15.5 at every x
    yr_mid: float = 12.0  # relief walls: 6.35 mm air gap in the middle ...
    yr_horn: float = 7.75  # ... 2.1 mm at the horns
    kt_mid: float = 5.0  # trumpet height
    kt_horn: float = 6.7
    end_chamfer: float = 1.0
    r_plan: float = 6.0  # toe-tip plan corners
    # pad lands, one per face of each horn, 43 mm above the V contact
    land_x0: float = 82.0
    land_x1: float = 98.0
    land_z0: float = 46.0
    land_z1: float = 58.0
    land_rim: float = 0.5  # the land rim sits this far below the liner surface
    # V felt pockets
    vfelt_w: float = 6.4
    vfelt_depth: float = 0.4
    vfelt_up: float = 7.6  # pocket centre, measured up the flank from the virtual apex
    felt_set: float = 0.3  # compression of the V felt under the Mac
    # feet: flat 12 x 2 mm stick-on feet in 0.8 mm pockets
    foot_x: float = 90.0
    foot_y: float = 61.0
    foot_d: float = 12.4
    foot_depth: float = 0.8
    # Clawd seal on the front 45 deg face
    logo_u: float = 2.0
    badge_t: float = 3.0
    glow_t: float = 2.0  # glow brightness levels off at about 2 mm
    badge_clr: float = 0.15  # pocket over the badge, per side
    pin_clr: float = 0.05  # eye pins under the badge's eye holes, per side
    push_d: float = 2.5  # push-out hole from below
    # cable fairleads (rear toes, both ends) and plug docks in the end faces
    cable_z: float = 8.0
    cable_turn_x: float = 88.0
    cable_turn_y: float = 76.0

    @property
    def land_y(self) -> float:
        """Land face: liner surface = mac_t/2 + c/2, and the rim sits land_rim behind it."""
        return self.mac_t / 2 + self.c / 2 + self.land_rim

    @property
    def liner_pocket(self) -> float:
        return self.liner_t - self.land_rim

    @property
    def felt_surface_apex(self) -> float:
        """Virtual apex of the two felt surfaces in the V."""
        return self.za + (self.felt_t - self.vfelt_depth) * math.sqrt(2)

    def seat_z(self, edge_r: float = 2.5) -> float:
        """Height of the Mac's hinge edge when its two corner rounds rest on the V felt."""
        return self.mac_t / 2 - 2 * edge_r + self.felt_surface_apex + edge_r * math.sqrt(2) - self.felt_set


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
    if s < 1e-9:
        ze = H + p.y_crest - yt + rt - rt * math.sqrt(2)

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


def _ok(part: Part, name: str) -> Part:
    if not part.is_valid:
        raise RuntimeError(f"{name}: invalid solid")
    return part


# --------------------------------------------------------------------------
# body
# --------------------------------------------------------------------------
def make_shell(p: P) -> Part:
    """The lofted body without any features."""
    mid = extrude(section_face(p, -p.x_mid), 2 * p.x_mid)
    stations = [p.x_mid + (p.x_horn - p.x_mid) * f for f in (0, 0.16, 0.32, 0.46, 0.58, 0.69, 0.79, 0.88, 0.95, 1.0)]
    body = mid
    for sx in (1, -1):
        body += loft([section_face(p, sx * xs) for xs in stations], ruled=False)
        horn = extrude(section_face(p, sx * p.x_horn), p.x_end - p.x_horn, dir=(sx, 0, 0))
        end = horn.faces().sort_by(Axis.X)[-1 if sx > 0 else 0]
        horn = chamfer(end.edges(), p.end_chamfer)  # before the plan cut, as the outline only
        plan = Pos(sx * (p.x_end - 15), 0, 0) * RectangleRounded(30, 2 * p.yt_horn, p.r_plan)
        body += horn & extrude(plan, p.h_horn + 10)
    return body


def seal_plane(p: P) -> Plane:
    """Centre of the flat 45 deg front face of the middle zone, normal pointing out."""
    q = section_pts(p, 0.0)
    cy, cz = (q["E"][0] + q["C1"][0]) / 2, (q["E"][1] + q["C1"][1]) / 2
    return Plane(origin=(0, -cy, cz), x_dir=(1, 0, 0), z_dir=Vector(0, -1, 1).normalized())


def cable_cutter(p: P) -> Part:
    """Bottom-loaded fairleads in the +x rear toe: a straight run from the end face,
    then a turn to the rear at the cable's minimum bend radius. The roof is a 45 deg
    teardrop, so nothing bridges. Plug docks in the end face hold each plug nose-out."""

    def profile(r, zc, wt, wl):
        s2 = math.sqrt(2)
        # counter-clockwise, like the other pieces: a clockwise polygon extrudes the other way
        roof = Polygon((0, zc), (r / s2, zc + r / s2), (0, zc + r * s2), (-r / s2, zc + r / s2), align=None)
        throat = Pos(0, (zc + p.zb - 2) / 2) * Rectangle(wt, zc - (p.zb - 2))
        lead = Polygon(
            (-wl / 2, p.zb - 2), (wl / 2, p.zb - 2), (wl / 2, p.zb), (wt / 2, p.zb + (wl - wt) / 2),
            (-wt / 2, p.zb + (wl - wt) / 2), (-wl / 2, p.zb), align=None,
        )  # fmt: skip
        return Sketch() + [Pos(0, zc) * Circle(r), roof, throat, lead]

    # y, bore radius, throat, lead-in, dock height, dock width: USB-C / Thunderbolt, then MagSafe 3
    channels = [(28.0, 2.65, 4.2, 6.2, 13.4, 7.8), (36.0, 1.95, 3.0, 5.0, 13.6, 4.9)]
    zc, xt, yc = p.cable_z, p.cable_turn_x, p.cable_turn_y
    cut = None
    for y0, r, wt, wl, dh, dw in channels:
        prof = profile(r, zc, wt, wl)
        pl = Plane(origin=(p.x_end + 3, y0, 0), x_dir=(0, -1, 0), z_dir=(-1, 0, 0))
        straight = extrude(pl * prof, p.x_end + 3 - xt)
        arc = revolve(Plane(origin=(xt, y0, 0), x_dir=(0, -1, 0), z_dir=(-1, 0, 0)) * prof, Axis((xt, yc, 0), (0, 0, 1)), -90)
        dock = Pos(p.x_end, y0, zc - 0.6) * Box(4.0, dw, dh + 1.2)
        c = straight + arc + dock
        cut = c if cut is None else cut + c
    return cut


def make_body(p: P) -> Part:
    body = make_shell(p)

    # pad lands: 45 deg frustums on the relief walls, with liner pockets
    xc, zc = (p.land_x0 + p.land_x1) / 2, (p.land_z0 + p.land_z1) / 2
    lx, lz = p.land_x1 - p.land_x0, p.land_z1 - p.land_z0
    rise = p.yr_horn - p.land_y
    for sx in (1, -1):
        for sy in (1, -1):
            pl = Plane(origin=(sx * xc, sy * p.yr_horn + p.v_offset, zc), x_dir=(1, 0, 0), z_dir=(0, -sy, 0))
            base = Rectangle(lx + 2 * rise, lz + 2 * rise)
            body += extrude(pl * base, rise, taper=45) + extrude(pl * base, -0.6)
            face_y = sy * p.land_y + p.v_offset
            body -= Pos(sx * xc, face_y + sy * p.liner_pocket / 2, zc) * Box(lx - 2, p.liner_pocket, lz - 1)

    # felt pockets on both V flanks, closed 2 mm short of the ends
    for sy in (1, -1):
        n, t = Vector(0, -sy, 1).normalized(), Vector(0, sy, 1).normalized()
        centre = Vector(0, 0, p.za) + t * p.vfelt_up
        body -= Plane(origin=centre, x_dir=(1, 0, 0), z_dir=n) * Box(2 * p.x_end - 4, p.vfelt_w, 2 * p.vfelt_depth)

    for sx in (1, -1):
        for sy in (1, -1):
            body -= Pos(sx * p.foot_x, sy * p.foot_y, p.zb + p.foot_depth / 2 - 0.01) * Cylinder(p.foot_d / 2, p.foot_depth + 0.02)

    # Clawd seal: pocket, black eye pins that show through the badge, push-out hole
    pl = seal_plane(p)
    outline, _, eyes = clawd_sketches(p.logo_u)
    body -= extrude(pl * offset(outline, p.badge_clr, kind=Kind.INTERSECTION), -p.badge_t)
    floor = pl.offset(-p.badge_t)
    body += extrude(floor * offset(eyes, -p.pin_clr, kind=Kind.INTERSECTION), p.badge_t)
    fc = floor.origin
    body -= Pos(0, fc.Y, (p.zb - 1 + fc.Z + 0.6) / 2) * Cylinder(p.push_d / 2, fc.Z + 0.6 - (p.zb - 1))

    cut = cable_cutter(p)
    body -= cut + mirror(cut, Plane.YZ)
    return _ok(body, "body")


# --------------------------------------------------------------------------
# badge and gauge
# --------------------------------------------------------------------------
def make_badge_parts(p: P) -> dict[str, Part]:
    """Badge in print orientation, face down: glow layers first, then white. The eye
    holes go through both, so the black PETG pins become the eyes."""
    _, body_sk, _ = clawd_sketches(p.logo_u)
    glow = extrude(body_sk, p.glow_t)
    white = Pos(0, 0, p.glow_t) * extrude(body_sk, p.badge_t - p.glow_t)
    return {"badge_glow": _ok(glow, "badge glow"), "badge_white": _ok(white, "badge white")}


def place_badge(p: P, part: Part) -> Part:
    """Move a badge part from print orientation into the seal pocket."""
    return seal_plane(p) * (Rot(0, 180, 0) * part)


def make_gauge(p: P) -> Part:
    """Fit test on one flat plate, about 45 min:
    - a 10 mm slice of the real horn section, lying on its end face, with the V, the
      felt pockets and the pad lands: stand the Mac's hinge edge in it
    - a comb of five pad slots, c = 0.2 / 0.4 / 0.6 / 0.8 / 1.0 (1-5 notches)
    - a 45 deg wedge with the real seal pocket and eye pins for the badge fit"""
    q = p.x_horn + 5
    zc = (p.land_z0 + p.land_z1) / 2
    s = extrude(section_face(p, p.x_horn), 10, dir=(1, 0, 0)) & Pos(q, 0, 40) * Box(10, 34, 80)
    rise = p.yr_horn - p.land_y
    for sy in (1, -1):
        pl = Plane(origin=(q, sy * p.yr_horn + p.v_offset, zc), x_dir=(1, 0, 0), z_dir=(0, -sy, 0))
        base = Rectangle(10.0, p.land_z1 - p.land_z0 + 2 * rise)
        s += extrude(pl * base, rise, taper=45) + extrude(pl * base, -0.6)
        s -= Pos(q, sy * (p.land_y + p.liner_pocket / 2) + p.v_offset, zc) * Box(12, p.liner_pocket, p.land_z1 - p.land_z0 - 1)
        n, t = Vector(0, -sy, 1).normalized(), Vector(0, sy, 1).normalized()
        s -= Plane(origin=Vector(q, 0, p.za) + t * p.vfelt_up, x_dir=(1, 0, 0), z_dir=n) * Box(12, p.vfelt_w, 2 * p.vfelt_depth)
    s += Pos(q, 0, p.zb + 1.5) * Box(10, 40, 3)
    s = Rot(0, -90, 0) * Pos(-p.x_horn, 0, 0) * s
    bb = s.bounding_box()
    slice_ = Pos(-bb.min.X - 70, 0, -bb.min.Z) * s

    comb = Pos(0, 0, 4) * Box(66, 30, 8)
    for i, c in enumerate((0.2, 0.4, 0.6, 0.8, 1.0)):
        w = p.mac_t + c + 2 * p.land_rim  # bare land-to-land width
        x = -26 + i * 13
        comb -= Pos(x, 6, 4.5) * Box(w, 18.01, 8)
        for sy in (1, -1):
            comb -= Pos(x + sy * (w / 2 + p.liner_pocket / 2), 7, 4.5) * Box(p.liner_pocket, 11, 6)
        for k in range(i + 1):
            comb -= Pos(x - 2.4 + 1.2 * k, -13.5, 8) * Box(0.6, 3, 1.2)
    comb = Pos(20, 45, 0) * comb

    # seal coupon: a 45 deg wedge carrying the real pocket and pins
    wedge = extrude(Plane.YZ * Polygon((-14, 1), (14, 1), (14, 29), align=None), 21, both=True)
    wedge += Pos(0, 0, 0.5) * Box(42, 28, 1)
    pl = Plane(origin=(0, 0, 15), x_dir=(1, 0, 0), z_dir=Vector(0, -1, 1).normalized())
    outline, _, eyes = clawd_sketches(p.logo_u)
    wedge -= extrude(pl * offset(outline, p.badge_clr, kind=Kind.INTERSECTION), -p.badge_t)
    wedge += extrude(pl.offset(-p.badge_t) * offset(eyes, -p.pin_clr, kind=Kind.INTERSECTION), p.badge_t)
    coupon = Pos(20, -35, 0) * wedge
    return _ok(slice_ + comb + coupon, "gauge")


# --------------------------------------------------------------------------
# liners, feet and a Mac stand-in (checks and renders)
# --------------------------------------------------------------------------
def liners(p: P) -> dict[str, Part]:
    """The felt as the README says to cut it: two 6 x 196 mm V strips and four pads."""
    out = {}
    for sy in (1, -1):
        n, t = Vector(0, -sy, 1).normalized(), Vector(0, sy, 1).normalized()
        thick = p.felt_t - p.felt_set
        centre = Vector(0, 0, p.za) + t * p.vfelt_up + n * (thick / 2 - p.vfelt_depth)
        box = Box(2 * p.x_end - 4.4, p.vfelt_w - 0.4, thick)
        out[f"felt_v{'r' if sy > 0 else 'l'}"] = Plane(origin=centre, x_dir=(1, 0, 0), z_dir=n) * box
    xc, zc = (p.land_x0 + p.land_x1) / 2, (p.land_z0 + p.land_z1) / 2
    for sx in (1, -1):
        for sy in (1, -1):
            y = sy * (p.land_y + p.liner_pocket - p.liner_t / 2) + p.v_offset
            pad = Box(p.land_x1 - p.land_x0 - 2.4, p.liner_t, p.land_z1 - p.land_z0 - 1.4)
            out[f"pad_{'r' if sx > 0 else 'l'}{'b' if sy > 0 else 'f'}"] = Pos(sx * xc, y, zc) * pad
    return out


def make_foot(p: P) -> Part:
    """Flat 12 x 2 mm stick-on foot, top at z = 2."""
    foot = Pos(0, 0, 1.0) * Cylinder(6.0, 2.0)
    return fillet(foot.edges().group_by(Axis.Z)[0], 0.5)


def make_laptop(lp: Laptop, edge_r: float = 2.5, r_plan: float = 13.0) -> Part:
    body = extrude(RectangleRounded(lp.width, lp.depth, r_plan), lp.thickness)
    body = fillet(body.edges().group_by(Axis.Z)[0], edge_r)
    body = fillet(body.edges().group_by(Axis.Z)[-1], edge_r)
    ring = extrude(RectangleRounded(lp.width + 2, lp.depth + 2, r_plan + 1), 0.35) - extrude(
        RectangleRounded(lp.width - 0.6, lp.depth - 0.6, r_plan - 0.3), 0.35
    )
    return body - Pos(0, 0, lp.thickness * 0.68) * ring


def place_laptop(p: P, lp: Laptop, part: Part, edge_r: float = 2.5) -> Part:
    """Stand the Mac hinge-down in the V, lid towards the user."""
    return Pos(0, 0, p.seat_z(edge_r)) * Rot(90, 0, 0) * Pos(0, lp.depth / 2, -lp.thickness / 2) * part


# --------------------------------------------------------------------------
# reports
# --------------------------------------------------------------------------
def stability(p: P, lp: Laptop, dock_kg: float, dock_cg_z: float) -> dict:
    """Push at the Mac's top edge that starts tipping the dock across the slot, the
    static tip angle, and the tip force for a sideways pull at the fairlead height.
    The pivot is the outer edge of the feet (12 mm feet, 0.5 mm edge round)."""
    b = p.foot_y + 6.0 - 0.5
    m = lp.weight + dock_kg
    z0 = p.seat_z()
    cg = (lp.weight * (z0 + lp.depth / 2) + dock_kg * dock_cg_z) / m
    return {
        "pivot_mm": round(b, 1),
        "tip_angle_deg": round(math.degrees(math.atan(b / cg)), 1),
        "push_at_top_N": round(m * 9.81 * b / (z0 + lp.depth), 2),
        "cable_pull_to_tip_N": round(m * 9.81 * b / p.cable_z),
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


def write_3mf(path: Path, title: str, parts: list[tuple[str, trimesh.Trimesh]], at=(128.0, 128.0)) -> None:
    """Plain 3MF core file that Bambu Studio, OrcaSlicer and PrusaSlicer open: one
    object; with several parts, each part can take its own filament."""
    res, ids = [], []
    for oid, (name, mesh) in enumerate(parts, start=1):
        v = "".join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in mesh.vertices)
        t = "".join(f'<triangle v1="{i}" v2="{j}" v3="{k}"/>' for i, j, k in mesh.faces)
        res.append(f'<object id="{oid}" type="model" name="{name}"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>')
        ids.append(oid)
    top = ids[0]
    if len(ids) > 1:
        top = len(ids) + 1
        comps = "".join(f'<component objectid="{i}"/>' for i in ids)
        res.append(f'<object id="{top}" type="model" name="{title}"><components>{comps}</components></object>')
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        f'<metadata name="Title">{title}</metadata>'
        '<metadata name="Designer">Claude Code Clamshell Dock</metadata>'
        f"<resources>{''.join(res)}</resources>"
        f'<build><item objectid="{top}" transform="1 0 0 0 1 0 0 0 1 {at[0]:.3f} {at[1]:.3f} 0"/></build></model>'
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


def to_bed(part: Part) -> Part:
    """Drop a part so its lowest point is on the print bed."""
    return Pos(0, 0, -part.bounding_box().min.Z) * part


def build(p: P, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        body = stl_mesh(to_bed(make_body(p)), tmp / "body.stl", 0.02)
        badge = {k: stl_mesh(v, tmp / f"{k}.stl", 0.01) for k, v in make_badge_parts(p).items()}
        gauge = stl_mesh(make_gauge(p), tmp / "gauge.stl", 0.02)
    write_3mf(out / "1_body_PETG.3mf", "TOGE dock body", [("body", body)])
    write_3mf(out / "2_clawd_badge.3mf", "Clawd badge", [("badge_glow", badge["badge_glow"]), ("badge_white", badge["badge_white"])])
    write_3mf(out / "0_fit_gauge_PETG.3mf", "Fit gauge", [("gauge", gauge)])
    print(f"{p.mac_t + p.c:.2f} mm between the pad liners, body {body.volume / 1000:.1f} cm3, wrote {out}")


def export_assembly(p: P, out: Path) -> None:
    """Placed meshes for renders plus a manifest the Blender script reads."""
    out.mkdir(parents=True, exist_ok=True)
    badge = make_badge_parts(p)
    items = [("body", make_body(p), "petg")]
    items += [("badge_glow", place_badge(p, badge["badge_glow"]), "glow"), ("badge_white", place_badge(p, badge["badge_white"]), "white")]
    items += [(name, part, "felt") for name, part in liners(p).items()]
    feet = [(sx * p.foot_x, sy * p.foot_y) for sx in (1, -1) for sy in (1, -1)]
    items += [(f"foot_{i}", Pos(x, y, p.zb - 2.0) * make_foot(p), "rubber") for i, (x, y) in enumerate(feet)]
    for set_name, with_laptop in (("assembled", True), ("dock", False)):
        manifest = []
        extra = [("laptop", place_laptop(p, AIR13, make_laptop(AIR13)), "laptop")] if with_laptop else []
        for name, part, mat in items + extra:
            fn = out / f"{set_name}__{name}.stl"
            export_stl(part, str(fn), tolerance=0.02, angular_tolerance=0.15)
            manifest.append({"file": fn.name, "material": mat})
        (out / f"{set_name}.json").write_text(json.dumps(manifest, indent=1))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--c", type=float, default=0.6, help="running clearance picked on the gauge comb, mm")
    ap.add_argument("--liner", type=float, default=2.0, help="pad liner thickness: 2.0 felt, 0.7 velvet sheet")
    ap.add_argument("--v-offset", type=float, default=0.0, help="shift of the pads in y, from the gauge slice")
    ap.add_argument("--mac-t", type=float, default=11.3, help="measured Mac thickness (add a case if you use one)")
    ap.add_argument("--out", default=str(ROOT / "print"), help="folder for the 3MF files")
    ap.add_argument("--assembly", metavar="DIR", help="only write placed meshes for renders into DIR")
    a = ap.parse_args()
    p = P(mac_t=a.mac_t, c=a.c, liner_t=a.liner, v_offset=a.v_offset)
    if a.assembly:
        export_assembly(p, Path(a.assembly))
        return
    build(p, Path(a.out))


if __name__ == "__main__":
    main()
