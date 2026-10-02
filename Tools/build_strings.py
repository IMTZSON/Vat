#!/usr/bin/env python3
"""Builds the String Catalogs (Localizable.xcstrings) for App/, Widgets/, Watch/, WatchWidgets/.

- Extracts user-facing literals from SwiftUI call sites (Text, Label, Button, navigationTitle,
  String(localized:), LocalizedStringKey parameters, …).
- Interpolations become format specifiers: `%lld` for integer-looking expressions, `%@` otherwise
  (Xcode re-validates and updates the catalog on the first build; mismatches simply fall back to
  English, they never crash).
- Italian translations come from Tools/translations/*.json ({ "English key": "Traduzione" }).
- Keys with no Italian translation are still listed (English is the development language).

Usage: python3 Tools/build_strings.py [--report-missing]
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TARGETS = {"App": "App/Resources/Localizable.xcstrings", "Widgets": "Widgets/Localizable.xcstrings",
           "Watch": "Watch/Localizable.xcstrings", "WatchWidgets": "WatchWidgets/Localizable.xcstrings"}
CALLS = [
    r"Text", r"Label", r"Button", r"\.navigationTitle", r"Section", r"Toggle", r"Picker", r"TextField",
    r"SecureField", r"LabeledContent", r"ContentUnavailableView", r"Link", r"Tab", r"Menu", r"Stepper",
    r"DatePicker", r"\.help", r"\.accessibilityLabel", r"\.accessibilityHint", r"\.accessibilityValue",
    r"\.alert", r"\.confirmationDialog", r"String\(localized:", r"LocalizedStringKey\(", r"LocalizedStringResource\(",
    r"SectionHeader", r"EmptyStateView\(title:", r"MetricTile\(title:", r"\.badge", r"ShareLink", r"NavigationLink",
    r"\.searchable\(text: [^,]+, prompt:", r"title:", r"message:", r"subtitle:", r"actionTitle:", r"\.navigationSubtitle",
]
STRING = r'"((?:[^"\\\n]|\\.)*)"'
CALL_RE = re.compile(r"(?:" + "|".join(CALLS) + r")\s*\(?\s*" + STRING)
INTERP = re.compile(r"\\\(([^()]*(?:\([^()]*\)[^()]*)*)\)")
INT_HINT = re.compile(r"(count|Count|cid|CID|minutes|hours|number|Int\(|index|total|score|rank|days|flights|points|level|altitude|speed|knots|\.rawValue == 0)")


def to_key(literal):
    def repl(m):
        expr = m.group(1)
        if "specifier:" in expr:
            spec = re.search(r'specifier:\s*"([^"]+)"', expr)
            return spec.group(1) if spec else "%@"
        return "%lld" if INT_HINT.search(expr) and "format" not in expr and "String(" not in expr else "%@"
    key = INTERP.sub(repl, literal)
    return key.replace('\\"', '"').replace("\\n", "\n")


def extract(folder):
    keys = set()
    for dirpath, _, files in os.walk(os.path.join(ROOT, folder)):
        for f in files:
            if not f.endswith(".swift"):
                continue
            src = open(os.path.join(dirpath, f), encoding="utf-8").read()
            for m in CALL_RE.finditer(src):
                lit = m.group(1)
                if not lit.strip() or re.fullmatch(r"[\W\d_]*", lit) or lit.startswith(("http", "systemImage")):
                    continue
                if re.fullmatch(r"[a-z]+(\.[a-z]+)+", lit):  # SF Symbol names
                    continue
                keys.add(to_key(lit))
    return keys


def main():
    it = {}
    tdir = os.path.join(ROOT, "Tools", "translations")
    for name in sorted(os.listdir(tdir)) if os.path.isdir(tdir) else []:
        if name.endswith(".json"):
            it.update(json.load(open(os.path.join(tdir, name), encoding="utf-8")))
    missing_all = set()
    for folder, out in TARGETS.items():
        if not os.path.isdir(os.path.join(ROOT, folder)):
            continue
        keys = extract(folder)
        if folder == "App":
            keys |= {k for k in it if k.startswith("Contrail")}
        strings = {}
        for k in sorted(keys):
            entry = {}
            if k in it:
                entry["localizations"] = {"it": {"stringUnit": {"state": "translated", "value": it[k]}}}
            else:
                missing_all.add(k)
            strings[k] = entry
        catalog = {"sourceLanguage": "en", "strings": strings, "version": "1.0"}
        path = os.path.join(ROOT, out)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(catalog, fh, ensure_ascii=False, indent=2, sort_keys=True)
        print(f"{out}: {len(keys)} keys, {sum(1 for k in keys if k in it)} translated")
    if "--report-missing" in sys.argv:
        for k in sorted(missing_all):
            print("MISSING:", json.dumps(k, ensure_ascii=False))


if __name__ == "__main__":
    main()
