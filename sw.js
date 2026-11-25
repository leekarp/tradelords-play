// Unscrambles the game's files in the browser. It knows nothing without the key from the link.
const STORE = "tl-lock-v1";
let state = null; // { key, files } once unlocked

const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const open = (key, buf) => crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(buf, 0, 12) }, key, new Uint8Array(buf, 12));

async function unlock(text) {
  const key = await crypto.subtle.importKey("raw", fromBase64Url(text), "AES-GCM", false, ["decrypt"]);
  const res = await fetch("d/index", { cache: "no-cache" });
  if (!res.ok) throw new Error("no index");
  const files = JSON.parse(new TextDecoder().decode(await open(key, await res.arrayBuffer())));
  return { key, files };
}
async function remembered() {
  const hit = await (await caches.open(STORE)).match("key");
  return hit ? hit.text() : null;
}
async function ready(fresh) {
  if (state && !fresh) return state;
  const text = await remembered();
  if (!text) return (state = null);
  try { state = await unlock(text); } catch (err) { if (!state) state = null; }
  return state;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// The opening page hands over the key from the link (or asks whether one is remembered).
self.addEventListener("message", (e) => {
  const port = e.ports && e.ports[0];
  e.waitUntil((async () => {
    try {
      const text = e.data && e.data.key;
      if (text) {
        state = await unlock(text); // throws on a wrong key
        await (await caches.open(STORE)).put("key", new Response(text));
      }
      const s = await ready(false);
      if (port) port.postMessage({ ok: Boolean(s) });
    } catch (err) {
      if (port) port.postMessage({ ok: false });
    }
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (e.request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  let path = decodeURIComponent(url.pathname.slice(scope.pathname.length));
  if (path === "") path = "index.html";
  if (path === "sw.js" || path.startsWith("d/")) return;
  e.respondWith((async () => {
    // Opening the game checks for a newer build; everything after uses the same list.
    const s = await ready(e.request.mode === "navigate");
    const entry = s && s.files[path];
    if (!entry) return fetch(e.request);
    const res = await fetch("d/" + entry[0]);
    if (!res.ok) return res;
    const plain = await open(s.key, await res.arrayBuffer());
    // Pictures may be reused while the page is open (sprites ask for the same sheet many times); the page itself is always fresh.
    return new Response(plain, { headers: { "Content-Type": entry[1], "Cache-Control": path === "index.html" ? "no-cache" : "private, max-age=600" } });
  })());
});
