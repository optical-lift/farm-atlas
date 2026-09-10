"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import styles from "./employee-surface.module.css";

type WorkerDayItem = {
  id: string;
  key: string;
  title: string;
  completed: boolean;
  institutionallyCompleted: boolean;
  reportedCompleted: boolean;
  active: boolean;
  resultContractKey: string | null;
  acceptanceMode: string | null;
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

type PotUpOutputContract = {
  cropCycleId: string;
  cropLabel: string;
  containerKind: string;
};

type PotUpContractResponse = {
  ok?: boolean;
  status?: string;
  projectionId?: string;
  instruction?: string;
  outputs?: PotUpOutputContract[];
};

type PotUpTrayDraft = {
  trayNumber: string;
  livingPlants: string;
};

type PotUpDialogState = {
  projectionId: string;
  title: string;
  instruction: string;
  outputs: PotUpOutputContract[];
  trays: Record<string, PotUpTrayDraft[]>;
  idempotencyKey: string;
};

type PilotResponse = {
  ok?: boolean;
  code?: string;
  status?: string;
  activeProjectionId?: string;
  activeTitle?: string;
  instruction?: string;
  outputs?: PotUpOutputContract[];
  [key: string]: unknown;
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

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `worker-pot-up:${crypto.randomUUID()}`;
  }
  return `worker-pot-up:${Date.now()}:${Math.random().toString(36).slice(2)}`;
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
  const [potUp, setPotUp] = useState<PotUpDialogState | null>(null);

  const allVisible = useMemo(() => items.length + extras.length, [items, extras]);

  function openTaskDrawer(item: WorkerDayItem) {
    window.dispatchEvent(
      new CustomEvent("atlas:employee-task-open", {
        detail: {
          id: item.id,
          title: item.title,
          completed: item.completed,
        },
      }),
    );
  }

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

  async function openPotUpCompletion(item: WorkerDayItem) {
    try {
      const result = (await requestPilot({
        action: "pot_up_contract",
        projectionId: item.id,
      })) as PotUpContractResponse;

      const outputs = Array.isArray(result.outputs) ? result.outputs : [];
      if (outputs.length === 0) {
        throw new Error("pot_up_contract_empty");
      }

      setPotUp({
        projectionId: item.id,
        title: item.title,
        instruction:
          result.instruction ??
          "Record every physical output tray and its actual living plant count.",
        outputs,
        trays: Object.fromEntries(
          outputs.map((output) => [
            output.cropCycleId,
            [{ trayNumber: "1", livingPlants: "" }],
          ]),
        ),
        idempotencyKey: newIdempotencyKey(),
      });
    } catch (requestError) {
      console.error(requestError);
      setError("I couldn’t open the completion record. Try again.");
    }
  }

  async function handleCompletion(item: WorkerDayItem) {
    if (!canEdit || busy || item.institutionallyCompleted) return;

    if (
      !item.reportedCompleted &&
      item.resultContractKey === "production_pot_up_v1"
    ) {
      await openPotUpCompletion(item);
      return;
    }

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

  function updatePotUpTray(
    cropCycleId: string,
    index: number,
    field: keyof PotUpTrayDraft,
    value: string,
  ) {
    setPotUp((current) => {
      if (!current) return current;
      const next = current.trays[cropCycleId].map((tray, trayIndex) =>
        trayIndex === index ? { ...tray, [field]: value } : tray,
      );
      return { ...current, trays: { ...current.trays, [cropCycleId]: next } };
    });
  }

  function addPotUpTray(cropCycleId: string) {
    setPotUp((current) => {
      if (!current) return current;
      const existing = current.trays[cropCycleId];
      return {
        ...current,
        trays: {
          ...current.trays,
          [cropCycleId]: [
            ...existing,
            { trayNumber: String(existing.length + 1), livingPlants: "" },
          ],
        },
      };
    });
  }

  function removePotUpTray(cropCycleId: string, index: number) {
    setPotUp((current) => {
      if (!current) return current;
      const existing = current.trays[cropCycleId];
      if (existing.length <= 1) return current;
      const next = existing
        .filter((_, trayIndex) => trayIndex !== index)
        .map((tray, trayIndex) => ({ ...tray, trayNumber: String(trayIndex + 1) }));
      return { ...current, trays: { ...current.trays, [cropCycleId]: next } };
    });
  }

  async function submitPotUp() {
    if (!potUp || busy) return;

    const outputs = potUp.outputs.map((output) => ({
      cropCycleId: output.cropCycleId,
      containerKind: output.containerKind,
      physicalTrays: potUp.trays[output.cropCycleId].map((tray) => ({
        trayNumber: Number(tray.trayNumber),
        livingPlants: Number(tray.livingPlants),
      })),
    }));

    const invalid = outputs.some((output) =>
      output.physicalTrays.some(
        (tray) =>
          !Number.isInteger(tray.trayNumber) ||
          tray.trayNumber <= 0 ||
          !Number.isFinite(tray.livingPlants) ||
          tray.livingPlants <= 0,
      ),
    );

    if (invalid) {
      setError("Enter the living plant count for every physical tray.");
      return;
    }

    try {
      await requestPilot({
        action: "complete_pot_up",
        projectionId: potUp.projectionId,
        outputs,
        idempotencyKey: potUp.idempotencyKey,
      });
      setPotUp(null);
      router.refresh();
    } catch (requestError) {
      console.error(requestError);
      setError("That completion did not save. Check the tray counts and try again.");
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

              <button
                type="button"
                onClick={() => openTaskDrawer(item)}
                className={`${styles.taskCopy} ${styles.taskOpenButton}`}
                aria-label={`Open ${item.title}`}
              >
                <span className={styles.taskTitle}>{item.title}</span>
                {item.reportedCompleted && !item.institutionallyCompleted && item.acceptanceMode === "manager_acceptance" ? (
                  <span className={styles.taskStatus}>reported · awaiting review</span>
                ) : null}
              </button>

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

      {potUp ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Finish ${potUp.title}`}
          className={styles.dialogScrim}
        >
          <div className={styles.dialog}>
            <div className={styles.dialogCopy}>
              <strong>{potUp.title}</strong>
              <div>{potUp.instruction}</div>
            </div>
            <div className={styles.dialogChoices}>
              {potUp.outputs.map((output) => (
                <div key={output.cropCycleId}>
                  <div className={styles.dialogCopy}>
                    <strong>{output.cropLabel}</strong> · {output.containerKind}
                  </div>
                  {potUp.trays[output.cropCycleId].map((tray, index) => (
                    <div key={`${output.cropCycleId}-${index}`} className={styles.composerActions}>
                      <span>Tray {index + 1}</span>
                      <input
                        inputMode="numeric"
                        type="number"
                        min="1"
                        step="1"
                        value={tray.livingPlants}
                        onChange={(event) =>
                          updatePotUpTray(
                            output.cropCycleId,
                            index,
                            "livingPlants",
                            event.target.value,
                          )
                        }
                        placeholder="Living plants"
                        aria-label={`${output.cropLabel} tray ${index + 1} living plants`}
                        className={styles.lineInput}
                      />
                      {potUp.trays[output.cropCycleId].length > 1 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removePotUpTray(output.cropCycleId, index)}
                          className={styles.textButton}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addPotUpTray(output.cropCycleId)}
                    className={styles.textButton}
                  >
                    + Another tray
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitPotUp()}
                className={styles.choiceButton}
              >
                Save and finish
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPotUp(null)}
                className={styles.choiceButton}
              >
                Cancel
              </button>
            </div>
          </div>
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
