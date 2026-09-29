"""Claude Code Clamshell Dock - parametric model (build123d).

A slim vertical dock for a MacBook used in clamshell (lid-closed) mode, printed
on a Bambu Lab P2S (build volume 256 x 256 x 256 mm).

Only two parts are printed:
  body   PLA, one piece, printed upright without supports
  logo   Clawd, the Claude Code mascot, printed face down and pressed into the front
Bought: 2 mm self-adhesive felt for the slot and four stick-on rubber feet.

Usage
  python3 clamshell_dock.py                  print/1_body_PLA.3mf and print/2_logo_clawd.3mf
  python3 clamshell_dock.py --model pro14    a body for another MacBook
  python3 clamshell_dock.py --no-logo        a body without the logo pocket
  python3 clamshell_dock.py --assembly DIR   placed meshes for render_blender.py / drawings.py

Millimetres. X along the dock (the laptop's width), Y front(-)/back(+), Z up,
dock bottom at z = 0 (the rubber feet lift it by P.feet_h).
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
    Cylinder,
    Kind,
    Part,
    Plane,
    Polygon,
    Pos,
    RectangleRounded,
    Rot,
    Sketch,
    chamfer,
    export_stl,
    extrude,
    fillet,
    offset,
)

from clawd import clawd_sketches

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


# --------------------------------------------------------------------------
# MacBooks (Apple tech specs; the thickness excludes the rubber feet, which sit
# near the corners, outside the dock)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Laptop:
    label: str
    thickness: float
    width: float
    depth: float
    weight: float  # kg


LAPTOPS = {
    "air13": Laptop("MacBook Air 13 (M2-M5)", 11.3, 304.1, 215.0, 1.24),
    "air15": Laptop("MacBook Air 15 (M2-M5)", 11.5, 340.4, 237.6, 1.51),
    "neo": Laptop("MacBook Neo (2026)", 12.75, 297.5, 206.4, 1.23),
    "pro14": Laptop("MacBook Pro 14 / Pro 13", 15.6, 312.6, 221.2, 1.63),
    "pro16": Laptop("MacBook Pro 16", 16.8, 355.7, 248.1, 2.20),
}


@dataclass
class P:
    model: str = "air13"
    felt: float = 2.0  # self-adhesive felt on both slot walls and the floor
    # side play left with nominal felt. Loose is easy to fix (tape under the felt),
    # tight is not, and a snug felt grip would lift the light dock with the laptop.
    fit_play: float = 0.3
    # outline
    length: float = 180.0
    depth: float = 104.0  # footprint across the slot: the tipping direction
    height: float = 34.0
    wall: float = 4.0  # slot wall thickness at the top
    draft: float = 8.0  # front and back faces of the upright
    end_draft: float = 7.0
    plate_edge: float = 3.0  # base plate thickness at its outer edge
    plate_root: float = 5.0  # ... and where it meets the upright
    r_plan: float = 18.0
    r_flare: float = 5.0
    r_edge: float = 1.4
    r_top: float = 1.9  # outer top edge and slot mouth; with a 4 mm wall the top is almost a half round
    r_end: float = 1.5  # 2.0 meets the top round in a corner blend that tessellates with a gap
    ch_bottom: float = 0.8  # 45 deg, hides elephant foot
    z_floor: float = 3.0  # slot floor above the dock bottom
    # stick-on rubber feet, centres feet_inset in from the footprint edge
    feet_h: float = 2.0
    feet_d: float = 12.0
    feet_inset: float = 9.0
    # Clawd logo (16u x 10u)
    logo_u: float = 2.0
    logo_t: float = 2.0
    logo_clr: float = 0.2  # per side
    logo_eye_t: float = 0.6
    # 45 deg chamfer at the back of the pocket's top edges, so its ceiling on the
    # near-vertical face prints without a bridge
    logo_back_chamfer: float = 1.2

    @property
    def laptop(self) -> Laptop:
        return LAPTOPS[self.model]

    @property
    def slot_w(self) -> float:
        return self.laptop.thickness + 2 * self.felt + self.fit_play

    @property
    def laptop_z(self) -> float:
        """Laptop edge above the dock bottom (it stands on the floor felt)."""
        return self.z_floor + self.felt

    @property
    def y_top(self) -> float:
        return self.slot_w / 2 + self.wall

    def face_y(self, z: float) -> float:
        """|y| of the upright's front/back face at height z."""
        return self.y_top + (self.height - z) * math.tan(math.radians(self.draft))

    @property
    def logo_z(self) -> float:
        """Centre of the flat part of the front face, between the flare and the top round."""
        th = math.radians(self.draft)
        # tangent lengths of the two 2D fillets along the face
        slope = math.atan((self.plate_root - self.plate_edge) / (self.depth / 2 - self.face_y(self.plate_root)))
        flare = self.r_flare / math.tan((math.pi / 2 + th + slope) / 2)
        top = self.r_top / math.tan((math.pi / 2 + th) / 2)
        return (self.plate_root + flare * math.cos(th) + self.height - top * math.cos(th)) / 2


