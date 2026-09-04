#!/usr/bin/env python3
"""Gate on the dictionaries. Run in CI; a non-zero exit means do not ship.

The dictionaries are symmetric today, and the string added by hand next month
is the one that breaks them. Nothing here is stylistic: a key a locale is
missing renders English inside a page marked lang="ja", a key nothing
references is translation work paying rent on a room it does not live in, and a
{placeholder} a translator dropped renders a sentence with the number missing.

The registry counts are checked too. i18n.js keeps a COUNTS fallback so a first
paint before registry/index.json resolves never shows a literal {n}; that
fallback is the one number in the interface that can still go stale, so it is
compared against the registry here rather than trusted.

Errors fail the run. Notes do not: they are bookkeeping this file carries on
behalf of work happening elsewhere — a reserved key the markup has finally
started using, an alias whose markup has been rewritten — and failing on them
would punish the very edit that resolves them.

Everything below rests on two readers, one for the markup and one for the
object literals, and a reader that quietly extracts the wrong string reports no
problem at all. So both are run against known answers before any dictionary is
opened, and a failure there is reported as "self-test:" and stops the run.

    python3 tools/check_i18n.py
"""

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
I18N = ROOT / "i18n.js"

# English is implicit: a key absent from the en object renders as itself. Only
# the locales below are required to carry every referenced key.
TRANSLATED = ("es", "pt-BR", "ja", "ru")

# Lookups whose argument is a variable are invisible to any extraction. Each is
# declared here, keyed by file and by the expression passed, with the keys it can
# produce — so the analysis below is not quietly working from a short list.
# Making a call site pass a literal instead deletes its entry, which is the
# point of the entry.
DYNAMIC = {
    ("js/app.js", "s"): [],  # the TT shim itself; its callers are checked
    ("js/app.js", "g.en"): ["Legal name", "Name", "Address", "Email", "Tax ID"],
    ("carino-navbar.js", "s"): [
        "Late shift.", "Good morning.", "Good afternoon.", "Good evening.",
    ],
}

# Translated ahead of the markup that will show them. A key sits here only with
# a reason; the list shrinking is progress, the list growing needs an argument.
RESERVED = {
    "Offline · nothing leaves this device": "masthead line the header does not currently carry",
    "Change": "jurisdiction switcher label, not yet rendered",
    "Card": "kind noun, only used by the empty state below",
    "personal": "lower-case kind, only used by the empty state below",
    "business": "lower-case kind, only used by the empty state below",
    "No {kind} card for {country} yet": "empty state, not yet rendered",
    "Checksum, invoice profile and delivery verified against the authority.": "tier 1 description, waiting on the tier pill to surface it",
    "Structure verified; invoice profile is not guaranteed.": "tier 2 description, waiting on the tier pill to surface it",
    "Free-form record. Stored and presented, but nothing is validated.": "tier 3 description, waiting on the tier pill to surface it",

    # Written ahead of the UI work that reads them. The import review object,
    # the share failure taxonomy and the backup pane were all in this group and
    # have landed, which is what the list shrinking looks like; what is left is
    # the engines status badge and the Quote failure taxonomy. Each names the
    # code in the module it renders.
    "Quote did not answer":
        "one message for all nine Quote failures, which is eight wrong answers; "
        "js/app.js still calls it and moves to the reasons above, after which it goes",
    "Empty":
        "badge for the engines status empty, which renders no badge at all — "
        "nothing was there to check; js/app.js still maps it and drops it in the "
        "same round, so the entry keeps the gate quiet on both sides of that edit",
    "The official QR image saved on this card": "alt text for the stored official QR; the app cannot know what it encodes",
}

# The only strings whose {n}/{t1}/{t2} mean the registry tallies. Nothing else
# counted may sit in static markup: applyStaticI18n fills every data-i18n string
# from COUNTS and has nothing else to fill it from, so a sentence counting files
# or cards would come out saying how many jurisdictions there are.
REGISTRY_COUNTED = {
    "Search {n} jurisdictions",
    "in all. {t1} are verified against their authority, {t2} carry published "
    "structure, and the rest store and present without validating. Each card says which.",
}

# Renderings that are correctly identical to the English. Anything else matching
# English is an untranslated string wearing a translation's clothes. "*" means
# the string is the same in every language.
IDENTICAL_ON_PURPOSE = {
    ("*", "vCard"),
    ("es", "Personal"),
    ("es", "personal"),
    ("pt-BR", "Link"),
}

