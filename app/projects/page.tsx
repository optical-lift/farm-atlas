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
  return projects.filter((project) => project.status !== "paused" && project.portfolioType !== "incubator");
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

function FarmLandscape({ farm }: { farm: AtlasPortfolioFarm }) {
  const roots = rootsFor(farm.projects);
  const ownerNeeds = roots.filter((project) => projectOwnerCue(project) === "Needs Owner").length;
  return (
    <AtlasCard as="section" className="atlas-farm-landscape">
      <header className="atlas-farm-landscape-head">
        <div>
          <small>{farm.locationLabel || "Farm"}</small>
          <h2>{farm.farmName}</h2>
        </div>
        <Link href={`/projects?farm=${encodeURIComponent(farm.farmKey)}`}>View farm →</Link>
      </header>
      <div className="atlas-north-star">
        <span>North Star</span>
        <strong>{farm.northStar || "Define what this farm is becoming."}</strong>
      </div>
      <RealityLandscape projects={farm.projects} compact />
      <footer className="atlas-farm-landscape-foot">
        <span>{roots.length} active {roots.length === 1 ? "world" : "worlds"}</span>
        {ownerNeeds ? <b>{ownerNeeds} {ownerNeeds === 1 ? "needs Owner" : "need Owner"}</b> : <span>Nothing needs Owner at this level</span>}
      </footer>
    </AtlasCard>
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

  const calmProjects = activeProjects(allProjects);
  const calmChildren = childrenMap(calmProjects);
  const calmRoots = rootsFor(calmProjects);

  const selectedActive = selectedFarm ? activeProjects(selectedFarm.projects) : [];
  const selectedRoots = selectedFarm ? rootsFor(selectedFarm.projects) : [];
  const selectedChildren = selectedFarm ? childrenMap(selectedFarm.projects) : new Map<string, Project[]>();
  const selectedLater = selectedFarm ? sortProjects(selectedFarm.projects.filter((project) => project.status === "paused" || project.portfolioType === "incubator")) : [];
  const crossFarmActive = rootsFor(home.crossFarmProjects);

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
        .atlas-owner-intro { padding: 4px 2px 1px; }
        .atlas-owner-intro small { display: block; color: #8a84aa; font-size: 9px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
        .atlas-owner-intro h1 { margin: 4px 0 3px; font-size: 25px; line-height: 1.04; color: #303243; }
        .atlas-owner-intro p { margin: 0; color: #77776f; font-size: 11px; line-height: 1.45; font-weight: 700; }
        .atlas-farm-list { display: grid; gap: 12px; }
        .atlas-farm-landscape { padding: 17px; display: grid; gap: 14px; }
        .atlas-farm-landscape-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .atlas-farm-landscape-head small { color: #8881b7; font-size: 9px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
        .atlas-farm-landscape-head h2 { margin: 4px 0 0; color: #303243; font-size: 22px; line-height: 1; }
        .atlas-farm-landscape-head > a { color: #615c88; font-size: 10px; font-weight: 900; text-decoration: none; }
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
        .atlas-farm-landscape-foot { border-top: 1px solid rgba(88,87,111,.08); padding-top: 9px; display: flex; justify-content: space-between; gap: 8px; color: #77776f; font-size: 9px; font-weight: 850; }
        .atlas-farm-landscape-foot b { color: #9c6c65; }
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
                  <div className="atlas-owner-intro">
                    <small>Owner reality map</small>
                    <h1>Your farms</h1>
                    <p>See what is becoming true at each place without turning Projects into a task report.</p>
                  </div>
                  <div className="atlas-farm-list">{home.farms.map((farm) => <FarmLandscape key={farm.farmId} farm={farm} />)}</div>
                  {crossFarmActive.length ? (
                    <AtlasCard as="section" className="atlas-projects-section" ariaLabelledBy="atlas-cross-farm-title">
                      <AtlasSectionHeading title="Across the farms" count={crossFarmActive.length} id="atlas-cross-farm-title" />
                      {crossFarmActive.map((project) => (
                        <Link key={project.projectId} href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-cross-farm-card">
                          <span>{realityLabel(project.realityState)}</span>
                          <strong>{project.title}</strong>
                          <p>{project.outcome || project.currentMilestone || "Cross-farm world"}</p>
                        </Link>
                      ))}
                    </AtlasCard>
                  ) : null}
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
