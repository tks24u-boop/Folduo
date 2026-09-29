"""Geometry checks to run after changing parameters.

    python3 check_fit.py [--c 0.6]

1. the body, badge and gauge are valid solids with closed meshes
2. the badge does not collide with its pocket and eye pins
3. the Mac stand-in, seated hinge-down, touches no PETG, and the felt only in the V
4. stability: top-edge push, tip angle, cable pull
5. how much of the Mac lies close to PETG (heat)
6. overhangs steeper than 45 deg that face down (printability)
"""

import argparse
import tempfile
from pathlib import Path

import numpy as np
import trimesh

from clamshell_dock import (
    AIR13,
    P,
    liners,
    make_badge_parts,
    make_body,
    make_gauge,
    make_laptop,
    place_badge,
    place_laptop,
    stability,
    stl_mesh,
)

DOCK_KG = 0.215  # PETG body 211 g (PrusaSlicer, 5 walls, 20 % gyroid) + badge, felt and feet


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--c", type=float, default=0.6)
    p = P(c=ap.parse_args().c)
    ok = True

    body = make_body(p)
    badge = make_badge_parts(p)
    with tempfile.TemporaryDirectory() as d:
        for name, part in {"body": body, "gauge": make_gauge(p), **badge}.items():
            stl_mesh(part, Path(d) / f"{name}.stl", 0.02)  # raises if the mesh leaks
            ok &= part.is_valid
            print(f"solid   {name:12s} valid={part.is_valid} closed mesh, {part.volume / 1000:6.2f} cm3")

    insert = place_badge(p, badge["badge_glow"]) + place_badge(p, badge["badge_white"])
    v = (insert & body).volume
    ok &= v < 1e-6
    print(f"clash   badge / body              {v:.3f} mm3")

    mac = place_laptop(p, AIR13, make_laptop(AIR13))
    v = (mac & body).volume
    ok &= v < 1e-6
    print(f"fit     Mac seated at z {p.seat_z():.2f} / PETG  {v:.3f} mm3, closest PETG {mac.distance_to(body):.2f} mm")
    for name, liner in liners(p).items():
        gap, v = mac.distance_to(liner), (mac & liner).volume
        ok &= v < 1e-6 and (liner & body).volume < 1e-6
        print(f"fit     {name:9s} gap {gap:.2f} mm")

    for k, val in stability(p, AIR13, DOCK_KG, body.center().Z).items():
        print(f"tip     {k:20s} {val}")

    # heat: share of the Mac's front face with PETG within 3 mm (1 mm grid; nothing
    # beyond the dock's length or above the horns can be that close)
    m = trimesh.Trimesh(*_mesh(body))
    xs = np.arange(-p.x_end - 1, p.x_end + 1.01, 1.0)
    zs = np.arange(p.seat_z(), p.h_horn + 1.01, 1.0)
    grid = np.array([(x, -p.mac_t / 2, z) for x in xs for z in zs])
    dist = np.concatenate([trimesh.proximity.closest_point(m, chunk)[1] for chunk in np.array_split(grid, 20)])
    near = (dist < 3.0).sum() / (AIR13.width * AIR13.depth)
    print(f"heat    PETG within 3 mm of the Mac on {near:.1%} of each face")

    # printability: downward faces steeper than 45 deg, above the first layer
    tri = m.triangles
    n = m.face_normals
    low = tri[:, :, 2].min(axis=1)
    bad = (n[:, 2] < -0.72) & (low > p.zb + 0.3)
    area = m.area_faces[bad].sum()
    print(f"print   downward faces over 45 deg above the bed: {area:.0f} mm2 (foot pockets, plug docks)")
    print("ALL CHECKS PASSED" if ok else "CHECK FAILED")
    raise SystemExit(0 if ok else 1)


def _mesh(part):
    with tempfile.TemporaryDirectory() as d:
        m = stl_mesh(part, Path(d) / "m.stl", 0.05)
    return m.vertices, m.faces


if __name__ == "__main__":
    main()
