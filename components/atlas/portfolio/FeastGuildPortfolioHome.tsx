import Link from "next/link";

import type { AtlasPortfolioHome, AtlasPortfolioProject } from "@/lib/atlas/portfolio";
import type { AtlasPortalViewer } from "@/lib/atlas/viewer";

import styles from "./portfolio.module.css";

type FeastGuildPortfolioHomeProps = {
  viewer: AtlasPortalViewer;
  portfolio: AtlasPortfolioHome;
  selectedFarm?: string | null;
  selectedWorkstream?: string | null;
};

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function projectHealthLabel(project: AtlasPortfolioProject) {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "Blocked";
  if (project.openAttentionCount > 0) return "Needs attention";
  if (project.health === "at_risk") return "At risk";
  if (project.health === "waiting") return "Waiting";
  if (project.health === "complete") return "Complete";
  if (project.health === "quiet") return "Quiet";
  return "Moving";
}

function projectHealthClass(project: AtlasPortfolioProject) {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return styles.healthBlocked;
  if (project.openAttentionCount > 0 || project.health === "at_risk") return styles.healthAttention;
  if (project.health === "waiting" || project.health === "quiet") return styles.healthWaiting;
  if (project.health === "complete") return styles.healthComplete;
  return styles.healthMoving;
}

function ProjectCard({ project }: { project: AtlasPortfolioProject }) {
  const targetPlace = project.targets.find((target) => target.placeLabel)?.placeLabel;
  return (
    <Link href={`/project/${encodeURIComponent(project.projectId)}`} className={styles.projectCard}>
      <div className={styles.projectCardTop}>
        <strong>{project.title}</strong>
        <span className={`${styles.health} ${projectHealthClass(project)}`}>
          {projectHealthLabel(project)}
        </span>
      </div>
      <p>{project.currentMilestone || project.outcome || "Open the project."}</p>
      <div className={styles.projectFacts}>
        {targetPlace ? <span>{targetPlace}</span> : null}
        <span>{project.openTaskCount} open</span>
        {project.targetDate ? <span>Due {project.targetDate}</span> : null}
      </div>
    </Link>
  );
}

function activeFilterHref(farm?: string | null, workstream?: string | null) {
  const params = new URLSearchParams();
  if (farm) params.set("farm", farm);
  if (workstream) params.set("workstream", workstream);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export default function FeastGuildPortfolioHome({
  viewer,
  portfolio,
  selectedFarm,
  selectedWorkstream,
}: FeastGuildPortfolioHomeProps) {
  const farms = selectedFarm
    ? portfolio.farms.filter((farm) => farm.farmKey === selectedFarm)
    : portfolio.farms;
  const workstreams = selectedWorkstream
    ? portfolio.workstreams.filter((workstream) => workstream === selectedWorkstream)
    : portfolio.workstreams;
  const crossFarmProjects = selectedWorkstream
    ? portfolio.crossFarmProjects.filter((project) => project.workstream === selectedWorkstream)
    : portfolio.crossFarmProjects;
  const hasFarmTools = viewer.farmMemberships.length > 0;

  return (
    <main className={styles.shell} data-feast-guild-portfolio data-portfolio-role={viewer.role}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Atlas portfolio</span>
          <h1>{portfolio.organization.name}</h1>
        </div>
        <nav className={styles.quickNav} aria-label="Atlas quick navigation">
          {hasFarmTools ? <Link href="/day">Today</Link> : null}
          {hasFarmTools ? <Link href="/overview/week">Week</Link> : null}
          {hasFarmTools ? <Link href="/overview/month">Month</Link> : null}
        </nav>
      </header>

      <section className={styles.attentionSection} aria-labelledby="portfolio-attention-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.kicker}>Exceptions first</span>
            <h2 id="portfolio-attention-title">Needs attention</h2>
          </div>
          <strong>{portfolio.attention.length}</strong>
        </div>
        {portfolio.attention.length ? (
          <div className={styles.attentionGrid}>
            {portfolio.attention.map((item, index) => (
              <Link
                key={`${item.attentionId ?? item.projectId}-${index}`}
                href={`/project/${encodeURIComponent(item.projectId)}`}
                className={styles.attentionCard}
              >
                <span>{titleCase(item.kind)}</span>
                <strong>{item.title}</strong>
                <p>{item.detail || item.projectTitle}</p>
                <small>{item.farmName || "Feast Guild"} · {item.projectTitle}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.calmState}>No visible project exceptions need attention right now.</p>
        )}
      </section>

      <section className={styles.zoomBar} aria-label="Portfolio zoom controls">
        <div className={styles.zoomGroup}>
          <span>Farm</span>
          <Link
            href={activeFilterHref(null, selectedWorkstream)}
            className={!selectedFarm ? styles.activeFilter : undefined}
          >
            All
          </Link>
          {portfolio.farms.map((farm) => (
            <Link
              key={farm.farmId}
              href={activeFilterHref(farm.farmKey, selectedWorkstream)}
              className={selectedFarm === farm.farmKey ? styles.activeFilter : undefined}
            >
              {farm.farmName}
            </Link>
          ))}
        </div>
        <div className={styles.zoomGroup}>
          <span>Workstream</span>
          <Link
            href={activeFilterHref(selectedFarm, null)}
            className={!selectedWorkstream ? styles.activeFilter : undefined}
          >
            All
          </Link>
          {portfolio.workstreams.map((workstream) => (
            <Link
              key={workstream}
              href={activeFilterHref(selectedFarm, workstream)}
              className={selectedWorkstream === workstream ? styles.activeFilter : undefined}
            >
              {titleCase(workstream)}
            </Link>
          ))}
        </div>
      </section>

      {crossFarmProjects.length ? (
        <section className={styles.collectiveSection} aria-labelledby="collective-projects-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Across farms</span>
              <h2 id="collective-projects-title">Feast Guild projects</h2>
            </div>
          </div>
          <div className={styles.collectiveGrid}>
            {crossFarmProjects.map((project) => <ProjectCard key={project.projectId} project={project} />)}
          </div>
        </section>
      ) : null}

      <section className={styles.matrixSection} aria-labelledby="portfolio-matrix-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.kicker}>Farm × workstream</span>
            <h2 id="portfolio-matrix-title">Portfolio matrix</h2>
          </div>
        </div>

        <div className={styles.matrix}>
          {farms.map((farm) => (
            <article key={farm.farmId} className={styles.farmRow}>
              <header className={styles.farmHeader}>
                <div>
                  <span>Active farm</span>
                  <h3>{farm.farmName}</h3>
                </div>
                <small>{farm.projects.length} active {farm.projects.length === 1 ? "project" : "projects"}</small>
              </header>
              <div className={styles.workstreamGrid}>
                {workstreams.map((workstream) => {
                  const projects = farm.projects.filter((project) => project.workstream === workstream);
                  return (
                    <section key={`${farm.farmId}-${workstream}`} className={styles.matrixCell}>
                      <div className={styles.cellHeading}>
                        <span>{titleCase(workstream)}</span>
                        <small>{projects.length}</small>
                      </div>
                      {projects.length ? (
                        <div className={styles.cellProjects}>
                          {projects.map((project) => <ProjectCard key={project.projectId} project={project} />)}
                        </div>
                      ) : (
                        <p className={styles.emptyCell}>No active project.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
