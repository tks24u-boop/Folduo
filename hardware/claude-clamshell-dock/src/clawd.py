"""Clawd, the Claude Code mascot, as exact 2D geometry.

The sprite is taken from the welcome screen that the Claude Code CLI draws with
Unicode quadrant blocks (@anthropic-ai/claude-code 2.0.77, cli.js):

     ▐▛███▜▌        colour "clawd_body"       = rgb(215,119,87)
    ▝▜█████▛▘       colour "clawd_background" = rgb(0,0,0)  (the two eyes)
      ▘▘ ▝▝

Each character cell holds 2x2 quadrants and a terminal cell is twice as tall as
it is wide, so one quadrant is u wide and 2u tall. The whole figure is 16u x 10u.
The same proportions are used by the "Claude Code" icon in @lobehub/icons.

Rows are counted from the top, columns are quadrant columns 1..16.
"""

from build123d import Pos, Rectangle, Sketch

# (row, [(first_col, last_col), ...]) of filled quadrants, eyes excluded
CLAWD_ROWS = [
    (0, [(3, 14)]),
    (1, [(3, 4), (6, 11), (13, 14)]),
    (2, [(1, 16)]),  # arms
    (3, [(3, 14)]),
    (4, [(4, 4), (6, 6), (11, 11), (13, 13)]),  # legs
]
CLAWD_EYES = [(1, 5), (1, 12)]

CLAWD_ORANGE_HEX = "#D77757"  # rgb(215,119,87) from the CLI theme
CLAWD_EYE_HEX = "#000000"


def _cell(u: float, row: int, c0: int, c1: int) -> Rectangle:
    x0 = (c0 - 1) * u - 8 * u
    x1 = c1 * u - 8 * u
    y1 = 5 * u - row * 2 * u
    y0 = y1 - 2 * u
    return Pos((x0 + x1) / 2, (y0 + y1) / 2) * Rectangle(x1 - x0, y1 - y0)


def clawd_sketches(u: float) -> tuple[Sketch, Sketch, Sketch]:
    """Return (outline, body_without_eyes, eyes), centred on the origin.

    outline: silhouette including the eyes (used for the pocket / insert)
    body:    orange area with two eye holes
    eyes:    the two eye rectangles
    """
    body = [_cell(u, r, a, b) for r, spans in CLAWD_ROWS for a, b in spans]
    eyes = [_cell(u, r, c, c) for r, c in CLAWD_EYES]
    return Sketch() + body + eyes, Sketch() + body, Sketch() + eyes


def clawd_size(u: float) -> tuple[float, float]:
    return 16 * u, 10 * u
