// Carino Fiscal — getting data out.
//
// Four ways off the device, and the choice between them is not cosmetic:
//
//   vCard QR   the only payload every phone camera decodes with no app. This is
//              what actually works for handing your details to a person.
//   PNG card   because in Mexico and Colombia this transaction really happens
//              over WhatsApp, and an image beats a link there every time.
//   #fragment  a link whose payload lives after the '#', which browsers never
//              send to the server. That is what makes a shareable URL possible
//              at all without this project growing a database of tax IDs.
//   Bridge     window-to-window handoff into another Carino tool (Quote), so
//              the data never even reaches a URL.
//
// Three rules run through all of it. Everything leaves as UTF-8, because a name
// that arrives as plausible garbage is worse than a share that fails. Every
// payload of our own carries a checksum, because a tax identifier that arrives
// altered gets read out at a counter as if it were right. And a number this app
// refuses to hold leaves by none of these routes and arrives by none of them —
// a promise kept only at the wallet is a promise kept nowhere, because every
// one of these paths reaches a phone, a chat thread or a contacts book that the
// wallet's rules have no say over.
//
// A link written before that checksum existed still opens, because someone's
// chat history is not their fault — but it can never be shown as checked, and
// there is no way to get a card out of readShared() without being handed the
// word for which of the two it is. That is why the reader returns a wrapper
// rather than the card: a flag on a card is a flag a renderer can drop without
// noticing, and an unverifiable card that renders like a checked one is the
// exact failure this file exists to prevent.
//
// Deliberately absent: a server-side short link. One /miguel endpoint would
// make this project the controller of a store of tax identifiers, which is the
// single change that would undo everything the privacy posture buys.