errors: list[str] = []
notes: list[str] = []


def err(where: str, msg: str) -> None:
    errors.append(f"{where}: {msg}")


def note(where: str, msg: str) -> None:
    notes.append(f"{where}: {msg}")


# ---------------------------------------------------------------- parsing

# A key written twice in one locale is the failure mode of an append-only
# dictionary, and it is invisible from either end: JavaScript keeps the last
# one and so does the reader below, so the earlier translation is dead text
# nobody can tell from live text. Collected while parsing, reported by name.
duplicates: list[str] = []


class ParseError(Exception):
    """i18n.js holds something this reader was never meant to understand.

    Raised rather than crashing: a person who has just written ordinary
    JavaScript deserves a line number, not a Python traceback, and a gate that
    hands out tracebacks is a gate somebody switches off.
    """


class JsLiteral:
    """Just enough of a JS object-literal reader for i18n.js.

    Values are strings or objects of plural categories; keys are quoted or bare
    identifiers. Both comment forms — // to the end of the line and /* */ —
    are skipped wherever whitespace is allowed, as are trailing commas. What is
    deliberately not here: numbers, arrays, template literals and expressions.
    Meeting one is a parse error rather than a silent misreading, because a
    dictionary that has grown any of them needs a person to look at it.
    """

    def __init__(self, text: str, start: int) -> None:
        self.s = text
        self.i = start

    def where(self, what: str) -> str:
        line = self.s.count("\n", 0, self.i) + 1
        snippet = self.s[self.i:self.i + 40].split("\n")[0]
        return f"line {line}: {what}, found {snippet!r}"

    def skip(self) -> None:
        while self.i < len(self.s):
            c = self.s[self.i]
            if c in " \t\r\n,":
                self.i += 1
            elif self.s.startswith("//", self.i):
                self.i = self.s.find("\n", self.i) + 1 or len(self.s)
            elif self.s.startswith("/*", self.i):
                end = self.s.find("*/", self.i + 2)
                if end == -1:
                    raise ParseError(self.where("unterminated block comment"))
                self.i = end + 2
            else:
                return

    def string(self) -> str:
        quote = self.s[self.i]
        opened = self.i
        self.i += 1
        out = []
        while self.i < len(self.s) and self.s[self.i] != quote:
            if self.s[self.i] == "\\":
                self.i += 1
                out.append({"n": "\n", "t": "\t"}.get(self.s[self.i], self.s[self.i]))
            else:
                out.append(self.s[self.i])
            self.i += 1
        if self.i >= len(self.s):
            self.i = opened
            raise ParseError(self.where("unterminated string"))
        self.i += 1
        return "".join(out)

    def key(self) -> str:
        if self.s[self.i] in "'\"":
            return self.string()
        m = re.compile(r"[A-Za-z_$][\w$]*").match(self.s, self.i)
        if not m:
            raise ParseError(self.where("expected a key"))
        self.i = m.end()
        return m.group(0)

    def value(self):
        if self.s[self.i] in "'\"":
            return self.string()
        if self.s[self.i] != "{":
            raise ParseError(self.where("expected a string or a plural object"))
        return self.obj()

    def obj(self) -> dict:
        if self.s[self.i] != "{":
            raise ParseError(self.where("expected an object"))
        self.i += 1
        out = {}
        while True:
            self.skip()
            if self.i >= len(self.s):
                raise ParseError(self.where("object is never closed"))
            if self.s[self.i] == "}":
                self.i += 1
                return out
            k = self.key()
            self.skip()
            if self.s[self.i] != ":":
                raise ParseError(self.where(f"expected ':' after key {k!r}"))
            self.i += 1
            self.skip()
            if k in out:
                duplicates.append(k)
            out[k] = self.value()


def load_object(name: str) -> dict:
    text = I18N.read_text(encoding="utf-8")
    anchor = "const " + name + " = {"
    if anchor not in text:
        raise ParseError(f"no `{anchor.rstrip(' {')} = ...` to read")
    return JsLiteral(text, text.index(anchor) + len(anchor) - 1).obj()


