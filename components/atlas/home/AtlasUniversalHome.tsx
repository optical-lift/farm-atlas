"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
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

function dateFromIso(value: string) {
  return new Date(`${value}T12:00:00`);
}

function isoFromDate(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(value: string) {
  return dateFromIso(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function overviewWindow(items: AtlasUniversalDatedItem[], todayIso: string) {
  const today = dateFromIso(todayIso);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndIso = isoFromDate(weekEnd);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12);
  const monthEndIso = isoFromDate(monthEnd);

  return {
    week: items.filter((item) => item.date >= todayIso && item.date <= weekEndIso),
    month: items.filter((item) => item.date >= todayIso && item.date <= monthEndIso),
    monthLabel: today.toLocaleDateString("en-US", { month: "long" }),
  };
}

function DateOverviewCard({
  title,
  summary,
  items,
}: {
  title: string;
  summary: string;
  items: AtlasUniversalDatedItem[];
}) {
  return (
    <AtlasCard className={styles.overviewCard}>
      <div className={styles.overviewHeading}>
        <strong>{title}</strong>
        <span>{summary}</span>
      </div>
      <div className={styles.overviewList}>
        {items.length ? items.slice(0, 4).map((item) => (
          <Link key={item.key} href={item.href}>
            <b>{item.title}</b>
            <small>{item.scopeLabel}</small>
            <em>{prettyDate(item.date)}</em>
          </Link>
        )) : <p>No dated items.</p>}
      </div>
    </AtlasCard>
  );
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
  const overview = useMemo(() => overviewWindow(home.datedItems, todayIso), [home.datedItems, todayIso]);
  const visibleFarms = useMemo(() => farmCards(home), [home]);
  const workstreams = home.organizationHome?.workstreams ?? [];
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

  const headerStatus = weatherLabel
    || `${home.metrics.movingCount} moving`;
  const filteredFarms = selectedFarmKey
    ? visibleFarms.filter((farm) => farm.farmKey === selectedFarmKey)
    : visibleFarms;
  const filteredProjects = home.projects.filter((project) => {
    if (selectedWorkstream && project.workstream !== selectedWorkstream) return false;
    if (!selectedFarmKey) return true;
    return project.farmKey === selectedFarmKey
      || project.targets.some((target) => target.farmId === filteredFarms[0]?.farmId);
  });

  return (
    <>
      <AtlasAppShell
        className="atlas-home-shell"
        data-atlas-home-portal="universal"
        data-atlas-has-farm-scope={home.viewer.hasFarmScope ? "true" : "false"}
        data-atlas-has-organization-scope={home.viewer.hasOrganizationScope ? "true" : "false"}
      >
        <AtlasTopBar
          title={home.title}
          status={<span className={styles.headerStatus}>{headerStatus}</span>}
          action={canDocumentActiveFarm ? (
            <button type="button" className={styles.addButton} aria-label="Document work" onClick={openFieldLog}>+</button>
          ) : home.projects.length ? (
            <Link href="#work-board" className={styles.addButton} aria-label="Open visible work">+</Link>
          ) : null}
        />

        <div className={styles.homeBody}>
          <AtlasCard variant="purple" className={styles.hero} ariaLabelledBy="atlas-today-title">
            <div className={styles.heroHeader}>
              <div>
                <span>Today</span>
                <strong id="atlas-today-title">{prettyDate(todayIso)}</strong>
              </div>
              <em>{home.metrics.openWorkCount} open</em>
            </div>
            {home.moves.length ? (
              <div className={styles.heroGrid}>
                {home.moves.map((move) => (
                  <Link key={move.key} href={move.href} className={styles.heroCard} data-atlas-state={move.state}>
                    <small>{move.category}</small>
                    <strong>{move.title}</strong>
                    <span>{move.scopeLabel} · {move.meta}</span>
                    <em>{move.detail}</em>
                  </Link>
                ))}
              </div>
            ) : (
              <div className={styles.heroEmpty}>
                <strong>No active move is waiting.</strong>
                <span>Open the scope board below to inspect farms and projects.</span>
              </div>
            )}
          </AtlasCard>

          <div className={styles.overviewPair} aria-label="Atlas date windows">
            <DateOverviewCard title="This Week" summary={`${overview.week.length} dated`} items={overview.week} />
            <DateOverviewCard title={overview.monthLabel} summary={`${overview.month.length} dated`} items={overview.month} />
          </div>

          <AtlasMetricStrip href="#scope-board" ariaLabel="Open Atlas scope board">
            <span><b>{home.metrics.farmCount}</b> farms</span>
            <span><b>{home.metrics.projectCount}</b> projects</span>
            <span><b>{home.metrics.openWorkCount}</b> open</span>
            <span><b>{home.metrics.attentionCount}</b> attention</span>
          </AtlasMetricStrip>

          <AtlasFooterActions>
            <Link href="#scope-board"><span>Farms</span><em>{home.metrics.farmCount} visible</em></Link>
            {home.projects.length ? (
              <Link href="#work-board"><span>Projects</span><em>{home.metrics.projectCount} active</em></Link>
            ) : (
              <Link href="/closeout"><span>Closeout</span><em>Review changes</em></Link>
            )}
          </AtlasFooterActions>

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
