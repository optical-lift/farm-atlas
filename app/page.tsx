"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
import { fetchAtlasCloseout, type AtlasCloseoutSummary } from "@/lib/atlas/closeout-client";
import { fetchAtlasFarmSnapshot, type AtlasFarmSnapshot } from "@/lib/atlas/farm-snapshot-client";
import {
  atlasCleanLabel,
  atlasMetadataValue,
  atlasMetaString,
  atlasRouteKeyForTask,
  atlasRouteLabels,
  atlasTaskDisplay,
} from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  filterMonthOverviewTasks,
  filterWeekOverviewTasks,
  monthName,
  monthProgress,
} from "@/lib/atlas/task-overview";
import { fetchAtlasZoneRegistry, type AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import {
  atlasBuildMowingCollectionSummary,
  atlasIsMowingCollectionMember,
  type AtlasWorkCollectionSummary,
} from "@/lib/atlas/work-collections";

type HomePanel = "closeout" | null;
type WeatherResponse = { ok: boolean; label?: string; rainAge?: string; daysSinceRain?: number | null; error?: string };
type HomeLaunchItem = { kind: "task"; task: AtlasTaskCard } | { kind: "collection"; collection: AtlasWorkCollectionSummary };

const defaultSnapshot: AtlasFarmSnapshot = { totalBeds: 0, growingBeds: 0, activeSqft: 0, sowingsLogged: 0, stemsLogged: 0 };

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function daysUntilFirstFrost() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let frost = new Date(now.getFullYear(), 10, 1);
  if (today > frost) frost = new Date(now.getFullYear() + 1, 10, 1);
  return Math.max(0, Math.ceil((frost.getTime() - today.getTime()) / 86400000));
}

function dateFromIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`);
}

function isoFromDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIsoFrom(dateIso: string, days: number) {
  const date = dateFromIso(dateIso);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  const date = dateIso.includes("-") ? dateFromIso(dateIso) : new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compactDateRange(startIso: string, endIso: string) {
  const start = dateFromIso(startIso);
  const end = dateFromIso(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${startIso}–${endIso}`;
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = sameMonth ? end.toLocaleDateString("en-US", { day: "numeric" }) : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startLabel}–${endLabel}`;
}

function dayShortLabel(dateIso: string) {
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function isChildTask(card: AtlasTaskCard) {
  return atlasMetadataValue(card, "is_child_task") === true || atlasMetadataValue(card, "is_child_task") === "true";
}

function isQuietHeroTask(card: AtlasTaskCard) {
  const quietTask = atlasMetadataValue(card, "quiet_task");
  const hiddenFromHero = atlasMetadataValue(card, "hide_from_home_hero");
  return quietTask === true || quietTask === "true" || hiddenFromHero === true || hiddenFromHero === "true";
}

function parentTaskId(card: AtlasTaskCard) {
  return atlasMetaString(card, "parent_task_id") || atlasMetaString(card, "parentTaskId") || "";
}

function isActiveChecklistChild(card: AtlasTaskCard) {
  if (!isChildTask(card)) return false;
  const checklistStatus = (atlasMetaString(card, "checklist_status") ?? "").toLowerCase();
  const atlasStatus = (atlasMetaString(card, "atlas_status") ?? "").toLowerCase();
  const relevance = (atlasMetaString(card, "relevance") ?? "").toLowerCase();
  return card.status !== "archived" && checklistStatus !== "archived" && atlasStatus !== "not_relevant" && relevance !== "not_relevant";
}

function subtaskCounts(cards: AtlasTaskCard[]) {
  const counts = new Map<string, number>();
  cards.filter(isActiveChecklistChild).forEach((card) => {
    const parentId = parentTaskId(card);
    if (!parentId) return;
    counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  });
  return counts;
}

function subtaskLabel(card: AtlasTaskCard, counts: Map<string, number>) {
  const count = counts.get(card.task_id) ?? 0;
  return `${count} ${count === 1 ? "step" : "steps"}`;
}

function taskSortValue(card: AtlasTaskCard) {
  return atlasWorkOrderSortValue(card);
}

function isTaskDone(card: AtlasTaskCard) {
  return card.status === "done" || card.task_outcomes?.[0]?.outcome === "done" || atlasMetaString(card, "checklist_status") === "done";
}

function isDayProgressTask(card: AtlasTaskCard) {
  const text = `${card.task_type} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  return card.status !== "archived" && !isChildTask(card) && !(text.includes("verify") || text.includes("check") || text.includes("confirm") || text.includes("count") || text.includes("germin") || text.includes("walk field rows"));
}

