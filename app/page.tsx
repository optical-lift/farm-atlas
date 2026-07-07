"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchAtlasCloseout, type AtlasCloseoutSummary } from "@/lib/atlas/closeout-client";
import { fetchAtlasFarmSnapshot, type AtlasFarmSnapshot } from "@/lib/atlas/farm-snapshot-client";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { saveAtlasInboxItem } from "@/lib/atlas/inbox-client";

type HomePanel = "inbox" | "week" | "closeout" | null;
type WeatherResponse = { ok: boolean; label?: string; rainAge?: string; daysSinceRain?: number | null; error?: string };
type HomeTaskDisplay = { rhythm: string; action: string; subject: string; location: string; detail: string | null };
type WorkRouteKey = "plant" | "weed" | "mow" | "seed" | "harvest" | "build" | "venue" | "water";
type WorkRoute = { key: WorkRouteKey; label: string; cards: AtlasTaskCard[]; zones: string[]; preview: string; href: string };
type DayPlan = { dateIso: string; dayLabel: string; dateLabel: string; total: number; cards: AtlasTaskCard[]; routeCounts: { key: WorkRouteKey; label: string; count: number }[]; preview: string };

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const defaultSnapshot: AtlasFarmSnapshot = { totalBeds: 0, growingBeds: 0, activeSqft: 0, sowingsLogged: 0, stemsLogged: 0 };
const routeOrder: WorkRouteKey[] = ["plant", "weed", "mow", "seed", "harvest", "build", "venue", "water"];
const heroRouteKeys = new Set<WorkRouteKey>(["plant", "weed", "mow", "harvest"]);
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
const shortRouteLabels: Record<WorkRouteKey, string> = {
  plant: "Plant",
  weed: "Weed",
  mow: "Mow",
  seed: "Seed",
  harvest: "Harvest",
  build: "Build",
  venue: "Venue",
  water: "Water",
};

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function dateFromIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  const date = dateIso.includes("-") ? dateFromIso(dateIso) : new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayLabel(dateIso: string) {
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long" });
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

function taskSortValue(card: AtlasTaskCard) {
  const dayOrder = metaNumber(card, "day_order") ?? 999;
  return `${card.due_date ?? "9999-12-31"}-${priorityRank[card.priority] ?? 9}-${String(dayOrder).padStart(3, "0")}-${card.title}`;
}

function taskDisplay(card: AtlasTaskCard): HomeTaskDisplay {
  const taskText = `${card.task_type} ${card.title}`.toLowerCase();
  const rhythm = metaString(card, "work_rhythm")
    ?? (taskText.includes("water") ? "Watering" : taskText.includes("harvest") ? "Harvest + Postharvest" : taskText.includes("venue") || taskText.includes("paint") || taskText.includes("trim") || taskText.includes("tidy") ? "Venue Maintenance" : taskText.includes("seed") || taskText.includes("sow") ? "Seed Sowing" : taskText.includes("weed") ? "Weeding" : taskText.includes("plant") ? "Planting" : taskText.includes("mow") ? "Maintenance" : taskText.includes("prep") || taskText.includes("string") ? "Build / Prep" : "Farm Work");
  const action = metaString(card, "display_action")
    ?? (taskText.includes("water") ? "Water" : taskText.includes("mow") ? "Mow" : taskText.includes("weed") ? "Weed" : taskText.includes("sow") ? "Sow" : taskText.includes("seed") ? "Seed" : taskText.includes("plant") ? "Plant" : taskText.includes("paint") ? "Paint" : taskText.includes("trim") ? "Trim" : taskText.includes("tidy") ? "Tidy" : taskText.includes("harvest") ? "Harvest" : taskText.includes("prep") ? "Prep" : taskText.includes("string") ? "String" : rhythm);
  const detailLines = metaStringList(card, "detail_lines");

  return {
    rhythm,
    action,
    subject: metaString(card, "display_subject") ?? titleSubject(card.title),
    location: metaString(card, "display_detail") ?? card.unlock_text ?? card.zone_label ?? "Elm Farm",
    detail: detailLines[0] ?? null,
  };
}

function isDashboardWork(card: AtlasTaskCard) {
  const text = `${card.task_type} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  const isChild = metadataValue(card, "is_child_task") === true || metadataValue(card, "is_child_task") === "true";
  return !isChild && !(text.includes("verify") || text.includes("check") || text.includes("confirm") || text.includes("count") || text.includes("germin") || text.includes("walk field rows"));
}

function isRouteKey(value: string | null): value is WorkRouteKey {
  return value === "plant" || value === "weed" || value === "mow" || value === "seed" || value === "harvest" || value === "build" || value === "venue" || value === "water";
}

function routeKeyForTask(card: AtlasTaskCard): WorkRouteKey {
  const explicitRoute = metaString(card, "work_route");
  if (isRouteKey(explicitRoute)) return explicitRoute;
  const display = taskDisplay(card);
  const text = `${card.task_type} ${card.title} ${display.rhythm} ${display.action}`.toLowerCase();
  if (text.includes("water")) return "water";
  if (text.includes("mow")) return "mow";
  if (text.includes("weed")) return "weed";
  if (text.includes("seed") || text.includes("sow")) return "seed";
  if (text.includes("harvest") || text.includes("postharvest") || text.includes("garlic") || text.includes("gather")) return "harvest";
  if (text.includes("venue") || text.includes("paint") || text.includes("trim") || text.includes("tidy") || text.includes("chicken")) return "venue";
  if (text.includes("build") || text.includes("prep") || text.includes("string") || text.includes("arch")) return "build";
  if (text.includes("plant") || text.includes("transplant")) return "plant";
  return "venue";
}

function zoneBucket(location: string) {
  const lower = location.toLowerCase();
  if (lower.includes("oak") || lower.includes("strawberry orchard")) return "Shady Oak";
  if (lower.includes("main garden") || lower.includes("straw strip")) return "Main Garden";
  if (lower.includes("field") || lower.includes("fr")) return "Field Rows";
  if (lower.includes("barn")) return "Barn Beds";
  if (lower.includes("berry") || lower.includes("bw")) return "Berry Walk";
  if (lower.includes("u-pick") || lower.includes("u pick")) return "U-Pick";
  if (lower.includes("follow me")) return "Follow Me";
  if (lower.includes("curve")) return "Curve Garden";
  if (lower.includes("lilac")) return "Lilac Haven";
  if (lower.includes("garage") || lower.includes("hydrangea")) return "Garage / House Beds";
  if (lower.includes("grow room")) return "Grow Room";
  if (lower.includes("entry") || lower.includes("billboard")) return "Entry Billboard";
  if (lower.includes("chicken")) return "Chicken Coop";
  return location;
}

function collectionLabel(card: AtlasTaskCard) {
  return metaString(card, "collection_label") ?? taskDisplay(card).subject;
}

function collectionZone(card: AtlasTaskCard) {
  return metaString(card, "collection_zone") ?? zoneBucket(taskDisplay(card).location);
}

function buildRoutes(cards: AtlasTaskCard[]) {
  const byRoute = new Map<WorkRouteKey, AtlasTaskCard[]>();
  routeOrder.forEach((key) => byRoute.set(key, []));
  cards.forEach((card) => byRoute.get(routeKeyForTask(card))?.push(card));

  return routeOrder
    .map((key): WorkRoute | null => {
      const routeCards = (byRoute.get(key) ?? []).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
      if (routeCards.length === 0) return null;
      const displays = routeCards.map(taskDisplay);
      const zones = Array.from(new Set(displays.map((display) => zoneBucket(display.location)).filter(Boolean))).slice(0, 4);
      const preview = displays.map((display) => display.subject).slice(0, 3).join(" · ");
      return {
        key,
        label: routeLabels[key],
        cards: routeCards,
        zones,
        preview,
        href: `/task?route=${encodeURIComponent(key)}`,
      };
    })
    .filter((route): route is WorkRoute => Boolean(route));
}

function routeCountsFor(cards: AtlasTaskCard[]) {
  return routeOrder
    .map((key) => ({ key, label: shortRouteLabels[key], count: cards.filter((card) => routeKeyForTask(card) === key).length }))
    .filter((item) => item.count > 0);
}

function dayPlan(dateIso: string, cards: AtlasTaskCard[]): DayPlan {
  const dayCards = cards
    .filter(isDashboardWork)
    .filter((card) => card.due_date === dateIso)
    .sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
  return {
    dateIso,
    dayLabel: dayLabel(dateIso),
    dateLabel: prettyDate(dateIso),
    total: dayCards.length,
    cards: dayCards,
    routeCounts: routeCountsFor(dayCards),
    preview: dayCards.map(collectionLabel).slice(0, 2).join(" · "),
  };
}

function forwardDayPlans(cards: AtlasTaskCard[], count: number, startOffset = 1) {
  return Array.from({ length: count }, (_, index) => dayPlan(addDaysIso(startOffset + index), cards));
}

function routeCountLine(plan: DayPlan) {
  if (!plan.routeCounts.length) return "No farm tasks planned";
  return plan.routeCounts.map((item) => `${item.label} ${item.count}`).join(" · ");
}

function panelTitle(panel: HomePanel) {
  if (panel === "inbox") return "Note";
  if (panel === "week") return "Week Lineup";
  if (panel === "closeout") return "Closeout";
  return "Atlas";
}

function TaskLaunchHero({ cards, loading }: { cards: AtlasTaskCard[]; loading: boolean; weatherLabel: string }) {
  const today = todayIso();
  const todayHref = `/day?date=${encodeURIComponent(today)}`;
  const dashboardCards = cards.filter(isDashboardWork);
  const todayCards = dashboardCards.filter((card) => card.due_date === today);
  const routes = buildRoutes(todayCards).filter((route) => heroRouteKeys.has(route.key)).slice(0, 4);
  const todayCount = todayCards.length;

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
          <em className="atlas-season-label">Open day overview · {prettyDate(today)}</em>
        </div>
        <span className="atlas-task-date">{todayCount ? `${todayCount} work` : "Complete"}</span>
      </Link>

      {routes.length === 0 ? (
        <Link href={todayHref} className="atlas-run-sheet-empty">
          <strong>All tasks complete</strong>
          <em>Open today overview, or browse the week below.</em>
        </Link>
      ) : (
        <div className="atlas-run-sheet-grid atlas-route-sheet-grid">
          {routes.map((route, index) => (
            <Link key={route.key} href={route.href} className="atlas-run-sheet-box atlas-route-sheet-box">
              <small>{index + 1} · {route.label}</small>
              <strong>{route.label}</strong>
              <span>{route.cards.length} {route.cards.length === 1 ? "task" : "tasks"} · {route.zones.join(", ")}</span>
              <em>{route.preview}</em>
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

function WeeklyWorkBox({ cards, loading, onOpen }: { cards: AtlasTaskCard[]; loading: boolean; onOpen: () => void }) {
  const plans = forwardDayPlans(cards, 2, 1);

  return (
    <button type="button" className="atlas-home-box atlas-home-box-white atlas-week-overview-box" onClick={onOpen}>
      <strong>Week Lineup</strong>
      <em>{loading ? "Loading the next farm days" : "Next farm days"}</em>
      <div className="atlas-week-day-preview-grid">
        {plans.map((plan) => (
          <span key={plan.dateIso} className="atlas-week-day-preview-card">
            <b>{plan.dayLabel}</b>
            <small>{plan.dateLabel} · {plan.total} {plan.total === 1 ? "task" : "tasks"}</small>
            <i>{routeCountLine(plan)}</i>
          </span>
        ))}
      </div>
    </button>
  );
}

function WeekLineupPanel({ cards }: { cards: AtlasTaskCard[] }) {
  const plans = forwardDayPlans(cards, 6, 1);

  return (
    <section className="atlas-task-focus-section atlas-week-panel">
      <article className="atlas-week-panel-hero atlas-week-calendar-hero">
        <span>This Week</span>
        <strong>Next farm days</strong>
        <p>Each day shows the task collections planned for that date.</p>
      </article>
      <div className="atlas-week-calendar-list">
        {plans.map((plan) => (
          <article key={plan.dateIso} className="atlas-week-calendar-day">
            <div className="atlas-week-calendar-day-head">
              <div>
                <strong>{plan.dayLabel}</strong>
                <span>{plan.dateLabel}</span>
              </div>
              <em>{plan.total} {plan.total === 1 ? "task" : "tasks"}</em>
            </div>
            <div className="atlas-week-route-counts">
              {plan.routeCounts.length ? plan.routeCounts.map((item) => <span key={item.key}>{item.label} {item.count}</span>) : <span>No farm tasks planned</span>}
            </div>
            {plan.cards.length ? (
              <div className="atlas-week-task-list">
                {plan.cards.map((card) => (
                  <Link key={card.task_id} href={`/task?taskId=${encodeURIComponent(card.task_id)}`} className="atlas-week-task-row">
                    <strong>{collectionLabel(card)}</strong>
                    <span>{routeLabels[routeKeyForTask(card)]} · {collectionZone(card)}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
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

function CloseoutFooterLink({ summary, today, onOpen }: { summary: AtlasCloseoutSummary | undefined; today: string; onOpen: () => void }) {
  return (
    <button type="button" className="atlas-home-closeout-footer-link" onClick={onOpen}>
      <span>Closeout</span>
      <em>{summary ? `${summary.counts.objectEvents} records · ${summary.counts.openTasks} open` : `Review · ${prettyDate(today)}`}</em>
    </button>
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

  async function loadCards() { try { setLoading(true); const response = await fetchAtlasTaskCards(); setCards((response.taskCards ?? []).filter((card) => card.status === "open").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)))); } finally { setLoading(false); } }
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
          <TaskLaunchHero cards={cards} loading={loading} weatherLabel={weatherLabel} />
          <WeeklyWorkBox cards={cards} loading={loading} onOpen={() => setOpenPanel("week")} />
          <FarmSnapshotBox snapshot={snapshot} loading={snapshotLoading} />
          <CloseoutFooterLink summary={monthSummary} today={today} onOpen={() => setOpenPanel("closeout")} />
        </div>
      </section>
      {openPanel ? <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true"><div className="atlas-task-focus-phone"><div className="atlas-task-focus-topbar"><div><strong>{panelTitle(openPanel)}</strong></div><button type="button" onClick={() => setOpenPanel(null)}>Close</button></div><div className="atlas-task-focus-body">{openPanel === "week" ? <WeekLineupPanel cards={cards} /> : null}{openPanel === "closeout" ? <CloseoutPanel summaries={closeoutSummaries} loading={closeoutLoading} /> : null}{openPanel === "inbox" ? <section className="atlas-task-focus-section"><div className="atlas-add-form"><select aria-label="Zone" value={inboxZoneKey} onChange={(event) => setInboxZoneKey(event.target.value)}><option value="">Whole farm</option></select><textarea aria-label="Note" value={inboxBody} onChange={(event) => setInboxBody(event.target.value)} placeholder="Note" /></div><button type="button" className="atlas-zone-action accent" style={{ width: "100%", border: 0, marginTop: 12 }} disabled={inboxSaving} onClick={() => void submitInbox()}>{inboxSaving ? "Saving" : "Save"}</button>{inboxMessage ? <p className="atlas-task-result-message">{inboxMessage}</p> : null}</section> : null}</div></div></section> : null}
    </main>
  );
}
