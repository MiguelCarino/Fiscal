#!/usr/bin/env python3
"""Gate on the registry. Run in CI; a non-zero exit means do not ship.

The registry is the product, so the failure mode that matters is not a broken
build — it is a jurisdiction record that quietly claims more authority than it
has. Everything checked here is about that: a record must declare where it was
verified from and when, must only name engines that exist, and must sit at a
tier its contents can actually support.

Shape is the cheap half. The half that matters is correctness, and the only
implementation of the check rules is js/engines.js, so this script executes it:
registry/fixtures.json holds reference values per identifier, bucketed by the
status validate() must return for them, and every one of them is run through
node before the gate passes. A regex that starts rejecting a real number, a
weight vector that drifts, or a placeholder that starts validating fails the
build instead of shipping. Alongside the status buckets it pins two things a
status cannot say: `expected`, the check character the badge offers back, which
must be right or absent and never a guess; and `weak`, the caveat that says the
authority's own rule matched but cannot catch every single-character typo. A
`fields` section does the same for Engines.checkField, and demo.json is held to
the registry's rule as well, because a sample card wearing a red badge teaches
the opposite of what the app does.

Two things can be wrong and they are not the same thing. A record that claims
more than it can support is wrong data and the fix is to go and correct it. A
generated artefact whose inputs have moved on is stale, and the fix is to run
the generator — which is the last step of the release, not a defect in the tree.
Every edit anywhere makes it stale again, so while anyone is still editing it is
stale by definition, and a run that fails on it fails permanently: a red exit
that is always red is one nobody reads, and the real errors go out with it. So
the exit code answers the question this gate is for — is the data right — and
the stale artefact is named on its own lines, in its own section, as work the
release still owes. Ask for it to count with --release, which is the run the
person cutting the release makes after the generator:

    exit 0   the data is right; anything listed under BLOCKS RELEASE is a
             generator that has not been run yet
    exit 1   wrong data — fix it before anything else
    exit 2   --release, the data is right, and an artefact is behind the tree

    python3 tools/validate.py
    python3 tools/validate.py --release
"""

import datetime
import json
import pathlib
import re
import subprocess
import sys

try:                                    # renamed in 3.11; both spellings are private
    import re._parser as sre_parse
except ImportError:                     # pragma: no cover
    import sre_parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
REG = ROOT / "registry"
TODAY = datetime.date.today().isoformat()

# Must match the keys exported by js/engines.js. Kept as a literal on purpose:
# if someone adds an engine to the JS, this list is the second place they are
# forced to think about it.
ENGINES = {
    "mod11-weighted", "luhn-modN", "mod9", "mod89", "mod97", "gb-vat",
    "mod511", "pow2-weighted", "iso7064-11-10", "es-nif", "it-cf", "mx-rfc",
    "structural", "unimplemented",
}

# Engines that only ever report on shape. An identifier sitting on one of these
# is making no arithmetic claim, and the fixtures are held to a lower bar.
SHAPE_ONLY = {"structural", "unimplemented"}

# Engines js/engines.js hangs a `weak` marker on: the check digit matched, but
# the authority's own rule cannot catch every single-character typo, and the
# badge has to say so. Mirrored here for the same reason ENGINES is — the next
# country to sit on modulus 9 must not ship an unqualified green badge because
# nobody remembered the caveat existed.
WEAK_ENGINES = {"mx-rfc", "mod9"}

MAPS = {"dian", "lt2-zero", "sub11-k", "sub11", "peru", "nip"}

STATUSES = {
    "ok", "bad-check", "bad-format", "unchecked", "unimplemented",
    "not-issuable", "refused", "reserved", "empty",
}

SCOPES = {"personal", "business", "both"}

# Engines.checkField is failure-only: it either says the value does not match
# the field's pattern, or it says nothing at all.
FIELD_STATUSES = {"ok", "bad-format"}

# What a `variants` override may replace on the identifier it belongs to. The
# list is short on purpose: an override is a different document held in the same
# box, not a licence to redefine the identifier into something else.
VARIANT_KEYS = {"label", "format", "display", "note", "checkLabel", "checksum",
                "denied", "reserved"}

# The same separator class js/engines.js strips before it matches a format.
SEPARATORS = re.compile(r"[\s./-]")

