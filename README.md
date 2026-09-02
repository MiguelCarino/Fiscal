# Fiscal

**fiscal.carino.systems** — your tax identity, personal and business, for every
jurisdiction you file in. Offline, on-device, never transmitted.

Dealing with tax information in more than one country means reciting the same
numbers at counters that each want them in a different shape: an RFC plus a
régimen fiscal in Mexico, a document type plus a number in Colombia, a name and
an EIN in the United States. Every country solved its own version of this with a
mechanism that stops at its own border. Fiscal is the part nobody built: one
card, any jurisdiction, in the form a counter actually accepts.

## Try it

`fiscal.carino.systems/#demo` loads eight sample cards across seven
jurisdictions. Every identifier in them is invented, and every one satisfies its
country's real check-digit rule — a demo whose validation badges all read red
would teach the opposite of what the app does. The samples live in memory only:
they are never written to storage and never mix with real cards.

## What it does

- **A wall of cards.** Every card you hold, as a tile: country, name, the lead
  identifier, and a coloured stripe for its kind. The country you are standing
  in sorts first. Click one and it opens.
- **Each card has its own URL.** `#/mx-business-carino-systems` opens that card
  directly — bookmark it, or put its QR somewhere you reach for often. The
  address is built from what the card *is*, so it survives an edit, and it is a
  fragment, so it never reaches a server.
- **Copy one field or all of them.** Every field in the popup has its own copy
  button; `Copy all` takes the block.
- **Counter mode.** Large, legible, one tap from the card. Opens on the country
  you are standing in.
- **Phonetic dictation.** The largest source of friction at a counter is a
  misheard letter, not a missing field. Every identifier is spelled out in the
  interface language — NATO in English, the *alfabeto de ciudades* in Spanish,
  the Brazilian set in Portuguese, NATO in katakana and in Cyrillic.
- **Check digits, validated on device.** A typo made once at setup is caught
  before it becomes a rejected CFDI months later.
- **Personal and business cards, any number per country.** An RFC as persona
  física and a company RFC are two cards in Mexico, with different régimen codes
  and different required fields.
- **249 jurisdictions from the first release**, honestly tiered (below).
- **Offline.** Installable, precached, and it makes no network request of its
  own once loaded.

### Getting data in

- **Read the authority's own document.** Drop in a Mexican Constancia de
  Situación Fiscal or a Colombian RUT and the fields fill themselves. These are
  generated PDFs with a real text layer, so it is exact extraction rather than
  OCR, and `pdf.js` is vendored — nothing is uploaded and nothing is fetched.
- **Or paste anything.** An email signature, a WhatsApp message from your
  accountant. The same parsers run over pasted text.
- **Nothing is trusted blindly.** Every extracted value must pass the registry's
  own format check before it is offered, and Colombia's verification digit is
  *computed* from the NIT rather than scraped off the page — the RUT prints it in
  a separate numbered box, and a regex reaching for "the next digit" reliably
  picks up the number of the next box instead.
- Mexican names are stripped of the régimen societario (`SA DE CV`), because SAT
  requires the name without it and that mismatch is the most common cause of a
  rejected CFDI 4.0.

### Getting data out

- **vCard QR** — the only payload every phone camera decodes with no app. It
  lands in contacts, with the tax fields carried in `X-TAXID-*`.
- **The card as a PNG**, drawn at 2x with the QR embedded, because in Mexico and
  Colombia this transaction really happens over WhatsApp.
- **A link that carries the card after the `#`.** Browsers never send a fragment
  to a server, so a shareable URL exists without this project ever holding a
  database of tax identifiers. It does land in history and clipboards, which the
  interface says out loud. A received card is shown, never silently stored.
- **Straight into Quote.** `carino-bridge.js` hands the card to
  quote.carino.systems window-to-window, and the quotation gains the issuer's
  tax line under the org name. Quote trusts only Fiscal's origin and ignores
  anything else rather than prompting.

