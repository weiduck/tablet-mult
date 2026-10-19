/**
 * 直式乘法練習：離線用 service worker
 * - index.html／頁面導覽：network-first，連得上就拿新版，離線用快取
 * - 其他同源外殼檔：stale-while-revalidate，先給快取、背景更新，下次載入生效
 * - 跨來源（Google Fonts 等）一律不攔、不快取；離線時字型退回系統字型
 * - 改了檔案清單或快取策略時，把 CACHE_VERSION 加 1（舊快取會在 activate 時刪掉）
 * 路徑都是相對於 sw.js，所以放在 GitHub Pages 的 /tablet-mult/ 底下也能用。
 */
const CACHE_VERSION = 3;
const CACHE_PREFIX = "tablet-mult-";
const CACHE_NAME = CACHE_PREFIX + "v" + CACHE_VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./mult-core.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache: "reload"：略過 HTTP 快取，確保新版本抓到的是伺服器上的新檔
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          // 同一個 github.io 網域可能還有別的練習，只刪自己的舊版本
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isPage(request, url) {
  if (request.mode === "navigate") return true;
  const scope = new URL(self.registration.scope);
  return url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html";
}

/** 頁面：先上網拿新版並更新快取；離線再用快取 */
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() =>
      caches
        .match(request, { ignoreSearch: true })
        .then((hit) => hit || caches.match("./index.html"))
        .then((hit) => hit || caches.match("./"))
    );
}

/**
 * 外殼檔：stale-while-revalidate——有快取就先用快取（離線也能開），
 * 同時在背景上網抓新版更新快取，下次載入就是新檔；沒有快取才等網路。
 */
function staleWhileRevalidate(event, request) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request, { ignoreSearch: true }).then((hit) => {
      const update = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            return cache.put(request, response.clone()).then(() => response);
          }
          return response;
        })
        .catch(() => undefined);
      if (hit) {
        event.waitUntil(update);
        return hit;
      }
      return update.then((response) => response || Response.error());
    })
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // 跨來源（Google Fonts 的 CSS／字型檔等）：不攔，交給瀏覽器
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    isPage(request, url) ? networkFirst(request) : staleWhileRevalidate(event, request)
  );
});
