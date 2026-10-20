/* EduSpace 서비스 워커: 화면 파일을 저장해 두어 인터넷이 잠깐 끊겨도 열린다. 데이터(API)·파일은 늘 서버에서. */
const CACHE = "eduspace-v4";
const SHELL = ["/", "/static/style.css", "/static/ot.js", "/static/core.js", "/static/calendar.js", "/static/classroom.js", "/static/docs.js", "/static/ink.js", "/static/notes.js", "/static/study.js", "/static/icon.png", "/static/manifest.webmanifest"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/files/") || u.pathname.startsWith("/auth/") || u.pathname === "/ws") return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("/"))));
});
