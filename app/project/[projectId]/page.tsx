import Link from "next/link";
import { notFound } from "next/navigation";

import ProjectTaskTools from "@/components/atlas/portfolio/ProjectTaskTools";
import {
  readAtlasProjectDetail,
  type AtlasProjectDetail,
} from "@/lib/atlas/portfolio";
import { requireAtlasPortalViewer } from "@/lib/atlas/viewer-context";

import styles from "@/components/atlas/portfolio/project.module.css";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const viewer = await requireAtlasPortalViewer();
  const { projectId } = await params;

  let detail: AtlasProjectDetail;
  try {
    detail = await readAtlasProjectDetail(projectId);
  } catch {
    notFound();
  }

  const project = detail.project;
  const placeTargets = project.targets.filter((target) => target.placeLabel);
  const locationLabel = project.farmName || viewer.organizationName;

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <span>Atlas portfolio</span>
          <strong>{viewer.organizationName}</strong>
        </Link>
        <Link href="/" className={styles.back}>Portfolio</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroMeta}>
          <span>{locationLabel}</span>
          <span>{titleCase(project.workstream)}</span>
          <span>{titleCase(project.health)}</span>
        </div>
        <h1>{project.title}</h1>
        {project.outcome ? <p>{project.outcome}</p> : null}
        <div className={styles.milestone}>
          <span>Current milestone</span>
          <strong>{project.currentMilestone || "Define the next project milestone"}</strong>
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

        <ProjectTaskTools
          projectId={project.projectId}
          tasks={detail.tasks}
          canCreateTasks={detail.permissions.canCreateTasks}
          canCompleteAll={detail.permissions.isOrganizationOwner}
        />

        {detail.steps.length ? (
          <section className={styles.trailSection} aria-labelledby="project-trail-title">
            <div className={styles.sectionHeading}>
              <div>
                <span>Project trail</span>
                <h2 id="project-trail-title">Milestones and work</h2>
              </div>
            </div>
            <ol className={styles.trail}>
              {detail.steps.map((step) => (
                <li key={step.stepId} data-status={step.status}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{step.title}</strong>
                    <small>{titleCase(step.status)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </main>
  );
}
