import Link from "next/link";

import type {
  AtlasPortfolioAttention,
  AtlasPortfolioHome,
  AtlasPortfolioProject,
} from "@/lib/atlas/portfolio";
import type { AtlasPortalViewer } from "@/lib/atlas/viewer";
import {
  AtlasAppShell,
  AtlasCard,
  AtlasFooterActions,
  AtlasMetricStrip,
  AtlasSectionHeading,
  AtlasStateBadge,
  AtlasTopBar,
} from "@/components/atlas/ui/AtlasPrimitives";

import styles from "./portfolio.module.css";

type FeastGuildPortfolioHomeProps = {
  viewer: AtlasPortalViewer;
  portfolio: AtlasPortfolioHome;
  selectedFarm?: string | null;
  selectedWorkstream?: string | null;
};

type DatedPortfolioItem = {
  key: string;
  label: string;
  title: string;
  date: string;
  href: string;
};

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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

function projectHealthState(project: AtlasPortfolioProject): "moving" | "waiting" | "blocked" | "complete" | "quiet" | "attention" {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "blocked";
  if (project.openAttentionCount > 0 || project.health === "at_risk") return "attention";
  if (project.health === "waiting") return "waiting";
  if (project.health === "quiet") return "quiet";
  if (project.health === "complete") return "complete";
  return "moving";
}

function projectLocation(project: AtlasPortfolioProject) {
  return project.farmName || "Feast Guild";
}

function ProjectCard({ project }: { project: AtlasPortfolioProject }) {
  const targetPlace = project.targets.find((target) => target.placeLabel)?.placeLabel;
  return (
    <Link href={`/project/${encodeURIComponent(project.projectId)}`} className={styles.projectCard}>
      <div className={styles.projectCardTop}>
        <span>{projectLocation(project)} · {titleCase(project.workstream)}</span>
        <AtlasStateBadge
          state={projectHealthState(project)}
          className={`${styles.health} ${projectHealthClass(project)}`}
        >
          {projectHealthLabel(project)}
        </AtlasStateBadge>
      </div>
      <strong>{project.title}</strong>
      <p>{project.currentMilestone || project.outcome || "Open the project."}</p>
      <div className={styles.projectFacts}>
        {targetPlace ? <span>{targetPlace}</span> : null}
        <span>{project.openTaskCount} open</span>
        {project.targetDate ? <span>Due {prettyDate(project.targetDate)}</span> : null}
      </div>
    </Link>
  );
}

function activeFilterHref(farm?: string | null, workstream?: string | null) {
  const params = new URLSearchParams();
  if (farm) params.set("farm", farm);
  if (workstream) params.set("workstream", workstream);
  const query = params.toString();
  return query ? `/?${query}#portfolio-board` : "/#portfolio-board";
}

function attentionForProject(attention: AtlasPortfolioAttention[], projectId: string) {
  return attention.find((item) => item.projectId === projectId) ?? null;
}

function projectPriority(project: AtlasPortfolioProject, attention: AtlasPortfolioAttention[]) {
  if (attentionForProject(attention, project.projectId)) return 0;
  if (project.blockedTaskCount > 0 || project.health === "blocked") return 1;
  if (project.health === "at_risk" || project.health === "waiting") return 2;
  if (project.openTaskCount > 0) return 3;
  return 4;
}

function dueItems(projects: AtlasPortfolioProject[], attention: AtlasPortfolioAttention[]) {
  const items: DatedPortfolioItem[] = [];
  attention.forEach((item) => {
    if (!item.dueDate) return;
    items.push({
      key: `attention-${item.attentionId ?? item.projectId}-${item.dueDate}`,
      label: "Attention",
      title: item.title,
      date: item.dueDate,
      href: `/project/${encodeURIComponent(item.projectId)}`,
    });
  });
  projects.forEach((project) => {
    if (!project.targetDate) return;
    items.push({
      key: `project-${project.projectId}-${project.targetDate}`,
      label: projectLocation(project),
      title: project.title,
      date: project.targetDate,
      href: `/project/${encodeURIComponent(project.projectId)}`,
    });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

function DateOverviewCard({
  title,
  summary,
  items,
}: {
  title: string;
  summary: string;
  items: DatedPortfolioItem[];
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
            <small>{item.label}</small>
            <em>{prettyDate(item.date)}</em>
          </Link>
        )) : <p>No dated items.</p>}
      </div>
    </AtlasCard>
  );
}

