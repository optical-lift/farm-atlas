#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
export const EVENT_SCHEMA_VERSION = "atlas_communication_event_v1";
export const MANIFEST_SCHEMA_VERSION = "atlas_communication_manifest_v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value) {
  return typeof value === "string" && value.length ? value : null;
}

function integerFlag(value) {
  return Number(value) === 1;
}

function decodeSqliteHex(value) {
  if (!value) return "";
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw new Error("SQLite returned a malformed hex-encoded text field.");
  }
  return Buffer.from(value, "hex").toString("utf8");
}

export function appleTimestampToIso(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;

  let raw;
  try {
    raw = BigInt(String(rawValue));
  } catch {
    return null;
  }

  if (raw <= 0n) return null;

  // Modern Messages databases store nanoseconds since 2001. Older migrated
  // stores can contain lower-resolution values, so preserve a bounded fallback.
  let millisecondsSinceAppleEpoch;
  if (raw > 100_000_000_000_000n) {
    millisecondsSinceAppleEpoch = raw / 1_000_000n;
  } else if (raw > 100_000_000_000n) {
    millisecondsSinceAppleEpoch = raw / 1_000n;
  } else {
    millisecondsSinceAppleEpoch = raw * 1_000n;
  }

  const unixMilliseconds = BigInt(APPLE_EPOCH_MS) + millisecondsSinceAppleEpoch;
  const numeric = Number(unixMilliseconds);
  if (!Number.isFinite(numeric)) return null;

  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dateToAppleNanoseconds(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("A valid Date is required.");
  }
  return (BigInt(date.getTime() - APPLE_EPOCH_MS) * 1_000_000n).toString();
}

function sourceFingerprintMaterial(row) {
  return JSON.stringify({
    rowId: String(row.source_row_id ?? ""),
    guid: String(row.source_event_id ?? ""),
    threadGuid: String(row.source_thread_id ?? ""),
    sender: String(row.sender_address ?? ""),
    participants: String(row.participant_addresses ?? ""),
    isFromMe: Number(row.is_from_me ?? 0),
    appleDate: String(row.apple_date ?? ""),
    service: String(row.service ?? ""),
    text: row.text ?? null,
    attributedBodyHex: String(row.attributed_body_hex ?? ""),
    associatedMessageGuid: String(row.associated_message_guid ?? ""),
    associatedMessageType: String(row.associated_message_type ?? ""),
  });
}

export function normalizeMessageRow(
  row,
  {
    accountRef = "local_apple_messages_fixture",
    capturedAt = new Date().toISOString(),
    captureMode = "historical_backfill",
  } = {},
) {
  const rowId = String(row.source_row_id ?? "").trim();
  const guid = String(row.source_event_id ?? "").trim();
  const threadGuid = String(row.source_thread_id ?? "").trim();
  const senderAddress = String(row.sender_address ?? "").trim();
  const attributedBodyHex = String(row.attributed_body_hex ?? "").trim();
  const body = cleanText(row.text);
  const isSelf = integerFlag(row.is_from_me);

  const bodyState = body !== null
    ? "exact_text"
    : attributedBodyHex
      ? "attributed_body_preserved"
      : "empty";

  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    source: {
      kind: "apple_messages",
      accountRef,
      eventRef: guid || `apple-message-rowid:${rowId || "unknown"}`,
      threadRef: threadGuid || null,
    },
    captureMode,
    sourceAuthority: "evidence_only",
    permittedStateEffect: "append_source_attributed_evidence_only",
    governingStateChanged: false,
    direction: isSelf ? "outgoing" : senderAddress ? "incoming" : "unknown",
    speaker: {
      isSelf,
      address: isSelf ? null : senderAddress || null,
    },
    occurredAt: appleTimestampToIso(row.apple_date),
    capturedAt,
    body,
    bodyState,
    contentHash: sha256(sourceFingerprintMaterial(row)),
    sourcePayload: {
      sourceRowId: rowId || null,
      appleDate: String(row.apple_date ?? "") || null,
      appleDateDelivered: String(row.apple_date_delivered ?? "") || null,
      appleDateRead: String(row.apple_date_read ?? "") || null,
      service: String(row.service ?? "") || null,
      participantAddresses: String(row.participant_addresses ?? "") || null,
      attributedBodyHex: attributedBodyHex || null,
      associatedMessageGuid: String(row.associated_message_guid ?? "") || null,
      associatedMessageType: String(row.associated_message_type ?? "") || null,
    },
  };
}

