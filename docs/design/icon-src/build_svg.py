#!/usr/bin/env python3
"""Emit the Gear6 icon masters as SVG.

Palette is Design.md's Cobalt and Bone. Every hex below is asserted against
the token list at the bottom of this file, so an invented colour fails the
build rather than shipping.

Geometry, cap height 64 (-32..32), stroke 12:
  G  ring r26 at (-25, 0), open -30deg..+30deg, bar and spur on the midline
  6  bowl r15 at (36, 11); the shoulder is one arc that lands on the bowl's
     leftmost point, where both tangents are vertical, so the join is smooth
     and the terminal cap is buried inside the bowl's own stroke
Below 32px the pair is two smudges, so that cut is the G alone at stroke 20.
"""
import math
import pathlib
import re
import sys

OUT = pathlib.Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

# --- Design.md tokens ------------------------------------------------------
COBALT = "#2451b8"        # {colors.surface-cobalt} / {colors.primary}
BONE = "#f1efe9"          # {colors.canvas-bone}
MIST = "#e6ecf9"          # {colors.canvas-mist}
ON_COBALT_MUTE = "#b8c6e8"  # {colors.on-cobalt-mute}

GROUND = COBALT
MARK = BONE

# Design.md's decorative depth: "warm bone, cobalt mist, and a pale slate stop
# blurred together at large radii". Baked as SVG gradients — an .icns cannot
# carry a stylesheet, and a flat fill loses the depth the brand asks for.
MESH = f"""
  <defs>
    <radialGradient id="m1" gradientUnits="userSpaceOnUse" cx="-70" cy="-84" r="150">
      <stop offset="0" stop-color="{BONE}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="{BONE}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="m2" gradientUnits="userSpaceOnUse" cx="46" cy="-96" r="152">
      <stop offset="0" stop-color="{MIST}" stop-opacity="0.17"/>
      <stop offset="1" stop-color="{MIST}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="m3" gradientUnits="userSpaceOnUse" cx="96" cy="90" r="150">
      <stop offset="0" stop-color="{ON_COBALT_MUTE}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="{ON_COBALT_MUTE}" stop-opacity="0"/>
    </radialGradient>
  </defs>"""


def ground():
    r = '<rect x="-84" y="-84" width="168" height="168"'
    return (
        f'{r} fill="{GROUND}"/>'
        f'{r} fill="url(#m1)"/>'
        f'{r} fill="url(#m2)"/>'
        f'{r} fill="url(#m3)"/>'
    )


# The shoulder arc: ends at the bowl's leftmost point (-15, 11) arriving
# vertically, which forces its centre onto y=11. Solving through (7, -26)
# gives centre x 27.11 and radius 42.11 — so the two curves share a tangent
# and the seam disappears.
SIX = (
    '<circle cx="0" cy="11" r="15"/>'
    '<path d="M 7,-26 A 42.11,42.11 0 0 0 -15,11"/>'
)

PAIR = f"""
  <g fill="none" stroke="{MARK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <g transform="translate(-25,0)">
      <path d="M 22.52,13 A 26,26 0 1 1 22.52,-13"/>
      <path d="M 6,0 L 22.52,0 L 22.52,13"/>
    </g>
    <g transform="translate(36,0)">{SIX}</g>
  </g>"""

GONLY = f"""
  <g fill="none" stroke="{MARK}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 38.97,22.5 A 45,45 0 1 1 38.97,-22.5"/>
    <path d="M 10,0 L 38.97,0 L 38.97,22.5"/>
  </g>"""


def superellipse(half, n=5.0, steps=360):
    """macOS masks icons with a squircle, not a rounded rectangle."""
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = half * math.copysign(abs(c) ** (2.0 / n), c)
        y = half * math.copysign(abs(s) ** (2.0 / n), s)
        pts.append(f"{x:.3f},{y:.3f}")
    return "M " + " L ".join(pts) + " Z"


def svg(body, defs=MESH):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-84 -84 168 168" '
        'width="168" height="168" role="img" aria-label="Gear6">'
        f"{defs}{body}</svg>\n"
    )


files = {}
files["square-pair.svg"] = svg(ground() + PAIR)
files["square-g.svg"] = svg(ground() + GONLY)

HALF = 168 * (824 / 1024) / 2  # Apple's content inset: 824 of 1024
mac_defs = MESH.replace(
    "</defs>", f'<clipPath id="sq"><path d="{superellipse(HALF)}"/></clipPath></defs>'
)
files["mac-pair.svg"] = svg(
    f'<g clip-path="url(#sq)">{ground()}</g><g transform="scale(0.82)">{PAIR}</g>', mac_defs
)
files["mac-g.svg"] = svg(
    f'<g clip-path="url(#sq)">{ground()}</g><g transform="scale(0.82)">{GONLY}</g>', mac_defs
)
files["favicon.svg"] = svg(ground() + GONLY)

# The in-app mark: no ground, currentColor, so it tints with its context —
# which the raster it replaces could not do.
files["mark-currentcolor.svg"] = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -40 128 80" '
    'fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" '
    'stroke-linejoin="round" role="img" aria-label="Gear6">'
    '<g transform="translate(-25,0)">'
    '<path d="M 22.52,13 A 26,26 0 1 1 22.52,-13"/>'
    '<path d="M 6,0 L 22.52,0 L 22.52,13"/></g>'
    f'<g transform="translate(36,0)">{SIX}</g></svg>\n'
)

# --- guard: no colour that Design.md does not name -------------------------
DESIGN_MD = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "Design.md")
assert DESIGN_MD.exists(), f"Design.md not found at {DESIGN_MD}"
ALLOWED = {h.lower() for h in re.findall(r"#[0-9a-fA-F]{6}", DESIGN_MD.read_text())}
assert ALLOWED, "no colours found in Design.md"

for name, text in files.items():
    for hex_used in re.findall(r"#[0-9a-fA-F]{6}", text):
        assert hex_used.lower() in ALLOWED, (
            f"{name}: {hex_used} is not a Design.md token. "
            "Every colour in the icon must come from the palette."
        )
    (OUT / name).write_text(text)

print(f"wrote {len(files)} masters; all colours verified against Design.md")
