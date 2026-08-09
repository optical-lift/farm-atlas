import Link from "next/link";
import { notFound } from "next/navigation";

import ProjectReviewPanel from "@/components/atlas/portfolio/ProjectReviewPanel";
import ProjectTaskTools from "@/components/atlas/portfolio/ProjectTaskTools";
import {
  readAtlasProjectDetail,
  type AtlasProjectDetail,
} from "@/lib/atlas/portfolio";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { atlasTrailCurrentNode } from "@/lib/atlas/trail";
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

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    <section id="finish-reservoir" className="atlas-project-attention-strip" style={{ marginTop: 18 }}>
      <div style={{ padding: "16px 18px 6px" }}>
        <small style={{ textTransform: "uppercase", letterSpacing: ".08em", opacity: .6 }}>Finish + Renovation reservoir</small>
        <h2 style={{ margin: "6px 0 8px", fontSize: 22 }}>The project holds the backlog. The day only gets one move.</h2>
        <p style={{ margin: 0, lineHeight: 1.5, opacity: .72 }}>
          These cards stay undated here until Atlas releases one into the worker day. Anna does not have to choose or reschedule the rest of the project.
        </p>
      </div>

      {active.length ? (
        <div style={{ padding: "10px 18px 4px" }}>
          <strong style={{ display: "block", marginBottom: 8 }}>Released now</strong>
          {active.map((item) => (
            <article key={item.id} style={{ padding: "12px 0", borderTop: "1px solid rgba(0,0,0,.08)" }}>
              <small>{item.expected_active_minutes} min · {titleCase(item.physical_load)} · {titleCase(item.environment)}</small>
              <strong style={{ display: "block", marginTop: 3 }}>{item.title}</strong>
              {item.note ? <p style={{ margin: "6px 0 0", opacity: .72 }}>{item.note}</p> : null}
              <Link href={`/task-focus/${encodeURIComponent(item.active_task_id!)}?returnTo=${encodeURIComponent(`/project/${projectId}`)}`} style={{ display: "inline-block", marginTop: 8 }}>Open current move →</Link>
            </article>
          ))}
        </div>
      ) : null}

      <details open style={{ padding: "8px 18px" }}>
        <summary><strong>Anna-ready work</strong><span style={{ marginLeft: 8, opacity: .6 }}>{farmHand.length}</span></summary>
        <div>
          {farmHand.slice(0, 8).map((item) => (
            <article key={item.id} style={{ padding: "11px 0", borderTop: "1px solid rgba(0,0,0,.07)" }}>
              <small>{item.expected_active_minutes} min · {titleCase(item.environment)} · {titleCase(item.priority)}</small>
              <strong style={{ display: "block", marginTop: 3 }}>{item.title}</strong>
              {item.note ? <p style={{ margin: "5px 0 0", opacity: .7 }}>{item.note}</p> : null}
            </article>
          ))}
          {farmHand.length > 8 ? <p style={{ opacity: .6 }}>+ {farmHand.length - 8} more held safely in the project.</p> : null}
        </div>
      </details>

      {management.length ? (
        <details style={{ padding: "8px 18px" }}>
          <summary><strong>Owner / Marshall work</strong><span style={{ marginLeft: 8, opacity: .6 }}>{management.length}</span></summary>
          <div>
            {management.map((item) => (
              <article key={item.id} style={{ padding: "10px 0", borderTop: "1px solid rgba(0,0,0,.07)" }}>
                <small>{item.expected_active_minutes} min · {titleCase(item.physical_load)}</small>
                <strong style={{ display: "block", marginTop: 3 }}>{item.title}</strong>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      <div style={{ padding: "8px 18px 18px", opacity: .62, fontSize: 13 }}>
        {available.length} waiting in the reservoir · {active.length} released · {completed.length} completed
      </div>
    </section>
  );
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  await requireAtlasUniversalViewer();
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
  const projectScopeName = project.farmName || "Atlas";
  const isFinishReservoir = project.projectKey === "elm_finish_renovation_pool";
  const reservoirItems = isFinishReservoir ? await readFinishReservoir(projectId).catch(() => []) : [];
  const currentNode = atlasTrailCurrentNode(project.trail);
  const nextNode = project.trail?.nextNode ?? null;
  const activeTasks = detail.tasks.filter((task) => task.status === "open" || task.status === "blocked");
  const completeTasks = detail.tasks.filter((task) => task.status === "done" || task.status === "skipped");
  const blockedTasks = detail.tasks.filter((task) => task.status === "blocked");
  const releasedProjectMove = reservoirItems.find((item) => item.status === "selected" && item.active_task_id)?.title ?? null;
  const currentMove = releasedProjectMove || project.trail?.currentMove?.title || activeTasks[0]?.title || currentNode?.label || project.currentMilestone || "Define the next task";
  const placeTargets = project.targets.filter((target) => target.placeLabel);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{projectScopeName}</span>
          </Link>
          <span className="atlas-weather-line">Project</span>
          <Link href="/" className="atlas-note-plus" aria-label="Back to Atlas home">↩</Link>
        </header>

        <div className="atlas-task-page-body">
          <section className="atlas-task-page-section atlas-route-collection atlas-day-browse atlas-project-browse">
            <div className="atlas-day-browse-head atlas-project-browse-head">
              <Link href="/" className="atlas-route-back atlas-day-back">← Atlas</Link>
              <div className="atlas-project-browse-title-row">
                <span>{titleCase(project.workstream)}</span>
                <strong>{isFinishReservoir ? `${reservoirItems.filter((item) => item.status === "available").length} held · ${reservoirItems.filter((item) => item.status === "selected").length} released` : `${activeTasks.length} open · ${blockedTasks.length} blocked · ${completeTasks.length} done`}</strong>
              </div>
              <p>{projectScopeName}</p>
            </div>

            <article className="atlas-day-command-header atlas-project-command-header">
              <div className="atlas-project-command-title"><small>Project</small><h1>{project.title}</h1></div>
              <div className="atlas-project-trail-position" aria-label="Current Project Trail position">
                <span>Current</span><strong>{currentMove}</strong>
                {nextNode ? <em>Next · {nextNode.label}</em> : <em>{isFinishReservoir ? "Atlas releases the next fitting move" : project.health === "complete" ? "Trail complete" : "No next node released"}</em>}
              </div>
              <details className="atlas-day-overview-drawer atlas-day-command-overview atlas-project-command-overview">
                <summary><span className="atlas-day-next-label">Next task</span><div className="atlas-day-next-copy"><strong>{currentMove}</strong><em>{isFinishReservoir ? "Atlas chooses from the reservoir" : currentNode?.label || titleCase(project.workstream)}</em></div><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-day-command-overview-body">
                  {project.outcome ? <p className="atlas-project-outcome">{project.outcome}</p> : null}
                  <div className="atlas-day-overview-pills" aria-label="Project context">
                    <span>{titleCase(project.health)}</span>
                    <span>{isFinishReservoir ? `${reservoirItems.length} project cards` : `${activeTasks.length} open`}</span>
                    {placeTargets.map((target) => <span key={target.placeId || target.placeLabel}>{target.placeLabel}</span>)}
                  </div>
                </div>
              </details>
            </article>

            <ProjectReviewPanel projectId={project.projectId} />

            {detail.attention.length ? (
              <details className="atlas-project-attention-strip" open={detail.attention.some((item) => item.kind === "blocked")}>
                <summary><strong>Needs attention</strong><span>{detail.attention.length}</span><b aria-hidden="true">⌄</b></summary>
                <div>{detail.attention.map((item) => <article key={item.attentionId}><small>{titleCase(item.kind)}</small><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</article>)}</div>
              </details>
            ) : null}

            {isFinishReservoir ? <FinishReservoir items={reservoirItems} projectId={project.projectId} /> : (
              <section id="project-work">
                <ProjectTaskTools projectId={project.projectId} projectTitle={project.title} tasks={detail.tasks} steps={detail.steps} trail={project.trail} canCreateTasks={detail.permissions.canCreateTasks} selectedTaskId={selectedTaskId} />
              </section>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