def load_counts() -> dict:
    text = I18N.read_text(encoding="utf-8")
    m = re.search(r"const COUNTS = (\{[^}]*\});", text)
    if not m:
        raise ParseError("no `const COUNTS = { … };` to compare with the registry")
    return {k: int(v) for k, v in re.findall(r"(\w+):\s*(\d+)", m.group(1))}


# ------------------------------------------------------------- extraction

TAG = re.compile(r"<(\w[\w-]*)((?:\s+[^<>]*?)?)/?>|</(\w[\w-]*)>", re.S)
ATTR = re.compile(r"([\w:-]+)\s*=\s*\"([^\"]*)\"")

# Elements that never close, so they never end the text of the data-i18n span
# they sit inside.
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


def markup_blocks(source: str) -> tuple:
    """The inner source of every data-i18n element, and the attribute keys.

    One scan serves both readers below: what the key is, and whether the
    element holds anything besides text.
    """
    blocks, keys = [], set()
    # data-i18n takes the element's whole text, so track where each one opened —
    # and how many elements of the same name have opened inside it since, or a
    # translated sentence with markup in the middle of it ends at the wrong
    # </span> and the key comes out truncated.
    open_i18n = []
    for m in TAG.finditer(source):
        name, attrs, closing = m.group(1), m.group(2) or "", m.group(3)
        if closing:
            if open_i18n and open_i18n[-1][0] == closing:
                if open_i18n[-1][2]:
                    open_i18n[-1][2] -= 1
                    continue
                _, text_start, _ = open_i18n.pop()
                blocks.append(source[text_start:m.start()])
            continue
        a = dict(ATTR.findall(attrs))
        bare = set(re.findall(r"(?:^|\s)(data-i18n[\w-]*)(?=\s|$)", attrs))
        if "data-i18n" in a or "data-i18n" in bare:
            open_i18n.append([name, m.end(), 0])
        elif (open_i18n and open_i18n[-1][0] == name
                and name not in VOID and not attrs.rstrip().endswith("/")):
            open_i18n[-1][2] += 1
        if "data-i18n-ph" in a or "data-i18n-ph" in bare:
            keys.add(html.unescape(a.get("placeholder", "")))
        if "data-i18n-attr" in a:
            for attr in a["data-i18n-attr"].split(","):
                keys.add(html.unescape(a.get(attr.strip(), "")))
    return blocks, keys


def block_key(block: str) -> str:
    """The key a data-i18n element's inner source produces.

    Unescaped, because the browser latches el.textContent, which has already
    decoded the entities. Reading the raw source instead invents a key ending
    in "&amp;" that no locale can ever be missing and no browser will ever ask
    for: the gate goes green and the page renders English.
    """
    return html.unescape(re.sub(r"<[^>]+>", "", block)).strip()


def markup_keys(source: str) -> set:
    """Keys the static passes in i18n.js would latch out of this markup."""
    keys = set()
    # applyHeadI18n latches these two out of <head> rather than off an attribute.
    for pattern in (r"<title>(.*?)</title>",
                    r"<meta name=\"description\" content=\"([^\"]*)\""):
        m = re.search(pattern, source, re.S)
        if m:
            keys.add(html.unescape(m.group(1)).strip())
    blocks, attr_keys = markup_blocks(source)
    keys |= attr_keys
    keys |= {block_key(b) for b in blocks}
    keys.discard("")
    return keys


def markup_children(source: str) -> list:
    """data-i18n elements holding an element, as (key, tag name) pairs.

    applyStaticI18n assigns el.textContent, so every child element inside a
    translated sentence is deleted on the first paint — the link, the <b>, the
    <br>. Nothing else here notices: the key extracts perfectly either way, the
    dictionaries answer it, and the gate is green over markup the browser is
    about to destroy. So the rule is checked rather than written down.
    """
    found = []
    for block in markup_blocks(source)[0]:
        m = TAG.search(block)
        if m:
            found.append((block_key(block), m.group(1) or m.group(3)))
    return found


CALL = re.compile(
    r"(?<![\w.$])(?:(?:window\.)?CarinoI18n\.t|window\.t|TT|t)"
    r"\(\s*(?:(['\"])(.*?)(?<!\\)\1|([^'\")\n][^,)\n]*))")


