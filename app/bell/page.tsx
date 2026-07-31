"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import type { AtlasBell, AtlasBellItem } from "@/lib/atlas/bell-contract";
import { fetchAtlasBell, updateAtlasBell } from "@/lib/atlas/bell-client";
import {
  atlasBellItemsForView,
  atlasBellViewSummary,
  type AtlasBellView,
} from "@/lib/atlas/bell-view";
import { setAtlasAppBadge } from "@/lib/atlas/pwa-client";

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function BellItemRow({
  item,
  onAcknowledged,
}: {
  item: AtlasBellItem;
  onAcknowledged: (item: AtlasBellItem) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function acknowledge() {
    if (saving || item.acknowledged) return;
    try {
      setSaving(true);
      await updateAtlasBell({ action: "acknowledge", eventId: item.eventId });
      onAcknowledged(item);
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
      data-atlas-bell-baseline={item.baseline ? "true" : "false"}
    >
      <Link href={item.deepLink} className="atlas-bell-item-main" onClick={markRead}>
        <span className="atlas-bell-symbol" aria-hidden="true">{item.symbol}</span>
        <div>
          <small>{eventLabel(item)} · {dateLabel(item.occurredAt)}</small>
          <strong>{item.title}</strong>
          {item.detail ? <p>{item.detail}</p> : null}
          <p className="atlas-bell-why"><b>Why you’re seeing this</b>{item.why}</p>
        </div>
      </Link>
      <div className="atlas-bell-item-state">
        {item.baseline ? <span>Known at monitoring start</span> : item.requiresAction ? <span>Needs you</span> : item.whileAway ? <span>While away</span> : <span>Farm movement</span>}
        {!item.acknowledged ? (
          <button type="button" onClick={acknowledge} disabled={saving}>
            {saving ? "Saving…" : item.baseline ? "Mark reviewed" : "Acknowledge"}
          </button>
        ) : <em>{item.baseline ? "Reviewed" : "Acknowledged"}</em>}
      </div>
    </article>
  );
}

function normalizedView(value: string | null): AtlasBellView {
  if (value === "needs" || value === "rhythms" || value === "movement" || value === "baseline") return value;
  return "all";
}

function AtlasBellPageContent() {
  const searchParams = useSearchParams();
  const view = normalizedView(searchParams.get("view"));
  const [bell, setBell] = useState<AtlasBell | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchAtlasBell(100);
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

  useEffect(() => {
    if (bell) void setAtlasAppBadge(bell.badgeCount);
  }, [bell]);

  function acknowledgeLocal(item: AtlasBellItem) {
    setBell((current) => current ? {
      ...current,
      badgeCount: item.requiresAction && !item.baseline ? Math.max(0, current.badgeCount - 1) : current.badgeCount,
      unreadCount: item.unread ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
      items: current.items.map((entry) => entry.eventId === item.eventId
        ? { ...entry, unread: false, acknowledged: true }
        : entry),
    } : current);
  }

  const items = useMemo(
    () => atlasBellItemsForView(bell?.items ?? [], view),
    [bell, view],
  );
  const summary = useMemo(
    () => bell ? atlasBellViewSummary(bell, view, items) : null,
    [bell, items, view],
  );

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Bell</span>
          </Link>
          <span className="atlas-weather-line">{summary?.status ?? "Meaningful changes"}</span>
          <Link href="/install" className="atlas-note-plus" aria-label="Open Farm Alerts settings">⋯</Link>
        </header>

        <div className="atlas-bell-page-body">
          <section className="atlas-bell-summary">
            <span>{summary?.eyebrow ?? "Current obligations"}</span>
            <h1>{summary?.title ?? "Listening to Atlas"}</h1>
            <p>The Bell points into the work, place, crop or project where the change belongs. It is not a second task list or a separate history dumping ground.</p>
          </section>

          {bell && bell.baselineSummary.totalCount > 0 ? (
            <section className="atlas-bell-baseline-card">
              <span>{bell.baselineSummary.label}</span>
              <strong>{bell.baselineSummary.totalCount} known obligations</strong>
              <p>{bell.baselineSummary.failureCount} fallen out of rhythm · {bell.baselineSummary.dueCount} due. These remain true in Atlas, but they do not count as new notifications.</p>
              <Link href="/bell?view=baseline">Review the existing baseline</Link>
            </section>
          ) : null}

          <nav className="atlas-bell-filters" aria-label="Bell filters">
            <Link href="/bell" aria-current={view === "all" ? "page" : undefined}>Current</Link>
            <Link href="/bell?view=needs" aria-current={view === "needs" ? "page" : undefined}>Needs you</Link>
            <Link href="/bell?view=rhythms" aria-current={view === "rhythms" ? "page" : undefined}>Rhythms</Link>
            <Link href="/bell?view=movement" aria-current={view === "movement" ? "page" : undefined}>Movement</Link>
            <Link href="/bell?view=baseline" aria-current={view === "baseline" ? "page" : undefined}>Baseline</Link>
          </nav>

          {loading ? <div className="atlas-bell-loading">Listening for meaningful Atlas changes…</div> : null}
          {error ? <div className="atlas-bell-error">{error}</div> : null}
          {!loading && !error && items.length === 0 ? (
            <div className="atlas-bell-empty">{summary?.emptyMessage ?? "Nothing belongs in this Bell view right now."}</div>
          ) : null}

          <section className="atlas-bell-list" aria-label="Bell entries">
            {items.map((item) => (
              <BellItemRow key={item.obligationKey} item={item} onAcknowledged={acknowledgeLocal} />
            ))}
          </section>

          <footer className="atlas-bell-footer">
            <Link href="/">Home</Link>
            <Link href="/install">Farm Alerts</Link>
            <Link href="/more">More</Link>
          </footer>
        </div>
      </section>
    </main>
  );
}

function BellFallback() {
  return <main className="atlas-phone-shell"><div className="atlas-bell-loading">Listening for meaningful Atlas changes…</div></main>;
}

export default function AtlasBellPage() {
  return (
    <Suspense fallback={<BellFallback />}>
      <AtlasBellPageContent />
    </Suspense>
  );
}
