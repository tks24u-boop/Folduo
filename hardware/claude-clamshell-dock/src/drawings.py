"""Dimensioned drawing sheet: front view, top view, and two cross-sections with the Mac seated.

    python3 clamshell_dock.py --assembly /tmp/asm
    python3 drawings.py /tmp/asm ../images/drawing.png

The parameters come from the assembly folder's params.json, so the sheet always
matches the meshes.
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import trimesh  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

# Japanese labels; falls back to the default font when Noto Sans CJK is missing
for path in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",):
    if Path(path).exists():
        font_manager.fontManager.addfont(path)
        plt.rcParams["font.family"] = "Noto Sans CJK JP"

from clamshell_dock import P, mac_for, seal_plane  # noqa: E402

INK, DIM, LAP, BODY, EDGE, FELT, GLOW, WHITE = "#1f1f1f", "#6b6b6b", "#5b7fa3", "#3a3a3d", "#1f1f1f", "#a8a8a8", "#ff9d5b", "#f4f1ea"
PAPER = dict(boxstyle="square,pad=0.15", fc="white", ec="none")  # keeps notes readable over lines


def section_fill(ax, mesh, x, color, z=1, edge=None):
    sec = mesh.section(plane_origin=[x, 0, 0], plane_normal=[1, 0, 0])
    if sec is None:
        return
    polys = [pts[:, [1, 2]] for pts in sec.discrete]
    ax.add_collection(PolyCollection(polys, facecolors=color, edgecolors=edge or color, linewidths=0.6, zorder=z))


def outline(ax, mesh, x, color, lw=1.0):
    sec = mesh.section(plane_origin=[x, 0, 0], plane_normal=[1, 0, 0])
    if sec is not None:
        for pts in sec.discrete:
            ax.plot(pts[:, 1], pts[:, 2], color=color, lw=lw, zorder=4)


def silhouette(ax, mesh, color, axes, z=1):
    tris = mesh.vertices[mesh.faces][:, :, list(axes)]
    ax.add_collection(PolyCollection(tris, facecolors=color, edgecolors=color, linewidths=0.2, zorder=z))


def dim(ax, a, b, text, offset=(0, 0), vertical=False, fs=8):
    (x0, y0), (x1, y1) = a, b
    ax.annotate("", xy=(x0, y0), xytext=(x1, y1), arrowprops=dict(arrowstyle="<->", color=DIM, lw=0.8, shrinkA=0, shrinkB=0))
    ax.text((x0 + x1) / 2 + offset[0], (y0 + y1) / 2 + offset[1], text, color=INK, fontsize=fs, ha="center", va="center",
            rotation=90 if vertical else 0, bbox=dict(boxstyle="square,pad=0.15", fc="white", ec="none"), zorder=5)


def main() -> None:
    asm, dst = Path(sys.argv[1]), Path(sys.argv[2])
    p = P(**json.loads((asm / "params.json").read_text()))
    load = lambda n: trimesh.load(asm / f"assembled__{n}.stl")  # noqa: E731
    body, lap = load("body"), load("laptop")
    felts = [load(n) for n in ("felt_vr", "felt_vl", "pad_rb", "pad_rf", "pad_lb", "pad_lf")]
    badge, badge_white = load("badge_glow"), load("badge_white")
    X, Y = p.x_end, p.yt_horn
    lp, seal = mac_for(p), seal_plane(p).origin

    fig = plt.figure(figsize=(17, 11), dpi=130)
    gs = fig.add_gridspec(2, 3, width_ratios=[1.6, 0.8, 0.8], height_ratios=[0.8, 1], hspace=0.12, wspace=0.08)

    # --- front view --------------------------------------------------------------
    ax = fig.add_subplot(gs[0, 0])
    silhouette(ax, body, BODY, (0, 2))
    silhouette(ax, badge, GLOW, (0, 2), z=2)
    ax.axhline(0, color=DIM, lw=0.6)
    dim(ax, (-X, -8), (X, -8), f"{2 * X:.0f}")
    dim(ax, (X + 8, 0), (X + 8, p.h_horn), f"{p.h_horn:.0f}", vertical=True)
    dim(ax, (-p.x_mid, p.h_mid + 6), (p.x_mid, p.h_mid + 6), f"低い峠 {2 * p.x_mid:.0f}（高さ{p.h_mid:.0f}）", fs=7)
    ax.text(-X, p.h_horn + 8, f"ゴム脚{p.zb:.1f} mm込みの高さ。中央は低く（Macのヒンジの熱い部分を空気にさらす）、両端の峰で支える",
            fontsize=8, color=DIM)
    ax.set_xlim(-X - 8, X + 18)
    ax.set_ylim(-15, p.h_horn + 14)
    ax.set_title("正面", loc="left", fontsize=11, color=INK)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- top view -------------------------------------------------------------------
    ax = fig.add_subplot(gs[1, 0])
    for z, color, lw, ls in ((p.zb + 0.3, INK, 1.0, "-"), (p.cable_z, DIM, 0.7, "--"), (50.0, INK, 1.0, "-")):
        sec = body.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        for pts in sec.discrete if sec is not None else []:
            ax.plot(pts[:, 0], pts[:, 1], color=color, lw=lw, ls=ls)
    silhouette(ax, badge, GLOW, (0, 1), z=2)
    ax.text(-X, Y + 14, f"実線：床面と高さ50 mmの断面　破線：高さ{p.cable_z:.0f} mm（ケーブルの通り道が見える）", fontsize=8, color=DIM)
    dim(ax, (-X, -Y - 9), (X, -Y - 9), f"{2 * X:.0f}")
    dim(ax, (X + 9, -Y), (X + 9, Y), f"{2 * Y:.0f}（脚の外側 {2 * (p.foot_y + p.foot_dia / 2):.0f}）", vertical=True, offset=(4, 0))
    ax.annotate("ケーブルの通り道（USB-C／MagSafe）\n両端の後ろ側。下から押し込む", xy=(X - 12, 30), xytext=(X - 95, Y + 4),
                fontsize=7, color=INK, arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
    ax.set_xlim(-X - 8, X + 30)
    ax.set_ylim(-Y - 16, Y + 22)
    ax.set_title("上面（奥が +Y）", loc="left", fontsize=11, color=INK)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- sections ---------------------------------------------------------------------
    for col, (xs, title) in enumerate(((0.0, "断面 中央（x = 0）"), (90.0, "断面 峰（x = 90）"))):
        ax = fig.add_subplot(gs[:, col + 1])
        section_fill(ax, body, xs, "#d9d6cf", edge=EDGE)
        for m in felts:
            section_fill(ax, m, xs, FELT, z=2)
        section_fill(ax, badge, xs, GLOW, z=2)
        section_fill(ax, badge_white, xs, WHITE, z=2, edge=DIM)
        outline(ax, lap, xs, LAP)
        ax.axhline(0, color=DIM, lw=0.6)
        seat = p.seat_z()
        if xs > p.x_horn:
            clear = p.mac_t + p.c
            dim(ax, (-clear / 2, p.land_z1 + 18), (clear / 2, p.land_z1 + 18), f"{clear:.1f}", offset=(0, 3), fs=7)
            ax.annotate(f"フェルトのパッド（Macとのすき間 片側{p.c / 2:.1f} mm）", xy=(-(p.mac_t + p.c) / 2 - 1, (p.land_z0 + p.land_z1) / 2), bbox=PAPER,
                        xytext=(-Y + 2, p.land_z1 + 30), fontsize=7, color=INK, arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
            dim(ax, (-Y, -6), (Y, -6), f"{2 * Y:.0f}", fs=7)
            dim(ax, (Y - 4, 0), (Y - 4, p.h_horn), f"{p.h_horn:.0f}", vertical=True, fs=7)
        else:
            dim(ax, (-p.y_mouth, p.h_mid + 6), (p.y_mouth, p.h_mid + 6), f"入口 {2 * p.y_mouth:.0f}", offset=(0, 3), fs=7)
            ax.annotate("45°のV溝にフェルト。Macはヒンジの角2本の線だけで立つ", xy=(4.5, seat + 1), xytext=(-40, seat + 70), bbox=PAPER,
                        fontsize=7, color=INK, arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
            ax.annotate("Clawd（蓄光）", xy=(seal.Y, seal.Z), xytext=(-48, 40), fontsize=7, color=INK, bbox=PAPER,
                        arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
            ax.annotate(f"Macの下端：机から{seat:.1f}", xy=(1.5, seat), xytext=(12, seat + 40), fontsize=7, color=INK, bbox=PAPER,
                        arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
            dim(ax, (40, 0), (40, p.h_mid), f"{p.h_mid:.0f}", vertical=True, fs=7)
        ax.text(0, p.h_horn + 70, f"{lp.label}（厚さ{lp.thickness} mm）", ha="center", color=LAP, fontsize=8, bbox=PAPER)
        ax.set_xlim(-Y - 4, Y + 4)
        ax.set_ylim(-14, p.h_horn + 78)
        ax.set_aspect("equal")
        ax.axis("off")
        ax.set_title(title, loc="left", fontsize=11, color=INK)

    fig.suptitle("TŌGE（峠）Claude Code クラムシェルドック　寸法図（単位 mm）", fontsize=13, x=0.02, ha="left", color=INK)
    dst.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(dst, bbox_inches="tight", facecolor="white")


if __name__ == "__main__":
    main()