function sqliteTabLines(databasePath, sql) {
  try {
    // Use only sqlite3 shell features present in older macOS releases. Variable
    // text fields in the Messages query are hex-encoded by SQL before they cross
    // this tab-delimited transport, so embedded tabs/newlines/emoji cannot split rows.
    const stdout = execFileSync(
      "sqlite3",
      ["-readonly", databasePath],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
        input: `.mode tabs\nPRAGMA query_only=ON;\n${sql}\n`,
      },
    );

    const withoutFinalNewline = stdout.replace(/\r?\n$/, "");
    return withoutFinalNewline ? withoutFinalNewline.split(/\r?\n/) : [];
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const message = stderr || error?.message || "Unknown sqlite3 error";
    throw new Error(
      `Unable to read Messages database in read-only mode. ${message}\n` +
      "On macOS, make sure Messages has synced locally and the terminal running this command has Full Disk Access.",
    );
  }
}

function tableColumns(databasePath, tableName) {
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, "");
  const lines = sqliteTabLines(databasePath, `PRAGMA table_info(${safeName});`);
  return new Set(lines.map((line) => line.split("\t")[1]).filter(Boolean));
}

function optionalHexColumn(columns, name, fallback = "''") {
  return columns.has(name)
    ? `hex(COALESCE(CAST(m.${name} AS TEXT), ''))`
    : fallback;
}

function optionalTextColumn(columns, name, fallback = "''") {
  return columns.has(name) ? `COALESCE(CAST(m.${name} AS TEXT), '')` : fallback;
}

export function buildMessageQuery({ columns, afterAppleNs = null, beforeAppleNs = null, limit = 0 }) {
  const conditions = [];
  if (afterAppleNs !== null) conditions.push(`m.date >= ${BigInt(afterAppleNs).toString()}`);
  if (beforeAppleNs !== null) conditions.push(`m.date < ${BigInt(beforeAppleNs).toString()}`);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? `LIMIT ${Math.min(limit, 1_000_000)}` : "";

  return `
SELECT
  CAST(m.ROWID AS TEXT),
  hex(COALESCE(CAST(m.guid AS TEXT), '')),
  hex(COALESCE(CAST((
    SELECT c.guid
    FROM chat_message_join cmj
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE cmj.message_id = m.ROWID
    ORDER BY cmj.chat_id
    LIMIT 1
  ) AS TEXT), '')),
  hex(COALESCE(CAST(h.id AS TEXT), '')),
  hex(COALESCE(CAST((
    SELECT group_concat(participant.id, ',')
    FROM chat_message_join cmj2
    JOIN chat_handle_join chj ON chj.chat_id = cmj2.chat_id
    JOIN handle participant ON participant.ROWID = chj.handle_id
    WHERE cmj2.message_id = m.ROWID
  ) AS TEXT), '')),
  CAST(COALESCE(m.is_from_me, 0) AS TEXT),
  CAST(m.date AS TEXT),
  ${optionalTextColumn(columns, "date_delivered")},
  ${optionalTextColumn(columns, "date_read")},
  ${optionalHexColumn(columns, "service")},
  ${optionalHexColumn(columns, "text")},
  ${columns.has("attributedBody") ? "CASE WHEN m.attributedBody IS NULL THEN '' ELSE hex(m.attributedBody) END" : "''"},
  ${optionalHexColumn(columns, "associated_message_guid")},
  ${optionalTextColumn(columns, "associated_message_type")}
FROM message m
LEFT JOIN handle h ON h.ROWID = m.handle_id
${where}
ORDER BY m.date ASC, m.ROWID ASC
${boundedLimit};`;
}

function parseMessageLine(line) {
  const fields = line.split("\t");
  if (fields.length !== 14) {
    throw new Error(`SQLite Messages row had ${fields.length} fields; expected 14.`);
  }

  return {
    source_row_id: fields[0],
    source_event_id: decodeSqliteHex(fields[1]),
    source_thread_id: decodeSqliteHex(fields[2]),
    sender_address: decodeSqliteHex(fields[3]),
    participant_addresses: decodeSqliteHex(fields[4]),
    is_from_me: fields[5],
    apple_date: fields[6],
    apple_date_delivered: fields[7],
    apple_date_read: fields[8],
    service: decodeSqliteHex(fields[9]),
    text: decodeSqliteHex(fields[10]),
    attributed_body_hex: fields[11],
    associated_message_guid: decodeSqliteHex(fields[12]),
    associated_message_type: fields[13],
  };
}