(function () {
    'use strict';

    const QUOTE = 'https://quote.carino.systems/';

    // Version 40 at error correction 'M' holds this much; past it the vendored
    // encoder throws instead of returning anything.
    const QR_MAX_BYTES = 2331;

    /* ================= bytes ================= */

    // One encoder for the whole file — the base64 payloads, the QR, the vCard.
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    // Fatal, so a payload that is not valid UTF-8 throws instead of quietly
    // becoming replacement characters inside an otherwise plausible card.
    const strictDec = new TextDecoder('utf-8', { fatal: true });

    function utf8(str) {
        return enc.encode(String(str == null ? '' : str));
    }

    function byteLength(str) {
        return utf8(str).length;
    }

    // The vendored encoder ships two byte functions and binds the wrong one:
    // its default truncates every character to `charCode & 0xff`, so 株式会社
    // becomes four unrelated ASCII bytes and Цветкова becomes '&25B:>20' —
    // without ever failing, which is the shape of error this app exists to
    // avoid. Everything goes out as UTF-8 instead.
    //
    // No ECI 26 header rides in front of it: the vendored library writes a
    // segment as mode plus length plus data and has no way to emit an ECI
    // header at all, and byte mode with no ECI is what phone scanners already
    // sniff for. Changing that means changing vendor/, and this is the encoder
    // every reader in the field actually expects.
    function qrBytes(s) {
        return Array.from(utf8(s));
    }

    /* ================= payloads ================= */

    // vCard 4.0. The tax data rides in a NOTE plus X- fields: NOTE is what every
    // contacts app will actually show, the X- fields are what a machine can read
    // back. ORG for a business card, N/FN for a personal one.
    function vcard(card, rec, lines, countryName) {
        // A contacts app is the least controllable place a number can land: it
        // syncs, it backs up, it is read by whatever else the phone lets in. A
        // value this app refuses does not go there, and neither does the counter
        // line the caller built out of it.
        const safe = scrub(card, rec);
        const clean = safe.card;
        const values = clean.values;
        const name = legalName(clean);
        const fn = name || [countryName || clean.iso, primaryId(clean, rec)].filter(Boolean).join(' ');

        const out = ['BEGIN:VCARD', 'VERSION:4.0'];
        out.push('KIND:' + (clean.kind === 'business' ? 'org' : 'individual'));
        out.push('FN:' + esc(fn));

        if (clean.kind === 'business') {
            out.push('ORG:' + esc(fn));
            // Apple Contacts still decides person-or-company from this rather
            // than from KIND.
            out.push('X-ABShowAs:COMPANY');
            out.push('N:;;;;');
        } else if (name) {
            // One free-text name and no way to know where the surname starts:
            // a Spanish name carries two of them, so splitting on whitespace
            // asserts a surname that is not one. The given-name slot claims
            // less than the family slot does.
            out.push('N:;' + esc(name) + ';;;');
        } else {
            // FN is a country and a number here. Naming the card after the
            // user's private nickname for it, which is what this used to do,
            // hands a clerk a contact called 'Yo en Colombia'.
            out.push('N:;;;;');
        }

        if (values.email) out.push('EMAIL:' + esc(values.email));
        const addr = values.address || values.direccion;
        if (addr) {
            out.push('ADR:;;' + esc(addr) + ';;;' + esc(values.cp || '') + ';' + esc(countryName));
        }

        // The identifiers, machine-readable.
        shownIdentifiers(rec, clean).forEach((ident) => {
            const v = values[ident.key];
            if (v) out.push('X-TAXID-' + ident.key.toUpperCase() + ':' + esc(v));
        });
        out.push('X-TAXID-COUNTRY:' + clean.iso);

        out.push('NOTE:' + esc(countryName + ' — '
            + safeLines(lines, safe.hidden, clean.iso).join('\n')));
        out.push('END:VCARD');

        // RFC 6350: CRLF between lines, one at the end, and no line longer than
        // 75 octets unfolded.
        return out.map(fold).join('\r\n') + '\r\n';
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/([\\,;])/g, '\\$1')
            .replace(/\r\n|[\r\n]/g, '\\n');
    }

    // Fold at 75 octets, counting the leading space a continuation line carries.
    // Counting characters instead would break the moment a name is not ASCII,
    // and cutting between the bytes of one character would break it worse.
    function fold(line) {
        const bytes = utf8(line);
        if (bytes.length <= 75) return line;

        const parts = [];
        let start = 0;
        let width = 75;
        while (bytes.length - start > width) {
            let end = start + width;
            while (end > start + 1 && (bytes[end] & 0xc0) === 0x80) end--;
            parts.push(dec.decode(bytes.subarray(start, end)));
            start = end;
            width = 74;
        }
        parts.push(dec.decode(bytes.subarray(start)));
        return parts.join('\r\n ');
    }

    function legalName(card) {
        const v = card.values || {};
        return v.razonSocial || v.legalName || v.nombre || '';
    }

    function primaryId(card, rec) {
        const v = card.values || {};
        return shownIdentifiers(rec, card).map((i) => v[i.key]).filter(Boolean)[0] || '';
    }

    // The identifiers this jurisdiction puts on an invoice for this kind of
    // card, in the order the app shows them — and nothing else. A record can
    // define identifiers its invoice profile leaves out (Mexico's CURP, a US
    // EIN on a personal card), and a stored card can still hold a value for one
    // after the user switched kind. What is not on the screen the user is
    // holding out has no business riding out in the vCard behind it.
    function shownIdentifiers(rec, card) {
        const kind = card.kind === 'business' ? 'business' : 'personal';
        const prof = ((rec && rec.invoiceProfile) || {})[kind] || {};
        const keys = (prof.required || []).concat(prof.optional || []);
        const idents = (rec && rec.identifiers) || [];
        return keys.map((k) => idents.find((i) => i.key === k)).filter(Boolean);
    }

    /* ================= our own payloads ================= */

    // FNV-1a over the exact bytes about to be encoded. Base64 is byte-aligned
    // and JSON survives a changed character inside a string, so without this a
    // link mangled in transit — retyped by hand, chewed by a chat client's link
    // detector — decodes into a different identifier and renders with the
    // ordinary badges. Eight characters buy a clean refusal instead.
    //
    // It is a checksum, not a signature: unkeyed, so anyone can recompute it
    // over a card they made up. A card that arrives in a link is unverified and
    // the UI has to keep saying so.
    function fnv1a(bytes) {
        let h = 0x811c9dc5;
        for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i];
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    // Checksumming the exact string we are about to encode is what removes any
    // need for a canonical JSON: there is only ever one serialisation to compare
    // against.
    //
    // Returns '' for a card with nothing left to send. A payload with no values
    // is one this app's own reader calls damage, so writing one would hand the
    // user a link that fails on arrival for a reason that has nothing to do with
    // what went wrong.
    function pack(card, rec) {
        const clean = scrub(card, rec).card;
        if (!Object.keys(clean.values).length) return '';
        const json = JSON.stringify({
            v: 2,
            iso: clean.iso,
            kind: clean.kind,
            // Capped as store.js caps it, and blanked if a number was typed
            // into it. Writing a longer label would produce a link this app's
            // own reader then refuses, which is the worst kind of refusal: one
            // that fires on a legitimate card.
            label: clean.label,
            values: clean.values,
        });
        return b64url(fnv1a(utf8(json)) + json);
    }

    // Two payload shapes are in the field, and both have to open. The current
    // one writes the checksum in front of the JSON; the first release wrote the
    // JSON alone. A link already in someone's chat history was made in good
    // faith and is read, flagged as unverified — but a payload that claims a
    // checksum and fails it is damage, and stays refused. Telling them apart
    // costs one look at the first character: JSON starts with a brace, and the
    // checksum is eight hex digits that cannot be one.
    function unpack(token) {
        const s = unb64url(token);
        const m = /^([0-9a-f]{8})(\{[\s\S]*)$/.exec(s);
        if (m) {
            if (fnv1a(utf8(m[2])) !== m[1]) return null;
            return { data: JSON.parse(m[2]), verified: true };
        }
        if (s.charAt(0) !== '{') return null;
        return { data: JSON.parse(s), verified: false };
    }

    // A versioned compact payload of our own, so there is somewhere to grow into
    // if a buyer-identity standard ever appears. Kept next to the vCard rather
    // than instead of it, because nothing decodes this today but us.
    function carinoPayload(card, rec) {
        const token = pack(card, rec);
        return token ? 'CFID2:' + token : '';
    }

    function b64url(str) {
        const bytes = utf8(str);
        let bin = '';
        bytes.forEach((b) => { bin += String.fromCharCode(b); });
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function unb64url(str) {
        const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return strictDec.decode(bytes);
    }

    // A link that carries the card in its fragment. The fragment is never put on
    // the wire, so origin logs, proxies and the server itself never see it — but
    // it does land in history and clipboards, which the UI says out loud.
    function shareLink(card, rec) {
        const token = pack(card, rec);
        return token ? location.origin + location.pathname + '#card=' + token : '';
    }

    // Why the last read failed, for the caller to say out loud. A link that
    // fails must not look like no link at all — the user is standing in front of
    // someone who just handed them one, and silence tells them the app is
    // broken when what happened is that the link is. These five values are the
    // whole set; nothing else is ever returned, and each one sends the user
    // somewhere different, so each needs its own sentence in the UI.
    //
    //   null         the read succeeded, or the text held nothing card-like at
    //                all. The only case where saying nothing is right.
    //   'damaged'    a payload was there and did not survive the trip: bad
    //                base64, invalid UTF-8, a failed checksum, JSON that will
    //                not parse, a version that disagrees with the shape it
    //                arrived in or with the marker in front of it, or a card
    //                this app could not have written.
    //                Ask for the link again, never retype the number from it.
    //   'outdated'   it declares a version above 2, in the payload or in the
    //                CFID marker: written by a newer Fiscal than this copy. The
    //                marker says so before the token is looked at, so a payload
    //                from a newer build that also arrived mangled still sends
    //                the user to reload rather than to ask for it again.
    //   'refused'    it carries a US Social Security Number or a Japanese My
    //                Number, by the key it is filed under or by the shape of the
    //                value itself. Refused at the link, not merely unsupported.
    //   'oversized'  the token is longer than anything this app can write, so
    //                it was never decoded at all.
    //
    // Reset at the top of every read, so it always describes the call that just
    // returned and never a previous one.
    let readError = null;

    function lastReadError() {
        return readError;
    }

    // Beyond this a token was not written here: forty values at the storage cap,
    // plus a label, plus base64's third, with room to spare. Measuring first
    // means a megabyte of someone else's fragment is refused rather than
    // decoded and parsed on their say-so.
    const TOKEN_MAX = 262144;

    // And below this one was not written here either. store.js gives every card
    // a kind and a label, so the smallest token the first release could write
    // measures 88 base64url characters and the smallest this build can write
    // measures 102: anything shorter behind a `card=` belongs to somebody else's
    // URL — a shop's `&card=visa`, a session id in a query string — and telling
    // that user their link is damaged reports a problem they do not have. The
    // link form carries the floor in its own pattern rather than in a test after
    // it, so a short match cannot shadow a real payload further along the same
    // text.
    //
    // The floor cuts both ways and the trade is deliberate. A real link chewed
    // down past 64 characters of token now reads as no link at all rather than
    // as a damaged one. A false 'that link is damaged' is the worse of the two,
    // because it fires on people who never used this app.
    const TOKEN_MIN = 64;
    const LINK_MARKER = new RegExp('[#&]card=([A-Za-z0-9_-]{' + TOKEN_MIN + ',})');
    const NATIVE_MARKER = /CFID(\d+):([A-Za-z0-9_-]*)/;

    // Anything that might hold a card: the fragment of a link, or the native
    // payload on its own, wherever in the text it sits. A payload read off a
    // screen with a phone arrives pasted into something, not as a tidy line —
    // which is also how the CFID payload gets back in, since the only reader it
    // has in the world is this function.
    //
    // Returns null when there was nothing to read or nothing readable, and
    // { card, verified } when there was. `verified` is false for a link written
    // before the checksum existed: the card is real enough to show, and there is
    // no way on earth to tell whether it is the card that was sent.
    function readShared(text) {
        readError = null;
        const s = String(text || '');
        const link = LINK_MARKER.exec(s);

        // The native payload carries its version in the marker, so a version
        // this build has never heard of is recognisable before anything is
        // decoded. Matching only the markers we do know would send a CFID3
        // payload down the same path as a line of unrelated chat text, and a
        // payload that arrived perfectly intact would present as no payload at
        // all — the one answer that tells the user nothing. The token behind it
        // is allowed to be empty here for the same reason: what the marker says
        // about the version is worth reading even when nothing usable follows.
        const native = link ? null : NATIVE_MARKER.exec(s);
        if (!link && !native) return null;

        if (native && Number(native[1]) > 2) {
            readError = 'outdated';
            return null;
        }

        const token = link ? link[1] : native[2];
        if (token.length > TOKEN_MAX) {
            readError = 'oversized';
            return null;
        }
        if (token.length < TOKEN_MIN) return null;

        let payload = null;
        try { payload = unpack(token); } catch (e) { payload = null; }
        if (!payload) {
            readError = 'damaged';
            return null;
        }

        // Version and shape have to agree with each other. This build writes v2
        // behind a checksum and the first release wrote v1 with none; a payload
        // claiming one while carrying the other was written by neither, so it is
        // damage rather than history. A version from the future cannot be read
        // down to something safe by guessing, and one that is not a number at
        // all is not a version.
        const v = payload.data && payload.data.v;
        if (typeof v !== 'number' || !isFinite(v)) {
            readError = 'damaged';
            return null;
        }
        if (v > 2) {
            readError = 'outdated';
            return null;
        }
        if (v !== (payload.verified ? 2 : 1)) {
            readError = 'damaged';
            return null;
        }

        // And the marker has to agree with the payload behind it. CFID1 was
        // only ever written in front of the unchecksummed v1 body and CFID2 in
        // front of the v2 one, so a pairing neither release wrote was assembled
        // somewhere else. Without this the number in the marker means nothing
        // once the token is reached, and the next version to keep the pairing
        // would inherit a version field with nothing enforcing it.
        if (native && Number(native[1]) !== v) {
            readError = 'damaged';
            return null;
        }

        // Everything past here is a stranger's link. Nothing but strings this
        // app could itself have written is allowed through to the renderer, and
        // the object handed back is built here rather than being the parsed one
        // with extra keys still riding along.
        const card = incomingCard(payload.data);
        if (!card) {
            readError = 'damaged';
            return null;
        }
        if (refuses(card)) {
            readError = 'refused';
            return null;
        }

        // The verdict twice: on the wrapper, where a caller cannot reach the
        // card without passing it, and on the card, so it survives being handed
        // on to anything that only ever sees the card.
        card.verified = payload.verified;
        return { card: card, verified: payload.verified };
    }

    // The two numbers this app will not hold, refused on every way off the
    // device as well as at the wallet. store.js keeps them out of storage;
    // storage is not the boundary that matters here, because a card leaves in a
    // link, a QR, a vCard and an image long before anyone decides to keep it,
    // and one arriving in a link is on the screen and being read aloud before
    // anyone decides anything at all.
    //
    // Three ways of recognising one, because the key name is the weakest of the
    // three and it is the only one this file used to have. The country in a
    // link is whatever the link says and so is the spelling of the key, so the
    // name is refused under any ISO and in any capitalisation. The record's own
    // rule is better: FiscalEngines.refusalFor() reads the pattern the registry
    // publishes, and that is what catches an SSN typed into the EIN box — which
    // is where it gets typed, because a form asking for a tax number is where
    // someone reaches for the number they know. And where there is no record to
    // consult, which is every read, since readShared() runs before anything
    // knows what country the card is from, the patterns are mirrored here.
    //
    // Every piece of text on the card is read the same way, and not only the
    // boxes a schema calls identifiers. A card carries prose too — a legal
    // name, an address — and 'Bob Smith, SSN 123-45-6789' is how one of these
    // arrives there, because the user copies the line off a form. A rule that
    // only ever looked at a value it expected to BE the number let that text
    // out in the link, in the vCard, in the QR, in the image and into Quote.
    // The label is the one place a hit costs the nickname rather than the card:
    // nothing is read off a nickname at a counter, and refusing a whole card
    // over the name its owner gave it would be a refusal firing on a legitimate
    // card.
    //
    // Their scope is deliberately not symmetrical. The SSA's 3-2-4 grouping is
    // worn by no identifier and no field anywhere in registry/, so it is refused
    // whatever country the card claims. Twelve digits are not so distinctive:
    // GB's branch VAT number 980780684001 is twelve of them and real, so My
    // Number is refused under JP alone. A refusal that fires on a legitimate
    // number is worse than the hole it closes.
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
    // is a different number and refusing it would be a refusal firing on
    // something legitimate.
    REFUSALS.forEach((r) => {
        r.within = new RegExp('(^|[^0-9])' + r.body + '([^0-9]|$)');
    });

    // Trimmed and capped exactly as js/store.js trims and caps the same string,
    // so what one layer tests is what the other tests.
    function text(v, cap) {
        if (typeof v === 'number' && isFinite(v)) v = String(v);
        if (typeof v !== 'string') return '';
        return v.trim().slice(0, cap);
    }

    function refusedName(key) {
        const k = String(key).toLowerCase();
        const hit = REFUSALS.filter((r) => r.key.toLowerCase() === k)[0];
        return hit ? hit.key : null;
    }

    // Read as far as the text is allowed to travel and no further, so what is
    // tested is what would leave. Folded first, so full-width digits are not a
    // way around it. The nickname, and the heading an image is given, are cut
    // to their own cap by the caller before they get here, because the cap is
    // what actually travels.
    function refusedText(value, iso) {
        const raw = text(value, VALUE_CAP).normalize('NFKC');
        if (!raw) return null;
        const where = String(iso || '').toUpperCase();
        const hit = REFUSALS.filter((r) => (r.anywhere || r.iso === where)
            && r.within.test(raw))[0];
        return hit ? hit.key : null;
    }

    // The label as it is allowed to leave, cut to its cap first because the cap
    // is what actually travels — a nickname trimmed at 80 characters can end in
    // a shape the untrimmed one did not. Trimmed before it is cut, as store.js
    // cuts the same string, so the nickname on the disk and the nickname in the
    // link are one string and not two that happen to look alike.
    //
    // Blanked rather than costing the card. Nothing is read off a nickname at a
    // counter, so losing one costs the user nothing they need, while refusing a
    // whole card over the name its owner gave it would be the refusal this file
    // says everywhere else is worse than the hole it closes. refusedIn() names
    // it so the UI can say a nickname was left behind.
    function safeLabel(label, iso) {
        const capped = text(label, LABEL_CAP);
        return refusedText(capped, iso) ? '' : capped;
    }

    // The registry is the source of truth for a refusal and can grow one this
    // file has never heard of, so where a record is at hand it is asked.
    //
    // A record reaches here from a fetch that may have returned anything, and
    // `identifiers` as an object rather than an array used to throw out of the
    // filter — which takes down the caller that was asking whether a number may
    // leave, and a refusal that fails open is no refusal.
    function refusedByRecord(key, value, rec) {
        const engines = window.FiscalEngines;
        if (!engines || typeof engines.refusalFor !== 'function') return null;
        const list = (rec && Array.isArray(rec.identifiers)) ? rec.identifiers : [];
        const ident = list.filter((i) => i && i.key === key)[0];
        const rule = ident ? engines.refusalFor(text(value, VALUE_CAP), ident) : null;
        return rule ? rule.key : null;
    }

    function refusedValues(card, rec) {
        const values = (card && card.values) || {};
        return Object.keys(values).map((key) => {
            const refused = refusedName(key)
                || refusedText(values[key], card && card.iso)
                || refusedByRecord(key, values[key], rec);
            return refused ? { key: key, refused: refused, where: 'value' } : null;
        }).filter(Boolean);
    }

    // Everything on this card that will not be let out, as
    // [{key, refused, where}]: `refused` is the kind of number it turned out to
    // be, which is what the record's `refused[]` explains in words, and `where`
    // says whether `key` names one of the card's values or the label itself.
    // The UI needs this before it offers a share — dropping the value is half of
    // keeping the promise and saying so out loud is the other half, because a
    // number that silently fails to arrive gets read off the original document
    // and typed in by hand at the counter instead.
    //
    // The label is reported last and under `where: 'label'` rather than as a
    // value key, because a card is free to hold a value called `label` and
    // because the two need different sentences: one number was refused storage,
    // the other was a nickname blanked on the way out.
    function refusedIn(card, rec) {
        const found = refusedValues(card, rec);
        const label = refusedText(text(card && card.label, LABEL_CAP), card && card.iso);
        return label
            ? found.concat([{ key: 'label', refused: label, where: 'label' }])
            : found;
    }

    // A hidden value is only worth searching for inside a counter line when it
    // is long enough to be the number it stands for. store.js refuses by key
    // name alone, so a card hand-edited back in through a backup can hold
    // values:{ssn:'1'} — and dropping every line containing a '1' takes the real
    // EIN off the image, out of the vCard and out of the Quote hand-off while
    // the link still carries it, which is a refusal firing on a legitimate
    // identifier. Nothing this file refuses by shape is shorter than nine
    // characters, and a string short enough to turn up inside an unrelated line
    // is not a number worth losing a line over.
    const HIDDEN_MIN = 6;

    // The card as it is allowed to leave — values and label both — plus the
    // strings that stayed behind so the lines built from them can be dropped
    // too.
    function scrub(card, rec) {
        const values = (card && card.values) || {};
        const refused = refusedValues(card, rec);
        const kept = {};
        Object.keys(values).forEach((key) => {
            if (!refused.some((r) => r.key === key)) kept[key] = values[key];
        });
        return {
            card: Object.assign({}, card, {
                values: kept,
                label: safeLabel(card && card.label, card && card.iso),
            }),
            hidden: refused.map((r) => values[r.key])
                .filter((v) => typeof v === 'string' && v.length >= HIDDEN_MIN),
        };
    }

    // A counter line is text the caller built out of the same card, so a refused
    // value sits somewhere inside it rather than being all of it. Both tests
    // earn their place: the substring catches the line built from a value this
    // call was shown, whatever that value looks like, and the rule catches a
    // number in a line assembled by a caller that was never shown a card at
    // all. Neither is a backstop for the other — the rule cannot see a value
    // refused for its key name, and the substring test cannot see a number this
    // call does not hold.
    function safeLines(lines, hidden, iso, valueOf) {
        return (lines || []).filter((line) => {
            const str = String((valueOf ? valueOf(line) : line) || '');
            if (hidden.some((v) => str.indexOf(v) !== -1)) return false;
            return !refusedText(str, iso);
        });
    }

    function refuses(card) {
        return Object.keys(card.values).some((key) => refusedName(key)
            || refusedText(card.values[key], card.iso));
    }

    // The caps match store.js, which is where this card goes if the user keeps
    // it. A value outside them was not written by this app and is refused rather
    // than trimmed, because a trimmed tax identifier is a wrong one and this
    // whole file exists to avoid handing someone a wrong one. The label is the
    // exception: it is the user's private nickname for the card, nothing is read
    // off it at a counter, and refusing a whole card over a long nickname is a
    // refusal firing on a legitimate card. store.js trims it, so this trims it —
    // and safeLabel() blanks it if a number was typed there, for the same reason
    // and at the same price.
    const LABEL_CAP = 80;
    const VALUE_CAP = 4096;
    const VALUE_KEYS = 40;

    function incomingCard(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        if (typeof data.iso !== 'string' || !/^[A-Za-z]{2}$/.test(data.iso)) return null;
        if (data.label != null && typeof data.label !== 'string') return null;
        if (data.kind != null && data.kind !== 'personal' && data.kind !== 'business') return null;

        const src = data.values;
        if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
        const keys = Object.keys(src);
        if (!keys.length || keys.length > VALUE_KEYS) return null;

        const values = {};
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k === '__proto__' || !/^[A-Za-z0-9_]{1,40}$/.test(k)) return null;
            if (typeof src[k] !== 'string') return null;
            // Trimmed, then measured one character wider than the cap, exactly
            // as store.js measures the same string on its way to the disk. A
            // value past the cap is refused rather than cut down, for the reason
            // that file gives — a trimmed tax identifier is a wrong one — but
            // measuring the untrimmed string called a card damaged that storage
            // would have taken, which is the two layers disagreeing about one
            // value in front of a user who cannot see either of them.
            const v = text(src[k], VALUE_CAP + 1);
            if (v.length > VALUE_CAP) return null;
            if (v) values[k] = v;
        }
        if (!Object.keys(values).length) return null;

        // The label arriving with a number in it costs the label and not the
        // card: the values are legitimate and the card is the sender's own, so
        // refusing the whole thing over the name they gave it would deny the
        // holder a card they can use. Blanked on the way in exactly as it is
        // blanked on the way out, which is why nothing this build writes can
        // carry one.
        const iso = data.iso.toUpperCase();
        return {
            iso: iso,
            kind: data.kind === 'business' ? 'business' : 'personal',
            label: safeLabel(data.label, iso),
            values: values,
        };
    }

    /* ================= QR ================= */

    // The vendored encoder gives us the module matrix; drawing it ourselves
    // means the same code produces the standalone QR and the QR inside the
    // shareable card image, at whatever pixel size each one needs.
    function qrCanvas(text, pixels, quiet) {
        if (typeof window.qrcode !== 'function') return null;
        window.qrcode.stringToBytes = qrBytes;

        // Type 0 lets the library pick the smallest version that fits. 'M'
        // survives a phone screen photographed at an angle.
        const qr = window.qrcode(0, 'M');
        try {
            qr.addData(text);
            qr.make();
        } catch (e) {
            // Past version 40 the library throws a bare string, which used to
            // escape the click handler and leave the Share dialog unopenable
            // with nothing said. qrFits() tells the caller which failure this
            // was, so it can say something true about it.
            return null;
        }

        const count = qr.getModuleCount();
        const margin = quiet == null ? 4 : quiet;
        const total = count + margin * 2;

        // `pixels` is a budget, not a target. A symbol drawn to a fixed square
        // gets a fractional number of pixels per module, and under the
        // image-rendering:pixelated this is displayed with, that means module
        // edges that land a pixel wide in some columns and two in others —
        // exactly the unevenness a decoder's grid estimation cannot absorb. So
        // the module count chooses the size: whole pixels per module, and the
        // element sized to its own bitmap so nothing resamples it afterwards.
        const scale = Math.max(1, Math.floor(pixels / total));
        const side = total * scale;

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = side;
        canvas.style.width = side + 'px';
        // A caller may still lay this out smaller; what max-width refuses is
        // being stretched to a size that is not a whole multiple of the bitmap.
        canvas.style.maxWidth = side + 'px';
        const ctx = canvas.getContext('2d');

        // Light ground and dark modules regardless of the page theme — a QR
        // inverted for a dark UI is a QR that many scanners refuse.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000000';
        for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
                if (qr.isDark(r, c)) {
                    ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
                }
            }
        }
        return canvas;
    }

    function qrFits(text) {
        return byteLength(text) <= QR_MAX_BYTES;
    }

    /* ================= the card as an image ================= */

    // Rendered at 2x and drawn by hand rather than screenshotted, so the result
    // is legible when WhatsApp recompresses it.
    function cardImage(opts) {
        // Called from a click handler, so a missing argument has to come back as
        // an empty card rather than as a throw that escapes the handler and
        // leaves the dialog half-open with nothing said.
        opts = opts || {};
        const S = 2;
        const W = 640;
        const pad = 28;

        // The image is the payload that travels furthest — it is forwarded,
        // saved to a gallery and backed up — so the same values that stay out
        // of the link stay off it. `card` and `rec` are how a caller says which
        // card these lines were built from; without them the shapes this file
        // refuses everywhere are still caught, which is what stops an SSN
        // reaching a WhatsApp thread when the caller forgot to say.
        const safe = scrub(opts.card, opts.rec);
        const lines = safeLines(opts.lines, safe.hidden, safe.card.iso, (l) => l && l.v);
        // The heading is the one string on this image the caller writes freely,
        // and the caller writes it out of the label, so it gets the label's
        // reading of the rule as well as a row's. Blank rather than absent: an
        // image with no heading is still an image, and 'undefined' painted at
        // 13pt is what the bare coercion used to produce.
        const heading = refusedText(opts.heading, safe.card.iso)
            ? '' : (safeLines([opts.heading], safe.hidden, safe.card.iso)[0] || '');
        // The QR is the part of this image a stranger's phone reads without
        // anyone looking at it first, so a payload built somewhere else that
        // turns out to carry a refused value costs the whole symbol rather than
        // riding along inside it.
        const qrText = safeLines([opts.qrText], safe.hidden, safe.card.iso)[0];

        // The QR keeps whatever size its module count gave it, and the layout
        // moves around it. Squeezing it into a fixed 200pt square would resample
        // the one thing on this card that has to survive a photograph.
        const qr = qrText ? qrCanvas(qrText, 200 * S, 2) : null;
        const qrSide = qr ? qr.width / S : 0;

        const lineH = 46;
        const bodyH = pad + 44 + lines.length * lineH + pad;
        const H = Math.max(bodyH, qr ? qrSide + pad * 2 + 44 : 0);

        const canvas = document.createElement('canvas');
        canvas.width = W * S;
        canvas.height = H * S;
        const ctx = canvas.getContext('2d');
        ctx.scale(S, S);

        ctx.fillStyle = '#0b0b0b';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#262626';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

        // Gold rule at the top — the fleet's one accent, used once.
        ctx.fillStyle = '#eab308';
        ctx.fillRect(0, 0, W, 3);

        const textW = W - pad * 2 - (qr ? qrSide + pad : 0);

        ctx.fillStyle = '#eab308';
        ctx.font = '600 13px "IBM Plex Mono", monospace';
        ctx.fillText(fit(ctx, String(heading).toUpperCase(), W - pad * 2), pad, pad + 14);

        let y = pad + 52;
        lines.forEach((line) => {
            ctx.fillStyle = '#666666';
            ctx.font = '500 11px "IBM Plex Mono", monospace';
            ctx.fillText(String(line.k).toUpperCase(), pad, y);

            ctx.fillStyle = '#ffffff';
            ctx.font = (line.lead ? '700 26px' : '500 17px') + ' "IBM Plex Mono", monospace';
            ctx.fillText(fit(ctx, String(line.v), textW), pad, y + (line.lead ? 28 : 22));
            y += lineH;
        });

        if (qr) {
            ctx.drawImage(qr, W - pad - qrSide, pad + 34, qrSide, qrSide);
        }

        ctx.fillStyle = '#666666';
        ctx.font = '400 10px "IBM Plex Mono", monospace';
        ctx.fillText('fiscal.carino.systems', pad, H - 12);

        return canvas;
    }

    // Trim to width with an ellipsis rather than letting text run off the edge.
    // By grapheme, not by code unit: slicing UTF-16 strands the high half of an
    // emoji and cuts a flag or a joined sequence in two, which lands a tofu box
    // on the card immediately before the ellipsis.
    function fit(ctx, text, max) {
        if (ctx.measureText(text).width <= max) return text;
        const seg = (typeof Intl !== 'undefined' && Intl.Segmenter)
            ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
                (s) => s.segment)
            : Array.from(text);
        while (seg.length > 1 && ctx.measureText(seg.join('') + '…').width > max) seg.pop();
        return seg.join('') + '…';
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve) => {
            if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
            else resolve(null);
        });
    }

    /* ================= Bridge into Quote ================= */

    // The Bridge already moves Files between fleet pages, so a card travels as
    // one rather than inventing a second protocol. Quote reads it and puts the
    // issuer's tax line on the quotation.
    //
    // What crosses is what Quote consumes, and nothing else: it renders the
    // label, the country and the counter lines, so the kind, the authority and
    // the structured bag stayed behind. Data with no reader has no business
    // crossing a window boundary — card.values holds a CURP, deliberately not
    // in the invoice profile that built `lines`.
    function sendToQuote(card, lines, countryName, rec) {
        // The registry record used to sit second and go unread; it now sits last
        // and is read, for the refusal below. Accepting it in either position
        // would let a call site written against the old shape send the record
        // where the counter lines belong, and Quote would put whatever that
        // stringified into on an invoice — so the arguments are checked rather
        // than trusted, and checked before anything about the environment,
        // because a caller's mistake is a caller's mistake whether or not the
        // bridge happens to be there.
        //
        // Every one of these leaves through a rejection rather than a throw.
        // The function's whole contract is that it returns a promise, and a
        // caller that wrote .catch() gets an unhandled exception instead of its
        // handler the moment one argument is wrong — which is exactly when the
        // handler was needed. Nothing is dereferenced before the check that
        // makes dereferencing safe.
        const badCall = (what) => Promise.reject(
            failure('bad-call', 'sendToQuote(card, lines, countryName, rec) wants ' + what));

        if (!card || typeof card !== 'object' || Array.isArray(card)
            || typeof card.iso !== 'string' || !/^[A-Za-z]{2}$/.test(card.iso)) {
            return badCall('a card with a two-letter iso');
        }
        if (!Array.isArray(lines) || !lines.length || lines.some((l) => typeof l !== 'string')) {
            return badCall('an array of strings');
        }
        if (countryName != null && typeof countryName !== 'string') {
            return badCall('a country name as text');
        }

        // The lines are what Quote prints on the quotation, so a refused value
        // must not be among them. A card whose every line is one has nothing to
        // put on an invoice, and sending an empty card would leave the user
        // looking at a quotation with no tax line and no reason given.
        const safe = scrub(card, rec);
        const sendable = safeLines(lines, safe.hidden, safe.card.iso);
        if (!sendable.length) {
            return Promise.reject(failure('refused',
                'every line carried a number this app will not hand on'));
        }
        if (!window.CarinoBridge) return Promise.reject(failure('no-bridge', 'the bridge did not load'));

        const payload = {
            app: 'carino-fiscal', v: 1,
            iso: card.iso.toUpperCase(), country: countryName,
            // Trimmed, and blanked if a number was typed there, rather than
            // refused: the label is the user's private nickname, nothing is
            // read off it at a counter, and a card is not worth blocking over
            // one. A value is a different matter and none of them cross.
            label: safe.card.label,
            lines: sendable,
            provenance: provenance(card),
        };

        const file = {
            name: 'fiscal-card.json',
            type: 'application/json',
            body: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        };

        // The Bridge opens the window and keeps the handle to itself, so the
        // only chance to hold on to it is while it is being created. A tab the
        // user shut is never going to answer, and twelve seconds of a button
        // reading 'Opening Quote…' is read as a hang either way.
        const open = window.open;
        let win = null;
        window.open = function () { win = open.apply(window, arguments); return win; };
        let sending;
        try {
            sending = window.CarinoBridge.send(quoteUrl(), [file], { timeout: 12000 });
        } finally {
            window.open = open;
        }

        // Whichever of the two loses the race still settles, and a rejection
        // nobody is listening to is an unhandled one.
        sending.catch(() => {});

        const watch = untilClosed(win);
        return Promise.race([sending, watch.gone])
            .then((r) => { watch.stop(); return r; },
                (e) => { watch.stop(); throw diagnose(e); });
    }

    // Quote will not put a card on a quotation unless Fiscal says it is the
    // user's own, and it can only go by what it is told. A demo sample and a
    // card being previewed from someone else's link both live in memory only,
    // so the wallet is what tells them apart from a card that is really yours.
    function provenance(card) {
        const store = window.FiscalStore;
        if (!store || typeof store.byId !== 'function') return 'unknown';
        const id = card && card.id;
        if (id && store.byId(id)) return 'own';
        return /^demo/.test(String(id)) ? 'demo' : 'shared';
    }

    // Production Quote from the production site: quote.carino.systems is where
    // it is deployed, and its receiver allows exactly one remote origin,
    // https://fiscal.carino.systems, which is this one.
    //
    // Served from a machine, that pair is unreachable in both directions, so the
    // sibling checkout is the target instead — the fleet repos sit next to each
    // other and Quote's receiver additionally trusts a local Fiscal on
    // localhost:8000 or 127.0.0.1:8000. A handoff that can only ever cross to
    // the live site is a handoff nobody can exercise before it ships, so
    // development means serving the directory that holds both repos on port
    // 8000: Fiscal at /Fiscal/ then resolves '../Quote/' to the checkout beside
    // it. Serving Fiscal alone as its own root leaves nothing on the other side
    // to reach, and no URL this function could return would change that.
    function quoteUrl() {
        const local = ['localhost', '127.0.0.1', '[::1]'].indexOf(location.hostname) !== -1;
        return local ? new URL('../Quote/', location.href).href : QUOTE;
    }

    // Poll for the tab going away, so a closed window fails at once instead of
    // at the timeout. A handle whose opener link was severed — a receiver that
    // sets COOP — reads as closed and never changes, which is exactly what a
    // tab the user shut looks like. The two are told apart by when: this runs
    // in the same tick the window was created, and nobody closes a tab that
    // fast, so a window already gone here was never ours to watch.
    function untilClosed(win) {
        let shut = true;
        try { shut = !win || win.closed; } catch (e) { shut = true; }
        if (shut) return { gone: new Promise(() => {}), stop: () => {} };

        let stop = null;
        const gone = new Promise((resolve, reject) => {
            const poll = setInterval(() => {
                let closed = false;
                try { closed = !!win.closed; } catch (e) { closed = false; }
                if (!closed) return;
                clearInterval(poll);
                reject(failure('closed', 'that tab was closed'));
            }, 250);
            stop = () => clearInterval(poll);
        });
        return { gone: gone, stop: stop };
    }

    // The Bridge already tells these apart — a window that never opened, one
    // that opened and never announced itself, one that took the card without
    // acknowledging it, one that refused it — and every one of them sends the
    // user somewhere different. Collapsing them into 'Quote did not answer'
    // sends four out of five to look for the wrong problem.
    const FAILURES = [
        [/pop-up blocked/, 'blocked'],
        [/never answered/, 'no-answer'],
        [/no acknowledgement/, 'no-ack'],
        [/declined/, 'declined'],
        [/too old for this one/, 'quote-outdated'],
        [/too old for the other one/, 'fiscal-outdated'],
    ];

    function failure(reason, message) {
        const err = new Error('Quote handoff: ' + message);
        err.reason = reason;
        return err;
    }

    function diagnose(err) {
        if (err && err.reason) return err;
        const message = (typeof err === 'string' ? err : (err && err.message)) || '';
        const hit = FAILURES.find((f) => f[0].test(message));
        if (!hit) return failure('failed', message || 'it did not go through');
        if (err instanceof Error) { err.reason = hit[1]; return err; }
        return failure(hit[1], message);
    }

    window.FiscalShare = {
        refusedIn: refusedIn,
        vcard: vcard,
        carinoPayload: carinoPayload,
        shareLink: shareLink,
        readShared: readShared,
        lastReadError: lastReadError,
        qrCanvas: qrCanvas,
        qrFits: qrFits,
        cardImage: cardImage,
        canvasToBlob: canvasToBlob,
        sendToQuote: sendToQuote,
    };
})();
