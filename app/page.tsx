"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchAtlasCloseout,
  type AtlasCloseoutSummary,
} from "@/lib/atlas/closeout-client";
import { fetchAtlasFarmSnapshot, type AtlasFarmSnapshot } from "@/lib/atlas/farm-snapshot-client";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { saveAtlasInboxItem } from "@/lib/atlas/inbox-client";

type HomePanel = "inbox" | "week" | "closeout" | null;
type WeatherResponse = { ok: boolean; label?: string; rainAge?: string; daysSinceRain?: number | null; error?: string };
type HomeTaskDisplay = { rhythm: string; action: string; subject: string; location: string; detail: string | null };
type WorkRouteKey = "plant" | "weed" | "mow" | "seed" | "harvest" | "build" | "venue" | "water";
type WorkRoute = { key: WorkRouteKey; label: string; cards: AtlasTaskCard[]; zones: string[]; preview: string; href: string };
type WorkGroup = { label: string; cards: AtlasTaskCard[]; routes: string[]; preview: string };

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const defaultSnapshot: AtlasFarmSnapshot = { totalBeds: 0, growingBeds: 0, activeSqft: 0, sowingsLogged: 0, stemsLogged: 0 };
const routeOrder: WorkRouteKey[] = ["plant", "weed", "mow", "seed", "harvest", "build", "venue", "water"];
const mainRouteKeys = new Set<WorkRouteKey>(["plant", "weed", "mow", "seed", "build"]);
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
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  const date = dateIso.includes("-") ? new Date(`${dateIso}T12:00:00`) : new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  const text = `${card.task_type} ${card.title}`.toLowerCase();
  const rhythm = metaString(card, "work_rhythm")
    ?? (text.includes("water") ? "Watering" : text.includes("harvest") ? "Harvest + Postharvest" : text.includes("venue") || text.includes("paint") || text.includes("trim") || text.includes("tidy") ? "Venue Maintenance" : text.includes("seed") || text.includes("sow") ? "Seed Sowing" : text.includes("weed") ? "Weeding" : text.includes("plant") ? "Planting" : text.includes("mow") ? "Maintenance" : text.includes("prep") || text.includes("string") ? "Build / Prep" : "Farm Work");
  const action = metaString(card, "display_action")
    ?? (text.includes("water") ? "Water" : text.includes("mow") ? "Mow" : text.includes("weed") ? "Weed" : text.includes("sow") ? "Sow" : text.includes("seed") ? "Seed" : text.includes("plant") ? "Plant" : text.includes("paint") ? "Paint" : text.includes("trim") ? "Trim" : text.includes("tidy") ? "Tidy" : text.includes("harvest") ? "Harvest" : text.includes("prep") ? "Prep" : text.includes("string") ? "String" : rhythm);
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

