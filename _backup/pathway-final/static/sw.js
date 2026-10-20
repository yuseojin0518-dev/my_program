/* Pathway 서비스 워커: 화면 파일을 저장해 두어 인터넷이 끊겨도 열린다.
   API 요청은 늘 서버로 보내고, 화면 파일은 '먼저 네트워크, 안 되면 저장본'으로 준다. */
const CACHE = "pathway-v1";
const SHELL = ["/", "/static/index.css", "/static/engine.js", "/static/data.js", "/static/ui.js", "/static/app.js",
  "/static/views-home.js", "/static/views-grades.js", "/static/views-plan.js", "/static/views-path.js", "/static/views-report.js",
  "/static/icon.png", "/static/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/me") return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("/")))
  );
});
