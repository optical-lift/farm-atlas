#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { runExport } from "./export-macos-messages.mjs";

const CONFIG_SCHEMA_VERSION = "atlas_messages_relay_config_v1";
const DEFAULT_ACCOUNT_REF = "local_apple_messages_fixture";
const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_OVERLAP_MINUTES = 10;
const INITIAL_LOOKBACK_DAYS = 7;
const CHUNK_SIZE = 500;

function defaultPaths() {
  const root = resolve(homedir(), ".atlas-continuity/messages");
  return {
    root,
    config: resolve(root, "relay.json"),
    spool: resolve(root, "relay-spool.ndjson"),
  };
}

function privateWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function readConfig(path) {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed?.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error("Messages relay config has an unsupported schema version.");
  }
  return parsed;
}

function parseArguments(argv) {
  const paths = defaultPaths();
  const options = {
    configPath: paths.config,
    ingestUrl: null,
    relayToken: null,
    accountRef: null,
    databasePath: null,
    once: false,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    overlapMinutes: DEFAULT_OVERLAP_MINUTES,
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

    if (arg === "--url") options.ingestUrl = next().trim();
    else if (arg === "--token") options.relayToken = next().trim();
    else if (arg === "--account-ref") options.accountRef = next().trim();
    else if (arg === "--db") options.databasePath = resolve(next().replace(/^~(?=\/)/, homedir()));
    else if (arg === "--config") options.configPath = resolve(next().replace(/^~(?=\/)/, homedir()));
    else if (arg === "--interval-seconds") options.intervalSeconds = Number.parseInt(next(), 10);
    else if (arg === "--overlap-minutes") options.overlapMinutes = Number.parseInt(next(), 10);
    else if (arg === "--once") options.once = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < 15) {
    throw new Error("--interval-seconds must be an integer of at least 15 seconds.");
  }
  if (!Number.isInteger(options.overlapMinutes) || options.overlapMinutes < 1 || options.overlapMinutes > 1440) {
    throw new Error("--overlap-minutes must be between 1 and 1440.");
  }
  return options;
}

function usage() {
  return `Atlas Continuity — macOS Messages foreground relay

First pairing:
  npm run continuity:messages:relay -- --url <Atlas ingest URL> --token <relay token>

Later runs:
  npm run continuity:messages:relay

Options:
  --url <https://...>       Atlas relay ingest endpoint. Saved privately on first run.
  --token <value>           Revocable relay token. Saved privately on first run.
  --account-ref <value>     Source account ref; defaults to the first Messages fixture ref.
  --db <path>               Override ~/Library/Messages/chat.db.
  --config <path>           Override ~/.atlas-continuity/messages/relay.json.
  --interval-seconds <n>    Poll interval; default 60, minimum 15.
  --overlap-minutes <n>     Re-read overlap after checkpoint; default 10.
  --once                    Run one capture/ingest pass and exit.
  --help                    Show this help.

The relay never holds a Supabase service-role key. It reads Messages with the same
read-only exporter used by the fixture proof, sends canonical evidence only, and
prints counts rather than message bodies or participant identifiers.
`;
}

function resolveConfig(options) {
  const existing = readConfig(options.configPath) ?? {};
  const paths = defaultPaths();
  const databasePath = options.databasePath
    ?? existing.databasePath
    ?? resolve(homedir(), "Library/Messages/chat.db");
  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ingestUrl: options.ingestUrl ?? existing.ingestUrl ?? null,
    relayToken: options.relayToken ?? existing.relayToken ?? null,
    accountRef: options.accountRef ?? existing.accountRef ?? DEFAULT_ACCOUNT_REF,
    databasePath,
    checkpointOccurredAt: existing.checkpointOccurredAt ?? null,
    lastSuccessfulIngestAt: existing.lastSuccessfulIngestAt ?? null,
    lastCheckedAt: existing.lastCheckedAt ?? null,
    overlapMinutes: options.overlapMinutes ?? existing.overlapMinutes ?? DEFAULT_OVERLAP_MINUTES,
    spoolPath: existing.spoolPath ?? paths.spool,
  };

  if (!config.ingestUrl || !/^https?:\/\//.test(config.ingestUrl)) {
    throw new Error("Messages relay is not paired. Supply --url from Atlas pairing.");
  }
  if (!config.relayToken || config.relayToken.length < 32) {
    throw new Error("Messages relay is not paired. Supply --token from Atlas pairing.");
  }
  if (!config.accountRef) throw new Error("Messages relay accountRef cannot be empty.");

  privateWrite(options.configPath, JSON.stringify(config, null, 2) + "\n");
  return config;
}

