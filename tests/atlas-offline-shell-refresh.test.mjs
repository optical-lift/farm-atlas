import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const worker = read("public/sw.js");
const offline = read("app/offline/page.tsx");
const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");

test("dock and client-version changes invalidate the previously cached offline shell", () => {
  assert.match(worker, /atlas-pwa-shell-v9/);
  assert.match(worker, /adds best-effort iPhone notification actions/);
  assert.match(worker, /Bump this version whenever the offline document or global app chrome changes/);
  assert.match(worker, /cache: "reload"/);
  assert.match(worker, /reloadOpenAtlasClients/);
});

test("the offline fallback uses current Atlas navigation language", () => {
  assert.match(offline, /Home, Work, Bell, Zone Registry, or Project/);
  assert.match(offline, />Work<\/Link>/);
  assert.doesNotMatch(offline, /Home, Day, Bell, Place/);
});

test("the global dock stays absent from the dedicated offline fallback", () => {
  assert.match(frame, /const HIDDEN_PATHS = \["\/login", "\/auth", "\/offline"\]/);
});
