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
//   { status: <one of the states below>, expected?: string }
//
// `expected` is the check character the rule computes, and it is present only
// when the rule could compute it from a body it is sure of. An identifier whose
// body varies in length cannot always tell its check character from the last
// character of the body, and a suggested digit that rests on the wrong reading
// is worse than no suggestion at all, so in that case it is simply absent.
//
//   ok             the check digit was computed and it matches
//   bad-check      the check digit was computed and it does not match
//   bad-format     the value is not the shape the authority prints
//   unchecked      the authority publishes no check rule for this identifier
//   unimplemented  a published rule exists and this build did not run it —
//                  either because no engine here implements it, or because the
//                  value did not say where its body ends (see splitIsCertain)
//   not-issuable   the authority could never have issued this value
//   refused        this app declines to hold a number of this kind at all
//   reserved       an administrative constant that is exempt from the rule
//   empty          nothing was entered
//
// 'unchecked' and 'unimplemented' are deliberately separate. One is a fact
// about the jurisdiction, the other is a fact about this build, and a user
// deciding how far to trust a badge needs to know which one they are looking
// at. Neither of them may ever read like 'ok'.
//
// PROVENANCE: every weight vector below is cited to the rule it implements.
// A rule with no citation does not belong here — it belongs in `structural`
// until someone verifies it. Cross-check candidates against python-stdnum
// (LGPL-2.1-or-later, upgrade-compatible with this project's AGPL-3.0) before
// promoting a jurisdiction to tier 1 or 2.