# Reading js/engines.js in node is the only way to check a rule, because it is
# the only place the rules exist. Python owns every assertion; this driver only
# reports what the engines said.
DRIVER = r"""
const fs = require('fs');
const root = process.argv[1];
global.window = {};
new Function(fs.readFileSync(root + '/js/engines.js', 'utf8'))();
const E = window.FiscalEngines;
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
    const cache = {};
    const out = JSON.parse(input).map((p) => {
        const rec = cache[p.iso] || (cache[p.iso] = JSON.parse(fs.readFileSync(
            root + '/registry/' + p.iso.toLowerCase() + '.json', 'utf8')));
        try {
            if (p.field) {
                const f = (rec.fields || {})[p.key];
                if (!f) return { status: 'no-such-field' };
                const r = E.checkField(p.value, f);
                return { status: r ? r.status : 'ok' };
            }
            const ids = rec.identifiers;
            if (!Array.isArray(ids)) return { status: 'identifiers-is-not-an-array' };
            const id = ids.find((i) => i && i.key === p.key);
            if (!id) return { status: 'no-such-identifier' };
            const r = E.validate(p.value, id);
            return { status: r.status, expected: r.expected == null ? null : r.expected,
                     weak: r.weak == null ? null : r.weak };
        } catch (e) {
            return { status: 'threw — ' + e.message };
        }
    });
    process.stdout.write(JSON.stringify(out));
});
"""

errors: list[str] = []
warnings: list[str] = []
stale: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"{where}: {msg}")


def warn(where: str, msg: str) -> None:
    warnings.append(f"{where}: {msg}")


def outdated(where: str, msg: str) -> None:
    stale.append(f"{where}: {msg}")


def canonical(value: str) -> str:
    return SEPARATORS.sub("", str(value).upper())


def admissible_widths(pattern: str, cap: int = 24) -> set[int] | None:
    """Every string length the pattern can match, or None if it is unbounded.

    Exact rather than a min/max range: `^[0-9]{9}([0-9]{3})?$` admits 9 and 12
    and nothing between, and a range would demand the engines handle 10 and 11.
    """
    def widths(node) -> set[int] | None:
        total = {0}
        for op, av in node:
            name = str(op)
            if name in ("LITERAL", "NOT_LITERAL", "IN", "ANY", "RANGE", "CATEGORY"):
                step = {1}
            elif name in ("AT", "ASSERT", "ASSERT_NOT"):
                step = {0}
            elif name == "SUBPATTERN":
                step = widths(av[3])
            elif name == "ATOMIC_GROUP":
                step = widths(av)
            elif name == "BRANCH":
                step = set()
                for branch in av[1]:
                    inner = widths(branch)
                    if inner is None:
                        return None
                    step |= inner
            elif name in ("MAX_REPEAT", "MIN_REPEAT"):
                lo, hi, sub = av
                if hi > cap:
                    return None
                inner = widths(sub)
                if inner is None:
                    return None
                step = set()
                acc = {0}
                for n in range(hi + 1):
                    if n >= lo:
                        step |= acc
                    acc = {a + b for a in acc for b in inner if a + b <= cap}
            else:
                return None
            if step is None:
                return None
            total = {a + b for a in total for b in step if a + b <= cap}
            if not total:
                return None
        return total

    try:
        return widths(sre_parse.parse(pattern))
    except Exception:
        return None


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

        # `bodyLengths` is how a record says its body varies, and it is the only
        # thing that lets the engine know when the last character of a bare value
        # might be the last of the body rather than the check. Declared wrong, it
        # either hands out a suggested digit that rests on a guess or withholds
        # one it could have given.
        lengths = spec.get("bodyLengths")
        if lengths is not None:
            if (not isinstance(lengths, list) or len(lengths) < 2
                    or any(not isinstance(n, int) or n < 1 for n in lengths)
                    or sorted(set(lengths)) != lengths):
                err(where, "bodyLengths must be two or more ascending distinct body "
                           "lengths — one length is not a variable body")


def check_display(where: str, ident: dict, fmt: "re.Pattern | None") -> None:
    """A mask the editor offers as a placeholder has to survive being typed.

    Only the `#` placeholders are filled; every literal in the mask stays, which
    is what makes the round trip a real test of the format rather than of the
    mask. Any single digit may fill them, because a format can constrain a
    position (an ITIN's group, a Belgian 0- or 1-series) without the mask saying
    which digit belongs there.
    """
    mask = ident.get("display")
    if not mask or fmt is None:
        return
    if not isinstance(mask, str):
        err(where, f"display must be a mask string, got {type(mask).__name__}")
        return
    if "#" not in mask:
        return
    for filler in "0123456789":
        if fmt.fullmatch(canonical(mask.replace("#", filler))):
            return
    err(where, f"display mask {mask!r} cannot be typed into its own format")


