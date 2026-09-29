"""Geometry checks to run after changing parameters.

    python3 check_fit.py [--model air13]

1. the printed parts are valid solids
2. the logo insert does not collide with its pocket
3. the MacBook stand-in touches neither the PLA nor the felt, and how much play is left
4. tipping margins with this body for every MacBook
5. how much of the MacBook the dock covers (heat)
"""

import argparse

from clamshell_dock import (
    LAPTOPS,
    P,
    felt_strips,
    make_body,
    make_laptop,
    make_logo_parts,
    place_laptop,
    place_logo,
    stability_report,
)

DOCK_KG = 0.10  # 95 g PLA (PrusaSlicer, 3 walls, 15 % infill) + felt, feet and logo


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="air13", choices=sorted(LAPTOPS))
    p = P(model=ap.parse_args().model)
    lp = p.laptop
    ok = True

    body = make_body(p)
    logo = make_logo_parts(p)
    for name, part in {"body": body, **logo}.items():
        ok &= part.is_valid
        print(f"solid   {name:12s} valid={part.is_valid} volume={part.volume / 1000:6.2f} cm3")

    insert = place_logo(p, logo["logo_orange"]) + place_logo(p, logo["logo_eyes"])
    v = (insert & body).volume
    ok &= v < 1e-6
    print(f"clash   logo insert / body      {v:.3f} mm3")

    mac = place_laptop(p, make_laptop(lp))
    v = (mac & body).volume
    ok &= v < 1e-6
    print(f"fit     {lp.label} / PLA         {v:.3f} mm3")
    for name, felt in felt_strips(p).items():
        gap = mac.distance_to(felt)
        v = (mac & felt).volume
        ok &= v < 1e-6
        print(f"fit     {lp.label} / {name:10s} gap {gap:.2f} mm")
    print(f"fit     slot {p.slot_w:.2f} mm, the Mac sticks out {(lp.width - p.length) / 2:.1f} mm at each end")

    cg_z = body.center().Z
    for row in stability_report(p, DOCK_KG, cg_z):
        print(f"tip     {row['model']:26s} {row['tip_angle_deg']:5.1f} deg, {row['push_at_top_N']:4.2f} N at the top edge")

    covered_h = p.height - p.laptop_z
    face = lp.width * lp.depth
    print(f"heat    covers {covered_h:.0f} mm x {p.length:.0f} mm of each face = {covered_h * p.length / face:.1%} of it")
    print("ALL CHECKS PASSED" if ok else "CHECK FAILED")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
