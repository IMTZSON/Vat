#!/usr/bin/env python3
"""Minimal OpenStep-plist parser to sanity-check Contrail.xcodeproj/project.pbxproj:
syntax, and that every 24-hex object reference points at an existing object."""
import re, sys
src = open(sys.argv[1] if len(sys.argv) > 1 else "Contrail.xcodeproj/project.pbxproj").read()
src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
src = re.sub(r"^//.*$", "", src, flags=re.M)
i = 0
def ws():
    global i
    while i < len(src) and src[i] in " \t\r\n": i += 1
def value():
    global i
    ws()
    c = src[i]
    if c == "{":
        i += 1; d = {}
        while True:
            ws()
            if src[i] == "}": i += 1; return d
            k = scalar(); ws(); assert src[i] == "=", f"expected = at {i}: {src[i-30:i+30]!r}"; i += 1
            d[k] = value(); ws(); assert src[i] == ";", f"expected ; at {i}: {src[i-30:i+30]!r}"; i += 1
    if c == "(":
        i += 1; a = []
        while True:
            ws()
            if src[i] == ")": i += 1; return a
            a.append(value()); ws()
            if src[i] == ",": i += 1
            else: ws(); assert src[i] == ")", f"expected , or ) at {i}"
    return scalar()
def scalar():
    global i
    ws()
    if src[i] == '"':
        j = i + 1; out = ""
        while src[j] != '"':
            if src[j] == "\\": out += src[j+1]; j += 2
            else: out += src[j]; j += 1
        i = j + 1; return out
    m = re.match(r"[A-Za-z0-9_$./:-]+", src[i:])
    assert m, f"bad token at {i}: {src[i:i+40]!r}"
    i += m.end(); return m.group(0)
root = value()
objs = root["objects"]
missing = set()
def walk(v):
    if isinstance(v, dict):
        for x in v.values(): walk(x)
    elif isinstance(v, list):
        for x in v: walk(x)
    elif isinstance(v, str) and re.fullmatch(r"[0-9A-F]{24}", v) and v not in objs:
        missing.add(v)
walk(objs); walk(root["rootObject"])
print("objects:", len(objs), "missing refs:", missing or "none")
isas = {}
for o in objs.values(): isas[o["isa"]] = isas.get(o["isa"], 0) + 1
print(isas)
sys.exit(1 if missing else 0)
