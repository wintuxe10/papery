const CACHE_NAME = 'papery-v10';

const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(saveEverything());
});

async function saveEverything() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(FILES_TO_CACHE);
}

self.addEventListener('activate', function (event) {
  event.waitUntil(deleteOldDrawers());
});

async function deleteOldDrawers() {
  const names = await caches.keys();
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== CACHE_NAME) {
      await caches.delete(names[i]);
    }
  }
}

self.addEventListener('fetch', function (event) {
  event.respondWith(answerFor(event.request));
});

async function answerFor(request) {
  const saved = await caches.match(request);
  if (saved) {
    return saved;
  }
  return fetch(request);
}
