#!/usr/bin/env python3
"""Gate on the registry. Run in CI; a non-zero exit means do not ship.

The registry is the product, so the failure mode that matters is not a broken
build — it is a jurisdiction record that quietly claims more authority than it
has. Everything checked here is about that: a record must declare where it was
verified from and when, must only name engines that exist, and must sit at a
tier its contents can actually support.

    python3 tools/validate.py
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REG = ROOT / "registry"

# Must match the keys exported by js/engines.js. Kept as a literal on purpose:
# if someone adds an engine to the JS, this list is the second place they are
# forced to think about it.
ENGINES = {
    "mod11-weighted", "luhn-modN", "mod9", "mod89", "mod97",
    "mod511", "pow2-weighted", "mx-rfc", "structural",
}

MAPS = {"dian", "lt2-zero", "sub11-k", "sub11", "peru"}

errors: list[str] = []
warnings: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"{where}: {msg}")


def warn(where: str, msg: str) -> None:
    warnings.append(f"{where}: {msg}")


def check_checksum(where: str, spec: dict) -> None:
    engine = spec.get("engine")
    if engine not in ENGINES:
        err(where, f"unknown engine {engine!r} — not exported by js/engines.js")
        return

    if engine == "mod11-weighted":
        if "weights" not in spec and "cycle" not in spec:
            err(where, "mod11-weighted needs either `weights` or `cycle`")
        if spec.get("map") not in MAPS:
            err(where, f"unknown remainder map {spec.get('map')!r}")
        digits = spec.get("digits", 1)
        weights = spec.get("weights")
        if digits == 2 and weights and not isinstance(weights[0], list):
            err(where, "digits=2 needs one weight vector per pass (array of arrays)")
        if digits == 1 and weights and isinstance(weights[0], list):
            err(where, "digits=1 takes a flat weight vector")


def check_record(path: pathlib.Path, index_tier: dict) -> None:
    where = path.name
    try:
        rec = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        err(where, f"invalid JSON — {exc}")
        return

    iso = rec.get("iso", "")
    if not re.fullmatch(r"[A-Z]{2}", iso):
        err(where, f"iso must be an ISO 3166-1 alpha-2 code, got {iso!r}")
    if path.stem.upper() != iso:
        err(where, f"filename does not match iso {iso!r}")

    tier = rec.get("tier")
    if tier not in (1, 2, 3):
        err(where, f"tier must be 1, 2 or 3, got {tier!r}")
    elif index_tier.get(iso) != tier:
        err(where, f"tier {tier} disagrees with index.json ({index_tier.get(iso)}) "
                   f"— fix TIER1/TIER2 in tools/build_index.py and regenerate")

    # Provenance. This is the whole point of the gate: a record with no source
    # is an assertion, not a record.
    verified = rec.get("verified") or {}
    if not verified.get("src"):
        err(where, "verified.src is required — every record cites the authority it came from")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(verified.get("on", ""))):
        err(where, "verified.on must be an ISO date")
    if not rec.get("authority"):
        err(where, "authority is required")

    # Peppol and e-invoicing describe the world outside this repo, so they are
    # held to the same provenance rule as a checksum: cite it or drop it.
    STATUSES = {"mandatory", "scheduled", "partial", "none"}
    ein = rec.get("einvoicing")
    if ein is not None:
        if ein.get("status") not in STATUSES:
            err(where, f"einvoicing.status must be one of {sorted(STATUSES)}, got {ein.get('status')!r}")
        if not ein.get("src"):
            err(where, "einvoicing needs a src")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(ein.get("verified", ""))):
            err(where, "einvoicing.verified must be an ISO date")
        if ein.get("status") == "scheduled" and not ein.get("from"):
            err(where, "einvoicing.status 'scheduled' needs a `from` date")
        if ein.get("from") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(ein["from"])):
            err(where, "einvoicing.from must be an ISO date")

    pep = rec.get("peppol")
    if pep is not None:
        if not re.fullmatch(r"[0-9]{4}", str(pep.get("eas", ""))):
            err(where, "peppol.eas must be a four-digit EAS scheme code")
        if not pep.get("src"):
            err(where, "peppol needs a src")

    identifiers = rec.get("identifiers") or []
    if not identifiers:
        err(where, "at least one identifier is required")

    keys = set()
    checked_any = False
    for ident in identifiers:
        key = ident.get("key")
        iwhere = f"{where}[{key}]"
        if not key:
            err(iwhere, "identifier needs a key")
        if key in keys:
            err(iwhere, "duplicate identifier key")
        keys.add(key)
        if not ident.get("label"):
            err(iwhere, "identifier needs a label")

        fmt = ident.get("format")
        if not fmt:
            err(iwhere, "identifier needs a format regex")
        else:
            try:
                re.compile(fmt)
            except re.error as exc:
                err(iwhere, f"format is not a valid regex — {exc}")

        spec = ident.get("checksum") or {"engine": "structural"}
        check_checksum(iwhere, spec)
        if spec.get("engine") != "structural":
            checked_any = True

    # Tier 1 promises a verified invoice profile; tier 2 promises structure.
    if tier == 1:
        profile = rec.get("invoiceProfile") or {}
        for kind in ("personal", "business"):
            if not (profile.get(kind) or {}).get("required"):
                err(where, f"tier 1 needs invoiceProfile.{kind}.required")
        if not rec.get("delivery"):
            err(where, "tier 1 needs a delivery list")

    if tier in (1, 2) and not checked_any:
        warn(where, "no arithmetic check on any identifier — correct if the authority "
                    "publishes none, but confirm before leaving it at this tier")

    # Cross-check that every field named by a profile is definable.
    fields = set(rec.get("fields") or {})
    catalogues = set(rec.get("catalogues") or {})
    generic = {"legalName", "address", "email", "nombre", "razonSocial"}
    for kind, prof in (rec.get("invoiceProfile") or {}).items():
        if not isinstance(prof, dict):
            continue
        for field in (prof.get("required") or []) + (prof.get("optional") or []):
            if field not in keys | fields | catalogues | generic:
                err(where, f"invoiceProfile.{kind} names unknown field {field!r}")


def main() -> int:
    index_path = REG / "index.json"
    if not index_path.exists():
        print("registry/index.json missing — run tools/build_index.py")
        return 1

    index = json.loads(index_path.read_text(encoding="utf-8"))
    index_tier = {c["iso"]: c["tier"] for c in index["countries"]}

    records = sorted(p for p in REG.glob("*.json") if p.name != "index.json")
    for path in records:
        check_record(path, index_tier)

    # Every tier 1 or 2 country in the index must have a record, and vice versa.
    have = {p.stem.upper() for p in records}
    promised = {iso for iso, t in index_tier.items() if t in (1, 2)}
    for iso in sorted(promised - have):
        errors.append(f"index.json: {iso} is tier {index_tier[iso]} but registry/{iso.lower()}.json is missing")
    for iso in sorted(have - promised):
        errors.append(f"registry/{iso.lower()}.json exists but index.json has {iso} at tier 3")

    for line in warnings:
        print(f"warn  {line}")
    for line in errors:
        print(f"ERROR {line}")

    tiers = {t: sum(1 for v in index_tier.values() if v == t) for t in (1, 2, 3)}
    print(f"\n{len(records)} records · {len(index_tier)} jurisdictions "
          f"(tier 1: {tiers[1]}, tier 2: {tiers[2]}, tier 3: {tiers[3]}) "
          f"· {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