def _ok(part: Part, name: str) -> Part:
    if not part.is_valid:
        raise RuntimeError(f"{name}: invalid solid")
    return part


def front_plane(p: P, z: float) -> Plane:
    """Plane on the drafted front face at height z, normal pointing out of the part."""
    th = math.radians(p.draft)
    return Plane(origin=(0, -p.face_y(z), z), x_dir=(1, 0, 0), z_dir=(0, -math.cos(th), math.sin(th)))


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


# --------------------------------------------------------------------------
# body
# --------------------------------------------------------------------------
def profile(p: P) -> Sketch:
    """Cross-section in the YZ plane (sketch x = Y, sketch y = Z): a thin, wide base
    plate for stability and a slim upright around the slot."""
    h, Y = p.slot_w / 2, p.depth / 2
    yt, yr = p.y_top, p.face_y(p.plate_root)
    pts = [
        (-Y, 0), (Y, 0), (Y, p.plate_edge), (yr, p.plate_root), (yt, p.height), (h, p.height),
        (h, p.z_floor), (-h, p.z_floor), (-h, p.height), (-yt, p.height), (-yr, p.plate_root), (-Y, p.plate_edge),
    ]  # fmt: skip
    sk = Sketch() + Polygon(*pts, align=None)

    def at(targets):
        return [v for v in sk.vertices() if any(abs(v.X - a) < 1e-6 and abs(v.Y - b) < 1e-6 for a, b in targets)]

    for targets, r in (
        ([(Y, p.plate_edge), (-Y, p.plate_edge)], p.r_edge),
        ([(yr, p.plate_root), (-yr, p.plate_root)], p.r_flare),
        ([(yt, p.height), (-yt, p.height), (h, p.height), (-h, p.height)], p.r_top),
    ):
        sk = fillet(at(targets), r)
    return sk


def make_body(p: P, logo: bool = True) -> Part:
    body = extrude(Plane.YZ * profile(p), p.length / 2 + 5, both=True)
    body &= extrude(RectangleRounded(p.length, p.depth, p.r_plan), p.height + 1, taper=p.end_draft)

    # soften the corners of the upright's ends and of the slot ends
    ends = [
        e
        for e in body.edges()
        if abs(e.center().X) > p.length / 2 - 6
        and p.slot_w / 2 - 0.5 < abs(e.center().Y) < p.face_y(p.plate_root) + 0.5
        and e.center().Z > p.plate_root + 2
        and abs((e @ 1 - e @ 0).normalized().Z) > 0.9
    ]
    try:
        body = fillet(ends, p.r_end)
    except Exception:  # OCCT occasionally refuses; a sharp edge is harmless here
        pass
    body = chamfer(body.edges().group_by(Axis.Z)[0], p.ch_bottom)

    if logo:
        outline, _, _ = clawd_sketches(p.logo_u)
        pocket = offset(outline, p.logo_clr, kind=Kind.INTERSECTION)
        cutter = back_top_chamfer(extrude(pocket, -p.logo_t), -p.logo_t, p.logo_back_chamfer)
        body -= front_plane(p, p.logo_z) * cutter
    return _ok(body, "body")


