"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
import AtlasPortfolioMatrix from "@/components/atlas/home/AtlasPortfolioMatrix";
import AtlasTrailPulseBoard from "@/components/atlas/home/AtlasTrailPulseBoard";
import {
  AtlasAppShell,
  AtlasCard,
  AtlasFooterActions,
  AtlasMetricStrip,
  AtlasSectionHeading,
  AtlasStateBadge,
  AtlasTopBar,
} from "@/components/atlas/ui/AtlasPrimitives";
import type {
  AtlasUniversalDatedItem,
  AtlasUniversalFarmScope,
  AtlasUniversalHomeModel,
  AtlasUniversalMoveState,
} from "@/lib/atlas/universal-home";
import { fetchAtlasZoneRegistry, type AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

import styles from "./universal-home.module.css";

type AtlasUniversalHomeProps = {
  home: AtlasUniversalHomeModel;
  selectedFarmKey?: string | null;
  selectedWorkstream?: string | null;
};

type WeatherResponse = {
  ok: boolean;
  label?: string;
};

type UniversalFarmCard = {
  farmId: string;
  farmKey: string;
  farmName: string;
  status: string;
  scope: AtlasUniversalFarmScope | null;
  projectCount: number;
};

type OverviewRow = {
  key: string;
  label: string;
  sublabel: string;
  count: number;
  href: string;
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

function dayShortLabel(value: string) {
  return dateFromIso(value).toLocaleDateString("en-US", { weekday: "short" });
}

function compactDateRange(startIso: string, endIso: string) {
  const start = dateFromIso(startIso);
  const end = dateFromIso(endIso);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = sameMonth
    ? end.toLocaleDateString("en-US", { day: "numeric" })
    : end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startLabel}–${endLabel}`;
}

function calendarWeekStartFor(value: string) {
  const start = dateFromIso(value);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function countDatedItems(items: AtlasUniversalDatedItem[], startIso: string, endIso = startIso) {
  return items.filter((item) => item.date >= startIso && item.date <= endIso).length;
}

function monthProgress(value: string) {
  const date = dateFromIso(value);
  return {
    day: date.getDate(),
    days: new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(),
  };
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateLabel(state: AtlasUniversalMoveState) {
  if (state === "blocked") return "Blocked";
  if (state === "attention") return "Attention";
  if (state === "waiting") return "Waiting";
  if (state === "complete") return "Complete";
  if (state === "quiet") return "Quiet";
  if (state === "review") return "Review";
  if (state === "ready") return "Ready";
  return "Moving";
}

function projectState(project: AtlasUniversalHomeModel["projects"][number]): AtlasUniversalMoveState {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "blocked";
  if (project.openAttentionCount > 0 || project.health === "at_risk") return "attention";
  if (project.health === "waiting") return "waiting";
  if (project.health === "complete") return "complete";
  if (project.health === "quiet") return "quiet";
  return "moving";
}

function farmState(farm: UniversalFarmCard): AtlasUniversalMoveState {
  if (!farm.scope) return farm.projectCount > 0 ? "moving" : "quiet";
  if (farm.scope.blockedTaskCount > 0) return "blocked";
  if (farm.scope.overdueTaskCount > 0) return "attention";
  if (farm.scope.openTaskCount > 0) return "moving";
  return "quiet";
}

function farmCards(home: AtlasUniversalHomeModel) {
  const cards = new Map<string, UniversalFarmCard>();
  home.organizationHome?.farms.forEach((farm) => {
    cards.set(farm.farmId, {
      farmId: farm.farmId,
      farmKey: farm.farmKey,
      farmName: farm.farmName,
      status: farm.status,
      scope: home.farms.find((item) => item.farmId === farm.farmId) ?? null,
      projectCount: farm.projects.length,
    });
  });
  home.farms.forEach((farm) => {
    const existing = cards.get(farm.farmId);
    cards.set(farm.farmId, {
      farmId: farm.farmId,
      farmKey: farm.farmKey,
      farmName: farm.farmName,
      status: farm.farmStatus,
      scope: farm,
      projectCount: existing?.projectCount ?? 0,
    });
  });
  return [...cards.values()].sort((left, right) => left.farmName.localeCompare(right.farmName));
}

function filterHref(farmKey?: string | null, workstream?: string | null) {
  const params = new URLSearchParams();
  if (farmKey) params.set("farm", farmKey);
  if (workstream) params.set("workstream", workstream);
  const query = params.toString();
  return query ? `/?${query}#scope-board` : "/#scope-board";
}

function overviewRows(items: AtlasUniversalDatedItem[], todayIso: string) {
  const dayRows: OverviewRow[] = Array.from({ length: 4 }, (_, index) => {
    const dateIso = addDaysIso(todayIso, index + 1);
    return {
      key: dateIso,
      label: dayShortLabel(dateIso),
      sublabel: prettyDate(dateIso),
      count: countDatedItems(items, dateIso),
      href: `/day?date=${encodeURIComponent(dateIso)}`,
    };
  });

  const weekRows: OverviewRow[] = [];
  let start = calendarWeekStartFor(todayIso);
  for (let index = 0; index < 4; index += 1) {
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startIso = isoFromDate(start);
    const endIso = isoFromDate(end);
    weekRows.push({
      key: startIso,
      label: compactDateRange(startIso, endIso),
      sublabel: "Sun–Sat",
      count: countDatedItems(items, startIso, endIso),
      href: `/overview/week?date=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
    });
    start = new Date(end);
    start.setDate(start.getDate() + 1);
  }

  const weekEnd = addDaysIso(todayIso, 7);
  const date = dateFromIso(todayIso);
  const monthEnd = isoFromDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
  return {
    dayRows,
    weekRows,
    weekCount: countDatedItems(items, todayIso, weekEnd),
    monthCount: countDatedItems(items, todayIso, monthEnd),
    monthLabel: date.toLocaleDateString("en-US", { month: "long" }),
    progress: monthProgress(todayIso),
  };
}

function UniversalOverviewBoxes({ home }: { home: AtlasUniversalHomeModel }) {
  const rows = overviewRows(home.datedItems, home.window.doneDate);
  const canOpenFarmCalendar = Boolean(home.activeFarm);

  return (
    <div className="atlas-home-overview-row" aria-label="Week and month overview links">
      <AtlasCard className="atlas-home-overview-card atlas-home-overview-week">
        <Link href={canOpenFarmCalendar ? "/overview/week" : "#work-board"} className="atlas-home-overview-top">
          <strong>This Week</strong>
          <span>{rows.weekCount} open</span>
        </Link>
        <div className="atlas-home-overview-list">
          {rows.dayRows.map((row) => (
            <Link key={row.key} href={canOpenFarmCalendar ? row.href : "#work-board"} className="atlas-home-overview-row-link">
              <b>{row.label}</b>
              <small>{row.sublabel}</small>
              <em>{row.count}</em>
            </Link>
          ))}
        </div>
      </AtlasCard>
      <AtlasCard className="atlas-home-overview-card atlas-home-overview-month">
        <Link href={canOpenFarmCalendar ? "/overview/month" : "#work-board"} className="atlas-home-overview-top">
          <strong>{rows.monthLabel}</strong>
          <span>{rows.progress.day}/{rows.progress.days} days · {rows.monthCount} open</span>
        </Link>
        <div className="atlas-home-overview-list atlas-home-month-week-list">
          {rows.weekRows.map((row) => (
            <Link key={row.key} href={canOpenFarmCalendar ? row.href : "#work-board"} className="atlas-home-overview-row-link">
              <b>{row.label}</b>
              <small>{row.sublabel}</small>
              <em>{row.count}</em>
            </Link>
          ))}
        </div>
      </AtlasCard>
    </div>
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
  const visibleFarms = useMemo(() => farmCards(home), [home]);
  const workstreams = home.organizationHome?.workstreams ?? [];
  const singleVisibleFarm = visibleFarms.length === 1;
  const showOwnerPortfolio = Boolean(home.organizationHome?.viewer.isOwner && home.projects.length);
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
  const filteredFarms = selectedFarmKey
    ? visibleFarms.filter((farm) => farm.farmKey === selectedFarmKey)
    : visibleFarms;
  const filteredProjects = home.projects.filter((project) => {
    if (selectedWorkstream && project.workstream !== selectedWorkstream) return false;
    if (!selectedFarmKey) return true;
    return project.farmKey === selectedFarmKey
      || project.targets.some((target) => target.farmId === filteredFarms[0]?.farmId);
  });
  const todayDatedCount = home.datedItems.filter((item) => item.date === todayIso && item.state !== "complete").length;
  const currentMoveLabel = todayDatedCount
    ? `${todayDatedCount} today`
    : home.moves.length
      ? `${home.moves.length} open`
      : "Complete";
  const heroHref = home.activeFarm
    ? `/day?date=${encodeURIComponent(todayIso)}`
    : home.moves[0]?.href || "#work-board";
  const activeSnapshot = home.activeFarm?.snapshot;
  const showFarmSnapshot = Boolean(activeSnapshot && !home.viewer.hasOrganizationScope);
  const firstProjectHref = home.projects[0] ? `/project/${encodeURIComponent(home.projects[0].projectId)}` : "#work-board";
  const metricHref = showOwnerPortfolio
    ? "#portfolio-matrix"
    : singleVisibleFarm
      ? (home.projects.length ? "#work-board" : "/zones")
      : "#scope-board";

  return (
    <>
      <AtlasAppShell
        className="atlas-home-shell"
        data-atlas-home-portal="universal"
        data-atlas-has-farm-scope={home.viewer.hasFarmScope ? "true" : "false"}
        data-atlas-has-organization-scope={home.viewer.hasOrganizationScope ? "true" : "false"}
        data-atlas-single-farm={singleVisibleFarm ? "true" : "false"}
      >
        <AtlasTopBar
          title={home.title}
          status={<span className="atlas-weather-line">{headerStatus}</span>}
          action={canDocumentActiveFarm ? (
            <button type="button" className="atlas-note-plus" aria-label="Document work" onClick={openFieldLog}>+</button>
          ) : home.projects.length ? (
            <Link href={firstProjectHref} className="atlas-note-plus" aria-label="Open current project work">+</Link>
          ) : null}
        />

        <div className="atlas-home-grid">
          <AtlasCard
            variant="purple"
            className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller atlas-daily-run-sheet atlas-route-sheet"
            ariaLabelledBy="atlas-today-title"
          >
            <Link href={heroHref} className="atlas-task-controller-head atlas-task-controller-head-link" aria-label="Open current work">
              <div>
                <span className="atlas-task-kicker">Today</span>
                <em className="atlas-season-label" id="atlas-today-title">{prettyDate(todayIso)}</em>
              </div>
              <span className="atlas-task-date">{currentMoveLabel}</span>
            </Link>
            {home.moves.length ? (
              <div className="atlas-run-sheet-grid atlas-route-sheet-grid" data-universal-move-count={home.moves.length}>
                {home.moves.map((move) => (
                  <Link
                    key={move.key}
                    href={move.href}
                    className="atlas-run-sheet-box atlas-route-sheet-box atlas-task-forward-box"
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
              <Link href={heroHref} className="atlas-run-sheet-empty">
                <strong>All tasks complete</strong>
                <em>Open the work board below to inspect the next project or farm move.</em>
              </Link>
            )}
          </AtlasCard>

          <UniversalOverviewBoxes home={home} />

          {showFarmSnapshot && activeSnapshot ? (
            <AtlasMetricStrip href="/zones" className="atlas-farm-snapshot-bar" ariaLabel="Open farm snapshot">
              <span><b>{activeSnapshot.growingBeds}</b> beds</span>
              <span><b>{activeSnapshot.activeSqft.toLocaleString()}</b> sq ft</span>
              <span><b>{activeSnapshot.sowingsLogged}</b> sowings</span>
              <span><b>{activeSnapshot.stemsLogged}</b> stems</span>
            </AtlasMetricStrip>
          ) : (
            <AtlasMetricStrip href={metricHref} className="atlas-farm-snapshot-bar" ariaLabel="Open current Atlas work">
              <span><b>{home.metrics.farmCount}</b> farms</span>
              <span><b>{home.metrics.projectCount}</b> projects</span>
              <span><b>{home.metrics.openWorkCount}</b> open</span>
              <span><b>{home.metrics.attentionCount}</b> attention</span>
            </AtlasMetricStrip>
          )}

          <AtlasFooterActions className="atlas-home-footer-row">
            {showOwnerPortfolio ? (
              <Link href="#portfolio-matrix" className="atlas-home-closeout-footer-link">
                <span>Portfolio</span>
                <em>{home.metrics.projectCount} projects across {home.metrics.farmCount} farms</em>
              </Link>
            ) : !singleVisibleFarm ? (
              <Link href="#scope-board" className="atlas-home-closeout-footer-link">
                <span>Atlas scope</span>
                <em>{home.metrics.farmCount} farms visible</em>
              </Link>
            ) : null}
            <Link href={home.projects.length ? "#work-board" : "/closeout"} className="atlas-owner-footer-link">
              <span>{home.projects.length ? "Work in motion" : "Closeout"}</span>
              <em>{home.projects.length ? `${home.metrics.projectCount} projects` : "Review changes"}</em>
            </Link>
          </AtlasFooterActions>

          <AtlasTrailPulseBoard />

          {showOwnerPortfolio ? <AtlasPortfolioMatrix home={home} /> : null}

          {home.projects.length || home.attention.length ? (
            <AtlasCard as="section" id="work-board" className={styles.detailSection} ariaLabelledBy="work-board-title">
              <AtlasSectionHeading kicker="Current moves" title="Work in Motion" count={home.projects.length} id="work-board-title" />
              {home.attention.length ? (
                <div className={styles.attentionList}>
                  {home.attention.map((item, index) => (
                    <Link key={`${item.attentionId ?? item.projectId}-${index}`} href={`/project/${encodeURIComponent(item.projectId)}`}>
                      <span>{titleCase(item.kind)}</span>
                      <strong>{item.title}</strong>
                      <p>{item.detail || item.projectTitle}</p>
                      <small>{item.farmName || "Feast Guild"} · {item.projectTitle}</small>
                    </Link>
                  ))}
                </div>
              ) : null}
              <div className={styles.projectList}>
                {filteredProjects.map((project) => {
                  const state = projectState(project);
                  return (
                    <Link key={project.projectId} href={`/project/${encodeURIComponent(project.projectId)}`} className={styles.projectCard}>
                      <div>
                        <span>{project.farmName || "Feast Guild"} · {titleCase(project.workstream)}</span>
                        <AtlasStateBadge state={state}>{stateLabel(state)}</AtlasStateBadge>
                      </div>
                      <strong>{project.title}</strong>
                      <p>{project.currentMilestone || project.outcome || "Open the project."}</p>
                      <small>{project.openTaskCount} open{project.targetDate ? ` · due ${prettyDate(project.targetDate)}` : ""}</small>
                    </Link>
                  );
                })}
              </div>
            </AtlasCard>
          ) : null}

          {!singleVisibleFarm && !showOwnerPortfolio ? (
            <AtlasCard as="section" id="scope-board" className={styles.detailSection} ariaLabelledBy="scope-board-title">
              <AtlasSectionHeading kicker="Bird's-eye view" title="Atlas Scope" count={visibleFarms.length} id="scope-board-title" />

              {(visibleFarms.length > 1 || workstreams.length > 1) ? (
                <div className={styles.filters} aria-label="Atlas scope filters">
                  {visibleFarms.length > 1 ? (
                    <div>
                      <span>Farm</span>
                      <Link href={filterHref(null, selectedWorkstream)} className={!selectedFarmKey ? styles.activeFilter : undefined}>All</Link>
                      {visibleFarms.map((farm) => (
                        <Link key={farm.farmId} href={filterHref(farm.farmKey, selectedWorkstream)} className={selectedFarmKey === farm.farmKey ? styles.activeFilter : undefined}>
                          {farm.farmName}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {workstreams.length > 1 ? (
                    <div>
                      <span>Workstream</span>
                      <Link href={filterHref(selectedFarmKey, null)} className={!selectedWorkstream ? styles.activeFilter : undefined}>All</Link>
                      {workstreams.map((workstream) => (
                        <Link key={workstream} href={filterHref(selectedFarmKey, workstream)} className={selectedWorkstream === workstream ? styles.activeFilter : undefined}>
                          {titleCase(workstream)}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className={styles.farmList}>
                {filteredFarms.map((farm) => {
                  const state = farmState(farm);
                  const scope = farm.scope;
                  return (
                    <AtlasCard key={farm.farmId} className={styles.farmCard} variant="cream">
                      <div className={styles.farmCardHeader}>
                        <div>
                          <span>{scope ? titleCase(scope.role) : "Project access"}</span>
                          <strong>{farm.farmName}</strong>
                        </div>
                        <AtlasStateBadge state={state}>{stateLabel(state)}</AtlasStateBadge>
                      </div>
                      <div className={styles.farmFacts}>
                        <span><b>{scope?.openTaskCount ?? 0}</b> open</span>
                        <span><b>{scope?.blockedTaskCount ?? 0}</b> blocked</span>
                        <span><b>{scope?.snapshot.growingBeds ?? 0}</b> beds</span>
                        <span><b>{farm.projectCount}</b> projects</span>
                      </div>
                      <div className={styles.farmLinks}>
                        {scope ? <Link href={farm.farmId === home.activeFarmId ? "/zones" : filterHref(farm.farmKey, selectedWorkstream)}>Open farm</Link> : null}
                        {farm.projectCount ? <Link href={filterHref(farm.farmKey, selectedWorkstream)}>Open projects</Link> : null}
                      </div>
                    </AtlasCard>
                  );
                })}
              </div>
            </AtlasCard>
          ) : null}
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
