// Carino Fiscal — card storage.
//
// Everything here is local and stays local. There is no sync, no account, no
// telemetry and no network call anywhere in this app; that is not a preference,
// it is the architecture that keeps a file full of national identity numbers
// from ever becoming somebody's data-protection problem — this app is never a
// controller of anything, because nothing is ever transmitted.
//
// localStorage rather than IndexedDB: the payload is a handful of short strings
// plus at most one small image per card, every read is synchronous at render
// time, and the whole store fits in a quota that is available everywhere. The
// cost is the 5 MB ceiling, which is why images are capped on the way in.
//
// Every access is wrapped: a private window, cleared site data, or a browser
// set to block storage must degrade to an empty store, never to a broken page.
//
// One gate stands in front of the disk in both directions, and every write path
// — an edit, a card off a link, a restored backup — goes through it. It is also
// where the promise that this app will not hold a US Social Security Number or
// a Japanese My Number is kept: not by trusting the editor to have refused one,
// because a backup is a file anybody can edit and a link is written by whoever
// sends it, but by testing the value itself on the way to localStorage.

(function () {
    'use strict';

    const KEY_CARDS = 'carino.fiscal.cards';
    const KEY_LAST = 'carino.fiscal.last';         // { iso, kindByIso: { MX: 'business' } }
    const KEY_TRUST = 'carino-bridge.trusted';     // written by carino-bridge.js, erased with the rest
    const IMAGE_CAP = 400 * 1024;                  // ~400 KB of data URL per card

    const APP = 'carino-fiscal';                   // envelope marker on a backup
    const FORMAT = 1;                              // backup format, not app version

    let memory = null;   // fallback when storage throws (private mode, blocked)

    function read(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function write(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            // Quota or a blocked accessor. Keep the session working in memory and
            // let the caller tell the user their edit will not survive a reload.
            return false;
        }
    }

    function drop(key) {
        try {
            window.localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    }

    function storageAvailable() {
        try {
            const probe = '__carino_fiscal_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return true;
        } catch (e) {
            return false;
        }
    }

    function uid() {
        // Not a security token — just a stable key for editing and deleting.
        return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* ---------------- the gate ----------------
       One definition of what a card is, and both directions go through it. A
       card can arrive from a shared link, from a backup somebody pasted in by
       hand, or from a store written by an older build, and none of those are
       typed: a label that is an object rather than a string is enough to break
       slug building for every card on the wall, not just its own. So nothing is
       trusted on the way in and nothing untrusted is handed out on the way back.

       Keys are bounded in shape and in number, as are the values, so a crafted
       payload cannot smuggle a field past the renderer or quietly eat the quota
       the real cards need — and a value this app refuses to hold never reaches
       localStorage by any of the ways in. */

    const LABEL_CAP = 80;
    const VALUE_CAP = 4096;      // an address is the long one; an identifier is a dozen characters
    const VALUE_KEYS = 40;       // no jurisdiction asks for anything close to this many

    function text(v, cap) {
        if (typeof v === 'number' && isFinite(v)) v = String(v);
        if (typeof v !== 'string') return '';
        return v.trim().slice(0, cap);
    }

    /* ---------------- the two numbers this app will not hold ----------------
       registry/us.json and registry/jp.json say so as well, and that is what the
       editor shows the user — but the registry arrives over an async fetch and
       this gate is synchronous, so the refusal has to hold on a write that
       happens before any record was loaded and through the paths that load
       none: a restored backup, a card off a link, a store written by an older
       build.

       Three ways of recognising one, matching js/share.js line for line so the
       two layers can never disagree about the same value. The key name is the
       weakest and it used to be the only one here: a backup can spell it 'SSN'
       and can name any country it likes, so the name is refused under any ISO
       and in any capitalisation. The shape is what actually catches it, because
       an SSN gets typed into the EIN box — that is where someone reaches for
       the number they know — and by the time it is a value in a card nothing is
       left of which box it came from. And where a record is at hand the record
       is asked, through FiscalEngines.refusalFor(), so a refusal the registry
       grows later holds here without this file being edited.

       The shape is read over every piece of text a card carries and not only
       over the boxes a schema calls identifiers. A card holds prose as well —
       a legal name, an address — and 'Bob Smith, SSN 123-45-6789' is exactly
       how one of these arrives there: the user copies the line off a form. A
       rule that only ever saw a value it expected to BE the number left that
       text on the disk, in the QR, in the vCard and on the printed sheet.

       The scopes are deliberately asymmetric. The SSA's 3-2-4 grouping is worn
       by no identifier and no field anywhere in registry/ — the one nine-digit
       number printed that way is the ITIN, which always starts with 9, hence the
       lookahead — so it is refused whatever country the card claims. Twelve
       digits are not so distinctive: GB's branch VAT number 980780684001 is
       twelve of them and real, so My Number is refused under JP alone. A refusal
       that fires on a legitimate number is worse than the hole it closes. */

    const SEP = '[\\s./\\u2010-\\u2015\\u2212-]{1,3}';
    const REFUSALS = [
        {
            key: 'ssn', iso: 'US', anywhere: true,
            body: '(?!9)[0-9]{3}' + SEP + '[0-9]{2}' + SEP + '[0-9]{4}',
        },
        {
            key: 'myNumber', iso: 'JP', anywhere: false,
            body: '[0-9]{4}(' + SEP + ')?[0-9]{4}(' + SEP + ')?[0-9]{4}',
        },
    ];

    // One reading of the rule, searched rather than anchored, over every piece
    // of text on a card. What is refused is the grouping and not the digits:
    // nine bare digits are an EIN as readily as an SSN, so the pattern demands
    // the SSA's punctuation between them. That is what lets the same search run
    // over an address without taking a nine-digit run, a postal code beside a
    // street number or a company name with digits in it — and it is why the
    // digits either side are still anchored, because a run inside a longer one
    // is a different number and refusing it would fire on something legitimate.
    REFUSALS.forEach((r) => {
        r.within = new RegExp('(^|[^0-9])' + r.body + '([^0-9]|$)');
    });

    function refusedName(key) {
        const k = String(key).toLowerCase();
        const hit = REFUSALS.filter((r) => r.key.toLowerCase() === k)[0];
        return hit ? hit.key : null;
    }

    // Read as far as the text will be kept and no further, so what is tested is
    // what would be written. Folded first, so full-width digits are not a way
    // around it.
    function refusedText(value, iso, cap) {
        const raw = text(value, cap).normalize('NFKC');
        if (!raw) return null;
        const where = String(iso || '').toUpperCase();
        const hit = REFUSALS.filter((r) => (r.anywhere || r.iso === where)
            && r.within.test(raw))[0];
        return hit ? hit.key : null;
    }

    // A value and the nickname differ only in how much of them is kept: the
    // nickname has no key name and no record rule to consult, but it is written
    // to the same disk, so a number typed into it is stored exactly as one
    // typed into a field is.
    function refusedShape(value, iso) {
        return refusedText(value, iso, VALUE_CAP);
    }

    function refusedWithin(value, iso) {
        return refusedText(value, iso, LABEL_CAP);
    }

    function refusedByRecord(key, value, rec) {
        const engines = window.FiscalEngines;
        if (!engines || typeof engines.refusalFor !== 'function') return null;
        const list = (rec && Array.isArray(rec.identifiers)) ? rec.identifiers : [];
        const ident = list.filter((i) => i && i.key === key)[0];
        const rule = ident ? engines.refusalFor(text(value, VALUE_CAP), ident) : null;
        return rule ? rule.key : null;
    }

    function refusalFor(key, value, iso, rec) {
        return refusedName(key) || refusedShape(value, iso) || refusedByRecord(key, value, rec);
    }

    // Everything on this card that will not be kept, as [{key, refused, where}]
    // — `key` as the card spells it, `refused` as the registry's `refused[]`
    // names it, so the caller can look up the sentence that explains itself, and
    // `where` saying whether that key names a value or the nickname. Dropping
    // the value is half of keeping the promise; saying so is the other half,
    // because a number that silently fails to save gets typed in again.
    //
    // The label is reported last and under `where: 'label'` rather than as a
    // value key, because a card is free to hold a value called `label` and
    // because the two need different sentences: one number was not stored, the
    // other was a nickname blanked.
    function refusedIn(card, rec) {
        const iso = text(card && card.iso, 8).toUpperCase();
        const values = (card && card.values && typeof card.values === 'object') ? card.values : {};
        const found = Object.keys(values).map((key) => {
            const refused = refusalFor(key, values[key], iso, rec);
            return refused ? { key: key, refused: refused, where: 'value' } : null;
        }).filter(Boolean);
        const label = refusedWithin(card && card.label, iso);
        return label
            ? found.concat([{ key: 'label', refused: label, where: 'label' }])
            : found;
    }

    function sanitiseCard(card, rec) {
        if (!card || typeof card !== 'object' || Array.isArray(card)) return null;

        const iso = text(card.iso, 8).toUpperCase();
        if (!/^[A-Z]{2}$/.test(iso)) return null;   // with no jurisdiction there is no card to render

        // A nickname carrying one of the two numbers is blanked rather than
        // costing the card. Nothing is read off a nickname at a counter, so
        // losing one costs the user nothing they need, while refusing a whole
        // card over the name its owner gave it would be the refusal that fires
        // on something legitimate.
        const label = text(card.label, LABEL_CAP);
        const clean = {
            iso: iso,
            kind: card.kind === 'business' ? 'business' : 'personal',
            label: refusedWithin(label, iso) ? '' : label,
            values: {},
        };

        // Read wider than the target so an over-long id is refused rather than
        // silently rewritten: two hand-edited cards sharing their first forty
        // characters would otherwise become one card that overwrites the other.
        const id = text(card.id, 64);
        if (/^[A-Za-z0-9_-]{1,40}$/.test(id)) clean.id = id;   // otherwise save() mints a fresh one

        const values = (card.values && typeof card.values === 'object') ? card.values : {};
        Object.keys(values).forEach((key) => {
            // The key shape is share.js's, and every key in registry/ satisfies
            // it. It keeps '__proto__' out and it bounds the key as well as the
            // value, so a crafted backup cannot spend the quota on key names.
            if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) return;
            if (Object.keys(clean.values).length >= VALUE_KEYS) return;
            // Read one character wider than the cap, for the reason the id is:
            // a value past it was not written by this app, and js/share.js
            // refuses such a card rather than trimming it. Trimming here would
            // leave the two layers disagreeing about the same string — and a
            // trimmed tax identifier is a wrong one, which is worse than a
            // missing one.
            const v = text(values[key], VALUE_CAP + 1);
            if (!v || v.length > VALUE_CAP || refusalFor(key, v, iso, rec)) return;
            clean.values[key] = v;
        });

        const verifiedOn = text(card.verifiedOn, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn)) clean.verifiedOn = verifiedOn;

        const qr = typeof card.officialQr === 'string' ? card.officialQr : '';
        if (/^data:image\//.test(qr) && qr.length <= IMAGE_CAP) clean.officialQr = qr;

        return clean;
    }

    /* ---------------- cards ---------------- */

    function all() {
        const raw = memory || read(KEY_CARDS, []);
        if (!Array.isArray(raw)) return [];
        const cards = [];
        raw.forEach((c) => {
            const clean = sanitiseCard(c);
            if (clean) cards.push(clean);
        });
        return cards;
    }

    function persist(cards) {
        const ok = write(KEY_CARDS, cards);
        // A storage failure is a condition, not a verdict. The write that comes
        // after a delete may well fit where the last one did not, so every
        // attempt goes to disk first and memory holds only what disk refused.
        memory = ok ? null : cards;
        return ok;
    }

    function forIso(iso) {
        return all().filter((c) => c.iso === iso);
    }

    function byId(id) {
        return all().find((c) => c.id === id) || null;
    }

    function save(card, rec) {
        const refused = refusedIn(card, rec);
        const clean = sanitiseCard(card, rec);
        if (!clean) return { card: null, durable: false, refused: refused };
        const cards = all();
        if (!clean.id) {
            clean.id = uid();
            cards.push(clean);
        } else {
            const i = cards.findIndex((c) => c.id === clean.id);
            if (i === -1) cards.push(clean); else cards[i] = clean;
        }
        return { card: clean, durable: persist(cards), refused: refused };
    }

    function remove(id) {
        const cards = all().filter((c) => c.id !== id);
        const durable = persist(cards);
        pruneLast(cards);
        return durable;
    }

    /* ---------------- last used ----------------
       Counter mode should open on the card you actually reach for in that
       country: the company in Monterrey, yourself in Bogotá. One toggle, no
       menu, and the app remembers per jurisdiction rather than globally.

       It is also a list of the jurisdictions you file in, which is close enough
       to a residency history that it cannot outlive the cards. Deleting the last
       card has to leave the device saying nothing, not saying less. */

    function lastState() {
        const s = read(KEY_LAST, {});
        return (s && typeof s === 'object') ? s : {};
    }

    function lastIso() {
        return lastState().iso || null;
    }

    function lastKind(iso) {
        return (lastState().kindByIso || {})[iso] || null;
    }

    function noteUse(iso, kind) {
        const code = text(iso, 8).toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) return;
        const s = lastState();
        s.iso = code;
        s.kindByIso = (s.kindByIso && typeof s.kindByIso === 'object') ? s.kindByIso : {};
        if (kind === 'personal' || kind === 'business') s.kindByIso[code] = kind;
        write(KEY_LAST, s);
    }

    // Rebuilt from the surviving cards rather than pruned by the one that went:
    // the record also collects jurisdictions that were only ever browsed, and
    // those have no card to be deleted with them.
    function pruneLast(cards) {
        if (!cards.length) { drop(KEY_LAST); return; }
        const live = {};
        cards.forEach((c) => { live[c.iso] = true; });
        const s = lastState();
        const kinds = (s.kindByIso && typeof s.kindByIso === 'object') ? s.kindByIso : {};
        const next = {};
        Object.keys(kinds).forEach((k) => { if (live[k]) next[k] = kinds[k]; });
        const iso = live[s.iso] ? s.iso : null;
        if (!iso && !Object.keys(next).length) { drop(KEY_LAST); return; }
        write(KEY_LAST, iso ? { iso: iso, kindByIso: next } : { kindByIso: next });
    }

    // The one-button version of "clear site data", for the user who is handing
    // the phone over now and does not know where that setting lives. The bridge's
    // trusted-origin list goes too: it names the fleet tools you handed cards to,
    // which is the same residue in a different key. The service worker is left
    // alone deliberately — it caches the app shell and the registry, never a
    // card, and unregistering it would cost the offline mode that is the whole
    // point of this app at a counter, for no privacy at all.
    function wipe() {
        memory = null;
        const gone = drop(KEY_CARDS) && drop(KEY_LAST);
        drop(KEY_TRUST);
        return gone && !read(KEY_CARDS, null) && !read(KEY_LAST, null);
    }

    /* ---------------- images ----------------
       Mexico's Cédula de Datos Fiscales QR is stored as the image SAT issued,
       not regenerated. Capped so one card cannot exhaust the quota for all the
       others. */

    function readImage(file) {
        return new Promise((resolve, reject) => {
            if (!file) return reject(new Error('no-file'));
            if (!/^image\//.test(file.type)) return reject(new Error('not-an-image'));
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('read-failed'));
            reader.onload = () => {
                const url = String(reader.result || '');
                if (url.length > IMAGE_CAP) return reject(new Error('too-large'));
                resolve(url);
            };
            reader.readAsDataURL(file);
        });
    }

    function usage() {
        try {
            const cards = window.localStorage.getItem(KEY_CARDS) || '';
            const last = window.localStorage.getItem(KEY_LAST) || '';
            return cards.length + last.length;
        } catch (e) {
            return 0;
        }
    }

    /* ---------------- backup ----------------
       The one file that leaves the device, and it leaves in the user's hands.
       That makes the shape a contract in two directions: importAll must accept
       exactly what exportAll writes, and a person reading it in a notes app has
       to be able to see what they are holding — which is why it is indented JSON
       with the jurisdiction first and no encoding of any kind.

       Storage ids are not in it. They mean nothing on another device, and every
       card gets a fresh one on the way in. */

    function exportAll() {
        const cards = all().map((c) => {
            const out = { iso: c.iso, kind: c.kind, label: c.label, values: c.values };
            if (c.verifiedOn) out.verifiedOn = c.verifiedOn;
            if (c.officialQr) out.officialQr = c.officialQr;
            return out;
        });
        return JSON.stringify({
            app: APP,
            version: FORMAT,
            exported: new Date().toISOString().slice(0, 10),
            cards: cards,
        }, null, 2);
    }

    // Two cards are the same card when they say the same thing, whatever id
    // either one carries. Restoring the same backup twice is what a nervous user
    // does, and it must not end in two of everything.
    function fingerprint(card) {
        const keys = Object.keys(card.values).sort();
        return [card.iso, card.kind, card.label.toLowerCase()]
            .concat(keys.map((k) => k + '=' + card.values[k])).join('\u0001');
    }

    // Throws with a reason the UI can name: 'not-json' (it did not parse),
    // 'not-a-backup' (it parsed but is not ours), 'shape' (ours, but the cards
    // are missing). Anything that survives that is still put through the gate
    // card by card, so a valid envelope full of nonsense imports nothing rather
    // than storing nonsense.
    function importAll(json, opts) {
        let parsed;
        try {
            parsed = (typeof json === 'string') ? JSON.parse(json) : json;
        } catch (e) {
            throw new Error('not-json');
        }
        if (!parsed || typeof parsed !== 'object' || parsed.app !== APP) throw new Error('not-a-backup');
        if (!Array.isArray(parsed.cards)) throw new Error('shape');

        // A backup written by a later build is read, not rejected: the gate
        // drops whatever it does not recognise, so the worst case is a card that
        // comes back with fewer fields than it left with. The caller says so.
        const version = Number(parsed.version);
        const newer = !(version <= FORMAT);

        const replace = !!(opts && opts.replace);
        const cards = replace ? [] : all();
        const seen = {};
        cards.forEach((c) => { seen[fingerprint(c)] = true; });

        let added = 0;
        let skipped = 0;
        let dropped = 0;
        let refused = 0;
        parsed.cards.forEach((raw) => {
            const clean = sanitiseCard(raw);
            if (!clean) { dropped++; return; }
            // A backup is a file somebody could have edited, so it is the likeliest
            // way for one of these to arrive. Counted, because a restore that
            // quietly holds a number back sends the user to type it in again.
            refused += refusedIn(raw).length;
            const key = fingerprint(clean);
            if (seen[key]) { skipped++; return; }
            seen[key] = true;
            clean.id = uid();           // never trust an incoming id
            cards.push(clean);
            added++;
        });

        const durable = persist(cards);
        if (replace) pruneLast(cards);
        return {
            added: added, skipped: skipped, dropped: dropped, refused: refused,
            durable: durable, newer: newer, total: parsed.cards.length,
        };
    }

    window.FiscalStore = {
        all: all,
        forIso: forIso,
        byId: byId,
        save: save,
        remove: remove,
        wipe: wipe,
        sanitiseCard: sanitiseCard,
        refusedIn: refusedIn,
        lastIso: lastIso,
        lastKind: lastKind,
        noteUse: noteUse,
        readImage: readImage,
        storageAvailable: storageAvailable,
        usage: usage,
        exportAll: exportAll,
        importAll: importAll,
        IMAGE_CAP: IMAGE_CAP,
    };
})();