def unescape_js(raw: str) -> str:
    """A string literal's escapes, decoded exactly as JsLiteral decodes them.

    The dictionary side of every comparison comes through JsLiteral, which
    turns \\' into ', while a call site is captured raw by the regex above.
    Left to disagree, one escaped quote reports the same string as both missing
    and orphaned in every locale — eight errors, and nothing the author can
    edit that satisfies both readers at once.
    """
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)),
                  raw, flags=re.S)


def call_keys(text: str) -> tuple:
    """Literal keys in one file, plus the line and expression of every lookup
    whose argument is not a literal."""
    keys, dynamic = set(), []
    for m in CALL.finditer(text):
        if m.group(2) is not None:
            keys.add(unescape_js(m.group(2)))
        else:
            dynamic.append((text.count("\n", 0, m.start()) + 1, m.group(3).strip()))
    return keys, dynamic


def js_keys(paths) -> tuple:
    """Literal keys, plus the call sites whose argument is not a literal.

    Whole file rather than line by line: a long string wrapped onto the line
    after its TT( would otherwise read as no reference at all, and the four
    translations of it would be reported as orphans.
    """
    keys, dynamic = set(), []
    for path in paths:
        rel = path.relative_to(ROOT).as_posix()
        found, unresolved = call_keys(path.read_text(encoding="utf-8"))
        keys |= found
        dynamic += [(rel, n, expr) for n, expr in unresolved]
    return keys, dynamic


# ----------------------------------------------------------------- checks

def placeholders(value) -> set:
    forms = value.values() if isinstance(value, dict) else [value]
    return {p for form in forms for p in re.findall(r"\{(\w+)\}", form)}


# ---------------------------------------------------------------- self-test

# The two readers above are the whole gate: everything else compares sets they
# produced. Both have already been wrong in the direction that matters — a
# reader that quietly extracts the wrong string reports no problem at all, and
# the run goes green over a page that renders English. So they are exercised
# against known answers on every run, before any dictionary is looked at. It
# costs a millisecond and it is the only part of this file nothing else checks.
SELF_TESTS = [
    # An entity is decoded by the time the browser latches el.textContent, so
    # the key the gate looks for has to be decoded too.
    ("entity in a translated element",
     lambda: markup_keys('<span data-i18n>Nothing leaves this device &amp; nothing is sent.</span>'),
     {'Nothing leaves this device & nothing is sent.'}),
    ("entity in a translated attribute",
     lambda: markup_keys('<button data-i18n-attr="aria-label" aria-label="Copy &amp; close"></button>'),
     {'Copy & close'}),
    ("entity in a translated placeholder",
     lambda: markup_keys('<input data-i18n-ph placeholder="Search &#8212; anywhere">'),
     {'Search — anywhere'}),
    # An element of the same name inside a translated sentence must not end the
    # key at the first closing tag: the browser reads to the outer one.
    ("markup nested inside a translated sentence",
     lambda: markup_keys('<span data-i18n>Read <span>this</span> aloud<br>now.</span>'),
     {'Read this aloudnow.'}),
    # ...and that same element is what textContent deletes, which is the whole
    # reason the rule exists. Both directions, because a check that never fires
    # and a check that always fires look the same from here.
    ("element child inside a translated element",
     lambda: markup_children('<p data-i18n>Copy <b>link</b></p>'),
     [('Copy link', 'b')]),
    ("text-only translated element",
     lambda: markup_children('<p data-i18n>Copy link</p>'), []),
    # The three ways of reaching t() that i18n.js actually exports, and one that
    # belongs to somebody else's object.
    ("every advertised spelling of the lookup",
     lambda: call_keys("t('A'); window.t('B'); TT('C'); window.CarinoI18n.t('D');")[0],
     {'A', 'B', 'C', 'D'}),
    ("a lookup on an unrelated object is not one of ours",
     lambda: call_keys("Other.t('E'); obj.tt('F');")[0], set()),
    # The regex captures the source; JsLiteral captures the string. They have to
    # agree about an escape or the same key is reported missing and orphaned.
    ("escaped quote in a call site",
     lambda: call_keys("TT('A clerk\\'s note')")[0], {"A clerk's note"}),
    # Whatever the reader does with a comment, it must not be to raise.
    ("block comment between entries",
     lambda: JsLiteral("{ /* a note\n  spanning lines */ a: 'x', // trailing\n b: 'y' }", 0).obj(),
     {'a': 'x', 'b': 'y'}),
    ("block comment before the first key",
     lambda: JsLiteral("{/*note*/'a b': 'x'}", 0).obj(),
     {'a b': 'x'}),
    ("comment markers inside a value are text",
     lambda: JsLiteral("{ a: 'http://x /* y */ // z' }", 0).obj(),
     {'a': 'http://x /* y */ // z'}),
    ("plural object", lambda: JsLiteral("{ a: { one: '1', other: '{n}' } }", 0).obj(),
     {'a': {'one': '1', 'other': '{n}'}}),
]


