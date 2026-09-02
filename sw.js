// Carino Fiscal — offline cache.
//
// Offline is the premise, not an enhancement: a counter in a basement with no
// signal is exactly where this app has to work. So the whole site is
// precached on install, and every fetch is served cache-first.
//
// Cache-first is safe here because the app makes no network requests of its own
// once loaded — there is no live data to go stale. The only thing that changes
// is the app itself, so bumping VERSION is the entire update mechanism.

const VERSION = 'carino-fiscal-v2';

const SHELL = [
    './',
    'index.html',
    'i18n.js',
    'demo.json',
    'carino-navbar.js',
    'carino-lang.js',
    'carino-clock.js',
    'carino-bridge.js',
    'js/engines.js',
    'js/phonetic.js',
    'js/store.js',
    'js/import.js',
    'js/share.js',
    'js/app.js',
    'vendor/qrcode-generator-1.4.4.js',
    'fonts/carino-fonts.css',
    'logo.webp',
    'manifest.webmanifest',
    'registry/index.json',
    'registry/ar.json',
    'registry/au.json',
    'registry/be.json',
    'registry/br.json',
    'registry/ca.json',
    'registry/cl.json',
    'registry/co.json',
    'registry/de.json',
    'registry/es.json',
    'registry/fr.json',
    'registry/gb.json',
    'registry/gr.json',
    'registry/in.json',
    'registry/it.json',
    'registry/jp.json',
    'registry/mx.json',
    'registry/nl.json',
    'registry/pe.json',
    'registry/pt.json',
    'registry/us.json',
    'registry/za.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(VERSION)
            // addAll is all-or-nothing; the fonts are added separately below so a
            // single missing weight cannot fail the whole install.
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((hit) => {
            if (hit) return hit;
            return fetch(event.request).then((res) => {
                // Font files and anything else not in the shell get cached on
                // first use, so the second visit is fully offline.
                if (res.ok && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(VERSION).then((cache) => cache.put(event.request, copy));
                }
                return res;
            }).catch(() => hit);
        })
    );
});
