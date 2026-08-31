"use client";

import { useMemo, useState } from "react";

type PairingResult = {
  ok: boolean;
  relayToken?: string;
  ingestUrl?: string;
  providerAccountKey?: string;
  displayLabel?: string;
  error?: string;
};

export default function MessagesContinuityPage() {
  const [label, setLabel] = useState("This Mac · Apple Messages");
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  const command = useMemo(() => {
    if (!pairing?.relayToken || !pairing.ingestUrl) return "";
    return `npm run continuity:messages:relay -- --url ${JSON.stringify(pairing.ingestUrl)} --token ${JSON.stringify(pairing.relayToken)}`;
  }, [pairing]);

  async function pair() {
    setWorking(true);
    setCopied(false);
    try {
      const response = await fetch("/api/continuity/messages/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayLabel: label,
          providerAccountKey: "local_apple_messages_fixture",
        }),
      });
      const body = await response.json() as PairingResult;
      setPairing(body);
    } catch {
      setPairing({ ok: false, error: "Unable to pair this Mac." });
    } finally {
      setWorking(false);
    }
  }

  async function copyCommand() {
    if (!command) return;
    await navigator.clipboard.writeText(command);
    setCopied(true);
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 sm:px-8">
      <div className="mb-8">
        <a href="/owner" className="text-sm text-neutral-500 hover:text-neutral-900">← Owner</a>
      </div>

      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">Atlas Continuity</p>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Apple Messages</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
          Pair this Mac as a person-owned, read-only communication source. Atlas will preserve messages as evidence only; pairing does not create tasks, sales, decisions, or other governing state.
        </p>

        {!pairing?.ok ? (
          <div className="mt-8 space-y-4">
            <label className="block text-sm font-medium text-neutral-800">
              Source label
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="mt-2 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                maxLength={160}
              />
            </label>
            <button
              type="button"
              onClick={pair}
              disabled={working}
              className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {working ? "Pairing…" : "Pair this Mac"}
            </button>
            {pairing?.error ? <p className="text-sm text-red-700">{pairing.error}</p> : null}
          </div>
        ) : (
          <div className="mt-8 space-y-5">
            <div className="rounded-2xl bg-neutral-50 p-4">
              <p className="text-sm font-medium text-neutral-900">Paired.</p>
              <p className="mt-1 text-sm leading-6 text-neutral-600">
                This relay token is shown once. The command stores it under <code>~/.atlas-continuity/messages/relay.json</code> with user-only permissions.
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-neutral-800">Run this once in the farm-atlas Terminal:</p>
              <pre className="overflow-x-auto rounded-2xl bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">{command}</pre>
            </div>

            <button
              type="button"
              onClick={copyCommand}
              className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-900"
            >
              {copied ? "Copied" : "Copy command"}
            </button>

            <p className="text-xs leading-5 text-neutral-500">
              After the first run, use <code>npm run continuity:messages:relay</code>. The foreground relay rereads an overlapping source window so sleep/offline time can catch up without duplicating messages.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
