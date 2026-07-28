"use client";

import Link from "next/link";
import { Fragment } from "react";

import {
  AtlasCard,
  AtlasSectionHeading,
  AtlasStateBadge,
} from "@/components/atlas/ui/AtlasPrimitives";
import type {
  AtlasUniversalHomeModel,
  AtlasUniversalMoveState,
  AtlasUniversalProjectTask,
} from "@/lib/atlas/universal-home";

import styles from "./portfolio-matrix.module.css";

type AtlasPortfolioProject = AtlasUniversalHomeModel["projects"][number];

type MatrixRow = {
  key: string;
  kind: "organization" | "farm";
  label: string;
  detail: string;
  farmId: string | null;
  openCount: number;
  blockedCount: number;
};

type MatrixAttention = {
  key: string;
  projectId: string;
  kind: "blocked" | "missing_task" | "overdue" | "review" | "attention";
  label: string;
  title: string;
  detail: string;
  href: string;
  dueDate: string | null;
};

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function projectState(project: AtlasPortfolioProject): AtlasUniversalMoveState {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "blocked";
  if (project.openAttentionCount > 0 || project.health === "at_risk") return "attention";
  if (project.health === "waiting") return "waiting";
  if (project.health === "complete") return "complete";
  if (project.health === "quiet") return "quiet";
  return "moving";
}

function stateLabel(state: AtlasUniversalMoveState) {
  if (state === "blocked") return "Blocked";
  if (state === "attention") return "Attention";
  if (state === "waiting") return "Waiting";
  if (state === "complete") return "Complete";
  if (state === "quiet") return "Quiet";
  return "Moving";
}

function currentNode(project: AtlasPortfolioProject) {
  const trail = project.trail;
  if (!trail) return null;
  return trail.nodes.find((node) => node.nodeId === trail.currentNodeId)
    ?? trail.nodes.find((node) => node.status === "current" || node.status === "blocked" || node.status === "care")
    ?? null;
}

