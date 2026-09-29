"""Dimensioned drawing sheet: top view, front view, and a cross-section with the MacBook and felt.

    python3 clamshell_dock.py --assembly /tmp/asm
    python3 drawings.py /tmp/asm ../images/drawing.png
"""

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

from clamshell_dock import P  # noqa: E402

INK, DIM, CUT, LAP, ORANGE, FELT = "#1f1f1f", "#6b6b6b", "#8a7f6c", "#5b7fa3", "#d77757", "#9a9a9a"


def outline(ax, mesh, origin, normal, axes, color=INK, lw=1.0, ls="-", shift=(0.0, 0.0)):
    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    if sec is None:
        return
    for pts in sec.discrete:
        ax.plot(pts[:, axes[0]] + shift[0], pts[:, axes[1]] + shift[1], color=color, lw=lw, ls=ls)


def section_fill(ax, mesh, origin, normal, axes, color, z=1):
    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    if sec is None:
        return
    polys = [pts[:, axes] for pts in sec.discrete]
    ax.add_collection(PolyCollection(polys, facecolors=color, edgecolors=color, linewidths=0.3, zorder=z))


def silhouette(ax, mesh, color, axes=(0, 2), z=1):
    tris = mesh.vertices[mesh.faces][:, :, list(axes)]
    ax.add_collection(PolyCollection(tris, facecolors=color, edgecolors=color, linewidths=0.2, zorder=z))


def dim(ax, a, b, text, offset=(0, 0), vertical=False, fs=8):
    """Dimension line between points a and b, label at the middle."""
    (x0, y0), (x1, y1) = a, b
    ax.annotate("", xy=(x0, y0), xytext=(x1, y1), arrowprops=dict(arrowstyle="<->", color=DIM, lw=0.8, shrinkA=0, shrinkB=0))
    mx, my = (x0 + x1) / 2 + offset[0], (y0 + y1) / 2 + offset[1]
    ax.text(mx, my, text, color=INK, fontsize=fs, ha="center", va="center", rotation=90 if vertical else 0,
            bbox=dict(boxstyle="square,pad=0.15", fc="white", ec="none"), zorder=5)


