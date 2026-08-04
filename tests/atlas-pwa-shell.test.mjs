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
const offlineRecovery = read("components/atlas/pwa/AtlasOfflineRecovery.tsx");
const installPage = read("app/install/page.tsx");
const offlinePage = read("app/offline/page.tsx");
const iconRoute = read("app/api/pwa/icon/route.tsx");
const buildVersionRoute = read("app/api/atlas/build-version/route.ts");
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
  offlineRecovery,
  installPage,
  offlinePage,
  iconRoute,
  buildVersionRoute,
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

test("the service worker keeps only the offline shell and never caches active Atlas work", () => {
  assert.match(serviceWorker, /atlas-pwa-shell-v6/);
  assert.match(serviceWorker, /SHELL_CACHE/);
  assert.match(serviceWorker, /STATIC_CACHE/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/atlas\/"\)\) return/);
  assert.doesNotMatch(serviceWorker, /PAGE_CACHE|DATA_CACHE|preparedDataResponse|latestCachedDay/);
  assert.match(serviceWorker, /if \(request\.method !== "GET"\) return/);
  assert.doesNotMatch(serviceWorker, /respondWith\([^\n]*POST|queue.*mutation/i);
});

test("navigation gets a fresh server retry before Atlas declares the device offline", () => {
  assert.match(serviceWorker, /finishNavigationResponse/);
  assert.match(serviceWorker, /new Request\(request\.url/);
  assert.match(serviceWorker, /cache: "reload"/);
  assert.match(serviceWorker, /credentials: "same-origin"/);
  assert.match(serviceWorker, /return await finishNavigationResponse\(await fetch\(retry\)/);
  assert.match(serviceWorker, /shell\.match\("\/offline"\)/);
  assert.ok(serviceWorker.indexOf("fetch(retry)") < serviceWorker.indexOf('shell.match("/offline")'));
});

test("activation removes every earlier prepared-page and prepared-data cache", () => {
  assert.match(serviceWorker, /PRIVATE_CACHE_SUFFIXES/);
  assert.match(serviceWorker, /key\.startsWith\("atlas-pwa-"\)/);
  assert.match(serviceWorker, /!keep\.has\(key\)/);
  assert.match(serviceWorker, /ATLAS_CLEAR_PRIVATE_CACHES/);
  assert.match(serviceWorker, /finalUrl\.pathname === "\/login"/);
  assert.match(bridge, /pathname === "\/login"/);
  assert.match(bridge, /clearAtlasPrivateCaches/);
});

test("installed Atlas clients leave stale deployment code behind", () => {
  assert.match(serviceWorker, /reloadOpenAtlasClients/);
  assert.match(serviceWorker, /replacingEarlierShell/);
  assert.match(serviceWorker, /client\.navigate\(client\.url\)/);
  assert.match(buildVersionRoute, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(buildVersionRoute, /VERCEL_URL/);
  assert.match(buildVersionRoute, /no-store/);
  assert.match(bridge, /LOADED_BUILD_KEY/);
  assert.match(bridge, /fetch\("\/api\/atlas\/build-version"/);
  assert.match(bridge, /cache: "no-store"/);
  assert.match(bridge, /window\.location\.reload\(\)/);
  assert.match(bridge, /addEventListener\("pageshow", refreshNow\)/);
  assert.match(bridge, /addEventListener\("visibilitychange", refreshWhenVisible\)/);
});

test("Safari installation guidance remains explicit and the Home cover stays recognizable", () => {
  assert.match(setup, /Tap Safari’s Share button/);
  assert.match(setup, /Add to Home Screen/);
  assert.match(setup, /AtlasPwaCoverPrompt/);
  assert.match(home, /<AtlasUniversalHome/);
  assert.match(layout, /<AtlasBellCover \/>/);
  assert.match(home, /<AtlasPwaCoverPrompt/);
  assert.match(installPage, /Let Atlas carry the workday/);
});

test("notification permission remains tied to an explicit lockscreen-delivery action", () => {
  assert.match(setup, /Enable Atlas notifications/);
  assert.match(setup, /Connect lockscreen delivery/);
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

test("the installed Bell badge refreshes whenever Atlas resumes or regains connectivity", () => {
  assert.match(bellCover, /addEventListener\("focus", refreshNow\)/);
  assert.match(bellCover, /addEventListener\("pageshow", refreshNow\)/);
  assert.match(bellCover, /addEventListener\("online", refreshNow\)/);
  assert.match(bellCover, /addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(bellCover, /addEventListener\("controllerchange", refreshNow\)/);
  assert.match(bellCover, /setInterval\(refreshWhenVisible, 60_000\)/);
  assert.match(bellCover, /requestId !== requestSequence/);
});

test("offline fallback is an Atlas shell and does not claim unsynced farm truth", () => {
  assert.match(offlinePage, /Atlas is still here/);
  assert.match(offlinePage, /<AtlasOfflineRecovery \/>/);
  assert.match(offlinePage, /return to the view you were opening/);
  assert.match(serviceWorker, /server-authoritative/);
  assert.doesNotMatch(offlinePage, /saved|synced|completed|recorded/i);
});

test("the offline shell retries the real destination and leaves automatically when signal returns", () => {
  assert.match(offlineRecovery, /fetch\(probe/);
  assert.match(offlineRecovery, /cache: "no-store"/);
  assert.match(offlineRecovery, /window\.location\.replace\(destination\.href\)/);
  assert.match(offlineRecovery, /setInterval\([\s\S]*5000\)/);
  assert.match(offlineRecovery, /addEventListener\("online", resume\)/);
  assert.match(offlineRecovery, /addEventListener\("focus", resume\)/);
  assert.match(offlineRecovery, /addEventListener\("pageshow", resume\)/);
  assert.match(offlineRecovery, /addEventListener\("visibilitychange", visibility\)/);
  assert.match(offlineRecovery, /atlasOfflineFallback/);
  assert.match(offlineRecovery, /\.atlas-context-footer, \.atlas-bell-cover/);
});
