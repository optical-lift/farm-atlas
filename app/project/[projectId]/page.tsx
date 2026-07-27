import Link from "next/link";
import { notFound } from "next/navigation";

import ProjectTaskTools from "@/components/atlas/portfolio/ProjectTaskTools";
import AtlasTrail from "@/components/atlas/trail/AtlasTrail";
import {
  readAtlasProjectDetail,
  type AtlasProjectDetail,
} from "@/lib/atlas/portfolio";
import { requireAtlasPortalViewer } from "@/lib/atlas/viewer-context";

import styles from "@/components/atlas/portfolio/project.module.css";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
  const query = searchParams ? await searchParams : {};
  const selectedTaskId = firstParam(query.taskId);

  let detail: AtlasProjectDetail;
  try {
    detail = await readAtlasProjectDetail(projectId);
  } catch {
    notFound();
  }

  const project = detail.project;
  const placeTargets = project.targets.filter((target) => target.placeLabel);
  const locationLabel = project.farmName || viewer.organizationName;
  const currentTrailNode = project.trail?.nodes.find((node) => node.nodeId === project.trail?.currentNodeId)
    ?? project.trail?.nodes.find((node) => node.status === "current" || node.status === "blocked")
    ?? null;
  const currentMove = project.trail?.currentMove?.title
    || currentTrailNode?.label
    || project.currentMilestone
    || "Define the next move";

  return (
    <main className="atlas-phone-shell">
      <section className={`atlas-phone ${styles.projectPhone}`}>
        <header className={`atlas-phone-top ${styles.topbar}`}>
          <Link href="/" className={styles.brand}>
            <span className="atlas-phone-kicker">Atlas</span>
            <strong className="atlas-phone-title">{viewer.organizationName}</strong>
          </Link>
          <Link href="/#work-board" className={styles.back}>Work</Link>
        </header>

        <div className={styles.projectBody}>
          <section className={styles.hero}>
            <div className={styles.heroMeta}>
              <span>{locationLabel}</span>
              <span>{titleCase(project.workstream)}</span>
              <span>{titleCase(project.health)}</span>
            </div>
            <h1>{project.title}</h1>
            {project.outcome ? <p>{project.outcome}</p> : null}
            <div className={styles.milestone}>
              <span>Current move</span>
              <strong>{currentMove}</strong>
            </div>
            {placeTargets.length ? (
              <div className={styles.targets}>
                {placeTargets.map((target) => (
                  <span key={target.placeId || target.placeLabel}>{target.placeLabel}</span>
                ))}
              </div>
            ) : null}
          </section>

          <div className={styles.body}>
            {detail.attention.length ? (
              <section className={styles.attentionSection} aria-labelledby="project-attention-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <span>Exceptions</span>
                    <h2 id="project-attention-title">Needs attention</h2>
                  </div>
                  <strong>{detail.attention.length}</strong>
                </div>
                <div className={styles.attentionList}>
                  {detail.attention.map((item) => (
                    <article key={item.attentionId}>
                      <span>{titleCase(item.kind)}</span>
                      <strong>{item.title}</strong>
                      {item.detail ? <p>{item.detail}</p> : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {project.trail ? (
              <AtlasTrail context={project.trail} mode="full" title="Project Trail" />
            ) : null}

            <section id="project-work">
              <ProjectTaskTools
                projectId={project.projectId}
                tasks={detail.tasks}
                canCreateTasks={detail.permissions.canCreateTasks}
                canCompleteAll={detail.permissions.isOrganizationOwner}
                selectedTaskId={selectedTaskId}
              />
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
