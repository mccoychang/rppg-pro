// ===== rPPG Pro — Service Worker =====
const CACHE_NAME = 'rppg-pro-v4';
const ASSETS = [
    '/',
    '/index.html',
    '/analysis.js',
    '/history.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

// Install: cache core assets
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('📦 Caching assets...');
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // API calls: always go to network
    if (url.pathname.startsWith('/api/')) {
        e.respondWith(fetch(e.request).catch(() =>
            new Response(JSON.stringify({ error: 'offline' }), {
                headers: { 'Content-Type': 'application/json' }
            })
        ));
        return;
    }

    // Assets: cache-first, falling back to network
    e.respondWith(
        caches.match(e.request).then(cached => {
            const fetchPromise = fetch(e.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});