export default function FeastGuildPortfolioHome({
  viewer,
  portfolio,
  selectedFarm,
  selectedWorkstream,
}: FeastGuildPortfolioHomeProps) {
  const projectMap = new Map<string, AtlasPortfolioProject>();
  portfolio.crossFarmProjects.forEach((project) => projectMap.set(project.projectId, project));
  portfolio.farms.forEach((farm) => {
    farm.projects.forEach((project) => projectMap.set(project.projectId, project));
  });
  const allProjects = [...projectMap.values()];
  const totalOpen = allProjects.reduce((sum, project) => sum + project.openTaskCount, 0);
  const movingCount = allProjects.filter((project) => projectHealthLabel(project) === "Moving").length;
  const heroProjects = [...allProjects]
    .sort((a, b) => {
      const priority = projectPriority(a, portfolio.attention) - projectPriority(b, portfolio.attention);
      if (priority !== 0) return priority;
      return b.openTaskCount - a.openTaskCount || a.title.localeCompare(b.title);
    })
    .slice(0, 4);

  const today = new Date();
  const todayIso = isoFromDate(today);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndIso = isoFromDate(weekEnd);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthEndIso = isoFromDate(monthEnd);
  const dated = dueItems(allProjects, portfolio.attention);
  const weekItems = dated.filter((item) => item.date >= todayIso && item.date <= weekEndIso);
  const monthItems = dated.filter((item) => item.date >= todayIso && item.date <= monthEndIso);
  const monthLabel = today.toLocaleDateString("en-US", { month: "long" });
  const todayLabel = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const farms = selectedFarm
    ? portfolio.farms.filter((farm) => farm.farmKey === selectedFarm)
    : portfolio.farms;
  const workstreams = selectedWorkstream
    ? portfolio.workstreams.filter((workstream) => workstream === selectedWorkstream)
    : portfolio.workstreams;
  const crossFarmProjects = selectedFarm
    ? []
    : selectedWorkstream
      ? portfolio.crossFarmProjects.filter((project) => project.workstream === selectedWorkstream)
      : portfolio.crossFarmProjects;

  return (
    <AtlasAppShell
      className="atlas-home-shell"
      data-feast-guild-portfolio
      data-portfolio-role={viewer.role}
    >
      <AtlasTopBar
        title={portfolio.organization.name}
        status={<span>{movingCount} moving</span>}
        action={(
          <Link href="#guild-work" className="atlas-top-action atlas-top-action-task" aria-label="Open Guild work">
            +
          </Link>
        )}
      />

      <div className={styles.homeBody}>
        <AtlasCard
          as="section"
          variant="purple"
          className={`atlas-home-box atlas-home-box-purple ${styles.hero}`}
          ariaLabelledBy="guild-today-title"
        >
          <div className={styles.heroHeader}>
            <div>
              <span className={styles.heroKicker}>Today</span>
              <strong id="guild-today-title">{todayLabel}</strong>
            </div>
            <span className={styles.heroCount}>{totalOpen} open</span>
          </div>
          {heroProjects.length ? (
            <div className={styles.heroGrid}>
              {heroProjects.map((project) => {
                const attention = attentionForProject(portfolio.attention, project.projectId);
                return (
                  <Link
                    key={project.projectId}
                    href={`/project/${encodeURIComponent(project.projectId)}`}
                    className={styles.heroCard}
                  >
                    <small>{attention ? titleCase(attention.kind) : titleCase(project.workstream)}</small>
                    <strong>{attention?.title || project.title}</strong>
                    <span>{projectLocation(project)} · {project.openTaskCount} open</span>
                    <em>{attention?.detail || project.currentMilestone || project.outcome || "Open the project."}</em>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className={styles.heroEmpty}>No active Guild work is visible.</p>
          )}
        </AtlasCard>

        <div className={styles.overviewPair} aria-label="Portfolio dates">
          <DateOverviewCard title="This Week" summary={`${weekItems.length} dated`} items={weekItems} />
          <DateOverviewCard title={monthLabel} summary={`${monthItems.length} dated`} items={monthItems} />
        </div>

        <AtlasMetricStrip href="#portfolio-board" ariaLabel="Open portfolio board">
          <span><b>{portfolio.farms.length}</b> farms</span>
          <span><b>{allProjects.length}</b> projects</span>
          <span><b>{totalOpen}</b> open</span>
          <span><b>{portfolio.attention.length}</b> attention</span>
        </AtlasMetricStrip>

        <AtlasFooterActions>
          <Link href="#portfolio-board"><span>Portfolio</span><em>{allProjects.length} active</em></Link>
          <Link href="#guild-work"><span>Guild work</span><em>{totalOpen} open</em></Link>
        </AtlasFooterActions>

        <section id="guild-work" className={styles.detailSection} aria-labelledby="guild-work-title">
          <AtlasSectionHeading
            kicker="Work in motion"
            title="My Guild Work"
            id="guild-work-title"
            count={allProjects.length}
          />
          {portfolio.attention.length ? (
            <div className={styles.attentionList}>
              {portfolio.attention.map((item, index) => (
                <Link
                  key={`${item.attentionId ?? item.projectId}-${index}`}
                  href={`/project/${encodeURIComponent(item.projectId)}`}
                >
                  <span>{titleCase(item.kind)}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail || item.projectTitle}</p>
                  <small>{item.farmName || "Feast Guild"} · {item.projectTitle}</small>
                </Link>
              ))}
            </div>
          ) : null}
          <div className={styles.projectList}>
            {allProjects.map((project) => <ProjectCard key={project.projectId} project={project} />)}
          </div>
        </section>

        <section id="portfolio-board" className={styles.detailSection} aria-labelledby="portfolio-board-title">
          <AtlasSectionHeading
            kicker="Bird's-eye view"
            title="Portfolio"
            id="portfolio-board-title"
            count={portfolio.farms.length}
          />

          <div className={styles.filters} aria-label="Portfolio zoom controls">
            <div>
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
            <div>
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
          </div>

          {crossFarmProjects.length ? (
            <article className={styles.farmCard}>
              <header>
                <div>
                  <span>Across farms</span>
                  <h3>Feast Guild</h3>
                </div>
                <small>{crossFarmProjects.length} active</small>
              </header>
              <div className={styles.farmProjects}>
                {crossFarmProjects.map((project) => <ProjectCard key={project.projectId} project={project} />)}
              </div>
            </article>
          ) : null}

          <div className={styles.farmList}>
            {farms.map((farm) => {
              const visibleProjects = farm.projects.filter((project) => workstreams.includes(project.workstream));
              const grouped = workstreams
                .map((workstream) => ({
                  workstream,
                  projects: visibleProjects.filter((project) => project.workstream === workstream),
                }))
                .filter((group) => group.projects.length > 0);
              return (
                <article key={farm.farmId} className={styles.farmCard}>
                  <header>
                    <div>
                      <span>Active farm</span>
                      <h3>{farm.farmName}</h3>
                    </div>
                    <small>{visibleProjects.length} active</small>
                  </header>
                  {grouped.length ? grouped.map((group) => (
                    <section key={`${farm.farmId}-${group.workstream}`} className={styles.workstreamGroup}>
                      <div className={styles.workstreamHeading}>
                        <strong>{titleCase(group.workstream)}</strong>
                        <span>{group.projects.length}</span>
                      </div>
                      <div className={styles.farmProjects}>
                        {group.projects.map((project) => <ProjectCard key={project.projectId} project={project} />)}
                      </div>
                    </section>
                  )) : <p className={styles.emptyState}>No active projects in this view.</p>}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </AtlasAppShell>
  );
}
