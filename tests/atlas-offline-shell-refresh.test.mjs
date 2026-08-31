import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const worker = read("public/sw.js");
const offline = read("app/offline/page.tsx");
const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");

test("person-owned entry and client-version changes invalidate the previously cached offline shell", () => {
  assert.match(worker, /atlas-pwa-shell-v12/);
  assert.match(worker, /refreshes installed clients after the person-owned Atlas entry-point change/);
  assert.match(worker, /Bump this version whenever the offline document or global app chrome changes/);
  assert.match(worker, /cache: "reload"/);
  assert.match(worker, /reloadOpenAtlasClients/);
});

test("the offline fallback uses current Atlas navigation language without advertising paused Bell", () => {
  assert.match(offline, /Home, Work, Zone Registry, or Project/);
  assert.doesNotMatch(offline, /Home, Work, Bell/);
  assert.match(offline, />Work<\/Link>/);
  assert.doesNotMatch(offline, /Home, Day, Bell, Place/);
});

test("the global dock stays absent from the dedicated offline fallback", () => {
  assert.match(frame, /const HIDDEN_PATHS = \[/);
  assert.match(frame, /"\/login"/);
  assert.match(frame, /"\/auth"/);
  assert.match(frame, /"\/offline"/);
  assert.match(frame, /if \(hidden\) return null/);
});
