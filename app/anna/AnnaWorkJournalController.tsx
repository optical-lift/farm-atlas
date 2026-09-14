"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import EmployeeWorkJournalClient from "@/components/employee/EmployeeWorkJournalClient";
import journalStyles from "@/components/employee/EmployeeWorkJournal.module.css";
import type {
  EmployeeWorkJournalDay,
  EmployeeWorkJournalEntry,
} from "@/lib/employee-work-journal";

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

export default function AnnaWorkJournalController({
  journal,
  canEdit,
}: {
  journal: EmployeeWorkJournalDay;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [stopTime, setStopTime] = useState(currentTimeValue);
  const [potUp, setPotUp] = useState<PotUpDialogState | null>(null);

  async function requestPilot(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/anna/pilot", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
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
          activeTitle: result.activeTitle ?? "Previous work",
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

  async function openPotUpCompletion(entry: EmployeeWorkJournalEntry) {
    try {
      const result = (await requestPilot({
        action: "pot_up_contract",
        projectionId: entry.id,
      })) as PotUpContractResponse;

      const outputs = Array.isArray(result.outputs) ? result.outputs : [];
      if (outputs.length === 0) throw new Error("pot_up_contract_empty");

      setPotUp({
        projectionId: entry.id,
        title: entry.title,
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

  async function handleCompletion(entry: EmployeeWorkJournalEntry) {
    if (!canEdit || busy || entry.completion.institutionallyComplete) return;

    if (
      entry.state !== "reported_complete" &&
      entry.completion.resultContractKey === "production_pot_up_v1"
    ) {
      await openPotUpCompletion(entry);
      return;
    }

    await finishMutation({
      action: entry.state === "reported_complete" ? "reopen" : "done",
      projectionId: entry.id,
      effectiveAt: new Date().toISOString(),
    });
  }

  async function handleAttention(entry: EmployeeWorkJournalEntry) {
    if (!canEdit || busy || entry.state === "complete" || entry.state === "reported_complete") return;

    await finishMutation({
      action: entry.state === "active" ? "stop" : "start",
      projectionId: entry.id,
      effectiveAt: new Date().toISOString(),
    });
  }

  async function addReportedWork(title: string) {
    if (!canEdit || busy) return;
    try {
      await requestPilot({
        action: "report_unscheduled",
        reportedTitle: title,
        effectiveAt: new Date().toISOString(),
      });
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

  async function resolveConflict(
    action: "switch_finish" | "switch_stop",
    effectiveAt?: string,
  ) {
    if (!conflict) return;
    await finishMutation({
      action,
      projectionId: conflict.targetProjectionId,
      effectiveAt: effectiveAt ?? new Date().toISOString(),
    });
  }

  return (
    <>
      <EmployeeWorkJournalClient
        journal={journal}
        canEdit={canEdit}
        busy={busy}
        error={error}
        onToggleComplete={handleCompletion}
        onToggleAttention={handleAttention}
        onAddReportedWork={addReportedWork}
      />

      {potUp ? (
        <div role="dialog" aria-modal="true" className={journalStyles.dialogScrim}>
          <div className={journalStyles.dialog}>
            <div className={journalStyles.dialogCopy}>
              <strong>{potUp.title}</strong>
              <div>{potUp.instruction}</div>
            </div>
            <div className={journalStyles.dialogChoices}>
              {potUp.outputs.map((output) => (
                <div key={output.cropCycleId}>
                  <div className={journalStyles.dialogCopy}>
                    <strong>{output.cropLabel}</strong> · {output.containerKind}
                  </div>
                  {potUp.trays[output.cropCycleId].map((tray, index) => (
                    <div key={`${output.cropCycleId}-${index}`} className={journalStyles.composerActions}>
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
                        className={journalStyles.lineInput}
                      />
                      {potUp.trays[output.cropCycleId].length > 1 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removePotUpTray(output.cropCycleId, index)}
                          className={journalStyles.textButton}
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
                    className={journalStyles.textButton}
                  >
                    + Another tray
                  </button>
                </div>
              ))}
              <button type="button" disabled={busy} onClick={() => void submitPotUp()} className={journalStyles.choiceButton}>
                Save and finish
              </button>
              <button type="button" disabled={busy} onClick={() => setPotUp(null)} className={journalStyles.choiceButton}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div role="dialog" aria-modal="true" className={journalStyles.dialogScrim}>
          <div className={journalStyles.dialog}>
            {!conflict.choosingStopTime ? (
              <>
                <div className={journalStyles.dialogCopy}>
                  <strong>{conflict.activeTitle}</strong> is still being worked on.
                </div>
                <div className={journalStyles.dialogChoices}>
                  <button type="button" disabled={busy} onClick={() => void resolveConflict("switch_finish")} className={journalStyles.choiceButton}>
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
                    className={journalStyles.choiceButton}
                  >
                    I stopped working on it
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConflict(null)} className={journalStyles.choiceButton}>
                    Never mind — I’m still working on it
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={journalStyles.dialogCopy}>When?</div>
                <div className={journalStyles.dialogChoices}>
                  <button type="button" disabled={busy} onClick={() => void resolveConflict("switch_stop")} className={journalStyles.choiceButton}>
                    Now
                  </button>
                  <input
                    type="time"
                    value={stopTime}
                    onChange={(event) => setStopTime(event.target.value)}
                    className={journalStyles.lineInput}
                    aria-label="Time I stopped"
                  />
                  <button
                    type="button"
                    disabled={busy || !stopTime}
                    onClick={() => void resolveConflict("switch_stop", todayAtTime(stopTime))}
                    className={journalStyles.choiceButton}
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
                    className={journalStyles.choiceButton}
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
