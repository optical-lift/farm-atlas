"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type NetworkContext = {
  workRhythm?: string | null;
  collectionLabel?: string | null;
  displaySubject?: string | null;
  networkShiftReason?: string | null;
};

type ConfirmationItem = {
  decisionId: string;
  taskId: string;
  prompt: string;
  title: string;
  dueDate?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  networkContext?: NetworkContext | null;
};

type ConfirmationQueue = {
  pendingCount?: number;
  items?: ConfirmationItem[];
};

type QueueResponse = {
  ok?: boolean;
  queue?: ConfirmationQueue;
  error?: string;
  message?: string;
};

function centralTomorrowIso() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${today}T12:00:00-05:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function cleanNetworkTitle(title: string) {
  return title.replace(/^Network\s*[—–-]\s*/i, "").trim() || title;
}

export default function OwnerNetworkConfirmationModal() {
  const router = useRouter();
  const [items, setItems] = useState<ConfirmationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chooseDate, setChooseDate] = useState(false);
  const [targetDate, setTargetDate] = useState(centralTomorrowIso());

  const item = useMemo(() => items[0] ?? null, [items]);

  async function loadQueue() {
    try {
      setError(null);
      const response = await fetch("/api/atlas/owner/network-confirmations", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json() as QueueResponse;
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || "Atlas could not load networking confirmations.");
      setItems(data.queue?.items ?? []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Atlas could not load networking confirmations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQueue();
  }, []);

  useEffect(() => {
    setChooseDate(false);
    setTargetDate(centralTomorrowIso());
    setError(null);
  }, [item?.decisionId]);

  async function resolve(action: "send_now" | "choose_date" | "not_now") {
    if (!item || saving) return;
    if (action === "choose_date" && !targetDate) {
      setError("Choose the date when this networking work should become eligible for Anna.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/atlas/owner/network-confirmations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Atlas-Intent": "owner-network-confirmation-v1",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          decisionId: item.decisionId,
          action,
          targetDate: action === "choose_date" ? targetDate : null,
        }),
      });
      const data = await response.json() as QueueResponse;
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || "Atlas could not save this networking decision.");
      setItems(data.queue?.items ?? []);
      router.refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Atlas could not save this networking decision.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || (!item && !error)) return null;
  if (!item) return null;

  const context = item.networkContext ?? {};
  const shiftReason = context.networkShiftReason?.trim();
  const remaining = Math.max(items.length - 1, 0);

  return (
    <div className="atlas-network-confirmation-backdrop" role="presentation" data-atlas-network-confirmation="true">
      <section
        className="atlas-network-confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-network-confirmation-title"
        aria-describedby="atlas-network-confirmation-description"
      >
        <div className="atlas-network-confirmation-kicker">Owner confirmation · Network</div>
        <h2 id="atlas-network-confirmation-title">{item.prompt || "Send this networking task to Anna?"}</h2>
        <p id="atlas-network-confirmation-description" className="atlas-network-confirmation-task">
          {cleanNetworkTitle(item.title)}
        </p>

        <div className="atlas-network-confirmation-state">
          <strong>Not sent to Anna.</strong>
          <span>This work is held in management until you confirm that networking is the right next step.</span>
        </div>

        {shiftReason ? <p className="atlas-network-confirmation-context">Existing context: {shiftReason}</p> : null}
        {item.dueDate ? <p className="atlas-network-confirmation-meta">Current proposed date: {item.dueDate}</p> : null}

        {chooseDate ? (
          <div className="atlas-network-confirmation-date-row">
            <label htmlFor="atlas-network-confirmation-date">Send to Anna on</label>
            <input
              id="atlas-network-confirmation-date"
              type="date"
              value={targetDate}
              min={centralTomorrowIso()}
              disabled={saving}
              onChange={(event) => setTargetDate(event.target.value)}
            />
            <div className="atlas-network-confirmation-inline-actions">
              <button type="button" disabled={saving} className="primary" onClick={() => void resolve("choose_date")}>
                {saving ? "Saving…" : "Confirm date"}
              </button>
              <button type="button" disabled={saving} onClick={() => setChooseDate(false)}>Back</button>
            </div>
          </div>
        ) : (
          <div className="atlas-network-confirmation-actions">
            <button type="button" disabled={saving} className="primary" onClick={() => void resolve("send_now")}>
              {saving ? "Saving…" : "Send to Anna"}
            </button>
            <button type="button" disabled={saving} onClick={() => setChooseDate(true)}>Choose a date</button>
            <button type="button" disabled={saving} className="quiet" onClick={() => void resolve("not_now")}>Not now</button>
          </div>
        )}

        {error ? <p className="atlas-network-confirmation-error" role="alert">{error}</p> : null}
        {remaining ? <p className="atlas-network-confirmation-remaining">{remaining} more networking confirmation{remaining === 1 ? "" : "s"} waiting after this one.</p> : null}
      </section>

      <style>{`
        .atlas-network-confirmation-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10000;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(35, 36, 49, .42);
          backdrop-filter: blur(7px);
        }
        .atlas-network-confirmation-modal {
          width: min(520px, 100%);
          max-height: calc(100vh - 44px);
          overflow: auto;
          box-sizing: border-box;
          padding: 26px;
          border: 1px solid rgba(71, 70, 91, .16);
          border-radius: 22px;
          background: #fbf8f1;
          box-shadow: 0 24px 80px rgba(32, 32, 44, .24);
          color: #303244;
        }
        .atlas-network-confirmation-kicker {
          margin-bottom: 9px;
          color: #7a7fa9;
          font-size: .68rem;
          font-weight: 950;
          letter-spacing: .14em;
          text-transform: uppercase;
        }
        .atlas-network-confirmation-modal h2 {
          margin: 0;
          font-size: clamp(1.35rem, 5vw, 1.85rem);
          line-height: 1.1;
          letter-spacing: -.03em;
        }
        .atlas-network-confirmation-task {
          margin: 10px 0 0;
          color: #55586d;
          font-size: 1rem;
          font-weight: 800;
          line-height: 1.35;
        }
        .atlas-network-confirmation-state {
          display: grid;
          gap: 4px;
          margin-top: 18px;
          padding: 13px 14px;
          border: 1px solid rgba(89, 93, 128, .16);
          border-radius: 13px;
          background: #f1f1f8;
        }
        .atlas-network-confirmation-state strong { font-size: .79rem; }
        .atlas-network-confirmation-state span { color: #65697c; font-size: .76rem; line-height: 1.42; }
        .atlas-network-confirmation-context,
        .atlas-network-confirmation-meta,
        .atlas-network-confirmation-remaining {
          margin: 12px 0 0;
          color: #6d6f7d;
          font-size: .76rem;
          line-height: 1.45;
        }
        .atlas-network-confirmation-meta { margin-top: 7px; }
        .atlas-network-confirmation-actions,
        .atlas-network-confirmation-inline-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 9px;
          margin-top: 20px;
        }
        .atlas-network-confirmation-actions .quiet { grid-column: 1 / -1; }
        .atlas-network-confirmation-actions button,
        .atlas-network-confirmation-inline-actions button {
          min-height: 45px;
          border: 1px solid rgba(71, 70, 91, .18);
          border-radius: 12px;
          background: #fff;
          color: #44475a;
          font: inherit;
          font-size: .8rem;
          font-weight: 900;
          cursor: pointer;
        }
        .atlas-network-confirmation-actions button.primary,
        .atlas-network-confirmation-inline-actions button.primary {
          border-color: #575c86;
          background: #575c86;
          color: white;
        }
        .atlas-network-confirmation-actions button.quiet { background: transparent; }
        .atlas-network-confirmation-actions button:disabled,
        .atlas-network-confirmation-inline-actions button:disabled { opacity: .55; cursor: default; }
        .atlas-network-confirmation-date-row {
          display: grid;
          gap: 7px;
          margin-top: 20px;
        }
        .atlas-network-confirmation-date-row label {
          color: #5f6274;
          font-size: .74rem;
          font-weight: 900;
        }
        .atlas-network-confirmation-date-row input {
          width: 100%;
          box-sizing: border-box;
          min-height: 45px;
          padding: 9px 11px;
          border: 1px solid rgba(71, 70, 91, .2);
          border-radius: 11px;
          background: white;
          color: #343646;
          font: inherit;
          font-weight: 800;
        }
        .atlas-network-confirmation-error {
          margin: 12px 0 0;
          color: #8b4138;
          font-size: .76rem;
          font-weight: 750;
          line-height: 1.4;
        }
        @media (max-width: 520px) {
          .atlas-network-confirmation-backdrop { padding: 14px; align-items: end; }
          .atlas-network-confirmation-modal { padding: 22px 18px; border-radius: 20px 20px 14px 14px; }
          .atlas-network-confirmation-actions,
          .atlas-network-confirmation-inline-actions { grid-template-columns: 1fr; }
          .atlas-network-confirmation-actions .quiet { grid-column: auto; }
        }
      `}</style>
    </div>
  );
}
