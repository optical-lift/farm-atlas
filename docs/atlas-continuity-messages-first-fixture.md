# Atlas Continuity — first Messages fixture

This is the first executable proof of the Communications Continuity contract.

It is intentionally **local and shadow-only**. The exporter reads the current macOS Messages database in read-only mode, emits canonical Atlas Communication Events into a private local NDJSON file, and writes a custody manifest. It does not upload message content, mutate Supabase, change Atlas state, or interpret messages into tasks/decisions.

## Why this exists

Before Atlas builds live Apple capture, remote/device reconciliation, or communication-derived intelligence, it needs to prove that one real human's existing Messages history can cross into a stable source-preserving contract without collapsing evidence into governing state.

The first bounded fixture should answer:

- can Atlas enumerate real Messages events in order;
- can it preserve source event/thread identity;
- can it distinguish incoming/outgoing direction;
- can it preserve exact plain text when Apple exposes it;
- can it preserve an opaque attributed-body blob without guessing when plain text is absent;
- can it produce a deterministic content fingerprint;
- can it write a custody manifest with count, range, and export SHA-256;
- can it do all of this without any write path into Messages or Atlas.

## Requirements

- macOS with Messages synced locally;
- Node/npm for this repository;
- the built-in `sqlite3` command;
- Full Disk Access for the terminal/process running the exporter so macOS permits read access to `~/Library/Messages/chat.db`.

## First bounded run

From the `farm-atlas` repository:

```bash
npm run continuity:messages:export
```

With no date argument, the first fixture is deliberately bounded to the last seven days.

The exporter writes private files under:

```text
~/.atlas-continuity/messages/
```

The NDJSON export and manifest are created with user-only file permissions. The command prints only counts, time range, paths, and the export SHA-256; it does not echo message bodies to the terminal.

## Explicit date range

```bash
npm run continuity:messages:export -- \
  --after 2026-08-24T00:00:00-05:00 \
  --before 2026-09-01T00:00:00-05:00
```

## Complete local history

Do not start with this merely to prove the extractor. Once the bounded fixture is verified:

```bash
npm run continuity:messages:export -- --all
```

`--all` means all message events present in the local Mac Messages database. It is not yet a claim that the local Mac itself contains every message that ever existed on every Apple device. That stronger claim belongs to the later reconciliation layer.

## Custody boundary

Every emitted event carries:

```text
sourceAuthority = evidence_only
permittedStateEffect = append_source_attributed_evidence_only
governingStateChanged = false
```

A communication event is evidence. It is not automatically a task, completion, directive, priority, CRM mutation, calendar change, financial action, or other institutional state.

## Opaque attributed bodies

Modern Apple Messages records do not always expose plain text in the `message.text` column. When `text` is absent but `attributedBody` exists, this first exporter preserves the exact blob as hex and emits:

```text
body = null
bodyState = attributed_body_preserved
```

Do not decode that blob heuristically and promote guessed text into source truth. A later Apple adapter may add a separately tested decoder while preserving the original bytes.

## Next tranche after this fixture passes

1. inspect a bounded real export for source fidelity;
2. add the canonical database ledger under `noel-core-db` custody, not the app repository;
3. add an authenticated ingestion API that accepts only the canonical event contract;
4. upload the same bounded export and prove idempotent custody;
5. run the exporter again over the same range and prove duplicate-safe reconciliation;
6. only then add communication interpretation/claim extraction;
7. live capture and independent device reconciliation remain separate mechanisms.

The governing build remains:

```text
source → capture → custody → reconciliation → interpretation → authorized state
```