def check_variants(iwhere: str, ident: dict, catalogues: dict) -> None:
    """An identifier whose meaning is set by a catalogue the user picks from.

    Colombia is the case: `tipoDocumento` decides whether the number beside it is
    a cédula, a passport or a foreign document, and each of those is a different
    label and a different shape in the same box. The override is merged over the
    identifier, so it must name a catalogue that exists, a code that catalogue
    actually offers, and nothing the merge has no business replacing. A key given
    as null is removed by the merge rather than replaced — a foreign tax number
    has no verification digit, so it must be able to drop the check label and the
    display mask the DIAN number carries.

    Whether the set of overrides is complete is a question about the card rather
    than about one identifier, so it is asked in check_selectors below.
    """
    variants = ident.get("variants")
    if variants is None:
        return

    on = variants.get("on")
    cat = catalogues.get(on)
    if not cat:
        err(iwhere, f"variants.on names {on!r}, which is not a catalogue on this record")
        return
    options = cat.get("options") or []
    codes = {str(o.get("code")) for o in options}

    default = variants.get("default")
    if default is None:
        err(iwhere, "variants needs a `default` naming the code the identifier already is, "
                    "or nothing says which document the unmodified definition describes")
    elif str(default) not in codes:
        err(iwhere, f"variants.default {default!r} is not an option {on} offers")

    by = variants.get("by")
    if not isinstance(by, dict) or not by:
        err(iwhere, "variants needs a `by` map from catalogue code to override")
        return

    for code, over in by.items():
        vwhere = f"{iwhere}[variant:{code}]"
        if code not in codes:
            err(vwhere, f"{on} offers no option {code!r}, so this override can never apply")
        if code == str(default):
            err(vwhere, "this is the default, which is the identifier as written — an "
                        "override on it says the definition is two things at once")
        if not isinstance(over, dict) or not over:
            err(vwhere, "an override with nothing in it is the identifier itself")
            continue
        for key in set(over) - VARIANT_KEYS:
            err(vwhere, f"a variant may not override {key!r} — allowed: {sorted(VARIANT_KEYS)}")
        if not over.get("label"):
            err(vwhere, "a variant needs its own label, or the field keeps the name of "
                        "a document it is no longer holding")
        if over.get("format") is not None:
            try:
                re.compile(over["format"])
            except (re.error, TypeError) as exc:
                err(vwhere, f"format is not a valid regex — {exc}")
        if over.get("checksum") is not None:
            if isinstance(over["checksum"], dict):
                check_checksum(vwhere, over["checksum"])
            else:
                err(vwhere, "checksum must be an object naming an engine")
        # An override that moves the field onto an engine with no arithmetic
        # owes the badge its own explanation: the definition's note describes
        # the document the variant just replaced, so inheriting it would put a
        # sentence about a cédula under a passport number.
        note = over.get("note")
        merged = over.get("checksum") or ident.get("checksum") or {"engine": "structural"}
        if merged.get("engine") in SHAPE_ONLY and not (note or {}).get("en"):
            err(vwhere, "runs no check and carries no note of its own — inheriting the "
                        "definition's would put a sentence about the document this "
                        "variant replaced under the one it holds now")


def check_selectors(where: str, rec: dict, identifiers: list) -> None:
    """A catalogue an identifier defers to is choosing which document is in the box.

    Once a record says `variants.on: tipoDocumento`, that catalogue stops being a
    code the user reads out and becomes the thing that decides what the number
    beside it is. Every option it offers a card must then land somewhere on that
    card. Colombia is where this went wrong: the app offered 'Pasaporte' from
    DIAN's own list and the only place to type it was a field that admitted
    digits, so choosing it produced 'Wrong format' and no way forward.
    """
    catalogues = rec.get("catalogues") or {}
    selectors = {ident["variants"]["on"] for ident in identifiers
                 if isinstance(ident.get("variants"), dict) and ident["variants"].get("on")}

    for name in sorted(selectors & set(catalogues)):
        options = catalogues[name].get("options") or []
        for kind, prof in (rec.get("invoiceProfile") or {}).items():
            if not isinstance(prof, dict) or name not in (prof.get("required") or []):
                continue
            required = set(prof.get("required") or [])
            covered = set()
            for ident in identifiers:
                variants = ident.get("variants") or {}
                if ident.get("key") in required and variants.get("on") == name:
                    covered |= set(variants.get("by") or {})
                    covered.add(str(variants.get("default")))
            for option in options:
                applies = option.get("applies")
                if applies and kind not in applies:
                    continue
                code = str(option.get("code"))
                if code not in covered:
                    err(where, f"a {kind} card must give {name}, and {code!r} "
                               f"({option.get('label')!r}) is one of the answers it offers, but "
                               f"no identifier the {kind} profile requires is that document or "
                               f"has a variant for it — the user picks it and has nowhere to type")


