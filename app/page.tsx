"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchAtlasCloseout, type AtlasCloseoutSummary } from "@/lib/atlas/closeout-client";
import { fetchAtlasFarmSnapshot, type AtlasFarmSnapshot } from "@/lib/atlas/farm-snapshot-client";
import { saveAtlasInboxItem } from "@/lib/atlas/inbox-client";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  filterMonthOverviewTasks,
  filterWeekOverviewTasks,
  isUrgentTask,
  monthName,
  monthProgress,
} from "@/lib/atlas/task-overview";

type HomePanel = "inbox" | "closeout" | null;
type WeatherResponse = { ok: boolean; label?: string; rainAge?: string; daysSinceRain?: number | null; error?: string };
type HomeTaskDisplay = { action: string; subject: string; zone: string; detail: string };
type WorkRouteKey = "plant" | "weed" | "mow" | "seed" | "harvest" | "build" | "venue" | "water";

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const defaultSnapshot: AtlasFarmSnapshot = { totalBeds: 0, growingBeds: 0, activeSqft: 0, sowingsLogged: 0, stemsLogged: 0 };
const routeLabels: Record<WorkRouteKey, string> = {
  plant: "Plant",
  weed: "Weed",
  mow: "Mow",
  seed: "Seed",
  harvest: "Harvest",
  build: "Build / Prep",
  venue: "Venue",
  water: "Water",
};

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

