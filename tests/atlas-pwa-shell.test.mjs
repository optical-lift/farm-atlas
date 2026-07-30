import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const manifest = read("app/manifest.ts");
const layout = read("app/layout.tsx");
const serviceWorker = read("public/sw.js");
const pwaClient = read("lib/atlas/pwa-client.ts");
const bridge = read("components/atlas/pwa/AtlasPwaBridge.tsx");
const setup = read("components/atlas/pwa/AtlasPwaSetup.tsx");
const installPage = read("app/install/page.tsx");
const offlinePage = read("app/offline/page.tsx");
const iconRoute = read("app/api/pwa/icon/route.tsx");
const home = read("app/page.tsx");
const bellCover = read("components/atlas/home/AtlasBellCover.tsx");
const bellPage = read("app/bell/page.tsx");
const authProxy = read("lib/supabase/proxy.ts");
const proxy = read("proxy.ts");

const build = [
  manifest,
  layout,
  serviceWorker,
  pwaClient,
  bridge,
  setup,
  installPage,
  offlinePage,
  iconRoute,
  home,
  bellCover,
  bellPage,
  authProxy,
  proxy,
].join("\n");

test("Build 9 ships a stable standalone Atlas manifest and icon set", () => {
  assert.match(manifest, /id: "\/"/);
  assert.match(manifest, /start_url: "\/"/);
  assert.match(manifest, /scope: "\/"/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /theme_color: "#f7f4e9"/);
  assert.match(manifest, /192x192/);
  assert.match(manifest, /512x512/);
  assert.match(manifest, /purpose: "maskable"/);
  assert.match(iconRoute, /new ImageResponse/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /viewportFit: "cover"/);
});

test("PWA discovery assets remain public before Atlas authentication", () => {
  assert.match(authProxy, /pathname === "\/manifest\.webmanifest"/);
  assert.match(authProxy, /pathname === "\/sw\.js"/);
  assert.match(authProxy, /pathname === "\/offline"/);
  assert.match(authProxy, /pathname\.startsWith\("\/api\/pwa\/icon"\)/);
  assert.match(proxy, /manifest\.webmanifest/);
  assert.match(proxy, /sw\.js/);
  assert.match(proxy, /api\/pwa\/icon/);
});

test("the service worker keeps a prepared shell without intercepting canonical writes", () => {
  assert.match(serviceWorker, /atlas-pwa-shell-v1/);
  assert.match(serviceWorker, /SHELL_CACHE/);
  assert.match(serviceWorker, /PAGE_CACHE/);
  assert.match(serviceWorker, /DATA_CACHE/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /latestCachedDay/);
  assert.match(serviceWorker, /\/api\/atlas\/living-day/);
  assert.match(serviceWorker, /\/api\/atlas\/living-day-plan/);
  assert.match(serviceWorker, /if \(request\.method !== "GET"\) return/);
  assert.doesNotMatch(serviceWorker, /respondWith\([^\n]*POST|queue.*mutation/i);
});

test("private prepared caches clear when the browser returns to authentication", () => {
  assert.match(serviceWorker, /ATLAS_CLEAR_PRIVATE_CACHES/);
  assert.match(serviceWorker, /finalUrl\.pathname === "\/login"/);
  assert.match(bridge, /pathname === "\/login"/);
  assert.match(bridge, /clearAtlasPrivateCaches/);
});

test("Safari installation guidance remains explicit and the Home cover stays recognizable", () => {
  assert.match(setup, /Tap Safari’s Share button/);
  assert.match(setup, /Add to Home Screen/);
  assert.match(setup, /AtlasPwaCoverPrompt/);
  assert.match(home, /<AtlasUniversalHome/);
  assert.match(layout, /<AtlasBellCover \/>/);
  assert.match(home, /<AtlasPwaCoverPrompt/);
  assert.match(installPage, /Carry the farm journal like an app/);
});

test("notification permission remains tied to an explicit Farm Alerts action", () => {
  assert.match(setup, /Enable Farm Alerts/);
  assert.match(setup, /onClick=\{\(\) => void connectAlerts\(\)\}/);
  assert.match(pwaClient, /Notification\.requestPermission\(\)/);
  assert.doesNotMatch(setup, /useEffect\([\s\S]{0,300}Notification\.requestPermission/);
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
});

test("Bell badge truth reaches the installed app without becoming a second task count", () => {
  assert.match(bellCover, /setAtlasAppBadge\(result\.badgeCount\)/);
  assert.match(bellPage, /setAtlasAppBadge\(bell\.badgeCount\)/);
  assert.match(serviceWorker, /ATLAS_BADGE/);
  assert.match(serviceWorker, /setAppBadge/);
  assert.doesNotMatch(build, /total open tasks.*setAppBadge/i);
});

test("offline fallback is an Atlas shell and does not claim unsynced farm truth", () => {
  assert.match(offlinePage, /Atlas is still here/);
  assert.match(offlinePage, /Return to a Home, Day, Bell, Place, or Project view you opened/);
  assert.match(serviceWorker, /server-authoritative/);
  assert.doesNotMatch(offlinePage, /saved|synced|completed|recorded/i);
});