def check_record(path: pathlib.Path, index_tier: dict, fixtures: dict) -> None:
    where = path.name
    try:
        rec = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        err(where, f"invalid JSON — {exc}")
        return

    if not isinstance(rec, dict):
        err(where, f"a record must be a JSON object, got {type(rec).__name__}")
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
    src = verified.get("src") or ""
    if not src:
        err(where, "verified.src is required — every record cites the authority it came from")
    elif re.fullmatch(r"https?://[^/]+/?", src):
        warn(where, "verified.src is a site root — cite the page that publishes the format "
                    "or the check rule, because a homepage cannot evidence either")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(verified.get("on", ""))):
        err(where, "verified.on must be an ISO date")
    elif str(verified["on"]) > TODAY:
        err(where, "verified.on is in the future")
    if not rec.get("authority"):
        err(where, "authority is required")

    # Peppol and e-invoicing describe the world outside this repo, so they are
    # held to the same provenance rule as a checksum: cite it or drop it.
    EIN_STATUSES = {"mandatory", "scheduled", "partial", "none"}
    ein = rec.get("einvoicing")
    if ein is not None:
        if ein.get("status") not in EIN_STATUSES:
            err(where, f"einvoicing.status must be one of {sorted(EIN_STATUSES)}, "
                       f"got {ein.get('status')!r}")
        if not ein.get("src"):
            err(where, "einvoicing needs a src")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(ein.get("verified", ""))):
            err(where, "einvoicing.verified must be an ISO date")
        elif str(ein["verified"]) > TODAY:
            err(where, "einvoicing.verified is in the future")
        if ein.get("status") == "scheduled" and not ein.get("from"):
            err(where, "einvoicing.status 'scheduled' needs a `from` date")
        for key in ("from", "fullyFrom"):
            if ein.get(key) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(ein[key])):
                err(where, f"einvoicing.{key} must be an ISO date")
        # A mandate that has commenced is no longer scheduled. Which state it
        # became is a judgement about the phase-in, not something a date can
        # infer, so this is a nudge to go and look rather than a build failure.
        if ein.get("status") == "scheduled" and str(ein.get("from", "")) <= TODAY:
            warn(where, "einvoicing.status is 'scheduled' but `from` has already passed "
                        "— confirm which phase now binds and restate it")
        if ein.get("fullyFrom") and ein.get("from") and ein["fullyFrom"] < ein["from"]:
            err(where, "einvoicing.fullyFrom is before `from`")

    pep = rec.get("peppol")
    if pep is not None:
        if not re.fullmatch(r"[0-9]{4}", str(pep.get("eas", ""))):
            err(where, "peppol.eas must be a four-digit EAS scheme code")
        if not pep.get("src"):
            err(where, "peppol needs a src")

    identifiers = rec.get("identifiers") or []
    if not isinstance(identifiers, list):
        err(where, f"identifiers must be an array, got {type(identifiers).__name__} "
                   f"— `fields` and `catalogues` are objects, `identifiers` is not")
        return
    if not identifiers:
        err(where, "at least one identifier is required")
    shaped = []
    for entry in identifiers:
        if isinstance(entry, dict):
            shaped.append(entry)
        else:
            err(where, f"identifiers holds a {type(entry).__name__}, not an identifier")
    identifiers = shaped

    country_fixtures = (fixtures.get("countries") or {}).get(iso) or {}
    keys = set()
    scopes = {}
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

        scope = ident.get("scope", "both")
        if scope not in SCOPES:
            err(iwhere, f"scope must be one of {sorted(SCOPES)}, got {scope!r}")
        scopes[key] = scope

        fmt = ident.get("format")
        widths = None
        compiled = None
        if not fmt:
            err(iwhere, "identifier needs a format regex")
        elif not isinstance(fmt, str):
            err(iwhere, f"format must be a regex string, got {type(fmt).__name__}")
        else:
            try:
                compiled = re.compile(fmt, re.I)
                widths = admissible_widths(fmt)
            except re.error as exc:
                err(iwhere, f"format is not a valid regex — {exc}")

        spec = ident.get("checksum") or {"engine": "structural"}
        if not isinstance(spec, dict):
            err(iwhere, f"checksum must be an object naming an engine, got "
                        f"{type(spec).__name__}")
            spec = {"engine": "structural"}
        check_checksum(iwhere, spec)
        check_display(iwhere, ident, compiled)
        check_variants(iwhere, ident, rec.get("catalogues") or {})
        if spec.get("engine") not in SHAPE_ONLY:
            checked_any = True

        # `unchecked` and `unimplemented` are two different facts — one about
        # the jurisdiction, one about this build — and the status alone cannot
        # say which is which to a user. The record's note is the only place that
        # sentence exists, and the badge reads it from here, so an identifier
        # that makes no arithmetic claim and offers no explanation leaves the
        # user with an amber badge and nothing to act on.
        if spec.get("engine") in SHAPE_ONLY and not (ident.get("note") or {}).get("en"):
            err(iwhere, "runs no check and carries no note — the badge can then only say "
                        "the value was not verified, and never whether a rule exists at all")

        if spec.get("engine") in WEAK_ENGINES:
            cases = (fixtures.get("weak") or {}).get(f"{iso}.{key}") or {}
            if not any(cases.values()):
                err(iwhere, "sits on an engine whose own rule cannot catch every "
                            "single-character typo, and no `weak` fixture pins the caveat — "
                            "without one the qualification can drop off the green badge and "
                            "nothing fails")

        # `denied` is the mirror of `reserved`: values the arithmetic accepts
        # and the authority never issued. One that its own format rejects, or
        # that carries separators the canonicaliser would have stripped, can
        # never fire, so it is a claim of safety the code does not keep.
        for value in ident.get("denied") or []:
            if not isinstance(value, str):
                err(iwhere, f"denied holds a {type(value).__name__}; a denied value is the "
                            f"canonical string the engine compares against")
                continue
            if value != canonical(value):
                err(iwhere, f"denied value {value!r} is not canonical — "
                            f"separators are stripped before it is compared")
            elif compiled and not compiled.fullmatch(value):
                err(iwhere, f"denied value {value!r} does not match this identifier's format, "
                            f"so it could never be reached")
            if value in (ident.get("reserved") or []):
                err(iwhere, f"{value!r} is both reserved and denied")

        refused_keys = {e.get("key") for e in rec.get("refused") or []
                        if isinstance(e, dict)}
        for rule in ident.get("refuses") or []:
            if not isinstance(rule, dict):
                err(iwhere, f"refuses holds a {type(rule).__name__}, not a {{key, pattern}} rule")
                continue
            try:
                re.compile(rule.get("pattern", ""))
            except (re.error, TypeError) as exc:
                err(iwhere, f"refuses.pattern is not a valid regex — {exc}")
            if rule.get("key") not in refused_keys:
                err(iwhere, f"refuses {rule.get('key')!r} but no `refused` entry explains why "
                            f"— a refusal with no copy is a dead end for the user")

        check_fixtures(iwhere, ident, spec, widths, country_fixtures.get(key))

    check_selectors(where, rec, identifiers)

    for key in country_fixtures:
        if key not in keys:
            err(f"fixtures.json[{iso}]", f"no identifier {key!r} in {where}")

    # A refusal is only a promise if an identifier that could receive the number
    # carries the detector. Without one it is a paragraph in the editor, which
    # is what it was before, and the app's loudest claim goes unenforced.
    for entry in rec.get("refused") or []:
        if not isinstance(entry, dict):
            err(where, f"refused holds a {type(entry).__name__}, not an entry with a key "
                       f"and a reason")
            continue
        rwhere = f"{where}[refused:{entry.get('key')}]"
        if not entry.get("reason"):
            err(rwhere, "a refused entry needs a reason the user can read")
        guards = [ident for ident in identifiers
                  if any(isinstance(rule, dict) and rule.get("key") == entry.get("key")
                         for rule in ident.get("refuses") or [])]
        if not guards:
            err(rwhere, "no identifier carries a `refuses` rule for this key — a refusal the "
                        "engines cannot enforce is prose, not a promise")
        elif not any("refused" in (country_fixtures.get(ident["key"]) or {}) for ident in guards):
            err(rwhere, "no fixture proves this refusal fires — add a `refused` bucket")

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

    # Cross-check that every field named by a profile is definable, and that a
    # personal card is never made to supply a number only a business is issued.
    fields = rec.get("fields") or {}
    catalogues = set(rec.get("catalogues") or {})
    generic = {"legalName", "address", "email", "nombre", "razonSocial"}
    for kind, prof in (rec.get("invoiceProfile") or {}).items():
        if not isinstance(prof, dict):
            continue
        for field in (prof.get("required") or []) + (prof.get("optional") or []):
            if field not in keys | set(fields) | catalogues | generic:
                err(where, f"invoiceProfile.{kind} names unknown field {field!r}")
        for field in prof.get("required") or []:
            other = "business" if kind == "personal" else "personal"
            if scopes.get(field) == other:
                err(where, f"invoiceProfile.{kind}.required names {field!r}, which is scoped "
                           f"{other}-only — a {kind} card can never fill it")

    # A `format` on a plain field is a typo gate, run by Engines.checkField and
    # not by validate(). It is only worth anything if the field is on a card
    # somebody fills in and if a fixture proves the pattern still catches what it
    # was written to catch — a regex nothing reaches is a promise, not a check.
    profiled = {name
                for prof in (rec.get("invoiceProfile") or {}).values()
                if isinstance(prof, dict)
                for name in (prof.get("required") or []) + (prof.get("optional") or [])}
    field_fixtures = (fixtures.get("fields") or {}).get(iso) or {}
    for name, field in fields.items():
        fwhere = f"{where}[field:{name}]"
        if not isinstance(field, dict):
            err(fwhere, f"a field must be an object, got {type(field).__name__}")
            continue
        if not field.get("format"):
            continue
        try:
            re.compile(field["format"])
        except (re.error, TypeError) as exc:
            err(fwhere, f"format is not a valid regex — {exc}")
            continue
        if name not in profiled:
            err(fwhere, "carries a format but no invoice profile asks for the field, "
                        "so the pattern can never run")
        buckets = field_fixtures.get(name)
        if not buckets:
            err(fwhere, "carries a format but has no fixtures in registry/fixtures.json "
                        "under `fields` — an unexercised pattern is not a gate")
        else:
            for status in buckets:
                if status not in FIELD_STATUSES:
                    err(fwhere, f"fixture bucket {status!r} is not a verdict "
                                f"Engines.checkField returns")
            for needed in ("ok", "bad-format"):
                if not buckets.get(needed):
                    err(fwhere, f"needs at least one {needed!r} field fixture")
    for name in field_fixtures:
        if not (fields.get(name) if isinstance(fields.get(name), dict) else {}).get("format"):
            err(f"fixtures.json[fields:{iso}]", f"no field {name!r} with a format in {where}")


