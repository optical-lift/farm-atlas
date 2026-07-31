import Link from "next/link";
import { notFound } from "next/navigation";

import ProjectReviewPanel from "@/components/atlas/portfolio/ProjectReviewPanel";
import ProjectTaskTools from "@/components/atlas/portfolio/ProjectTaskTools";
import {
  readAtlasProjectDetail,
  type AtlasProjectDetail,
} from "@/lib/atlas/portfolio";
import { atlasTrailCurrentNode } from "@/lib/atlas/trail";
import { requireAtlasPortalViewer } from "@/lib/atlas/viewer-context";

export const dynamic = "force-dynamic";

type ProjectSearchParams = Record<string, string | string[] | undefined>;

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<ProjectSearchParams>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const viewer = await requireAtlasPortalViewer();
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
  const currentNode = atlasTrailCurrentNode(project.trail);
  const nextNode = project.trail?.nextNode ?? null;
  const activeTasks = detail.tasks.filter((task) => task.status === "open" || task.status === "blocked");
  const completeTasks = detail.tasks.filter((task) => task.status === "done" || task.status === "skipped");
  const blockedTasks = detail.tasks.filter((task) => task.status === "blocked");
  const currentMove = project.trail?.currentMove?.title
    || activeTasks[0]?.title
    || currentNode?.label
    || project.currentMilestone
    || "Define the next task";
  const placeTargets = project.targets.filter((target) => target.placeLabel);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{viewer.organizationName}</span>
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
                <strong>{activeTasks.length} open · {blockedTasks.length} blocked · {completeTasks.length} done</strong>
              </div>
              <p>{project.farmName || viewer.organizationName}</p>
            </div>

            <article className="atlas-day-command-header atlas-project-command-header">
              <div className="atlas-project-command-title">
                <small>Project</small>
                <h1>{project.title}</h1>
              </div>

              <div className="atlas-project-trail-position" aria-label="Current Project Trail position">
                <span>Current</span>
                <strong>{currentNode?.label || currentMove}</strong>
                {nextNode ? <em>Next · {nextNode.label}</em> : <em>{project.health === "complete" ? "Trail complete" : "No next node released"}</em>}
              </div>

              <details className="atlas-day-overview-drawer atlas-day-command-overview atlas-project-command-overview">
                <summary>
                  <span className="atlas-day-next-label">Next task</span>
                  <div className="atlas-day-next-copy">
                    <strong>{currentMove}</strong>
                    <em>{currentNode?.label || titleCase(project.workstream)}</em>
                  </div>
                  <b aria-hidden="true">⌄</b>
                </summary>
                <div className="atlas-day-command-overview-body">
                  {project.outcome ? <p className="atlas-project-outcome">{project.outcome}</p> : null}
                  <div className="atlas-day-overview-pills" aria-label="Project context">
                    <span>{titleCase(project.health)}</span>
                    <span>{activeTasks.length} open</span>
                    {placeTargets.map((target) => <span key={target.placeId || target.placeLabel}>{target.placeLabel}</span>)}
                  </div>
                </div>
              </details>
            </article>

            <ProjectReviewPanel projectId={project.projectId} />

            {detail.attention.length ? (
              <details className="atlas-project-attention-strip" open={detail.attention.some((item) => item.kind === "blocked")}>
                <summary><strong>Needs attention</strong><span>{detail.attention.length}</span><b aria-hidden="true">⌄</b></summary>
                <div>
                  {detail.attention.map((item) => (
                    <article key={item.attentionId}>
                      <small>{titleCase(item.kind)}</small>
                      <strong>{item.title}</strong>
                      {item.detail ? <p>{item.detail}</p> : null}
                    </article>
                  ))}
                </div>
              </details>
            ) : null}

            <section id="project-work">
              <ProjectTaskTools
                projectId={project.projectId}
                projectTitle={project.title}
                tasks={detail.tasks}
                steps={detail.steps}
                trail={project.trail}
                canCreateTasks={detail.permissions.canCreateTasks}
                selectedTaskId={selectedTaskId}
              />
            </section>
          </section>
        </div>
      </section>
    </main>
  );
}
