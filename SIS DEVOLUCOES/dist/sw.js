/* =========================================================================
   SW.JS — service worker do app instalável (PWA).
   Guarda uma cópia do sistema no aparelho para abrir rápido e sem internet.

   Estratégia "rede primeiro": com internet, sempre busca a versão mais nova
   (e atualiza a cópia); sem internet, usa a cópia guardada.
   Só cuida de arquivos deste mesmo site. Chamadas à ponte do Mercado Livre
   (outro endereço) passam direto, nunca são guardadas.
   Os dados das devoluções NÃO passam por aqui: ficam no localStorage.
   ========================================================================= */
'use strict';

const CACHE = 'devolucoes-app-v2';
const ARQUIVOS = ['./', 'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((r) => r || (req.mode === 'navigate' ? caches.match('./') : undefined))
          .then((r) => r || Response.error()),
      ),
  );
});
