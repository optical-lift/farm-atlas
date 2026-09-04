import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const adapter = read("lib/atlas/integrations/providers/apple-messages.ts");
const exporter = read("scripts/export-macos-messages.mjs");

test("Apple Messages legacy event remains evidence-only through the portable adapter", () => {
  assert.match(exporter, /sourceAuthority: "evidence_only"/);
  assert.match(exporter, /permittedStateEffect: "append_source_attributed_evidence_only"/);
  assert.match(exporter, /governingStateChanged: false/);

  assert.match(adapter, /authority: "evidence_only"/);
  assert.match(adapter, /transport: "relay"/);
  assert.match(adapter, /capability: "communication"/);
  assert.doesNotMatch(adapter, /canonical_authority|governing_authority/);
});

test("Apple Messages adapter reuses existing durable source identity and fingerprint", () => {
  assert.match(exporter, /eventRef: guid \|\| `apple-message-rowid:/);
  assert.match(exporter, /contentHash: sha256\(sourceFingerprintMaterial\(row\)\)/);

  assert.match(adapter, /sourceEventRef: event\.source\.eventRef/);
  assert.match(adapter, /sourceContentSha256: event\.contentHash/);
  assert.match(adapter, /event\.source\.eventRef,/);
  assert.match(adapter, /event\.contentHash,/);
});

test("Apple Messages adapter preserves source time and capture time separately", () => {
  assert.match(exporter, /occurredAt: appleTimestampToIso\(row\.apple_date\)/);
  assert.match(exporter, /capturedAt,/);

  assert.match(adapter, /occurredAt: event\.occurredAt \?\? null/);
  assert.match(adapter, /receivedAt: event\.capturedAt/);
});

test("Apple Messages adapter validates provider account custody instead of joining by mutable address", () => {
  assert.match(adapter, /source\.providerAccountKey !== event\.source\.accountRef/);
  assert.match(adapter, /custody: source\.custody/);
  assert.doesNotMatch(adapter, /speaker\.address.*sourceId|sourceId.*speaker\.address/);
});
