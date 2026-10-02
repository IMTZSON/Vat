#!/usr/bin/env python3
"""Builds the open datasets bundled in App/Resources/Data.

Usage: python3 Tools/build_data.py <ref-dir>
<ref-dir> must contain clones of:
  vatsimnetwork/vatspy-data-project, vatsimnetwork/simaware-tracon-project,
  davidmegginson/ourairports-data
"""
import csv, json, os, sys, glob, shutil

ref = sys.argv[1] if len(sys.argv) > 1 else "../ref"
out = os.path.join(os.path.dirname(__file__), "..", "App", "Resources", "Data")
os.makedirs(out, exist_ok=True)

def rnd(c):
    if isinstance(c, (int, float)):
        return round(c, 5)
    return [rnd(x) for x in c]

def minify_fc(features, path):
    for f in features:
        g = f.get("geometry") or {}
        if "coordinates" in g:
            g["coordinates"] = rnd(g["coordinates"])
    with open(path, "w") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, separators=(",", ":"))
    print(path, os.path.getsize(path) // 1024, "KB", len(features), "features")

# VATSpy
vs = os.path.join(ref, "vatspy-data-project")
shutil.copy(os.path.join(vs, "VATSpy.dat"), os.path.join(out, "VATSpy.dat"))
fir = json.load(open(os.path.join(vs, "Boundaries.geojson")))
minify_fc(fir["features"], os.path.join(out, "FIRBoundaries.geojson"))

# SimAware TRACON (same as scripts/bin/compile.ts: concatenate every Boundaries/**.json feature)
feats = []
for p in sorted(glob.glob(os.path.join(ref, "simaware-tracon-project", "Boundaries", "**", "*.json"), recursive=True)):
    d = json.load(open(p))
    if d.get("type") == "FeatureCollection":
        feats.extend(d["features"])
    else:
        feats.append(d)
minify_fc(feats, os.path.join(out, "TRACONBoundaries.geojson"))

# OurAirports navaids (public domain): ident,name,type,lat,lon,freq_khz,country
oa = os.path.join(ref, "ourairports-data")
with open(os.path.join(oa, "navaids.csv")) as fh, open(os.path.join(out, "navaids.csv"), "w") as o:
    w = csv.writer(o)
    n = 0
    for r in csv.DictReader(fh):
        if r["type"] not in ("VOR", "VOR-DME", "VORTAC", "TACAN", "NDB", "NDB-DME", "DME"):
            continue
        w.writerow([r["ident"], r["name"], r["type"], round(float(r["latitude_deg"]), 5),
                    round(float(r["longitude_deg"]), 5), r["frequency_khz"], r["iso_country"]])
        n += 1
    print("navaids", n)

# Airport extras for ICAO codes in VATSpy: icao,elevation_ft,iso_country,municipality,scheduled
icaos = set()
section = None
for line in open(os.path.join(vs, "VATSpy.dat"), encoding="utf-8", errors="replace"):
    line = line.strip()
    if line.startswith("["):
        section = line
        continue
    if section == "[Airports]" and line and not line.startswith(";"):
        icaos.add(line.split("|")[0])
with open(os.path.join(oa, "airports.csv")) as fh, open(os.path.join(out, "airport_extras.csv"), "w") as o:
    w = csv.writer(o)
    n = 0
    for r in csv.DictReader(fh):
        code = r["icao_code"] or r["gps_code"] or r["ident"]
        if code not in icaos:
            continue
        w.writerow([code, r["elevation_ft"] or "0", r["iso_country"], r["municipality"],
                    1 if r["scheduled_service"] == "yes" else 0, r["type"]])
        n += 1
    print("airport extras", n)
