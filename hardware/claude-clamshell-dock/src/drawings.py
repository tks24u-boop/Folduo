"""Dimensioned drawing sheet (top section, front view, cross-section with a MacBook Pro 14).

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

# Japanese labels; falls back to the default font when Noto Sans CJK is missing
for path in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",):
    if Path(path).exists():
        font_manager.fontManager.addfont(path)
        plt.rcParams["font.family"] = "Noto Sans CJK JP"

from clamshell_dock import LAPTOPS, LINERS, P, liner_gap, liner_height  # noqa: E402

INK, DIM, CUT, LAP, ORANGE = "#1f1f1f", "#6b6b6b", "#8a7f6c", "#5b7fa3", "#d77757"


def outline(ax, mesh, origin, normal, axes, color=INK, lw=1.0, ls="-", z_shift=0.0):
    sec = mesh.section(plane_origin=origin, plane_normal=normal)
    if sec is None:
        return
    for pts in sec.discrete:
        ax.plot(pts[:, axes[0]], pts[:, axes[1]] + z_shift, color=color, lw=lw, ls=ls)


def dim(ax, a, b, text, offset=(0, 0), vertical=False, fs=8):
    """Dimension line between points a and b, label at the middle."""
    (x0, y0), (x1, y1) = a, b
    ax.annotate("", xy=(x0, y0), xytext=(x1, y1), arrowprops=dict(arrowstyle="<->", color=DIM, lw=0.8, shrinkA=0, shrinkB=0))
    mx, my = (x0 + x1) / 2 + offset[0], (y0 + y1) / 2 + offset[1]
    ax.text(mx, my, text, color=INK, fontsize=fs, ha="center", va="center", rotation=90 if vertical else 0,
            bbox=dict(boxstyle="square,pad=0.15", fc="white", ec="none"))


def main() -> None:
    asm, dst = Path(sys.argv[1]), Path(sys.argv[2])
    p = P()
    lift = p.lift
    load = lambda n: trimesh.load(asm / f"assembled__{n}.stl")  # noqa: E731
    body, lap = load("body"), load("laptop")
    liners = [load("liner_0"), load("liner_1")]
    logo = load("logo_orange")
    lp = next(l for l in LAPTOPS if l.key == "pro14")

    fig = plt.figure(figsize=(16, 11), dpi=130)
    gs = fig.add_gridspec(2, 2, width_ratios=[1.35, 1], height_ratios=[1, 1.05], hspace=0.18, wspace=0.08)

    # --- top: plan section at mid height ------------------------------------------
    ax = fig.add_subplot(gs[0, 0])
    zc = lift + 30
    outline(ax, body, [0, 0, zc], [0, 0, 1], (0, 1))
    outline(ax, body, [0, 0, lift + 0.8], [0, 0, 1], (0, 1), color=DIM, lw=0.6, ls="--")
    for m in liners:
        outline(ax, m, [0, 0, zc], [0, 0, 1], (0, 1), color="#333333", lw=1.0)
    L, D = p.length, p.depth
    dim(ax, (-L / 2, -D / 2 - 10), (L / 2, -D / 2 - 10), f"{L:.0f}")
    dim(ax, (L / 2 + 10, -D / 2), (L / 2 + 10, D / 2), f"{D:.0f}", vertical=True)
    dim(ax, (-L / 2 - 8, -p.slot_w / 2), (-L / 2 - 8, p.slot_w / 2), f"スロット {p.slot_w:.0f}", offset=(-9, 0), vertical=True)
    x0 = p.liner_x - p.liner_len / 2
    dim(ax, (x0, p.slot_w / 2 + 7), (x0 + p.liner_len, p.slot_w / 2 + 7), f"TPUライナー {p.liner_len:.0f}")
    dim(ax, (0, -p.slot_w / 2 - 8), (p.liner_x, -p.slot_w / 2 - 8), f"{p.liner_x:.0f}")
    ax.text(0, D / 2 + 6, "高さ30 mmでの断面。破線は底面（脚の凹み4か所とT字のケーブル溝）",
            ha="center", fontsize=8, color=DIM)
    ax.set_xlim(-L / 2 - 30, L / 2 + 22)
    ax.set_ylim(-D / 2 - 18, D / 2 + 12)
    ax.set_title("上面", loc="left", fontsize=11, color=INK)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- front view: filled silhouettes projected on XZ ------------------------------
    ax = fig.add_subplot(gs[1, 0])
    from matplotlib.collections import PolyCollection

    def silhouette(m, color, z=0):
        tris = m.vertices[m.faces][:, :, [0, 2]]
        ax.add_collection(PolyCollection(tris, facecolors=color, edgecolors=color, linewidths=0.2, zorder=z))

    silhouette(body, "#e6dfd0", 1)
    silhouette(logo, ORANGE, 2)
    silhouette(load("logo_eyes"), "#161616", 3)
    for f in range(4):
        silhouette(load(f"foot_{f}"), "#333333", 0)
    ax.axhline(0, color=DIM, lw=0.6)
    dim(ax, (-L / 2, -8), (L / 2, -8), f"{L:.0f}")
    dim(ax, (L / 2 + 8, lift), (L / 2 + 8, lift + p.height), f"{p.height:.0f}", vertical=True)
    u = p.logo_u
    lz = lift + p.logo_z
    dim(ax, (-8 * u, lz + 5 * u + 5), (8 * u, lz + 5 * u + 5), f"{16 * u:.0f}")
    dim(ax, (8 * u + 7, lz - 5 * u), (8 * u + 7, lz + 5 * u), f"{10 * u:.0f}", vertical=True)
    ax.text(-L / 2 + 4, lift + p.height + 8, f"側面の抜き勾配 {p.draft:.0f}°、上端 R{p.r_top:.0f}、下端の面取り {p.ch_bottom}",
            fontsize=8, color=DIM)
    ax.set_xlim(-L / 2 - 10, L / 2 + 20)
    ax.set_ylim(-16, lift + p.height + 16)
    ax.set_title("正面（Clawdのはめ込み：1ピクセル＝2.5×5 mm）", loc="left", fontsize=11, color=INK)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- section through a liner bay with a MacBook Pro 14 -------------------------------
    ax = fig.add_subplot(gs[:, 1])
    xs = p.liner_x + (p.rib_w / 2 + (p.liner_len - 3 * p.rib_w) / 4)
    outline(ax, body, [xs, 0, 0], [1, 0, 0], (1, 2), color=CUT, lw=1.2)
    for m in liners:
        outline(ax, m, [xs, 0, 0], [1, 0, 0], (1, 2), color="#222222", lw=1.0)
    outline(ax, lap, [xs, 0, 0], [1, 0, 0], (1, 2), color=LAP, lw=1.0)
    for f in range(4):
        outline(ax, load(f"foot_{f}"), [xs, 0, 0], [1, 0, 0], (1, 2), color="#222222", lw=1.0)
    ax.axhline(0, color=DIM, lw=0.6)
    t_nom = LINERS["pro14"][0]
    gap = liner_gap(p, t_nom) - 2 * p.bump_r
    z_lap = lift + p.laptop_z
    dim(ax, (-p.slot_w / 2, lift + p.height + 6), (p.slot_w / 2, lift + p.height + 6), f"スロット {p.slot_w:.0f}")
    dim(ax, (-gap / 2, z_lap + 25), (gap / 2, z_lap + 25), f"リブ間 {gap:.2f}\n(MBP14 {lp.thickness})", fs=7)
    dim(ax, (p.slot_w / 2 + 16, 0), (p.slot_w / 2 + 16, z_lap), f"{z_lap:.1f}", vertical=True)
    dim(ax, (p.slot_w / 2 + 26, 0), (p.slot_w / 2 + 26, lift + p.height), f"{lift + p.height:.1f}", vertical=True)
    dim(ax, (-p.ch_w / 2, lift - 5), (p.ch_w / 2, lift - 5), f"ケーブル溝 幅{p.ch_w:.0f}・45°屋根", offset=(0, -4))
    hz = liner_height(p)
    dim(ax, (-p.slot_w / 2 - 6, lift + p.z_floor), (-p.slot_w / 2 - 6, lift + p.z_floor + hz), f"ライナー {hz:.0f}", vertical=True)
    ax.text(0, lift + p.height + 22, "MacBook Pro 14を立てた状態", ha="center", color=LAP, fontsize=8)
    ax.text(-38, 4, "机", color=DIM, fontsize=8)
    ax.text(0, -16, (
        "TPUライナー：厚さ1.2 mmの膜の裏に0.8 mmの空気層。\n"
        "片側4本のリブがMacに0.03〜0.13 mmだけ触れ、\n"
        "Macを抜くときにドックが持ち上がらない軽さにしてある。"), ha="center", va="top", fontsize=8, color=INK)
    ax.set_xlim(-45, 45)
    ax.set_ylim(-40, lift + p.height + 40)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(f"断面（ライナーのリブ位置 x = {xs:.1f}）", loc="left", fontsize=11, color=INK)

    fig.suptitle("Claude Code クラムシェルドック　寸法図（単位 mm）", fontsize=13, x=0.02, ha="left", color=INK)
    dst.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(dst, bbox_inches="tight", facecolor="white")


if __name__ == "__main__":
    main()
