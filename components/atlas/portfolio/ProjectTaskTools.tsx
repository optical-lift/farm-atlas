"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import type { AtlasProjectTask } from "@/lib/atlas/portfolio";

import styles from "./project.module.css";

type ProjectTaskToolsProps = {
  projectId: string;
  tasks: AtlasProjectTask[];
  canCreateTasks: boolean;
  canCompleteAll: boolean;
};

export default function ProjectTaskTools({
  projectId,
  tasks,
  canCreateTasks,
  canCompleteAll,
}: ProjectTaskToolsProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

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

  async function completeTask(taskId: string) {
    setError("");
    setCompletingId(taskId);
    const response = await fetch(
      `/api/atlas/project-tasks/${encodeURIComponent(taskId)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error || "The project task could not be completed.");
      setCompletingId(null);
      return;
    }
    setCompletingId(null);
    router.refresh();
  }

  const activeTasks = tasks.filter((task) => task.status === "open" || task.status === "blocked");
  const finishedTasks = tasks.filter((task) => task.status !== "open" && task.status !== "blocked");

  return (
    <>
      <section className={styles.taskSection} aria-labelledby="project-work-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>Project work</span>
            <h2 id="project-work-title">On the plate</h2>
          </div>
          <strong>{activeTasks.length}</strong>
        </div>

        {activeTasks.length ? (
          <div className={styles.taskList}>
            {activeTasks.map((task) => {
              const canComplete = canCompleteAll || task.assignedToViewer;
              return (
                <article key={task.taskId} className={styles.taskCard}>
                  <div>
                    <span>{task.assignedToViewer ? "Your task" : "Project task"}</span>
                    <h3>{task.title}</h3>
                    {task.note ? <p>{task.note}</p> : null}
                    <small>
                      {task.status === "blocked" ? "Blocked" : "Open"}
                      {task.dueDate ? ` · Due ${task.dueDate}` : ""}
                    </small>
                  </div>
                  {canComplete && task.status === "open" ? (
                    <button
                      type="button"
                      onClick={() => completeTask(task.taskId)}
                      disabled={completingId === task.taskId}
                    >
                      {completingId === task.taskId ? "Saving…" : "Done"}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className={styles.emptyState}>No open project work.</p>
        )}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      {canCreateTasks ? (
        <section className={styles.createSection} aria-labelledby="create-project-task-title">
          <div className={styles.sectionHeading}>
            <div>
              <span>Originate work</span>
              <h2 id="create-project-task-title">Add work for myself</h2>
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
      ) : null}

      {finishedTasks.length ? (
        <details className={styles.finishedSection}>
          <summary>Completed work · {finishedTasks.length}</summary>
          <div className={styles.finishedList}>
            {finishedTasks.map((task) => <p key={task.taskId}>{task.title}</p>)}
          </div>
        </details>
      ) : null}
    </>
  );
}