function activeProjectTasks(home: AtlasUniversalHomeModel, projectId: string) {
  return home.projectTasks
    .filter((task) => task.projectId === projectId && (task.status === "open" || task.status === "blocked"))
    .sort((left, right) => {
      const leftBlocked = left.status === "blocked" ? 0 : 1;
      const rightBlocked = right.status === "blocked" ? 0 : 1;
      return leftBlocked - rightBlocked
        || (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
        || left.title.localeCompare(right.title);
    });
}

function currentTask(home: AtlasUniversalHomeModel, project: AtlasPortfolioProject) {
  const trailTaskId = project.trail?.currentMove?.taskId ?? null;
  const tasks = activeProjectTasks(home, project.projectId);
  return tasks.find((task) => task.taskId === trailTaskId) ?? tasks[0] ?? null;
}

function projectTaskHref(project: AtlasPortfolioProject, task: AtlasUniversalProjectTask | null) {
  if (project.trail?.currentMove?.href && (!task || project.trail.currentMove.taskId === task.taskId)) {
    return project.trail.currentMove.href;
  }
  if (!task) return null;
  const returnTo = `/project/${project.projectId}`;
  return `/task-focus/${encodeURIComponent(task.taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function projectTouchesFarm(project: AtlasPortfolioProject, farmId: string) {
  return project.farmId === farmId || project.targets.some((target) => target.farmId === farmId);
}

function projectTouchesRow(project: AtlasPortfolioProject, row: MatrixRow) {
  if (row.kind === "farm" && row.farmId) return projectTouchesFarm(project, row.farmId);
  const targetFarmIds = new Set(project.targets.map((target) => target.farmId).filter(Boolean));
  return project.projectKind !== "farm" || !project.farmId || targetFarmIds.size !== 1;
}

function matrixRows(home: AtlasUniversalHomeModel) {
  const rows = new Map<string, MatrixRow>();
  const organizationName = home.organizationHome?.organization.name || "Feast Guild";
  const hasOrganizationWork = home.projects.some((project) => {
    const targetFarmIds = new Set(project.targets.map((target) => target.farmId).filter(Boolean));
    return project.projectKind !== "farm" || !project.farmId || targetFarmIds.size !== 1;
  });

  if (hasOrganizationWork) {
    rows.set("organization", {
      key: "organization",
      kind: "organization",
      label: organizationName,
      detail: "Cross-farm and Guild work",
      farmId: null,
      openCount: home.projectTasks.filter((task) => task.status === "open" || task.status === "blocked").length,
      blockedCount: home.projectTasks.filter((task) => task.status === "blocked").length,
    });
  }

  home.organizationHome?.farms.forEach((farm) => {
    const scope = home.farms.find((item) => item.farmId === farm.farmId) ?? null;
    rows.set(farm.farmId, {
      key: `farm:${farm.farmId}`,
      kind: "farm",
      label: farm.farmName,
      detail: scope ? `${scope.openTaskCount} farm tasks` : `${farm.projects.length} visible projects`,
      farmId: farm.farmId,
      openCount: scope?.openTaskCount ?? 0,
      blockedCount: scope?.blockedTaskCount ?? 0,
    });
  });

  home.farms.forEach((farm) => {
    rows.set(farm.farmId, {
      key: `farm:${farm.farmId}`,
      kind: "farm",
      label: farm.farmName,
      detail: `${farm.openTaskCount} farm tasks`,
      farmId: farm.farmId,
      openCount: farm.openTaskCount,
      blockedCount: farm.blockedTaskCount,
    });
  });

  return [...rows.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "organization" ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

function attentionItems(home: AtlasUniversalHomeModel) {
  const items: MatrixAttention[] = [];
  const seen = new Set<string>();
  const today = home.window.doneDate;

  const add = (item: MatrixAttention) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    items.push(item);
  };

  home.attention.forEach((attention) => {
    add({
      key: `${attention.projectId}:attention:${attention.attentionId ?? attention.kind}`,
      projectId: attention.projectId,
      kind: attention.kind === "blocked" ? "blocked" : attention.kind === "review" || attention.kind === "decision" ? "review" : "attention",
      label: titleCase(attention.kind),
      title: attention.title,
      detail: attention.detail || attention.projectTitle,
      href: `/project/${encodeURIComponent(attention.projectId)}`,
      dueDate: attention.dueDate,
    });
  });

  home.projects.forEach((project) => {
    const node = currentNode(project);
    const task = currentTask(home, project);
    const taskHref = projectTaskHref(project, task);
    const explicitBlocker = project.trail?.blocker;

    if ((project.health === "blocked" || project.blockedTaskCount > 0) && !home.attention.some((item) => item.projectId === project.projectId && item.kind === "blocked")) {
      add({
        key: `${project.projectId}:blocked`,
        projectId: project.projectId,
        kind: "blocked",
        label: "Blocked",
        title: project.title,
        detail: explicitBlocker?.detail || explicitBlocker?.title || task?.blockerText || "The current project move is blocked.",
        href: taskHref || `/project/${encodeURIComponent(project.projectId)}`,
        dueDate: task?.dueDate || project.targetDate,
      });
    }

    if (project.trail && node && project.health !== "complete" && !project.trail.currentMove && !task) {
      add({
        key: `${project.projectId}:missing_task`,
        projectId: project.projectId,
        kind: "missing_task",
        label: "Needs task",
        title: project.title,
        detail: `${node.label} has no released current task.`,
        href: `/project/${encodeURIComponent(project.projectId)}`,
        dueDate: project.targetDate,
      });
    }

    if ((node?.nodeKind === "review" || node?.nodeKind === "decision" || project.health === "waiting") && project.health !== "complete") {
      add({
        key: `${project.projectId}:review`,
        projectId: project.projectId,
        kind: "review",
        label: node?.nodeKind === "decision" ? "Decision" : "Review",
        title: project.title,
        detail: task?.title || node?.label || project.currentMilestone || "This project is waiting for review.",
        href: taskHref || `/project/${encodeURIComponent(project.projectId)}`,
        dueDate: task?.dueDate || project.targetDate,
      });
    }
  });

  home.projectTasks
    .filter((task) => (task.status === "open" || task.status === "blocked") && Boolean(task.dueDate && task.dueDate < today))
    .forEach((task) => {
      const project = home.projects.find((candidate) => candidate.projectId === task.projectId);
      if (!project) return;
      add({
        key: `${task.projectId}:overdue:${task.taskId}`,
        projectId: task.projectId,
        kind: "overdue",
        label: "Overdue",
        title: task.title,
        detail: project.title,
        href: projectTaskHref(project, task) || `/project/${encodeURIComponent(task.projectId)}`,
        dueDate: task.dueDate,
      });
    });

  const rank: Record<MatrixAttention["kind"], number> = {
    blocked: 0,
    missing_task: 1,
    review: 2,
    overdue: 3,
    attention: 4,
  };
  return items.sort((left, right) => rank[left.kind] - rank[right.kind]
    || (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
    || left.title.localeCompare(right.title));
}

function MatrixCell({
  home,
  project,
  row,
}: {
  home: AtlasUniversalHomeModel;
  project: AtlasPortfolioProject;
  row: MatrixRow;
}) {
  if (!projectTouchesRow(project, row)) {
    return <div className={styles.emptyCell} aria-label={`${project.title} is not in ${row.label}`}><span aria-hidden="true">—</span></div>;
  }

  const state = projectState(project);
  const node = currentNode(project);
  const task = currentTask(home, project);
  const taskHref = projectTaskHref(project, task);
  const blocker = project.trail?.blocker;
  const projectHref = `/project/${encodeURIComponent(project.projectId)}`;
  const missingTask = Boolean(project.trail && node && project.health !== "complete" && !project.trail.currentMove && !task);
  const position = node?.label || project.currentMilestone || project.outcome || "Current position not set";
  const next = project.trail?.nextNode?.label ?? null;
  const lastMoved = prettyDate(project.lastMovementAt);

  return (
    <article className={styles.cell} data-matrix-state={missingTask ? "missing_task" : state}>
      <div className={styles.cellTopline}>
        <span>{titleCase(project.workstream)}</span>
        <AtlasStateBadge state={missingTask ? "attention" : state}>{missingTask ? "Needs task" : stateLabel(state)}</AtlasStateBadge>
      </div>
      <strong>{position}</strong>
      {next ? <small>Next · {next}</small> : null}
      <p>{task ? task.title : missingTask ? "No task released for this Trail point." : project.outcome || "No current task."}</p>
      {blocker ? <em>{blocker.detail || blocker.title}</em> : task?.blockerText ? <em>{task.blockerText}</em> : null}
      <div className={styles.cellMeta}>
        {task?.dueDate ? <span>Due {prettyDate(task.dueDate)}</span> : null}
        {lastMoved ? <span>Moved {lastMoved}</span> : null}
      </div>
      <footer>
        <Link href={projectHref}>Project</Link>
        {taskHref ? <Link href={taskHref}>Current task</Link> : null}
      </footer>
    </article>
  );
}

export default function AtlasPortfolioMatrix({ home }: { home: AtlasUniversalHomeModel }) {
  const rows = matrixRows(home);
  const projects = home.projects;
  const attention = attentionItems(home);
  const blockedCount = projects.filter((project) => projectState(project) === "blocked").length;
  const movingCount = projects.filter((project) => projectState(project) === "moving").length;
  const missingTaskCount = projects.filter((project) => {
    const node = currentNode(project);
    return Boolean(project.trail && node && project.health !== "complete" && !project.trail.currentMove && !currentTask(home, project));
  }).length;
  const reviewCount = attention.filter((item) => item.kind === "review").length;
  const gridTemplateColumns = `minmax(116px, 0.72fr) repeat(${Math.max(projects.length, 1)}, minmax(190px, 1fr))`;

  if (!projects.length) return null;

  return (
    <AtlasCard as="section" id="portfolio-matrix" className={styles.root} ariaLabelledBy="portfolio-matrix-title">
      <AtlasSectionHeading
        kicker="Bird's-eye view"
        title="Portfolio Matrix"
        count={projects.length}
        id="portfolio-matrix-title"
      />

      <div className={styles.summary} aria-label="Portfolio project state summary">
        <span><b>{movingCount}</b>moving</span>
        <span><b>{blockedCount}</b>blocked</span>
        <span><b>{reviewCount}</b>review or decision</span>
        <span><b>{missingTaskCount}</b>needs a task</span>
      </div>

      <section className={styles.attention} id="portfolio-attention" aria-labelledby="portfolio-attention-title">
        <header>
          <div>
            <span>Owner attention</span>
            <h3 id="portfolio-attention-title">Decisions and exceptions</h3>
          </div>
          <strong>{attention.length}</strong>
        </header>
        {attention.length ? (
          <div className={styles.attentionList}>
            {attention.slice(0, 8).map((item) => (
              <Link href={item.href} key={item.key} data-attention-kind={item.kind}>
                <span>{item.label}{item.dueDate ? ` · ${prettyDate(item.dueDate)}` : ""}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.quietAttention}>No project decision, blocker, overdue move, or missing released task needs attention.</p>
        )}
      </section>

      <div className={styles.scroller} tabIndex={0} aria-label="Farm by project portfolio matrix">
        <div className={styles.matrix} style={{ gridTemplateColumns }}>
          <div className={`${styles.matrixHeader} ${styles.corner}`}>
            <span>Farm × project</span>
            <strong>Where work is moving</strong>
          </div>
          {projects.map((project) => (
            <Link className={styles.projectHeader} href={`/project/${encodeURIComponent(project.projectId)}`} key={project.projectId}>
              <span>{titleCase(project.workstream)}</span>
              <strong>{project.title}</strong>
              <small>{project.openTaskCount} open</small>
            </Link>
          ))}

          {rows.map((row) => (
            <Fragment key={row.key}>
              <div className={styles.rowHeader}>
                <span>{row.kind === "organization" ? "Organization" : "Farm"}</span>
                <strong>{row.label}</strong>
                <small>{row.detail}{row.blockedCount ? ` · ${row.blockedCount} blocked` : ""}</small>
              </div>
              {projects.map((project) => (
                <MatrixCell home={home} project={project} row={row} key={`${row.key}:${project.projectId}`} />
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      <p className={styles.hint}>Scroll across projects. Every active intersection opens the existing project collection or its current Atlas task.</p>
    </AtlasCard>
  );
}