function readSpool(path) {
  const raw = readFileSync(path, "utf8").trim();
  return raw ? raw.split("\n").map((line) => JSON.parse(line)) : [];
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function latestOccurredAt(events) {
  const values = events.map((event) => event.occurredAt).filter(Boolean).sort();
  return values.at(-1) ?? null;
}

function captureStart(config) {
  if (!config.checkpointOccurredAt) {
    return new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  }
  const checkpoint = new Date(config.checkpointOccurredAt);
  if (Number.isNaN(checkpoint.getTime())) throw new Error("Relay checkpoint is invalid.");
  return new Date(checkpoint.getTime() - config.overlapMinutes * 60 * 1000);
}

async function postChunk(config, events, iterationId, chunkIndex, chunkCount) {
  const occurred = events.map((event) => event.occurredAt).filter(Boolean).sort();
  const response = await fetch(config.ingestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.relayToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      events,
      manifest: {
        schemaVersion: "atlas_communication_relay_manifest_v1",
        sourceKind: "apple_messages",
        sourceAccountRef: config.accountRef,
        captureMode: events[0]?.captureMode ?? "live_capture",
        sourceReadOnly: true,
        relayIterationId: iterationId,
        chunkIndex,
        chunkCount,
        eventCount: events.length,
        firstOccurredAt: occurred[0] ?? null,
        lastOccurredAt: occurred.at(-1) ?? null,
      },
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep failures body-free in terminal output.
  }
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Atlas relay ingest failed with HTTP ${response.status}.`);
  }
  return payload.receipt;
}

export async function relayIteration(config, configPath) {
  const after = captureStart(config);
  const firstCustodyPass = !config.checkpointOccurredAt;
  const captureMode = firstCustodyPass ? "historical_backfill" : "live_capture";

  const { manifest } = runExport({
    databasePath: config.databasePath,
    outputPath: config.spoolPath,
    after,
    before: null,
    all: false,
    limit: 0,
    accountRef: config.accountRef,
  });

  const captured = readSpool(manifest.exportPath).map((event) => ({
    ...event,
    captureMode,
  }));

  config.lastCheckedAt = new Date().toISOString();
  if (!captured.length) {
    privateWrite(configPath, JSON.stringify(config, null, 2) + "\n");
    return { supplied: 0, admitted: 0, alreadyInCustody: 0, conflicts: 0, lastOccurredAt: null };
  }

  const batches = chunk(captured, CHUNK_SIZE);
  const totals = { supplied: 0, admitted: 0, alreadyInCustody: 0, conflicts: 0, lastOccurredAt: latestOccurredAt(captured) };
  const iterationId = `mac-relay-${Date.now()}`;

  for (let index = 0; index < batches.length; index += 1) {
    const receipt = await postChunk(config, batches[index], iterationId, index + 1, batches.length);
    totals.supplied += Number(receipt?.supplied ?? 0);
    totals.admitted += Number(receipt?.admitted ?? 0);
    totals.alreadyInCustody += Number(receipt?.alreadyInCustody ?? 0);
    totals.conflicts += Number(receipt?.conflicts ?? 0);
  }

  if (totals.lastOccurredAt) {
    const previous = config.checkpointOccurredAt ? new Date(config.checkpointOccurredAt).getTime() : 0;
    const observed = new Date(totals.lastOccurredAt).getTime();
    if (Number.isFinite(observed) && observed > previous) config.checkpointOccurredAt = totals.lastOccurredAt;
  }
  config.lastSuccessfulIngestAt = new Date().toISOString();
  privateWrite(configPath, JSON.stringify(config, null, 2) + "\n");
  return totals;
}

function renderTotals(totals) {
  return [
    `Observed: ${totals.supplied}`,
    `Admitted: ${totals.admitted}`,
    `Already in custody: ${totals.alreadyInCustody}`,
    `Conflicts: ${totals.conflicts}`,
    `Custody through: ${totals.lastOccurredAt ?? "no new source events"}`,
  ].join(" · ");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (process.platform !== "darwin") throw new Error("The Apple Messages relay must run on macOS.");

  const config = resolveConfig(options);
  process.stdout.write("Atlas Continuity Messages relay started. No message bodies will be printed.\n");

  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  do {
    try {
      const totals = await relayIteration(config, options.configPath);
      process.stdout.write(`${new Date().toISOString()} · ${renderTotals(totals)}\n`);
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} · Relay pass failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    if (options.once || stopping) break;
    await sleep(options.intervalSeconds * 1000);
  } while (!stopping);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