def check_fixtures(iwhere: str, ident: dict, spec: dict, widths, buckets) -> None:
    if buckets is None:
        err(iwhere, "no fixtures — every identifier needs reference values in "
                    "registry/fixtures.json, or the gate can only check shape")
        return

    for status in buckets:
        if status not in STATUSES:
            err(iwhere, f"fixture bucket {status!r} is not a status js/engines.js returns")

    if spec.get("engine") not in SHAPE_ONLY:
        for needed in ("ok", "bad-check"):
            if not buckets.get(needed):
                err(iwhere, f"a computing engine needs at least one {needed!r} fixture")
    if not buckets.get("bad-format"):
        err(iwhere, "every identifier needs at least one 'bad-format' fixture")
    if ident.get("denied") and not buckets.get("not-issuable"):
        err(iwhere, "`denied` is declared but no fixture proves it fires")

    # Every length the format admits has to be reachable by a real value with a
    # real verdict. This is what catches a checksum spec that cannot consume a
    # length its own format promises: the fixture at that length has nowhere to
    # sit except 'bad-format', and the record is then lying about its own shape.
    if widths:
        reached = {len(canonical(v))
                   for status, values in buckets.items() if status != "bad-format"
                   for v in values}
        for width in sorted(widths - reached):
            err(iwhere, f"the format admits a {width}-character value and no fixture reaches "
                        f"it — either it is unusable, or the format is wider than the truth")


