"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import type { AtlasBell, AtlasBellItem } from "@/lib/atlas/bell-contract";
import {
  atlasBellActionState,
  atlasBellActionSymbol,
  atlasBellActionTiming,
  atlasBellActionTitle,
  atlasBellConsequence,
  atlasBellOpenLabel,
} from "@/lib/atlas/bell-action";
import { fetchAtlasBell, updateAtlasBell } from "@/lib/atlas/bell-client";
import {
  atlasBellIsManagementRole,
  atlasBellItemsForView,
  atlasBellQueueCounts,
  atlasBellViewSummary,
  type AtlasBellView,
} from "@/lib/atlas/bell-view";
import { setAtlasAppBadge } from "@/lib/atlas/pwa-client";

function BellItemRow({ item }: { item: AtlasBellItem }) {
  const consequence = atlasBellConsequence(item);

  function markRead() {
    if (!item.unread) return;
    void updateAtlasBell({ action: "read", eventId: item.eventId }).catch(() => undefined);
  }

  return (
    <article
      className="atlas-bell-item"
      data-atlas-bell-importance={item.importance}
      data-atlas-bell-unread={item.unread ? "true" : "false"}
      data-atlas-bell-action-state={atlasBellActionState(item)}
    >
      <Link href={item.deepLink} className="atlas-bell-item-main" onClick={markRead}>
        <span className="atlas-bell-symbol" aria-hidden="true">{atlasBellActionSymbol(item)}</span>
        <div className="atlas-bell-action-copy">
          <small>{atlasBellActionTiming(item)}</small>
          <strong>{atlasBellActionTitle(item)}</strong>
          {consequence ? (
            <p className="atlas-bell-consequence">
              <span>{consequence.label}</span>
              {consequence.text}
            </p>
          ) : null}
        </div>
        <span className="atlas-bell-open">
          {atlasBellOpenLabel(item)} <b aria-hidden="true">›</b>
        </span>
      </Link>
    </article>
  );
}

function normalizedView(value: string | null): AtlasBellView {
  if (value === "next" || value === "upcoming") return "next";
  if (value === "older" || value === "baseline") return "older";
  return "now";
}

function AtlasBellPageContent() {
  const searchParams = useSearchParams();
  const requestedView = normalizedView(searchParams.get("view"));
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

  const management = atlasBellIsManagementRole(bell?.effectiveRole);
  const view: AtlasBellView = management ? requestedView : "now";
  const items = useMemo(
    () => atlasBellItemsForView(bell?.items ?? [], view, bell?.effectiveRole),
    [bell, view],
  );
  const counts = useMemo(
    () => atlasBellQueueCounts(bell?.items ?? [], bell?.effectiveRole),
    [bell],
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
          <span className="atlas-weather-line">{summary?.status ?? "Actions"}</span>
          <Link href="/install" className="atlas-note-plus" aria-label="Open Farm Alerts settings">⋯</Link>
        </header>

        <div className="atlas-bell-page-body" data-atlas-bell-mode={management ? "management" : "follow-through"}>
          <section className="atlas-bell-action-summary">
            <span>{summary?.eyebrow ?? "Do now"}</span>
            <h1>{summary?.title ?? "Loading actions"}</h1>
          </section>

          {management ? (
            <nav className="atlas-bell-action-tabs" aria-label="Bell action queues">
              <Link href="/bell" aria-current={view === "now" ? "page" : undefined}>
                <strong>Do now</strong>
                <span>{counts.now}</span>
              </Link>
              <Link href="/bell?view=next" aria-current={view === "next" ? "page" : undefined}>
                <strong>Coming up</strong>
                <span>{counts.next}</span>
              </Link>
              <Link href="/bell?view=older" aria-current={view === "older" ? "page" : undefined}>
                <strong>Older work</strong>
                <span>{counts.older}</span>
              </Link>
            </nav>
          ) : null}

          {loading ? <div className="atlas-bell-loading">Loading actions…</div> : null}
          {error ? <div className="atlas-bell-error">{error}</div> : null}
          {!loading && !error && items.length === 0 ? (
            <div className="atlas-bell-empty">{summary?.emptyMessage ?? "Nothing to do now."}</div>
          ) : null}

          <section className="atlas-bell-list" aria-label="Actions">
            {items.map((item) => (
              <BellItemRow key={item.obligationKey} item={item} />
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}

function BellFallback() {
  return <main className="atlas-phone-shell"><div className="atlas-bell-loading">Loading actions…</div></main>;
}

export default function AtlasBellPage() {
  return (
    <Suspense fallback={<BellFallback />}>
      <AtlasBellPageContent />
    </Suspense>
  );
}
