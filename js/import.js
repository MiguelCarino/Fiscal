// Carino Fiscal — getting data in without typing it.
//
// Typing an RFC into a phone is the friction this whole app exists to remove,
// so the fastest path is to read the authority's OWN document. Both of the
// documents that matter here are generated PDFs with a real text layer, not
// scans, so this is a text extraction rather than OCR — which also means it is
// exact.
//
// Nothing in this file writes anything. A document is read into a list of
// CANDIDATES — each one carrying the value, the label it was found next to, how
// it was found and what the registry's own engine makes of it — and the person
// holding the card decides which of them are theirs. That is the whole design:
// a tax ID that is confidently wrong is worse than a field left empty, and the
// only reliable way to tell the user's RFC from the example RFC printed in the
// document header is to show them both and ask.
//
// So the shape of the API is: fromFile/fromText return a REVIEW, the pane
// renders review.candidates as a tick-list and sets `accepted` on each, and
// accept(review) returns the values that survived. Reading a document is never
// filling a form, and there is no call here that skips the pane. accept()
// re-checks `blocked` itself rather than trusting the pane's ticks, and it
// returns verified:false always — an import is the moment before a holder
// checks their card against their papers, not after it.
//
// Three rules do most of the work. A value is attributed to an identifier only
// when it sits next to a label the registry says that identifier is printed
// under — guessing by shape alone is how a phone number becomes a NIT and a
// date becomes a DNI. A number whose written grouping the record refuses is
// struck out of the text before anything else looks at it, because an SSN and
// an EIN are the same nine digits once the hyphens are gone: the punctuation is
// the entire signal, and it only exists before the separators are closed up.
// And the grouping cuts the other way too — the record's own `display` mask is
// the authority saying how it prints the number, so a run that fills exactly one
// mask on the record has been told apart by the document's typography. That is
// what lets a 2-7 EIN through the same gate that stops a 3-2-4 SSN, and what
// stops an ITIN being mistaken for the SSN it is deliberately shaped against.
//
// pdf.js is vendored (no CDN, no network) and loaded on demand — it is 1.5 MB
// and most sessions never import a document. The file itself never leaves the
// browser: it is read with FileReader semantics into an ArrayBuffer, parsed by
// a worker on the same origin, and nothing here stores it.

