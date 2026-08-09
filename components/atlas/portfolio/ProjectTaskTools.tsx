"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { AtlasProjectStep, AtlasProjectTask } from "@/lib/atlas/portfolio";
import type { AtlasTrailContext } from "@/lib/atlas/trail";

import styles from "./project.module.css";

type ProjectTaskToolsProps = {
  projectId: string;
  projectTitle: string;
  tasks: AtlasProjectTask[];
  steps: AtlasProjectStep[];
  trail: AtlasTrailContext | null;
  canCreateTasks: boolean;
  selectedTaskId?: string | null;
};

function prettyDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isCompleteTask(task: AtlasProjectTask) {
  return task.status === "done" || task.status === "skipped";
}

export default function ProjectTaskTools({
  projectId,
  projectTitle,
  tasks,
  steps,
  trail,
  canCreateTasks,
  selectedTaskId = null,
}: ProjectTaskToolsProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTaskId) return;
    const task = document.getElementById(`project-task-${selectedTaskId}`);
    if (!task) return;
    task.scrollIntoView({ behavior: "smooth", block: "center" });
    task.focus({ preventScroll: true });
  }, [selectedTaskId]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setSaving(true);

    const form = new FormData(formElement);
    const response = await fetch(`/api/atlas/projects/${encodeURIComponent(projectId)}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        dueDate: form.get("dueDate"),
        note: form.get("note"),
      }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;

    if (!response.ok) {
      setError(result?.error || "The project task could not be created.");
      setSaving(false);
      return;
    }

    formElement.reset();
    setSaving(false);
    router.refresh();
  }

  const stepByTask = useMemo(() => new Map(
    steps.filter((step) => step.linkedTaskId).map((step) => [step.linkedTaskId as string, step]),
  ), [steps]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.taskId, task])), [tasks]);
  const currentTaskId = trail?.currentMove?.taskId
    || steps.find((step) => {
      const node = trail?.nodes[step.stepOrder - 1];
      return node?.nodeId === trail?.currentNodeId || node?.status === "current" || node?.status === "blocked";
    })?.linkedTaskId
    || tasks.find((task) => task.status === "open" || task.status === "blocked")?.taskId
    || null;

  const taskTree = useMemo(() => {
    const compareTasks = (a: AtlasProjectTask, b: AtlasProjectTask) => {
      const sortDifference = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (sortDifference) return sortDifference;
      const aStep = stepByTask.get(a.taskId)?.stepOrder ?? Number.MAX_SAFE_INTEGER;
      const bStep = stepByTask.get(b.taskId)?.stepOrder ?? Number.MAX_SAFE_INTEGER;
      if (aStep !== bStep) return aStep - bStep;
      return `${a.dueDate ?? "9999-12-31"}-${a.createdAt}`.localeCompare(`${b.dueDate ?? "9999-12-31"}-${b.createdAt}`);
    };

    const primaryParentByTask = new Map<string, string>();
    for (const task of tasks) {
      const prerequisiteParents = (task.prerequisites ?? [])
        .filter((prerequisite) => taskById.has(prerequisite.taskId))
        .sort((a, b) => {
          if (a.sequenceOrder !== b.sequenceOrder) return a.sequenceOrder - b.sequenceOrder;
          const aTask = taskById.get(a.taskId);
          const bTask = taskById.get(b.taskId);
          return (aTask?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (bTask?.sortOrder ?? Number.MAX_SAFE_INTEGER);
        });
      const prerequisiteParent = prerequisiteParents[0]?.taskId ?? null;
      const structuralParent = task.parentTaskId && taskById.has(task.parentTaskId) ? task.parentTaskId : null;
      const parent = prerequisiteParent || structuralParent;
      if (parent && parent !== task.taskId) primaryParentByTask.set(task.taskId, parent);
    }

    const childrenByTask = new Map<string, AtlasProjectTask[]>();
    for (const task of tasks) {
      const parentId = primaryParentByTask.get(task.taskId);
      if (!parentId) continue;
      const children = childrenByTask.get(parentId) ?? [];
      children.push(task);
      childrenByTask.set(parentId, children);
    }
    for (const children of childrenByTask.values()) children.sort(compareTasks);

    const roots = tasks.filter((task) => !primaryParentByTask.has(task.taskId)).sort(compareTasks);
    return { roots, childrenByTask };
  }, [stepByTask, taskById, tasks]);

  const openCount = tasks.filter((task) => task.status === "open" || task.status === "blocked").length;
  const doneCount = tasks.filter((task) => task.status === "done" || task.status === "skipped").length;
  const returnTo = `/project/${encodeURIComponent(projectId)}`;

  function renderTaskNode(task: AtlasProjectTask, ancestors = new Set<string>()) {
    if (ancestors.has(task.taskId)) return null;

    const step = stepByTask.get(task.taskId);
    const complete = isCompleteTask(task);
    const current = task.taskId === currentTaskId && !complete;
    const blocked = task.status === "blocked";
    const state = blocked ? "blocked" : current ? "current" : complete ? "complete" : "future";
    const selected = task.taskId === selectedTaskId;
    const children = taskTree.childrenByTask.get(task.taskId) ?? [];
    const family = step?.title || (current ? "Current project move" : children.length ? "Priority gate" : "Project task");
    const href = `/task-focus/${encodeURIComponent(task.taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
    const assignee = task.assigneeName || (task.assignedToViewer ? "You" : "Shared");
    const waitingOn = (task.prerequisites ?? [])
      .map((prerequisite) => taskById.get(prerequisite.taskId))
      .filter((prerequisite): prerequisite is AtlasProjectTask => Boolean(prerequisite) && !isCompleteTask(prerequisite));
    const dependencyNote = waitingOn.length
      ? `Waiting on ${waitingOn.map((prerequisite) => prerequisite.title).join(" + ")}`
      : null;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(task.taskId);

    return (
      <div key={task.taskId} className="atlas-project-task-tree-node">
        <div
          id={`project-task-${task.taskId}`}
          className={`atlas-day-task-entry atlas-project-task-entry atlas-day-route-${state}${complete ? " atlas-day-complete-entry" : ""}`}
          data-project-task-selected={selected ? "true" : "false"}
          tabIndex={-1}
        >
          <span className={`atlas-day-task-node atlas-project-task-node${complete ? " is-complete" : ""}`} aria-hidden="true"><span /></span>
          <Link
            className={`atlas-day-task-card atlas-project-task-card atlas-day-route-${state}${complete ? " complete" : ""}`}
            href={href}
            aria-current={current ? "step" : undefined}
          >
            <div className="atlas-project-task-card-head">
              <small className="atlas-day-task-family">{current ? `Current · ${family}` : blocked ? `Blocked · ${family}` : complete ? `Complete · ${family}` : family}</small>
              <span className="atlas-project-task-badges">
                <b className="atlas-project-task-assignee">{assignee}</b>
                {children.length ? <b className="atlas-project-task-unlocks">Unlocks {children.length}</b> : null}
              </span>
            </div>
            <strong>{task.title}</strong>
            <span>{titleCase(task.status)}{task.dueDate ? ` · ${prettyDate(task.dueDate)}` : ""}</span>
            {dependencyNote ? <em>{dependencyNote}</em> : task.blockerText ? <em>{task.blockerText}</em> : task.note ? <em>{task.note}</em> : null}
          </Link>
        </div>

        {children.length ? (
          <div className="atlas-project-task-children" aria-label={`Tasks unlocked by ${task.title}`}>
            {children.map((child) => (
              <div key={child.taskId} className="atlas-project-task-child-branch">
                {renderTaskNode(child, nextAncestors)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <section className="atlas-project-task-collection" aria-labelledby="project-work-title">
        <div className="atlas-project-task-collection-head">
          <div>
            <span>Project tasks</span>
            <h2 id="project-work-title">Work order</h2>
          </div>
          <strong>{openCount} open</strong>
        </div>

        {taskTree.roots.length ? (
          <div className="atlas-day-route-spine atlas-project-route-spine atlas-project-task-tree" aria-label={`${projectTitle} task work order`}>
            {taskTree.roots.map((task) => renderTaskNode(task))}
          </div>
        ) : (
          <p className={styles.emptyState}>No project tasks yet.</p>
        )}

        <div className="atlas-project-task-totals"><span>{doneCount} complete</span><span>{openCount} open</span></div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      {canCreateTasks ? (
        <details className={styles.createDetails}>
          <summary>
            <span>+</span>
            <strong>Add work for myself</strong>
          </summary>
          <section className={styles.createSection} aria-labelledby="create-project-task-title">
            <div className={styles.sectionHeading}>
              <div>
                <span>Originate work</span>
                <h2 id="create-project-task-title">New project task</h2>
              </div>
            </div>
            <form onSubmit={createTask} className={styles.taskForm}>
              <label>
                <span>Task</span>
                <input name="title" required placeholder="What needs to move next?" />
              </label>
              <label>
                <span>Due date</span>
                <input name="dueDate" type="date" />
              </label>
              <label className={styles.noteField}>
                <span>Working note</span>
                <textarea name="note" rows={3} placeholder="Optional context or intended result" />
              </label>
              <button type="submit" disabled={saving}>
                {saving ? "Adding…" : "Add to this project"}
              </button>
            </form>
          </section>
        </details>
      ) : null}
    </>
  );
}
