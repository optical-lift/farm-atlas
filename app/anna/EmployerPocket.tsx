"use client";

import { useEffect, useState } from "react";

import styles from "./employee-surface.module.css";

export type EmployerPocketItem = {
  label: string;
  title: string;
  detail: string;
};

type WorkerDayDrawerItem = {
  id: string;
  title: string;
  completed: boolean;
};

type WorkerDayTaskGuide = {
  id: string;
  title: string;
  completed: boolean;
  details: string[];
};

export default function EmployerPocket({
  items,
  taskItems = [],
}: {
  items: EmployerPocketItem[];
  taskItems?: WorkerDayTaskGuide[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkerDayDrawerItem | null>(null);

  useEffect(() => {
    function handleTaskOpen(event: Event) {
      const detail = (event as CustomEvent<WorkerDayDrawerItem>).detail;
      if (!detail || typeof detail.title !== "string") return;
      setSelectedTask(detail);
      setOpen(true);
    }

    window.addEventListener("atlas:employee-task-open", handleTaskOpen);
    return () => window.removeEventListener("atlas:employee-task-open", handleTaskOpen);
  }, []);

  const selectedTaskGuide = selectedTask
    ? taskItems.find((item) => item.id === selectedTask.id) ?? null
    : null;
  const drawerLabel = selectedTask ? "Task" : "This Week";

  function toggleDrawer() {
    if (open) {
      setOpen(false);
      window.setTimeout(() => setSelectedTask(null), 420);
      return;
    }

    setOpen(true);
  }

  return (
    <div className={`${styles.pocketViewport}${open ? ` ${styles.pocketViewportOpen}` : ""}`}>
      <section className={styles.pocketSheet} aria-label={selectedTask ? selectedTask.title : "This week at Elm"}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="elm-employer-pocket"
          onClick={toggleDrawer}
          className={styles.pocketToggle}
        >
          <span className={styles.pocketHandle} aria-hidden="true" />
          <span className={styles.pocketHeading}>
            <span className={styles.pocketLabel}>{drawerLabel}</span>
            <span className={styles.pocketCount}>
              {selectedTask ? (selectedTask.completed ? "Done" : "Today") : items.length}
            </span>
          </span>
        </button>

        <div id="elm-employer-pocket" className={styles.pocketBody}>
          {selectedTask ? (
            <div className={styles.taskDrawer}>
              <div className={styles.taskDrawerTitle}>{selectedTask.title}</div>

              {selectedTaskGuide?.details.length ? (
                <div className={styles.taskDrawerDetails}>
                  {selectedTaskGuide.details.map((detail) => (
                    <div key={detail}>{detail}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className={styles.pocketRows}>
                {items.map((item) => (
                  <article key={`${item.label}-${item.title}`} className={styles.pocketRow}>
                    <div className={styles.pocketRowLabel}>{item.label}</div>
                    <div className={styles.pocketRowTitle}>{item.title}</div>
                    <div className={styles.pocketRowDetail}>{item.detail}</div>
                  </article>
                ))}
              </div>

              <div className={styles.pocketActions} aria-label="Worker reporting preview">
                <button type="button" className={styles.pocketActionButton}>
                  Log a problem
                </button>
                <button type="button" className={styles.pocketActionButton}>
                  Log a completed task
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