### Staying correct

- **Peppol electronic address** (EAS scheme code + identifier) as a first-class
  field where the scheme is published. ViDA is in force and mandates land across
  Europe through 2026 and beyond; carrying the routable address now means the
  card is already right when a counterparty moves to Peppol.
- **E-invoicing posture per jurisdiction** — mandatory, scheduled, partly in
  force, or none, with the scheme name and any commencement date. That is what
  keeps this from being a static wallet.
- **Staleness nudges.** Tax data goes stale silently. The card says so when the
  authority revised a catalogue after you last confirmed it, or when a year has
  passed without you confirming it at all.

### Card colours

One colour per kind, used as a stripe, a chip and a hover border — never a
filled card. **Business is the house gold** (`#eab308`), because invoicing is
what this tool is mostly for and the business card is the one that ends up on a
quotation. **Personal is the cool counterpart** (`#38bdf8`), already in the
Branding palette. Both stay subordinate to gold-as-the-interactive-accent, so
the wall reads as one system rather than a colour chart.

### At the counter

- **Speak it aloud.** `SpeechSynthesis` reads the identifier out using the same
  phonetic table the screen shows — "C de Coruña", not "csy". Voices are per
  platform, so the button appears only where the API exists.
- **The screen stays awake** while counter mode is open (Wake Lock, where
  granted). A screen going dark mid-transaction is the small failure that makes
  someone give up and read numbers off a photo instead.

## What it deliberately does not do

- **File anything.** Not a CFDI issuer, not a DIAN client. The moment it files,
  it inherits every regulator's compliance surface.
- **Call an authority.** No live SAT or DIAN lookups. They need auth, they are
  CORS-hostile, and adding them would break the zero-network guarantee that the
  privacy story rests on.
- **Store another person's data.** Your cards only. That is the line between a
  personal card and an unregulated CRM.
- **Hold a US SSN or a Japanese My Number.** Both are refused at the editor with
  an explanation and a pointer to what to use instead (an EIN, a corporate
  number). Refusal is declared in the jurisdiction record, not hard-coded.
- **US exemption certificates — not yet.** Per-state forms, expiry tracking and
  PDF generation are a project of their own. `certificateProfile` is reserved
  and unused.

## Privacy

Nothing leaves the device. No analytics, no sync, no account, no error
reporting, no third-party CDN, no runtime font host. That is also the legal
architecture: with no transmission there is no controller, no processor and no
cross-border transfer, so the GDPR and LGPD questions that would otherwise
dominate a global product never arise.

Cards live in `localStorage` in one browser on one device. Clearing site data
deletes them. `Copy a backup` puts the JSON on your clipboard; where it goes
next is your decision, not the app's.

## Coverage tiers

Every jurisdiction is present from the first release, and each says which tier
it is at rather than implying an authority it does not have.

| Tier | What the record carries | What the app can do | Members |
|---|---|---|---|
| **1** | Checksum engine, invoice profile and delivery, verified against the authority's own publication | Validate, generate the right field set, dictate phonetically | MX, CO, US |
| **2** | Published structure, plus a check digit where the authority publishes one | Validate format and check digit; store and present | AR, AU, BE, BR, CA, CL, DE, ES, FR, GB, GR, IN, IT, JP, NL, PE, PT, ZA |
| **3** | Country code only | Store, present, dictate, copy, print — marked unverified | The remaining 228 |

Promotion is a data change: add `registry/<iso>.json`, move the code into
`TIER1`/`TIER2` in `tools/build_index.py`, regenerate, and the gate does the
rest. It is never a change to the app.

## The engines

`js/engines.js` is short and never grows per country. Nearly every national tax
identifier is a weighted modulus over a digit string, so the file ships nine
parameterised engines and each jurisdiction is expressed as data.