def selftest() -> list[str]:
    """Failures of the extractors themselves, as lines fit to print."""
    bad = []
    for name, run, want in SELF_TESTS:
        try:
            got = run()
        except Exception as e:
            bad.append(f"{name}: raised {type(e).__name__}: {e}")
            continue
        if got != want:
            bad.append(f"{name}: read {got!r}, expected {want!r}")
    # A malformed literal has to arrive as a message rather than a traceback.
    for name, text in (("unterminated string", "{ a: 'x }"),
                       ("unterminated block comment", "{ /* a: 'x' }"),
                       ("value this reader does not accept", "{ a: 3 }")):
        try:
            JsLiteral(text, 0).obj()
        except ParseError:
            continue
        except Exception as e:
            bad.append(f"{name}: raised {type(e).__name__} rather than ParseError")
            continue
        bad.append(f"{name}: parsed without complaint")
    return bad


def main() -> int:
    for line in selftest():
        err("tools/check_i18n.py", f"self-test: {line}")
    if errors:
        return report()

    try:
        dicts = load_object("I18N")
        counts = load_counts()
        aliases = load_object("SOURCE_ALIASES")
    except ParseError as e:
        err("i18n.js", str(e))
        return report()
    english = dicts.get("en", {})

    # i18n.js is the implementation of t(), not a caller of it.
    sources = [p for p in sorted(ROOT.glob("js/*.js")) + sorted(ROOT.glob("*.js"))
               if p != I18N]
    literal, dynamic = js_keys(sources)
    declared = {k for keys in DYNAMIC.values() for k in keys}

    # What the app actually asks for, then what the dictionaries are keyed on:
    # t() resolves an alias before it looks anything up, so a source string with
    # an alias never reaches the dictionaries under its own name.
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    markup = markup_keys(page)
    asked = markup | literal | declared

    for key, tag in markup_children(page):
        err("index.html", f"<{tag}> inside a data-i18n element: applyStaticI18n assigns "
                          f"textContent and deletes it on the first paint — translate the "
                          f"parts separately, or move the element outside: {key!r}")
    referenced = {aliases.get(key, key) for key in asked}

    for rel, n, expr in dynamic:
        if (rel, expr) not in DYNAMIC:
            err(f"{rel}:{n}", f"undeclared dynamic lookup t({expr}) — pass a literal, "
                              "or declare the keys it can produce in DYNAMIC")

    live = {(rel, expr) for rel, _, expr in dynamic}
    for entry in sorted(DYNAMIC):
        if entry not in live:
            err("tools/check_i18n.py", f"DYNAMIC declares t({entry[1]}) in {entry[0]}, "
                                       "which no longer exists — delete the entry")

    for key in sorted(set(duplicates)):
        err("i18n.js", f"key written twice; the earlier one is dead: {key!r}")

    for code in TRANSLATED:
        if code not in dicts:
            err("i18n.js", f"locale {code} is missing entirely")
            return report()

    # 1. every referenced key is translated everywhere
    for key in sorted(referenced):
        for code in TRANSLATED:
            if key not in dicts[code]:
                err(code, f"missing key: {key!r}")

    # 2. nothing is translated that nothing shows. `en` is swept too: it is the
    # one locale where an entry can shadow the markup it was copied from, and an
    # entry left behind after a reword renders the old English for ever.
    for code in ("en",) + TRANSLATED:
        for key in sorted(dicts.get(code, {})):
            if key not in referenced and key not in RESERVED:
                err(code, f"orphan key, nothing references it: {key!r}")

    # 3. the locales agree on which keys exist
    base = set(dicts[TRANSLATED[0]])
    for code in TRANSLATED[1:]:
        for key in sorted(base ^ set(dicts[code])):
            err(code, f"key present in some locales but not others: {key!r}")

    # 4. a translation may not drop a placeholder, and en may not invent one.
    # Form by form, not over their union: a plural whose `other` lost its {n}
    # renders a sentence with the number missing, and `other` is exactly what a
    # caller passing no count receives, so a union would hide it behind the
    # forms that still carry it.
    for key in sorted(base):
        want = placeholders(english.get(key, key))
        for code in ("en",) + TRANSLATED:
            value = dicts.get(code, {}).get(key)
            if value is None:
                continue
            forms = value.items() if isinstance(value, dict) else [("", value)]
            for form, text in forms:
                got = placeholders(text)
                if got != want:
                    where = f" in the {form!r} form" if form else ""
                    err(code, f"placeholders {sorted(got)} != English {sorted(want)}"
                              f"{where}: {key!r}")

    # 5. static markup has one set of variables and no way to pass another:
    # applyStaticI18n fills every data-i18n string from COUNTS. A placeholder
    # COUNTS does not carry survives fill() untouched and reaches the reader as
    # a literal {brace}, in five languages at once — and one COUNTS does carry
    # is worse, because it is filled with a number about something else and
    # nothing looks wrong. Counted strings that are not registry tallies belong
    # in a t() call with their own vars.
    supplied = set(counts)
    for key in sorted({aliases.get(k, k) for k in markup}):
        found = placeholders(english.get(key, key))
        for code in TRANSLATED:
            found |= placeholders(dicts[code].get(key, ""))
        for name in sorted(found - supplied):
            err("index.html", f"{{{name}}} in static markup, which is only ever filled "
                              f"from {sorted(supplied)}: {key!r}")
        taken = sorted(found & supplied)
        if taken and key not in REGISTRY_COUNTED:
            err("index.html", f"{taken} in static markup would be filled with the registry "
                              f"tally, which is not what this sentence counts — move it to a "
                              f"t() call with its own vars: {key!r}")

    # 6. an untranslated string is worse than a missing one — it looks checked
    for code in TRANSLATED:
        for key, value in sorted(dicts[code].items()):
            if isinstance(value, dict):
                continue
            if {("*", key), (code, key)} & IDENTICAL_ON_PURPOSE:
                continue
            if value == (english.get(key) or key):
                err(code, f"value is identical to English: {key!r}")

    # 7. the shipped fallback counts still describe the registry
    index = json.loads((ROOT / "registry" / "index.json").read_text(encoding="utf-8"))
    countries = index["countries"]
    actual = {
        "n": len(countries),
        "t1": sum(1 for c in countries if c["tier"] == 1),
        "t2": sum(1 for c in countries if c["tier"] == 2),
    }
    if counts != actual:
        err("i18n.js", f"COUNTS {counts} no longer matches the registry {actual}")

    # 8. an alias only earns its place while the older source string is still in
    # the markup, and it must not compete with a key of the same name.
    for src, dst in sorted(aliases.items()):
        if src not in asked:
            note("i18n.js", f"SOURCE_ALIASES entry matches nothing any more: {src!r} — delete it")
        for code in ("en",) + TRANSLATED:
            if src in dicts.get(code, {}):
                err(code, f"{src!r} is both a SOURCE_ALIASES source and a key; "
                          "the key can never be reached")
        if dst in aliases:
            err("i18n.js", f"SOURCE_ALIASES points {src!r} at another alias; aliases do not chain")

    # 9. the two lists of exceptions above rot silently, so they are swept too.
    for key, why in sorted(RESERVED.items()):
        if key in referenced:
            note("tools/check_i18n.py",
                 f"reserved key is referenced now: {key!r} — drop it from RESERVED ({why})")
        elif not any(key in dicts[code] for code in TRANSLATED):
            err("tools/check_i18n.py", f"RESERVED names a key no locale carries: {key!r}")

    for code, key in sorted(IDENTICAL_ON_PURPOSE):
        wanted = TRANSLATED if code == "*" else (code,)
        if not any(dicts.get(c, {}).get(key) == (english.get(key) or key) for c in wanted):
            note("tools/check_i18n.py",
                 f"IDENTICAL_ON_PURPOSE exempts {key!r} for {code}, which no longer needs it")

    return report()


def report() -> int:
    for line in notes:
        print(line)
    for line in errors:
        print(line, file=sys.stderr)
    if errors:
        print(f"\n{len(errors)} problem(s).", file=sys.stderr)
        return 1
    print("i18n OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
