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

(function () {
    'use strict';

    const KEY_CARDS = 'carino.fiscal.cards';
    const KEY_LAST = 'carino.fiscal.last';         // { iso, kindByIso: { MX: 'business' } }
    const IMAGE_CAP = 400 * 1024;                  // ~400 KB of data URL per card

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

    /* ---------------- cards ---------------- */

    function all() {
        if (memory) return memory;
        const cards = read(KEY_CARDS, []);
        return Array.isArray(cards) ? cards : [];
    }

    function persist(cards) {
        if (memory) { memory = cards; return false; }
        const ok = write(KEY_CARDS, cards);
        if (!ok) memory = cards;
        return ok;
    }

    function forIso(iso) {
        return all().filter((c) => c.iso === iso);
    }

    function byId(id) {
        return all().find((c) => c.id === id) || null;
    }

    function save(card) {
        const cards = all();
        if (!card.id) {
            card.id = uid();
            cards.push(card);
        } else {
            const i = cards.findIndex((c) => c.id === card.id);
            if (i === -1) cards.push(card); else cards[i] = card;
        }
        const durable = persist(cards);
        return { card: card, durable: durable };
    }

    function remove(id) {
        const cards = all().filter((c) => c.id !== id);
        persist(cards);
    }

    /* ---------------- last used ----------------
       Counter mode should open on the card you actually reach for in that
       country: the company in Monterrey, yourself in Bogotá. One toggle, no
       menu, and the app remembers per jurisdiction rather than globally. */

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
        const s = lastState();
        s.iso = iso;
        s.kindByIso = s.kindByIso || {};
        if (kind) s.kindByIso[iso] = kind;
        write(KEY_LAST, s);
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
            const raw = window.localStorage.getItem(KEY_CARDS) || '';
            return raw.length;
        } catch (e) {
            return 0;
        }
    }

    function exportAll() {
        return JSON.stringify({ app: 'carino-fiscal', version: 1, cards: all() }, null, 2);
    }

    function importAll(json) {
        const parsed = JSON.parse(json);
        if (!parsed || !Array.isArray(parsed.cards)) throw new Error('shape');
        const cards = all();
        parsed.cards.forEach((c) => {
            c.id = uid();               // never trust an incoming id
            cards.push(c);
        });
        persist(cards);
        return parsed.cards.length;
    }

    window.FiscalStore = {
        all: all,
        forIso: forIso,
        byId: byId,
        save: save,
        remove: remove,
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
