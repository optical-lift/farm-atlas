import Link from "next/link";
import { redirect } from "next/navigation";

import {
  AtlasAppShell,
  AtlasCard,
  AtlasSectionHeading,
  AtlasTopBar,
} from "@/components/atlas/ui/AtlasPrimitives";
import {
  readAtlasPortfolioHome,
  type AtlasPortfolioFarm,
  type AtlasPortfolioProject,
  type AtlasRealityState,
} from "@/lib/atlas/portfolio";
import {
  readAtlasProjectsHomePriority,
  type AtlasProjectsHomeBlocker,
  type AtlasProjectsHomePriority,
} from "@/lib/atlas/projects-home-priority";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";

export const dynamic = "force-dynamic";

type Project = AtlasPortfolioProject;
type SearchParams = Record<string, string | string[] | undefined>;
type ProjectsPageProps = { searchParams?: Promise<SearchParams> };

const REALITY_STATES: Array<{ key: AtlasRealityState; label: string; short: string }> = [
  { key: "finding_shape", label: "Finding the shape", short: "Shape" },
  { key: "making_real", label: "Making it real", short: "Making" },
  { key: "closing_loop", label: "Closing the loop", short: "Closing" },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function projectTypeLabel(project: Project) {
  if (project.portfolioType === "side_quest") return "Quest";
  if (project.portfolioType === "event") return "Event";
  if (project.portfolioType === "program") return "Program";
  if (project.portfolioType === "incubator") return "Incubator";
  return "World";
}

function realityLabel(state: string | null | undefined) {
  return REALITY_STATES.find((item) => item.key === state)?.label ?? "Finding the shape";
}

function activeProjects(projects: Project[]) {
  return projects.filter((project) => project.status !== "paused" && project.status !== "archived" && project.portfolioType !== "incubator");
}

function sortProjects(projects: Project[]) {
  const rank = new Map<AtlasRealityState, number>(REALITY_STATES.map((state, index) => [state.key, index]));
  return [...projects].sort((left, right) =>
    (rank.get(left.realityState) ?? 0) - (rank.get(right.realityState) ?? 0)
    || (left.targetDate ?? "9999-12-31").localeCompare(right.targetDate ?? "9999-12-31")
    || left.title.localeCompare(right.title));
}

function projectOwnerCue(project: Project) {
  if (project.health === "waiting") return "Waiting";
  if (project.openAttentionCount > 0 || project.health === "at_risk" || project.health === "blocked") return "Needs Owner";
  if (project.targetDate) return `Hard date · ${prettyDate(project.targetDate)}`;
  return null;
}

function rootsFor(projects: Project[]) {
  const active = activeProjects(projects);
  const ids = new Set(active.map((project) => project.projectId));
  return sortProjects(active.filter((project) => !project.parentProjectId || !ids.has(project.parentProjectId)));
}

function childrenMap(projects: Project[]) {
  const active = activeProjects(projects);
  const ids = new Set(active.map((project) => project.projectId));
  const map = new Map<string, Project[]>();
  active.forEach((project) => {
    if (!project.parentProjectId || !ids.has(project.parentProjectId)) return;
    const children = map.get(project.parentProjectId) ?? [];
    children.push(project);
    map.set(project.parentProjectId, children);
  });
  return map;
}

function RealityLandscape({ projects, compact = false }: { projects: Project[]; compact?: boolean }) {
  const roots = rootsFor(projects);
  return (
    <div className={`atlas-reality-landscape${compact ? " atlas-reality-landscape-compact" : ""}`}>
      {REALITY_STATES.map((state) => {
        const inState = roots.filter((project) => project.realityState === state.key);
        return (
          <div key={state.key} className="atlas-reality-zone" data-state={state.key}>
            <div className="atlas-reality-zone-head"><span>{state.label}</span></div>
            <div className="atlas-reality-zone-track" aria-hidden="true" />
            <div className="atlas-reality-markers">
              {inState.map((project) => (
                <Link key={project.projectId} href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-reality-marker">
                  <strong>{project.title}</strong>
                  {projectOwnerCue(project) ? <small>{projectOwnerCue(project)}</small> : null}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      {roots.length === 0 ? <p className="atlas-reality-empty">No active worlds yet.</p> : null}
    </div>
  );
}

function QuestBranch({ project, childrenByParent, depth = 0 }: { project: Project; childrenByParent: Map<string, Project[]>; depth?: number }) {
  const children = sortProjects(childrenByParent.get(project.projectId) ?? []);
  return (
    <div className="atlas-quest-branch" data-depth={depth}>
      <Link href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-quest-card">
        <span>{realityLabel(project.realityState)}</span>
        <strong>{project.title}</strong>
        <p>{project.currentMilestone || project.outcome || "Open this quest."}</p>
      </Link>
      {children.length ? (
        <details className="atlas-quest-children">
          <summary>{children.length} deeper {children.length === 1 ? "quest" : "quests"}</summary>
          <div>{children.map((child) => <QuestBranch key={child.projectId} project={child} childrenByParent={childrenByParent} depth={depth + 1} />)}</div>
        </details>
      ) : null}
    </div>
  );
}

function WorldCard({ project, childrenByParent }: { project: Project; childrenByParent: Map<string, Project[]> }) {
  const children = sortProjects(childrenByParent.get(project.projectId) ?? []);
  const cue = projectOwnerCue(project);
  return (
    <article className="atlas-world-card" data-reality-state={project.realityState}>
      <Link href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-world-card-main">
        <div className="atlas-world-card-kicker">
          <span>{projectTypeLabel(project)} · {realityLabel(project.realityState)}</span>
          {cue ? <b>{cue}</b> : null}
        </div>
        <h3>{project.title}</h3>
        <p className="atlas-world-outcome">{project.outcome || "Define what becomes true when this world is complete."}</p>
        {project.currentMilestone ? <p className="atlas-world-current"><span>Now</span>{project.currentMilestone}</p> : null}
      </Link>
      {children.length ? (
        <details className="atlas-world-quests">
          <summary>{children.length} {children.length === 1 ? "quest" : "quests"}</summary>
          <div>{children.map((child) => <QuestBranch key={child.projectId} project={child} childrenByParent={childrenByParent} />)}</div>
        </details>
      ) : null}
    </article>
  );
}

function CalmProjectBranch({ project, childrenByParent, depth = 0 }: { project: Project; childrenByParent: Map<string, Project[]>; depth?: number }) {
  const children = sortProjects(childrenByParent.get(project.projectId) ?? []);
  return (
    <div className="atlas-project-calm-branch" data-project-depth={depth}>
      <Link href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-project-card-calm">
        <span>{projectTypeLabel(project)}</span>
        <strong>{project.title}</strong>
        <p>{project.currentMilestone || project.outcome || "Open the project."}</p>
      </Link>
      {children.length ? (
        <details className="atlas-project-calm-children">
          <summary>{children.length} {children.length === 1 ? "quest" : "quests"} inside</summary>
          <div>{children.map((child) => <CalmProjectBranch key={child.projectId} project={child} childrenByParent={childrenByParent} depth={depth + 1} />)}</div>
        </details>
      ) : null}
    </div>
  );
}

function blockerRootRank(projectId: string, priority: AtlasProjectsHomePriority | null) {
  if (!priority) return 999;
  if (priority.primaryBlocker?.rootProjectIds.includes(projectId)) return 0;
  const secondary = priority.secondaryBlockers.findIndex((blocker) => blocker.rootProjectIds.includes(projectId));
  return secondary >= 0 ? secondary + 1 : 999;
}

function sortHomeWorlds(projects: Project[], priority: AtlasProjectsHomePriority | null) {
  return [...rootsFor(projects)].sort((left, right) => {
    const blockerDifference = blockerRootRank(left.projectId, priority) - blockerRootRank(right.projectId, priority);
    if (blockerDifference) return blockerDifference;
    const cueRank = (project: Project) => {
      const cue = projectOwnerCue(project);
      if (cue === "Needs Owner") return 0;
      if (cue?.startsWith("Hard date")) return 1;
      if (project.health === "moving") return 2;
      if (project.health === "waiting") return 3;
      return 4;
    };
    return cueRank(left) - cueRank(right)
      || (left.targetDate ?? "9999-12-31").localeCompare(right.targetDate ?? "9999-12-31")
      || left.title.localeCompare(right.title);
  });
}

function MiniRealityTrail({ state }: { state: AtlasRealityState }) {
  const activeIndex = Math.max(0, REALITY_STATES.findIndex((item) => item.key === state));
  return (
    <div className="atlas-mini-reality" aria-label={realityLabel(state)}>
      <div className="atlas-mini-reality-track" aria-hidden="true">
        {REALITY_STATES.map((item, index) => (
          <span key={item.key} className="atlas-mini-reality-node" data-past={index < activeIndex} data-active={index === activeIndex} />
        ))}
      </div>
      <span>{realityLabel(state)}</span>
    </div>
  );
}

function HomeWorldCard({ project, questCount, priority }: { project: Project; questCount: number; priority: AtlasProjectsHomePriority | null }) {
  const primaryPath = priority?.primaryBlocker?.rootProjectIds.includes(project.projectId) ?? false;
  const secondaryPath = priority?.secondaryBlockers.some((blocker) => blocker.rootProjectIds.includes(project.projectId)) ?? false;
  const cue = projectOwnerCue(project);
  const nodeState = primaryPath ? "attention" : project.health === "waiting" ? "waiting" : "active";
  return (
    <div className="atlas-home-world-node" data-node-state={nodeState}>
      <Link href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-home-world-card">
        <div className="atlas-home-world-kicker">
          <span>{projectTypeLabel(project)}</span>
          {primaryPath ? <b>Needs you now</b> : secondaryPath ? <b>Owner path</b> : cue ? <b>{cue}</b> : null}
        </div>
        <strong>{project.title}</strong>
        <p>{project.currentMilestone || project.outcome || "Open this world."}</p>
        <footer>
          <MiniRealityTrail state={project.realityState} />
          {questCount ? <span>{questCount} {questCount === 1 ? "quest" : "quests"}</span> : null}
        </footer>
      </Link>
    </div>
  );
}

function FarmHomeLane({ farm, priority }: { farm: AtlasPortfolioFarm; priority: AtlasProjectsHomePriority | null }) {
  const roots = sortHomeWorlds(farm.projects, priority);
  const children = childrenMap(farm.projects);
  const laterCount = farm.projects.filter((project) => project.status === "paused" || project.portfolioType === "incubator").length;
  return (
    <section className="atlas-farm-home-lane" aria-labelledby={`farm-${farm.farmId}`}>
      <header className="atlas-farm-home-head">
        <div className="atlas-farm-home-heading">
          <span className="atlas-farm-home-anchor" aria-hidden="true" />
          <div>
            <small>{farm.locationLabel || "Farm"}</small>
            <h2 id={`farm-${farm.farmId}`}>{farm.farmName}</h2>
          </div>
        </div>
        <Link href={`/projects?farm=${encodeURIComponent(farm.farmKey)}`}>Open farm →</Link>
      </header>
      <p className="atlas-farm-home-north-star"><span>North Star</span>{farm.northStar || "Define what this farm is becoming."}</p>
      {roots.length ? (
        <div className="atlas-home-world-grid">
          {roots.map((project) => (
            <HomeWorldCard
              key={project.projectId}
              project={project}
              questCount={(children.get(project.projectId) ?? []).length}
              priority={priority}
            />
          ))}
        </div>
      ) : (
        <div className="atlas-home-world-empty">
          <span aria-hidden="true" />
          <div><strong>No active Worlds yet</strong>{laterCount ? <small>{laterCount} {laterCount === 1 ? "idea" : "ideas"} in incubator</small> : null}</div>
        </div>
      )}
    </section>
  );
}

function blockerSummary(blocker: AtlasProjectsHomeBlocker) {
  const parts: string[] = [];
  if (blocker.downstreamUnlockCount) parts.push(`unlocks ${blocker.downstreamUnlockCount} ${blocker.downstreamUnlockCount === 1 ? "move" : "moves"}`);
  if (blocker.blockedMembershipCount) parts.push(`${blocker.blockedMembershipCount} ${blocker.blockedMembershipCount === 1 ? "teammate" : "teammates"} waiting`);
  if (blocker.targetDate) parts.push(`hard date ${prettyDate(blocker.targetDate)}`);
  return parts.join(" · ");
}

function PrimaryBlocker({ priority }: { priority: AtlasProjectsHomePriority }) {
  const blocker = priority.primaryBlocker;
  if (!blocker) {
    return (
      <div className="atlas-project-priority-clear">
        <span aria-hidden="true" />
        <p><strong>No project blocker needs you right now.</strong><small>The farm lanes below stay ordered by consequence and current movement.</small></p>
      </div>
    );
  }
  return (
    <section className="atlas-project-priority" aria-labelledby="atlas-project-priority-title">
      <div className="atlas-project-priority-trail" aria-hidden="true"><span /><i /></div>
      <div className="atlas-project-priority-content">
        <Link href={`/task-focus/${encodeURIComponent(blocker.taskId)}?returnTo=${encodeURIComponent("/projects")}`} className="atlas-project-priority-card">
          <small>Needs you now</small>
          <h1 id="atlas-project-priority-title">{blocker.title}</h1>
          <p>{blocker.unlockText || blockerSummary(blocker) || "This Move is holding the highest-consequence active project path."}</p>
          <footer>
            <span>{blocker.farmName || "Across the farms"} · {blocker.projectTitle}</span>
            {blockerSummary(blocker) ? <b>{blockerSummary(blocker)}</b> : null}
          </footer>
        </Link>
        {priority.secondaryCount ? (
          <details className="atlas-project-priority-more">
            <summary>{priority.secondaryCount} other {priority.secondaryCount === 1 ? "thing needs" : "things need"} you</summary>
            <div>
              {priority.secondaryBlockers.map((item) => (
                <Link key={item.taskId} href={`/task-focus/${encodeURIComponent(item.taskId)}?returnTo=${encodeURIComponent("/projects")}`}>
                  <span>{item.farmName || "Across the farms"} · {item.projectTitle}</span>
                  <strong>{item.title}</strong>
                  <small>{blockerSummary(item)}</small>
                </Link>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function CrossFarmHomeLane({ projects, priority }: { projects: Project[]; priority: AtlasProjectsHomePriority | null }) {
  const roots = sortHomeWorlds(projects, priority);
  if (!roots.length) return null;
  const children = childrenMap(projects);
  return (
    <section className="atlas-farm-home-lane atlas-cross-home-lane" aria-labelledby="atlas-cross-farm-title">
      <header className="atlas-farm-home-head">
        <div className="atlas-farm-home-heading"><span className="atlas-farm-home-anchor" aria-hidden="true" /><div><small>Feast Guild</small><h2 id="atlas-cross-farm-title">Across the farms</h2></div></div>
      </header>
      <div className="atlas-home-world-grid">
        {roots.map((project) => <HomeWorldCard key={project.projectId} project={project} questCount={(children.get(project.projectId) ?? []).length} priority={priority} />)}
      </div>
    </section>
  );
}

export default async function AtlasProjectsPage({ searchParams }: ProjectsPageProps) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=membership_required");

  const organizationId = viewer.activeOrganizationId ?? viewer.organizationMemberships[0]?.organizationId ?? null;
  if (!organizationId) redirect("/auth/error?reason=organization_membership_required");

  const home = await readAtlasPortfolioHome(organizationId);
  const allProjects = [...home.crossFarmProjects, ...home.farms.flatMap((farm) => farm.projects)];
  const ownerMode = viewer.canManageAnyPortfolio;
  const farmHandMode = viewer.farmMemberships.some((membership) => membership.role === "farm_hand")
    && !viewer.canManageAnyFarm
    && !viewer.canManageAnyPortfolio;

  const query = searchParams ? await searchParams : {};
  const requestedFarm = firstParam(query.farm);
  const selectedFarm = ownerMode && requestedFarm
    ? home.farms.find((farm) => farm.farmKey === requestedFarm || farm.farmId === requestedFarm) ?? null
    : null;
  const homePriority = ownerMode && !selectedFarm
    ? await readAtlasProjectsHomePriority(home, session.userId).catch(() => ({ primaryBlocker: null, secondaryBlockers: [], secondaryCount: 0 }))
    : null;

  const calmProjects = activeProjects(allProjects);
  const calmChildren = childrenMap(calmProjects);
  const calmRoots = rootsFor(calmProjects);
  const selectedRoots = selectedFarm ? rootsFor(selectedFarm.projects) : [];
  const selectedChildren = selectedFarm ? childrenMap(selectedFarm.projects) : new Map<string, Project[]>();
  const selectedLater = selectedFarm ? sortProjects(selectedFarm.projects.filter((project) => project.status === "paused" || project.portfolioType === "incubator")) : [];

  return (
    <>
      <style>{`
        .atlas-projects-page { background: #fbf9f1; }
        .atlas-projects-body { padding: 14px; display: grid; gap: 14px; }
        .atlas-projects-section { padding: 16px; display: grid; gap: 13px; }
        .atlas-scope-tabs { display: flex; gap: 7px; overflow-x: auto; padding: 1px 1px 3px; scrollbar-width: none; }
        .atlas-scope-tabs::-webkit-scrollbar { display: none; }
        .atlas-scope-tabs a { white-space: nowrap; text-decoration: none; color: #646078; border: 1px solid rgba(88,87,111,.14); background: rgba(255,253,247,.75); border-radius: 999px; padding: 8px 11px; font-size: 10px; font-weight: 900; }
        .atlas-scope-tabs a[aria-current="page"] { background: #313348; color: #fffdf7; border-color: #313348; }
        .atlas-project-priority { display: grid; grid-template-columns: 20px minmax(0,1fr); gap: 7px; align-items: stretch; }
        .atlas-project-priority-trail { position: relative; display: flex; justify-content: center; }
        .atlas-project-priority-trail span { position: absolute; top: 13px; width: 10px; height: 10px; border-radius: 999px; background: #9a6962; box-shadow: 0 0 0 4px #fbf9f1; }
        .atlas-project-priority-trail i { width: 2px; margin-top: 21px; background: rgba(117,113,157,.3); border-radius: 99px; }
        .atlas-project-priority-content { min-width: 0; display: grid; gap: 7px; }
        .atlas-project-priority-card { display: block; text-decoration: none; border: 1px solid rgba(154,105,98,.24); border-radius: 18px; background: #fffaf2; color: #303243; padding: 16px; box-shadow: 0 5px 14px rgba(55,50,55,.04); }
        .atlas-project-priority-card > small { color: #9a6962; font-size: 8px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
        .atlas-project-priority-card h1 { margin: 5px 0 0; font-size: 21px; line-height: 1.04; }
        .atlas-project-priority-card > p { margin: 7px 0 0; color: #65665f; font-size: 11px; line-height: 1.4; font-weight: 720; }
        .atlas-project-priority-card footer { margin-top: 11px; padding-top: 9px; border-top: 1px solid rgba(154,105,98,.11); display: grid; gap: 3px; }
        .atlas-project-priority-card footer span { color: #7d7896; font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: .055em; }
        .atlas-project-priority-card footer b { color: #8d645e; font-size: 9px; }
        .atlas-project-priority-more > summary { cursor: pointer; color: #68638c; font-size: 9px; font-weight: 900; list-style-position: inside; padding: 2px 4px; }
        .atlas-project-priority-more > div { display: grid; gap: 6px; margin-top: 6px; }
        .atlas-project-priority-more a { display: block; text-decoration: none; border-left: 2px solid rgba(139,145,194,.28); padding: 7px 9px; color: #363748; background: rgba(255,253,247,.62); }
        .atlas-project-priority-more a span, .atlas-project-priority-more a small { display: block; color: #8580a4; font-size: 7px; font-weight: 850; }
        .atlas-project-priority-more a strong { display: block; margin: 2px 0; font-size: 11px; }
        .atlas-project-priority-clear { display: grid; grid-template-columns: 20px minmax(0,1fr); gap: 7px; align-items: center; }
        .atlas-project-priority-clear > span { justify-self: center; width: 9px; height: 9px; border: 2px solid #aaa6c4; border-radius: 999px; }
        .atlas-project-priority-clear p { margin: 0; padding: 10px 12px; border-radius: 14px; background: rgba(255,253,247,.55); }
        .atlas-project-priority-clear strong, .atlas-project-priority-clear small { display: block; }
        .atlas-project-priority-clear strong { color: #4a4a5a; font-size: 11px; }
        .atlas-project-priority-clear small { margin-top: 2px; color: #85857d; font-size: 8px; }
        .atlas-farm-home-lane { border-top: 1px solid rgba(88,87,111,.09); padding-top: 14px; display: grid; gap: 9px; }
        .atlas-farm-home-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
        .atlas-farm-home-heading { display: grid; grid-template-columns: 20px minmax(0,1fr); gap: 7px; align-items: center; }
        .atlas-farm-home-anchor { justify-self: center; width: 10px; height: 10px; border-radius: 999px; background: #77719d; box-shadow: 0 0 0 4px #fbf9f1; }
        .atlas-farm-home-heading small { color: #8881b7; font-size: 8px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
        .atlas-farm-home-heading h2 { margin: 2px 0 0; color: #303243; font-size: 20px; line-height: 1; }
        .atlas-farm-home-head > a { color: #615c88; font-size: 9px; font-weight: 900; text-decoration: none; padding-top: 4px; }
        .atlas-farm-home-north-star { margin: 0 0 0 27px; color: #66675f; font-family: Georgia,serif; font-size: 11px; line-height: 1.35; }
        .atlas-farm-home-north-star span { display: block; margin-bottom: 2px; color: #9993b5; font-family: system-ui,sans-serif; font-size: 7px; font-weight: 950; letter-spacing: .09em; text-transform: uppercase; }
        .atlas-home-world-grid { position: relative; margin-left: 9px; padding: 4px 0 2px 18px; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
        .atlas-home-world-grid::before { content: ""; position: absolute; left: 5px; top: -7px; bottom: 9px; width: 2px; background: rgba(119,113,157,.22); border-radius: 99px; }
        .atlas-home-world-node { position: relative; min-width: 0; }
        .atlas-home-world-node::before { content: ""; position: absolute; z-index: 2; left: -17px; top: 15px; width: 8px; height: 8px; border-radius: 999px; background: #77719d; border: 2px solid #fbf9f1; }
        .atlas-home-world-node::after { content: ""; position: absolute; left: -13px; top: 18px; width: 13px; height: 2px; background: rgba(119,113,157,.22); }
        .atlas-home-world-node[data-node-state="attention"]::before { background: #9a6962; }
        .atlas-home-world-node[data-node-state="waiting"]::before { background: #fbf9f1; border-color: #aaa6c4; }
        .atlas-home-world-card { height: 100%; display: flex; flex-direction: column; text-decoration: none; border: 1px solid rgba(88,87,111,.11); border-radius: 14px; background: #fffdf7; color: #303243; padding: 11px; min-width: 0; }
        .atlas-home-world-node[data-node-state="attention"] .atlas-home-world-card { border-color: rgba(154,105,98,.25); background: #fffbf4; }
        .atlas-home-world-kicker { display: flex; gap: 4px; align-items: flex-start; justify-content: space-between; min-height: 13px; }
        .atlas-home-world-kicker span { color: #8d87aa; font-size: 7px; font-weight: 950; letter-spacing: .07em; text-transform: uppercase; }
        .atlas-home-world-kicker b { color: #986960; font-size: 7px; text-align: right; }
        .atlas-home-world-card > strong { display: block; margin-top: 5px; font-size: 14px; line-height: 1.08; overflow-wrap: anywhere; }
        .atlas-home-world-card > p { flex: 1; margin: 5px 0 0; color: #74756e; font-size: 9px; line-height: 1.32; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .atlas-home-world-card footer { margin-top: 9px; padding-top: 7px; border-top: 1px solid rgba(88,87,111,.07); display: flex; align-items: flex-end; justify-content: space-between; gap: 6px; }
        .atlas-home-world-card footer > span { color: #77728f; font-size: 7px; font-weight: 900; white-space: nowrap; }
        .atlas-mini-reality { min-width: 0; display: grid; gap: 3px; }
        .atlas-mini-reality > span { color: #817c9f; font-size: 7px; font-weight: 850; }
        .atlas-mini-reality-track { display: flex; align-items: center; width: 52px; }
        .atlas-mini-reality-node { position: relative; width: 7px; height: 7px; flex: 0 0 7px; border-radius: 999px; border: 1.5px solid #aaa6c4; background: #fffdf7; }
        .atlas-mini-reality-node:not(:last-child) { margin-right: 15px; }
        .atlas-mini-reality-node:not(:last-child)::after { content: ""; position: absolute; left: 6px; top: 2px; width: 16px; height: 1.5px; background: #d5d2df; }
        .atlas-mini-reality-node[data-past="true"], .atlas-mini-reality-node[data-active="true"] { background: #77719d; border-color: #77719d; }
        .atlas-mini-reality-node[data-past="true"]::after { background: #77719d; }
        .atlas-mini-reality-node[data-active="true"] { box-shadow: 0 0 0 2px rgba(119,113,157,.12); }
        .atlas-home-world-empty { position: relative; margin-left: 14px; padding: 7px 0 5px 22px; border-left: 2px solid rgba(119,113,157,.18); color: #6f706a; }
        .atlas-home-world-empty > span { position: absolute; left: -6px; top: 12px; width: 10px; height: 10px; border: 2px solid #aaa6c4; border-radius: 999px; background: #fbf9f1; }
        .atlas-home-world-empty strong, .atlas-home-world-empty small { display: block; }
        .atlas-home-world-empty strong { font-size: 11px; }
        .atlas-home-world-empty small { margin-top: 2px; color: #8d889f; font-size: 8px; }
        .atlas-cross-home-lane { padding-bottom: 4px; }
        .atlas-north-star { border-left: 3px solid rgba(139,145,194,.45); padding-left: 11px; }
        .atlas-north-star span { display: block; color: #8c86ad; font-size: 8px; font-weight: 950; letter-spacing: .11em; text-transform: uppercase; }
        .atlas-north-star strong { display: block; margin-top: 4px; color: #3a3b4f; font-size: 14px; line-height: 1.3; font-family: Georgia, serif; font-weight: 600; }
        .atlas-reality-landscape { position: relative; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 7px; padding-top: 2px; }
        .atlas-reality-zone { min-width: 0; position: relative; }
        .atlas-reality-zone-head { min-height: 22px; color: #827da2; font-size: 8px; font-weight: 950; line-height: 1.1; text-transform: uppercase; letter-spacing: .055em; }
        .atlas-reality-zone-track { height: 2px; background: rgba(111,108,135,.16); margin: 3px 0 8px; }
        .atlas-reality-zone:first-child .atlas-reality-zone-track { border-radius: 99px 0 0 99px; }
        .atlas-reality-zone:last-child .atlas-reality-zone-track { border-radius: 0 99px 99px 0; }
        .atlas-reality-markers { display: grid; gap: 5px; }
        .atlas-reality-marker { min-width: 0; text-decoration: none; border: 1px solid rgba(88,87,111,.12); background: #fffdf7; border-radius: 10px; padding: 7px; color: #393a4d; }
        .atlas-reality-marker strong { display: block; font-size: 9px; line-height: 1.18; overflow-wrap: anywhere; }
        .atlas-reality-marker small { display: block; margin-top: 4px; color: #9c6c65; font-size: 7px; font-weight: 900; }
        .atlas-reality-empty { grid-column: 1 / -1; margin: 2px 0 0; color: #8a8a82; font-size: 10px; font-weight: 750; }
        .atlas-farm-horizon { padding: 18px; display: grid; gap: 14px; }
        .atlas-farm-horizon-head small { color: #8881b7; font-size: 9px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
        .atlas-farm-horizon-head h1 { margin: 4px 0 0; font-size: 26px; line-height: 1; color: #303243; }
        .atlas-farm-horizon .atlas-north-star strong { font-size: 18px; }
        .atlas-world-list { display: grid; gap: 10px; }
        .atlas-world-card { border: 1px solid rgba(88,87,111,.12); border-radius: 17px; background: #fffdf7; overflow: hidden; }
        .atlas-world-card-main { display: block; padding: 15px; color: #303243; text-decoration: none; }
        .atlas-world-card-kicker { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .atlas-world-card-kicker span { color: #8580a5; font-size: 8px; font-weight: 950; letter-spacing: .075em; text-transform: uppercase; }
        .atlas-world-card-kicker b { color: #9a6962; font-size: 8px; white-space: nowrap; }
        .atlas-world-card h3 { margin: 7px 0 0; font-size: 20px; line-height: 1.05; }
        .atlas-world-outcome { margin: 7px 0 0; color: #666861; font-family: Georgia, serif; font-size: 13px; line-height: 1.4; }
        .atlas-world-current { margin: 10px 0 0; color: #74756f; font-size: 10px; line-height: 1.35; font-weight: 750; }
        .atlas-world-current span { display: block; margin-bottom: 2px; color: #8c86ad; font-size: 7px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
        .atlas-world-quests { border-top: 1px solid rgba(88,87,111,.08); }
        .atlas-world-quests > summary, .atlas-quest-children > summary { cursor: pointer; padding: 10px 15px; color: #655f8c; font-size: 9px; font-weight: 900; list-style-position: inside; }
        .atlas-world-quests > div { display: grid; gap: 7px; padding: 0 11px 11px; }
        .atlas-quest-branch { display: grid; gap: 5px; }
        .atlas-quest-card { text-decoration: none; background: rgba(249,247,240,.75); border-radius: 12px; padding: 11px; color: #3b3c4e; }
        .atlas-quest-card > span { color: #8c86ad; font-size: 7px; font-weight: 950; letter-spacing: .07em; text-transform: uppercase; }
        .atlas-quest-card > strong { display: block; margin-top: 4px; font-size: 13px; }
        .atlas-quest-card > p { margin: 4px 0 0; color: #74756f; font-size: 9px; line-height: 1.35; font-weight: 700; }
        .atlas-quest-children { margin-left: 7px; border-left: 2px solid rgba(139,145,194,.16); }
        .atlas-quest-children > div { display: grid; gap: 6px; padding: 0 0 6px 8px; }
        .atlas-cross-farm-card { text-decoration: none; color: #303243; border: 1px solid rgba(88,87,111,.12); border-radius: 14px; background: #fffdf7; padding: 13px; }
        .atlas-cross-farm-card span { color: #8881b7; font-size: 8px; font-weight: 950; text-transform: uppercase; letter-spacing: .08em; }
        .atlas-cross-farm-card strong { display: block; margin-top: 5px; font-size: 15px; }
        .atlas-cross-farm-card p { margin: 5px 0 0; color: #73746d; font-size: 10px; line-height: 1.35; }
        .atlas-later { border-top: 1px solid rgba(88,87,111,.09); padding-top: 9px; }
        .atlas-later > summary { cursor: pointer; color: #655f8c; font-size: 10px; font-weight: 900; }
        .atlas-later > div { display: grid; gap: 7px; margin-top: 9px; }
        .atlas-project-card-calm { display: block; text-decoration: none; border: 1px solid rgba(88,87,111,.11); background: #fffdf7; border-radius: 15px; padding: 14px; color: #303243; }
        .atlas-project-card-calm > span { color: #8881b7; font-size: 8px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
        .atlas-project-card-calm > strong { display: block; margin-top: 5px; font-size: 17px; }
        .atlas-project-card-calm > p { margin: 6px 0 0; color: #73746d; font-size: 10px; line-height: 1.35; font-weight: 700; }
        .atlas-project-calm-branch { display: grid; gap: 6px; }
        .atlas-project-calm-children { margin: 0 6px; }
        .atlas-project-calm-children > summary { cursor: pointer; color: #67638f; font-size: 9px; font-weight: 900; }
        .atlas-project-calm-children > div { display: grid; gap: 7px; margin: 6px 0 0 8px; padding-left: 9px; border-left: 2px solid rgba(139,145,194,.17); }
        .atlas-projects-empty { margin: 0; color: #72736d; font-size: 12px; font-weight: 750; }
        @media (max-width: 340px) { .atlas-home-world-grid { grid-template-columns: 1fr; } }
        @media (max-width: 380px) {
          .atlas-reality-zone-head { font-size: 7px; }
          .atlas-reality-marker { padding: 6px; }
          .atlas-reality-marker strong { font-size: 8px; }
        }
      `}</style>
      <AtlasAppShell className="atlas-projects-shell" frameClassName="atlas-projects-page">
        <AtlasTopBar title="Projects" />
        <div className="atlas-projects-body">
          {ownerMode ? (
            <>
              <nav className="atlas-scope-tabs" aria-label="Project farm scope">
                <Link href="/projects" aria-current={!selectedFarm ? "page" : undefined}>All Farms</Link>
                {home.farms.map((farm) => (
                  <Link key={farm.farmId} href={`/projects?farm=${encodeURIComponent(farm.farmKey)}`} aria-current={selectedFarm?.farmId === farm.farmId ? "page" : undefined}>{farm.farmName.replace(" Farm", "")}</Link>
                ))}
              </nav>

              {!selectedFarm ? (
                <>
                  <PrimaryBlocker priority={homePriority ?? { primaryBlocker: null, secondaryBlockers: [], secondaryCount: 0 }} />
                  {home.farms.map((farm) => <FarmHomeLane key={farm.farmId} farm={farm} priority={homePriority} />)}
                  <CrossFarmHomeLane projects={home.crossFarmProjects} priority={homePriority} />
                </>
              ) : (
                <>
                  <AtlasCard as="section" className="atlas-farm-horizon">
                    <header className="atlas-farm-horizon-head"><small>{selectedFarm.locationLabel || "Farm"}</small><h1>{selectedFarm.farmName}</h1></header>
                    <div className="atlas-north-star"><span>North Star</span><strong>{selectedFarm.northStar || "Define what this farm is becoming."}</strong></div>
                    <RealityLandscape projects={selectedFarm.projects} />
                  </AtlasCard>

                  <AtlasCard as="section" className="atlas-projects-section" ariaLabelledBy="atlas-worlds-title">
                    <AtlasSectionHeading title="Worlds" count={selectedRoots.length} id="atlas-worlds-title" />
                    {selectedRoots.length ? <div className="atlas-world-list">{selectedRoots.map((project) => <WorldCard key={project.projectId} project={project} childrenByParent={selectedChildren} />)}</div> : <p className="atlas-projects-empty">No active worlds yet. This farm can stay quiet until there is a real outcome to move.</p>}
                    {selectedLater.length ? (
                      <details className="atlas-later">
                        <summary>Later at {selectedFarm.farmName} · {selectedLater.length}</summary>
                        <div>{selectedLater.map((project) => <Link key={project.projectId} href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-cross-farm-card"><span>Later</span><strong>{project.title}</strong><p>{project.outcome || project.currentMilestone || "Held outside the current field of play."}</p></Link>)}</div>
                      </details>
                    ) : null}
                  </AtlasCard>
                </>
              )}
            </>
          ) : (
            <AtlasCard as="section" className="atlas-projects-section" ariaLabelledBy="atlas-project-list-title">
              <AtlasSectionHeading title={farmHandMode ? "Your worlds" : "Contributed worlds"} count={calmRoots.length} id="atlas-project-list-title" />
              {calmRoots.length ? <div className="atlas-world-list">{calmRoots.map((project) => <CalmProjectBranch key={project.projectId} project={project} childrenByParent={calmChildren} />)}</div> : <p className="atlas-projects-empty">No active projects are visible in this account view.</p>}
            </AtlasCard>
          )}
        </div>
      </AtlasAppShell>
    </>
  );
}