(function () {
    'use strict';

    // `serial` is the part of the value the authority allocated, as the rule
    // that just ran reads it — everything else is a check character the rule
    // computed or a prefix the authority prints. Only the engine knows where
    // that split falls, so only the engine may state it. validate() strips it
    // off before the result leaves this file; see zeroSerial below.
    const OK = (expected, serial) => ({ status: 'ok', expected, serial });
    const BAD = (expected) => ({ status: 'bad-check', expected });
    const MALFORMED = () => ({ status: 'bad-format' });
    const UNCHECKED = () => ({ status: 'unchecked' });
    const UNIMPLEMENTED = () => ({ status: 'unimplemented' });
    const NOT_ISSUABLE = () => ({ status: 'not-issuable' });

    // Digits only. Chile's check character may be K, so it survives normalisation
    // everywhere — anywhere else a stray K simply fails the comparison.
    function norm(value) {
        return String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
    }

    function alnum(value) {
        return String(value || '').toUpperCase().replace(/[^0-9A-Z&Ñ]/g, '');
    }

    // Brazil's alphanumeric CNPJ values a body character by its ASCII code less
    // 48, so & and Ñ — which alnum() keeps for Mexico — would come out negative.
    // This normaliser keeps exactly the character set that rule is defined over.
    function normAlnumStrict(value) {
        return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    }

    // Separators as printed on the document. The slash is Brazil's: a CNPJ is
    // printed 11.222.333/0001-81 and that is the string the user copies.
    function canonical(value) {
        return String(value || '').toUpperCase().replace(/[\s./-]/g, '');
    }

    // Format regexes come from JSON, are reused on every keystroke, and never
    // carry the g flag, so one compiled copy per pattern is safe and free.
    const RE_CACHE = new Map();
    function formatRe(pattern) {
        let re = RE_CACHE.get(pattern);
        if (!re) {
            re = new RegExp(pattern, 'i');
            RE_CACHE.set(pattern, re);
        }
        return re;
    }

    /* ---------------------------------------------------------------- *
     * mod11-weighted — by far the largest family.                       *
     *                                                                   *
     * params:                                                           *
     *   weights  number[]  | number[][]  right-aligned over the body;   *
     *                                    array-of-arrays when digits=2  *
     *   cycle    number[]                repeated right-to-left instead *
     *   digits   1 | 2                   how many check digits trail     *
     *   map      string                  remainder -> check character    *
     *   charValue 'ascii-48'             body may hold letters          *
     *   bodyLengths number[]             body lengths the authority     *
     *                                    issues at, when more than one  *
     * ---------------------------------------------------------------- */

    // The remainder mappings are where countries actually differ. Naming them
    // keeps registry files readable: "map": "dian" says what it is.
    const MAPS = {
        // Colombia (DIAN): r < 2 keeps the remainder, otherwise 11 - r.
        dian: (r) => (r < 2 ? String(r) : String(11 - r)),
        // Brazil (CPF, CNPJ) and Portugal (NIF): r < 2 collapses to 0.
        'lt2-zero': (r) => (r < 2 ? '0' : String(11 - r)),
        // Chile (RUT): 11 -> 0, 10 -> K.
        'sub11-k': (r) => { const v = 11 - r; return v === 11 ? '0' : v === 10 ? 'K' : String(v); },
        // Argentina (CUIT): 11 -> 0; a would-be 10 means the number is not issuable.
        sub11: (r) => { const v = 11 - r; return v === 11 ? '0' : v === 10 ? null : String(v); },
        // Peru (RUC): 10 -> 0, 11 -> 1.
        peru: (r) => { const v = 11 - r; return v === 10 ? '0' : v === 11 ? '1' : String(v); },
        // Poland (NIP): the remainder IS the digit; a remainder of 10 is not issuable.
        nip: (r) => (r === 10 ? null : String(r)),
    };

    // Authorities publish these vectors right-to-left from the check digit, and
    // the ones that serve more than one body length (DIAN's NIT sits on an 8-,
    // 9- or 10-digit cédula) simply use as many of the trailing weights as the
    // body needs. Right-aligning here is what makes a variable-length record
    // expressible as data rather than as a change to this file. A vector too
    // short for the body cannot be right-aligned at all, and saying so is the
    // job of tools/validate.py rather than of a silent wrong answer.
    function weightsFor(params, pass, len) {
        if (params.cycle) {
            // Right-to-left repeating cycle (Chile). Build it left-aligned so the
            // main loop stays a single forward pass.
            const w = new Array(len);
            for (let i = 0; i < len; i++) w[len - 1 - i] = params.cycle[i % params.cycle.length];
            return w;
        }
        const raw = Array.isArray(params.weights[0]) ? params.weights[pass] : params.weights;
        if (!raw) return null;
        if (raw.length === len) return raw;
        return raw.length > len ? raw.slice(raw.length - len) : null;
    }

    // Where the body ends and the check begins is a reading, not a fact. For a
    // fixed-length identifier there is only one reading and nothing to decide,
    // but a Colombian NIT sits on a cédula of 8, 9 or 10 digits, so a bare ten
    // digits are either a nine-digit body and its verification digit or a
    // ten-digit body with the digit still missing — the same string, two
    // different answers. `bodyLengths` is where a record says its body varies;
    // when both readings are admissible, only the value written the way DIAN
    // prints it, with the digit apart from the body, states which is meant.
    //
    // A match under a reading nobody chose is not a verdict. The body of a
    // Colombian company NIT is nine digits and DIAN prints its verification
    // digit in a separate box, so nine bare digits are how the number is
    // usually spoken — and read as an eight-digit body and a digit, one in ten
    // of them satisfies the modulus by coincidence. That was a green badge on a
    // number with its last character still missing, which is the one answer this
    // app must never give. A mismatch is safe to report either way, because the
    // value is wrong under one reading and incomplete under the other; a match
    // is only safe when the value said where its body ends.
    const TRAILING_GROUP = /[\s./-]([0-9A-Za-z]+)$/;

    function splitIsCertain(raw, len, nCheck, params) {
        const lengths = params.bodyLengths;
        if (!lengths) return true;
        if (lengths.indexOf(len - nCheck) === -1 || lengths.indexOf(len) === -1) return true;
        const tail = TRAILING_GROUP.exec(String(raw).trim());
        return !!tail && tail[1].length === nCheck;
    }

    function mod11Weighted(value, params) {
        const ascii = params.charValue === 'ascii-48';
        const s = ascii ? normAlnumStrict(value) : norm(value);
        const nCheck = params.digits || 1;
        const bodyLen = s.length - nCheck;
        if (bodyLen <= 0) return MALFORMED();

        const body = s.slice(0, bodyLen);
        const given = s.slice(bodyLen);
        const map = MAPS[params.map] || MAPS.dian;

        let expected = '';
        for (let pass = 0; pass < nCheck; pass++) {
            // The second pass folds in the check digit the first pass produced —
            // that is what makes Brazil's two-digit scheme self-reinforcing. It is
            // always a digit, so ASCII-48 and Number() agree on it.
            const src = body + expected;
            const w = weightsFor(params, pass, src.length);
            if (!w) return UNIMPLEMENTED();
            let sum = 0;
            for (let i = 0; i < src.length; i++) {
                sum += (ascii ? src.charCodeAt(i) - 48 : Number(src[i])) * w[i];
            }
            const d = map(sum % 11);
            if (d === null) return BAD();   // no issuable check digit for this body
            expected += d;
        }
        const certain = splitIsCertain(value, s.length, nCheck, params);
        if (expected === given) return certain ? OK(expected, body) : UNIMPLEMENTED();
        return certain ? BAD(expected) : BAD();
    }

    /* ---------------------------------------------------------------- *
     * luhn-modN — Luhn generalised to an alphabet. India's GSTIN is the *
     * live user: base 36 over 0-9 A-Z, check character trailing. Base   *
     * 10 over the digits is plain Luhn, which is Canada's Business      *
     * Number, France's SIREN and Italy's Partita IVA.                   *
     *                                                                   *
     * `length` is for an identifier that carries a program suffix past  *
     * the check character — a Canadian BN is 9 digits plus an optional  *
     * RT0001 account, and the check covers the 9 only.                  *
     * ---------------------------------------------------------------- */

    function luhnModN(value, params) {
        const alphabet = params.alphabet || '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const n = params.base || alphabet.length;
        const all = alnum(value);
        const s = params.length ? all.slice(0, params.length) : all;
        if (s.length < 2) return MALFORMED();
        if (params.length && all.length < params.length) return MALFORMED();

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
        return expected === given ? OK(expected, body) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * mod9 — Japan's 法人番号, and the qualified-invoice registration    *
     * number a corporation gets, which is T plus that same number.      *
     * Unusually, the check digit LEADS the 12-digit commercial          *
     * registration number rather than trailing it. Q alternates 1,2     *
     * counting from the right. A remainder of 0 yields 9, which is why  *
     * a corporate number never begins with 0.                           *
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
        return expected === given ? OK(expected, body) : BAD(expected);
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
        // The two leading digits are the pair the ATO prepends to the nine
        // it issues, so the serial is what follows them.
        return sum % 89 === 0 ? OK(undefined, s.slice(2)) : BAD();
    }

    /* ---------------------------------------------------------------- *
     * mod97 — IBAN-style. Belgium's VAT number is the user here.        *
     * ---------------------------------------------------------------- */

    function mod97(value, params) {
        const s = norm(value);
        const bodyLen = params.bodyLength || s.length - 2;
        if (s.length !== bodyLen + 2) return MALFORMED();

        const serial = s.slice(0, bodyLen);
        const body = Number(serial);
        if (!Number.isSafeInteger(body)) return MALFORMED();
        const expected = String(97 - (body % 97)).padStart(2, '0');
        return expected === s.slice(bodyLen) ? OK(expected, serial) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * gb-vat — HMRC's own modulus 97. The seven leading digits are      *
     * weighted 8..2 and the two check digits complete a multiple of 97. *
     * Numbers issued from 2010 carry the "9755" variant, which is the   *
     * same sum shifted by 55, so a valid number satisfies one or the    *
     * other and there is no way to tell from the number which.          *
     *                                                                   *
     * That is also why a failure names no pair. Two pairs are admissible *
     * and the number does not say which register it came from, so       *
     * offering one of them steers half the holders it is offered to onto *
     * a VRN that belongs to somebody else — and it is a real VRN, which  *
     * is the worst suggestion this app could print.                      *
     * ---------------------------------------------------------------- */

    function gbVat(value) {
        const s = norm(value);
        // The 12-digit form is a branch trader: the last three identify the
        // branch and take no part in the check.
        if (s.length !== 9 && s.length !== 12) return MALFORMED();

        const w = [8, 7, 6, 5, 4, 3, 2];
        let sum = 0;
        for (let i = 0; i < 7; i++) sum += Number(s[i]) * w[i];

        const given = s.slice(7, 9);
        const classic = String((97 - (sum % 97)) % 97).padStart(2, '0');
        const post2010 = String((97 - ((sum + 55) % 97)) % 97).padStart(2, '0');
        if (given === classic || given === post2010) return OK(given, s.slice(0, 7));
        return BAD();
    }

    /* ---------------------------------------------------------------- *
     * mod511 — France's numéro fiscal: three trailing check digits.     *
     * ---------------------------------------------------------------- */

    function mod511(value, params) {
        const s = norm(value);
        const bodyLen = params.bodyLength || 10;
        if (s.length !== bodyLen + 3) return MALFORMED();

        const serial = s.slice(0, bodyLen);
        const body = Number(serial);
        if (!Number.isSafeInteger(body)) return MALFORMED();
        const expected = String(body % 511).padStart(3, '0');
        return expected === s.slice(bodyLen) ? OK(expected, serial) : BAD(expected);
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
        return expected === s[len - 1] ? OK(expected, body) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * iso7064-11-10 — Germany's USt-IdNr. A running product carried     *
     * across the body, alternating mod 10 and mod 11, with the digit    *
     * that closes it as the check.                                      *
     * ---------------------------------------------------------------- */

    function iso7064_11_10(value, params) {
        const s = norm(value);
        const len = params.length || s.length;
        if (s.length !== len || !/^[0-9]+$/.test(s)) return MALFORMED();

        let p = 10;
        for (let i = 0; i < len - 1; i++) {
            const m = (Number(s[i]) + p) % 10 || 10;
            p = (2 * m) % 11;
        }
        const expected = String((11 - p) % 10);
        return expected === s[len - 1] ? OK(expected, s.slice(0, len - 1)) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * es-nif — Spain runs three rules under one nine-character shape.   *
     * A DNI is eight digits plus a letter from a mod-23 table; an NIE   *
     * is the same rule once the leading X/Y/Z is read back as the 0/1/2 *
     * it stands for; a CIF is an entity-type letter, seven digits and a *
     * control that is a digit for some entity types, a letter for       *
     * others, and whichever the register assigned for the rest.         *
     * ---------------------------------------------------------------- */

    const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
    const CIF_LETTERS = 'JABCDEFGHI';

    function esNif(value) {
        const s = alnum(value);
        if (s.length !== 9 || !/^[0-9]{7}$/.test(s.slice(1, 8))) return MALFORMED();

        const head = s[0];
        const given = s[8];
        const nie = 'XYZ'.indexOf(head);
        if (nie !== -1 || /[0-9]/.test(head)) {
            const digits = (nie === -1 ? head : String(nie)) + s.slice(1, 8);
            const expected = NIF_LETTERS[Number(digits) % 23];
            return expected === given ? OK(expected, digits) : BAD(expected);
        }

        let sum = 0;
        for (let i = 1; i <= 7; i++) {
            const d = Number(s[i]);
            if (i % 2 === 1) { const x = d * 2; sum += Math.floor(x / 10) + (x % 10); }
            else sum += d;
        }
        const n = (10 - (sum % 10)) % 10;
        const digit = String(n);
        const letter = CIF_LETTERS[n];
        // K is a minor without a DNI; P, Q, R, S, N and W are bodies whose
        // control the register always issues as a letter. L and M are natural
        // persons too but fall to the branch below, which takes either.
        const serial = s.slice(1, 8);
        if ('KPQRSNW'.indexOf(head) !== -1) return letter === given ? OK(letter, serial) : BAD(letter);
        if ('ABEH'.indexOf(head) !== -1) return digit === given ? OK(digit, serial) : BAD(digit);
        // Every other entity type takes either control and the register decided
        // which, so naming one of the two would send half of them to a NIF that
        // is not theirs. The mismatch is reported; the character is not.
        return given === digit || given === letter ? OK(given, serial) : BAD();
    }

    /* ---------------------------------------------------------------- *
     * it-cf — Italy's codice fiscale check character (CIN). Odd and     *
     * even positions read from two different tables, summed mod 26 and  *
     * turned back into a letter. Omocodia substitutions need no special *
     * handling: the CIN is computed over the characters as printed.     *
     *                                                                   *
     * An eleven-digit codice fiscale is an entity's, and is the same    *
     * number as its Partita IVA, so it takes the Partita IVA's Luhn.    *
     * ---------------------------------------------------------------- */

    const CF_ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const CF_ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21,
                    1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11,
                    3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];

    function itCf(value) {
        const s = alnum(value);
        if (/^[0-9]{11}$/.test(s)) return luhnModN(s, { alphabet: '0123456789', base: 10 });
        if (s.length !== 16) return MALFORMED();

        let sum = 0;
        for (let i = 0; i < 15; i++) {
            const at = CF_ALPHA.indexOf(s[i]);
            if (at < 0) return MALFORMED();
            sum += i % 2 === 0 ? CF_ODD[at] : (at < 10 ? at : at - 10);
        }
        const expected = String.fromCharCode(65 + (sum % 26));
        return expected === s[15] ? OK(expected, s.slice(0, 15)) : BAD(expected);
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
        return expected === given ? OK(expected, s.slice(0, -1)) : BAD(expected);
    }

    /* ---------------------------------------------------------------- *
     * structural — the honest engine, for an identifier its authority   *
     * publishes no check rule for at all. The format regex on the       *
     * record has already run by the time we get here; there is no       *
     * arithmetic to add, and we say so rather than returning a false OK.*
     *                                                                   *
     * The US EIN lives here on purpose. The IRS campus prefix list has  *
     * changed repeatedly and is not published as a stable machine-      *
     * readable set, so validating against a copy of it would fail       *
     * legitimate numbers. Format only, and the badge says "format only".*
     *                                                                   *
     * unimplemented — for an identifier that DOES have a published rule *
     * this build does not run. Mexico's CURP is the case that forces    *
     * the distinction: RENAPO publishes its check digit, and legacy     *
     * issuances are known not to satisfy it, so enforcing it would call *
     * real cards broken. Saying "no rule exists" there would be a lie   *
     * about Mexico; saying "not checked here" is the truth about us.    *
     * ---------------------------------------------------------------- */

    function structural() {
        return UNCHECKED();
    }

    function unimplemented() {
        return UNIMPLEMENTED();
    }

    // Two of the authorities' own algorithms have a blind spot a user can hit by
    // mistyping one character in a place they could be told to look at again,
    // and the badge should not imply otherwise. This is a property of the rule,
    // not of the jurisdiction, so it lives beside the engines rather than being
    // authored into every record that uses one. `ok` stays `ok` — the check
    // digit really did match — and the caller decides how to say the rest.
    //
    // The mod-11 engines are not listed, and that is a decision rather than an
    // omission. Every scheme here that folds an eleventh residue back into a
    // single digit — Colombia's `dian`, Brazil's `lt2-zero`, Greece's fold to
    // mod 10 — loses one residue class and so misses roughly one substitution in
    // eleven, which is true of nearly every national check digit ever published.
    // Saying it on almost every badge would say nothing. What is listed is what
    // a person could act on: look at that character again.
    const WEAK = {
        // SAT weights the padded body 13 down to 2, so the third character is
        // multiplied by 11 and contributes nothing mod 11. That character is the
        // name block, which is where a transcription error actually lands.
        'mx-rfc': 'rfc-weight-11',
        // Modulus 9 cannot tell 0 from 9.
        mod9: 'mod9-zero-nine',
    };

    const ENGINES = {
        'mod11-weighted': mod11Weighted,
        'luhn-modN': luhnModN,
        mod9: mod9,
        mod89: mod89,
        mod97: mod97,
        'gb-vat': gbVat,
        mod511: mod511,
        'pow2-weighted': pow2Weighted,
        'iso7064-11-10': iso7064_11_10,
        'es-nif': esNif,
        'it-cf': itCf,
        'mx-rfc': mxRfc,
        structural: structural,
        unimplemented: unimplemented,
    };

    // Numbers this app declines to hold. The refusal of an SSN and of a My
    // Number is the sharpest promise the product makes, so it is enforced here
    // rather than explained in the editor: an identifier that could receive one
    // carries the detector, and every caller of validate() gets the refusal for
    // free — editor, card, import and share alike.
    //
    // The pattern is matched against the value AS TYPED, before separators are
    // stripped. An SSN and an EIN are the same nine digits once the punctuation
    // is gone, and the punctuation is the whole signal: an EIN is written
    // ##-#######, an SSN ###-##-####. The record's `refused` list holds the copy
    // that explains the refusal, keyed by the same name.
    function refusalFor(value, identifier) {
        const rules = identifier && identifier.refuses;
        if (!rules) return null;
        const raw = String(value || '').trim().normalize('NFKC');
        if (!raw) return null;
        for (let i = 0; i < rules.length; i++) {
            if (formatRe(rules[i].pattern).test(raw)) return rules[i];
        }
        return null;
    }

    // No authority's first serial is zero, and a body of nothing but zeros sums
    // to zero under every weighting here — so the check character follows from
    // it and the arithmetic on its own would call the value correct. That is the
    // one verdict this app must never reach for a number nobody was issued, and
    // it is general enough to belong beside the engines rather than in a list
    // per record.
    //
    // What it must not do is guess where the body ends. An earlier version saw
    // only the canonical string, took a window off each end for the check
    // characters and read what was left as digits — and condemned real numbers
    // for it, because Brazil's alphanumeric CNPJ scatters its digits wherever
    // the letters leave room, so the window lands on the check digits
    // themselves. The split is part of the rule, so the engine that ran the rule
    // is what states it: `serial` is what the authority allocated and everything
    // else is a check character it computed. Where no arithmetic ran there is no
    // split to make, and all of it was allocated but the scheme prefix.
    //
    // A serial condemns itself only by being zeros character for character.
    // Letters make a value a candidate for issue rather than a zero serial —
    // ABCDEFGHIJKL80 is a CNPJ Receita can hand out — and Banco do Brasil's
    // 00.000.000/0001-91 is why the test stops at the serial and not at the
    // number: an all-zero root is issued, an all-zero serial is not.
    //
    // Anything narrower is a fact about one authority and belongs in that
    // record's `denied` list, where it can be cited: South Africa's VAT number
    // begins with a 4, so its zero serial is not a string of zeros, and Japan's
    // corporate number carries a leading check digit that a zero body forces to
    // 9. Both are listed where they can be read.
    function zeroSerial(serial) {
        return serial.length > 0 && /^0+$/.test(serial);
    }

    // Validate one value against one identifier definition from a registry
    // record. Format is checked first so a typo reports as a format problem
    // rather than as a failed checksum.
    function validate(value, identifier) {
        // A Japanese IME types full-width digits and a Gulf keyboard types
        // Arabic-Indic ones. Fold them here, once, so no engine has to know.
        const raw = String(value || '').trim().normalize('NFKC');
        if (!raw) return { status: 'empty' };

        // A saved card outlives the record it was written against, and a record
        // is data that changes. With no definition there is no rule to run, and
        // an honest amber badge on one field beats an exception that blanks the
        // whole card on the counter.
        if (!identifier) return UNCHECKED();

        const refusal = refusalFor(raw, identifier);
        if (refusal) return { status: 'refused', refused: refusal.key };

        // Reserved administrative constants. SAT's XAXX010101000 (público en
        // general) is the case that forces this: it is a legitimate, mandated
        // value that does NOT satisfy the RFC check-digit algorithm. Running the
        // arithmetic on it would report a real number as broken, so records
        // declare these explicitly and we short-circuit before any engine runs.
        const canon = canonical(raw);
        if (identifier.reserved && identifier.reserved.indexOf(canon) !== -1) {
            return { status: 'reserved' };
        }

        if (identifier.format && !formatRe(identifier.format).test(canon)) {
            return MALFORMED();
        }

        const spec = identifier.checksum || { engine: 'structural' };
        const engine = ENGINES[spec.engine];
        if (!engine) return UNIMPLEMENTED();
        const result = engine(raw, spec);

        // Which characters the authority allocated is the engine's own reading
        // of its rule and is nobody else's business, so it is taken here and
        // removed: callers read `status`, `expected` and `weak` and nothing
        // else. An engine that computed nothing has split nothing either, so
        // all of it was allocated — less the scheme prefix an authority prints
        // in front of the number, which is the one part nobody was issued.
        const serial = result.serial === undefined
            ? canon.replace(/^[A-Z]+/, '') : result.serial;
        delete result.serial;

        // The mirror image of `reserved`: values the arithmetic happens to
        // accept and the authority never issued. Every repeated-digit CPF
        // satisfies Brazil's mod 11, which is exactly why Receita Federal
        // rejects them by rule instead, and the same holds for the all-zero
        // serial in half a dozen other countries.
        //
        // It runs last, over a verdict the arithmetic had nothing left to say
        // about, because its only job is to overturn an acceptance. Nine of the
        // ten repeated-digit CNPJs already fail the check digit, and a rule
        // meant to make a fake number read as worse must never be the reason it
        // reads as better: a value the arithmetic rejected keeps its rejection.
        const settled = result.status === 'ok' || result.status === 'unchecked'
            || result.status === 'unimplemented';
        if (settled) {
            const listed = identifier.denied && identifier.denied.indexOf(canon) !== -1;
            if (listed || zeroSerial(serial)) return NOT_ISSUABLE();
        }
        if (result.status === 'ok' && WEAK[spec.engine]) result.weak = WEAK[spec.engine];
        return result;
    }

    // A `fields` entry may carry a format too — Mexico's postal code is a CFDI
    // 4.0 required value and five digits is the whole rule. This is a typo gate,
    // not a verification: it returns { status: 'bad-format' } when the value
    // fails the pattern and null when there is nothing to say — no format, no
    // value, or a value that fits — so a correct entry can never sprout a badge
    // implying a check that never happened. Do not route a field through
    // validate() instead: with no checksum it falls to `structural` and comes
    // back `unchecked`, which would put a check-digit caveat on every correctly
    // typed postal code.
    //
    // Unlike an identifier the value is matched as typed, only trimmed and
    // NFKC-folded. An identifier is canonicalised first because authorities
    // print them with punctuation that is not part of the number; a field is
    // free text with a shape, so its pattern is written against what the user
    // actually types and may require punctuation and get it.
    function checkField(value, field) {
        if (!field || !field.format) return null;
        const raw = String(value || '').trim().normalize('NFKC');
        if (!raw) return null;
        return formatRe(field.format).test(raw) ? null : MALFORMED();
    }

    window.FiscalEngines = {
        validate: validate,
        checkField: checkField,
        refusalFor: refusalFor,
        engines: ENGINES,
        MAPS: MAPS,
        WEAK: WEAK,
    };
})();