def drive(probes: list) -> list | None:
    """Run a batch of values through js/engines.js and hand back what it said."""
    try:
        done = subprocess.run(["node", "-e", DRIVER, str(ROOT)],
                              input=json.dumps(probes), capture_output=True,
                              text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        err("fixtures.json", f"could not run js/engines.js under node — {exc}. The fixtures "
                             f"are the only correctness check there is; do not ship without them")
        return None
    if done.returncode != 0:
        err("fixtures.json", f"node exited {done.returncode} — {done.stderr.strip()[:400]}")
        return None
    return json.loads(done.stdout)


def run_fixtures(fixtures: dict) -> None:
    probes, wanted = [], []
    for iso, keys in (fixtures.get("countries") or {}).items():
        for key, buckets in keys.items():
            for status, values in buckets.items():
                for value in values:
                    probes.append({"iso": iso, "key": key, "value": value})
                    wanted.append(("status", status))

    # Whether the badge names a check character is as load-bearing as whether it
    # is red: a suggested digit that rests on a guess about where the body ended
    # is the one thing worse than no suggestion, so both the presence and the
    # value of `expected` are pinned here.
    for ref, cases in (fixtures.get("expected") or {}).items():
        iso, _, key = ref.partition(".")
        for value, want in cases.items():
            probes.append({"iso": iso, "key": key, "value": value})
            wanted.append(("expected", want))

    # `weak` is the caveat on a green badge — the authority's own rule matched
    # but cannot catch every single-character typo. It has to survive a change to
    # the engine table, or a mistyped RFC quietly reads as fully checked again.
    for ref, cases in (fixtures.get("weak") or {}).items():
        iso, _, key = ref.partition(".")
        for value, want in cases.items():
            probes.append({"iso": iso, "key": key, "value": value})
            wanted.append(("weak", want))

    for iso, names in (fixtures.get("fields") or {}).items():
        for name, buckets in names.items():
            for status, values in buckets.items():
                for value in values:
                    probes.append({"iso": iso, "key": name, "value": value, "field": True})
                    wanted.append(("status", status))

    if not probes:
        err("fixtures.json", "no fixtures at all")
        return

    got = drive(probes)
    if got is None:
        return

    for probe, (field, want), actual in zip(probes, wanted, got):
        if actual.get(field) != want:
            err(f"fixtures.json[{probe['iso']}.{probe['key']}]",
                f"{probe['value']!r} should have {field} {want!r} and js/engines.js "
                f"says {actual.get(field)!r}")


def check_demo_grouping(where: str, key: str, ident: dict, value: str) -> None:
    """A number that reads two ways is one the demo must not write one way.

    Two different ambiguities are closed by the same keystroke, and both of them
    are ambiguities the app itself cannot resolve. An SSN and an EIN are the same
    nine digits once the punctuation is gone, and us.json's own copy admits no
    rule can separate them there. A Colombian NIT run together is a body and its
    verification digit or a body still missing one — one in ten of the incomplete
    ones satisfies DIAN's weights by coincidence, which is why js/engines.js will
    not run the rule at all on that shape. Both times the grouping the authority
    prints is the whole signal. The demo is the first thing a new user reads the
    promise on, so the demo prints it: it shipped nine bare digits under the
    heading EIN, and a NIT under a mask whose own worked example is hyphenated.
    """
    refuses = bool(ident.get("refuses"))
    varies = len((ident.get("checksum") or {}).get("bodyLengths") or ()) > 1
    if not (refuses or varies):
        return
    seps = sorted(set(SEPARATORS.findall(ident.get("display") or "")))
    if not seps or SEPARATORS.search(str(value)):
        return
    why = ("this identifier refuses another number that the grouping is the only thing "
           "telling it from") if refuses else (
          "its body varies in length, so run together nothing in the value says which "
          "character is the check character and the rule is not run at all")
    err(where, f"{key} is written without the {''.join(seps)!r} the record's own "
               f"display mask prints, and {why}")


def check_demo(fixtures: dict) -> None:
    """The demo is the first thing a new user is offered, so it is held to the
    same rule as the registry: every identifier on a sample card must satisfy its
    jurisdiction's real check rule, and every required field must hold something.
    A demo card wearing a red badge teaches the opposite of what the app does.
    """
    path = ROOT / "demo.json"
    if not path.exists():
        err("demo.json", "missing — #demo has nothing to show")
        return
    try:
        demo = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        err("demo.json", f"invalid JSON — {exc}")
        return

    probes, labels = [], []
    for card in demo.get("cards") or []:
        iso, kind = card.get("iso", ""), card.get("kind", "")
        values = card.get("values") or {}
        where = f"demo.json[{card.get('label', iso)}]"
        record = REG / f"{iso.lower()}.json"
        if not record.exists():
            err(where, f"no registry record for {iso!r}")
            continue
        rec = json.loads(record.read_text(encoding="utf-8"))
        prof = (rec.get("invoiceProfile") or {}).get(kind)
        if not prof:
            err(where, f"no invoiceProfile.{kind} to render this card against")
            continue

        idents = {i.get("key"): i for i in rec.get("identifiers") or [] if isinstance(i, dict)}
        fields = rec.get("fields") or {}
        catalogues = rec.get("catalogues") or {}
        for key in prof.get("required") or []:
            if not values.get(key):
                err(where, f"required key {key!r} is empty — the card renders a dash")
        for key, value in values.items():
            if key in idents:
                check_demo_grouping(where, key, idents[key], value)
                probes.append({"iso": iso, "key": key, "value": value})
                labels.append((where, key))
            elif isinstance(fields.get(key), dict) and fields[key].get("format"):
                probes.append({"iso": iso, "key": key, "value": value, "field": True})
                labels.append((where, key))
            elif key in catalogues:
                codes = {str(o.get("code")) for o in catalogues[key].get("options") or []}
                if str(value) not in codes:
                    err(where, f"{key} {value!r} is not an option {iso} offers")

    if not probes:
        return
    got = drive(probes)
    if got is None:
        return
    # `unchecked` and `unimplemented` are honest verdicts about a rule that does
    # not exist or is not run here, so a demo value may sit on them. Anything
    # else that is not `ok` is a badge the shop window should never show.
    allowed = {"ok", "reserved", "unchecked", "unimplemented"}
    for (where, key), actual in zip(labels, got):
        if actual.get("status") not in allowed:
            err(where, f"{key} is {actual.get('status')!r} — every identifier in the demo "
                       f"must satisfy its jurisdiction's real rule")


def check_precache() -> None:
    """The offline cache in sw.js is generated, and a stale block ships a build
    nobody receives.

    tools/build_sw.py derives both the precache lists and VERSION from the bytes
    in the repo, so every edit anywhere in the tree invalidates them. Leaving
    that to somebody's memory produced a stale block three rounds running, and
    the failure is silent in the worst possible way: a stale VERSION leaves
    every existing install on the cache it already has, so the release that
    fixed something is the release nobody sees.

    It is reported apart from the records, because it is not the same kind of
    wrong. A stale artefact is a generator that has not been run yet and every
    edit in the tree makes it stale again; a bad record is a claim nobody may
    ship. Somebody working on the registry has to be able to see that their own
    half is clean without the last step of the release drowning it — and a gate
    that is red for a reason nobody in the tree can fix yet is a gate people
    learn to ignore, taking the real errors with it. So it blocks the release
    rather than the run: --release is what turns it back into an exit code.
    """
    script = ROOT / "tools" / "build_sw.py"
    try:
        done = subprocess.run([sys.executable, str(script), "--check"],
                              capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        outdated("sw.js", f"could not run tools/build_sw.py --check — {exc}")
        return
    if done.returncode == 0:
        return
    for line in (done.stdout + done.stderr).splitlines():
        if line.strip():
            outdated("sw.js", line.strip())


def main(argv: list[str]) -> int:
    release = "--release" in argv[1:]
    unknown = [a for a in argv[1:] if a != "--release"]
    if unknown:
        print(f"unknown argument {unknown[0]!r} — usage: validate.py [--release]")
        return 1

    index_path = REG / "index.json"
    if not index_path.exists():
        print("registry/index.json missing — run tools/build_index.py")
        return 1

    index = json.loads(index_path.read_text(encoding="utf-8"))
    index_tier = {c["iso"]: c["tier"] for c in index["countries"]}

    fixtures_path = REG / "fixtures.json"
    if not fixtures_path.exists():
        print("registry/fixtures.json missing — the gate cannot check any rule without it")
        return 1
    fixtures = json.loads(fixtures_path.read_text(encoding="utf-8"))

    reserved_names = {"index.json", "fixtures.json"}
    records = sorted(p for p in REG.glob("*.json") if p.name not in reserved_names)
    for path in records:
        # Everything above names the record, the key and the reason it failed,
        # and a record that ships a shape nothing here expected deserves the
        # same courtesy rather than a traceback with the file name nowhere in
        # it. The checks are still the ones that decide; this only makes sure
        # the answer is legible when one of them meets something it cannot read.
        try:
            check_record(path, index_tier, fixtures)
        except Exception as exc:                            # noqa: BLE001
            err(path.name, f"could not be checked — {type(exc).__name__}: {exc}. "
                           f"Some part of this record is not the shape the gate reads")

    for iso in fixtures.get("countries") or {}:
        if not (REG / f"{iso.lower()}.json").exists():
            err("fixtures.json", f"fixtures for {iso} but no registry/{iso.lower()}.json")

    for iso in (fixtures.get("fields") or {}):
        if not (REG / f"{iso.lower()}.json").exists():
            err("fixtures.json", f"field fixtures for {iso} but no registry/{iso.lower()}.json")

    for phase in (run_fixtures, check_demo):
        try:
            phase(fixtures)
        except Exception as exc:                            # noqa: BLE001
            err(phase.__name__, f"could not run — {type(exc).__name__}: {exc}. Something "
                                f"the registry or demo.json ships is not the shape it reads")

    # Every tier 1 or 2 country in the index must have a record, and vice versa.
    have = {p.stem.upper() for p in records}
    promised = {iso for iso, t in index_tier.items() if t in (1, 2)}
    for iso in sorted(promised - have):
        errors.append(f"index.json: {iso} is tier {index_tier[iso]} but registry/{iso.lower()}.json is missing")
    for iso in sorted(have - promised):
        errors.append(f"registry/{iso.lower()}.json exists but index.json has {iso} at tier 3")

    check_precache()

    for line in warnings:
        print(f"warn  {line}")
    for line in errors:
        print(f"ERROR {line}")
    # Last, and under a heading of its own: it is the only thing here that is
    # nobody's mistake, and it must not be read as one of the errors above.
    if stale:
        print("\nBLOCKS RELEASE — generated, and behind the tree:")
        for line in stale:
            print(f"  STALE {line}")
        print("Run the generator as the last step before release, then "
              "`python3 tools/validate.py --release` to confirm it.")

    probes = sum(len(v) for section in ("countries", "fields")
                 for keys in (fixtures.get(section) or {}).values()
                 for buckets in keys.values() for v in buckets.values())
    probes += sum(len(cases) for section in ("expected", "weak")
                  for cases in (fixtures.get(section) or {}).values())
    tiers = {t: sum(1 for v in index_tier.values() if v == t) for t in (1, 2, 3)}
    print(f"\n{len(records)} records · {len(index_tier)} jurisdictions "
          f"(tier 1: {tiers[1]}, tier 2: {tiers[2]}, tier 3: {tiers[3]}) "
          f"· {probes} fixtures executed "
          f"· {len(errors)} errors, {len(stale)} stale, {len(warnings)} warnings")
    if errors:
        return 1
    return 2 if (stale and release) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
