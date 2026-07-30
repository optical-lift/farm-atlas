"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import type { AtlasBell, AtlasBellItem } from "@/lib/atlas/bell-contract";
import { fetchAtlasBell, updateAtlasBell } from "@/lib/atlas/bell-client";

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventLabel(item: AtlasBellItem) {
  if (item.eventKind === "rhythm_failure") return "Fallen out of rhythm";
  if (item.eventKind === "rhythm_due") return "Due";
  if (item.eventKind === "rhythm_warning") return "Coming due";
  if (item.eventKind === "unlock") return "Unlocked";
  if (item.eventKind === "owner_decision") return "Owner decision";
  if (item.eventKind === "task_result") return "Result";
  return "Farm change";
}

function BellItemRow({ item, refresh }: { item: AtlasBellItem; refresh: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);

  async function acknowledge() {
    if (saving || item.acknowledged) return;
    try {
      setSaving(true);
      await updateAtlasBell({ action: "acknowledge", eventId: item.eventId });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  function markRead() {
    if (!item.unread) return;
    void updateAtlasBell({ action: "read", eventId: item.eventId }).catch(() => undefined);
  }

  return (
    <article
      className="atlas-bell-item"
      data-atlas-bell-importance={item.importance}
      data-atlas-bell-unread={item.unread ? "true" : "false"}
    >
      <Link href={item.deepLink} className="atlas-bell-item-main" onClick={markRead}>
        <span className="atlas-bell-symbol" aria-hidden="true">{item.symbol}</span>
        <div>
          <small>{eventLabel(item)} · {timeLabel(item.occurredAt)}</small>
          <strong>{item.title}</strong>
          {item.detail ? <p>{item.detail}</p> : null}
        </div>
      </Link>
      <div className="atlas-bell-item-state">
        {item.requiresAction ? <span>Needs attention</span> : item.whileAway ? <span>While away</span> : null}
        {!item.acknowledged ? (
          <button type="button" onClick={acknowledge} disabled={saving}>
            {saving ? "Saving…" : "Acknowledge"}
          </button>
        ) : <em>Acknowledged</em>}
      </div>
    </article>
  );
}

function AtlasBellPageContent() {
  const searchParams = useSearchParams();
  const whileAwayOnly = searchParams.get("view") === "while-away";
  const [bell, setBell] = useState<AtlasBell | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchAtlasBell(80);
      setBell(result);
      await updateAtlasBell({ action: "visit", seenThrough: result.preparedAt });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Bell could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(
    () => whileAwayOnly ? (bell?.items ?? []).filter((item) => item.whileAway) : bell?.items ?? [],
    [bell, whileAwayOnly],
  );

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Bell</span>
          </Link>
          <span className="atlas-weather-line">{bell ? `${bell.badgeCount} need attention` : "Farm changes"}</span>
          <Link href="/journal" className="atlas-note-plus" aria-label="Open Farm Journal">–</Link>
        </header>

        <div className="atlas-bell-page-body">
          <section className="atlas-bell-summary">
            <span>{whileAwayOnly ? "While you were away" : "Bell history"}</span>
            <h1>{bell ? `${bell.whileAwayCount} recent · ${bell.badgeCount} unresolved` : "Farm movement"}</h1>
            <p>The Bell is a read of the Farm Journal. Acknowledging an item removes its slip, not the event or its consequence.</p>
          </section>

          <nav className="atlas-bell-filters" aria-label="Bell filters">
            <Link href="/bell" aria-current={!whileAwayOnly ? "page" : undefined}>All</Link>
            <Link href="/bell?view=while-away" aria-current={whileAwayOnly ? "page" : undefined}>While away</Link>
          </nav>

          {loading ? <div className="atlas-bell-loading">Listening for farm changes…</div> : null}
          {error ? <div className="atlas-bell-error">{error}</div> : null}
          {!loading && !error && items.length === 0 ? (
            <div className="atlas-bell-empty">No Bell entries in this view.</div>
          ) : null}

          <section className="atlas-bell-list" aria-label="Bell entries">
            {items.map((item) => <BellItemRow key={item.eventId} item={item} refresh={load} />)}
          </section>

          <footer className="atlas-bell-footer">
            <Link href="/">Journal cover</Link>
            <Link href="/journal">Farm Journal</Link>
          </footer>
        </div>
      </section>
    </main>
  );
}

function BellFallback() {
  return <main className="atlas-phone-shell"><div className="atlas-bell-loading">Listening for farm changes…</div></main>;
}

export default function AtlasBellPage() {
  return (
    <Suspense fallback={<BellFallback />}>
      <AtlasBellPageContent />
    </Suspense>
  );
}
