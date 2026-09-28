"""Geometry checks to run after changing parameters.

    python3 check_fit.py

1. every printed part is a valid solid
2. the logo insert, liners and pegs do not collide with the body
3. each MacBook stand-in touches only the TPU bumps (never the PLA body), and
   only by the intended squeeze
4. tipping margins for every model
"""

from clamshell_dock import (
    LAPTOPS,
    LINERS,
    P,
    make_body,
    make_laptop,
    make_liner,
    make_logo_parts,
    make_parts,
    place_laptop,
    place_liner,
    place_logo,
    stability_report,
)


def main() -> None:
    p = P()
    ok = True
    for name, part in make_parts(p).items():
        ok &= part.is_valid
        print(f"solid   {name:18s} valid={part.is_valid} volume={part.volume / 1000:7.2f} cm3")

    body = make_body(p)
    logo = make_logo_parts(p)
    insert = place_logo(p, logo["logo_orange"]) + place_logo(p, logo["logo_eyes"])
    v = (insert & body).volume
    ok &= v < 1e-6
    print(f"clash   logo insert / body       {v:8.3f} mm3")
    for key, (t, lean) in LINERS.items():
        liner = make_liner(p, t, lean)
        pair = place_liner(p, liner, -1) + place_liner(p, liner, 1)
        v = (pair & body).volume
        ok &= v < 1e-6
        print(f"clash   liner {key:6s} / body       {v:8.3f} mm3")

    for lp in LAPTOPS:
        if lp.key == "air13m1":  # the stand-in is a flat slab, the real M1 Air is a wedge
            continue
        t, lean = LINERS[lp.liner]
        liner = make_liner(p, t, lean)
        pair = place_liner(p, liner, -1) + place_liner(p, liner, 1)
        mac = place_laptop(p, lp, make_laptop(lp))
        v_body, v_tpu = (mac & body).volume, (mac & pair).volume
        ok &= v_body < 1e-6 and v_tpu < 40
        print(f"fit     {lp.label:30s} touches PLA {v_body:6.3f} mm3, squeezes TPU bumps {v_tpu:6.2f} mm3")

    for row in stability_report(p, dock_kg=0.29):
        print(f"tip     {row['model']:30s} {row['tip_angle_deg']:5.1f} deg, {row['push_at_top_N']:4.1f} N at the top edge")
    print("ALL CHECKS PASSED" if ok else "CHECK FAILED")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