function cleanLabel(value: string | null | undefined) {
  return (value ?? "")
    .replace(/truth/gi, "state")
    .replace(/\b(urgent|high|normal|low)\b/gi, "")
    .replace(/\s+·\s+·\s+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

function metadataValue(card: AtlasTaskCard, key: string) {
  return card.metadata?.[key];
}

function metaString(card: AtlasTaskCard, key: string) {
  const value = metadataValue(card, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaNumber(card: AtlasTaskCard, key: string) {
  const value = metadataValue(card, key);
  return typeof value === "number" ? value : null;
}

function metaStringList(card: AtlasTaskCard, key: string) {
  const value = metadataValue(card, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function titleSubject(title: string) {
  const parts = title.split("—");
  return cleanLabel(parts.length > 1 ? parts.slice(1).join("—") : title);
}

function isChildTask(card: AtlasTaskCard) {
  return metadataValue(card, "is_child_task") === true || metadataValue(card, "is_child_task") === "true";
}

function parentTaskId(card: AtlasTaskCard) {
  return metaString(card, "parent_task_id") || metaString(card, "parentTaskId") || "";
}

function isActiveChecklistChild(card: AtlasTaskCard) {
  if (!isChildTask(card)) return false;
  const checklistStatus = (metaString(card, "checklist_status") ?? "").toLowerCase();
  const atlasStatus = (metaString(card, "atlas_status") ?? "").toLowerCase();
  const relevance = (metaString(card, "relevance") ?? "").toLowerCase();
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
  const dayOrder = metaNumber(card, "day_order") ?? 999;
  return `${card.due_date ?? "9999-12-31"}-${priorityRank[card.priority] ?? 9}-${String(dayOrder).padStart(3, "0")}-${card.title}`;
}

function isRouteKey(value: string | null): value is WorkRouteKey {
  return value === "plant" || value === "weed" || value === "mow" || value === "seed" || value === "harvest" || value === "build" || value === "venue" || value === "water";
}

function routeKeyForTask(card: AtlasTaskCard): WorkRouteKey {
  const explicitRoute = metaString(card, "work_route");
  if (isRouteKey(explicitRoute)) return explicitRoute;
  const joined = `${card.task_type ?? ""} ${card.title} ${metaString(card, "work_rhythm") ?? ""} ${metaString(card, "display_action") ?? ""}`.toLowerCase();
  if (joined.includes("water")) return "water";
  if (joined.includes("mow")) return "mow";
  if (joined.includes("weed")) return "weed";
  if (joined.includes("seed") || joined.includes("sow")) return "seed";
  if (joined.includes("harvest") || joined.includes("postharvest") || joined.includes("garlic") || joined.includes("gather")) return "harvest";
  if (joined.includes("build") || joined.includes("prep") || joined.includes("string") || joined.includes("arch")) return "build";
  if (joined.includes("plant") || joined.includes("transplant")) return "plant";
  return "venue";
}

function taskDisplay(card: AtlasTaskCard): HomeTaskDisplay {
  const route = routeKeyForTask(card);
  const action = metaString(card, "display_action") ?? routeLabels[route];
  const zone = metaString(card, "collection_zone") ?? metaString(card, "display_detail") ?? card.unlock_text ?? card.zone_label ?? "Elm Farm";
  const detailLines = metaStringList(card, "detail_lines");

  return {
    action,
    subject: metaString(card, "display_subject") ?? titleSubject(card.title),
    zone,
    detail: detailLines[0] ?? card.unlock_text ?? metaString(card, "display_detail") ?? "Open task",
  };
}

function isTaskDone(card: AtlasTaskCard) {
  return card.status === "done" || card.task_outcomes?.[0]?.outcome === "done" || metaString(card, "checklist_status") === "done";
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
  if (panel === "inbox") return "Note";
  if (panel === "closeout") return "Closeout";
  return "Atlas";
}

function TaskLaunchHero({ cards, loading }: { cards: AtlasTaskCard[]; loading: boolean }) {
  const today = todayIso();
  const todayHref = `/day?date=${encodeURIComponent(today)}`;
  const dashboardCards = cards.filter(isDashboardWork).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
  const todayCards = dashboardCards.filter((card) => card.due_date === today);
  const heroCards = (todayCards.length >= 4 ? todayCards : [...todayCards, ...dashboardCards.filter((card) => card.due_date !== today)]).slice(0, 4);
  const stepCounts = subtaskCounts(cards);
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

      {heroCards.length === 0 ? (
        <Link href={todayHref} className="atlas-run-sheet-empty">
          <strong>All tasks complete</strong>
          <em>Open today overview, or browse the week below.</em>
        </Link>
      ) : (
        <div className="atlas-run-sheet-grid atlas-route-sheet-grid" data-task-forward-signature={heroCards.map((card) => `${card.task_id}:${stepCounts.get(card.task_id) ?? 0}`).join("|")}>
          {heroCards.map((card) => {
            const display = taskDisplay(card);
            const steps = subtaskLabel(card, stepCounts);
            return (
              <Link key={card.task_id} href={`/task?taskId=${encodeURIComponent(card.task_id)}`} className="atlas-run-sheet-box atlas-route-sheet-box atlas-task-forward-box" data-single-task-id={card.task_id}>
                <small>{display.action}</small>
                <strong>{display.subject}</strong>
                <span>{display.zone} · {steps}</span>
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
  const urgentWeekTasks = weekTasks.filter((card) => isUrgentTask(card, today));
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
          <span>{loading ? "Loading" : `${weekTasks.length} open · ${urgentWeekTasks.length} urgent`}</span>
        </Link>
        <div className="atlas-home-overview-list">
          {dayRows.map((row) => (
            <Link key={row.dateIso} href={`/day?date=${encodeURIComponent(row.dateIso)}`} className="atlas-home-overview-row-link">
              <b>{dayShortLabel(row.dateIso)}</b>
              <small>{prettyDate(row.dateIso)}</small>
              <em>{loading ? "…" : row.count}</em>
            </Link>
          ))}
        </div>
      </article>
      <article className="atlas-home-overview-card atlas-home-overview-month">
        <Link href="/overview/month" className="atlas-home-overview-top">
          <strong>{monthName(today)}</strong>
          <span>{loading ? "Loading" : `${progress.day}/${progress.days} days · ${monthTasks.length} open`}</span>
        </Link>
        <div className="atlas-home-overview-list atlas-home-month-week-list">
          {monthRows.map((row) => (
            <Link key={row.label} href={row.href} className="atlas-home-overview-row-link">
              <b>{row.label}</b>
              <small>{row.dateLabel}</small>
              <em>{loading ? "…" : row.count}</em>
            </Link>
          ))}
        </div>
      </article>
    </div>
  );
}

function FarmSnapshotBox({ snapshot, loading }: { snapshot: AtlasFarmSnapshot; loading: boolean }) {
  return (
    <Link href="/zones" className="atlas-farm-snapshot-bar" aria-label="Open farm snapshot">
      <span><b>{loading ? "…" : snapshot.growingBeds}</b> beds</span>
      <span><b>{loading ? "…" : snapshot.activeSqft.toLocaleString()}</b> sq ft</span>
      <span><b>{loading ? "…" : snapshot.sowingsLogged}</b> sowings</span>
      <span><b>{loading ? "…" : snapshot.stemsLogged}</b> stems</span>
    </Link>
  );
}

function HomeFooterBar({ summary, today, onOpen }: { summary: AtlasCloseoutSummary | undefined; today: string; onOpen: () => void }) {
  const frostDays = daysUntilFirstFrost();

  return (
    <div className="atlas-home-footer-row">
      <button type="button" className="atlas-home-closeout-footer-link" onClick={onOpen}>
        <span>Closeout</span>
        <em>{summary ? `${summary.counts.objectEvents} records · ${summary.counts.openTasks} open` : `Review · ${prettyDate(today)}`}</em>
      </button>
      <div className="atlas-home-frost-countdown" aria-label={`${frostDays} days until first frost target on November 1`}>
        <span>First frost</span>
        <em>{frostDays} days · Nov 1</em>
      </div>
    </div>
  );
}

function CloseoutPanel({ summaries, loading }: { summaries: AtlasCloseoutSummary[]; loading: boolean }) {
  return <section className="atlas-task-focus-section"><div className="atlas-closeout-grid">{loading ? <div className="atlas-empty">Loading closeout.</div> : null}{summaries.map((summary) => <article key={summary.period} className="atlas-closeout-card tidy"><div className="atlas-closeout-card-head"><strong>{summary.label}</strong><span>{prettyDate(summary.startDate)}–{prettyDate(summary.endDate)}</span></div><div className="atlas-closeout-pill-row soft"><span>{summary.counts.objectEvents} records</span><span>{summary.counts.openTasks} open</span><span>{summary.counts.tasksBlocked} blocked</span></div>{summary.carryForward.length > 0 ? <div className="atlas-closeout-section carry"><span>Carry forward</span>{summary.carryForward.map((line) => <p key={line}>{cleanLabel(line)}</p>)}</div> : null}</article>)}</div></section>;
}

export default function AtlasHomePage() {
  const [cards, setCards] = useState<AtlasTaskCard[]>([]);
  const [snapshot, setSnapshot] = useState<AtlasFarmSnapshot>(defaultSnapshot);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [openPanel, setOpenPanel] = useState<HomePanel>(null);
  const [inboxBody, setInboxBody] = useState("");
  const [inboxZoneKey, setInboxZoneKey] = useState("");
  const [inboxSaving, setInboxSaving] = useState(false);
  const [inboxMessage, setInboxMessage] = useState<string | null>(null);
  const [closeoutSummaries, setCloseoutSummaries] = useState<AtlasCloseoutSummary[]>([]);
  const [closeoutLoading, setCloseoutLoading] = useState(true);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const today = todayIso();

  async function loadCards() { try { setLoading(true); const response = await fetchAtlasTaskCards(); setCards((response.taskCards ?? []).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)))); } finally { setLoading(false); } }
  async function loadSnapshot() { try { setSnapshotLoading(true); const response = await fetchAtlasFarmSnapshot(); setSnapshot(response.snapshot ?? defaultSnapshot); } finally { setSnapshotLoading(false); } }
  async function loadCloseout() { try { setCloseoutLoading(true); const response = await fetchAtlasCloseout(); setCloseoutSummaries(response.summaries ?? []); } finally { setCloseoutLoading(false); } }
  async function loadWeather() { try { const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" }); const data = (await response.json()) as WeatherResponse; setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable"); } catch { setWeatherLabel("weather unavailable"); } }

  useEffect(() => { void loadCards(); void loadSnapshot(); void loadCloseout(); void loadWeather(); }, []);

  const monthSummary = closeoutSummaries.find((summary) => summary.period === "month");
  async function submitInbox() { const cleanBody = inboxBody.trim(); if (!cleanBody) { setInboxMessage("Note required."); return; } try { setInboxSaving(true); setInboxMessage(null); await saveAtlasInboxItem({ body: cleanBody, zoneKey: inboxZoneKey || null }); setInboxBody(""); setInboxZoneKey(""); setInboxMessage("Saved."); } catch (inboxError) { setInboxMessage(inboxError instanceof Error ? inboxError.message : "Save failed."); } finally { setInboxSaving(false); } }

  return (
    <main className="atlas-phone-shell atlas-home-shell">
      <section className="atlas-phone atlas-dashboard-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <div className="atlas-phone-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></div>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <button type="button" className="atlas-note-plus" aria-label="Add note" onClick={() => setOpenPanel("inbox")}>+</button>
        </header>
        <div className="atlas-home-grid">
          <TaskLaunchHero cards={cards} loading={loading} />
          <OverviewLaunchBoxes cards={cards} loading={loading} />
          <FarmSnapshotBox snapshot={snapshot} loading={snapshotLoading} />
          <HomeFooterBar summary={monthSummary} today={today} onOpen={() => setOpenPanel("closeout")} />
        </div>
      </section>
      {openPanel ? <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true"><div className="atlas-task-focus-phone"><div className="atlas-task-focus-topbar"><div><strong>{panelTitle(openPanel)}</strong></div><button type="button" onClick={() => setOpenPanel(null)}>Close</button></div><div className="atlas-task-focus-body">{openPanel === "closeout" ? <CloseoutPanel summaries={closeoutSummaries} loading={closeoutLoading} /> : null}{openPanel === "inbox" ? <section className="atlas-task-focus-section"><div className="atlas-add-form"><select aria-label="Zone" value={inboxZoneKey} onChange={(event) => setInboxZoneKey(event.target.value)}><option value="">Whole farm</option></select><textarea aria-label="Note" value={inboxBody} onChange={(event) => setInboxBody(event.target.value)} placeholder="Note" /></div><button type="button" className="atlas-zone-action accent" style={{ width: "100%", border: 0, marginTop: 12 }} disabled={inboxSaving} onClick={() => void submitInbox()}>{inboxSaving ? "Saving" : "Save"}</button>{inboxMessage ? <p className="atlas-task-result-message">{inboxMessage}</p> : null}</section> : null}</div></div></section> : null}
    </main>
  );
}