def main() -> None:
    asm, dst = Path(sys.argv[1]), Path(sys.argv[2])
    p = P()
    lp, f = p.laptop, p.feet_h
    load = lambda n: trimesh.load(asm / f"assembled__{n}.stl")  # noqa: E731
    body, lap = load("body"), load("laptop")
    felts = [load(n) for n in ("felt_floor", "felt_front", "felt_back")]
    L, D, H = p.length, p.depth, p.height

    fig = plt.figure(figsize=(16, 10), dpi=130)
    gs = fig.add_gridspec(2, 2, width_ratios=[1.45, 1], height_ratios=[1, 0.85], hspace=0.16, wspace=0.06)

    # --- top view ------------------------------------------------------------------
    ax = fig.add_subplot(gs[0, 0])
    outline(ax, body, [0, 0, f + 0.3], [0, 0, 1], (0, 1), color=DIM, lw=0.8)
    outline(ax, body, [0, 0, f + H - 3], [0, 0, 1], (0, 1))
    dim(ax, (-L / 2, -D / 2 - 9), (L / 2, -D / 2 - 9), f"{L:.0f}")
    dim(ax, (L / 2 + 9, -D / 2), (L / 2 + 9, D / 2), f"{D:.0f}", vertical=True)
    dim(ax, (-L / 2 - 9, -p.slot_w / 2), (-L / 2 - 9, p.slot_w / 2), f"スロット {p.slot_w:.1f}", offset=(-7, 0), vertical=True, fs=7)
    ax.text(0, D / 2 + 5, "外側の線：底板　内側の線：立ち上がり（上端近く）", ha="center", fontsize=8, color=DIM)
    ax.set_xlim(-L / 2 - 26, L / 2 + 18)
    ax.set_ylim(-D / 2 - 16, D / 2 + 10)
    ax.set_title("上面", loc="left", fontsize=11, color=INK)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- front view -----------------------------------------------------------------
    ax = fig.add_subplot(gs[1, 0])
    silhouette(ax, body, "#e6dfd0", z=1)
    silhouette(ax, load("logo_orange"), ORANGE, z=2)
    silhouette(ax, load("logo_eyes"), "#161616", z=3)
    for i in range(4):
        silhouette(ax, load(f"foot_{i}"), "#333333", z=0)
    ax.axhline(0, color=DIM, lw=0.6)
    dim(ax, (-L / 2, -7), (L / 2, -7), f"{L:.0f}")
    dim(ax, (L / 2 + 7, 0), (L / 2 + 7, f + H), f"{f + H:.0f}", vertical=True)
    u, lz = p.logo_u, f + p.logo_z
    dim(ax, (-8 * u, lz + 5 * u + 3.5), (8 * u, lz + 5 * u + 3.5), f"{16 * u:.0f}", fs=7)
    dim(ax, (8 * u + 5, lz - 5 * u), (8 * u + 5, lz + 5 * u), f"{10 * u:.0f}", vertical=True, fs=7)
    ax.text(-L / 2, f + H + 7, f"ゴム脚{f:.0f} mm込みの高さ。Clawdは別に刷ってはめ込む（1ピクセル＝{u:g}×{2 * u:g} mm）",
            fontsize=8, color=DIM)
    ax.set_xlim(-L / 2 - 8, L / 2 + 16)
    ax.set_ylim(-13, f + H + 12)
    ax.set_title("正面", loc="left", fontsize=11, color=INK)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- cross-section away from the logo ---------------------------------------------
    ax = fig.add_subplot(gs[:, 1])
    xs = 50.0
    section_fill(ax, body, [xs, 0, 0], [1, 0, 0], (1, 2), "#e6dfd0", z=1)
    outline(ax, body, [xs, 0, 0], [1, 0, 0], (1, 2), color=CUT, lw=1.1)
    for m in felts:
        section_fill(ax, m, [xs, 0, 0], [1, 0, 0], (1, 2), FELT, z=2)
    outline(ax, lap, [xs, 0, 0], [1, 0, 0], (1, 2), color=LAP, lw=1.0)
    for i in range(4):
        section_fill(ax, load(f"foot_{i}"), [p.length / 2 - p.feet_inset - 3, 0, 0], [1, 0, 0], (1, 2), "#333333", z=0)
    ax.axhline(0, color=DIM, lw=0.6)
    h, zl = p.slot_w / 2, f + p.laptop_z
    dim(ax, (-D / 2, -8), (D / 2, -8), f"{D:.0f}（倒れにくさは底の広さで決まる）", fs=7)
    dim(ax, (-h, f + H + 5), (h, f + H + 5), f"スロット {p.slot_w:.1f}", offset=(0, 3.2), fs=7)
    dim(ax, (-p.y_top, f + H + 14), (p.y_top, f + H + 14), f"上端の幅 {2 * p.y_top:.1f}", offset=(0, 3.2), fs=7)
    dim(ax, (34, 0), (34, zl), f"{zl:.0f}", offset=(3, 0), vertical=True, fs=7)
    dim(ax, (D / 2 + 2, 0), (D / 2 + 2, f + H), f"{f + H:.0f}", vertical=True, fs=7)
    ax.annotate(f"フェルト {p.felt:g} mm（壁2枚と底1枚）", xy=(h - p.felt / 2, f + H - 12), xytext=(h + 10, f + H + 24),
                fontsize=7, color=INK, arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
    ax.annotate(f"壁 上端{p.wall:g} mm", xy=(p.y_top - 1, f + H - 2), xytext=(p.y_top + 14, f + H + 3),
                fontsize=7, color=INK, arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
    ax.annotate(f"底板 厚さ{p.plate_edge:g}〜{p.plate_root:g} mm", xy=(-D / 2 + 14, f + 3.5), xytext=(-D / 2 + 2, f + 22),
                fontsize=7, color=INK, arrowprops=dict(arrowstyle="-", color=DIM, lw=0.6))
    ax.text(h + 4, f + H + 46, f"{lp.label}（厚さ{lp.thickness} mm）", ha="left", color=LAP, fontsize=8)
    ax.text(29, zl + 5, "机からMacの下端まで", fontsize=7, color=DIM, va="bottom")
    ax.text(0, -19, (
        f"Macとフェルトのすき間は片側{p.fit_play / 2:.2f} mm（フェルトが公称どおりのとき）。\n"
        "ぐらつくなら、フェルトの下にマスキングテープを1枚足す。"), ha="center", va="top", fontsize=8, color=INK)
    ax.set_xlim(-D / 2 - 6, D / 2 + 8)
    ax.set_ylim(-32, f + H + 52)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(f"断面（x = {xs:.0f}）", loc="left", fontsize=11, color=INK)

    fig.suptitle("Claude Code クラムシェルドック　寸法図（単位 mm）", fontsize=13, x=0.02, ha="left", color=INK)
    dst.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(dst, bbox_inches="tight", facecolor="white")


if __name__ == "__main__":
    main()
