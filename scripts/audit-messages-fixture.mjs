#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function newestExport(directory) {
  const files = readdirSync(directory)
    .filter((name) => name.startsWith("apple-messages-") && name.endsWith(".ndjson"))
    .sort()
    .reverse();
  return files[0] ? resolve(directory, files[0]) : null;
}

function parseArgs(argv) {
  const options = { input: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--input") {
      const value = argv[index + 1];
      if (!value) throw new Error("--input requires a path.");
      index += 1;
      options.input = resolve(value.replace(/^~(?=\/)/, homedir()));
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Atlas Continuity — privacy-safe Messages fixture audit\n\nUsage:\n  npm run continuity:messages:audit -- [--input <path>] [--json]\n\nThe audit prints counts and custody/fidelity diagnostics only. It never prints message bodies, phone numbers, email addresses, participant lists, thread IDs, or source message IDs.\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

export function auditFixture(raw, manifest = null) {
  const lines = raw.split("\n").filter(Boolean);
  const directions = new Map();
  const bodyStates = new Map();
  const services = new Map();
  const threadRefs = new Set();
  const eventRefs = new Set();
  const contentHashes = new Set();
  let duplicateEventRefs = 0;
  let duplicateContentHashes = 0;
  let missingOccurredAt = 0;
  let missingThreadRef = 0;
  let missingEventRef = 0;
  let invalidEvents = 0;
  let firstOccurredAt = null;
  let lastOccurredAt = null;

  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Fixture contains invalid JSON on line ${index + 1}.`);
    }

    if (event?.schemaVersion !== "atlas_communication_event_v1" || event?.source?.kind !== "apple_messages") {
      invalidEvents += 1;
    }

    increment(directions, event?.direction ?? "missing");
    increment(bodyStates, event?.bodyState ?? "missing");
    increment(services, event?.sourcePayload?.service ?? "unknown");

    const eventRef = event?.source?.eventRef;
    if (!eventRef) missingEventRef += 1;
    else if (eventRefs.has(eventRef)) duplicateEventRefs += 1;
    else eventRefs.add(eventRef);

    const threadRef = event?.source?.threadRef;
    if (!threadRef) missingThreadRef += 1;
    else threadRefs.add(threadRef);

    const hash = event?.contentHash;
    if (hash) {
      if (contentHashes.has(hash)) duplicateContentHashes += 1;
      else contentHashes.add(hash);
    }

    const occurredAt = event?.occurredAt;
    if (!occurredAt) {
      missingOccurredAt += 1;
    } else {
      if (!firstOccurredAt || occurredAt < firstOccurredAt) firstOccurredAt = occurredAt;
      if (!lastOccurredAt || occurredAt > lastOccurredAt) lastOccurredAt = occurredAt;
    }
  }

  const computedSha256 = sha256(raw);
  const manifestCountMatches = manifest ? manifest.eventCount === lines.length : null;
  const manifestHashMatches = manifest ? manifest.exportSha256 === computedSha256 : null;
  const exactText = bodyStates.get("exact_text") ?? 0;
  const opaque = bodyStates.get("attributed_body_preserved") ?? 0;
  const empty = bodyStates.get("empty") ?? 0;

  return {
    schemaVersion: "atlas_communication_fixture_audit_v1",
    privacy: "counts_only_no_message_content_or_identifiers",
    eventCount: lines.length,
    firstOccurredAt,
    lastOccurredAt,
    uniqueThreadCount: threadRefs.size,
    directions: sortedObject(directions),
    bodyStates: sortedObject(bodyStates),
    bodyCoverage: {
      exactTextCount: exactText,
      exactTextPercent: lines.length ? Number(((exactText / lines.length) * 100).toFixed(2)) : 0,
      attributedBodyPreservedCount: opaque,
      attributedBodyPreservedPercent: lines.length ? Number(((opaque / lines.length) * 100).toFixed(2)) : 0,
      emptyCount: empty,
      emptyPercent: lines.length ? Number(((empty / lines.length) * 100).toFixed(2)) : 0,
    },
    services: sortedObject(services),
    integrity: {
      invalidEvents,
      missingEventRef,
      missingThreadRef,
      missingOccurredAt,
      duplicateEventRefs,
      duplicateContentHashes,
      computedSha256,
      manifestPresent: Boolean(manifest),
      manifestCountMatches,
      manifestHashMatches,
    },
  };
}

function humanReport(path, audit) {
  const lines = [
    "Atlas Continuity Messages fixture audit",
    "",
    `Fixture: ${path}`,
    `Events: ${audit.eventCount}`,
    `Range: ${audit.firstOccurredAt ?? "unknown"} → ${audit.lastOccurredAt ?? "unknown"}`,
    `Unique threads: ${audit.uniqueThreadCount}`,
    "",
    "Directions:",
    ...Object.entries(audit.directions).map(([key, value]) => `  ${key}: ${value}`),
    "",
    "Body fidelity:",
    `  exact text: ${audit.bodyCoverage.exactTextCount} (${audit.bodyCoverage.exactTextPercent}%)`,
    `  opaque attributed body preserved: ${audit.bodyCoverage.attributedBodyPreservedCount} (${audit.bodyCoverage.attributedBodyPreservedPercent}%)`,
    `  empty: ${audit.bodyCoverage.emptyCount} (${audit.bodyCoverage.emptyPercent}%)`,
    "",
    "Services:",
    ...Object.entries(audit.services).map(([key, value]) => `  ${key}: ${value}`),
    "",
    "Integrity:",
    `  invalid canonical events: ${audit.integrity.invalidEvents}`,
    `  missing event refs: ${audit.integrity.missingEventRef}`,
    `  missing thread refs: ${audit.integrity.missingThreadRef}`,
    `  missing timestamps: ${audit.integrity.missingOccurredAt}`,
    `  duplicate event refs: ${audit.integrity.duplicateEventRefs}`,
    `  duplicate content hashes: ${audit.integrity.duplicateContentHashes}`,
    `  manifest present: ${audit.integrity.manifestPresent ? "yes" : "no"}`,
    `  manifest count matches: ${audit.integrity.manifestCountMatches === null ? "not checked" : audit.integrity.manifestCountMatches ? "yes" : "NO"}`,
    `  manifest hash matches: ${audit.integrity.manifestHashMatches === null ? "not checked" : audit.integrity.manifestHashMatches ? "yes" : "NO"}`,
    "",
    "Privacy: no message bodies, addresses, participant lists, thread IDs, or source message IDs were printed.",
    "",
  ];
  return lines.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const directory = resolve(homedir(), ".atlas-continuity/messages");
    const input = options.input ?? (existsSync(directory) ? newestExport(directory) : null);
    if (!input || !existsSync(input)) throw new Error("No Messages NDJSON fixture found. Run the exporter first or pass --input <path>.");

    const raw = readFileSync(input, "utf8");
    const manifestPath = input.endsWith(".ndjson") ? input.slice(0, -".ndjson".length) + ".manifest.json" : null;
    const manifest = manifestPath && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    const audit = auditFixture(raw, manifest);

    process.stdout.write(options.json ? JSON.stringify(audit, null, 2) + "\n" : humanReport(input, audit));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
