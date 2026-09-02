// Carino Fiscal — checksum engines.
//
// The point of this file is that it is SHORT and never grows per country.
// Nearly every national tax identifier is a weighted modulus over a digit
// string, so we ship a handful of parameterised engines here and express each
// jurisdiction as data in registry/<iso>.json. Adding Vietnam is a JSON file;
// it is not a change to this file.
//
// Every engine is a pure function of (value, params). No network, no clock, no
// storage — which is what lets the whole app run offline and what makes these
// testable in isolation.
//
// Return shape is always:
//   { status: 'ok' | 'bad-check' | 'bad-format' | 'unchecked', expected?: string }
// 'unchecked' is not a failure. It is the honest answer for an identifier whose
// authority publishes no check digit, and the UI says so rather than implying a
// verification it did not perform.
//
// PROVENANCE: every weight vector below is cited to the rule it implements.
// A rule with no citation does not belong here — it belongs in `structural`
// until someone verifies it. Cross-check candidates against python-stdnum
// (LGPL-2.1-or-later, upgrade-compatible with this project's AGPL-3.0) before
// promoting a jurisdiction to tier 1 or 2.

(function () {
    'use strict';

    const OK = (expected) => ({ status: 'ok', expected });
    const BAD = (expected) => ({ status: 'bad-check', expected });
    const MALFORMED = () => ({ status: 'bad-format' });
    const UNCHECKED = () => ({ status: 'unchecked' });

    // Digits only. Chile's check character may be K, so it survives normalisation
    // everywhere — anywhere else a stray K simply fails the comparison.
    function norm(value) {
        return String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
    }

    function alnum(value) {
        return String(value || '').toUpperCase().replace(/[^0-9A-Z&Ñ]/g, '');
    }

    /* ---------------------------------------------------------------- *
     * mod11-weighted — by far the largest family.                       *
     *                                                                   *
     * params:                                                           *
     *   weights  number[]  | number[][]  left-aligned over the body;    *
     *                                    array-of-arrays when digits=2  *
     *   cycle    number[]                repeated right-to-left instead *
     *   digits   1 | 2                   how many check digits trail     *
     *   map      string                  remainder -> check character    *
     * ---------------------------------------------------------------- */

    // The remainder mappings are where countries actually differ. Naming them
    // keeps registry files readable: "map": "dian" says what it is.
    const MAPS = {
        // Colombia (DIAN): r < 2 keeps the remainder, otherwise 11 - r.
        dian: (r) => (r < 2 ? String(r) : String(11 - r)),
        // Brazil (CPF, CNPJ): r < 2 collapses to 0.
        'lt2-zero': (r) => (r < 2 ? '0' : String(11 - r)),
        // Chile (RUT): 11 -> 0, 10 -> K.
        'sub11-k': (r) => { const v = 11 - r; return v === 11 ? '0' : v === 10 ? 'K' : String(v); },
        // Argentina (CUIT): 11 -> 0; a would-be 10 means the number is not issuable.
        sub11: (r) => { const v = 11 - r; return v === 11 ? '0' : v === 10 ? null : String(v); },
        // Peru (RUC): 10 -> 0, 11 -> 1.
        peru: (r) => { const v = 11 - r; return v === 10 ? '0' : v === 11 ? '1' : String(v); },
    };

    function weightsFor(params, pass, len) {
        if (params.cycle) {
            // Right-to-left repeating cycle (Chile). Build it left-aligned so the
            // main loop stays a single forward pass.
            const w = new Array(len);
            for (let i = 0; i < len; i++) w[len - 1 - i] = params.cycle[i % params.cycle.length];
            return w;
        }
        const raw = Array.isArray(params.weights[0]) ? params.weights[pass] : params.weights;
        return raw && raw.length === len ? raw : null;
    }

    function mod11Weighted(value, params) {
        const s = norm(value);
        const nCheck = params.digits || 1;
        const bodyLen = s.length - nCheck;
        if (bodyLen <= 0) return MALFORMED();

        const body = s.slice(0, bodyLen);
        const given = s.slice(bodyLen);
        const map = MAPS[params.map] || MAPS.dian;

        let expected = '';
        for (let pass = 0; pass < nCheck; pass++) {
            // The second pass folds in the check digit the first pass produced —
            // that is what makes Brazil's two-digit scheme self-reinforcing.
            const src = body + expected;
            const w = weightsFor(params, pass, src.length);
            if (!w) return MALFORMED();
            let sum = 0;
            for (let i = 0; i < src.length; i++) sum += Number(src[i]) * w[i];
            const d = map(sum % 11);
            if (d === null) return BAD();   // no issuable check digit for this body
            expected += d;
        }
        return expected === given ? OK(expected) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * luhn-modN — Luhn generalised to an alphabet. India's GSTIN is the *
     * live user: base 36 over 0-9 A-Z, check character trailing.        *
     * ---------------------------------------------------------------- */

    function luhnModN(value, params) {
        const alphabet = params.alphabet || '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const n = params.base || alphabet.length;
        const s = alnum(value);
        if (s.length < 2) return MALFORMED();

        const body = s.slice(0, -1);
        const given = s.slice(-1);

        let factor = 2;
        let sum = 0;
        for (let i = body.length - 1; i >= 0; i--) {
            const cp = alphabet.indexOf(body[i]);
            if (cp < 0) return MALFORMED();
            let addend = factor * cp;
            factor = factor === 2 ? 1 : 2;
            // Fold the overflow back in — the base-N equivalent of Luhn's
            // "subtract 9" step.
            addend = Math.floor(addend / n) + (addend % n);
            sum += addend;
        }
        const expected = alphabet[(n - (sum % n)) % n];
        return expected === given ? OK(expected) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * mod9 — Japan's 法人番号. Unusually, the check digit LEADS the      *
     * 12-digit commercial registration number rather than trailing it.  *
     * Q alternates 1,2 counting from the right. A remainder of 0 yields *
     * 9, which is why a corporate number never begins with 0.           *
     * ---------------------------------------------------------------- */

    function mod9(value, params) {
        const s = norm(value);
        const len = params.length || 13;
        if (s.length !== len) return MALFORMED();

        const given = s[0];
        const body = s.slice(1);
        let sum = 0;
        for (let i = 0; i < body.length; i++) {
            const posFromRight = body.length - i;
            sum += Number(body[i]) * (posFromRight % 2 === 1 ? 1 : 2);
        }
        const expected = String(9 - (sum % 9));
        return expected === given ? OK(expected) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * mod89 — Australia's ABN. Subtract 1 from the leading digit, then  *
     * the whole weighted sum must divide by 89 exactly. There is no     *
     * single "check digit" to report back, so `expected` stays unset.   *
     * ---------------------------------------------------------------- */

    function mod89(value, params) {
        const s = norm(value);
        const w = params.weights || [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
        if (s.length !== w.length) return MALFORMED();

        let sum = 0;
        for (let i = 0; i < s.length; i++) {
            const d = Number(s[i]) - (i === 0 ? 1 : 0);
            sum += d * w[i];
        }
        return sum % 89 === 0 ? OK() : BAD();
    }

    /* ---------------------------------------------------------------- *
     * mod97 — IBAN-style. Belgium's VAT number is the user here.        *
     * ---------------------------------------------------------------- */

    function mod97(value, params) {
        const s = norm(value);
        const bodyLen = params.bodyLength || s.length - 2;
        if (s.length !== bodyLen + 2) return MALFORMED();

        const body = Number(s.slice(0, bodyLen));
        if (!Number.isSafeInteger(body)) return MALFORMED();
        const expected = String(97 - (body % 97)).padStart(2, '0');
        return expected === s.slice(bodyLen) ? OK(expected) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * mod511 — France's numéro fiscal: three trailing check digits.     *
     * ---------------------------------------------------------------- */

    function mod511(value, params) {
        const s = norm(value);
        const bodyLen = params.bodyLength || 10;
        if (s.length !== bodyLen + 3) return MALFORMED();

        const body = Number(s.slice(0, bodyLen));
        if (!Number.isSafeInteger(body)) return MALFORMED();
        const expected = String(body % 511).padStart(3, '0');
        return expected === s.slice(bodyLen) ? OK(expected) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * pow2-weighted — Greece's AFM: descending powers of two, mod 11,   *
     * then mod 10 to fold an 11th residue back into a single digit.     *
     * ---------------------------------------------------------------- */

    function pow2Weighted(value, params) {
        const s = norm(value);
        const len = params.length || 9;
        if (s.length !== len) return MALFORMED();

        const body = s.slice(0, len - 1);
        let sum = 0;
        for (let i = 0; i < body.length; i++) {
            sum += Number(body[i]) * Math.pow(2, body.length - i);
        }
        const expected = String((sum % 11) % 10);
        return expected === s[len - 1] ? OK(expected) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * mx-rfc — Mexico's RFC has a scheme of its own: an alphanumeric    *
     * value table, weights descending from 13, mod 11, with 0 and 10    *
     * mapping to '0' and 'A'.                                           *
     *                                                                   *
     * A persona moral RFC is 12 characters, a persona física 13. The    *
     * algorithm always runs over the 12 characters preceding the check  *
     * digit, so the 12-character form is left-padded with a space —     *
     * which is exactly why ' ' carries a value (37) in the table.       *
     * ---------------------------------------------------------------- */

    const RFC_TABLE = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

    function mxRfc(value) {
        const s = alnum(value);
        if (s.length !== 12 && s.length !== 13) return MALFORMED();

        const given = s.slice(-1);
        let body = s.slice(0, -1);
        if (body.length === 11) body = ' ' + body;   // persona moral

        let sum = 0;
        for (let i = 0; i < 12; i++) {
            const v = RFC_TABLE.indexOf(body[i]);
            if (v < 0) return MALFORMED();
            sum += v * (13 - i);
        }
        const r = sum % 11;
        const expected = r === 0 ? '0' : r === 10 ? 'A' : String(11 - r);
        return expected === given ? OK(expected) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * structural — the honest engine. The format regex on the record    *
     * has already run by the time we get here; there is no arithmetic   *
     * check to add, and we say so rather than returning a false OK.     *
     *                                                                   *
     * The US EIN lives here on purpose. The IRS campus prefix list has  *
     * changed repeatedly and is not published as a stable machine-      *
     * readable set, so validating against a copy of it would fail       *
     * legitimate numbers. Format only, and the badge says "format only".*
     * ---------------------------------------------------------------- */

    function structural() {
        return UNCHECKED();
    }

    const ENGINES = {
        'mod11-weighted': mod11Weighted,
        'luhn-modN': luhnModN,
        mod9: mod9,
        mod89: mod89,
        mod97: mod97,
        mod511: mod511,
        'pow2-weighted': pow2Weighted,
        'mx-rfc': mxRfc,
        structural: structural,
    };

    // Validate one value against one identifier definition from a registry
    // record. Format is checked first so a typo reports as a format problem
    // rather than as a failed checksum.
    function validate(value, identifier) {
        const raw = String(value || '').trim();
        if (!raw) return { status: 'empty' };

        // Reserved administrative constants. SAT's XAXX010101000 (público en
        // general) is the case that forces this: it is a legitimate, mandated
        // value that does NOT satisfy the RFC check-digit algorithm. Running the
        // arithmetic on it would report a real number as broken, so records
        // declare these explicitly and we short-circuit before any engine runs.
        const canon = raw.toUpperCase().replace(/[\s.-]/g, '');
        if (identifier.reserved && identifier.reserved.indexOf(canon) !== -1) {
            return { status: 'reserved' };
        }

        if (identifier.format) {
            const re = new RegExp(identifier.format, 'i');
            if (!re.test(raw.toUpperCase().replace(/[\s.-]/g, ''))) return MALFORMED();
        }

        const spec = identifier.checksum || { engine: 'structural' };
        const engine = ENGINES[spec.engine];
        if (!engine) return UNCHECKED();
        return engine(raw, spec);
    }

    window.FiscalEngines = { validate: validate, engines: ENGINES, MAPS: MAPS };
})();