(function () {
    'use strict';

    let pdfjsLib = null;

    async function loadPdfJs() {
        if (pdfjsLib) return pdfjsLib;
        const mod = await import('../vendor/pdfjs/pdf.min.mjs');
        mod.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs';
        pdfjsLib = mod;
        return mod;
    }

    // The ways a document fails are each a different thing for the user to do:
    // type a password, re-export with a text layer, save the original rather
    // than a photo of it, ask the authority for the file again. "That file could
    // not be read" tells them none of it, so the cause travels back as a code the
    // UI can phrase, and the codes are kept apart even where the remedy looks
    // similar — an encrypted PDF and a scanned one are both "no text here" to the
    // parser and nothing alike to the person holding the phone. The full set,
    // reported as `problem` on the review:
    //
    //   null         nothing went wrong
    //   encrypted    the PDF wants a password
    //   corrupt      the PDF's structure is damaged
    //   not-pdf      named .pdf, but the bytes are not a PDF
    //   no-text      a valid PDF with no text layer: a scan or a photograph
    //   partial      some pages read, a later one failed; candidates may be short
    //   not-text     neither a PDF nor a text file
    //   empty-file   nothing in it at all
    //   no-parser    the vendored pdf.js would not load; the install is incomplete
    //   unreadable   the file went away, or a cause nothing above names
    //
    // `partial` is the only one that leaves candidates worth showing; every other
    // non-null code comes back with none.
    function problemFor(err) {
        const name = err && err.name;
        if (name === 'PasswordException') return 'encrypted';
        if (name === 'InvalidPDFException' || name === 'FormatError') return 'corrupt';
        if (name === 'MissingPDFException') return 'empty-file';
        return 'unreadable';
    }

    // Flatten a PDF to one whitespace-normalised string. Layout is irrelevant
    // here: we are looking for labelled values, and the labels travel with the
    // values whatever order the text items come out in.
    async function readPdf(file) {
        let buf;
        try { buf = await file.arrayBuffer(); }
        catch (e) { return { text: '', problem: 'unreadable' }; }
        if (!buf.byteLength) return { text: '', problem: 'empty-file' };

        // A PDF says so in its first bytes. Checking before pdf.js does
        // separates "you picked a photo" from "this document is damaged", which
        // are different mistakes with different fixes.
        const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024));
        let ascii = '';
        for (let i = 0; i < head.length; i++) ascii += String.fromCharCode(head[i]);
        if (ascii.indexOf('%PDF-') === -1) return { text: '', problem: 'not-pdf' };

        let lib;
        try { lib = await loadPdfJs(); }
        catch (e) {
            // The parser is vendored and served from this origin, so failing to
            // load it says the install is incomplete — a stale service worker,
            // a partial offline copy — and nothing at all about the file. The
            // remedy is to go back online once, not to re-export the document.
            return { text: '', problem: 'no-parser' };
        }
        let doc;
        try {
            doc = await lib.getDocument({ data: buf }).promise;
        } catch (e) {
            return { text: '', problem: problemFor(e) };
        }

        const pages = [];
        let problem = null;
        try {
            for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i);
                const content = await page.getTextContent();
                pages.push(content.items.map((it) => it.str).join(' '));
            }
        } catch (e) {
            // Whatever was read before the damage is still worth offering — but
            // the user has to be told a page is missing, because the value they
            // came for may have been on it.
            problem = pages.length ? 'partial' : problemFor(e);
        }
        try { doc.destroy(); } catch (e) { /* nothing to do */ }

        const text = pages.join(' \n ').replace(/\s+/g, ' ').trim();
        // A photographed or scanner-printed Constancia parses perfectly and
        // contains no text at all. That is the single most likely thing a user
        // drops in, and it is not a parse failure.
        if (!text) return { text: '', problem: problem || 'no-text' };
        return { text: text, problem: problem };
    }

    /* ---------------------------------------------------------------- *
     * Text primitives. Everything downstream indexes into ONE string,   *
     * so every transform here either preserves length exactly or runs   *
     * before any offset is taken.                                       *
     * ---------------------------------------------------------------- */

    const SPAN = 64;        // how far past a label its value can still be
    const REFUSED_SPAN = 48;   // and how far a refused label's reach extends

    function squash(text) {
        return String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    }

    // Accent-folded and upper-cased, character for character, so an offset found
    // in the folded copy indexes the original. A fold that changes width — ß to
    // SS — would break that, so it is discarded rather than applied.
    function fold(s) {
        let out = '';
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            const d = ch.normalize('NFD');
            const base = d.length > 1 ? d[0] : ch;
            const up = base.toUpperCase();
            out += up.length === 1 ? up : ch;
        }
        return out;
    }

    // The same normalisation the engines apply before validating, so a value
    // printed 900.123.456-1 is tested as the registry's format expects it.
    function canonical(v) {
        return String(v || '').toUpperCase().replace(/[\s./-]/g, '');
    }

    const RE_CACHE = new Map();
    function re(pattern, flags) {
        const key = flags + ' ' + pattern;
        let rx = RE_CACHE.get(key);
        if (!rx) { rx = new RegExp(pattern, flags); RE_CACHE.set(key, rx); }
        return rx;
    }

    function escapeRe(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // A record's `display` is the authority's own statement of how it prints the
    // number: "##-#######" for an EIN, "9##-##-####" for an ITIN. Read as a
    // pattern rather than as decoration it is a discriminator, and where two
    // identifiers share a numeric space it is the only one there is. A run counts
    // as a grouping only when nothing alphanumeric and no further separator
    // touches it, so a fragment of a longer number never passes for a whole one.
    //
    // What the display states is where the breaks fall, not which glyph makes
    // them: us.json's own refusal says a number in the SSA's 3-2-4 grouping is
    // refused "however it is punctuated", and the rule it is weighed against
    // accepts every separator in the same breath. So a separator in the mask is
    // any separator, and only the ones canonical() closes up — anything else
    // survives into the value and fails the record's own format.
    const MASK_SEP = /[\s./-]/;

    function maskBody(display) {
        if (!display) return null;
        let body = '';
        let holes = 0;
        for (let i = 0; i < display.length; i++) {
            const ch = display[i];
            if (ch === '#') { body += '[0-9]'; holes++; }
            else if (MASK_SEP.test(ch)) body += MASK_SEP.source;
            else body += escapeRe(ch);
        }
        return holes ? body : null;
    }

    function maskScan(display) {
        const body = maskBody(display);
        return body ? new RegExp('(?<![0-9A-Za-z./-])(?:' + body + ')(?![0-9A-Za-z./-])', 'g') : null;
    }

    function maskExact(display) {
        const body = maskBody(display);
        return body ? re('^(?:' + body + ')$', '') : null;
    }

    // Which identifier a run written this way can only be. Two identifiers that
    // print alike and accept the same digits say nothing about each other, so
    // they say nothing here either and the run falls back on its label.
    function maskClaim(rec, seen) {
        const canon = canonical(seen);
        let claim = null;
        const idents = rec.identifiers || [];
        for (let i = 0; i < idents.length; i++) {
            const ident = idents[i];
            const rx = maskExact(ident.display);
            if (!rx || !rx.test(seen)) continue;
            if (ident.format && !re(ident.format, 'i').test(canon)) continue;
            if (claim) return null;
            claim = ident;
        }
        return claim;
    }

    // The same question asked of the run as the document printed it and of the
    // run with its spaces closed up. pdf.js breaks a number across text items
    // and a typist writes an EIN "12 - 3456789"; the grouping is there either
    // with that whitespace still in it or without.
    function groupClaim(rec, seen) {
        const tight = seen.replace(/\s+/g, '');
        return maskClaim(rec, seen) || (tight === seen ? null : maskClaim(rec, tight));
    }

    // Anchored behind an alphanumeric because an unanchored trailing run is
    // retried from every position in the token, which is quadratic: a pasted
    // base64 blob or a rule of dashes is a single token tens of thousands of
    // characters long, and trimming its tail then costs seconds.
    const TRAILING = /(?<=[0-9A-Za-z\u00C0-\uFFFF])[^0-9A-Za-z\u00C0-\uFFFF]+$/;

    // Split a slice into the runs a value could occupy, stripping the
    // punctuation a document wraps them in — "(NIT)", "1120." — while leaving
    // the separators inside a value alone, because those are what tell an EIN
    // from an SSN.
    function tokens(text, at, to) {
        const out = [];
        const slice = text.slice(at, to);
        const rx = /\S+/g;
        let m;
        while ((m = rx.exec(slice)) !== null) {
            const lead = /^[^0-9A-Za-z\u00C0-\uFFFF]*/.exec(m[0])[0].length;
            const trimmed = m[0].slice(lead).replace(TRAILING, '');
            if (trimmed) out.push({ text: trimmed, at: at + m.index + lead });
        }
        return out;
    }

    /* ---------------------------------------------------------------- *
     * Vocabulary. The registry already names every identifier the way   *
     * the authority prints it, in each language it publishes it in —    *
     * that is the vocabulary a document is labelled with, so it is what *
     * we look for. No country is written into this file.                *
     * ---------------------------------------------------------------- */

    function termsFrom(source) {
        const raw = [];
        if (typeof source === 'string') raw.push(source);
        else if (source) Object.keys(source).forEach((k) => {
            if (typeof source[k] === 'string') raw.push(source[k]);
        });

        const out = [];
        raw.forEach((s) => {
            // "登録番号 (invoice registration number)" and "CUIT / CUIL" each
            // name two things a document might actually print.
            s.split(/[/(),]/).forEach((part) => {
                const t = fold(part).replace(/\s+/g, ' ').trim().replace(/[.:\s]+$/, '');
                if (t.length >= 2) out.push(t);
            });
        });
        return out;
    }

    // A key is a label of last resort: `corporateNumber` is printed "Corporate
    // Number" and `razonSocial` "Razón social" on documents whose record has
    // not been given the phrase yet.
    function termsFromKey(key) {
        const t = fold(String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
        return t.length >= 2 ? [t] : [];
    }

    // Labels every document carries that name nothing we want. They earn their
    // place by bounding the value before them: without "Teléfono" in the list,
    // a razón social runs on into the phone number.
    const COMMON_STOPS = [
        'TELEFONO', 'TELEFONE', 'TELEPHONE', 'PHONE', 'CELULAR', 'MOVIL',
        'FECHA', 'DATE', 'PAGINA', 'PAGE', 'CIUDAD', 'MUNICIPIO', 'DEPARTAMENTO',
        'ESTADO', 'PAIS', 'COUNTRY', 'CODIGO', 'ACTIVIDAD ECONOMICA', 'ACTIVIDADES ECONOMICAS',
    ];

    // Not every document uses the authority's abbreviation. A letter from the
    // IRS says "Employer Identification Number", an invoice says "VAT number",
    // a Spanish form says "identificación fiscal" — phrasings that name A tax
    // identifier without saying WHICH, in a vocabulary that belongs to no one
    // country. So a value found under one of these is attributed by what the
    // record says it can be rather than by what the label called it, and only
    // when exactly one identifier can hold it. The phrases are here rather than
    // in the registry because they are the words used when the record's own
    // words are not; a record that names its identifier a second way says so in
    // `aliases`, and that is the stronger evidence and takes precedence.
    const GENERIC_LABELS = [
        'TAX ID', 'TAX IDENTIFICATION', 'TAX IDENTIFICATION NUMBER', 'TAX NUMBER',
        'TAXPAYER ID', 'TAXPAYER IDENTIFICATION NUMBER', 'TAX REGISTRATION NUMBER',
        'FEDERAL TAX ID', 'FEDERAL TAX IDENTIFICATION NUMBER',
        'EMPLOYER IDENTIFICATION NUMBER', 'EMPLOYER IDENTIFICATION', 'EMPLOYER ID', 'FEIN',
        'IDENTIFICATION NUMBER', 'VAT NUMBER', 'VAT REGISTRATION NUMBER',
        'IDENTIFICACION FISCAL', 'NUMERO DE IDENTIFICACION FISCAL', 'REGISTRO FISCAL',
        'IDENTIFICACAO FISCAL', 'NUMERO DE IDENTIFICACAO FISCAL',
        'IDENTIFIANT FISCAL', 'NUMERO D IDENTIFICATION FISCALE',
    ];

    function vocabulary(rec, reader) {
        const groups = [];
        const push = (key, slot, terms) => {
            const seen = {};
            const list = terms.filter((t) => (seen[t] ? false : (seen[t] = true)));
            if (list.length) groups.push({ key: key, slot: slot, terms: list });
        };

        (rec.identifiers || []).forEach((ident) => {
            push(ident.key, 'identifier',
                termsFrom(ident.aliases || null).concat(termsFrom(ident.label), termsFromKey(ident.key)));
        });
        Object.keys(rec.fields || {}).forEach((key) => {
            push(key, 'field', termsFrom(rec.fields[key].label).concat(termsFromKey(key)));
        });
        Object.keys(rec.catalogues || {}).forEach((key) => {
            push(key, 'catalogue', termsFrom(rec.catalogues[key].label).concat(termsFromKey(key)));
        });
        (rec.refused || []).forEach((r) => {
            push(r.key, 'refused',
                termsFrom(r.aliases || null).concat(termsFrom(r.label), termsFromKey(r.key)));
        });
        if (reader) (reader.boxes || []).forEach((b) => push(b.key, 'box', b.terms));
        if ((rec.identifiers || []).length) push(null, 'generic', GENERIC_LABELS);
        push(null, 'stop', COMMON_STOPS);
        return groups;
    }

    // Every label the record knows about, in one list sorted by position. A
    // value belongs to the label before it and ends where the next label begins
    // — the only boundary left once a PDF's whitespace has been flattened. The
    // longest term wins its span, so "Nombre Comercial" is one label rather than
    // "Nombre" followed by prose.
    function labelIndex(folded, groups) {
        const terms = [];
        groups.forEach((g) => g.terms.forEach((t) => terms.push({ term: t, group: g })));
        terms.sort((a, b) => b.term.length - a.term.length);

        const taken = new Array(folded.length).fill(false);
        const spans = {};
        const hits = [];
        terms.forEach((entry) => {
            const rx = new RegExp('(?<![0-9A-Z])' + escapeRe(entry.term) + '(?![0-9A-Z])', 'g');
            let m;
            while ((m = rx.exec(folded)) !== null) {
                const at = m.index;
                const end = at + m[0].length;
                let free = true;
                for (let i = at; i < end; i++) if (taken[i]) { free = false; break; }
                // Two identifiers can be printed under one caption: Japan's
                // 登録番号 is a corporation's number and a sole trader's alike,
                // and which one it is follows from the value rather than from
                // whichever definition reached the caption first. So an exactly
                // repeated span is a hit for both; anything else is the longer
                // label already having claimed it.
                if (!free && !spans[at + ':' + end]) continue;
                for (let i = at; i < end; i++) taken[i] = true;
                spans[at + ':' + end] = true;
                hits.push({ at: at, end: end, key: entry.group.key, slot: entry.group.slot });
            }
        });
        hits.sort((a, b) => a.at - b.at || a.end - b.end);
        return hits;
    }

    // The next label that starts after this one ends. Two labels sharing a span
    // are the same caption read twice, and treating the second as the boundary
    // of the first would leave the first with no window at all.
    function nextHit(hits, i, fallback) {
        for (let j = i + 1; j < hits.length; j++) {
            if (hits[j].at >= hits[i].end) return hits[j].at;
        }
        return fallback;
    }

    function windowAfter(text, hits, i) {
        const next = nextHit(hits, i, text.length);
        return { at: hits[i].end, to: Math.min(next, hits[i].end + SPAN) };
    }

    /* ---------------------------------------------------------------- *
     * Refusals. The record says which shapes this app declines to hold  *
     * and what they are called; both come from the registry, so adding  *
     * a country's refusal is a JSON change and not a change here.       *
     * ---------------------------------------------------------------- */

    function redact(text, rec, hits) {
        const counts = {};
        // Rebuilding the whole document around each struck run is quadratic in
        // the number of runs, and a page of them is a paste box that stops
        // answering. The characters are blanked in place and a string re-formed
        // only where the next pass needs one to read.
        const holes = new Uint8Array(text.length + 1);
        let chars = null;
        let out = text;
        let stale = false;
        const current = () => {
            if (stale) { out = chars.join(''); stale = false; }
            return out;
        };
        const blank = (at, to) => {
            if (to <= at) return;
            if (!chars) chars = out.split('');
            for (let i = at; i < to; i++) chars[i] = ' ';
            holes[at] = 1;
            stale = true;
        };

        // Whether the document NAMED the thing, as against merely printing a
        // run in its grouping. Both are struck — the grouping is the whole
        // signal and it is closed either way — but they are not the same
        // statement to make: 3-2-4 is how an SSN is written and also how an
        // order number is, and 4-4-4 is a My Number and a Japanese invoice
        // number alike. Where nothing on the page said the word, the count is
        // reported without the claim about what was found.
        const named = {};
        hits.forEach((h) => { if (h.slot === 'refused') named[h.key] = true; });

        // Struck out before anything closes a separator up: after that pass an
        // SSN and an EIN are the same nine digits and no rule can separate them.
        (rec.identifiers || []).forEach((ident) => {
            (ident.refuses || []).forEach((rule) => {
                const body = String(rule.pattern).replace(/^\^/, '').replace(/\$$/, '');
                let rx;
                try { rx = new RegExp('(?<![0-9A-Za-z])(?:' + body + ')(?![0-9A-Za-z])', 'gi'); }
                catch (e) { return; }
                // One reading of the document per rule. A run this rule blanks
                // can never uncover another of its own — every match ends on an
                // alphanumeric and the next would have to begin on one — so the
                // only pass that has to see these blanks is the next rule's.
                const scan = current();
                let m;
                while ((m = rx.exec(scan)) !== null) {
                    rx.lastIndex = m.index + m[0].length;
                    // Unless the record itself prints an identifier in exactly
                    // that grouping. An ITIN is published 9##-##-#### — the same
                    // 3-2-4 an SSN is written in — and it is safe to say which is
                    // which only because the IRS never issues an SSN beginning
                    // with a 9, which is a fact the ITIN's own format states.
                    if (maskClaim(rec, m[0])) continue;
                    counts[rule.key] = (counts[rule.key] || 0) + 1;
                    blank(m.index, m.index + m[0].length);
                }
            });
        });

        // And whatever is printed under a refused label, however it is grouped.
        // A number written out under "Social Security Number" is an SSN even
        // when it is typed as nine bare digits. Only the numbers go: the words
        // around them are what tells the next number whose it is.
        //
        // Every window this pass reads is one no earlier strike reaches into —
        // the hole check below skips the rest — and the labels partition the
        // text between them, so one reading serves the whole pass.
        const scan = current();
        hits.forEach((h, i) => {
            if (h.slot !== 'refused') return;
            const next = nextHit(hits, i, scan.length);
            const to = Math.min(next, h.end + REFUSED_SPAN);
            // A hole inside the label's reach IS its value: the shape pass has
            // already struck it, and blanks are invisible to a scan that skips
            // whitespace. Stepping over one reaches the next number in the
            // sentence instead and destroys it, and counts a second refusal
            // that never happened. The label has had its value; stop.
            for (let p = h.end; p < to; p++) if (holes[p]) return;
            const ts = tokens(scan, h.end, to);
            // A label introduces ONE value. "My SSN is 078-05-1120" puts two
            // words between the two, so a few are stepped over; but once the
            // digits start, the first word without any ends them, and what
            // follows is prose whose own numbers belong to something else.
            let from = -1;
            let last = -1;
            for (let t = 0; t < ts.length; t++) {
                const digits = /[0-9]/.test(ts[t].text);
                if (!digits) {
                    if (from >= 0 || t >= 3) break;
                    continue;
                }
                if (from < 0) from = t;
                last = t;
            }
            if (from < 0) return;
            // And a run set out in one of the record's own printed groupings is
            // that identifier whatever caption it followed: an EIN is written
            // 2-7 and an SSN 3-2-4, so "SSN not provided, use 12-3456789" is a
            // sentence about the EIN. The grouping is the same evidence the
            // shape pass defers to, and deferring to it here is what keeps
            // closing the SSN from costing the user the one number they came to
            // import. The run is asked as a whole first, because a document
            // that prints "912 70 1234" has set out the ITIN's own grouping as
            // surely as one that hyphenates it, and reading the tokens one at a
            // time sees three short numbers instead.
            const at = ts[from].at;
            const end = ts[last].at + ts[last].text.length;
            if (groupClaim(rec, scan.slice(at, end))) return;
            // Failing that, token by token, because the run may open with a
            // value the record's own grouping claims — "SSN not provided, use
            // 12-3456789" — and once one of those has answered the label, the
            // label has had its value.
            let struck = false;
            for (let t = from; t <= last; t++) {
                if (maskClaim(rec, ts[t].text)) break;
                // One number was on the paper, however many pieces it was set
                // in, and the count is what the pane tells the user was left
                // out. Counting the tokens of "912 70 1234" claims three.
                if (!struck) counts[h.key] = (counts[h.key] || 0) + 1;
                struck = true;
                blank(ts[t].at, ts[t].at + ts[t].text.length);
            }
        });

        const refusals = (rec.refused || [])
            .filter((r) => counts[r.key])
            .map((r) => ({
                key: r.key, label: r.label, reason: r.reason,
                count: counts[r.key], named: !!named[r.key],
            }));
        // current(), not `out`: everything the labelled pass struck is still
        // sitting in `chars`, and handing back the cached string would give the
        // scanners a document with the refused numbers in it. A bare nine-digit
        // SSN is struck by that pass alone.
        return { text: current(), refusals: refusals };
    }

    /* ---------------------------------------------------------------- *
     * Candidates.                                                       *
     * ---------------------------------------------------------------- */

    // Statuses a value may be offered under. Everything else — a failed check
    // digit, a refused shape, a number the authority could never have issued,
    // the administrative constant that is nobody's RFC — is read, reported and
    // withheld, because the alternative is a card that looks checked and is not.
    const OFFERABLE = { ok: true, unchecked: true, unimplemented: true };

    // Documents say whose number it is right next to the number: "CPF do
    // responsável", "DNI del representante", "Employer EIN", and the seccional
    // that issued the RUT in its own letterhead. A number introduced that way is
    // somebody else's, and this app holds only your own.
    const OTHERS = /(?:^|[^0-9A-Z])(EMPLOYER|EMPLEADOR|EMPLOYEUR|ISSUER|EMISOR|EMITENTE|PROVEEDOR|FORNECEDOR|SUPPLIER|VENDOR|SELLER|VENDEDOR|CLIENTE|CUSTOMER|REPRESENTANTE|RESPONSAVEL|RESPONSABLE|APODERADO|CONTADOR|CONTABILISTA|BENEFICIARIO|TERCERO|DESTINATARIO|REMITENTE|SECCIONAL|ADMINISTRACION)(?:[^0-9A-Z]|$)/;

    function hasChecksum(ident) {
        const engine = (ident.checksum || {}).engine;
        return !!engine && engine !== 'structural' && engine !== 'unimplemented';
    }

    // A qualifier belongs to the label it stands beside, so this reads the words
    // between the label and its value, the words that trail the value, the two
    // words in front of the label — stopping at the first that holds a digit,
    // because that is the previous value and its qualifier is not this one's —
    // and the caption before it, which is where a RUT's letterhead keeps
    // "Dirección Seccional".
    function ownerAt(folded, hits, i, valueAt, valueEnd) {
        const h = hits[i];
        let near = folded.slice(h.end, valueAt);
        // Portuguese and Spanish put the qualifier after the number as readily
        // as before it — "11.222.333/0001-81 do fornecedor" — so the words that
        // trail it, as far as the next caption, count too.
        if (valueEnd != null) {
            near += ' ' + folded.slice(valueEnd, Math.min(nextHit(hits, i, folded.length), valueEnd + 24));
        }
        const before = folded.slice(Math.max(0, h.at - 40), h.at).split(/\s+/).filter(Boolean).slice(-2);
        for (let w = before.length - 1; w >= 0; w--) {
            if (/[0-9]/.test(before[w])) break;
            near = before[w] + ' ' + near;
        }
        // The caption before is only a caption when it names something else. An
        // IRS letter heads its page with the same words it labels the value
        // with, and reading that as "an employer's number, not yours" gets the
        // one document the user is most likely to import exactly backwards.
        const prev = hits[i - 1];
        if (prev && prev.end <= h.at && !(prev.slot === h.slot && prev.key === h.key)) {
            near += ' ' + folded.slice(prev.at, prev.end);
        }
        return OTHERS.test(' ' + near + ' ') ? 'other' : 'self';
    }

    // With no label to stand beside, a qualifier can only be the prose the value
    // is embedded in, so the same words are looked for on either side of it —
    // "paid to our supplier 900.123.456-1" names its owner as plainly as a
    // caption would.
    function ownerNear(folded, at, end) {
        const near = folded.slice(Math.max(0, at - 48), at) + ' ' + folded.slice(end, end + 24);
        return OTHERS.test(' ' + near + ' ') ? 'other' : 'self';
    }

    function candidate(spec) {
        const c = {
            key: spec.key,
            slot: spec.slot,
            value: spec.value,
            seen: spec.seen,
            label: spec.label || '',
            confidence: spec.confidence,
            owner: spec.owner || 'self',
            status: spec.status,
            conflict: false,
            blocked: !OFFERABLE[spec.status],
            reason: null,
            accepted: false,
        };
        if (spec.anchor != null) c.anchor = spec.anchor;
        // The character the rule computes is only ever news about a value that
        // failed it. Shown beside one that passed — "should end in 5" next to a
        // checked badge — it reads as a correction to a number the arithmetic
        // has just confirmed, so it travels only with the failures.
        if (spec.expected != null && c.blocked) c.expected = spec.expected;
        if (spec.weak) c.weak = spec.weak;
        if (spec.refused) c.refused = spec.refused;
        if (spec.derived) c.derived = spec.derived;
        if (spec.printedDv != null) c.printedDv = spec.printedDv;

        // A caller may name the reason more exactly than the status does, but
        // only for a value that is already being withheld: a reason is the
        // sentence explaining a refusal, never a way to soften one.
        if (c.blocked) c.reason = spec.reason || c.status;
        else if (c.owner === 'other') c.reason = 'third-party';
        else if (c.confidence === 'shaped') c.reason = 'unlabelled';
        else if (c.confidence === 'grouped') c.reason = 'grouping-only';
        else if (c.derived) c.reason = 'derived';

        // The pane starts ticked only where the document itself vouched for the
        // value: a label that names this identifier, no third-party qualifier
        // beside it, and nothing computed on the user's behalf.
        c.accepted = !c.blocked && c.confidence === 'anchored' && c.owner === 'self' && !c.derived;
        return c;
    }

    function identifierCandidate(ident, hits, i, m, text, folded, confidence) {
        const hit = i == null ? null : hits[i];
        return candidate({
            key: ident.key,
            slot: 'identifier',
            value: m.value,
            seen: m.seen,
            label: hit ? text.slice(hit.at, hit.end) : '',
            anchor: hit ? hit.at : null,
            confidence: confidence,
            owner: hit ? ownerAt(folded, hits, i, m.at, m.at + m.seen.length) : 'unknown',
            status: m.res.status,
            expected: m.res.expected,
            weak: m.res.weak,
            refused: m.res.refused,
        });
    }

    function matchValue(rec, ident, text, at, to) {
        const ts = tokens(text, at, to);
        // A window may hold the number and something else shaped like it — a
        // form's own box number, a folio, the year. The one that satisfies the
        // authority's arithmetic is the number; only when none does is the first
        // thing of the right shape reported, so that a genuine typo is shown as
        // a failed check rather than silently passed over.
        let fallback = null;
        for (let i = 0; i < ts.length; i++) {
            // pdf.js hands back an RFC as "SIS 960308 GN5" and a VAT number as
            // "GB 123 4567 89" whenever the document set them in separate text
            // items, and a typist writes an EIN "12 - 3456789". A join has to be
            // vouched for by something outside itself, and there are exactly two
            // witnesses: the authority's check digit, and the authority's own
            // printed grouping, which is what the record's `display` states and
            // what already tells an EIN from an SSN everywhere else in this file.
            // Nothing else joins — a run of digits either satisfies the
            // arithmetic or fills a mask, or it is not this identifier.
            for (let span = 1; span <= 4 && i + span <= ts.length; span++) {
                const last = ts[i + span - 1];
                // As printed, separators and all, so the join is judged on the
                // typography the document actually used.
                const seen = span === 1 ? ts[i].text
                    : text.slice(ts[i].at, last.at + last.text.length);
                const canon = canonical(seen);
                if (!canon) continue;
                if (ident.format && !re(ident.format, 'i').test(canon)) continue;
                const res = window.FiscalEngines.validate(seen, ident);
                if (span > 1 && res.status !== 'ok'
                    && groupClaim(rec, seen) !== ident) continue;
                const m = { seen: seen, value: canon, res: res, at: ts[i].at };
                if (res.status === 'ok') return m;
                if (!fallback) fallback = m;
            }
        }
        return fallback;
    }

    function scanIdentifiers(rec, text, folded, hits, handled) {
        const out = [];
        (rec.identifiers || []).forEach((ident) => {
            if (handled.indexOf(ident.key) !== -1) return;

            const found = [];
            hits.forEach((h, i) => {
                if (h.slot !== 'identifier' || h.key !== ident.key) return;
                const w = windowAfter(text, hits, i);
                const m = matchValue(rec, ident, text, w.at, w.to);
                if (m) found.push(identifierCandidate(ident, hits, i, m, text, folded, 'anchored'));
            });

            if (!found.length && hasChecksum(ident)) {
                const seen = {};
                tokens(text, 0, text.length).forEach((t) => {
                    const canon = canonical(t.text);
                    if (!canon || (ident.format && !re(ident.format, 'i').test(canon))) return;
                    if (seen[canon]) return;
                    const res = window.FiscalEngines.validate(t.text, ident);
                    // The check digit is its own witness. A run that satisfies
                    // the authority's arithmetic by accident is rare; one that
                    // fails it is not this identifier and is not worth showing.
                    if (res.status !== 'ok') return;
                    seen[canon] = true;
                    found.push(identifierCandidate(ident, hits, null, { seen: t.text, value: canon, res: res, at: t.at },
                        text, folded, 'shaped'));
                });
            }

            // An identifier with no check digit has no arithmetic to appeal to,
            // so shape alone will never do: nine bare digits are a date, a folio,
            // an SSN and an EIN at once. What it does have is the way the
            // authority prints it. A run set out in exactly that grouping, and in
            // no other identifier's on this record, has been separated by the
            // document itself — it is offered, and left for the holder to tick,
            // because typography says which number this is and not whose.
            if (!found.length && !hasChecksum(ident)) {
                const rx = maskScan(ident.display);
                const seen = {};
                let m;
                while (rx && (m = rx.exec(text)) !== null) {
                    if (maskClaim(rec, m[0]) !== ident || seen[m[0]]) continue;
                    const res = window.FiscalEngines.validate(m[0], ident);
                    if (!OFFERABLE[res.status]) continue;
                    seen[m[0]] = true;
                    found.push(candidate({
                        key: ident.key, slot: 'identifier', value: canonical(m[0]), seen: m[0],
                        label: '', confidence: 'grouped', owner: ownerNear(folded, m.index, m.index + m[0].length),
                        status: res.status, expected: res.expected, weak: res.weak,
                    }));
                }
            }

            found.forEach((c) => out.push(c));
        });
        return out;
    }

    // A generic caption names a tax identifier without naming which, so the
    // record answers that: the value is taken only when one identifier can hold
    // it and the evidence that it does is the value's own — the check digit
    // where the authority publishes one, and the printed grouping where it does
    // not. "Tax ID: 123456789" therefore yields nothing in the United States,
    // which is the right answer and the registry's own: nine bare digits are an
    // EIN and an SSN alike, and no rule can separate them.
    function genericClaim(rec, seen) {
        const canon = canonical(seen);
        const grouped = groupClaim(rec, seen);
        if (grouped) {
            const res = window.FiscalEngines.validate(seen, grouped);
            return OFFERABLE[res.status] ? { ident: grouped, res: res } : null;
        }
        let claim = null;
        (rec.identifiers || []).forEach((ident) => {
            if (!hasChecksum(ident)) return;
            if (ident.format && !re(ident.format, 'i').test(canon)) return;
            const res = window.FiscalEngines.validate(seen, ident);
            if (res.status !== 'ok') return;
            claim = claim ? false : { ident: ident, res: res };
        });
        return claim || null;
    }

    function scanGeneric(rec, text, folded, hits, handled) {
        const out = [];
        hits.forEach((h, i) => {
            if (h.slot !== 'generic') return;
            const w = windowAfter(text, hits, i);
            const ts = tokens(text, w.at, w.to);
            for (let t = 0; t < ts.length; t++) {
                // An IRS letter heads its page "Employer Identification
                // Number", not "EIN", so the same run has to survive a generic
                // caption as it does its own. The joins are the ones matchValue
                // makes, and they answer to the same two witnesses — the
                // authority's arithmetic, or the authority's printed grouping —
                // which is what keeps "Tax ID: 123456789" yielding nothing.
                for (let span = 1; span <= 4 && t + span <= ts.length; span++) {
                    const last = ts[t + span - 1];
                    const end = last.at + last.text.length;
                    const seen = span === 1 ? ts[t].text : text.slice(ts[t].at, end);
                    const claim = genericClaim(rec, seen);
                    if (!claim || handled.indexOf(claim.ident.key) !== -1) continue;
                    out.push(candidate({
                        key: claim.ident.key, slot: 'identifier',
                        value: canonical(seen), seen: seen,
                        label: text.slice(h.at, h.end), anchor: h.at, confidence: 'anchored',
                        owner: ownerAt(folded, hits, i, ts[t].at, end),
                        status: claim.res.status, expected: claim.res.expected, weak: claim.res.weak,
                    }));
                    return;
                }
            }
        });
        return out;
    }

    /* ---------------------------------------------------------------- *
     * Fields and catalogues.                                            *
     * ---------------------------------------------------------------- */

    // The lookbehind is not tidying. Without it every position inside every word
    // is retried as the start of an address, so a document with no address in it
    // — a base64 attachment, a column of figures — costs seconds in this one
    // regex and freezes the tab the paste box lives in. An address can only begin
    // where a word does.
    const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]*\w/;

    function isEmail(key, def) {
        return /mail|correo/i.test(key + ' ' + JSON.stringify((def && def.label) || ''));
    }

    // `anchor` is where the caption sat, so it is carried by everything read
    // beside one — identifiers and fields alike — and omitted by the two things
    // that were not: the unlabelled email address, and a catalogue option, which
    // is recognised by its own name appearing rather than by a caption
    // introducing it.
    function fieldCandidate(key, slot, value, seen, label, confidence, anchor) {
        return candidate({
            key: key, slot: slot, value: value, seen: seen, label: label,
            confidence: confidence, status: 'unchecked', anchor: anchor,
        });
    }

    // Only fields the record can check, plus the email address — a name or an
    // address is prose whose boundaries are a matter of layout, so those are
    // read by the jurisdiction's own reader or not at all.
    function scanFields(rec, text, hits, handled) {
        const out = [];
        const fields = rec.fields || {};
        let email = null;

        hits.forEach((h, i) => {
            if (h.slot !== 'field' || handled.indexOf(h.key) !== -1) return;
            const def = fields[h.key];
            if (!def) return;
            const w = windowAfter(text, hits, i);
            const slice = text.slice(w.at, w.to);
            const label = text.slice(h.at, h.end);

            if (isEmail(h.key, def)) {
                const m = EMAIL.exec(slice);
                if (m && !email) email = fieldCandidate(h.key, 'field', m[0], m[0], label, 'anchored', h.at);
                return;
            }
            if (!def.format) return;
            const t = tokens(text, w.at, w.to).find((tok) => re(def.format, 'i').test(canonical(tok.text)));
            if (t) out.push(fieldCandidate(h.key, 'field', canonical(t.text), t.text, label, 'anchored', h.at));
        });

        // An unlabelled address is still worth offering, unticked — it is the
        // one value on a Constancia that is never wrong for being adjacent to
        // the wrong caption.
        if (!email) {
            const key = Object.keys(fields).find((k) => isEmail(k, fields[k]));
            const m = key && EMAIL.exec(text);
            if (m) email = fieldCandidate(key, 'field', m[0], m[0], '', 'shaped');
        }
        if (email) out.push(email);
        return out;
    }

    // A catalogue prints its option by name, not by code, so the option's own
    // label is the pattern. The whole label has to be present: matching a
    // fragment is how the bare word "Regímenes" became the régimen for
    // preferential foreign regimes.
    //
    // But a name found anywhere on a page is evidence that the words were
    // printed, not that they were printed about the holder: a leaflet's sentence
    // of advice names a régimen as readily as a Constancia asserts one, and no
    // caption introduced either. So the option is offered by its shape, unticked
    // and claiming no caption of its own. The régimen fiscal is the field SAT
    // rejects a CFDI over, which makes it the last one to fill in on a guess.
    function scanCatalogues(rec, text, handled) {
        const flatten = (s) => ' ' + fold(s).replace(/[^0-9A-Z]+/g, ' ').trim() + ' ';
        const flat = flatten(text);
        const out = [];
        Object.keys(rec.catalogues || {}).forEach((key) => {
            if (handled.indexOf(key) !== -1) return;
            const cat = rec.catalogues[key];
            (cat.options || []).forEach((opt) => {
                const needle = flatten(opt.label);
                // Short option names — "NIT", "Pagos" — appear in prose for
                // reasons that have nothing to do with the catalogue.
                if (needle.length - 2 < 10) return;
                if (flat.indexOf(needle) === -1) return;
                out.push(fieldCandidate(key, 'catalogue', opt.code, opt.label, '', 'shaped'));
            });
        });
        return out;
    }

    /* ---------------------------------------------------------------- *
     * Per-jurisdiction readers, for the boxes that are prose rather     *
     * than a checkable value: the names, and Colombia's split NIT.      *
     * ---------------------------------------------------------------- */

    // SAT's own rule: the name on a CFDI 4.0 carries no régimen societario, and
    // a trailing "SA DE CV" is the most common cause of a rejected invoice. The
    // list is deliberately short — only forms that are unambiguously a suffix —
    // and it is applied only to a company's name. "Sá" is a surname, and a
    // persona física called LOPEZ SA keeps it.
    const SUFFIXES = /[,\s]+(S\.?A\.?B\.?(\s+DE\s+C\.?V\.?)?|S\.?A\.?(\s+DE\s+C\.?V\.?)?|S\.?\s*DE\s*R\.?L\.?(\s+DE\s+C\.?V\.?)?|S\.?A\.?P\.?I\.?(\s+DE\s+C\.?V\.?)?|S\.?C\.?|A\.?C\.?|S\.?A\.?S\.?|LTDA\.?|LLC|INC\.?)$/i;

    // A legal name may hold a numeral (COMERCIAL 2000, GRUPO 3M), a period and a
    // diaeresis (GÜEMES); what it may not hold is the numbering a document puts
    // on its own boxes, which is the RUT's "35." running into the value.
    function cleanName(raw) {
        let name = String(raw)
            .replace(/^[\s:.\-]+/, '')
            .replace(/^\d{1,3}\.\s*/, '')
            .replace(/\s\d{1,3}\.\s*$/, '')
            .replace(/[\s:,;-]+$/, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .toUpperCase();
        // A trailing period closes an abbreviation in a name that is already
        // punctuated that way — INVERSIONES EL ROBLE S.A.S. is registered with
        // it and DIAN expects it back — and ends a sentence in one that is not.
        if (/\.$/.test(name) && name.slice(0, -1).indexOf('.') === -1) {
            name = name.slice(0, -1).replace(/[\s:,;-]+$/, '');
        }
        if (name.length < 2 || name.length > 120) return '';
        return /[A-Z\u00C0-\u024F]/.test(name) ? name : '';
    }

    function tidyName(raw) {
        return cleanName(String(raw).replace(SUFFIXES, ''));
    }

    function boxValue(text, hits, key) {
        for (let i = 0; i < hits.length; i++) {
            if (hits[i].key !== key) continue;
            const w = windowAfter(text, hits, i);
            const v = cleanName(text.slice(w.at, w.to));
            if (v) return { value: v, label: text.slice(hits[i].at, hits[i].end), at: hits[i].at };
        }
        return null;
    }

    function nameCandidate(key, parts, box) {
        const full = cleanName(parts.filter(Boolean).join(' '));
        if (!full) return null;
        return fieldCandidate(key, 'field', full, full, box.label, 'anchored', box.at);
    }

    // Colombia's verification digit is a published function of the NIT body, so
    // where DIAN prints it in its own box we read it and let the engine check
    // the pair — a mismatch means the scrape was wrong and should say so. Only
    // where the document gives the body alone is the digit computed, and then it
    // is marked as computed rather than shown as if it had been read.
    function withDv(body, ident) {
        // Probed with the digit written apart from the body, because a NIT sits
        // on a cédula of 8, 9 or 10 digits and the engine will not name a check
        // character it cannot place — which is the right refusal for a value
        // typed into a box and the wrong one here, where box 5 has already said
        // where the body ends.
        const probe = window.FiscalEngines.validate(body + '-0', ident);
        if (probe.status === 'ok') return body + '0';
        return probe.expected != null ? body + probe.expected : null;
    }

    const READERS = {
        // SAT — Constancia de Situación Fiscal, and the Cédula de Datos Fiscales.
        MX: {
            detect: (folded) => /CONSTANCIA DE SITUACI|CEDULA DE (DATOS FISCALES|IDENTIFICACI)|(?:^|[^0-9A-Z])RFC(?:[^0-9A-Z]|$)/.test(folded),
            boxes: [
                { key: 'razonSocial', terms: ['DENOMINACION/RAZON SOCIAL', 'DENOMINACION O RAZON SOCIAL', 'DENOMINACION'] },
                { key: 'nombre', terms: ['NOMBRE (S)', 'NOMBRE(S)', 'NOMBRES'] },
                { key: 'apellido1', terms: ['PRIMER APELLIDO'] },
                { key: 'apellido2', terms: ['SEGUNDO APELLIDO'] },
                { key: null, terms: [
                    'NOMBRE COMERCIAL', 'IDCIF', 'ID CIF', 'CURP', 'ESTATUS EN EL PADRON', 'ESTATUS',
                    'SITUACION DEL CONTRIBUYENTE', 'SITUACION', 'FECHA DE INICIO DE OPERACIONES',
                    'FECHA DE ULTIMO CAMBIO DE ESTADO', 'FECHA DE ALTA', 'ENTIDAD FEDERATIVA',
                    'NOMBRE DE VIALIDAD', 'TIPO DE VIALIDAD', 'NUMERO EXTERIOR', 'NUMERO INTERIOR',
                    'COLONIA', 'LOCALIDAD', 'ENTRE CALLE', 'DATOS DE IDENTIFICACION DEL CONTRIBUYENTE',
                    'DATOS DEL DOMICILIO REGISTRADO', 'CARACTERISTICAS FISCALES', 'OBLIGACIONES',
                    'LUGAR Y FECHA DE EMISION', 'CADENA ORIGINAL', 'SELLO DIGITAL',
                    'REGIMENES', 'REGIMEN',
                ] },
            ],
            handles: ['razonSocial', 'nombre'],
            read: function (rec, text, folded, hits, byKey) {
                const out = [];
                const razon = boxValue(text, hits, 'razonSocial');
                if (razon) {
                    const tidy = tidyName(razon.value);
                    if (tidy) out.push(fieldCandidate('razonSocial', 'field', tidy, razon.value, razon.label, 'anchored', razon.at));
                }
                const given = boxValue(text, hits, 'nombre');
                const first = boxValue(text, hits, 'apellido1');
                const second = boxValue(text, hits, 'apellido2');
                if (given || first) {
                    const person = nameCandidate('nombre',
                        [given && given.value, first && first.value, second && second.value],
                        given || first);
                    if (person) out.push(person);
                }

                // A persona moral's RFC is 12 characters and a persona física's
                // 13 — but only when there IS an RFC. A missing one says nothing
                // about the kind of card, and reading it as "personal" is how a
                // company loses its legal-name field on a bad scrape. SAT prints
                // a denominación for one and apellidos for the other, never
                // both, so where the boxes and the length disagree one of the
                // two readings is wrong and neither is worth asserting.
                const rfc = byKey('rfc');
                const byLength = rfc ? (rfc.value.length === 12 ? 'business' : 'personal') : null;
                const byBox = razon ? 'business' : ((given || first) ? 'personal' : null);
                let kind = null;
                let why = null;
                let from = null;
                if (byLength && byBox && byLength !== byBox) why = 'conflict';
                else if (byLength) { kind = byLength; why = 'rfc-length'; from = 'rfc'; }
                else if (byBox) {
                    kind = byBox;
                    why = razon ? 'razon-social' : 'apellidos';
                    from = razon ? 'razonSocial' : 'nombre';
                }
                return { candidates: out, kind: kind, kindReason: why, kindFrom: from };
            },
        },

        // DIAN — Registro Único Tributario (RUT).
        CO: {
            detect: (folded) => /REGISTRO UNICO TRIBUTARIO|(?:^|[^0-9A-Z])(RUT|NIT)(?:[^0-9A-Z]|$)/.test(folded),
            boxes: [
                { key: 'dv', terms: ['DV', 'DIGITO DE VERIFICACION'] },
                { key: 'nombres', terms: ['NOMBRES', 'OTROS NOMBRES', 'PRIMER NOMBRE'] },
                { key: 'apellido1', terms: ['PRIMER APELLIDO'] },
                { key: 'apellido2', terms: ['SEGUNDO APELLIDO'] },
                { key: null, terms: [
                    'NUMERO DE FORMULARIO', 'CONCEPTO', 'TIPO DE CONTRIBUYENTE', 'TIPO DE DOCUMENTO',
                    'LUGAR DE EXPEDICION', 'FECHA DE EXPEDICION', 'RESPONSABILIDADES', 'CALIDADES Y ATRIBUTOS',
                    'FIRMA DEL SOLICITANTE', 'DIRECCION SECCIONAL', 'OCUPACION', 'NOMBRE COMERCIAL',
                    'CORREO ELECTRONICO', 'NACIONALIDAD', 'ESTADO ACTUAL', 'FECHA DE ACTUALIZACION',
                ] },
            ],
            handles: ['nit', 'tipoDocumento', 'razonSocial', 'nombre'],
            read: function (rec, text, folded, hits, byKey) {
                const out = [];
                const ident = (rec.identifiers || []).find((i) => i.key === 'nit');
                const juridicaAt = /PERSONA JURIDICA/.exec(folded);
                const naturalAt = /PERSONA NATURAL/.exec(folded);
                const juridica = !!juridicaAt;
                const natural = !!naturalAt;

                // DIAN prints the body and its verification digit in separate
                // numbered boxes, so a regex reaching for "the next digit" picks
                // up the number of the next box instead. Read them as two boxes.
                let printedDv = null;
                let dvAt = -1;
                hits.forEach((h, i) => {
                    if (h.key !== 'dv' || printedDv) return;
                    const w = windowAfter(text, hits, i);
                    const digit = tokens(text, w.at, w.to).find((tok) => /^[0-9]$/.test(tok.text));
                    if (digit) { printedDv = digit.text; dvAt = h.at; }
                });
                // Box 6 belongs to the box 5 it follows, and to no other NIT on
                // the page. The seccional's number in the letterhead and a
                // supplier's on an attached invoice have no verification digit
                // printed anywhere; lending them this one invents a
                // disagreement the document never made.
                const nitAt = hits
                    .filter((h) => h.slot === 'identifier' && h.key === 'nit')
                    .map((h) => h.at);
                const dvFor = (at) => (printedDv != null && dvAt > at
                    && !nitAt.some((p) => p > at && p < dvAt) ? printedDv : null);
                if (ident) {
                    hits.forEach((h, i) => {
                        if (h.slot !== 'identifier' || h.key !== 'nit') return;
                        const w = windowAfter(text, hits, i);
                        const t = tokens(text, w.at, w.to)
                            .find((tok) => /^[0-9]{8,11}$/.test(canonical(tok.text)));
                        if (!t) return;

                        // Written out in one run — 900.123.456-1 — the hyphen is
                        // where the body ends. In separate boxes it is box 6.
                        // Either way the document has PRINTED the verification
                        // digit, and that is the reading: DIAN's arithmetic
                        // either agrees with it or says the pair was misread.
                        // Quietly preferring a shorter reading the paper does
                        // not show is how a nine-digit body reads as an
                        // eight-digit one plus a digit and another company's
                        // NIT comes back ticked and badged as checked.
                        const split = /^([0-9.]{8,13})-([0-9])$/.exec(t.text);
                        const run = canonical(t.text);
                        const body = split ? canonical(split[1]) : run;
                        const printed = split ? split[2] : dvFor(h.at);
                        const check = (v) => window.FiscalEngines.validate(v, ident);

                        let value = run;
                        let res = check(run);
                        let derived = null;
                        let mismatch = false;
                        if (printed != null) {
                            const paired = body + printed;
                            const pres = check(paired);
                            const rres = check(run);
                            if (pres.status === 'ok') { value = paired; res = pres; }
                            else if (!split && pres.status === 'bad-format'
                                && run.slice(-1) === printed && rres.status === 'ok') {
                                // Box 5 already carried the digit and box 6
                                // repeats it. Only where the pair is too long to
                                // be a NIT at all is that the sole reading; while
                                // the pair is still a possible NIT, preferring
                                // the shorter one is the guess that hands back
                                // another entity's number wearing a green badge.
                                value = run; res = rres;
                            } else {
                                // The digit on the paper and the digit the rule
                                // computes are different digits. One of the two
                                // boxes was misread or the document is damaged,
                                // and there is no way to tell which — so the
                                // pair is shown exactly as printed, withheld,
                                // and the computed digit travels beside it so
                                // the user can see what disagrees with what.
                                value = paired; res = pres; mismatch = true;
                            }
                        } else if (res.status !== 'ok') {
                            // No digit anywhere: DIAN's is computable from the
                            // body, but a computed digit is this app's
                            // arithmetic rather than the document's word, so it
                            // is marked as such and left unticked.
                            const done = withDv(run, ident);
                            const dres = done ? check(done) : null;
                            if (dres && dres.status === 'ok') { value = done; res = dres; derived = 'dv'; }
                        }

                        let expected = res.expected;
                        if (mismatch) {
                            const computed = withDv(body, ident);
                            if (computed) expected = computed.slice(-1);
                        }

                        const owner = ownerAt(folded, hits, i, t.at, t.at + t.text.length);
                        out.push(candidate({
                            key: 'nit', slot: 'identifier', value: value, seen: t.text,
                            label: text.slice(h.at, h.end), anchor: h.at, confidence: 'anchored',
                            owner: owner, status: res.status,
                            expected: expected, derived: derived,
                            printedDv: printed, reason: mismatch ? 'dv-mismatch' : null,
                        }));

                        // A natural person's NIT is their cédula with DIAN's
                        // verification digit on the end, so box 5 has already
                        // given both and the profile asks for each by name. The
                        // digit is the only part that is not the cédula — but
                        // only off a reading the arithmetic accepted, because a
                        // cédula has no check rule of its own and would come
                        // back from a rejected NIT unchecked, ticked and wrong.
                        const ced = (rec.identifiers || []).find((x) => x.key === 'cedula');
                        const bare = value.slice(0, -1);
                        if (natural && !juridica && ced && owner === 'self' && OFFERABLE[res.status]
                            && re(ced.format, 'i').test(bare)) {
                            const cres = window.FiscalEngines.validate(bare, ced);
                            out.push(candidate({
                                key: 'cedula', slot: 'identifier', value: bare, seen: t.text,
                                label: text.slice(h.at, h.end), anchor: h.at, confidence: 'anchored',
                                owner: owner, status: cres.status, expected: cres.expected,
                            }));
                        }
                    });
                }

                // "Persona jurídica" on a supplier's invoice is a sentence about
                // the supplier. The words are only about the holder where the
                // page also gave the holder's OWN number — otherwise the card
                // takes its document type, and the half of the form it shows,
                // from a stranger's paperwork, off the one identifier this
                // module has just finished marking as not the holder's.
                const mine = out.some((c) => c.slot === 'identifier' && c.owner === 'self');

                // The document says which it is; guessing it from whether a NIT
                // regex happened to match is how a company card ends up
                // asserting its document type is a cédula de ciudadanía. What is
                // shown is the phrase the page actually prints, because "found
                // beside «NIT»" names a caption no RUT carries.
                const said = mine ? (juridica && !natural ? juridicaAt : (natural && !juridica ? naturalAt : null)) : null;
                const cat = (rec.catalogues || {}).tipoDocumento;
                const wanted = said ? (juridica ? 'NIT' : 'CEDULA DE CIUDADANIA') : null;
                const opt = wanted && cat && (cat.options || []).find((o) => fold(o.label) === wanted);
                if (opt) {
                    const phrase = text.slice(said.index, said.index + said[0].length);
                    out.push(fieldCandidate('tipoDocumento', 'catalogue', opt.code, phrase, phrase, 'anchored', said.index));
                }

                // Unlike SAT, DIAN expects the razón social exactly as
                // registered, suffix included, so nothing is stripped here.
                const razon = boxValue(text, hits, 'razonSocial');
                if (razon) out.push(fieldCandidate('razonSocial', 'field', razon.value, razon.value, razon.label, 'anchored', razon.at));

                const given = boxValue(text, hits, 'nombres');
                const first = boxValue(text, hits, 'apellido1');
                const second = boxValue(text, hits, 'apellido2');
                if (given || first) {
                    const person = nameCandidate('nombre',
                        [given && given.value, first && first.value, second && second.value],
                        given || first);
                    if (person) out.push(person);
                }

                // This one is the document's own word rather than an inference
                // off a value, so it stands whatever the reviewer does with the
                // NIT: kindFrom is null. It rests on the same evidence the
                // document type does — the page has to be about the holder
                // before what it says about a contribuyente is about them.
                const kind = said ? (juridica ? 'business' : 'personal') : null;
                return { candidates: out, kind: kind, kindReason: kind ? 'tipo-contribuyente' : null, kindFrom: null };
            },
        },
    };

    /* ---------------------------------------------------------------- *
     * Assembly.                                                         *
     * ---------------------------------------------------------------- */

    function dedupe(list) {
        const rank = { anchored: 3, grouped: 2, shaped: 1 };
        const best = new Map();
        list.forEach((c) => {
            const key = c.key + ' ' + c.value;
            const prev = best.get(key);
            if (!prev) { best.set(key, c); return; }
            const better = (rank[c.confidence] || 0) - (rank[prev.confidence] || 0)
                || (c.owner === 'self' ? 1 : 0) - (prev.owner === 'self' ? 1 : 0);
            if (better > 0) best.set(key, c);
        });
        return list.filter((c) => best.get(c.key + ' ' + c.value) === c);
    }

    // Ambiguity is the state this module used to guess in. Two different RFCs on
    // one page means one of them is not the holder's, and there is no evidence
    // in the document saying which — so neither is offered and the UI says so.
    // A régimen is different: a taxpayer really can have two, and picking one is
    // a choice rather than a guess.
    function settle(candidates) {
        const ambiguous = [];
        const byKey = {};
        candidates.forEach((c) => { (byKey[c.key] = byKey[c.key] || []).push(c); });

        Object.keys(byKey).forEach((key) => {
            const all = byKey[key].filter((c) => !c.blocked);
            if (!all.length) return;

            // Two readings of one key compete for the one box the card has,
            // whoever they belong to. Saying so is not the same as calling them
            // ambiguous: a RUT's letterhead names the seccional's NIT and the
            // holder's box names the holder's, and the document has said which
            // is which. What it has not done is make them addable together —
            // and the stranger's is printed FIRST, so a pane that ticks both
            // hands back the stranger's. Mutually exclusive, and the one the
            // document vouched for is the one that arrives ticked.
            const spread = {};
            all.forEach((c) => { spread[c.value] = true; });
            if (Object.keys(spread).length > 1) all.forEach((c) => { c.conflict = true; });

            // A reading labelled as somebody else's does not make the holder's
            // own reading ambiguous — it just is not theirs. Neither does one
            // that has already been withheld: the generic RFC printed in a
            // header is not a second opinion about the holder's.
            const mine = all.filter((c) => c.owner !== 'other');
            const list = mine.length ? mine : all;
            const distinct = {};
            list.forEach((c) => { distinct[c.value] = true; });
            if (Object.keys(distinct).length < 2) return;

            const isIdentifier = list[0].slot === 'identifier';
            list.forEach((c) => {
                c.conflict = true;
                c.accepted = false;
                if (isIdentifier) { c.blocked = true; c.reason = 'ambiguous'; }
                else if (!c.reason) c.reason = 'choose-one';
            });
            if (isIdentifier) ambiguous.push(key);
        });

        // The mirror case: one number, two identifiers, one caption. Japan's
        // 登録番号 is printed the same for a corporation and for a sole trader,
        // and a card that held both would be asserting the holder is each. Where
        // the arithmetic tells them apart it decides; where it cannot, neither
        // reading is offered, because there is nothing left to decide it with.
        const byAnchor = {};
        candidates.forEach((c) => {
            if (c.slot !== 'identifier' || c.blocked || c.anchor == null) return;
            const at = c.anchor + ' ' + c.value;
            (byAnchor[at] = byAnchor[at] || []).push(c);
        });
        Object.keys(byAnchor).forEach((at) => {
            const list = byAnchor[at];
            if (list.length < 2) return;
            const checked = list.filter((c) => c.status === 'ok');
            if (checked.length === 1) {
                list.forEach((c) => {
                    if (c === checked[0]) return;
                    c.blocked = true;
                    c.accepted = false;
                    c.reason = 'same-value';
                });
                return;
            }
            list.forEach((c) => {
                c.conflict = true;
                c.blocked = true;
                c.accepted = false;
                c.reason = 'ambiguous';
                if (ambiguous.indexOf(c.key) === -1) ambiguous.push(c.key);
            });
        });

        // A reading that failed the authority's arithmetic is evidence about
        // the VALUE and not only about the identifier that ran the check: a
        // character of this run was misread, or the number is wrong. So no
        // other reading of the same string arrives already agreed to. Japan is
        // where this bites — 登録番号 is printed the same for a company and for
        // a sole trader, and only the company's number has a check digit, so a
        // T-number that fails the corporate mod 9 would otherwise come back
        // ticked under the identifier that has no arithmetic to contradict it.
        // It stays on offer, because a sole trader's number really does fail
        // that check and refusing it would refuse a legitimate number; what it
        // does not do is present itself as already confirmed.
        //
        // Three of those verdicts go further than unticking, because they are
        // facts about the DIGITS rather than about one identifier's arithmetic:
        // a number the authority never issued is nobody's under any caption, a
        // number this app declines to hold is the same number whichever box it
        // was typed into, and the form's own administrative constant is not the
        // holder's under either reading. A failed check digit says none of that
        // — a sole trader's number really does fail the corporate rule — so it
        // stops at unticking and the number stays on offer.
        const failed = {};
        const denied = {};
        candidates.forEach((c) => {
            if (c.slot !== 'identifier' || OFFERABLE[c.status]) return;
            // A wrong SHAPE says only that this is not that identifier, which
            // the caption already got wrong; it is the arithmetic that says a
            // character of the run was misread, and that is the whole claim the
            // caveat makes.
            if (c.status === 'bad-check') failed[c.value] = true;
            if (c.status === 'not-issuable' || c.status === 'refused' || c.status === 'reserved') {
                denied[c.value] = c.status;
            }
        });
        candidates.forEach((c) => {
            if (c.slot !== 'identifier' || c.blocked) return;
            if (denied[c.value]) {
                c.blocked = true;
                c.accepted = false;
                // The verdict travels as the STATUS, not only as the reason.
                // A badge is read off the status, and a number the authority
                // never issued wearing "no published check digit" reads softer
                // than a mistyped one — the one direction this app may never
                // get wrong.
                c.status = denied[c.value];
                c.reason = denied[c.value];
                return;
            }
            if (!failed[c.value]) return;
            c.accepted = false;
            if (!c.reason) c.reason = 'check-conflict';
        });
        return ambiguous;
    }

    // "Read 2 fields" reads as success even when the two are the postal code and
    // the email and the razón social was missed. Name what the profile still
    // wants so the sentence can say it.
    function missingFor(rec, kind, candidates) {
        const profile = (rec.invoiceProfile || {})[kind || 'personal'] || {};
        const have = {};
        candidates.forEach((c) => { if (!c.blocked && c.owner !== 'other') have[c.key] = true; });
        return (profile.required || []).filter((k) => !have[k]);
    }

    function build(text, rec, source, problem) {
        const squashed = squash(text);
        const reader = READERS[rec.iso];
        const groups = vocabulary(rec, reader);
        const hits = labelIndex(fold(squashed), groups);

        const guard = redact(squashed, rec, hits);
        const scan = guard.text;
        // Blanking preserves length, so the label positions still hold; only
        // the values printed under a refused label are gone.
        const folded = fold(scan);

        const use = reader && reader.detect(folded) ? reader : null;
        const handled = use ? use.handles : [];

        let candidates = scanIdentifiers(rec, scan, folded, hits, handled);
        // A reader asking what was found for a key wants the reading that could
        // actually be applied, not the generic value withheld two lines above.
        const byKey = (key) => candidates.find((c) => c.key === key && !c.blocked && c.owner !== 'other') || null;

        let kind = null;
        let kindReason = null;
        let kindFrom = null;
        if (use) {
            const extra = use.read(rec, scan, folded, hits, byKey);
            candidates = candidates.concat(extra.candidates);
            kind = extra.kind;
            kindReason = extra.kindReason;
            kindFrom = extra.kindFrom || null;
        }
        candidates = candidates
            .concat(scanGeneric(rec, scan, folded, hits, handled))
            .concat(scanFields(rec, scan, hits, handled))
            .concat(scanCatalogues(rec, scan, handled));

        candidates = dedupe(candidates);
        const ambiguous = settle(candidates);

        if (!kind && !kindReason) {
            // With no reader to say, the identifier's own scope does: an EIN is
            // a company's number and an ITIN is a person's.
            const scoped = candidates.find((c) => {
                if (c.slot !== 'identifier' || c.blocked || c.owner === 'other') return false;
                const ident = (rec.identifiers || []).find((i) => i.key === c.key);
                return ident && (ident.scope === 'business' || ident.scope === 'personal');
            });
            if (scoped) {
                kind = ((rec.identifiers || []).find((i) => i.key === scoped.key)).scope;
                kindReason = 'scope';
                kindFrom = scoped.key;
            }
        }

        const subject = candidates.find((c) => !c.blocked
            && (c.key === 'razonSocial' || c.key === 'nombre' || c.key === 'legalName'));

        return {
            source: source,
            problem: problem || null,
            chars: squashed.length,
            candidates: candidates,
            ambiguous: ambiguous,
            refusals: guard.refusals,
            missing: missingFor(rec, kind, candidates),
            kind: kind,
            kindReason: kindReason,
            // Which value the kind was read off, or null where the document
            // said it in words. accept() will not emit a kind whose evidence
            // the reviewer struck out.
            kindFrom: kindFrom,
            // The kind rewrites which half of the form is even shown, so it is
            // reviewed like everything else rather than applied on the way past.
            // The pane may clear this to decline it.
            acceptKind: !!kind,
            subject: subject ? subject.value : null,
        };
    }

    // A photo of a Constancia is the commonest thing to drop in after the
    // Constancia itself, and decoding a JPEG as UTF-8 turns it into a page of
    // mojibake that the scanners then dutifully search. Anything that is neither
    // a PDF nor text is named as what it is instead.
    const TEXTUAL = /^(?:text\/|application\/(?:json|xml|xhtml))|(?:\.(?:txt|text|md|csv|json|xml|html?)$)/i;

    async function fromFile(file, rec) {
        let source = 'text';
        let text = '';
        let problem = null;
        try {
            if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
                source = 'pdf';
                const read = await readPdf(file);
                text = read.text;
                problem = read.problem;
            } else if (!TEXTUAL.test(file.type || '') && !TEXTUAL.test(file.name || '')) {
                source = 'file';
                problem = 'not-text';
            } else {
                text = await file.text();
                problem = text.trim() ? null : 'empty-file';
            }
        } catch (e) {
            // Every cause this module can name has been named by here. What is
            // left is the file going out from under us — a removed card, a
            // download still in flight — and that has to come back as a review
            // saying so, because a rejected promise leaves the pane with
            // nothing to phrase and sends it back to "could not be read".
            source = 'file';
            text = '';
            problem = 'unreadable';
        }
        return build(text, rec, source, problem);
    }

    function fromText(text, rec) {
        return build(text, rec, 'text', null);
    }

    // What the reviewer ticked, and nothing else. Blocked candidates never come
    // back out however the pane is wired, because the guarantee that a refused
    // or unverifiable number cannot reach a card belongs here rather than in the
    // hands of whoever renders the checkboxes.
    function accept(review) {
        const values = {};
        const applied = [];
        const ticked = ((review && review.candidates) || []).filter((c) => c && !c.blocked && c.accepted);

        // One key, one value. A pane that has ticked two readings of the same
        // identifier is describing a card that cannot exist — but taking
        // whichever was printed first is a coin toss, and on the two documents
        // where this happens the loser is always the holder: a RUT prints the
        // seccional's NIT in its letterhead above the holder's own box, and an
        // accountant's RFC heads the Constancia they filed. Where the document
        // itself said a reading is somebody else's, that is the one that loses.
        // This app holds only your own numbers, and it does not decide that by
        // page order.
        const chosen = {};
        ticked.forEach((c) => {
            const prev = chosen[c.key];
            if (!prev || (prev.owner === 'other' && c.owner !== 'other')) chosen[c.key] = c;
        });

        ticked.forEach((c) => {
            if (chosen[c.key] !== c) return;
            values[c.key] = c.value;
            applied.push({ key: c.key, slot: c.slot, value: c.value, label: c.label });
        });
        // The kind rewrites which half of the card even exists, so it rests on
        // the same evidence as everything else. Where it was read off a value,
        // that value has to be one the reviewer actually ticked: a card told it
        // is a business by a number the user struck out is being told by
        // nothing. Where the document said it in words there is no value to
        // tick, and it stands on its own.
        const offered = !!(review && review.acceptKind && review.kind);
        const held = offered && (!review.kindFrom
            || Object.prototype.hasOwnProperty.call(values, review.kindFrom));

        return {
            values: values,
            applied: applied,
            kind: held ? review.kind : null,
            // An import is not a verification. `verifiedOn` means the holder
            // checked the card against their own papers, and reading a file is
            // the moment before that rather than after it.
            verified: false,
        };
    }

    window.FiscalImport = {
        fromFile: fromFile,
        fromText: fromText,
        accept: accept,
        supported: (iso) => !!READERS[String(iso || '').toUpperCase()],
    };
})();
