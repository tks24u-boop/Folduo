"""Geometry checks to run after changing parameters. Takes the same fit options as
clamshell_dock.py, e.g.  python3 check_fit.py --c 0.4 --liner 0.3

1. body, badge and every gauge piece are single valid solids with closed meshes
2. the badge does not collide with its pocket and eye pins
3. the Mac stand-in, seated hinge-down, touches no PETG: it rests on both V felt
   strips, clear of their edges, with c/2 to each pad liner
4. stability: top-edge push, tip angle, cable pull
5. how much of the Mac's face lies close to PETG (heat)
6. the lofted skin between the pass and the peaks follows the section law
7. printability: overhangs past 45 deg, and the gauge comb's teeth
Exits non-zero and names the failed checks if anything is off.
"""

import argparse
import tempfile
from pathlib import Path

import numpy as np
import trimesh
from build123d import Axis, Box, Pos, Vector

from clamshell_dock import (
    add_p_args,
    liners,
    mac_for,
    make_badge_parts,
    make_body,
    make_gauge,
    make_laptop,
    p_from_args,
    section_face,
    place_badge,
    place_laptop,
    stability,
    stl_mesh,
)

DOCK_KG = 0.190  # PETG body 185 g (PrusaSlicer, 0.16 mm, 5 walls, 20 % gyroid) + badge, felt and feet
failed: list[str] = []


def check(ok: bool, name: str, text: str) -> None:
    print(f"{'  ok' if ok else 'FAIL'}  {name:12s} {text}")
    if not ok:
        failed.append(name)