# --------------------------------------------------------------------------
# logo
# --------------------------------------------------------------------------
def make_logo_parts(p: P) -> dict[str, Part]:
    """Logo parts in print orientation: the visible face lies on the plate (z = 0).
    Without an AMS, print only logo_orange: the eyes become 0.6 mm recesses."""
    outline, _, eyes_sk = clawd_sketches(p.logo_u)
    eyes = extrude(eyes_sk, p.logo_eye_t)
    orange = back_top_chamfer(extrude(outline, p.logo_t), p.logo_t, p.logo_back_chamfer + 0.3) - eyes
    return {"logo_orange": _ok(orange, "logo orange"), "logo_eyes": _ok(eyes, "logo eyes")}


def place_logo(p: P, part: Part) -> Part:
    """Move a logo part from print orientation into the body's pocket."""
    return front_plane(p, p.logo_z) * (Rot(0, 180, 0) * part)


# --------------------------------------------------------------------------
# felt, feet and a laptop stand-in (fit checks and renders)
# --------------------------------------------------------------------------
def felt_strips(p: P) -> dict[str, Part]:
    """The felt as the README says to cut it: a floor strip and two wall strips that
    stop below the mouth round and short of the drafted slot ends."""
    h = p.slot_w / 2
    top = p.height - p.r_top - 1.0
    ln = p.length - 2 * top * math.tan(math.radians(p.end_draft)) - 4
    wall_h = top - p.laptop_z
    floor = Pos(0, 0, p.z_floor + p.felt / 2) * Box(ln, p.slot_w - 0.4, p.felt)
    return {
        "felt_floor": floor,
        "felt_front": Pos(0, -h + p.felt / 2, p.laptop_z + wall_h / 2) * Box(ln, p.felt, wall_h),
        "felt_back": Pos(0, h - p.felt / 2, p.laptop_z + wall_h / 2) * Box(ln, p.felt, wall_h),
    }


def feet_positions(p: P) -> list[tuple[float, float]]:
    # 3 mm further in along X keeps each foot inside the R18 plan corner
    x, y = p.length / 2 - p.feet_inset - 3, p.depth / 2 - p.feet_inset
    return [(sx * x, sy * y) for sx in (-1, 1) for sy in (-1, 1)]


def make_foot(p: P) -> Part:
    foot = Pos(0, 0, -p.feet_h / 2) * Cylinder(p.feet_d / 2, p.feet_h)
    return fillet(foot.edges().group_by(Axis.Z)[0], 0.6)


def make_laptop(lp: Laptop, r_plan: float = 13.0, r_edge: float = 3.0) -> Part:
    body = extrude(RectangleRounded(lp.width, lp.depth, r_plan), lp.thickness)
    body = fillet(body.edges().group_by(Axis.Z)[0], r_edge)
    body = fillet(body.edges().group_by(Axis.Z)[-1], min(r_edge, 2.0))
    zs = lp.thickness * 0.68
    ring = extrude(RectangleRounded(lp.width + 2, lp.depth + 2, r_plan + 1), 0.35) - extrude(
        RectangleRounded(lp.width - 0.6, lp.depth - 0.6, r_plan - 0.3), 0.35
    )
    return body - Pos(0, 0, zs) * ring


def place_laptop(p: P, part: Part) -> Part:
    """Stand the laptop hinge-up on its front edge, lid towards the front."""
    lp = p.laptop
    return Pos(0, 0, p.laptop_z) * Rot(90, 0, 0) * Pos(0, lp.depth / 2, -lp.thickness / 2) * part


