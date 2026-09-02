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
// Deliberately absent: a server-side short link. One /miguel endpoint would
// make this project the controller of a store of tax identifiers, which is the
// single change that would undo everything the privacy posture buys.

(function () {
    'use strict';

    const QUOTE = 'https://quote.carino.systems/';

    /* ================= payloads ================= */

    // vCard 4.0. The tax data rides in a NOTE plus X- fields: NOTE is what every
    // contacts app will actually show, the X- fields are what a machine can read
    // back. ORG for a business card, N/FN for a personal one.
    function vcard(card, rec, lines, countryName) {
        const esc = (s) => String(s || '').replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');
        const name = card.values.razonSocial || card.values.legalName
            || card.values.nombre || card.label || '';

        const out = ['BEGIN:VCARD', 'VERSION:4.0'];
        out.push('FN:' + esc(name));
        if (card.kind === 'business') out.push('ORG:' + esc(name));
        else out.push('N:' + esc(name) + ';;;;');

        if (card.values.email) out.push('EMAIL:' + esc(card.values.email));
        const addr = card.values.address || card.values.direccion;
        if (addr) out.push('ADR:;;' + esc(addr) + ';;;' + esc(card.values.cp || '') + ';' + esc(countryName));

        // The identifiers, machine-readable.
        (rec.identifiers || []).forEach((ident) => {
            const v = card.values[ident.key];
            if (v) out.push('X-TAXID-' + ident.key.toUpperCase() + ':' + esc(v));
        });
        out.push('X-TAXID-COUNTRY:' + card.iso);

        out.push('NOTE:' + esc(countryName + ' — ' + lines.join('\n')));
        out.push('END:VCARD');
        return out.join('\r\n');
    }

    // A versioned compact payload of our own, so there is somewhere to grow into
    // if a buyer-identity standard ever appears. Kept next to the vCard rather
    // than instead of it, because nothing decodes this today but us.
    function carinoPayload(card) {
        const body = { v: 1, iso: card.iso, kind: card.kind, label: card.label, values: card.values };
        return 'CFID1:' + b64url(JSON.stringify(body));
    }

    function b64url(str) {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        bytes.forEach((b) => { bin += String.fromCharCode(b); });
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function unb64url(str) {
        const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    // A link that carries the card in its fragment. The fragment is never put on
    // the wire, so origin logs, proxies and the server itself never see it — but
    // it does land in history and clipboards, which the UI says out loud.
    function shareLink(card) {
        const base = location.origin + location.pathname;
        return base + '#card=' + b64url(JSON.stringify({
            v: 1, iso: card.iso, kind: card.kind, label: card.label, values: card.values,
        }));
    }

    function readShared(hash) {
        const m = /[#&]card=([A-Za-z0-9_-]+)/.exec(hash || '');
        if (!m) return null;
        try {
            const data = JSON.parse(unb64url(m[1]));
            if (!data || !data.iso || !data.values) return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    /* ================= QR ================= */

    // The vendored encoder gives us the module matrix; drawing it ourselves
    // means the same code produces the standalone QR and the QR inside the
    // shareable card image, at whatever pixel size each one needs.
    function qrCanvas(text, pixels, quiet) {
        if (typeof window.qrcode !== 'function') return null;

        // Type 0 lets the library pick the smallest version that fits. 'M'
        // survives a phone screen photographed at an angle.
        const qr = window.qrcode(0, 'M');
        qr.addData(text);
        qr.make();

        const count = qr.getModuleCount();
        const margin = quiet == null ? 4 : quiet;
        const total = count + margin * 2;
        const scale = Math.max(1, Math.floor(pixels / total));

        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = total * scale;
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

    /* ================= the card as an image ================= */

    // Rendered at 2x and drawn by hand rather than screenshotted, so the result
    // is legible when WhatsApp recompresses it.
    function cardImage(opts) {
        const S = 2;
        const W = 640;
        const pad = 28;

        const qr = opts.qrText ? qrCanvas(opts.qrText, 200 * S, 2) : null;
        const qrSide = qr ? 200 : 0;

        const lineH = 46;
        const bodyH = pad + 44 + opts.lines.length * lineH + pad;
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
        ctx.fillText(opts.heading.toUpperCase(), pad, pad + 14);

        let y = pad + 52;
        opts.lines.forEach((line) => {
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
    function fit(ctx, text, max) {
        if (ctx.measureText(text).width <= max) return text;
        let s = text;
        while (s.length > 4 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
        return s + '…';
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
    function sendToQuote(card, rec, lines, countryName) {
        if (!window.CarinoBridge) return Promise.reject(new Error('no-bridge'));

        const payload = {
            app: 'carino-fiscal', v: 1,
            iso: card.iso, country: countryName, kind: card.kind,
            label: card.label, values: card.values,
            lines: lines,
            authority: rec.authority || null,
        };
        const file = {
            name: 'fiscal-card.json',
            type: 'application/json',
            body: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        };
        return window.CarinoBridge.send(QUOTE, [file]);
    }

    window.FiscalShare = {
        vcard: vcard,
        carinoPayload: carinoPayload,
        shareLink: shareLink,
        readShared: readShared,
        qrCanvas: qrCanvas,
        cardImage: cardImage,
        canvasToBlob: canvasToBlob,
        sendToQuote: sendToQuote,
        QUOTE: QUOTE,
    };
})();
