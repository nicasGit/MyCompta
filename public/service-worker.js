// Online data only: never store household data, PDFs or Google responses in CacheStorage.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate'
    || url.origin !== self.location.origin || !['/', '/index.html'].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html>
<html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#285fa8"><title>MyCompta · Hors connexion</title>
<body style="font:16px system-ui;background:#f5f8fc;color:#203653;padding:10vh 24px;max-width:480px;margin:auto">
<h1>Vous êtes hors connexion</h1><p>Reconnectez-vous à Internet pour retrouver les dépenses et documents de votre foyer.</p>
<a href="/" style="display:inline-block;background:#285fa8;color:white;padding:14px 22px;border-radius:10px;text-decoration:none">Réessayer</a></body></html>`,
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })));
});
