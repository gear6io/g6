#!/usr/bin/env python3
"""Build the render job list.

The one rule that matters: below 32px the pair is two smudges, so anything
smaller takes the G-alone cut. Everything at 32 and up gets the pair.
"""
import json
import pathlib
import sys

FE = pathlib.Path("/Users/asthajyoti/code/gear6/frontend")
ICONS = FE / "src-tauri" / "icons"
PUBLIC = FE / "public"
STAGE = pathlib.Path(sys.argv[1])

CUT = 32  # below this, G only


def square(size):
    return "square-g.svg" if size < CUT else "square-pair.svg"


def mac(size):
    return "mac-g.svg" if size < CUT else "mac-pair.svg"


jobs = []


def add(svg, size, out):
    jobs.append({"svg": svg, "size": size, "out": str(out)})


# --- tauri desktop PNGs (square, full bleed) --------------------------------
for name, size in [
    ("32x32.png", 32),
    ("64x64.png", 64),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("Square30x30Logo.png", 30),
    ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71),
    ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    ("StoreLogo.png", 50),
]:
    add(square(size), size, ICONS / name)

add("mac-pair.svg", 512, ICONS / "icon.png")

# --- the .icns iconset (macOS squircle, transparent margin) -----------------
for slug, size in [
    ("16x16", 16),
    ("16x16@2x", 32),
    ("32x32", 32),
    ("32x32@2x", 64),
    ("128x128", 128),
    ("128x128@2x", 256),
    ("256x256", 256),
    ("256x256@2x", 512),
    ("512x512", 512),
    ("512x512@2x", 1024),
]:
    add(mac(size), size, STAGE / "Gear6.iconset" / f"icon_{slug}.png")

# --- .ico members (square, Windows draws its own chrome) --------------------
for size in [16, 24, 32, 48, 64, 128, 256]:
    add(square(size), size, STAGE / "ico" / f"{size}.png")

# --- public/ raster referenced by the app ----------------------------------
add("square-pair.svg", 128, PUBLIC / "app-icon@2x.png")
add("square-pair.svg", 192, PUBLIC / "app-icon@3x.png")

# --- masters kept alongside the sources ------------------------------------
add("square-pair.svg", 1024, ICONS / "g6-source.png")

pathlib.Path(sys.argv[2]).write_text(json.dumps(jobs, indent=1))
print(f"{len(jobs)} render jobs")
