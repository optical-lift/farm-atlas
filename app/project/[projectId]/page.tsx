import Link from "next/link";
import { notFound } from "next/navigation";

import ProjectRealityStateControl from "@/components/atlas/portfolio/ProjectRealityStateControl";
import ProjectReviewPanel from "@/components/atlas/portfolio/ProjectReviewPanel";
import ProjectTaskTools from "@/components/atlas/portfolio/ProjectTaskTools";
import {
  readAtlasProjectDetail,
  type AtlasPortfolioProject,
  type AtlasProjectDetail,
  type AtlasProjectTask,
  type AtlasRealityState,
} from "@/lib/atlas/portfolio";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { requireAtlasUniversalViewer } from "@/lib/atlas/viewer-context";

export const dynamic = "force-dynamic";

type ProjectSearchParams = Record<string, string | string[] | undefined>;
type ProjectPageProps = { params: Promise<{ projectId: string }>; searchParams?: Promise<ProjectSearchParams> };

type PullItem = {
  id: string;
  title: string;
  note: string | null;
  status: string;
  preferred_membership_id: string | null;
  expected_active_minutes: number;
  physical_load: string;
  environment: string;
  priority: string;
  active_task_id: string | null;
};

type MembershipLane = { id: string; role: string };

const REALITY_STATES: Array<{ key: AtlasRealityState; label: string }> = [
  { key: "finding_shape", label: "Finding the shape" },
  { key: "making_real", label: "Making it real" },
  { key: "closing_loop", label: "Closing the loop" },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function realityLabel(state: string) {
  return REALITY_STATES.find((item) => item.key === state)?.label ?? "Finding the shape";
}

function projectCondition(project: AtlasPortfolioProject) {
  if (project.health === "waiting") return "Waiting";
  if (project.health === "blocked" || project.health === "at_risk" || project.openAttentionCount > 0) return "Needs Owner";
  if (project.targetDate) return `Hard date · ${prettyDate(project.targetDate)}`;
  return null;
}

async function readFinishReservoir(projectId: string) {
  const [{ data: items, error: itemError }, { data: memberships, error: membershipError }] = await Promise.all([
    atlasSupabase
      .schema("atlas")
      .from("project_pull_items")
      .select("id,title,note,status,preferred_membership_id,expected_active_minutes,physical_load,environment,priority,active_task_id")
      .eq("project_id", projectId)
      .order("status", { ascending: true })
      .order("priority", { ascending: true })
      .order("expected_active_minutes", { ascending: true }),
    atlasSupabase.schema("atlas").from("farm_memberships").select("id,role").eq("active", true),
  ]);
  if (itemError) throw new Error(itemError.message);
  if (membershipError) throw new Error(membershipError.message);
  const lanes = new Map(((memberships ?? []) as MembershipLane[]).map((row) => [row.id, row.role]));
  return ((items ?? []) as PullItem[]).map((item) => ({ ...item, role: item.preferred_membership_id ? lanes.get(item.preferred_membership_id) ?? "worker" : "shared" }));
}

function FinishReservoir({ items, projectId }: { items: Array<PullItem & { role: string }>; projectId: string }) {
  const active = items.filter((item) => item.status === "selected" && item.active_task_id);
  const available = items.filter((item) => item.status === "available");
  const completed = items.filter((item) => item.status === "completed");
  const farmHand = available.filter((item) => item.role === "farm_hand" || item.role === "shared");
  const management = available.filter((item) => item.role !== "farm_hand" && item.role !== "shared");

  return (
    <section className="atlas-reality-panel atlas-reservoir-panel">
      <header><div><small>Finish Elm reservoir</small><h2>Held work</h2></div><span>{available.length} waiting</span></header>
      <p className="atlas-panel-intro">The backlog lives here without becoming a daily failure list. Atlas releases bounded Moves into the day.</p>
      {active.length ? <div className="atlas-move-list">{active.map((item) => (
        <Link key={item.id} href={`/task-focus/${encodeURIComponent(item.active_task_id!)}?returnTo=${encodeURIComponent(`/project/${projectId}`)}`} className="atlas-move-card">
          <span>Released now · {item.expected_active_minutes} min</span><strong>{item.title}</strong>{item.note ? <p>{item.note}</p> : null}
        </Link>
      ))}</div> : null}
      <details className="atlas-project-more"><summary>Anna-ready work · {farmHand.length}</summary><div>{farmHand.map((item) => <article key={item.id}><span>{item.expected_active_minutes} min · {titleCase(item.environment)}</span><strong>{item.title}</strong></article>)}</div></details>
      {management.length ? <details className="atlas-project-more"><summary>Owner / Marshall work · {management.length}</summary><div>{management.map((item) => <article key={item.id}><span>{item.expected_active_minutes} min · {titleCase(item.physical_load)}</span><strong>{item.title}</strong></article>)}</div></details> : null}
      <small className="atlas-reservoir-foot">{available.length} held · {active.length} released · {completed.length} completed</small>
    </section>
  );
}

function QuestCard({ project }: { project: AtlasPortfolioProject }) {
  const cue = projectCondition(project);
  return (
    <Link href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-quest-card">
      <div><span>{realityLabel(project.realityState)}</span>{cue ? <b>{cue}</b> : null}</div>
      <strong>{project.title}</strong>
      <p>{project.outcome || project.currentMilestone || "Open this quest."}</p>
    </Link>
  );
}

function MoveCard({ task, projectId }: { task: AtlasProjectTask; projectId: string }) {
  return (
    <Link href={`/task-focus/${encodeURIComponent(task.taskId)}?returnTo=${encodeURIComponent(`/project/${projectId}`)}`} className="atlas-move-card">
      <span>{task.status === "blocked" ? "Waiting" : task.assigneeName || "Move"}{task.dueDate ? ` · ${prettyDate(task.dueDate)}` : ""}</span>
      <strong>{task.title}</strong>
      {task.blockerText ? <p>{task.blockerText}</p> : task.note ? <p>{task.note}</p> : null}
    </Link>
  );
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const viewer = await requireAtlasUniversalViewer();
  const { projectId } = await params;
  const query: ProjectSearchParams = searchParams ? await searchParams : {};
  const selectedTaskId = firstParam(query.taskId);

  let detail: AtlasProjectDetail;
  try {
    detail = await readAtlasProjectDetail(projectId);
  } catch {
    notFound();
  }

  const project = detail.project;
  const projectScopeName = project.farmName || "Across the farms";
  const isFinishReservoir = project.projectKey === "elm_finish_renovation_pool";
  const reservoirItems = isFinishReservoir ? await readFinishReservoir(projectId).catch(() => []) : [];
  const activeTasks = detail.tasks.filter((task) => task.status === "open" || task.status === "blocked");
  const children = (detail.children ?? []).filter((child) => child.status !== "archived");
  const condition = projectCondition(project);
  const currentStateIndex = Math.max(0, REALITY_STATES.findIndex((state) => state.key === project.realityState));
  const path = project.projectPath?.length ? project.projectPath : [project];
  const parentPath = path.filter((node) => node.projectId !== project.projectId);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <style>{`
        .atlas-project-reality-body { padding: 14px; display: grid; gap: 13px; background: #fbf9f1; }
        .atlas-project-breadcrumbs { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; color: #7d7897; font-size: 9px; font-weight: 850; }
        .atlas-project-breadcrumbs a { color: inherit; text-decoration: none; }
        .atlas-project-breadcrumbs i { opacity: .45; font-style: normal; }
        .atlas-project-horizon, .atlas-reality-panel { border: 1px solid rgba(88,87,111,.12); border-radius: 18px; background: #fffdf7; padding: 17px; color: #303243; }
        .atlas-project-horizon-kicker { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .atlas-project-horizon-kicker span { color: #8781a7; font-size: 8px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
        .atlas-project-horizon-kicker b { color: #9a6962; font-size: 8px; }
        .atlas-project-horizon h1 { margin: 8px 0 0; font-size: 27px; line-height: 1.02; }
        .atlas-project-outcome { margin: 10px 0 0; color: #62645e; font-family: Georgia, serif; font-size: 15px; line-height: 1.45; }
        .atlas-reality-steps { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; margin-top: 17px; }
        .atlas-reality-step { position: relative; padding-top: 10px; color: #96928d; font-size: 8px; font-weight: 900; line-height: 1.15; text-transform: uppercase; letter-spacing: .04em; }
        .atlas-reality-step::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: rgba(105,102,126,.13); }
        .atlas-reality-step[data-past="true"]::before, .atlas-reality-step[data-active="true"]::before { background: #77719d; }
        .atlas-reality-step[data-active="true"] { color: #575374; }
        .atlas-reality-reason { margin: 11px 0 0; color: #777870; font-size: 10px; line-height: 1.4; font-weight: 700; }
        .atlas-reality-panel { display: grid; gap: 11px; }
        .atlas-reality-panel > header { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
        .atlas-reality-panel > header small { color: #8983a8; font-size: 8px; font-weight: 950; letter-spacing: .09em; text-transform: uppercase; }
        .atlas-reality-panel > header h2 { margin: 4px 0 0; font-size: 19px; line-height: 1.05; }
        .atlas-reality-panel > header > span { color: #77728f; font-size: 9px; font-weight: 900; }
        .atlas-next-truth { margin: 0; color: #4c4e49; font-family: Georgia, serif; font-size: 16px; line-height: 1.42; }
        .atlas-panel-intro { margin: 0; color: #777870; font-size: 10px; line-height: 1.45; font-weight: 700; }
        .atlas-quest-grid, .atlas-move-list { display: grid; gap: 8px; }
        .atlas-quest-card, .atlas-move-card { display: block; text-decoration: none; border: 1px solid rgba(88,87,111,.09); border-radius: 13px; background: rgba(250,248,241,.82); padding: 11px; color: #37384a; }
        .atlas-quest-card > div { display: flex; justify-content: space-between; gap: 7px; }
        .atlas-quest-card span, .atlas-move-card span, .atlas-project-more article span { color: #8a84a7; font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: .045em; }
        .atlas-quest-card b { color: #9a6962; font-size: 8px; }
        .atlas-quest-card > strong, .atlas-move-card > strong, .atlas-project-more article strong { display: block; margin-top: 4px; font-size: 13px; line-height: 1.2; }
        .atlas-quest-card > p, .atlas-move-card > p { margin: 5px 0 0; color: #74756f; font-size: 9px; line-height: 1.35; }
        .atlas-project-more { border-top: 1px solid rgba(88,87,111,.08); padding-top: 9px; }
        .atlas-project-more > summary { cursor: pointer; color: #625e84; font-size: 9px; font-weight: 900; }
        .atlas-project-more > div { display: grid; gap: 6px; margin-top: 8px; }
        .atlas-project-more article { border-top: 1px solid rgba(88,87,111,.07); padding: 8px 2px; }
        .atlas-owner-attention { border-left: 3px solid rgba(181,122,111,.48); }
        .atlas-owner-attention article { padding: 7px 0; border-top: 1px solid rgba(88,87,111,.07); }
        .atlas-owner-attention article:first-of-type { border-top: 0; }
        .atlas-owner-attention article strong { display: block; font-size: 12px; }
        .atlas-owner-attention article p { margin: 4px 0 0; color: #777870; font-size: 9px; line-height: 1.35; }
        .atlas-reservoir-foot { color: #858079; font-size: 9px; font-weight: 800; }
        .atlas-project-controls > summary { cursor: pointer; color: #625e84; font-size: 10px; font-weight: 900; padding: 2px; }
        .atlas-project-controls > div { margin-top: 9px; }
      `}</style>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/projects" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Projects</span></Link>
          <span className="atlas-weather-line">{projectScopeName}</span>
          <Link href="/projects" className="atlas-note-plus" aria-label="Back to Projects">↩</Link>
        </header>

        <div className="atlas-project-reality-body">
          <nav className="atlas-project-breadcrumbs" aria-label="Project path">
            <Link href={project.farmKey ? `/projects?farm=${encodeURIComponent(project.farmKey)}` : "/projects"}>{projectScopeName}</Link>
            {parentPath.map((node) => <span key={node.projectId}><i>›</i> <Link href={`/project/${encodeURIComponent(node.projectId)}`}>{node.title}</Link></span>)}
          </nav>

          <section className="atlas-project-horizon">
            <div className="atlas-project-horizon-kicker"><span>{titleCase(project.portfolioType)} · {realityLabel(project.realityState)}</span>{condition ? <b>{condition}</b> : null}</div>
            <h1>{project.title}</h1>
            {project.outcome ? <p className="atlas-project-outcome">{project.outcome}</p> : null}
            <div className="atlas-reality-steps" aria-label={`Reality state: ${realityLabel(project.realityState)}`}>
              {REALITY_STATES.map((state, index) => <div key={state.key} className="atlas-reality-step" data-active={index === currentStateIndex} data-past={index < currentStateIndex}>{state.label}</div>)}
            </div>
            {project.realityStateReason ? <p className="atlas-reality-reason">{project.realityStateReason}</p> : null}
            {detail.permissions.isOrganizationOwner ? <ProjectRealityStateControl projectId={project.projectId} currentState={project.realityState} currentReason={project.realityStateReason} /> : null}
          </section>

          <section className="atlas-reality-panel">
            <header><div><small>Next truth</small><h2>What has to become true next</h2></div></header>
            <p className="atlas-next-truth">{project.currentMilestone || "Define the next observable condition this world needs."}</p>
          </section>

          {children.length ? (
            <section className="atlas-reality-panel">
              <header><div><small>Inside this world</small><h2>Quests</h2></div><span>{children.length}</span></header>
              <div className="atlas-quest-grid">{children.map((child) => <QuestCard key={child.projectId} project={child} />)}</div>
            </section>
          ) : null}

          <section className="atlas-reality-panel">
            <header><div><small>Execution</small><h2>Moves advancing this</h2></div><span>{activeTasks.length}</span></header>
            {activeTasks.length ? (
              <>
                <div className="atlas-move-list">{activeTasks.slice(0, 6).map((task) => <MoveCard key={task.taskId} task={task} projectId={project.projectId} />)}</div>
                {activeTasks.length > 6 ? <details className="atlas-project-more"><summary>Show {activeTasks.length - 6} more active Moves</summary><div>{activeTasks.slice(6).map((task) => <MoveCard key={task.taskId} task={task} projectId={project.projectId} />)}</div></details> : null}
              </>
            ) : <p className="atlas-panel-intro">No active Moves are attached right now. The world can remain visible without inventing busywork.</p>}
          </section>

          {isFinishReservoir ? <FinishReservoir items={reservoirItems} projectId={project.projectId} /> : null}

          {detail.attention.length ? (
            <details className="atlas-reality-panel atlas-owner-attention">
              <summary><strong>Needs Owner · {detail.attention.length}</strong></summary>
              <div>{detail.attention.map((item) => <article key={item.attentionId}><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</article>)}</div>
            </details>
          ) : null}

          {detail.relationships?.length ? (
            <details className="atlas-reality-panel">
              <summary><strong>Connected worlds · {detail.relationships.length}</strong></summary>
              <div className="atlas-quest-grid">{detail.relationships.map((relationship) => <QuestCard key={relationship.relationshipId} project={relationship.project} />)}</div>
            </details>
          ) : null}

          {viewer.canManageAnyPortfolio ? <ProjectReviewPanel projectId={project.projectId} /> : null}

          {!isFinishReservoir ? (
            <details className="atlas-project-controls">
              <summary>All project work + controls</summary>
              <div><ProjectTaskTools projectId={project.projectId} projectTitle={project.title} tasks={detail.tasks} steps={detail.steps} trail={project.trail} canCreateTasks={detail.permissions.canCreateTasks} selectedTaskId={selectedTaskId} /></div>
            </details>
          ) : null}
        </div>
      </section>
    </main>
  );
}
