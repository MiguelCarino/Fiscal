#!/usr/bin/env python3
"""Regenerate registry/index.json from the system's ISO 3166-1 data.

The country list is not hand-maintained: it comes from the `iso-codes` package
(/usr/share/iso-codes), so the set of jurisdictions is authoritative and the
regeneration is reproducible. Display names are localised at runtime by
Intl.DisplayNames — the English `name` here is only the fallback for engines
that lack it, and is never shown when Intl is available.

Tier is assigned here and nowhere else. Promoting a country means adding its
record under registry/ and moving its code up a list below.

    python3 tools/build_index.py
"""

import json
import pathlib
import datetime

SRC = pathlib.Path("/usr/share/iso-codes/json/iso_3166-1.json")
OUT = pathlib.Path(__file__).resolve().parent.parent / "registry" / "index.json"

# Tier 1 — checksum engine + invoice profile + delivery, verified against the
# authority's own publication. These are the ones with a full record.
TIER1 = {"MX", "CO", "US"}

# Tier 2 — structure and, where a published rule exists, a check digit.
# No invoice-profile guarantees.
TIER2 = {
    "BR", "AR", "CL", "PE", "IN", "JP", "AU", "FR", "GR", "BE",
    "DE", "ES", "IT", "NL", "PT", "PL", "GB", "CA", "ZA",
}


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC} — install the iso-codes package")
        return 1

    rows = json.loads(SRC.read_text(encoding="utf-8"))["3166-1"]
    countries = []
    for row in sorted(rows, key=lambda r: r["alpha_2"]):
        iso = row["alpha_2"]
        countries.append({
            "iso": iso,
            "flag": row.get("flag", ""),
            "name": row["name"],
            "tier": 1 if iso in TIER1 else 2 if iso in TIER2 else 3,
        })

    payload = {
        "generated": datetime.date.today().isoformat(),
        "source": "ISO 3166-1 via the iso-codes package (/usr/share/iso-codes)",
        "note": "Names are localised at runtime by Intl.DisplayNames; `name` is the fallback only.",
        "countries": countries,
    }
    # `generated` records when the jurisdictions last moved, not when somebody
    # last ran this. Stamping today's date over an identical list rewrites the
    # bytes, and sw.js hashes the bytes it precaches, so a run that changed
    # nothing would still ship every existing install a new version of a file
    # nothing in it changed. Regenerating an unchanged list is a no-op.
    body = {k: v for k, v in payload.items() if k != "generated"}
    if OUT.exists():
        try:
            before = json.loads(OUT.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeDecodeError):
            before = None
        if isinstance(before, dict) and {k: v for k, v in before.items()
                                         if k != "generated"} == body:
            payload["generated"] = before.get("generated", payload["generated"])

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    counts = {t: sum(1 for c in countries if c["tier"] == t) for t in (1, 2, 3)}
    print(f"wrote {OUT.relative_to(OUT.parent.parent)} — "
          f"{len(countries)} countries (tier 1: {counts[1]}, tier 2: {counts[2]}, tier 3: {counts[3]}) "
          f"· generated {payload['generated']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
