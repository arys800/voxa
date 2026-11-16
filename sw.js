// Service worker mínimo do Voxa: deixa o app instalável.
// Sempre busca da rede (o app depende do servidor), sem cache de páginas antigas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<meta charset="utf-8"><body style="background:#0d0d12;color:#e8e6e3;font:16px sans-serif;display:grid;place-items:center;height:100vh;margin:0">Sem conexão. Abra o Voxa de novo quando a internet voltar.</body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )));
});
