#!/usr/bin/env python3
"""Generates the Flowmap source icon.

The mark is the same current-as-an-F as `apps/desktop/src/components/FlowmapMark.tsx`,
drawn in paper on a drafting-ink field so it reads on a dock at 16 px. Keep the
path here in lockstep with the SVG.

Run: python3 scripts/make-icon.py
Then: pnpm exec tauri icon apps/desktop/src-tauri/icons/source.png
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
# 2× then downscale — a 3.2-unit stroke at 1024 needs the extra samples or
# the round caps facet.
RENDER = SIZE * 2

# Tokens, from packages/ui/tokens/tokens.css. The icon cannot read the sheet.
ACCENT = (0x24, 0x45, 0x7C, 255)  # --accent
PAPER = (0xFF, 0xFF, 0xFF, 255)  # --surface

# Same viewBox as FlowmapMark. The 32-unit square fills the icon; rx 7/32
# is the same 224 px corner used on the previous field.
VIEW = 32.0
SCALE = RENDER / VIEW
STROKE = 3.2 * SCALE
FIELD_RADIUS = 7 * SCALE

# Identical to FlowmapMark.tsx — edit both.
MARK = """
M13.4 11.7
H22.5
A3.2 3.2 0 0 0 22.5 5.3
H9.6
A2.65 2.65 0 0 0 6.95 7.95
V23.7
A2.65 2.65 0 0 0 12.25 23.7
V16
C17.2 16.6 21.4 19.5 27 16.2
"""

OUT = Path("apps/desktop/src-tauri/icons/source.png")


def cubic(p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float], p3: tuple[float, float], steps: int = 48) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def svg_arc(
    x1: float,
    y1: float,
    rx: float,
    ry: float,
    x2: float,
    y2: float,
    large: int,
    sweep: int,
    steps: int = 48,
) -> list[tuple[float, float]]:
    """Endpoint-parameterized SVG arc (circles in this mark)."""
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [(x1, y1), (x2, y2)]
    dx = (x1 - x2) / 2
    dy = (y1 - y2) / 2
    lam = dx**2 / rx**2 + dy**2 / ry**2
    if lam > 1:
        s = math.sqrt(lam)
        rx *= s
        ry *= s
    sign = -1 if large == sweep else 1
    num = rx**2 * ry**2 - rx**2 * dy**2 - ry**2 * dx**2
    den = rx**2 * dy**2 + ry**2 * dx**2
    coef = sign * math.sqrt(max(0.0, num / den))
    cxp = coef * rx * dy / ry
    cyp = coef * -ry * dx / rx
    cx = cxp + (x1 + x2) / 2
    cy = cyp + (y1 + y2) / 2

    def ang(ux: float, uy: float, vx: float, vy: float) -> float:
        return math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)

    theta1 = ang(1, 0, (x1 - cx) / rx, (y1 - cy) / ry)
    dtheta = ang((x1 - cx) / rx, (y1 - cy) / ry, (x2 - cx) / rx, (y2 - cy) / ry)
    if sweep == 0 and dtheta > 0:
        dtheta -= 2 * math.pi
    elif sweep == 1 and dtheta < 0:
        dtheta += 2 * math.pi
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = theta1 + dtheta * i / steps
        pts.append((cx + rx * math.cos(t), cy + ry * math.sin(t)))
    return pts


def densify(pts: list[tuple[float, float]], spacing: float) -> list[tuple[float, float]]:
    """Evenly space points so a stamped brush does not gap on long segments."""
    if len(pts) < 2:
        return pts
    out: list[tuple[float, float]] = [pts[0]]
    for i in range(1, len(pts)):
        x0, y0 = out[-1]
        x1, y1 = pts[i]
        dist = math.hypot(x1 - x0, y1 - y0)
        if dist == 0:
            continue
        steps = max(1, math.ceil(dist / spacing))
        for s in range(1, steps + 1):
            t = s / steps
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    return out


def mark_points() -> list[tuple[float, float]]:
    x, y = 13.4, 11.7
    pts: list[tuple[float, float]] = [(x, y)]
    x = 22.5
    pts.append((x, y))
    arc = svg_arc(x, y, 3.2, 3.2, 22.5, 5.3, 0, 0)
    pts.extend(arc[1:])
    x, y = 22.5, 5.3
    x = 9.6
    pts.append((x, y))
    arc = svg_arc(x, y, 2.65, 2.65, 6.95, 7.95, 0, 0)
    pts.extend(arc[1:])
    x, y = 6.95, 7.95
    y = 23.7
    pts.append((x, y))
    arc = svg_arc(x, y, 2.65, 2.65, 12.25, 23.7, 0, 0)
    pts.extend(arc[1:])
    x, y = 12.25, 23.7
    y = 16.0
    pts.append((x, y))
    pts.extend(cubic((x, y), (17.2, 16.6), (21.4, 19.5), (27.0, 16.2))[1:])
    return pts


def main() -> None:
    image = Image.new("RGBA", (RENDER, RENDER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([0, 0, RENDER - 1, RENDER - 1], radius=FIELD_RADIUS, fill=ACCENT)

    # Stamp a disc along the path. Pillow's wide `line()` facets on curves.
    r = STROKE / 2
    mapped = densify([(px * SCALE, py * SCALE) for px, py in mark_points()], spacing=2.0)
    for x, y in mapped:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=PAPER)

    icon = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT)
    print(f"wrote {OUT} ({SIZE}×{SIZE})")


if __name__ == "__main__":
    main()
