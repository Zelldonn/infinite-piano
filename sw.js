const CACHE_VERSION = 'atelier-piano-v4';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/styles.css',
    './Bravura.woff2',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    './js/constants.js',
    './js/audio.js',
    './js/theory-generator.js',
    './js/renderer.js',
    './js/playback-wait.js',
    './js/ui.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Hybrid offline strategy:
// - Cache-first for immutable binary assets (Bravura font & icons)
// - Stale-while-revalidate for HTML/CSS/JS/manifest so offline boot is instant while updates refresh cleanly online
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const isImmutableAsset = /\.(woff2|png|svg)$/i.test(url.pathname);
    if (isImmutableAsset) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((networkResp) => {
                    if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
                        const clone = networkResp.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
                    }
                    return networkResp;
                });
            })
        );
        return;
    }

    if (req.mode === 'navigate') {
        event.respondWith(
            caches.open(CACHE_VERSION).then((cache) =>
                cache.match('./index.html').then((cached) => {
                    const networkFetch = fetch(req).then((networkResp) => {
                        if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
                            cache.put('./index.html', networkResp.clone());
                        }
                        return networkResp;
                    }).catch(() => cached);
                    return cached || networkFetch;
                })
            )
        );
        return;
    }

    event.respondWith(
        caches.open(CACHE_VERSION).then((cache) =>
            cache.match(req).then((cached) => {
                const networkFetch = fetch(req).then((networkResp) => {
                    if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
                        cache.put(req, networkResp.clone());
                    }
                    return networkResp;
                }).catch(() => cached);
                return cached || networkFetch;
            })
        )
    );
});