def info(name: str, text: str) -> None:
    print(f"      {name:12s} {text}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_p_args(ap)
    p = p_from_args(ap.parse_args())

    body = make_body(p)
    badge = make_badge_parts(p)
    gauge = make_gauge(p)
    with tempfile.TemporaryDirectory() as d:
        for name, part in {"body": body, **badge, **{f"gauge {k}": v for k, v in gauge.items()}}.items():
            stl_mesh(part, Path(d) / "m.stl", 0.02)  # raises if the mesh leaks
            n = len(part.solids())
            check(part.is_valid and n == 1, name, f"{n} solid, closed mesh, {part.volume / 1000:.2f} cm3")

    insert = place_badge(p, badge["badge_glow"]) + place_badge(p, badge["badge_white"])
    v = (insert & body).volume
    check(v < 1e-6, "badge", f"overlaps its pocket and eye pins by {v:.3f} mm3")

    lp = mac_for(p)
    mac = place_laptop(p, lp, make_laptop(lp))
    shifted = Pos(0, p.v_offset, 0) * mac  # where the real Mac seats; v_offset moves the pads there
    v, gap = (shifted & body).volume, shifted.distance_to(body)
    check(v < 1e-6 and gap > 0.3, "Mac / PETG", f"seated at z {p.seat_z():.2f}, closest PETG {gap:.2f} mm")
    info("badge", f"{insert.distance_to(mac):.1f} mm from the Mac")

    felt = liners(p)
    for name, liner in felt.items():
        check((liner & body).volume < 1e-6, name, "sits in its pocket without overlapping PETG")
    # the corner rounds rest on the compressed V felt: lift the Mac a hair to find where
    lifted = Pos(0, 0, 0.05) * mac
    for name, sy in (("felt_vr", 1), ("felt_vl", -1)):
        d, _, on_felt = lifted.distance_to_with_closest_points(felt[name])
        t = Vector(0, sy, 1).normalized()  # up the flank
        bb = felt[name].bounding_box()
        up = (on_felt - bb.center()).dot(t)
        edge = (p.vfelt_w - 0.4) / 2 - abs(up)
        check(d < 0.07 and edge > 1.5, name, f"Mac rests on it (gap {max(d - 0.05, 0):.2f} mm), {edge:.1f} mm inside its edge")
    for name in ("pad_rb", "pad_rf", "pad_lb", "pad_lf"):
        gap = shifted.distance_to(felt[name])
        want = p.c / 2 + p.pad_sag  # the Mac's weight takes pad_sag off, in the real, flexible dock
        check(abs(gap - want) < 0.02, name, f"{gap:.2f} mm from the Mac unloaded, {gap - p.pad_sag:.2f} under its weight")

    tip = stability(p, lp, DOCK_KG, body.center().Z)
    check(tip["liftoff_N"] >= 3.6, "stability", f"push at the Mac's top edge: far feet lift at {tip['liftoff_N']} N, "
          f"it falls at {tip['tipover_N']} N")  # fmt: skip
    info("stability", f"feet lift at a {tip['tilt_deg']} deg tilt or {tip['quake_g']} g; "
         f"a sideways pull at the fairleads needs {tip['cable_pull_N']} N")  # fmt: skip

    # heat: share of the Mac's front face with PETG within 3 mm, on a 1 mm grid. The flat
    # face starts above the 2.5 mm edge round; nothing past the ends or above the horns
    # can be that close.
    m = trimesh.Trimesh(*_mesh(body))
    xs = np.arange(-p.x_end - 1, p.x_end + 1.01, 1.0)
    zs = np.arange(p.seat_z() + 2.5, p.h_horn + 1.01, 1.0)
    grid = np.array([(x, -p.mac_t / 2, z) for x in xs for z in zs])
    dist = np.concatenate([trimesh.proximity.closest_point(m, chunk)[1] for chunk in np.array_split(grid, 20)])
    info("heat", f"PETG within 3 mm of the Mac on {(dist < 3.0).sum() / (lp.width * lp.depth):.1%} of its front face")

    # the loft between the pass and the peaks against the section law, on the crest and
    # the flank, front and back (a sparse loft once sagged 0.4 mm just past x = 42)
    dev = 0.0
    for x in np.arange(p.x_mid + 0.5, p.x_horn, 1.0):
        edges = [np.array([(v.Y, v.Z) for v in (e.position_at(t) for t in np.linspace(0, 1, 200))]) for e in section_face(p, x).edges()]
        for y in (-22.0, -17.0, 17.0, 22.0):
            law = max(
                a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0])
                for pts in edges for a, b in zip(pts[:-1], pts[1:]) if min(a[0], b[0]) <= y <= max(a[0], b[0]) and a[0] != b[0]
            )  # fmt: skip
            skin = max(v[0].Z for v in body.find_intersection_points(Axis((x, y, 200), (0, 0, -1))))
            dev = max(dev, abs(skin - law))
    check(dev < 0.05, "loft", f"skin within {dev:.3f} mm of the section law from x = {p.x_mid:.0f} to {p.x_horn:.0f}")

    # printability: faces overhanging more than 45 deg from vertical, above the first
    # layers. The foot pocket and plug dock ceilings are short bridges; anywhere else only
    # mesh facets of the lofts, a degree or two past 45, may show up.
    tri, n, area = m.triangles, m.face_normals, m.area_faces
    over = np.degrees(np.arcsin(np.clip(-n[:, 2], 0, 1)))
    down = (over > 46) & (tri[:, :, 2].min(axis=1) > p.zb + 0.3) & (area > 1e-3)  # zero-area slivers print nothing
    cz, cx = tri[:, :, 2].mean(axis=1), np.abs(tri[:, :, 0].mean(axis=1))
    feet = down & (np.abs(cz - (p.zb + p.foot_depth)) < 0.05)
    docks = down & ~feet & (cx > p.x_end - 5)  # their ceilings lean with the end face
    other = down & ~feet & ~docks
    worst = over[other].max() if other.any() else 45.0
    check(worst < 50, "overhangs", f"bridges: foot pocket ceilings {area[feet].sum():.0f} mm2, plug dock ceilings "
          f"{area[docks].sum():.0f} mm2; elsewhere at most {worst:.0f} deg from vertical")  # fmt: skip

    teeth = gauge["comb"] & Pos(0, 0, 7) * Box(300, 0.2, 0.2)
    thin = min(s.bounding_box().size.X for s in teeth.solids())
    check(thin >= 2.0, "gauge comb", f"thinnest tooth {thin:.1f} mm")

    print("ALL CHECKS PASSED" if not failed else f"FAILED: {', '.join(failed)}")
    raise SystemExit(1 if failed else 0)


def _mesh(part):
    with tempfile.TemporaryDirectory() as d:
        m = stl_mesh(part, Path(d) / "m.stl", 0.05)
    return m.vertices, m.faces


if __name__ == "__main__":
    main()
