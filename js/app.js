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

    const TT = (s) => (window.t ? window.t(s) : s);

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

    // Country names are localised by the platform rather than shipped in five
    // languages for 249 countries. The English name in index.json is the
    // fallback for engines without Intl.DisplayNames.
    let displayNames = null;
    let displayNamesLang = null;

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

    // Records carry labels keyed by language with an English fallback, which is
    // the same contract as the i18n dictionary.
    function label(obj, fallback) {
        if (!obj) return fallback || '';
        if (typeof obj === 'string') return obj;
        return obj[lang()] || obj.en || fallback || '';
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

    /* ================= validation display ================= */

    function badgeFor(status, ident) {
        const map = {
            ok: ['ok', TT('Check digit valid')],
            'bad-check': ['err', TT('Check digit does not match')],
            'bad-format': ['err', TT('Wrong format')],
            unchecked: ['warn', TT('Format only — no published check digit')],
            reserved: ['ok', TT('Reserved official value')],
            empty: ['warn', TT('Empty')],
        };
        const [tone, text] = map[status] || ['warn', TT('Not checked')];
        return { tone: tone, text: text, ident: ident };
    }

    /* ================= rendering ================= */

    const $ = (sel) => document.querySelector(sel);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };

    // The card whose detail popup is open. Everything downstream — counter
    // mode, share, the editor — acts on this rather than re-deriving a card
    // from the jurisdiction, which is what let a card be addressable at all.
    let current = null;

    function currentCard() { return current; }

    // A stable, readable address for a card: mx-business-carino-systems. Built
    // from what the card IS rather than from its storage id, so the same card
    // keeps the same URL across an edit, and a link stays meaningful written
    // down. Collisions get a numeric suffix in wall order.
    function slugFor(card) {
        const base = [
            card.iso.toLowerCase(),
            card.kind,
            (card.label || '')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        ].filter(Boolean).join('-');

        const same = allCards().filter((c) => slugBase(c) === slugBase(card));
        if (same.length < 2) return base;
        const i = same.findIndex((c) => c === card || c.id === card.id);
        return i > 0 ? base + '-' + (i + 1) : base;
    }

    function slugBase(card) {
        return [card.iso.toLowerCase(), card.kind, (card.label || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]
            .filter(Boolean).join('-');
    }

    function cardBySlug(slug) {
        return allCards().find((c) => slugFor(c) === slug) || null;
    }

    function cardUrl(card) {
        return location.origin + location.pathname + '#/' + slugFor(card);
    }

    function copy(text, node) {
        const done = () => {
            if (!node) return;
            const was = node.getAttribute('data-copy-label') || node.textContent;
            node.setAttribute('data-copy-label', was);
            node.textContent = TT('Copied');
            node.classList.add('copied');
            setTimeout(() => { node.textContent = was; node.classList.remove('copied'); }, 1200);
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

    function renderCard(rec, big) {
        const host = big ? $('#bigFace') : $('#detailFields');
        host.innerHTML = '';
        const card = currentCard();
        if (!card) return;

        const keys = profileKeys(rec, card.kind, card);
        let first = true;

        keys.forEach((key) => {
            const resolved = resolveField(rec, key);
            if (!resolved) return;
            const value = fieldValue(rec, resolved, card);
            if (!value && resolved.kindOf !== 'identifier') return;

            const row = el('div', 'f' + (first ? ' f--lead' : ''));
            const head = el('div', 'f-head');
            head.append(el('span', 'f-k', label(resolved.def.label, key)));

            const copyBtn = el('button', 'f-copy', TT('Copy'));
            copyBtn.addEventListener('click', () => copy(value, copyBtn));
            head.append(copyBtn);
            row.append(head);

            const v = el('div', 'f-v' + (first ? '' : ' f-v--sm'), value || '—');
            if (big && first) v.classList.add('f-v--fit');
            row.append(v);

            if (resolved.kindOf === 'identifier') {
                const result = Engines.validate(value, resolved.def);
                const b = badgeFor(result.status);
                const badge = el('div', 'f-badge ' + b.tone, b.text);
                if (result.status === 'bad-check' && result.expected) {
                    badge.textContent = b.text + ' (' + TT('expected') + ' ' + result.expected + ')';
                }
                if (result.status === 'reserved' && resolved.def.reservedNote) {
                    badge.title = label(resolved.def.reservedNote, '');
                }
                if (result.status === 'unchecked' && resolved.def.note) {
                    badge.title = label(resolved.def.note, '');
                }
                row.append(badge);

                // The whole reason this app exists: a clerk mishears a letter
                // far more often than they miss a field.
                if (value) {
                    row.append(el('div', 'f-phon', Phonetic.spell(value, lang())));
                }
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
            return TT('The official catalogue was updated on {date}, after you last confirmed this card.')
                .replace('{date}', newest);
        }

        // 2. You have not confirmed it in a year.
        if (!card.verifiedOn) return TT('Never confirmed against your own documents.');
        const age = Date.now() - Date.parse(card.verifiedOn + 'T00:00:00Z');
        if (age > YEAR_MS) {
            return TT('Last confirmed on {date}. Worth checking it still matches your records.')
                .replace('{date}', card.verifiedOn);
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

        $('#cardCount').textContent = cards.length
            ? TT('{n} cards on this device').replace('{n}', String(cards.length))
            : TT('Nothing stored yet');

        cards.slice().sort((a, b) => {
            if ((a.iso === here) !== (b.iso === here)) return a.iso === here ? -1 : 1;
            if (a.iso !== b.iso) return countryName(a.iso).localeCompare(countryName(b.iso));
            if (a.kind !== b.kind) return a.kind === 'business' ? -1 : 1;
            return (a.label || '').localeCompare(b.label || '');
        }).forEach((card) => host.append(tile(card)));

        if (!readOnly()) host.append(addTile());
        if (!cards.length) host.append(exampleTile());
    }

    function tile(card) {
        const t = el('button', 'tile ' + card.kind);
        t.setAttribute('aria-label', (card.label || '') + ' — ' + countryName(card.iso));

        const top = el('div', 't-top');
        top.append(el('span', 't-flag', (BY_ISO[card.iso] && BY_ISO[card.iso].flag) || ''));
        top.append(el('span', 't-country', countryName(card.iso)));
        const tier = BY_ISO[card.iso] ? BY_ISO[card.iso].tier : 3;
        top.append(el('span', 'pill t' + tier, 'T' + tier));
        t.append(top);

        t.append(el('div', 't-label', card.label || countryName(card.iso)));

        // The lead identifier, because that is what the card is FOR.
        const lead = leadOf(card);
        t.append(el('div', 't-id', lead || '—'));

        const foot = el('div', 't-foot');
        foot.append(el('span', 't-kind', card.kind === 'personal' ? TT('Personal') : TT('Business')));
        if (needsAttention(card)) foot.append(el('span', 't-warn', TT('check it')));
        t.append(foot);

        t.addEventListener('click', () => openCard(card));
        return t;
    }

    // Read the lead identifier straight off the card so a tile costs no record
    // fetch — the wall must paint before 249 jurisdictions are considered.
    function leadOf(card) {
        const vals = card.values || {};
        const preferred = ['rfc', 'nit', 'ein', 'cnpj', 'cpf', 'cuit', 'rut', 'ruc',
            'gstin', 'corporateNumber', 'abn', 'nif', 'vat', 'taxId', 'cedula'];
        for (const key of preferred) if (vals[key]) return vals[key];
        const first = Object.keys(vals).find((k) => vals[k] && !/mail|address|direccion|nombre|razon|legal|cp|tipo/i.test(k));
        return first ? vals[first] : '';
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
        t.append(el('div', 't-id', TT('For any of {n} jurisdictions').replace('{n}', String(INDEX.length))));
        t.addEventListener('click', () => openPicker(true));
        return t;
    }

    // On a fresh install, show what a card looks like rather than an empty grid.
    // XAXX010101000 is SAT's public "público en general" RFC: real, carries no
    // personal data, and exercises the reserved-value badge.
    function exampleTile() {
        const box = el('div', 'example-tile');
        box.append(el('div', 'example-tag', TT('Example — not your data')));
        box.append(el('div', 't-label', 'Ejemplo'));
        box.append(el('div', 'f-v f-v--sm', 'XAXX010101000'));
        const def = { key: 'rfc', checksum: { engine: 'mx-rfc' }, reserved: ['XAXX010101000'] };
        const b = badgeFor(Engines.validate('XAXX010101000', def).status);
        box.append(el('div', 'f-badge ' + b.tone, b.text));
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

        $('#detailCountry').textContent =
            ((BY_ISO[iso] && BY_ISO[iso].flag) || '') + ' ' + countryName(iso);
        $('#detailLabel').textContent = card.label || countryName(iso);

        const meta = $('#detailMeta');
        meta.innerHTML = '';
        const tier = BY_ISO[iso] ? BY_ISO[iso].tier : 3;
        meta.append(el('span', 'pill t' + tier,
            TT('Tier') + ' ' + tier + (tier === 3 ? ' · ' + TT('unverified') : '')));
        meta.append(el('span', 't-kind', card.kind === 'personal' ? TT('Personal') : TT('Business')));
        if (rec.authority) meta.append(el('span', 'jauth', rec.authority));

        renderCard(rec, false);

        $('#detailAddr').textContent = '#/' + slugFor(card);
        renderDetailActions(rec, card);

        // Reflect the open card in the URL so it can be linked, bookmarked and
        // reloaded straight back to here.
        try { history.replaceState(null, '', '#/' + slugFor(card)); } catch (e) { /* fine */ }

        onDialogClose(dlg, () => {
            current = null;
            try { history.replaceState(null, '', location.pathname + location.search); }
            catch (e) { /* history is not essential to the card working */ }
        });
        if (!dlg.open) dlg.showModal();
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
        host.append(mk('', TT('Print'), () => window.print()));
        if (!readOnly()) host.append(mk('btn-ghost', TT('Edit'), () => openEditor(card)));
    }

    function asText(rec, card) {
        const lines = [countryName(iso) + ' · ' + (card.label || '')];
        profileKeys(rec, card.kind, card).forEach((key) => {
            const resolved = resolveField(rec, key);
            if (!resolved) return;
            const value = fieldValue(rec, resolved, card);
            if (value) lines.push(label(resolved.def.label, key) + ': ' + value);
        });
        return lines.join('\n');
    }

    /* ================= counter (big) mode ================= */

    function openBig(rec) {
        renderCard(rec, true);
        $('#bigCountry').textContent = (BY_ISO[iso] ? BY_ISO[iso].flag + ' ' : '') + countryName(iso);
        const card = currentCard();
        $('#bigLabel').textContent = card ? (card.label || '') : '';
        $('#bigDlg').showModal();
        fitLead();
        holdScreenAwake();

        const speak = $('#bigSpeak');
        speak.hidden = !('speechSynthesis' in window);
        speak.onclick = () => speakLead(rec, card);

        onDialogClose($('#bigDlg'), releaseScreen);
    }

    // The screen going dark mid-transaction is the small failure that makes
    // someone put the phone away and start reading numbers off a photo instead.
    let wakeLock = null;

    function holdScreenAwake() {
        if (!navigator.wakeLock || !navigator.wakeLock.request) return;
        navigator.wakeLock.request('screen')
            .then((lock) => { wakeLock = lock; })
            .catch(() => { /* denied or unsupported: the dialog still works */ });
    }

    function releaseScreen() {
        if (!wakeLock) return;
        try { wakeLock.release(); } catch (e) { /* already gone */ }
        wakeLock = null;
    }

    // Read the identifier out loud, letter by letter, using the same phonetic
    // table the screen shows — so the clerk hears "C de Coruña", not "csy".
    // Voices are per platform; where none is installed this simply does nothing
    // visible, which is why the button is only shown when the API exists.
    function speakLead(rec, card) {
        if (!('speechSynthesis' in window) || !card) return;
        const keys = profileKeys(rec, kind, card);
        const first = keys.map((k) => resolveField(rec, k)).find((r) => r && r.kindOf === 'identifier');
        if (!first) return;
        const value = (card.values || {})[first.key];
        if (!value) return;

        window.speechSynthesis.cancel();
        const spoken = Phonetic.spell(value, lang()).replace(/ · /g, ', ');
        const u = new SpeechSynthesisUtterance(spoken);
        u.lang = lang() === 'pt-BR' ? 'pt-BR' : lang();
        u.rate = 0.85;
        window.speechSynthesis.speak(u);
    }

    // In counter mode the lead identifier must never wrap or clip: a number
    // broken across two lines is exactly the thing a clerk mistypes. Rather than
    // predicting the width from font metrics — which depends on the face that
    // actually loaded — measure the rendered line and shrink until it fits.
    // Runs after showModal() so layout is available.
    function fitLead() {
        const v = $('#bigFace .f-v--fit');
        if (!v || !v.firstChild) return;

        const avail = v.clientWidth;
        if (!avail) return;

        // Measure the text itself with a Range rather than reading scrollWidth:
        // the element clips its overflow, and a clipped element reports a
        // scrollWidth equal to its client width, so the obvious check would
        // always say "it fits" no matter how far the number ran off the edge.
        const START = 68;
        v.style.fontSize = START + 'px';

        const range = document.createRange();
        range.selectNodeContents(v);
        const drawn = range.getBoundingClientRect().width;
        if (!drawn) return;

        // 0.98 leaves a hair of room so the last glyph never touches the edge.
        const fitted = Math.floor(START * (avail * 0.98) / drawn);
        v.style.fontSize = Math.max(18, Math.min(START, fitted)) + 'px';
    }

    /* ================= share ================= */

    let shareState = null;

    function shareLines(rec, card) {
        return profileKeys(rec, kind, card).map((key) => {
            const r = resolveField(rec, key);
            if (!r) return null;
            const v = fieldValue(rec, r, card);
            return v ? { k: label(r.def.label, key), v: v, lead: r.kindOf === 'identifier' } : null;
        }).filter(Boolean);
    }

    function openShare(rec, card) {
        shareState = { rec: rec, card: card, payload: 'vcard' };
        renderShare();
        $('#shareDlg').showModal();
    }

    function renderShare() {
        const { rec, card, payload } = shareState;
        const lines = shareLines(rec, card);
        const name = countryName(iso);

        const text = payload === 'vcard'
            ? window.FiscalShare.vcard(card, rec, lines.map((l) => l.k + ': ' + l.v), name)
            : payload === 'link'
                ? window.FiscalShare.shareLink(card)
                : window.FiscalShare.carinoPayload(card);

        const host = $('#shareQr');
        host.innerHTML = '';
        const canvas = window.FiscalShare.qrCanvas(text, 260);
        if (canvas) {
            canvas.style.width = '260px';
            canvas.style.height = 'auto';
            host.append(canvas);
        } else {
            host.append(el('div', 'ed-hint err', TT('The QR encoder did not load.')));
        }

        $('#shareWhat').textContent = payload === 'vcard'
            ? TT('A vCard — any phone camera reads this and offers to save it as a contact.')
            : payload === 'link'
                ? TT('The card itself, inside a link. Scanning it opens this card on any phone — the data rides after the “#”, so no server ever sees it.')
                : TT('A Carino payload — only this app reads it, kept for exchanging a card between your own devices.');

        document.querySelectorAll('#shareTabs .shr-tab').forEach((b) => {
            b.classList.toggle('on', b.dataset.payload === payload);
        });
    }

    async function shareImage() {
        const { rec, card } = shareState;
        const lines = shareLines(rec, card);
        const vc = window.FiscalShare.vcard(card, rec, lines.map((l) => l.k + ': ' + l.v), countryName(iso));
        const canvas = window.FiscalShare.cardImage({
            heading: countryName(iso) + ' · ' + (card.label || ''),
            lines: lines,
            qrText: vc,
        });
        const blob = await window.FiscalShare.canvasToBlob(canvas);
        if (!blob) return;

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

        const rows = INDEX
            .map((c) => ({ c: c, name: countryName(c.iso) }))
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
                return a.name.localeCompare(b.name);
            })
            .slice(0, 120);

        rows.forEach((r) => {
            const b = el('button', 'prow' + (r.c.iso === iso ? ' on' : ''));
            b.append(el('span', 'p-flag', r.c.flag));
            b.append(el('span', 'p-name', r.name));
            if (owned.has(r.c.iso)) b.append(el('span', 'p-own', TT('your card')));
            b.append(el('span', 'pill t' + r.c.tier, 'T' + r.c.tier));
            b.addEventListener('click', async () => {
                iso = r.c.iso;
                kind = Store.lastKind(iso) || 'personal';
                Store.noteUse(iso, kind);
                $('#pickerDlg').close();
                // The picker is only ever reached on the way to a new card.
                if (pickerAdds) await openEditor(null);
                else await render();
            });
            list.append(b);
        });

        $('#pickerCount').textContent = TT('{n} of {total} jurisdictions')
            .replace('{n}', String(rows.length)).replace('{total}', String(INDEX.length));
    }

    /* ================= editor ================= */

    let editing = null;

    async function openEditor(card) {
        const rec = await record(iso);
        editing = card ? JSON.parse(JSON.stringify(card)) : { iso: iso, kind: kind, label: '', values: {} };

        $('#editTitle').textContent = card
            ? TT('Edit card') : TT('New card') + ' · ' + countryName(iso);

        buildForm(rec, !!card);

        const dlg = $('#editDlg');
        if (!dlg.open) dlg.showModal();
    }

    // Split out so switching Personal/Business rebuilds the fields in place.
    // Rebuilding by re-opening the dialog would both lose what has been typed
    // and throw, because showModal() on an already-open dialog is an error.
    let isExistingCard = false;

    function buildForm(rec, isExisting) {
        isExistingCard = !!isExisting;
        const form = $('#editForm');
        form.innerHTML = '';

        // Import first: the fastest way to fill this form is not to type in it.
        form.append(importRow(rec));

        // Card name + kind.
        form.append(textRow(TT('Card name'), editing.label || '',
            (v) => { editing.label = v; },
            kind === 'business' ? TT('e.g. Carino Systems') : TT('e.g. Personal')));

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
        form.append(kindRow);

        // Everything the profile asks for, in order.
        const keys = (rec.invoiceProfile[editing.kind] || rec.invoiceProfile.personal);
        const all = (keys.required || []).concat(keys.optional || []);

        all.forEach((key) => {
            const resolved = resolveField(rec, key);
            if (!resolved) return;
            const req = (keys.required || []).indexOf(key) !== -1;
            const name = label(resolved.def.label, key) + (req ? '' : ' · ' + TT('optional'));

            if (resolved.kindOf === 'catalogue') {
                form.append(catalogueRow(name, resolved, editing));
            } else {
                form.append(textRow(name, editing.values[key] || '',
                    (v) => { editing.values[key] = v; },
                    resolved.def.display || '',
                    resolved.kindOf === 'identifier' ? resolved.def : null,
                    resolved.def.multiline));
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
            form.append(qrRow(rec, editing));
        }

        $('#editDelete').hidden = !isExisting;
    }

    // Read the authority's own document instead of retyping it. Both the
    // Mexican Constancia and the Colombian RUT are generated PDFs with a real
    // text layer, so this is exact extraction rather than OCR — and every value
    // still has to pass the registry's format check before it is offered.
    function importRow(rec) {
        const row = el('div', 'ed-import');
        row.append(el('div', 'ed-k', TT('Fill it from a document')));

        const hint = el('div', 'ed-note', window.FiscalImport.supported(rec.iso)
            ? TT('Drop in the PDF the tax authority issued, or paste the text of one.')
            : TT('Paste any text holding your tax number — an email signature works.'));
        row.append(hint);

        const status = el('div', 'ed-hint');

        const apply = (result) => {
            if (!result) {
                status.textContent = TT('Nothing recognisable found. Fill the fields below instead.');
                status.className = 'ed-hint warn';
                return;
            }
            Object.keys(result.values).forEach((k) => { editing.values[k] = result.values[k]; });
            if (result.kind) editing.kind = result.kind;
            editing.verifiedOn = today();

            // Name the card after whoever the document says it belongs to. The
            // label is the tile's headline and part of the card's URL, so
            // leaving it blank would give an imported card the address
            // "#/mx-business" and the title "Mexico".
            if (!editing.label) {
                const v = editing.values;
                const name = v.razonSocial || v.legalName || v.nombre || '';
                if (name) editing.label = name.length > 40 ? name.slice(0, 40).trim() : name;
            }
            status.textContent = TT('Read {n} fields from the document.')
                .replace('{n}', String(Object.keys(result.values).length));
            status.className = 'ed-hint ok';
            buildForm(rec, isExistingCard);
            // buildForm rebuilt the DOM, so put the message back on the new one.
            const fresh = $('#editForm .ed-import .ed-hint');
            if (fresh) { fresh.textContent = status.textContent; fresh.className = status.className; }
        };

        const file = el('input', 'input');
        file.type = 'file';
        file.accept = 'application/pdf,.pdf,text/plain';
        file.addEventListener('change', async () => {
            const f = file.files && file.files[0];
            if (!f) return;
            status.textContent = TT('Reading…');
            status.className = 'ed-hint';
            try {
                const result = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name)
                    ? await window.FiscalImport.fromFile(f, rec)
                    : window.FiscalImport.fromText(await f.text(), rec);
                apply(result);
            } catch (e) {
                status.textContent = TT('That file could not be read.');
                status.className = 'ed-hint err';
            }
        });
        row.append(file);

        const paste = el('textarea', 'textarea');
        paste.placeholder = TT('…or paste text here');
        paste.rows = 2;
        paste.addEventListener('input', () => {
            if (paste.value.trim().length < 8) return;
            apply(window.FiscalImport.fromText(paste.value, rec));
        });
        row.append(paste, status);
        return row;
    }

    function today() {
        return new Date().toISOString().slice(0, 10);
    }

    function textRow(name, value, onInput, placeholder, identDef, multiline) {
        const row = el('div', 'ed-row');
        row.append(el('label', 'ed-k', name));
        const input = el(multiline ? 'textarea' : 'input', multiline ? 'textarea' : 'input');
        input.value = value;
        if (placeholder) input.placeholder = placeholder;
        const hint = el('div', 'ed-hint');
        row.append(input, hint);

        const check = () => {
            if (!identDef) return;
            if (!input.value.trim()) { hint.textContent = ''; hint.className = 'ed-hint'; return; }
            const r = Engines.validate(input.value, identDef);
            const b = badgeFor(r.status);
            hint.textContent = b.text + (r.status === 'bad-check' && r.expected
                ? ' (' + TT('expected') + ' ' + r.expected + ')' : '');
            hint.className = 'ed-hint ' + b.tone;
        };

        input.addEventListener('input', () => { onInput(input.value); check(); });
        check();
        return row;
    }

    function catalogueRow(name, resolved, card) {
        const row = el('div', 'ed-row');
        row.append(el('label', 'ed-k', name));
        const sel = el('select', 'select');
        sel.append(el('option', null, '—'));

        (resolved.def.options || [])
            .filter((o) => !o.applies || o.applies.indexOf(card.kind) !== -1)
            .forEach((o) => {
                const opt = el('option', null, o.code + ' — ' + o.label);
                opt.value = o.code;
                if (card.values[resolved.key] === o.code) opt.selected = true;
                sel.append(opt);
            });

        sel.addEventListener('change', () => { card.values[resolved.key] = sel.value; });
        row.append(sel);

        if (resolved.def.staleness) {
            row.append(el('div', 'ed-hint', TT('Catalogue verified') + ' ' + resolved.def.verified));
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

    /* ================= main render ================= */

    async function render() {
        if (loadError) return;
        renderWall();
        // A language switch while a card is open should redraw that card too.
        if (current && $('#cardDlg').open) {
            const rec = await record(current.iso);
            renderCard(rec, false);
            renderDetailActions(rec, current);
        }
        document.documentElement.lang = lang();
    }

    /* ================= URL routing =================
       #/<slug>        a specific card on this device
       #card=<data>    a card carried in from a shared link
       #demo           the samples
       Everything is a fragment, so none of it reaches a server. */

    async function routeFromHash() {
        const m = /^#\/([a-z0-9-]+)$/i.exec(location.hash || '');
        if (!m) return false;
        const card = cardBySlug(m[1]);
        if (!card) return false;
        await openCard(card);
        return true;
    }

    /* ================= wiring ================= */

    function wire() {
        $('#pickerSearch').addEventListener('input', (e) => renderPickerList(e.target.value));

        document.querySelectorAll('[data-close]').forEach((b) => {
            b.addEventListener('click', () => b.closest('dialog').close());
        });

        $('#addCard').addEventListener('click', () => openPicker(true));

        $('#editSave').addEventListener('click', async () => {
            if (!editing) return;
            editing.iso = iso;
            // Saving is you confirming the card is right today; that date is what
            // the staleness nudge measures against.
            editing.verifiedOn = today();
            const result = Store.save(editing);
            if (!result.durable) {
                $('#storageWarn').hidden = false;
            }
            kind = editing.kind;
            Store.noteUse(iso, kind);
            const saved = result.card;
            editing = null;
            $('#editDlg').close();
            await render();
            await openCard(Store.byId(saved.id) || saved);
        });

        $('#editDelete').addEventListener('click', async () => {
            if (editing && editing.id) Store.remove(editing.id);
            editing = null;
            current = null;
            $('#editDlg').close();
            const detail = $('#cardDlg');
            if (detail.open) detail.close();
            await render();
        });

        $('#detailAddrCopy').addEventListener('click', function () {
            if (current) copy(cardUrl(current), this);
        });

        $('#exportBtn').addEventListener('click', function () {
            copy(Store.exportAll(), this);
        });

        const demoLink = $('#demoLink');
        if (demoLink) demoLink.addEventListener('click', (e) => {
            e.preventDefault();
            location.hash = 'demo';
            location.reload();
        });

        if (!Store.storageAvailable()) $('#storageWarn').hidden = false;

        document.querySelectorAll('#shareTabs .shr-tab').forEach((b) => {
            b.addEventListener('click', () => {
                shareState.payload = b.dataset.payload;
                renderShare();
            });
        });

        $('#shareImage').addEventListener('click', shareImage);

        $('#shareLink').addEventListener('click', function () {
            copy(window.FiscalShare.shareLink(shareState.card), this);
        });

        $('#shareQuote').addEventListener('click', async function () {
            const { rec, card } = shareState;
            const lines = shareLines(rec, card).map((l) => l.k + ': ' + l.v);
            const was = this.textContent;
            this.textContent = TT('Opening Quote…');
            try {
                await window.FiscalShare.sendToQuote(card, rec, lines, countryName(iso));
                this.textContent = TT('Sent to Quote');
            } catch (e) {
                this.textContent = TT('Quote did not answer');
            }
            setTimeout(() => { this.textContent = was; }, 2500);
        });

        $('#demoExit').addEventListener('click', () => {
            DEMO = null;
            history.replaceState(null, '', location.pathname);
            $('#demoBanner').hidden = true;
            iso = detectIso();
            kind = Store.lastKind(iso) || 'personal';
            current = null;
            const dlg = $('#cardDlg');
            if (dlg.open) dlg.close();
            render();
        });

        $('#sharedAdd').addEventListener('click', async () => {
            if (!incoming) return;
            const card = incoming;
            incoming = null;
            $('#sharedBanner').hidden = true;
            history.replaceState(null, '', location.pathname);
            card.verifiedOn = today();
            const saved = Store.save(card).card;
            DEMO = null;
            iso = card.iso;
            kind = card.kind || 'personal';
            await render();
            await openCard(Store.byId(saved.id) || saved);
        });
    }

    /* ================= demo + incoming cards ================= */

    let incoming = null;

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

    // A card arriving in a link fragment. It is shown, never silently stored:
    // the fragment could have come from anywhere, and quietly writing a tax
    // identity into someone's wallet is not a thing this app should do.
    function takeIncoming() {
        const data = window.FiscalShare.readShared(location.hash);
        if (!data) return false;
        incoming = { iso: data.iso, kind: data.kind || 'personal', label: data.label || '', values: data.values || {} };
        DEMO = [incoming];
        $('#sharedBanner').hidden = false;
        return true;
    }

    async function boot() {
        try {
            const res = await fetch('registry/index.json');
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            INDEX = data.countries || [];
            INDEX.forEach((c) => { BY_ISO[c.iso] = c; });
        } catch (e) {
            loadError = true;
            $('#loadError').hidden = false;
            return;
        }

        $('#jurisdictionTotal').textContent = String(INDEX.length);

        // A shared card wins over #demo — someone following a link means to see
        // that card, not the samples.
        if (!takeIncoming() && /(^|[#&])demo\b/.test(location.hash)) await loadDemo();

        iso = detectIso();
        kind = Store.lastKind(iso) || 'personal';
        if (DEMO && DEMO.length) {
            iso = DEMO[0].iso;
            kind = DEMO[0].kind;
        }
        wire();
        await render();
        await routeFromHash();
    }

    // i18n re-render hook, same contract as the rest of the fleet.
    window.FISCAL = { render: render };

    document.addEventListener('DOMContentLoaded', boot);
})();
