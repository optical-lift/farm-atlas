"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type WeatherResponse = { ok: boolean; label?: string };

type MowingRoute = {
  objectId: string;
  objectKey: string;
  label: string;
  zoneId: string | null;
  zoneLabel: string | null;
  equipmentGroup: string | null;
  targetCutHeightInches: string | number | null;
  cadenceDays: string | number | null;
  stateId: string;
  rhythmState: string;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  currentTaskId: string | null;
  areaStatus: string;
  lastMowedAt: string | null;
  lastObservedAt: string | null;
  nextCheckDate: string | null;
  note: string | null;
  bindingActive: boolean;
};

type DashboardResponse = {
  ok?: boolean;
  error?: string;
  items?: MowingRoute[];
};

type RouteSectionProps = {
  title: string;
  routes: MowingRoute[];
  empty: string;
  tone?: "due" | "done" | "paused" | "upcoming";
};

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function rhythmLabel(route: MowingRoute) {
  if (!route.bindingActive || route.rhythmState === "paused") return "Paused";
  if (route.areaStatus === "problem") return "Owner attention";
  if (route.areaStatus === "too_wet") return route.nextCheckDate ? `Wet · return ${prettyDate(route.nextCheckDate)}` : "Too wet";
  if (route.areaStatus === "partial") return "Partly mowed · route remains open";
  if (route.rhythmState === "fallen_out_of_rhythm") return "Restore now";
  if (route.rhythmState === "due") return route.currentTaskId ? "Due now" : "Due · waiting behind work capacity";
  if (route.rhythmState === "recovering") return "Recovering";
  if (route.currentTaskId) return `Scheduled ${prettyDate(route.dueAt)}`;
  if (route.rhythmState === "coming_due") return `Coming due ${prettyDate(route.dueAt)}`;
  return `In rhythm · returns ${prettyDate(route.dueAt)}`;
}

function routeDetail(route: MowingRoute) {
  const equipment = route.equipmentGroup || "Equipment not recorded";
  const height = route.targetCutHeightInches ? `${route.targetCutHeightInches} in target` : "route height standard";
  return `${equipment} · ${height} · last full mow ${prettyDate(route.lastMowedAt)}`;
}

function MowingRouteCard({ route, tone }: { route: MowingRoute; tone?: RouteSectionProps["tone"] }) {
  const body = (
    <>
      <div>
        <strong>{route.label}</strong>
        <span>{route.zoneLabel || "Elm Farm"}</span>
      </div>
      <em>{rhythmLabel(route)}</em>
      <p>{routeDetail(route)}{route.note ? ` · ${route.note}` : ""}</p>
    </>
  );

  return route.currentTaskId ? (
    <Link className={`atlas-overview-task-card atlas-work-collection-task-card ${tone ?? ""}`} href={`/task-focus/${encodeURIComponent(route.currentTaskId)}?returnTo=${encodeURIComponent("/collections/mowing")}`}>
      {body}
    </Link>
  ) : (
    <article className={`atlas-overview-task-card atlas-work-collection-task-card ${tone ?? ""}`}>
      {body}
    </article>
  );
}

function RouteSection({ title, routes, empty, tone }: RouteSectionProps) {
  return (
    <section className="atlas-overview-zone-card atlas-work-collection-section">
      <summary>
        <div><strong>{title}</strong><span>{routes.length} {routes.length === 1 ? "route" : "routes"}</span></div>
        <b>Clock</b>
      </summary>
      <div className="atlas-overview-task-list">
        {routes.length ? routes.map((route) => <MowingRouteCard key={route.objectId} route={route} tone={tone} />) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

export default function MowingCollectionPage() {
  const [routes, setRoutes] = useState<MowingRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const today = todayIso();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/atlas/mowing", { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = await response.json() as DashboardResponse;
        if (!response.ok || !data.ok) throw new Error(data.error || "Mowing routes failed.");
        setRoutes(Array.isArray(data.items) ? data.items : []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Mowing collection failed.");
      } finally {
        setLoading(false);
      }
    }

    async function loadWeather() {
      try {
        const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = await response.json() as WeatherResponse;
        setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable");
      } catch {
        setWeatherLabel("weather unavailable");
      }
    }

    void load();
    void loadWeather();
  }, []);

  const due = useMemo(() => routes.filter((route) => ["due", "fallen_out_of_rhythm", "recovering"].includes(route.rhythmState) || ["partial", "too_wet", "problem"].includes(route.areaStatus)), [routes]);
  const upcoming = useMemo(() => routes.filter((route) => !due.includes(route) && route.bindingActive && (route.rhythmState === "coming_due" || Boolean(route.currentTaskId))), [routes, due]);
  const resting = useMemo(() => routes.filter((route) => !due.includes(route) && !upcoming.includes(route) && route.bindingActive && route.rhythmState === "resting"), [routes, due, upcoming]);
  const paused = useMemo(() => routes.filter((route) => !route.bindingActive || route.rhythmState === "paused"), [routes]);
  const nextDue = useMemo(() => routes.map((route) => route.dueAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null, [routes]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Mowing</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href="/day" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to day overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div><strong>Mowing Routes</strong><span>{prettyDate(today)}</span></div>
            <p>{loading ? "Loading route clocks" : `${due.length} need attention · ${resting.length} in rhythm · ${upcoming.length} approaching`}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Mowing route stats">
            <article><strong>{loading ? "…" : due.length}</strong><span>need attention</span></article>
            <article><strong>{loading ? "…" : resting.length}</strong><span>in rhythm</span></article>
            <article><strong>{loading ? "…" : upcoming.length}</strong><span>approaching</span></article>
            <article><strong>{loading ? "…" : prettyDate(nextDue)}</strong><span>next boundary</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>Time returns a route for attention. Only a field result may say it was mowed, remains acceptable, is too wet, or has a problem.</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading mowing routes.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-work-collection-list" aria-label="Mowing routes">
              <RouteSection title="Needs Attention" routes={due} empty="No mowing routes need attention." tone="due" />
              <RouteSection title="Approaching / Scheduled" routes={upcoming} empty="No mowing routes are approaching." tone="upcoming" />
              <RouteSection title="In Rhythm" routes={resting} empty="No routes are resting." tone="done" />
              <RouteSection title="Paused" routes={paused} empty="No mowing routes are paused." tone="paused" />
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