function weekCards(cards: AtlasTaskCard[]) {
  const weekEnd = addDaysIso(6);
  return cards
    .filter(isDashboardWork)
    .filter((card) => !card.due_date || card.due_date <= weekEnd)
    .sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
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

function groupedCards(cards: AtlasTaskCard[], groupBy: (card: AtlasTaskCard) => string): WorkGroup[] {
  const map = new Map<string, AtlasTaskCard[]>();
  cards.forEach((card) => {
    const key = groupBy(card);
    map.set(key, [...(map.get(key) ?? []), card]);
  });
  return Array.from(map.entries()).map(([label, groupCards]) => {
    const routes = Array.from(new Set(groupCards.map((card) => routeLabels[routeKeyForTask(card)])));
    return {
      label,
      cards: groupCards,
      routes,
      preview: groupCards.map(collectionLabel).slice(0, 3).join(" · "),
    };
  });
}

function panelTitle(panel: HomePanel) {
  if (panel === "inbox") return "Note";
  if (panel === "week") return "Week Lineup";
  if (panel === "closeout") return "Closeout";
  return "Atlas";
}

function TaskLaunchHero({ cards, loading }: { cards: AtlasTaskCard[]; loading: boolean; weatherLabel: string }) {
  const today = todayIso();
  const dashboardCards = cards.filter(isDashboardWork);
  const todayCards = dashboardCards.filter((card) => !card.due_date || card.due_date <= today);
  const upcomingCards = dashboardCards.filter((card) => card.due_date && card.due_date > today);
  const routeSource = todayCards.length ? todayCards : upcomingCards;
  const routes = buildRoutes(routeSource);
  const firstDue = routeSource[0]?.due_date ? prettyDate(routeSource[0].due_date) : prettyDate(today);

  if (loading && cards.length === 0) {
    return (
      <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller atlas-daily-run-sheet empty">
        <div className="atlas-task-controller-head">
          <span className="atlas-task-kicker">Today</span>
          <span className="atlas-task-date">Loading</span>
        </div>
        <Link href="/task" className="atlas-run-sheet-empty">
          <strong>Loading the work board</strong>
          <em>Atlas is pulling open tasks.</em>
        </Link>
      </article>
    );
  }

  return (
    <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller atlas-daily-run-sheet atlas-route-sheet">
      <div className="atlas-task-controller-head">
        <div>
          <span className="atlas-task-kicker">Today</span>
          <em className="atlas-season-label">Choose a route · {firstDue}</em>
        </div>
        <Link href="/task" className="atlas-task-date">{dashboardCards.length} work</Link>
      </div>

      {routes.length === 0 ? (
        <Link href="/task" className="atlas-run-sheet-empty">
          <strong>No open farm work</strong>
          <em>Open the task board.</em>
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
  const items = weekCards(cards);
  const main = items.filter((card) => mainRouteKeys.has(routeKeyForTask(card)));
  const side = items.filter((card) => !mainRouteKeys.has(routeKeyForTask(card)));
  const mainGroups = groupedCards(main, collectionZone).slice(0, 3);
  const sideRoutes = groupedCards(side, (card) => routeLabels[routeKeyForTask(card)]).map((group) => group.label).slice(0, 3);

  return (
    <button type="button" className="atlas-home-box atlas-home-box-white atlas-week-overview-box" onClick={onOpen}>
      <strong>Week Lineup</strong>
      <em>{loading ? "Loading work" : `${items.length} open · main work by place`}</em>
      <div className="atlas-week-mini-list">
        {mainGroups.map((group) => (
          <span key={group.label}><b>{group.label}</b><small>{group.routes.join(" + ")}</small></span>
        ))}
        {sideRoutes.length ? <span><b>Side Work</b><small>{sideRoutes.join(" + ")}</small></span> : null}
      </div>
    </button>
  );
}

function WeekLineupPanel({ cards }: { cards: AtlasTaskCard[] }) {
  const items = weekCards(cards);
  const main = items.filter((card) => mainRouteKeys.has(routeKeyForTask(card)));
  const side = items.filter((card) => !mainRouteKeys.has(routeKeyForTask(card)));
  const mainGroups = groupedCards(main, collectionZone);
  const sideGroups = groupedCards(side, (card) => routeLabels[routeKeyForTask(card)]);

  return (
    <section className="atlas-task-focus-section atlas-week-panel">
      <article className="atlas-week-panel-hero">
        <span>This Week</span>
        <strong>{items.length} open</strong>
        <p>Main work is grouped by place. Side work is grouped by route.</p>
      </article>
      <div className="atlas-week-shelf">
        <h3>Main Work</h3>
        {mainGroups.map((group) => (
          <article key={group.label} className="atlas-week-group-card">
            <div className="atlas-week-group-head">
              <strong>{group.label}</strong>
              <span>{group.routes.join(" + ")}</span>
            </div>
            <div className="atlas-week-task-list">
              {group.cards.map((card) => (
                <Link key={card.task_id} href={`/task?taskId=${encodeURIComponent(card.task_id)}`} className="atlas-week-task-row">
                  <strong>{collectionLabel(card)}</strong>
                  <span>{routeLabels[routeKeyForTask(card)]} · {prettyDate(card.due_date)}</span>
                </Link>
              ))}
            </div>
          </article>
        ))}
      </div>
      {sideGroups.length ? (
        <div className="atlas-week-shelf">
          <h3>Side Work</h3>
          {sideGroups.map((group) => (
            <article key={group.label} className="atlas-week-group-card">
              <div className="atlas-week-group-head">
                <strong>{group.label}</strong>
                <span>{group.cards.length} {group.cards.length === 1 ? "task" : "tasks"}</span>
              </div>
              <div className="atlas-week-task-list">
                {group.cards.map((card) => (
                  <Link key={card.task_id} href={`/task?taskId=${encodeURIComponent(card.task_id)}`} className="atlas-week-task-row">
                    <strong>{collectionLabel(card)}</strong>
                    <span>{collectionZone(card)} · {prettyDate(card.due_date)}</span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function FarmSnapshotBox({ snapshot, loading }: { snapshot: AtlasFarmSnapshot; loading: boolean }) {
  return <Link href="/zones" className="atlas-home-box atlas-home-box-white atlas-home-box-link atlas-farm-snapshot-box"><strong>Farm Snapshot</strong><div className="atlas-snapshot-grid"><span><b>{loading ? "…" : snapshot.growingBeds}</b> growing beds</span><span><b>{loading ? "…" : snapshot.activeSqft.toLocaleString()}</b> active sq ft</span><span><b>{loading ? "…" : snapshot.sowingsLogged}</b> sowings logged</span><span><b>{loading ? "…" : snapshot.stemsLogged}</b> stems logged</span></div></Link>;
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
          <button type="button" className="atlas-home-box atlas-home-box-white" onClick={() => setOpenPanel("closeout")}><strong>Closeout</strong><em>{monthSummary ? `${monthSummary.counts.objectEvents} records · ${monthSummary.counts.openTasks} still open` : "Month record"}</em><div className="atlas-home-mini-list"><span>Today · {prettyDate(today)}</span><span>Review what changed</span></div></button>
          <WeeklyWorkBox cards={cards} loading={loading} onOpen={() => setOpenPanel("week")} />
          <FarmSnapshotBox snapshot={snapshot} loading={snapshotLoading} />
        </div>
      </section>
      {openPanel ? <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true"><div className="atlas-task-focus-phone"><div className="atlas-task-focus-topbar"><div><strong>{panelTitle(openPanel)}</strong></div><button type="button" onClick={() => setOpenPanel(null)}>Close</button></div><div className="atlas-task-focus-body">{openPanel === "week" ? <WeekLineupPanel cards={cards} /> : null}{openPanel === "closeout" ? <CloseoutPanel summaries={closeoutSummaries} loading={closeoutLoading} /> : null}{openPanel === "inbox" ? <section className="atlas-task-focus-section"><div className="atlas-add-form"><select aria-label="Zone" value={inboxZoneKey} onChange={(event) => setInboxZoneKey(event.target.value)}><option value="">Whole farm</option></select><textarea aria-label="Note" value={inboxBody} onChange={(event) => setInboxBody(event.target.value)} placeholder="Note" /></div><button type="button" className="atlas-zone-action accent" style={{ width: "100%", border: 0, marginTop: 12 }} disabled={inboxSaving} onClick={() => void submitInbox()}>{inboxSaving ? "Saving" : "Save"}</button>{inboxMessage ? <p className="atlas-task-result-message">{inboxMessage}</p> : null}</section> : null}</div></div></section> : null}
    </main>
  );
}
