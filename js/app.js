// Carino Fiscal — the app.
//
// Counter mode is the product. Everything else on the page exists to get a
// legible, dictatable card in front of a clerk in about eleven seconds, so the
// default view is not a settings screen or a list: it is the card for the
// jurisdiction you are standing in, at the kind you last used there.
//
// Load order: engines -> phonetic -> store -> i18n -> app.

(function () {
    'use strict';

    const Engines = window.FiscalEngines;
    const Phonetic = window.FiscalPhonetic;
    const Store = window.FiscalStore;

    const TT = (s, v) => (window.t ? window.t(s, v) : s);

    /* ================= state ================= */

    let INDEX = [];               // [{ iso, flag, name, tier }]
    let BY_ISO = {};
    const RECORDS = {};           // iso -> record (fetched or synthesised)
    let iso = null;               // current jurisdiction
    let kind = 'personal';        // 'personal' | 'business'
    let loadError = null;

    // Sample cards, loaded by #demo. They live only in memory: the point of the
    // demo is to show the app working without touching — or being confused
    // with — whatever real cards this browser already holds.
    let DEMO = null;

    function allCards() { return DEMO ? DEMO : Store.all(); }
    function isoCards(code) { return allCards().filter((c) => c.iso === code); }
    function readOnly() { return !!DEMO; }

    /* ================= jurisdiction detection =================
       Timezone first, locale second. A phone's language does not change when
       its owner lands in Bogotá, but its timezone does — and "where am I
       standing" is the question counter mode is actually asking. */

    const TZ_ISO = {
        'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Cancun': 'MX',
        'America/Merida': 'MX', 'America/Chihuahua': 'MX', 'America/Hermosillo': 'MX',
        'America/Mazatlan': 'MX', 'America/Tijuana': 'MX',
        'America/Bogota': 'CO',
        'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
        'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
        'Pacific/Honolulu': 'US',
        'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR',
        'America/Recife': 'BR', 'America/Manaus': 'BR',
        'America/Santiago': 'CL', 'America/Lima': 'PE',
        'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
        'America/Winnipeg': 'CA', 'America/Halifax': 'CA',
        'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Tokyo': 'JP',
        'Europe/Paris': 'FR', 'Europe/Athens': 'GR', 'Europe/Brussels': 'BE',
        'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
        'Europe/Amsterdam': 'NL', 'Europe/Lisbon': 'PT', 'Europe/London': 'GB',
        'Africa/Johannesburg': 'ZA',
    };

    function tzIso() {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            if (TZ_ISO[tz]) return TZ_ISO[tz];
            if (tz.indexOf('America/Argentina/') === 0) return 'AR';
            if (tz.indexOf('Australia/') === 0) return 'AU';
            return null;
        } catch (e) { return null; }
    }

    function localeIso() {
        const tags = (navigator.languages && navigator.languages.length)
            ? navigator.languages : [navigator.language || ''];
        for (const tag of tags) {
            const m = /-([A-Z]{2})\b/.exec(String(tag).toUpperCase());
            if (m && BY_ISO[m[1]]) return m[1];
        }
        return null;
    }

    function detectIso() {
        const cards = allCards();
        const here = tzIso() || localeIso();

        // If you hold a card for where you are standing, that is the answer.
        if (here && cards.some((c) => c.iso === here)) return here;
        const last = Store.lastIso();
        if (last && BY_ISO[last]) return last;
        if (cards.length) return cards[0].iso;
        return (here && BY_ISO[here]) ? here : 'MX';
    }

    /* ================= names ================= */

    function lang() { return (window.CarinoLang && window.CarinoLang.current) || 'en'; }

    // The dictation table belongs to the counter, not to the phone. A clerk in
    // Guadalajara hears the alfabeto telefónico whether or not the holder set
    // the interface to English, and "Delta Echo Mike" is not a spelling anyone
    // there is listening for. js/phonetic.js says the tables are per language;
    // this is the language of the jurisdiction the card is for.
    //
    // Only where a table exists. Everywhere else the line falls back to the
    // interface language, because the person holding the phone has to be able
    // to read it out loud before the clerk can hear anything at all.
    const DICTATION = {
        AR: 'es', BO: 'es', CL: 'es', CO: 'es', CR: 'es', CU: 'es', DO: 'es',
        EC: 'es', ES: 'es', GQ: 'es', GT: 'es', HN: 'es', MX: 'es', NI: 'es',
        PA: 'es', PE: 'es', PY: 'es', SV: 'es', UY: 'es', VE: 'es',
        AO: 'pt-BR', BR: 'pt-BR', MZ: 'pt-BR', PT: 'pt-BR',
        JP: 'ja',
        BY: 'ru', KG: 'ru', KZ: 'ru', RU: 'ru',
    };

    function dictationLang(card) {
        const want = card && DICTATION[card.iso];
        return (want && Phonetic.tables && Phonetic.tables[want]) ? want : lang();
    }

    // Country names are localised by the platform rather than shipped in five
    // languages for 249 countries. The English name in index.json is the
    // fallback for engines without Intl.DisplayNames.
    let displayNames = null;
    let displayNamesLang = null;
    /* The picker re-renders on every keystroke over all 249 jurisdictions, and both of these were
       being rebuilt inside that loop. `displayNames.of` is memoised into a plain map because the
       answer only changes when the locale does, and the collator is hoisted because
       String.prototype.localeCompare constructs one PER COMPARISON — a 249-row sort is about
       1,800 of them, per keypress, on a phone. Both caches are keyed by lang() and rebuilt when
       it changes, which is the same trigger displayNames already used. */
    let nameCache = null;
    let nameCacheLang = null;
    let collator = null;
    let collatorLang = null;

    function countryNames() {
        if (nameCacheLang !== lang() || !nameCache || nameCache.size !== INDEX.length) {
            const m = new Map();
            for (let i = 0; i < INDEX.length; i++) m.set(INDEX[i].iso, countryName(INDEX[i].iso));
            nameCache = m;
            nameCacheLang = lang();
        }
        return nameCache;
    }

    function collate() {
        if (collatorLang !== lang() || !collator) {
            try { collator = new Intl.Collator(lang()); }
            catch (e) { collator = { compare: (a, b) => a.localeCompare(b) }; }
            collatorLang = lang();
        }
        return collator;
    }

    function countryName(code) {
        const entry = BY_ISO[code];
        try {
            if (displayNamesLang !== lang()) {
                displayNames = new Intl.DisplayNames([lang()], { type: 'region' });
                displayNamesLang = lang();
            }
            return displayNames.of(code) || (entry && entry.name) || code;
        } catch (e) {
            return (entry && entry.name) || code;
        }
    }

    // A date is stored the way it sorts and shown the way the reader's own
    // calendar writes it. Anything that is not a plain ISO day is handed back
    // untouched: the record's catalogue dates and the card's verifiedOn are the
    // only two that reach here, and neither is worth guessing at.
    function dateText(value) {
        const s = String(value || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        try {
            return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeZone: 'UTC' })
                .format(new Date(s + 'T00:00:00Z'));
        } catch (e) {
            return s;
        }
    }

    // Records carry labels keyed by language with an English fallback, which is
    // the same contract as the i18n dictionary.
    function label(obj, fallback) {
        if (!obj) return fallback || '';
        if (typeof obj === 'string') return obj;
        return obj[lang()] || obj.en || fallback || '';
    }

    // Tier 3 answers for a jurisdiction the index carries as tier 3 and for one
    // it does not carry at all: both are records nothing validated.
    function tierOf(code) {
        return BY_ISO[code] ? BY_ISO[code].tier : 3;
    }

    /* ================= records ================= */

    // Tier 3 has no file. Rather than refusing to work in 228 countries, we
    // synthesise the most permissive possible record: one free-form identifier,
    // structural validation only, and a UI that says plainly it is unverified.
    function syntheticRecord(code) {
        return {
            iso: code,
            tier: 3,
            synthetic: true,
            authority: null,
            identifiers: [{
                key: 'taxId',
                label: { en: 'Tax ID' },
                format: '^.{1,40}$',
                checksum: { engine: 'structural' },
            }],
            invoiceProfile: {
                personal: { required: ['taxId', 'legalName'], optional: ['address', 'email'] },
                business: { required: ['taxId', 'legalName'], optional: ['address', 'email'] },
            },
            delivery: ['counter', 'phonetic', 'copy', 'share', 'print'],
        };
    }

    async function record(code) {
        if (RECORDS[code]) return RECORDS[code];
        const entry = BY_ISO[code];
        if (!entry || entry.tier === 3) {
            RECORDS[code] = syntheticRecord(code);
            return RECORDS[code];
        }
        try {
            const res = await fetch('registry/' + code.toLowerCase() + '.json');
            if (!res.ok) throw new Error(res.status);
            RECORDS[code] = await res.json();
        } catch (e) {
            RECORDS[code] = syntheticRecord(code);
        }
        return RECORDS[code];
    }

    /* ================= generic fields =================
       legalName / address / email recur in nearly every record. Defining them
       once here keeps tier 2 and tier 3 records to the part that is actually
       jurisdiction-specific. */

    function genericField(key) {
        const G = {
            legalName: { en: 'Legal name' },
            nombre: { en: 'Name' },
            razonSocial: { en: 'Legal name' },
            address: { en: 'Address', multiline: true },
            direccion: { en: 'Address', multiline: true },
            email: { en: 'Email' },
            taxId: { en: 'Tax ID' },
        };
        const g = G[key];
        return g ? { label: { en: TT(g.en) }, multiline: !!g.multiline } : null;
    }

    // Resolve one profile key into everything the renderer needs.
    function resolveField(rec, key) {
        const ident = (rec.identifiers || []).find((i) => i.key === key);
        if (ident) return { kindOf: 'identifier', key: key, def: ident };

        const cat = (rec.catalogues || {})[key];
        if (cat) return { kindOf: 'catalogue', key: key, def: cat };

        const own = (rec.fields || {})[key];
        if (own) return { kindOf: 'field', key: key, def: own };

        const gen = genericField(key);
        if (gen) return { kindOf: 'field', key: key, def: gen };
        return null;
    }

    function profileKeys(rec, k, card) {
        const prof = (rec.invoiceProfile || {})[k] || { required: [], optional: [] };
        const req = prof.required || [];
        // Optional keys appear only once they hold a value — a counter card
        // should show what you have, not a list of blanks.
        const opt = (prof.optional || []).filter((key) => card && card.values && card.values[key]);
        return req.concat(opt);
    }

    // The one field the card is FOR, named rather than inferred from where a
    // row happened to land. Colombia's profile opens with a document-type
    // catalogue and the US, Japanese and Belgian personal profiles open with a
    // legal name, so "whatever rendered first" puts a catalogue label across the
    // screen and the tax number under it in the size for supporting detail.
    //
    // An identifier with nothing in it still counts: the row is drawn either
    // way, and a field waiting to be filled in still leads the card it is on.
    function leadKeyFor(rec, card) {
        return profileKeys(rec, card.kind, card)
            .find((key) => {
                const r = resolveField(rec, key);
                return r && r.kindOf === 'identifier';
            }) || '';
    }

    /* ================= validation display ================= */

    // Where the record's own note is about the document in the box. It joins the
    // badge's line rather than replacing it: one is this app saying what it did
    // or did not run, the other is the authority describing the identifier, and
    // dropping either leaves a verdict resting on half its reasons.
    const NOTED = { unchecked: 1, unimplemented: 1, 'not-issuable': 1 };

    // A verdict is a pair: the badge names it and the hover says what it rests
    // on. The three statuses that used to fall to an amber default are the ones
    // the engine is most certain about, so each carries its own line and none of
    // them may read softer than a failed check digit.
    function badgeFor(result, def) {
        const status = result && result.status;
        // Nothing was in the box, so there is nothing to say about it.
        if (!status || status === 'empty') return null;

        const map = {
            ok: ['ok', TT('Check digit valid')],
            reserved: ['ok', TT('Reserved official value')],
            'bad-check': ['err', TT('Check digit does not match')],
            'bad-format': ['err', TT('Wrong format')],
            'not-issuable': ['err', TT('Never issued by the authority'),
                TT('The arithmetic fits, but this is a filler value the authority never issues.')],
            refused: ['err', TT('This app never stores this number'),
                TT('A number the state uses to identify a person is refused on every card. Use the number your counter actually asks for.')],
            unchecked: ['warn', TT('Format only — no published check digit')],
            unimplemented: ['warn', TT('Published rule this build does not run'),
                TT('The authority publishes a check rule for this identifier and this build does not run it, so the number has not been checked.')],
        };
        // The last resort catches a status a future engine adds.
        const [tone, text, hover] = map[status] || ['warn', TT('Not checked')];

        // Only ever the character the engine itself computed, and only where it
        // could: a suggestion that rests on the wrong reading of where the body
        // ends points at somebody else's valid number. checkLabel names the
        // character the way the authority names it, and the wording stays
        // positionless — Japan's check digit leads the number.
        let full = text;
        if (status === 'bad-check' && result.expected) {
            const named = label(def && def.checkLabel, '');
            full += ' (' + (named ? named + ' · ' : '')
                + TT('expected') + ' ' + result.expected + ')';
        }
        // A rule that cannot see the whole number qualifies the badge itself,
        // wherever the badge goes: the wall, the printed sheet and the editor
        // carry no room for the sentence underneath it, and a bare green pass
        // on a number the engine is half blind to is the confident wrongness
        // this product exists to prevent.
        if (result.weak) full += ' · ' + TT('Worth reading back');

        let title = '';
        if (status === 'reserved') title = label(def && def.reservedNote, '');
        else if (NOTED[status]) {
            title = [hover, label(def && def.note, '')].filter(Boolean).join(' — ');
        }
        return { tone: tone, text: full, title: title || hover || '' };
    }

    // A card that arrived in a link written before payloads carried a checksum
    // is a card nothing verified, so no verdict resting on the payload having
    // survived intact may read as a confirmation.
    function checkable(card) {
        return !(incoming && card === incoming && incomingVerified === false);
    }

    // Four verdicts pass through anyway: two describe the value that actually
    // arrived, and two are outright denials. Rewriting a never-issued or a
    // refused number into an amber "not checked" would tell the holder their
    // fake is less wrong than their typo, which is the one inversion this
    // product cannot ship — so the replacement is a withdrawal of the
    // affirmative statuses and of nothing else, hover included.
    function linkBadge(badge, status, card) {
        if (!badge || checkable(card)) return badge;
        if (status === 'bad-check' || status === 'bad-format'
            || status === 'not-issuable' || status === 'refused') return badge;
        return { tone: 'warn', text: TT('Link not verified'), title: '' };
    }

    // The check digit matched and the rule itself says how far that goes. The
    // fallback is load-bearing: an engine added to FiscalEngines.WEAK with no
    // row here would otherwise print "— undefined" beside a green badge.
    function weakCopy(marker) {
        const map = {
            'rfc-weight-11': TT('The check digit matched, but it cannot see the third character. Read that one back against your document.'),
            'mod9-zero-nine': TT('The check digit matched, but it cannot tell a 0 from a 9. Read every 0 and 9 back against your document.'),
        };
        return map[marker] || '';
    }

    // A catalogue the user picks from can decide what document is in the box:
    // Colombia's tipoDocumento turns the cédula field into a passport number and
    // the NIT field into a foreign tax number, each a different label and a
    // different shape in the same field.
    function resolveVariant(def, card) {
        const v = def && def.variants;
        if (!v) return def;
        const code = String((card && card.values && card.values[v.on]) || '');
        const over = code && code !== String(v.default) ? (v.by || {})[code] : null;
        if (!over) return def;
        const out = Object.assign({}, def, over);
        // A key set to null is removed rather than set to null: co.nit's variant
        // 50 drops checkLabel and display because a number another country
        // issued has no DIAN verification digit to name and no mask to wear.
        Object.keys(over).forEach((k) => { if (over[k] === null) delete out[k]; });
        delete out.variants;
        return out;
    }

    // What a card could not take with it, said before it goes. A number that
    // silently fails to arrive is read off the original document and typed in
    // by hand, which is the hole the refusal was closing.
    //
    // A blanked nickname is not a number that was left out: counting it as one
    // would report the name its owner gave the card as a tax identifier, so the
    // two carry different sentences and the count never includes the label.
    function refusalNotes(rec, dropped) {
        const out = [];
        const numbers = (dropped || []).filter((d) => d.where === 'value');
        if (numbers.length) {
            out.push(el('div', null,
                TT('{n} numbers this app never stores were found and left out.', { n: numbers.length })));
            // The count says how much went; the record says what and why. Named
            // once per kind rather than once per field: two fields holding the
            // same kind of number have one explanation between them.
            const kinds = [];
            numbers.forEach((d) => { if (kinds.indexOf(d.refused) === -1) kinds.push(d.refused); });
            kinds.forEach((key) => {
                const block = refusalBlock(rec, key);
                if (!block) return;
                block.querySelector('.refused-t')
                    .after(el('div', 'f-badge err', TT('This app never stores this number')));
                out.push(block);
            });
        }
        if ((dropped || []).some((d) => d.where === 'label')) {
            out.push(el('div', null,
                TT('The card name held a number this app never stores, so the card was saved without a name.')));
        }
        return out;
    }

    // The refusal is the only place the app explains itself, so it is a
    // paragraph on the card rather than a hover nobody can read at a counter.
    // The key names an entry on the record, not on the identifier.
    function refusalBlock(rec, key) {
        const entry = ((rec && rec.refused) || []).find((r) => r.key === key);
        if (!entry) return null;
        const node = el('div', 'refused');
        node.append(el('div', 'refused-t', label(entry.label, key)));
        node.append(el('div', 'refused-d', label(entry.reason, '')));
        return node;
    }

    /* ================= rendering ================= */

    const $ = (sel) => document.querySelector(sel);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };

    // Three sentences have nowhere in index.html to go: what a card left
    // behind, how the hand-off to Quote went, and why a link would not open.
    // The node is built once beside the thing it talks about and emptied on
    // every write, so nothing accumulates across the cards that pass through.
    function sideNote(id, cls, before) {
        let node = document.getElementById(id);
        if (!node) {
            node = el('div');
            node.id = id;
            const anchor = $(before);
            anchor.parentNode.insertBefore(node, anchor);
        }
        node.className = cls;
        node.innerHTML = '';
        node.hidden = true;
        return node;
    }

    // Every entry point that can reject goes through here. A rejected promise
    // out of a click handler is invisible — nothing on screen, nothing the
    // holder will ever see — and what it leaves behind is a dialog that did not
    // open or a wall that did not repaint. There is no "something went wrong"
    // sentence in the dictionary and writing one here would ship English into
    // four languages, so what this owes is the page still working: the wall,
    // repainted, rather than a screen frozen halfway through an action.
    let recovering = false;

    function failed(e) {
        console.error(e);
        if (recovering) return;
        recovering = true;
        Promise.resolve().then(render)
            .catch((again) => console.error(again))
            .then(() => { recovering = false; });
    }

    function guard(fn) {
        return function () {
            try {
                return Promise.resolve(fn.apply(this, arguments)).catch(failed);
            } catch (e) {
                failed(e);
            }
        };
    }

    // The card whose detail popup is open. Everything downstream — counter
    // mode, share, the editor — acts on this rather than re-deriving a card
    // from the jurisdiction, which is what let a card be addressable at all.
    let current = null;

    function currentCard() { return current; }

    // A card's address is two halves: mx-business-carino-systems-c1a2b3c4d5,
    // readable so it means something written down, and ending in the card's own
    // id so the readable half is decoration rather than identity. Naming the
    // card by what it SAYS is what made an address break when the card was
    // renamed, made two cards claim one address, and made deleting a card
    // silently hand its address to another one — the wall order the suffix
    // counted through is not a property of the card at all.
    function slugFor(card) {
        const base = slugBase(card);
        const id = String(card.id || '');
        if (!id) return base;
        return base ? base + '-' + id : id;
    }

    function slugBase(card) {
        return [card.iso.toLowerCase(), card.kind, (card.label || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]
            .filter(Boolean).join('-');
    }

    // The id is the last segment and never contains a hyphen, so the readable
    // half can be anything without confusing the lookup. The fallback resolves
    // an address written down before ids were in them, and a card that reached
    // this device without one.
    function cardBySlug(slug) {
        const s = String(slug || '');
        const id = s.slice(s.lastIndexOf('-') + 1);
        return allCards().find((c) => c.id && c.id === id)
            || allCards().find((c) => slugBase(c) === s)
            || null;
    }

    function cardUrl(card) {
        return location.origin + location.pathname + '#/' + slugFor(card);
    }

    function copy(text, node) {
        const done = () => {
            if (!node) return;
            const was = node.getAttribute('data-copy-label') || node.textContent;
            node.setAttribute('data-copy-label', was);
            // A control that carries its own accessible name does not announce
            // the text under it, so the confirmation has to move the name too —
            // a name that changes on the focused element is what a screen
            // reader reads out, and this page has no live region to say it in.
            const named = node.getAttribute('data-copy-name') || node.getAttribute('aria-label');
            if (named) node.setAttribute('data-copy-name', named);
            node.textContent = TT('Copied');
            if (named) node.setAttribute('aria-label', TT('Copied'));
            node.classList.add('copied');
            setTimeout(() => {
                node.textContent = was;
                if (named) node.setAttribute('aria-label', named);
                node.classList.remove('copied');
            }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, done);
        } else {
            const ta = el('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) { /* nothing to do */ }
            ta.remove();
            done();
        }
    }

    function fieldValue(rec, resolved, card) {
        const raw = (card.values || {})[resolved.key] || '';
        if (resolved.kindOf !== 'catalogue') return raw;
        const opt = (resolved.def.options || []).find((o) => o.code === raw);
        return opt ? opt.code + ' — ' + opt.label : raw;
    }

    // The grouping the authority prints, which is the grouping a clerk follows
    // and a holder reads out: 'BE #### ### ###' is what a Belgian VAT looks
    // like on the invoice it is being copied onto. For the eye only — what is
    // copied, spoken, packed into a link or handed to Quote is the value as it
    // was typed, because a mask is a reading aid and not part of the number.
    //
    // A mask that does not consume the value exactly is not applied at all: a
    // NIT is nine digits or eleven, and half a mask over the wrong one of them
    // would print a grouping the authority never issues.
    function displayValue(def, value) {
        const mask = def && def.display;
        if (!value || !mask || mask.indexOf('#') === -1) return value;

        let out = '';
        let i = 0;
        for (const ch of mask) {
            if (ch === '#') {
                if (i >= value.length) return value;
                out += value[i++];
            } else if (i < value.length && value[i].toUpperCase() === ch.toUpperCase()) {
                // A literal is as often part of the value as not: the same VAT
                // is stored with its country prefix and without it.
                out += value[i++];
            } else {
                out += ch;
            }
        }
        return i === value.length ? out : value;
    }

    function renderCard(rec, big) {
        const host = big ? $('#bigFace') : $('#detailFields');
        host.innerHTML = '';
        const card = currentCard();
        if (!card) return;

        const keys = profileKeys(rec, card.kind, card);
        const leadKey = leadKeyFor(rec, card);
        // Counter mode is held up to be read, so the identifier goes first
        // rather than wherever the invoice profile lists it: the card can only
        // overflow downward, and the row at the top is the one that is on
        // screen at every height. On the detail card the profile's own order is
        // the one the authority asks for, and nothing is competing for the top.
        const order = (big && leadKey)
            ? [leadKey].concat(keys.filter((k) => k !== leadKey))
            : keys;
        // A stored value the record cannot name is still the holder's. When
        // registry/index.json never arrived every record is the synthetic one,
        // which asks for taxId and legalName and knows nothing of an RFC — and
        // a number the wall is showing that vanishes one click later reads as
        // the card having lost it. Under a record that loaded, nothing lands
        // here: resolveField answers for every key a profile can carry.
        const carried = Object.keys(card.values || {}).filter(
            (key) => card.values[key] && order.indexOf(key) === -1 && !resolveField(rec, key));

        // A profile with no identifier at all — the US personal one, until an
        // ITIN is filled in — still needs a row at the head of the card.
        let first = true;

        order.concat(carried).forEach((key) => {
            const resolved = resolveField(rec, key) || { kindOf: 'field', key: key, def: {} };
            // Before the label is read, not just before the rule is run: the head
            // of the row names the document, and a variant is a different
            // document in the same box.
            if (resolved.kindOf === 'identifier') {
                resolved.def = resolveVariant(resolved.def, card);
            }
            const value = fieldValue(rec, resolved, card);
            if (!value && resolved.kindOf !== 'identifier') return;

            const lead = leadKey ? key === leadKey : first;
            const name = label(resolved.def.label, key);

            const row = el('div', 'f' + (lead ? ' f--lead' : ''));
            const head = el('div', 'f-head');
            head.append(el('span', 'f-k', name));

            const copyBtn = el('button', 'f-copy', TT('Copy'));
            // Six buttons in this dialog are called Copy, and a screen reader
            // reads them as a list: the field is the whole of what tells them
            // apart. The clipboard gets the value, never the grouping.
            copyBtn.setAttribute('aria-label', TT('Copy') + ' ' + name);
            copyBtn.addEventListener('click', () => copy(value, copyBtn));
            head.append(copyBtn);
            row.append(head);

            const shown = resolved.kindOf === 'identifier'
                ? displayValue(resolved.def, value) : value;
            const v = el('div', 'f-v' + (lead ? '' : ' f-v--sm'), shown || '—');
            // Nothing to fit to the screen but the placeholder for a field
            // nobody has filled in, and an em dash at the width of a phone is
            // not what the fit is for.
            if (big && lead && value) v.classList.add('f-v--fit');
            row.append(v);

            if (resolved.kindOf === 'identifier') {
                const result = Engines.validate(value, resolved.def);
                const b = linkBadge(badgeFor(result, resolved.def), result.status, card);
                if (b) {
                    row.append(el('div', 'f-badge ' + b.tone, b.text));
                    // What the verdict rests on, as a line and not a hover:
                    // there is nothing to hover with on the phone this card is
                    // held up on, and the sentence behind a refused or a
                    // never-issued number is the one that says what to do
                    // instead of reading it out.
                    if (b.title) row.append(el('div', 'f-note', b.title));
                }

                // A caveat on the green badge, never a downgrade — and a line
                // rather than a hover, because it has to be readable at a
                // counter. Guarded on the copy so an engine this build has no
                // sentence for says nothing instead of saying "undefined", and
                // on the link, because a sentence beginning "the check digit
                // matched" would re-assert exactly what the withdrawn badge
                // above it has just taken back.
                const weak = checkable(card) && result.weak && weakCopy(result.weak);
                if (weak) {
                    row.append(el('div', 'f-note f-weak', TT('Worth reading back') + ' — ' + weak));
                }

                if (result.status === 'refused') {
                    const block = refusalBlock(rec, result.refused);
                    if (block) row.append(block);
                }

                // The whole reason this app exists: a clerk mishears a letter
                // far more often than they miss a field.
                if (value) {
                    row.append(el('div', 'f-phon', Phonetic.spell(value, dictationLang(card))));
                }
            } else if (resolved.kindOf === 'field'
                    && Engines.checkField(value, resolved.def)) {
                // A typo gate, not a verification: checkField says only that the
                // shape is wrong, so a correct value never sprouts a badge
                // implying a check that never happened.
                row.append(el('div', 'f-badge err', TT('Wrong format')));
            }

            host.append(row);
            first = false;
        });

        const stale = stalenessOf(rec, card);
        if (stale) {
            const n = el('div', 'f-stale', stale);
            host.append(n);
        }

        if (rec.einvoicing) host.append(einvoicingRow(rec));

        if (rec.invoiceProfile && rec.invoiceProfile.note) {
            host.append(el('div', 'f-note', label(rec.invoiceProfile.note, '')));
        }
        if (card.officialQr) {
            const btn = el('button', 'btn qr-open', TT('Show official QR'));
            btn.addEventListener('click', () => openQr(card));
            host.append(btn);
        }
    }

    // Tax data goes stale silently: a régimen changes, a catalogue is revised,
    // and nothing tells you until an invoice is rejected. Two nudges, both
    // computed offline from dates already in the record.
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    function stalenessOf(rec, card) {
        if (!card) return null;

        // 1. The authority revised a catalogue after you last confirmed the card.
        const cats = rec.catalogues || {};
        let newest = null;
        Object.keys(cats).forEach((key) => {
            if (!card.values || !card.values[key]) return;
            const on = cats[key].verified;
            if (on && (!newest || on > newest)) newest = on;
        });
        if (newest && card.verifiedOn && newest > card.verifiedOn) {
            return TT('The official catalogue was updated on {date}, after you last confirmed this card.',
                { date: dateText(newest) });
        }

        // 2. You have not confirmed it in a year.
        if (!card.verifiedOn) return TT('Never confirmed against your own documents.');
        const age = Date.now() - Date.parse(card.verifiedOn + 'T00:00:00Z');
        if (age > YEAR_MS) {
            return TT('Last confirmed on {date}. Worth checking it still matches your records.',
                { date: dateText(card.verifiedOn) });
        }
        return null;
    }

    function einvoicingRow(rec) {
        const e = rec.einvoicing;
        const row = el('div', 'f-einv ' + e.status);
        const words = {
            mandatory: TT('E-invoicing mandatory'),
            scheduled: TT('E-invoicing scheduled'),
            partial: TT('E-invoicing partly in force'),
            none: TT('No e-invoicing mandate'),
        };
        let head = words[e.status] || e.status;
        if (e.scheme) head += ' · ' + e.scheme;
        if (e.from) head += ' · ' + e.from;
        row.append(el('span', 'einv-k', head));
        const note = label(e.note, '');
        if (note) row.append(el('span', 'einv-d', note));
        return row;
    }

    /* ================= the wall ================= */

    // Cards, largest surface first. Sorted so the country you are standing in
    // leads: counter mode is still the job, the wall is just how you get to it.
    function renderWall() {
        const host = $('#cardGrid');
        host.innerHTML = '';
        const cards = allCards();
        const here = tzIso() || localeIso();

        // The count is about this device and nothing else. The samples and a
        // card being previewed off a link are both on the wall without being
        // stored, and "8 cards on this device" is the one claim those two
        // states exist to avoid making. A browser refusing to store anything is
        // the third: the wall is holding the card in memory, the device is not.
        const stored = !Store.storageAvailable() ? 0
            : readOnly() ? Store.all().length : cards.length;
        // With the pitch on screen the count line would be a second headline
        // saying the same thing in smaller type.
        $('#emptyIntro').hidden = !!cards.length;
        $('#cardCount').textContent = !cards.length ? ''
            : (stored ? TT('{n} cards on this device', { n: stored }) : TT('Nothing stored yet'));

        // Nothing to pick from: without the index there is no jurisdiction to
        // add a card for, and the banner above already says why.
        $('#addCard').hidden = !!loadError;

        /* Same two hoists the picker makes, for the same reason: this comparator ran
           Intl.DisplayNames twice and built a collator twice on EVERY comparison. */
        const wallNames = countryNames();
        const wcmp = collate().compare;
        const wallFrag = document.createDocumentFragment();
        cards.slice().sort((a, b) => {
            if ((a.iso === here) !== (b.iso === here)) return a.iso === here ? -1 : 1;
            if (a.iso !== b.iso) {
                return wcmp(wallNames.get(a.iso) || a.iso, wallNames.get(b.iso) || b.iso);
            }
            if (a.kind !== b.kind) return a.kind === 'business' ? -1 : 1;
            return wcmp(a.label || '', b.label || '');
        }).forEach((card) => wallFrag.append(tile(card)));
        host.append(wallFrag);

        if (!readOnly() && !loadError) host.append(addTile());
        if (!cards.length) host.append(exampleTile());
    }

    // A tile is one button, so everything inside it collapses into the one name
    // a screen reader reads out. With only the nickname and the country in
    // there, personal and business were told apart by the colour of a stripe,
    // and the verdict and the staleness flag — the two warnings this wall
    // exists to carry — were visible only to somebody looking at it.
    function tileLabel(card, shown, verdict) {
        return [
            countryName(card.iso),
            TT('Tier') + ' ' + tierOf(card.iso),
            card.label || '',
            shown || '',
            verdict || '',
            card.kind === 'personal' ? TT('Personal') : TT('Business'),
            needsAttention(card) ? TT('check it') : '',
        ].filter(Boolean).join(' · ');
    }

    function tile(card) {
        const t = el('button', 'tile ' + card.kind);

        const top = el('div', 't-top');
        top.append(el('span', 't-flag', (BY_ISO[card.iso] && BY_ISO[card.iso].flag) || ''));
        top.append(el('span', 't-country', countryName(card.iso)));
        const tier = tierOf(card.iso);
        top.append(el('span', 'pill t' + tier, 'T' + tier));
        t.append(top);

        t.append(el('div', 't-label', card.label || countryName(card.iso)));

        // The lead identifier, because that is what the card is FOR.
        const lead = leadOf(card);
        const id = el('div', 't-id', lead || '—');
        t.append(id);

        const foot = el('div', 't-foot');
        foot.append(el('span', 't-kind', card.kind === 'personal' ? TT('Personal') : TT('Business')));
        if (needsAttention(card)) foot.append(el('span', 't-warn', TT('check it')));
        t.append(foot);

        t.setAttribute('aria-label', tileLabel(card, lead, ''));
        markTile(t, card, foot, id);

        t.addEventListener('click', guard(() => openCard(card)));
        return t;
    }

    // Read the lead identifier straight off the card so a tile costs no record
    // fetch — the wall must paint before 249 jurisdictions are considered.
    function leadKeyOf(card) {
        const vals = card.values || {};
        const preferred = ['rfc', 'nit', 'ein', 'cnpj', 'cpf', 'cuit', 'rut', 'ruc',
            'gstin', 'corporateNumber', 'abn', 'nif', 'vat', 'taxId', 'cedula'];
        for (const key of preferred) if (vals[key]) return key;
        return Object.keys(vals).find((k) => vals[k] && !/mail|address|direccion|nombre|razon|legal|cp|tipo/i.test(k)) || '';
    }

    function leadOf(card) {
        const key = leadKeyOf(card);
        return key ? (card.values || {})[key] : '';
    }

    // The verdict costs the record, which the wall deliberately does not wait
    // for, so it arrives when the record does. Without it a number whose check
    // digit failed looks exactly like one that passed for as long as the card
    // is only ever seen on the wall.
    function markTile(t, card, before, idNode) {
        const key = leadKeyOf(card);
        // The wall is painted once before the registry has answered, and a
        // record fetched then would be synthesised from a jurisdiction nobody
        // has read yet and cached that way for the session. No index, no
        // verdict: the wall is painted again as soon as there is one.
        if (!key || !BY_ISO[card.iso]) return;
        record(card.iso).then((rec) => {
            const resolved = resolveField(rec, key);
            if (!resolved || resolved.kindOf !== 'identifier') return;
            const def = resolveVariant(resolved.def, card);
            const value = (card.values || {})[key];
            const result = Engines.validate(value, def);
            const b = linkBadge(badgeFor(result, def), result.status, card);

            // The record is also where the authority's own grouping is written,
            // and the wall is where the number is read first.
            const shown = displayValue(def, value);
            idNode.textContent = shown;
            t.setAttribute('aria-label', tileLabel(card, shown, b && b.text));

            if (!b) return;
            const badge = el('div', 'f-badge ' + b.tone, b.text);
            // A tile has no room for the sentence behind the verdict; the card
            // it opens carries it as a line. This one stays a hover.
            if (b.title) badge.title = b.title;
            t.insertBefore(badge, before);
        });
    }

    // Cheap staleness check for the tile: the full one needs the record, this
    // one only needs the date the card carries.
    function needsAttention(card) {
        if (!card.verifiedOn) return true;
        return (Date.now() - Date.parse(card.verifiedOn + 'T00:00:00Z')) > YEAR_MS;
    }

    function addTile() {
        const t = el('button', 'tile add');
        t.append(el('div', 't-label', '+ ' + TT('Add card')));
        t.append(el('div', 't-id', TT('For any of {n} jurisdictions', { n: INDEX.length })));
        t.addEventListener('click', () => openPicker(true));
        return t;
    }

    // On a fresh install, show what a card looks like rather than an empty grid.
    // XAXX010101000 is SAT's public "público en general" RFC: real, carries no
    // personal data, and exercises the reserved-value badge.
    function exampleTile() {
        const box = el('div', 'example-tile');
        box.append(el('div', 'example-tag', TT('Example — not your data')));
        // Named the way a card with no nickname is named, and by the platform
        // rather than by a Spanish word this app would then print to a reader
        // in four other languages.
        box.append(el('div', 't-label', countryName('MX')));
        box.append(el('div', 'f-v f-v--sm', 'XAXX010101000'));
        const def = { key: 'rfc', checksum: { engine: 'mx-rfc' }, reserved: ['XAXX010101000'] };
        const b = badgeFor(Engines.validate('XAXX010101000', def), def);
        if (b) box.append(el('div', 'f-badge ' + b.tone, b.text));
        box.append(el('div', 'f-phon', Phonetic.spell('XAXX010101000', lang())));
        return box;
    }

    // <dialog>'s `close` event is not dispatched by every engine — some headless
    // Chromium builds flip the `open` attribute and fire nothing. Two things
    // depend on knowing a dialog went away (releasing the wake lock, clearing
    // the card out of the URL), and both are worse than useless if they are
    // unreliable, so watch the attribute instead of trusting the event.
    function onDialogClose(dlg, fn) {
        if (dlg._closeWatch) return;
        dlg._closeWatch = true;
        let wasOpen = dlg.open;
        new MutationObserver(() => {
            const isOpen = dlg.open;
            if (wasOpen && !isOpen) fn();
            wasOpen = isOpen;
        }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
    }

    /* ================= the detail popup ================= */

    async function openCard(card) {
        current = card;
        iso = card.iso;
        kind = card.kind;
        if (!readOnly()) Store.noteUse(iso, kind);

        const rec = await record(iso);
        const dlg = $('#cardDlg');
        dlg.dataset.kind = card.kind;

        renderDetailHead(rec, card);
        renderCard(rec, false);

        // A sample and a card being previewed off somebody's link have no
        // address on this device: they live behind #demo and behind the link
        // that carried them. Writing a card slug over either hands out an
        // address that resolves to nothing on the next load, and takes the
        // fragment those two states are being shown from with it.
        const addressable = !readOnly();
        $('#cardDlg .detail-addr').hidden = !addressable;
        if (addressable) {
            $('#detailAddr').textContent = '#/' + slugFor(card);
            try { history.replaceState(null, '', '#/' + slugFor(card)); } catch (e) { /* fine */ }
        }
        renderDetailActions(rec, card);

        // The watcher is attached once for the life of the page, so what it may
        // clear is decided as it fires: the same dialog closes over a stored
        // card, a sample and a preview in one session.
        onDialogClose(dlg, () => {
            current = null;
            if (readOnly()) return;
            try { history.replaceState(null, '', location.pathname + location.search); }
            catch (e) { /* history is not essential to the card working */ }
        });
        if (!dlg.open) dlg.showModal();
    }

    // The country, the tier word and the kind are all translated, and they are
    // written here rather than by the markup — so they are written again on
    // every repaint, or an open card keeps the language it was opened in while
    // everything around it changes.
    function renderDetailHead(rec, card) {
        const entry = BY_ISO[card.iso];
        $('#detailCountry').textContent =
            ((entry && entry.flag) || '') + ' ' + countryName(card.iso);
        $('#detailLabel').textContent = card.label || countryName(card.iso);

        const meta = $('#detailMeta');
        meta.innerHTML = '';
        const tier = tierOf(card.iso);
        meta.append(el('span', 'pill t' + tier,
            TT('Tier') + ' ' + tier + (tier === 3 ? ' · ' + TT('unverified') : '')));
        meta.append(el('span', 't-kind', card.kind === 'personal' ? TT('Personal') : TT('Business')));
        if (rec.authority) meta.append(el('span', 'jauth', rec.authority));
    }

    function renderDetailActions(rec, card) {
        const host = $('#detailActions');
        host.innerHTML = '';
        const mk = (cls, text, fn) => {
            const b = el('button', 'btn ' + cls, text);
            b.addEventListener('click', fn);
            return b;
        };
        host.append(mk('btn-primary', TT('Counter mode'), () => openBig(rec)));
        host.append(mk('', TT('Copy all'), function () { copy(asText(rec, card), this); }));
        host.append(mk('', TT('Share'), () => openShare(rec, card)));
        // The sheet is filled from the card in front of the user rather than
        // from whatever dialog happens to be open: counter mode leaves the
        // detail popup open underneath itself.
        host.append(mk('', TT('Print'), () => {
            fillPrintSheet(rec, card);
            window.print();
        }));
        if (!readOnly()) host.append(mk('btn-ghost', TT('Edit'), guard(() => openEditor(card))));

        // The field copies are named where they are built. This one is the
        // sixth button in the dialog whose text is "Copy" and that text belongs
        // to the markup, so the name it is announced by is set here — which is
        // also what runs again when the language changes.
        $('#detailAddrCopy').setAttribute('aria-label',
            TT('Copy') + ' ' + TT("This card's address on this device"));

        // A number that will not leave has to be said out loud before the
        // clipboard and the printer, or it is read off the original document
        // and typed in by hand at the counter instead.
        const note = sideNote('cardNote', 'ed-hint warn', '#detailActions');
        refusalNotes(rec, window.FiscalShare.refusedIn(card, rec)).forEach((n) => note.append(n));
        note.hidden = !note.firstChild;
    }

    // Everything the card is, as text. A refused value is absent rather than
    // masked: a clipboard is a way off the device, and a masked number is still
    // a number once the reader knows the mask.
    function asText(rec, card) {
        const dropped = window.FiscalShare.refusedIn(card, rec);
        const held = {};
        dropped.forEach((d) => { if (d.where === 'value') held[d.key] = true; });
        const named = dropped.some((d) => d.where === 'label') ? '' : (card.label || '');

        const lines = [countryName(card.iso) + ' · ' + named];
        profileKeys(rec, card.kind, card).forEach((key) => {
            const resolved = resolveField(rec, key);
            if (!resolved || held[key]) return;
            if (resolved.kindOf === 'identifier') {
                resolved.def = resolveVariant(resolved.def, card);
            }
            const value = fieldValue(rec, resolved, card);
            if (value) lines.push(label(resolved.def.label, key) + ': ' + value);
        });
        return lines.join('\n');
    }

    /* ================= counter (big) mode ================= */

    // Same reason as the detail head: counter mode is the surface a card is
    // held up on for longest, so it is the one a language switch must not leave
    // headed in the language before it.
    function renderBigHead(card) {
        const code = (card && card.iso) || iso;
        $('#bigCountry').textContent =
            (BY_ISO[code] ? BY_ISO[code].flag + ' ' : '') + countryName(code);
        $('#bigLabel').textContent = (card && card.label) || '';
    }

    function openBig(rec) {
        const card = currentCard();
        renderCard(rec, true);
        renderBigHead(card);
        $('#bigDlg').showModal();
        fitLead();
        // The first fit races the webfont: the fallback face is a different
        // width, so a number measured against it is drawn at the wrong size for
        // the one that arrives a moment later.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => { if ($('#bigDlg').open) fitLead(); });
        }
        holdScreenAwake();

        const speak = $('#bigSpeak');
        speak.hidden = !('speechSynthesis' in window);
        speak.onclick = () => speakLead(rec, card);

        onDialogClose($('#bigDlg'), () => {
            releaseScreen();
            // The utterance outlives the dialog otherwise, and a card put away
            // mid-sentence keeps reading a tax number out into the room.
            stopSpeaking();
        });
    }

    // The screen going dark mid-transaction is the small failure that makes
    // someone put the phone away and start reading numbers off a photo instead.
    //
    // The lock is wanted for as long as counter mode is open, which is not the
    // same as holding one: request() resolves a turn later, the platform drops
    // the lock every time the tab is hidden and does not give it back, and a
    // lock that resolves after the dialog has closed is a screen nobody asked
    // to keep awake and nobody holds a reference to.
    let wakeLock = null;
    let wakeAsking = false;
    let wakeWanted = false;

    function holdScreenAwake() {
        wakeWanted = true;
        if (!navigator.wakeLock || !navigator.wakeLock.request || wakeAsking) return;
        // The release event is what normally clears the reference; a sentinel
        // that says of itself that it is already released is not a lock either,
        // and asking for a new one is the only thing that brings the screen
        // back. An engine that publishes neither keeps the lock it has.
        if (wakeLock && wakeLock.released !== true) return;
        wakeLock = null;
        wakeAsking = true;
        navigator.wakeLock.request('screen').then((lock) => {
            wakeAsking = false;
            if (!wakeWanted) {
                try { lock.release(); } catch (e) { /* nothing left to release */ }
                return;
            }
            wakeLock = lock;
            lock.addEventListener('release', () => {
                if (wakeLock === lock) wakeLock = null;
            });
        }).catch(() => {
            // Denied or unsupported: the dialog still works.
            wakeAsking = false;
        });
    }

    function releaseScreen() {
        wakeWanted = false;
        const lock = wakeLock;
        wakeLock = null;
        if (!lock) return;
        try { lock.release(); } catch (e) { /* already gone */ }
    }

    function stopSpeaking() {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    // Read the identifier out loud, letter by letter, from the same table the
    // screen shows — so the clerk hears "D de Dolores", not "dee".
    // Voices are per platform; where none is installed this simply does nothing
    // visible, which is why the button is only shown when the API exists.
    function speakLead(rec, card) {
        if (!('speechSynthesis' in window) || !card) return;
        const key = leadKeyFor(rec, card);
        if (!key) return;
        const value = (card.values || {})[key];
        if (!value) return;
        // A voice is a way off the device and the only one with no undo, so a
        // number this app will not hold is not read out either.
        if (window.FiscalShare.refusedIn(card, rec)
            .some((d) => d.where === 'value' && d.key === key)) return;

        stopSpeaking();
        // speak(), not spell() with its separators swapped: the separators are
        // per table, and swapping the one English uses leaves the Japanese
        // utterance carrying ・ and ／ for a voice to read out as punctuation.
        const spoken = dictationLang(card);
        const u = new SpeechSynthesisUtterance(Phonetic.speak(value, spoken));
        u.lang = spoken;
        u.rate = 0.85;
        window.speechSynthesis.speak(u);
    }

    // In counter mode the lead identifier must never wrap or clip: a number
    // broken across two lines is exactly the thing a clerk mistypes. Rather than
    // predicting the width from font metrics — which depends on the face that
    // actually loaded — measure the rendered line and shrink until it fits.
    // Runs after showModal() so layout is available.
    //
    // START is a cap and not a target: the arithmetic is scale-invariant, so
    // the only thing 68 was doing was refusing to use a screen an arm's length
    // away. FLOOR is where legibility runs out and wrapping takes over.

    // Measure the text itself with a Range rather than reading scrollWidth: an
    // element that clips its overflow reports a scrollWidth equal to its client
    // width, so the obvious check would always say "it fits" no matter how far
    // the number ran off the edge.
    function drawnWidth(node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().width;
    }

    function fitLead() {
        const START = 200;
        const FLOOR = 18;

        const v = $('#bigFace .f-v--fit');
        if (!v || !v.firstChild) return;

        // Before the measurement, not after it: the class is what lets the
        // value wrap, and a Range over wrapped text returns the union of its
        // line boxes — the container's width — so a second fit run against a
        // wrapped value concludes it already fits at any size at all.
        v.classList.remove('f-v--wrap');

        // Read live. The box loses 15px the moment the card grows past the
        // scrollport and the body takes a scrollbar.
        const avail = v.clientWidth;
        if (!avail) return;

        v.style.fontSize = START + 'px';
        const drawn = drawnWidth(v);
        if (!drawn) return;

        // 0.98 leaves a hair of room so the last glyph never touches the edge.
        const fitted = Math.floor(START * (avail * 0.98) / drawn);
        let size = Math.max(FLOOR, Math.min(START, fitted));
        v.style.fontSize = size + 'px';

        // Then check the arithmetic against the box it produced rather than
        // trusting it: a card that grows past the scrollport takes a scrollbar
        // with it, and the width the sum was computed against was 15px wider
        // than the one the number landed in.
        while (size > FLOOR && drawnWidth(v) > v.clientWidth) {
            size -= 2;
            v.style.fontSize = size + 'px';
        }

        // Height is guarded on the LEAD ROW, not on the card. Everything under
        // the identifier may overflow and scroll — the stylesheet is written
        // for that — but the lead row sits at scrollTop 0, so a row taller than
        // the scrollport is a number read off the top of the screen with no way
        // to scroll up to it. Shrinking the identifier is exactly what shrinks
        // that row, so this terminates.
        const row = $('#bigFace .f--lead');
        const body = $('#bigDlg .dlg-body');
        while (row && body && size > FLOOR
            && row.getBoundingClientRect().height > body.clientHeight) {
            size -= 2;
            v.style.fontSize = size + 'px';
        }

        // At the floor the value can still be wider than the box. Wrapping is
        // the only outcome that shows every character; spilling into a
        // horizontal scroll shows a truncated number with a scrollbar as the
        // only hint that it is truncated.
        v.classList.toggle('f-v--wrap', size <= FLOOR);
    }

    // The fit is against the box as it is now, and the box changes without the
    // card being reopened: a phone turned on its side, a window dragged
    // narrower, a reader at 200%. Zoom resizes the layout viewport, so it
    // arrives here as a resize; pinch-zoom does not, and arrives on
    // visualViewport instead. Coalesced into a frame because a drag delivers
    // dozens and each one costs a reflow.
    let refitting = false;

    function refitLead() {
        if (refitting || !$('#bigDlg').open) return;
        refitting = true;
        requestAnimationFrame(() => {
            refitting = false;
            if ($('#bigDlg').open) fitLead();
        });
    }

    /* ================= the printed sheet =================
       index.html carries the skeleton and one rule: the sheet takes the page
       only while #psLeadV is not empty, and the page prints itself otherwise.
       So an unfillable sheet is left empty rather than filled with a
       placeholder — a card there is nothing to print does not become one. */

    function clearPrintSheet() {
        ['#psFlag', '#psCountry', '#psTier', '#psLabel', '#psAuth',
            '#psLeadK', '#psLeadV', '#psPhon', '#psNote', '#psSrc']
            .forEach((sel) => { $(sel).textContent = ''; });
        $('#psRows').innerHTML = '';
        $('#psState').textContent = '';
        $('#psState').className = 'ps-state';
    }

    // Paper is the one output nobody can recall, so the refusal rule is harder
    // here than anywhere: a refused value is absent, not truncated and not
    // masked, and where the refused one is the identifier the sheet is FOR the
    // lead is left empty rather than quietly promoting the next value into its
    // place. That leaves the page printing itself, which is the honest answer.
    function fillPrintSheet(rec, card) {
        clearPrintSheet();
        if (!card) return;

        const dropped = window.FiscalShare.refusedIn(card, rec);
        const held = {};
        dropped.forEach((d) => { if (d.where === 'value') held[d.key] = true; });

        const entry = BY_ISO[card.iso];
        const tier = tierOf(card.iso);
        $('#psFlag').textContent = (entry && entry.flag) || '';
        $('#psCountry').textContent = countryName(card.iso);
        $('#psTier').textContent = TT('Tier') + ' ' + tier
            + (tier === 3 ? ' · ' + TT('unverified') : '');
        // The nickname prints at the top of the sheet, so a number typed into
        // it leaves on paper exactly as one typed into a field would.
        $('#psLabel').textContent = dropped.some((d) => d.where === 'label')
            ? '' : (card.label || '');
        $('#psAuth').textContent = rec.authority || '';

        const rows = $('#psRows');
        const leadKey = leadKeyFor(rec, card);
        let lead = null;

        profileKeys(rec, card.kind, card).forEach((key) => {
            const resolved = resolveField(rec, key);
            if (!resolved) return;
            if (resolved.kindOf === 'identifier') {
                resolved.def = resolveVariant(resolved.def, card);
            }
            const value = fieldValue(rec, resolved, card);
            const name = label(resolved.def.label, key);
            const shown = resolved.kindOf === 'identifier'
                ? displayValue(resolved.def, value) : value;

            if (key === leadKey) {
                if (value && !held[key]) {
                    lead = { name: name, value: value, shown: shown, def: resolved.def };
                }
                return;
            }
            if (!value || held[key]) return;

            const row = el('div', 'ps-row');
            row.append(el('span', 'ps-rk', name));
            row.append(el('span', 'ps-rv', shown));
            rows.append(row);
        });

        if (!lead) return;

        const result = Engines.validate(lead.value, lead.def);
        const b = linkBadge(badgeFor(result, lead.def), result.status, card);
        if (b) {
            $('#psState').textContent = b.text;
            $('#psState').className = 'ps-state ' + b.tone;
        }
        $('#psPhon').textContent = Phonetic.spell(lead.value, dictationLang(card));
        // Paper outlives the screen and carries no hover, so the sentence
        // behind the qualified badge goes on it too — and it goes away with the
        // badge on a link nothing could verify, which is the one state where
        // "the check digit matched" is no longer this app's to say.
        const weak = checkable(card) && result.weak && weakCopy(result.weak);
        $('#psNote').textContent = [weak || '',
            label(rec.invoiceProfile && rec.invoiceProfile.note, '')].filter(Boolean).join(' · ');
        $('#psSrc').textContent = card.verifiedOn
            ? TT('Confirmed {date}', { date: dateText(card.verifiedOn) }) + ' · Carino Fiscal'
            : TT('Never confirmed against your own documents.');

        $('#psLeadK').textContent = lead.name;
        // Last, because this is the switch for the whole sheet.
        $('#psLeadV').textContent = lead.shown;
    }

    /* ================= share ================= */

    let shareState = null;

    // The counter lines: what a clerk is handed, in the order the profile asks
    // for it. A variant decides which document the box holds, so it is resolved
    // before the label is read — a Colombian passport must not go out on a
    // vCard, into an image or across to Quote calling itself a cédula.
    function shareLines(rec, card) {
        return profileKeys(rec, card.kind, card).map((key) => {
            const r = resolveField(rec, key);
            if (!r) return null;
            if (r.kindOf === 'identifier') r.def = resolveVariant(r.def, card);
            const v = fieldValue(rec, r, card);
            return v ? { k: label(r.def.label, key), v: v, lead: r.kindOf === 'identifier' } : null;
        }).filter(Boolean);
    }

    // vcard() wants the lines already formatted; cardImage() wants them as they
    // come. Both are built from the one list rather than from two.
    function shareVcard(rec, card) {
        return window.FiscalShare.vcard(card, rec,
            shareLines(rec, card).map((l) => l.k + ': ' + l.v), countryName(card.iso));
    }

    function openShare(rec, card) {
        const link = window.FiscalShare.shareLink(card, rec);
        shareState = {
            rec: rec,
            card: card,
            payload: 'vcard',
            link: link,
            // An all-refused card packs to nothing at all: share.js writes no
            // payload rather than one with no values in it. There is then
            // nothing to copy, encode, paint or hand on.
            blank: !link,
            dropped: window.FiscalShare.refusedIn(card, rec),
        };
        renderShare();
        $('#shareDlg').showModal();
    }

    function renderShare() {
        const { rec, card, payload, blank, dropped } = shareState;

        const text = payload === 'vcard'
            ? shareVcard(rec, card)
            : payload === 'link'
                ? shareState.link
                : window.FiscalShare.carinoPayload(card, rec);

        // The radios are the state and the browser announces them; reflecting
        // into the group is one-way, and setting checked from script fires no
        // change event, so this cannot loop.
        const radio = document.querySelector('#shareTabs input[value="' + payload + '"]');
        if (radio) radio.checked = true;

        // Nothing packs, so there is no payload to describe: the sentence
        // promises a vCard a card with no values on it cannot produce.
        $('#shareWhat').textContent = blank ? ''
            : payload === 'vcard'
            ? TT('A vCard — any phone camera reads this and offers to save it as a contact.')
            : payload === 'link'
                ? TT('The card itself, inside a link. Scanning it opens this card on any phone — the data rides after the “#”, so no server ever sees it.')
                : TT('A Carino payload — only this app reads it, kept for exchanging a card between your own devices.');

        // Nothing is drawn for a card with no payload: qrCanvas('') encodes the
        // empty string and hands back a canvas quite happily, which would put a
        // QR of nothing in front of a clerk. The note under the buttons says
        // what happened.
        const host = $('#shareQr');
        host.innerHTML = '';
        if (!blank && !window.FiscalShare.qrFits(text)) {
            host.append(el('div', 'ed-hint err',
                TT('This card is too large for a QR code. Share the link instead.')));
        } else if (!blank) {
            const canvas = window.FiscalShare.qrCanvas(text, 260);
            if (canvas) {
                // qrCanvas has already sized the element to its own bitmap.
                // Resampling lands module edges one pixel wide in some columns
                // and two in others, which is what makes a symbol undecodable,
                // so the container scrolls instead — #shareQr is overflow:auto.
                canvas.setAttribute('role', 'img');
                canvas.setAttribute('aria-label', TT('QR code for this card'));
                canvas.setAttribute('aria-describedby', 'shareWhat');
                host.append(canvas);
            } else {
                // True only here: the encoder is missing, rather than the card
                // being too big for any version of the symbol.
                host.append(el('div', 'ed-hint err', TT('The QR encoder did not load.')));
            }
        }

        // Nothing can leave, so the buttons that would send nothing go with it.
        [$('#shareImage'), $('#shareLink'), $('#shareVcf'), $('#shareVcard')]
            .forEach((b) => { b.hidden = blank; });
        // Quote takes the user's own card and answers 'declined' for anything
        // else, and a demo sample and a card previewed from someone else's link
        // are both anything else.
        $('#shareQuote').hidden = blank || readOnly();

        const note = sideNote('shareNote', 'ed-hint warn', '#shareDlg .shr-acts');
        refusalNotes(rec, dropped).forEach((n) => note.append(n));
        // The two sentences answer different questions and point at each other
        // when they meet, so the QR's lives in the QR panel and this one beside
        // the button it is about.
        if (shareState.link.length > 1800) {
            note.append(el('div', null,
                TT('This link is long — some chat apps will cut it. Send the image instead.')));
        }
        note.hidden = !note.firstChild;

        // A hand-off result describes the card and the payload it was sent
        // from, so it does not outlive either.
        sideNote('shareStatus', 'ed-hint', '#shareDlg .shr-warn');
    }

    async function shareImage() {
        const { rec, card } = shareState;
        const lines = shareLines(rec, card);
        // With the card and the record, a row whose value is refused is not
        // painted; without them only a row that is wholly the number is caught.
        const canvas = window.FiscalShare.cardImage({
            card: card,
            rec: rec,
            heading: countryName(card.iso) + ' · ' + (card.label || ''),
            lines: lines,
            qrText: shareVcard(rec, card),
        });
        const blob = await window.FiscalShare.canvasToBlob(canvas);
        if (!blob) {
            const status = sideNote('shareStatus', 'ed-hint err', '#shareDlg .shr-warn');
            status.append(el('div', null, TT('This browser could not turn the card into an image.')));
            status.hidden = false;
            return;
        }

        const file = new File([blob], 'fiscal-' + card.iso.toLowerCase() + '.png', { type: 'image/png' });
        // Share sheet where there is one — this is a WhatsApp transaction far
        // more often than it is a download.
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file] }); return; } catch (e) { /* fall through */ }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    // Eleven rejections, and nine of them send the user somewhere different: a
    // blocked pop-up, an old copy of Quote and a tab that was shut are three
    // different next steps. The refusal gets its own sentence rather than the
    // fallback, because a refusal reported as a generic failure teaches the
    // holder this app is flaky rather than principled.
    function quoteProblem(reason, held) {
        // At least one, whatever the count says. share.js reads the whole
        // counter line and refusedIn() reads the value, so a line stripped for
        // a number sitting inside a name comes back counted as none — and "0
        // numbers were found and left out" beside a hand-off that did not
        // happen is as wrong as reporting the refusal as a generic failure.
        if (reason === 'refused') {
            return TT('{n} numbers this app never stores were found and left out.',
                { n: held || 1 });
        }
        if (reason === 'no-bridge') return TT('The hand-off could not start. Reload this page and try again.');
        if (reason === 'blocked') return TT('Your browser blocked the pop-up. Allow pop-ups for this page and try again.');
        if (reason === 'no-answer') return TT('Quote never answered — it may not have finished loading.');
        if (reason === 'no-ack') return TT('Quote opened but never confirmed it received the card.');
        if (reason === 'declined') return TT('Quote declined the card.');
        if (reason === 'quote-outdated') return TT('That copy of Quote is too old for this card. Reload Quote and try again.');
        if (reason === 'fiscal-outdated') return TT('This page is too old for that copy of Quote. Reload this page and try again.');
        if (reason === 'closed') return TT('That tab was closed before the card arrived.');
        return TT('The hand-off did not go through.');
    }

    /* ================= official QR ================= */

    function openQr(card) {
        $('#qrImg').src = card.officialQr;
        $('#qrDlg').showModal();
    }

    /* ================= jurisdiction picker ================= */

    let pickerAdds = false;

    function openPicker(forAdd) {
        pickerAdds = !!forAdd;
        const input = $('#pickerSearch');
        input.value = '';
        renderPickerList('');
        $('#pickerDlg').showModal();
        input.focus();
    }

    function renderPickerList(query) {
        const list = $('#pickerList');
        list.innerHTML = '';
        const q = query.trim().toLowerCase();
        const owned = new Set(allCards().map((c) => c.iso));
        const names = countryNames();   // a Map, so a jurisdiction called 'constructor' is a row
        const cmp = collate().compare;

        const matched = INDEX
            .map((c) => ({ c: c, name: names.get(c.iso) || c.name }))
            .filter((r) => !q || r.name.toLowerCase().indexOf(q) !== -1
                || r.c.iso.toLowerCase().indexOf(q) !== -1
                || r.c.name.toLowerCase().indexOf(q) !== -1)
            .sort((a, b) => {
                // Countries you hold a card for float to the top, then tier,
                // then name — the list is 249 long and mostly irrelevant.
                const ao = owned.has(a.c.iso) ? 0 : 1;
                const bo = owned.has(b.c.iso) ? 0 : 1;
                if (ao !== bo) return ao - bo;
                if (a.c.tier !== b.c.tier) return a.c.tier - b.c.tier;
                return cmp(a.name, b.name);
            });
        const rows = matched.slice(0, 120);

        /* Built into a fragment and attached once. 120 rows of four children each is about 600
           insertions into a live subtree; into a fragment it is none, and the list lands in one. */
        const frag = document.createDocumentFragment();
        rows.forEach((r) => {
            const b = el('button', 'prow' + (r.c.iso === iso ? ' on' : ''));
            // The gold bar and the bold name are what say "this is the one you
            // are on"; this is the same sentence for a reader who sees neither.
            if (r.c.iso === iso) b.setAttribute('aria-current', 'true');
            b.append(el('span', 'p-flag', r.c.flag));
            b.append(el('span', 'p-name', r.name));
            if (owned.has(r.c.iso)) b.append(el('span', 'p-own', TT('your card')));
            b.append(el('span', 'pill t' + r.c.tier, 'T' + r.c.tier));
            b.addEventListener('click', guard(async () => {
                iso = r.c.iso;
                kind = Store.lastKind(iso) || 'personal';
                Store.noteUse(iso, kind);
                $('#pickerDlg').close();
                // The picker is only ever reached on the way to a new card.
                if (pickerAdds) await openEditor(null);
                else await render();
            }));
            frag.append(b);
        });
        list.append(frag);

        // The list is cut at 120 rows, so the count is also the disclosure that
        // the rest exist and how to reach them.
        $('#pickerCount').textContent = TT('{n} of {total} jurisdictions',
            { n: rows.length, total: INDEX.length })
            + (rows.length < matched.length ? ' · ' + TT('type to narrow') : '');
    }

    /* ================= editor ================= */

    let editing = null;

    async function openEditor(card) {
        const rec = await record(iso);
        editing = card ? JSON.parse(JSON.stringify(card)) : { iso: iso, kind: kind, label: '', values: {} };

        // Whatever was read for the last card is not on offer for this one.
        closeReview();
        buildForm(rec, !!card);

        const dlg = $('#editDlg');
        if (!dlg.open) dlg.showModal();
    }

    // Split out so switching Personal/Business rebuilds the fields in place.
    // Rebuilding by re-opening the dialog would both lose what has been typed
    // and throw, because showModal() on an already-open dialog is an error.
    let isExistingCard = false;

    // What a rebuilt form gives back: the control, by the id it will be rebuilt
    // with, and the caret inside it. Changing the kind, picking a document type
    // and applying an import all replace every control in the form, and without
    // this each of them drops the reading position back onto <body>.
    function heldFocus(form) {
        const node = document.activeElement;
        if (!node || !node.id || !form.contains(node)) return null;
        const at = { id: node.id };
        try {
            at.start = node.selectionStart;
            at.end = node.selectionEnd;
        } catch (e) {
            // A control with no selection to speak of; focus alone is kept.
        }
        return at;
    }

    function restoreFocus(at) {
        if (!at) return;
        const node = document.getElementById(at.id);
        if (!node) return;
        node.focus();
        if (at.start == null) return;
        try { node.setSelectionRange(at.start, at.end); } catch (e) { /* not selectable */ }
    }

    // index.html's form vocabulary lays the label, the control and the control's
    // verdict out as siblings rather than nesting them, so a label with no
    // `for` names nothing and a badge with nothing pointing at it is a verdict
    // only somebody looking at the row knows is about that field. Every row
    // builder is tied together here, once its row is built, and the id is also
    // what focus comes back to when the form is rebuilt under it.
    function nameRow(row, id) {
        const control = row.querySelector('.input, .textarea, .select');
        if (!control) return row;
        control.id = id;
        const lab = row.querySelector('label.ed-k');
        if (lab) lab.htmlFor = id;

        const described = [];
        const hint = row.querySelector('.ed-hint');
        if (hint) {
            hint.id = id + '-state';
            // The verdict lands while the field is being typed into, so it is
            // announced rather than only readable once focus comes back.
            hint.setAttribute('role', 'status');
            hint.setAttribute('aria-atomic', 'true');
            described.push(hint.id);
        }
        const note = row.querySelector('.ed-note');
        if (note) {
            note.id = id + '-note';
            described.push(note.id);
        }
        if (described.length) control.setAttribute('aria-describedby', described.join(' '));
        return row;
    }

    function buildForm(rec, isExisting) {
        isExistingCard = !!isExisting;
        // Written here rather than only where the dialog opens: the title names
        // the card and its jurisdiction, both of which are translated, and this
        // is what runs again when the language changes under an open editor.
        $('#editTitle').textContent = isExisting
            ? TT('Edit card')
            : TT('New card') + ' · ' + countryName(editing.iso || iso);

        const form = $('#editForm');
        const held = heldFocus(form);
        form.innerHTML = '';

        // Import first: the fastest way to fill this form is not to type in it.
        form.append(importRow(rec));

        // Card name + kind.
        form.append(nameRow(textRow(TT('Card name'), editing.label || '',
            (v) => { editing.label = v; },
            kind === 'business' ? TT('e.g. Carino Systems') : TT('e.g. Personal')), 'ed-card-label'));

        const kindRow = el('div', 'ed-row');
        kindRow.append(el('label', 'ed-k', TT('Kind')));
        const sel = el('select', 'select');
        [['personal', TT('Personal')], ['business', TT('Business')]].forEach(([v, l]) => {
            const o = el('option', null, l);
            o.value = v;
            if (editing.kind === v) o.selected = true;
            sel.append(o);
        });
        sel.addEventListener('change', () => {
            editing.kind = sel.value;
            // Values already typed are kept: they live on `editing`, and a key
            // the other kind does not ask for is simply not rendered.
            buildForm(rec, isExisting);
        });
        kindRow.append(sel);
        form.append(nameRow(kindRow, 'ed-kind'));

        // Everything the profile asks for, in order.
        const keys = (rec.invoiceProfile[editing.kind] || rec.invoiceProfile.personal);
        const all = (keys.required || []).concat(keys.optional || []);

        all.forEach((key) => {
            const resolved = resolveField(rec, key);
            if (!resolved) return;
            if (resolved.kindOf === 'identifier') {
                resolved.def = resolveVariant(resolved.def, editing);
            }
            const req = (keys.required || []).indexOf(key) !== -1;
            const name = label(resolved.def.label, key) + (req ? '' : ' · ' + TT('optional'));

            if (resolved.kindOf === 'catalogue') {
                // A catalogue a variant hangs off decides what the field below
                // IS, so picking in it rebuilds the form. Only that one:
                // rebuilding on any other catalogue throws away focus for
                // nothing.
                const drives = (rec.identifiers || []).some(
                    (i) => i.variants && i.variants.on === key);
                form.append(nameRow(catalogueRow(name, resolved, editing,
                    drives ? () => buildForm(rec, isExisting) : null), 'ed-' + key));
            } else {
                form.append(nameRow(textRow(name, editing.values[key] || '',
                    (v) => { editing.values[key] = v; },
                    resolved.def.display || '', resolved,
                    resolved.def.multiline, rec), 'ed-' + key));
            }
        });

        // Refused identifiers are shown, not hidden. Telling someone why their
        // SSN is not welcome is more useful than silently omitting the field.
        (rec.refused || []).forEach((r) => {
            const box = el('div', 'refused');
            box.append(el('div', 'refused-t', label(r.label, r.key) + ' — ' + TT('not stored')));
            box.append(el('div', 'refused-d', label(r.reason, '')));
            form.append(box);
        });

        // Mexico's official QR: the image SAT issued, kept as-is.
        if (rec.officialQr) {
            form.append(nameRow(qrRow(rec, editing), 'ed-officialQr'));
        }

        $('#editDelete').hidden = !isExisting;
        // The kind decides which fields the card asks for, so switching it
        // rewrites what an open pane is calling missing.
        if (review) refreshReview();
        gateSave();
        restoreFocus(held);
    }

    // A number this app refuses to hold is dropped on its way to storage, so
    // saving with one in the form would take the value away without saying so.
    // What the user typed stays in the box; the save waits until it is the
    // number that box actually asks for.
    //
    // A new card with nothing in any box is the other thing the save waits on:
    // it stores as an em dash on the wall, packs to no payload at all, and is
    // the one card that cannot be read out at a counter. An existing card is
    // left alone — clearing the last field of one is how it gets emptied on
    // purpose, and Delete is a different button.
    function gateSave() {
        const btn = $('#editSave');
        const values = (editing && editing.values) || {};
        const bare = !isExistingCard
            && !Object.keys(values).some((k) => String(values[k] || '').trim());
        const blocked = bare || !!$('#editForm [data-refused]');
        btn.disabled = blocked;
        btn.style.opacity = blocked ? '0.5' : '';
    }

    // Deleting a card is the one thing here that nothing can undo: there is no
    // copy on a server, none on another device, and the number on it may be on
    // a document the holder is not carrying. So the markup's Delete asks, and
    // the button that removes the card is one this code builds — a second press
    // on the first one cannot reach it.
    function askDelete(run) {
        const form = $('#editForm');
        const open = form.querySelector('.ed-confirm');
        if (open) { open.focus(); return; }

        const box = el('div', 'refused ed-confirm');
        box.tabIndex = -1;
        // The card being deleted is the whole question, so it is what the block
        // says and what focus lands on: focusing either answer would read the
        // answer out and leave the question unread.
        box.append(el('div', 'refused-t',
            TT('Delete') + ' — ' + (editing.label || countryName(editing.iso))));

        const acts = el('div', 'rv-acts');
        const yes = el('button', 'btn btn-danger', TT('Delete'));
        yes.addEventListener('click', run);
        const no = el('button', 'btn', TT('Cancel'));
        no.addEventListener('click', () => {
            box.remove();
            $('#editDelete').focus();
        });
        acts.append(yes, no);
        box.append(acts);

        form.insertBefore(box, form.firstChild);
        box.focus();
    }

    async function runDelete() {
        const gone = Store.remove(editing.id);
        reflectStorage();
        editing = null;
        current = null;
        const detail = $('#cardDlg');
        if (detail.open) detail.close();
        await render();
        if (!gone) {
            // The card is out of this session, but the shortened list never
            // reached disk, so it comes back on the next load. The editor is
            // the only surface still on screen to say that in.
            const form = $('#editForm');
            form.innerHTML = '';
            form.append(el('div', 'ed-hint err',
                TT('Nothing was written to this device, so this will be gone when you reload.')));
            return;
        }
        $('#editDlg').close();
    }

    // Read the authority's own document instead of retyping it. Both the
    // Mexican Constancia and the Colombian RUT are generated PDFs with a real
    // text layer, so this is exact extraction rather than OCR — and every value
    // still has to pass the registry's format check before it is offered.
    function importRow(rec) {
        const row = el('div', 'ed-import');
        // Two controls sit under one heading, so the heading names the block
        // and each control says for itself which half of it it is.
        const head = el('div', 'ed-k', TT('Fill it from a document'));
        head.id = 'ed-import-k';
        row.append(head);

        const hint = el('div', 'ed-note', window.FiscalImport.supported(rec.iso)
            ? TT('Drop in the PDF the tax authority issued, or paste the text of one.')
            : TT('Paste any text holding your tax number — an email signature works.'));
        hint.id = 'ed-import-note';
        row.append(hint);

        const status = el('div', 'ed-hint');
        status.id = 'ed-import-state';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-atomic', 'true');

        const file = el('input', 'input');
        file.type = 'file';
        file.accept = 'application/pdf,.pdf,text/plain';
        file.id = 'ed-import-file';
        file.setAttribute('aria-labelledby', head.id);
        file.setAttribute('aria-describedby', hint.id + ' ' + status.id);
        file.addEventListener('change', async () => {
            const f = file.files && file.files[0];
            if (!f) return;
            status.textContent = TT('Reading…');
            status.className = 'ed-hint';
            let rv;
            try {
                // Every file, whatever its name says: fromFile dispatches on
                // the type itself and names what it found. Decoding a photo of
                // a Constancia as text would hand the scanners its mojibake.
                rv = await window.FiscalImport.fromFile(f, rec);
            } catch (e) {
                status.textContent = TT('That file could not be read.');
                status.className = 'ed-hint err';
                return;
            }
            status.textContent = '';
            status.className = 'ed-hint';
            showReview(rec, rv);
        });
        row.append(file);

        const paste = el('textarea', 'textarea');
        paste.placeholder = TT('…or paste text here');
        // A placeholder is not a name — it is gone the moment anything is typed
        // — and this box is the second control under one heading.
        paste.setAttribute('aria-label', TT('…or paste text here'));
        paste.setAttribute('aria-describedby', status.id);
        paste.id = 'ed-import-paste';
        paste.rows = 2;
        // Reading is synchronous and a megabyte of it costs half a second on
        // the thread this box lives on, so it runs when the typing stops.
        let pending = null;
        paste.addEventListener('input', () => {
            clearTimeout(pending);
            pending = setTimeout(() => {
                // An applied import rebuilds the form under this box. The last
                // keystroke before that must not reopen a pane over the result.
                if (!paste.isConnected) return;
                status.textContent = '';
                status.className = 'ed-hint';
                if (takePasted(rec, status, paste.value)) return;
                showReview(rec, window.FiscalImport.fromText(paste.value, rec));
            }, 300);
        });
        row.append(paste, status);
        return row;
    }

    // Share tab 3 writes a CFID payload, and the way a card crosses between two
    // of the holder's own phones is to scan that QR and paste it here. So the
    // link reader runs before the document reader: a payload is not prose, and
    // a link that failed to open is not text to go hunting a tax number in.
    function takePasted(rec, status, text) {
        const result = window.FiscalShare.readShared(text);
        if (!result) {
            // Silent on ordinary text, which is what makes the fall-through to
            // the document reader safe.
            const why = window.FiscalShare.lastReadError();
            if (!why) return false;
            status.textContent = linkProblemCopy(why);
            status.className = 'ed-hint err';
            return true;
        }

        if (result.card.iso !== rec.iso) {
            status.textContent = TT('That card is for {country}, not this one.',
                { country: countryName(result.card.iso) });
            status.className = 'ed-hint err';
            return true;
        }

        // Only the keys this record defines: a payload may name any key at all,
        // and a value with no field to render it is a value nobody can check.
        Object.keys(result.card.values).forEach((key) => {
            if (resolveField(rec, key)) editing.values[key] = result.card.values[key];
        });
        editing.kind = result.card.kind;
        if (!editing.label && result.card.label) editing.label = result.card.label;

        // No verifiedOn: a card off somebody's link is the moment BEFORE the
        // holder checks it against their own papers, exactly as an import is.
        closeReview();
        buildForm(rec, isExistingCard);
        if (!result.verified) {
            const fresh = $('#editForm .ed-import .ed-hint');
            if (fresh) {
                fresh.textContent = TT('This link is from an older version and carries no integrity check. Read every number back against your own document before you use it.');
                fresh.className = 'ed-hint err';
            }
        }
        return true;
    }

    function today() {
        return new Date().toISOString().slice(0, 10);
    }

    function textRow(name, value, onInput, placeholder, resolved, multiline, rec) {
        const identDef = resolved && resolved.kindOf === 'identifier' ? resolved.def : null;
        const fieldDef = resolved && resolved.kindOf === 'field' ? resolved.def : null;
        const row = el('div', 'ed-row');
        row.append(el('label', 'ed-k', name));
        const input = el(multiline ? 'textarea' : 'input', multiline ? 'textarea' : 'input');
        input.value = value;
        if (placeholder) input.placeholder = placeholder;
        /* THE KEYBOARD IS DERIVED FROM THE FORMAT, NOT LISTED PER COUNTRY. An identifier whose
           published shape admits no letter — a RUC, a NIF, an AFM, a CPF — should raise a phone's
           number pad and not its QWERTY, because the whole posture this app is used in is somebody
           typing eleven digits at a counter. The registry already states the shape, so the answer
           is read off the record's own regex rather than written down a second time in a list that
           would then have to be kept in step with it: no character class in the pattern mentions a
           letter, so no letter can be typed.
           inputmode and not type="number", deliberately — a number input strips leading zeros,
           offers a spinner, and in several browsers refuses a value it considers malformed, and a
           tax identifier is a STRING of digits, not a quantity. inputmode only picks the keyboard.
           Chile is the case that proves the derivation right: its RUT ends in a digit or a K, its
           pattern says so, and it correctly keeps the full keyboard. */
        if (!multiline && identDef && typeof identDef.format === 'string'
            && !/[A-Za-z]/.test(identDef.format)) {
            input.inputMode = 'numeric';
            input.autocapitalize = 'off';
            input.spellcheck = false;
        }
        const hint = el('div', 'ed-hint');
        // What the verdict rests on, beside the field rather than in a hover:
        // there is nothing to hover with on a phone, and the line that says an
        // authority never issues this number is the one worth reading.
        const why = el('div', 'ed-note');
        row.append(input, hint, why);

        // Written only where it changes: a live region re-announces whatever is
        // put into it, and a verdict restated on every keystroke is one nobody
        // hears the end of.
        const say = (node, text) => { if (node.textContent !== text) node.textContent = text; };

        let block = null;
        const explain = (key) => {
            if (block) { block.remove(); block = null; }
            if (key) block = refusalBlock(rec, key);
            if (block) row.append(block);
            if (key) row.dataset.refused = key;
            else delete row.dataset.refused;
        };

        // `settled` is the field having been left alone, not every keystroke:
        // Japan's My Number rule matches any twelve digits and a 法人番号 passes
        // through twelve on its way to thirteen, so a live refusal would fire
        // mid-word on a legitimate number. Every other verdict stays live.
        const check = (settled) => {
            // A field is not an identifier: checkField knows only that the
            // shape is wrong, and there is no key saying a field is right, so a
            // correct value stays silent. Said when the box is left rather than
            // while it is being filled — half a postcode is not a bad one, and
            // the same verdict arrives on the card the moment it is saved.
            if (!identDef) {
                const bad = !!(settled && fieldDef && input.value.trim()
                    && Engines.checkField(input.value, fieldDef));
                say(hint, bad ? TT('Wrong format') : '');
                hint.className = 'ed-hint' + (bad ? ' err' : '');
                return;
            }
            const quiet = () => {
                say(hint, '');
                say(why, '');
                hint.className = 'ed-hint';
                explain(null);
                gateSave();
            };
            if (!input.value.trim()) { quiet(); return; }

            const r = Engines.validate(input.value, identDef);
            // share.js reads the shape of the value as well as the record's own
            // rules, and in one case the registry publishes no rule for it is
            // the stricter of the two — it is also the layer that decides what
            // is stored and what may leave, so it decides what the badge says.
            // Two layers explaining one refusal differently is how somebody
            // learns to trust neither, and the value would go missing at the
            // save under a badge that had called it a typo.
            const held = identDef.key && rec ? window.FiscalShare.refusedIn(
                { iso: rec.iso, values: { [identDef.key]: input.value } }, rec)[0] : null;
            if ((r.status === 'refused' || held) && !settled) { quiet(); return; }

            const b = held && r.status !== 'refused'
                ? {
                    tone: 'err',
                    text: TT('This app never stores this number'),
                    title: TT('A number the state uses to identify a person is refused on every card. Use the number your counter actually asks for.'),
                }
                : badgeFor(r, identDef);
            say(hint, b ? b.text : '');
            say(why, b ? b.title : '');
            hint.className = 'ed-hint' + (b ? ' ' + b.tone : '');
            explain(r.status === 'refused' ? r.refused : (held ? held.refused : null));
            gateSave();
        };

        input.addEventListener('input', () => { onInput(input.value); check(false); });
        input.addEventListener('change', () => check(true));
        input.addEventListener('blur', () => check(true));
        check(true);
        return row;
    }

    function catalogueRow(name, resolved, card, onPick) {
        const row = el('div', 'ed-row');
        row.append(el('label', 'ed-k', name));
        const sel = el('select', 'select');
        sel.append(el('option', null, '—'));

        (resolved.def.options || [])
            // The option the card already holds is offered whatever kind the
            // card is now. A régimen ticked as a business and then switched to
            // personal is still stored and still on the invoice; dropping it
            // from the list left the field reading '—' over a value that was
            // very much there.
            .filter((o) => !o.applies || o.applies.indexOf(card.kind) !== -1
                || card.values[resolved.key] === o.code)
            .forEach((o) => {
                const opt = el('option', null, o.code + ' — ' + o.label);
                opt.value = o.code;
                if (card.values[resolved.key] === o.code) opt.selected = true;
                sel.append(opt);
            });

        sel.addEventListener('change', () => {
            card.values[resolved.key] = sel.value;
            gateSave();
            if (onPick) onPick();
        });
        row.append(sel);

        if (resolved.def.staleness) {
            row.append(el('div', 'ed-hint',
                TT('Catalogue verified') + ' ' + dateText(resolved.def.verified)));
        }
        return row;
    }

    function qrRow(rec, card) {
        const row = el('div', 'ed-row');
        row.append(el('label', 'ed-k', label(rec.officialQr.label, 'QR')));

        const note = el('div', 'ed-note', label(rec.officialQr.note, ''));
        const input = el('input', 'input');
        input.type = 'file';
        input.accept = 'image/*';

        const status = el('div', 'ed-hint');
        if (card.officialQr) status.textContent = TT('Image stored');

        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            Store.readImage(file).then((url) => {
                card.officialQr = url;
                status.textContent = TT('Image stored');
                status.className = 'ed-hint ok';
            }).catch((e) => {
                status.textContent = e.message === 'too-large'
                    ? TT('That image is too large — keep it under 400 KB.')
                    : TT('That file could not be read as an image.');
                status.className = 'ed-hint err';
            });
        });

        row.append(input, status, note);
        if (rec.officialQr.get) {
            const a = el('a', 'ed-link', TT('Get it from the authority'));
            a.href = rec.officialQr.get;
            a.target = '_blank';
            a.rel = 'noopener';
            row.append(a);
        }
        return row;
    }

    /* ================= import review =================
       A document proposes and the holder disposes. Nothing a reader found
       reaches a card until it has been shown here — beside the caption it was
       found under and however far the arithmetic went — and ticked. */

    // The review on offer, and the record it was read against.
    let review = null;
    let reviewRec = null;
    let reviewKindWhy = null;

    function closeReview() {
        review = null;
        reviewRec = null;
        reviewKindWhy = null;
        $('#reviewPane').hidden = true;
        $('#reviewProblem').hidden = true;
        $('#reviewProblem').textContent = '';
        $('#reviewList').innerHTML = '';
        $('#reviewNotes').innerHTML = '';
        $('#reviewMissing').hidden = true;
        $('#reviewMissingList').textContent = '';
    }

    // Nine codes, nine sentences. A locked PDF, a photo of one and a JPEG are
    // three different next steps, and one "could not be read" for all of them
    // sends eight readers out of nine looking for the wrong fault.
    function problemCopy(code) {
        if (code === 'encrypted') return TT('That PDF is password-protected. Unlock it and save a copy, or paste its text below.');
        if (code === 'corrupt') return TT('That PDF is damaged and could not be read.');
        if (code === 'not-pdf') return TT('That file is not a PDF.');
        if (code === 'no-text') return TT('That PDF holds no text — it is a scan or a photo. Type the fields in, or paste the text from somewhere else.');
        if (code === 'not-text') return TT('That file is not text and cannot be read here.');
        if (code === 'empty-file') return TT('That file is empty.');
        if (code === 'no-parser') return TT('The PDF reader did not load, so PDFs cannot be opened here yet. Go online once to finish installing, or paste the text instead.');
        if (code === 'partial') return TT('Only part of that document could be read. Check every field before you save.');
        return TT('That file could not be read.');
    }

    // Why a row is offered unticked, or cannot be offered at all. Where the
    // reason is the status, the badge is already carrying it and says it once.
    function reasonCopy(c) {
        const reason = c.reason;
        if (!reason || reason === c.status) return '';
        if (reason === 'dv-mismatch') {
            // Both digits are the sentence. Without them it prints its own
            // braces to somebody standing at a counter.
            if (!c.printedDv || !c.expected) return '';
            return TT('The document prints check digit {printed}, but the rule computes {expected}. Nothing was filled in — check the paper and type it.',
                { printed: c.printedDv, expected: c.expected });
        }
        const map = {
            'third-party': TT('Printed as somebody else’s number'),
            unlabelled: TT('Found without a label naming it'),
            'grouping-only': TT('Recognised only by its shape'),
            derived: TT('Completed by this app, not read from the document'),
            ambiguous: TT('Two readings of this were possible'),
            'choose-one': TT('Only one of these can be right'),
            'same-value': TT('The same value was found twice'),
            'check-conflict': TT('Another reading of this number fails its check digit — compare it with the paper.'),
            // A denial that ever arrives under a status which does not carry it
            // would be read off an offerable badge. If one of these three ever
            // prints, the badge above it is the thing that is wrong.
            'not-issuable': TT('Never issued by the authority'),
            refused: TT('This app never stores this number'),
            reserved: TT('Reserved official value'),
        };
        return map[reason] || '';
    }

    function reviewRow(rec, c, boxes) {
        const row = el('div', 'rv-row' + (c.blocked ? ' blocked' : ''));

        // A blocked row carries no checkbox: it can never be applied, and a box
        // that refuses to tick invites the second try.
        if (!c.blocked) {
            const box = el('input');
            box.type = 'checkbox';
            box.checked = !!c.accepted;
            box.addEventListener('change', () => {
                c.accepted = box.checked;
                // Two readings of one key describe a card that cannot exist,
                // and accept() would keep whichever was scanned first — which
                // on a RUT is the seccional's NIT and not the holder's.
                if (box.checked) {
                    boxes.forEach((other) => {
                        if (other.c === c || other.c.key !== c.key) return;
                        other.c.accepted = false;
                        other.box.checked = false;
                    });
                }
                refreshReview();
            });
            boxes.push({ c: c, box: box });
            row.append(box);
        }

        const main = el('div', 'rv-main');
        row.append(main);

        const resolved = resolveField(rec, c.key);
        let def = resolved ? resolved.def : null;
        if (resolved && resolved.kindOf === 'identifier') def = resolveVariant(def, editing);
        main.append(el('span', 'rv-k', label(def && def.label, c.key)));
        main.append(el('span', 'rv-v', c.value));

        // What the paper printed, where it differs from what would be written:
        // a NIT read across two boxes and a check digit this app computed
        // differ from the value by exactly the part the holder has to check.
        const seen = c.seen && c.seen !== c.value ? '“' + c.seen + '” · ' : '';
        main.append(el('span', 'rv-seen', seen + (c.label
            ? TT('found beside “{label}”', { label: c.label })
            : TT('found with no label'))));

        // A field's status is a hard-coded 'unchecked', and "no published check
        // digit" is not a thing to say about a name or an email address.
        let verdict = '';
        let verdictTone = '';
        if (c.slot === 'identifier') {
            const b = badgeFor({ status: c.status, expected: c.expected }, def);
            if (b) {
                main.append(el('span', 'f-badge ' + b.tone, b.text));
                verdict = b.title;
                verdictTone = b.tone;
            }
        }

        const why = (text) => { if (text) main.append(el('span', 'rv-why', text)); };
        why(reasonCopy(c));
        // The sentence behind the badge, on the row and not in a hover: this
        // pane is read on the phone the document was photographed with. A pass
        // keeps out of .rv-why, which a blocked row paints in the error colour:
        // XAXX010101000 is the constant SAT mandates, and its note printed red
        // tells a Mexican holder their correct RFC is wrong.
        if (verdict) {
            main.append(el('span', verdictTone === 'ok' ? 'rv-seen' : 'rv-why', verdict));
        }
        // Off the field and never off the reason: a computed check digit on
        // somebody else's number reports 'third-party' and carries status ok,
        // so the badge alone would read as verified.
        if (c.derived && c.reason !== 'derived') {
            why(TT('Completed by this app, not read from the document'));
        }
        const weak = c.weak && weakCopy(c.weak);
        if (weak) why(TT('Worth reading back') + ' — ' + weak);
        return row;
    }

    // The kind is not a field anyone ticks: accept() reads it off the rows that
    // are. It is on the pane because it decides which half of the form the card
    // is asked for at all.
    function kindRow(rv) {
        const row = el('div', 'rv-row');
        const main = el('div', 'rv-main');
        main.append(el('span', 'rv-k', TT('Kind')));
        main.append(el('span', 'rv-v', rv.kind === 'business' ? TT('Business') : TT('Personal')));
        reviewKindWhy = el('span', 'rv-why');
        main.append(reviewKindWhy);
        row.append(main);
        return row;
    }

    // A refusal is the app working, never an error. The count names nothing;
    // the record's own label and paragraph follow only where the document
    // printed the name, because telling a Japanese invoice it carried a My
    // Number sends its holder hunting a page for a number that is not on it.
    function reviewNotes(rec, rv) {
        const host = $('#reviewNotes');
        host.innerHTML = '';

        (rv.refusals || []).forEach((r) => {
            host.append(el('div', null,
                TT('{n} numbers this app never stores were found and left out.', { n: r.count })));
            if (!r.named) return;
            const named = label(r.label, r.key);
            const why = label(r.reason, '');
            host.append(el('div', null, why ? named + ' — ' + why : named));
        });

        (rv.ambiguous || []).forEach((key) => {
            const resolved = resolveField(rec, key);
            host.append(el('div', null, label(resolved && resolved.def.label, key)
                + ' — ' + TT('Two readings of this were possible')));
        });

        // How a holder notices the document in their hand is not theirs.
        if (rv.subject) {
            host.append(el('div', null,
                TT('This document names {name} as the holder.', { name: rv.subject })));
        }
    }

    // accept() emits the kind only where the value it was read off survived the
    // ticks, so the pane says the same rather than promising one the apply will
    // not deliver.
    function kindOnOffer() {
        if (!review || !review.acceptKind || !review.kind) return null;
        if (!review.kindFrom) return review.kind;
        return review.candidates.some(
            (c) => c.key === review.kindFrom && c.accepted && !c.blocked) ? review.kind : null;
    }

    // review.missing counts a row that was merely OFFERED as found, so a
    // régimen fiscal left unticked reads there as present and the card saves
    // without the one field SAT rejects a CFDI 4.0 over. Ask the ticks instead.
    function renderMissing() {
        const rec = reviewRec;
        const values = (editing && editing.values) || {};
        const k = kindOnOffer() || (editing && editing.kind) || 'personal';
        const prof = (rec.invoiceProfile || {})[k] || {};

        const ticked = {};
        review.candidates.forEach((c) => { if (c.accepted && !c.blocked) ticked[c.key] = true; });

        const names = (prof.required || [])
            // A key the form already holds is not a gap this document leaves.
            .filter((key) => !ticked[key] && !values[key])
            .map((key) => {
                const resolved = resolveField(rec, key);
                return resolved ? label(resolved.def.label, key) : key;
            });

        $('#reviewMissingList').textContent = names.join(' · ');
        $('#reviewMissing').hidden = !names.length;
    }

    // The two lines that follow the ticks rather than the document.
    function refreshReview() {
        if (!review || !reviewRec) return;
        if (reviewKindWhy) {
            reviewKindWhy.textContent = kindOnOffer() ? '' : TT('Not found in the document');
        }
        renderMissing();
    }

    function showReview(rec, rv) {
        // An empty box is not a failed read: there is nothing to say about it,
        // and the review carries a missing list even here.
        if (!rv || (!rv.problem && !rv.chars)) { closeReview(); return; }

        review = rv;
        reviewRec = rec;
        reviewKindWhy = null;

        const list = $('#reviewList');
        list.innerHTML = '';
        $('#reviewNotes').innerHTML = '';
        $('#reviewMissing').hidden = true;
        $('#reviewMissingList').textContent = '';

        // 'partial' is the one code that still carries rows: it says so and
        // shows what it read. A page of prose that matched nothing did not
        // fail either, and gets the sentence that says what to do next.
        const sentence = rv.problem ? problemCopy(rv.problem)
            : (rv.candidates.length ? ''
                : TT('Nothing recognisable found. Fill the fields below instead.'));
        const problem = $('#reviewProblem');
        problem.textContent = sentence;
        problem.hidden = !sentence;

        // A document that did not open holds no rows, no refusals and nothing
        // to call missing: that sentence is the whole report.
        if (rv.problem && !rv.chars) {
            $('#reviewPane').hidden = false;
            return;
        }

        const boxes = [];
        // Page order rather than scan order: this is read against a sheet of
        // paper the holder has in their hand.
        rv.candidates.slice()
            .sort((a, b) => (a.anchor == null ? 1e9 : a.anchor) - (b.anchor == null ? 1e9 : b.anchor))
            .forEach((c) => list.append(reviewRow(rec, c, boxes)));
        if (rv.kind) list.append(kindRow(rv));

        reviewNotes(rec, rv);
        refreshReview();
        $('#reviewPane').hidden = false;
    }

    // accept() is the only way a value may leave a review: it re-checks every
    // tick, so a blocked row cannot get out through a forced checkbox.
    function applyReview() {
        if (!review || !reviewRec || !editing) return;
        const rec = reviewRec;
        const out = window.FiscalImport.accept(review);

        Object.keys(out.values).forEach((k) => { editing.values[k] = out.values[k]; });
        // Only what accept() emitted. review.kind is what the document said,
        // not what the ticks agreed to.
        if (out.kind) editing.kind = out.kind;

        // Name the card after whoever the document says it belongs to. The
        // label is the tile's headline and part of the card's URL, so leaving
        // it blank would give an imported card the address "#/mx-business" and
        // the title "Mexico".
        if (!editing.label) {
            const v = editing.values;
            const name = review.subject || v.razonSocial || v.legalName || v.nombre || '';
            if (name) editing.label = name.length > 40 ? name.slice(0, 40).trim() : name;
        }

        // No verifiedOn: an import is the moment before the holder checks the
        // card against their papers, and dating it would start the staleness
        // clock from a claim nobody made.
        closeReview();
        buildForm(rec, isExistingCard);
        // buildForm rebuilt the row, so the report goes on the new one.
        const fresh = $('#editForm .ed-import .ed-hint');
        if (fresh) {
            fresh.textContent = TT('Read {n} fields from the document.', { n: out.applied.length });
            fresh.className = 'ed-hint ok';
        }
    }

    /* ================= main render ================= */

    // The language a rendered surface is currently in. render() is the i18n
    // hook as well as this app's own repaint, and the two want different
    // things: a repaint after a save must leave an open form alone, while a
    // language switch has to rebuild it or it stays in the language it was
    // built in for as long as the dialog is open.
    let paintedLang = null;

    async function render() {
        const switched = paintedLang !== lang();
        paintedLang = lang();

        renderLinkProblem();
        renderWall();
        paintOffline();

        if (current && $('#cardDlg').open) {
            const rec = await record(current.iso);
            renderDetailHead(rec, current);
            renderCard(rec, false);
            renderDetailActions(rec, current);
            if ($('#bigDlg').open) {
                renderCard(rec, true);
                renderBigHead(current);
                refitLead();
            }
        }
        if (switched) {
            if ($('#shareDlg').open && shareState) renderShare();
            if ($('#pickerDlg').open) renderPickerList($('#pickerSearch').value);
            if ($('#editDlg').open && editing) {
                buildForm(await record(editing.iso || iso), isExistingCard);
                // The pane is drawn from the same review, whose rows carry the
                // record's labels and this app's own sentences alike.
                if (review && reviewRec) showReview(reviewRec, review);
            }
        }
        document.documentElement.lang = lang();
    }

    /* ================= URL routing =================
       #/<slug>        a specific card on this device
       #card=<data>    a card carried in from a shared link
       #demo           the samples
       Everything is a fragment, so none of it reaches a server. */

    /* ================= launched from outside the tab =================
       Three doors the manifest opens, and all three are read from the query string and then
       WIPED from it, for the same reason the card links are: an address that still says
       ?text=<somebody's VAT number> is one that goes into history, into a bookmark and into the
       next screenshot. The strip is a replaceState, so Back does not walk into it either.

       SHARED TEXT GOES TO THE CHECK BOX AND NOWHERE ELSE. It is the one surface in this app that
       stores nothing, which is the right default for content the user did not type here and may
       not have read: a signature block shared in from a mail app can carry somebody else's
       number, and routing it to the editor would be an app that quietly keeps what it was passed.
       ?do=check and ?do=counter are the manifest shortcuts; ?do=restore is the file handler. */
    async function routeFromLaunch() {
        let q;
        try { q = new URLSearchParams(location.search || ''); }
        catch (e) { return false; }
        const doing = q.get('do');
        const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n');
        if (!doing && !shared) return false;

        try { history.replaceState(null, '', location.pathname); }
        catch (e) { /* the address bar is not what the app runs on */ }

        if (shared || doing === 'check') {
            $('#checkText').value = shared;
            $('#checkOut').textContent = '';
            $('#checkDlg').showModal();
            if (shared) renderCheck();
            return true;
        }
        if (doing === 'restore') {
            $('#restoreFile').value = '';
            $('#restoreText').value = '';
            $('#restoreReplace').checked = false;
            $('#restoreResult').textContent = '';
            $('#restoreDlg').showModal();
            return true;
        }
        if (doing === 'counter') {
            // The last card used, which is what a shortcut from the home screen means by "my
            // card". With none on the device there is nothing to open and the wall is the honest
            // answer rather than an empty dialog.
            // openBig() reads the module's current card rather than taking one, so the card has
            // to be SELECTED first. openCard does exactly that and opens the detail behind it,
            // which is also where closing counter mode should land.
            const card = (Store.forIso(Store.lastIso()) || [])[0] || allCards()[0];
            if (card) {
                await openCard(card);
                openBig(await record(card.iso));
                return true;
            }
        }
        return false;
    }

    /* A file handed to an installed copy arrives through launchQueue rather than through the
       query string, so the handler above cannot see it. Read as text and dropped into the
       restore box — never applied on arrival, because a backup that restores itself the moment
       it is opened is one nobody agreed to. */
    function acceptLaunchedFiles() {
        if (!('launchQueue' in window) || !window.launchQueue) return;
        try {
            window.launchQueue.setConsumer(async (params) => {
                if (!params || !params.files || !params.files.length) return;
                try {
                    const text = await (await params.files[0].getFile()).text();
                    $('#restoreFile').value = '';
                    $('#restoreText').value = text;
                    $('#restoreReplace').checked = false;
                    $('#restoreResult').textContent = '';
                    $('#restoreDlg').showModal();
                } catch (e) { /* an unreadable file is the file picker's problem, not a crash */ }
            });
        } catch (e) { /* not supported here */ }
    }

    async function routeFromHash() {
        const m = /^#\/([a-z0-9-]+)$/i.exec(location.hash || '');
        if (!m) return false;
        const card = cardBySlug(m[1]);
        if (!card) {
            // Nothing on this device answers to that address — a card that was
            // deleted, or a link from someone else's wall. Leaving it in the
            // bar makes the tab look like it is showing a card it is not, and
            // makes every reload and every Back retry the same dead address.
            const dlg = $('#cardDlg');
            if (dlg.open) dlg.close();
            try { history.replaceState(null, '', location.pathname + location.search); }
            catch (e) { /* the address bar is not what the card runs on */ }
            return false;
        }
        await openCard(card);
        return true;
    }

    /* ================= backup, restore, erase ================= */

    // #storageWarn's own sentence is about a browser that refuses to store
    // anything at all, so it follows the probe and nothing else — including
    // back to hidden once site data is allowed again. A single write that did
    // not land is a different fact and gets its own line, because
    // storageAvailable() still answers true when the quota is simply full.
    /* ================= checking a number that is not yours =================
       THE ENGINES WERE ALWAYS GENERAL AND ONLY EVER POINTED AT THE HOLDER. Twenty-two records,
       thirty-odd identifiers and a fixture suite already answer "is this a real number" for any
       jurisdiction in the registry; until now the only way to ask was to type it into a card and
       keep it. A supplier's VAT number on an invoice is the commonest reason to want the answer
       and the one case the app could not serve.

       NOTHING TYPED HERE IS STORED. Not to localStorage, not to the wall, not to `last`. That is
       the whole reason this is a separate dialog rather than a mode of the editor: the editor's
       job is to keep what it is given, and this box's job is to forget it. The hint says so where
       the user is looking rather than in a policy page.

       The jurisdiction is not asked for. A number's shape is usually enough to place it, and
       making somebody pick Peru from 249 rows before they can check a RUC is the friction the
       feature exists to remove — so every identifier of every real record is tried and the
       results are ranked. Where a shape is genuinely ambiguous the answer says so by showing
       more than one row, which is the honest output rather than a guess. */

    // Trailing-edge only: the answer to a half-typed number is noise, and the answer to the
    // finished one is the same work done once. 160ms is under the gap between two keystrokes of
    // ordinary typing and over the gap inside a paste.
    function debounce(fn, ms) {
        let t = 0;
        return function () {
            const self = this, args = arguments;
            clearTimeout(t);
            t = setTimeout(() => fn.apply(self, args), ms);
        };
    }

    // Tier 3 records are synthetic and hold no identifier, so they can neither match nor rule
    // anything out. Loaded once and cached by record() thereafter.
    let realRecordsCache = null;
    async function realRecords() {
        if (realRecordsCache) return realRecordsCache;
        const codes = INDEX.filter((c) => c.tier !== 3).map((c) => c.iso);
        realRecordsCache = await Promise.all(codes.map((c) => record(c)));
        return realRecordsCache;
    }

    // Ranked worst-to-best so a plain sort puts the most useful reading first. A bad-check is
    // ABOVE bad-format on purpose: "the right shape for a Spanish NIF, wrong control character"
    // is a far more useful sentence than silence, and it is the one a mistyped number produces.
    const CHECK_RANK = {
        ok: 6, reserved: 5, unchecked: 4, unimplemented: 4,
        'not-issuable': 3, 'bad-check': 2, refused: 1,
    };

    function readingsFor(value, recs) {
        const out = [];
        recs.forEach((rec) => {
            (rec.identifiers || []).forEach((def) => {
                const r = Engines.validate(value, def, rec);
                const status = r && r.status;
                // bad-format is the answer for every jurisdiction the number is NOT from, which is
                // most of them; keeping those would bury the one that matters under two hundred.
                if (!status || status === 'empty' || status === 'bad-format') return;
                out.push({ iso: rec.iso, rec: rec, def: def, result: r, rank: CHECK_RANK[status] || 0 });
            });
        });
        out.sort((a, b) => b.rank - a.rank);
        // Only the best tier of answer is shown. A number that validates cleanly in one place does
        // not need the four jurisdictions where it merely has the right number of digits.
        return out.length ? out.filter((r) => r.rank === out[0].rank) : out;
    }

    /* WHAT COUNTS AS "A NUMBER" ON A LINE OF PROSE. A column pasted from a spreadsheet is one
       value per line and the line IS the value; text shared in from a mail app is a sentence with
       a value somewhere in it, and share_target exists to receive exactly that. So the whole line
       is tried first — it is the common case and the least surprising — and only if nothing reads
       is the line broken into candidate tokens.
       Six characters is the floor because the shortest identifier the registry holds is eight and
       a separator or two can be written inside it; below that the tokens are words. Punctuation
       that authorities actually print inside numbers (. - /) stays inside the token, which is why
       12.345.678-5 survives the split as one candidate rather than three. */
    function candidatesOn(line) {
        const out = [line];
        const seen = { [line]: 1 };
        (line.match(/[0-9A-Za-z][0-9A-Za-z.\-\/]{4,}[0-9A-Za-z]/g) || []).forEach((t) => {
            if (!seen[t]) { seen[t] = 1; out.push(t); }
        });
        /* AND THE GROUPED FORMS, because that is how the authorities themselves print them: an ABN
           is published as 51 824 753 556 and a SIREN as 380 129 866. The token pass above stops at
           the first space and would read those as "51". This second pass takes runs of digits and
           the separators that appear INSIDE a number, then closes the gaps — the engines normalise
           punctuation anyway, so what is handed on is the digits in order.
           Bounded to runs that still look like one number: it starts and ends on a digit, so a
           sentence's worth of prose cannot be swallowed into a single candidate. */
        (line.match(/[0-9][0-9 .\-]{4,}[0-9]/g) || []).forEach((t) => {
            const joined = t.replace(/\s+/g, '');
            if (!seen[joined]) { seen[joined] = 1; out.push(joined); }
        });
        return out;
    }

    function renderCheck() {
        const out = $('#checkOut');
        out.textContent = '';
        const lines = $('#checkText').value.split(/[\r\n]+/)
            .map((l) => l.trim()).filter(Boolean).slice(0, 200);
        if (!lines.length) return;

        realRecords().then((recs) => {
            const frag = document.createDocumentFragment();
            lines.forEach((line) => {
                const row = el('div', 'chk-row');
                // The echo is the candidate that actually read, not the line it was found in:
                // on a shared signature block the line is a sentence, and a verdict beside a
                // sentence does not say which characters it is about.
                let shown = line;
                let readings = [];
                const cands = candidatesOn(line);
                for (let ci = 0; ci < cands.length; ci++) {
                    readings = readingsFor(cands[ci], recs);
                    if (readings.length) { shown = cands[ci]; break; }
                }
                row.append(el('span', 'chk-in', shown));
                if (!readings.length) {
                    row.append(el('span', 'chk-none',
                        TT('No jurisdiction this app knows issues a number in that shape.')));
                } else {
                    const hits = el('span', 'chk-hits');
                    readings.forEach((r) => {
                        const b = badgeFor(r.result, r.def);
                        const one = el('span', 'chk-hit');
                        one.append(el('span', 'chk-where',
                            countryName(r.iso) + ' · ' + label(r.def.label, r.def.key)));
                        if (b) {
                            const badge = el('span', 'f-badge ' + b.tone, b.text);
                            if (b.title) badge.title = b.title;
                            one.append(badge);
                        }
                        hits.append(one);
                    });
                    row.append(hits);
                }
                frag.append(row);
            });
            out.append(frag);
        });
    }

    function reflectStorage() {
        $('#storageWarn').hidden = Store.storageAvailable();
    }

    /* Asked once per page life, not once per save. requestPersistence() resolves rather than
       rejects on every path, so there is no catch here to write: a browser that does not implement
       it, a user who declined, and a grant all arrive as the same shape. Nothing is shown on a
       refusal — the honest consequence of one is that the backup line matters more, and that line
       is already on screen. */
    let persistenceAsked = false;
    function askPersistenceOnce() {
        if (persistenceAsked) return;
        persistenceAsked = true;
        Store.requestPersistence().then(reflectBackup);
    }

    /* ONE LINE THAT SAYS WHETHER THIS DEVICE IS A SAFE PLACE TO KEEP THIS, and it is deliberately
       not a badge that says "protected". Two facts decide it and neither is under this app's
       control: whether the browser granted persistent storage, and how long ago the user last took
       a backup. The wording leads with the action, because "export a backup" is the only thing the
       reader can actually do about either. */
    function reflectBackup() {
        const line = $('#backupNote');
        if (!line) return;
        const b = Store.backupState();
        if (!b) { line.hidden = true; line.textContent = ''; return; }
        Store.persistence().then((p) => {
            const parts = [];
            if (b.state === 'none') parts.push(TT('No backup has been taken from this device yet.'));
            else parts.push(TT('The last backup was {date} and this device has changed since.',
                { date: dateText(b.on) }));
            // Said only when it is true and only when it is bad news. A granted persist() is the
            // quiet case and needs no sentence; a refused one is why the backup is the whole plan.
            if (p.supported && !p.persisted) {
                parts.push(TT('This browser has not promised to keep this data, so it can be cleared to make room.'));
            }
            line.textContent = parts.join(' ');
            line.hidden = false;
        });
    }

    // A write the store could not land, and a number it held back, both have to
    // be said out loud: a value that disappears without a word gets read off
    // the original document and typed in again at the counter. The record names
    // the kind; the number itself is never printed back.
    function writeNotes(rec, result) {
        const out = [];
        if (!result.durable) {
            out.push(el('div', 'ed-hint err',
                TT('Nothing was written to this device, so this will be gone when you reload.')));
        }

        const refused = result.refused || [];
        const numbers = refused.filter((d) => d.where === 'value');
        if (numbers.length) {
            out.push(el('div', 'ed-hint warn',
                TT('{n} numbers this app never stores were found and left out.', { n: numbers.length })));
            const kinds = [];
            numbers.forEach((d) => { if (kinds.indexOf(d.refused) === -1) kinds.push(d.refused); });
            kinds.forEach((key) => {
                const block = refusalBlock(rec, key);
                if (block) out.push(block);
            });
        }

        // A nickname is not a number that was left out — it was blanked, and
        // counting it as one would report a name as a tax identifier.
        if (refused.some((d) => d.where === 'label')) {
            out.push(el('div', 'ed-hint warn',
                TT('The card name held a number this app never stores, so the card was saved without a name.')));
        }
        return out;
    }

    // The clipboard does not survive the device change a backup exists for, so
    // the same click also writes the file. Both carry exactly what exportAll()
    // returned; neither reformats it.
    function downloadBackup(text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = el('a');
        a.href = url;
        a.download = 'carino-fiscal-backup-' + today() + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    // importAll refuses a file it cannot use by throwing a code, and the three
    // codes are the whole set. One sentence each: "that file could not be read"
    // sends someone who pasted the wrong JSON looking for a disk fault.
    function restoreError(code) {
        if (code === 'not-json') return TT('That file is not JSON.');
        if (code === 'not-a-backup') return TT('That file is not a Carino Fiscal backup.');
        if (code === 'shape') return TT('That backup holds no cards.');
        return TT('That file could not be read.');
    }

    // importAll takes the string or the parsed object, so the file input and
    // the paste box are one path and one report. The backup is the one file
    // that comes back from outside the device: it is never parsed here.
    async function runRestore() {
        const out = $('#restoreResult');
        const picked = $('#restoreFile').files;
        const file = picked && picked[0];

        // Nothing chosen and nothing pasted is not a broken backup, and the
        // dialog's own line already says what to do; sending the reader after a
        // file they never picked would be the wrong sentence for the wrong step.
        if (!file && !$('#restoreText').value.trim()) {
            $('#restoreFile').focus();
            return;
        }

        let text;
        try {
            text = file ? await file.text() : $('#restoreText').value;
        } catch (e) {
            out.textContent = TT('That file could not be read.');
            out.className = 'ed-hint err';
            return;
        }

        let res;
        try {
            res = Store.importAll(text, { replace: $('#restoreReplace').checked });
        } catch (e) {
            out.textContent = restoreError(e.message);
            out.className = 'ed-hint err';
            return;
        }
        reflectStorage();
        reflectBackup();

        const parts = [];
        let tone = 'ok';
        if (!res.durable) {
            // Nothing reached disk, so there is nothing restored to count.
            parts.push(TT('Nothing was written to this device, so this will be gone when you reload.'));
            tone = 'err';
        } else {
            if (res.added) parts.push(TT('{n} cards restored', { n: res.added }));
            if (res.skipped) parts.push(TT('{n} were already here and were skipped', { n: res.skipped }));
            if (res.dropped) {
                parts.push(TT('{n} could not be read and were dropped', { n: res.dropped }));
                tone = 'warn';
            }
        }
        if (res.refused) {
            parts.push(TT('{n} numbers this app never stores were found and left out.', { n: res.refused }));
            if (tone === 'ok') tone = 'warn';
        }
        if (res.newer) {
            parts.push(TT('That backup was written by a newer version, so some fields may be missing.'));
            if (tone === 'ok') tone = 'warn';
        }

        out.textContent = parts.join(' · ');
        out.className = 'ed-hint ' + tone;
        // The dialog stays open: #restoreResult is where the counts are, and a
        // restore that closes over its own report tells the user nothing.
        await render();
    }

    /* ================= the service worker =================
       A new build installs, waits, and says so. It never takes over a running
       page by itself: the page it would replace belongs to somebody standing at
       a counter with a form half typed. */

    // Sampled before anything can change it. The worker claims an uncontrolled
    // page on a FIRST install too, which raises controllerchange with no build
    // having changed; only a page that was already controlled is looking at
    // code the new worker has replaced.
    const hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    let reloading = false;
    let updateReg = null;
    let updateDismissed = false;

    function offerUpdate(reg) {
        if (updateDismissed) return;
        updateReg = reg;
        // The bar carries its own sentence, so unhiding it is the announcement.
        $('#updateBar').hidden = false;
    }

    // Three ways to learn the same fact, each with a hole the other two cover: a
    // worker that installed while the tab was closed is already waiting; one
    // that installs while this page is open arrives as a state change; and one
    // that finished before the listener was attached is only ever announced.
    // The announcement is posted from inside install, before the worker reaches
    // the waiting state, so it is a reason to look rather than proof there is
    // something to take.
    function watchForUpdate(reg) {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);

        reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
                if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
            });
        });

        navigator.serviceWorker.addEventListener('message', (e) => {
            if (!e.data || e.data.type !== 'UPDATE_AVAILABLE') return;
            if (reg.waiting) { offerUpdate(reg); return; }
            let tries = 0;
            const poll = setInterval(() => {
                if (reg.waiting) { clearInterval(poll); offerUpdate(reg); }
                else if (++tries > 40) clearInterval(poll);
            }, 250);
        });
    }

    // The worker's last answer about what it holds, or null while there has not
    // been one. Unknown is a third state and it renders as an empty line:
    // #offlineRow is a live region, it has to be sitting in the accessibility
    // tree and empty before any text arrives, and there is no honest sentence
    // for "the worker never answered" — so the line is never hidden and the
    // sentence is never invented.
    let cached = null;

    function paintOffline() {
        if (!cached) return;
        const line = $('#offlineState');
        if (cached.ready) {
            line.className = 'ready';
            line.textContent = TT('Ready to use offline');
            return;
        }
        line.className = 'pending';
        line.textContent = TT('Still saving for offline use — {n} files to go.',
            { n: (cached.missing || []).length });
    }

    function askOffline() {
        if (!('serviceWorker' in navigator)) return Promise.reject(new Error('no worker'));
        // navigator.serviceWorker.ready never settles where nothing is
        // registered, so the timeout races the whole ask rather than sitting
        // inside it where it would never be armed.
        const timeout = new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('timeout')), 10000);
        });
        const asked = navigator.serviceWorker.ready.then((reg) => new Promise((resolve, reject) => {
            if (!reg.active) { reject(new Error('no active worker')); return; }
            const channel = new MessageChannel();
            channel.port1.onmessage = (e) => resolve(e.data);
            reg.active.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
        }));
        return Promise.race([asked, timeout]);
    }

    function reflectOffline(retry) {
        askOffline().then((state) => {
            cached = state || null;
            paintOffline();
            // Asking is also what repairs a cache with a hole in it — install
            // runs once per version, so a file that failed there is otherwise
            // missing for good — which makes the second ask the repair as much
            // as the report.
            if (retry && state && !state.ready) setTimeout(() => reflectOffline(false), 5000);
        }, () => { /* unknown, and an empty line is what says so */ });
    }

    function onServiceWorker(reg) {
        watchForUpdate(reg);
        reflectOffline(true);
    }

    /* ================= wiring ================= */

    function wire() {
        // The target carries tabindex="-1" so it can take focus, but a fragment
        // jump moves the reading position only as far as the browser is willing
        // to take it. Doing it here also leaves the address bar alone: a card's
        // own address lives in that same fragment.
        $('#skipLink').addEventListener('click', (e) => {
            e.preventDefault();
            $('#main').focus();
        });

        $('#pickerSearch').addEventListener('input', (e) => renderPickerList(e.target.value));

        document.querySelectorAll('[data-close]').forEach((b) => {
            b.addEventListener('click', () => b.closest('dialog').close());
        });

        $('#addCard').addEventListener('click', () => openPicker(true));

        $('#reviewApply').addEventListener('click', applyReview);
        $('#reviewCancel').addEventListener('click', closeReview);

        $('#editSave').addEventListener('click', guard(async () => {
            if (!editing) return;
            editing.iso = iso;
            // Saving is you confirming the card is right today; that date is what
            // the staleness nudge measures against.
            editing.verifiedOn = today();
            const rec = await record(iso);
            // The record carries the jurisdiction's own refusals, which the
            // store consults but cannot fetch for itself.
            const result = Store.save(editing, rec);
            reflectStorage();
            // THE FIRST MOMENT THERE IS ANYTHING TO LOSE is the right one to ask the browser to
            // keep it. Asking at boot would put a permission prompt in front of somebody who has
            // not yet decided the app is worth anything; asking after every save would re-ask a
            // question already answered. persist() resolves false on a refusal, which is not an
            // error and is not reported as one — it is the state the backup nudge is for.
            askPersistenceOnce();
            // Only an iso that is not two letters reaches this, and the picker
            // cannot produce one — but the wall goes down if it ever does.
            if (!result.card) return;

            kind = result.card.kind;
            Store.noteUse(iso, kind);
            // The store's copy, never the one that was typed: it is the one the
            // refusal already went through.
            const saved = Store.byId(result.card.id) || result.card;

            const notes = writeNotes(rec, result);
            if (notes.length) {
                // #editDlg has no status line of its own, and closing over a
                // held-back number would leave the user believing they saved
                // it. Rebuilding the form on the saved card shows what actually
                // landed, and holding the id means a second Save updates that
                // card rather than minting another.
                editing = saved;
                buildForm(rec, true);
                notes.forEach((n) => $('#editForm').append(n));
                await render();
                return;
            }

            editing = null;
            $('#editDlg').close();
            await render();
            await openCard(saved);
        }));

        $('#editDelete').addEventListener('click', () => {
            if (!editing) return;
            // A card that was never written has nothing to remove and nothing
            // to ask about.
            if (!editing.id) { $('#editDlg').close(); return; }
            askDelete(guard(runDelete));
        });

        $('#detailAddrCopy').addEventListener('click', function () {
            if (current) copy(cardUrl(current), this);
        });

        $('#exportBtn').addEventListener('click', function () {
            const text = Store.exportAll();
            copy(text, this);
            downloadBackup(text);
            // Recorded here and not inside exportAll(), because what counts as a backup is a file
            // that left the app, not a string that was built. Both happen on this click.
            Store.noteBackup(allCards().length);
            reflectBackup();
        });

        $('#checkBtn').addEventListener('click', () => {
            $('#checkText').value = '';
            $('#checkOut').textContent = '';
            $('#checkDlg').showModal();
        });
        $('#checkRun').addEventListener('click', guard(renderCheck));
        // Re-run as they type rather than only on the button: the commonest use is one number
        // pasted in, and making somebody reach for a second click to see the answer to a question
        // the app can already answer is the friction this feature exists to remove.
        $('#checkText').addEventListener('input', debounce(renderCheck, 160));

        $('#restoreBtn').addEventListener('click', () => {
            $('#restoreFile').value = '';
            $('#restoreText').value = '';
            $('#restoreReplace').checked = false;
            const out = $('#restoreResult');
            out.textContent = '';
            out.className = 'ed-hint';
            $('#restoreDlg').showModal();
        });

        $('#restoreRun').addEventListener('click', guard(runRestore));

        $('#eraseBtn').addEventListener('click', () => {
            const out = $('#eraseResult');
            out.textContent = '';
            out.className = 'ed-hint';
            $('#eraseDlg').showModal();
        });

        // The dialog is the confirmation, so there is nothing left to ask.
        $('#eraseRun').addEventListener('click', guard(async () => {
            const gone = Store.wipe();
            reflectStorage();
            current = null;
            const detail = $('#cardDlg');
            if (detail.open) detail.close();
            await render();

            const out = $('#eraseResult');
            if (gone) {
                out.textContent = TT('Everything on this device was erased.');
                out.className = 'ed-hint ok';
                return;
            }
            // wipe() reports false where the browser stores nothing at all, and
            // then there was nothing on disk to erase. #storageWarn is already
            // saying why; claiming an erasure that did not happen would not be.
        }));

        const demoLink = $('#demoLink');
        if (demoLink) demoLink.addEventListener('click', (e) => {
            e.preventDefault();
            location.hash = 'demo';
            location.reload();
        });

        reflectStorage();
        reflectBackup();

        // A card's address is a real address: pasting one into a tab that is
        // already open has to open that card. Only a user navigation reaches
        // here — the app's own history.replaceState calls fire nothing — so
        // this cannot loop against the address counter mode writes.
        window.addEventListener('hashchange', guard(routeFromHash));

        window.addEventListener('resize', refitLead);
        window.addEventListener('orientationchange', refitLead);
        // Pinch-zoom moves the visual viewport without resizing the layout one,
        // so it arrives here and nowhere else.
        if (window.visualViewport) window.visualViewport.addEventListener('resize', refitLead);

        // A wake lock is dropped the moment the tab is hidden and is never
        // handed back, so a card left open while its holder answers a message
        // goes dark at the counter on the way back.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && $('#bigDlg').open) holdScreenAwake();
        });

        // Print reached any other way — Ctrl+P, the browser menu — prints the
        // page itself, so the sheet is filled only while a card is open and
        // blanked otherwise. A sheet still holding the last card would print
        // that card instead, which is the failure the sheet exists to prevent.
        window.addEventListener('beforeprint', () => {
            const rec = current && RECORDS[current.iso];
            if (rec && $('#cardDlg').open) fillPrintSheet(rec, current);
            else clearPrintSheet();
        });
        window.addEventListener('afterprint', clearPrintSheet);

        // The tabs are radios, so the browser holds and announces the selection
        // and the stylesheet draws it. Read the value out of the group; a label
        // carries no state to read.
        $('#shareTabs').addEventListener('change', (e) => {
            if (!shareState || !e.target.name) return;
            shareState.payload = e.target.value;
            renderShare();
        });

        $('#shareImage').addEventListener('click', guard(shareImage));

        $('#shareLink').addEventListener('click', function () {
            copy(shareState.link, this);
        });

        $('#shareVcf').addEventListener('click', () => {
            const { rec, card } = shareState;
            const url = URL.createObjectURL(
                new Blob([shareVcard(rec, card)], { type: 'text/vcard' }));
            const a = el('a');
            a.href = url;
            a.download = 'fiscal-' + card.iso.toLowerCase() + '.vcf';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        });

        $('#shareVcard').addEventListener('click', function () {
            copy(shareVcard(shareState.rec, shareState.card), this);
        });

        $('#shareQuote').addEventListener('click', guard(async function () {
            const { rec, card, dropped } = shareState;
            const lines = shareLines(rec, card).map((l) => l.k + ': ' + l.v);
            const status = sideNote('shareStatus', 'ed-hint', '#shareDlg .shr-warn');
            const was = this.textContent;
            this.textContent = TT('Opening Quote…');
            this.disabled = true;
            try {
                await window.FiscalShare.sendToQuote(card, lines, countryName(card.iso), rec);
                this.textContent = TT('Sent to Quote');
                setTimeout(() => { this.textContent = was; }, 2500);
            } catch (e) {
                // Never e.message: it is the bridge's own string. bad-call is a
                // programming error here and the console is where it belongs,
                // but a button that silently does nothing is the worst possible
                // rendering of a bug, so the generic sentence still shows.
                if (e.reason === 'bad-call') console.error(e);
                status.className = 'ed-hint err';
                status.append(el('div', null, quoteProblem(e.reason,
                    dropped.filter((d) => d.where === 'value').length)));
                status.hidden = false;
                this.textContent = was;
            }
            this.disabled = false;
        }));

        $('#demoExit').addEventListener('click', guard(async () => {
            DEMO = null;
            history.replaceState(null, '', location.pathname);
            $('#demoBanner').hidden = true;
            iso = detectIso();
            kind = Store.lastKind(iso) || 'personal';
            current = null;
            const dlg = $('#cardDlg');
            if (dlg.open) dlg.close();
            await render();
        }));

        $('#sharedAdd').addEventListener('click', guard(async () => {
            if (!incoming) return;
            const card = incoming;
            incoming = null;
            $('#sharedBanner').hidden = true;
            // The caveat was about the link, and the link is over: what is on
            // the wall from here is a card of the user's own.
            $('#sharedUnverified').hidden = true;
            history.replaceState(null, '', location.pathname);
            card.verifiedOn = today();
            const rec = await record(card.iso);
            const result = Store.save(card, rec);
            reflectStorage();
            DEMO = null;
            if (!result.card) return;

            const saved = Store.byId(result.card.id) || result.card;
            iso = saved.iso;
            kind = saved.kind;
            await render();
            await openCard(saved);
            // The card is on screen by now, so its own sheet is where a write
            // that did not land, or a number held back on the way in, belongs.
            writeNotes(rec, result).forEach((n) => $('#detailFields').append(n));
        }));

        $('#updateReload').addEventListener('click', () => {
            const waiting = updateReg && updateReg.waiting;
            // The one place SKIP_WAITING is ever posted, and only because the
            // holder pressed it: the bar says beside itself that reloading
            // discards whatever is being typed. A worker that has already moved
            // on leaves nothing to hand over and the reload is the whole point.
            if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
            else location.reload();
        });

        // Dismissed is dismissed. Nothing brings the bar back on a timer, and
        // the build is taken on the next load like any other.
        $('#updateDismiss').addEventListener('click', () => {
            updateDismissed = true;
            $('#updateBar').hidden = true;
        });
    }

    /* ================= demo + incoming cards ================= */

    let incoming = null;
    let incomingVerified = true;

    // #demo loads sample cards for several jurisdictions. They are held in
    // memory only, so they can never be confused with real ones or survive a
    // reload — and every number in them is fake but check-digit valid, which is
    // the only way the validation badges mean anything in a demo.
    async function loadDemo() {
        try {
            const res = await fetch('demo.json');
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            DEMO = (data.cards || []).map((c, i) => Object.assign({ id: 'demo' + i }, c));
            $('#demoBanner').hidden = false;
            return true;
        } catch (e) {
            return false;
        }
    }

    // Four codes, four sentences. A damaged link, one written by a build this
    // one has never seen and one carrying a number this app refuses are three
    // different things and three different next steps — and the refusal must
    // not read softer than the damage. A null code is ordinary text that was
    // never link-shaped, and there is nothing to say about that.
    function linkProblemCopy(code) {
        if (code === 'damaged') return TT('That link is damaged and could not be read.');
        if (code === 'outdated') return TT('That link was made by a newer version of this app. Reload this page and open it again.');
        if (code === 'refused') return TT('That link carries a number this app never stores, so it was not opened.');
        if (code === 'oversized') return TT('That link is far longer than anything this app writes, so it was not opened.');
        return '';
    }

    // lastReadError() resets at the top of every read, so it is read on the
    // line after the read it describes and nowhere else.
    let linkProblem = null;

    function readLink() {
        const data = window.FiscalShare.readShared(location.hash);
        linkProblem = data ? null : window.FiscalShare.lastReadError();
        return data;
    }

    // The sentence is rewritten on every render rather than written once: this
    // node is built in JS, and text set with textContent stays in the language
    // it was written in for as long as the page is open.
    function renderLinkProblem() {
        const banner = $('#sharedBanner');
        let node = document.getElementById('linkProblem');
        if (!linkProblem) {
            if (node) node.hidden = true;
            return;
        }
        if (!node) {
            node = el('div', 'alert err');
            node.id = 'linkProblem';
            banner.parentNode.insertBefore(node, banner);
        }
        node.textContent = linkProblemCopy(linkProblem);
        node.hidden = false;
    }

    // A card arriving in a link fragment. It is shown, never silently stored:
    // the fragment could have come from anywhere, and quietly writing a tax
    // identity into someone's wallet is not a thing this app should do.
    function takeIncoming() {
        const data = readLink();
        if (!data) return false;
        // Through the same gate every stored card goes through, before anything
        // reads it: a fragment can carry any shape at all, and a label that is
        // not a string throws in slugBase and takes the whole wall with it.
        const card = Store.sanitiseCard(data.card);
        if (!card) return false;
        incoming = card;
        // Off the wrapper, never off the card: a flag on a card is a flag a
        // renderer drops without noticing, which is the bug the wrapper exists
        // to prevent.
        incomingVerified = data.verified;
        DEMO = [incoming];
        $('#sharedBanner').hidden = false;
        $('#sharedUnverified').hidden = data.verified;
        return true;
    }

    async function boot() {
        // Wired before anything that can fail. Everything below this either has
        // a fallback or is one card that will not be there, but a page whose
        // handlers were never attached is a wall nothing on it answers to.
        wire();

        try {
            const res = await fetch('registry/index.json');
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            INDEX = data.countries || [];
            INDEX.forEach((c) => { BY_ISO[c.iso] = c; });
            $('#jurisdictionTotal').textContent = String(INDEX.length);
            // The tallies in the coverage sentence and in the picker's search
            // box are registry facts, and until this lands they are the frozen
            // fallback i18n.js ships against the day it was written.
            if (window.CarinoI18n) window.CarinoI18n.setCounts(INDEX);
        } catch (e) {
            // The rest of the boot still runs. Without the index there is no
            // picker and no tier, but a card already on this device and a card
            // arriving in a link are both still cards — every record falls back
            // to the synthetic one — and a boot that returned here left a share
            // link doing nothing at all, banner and card alike.
            loadError = true;
            $('#loadError').hidden = false;
        }

        // A shared card wins over #demo — someone following a link means to see
        // that card, not the samples.
        if (!takeIncoming() && /(^|[#&])demo\b/.test(location.hash)) await loadDemo();

        iso = detectIso();
        kind = Store.lastKind(iso) || 'personal';
        if (DEMO && DEMO.length) {
            iso = DEMO[0].iso;
            kind = DEMO[0].kind;
        }
        await render();
        // Hash first: a card address is the more specific claim on the tab, and a launch that also
        // carries one should land on the card rather than on a dialog over it.
        const routed = await routeFromHash();
        if (!routed) await routeFromLaunch();
        acceptLaunchedFiles();
    }

    // i18n re-render hook, same contract as the rest of the fleet.
    window.FISCAL = { render: render };

    // index.html hands the registration over here, on load.
    window.FiscalApp = { onServiceWorker: onServiceWorker };

    if ('serviceWorker' in navigator) {
        // Old code reading the new build's registry JSON is precisely how an
        // app that draws conclusions about identifiers comes to be confidently
        // wrong, so a page that was already controlled reloads the instant the
        // new worker takes over. Attached here rather than beside the update
        // bar: another tab can hand the page over at any moment, and this has
        // to be listening before it does.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hadController || reloading) return;
            reloading = true;
            location.reload();
        });
    }

    document.addEventListener('DOMContentLoaded', guard(boot));
})();