# --------------------------------------------------------------------------
# reports
# --------------------------------------------------------------------------
def stability_report(p: P, dock_kg: float, dock_cg_z: float) -> list[dict]:
    """Sideways push at the laptop's top edge that starts lifting the dock, and the
    tilt at which it would fall. The pivot is the outer edge of the rubber feet, where
    it first rocks; the plate edge is only 2.2 mm further out."""
    pivot = p.depth / 2 - p.feet_inset + p.feet_d / 2
    rows = []
    for lp in LAPTOPS.values():
        m = lp.weight + dock_kg
        z0 = p.feet_h + p.laptop_z
        cg = (lp.weight * (z0 + lp.depth / 2) + dock_kg * (p.feet_h + dock_cg_z)) / m
        rows.append(
            {
                "model": lp.label,
                "tip_angle_deg": round(math.degrees(math.atan(pivot / cg)), 1),
                "push_at_top_N": round(m * 9.81 * pivot / (z0 + lp.depth), 2),
            }
        )
    return rows


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


def build(p: P, out: Path, logo: bool = True) -> None:
    out.mkdir(parents=True, exist_ok=True)
    suffix = ("" if p.model == "air13" else f"_{p.model}") + ("" if logo else "_no_logo")
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        body = stl_mesh(make_body(p, logo), tmp / "body.stl", 0.02)
        write_3mf(out / f"1_body_PLA{suffix}.3mf", f"Clamshell dock body ({p.laptop.label})", [("body", body)])
        if logo:
            parts = {k: stl_mesh(v, tmp / f"{k}.stl", 0.01) for k, v in make_logo_parts(p).items()}
            write_3mf(
                out / "2_logo_clawd.3mf",
                "Clawd logo insert",
                [("clawd_orange", parts["logo_orange"]), ("clawd_eyes_black", parts["logo_eyes"])],
            )
    print(f"{p.laptop.label}: slot {p.slot_w:.2f} mm, body {body.volume / 1000:.1f} cm3, wrote {out}")


def export_assembly(p: P, out: Path) -> None:
    """Placed meshes for renders plus a manifest the Blender script reads."""
    out.mkdir(parents=True, exist_ok=True)
    logo = make_logo_parts(p)
    items = [("body", make_body(p), "body")]
    items += [("logo_orange", place_logo(p, logo["logo_orange"]), "orange"), ("logo_eyes", place_logo(p, logo["logo_eyes"]), "black")]
    items += [(name, part, "felt") for name, part in felt_strips(p).items()]
    items += [(f"foot_{i}", Pos(x, y, 0) * make_foot(p), "rubber") for i, (x, y) in enumerate(feet_positions(p))]
    lift = Pos(0, 0, p.feet_h)
    for set_name, with_laptop in (("assembled", True), ("dock", False)):
        manifest = []
        extra = [("laptop", place_laptop(p, make_laptop(p.laptop)), "laptop")] if with_laptop else []
        for name, part, mat in items + extra:
            fn = out / f"{set_name}__{name}.stl"
            export_stl(lift * part, str(fn), tolerance=0.02, angular_tolerance=0.15)
            manifest.append({"file": fn.name, "material": mat})
        (out / f"{set_name}.json").write_text(json.dumps(manifest, indent=1))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="air13", choices=sorted(LAPTOPS), help="MacBook the slot is sized for")
    ap.add_argument("--felt", type=float, default=2.0, help="felt thickness, mm")
    ap.add_argument("--out", default=str(ROOT / "print"), help="folder for the 3MF files")
    ap.add_argument("--no-logo", action="store_true", help="body without the logo pocket, e.g. to share it")
    ap.add_argument("--assembly", metavar="DIR", help="only write placed meshes for renders into DIR")
    args = ap.parse_args()
    p = P(model=args.model, felt=args.felt)
    if args.assembly:
        export_assembly(p, Path(args.assembly))
        return
    build(p, Path(args.out), logo=not args.no_logo)


if __name__ == "__main__":
    main()
