"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
import {
  AtlasAppShell,
  AtlasCard,
  AtlasTopBar,
} from "@/components/atlas/ui/AtlasPrimitives";
import type {
  AtlasUniversalDatedItem,
  AtlasUniversalHomeModel,
  AtlasUniversalMoveState,
} from "@/lib/atlas/universal-home";
import { fetchAtlasZoneRegistry, type AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

import styles from "./universal-home-v2.module.css";

type AtlasUniversalHomeProps = {
  home: AtlasUniversalHomeModel;
  selectedFarmKey?: string | null;
  selectedWorkstream?: string | null;
};

type WeatherResponse = {
  ok: boolean;
  label?: string;
};

type DayRailItem = {
  dateIso: string;
  weekday: string;
  day: string;
  openCount: number;
  completeCount: number;
  blocked: boolean;
  attention: boolean;
};

function dateFromIso(value: string) {
  return new Date(`${value}T12:00:00`);
}

function isoFromDate(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(value: string, days: number) {
  const date = dateFromIso(value);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

function prettyDate(value: string) {
  return dateFromIso(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function weekStartMonday(value: string) {
  const date = dateFromIso(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return isoFromDate(date);
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function projectState(project: AtlasUniversalHomeModel["projects"][number]): AtlasUniversalMoveState {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "blocked";
  if (project.openAttentionCount > 0 || project.health === "at_risk") return "attention";
  if (project.health === "waiting") return "waiting";
  if (project.health === "complete") return "complete";
  if (project.health === "quiet") return "quiet";
  return "moving";
}

function projectStateLabel(state: AtlasUniversalMoveState) {
  if (state === "blocked") return "Blocked";
  if (state === "attention") return "Needs action";
  if (state === "waiting") return "Waiting";
  if (state === "complete") return "Complete";
  if (state === "quiet") return "Quiet";
  return "Moving";
}

function openDatedItem(item: AtlasUniversalDatedItem) {
  return item.state !== "complete";
}

function dayRail(items: AtlasUniversalDatedItem[], todayIso: string) {
  const startIso = weekStartMonday(todayIso);
  return Array.from({ length: 7 }, (_, index): DayRailItem => {
    const dateIso = addDaysIso(startIso, index);
    const dayItems = items.filter((item) => item.date === dateIso);
    return {
      dateIso,
      weekday: dateFromIso(dateIso).toLocaleDateString("en-US", { weekday: "narrow" }),
      day: dateFromIso(dateIso).toLocaleDateString("en-US", { day: "numeric" }),
      openCount: dayItems.filter(openDatedItem).length,
      completeCount: dayItems.filter((item) => item.state === "complete").length,
      blocked: dayItems.some((item) => item.state === "blocked"),
      attention: dayItems.some((item) => item.state === "attention"),
    };
  });
}

function dayMarker(day: DayRailItem) {
  if (day.openCount > 0) return String(day.openCount);
  if (day.completeCount > 0) return "✓";
  return "—";
}

function HomeTimeRail({ home }: { home: AtlasUniversalHomeModel }) {
  const todayIso = home.window.doneDate;
  const days = dayRail(home.datedItems, todayIso);
  const weekStart = days[0]?.dateIso ?? todayIso;
  const weekEnd = days[6]?.dateIso ?? todayIso;
  const weekOpen = home.datedItems.filter((item) => item.date >= weekStart && item.date <= weekEnd && openDatedItem(item)).length;
  const previousWeek = addDaysIso(weekStart, -7);
  const previousWeekEnd = addDaysIso(previousWeek, 6);

  return (
    <section className={styles.timeRail} aria-labelledby="atlas-home-time-title">
      <div className={styles.timeRailHead}>
        <span id="atlas-home-time-title">The week</span>
        <Link href={`/overview/week?date=${encodeURIComponent(weekStart)}&end=${encodeURIComponent(weekEnd)}`}>
          {weekOpen} open
        </Link>
      </div>
      <div className={styles.days} aria-label="Open a day in this week">
        {days.map((day) => (
          <Link
            key={day.dateIso}
            href={`/day?date=${encodeURIComponent(day.dateIso)}&view=work_order`}
            className={day.dateIso === todayIso ? styles.today : undefined}
            data-blocked={day.blocked ? "true" : "false"}
            data-attention={day.attention ? "true" : "false"}
            aria-current={day.dateIso === todayIso ? "date" : undefined}
            aria-label={`${dateFromIso(day.dateIso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}: ${day.openCount} open`}
          >
            <small>{day.weekday}</small>
            <strong>{day.day}</strong>
            <em>{dayMarker(day)}</em>
          </Link>
        ))}
      </div>
      <nav className={styles.timeRoutes} aria-label="Week and month routes">
        <Link href={`/overview/week?date=${encodeURIComponent(previousWeek)}&end=${encodeURIComponent(previousWeekEnd)}`}>‹ Previous week</Link>
        <Link href={`/overview/week?date=${encodeURIComponent(weekStart)}&end=${encodeURIComponent(weekEnd)}`}>This week · {weekOpen}</Link>
        <Link href={`/overview/month?date=${encodeURIComponent(todayIso)}`}>Month ›</Link>
      </nav>
    </section>
  );
}

function NeedsYou({ home }: { home: AtlasUniversalHomeModel }) {
  const items = home.attention.slice(0, 3);
  if (!items.length) return null;

  return (
    <AtlasCard as="section" className={styles.lens} ariaLabelledBy="atlas-home-needs-title">
      <header className={styles.lensHeader}>
        <div>
          <span>Owner lane</span>
          <h2 id="atlas-home-needs-title">Needs you</h2>
        </div>
        <Link href="/projects">{home.attention.length}</Link>
      </header>
      <div className={styles.lensList}>
        {items.map((item, index) => (
          <Link key={`${item.attentionId ?? item.projectId}-${index}`} href={`/project/${encodeURIComponent(item.projectId)}`}>
            <div>
              <small>{titleCase(item.kind)}</small>
              <strong>{item.title}</strong>
              <span>{item.detail || item.projectTitle}</span>
            </div>
            <b aria-hidden="true">›</b>
          </Link>
        ))}
      </div>
      {home.attention.length > items.length ? <Link className={styles.lensFooter} href="/projects">See all {home.attention.length} items</Link> : null}
    </AtlasCard>
  );
}

function MovingNow({ projects }: { projects: AtlasUniversalHomeModel["projects"] }) {
  const ranked = [...projects]
    .filter((project) => projectState(project) !== "complete" && projectState(project) !== "quiet")
    .sort((left, right) => {
      const rank: Record<AtlasUniversalMoveState, number> = {
        blocked: 0,
        attention: 1,
        moving: 2,
        ready: 3,
        waiting: 4,
        review: 5,
        quiet: 6,
        complete: 7,
      };
      return rank[projectState(left)] - rank[projectState(right)]
        || (right.lastMovementAt ?? "").localeCompare(left.lastMovementAt ?? "")
        || left.title.localeCompare(right.title);
    })
    .slice(0, 3);

  if (!ranked.length) return null;

  return (
    <AtlasCard as="section" className={styles.lens} ariaLabelledBy="atlas-home-moving-title">
      <header className={styles.lensHeader}>
        <div>
          <span>Projects</span>
          <h2 id="atlas-home-moving-title">Moving now</h2>
        </div>
        <Link href="/projects">Open</Link>
      </header>
      <div className={styles.projectRows}>
        {ranked.map((project) => {
          const state = projectState(project);
          return (
            <Link key={project.projectId} href={`/project/${encodeURIComponent(project.projectId)}`} data-state={state}>
              <div>
                <small>{project.farmName || "Feast Guild"} · {projectStateLabel(state)}</small>
                <strong>{project.title}</strong>
                <span>{project.currentMilestone || project.outcome || "Open the project."}</span>
              </div>
              <b>{project.openTaskCount}</b>
            </Link>
          );
        })}
      </div>
    </AtlasCard>
  );
}

function FarmPulse({ home }: { home: AtlasUniversalHomeModel }) {
  const todayIso = home.window.doneDate;
  const todayCount = home.datedItems.filter((item) => item.date === todayIso && openDatedItem(item)).length;
  const carryoverCount = home.datedItems.filter((item) => item.date < todayIso && openDatedItem(item)).length;
  const movingProjects = home.projects.filter((project) => {
    const state = projectState(project);
    return state === "moving" || state === "blocked" || state === "attention" || state === "waiting";
  }).length;

  return (
    <section className={styles.pulse} aria-labelledby="atlas-home-pulse-title">
      <div className={styles.pulseHead}>
        <span id="atlas-home-pulse-title">Farm pulse</span>
        <Link href="/more">Deeper views ›</Link>
      </div>
      <div className={styles.pulseMetrics}>
        <Link href={`/day?date=${encodeURIComponent(todayIso)}&view=work_order`}><b>{todayCount}</b><span>today</span></Link>
        <Link href="/overview/week"><b>{carryoverCount}</b><span>carried</span></Link>
        <Link href="/projects"><b>{movingProjects}</b><span>projects moving</span></Link>
        <Link href="/bell?view=baseline"><b>{home.metrics.attentionCount}</b><span>known gaps</span></Link>
      </div>
    </section>
  );
}

export default function AtlasUniversalHome({
  home,
  selectedFarmKey,
  selectedWorkstream,
}: AtlasUniversalHomeProps) {
  const router = useRouter();
  const [weatherLabel, setWeatherLabel] = useState<string | null>(null);
  const [registryZones, setRegistryZones] = useState<AtlasRegistryZone[]>([]);
  const [logSeed, setLogSeed] = useState<AtlasFieldLogSeed | null>(null);
  const todayIso = home.window.doneDate;
  const canDocumentActiveFarm = Boolean(
    home.activeFarm
      && home.activeFarm.workerKey
      && home.activeFarm.farmId === home.viewer.activeFarmId,
  );

  useEffect(() => {
    if (!home.activeFarm || home.activeFarm.farmId !== home.viewer.activeFarmId) return;
    let active = true;
    fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: WeatherResponse) => {
        if (active) setWeatherLabel(data.ok && data.label ? data.label : null);
      })
      .catch(() => {
        if (active) setWeatherLabel(null);
      });
    return () => {
      active = false;
    };
  }, [home.activeFarm, home.viewer.activeFarmId]);

  async function openFieldLog() {
    if (!canDocumentActiveFarm) return;
    if (registryZones.length === 0) {
      try {
        const response = await fetchAtlasZoneRegistry();
        setRegistryZones(response.zones ?? []);
      } catch {
        setRegistryZones([]);
      }
    }
    setLogSeed({ workKey: "note", zoneKeys: [], objectKeys: [] });
  }

  const headerStatus = weatherLabel || `${home.metrics.movingCount} moving`;
  const filteredProjects = useMemo(() => home.projects.filter((project) => {
    if (selectedWorkstream && project.workstream !== selectedWorkstream) return false;
    if (selectedFarmKey && project.farmKey !== selectedFarmKey) return false;
    return true;
  }), [home.projects, selectedFarmKey, selectedWorkstream]);
  const todayOpen = home.datedItems.filter((item) => item.date === todayIso && openDatedItem(item)).length;
  const heroHref = home.activeFarm
    ? `/day?date=${encodeURIComponent(todayIso)}&view=work_order`
    : home.moves[0]?.href || "/projects";
  const coverLabel = home.activeFarm && home.title === home.activeFarm.farmName
    ? `Today at ${home.activeFarm.farmName}`
    : "Across the Guild";

  return (
    <>
      <AtlasAppShell
        className="atlas-home-shell"
        frameClassName={styles.frame}
        data-atlas-home-portal="universal-v2"
        data-atlas-has-farm-scope={home.viewer.hasFarmScope ? "true" : "false"}
        data-atlas-has-organization-scope={home.viewer.hasOrganizationScope ? "true" : "false"}
      >
        <AtlasTopBar
          title={home.title}
          status={<span className="atlas-weather-line">{headerStatus}</span>}
          action={canDocumentActiveFarm ? (
            <button type="button" className="atlas-note-plus" aria-label="Document work" onClick={openFieldLog}>+</button>
          ) : home.projects.length ? (
            <Link href="/projects" className="atlas-note-plus" aria-label="Open projects">+</Link>
          ) : null}
        />

        <div className={styles.home}>
          <AtlasCard
            variant="purple"
            className={`${styles.hero} atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller atlas-daily-run-sheet atlas-route-sheet`}
            ariaLabelledBy="atlas-today-title"
          >
            <Link href={heroHref} className={`${styles.heroHead} atlas-task-controller-head atlas-task-controller-head-link`} aria-label="Open current work">
              <div>
                <span className="atlas-task-kicker">{coverLabel}</span>
                <em className="atlas-season-label" id="atlas-today-title">{prettyDate(todayIso)}</em>
              </div>
              <span className="atlas-task-date">{todayOpen ? `${todayOpen} in hand` : "Day clear"}</span>
            </Link>
            {home.moves.length ? (
              <div className={`${styles.heroGrid} atlas-run-sheet-grid atlas-route-sheet-grid`} data-universal-move-count={home.moves.length}>
                {home.moves.map((move) => (
                  <Link
                    key={move.key}
                    href={move.href}
                    className={`${styles.heroMove} atlas-run-sheet-box atlas-route-sheet-box atlas-task-forward-box`}
                    data-atlas-state={move.state}
                  >
                    <small>{move.category}</small>
                    <strong>{move.title}</strong>
                    <span>{move.scopeLabel} · {move.meta}</span>
                    <em>{move.detail}</em>
                  </Link>
                ))}
              </div>
            ) : (
              <Link href={heroHref} className={styles.heroEmpty}>
                <strong>The day is clear</strong>
                <em>Open Work to inspect the next useful move.</em>
              </Link>
            )}
          </AtlasCard>

          <HomeTimeRail home={home} />

          <div className={styles.lenses}>
            <NeedsYou home={home} />
            <MovingNow projects={filteredProjects} />
          </div>

          <FarmPulse home={home} />
        </div>
      </AtlasAppShell>

      {logSeed ? (
        <FieldLogDrawer
          zones={registryZones}
          seed={logSeed}
          onClose={() => setLogSeed(null)}
          onSaved={() => {
            setLogSeed(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
