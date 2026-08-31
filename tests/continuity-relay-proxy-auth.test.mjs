import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxy = readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");
const ingest = readFileSync(new URL("../app/api/continuity/messages/ingest/route.ts", import.meta.url), "utf8");

test("Messages relay bypasses browser-session auth only at the exact ingest route", () => {
  assert.match(proxy, /function isExternallyAuthenticatedPath\(pathname: string\)/);
  assert.match(proxy, /return pathname === "\/api\/continuity\/messages\/ingest"/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\("\/api\/continuity\//);
  assert.doesNotMatch(proxy, /pathname === "\/api\/continuity\/messages\/pair"/);
  assert.match(proxy, /!isExternallyAuthenticatedPath\(pathname\)/);
});

test("the externally authenticated ingest route still requires the relay bearer credential", () => {
  assert.match(ingest, /authorization\.startsWith\("Bearer "\)/);
  assert.match(ingest, /createHash\("sha256"\)\.update\(token\)/);
  assert.match(ingest, /ingest_communication_events_relay_api_v1/);
  assert.match(ingest, /Relay credential required\./);
});