function parseArguments(argv) {
  const options = {
    databasePath: resolve(homedir(), "Library/Messages/chat.db"),
    outputPath: null,
    after: null,
    before: null,
    all: false,
    limit: 0,
    accountRef: "local_apple_messages_fixture",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };

    if (arg === "--db") options.databasePath = resolve(next().replace(/^~(?=\/)/, homedir()));
    else if (arg === "--output") options.outputPath = resolve(next().replace(/^~(?=\/)/, homedir()));
    else if (arg === "--after") options.after = new Date(next());
    else if (arg === "--before") options.before = new Date(next());
    else if (arg === "--limit") options.limit = Number.parseInt(next(), 10);
    else if (arg === "--account-ref") options.accountRef = next().trim();
    else if (arg === "--all") options.all = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.after && Number.isNaN(options.after.getTime())) throw new Error("--after must be a valid date/time.");
  if (options.before && Number.isNaN(options.before.getTime())) throw new Error("--before must be a valid date/time.");
  if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error("--limit must be a non-negative integer.");
  if (!options.accountRef) throw new Error("--account-ref cannot be empty.");
  if (options.all && options.after) throw new Error("Use either --all or --after, not both.");

  return options;
}

function defaultOutputPath(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return resolve(homedir(), ".atlas-continuity/messages", `apple-messages-${stamp}.ndjson`);
}

function usage() {
  return `Atlas Continuity — macOS Messages read-only exporter

Usage:
  npm run continuity:messages:export -- [options]

Options:
  --after <ISO date>       Export messages on/after this time.
  --before <ISO date>      Export messages before this time.
  --all                    Export the complete local Messages history.
  --limit <count>          Optional row limit for a bounded fixture.
  --account-ref <value>    Stable local source-account label.
  --db <path>              Override ~/Library/Messages/chat.db.
  --output <path>          Override the private NDJSON output path.
  --help                   Show this help.

Safety:
  The source database is opened with sqlite3 -readonly and PRAGMA query_only=ON.
  Nothing is uploaded and no Atlas state is changed. If neither --after nor --all
  is supplied, the exporter defaults to the last seven days for the first fixture.
`;
}

function writePrivateFile(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function runExport(options) {
  if (process.platform !== "darwin") {
    throw new Error("The Apple Messages fixture exporter must be run on macOS.");
  }
  if (!existsSync(options.databasePath)) {
    throw new Error(`Messages database not found at ${options.databasePath}. Make sure Messages has synced locally.`);
  }

  const capturedAt = new Date().toISOString();
  const afterDate = options.all
    ? null
    : options.after ?? new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));

  const columns = tableColumns(options.databasePath, "message");
  const query = buildMessageQuery({
    columns,
    afterAppleNs: afterDate ? dateToAppleNanoseconds(afterDate) : null,
    beforeAppleNs: options.before ? dateToAppleNanoseconds(options.before) : null,
    limit: options.limit,
  });

  const rows = sqliteTabLines(options.databasePath, query).map(parseMessageLine);
  const events = rows.map((row) => normalizeMessageRow(row, {
    accountRef: options.accountRef,
    capturedAt,
    captureMode: "historical_backfill",
  }));

  const ndjson = events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : "");
  const outputPath = options.outputPath ?? defaultOutputPath();
  writePrivateFile(outputPath, ndjson);

  const occurred = events.map((event) => event.occurredAt).filter(Boolean).sort();
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sourceKind: "apple_messages",
    captureMode: "historical_backfill",
    sourceAccountRef: options.accountRef,
    capturedAt,
    sourceDatabasePath: options.databasePath,
    sourceReadOnly: true,
    eventCount: events.length,
    firstOccurredAt: occurred[0] ?? null,
    lastOccurredAt: occurred.at(-1) ?? null,
    exportSha256: sha256(ndjson),
    exportPath: outputPath,
  };

  const manifestPath = outputPath.endsWith(".ndjson")
    ? outputPath.slice(0, -".ndjson".length) + ".manifest.json"
    : outputPath + ".manifest.json";
  writePrivateFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return { manifest, manifestPath };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(usage());
      return;
    }

    const { manifest, manifestPath } = runExport(options);
    process.stdout.write([
      "Atlas Continuity Messages fixture exported locally.",
      `Events: ${manifest.eventCount}`,
      `First event: ${manifest.firstOccurredAt ?? "none"}`,
      `Last event: ${manifest.lastOccurredAt ?? "none"}`,
      `Export: ${manifest.exportPath}`,
      `Manifest: ${manifestPath}`,
      `SHA-256: ${manifest.exportSha256}`,
      "No data was uploaded and no Atlas governing state changed.",
      "",
    ].join("\n"));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