function isDashboardWork(card: AtlasTaskCard) {
  return card.status === "open" && isDayProgressTask(card);
}

function taskCountForDate(cards: AtlasTaskCard[], dateIso: string) {
  return cards.filter(isDashboardWork).filter((card) => card.due_date === dateIso).length;
}

function weekCountForRange(cards: AtlasTaskCard[], startIso: string, endIso: string) {
  return cards.filter(isDashboardWork).filter((task) => task.due_date && task.due_date >= startIso && task.due_date <= endIso).length;
}

function calendarWeekStartFor(date: Date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function calendarWeekEndFor(start: Date) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function upcomingWeekRows(cards: AtlasTaskCard[], anchorIso: string) {
  const rows: { label: string; dateLabel: string; href: string; count: number }[] = [];
  let start = calendarWeekStartFor(dateFromIso(anchorIso));

  for (let index = 0; index < 4; index += 1) {
    const end = calendarWeekEndFor(start);
    const startIso = isoFromDate(start);
    const endIso = isoFromDate(end);
    rows.push({
      label: compactDateRange(startIso, endIso),
      dateLabel: "Sun–Sat",
      href: `/overview/week?date=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
      count: weekCountForRange(cards, startIso, endIso),
    });
    start = new Date(end);
    start.setDate(start.getDate() + 1);
  }

  return rows;
}

function panelTitle(panel: HomePanel) {
  if (panel === "closeout") return "Closeout";
  return "Atlas";
}

function homeLaunchItems(todayCards: AtlasTaskCard[], cards: AtlasTaskCard[], today: string): HomeLaunchItem[] {
  const mowing = atlasBuildMowingCollectionSummary(cards, today);
  const standalone = todayCards
    .filter((card) => !isQuietHeroTask(card))
    .filter((card) => !atlasIsMowingCollectionMember(card))
    .map((task) => ({ kind: "task" as const, task }));
  return [...standalone, ...(mowing && mowing.dueCount > 0 ? [{ kind: "collection" as const, collection: mowing }] : [])].slice(0, 4);
}

function launchItemSignature(item: HomeLaunchItem, stepCounts: Map<string, number>) {
  if (item.kind === "collection") return `collection:${item.collection.key}:${item.collection.dueCount}:${item.collection.doneRecentCount}:${item.collection.notReadyCount}`;
  return `${item.task.task_id}:${stepCounts.get(item.task.task_id) ?? 0}`;
}

function TaskLaunchHero({ cards, loading }: { cards: AtlasTaskCard[]; loading: boolean }) {
  const today = todayIso();
  const todayHref = `/day?date=${encodeURIComponent(today)}`;
  const dashboardCards = cards.filter(isDashboardWork).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
  const todayCards = dashboardCards.filter((card) => card.due_date === today);
  const stepCounts = subtaskCounts(cards);
  const heroItems = homeLaunchItems(todayCards, cards, today);
  const dayProgressCards = cards.filter(isDayProgressTask).filter((card) => card.due_date === today);
  const dayDoneCount = dayProgressCards.filter(isTaskDone).length;
  const dayTotal = dayProgressCards.length;
  const dayProgressLabel = dayTotal ? `${dayDoneCount}/${dayTotal}` : "Complete";

  if (loading && cards.length === 0) {
    return (
      <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller atlas-daily-run-sheet empty">
        <Link href={todayHref} className="atlas-task-controller-head atlas-task-controller-head-link" aria-label="Open today's full work overview">
          <span className="atlas-task-kicker">Today</span>
          <span className="atlas-task-date">Loading</span>
        </Link>
        <Link href={todayHref} className="atlas-run-sheet-empty">
          <strong>Loading the work board</strong>
          <em>Atlas is pulling open tasks.</em>
        </Link>
      </article>
    );
  }

  return (
    <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller atlas-daily-run-sheet atlas-route-sheet">
      <Link href={todayHref} className="atlas-task-controller-head atlas-task-controller-head-link" aria-label="Open today's full work overview">
        <div>
          <span className="atlas-task-kicker">Today</span>
          <em className="atlas-season-label">{prettyDate(today)}</em>
        </div>
        <span className="atlas-task-date">{dayProgressLabel}</span>
      </Link>

      {heroItems.length === 0 ? (
        <Link href={todayHref} className="atlas-run-sheet-empty">
          <strong>All tasks complete</strong>
          <em>Open today overview, or browse the week below.</em>
        </Link>
      ) : (
        <div className="atlas-run-sheet-grid atlas-route-sheet-grid" data-task-forward-signature={heroItems.map((item) => launchItemSignature(item, stepCounts)).join("|")}>
          {heroItems.map((item) => {
            if (item.kind === "collection") {
              return (
                <Link key={`collection-${item.collection.key}`} href={item.collection.href} className="atlas-run-sheet-box atlas-route-sheet-box atlas-task-forward-box atlas-work-collection-forward-box" data-work-collection-key={item.collection.key}>
                  <small>Collection</small>
                  <strong>{item.collection.label}</strong>
                  <span>{item.collection.dueCount} due · {item.collection.doneRecentCount} resting</span>
                  <em>{item.collection.preview}</em>
                </Link>
              );
            }

            const card = item.task;
            const display = atlasTaskDisplay(card);
            const routeLabel = atlasRouteLabels[atlasRouteKeyForTask(card)];
            const steps = subtaskLabel(card, stepCounts);
            return (
              <Link key={card.task_id} href={`/task?taskId=${encodeURIComponent(card.task_id)}`} className="atlas-run-sheet-box atlas-route-sheet-box atlas-task-forward-box" data-single-task-id={card.task_id}>
                <small>{display.action || routeLabel}</small>
                <strong>{display.title}</strong>
                <span>{display.location} · {steps}</span>
                <em>{display.detail}</em>
              </Link>
            );
          })}
        </div>
      )}
    </article>
  );
}

function OverviewLaunchBoxes({ cards, loading }: { cards: AtlasTaskCard[]; loading: boolean }) {
  const today = todayIso();
  const weekTasks = filterWeekOverviewTasks(cards, today);
  const monthTasks = filterMonthOverviewTasks(cards, today);
  const progress = monthProgress(today);
  const dayRows = Array.from({ length: 4 }, (_, index) => {
    const dateIso = addDaysIsoFrom(today, index + 1);
    return { dateIso, count: taskCountForDate(cards, dateIso) };
  });
  const monthRows = upcomingWeekRows(cards, today);

  return (
    <div className="atlas-home-overview-row" aria-label="Week and month overview links">
      <article className="atlas-home-overview-card atlas-home-overview-week">
        <Link href="/overview/week" className="atlas-home-overview-top">
          <strong>This Week</strong>
          <span>{loading ? "Loading" : `${weekTasks.length} open`}</span>
        </Link>
        <div className="atlas-home-overview-list">
          {dayRows.map((row) => (
            <Link key={row.dateIso} href={`/day?date=${encodeURIComponent(row.dateIso)}`}>
              <strong>{dayShortLabel(row.dateIso)}</strong>
              <span>{prettyDate(row.dateIso)}</span>
              <em>{row.count}</em>
            </Link>
          ))}
        </div>
      </article>

      <article className="atlas-home-overview-card atlas-home-overview-month">
        <Link href="/overview/month" className="atlas-home-overview-top">
          <strong>{monthName(today)}</strong>
          <span>{loading ? "Loading" : `${progress.day}/${progress.daysInMonth} days · ${monthTasks.length} open`}</span>
        </Link>
        <div className="atlas-home-overview-list">
          {monthRows.map((row) => (
            <Link key={row.href} href={row.href}>
              <strong>{row.label}</strong>
              <span>{row.dateLabel}</span>
              <em>{row.count}</em>
            </Link>
          ))}
        </div>
      </article>
    </div>
  );
}

export default function AtlasHome() {
  const [snapshot, setSnapshot] = useState<AtlasFarmSnapshot>(defaultSnapshot);
  const [taskCards, setTaskCards] = useState<AtlasTaskCard[]>([]);
  const [zoneRegistry, setZoneRegistry] = useState<AtlasRegistryZone[]>([]);
  const [closeout, setCloseout] = useState<AtlasCloseoutSummary | null>(null);
  const [weather, setWeather] = useState<WeatherResponse>({ ok: false, label: "loading weather…" });
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<HomePanel>(null);
  const [fieldLogSeed, setFieldLogSeed] = useState<AtlasFieldLogSeed | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [snapshotResult, taskResult, zoneResult, closeoutResult, weatherResult] = await Promise.allSettled([
          fetchAtlasFarmSnapshot(),
          fetchAtlasTaskCards(),
          fetchAtlasZoneRegistry(),
          fetchAtlasCloseout(),
          fetch("/api/atlas/weather", { cache: "no-store" }).then((response) => response.json() as Promise<WeatherResponse>),
        ]);

        if (!active) return;
        if (snapshotResult.status === "fulfilled") setSnapshot(snapshotResult.value);
        if (taskResult.status === "fulfilled") setTaskCards(taskResult.value.taskCards ?? []);
        if (zoneResult.status === "fulfilled") setZoneRegistry(zoneResult.value.zones ?? []);
        if (closeoutResult.status === "fulfilled") setCloseout(closeoutResult.value);
        if (weatherResult.status === "fulfilled") setWeather(weatherResult.value);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const weatherLabel = weather.label || "weather unavailable";
  const rainLabel = weather.rainAge || (typeof weather.daysSinceRain === "number" ? `${weather.daysSinceRain} days since watering rain` : "rain age unavailable");
  const frostDays = daysUntilFirstFrost();

  return (
    <main className="atlas-home-page">
      <header className="atlas-home-header">
        <div>
          <span>Atlas</span>
          <strong>Elm Farm</strong>
        </div>
        <p>{weatherLabel} · {rainLabel}</p>
        <button type="button" onClick={() => setFieldLogSeed({})} aria-label="Add field log">+</button>
      </header>

      <TaskLaunchHero cards={taskCards} loading={loading} />
      <OverviewLaunchBoxes cards={taskCards} loading={loading} />

      <section className="atlas-home-stats" aria-label="Farm snapshot">
        <div><strong>{snapshot.totalBeds}</strong><span>Beds</span></div>
        <div><strong>{snapshot.growingBeds}</strong><span>Growing</span></div>
        <div><strong>{Math.round(snapshot.activeSqft).toLocaleString()}</strong><span>Active sq ft</span></div>
        <div><strong>{snapshot.sowingsLogged}</strong><span>Sowings</span></div>
        <div><strong>{snapshot.stemsLogged}</strong><span>Stems</span></div>
      </section>

      <section className="atlas-home-actions">
        <button type="button" onClick={() => setActivePanel("closeout")}>Closeout</button>
        <Link href="/day">Today</Link>
        <Link href="/overview/week">Week</Link>
        <Link href="/overview/month">Month</Link>
      </section>

      <p className="atlas-home-frost">{frostDays} days until first frost</p>

      {activePanel ? (
        <div className="atlas-home-panel" role="dialog" aria-modal="true" aria-label={panelTitle(activePanel)}>
          <button type="button" onClick={() => setActivePanel(null)} aria-label="Close panel">×</button>
          {activePanel === "closeout" ? (
            <section>
              <h2>Closeout</h2>
              <p>{closeout?.label ?? "No closeout summary available."}</p>
            </section>
          ) : null}
        </div>
      ) : null}

      <FieldLogDrawer
        open={Boolean(fieldLogSeed)}
        onClose={() => setFieldLogSeed(null)}
        zones={zoneRegistry}
        seed={fieldLogSeed ?? undefined}
      />
    </main>
  );
}
