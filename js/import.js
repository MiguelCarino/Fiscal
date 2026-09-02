// Carino Fiscal — getting data in without typing it.
//
// Typing an RFC into a phone is the friction this whole app exists to remove,
// so the fastest path is to read the authority's OWN document. Both of the
// documents that matter here are generated PDFs with a real text layer, not
// scans, so this is a text extraction rather than OCR — which also means it is
// exact. A misread tax ID is worse than no tax ID, so nothing here guesses:
// every field is matched against the same format regex the registry already
// uses to validate it, and anything that fails simply is not offered.
//
// pdf.js is vendored (no CDN, no network) and loaded on demand — it is 1.5 MB
// and most sessions never import a document.

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

    // Flatten a PDF to one whitespace-normalised string. Layout is irrelevant
    // here: we are looking for labelled values, and the labels travel with the
    // values whatever order the text items come out in.
    async function pdfText(file) {
        const lib = await loadPdfJs();
        const buf = await file.arrayBuffer();
        const doc = await lib.getDocument({ data: buf }).promise;
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map((it) => it.str).join(' '));
        }
        try { doc.destroy(); } catch (e) { /* nothing to do */ }
        return pages.join(' \n ').replace(/\s+/g, ' ').trim();
    }

    /* ---------------------------------------------------------------- *
     * Per-jurisdiction readers.                                        *
     *                                                                  *
     * Each returns { values, kind } or null. They are deliberately      *
     * conservative: a document that does not clearly identify itself    *
     * is not parsed at all, because a half-read Constancia that fills   *
     * three fields and silently drops the régimen is worse than a form. *
     * ---------------------------------------------------------------- */

    // SAT's own rule: the name on a CFDI 4.0 carries no régimen societario, and
    // a trailing "SA DE CV" is the most common cause of a rejected invoice. The
    // list is deliberately short — only forms that are unambiguously a suffix.
    const SUFFIXES = /[,\s]+(S\.?A\.?(\s+DE\s+C\.?V\.?)?|S\.?\s*DE\s*R\.?L\.?(\s+DE\s+C\.?V\.?)?|S\.?A\.?P\.?I\.?(\s+DE\s+C\.?V\.?)?|S\.?C\.?|A\.?C\.?|S\.?A\.?S\.?|LTDA\.?|LLC|INC\.?)$/i;

    function tidyName(raw) {
        return String(raw).trim().replace(/\s{2,}/g, ' ').replace(SUFFIXES, '').trim().toUpperCase();
    }

    // Colombia's verification digit is a published function of the NIT body, so
    // it is computed rather than read off the page. The engine reports what it
    // expected for a wrong digit, which is exactly the number we want.
    function withDv(body) {
        const ident = { format: '^[0-9]{9,10}$', checksum: {
            engine: 'mod11-weighted', weights: [41, 37, 29, 23, 19, 17, 13, 7, 3], map: 'dian' } };
        const probe = window.FiscalEngines.validate(body + '0', ident);
        if (probe.status === 'ok') return body + '0';
        return probe.expected != null ? body + probe.expected : body;
    }

    const READERS = {
        // SAT — Constancia de Situación Fiscal, and the Cédula de Datos Fiscales.
        MX: function (text) {
            if (!/(CONSTANCIA DE SITUACI|C[ÉE]DULA DE (DATOS FISCALES|IDENTIFICACI))/i.test(text)
                && !/\bRFC\b/i.test(text)) return null;

            const values = {};
            const rfc = /\b([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})\b/.exec(text.toUpperCase());
            if (rfc) values.rfc = rfc[1];

            const curp = /\b([A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z\d]\d)\b/.exec(text.toUpperCase());
            if (curp) values.curp = curp[1];

            // The CSF prints "Código Postal: 64000"; the Cédula prints "CP".
            const cp = /(?:C[ÓO]DIGO POSTAL|\bCP\b)\s*:?\s*(\d{5})/i.exec(text);
            if (cp) values.cp = cp[1];

            // "Régimen General de Ley Personas Morales" — match the catalogue by
            // name, since the CSF prints the name and not the code.
            const reg = /R[ÉE]GIMEN(?:ES)?\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ,.()-]{10,90})/i.exec(text);
            if (reg) values._regimenName = reg[1].trim();

            // A moral person's RFC is 12 characters; a física's is 13.
            const kind = values.rfc && values.rfc.length === 12 ? 'business' : 'personal';

            if (kind === 'business') {
                const name = /(?:DENOMINACI[ÓO]N\/?\s*RAZ[ÓO]N\s*SOCIAL|RAZ[ÓO]N SOCIAL)\s*:?\s*([A-ZÁÉÍÓÚÑ&.,' -]{3,80}?)(?=\s{2,}|\s*(?:R[ÉE]GIMEN|FECHA|ESTATUS|$))/i.exec(text);
                if (name) values.razonSocial = tidyName(name[1]);
            } else {
                // A persona física CSF splits the name across three boxes, so
                // reading "Nombre (s):" alone swallows the next box's label.
                const parts = [];
                const grab = (re) => { const m = re.exec(text); return m ? m[1] : ''; };
                parts.push(grab(/NOMBRE\s*\(?S?\)?\s*:?\s*([A-ZÁÉÍÓÚÑ' -]{2,40}?)(?=\s*(?:PRIMER|SEGUNDO|APELLIDO|R[ÉE]GIMEN|CURP|FECHA|$))/i));
                parts.push(grab(/PRIMER\s+APELLIDO\s*:?\s*([A-ZÁÉÍÓÚÑ' -]{2,40}?)(?=\s*(?:SEGUNDO|APELLIDO|R[ÉE]GIMEN|CURP|FECHA|$))/i));
                parts.push(grab(/SEGUNDO\s+APELLIDO\s*:?\s*([A-ZÁÉÍÓÚÑ' -]{2,40}?)(?=\s*(?:R[ÉE]GIMEN|CURP|FECHA|$))/i));
                const full = parts.map((x) => x.trim()).filter(Boolean).join(' ');
                if (full) values.nombre = tidyName(full);
            }
            return Object.keys(values).length ? { values: values, kind: kind } : null;
        },

        // DIAN — Registro Único Tributario (RUT).
        CO: function (text) {
            if (!/REGISTRO [ÚU]NICO TRIBUTARIO|\bRUT\b|\bNIT\b/i.test(text)) return null;
            const values = {};

            // The RUT prints the NIT body and its verification digit in separate
            // numbered boxes, so a regex reaching for "the next digit" reliably
            // picks up the NUMBER OF THE NEXT BOX instead. Take the body only and
            // compute the DV — it is a published function of the body, so this is
            // exact where scraping was merely plausible.
            const nit = /N[ÚU]MERO DE IDENTIFICACI[ÓO]N TRIBUTARIA[^\d]{0,40}(\d{9})\b/i.exec(text)
                || /\bNIT\b[^\d]{0,20}(\d{9})\b/i.exec(text);
            if (nit) values.nit = withDv(nit[1]);

            // Stop at the next labelled box, or the value runs on into it.
            // Note SAS/LTDA are NOT stripped here: unlike SAT, DIAN expects the
            // razón social exactly as registered, suffix included.
            const name = /RAZ[ÓO]N SOCIAL\s*:?\s*([A-ZÁÉÍÓÚÑ&.,' -]{3,80}?)(?=\s{2,}|\s*(?:\d+\.|CORREO|DIRECCI[ÓO]N|TEL[ÉE]FONO|ACTIVIDAD|$))/i.exec(text);
            if (name) values.razonSocial = name[1].trim().replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').toUpperCase();

            const mail = /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(text);
            if (mail) values.email = mail[1];

            values.tipoDocumento = values.nit ? '31' : '13';
            return Object.keys(values).length > 1 ? { values: values, kind: 'business' } : null;
        },
    };

    /* ---------------------------------------------------------------- *
     * Paste-and-parse. Half the time this data arrives as an email      *
     * signature or a WhatsApp message from an accountant, so accept     *
     * that shape too: the same readers run over pasted text.            *
     * ---------------------------------------------------------------- */

    // Generic fallback: pull anything matching the jurisdiction's own
    // identifier formats out of free text. Used for records with no reader.
    function genericRead(text, rec) {
        const values = {};
        const upper = text.toUpperCase();
        // People write 11.222.333/0001-81, not 11222333000181. Scan a copy with
        // separators closed up so the registry's own formats can still match.
        let joined = upper;
        for (let i = 0; i < 6; i++) joined = joined.replace(/([0-9A-Z])[.\-\/]([0-9A-Z])/g, '$1$2');
        (rec.identifiers || []).forEach((ident) => {
            if (!ident.format) return;
            // Anchored formats cannot match inside a longer string, so relax the
            // anchors into word boundaries for the scan.
            const body = ident.format.replace(/^\^/, '').replace(/\$$/, '');
            let m = null;
            try {
                const re = new RegExp('\\b(' + body + ')\\b');
                m = re.exec(upper) || re.exec(joined);
            } catch (e) { return; }
            if (m) values[ident.key] = m[1];
        });
        const mail = /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(text);
        if (mail) values.email = mail[1];
        return Object.keys(values).length ? { values: values, kind: null } : null;
    }

    // Resolve a régimen printed by name into its catalogue code.
    function matchRegimen(rec, name) {
        const cat = ((rec.catalogues || {}).regimenFiscal || {}).options || [];
        if (!name) return null;
        const norm = (s) => s.toUpperCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const target = norm(name);
        let best = null;
        cat.forEach((opt) => {
            const label = norm(opt.label);
            if (target.indexOf(label) !== -1 || label.indexOf(target) !== -1) {
                if (!best || label.length > norm(best.label).length) best = opt;
            }
        });
        return best ? best.code : null;
    }

    // Keep only values that pass the registry's own format check. This is the
    // guard that makes import safe: a regex that matched the wrong run of
    // characters is dropped rather than written into a card.
    function keepValid(rec, values) {
        const out = {};
        const byKey = {};
        (rec.identifiers || []).forEach((i) => { byKey[i.key] = i; });

        Object.keys(values).forEach((key) => {
            if (key.charAt(0) === '_') return;
            const ident = byKey[key];
            if (!ident) { out[key] = values[key]; return; }
            const res = window.FiscalEngines.validate(values[key], ident);
            if (res.status !== 'bad-format') out[key] = values[key];
        });
        return out;
    }

    async function fromFile(file, rec) {
        const text = await pdfText(file);
        return finish(text, rec);
    }

    function fromText(text, rec) {
        return finish(text, rec);
    }

    function finish(text, rec) {
        const reader = READERS[rec.iso];
        const read = (reader && reader(text)) || genericRead(text, rec);
        if (!read) return null;

        const regimen = matchRegimen(rec, read.values._regimenName);
        if (regimen) read.values.regimenFiscal = regimen;

        const values = keepValid(rec, read.values);
        if (!Object.keys(values).length) return null;
        return { values: values, kind: read.kind, chars: text.length };
    }

    window.FiscalImport = {
        fromFile: fromFile,
        fromText: fromText,
        pdfText: pdfText,
        supported: (iso) => !!READERS[iso],
    };
})();
