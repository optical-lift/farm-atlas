"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import styles from "./employee-surface.module.css";

type WorkerDayItem = {
  id: string;
  key: string;
  title: string;
  details: string[];
  completed: boolean;
  institutionallyCompleted: boolean;
  reportedCompleted: boolean;
  active: boolean;
};

type WorkerDayExtra = {
  id: string;
  key: string;
  title: string;
};

type ConflictState = {
  targetProjectionId: string;
  activeTitle: string;
  choosingStopTime: boolean;
};

type PilotResponse = {
  ok?: boolean;
  code?: string;
  status?: string;
  activeProjectionId?: string;
  activeTitle?: string;
};

function currentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function todayAtTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const when = new Date();
  when.setHours(hours, minutes, 0, 0);
  return when.toISOString();
}

function TaskMark({ completed }: { completed: boolean }) {
  return (
    <svg className={styles.taskMark} viewBox="0 0 22 22" aria-hidden="true">
      {completed ? (
        <>
          <circle cx="11" cy="11" r="7.25" fill="#181713" opacity="0.78" />
          <path
            d="M5.5 11.1c1.8-3.6 7.4-6.8 10.9-2.4 2.3 2.9.3 7.1-3 8.2-4.2 1.4-8.8-1.8-7.9-5.8Z"
            fill="none"
            stroke="#181713"
            strokeWidth="0.8"
            opacity="0.32"
          />
        </>
      ) : (
        <path
          d="M5.3 11.3c.2-4.1 3.1-7.2 6.8-7.1 3.9.1 6.7 3.3 6.3 7.1-.4 3.8-3.4 6.7-7.2 6.5-3.9-.2-6.1-3.1-5.9-6.5Z"
          fill="none"
          stroke="#181713"
          strokeWidth="1.05"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export default function AnnaWorkerDayClient({
  items,
  extras,
  canEdit,
}: {
  items: WorkerDayItem[];
  extras: WorkerDayExtra[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [stopTime, setStopTime] = useState(currentTimeValue);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraTitle, setExtraTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const allVisible = useMemo(() => items.length + extras.length, [items, extras]);

  async function requestPilot(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/anna/pilot", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as PilotResponse;
      if (response.status === 409 && result.code === "attention_conflict") {
        return result;
      }

      if (!response.ok || result.ok !== true) {
        throw new Error(result.code ?? "pilot_request_failed");
      }

      return result;
    } finally {
      setBusy(false);
    }
  }

  async function finishMutation(payload: Record<string, unknown>) {
    try {
      const result = await requestPilot(payload);
      if (result?.code === "attention_conflict") {
        setConflict({
          targetProjectionId: String(payload.projectionId),
          activeTitle: result.activeTitle ?? "Previous task",
          choosingStopTime: false,
        });
        setStopTime(currentTimeValue());
        return;
      }

      setConflict(null);
      router.refresh();
    } catch (requestError) {
      console.error(requestError);
      setError("That change did not save. Try again.");
    }
  }

  async function handleCompletion(item: WorkerDayItem) {
    if (!canEdit || busy || item.institutionallyCompleted) return;

    await finishMutation({
      action: item.reportedCompleted ? "reopen" : "done",
      projectionId: item.id,
      effectiveAt: new Date().toISOString(),
    });
  }

  async function handleAttention(item: WorkerDayItem) {
    if (!canEdit || busy || item.completed) return;

    await finishMutation({
      action: item.active ? "stop" : "start",
      projectionId: item.id,
      effectiveAt: new Date().toISOString(),
    });
  }

  async function resolveConflict(action: "switch_finish" | "switch_stop", effectiveAt?: string) {
    if (!conflict) return;

    await finishMutation({
      action,
      projectionId: conflict.targetProjectionId,
      effectiveAt: effectiveAt ?? new Date().toISOString(),
    });
  }

  async function addExtra() {
    const title = extraTitle.trim();
    if (!title || busy) return;

    try {
      await requestPilot({
        action: "report_unscheduled",
        reportedTitle: title,
        effectiveAt: new Date().toISOString(),
      });
      setExtraTitle("");
      setExtraOpen(false);
      router.refresh();
    } catch (requestError) {
      console.error(requestError);
      setError("That did not save. Try again.");
    }
  }

  return (
    <>
      <div className={styles.taskList}>
        {items.map((item) => (
          <div
            key={item.key}
            data-anna-task-key={item.key}
            data-worker-projection-id={item.id}
            className={`${styles.task}${item.completed ? ` ${styles.completed}` : ""}`}
          >
            <div className={styles.taskMain}>
              {canEdit && !item.institutionallyCompleted ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={item.completed ? `Reopen ${item.title}` : `Mark ${item.title} done`}
                  onClick={() => void handleCompletion(item)}
                  className={styles.taskMarkButton}
                >
                  <TaskMark completed={item.completed} />
                </button>
              ) : (
                <span className={styles.taskMarkStatic}>
                  <TaskMark completed={item.completed} />
                </span>
              )}

              <div className={styles.taskCopy}>
                <span className={styles.taskTitle}>{item.title}</span>
                {item.details.length > 0 ? (
                  <div className={styles.taskDetails}>
                    {item.details.map((detail, index) => (
                      <span key={`${item.key}-detail-${index}`}>{detail}</span>
                    ))}
                  </div>
                ) : null}
              </div>

              {canEdit && !item.completed ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={item.active ? `Stop working on ${item.title}` : `Work on ${item.title}`}
                  onClick={() => void handleAttention(item)}
                  className={styles.attentionButton}
                >
                  {item.active ? <span className={styles.attentionMark} aria-hidden="true" /> : null}
                </button>
              ) : item.active ? (
                <span className={styles.attentionMark} aria-hidden="true" />
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          </div>
        ))}

        {extras.map((extra) => (
          <div key={extra.key} className={styles.extra}>
            <span className={styles.taskMarkStatic}>
              <TaskMark completed />
            </span>
            <span className={styles.extraTitle}>{extra.title}</span>
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className={styles.addArea} style={{ marginTop: allVisible > 0 ? undefined : 0 }}>
          {extraOpen ? (
            <div className={styles.extraComposer}>
              <input
                autoFocus
                value={extraTitle}
                onChange={(event) => setExtraTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addExtra();
                  }
                }}
                placeholder="What did you do?"
                aria-label="Something I did"
                className={styles.lineInput}
              />
              <div className={styles.composerActions}>
                <button
                  type="button"
                  disabled={busy || !extraTitle.trim()}
                  onClick={() => void addExtra()}
                  className={styles.textButton}
                >
                  Add
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setExtraOpen(false);
                    setExtraTitle("");
                  }}
                  className={styles.textButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setExtraOpen(true)}
              className={styles.textButton}
            >
              + Add something I did
            </button>
          )}
        </div>
      ) : null}

      {error ? (
        <div role="status" className={styles.error}>
          {error}
        </div>
      ) : null}

      {conflict ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Previous work is still active"
          className={styles.dialogScrim}
        >
          <div className={styles.dialog}>
            {!conflict.choosingStopTime ? (
              <>
                <div className={styles.dialogCopy}>
                  <strong>{conflict.activeTitle}</strong> is still being worked on.
                </div>
                <div className={styles.dialogChoices}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveConflict("switch_finish")}
                    className={styles.choiceButton}
                  >
                    I finished it
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setConflict((current) =>
                        current ? { ...current, choosingStopTime: true } : current,
                      )
                    }
                    className={styles.choiceButton}
                  >
                    I stopped working on it
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConflict(null)}
                    className={styles.choiceButton}
                  >
                    Never mind — I’m still working on it
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.dialogCopy}>When?</div>
                <div className={styles.dialogChoices}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveConflict("switch_stop")}
                    className={styles.choiceButton}
                  >
                    Now
                  </button>
                  <input
                    type="time"
                    value={stopTime}
                    onChange={(event) => setStopTime(event.target.value)}
                    aria-label="Time I stopped"
                    className={styles.lineInput}
                  />
                  <button
                    type="button"
                    disabled={busy || !stopTime}
                    onClick={() => void resolveConflict("switch_stop", todayAtTime(stopTime))}
                    className={styles.choiceButton}
                  >
                    Use this time
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setConflict((current) =>
                        current ? { ...current, choosingStopTime: false } : current,
                      )
                    }
                    className={styles.choiceButton}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