| Engine | Verified against |
|---|---|
| `mod11-weighted` | BR CPF/CNPJ, CO NIT, AR CUIT, CL RUT, PE RUC |
| `luhn-modN` | IN GSTIN (base 36) |
| `mod9` | JP 法人番号 — the check digit leads rather than trails |
| `mod89` | AU ABN |
| `mod97` | BE VAT |
| `mod511` | FR numéro fiscal |
| `pow2-weighted` | GR ΑΦΜ |
| `mx-rfc` | MX RFC — its own alphanumeric table |
| `structural` | US EIN and every tier 3 record |

Each was checked against real published identifiers (the DIAN's own NIT, SUNAT's
RUC, AFIP's CUIT, the ATO's ABN, the NTA's corporate number, the canonical
CPF/CNPJ and GSTIN test values) before being committed.

`structural` is not a stub — it is the honest answer where no check digit is
published, and the badge says "format only" rather than implying a verification
that did not happen. The US EIN sits there on purpose: the IRS campus prefix
list has changed repeatedly and is not published as a stable machine-readable
set, so validating against a copy of it would reject legitimate numbers.

## Provenance and the gate

The registry is the product, so the failure mode that matters is a record that
quietly claims more authority than it has. Every record cites the authority and
the date it was verified, and `tools/validate.py` fails the build without them.

```sh
python3 tools/build_index.py     # regenerate registry/index.json from iso-codes
python3 tools/validate.py        # the gate — non-zero exit means do not ship
```

The gate also refuses unknown engine names, disagreements between a record's
tier and `index.json`, profiles naming fields that do not exist, and tier 1
records missing an invoice profile. It *warns* — deliberately, rather than
failing — when a tier 1 or 2 record has no arithmetic check anywhere, because
that is sometimes correct and always worth a second look.

The country list is not hand-maintained: `tools/build_index.py` reads the system
`iso-codes` package, so the set of jurisdictions is authoritative and the
regeneration is reproducible.

## Running it

Any static server; there is no build step.

```sh
python3 -m http.server 8000
```

Opening `index.html` directly from disk will not work — `fetch` of the registry
is blocked on `file://`, and the page says so rather than failing silently.

## Structure

```
index.html            shell, styles, static markup
i18n.js               five locales; English strings are the keys
js/engines.js         the nine checksum engines
js/phonetic.js        five phonetic tables
js/store.js           local card storage
js/import.js          PDF + paste readers for the authorities' own documents
js/share.js           vCard, QR, card image, fragment link, Quote handoff
js/app.js             counter mode, editor, jurisdiction picker
demo.json             sample cards for #demo — fake, but check-digit valid
registry/index.json   generated — 249 jurisdictions with tiers
registry/<iso>.json   one record per tier 1 / tier 2 jurisdiction
tools/build_index.py  regenerates the index from iso-codes
tools/validate.py     the CI gate
sw.js                 offline precache
vendor/pdfjs/         pdf.js, loaded on demand (1.5 MB, not precached)
vendor/qrcode-*.js    QR encoder (MIT), used for both the QR and the card image
```

Chrome (navbar, language switcher, clock, fonts) is the shared fleet code, drop
-in and unmodified. `carino-lang.js` owns the language preference across
`.carino.systems`; this app owns only its dictionary.

## Still not done, deliberately

- **No server-side share link.** One `/miguel` endpoint would make this project
  the controller of a store of tax identifiers, which is the single change that
  would undo everything the architecture buys.
- **No signed wallet passes.** Apple `.pkpass` and Google Wallet both need
  server-side signing keys.
- **No OCR.** Both documents that matter carry a real text layer. A confidently
  wrong tax ID is worse than no tax ID.

## Licence

AGPL-3.0. See `LICENSE`. Vendored dependencies keep their own notices:
`vendor/LICENSE-qrcode-generator.txt` (MIT) and `vendor/pdfjs/LICENSE`
(Apache-2.0); both are compatible with AGPL-3.0.
