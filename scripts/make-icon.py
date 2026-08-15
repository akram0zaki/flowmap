#!/usr/bin/env python3
"""Generates the Flowmap source icon.

The mark is the capacity vessel from docs/design/design-system.md §6, reduced to
what survives at 16 px: a measured container, a hatched reserve plinth holding
the work up, two graphite blocks, and the deliverable-capacity rule they sit
under. Drafting ink on paper.

Run: python3 scripts/make-icon.py
Then: npx tauri icon apps/desktop/src-tauri/icons/source.png
"""

from PIL import Image, ImageDraw

SIZE = 1024

# Tokens, from packages/ui/tokens/tokens.css. Kept in sync by hand — the icon is
# the one surface that cannot read the stylesheet.
ACCENT = (0x24, 0x45, 0x7C, 255)  # --accent, drafting ink
PAPER = (0xFF, 0xFF, 0xFF, 255)  # --surface
GRAPHITE_2 = (0xDC, 0xD8, 0xD0, 255)  # --graphite-2, block fill
GRAPHITE_4 = (0x8C, 0x87, 0x7D, 255)  # --graphite-4, block stroke
INK_MUTED = (0x56, 0x5B, 0x63, 255)  # --ink-muted, the capacity rule


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Rounded ink field. Generous radius so it reads as an app icon rather than
    # a screenshot of a chart.
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=224, fill=ACCENT)

    # The vessel: a paper container inset in the ink.
    margin = 208
    vessel = [margin, margin, SIZE - margin, SIZE - margin]
    draw.rounded_rectangle(vessel, radius=24, fill=PAPER)

    left, top, right, bottom = vessel
    width = right - left
    height = bottom - top

    # Reserve plinth — hatched, at the base, holding everything up.
    plinth_top = bottom - height * 0.26
    draw.rectangle([left, plinth_top, right, bottom], fill=PAPER)
    pitch = 34
    x = left - height
    while x < right + height:
        draw.line(
            [(x, bottom), (x + (bottom - plinth_top), plinth_top)],
            fill=GRAPHITE_4,
            width=9,
        )
        x += pitch
    # Clip the hatch back inside the vessel.
    draw.rectangle([0, 0, left, SIZE], fill=ACCENT)
    draw.rectangle([right, 0, SIZE, SIZE], fill=ACCENT)
    draw.rectangle([0, bottom, SIZE, SIZE], fill=ACCENT)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=224, outline=ACCENT, width=200)

    # Two blocks, stacked from the plinth upward, sized to read as different.
    block_left = left + 44
    block_right = right - 44
    gap = 26

    lower_h = height * 0.24
    lower_top = plinth_top - lower_h
    draw.rounded_rectangle(
        [block_left, lower_top, block_right, plinth_top - 6],
        radius=10,
        fill=GRAPHITE_2,
        outline=GRAPHITE_4,
        width=8,
    )

    upper_h = height * 0.17
    upper_bottom = lower_top - gap
    draw.rounded_rectangle(
        [block_left, upper_bottom - upper_h, block_right, upper_bottom],
        radius=10,
        fill=GRAPHITE_2,
        outline=GRAPHITE_4,
        width=8,
    )

    # The deliverable-capacity rule: the line work must fit under.
    rule_y = top + height * 0.22
    draw.line([(left + 20, rule_y), (right - 20, rule_y)], fill=INK_MUTED, width=14)

    out = "apps/desktop/src-tauri/icons/source.png"
    image.save(out)
    print(f"wrote {out} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
