import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { auditFixture } from "../scripts/audit-messages-fixture.mjs";
import {
  appleTimestampToIso,
  buildMessageQuery,
  dateToAppleNanoseconds,
  normalizeMessageRow,
} from "../scripts/export-macos-messages.mjs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Apple timestamp conversion round-trips without using floating-point source time", () => {
  const expected = new Date("2026-08-31T15:00:00.000Z");
  const apple = dateToAppleNanoseconds(expected);
  assert.equal(appleTimestampToIso(apple), expected.toISOString());
});

test("Messages rows become evidence-only canonical communication events", () => {
  const capturedAt = "2026-08-31T15:32:00.000Z";
  const occurredAt = "2026-08-31T15:31:00.000Z";
  const row = {
    source_row_id: "42",
    source_event_id: "p:0/ABC-123",
    source_thread_id: "iMessage;+;chatABC",
    sender_address: "+14175551212",
    participant_addresses: "+14175551212",
    is_from_me: 0,
    apple_date: dateToAppleNanoseconds(new Date(occurredAt)),
    apple_date_delivered: "",
    apple_date_read: "",
    service: "iMessage",
    text: "Anna finished the lisianthus.",
    attributed_body_hex: "",
    associated_message_guid: "",
    associated_message_type: "",
  };

  const event = normalizeMessageRow(row, {
    accountRef: "fixture-account",
    capturedAt,
  });

  assert.equal(event.schemaVersion, "atlas_communication_event_v1");
  assert.equal(event.source.kind, "apple_messages");
  assert.equal(event.source.accountRef, "fixture-account");
  assert.equal(event.source.eventRef, row.source_event_id);
  assert.equal(event.source.threadRef, row.source_thread_id);
  assert.equal(event.direction, "incoming");
  assert.deepEqual(event.speaker, { isSelf: false, address: "+14175551212" });
  assert.equal(event.occurredAt, occurredAt);
  assert.equal(event.body, row.text);
  assert.equal(event.bodyState, "exact_text");
  assert.equal(event.sourceAuthority, "evidence_only");
  assert.equal(event.permittedStateEffect, "append_source_attributed_evidence_only");
  assert.equal(event.governingStateChanged, false);
  assert.match(event.contentHash, /^[a-f0-9]{64}$/);
});

test("opaque Apple attributed bodies are preserved instead of guessed", () => {
  const event = normalizeMessageRow({
    source_row_id: "77",
    source_event_id: "guid-77",
    source_thread_id: "chat-77",
    sender_address: "",
    participant_addresses: "+14175550000",
    is_from_me: 1,
    apple_date: dateToAppleNanoseconds(new Date("2026-08-31T15:31:00.000Z")),
    service: "iMessage",
    text: null,
    attributed_body_hex: "010203AABBCC",
  });

  assert.equal(event.direction, "outgoing");
  assert.deepEqual(event.speaker, { isSelf: true, address: null });
  assert.equal(event.body, null);
  assert.equal(event.bodyState, "attributed_body_preserved");
  assert.equal(event.sourcePayload.attributedBodyHex, "010203AABBCC");
});

