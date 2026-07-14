#!/usr/bin/env python
"""Convert the astronexus HYG database CSV into a compact brightstars.json.

Source: HYG Database (astronexus), https://github.com/astronexus/HYG-Database
License: CC BY-SA 4.0.

Output: array-of-arrays [x, y, z, mag, ci] where x/y/z is a unit direction in
the app's frame (ecliptic plane = XZ, +Y = ecliptic north). Only stars with
visual magnitude <= 6.5 are kept.
"""
import csv, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "hygdata_v41.csv")
OUT = os.path.join(HERE, "brightstars.json")

MAG_LIMIT = 6.5
EPS = math.radians(23.4393)  # obliquity of the ecliptic
cosE, sinE = math.cos(EPS), math.sin(EPS)

stars = []
with open(SRC, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row.get("id") == "0":  # the Sun
            continue
        try:
            mag = float(row["mag"])
        except (ValueError, KeyError):
            continue
        if mag > MAG_LIMIT:
            continue
        try:
            x = float(row["x"]); y = float(row["y"]); z = float(row["z"])
        except (ValueError, KeyError):
            continue
        r = math.sqrt(x * x + y * y + z * z)
        if r == 0.0:  # the Sun (id 0) sits at the origin -> skip
            continue
        x /= r; y /= r; z /= r
        # Equatorial -> ecliptic: rotate about X by the obliquity.
        xe = x
        ye = y * cosE + z * sinE
        ze = -y * sinE + z * cosE  # ecliptic north component
        # App frame: ecliptic plane is XZ, +Y is ecliptic north.
        ax, ay, az = xe, ze, ye
        try:
            ci = float(row["ci"])
        except (ValueError, KeyError):
            ci = 0.0
        stars.append([
            round(ax, 4), round(ay, 4), round(az, 4),
            round(mag, 2), round(ci, 3),
        ])

with open(OUT, "w") as f:
    json.dump(stars, f, separators=(",", ":"))

size = os.path.getsize(OUT)
print(f"stars: {len(stars)}")
print(f"output: {OUT} ({size} bytes, {size/1024:.1f} KB)")