test("the source query is bounded and the legacy-compatible read path preserves custody", () => {
  const query = buildMessageQuery({
    columns: new Set([
      "date_delivered",
      "date_read",
      "service",
      "text",
      "attributedBody",
      "associated_message_guid",
      "associated_message_type",
    ]),
    afterAppleNs: "100",
    beforeAppleNs: "200",
    limit: 50,
  });
  const exporter = read("scripts/export-macos-messages.mjs");

  assert.match(query, /m\.date >= 100/);
  assert.match(query, /m\.date < 200/);
  assert.match(query, /LIMIT 50/);
  assert.match(query, /hex\(COALESCE\(CAST\(m\.guid AS TEXT\)/);
  assert.match(query, /hex\(COALESCE\(CAST\(m\.text AS TEXT\)/);
  assert.match(exporter, /\["-readonly", databasePath\]/);
  assert.match(exporter, /\.mode tabs/);
  assert.doesNotMatch(exporter, /\.mode json|"-json"/);
  assert.match(exporter, /PRAGMA query_only=ON/);
  assert.match(exporter, /decodeSqliteHex/);
  assert.doesNotMatch(exporter, /fetch\(|supabase|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
});

test("privacy-safe fixture audit exposes structural counts without communication content or identifiers", () => {
  const privateBody = "This is a private message body that must never appear in audit output.";
  const privateAddress = "+14175551212";
  const privateEventRef = "p:0/PRIVATE-GUID";
  const event = normalizeMessageRow({
    source_row_id: "91",
    source_event_id: privateEventRef,
    source_thread_id: "iMessage;+;private-thread",
    sender_address: privateAddress,
    participant_addresses: privateAddress,
    is_from_me: 0,
    apple_date: dateToAppleNanoseconds(new Date("2026-08-31T15:31:00.000Z")),
    service: "iMessage",
    text: privateBody,
    attributed_body_hex: "",
  });
  const raw = `${JSON.stringify(event)}\n`;
  const audit = auditFixture(raw, {
    eventCount: 1,
    exportSha256: createHash("sha256").update(raw).digest("hex"),
  });
  const rendered = JSON.stringify(audit);

  assert.equal(audit.eventCount, 1);
  assert.equal(audit.uniqueThreadCount, 1);
  assert.equal(audit.directions.incoming, 1);
  assert.equal(audit.bodyCoverage.exactTextCount, 1);
  assert.equal(audit.integrity.manifestCountMatches, true);
  assert.equal(audit.integrity.manifestHashMatches, true);
  assert.doesNotMatch(rendered, new RegExp(privateBody));
  assert.doesNotMatch(rendered, new RegExp(privateAddress.replace(/[+]/g, "\\+")));
  assert.doesNotMatch(rendered, new RegExp(privateEventRef));
});

test("the universal communication contract does not grant communication evidence governing authority", () => {
  const contract = read("lib/atlas/continuity/communication.ts");

  assert.match(contract, /sourceAuthority: "evidence_only"/);
  assert.match(contract, /permittedStateEffect: "append_source_attributed_evidence_only"/);
  assert.match(contract, /governingStateChanged: false/);
  assert.match(contract, /"apple_messages"/);
  assert.match(contract, /"email"/);
  assert.match(contract, /"call_transcript"/);
  assert.doesNotMatch(contract, /Nathan|Anna|Elm Farm|real estate/i);
});

test("the foreground relay reuses the read-only exporter and never carries database authority", () => {
  const relay = read("scripts/relay-macos-messages.mjs");
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(packageJson.scripts["continuity:messages:relay"], "node scripts/relay-macos-messages.mjs");
  assert.match(relay, /import \{ runExport \} from "\.\/export-macos-messages\.mjs"/);
  assert.match(relay, /mode: 0o600/);
  assert.match(relay, /Authorization: `Bearer \$\{config\.relayToken\}`/);
  assert.match(relay, /overlapMinutes/);
  assert.match(relay, /Already in custody/);
  assert.doesNotMatch(relay, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/);
  assert.doesNotMatch(relay, /event\.body|speaker\.address|participantAddresses/);
});

test("pairing and relay ingestion keep service authority server-side and evidence-only", () => {
  const pairing = read("app/api/continuity/messages/pair/route.ts");
  const ingest = read("app/api/continuity/messages/ingest/route.ts");

  assert.match(pairing, /createAtlasServerClient/);
  assert.match(pairing, /randomBytes\(32\)/);
  assert.match(pairing, /register_communication_relay_api_v1/);
  assert.doesNotMatch(pairing, /createAtlasAdminClient|SUPABASE_SERVICE_ROLE_KEY/);

  assert.match(ingest, /createAtlasAdminClient/);
  assert.match(ingest, /createHash\("sha256"\)\.update\(token\)/);
  assert.match(ingest, /ingest_communication_events_relay_api_v1/);
  assert.match(ingest, /sourceAuthority !== "evidence_only"/);
  assert.match(ingest, /governingStateChanged !== false/);
  assert.doesNotMatch(ingest, /console\.log|JSON\.stringify\(events\)/);
});
