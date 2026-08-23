"use client";

import { useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import StructuredWorkResultForm from "@/components/atlas/structured-work-result-form";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stepOrder(task: AtlasTaskCard) {
  const value = task.metadata?.step_order;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 999;
}

function inputLabel(task: AtlasTaskCard) {
  return text(task.metadata?.checklist_label)
    || text(task.metadata?.network_input_label)
    || text(task.metadata?.display_subject)
    || task.title.replace(/^Checklist\s+—\s+/i, "");
}

function currentDone(task: AtlasTaskCard) {
  return task.status === "done" || text(task.metadata?.checklist_status) === "done";
}

export default function NetworkInputsTaskDetail({ task, childTasks, assignee }: Props) {
  const inputs = useMemo(
    () => [...childTasks].sort((a, b) => stepOrder(a) - stepOrder(b) || inputLabel(a).localeCompare(inputLabel(b))),
    [childTasks],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  const [doneById, setDoneById] = useState<Record<string, boolean>>(() => Object.fromEntries(
    inputs.map((input) => [input.task_id, currentDone(input)]),
  ));

  async function toggleDone(input: AtlasTaskCard, shellBusy: boolean) {
    if (shellBusy || closing || savingId) return;
    const nextDone = !(doneById[input.task_id] ?? currentDone(input));
    try {
      setSavingId(input.task_id);
      setMessageById((current) => ({ ...current, [input.task_id]: "" }));
      await postAtlasTaskTransition({
        taskId: input.task_id,
        transition: nextDone ? "checklist_done" : "checklist_open",
        laneKey: "checklist",
        workKey: nextDone ? "checked" : "reopened",
        payload: {
          completion_source: "network_input_checklist",
          parent_task_id: task.task_id,
          input_key: text(input.metadata?.network_input_key),
        },
      });
      setDoneById((current) => ({ ...current, [input.task_id]: nextDone }));
    } catch (error) {
      setMessageById((current) => ({
        ...current,
        [input.task_id]: error instanceof Error ? error.message : "Could not update this input.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function finishTask({
    task: currentTask,
    assignee: currentAssignee,
    assembly,
    busy,
    returnHref,
  }: AssignedTaskResultInstrumentContext) {
    const moveBlocked =
      busy ||
      closing ||
      Boolean(savingId) ||
      !assembly ||
      assembly.readiness.status === "blocked" ||
      assembly.spine.connection === "stops_at_move";
    if (moveBlocked) return;

    try {
      setClosing(true);
      setTaskMessage(null);
      await postAtlasTaskTransition({
        taskId: currentTask.task_id,
        transition: "done",
        laneKey: currentTask.action_key || "network",
        workKey: currentTask.action_key || "network",
        payload: { assigneeKey: currentAssignee.key },
      });
      window.location.assign(returnHref);
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : "Could not finish this task.");
    } finally {
      setClosing(false);
    }
  }

  function methodInstrument({ busy }: AssignedTaskInstrumentContext) {
    const methodBusy = busy || closing || Boolean(savingId);
    return (
      <>
        <section className="atlas-network-inputs" aria-label="Source research" data-atlas-method-instrument="network-inputs">
          <h2>Sources</h2>
          <div className="atlas-network-inputs__list">
            {inputs.map((input) => {
              const done = doneById[input.task_id] ?? currentDone(input);
              const open = openId === input.task_id;
              const message = messageById[input.task_id] ?? "";

              return (
                <article className={`atlas-network-input${done ? " is-done" : ""}${open ? " is-open" : ""}`} key={input.task_id}>
                  <div className="atlas-network-input__row">
                    <button
                      type="button"
                      className="atlas-network-input__check"
                      aria-label={done ? `Reopen ${inputLabel(input)}` : `Complete ${inputLabel(input)}`}
                      aria-pressed={done}
                      disabled={methodBusy}
                      onClick={() => void toggleDone(input, busy)}
                    >
                      {done ? "✓" : ""}
                    </button>
                    <button
                      type="button"
                      className="atlas-network-input__open"
                      aria-expanded={open}
                      disabled={methodBusy}
                      onClick={() => setOpenId(open ? null : input.task_id)}
                    >
                      <strong>{inputLabel(input)}</strong>
                      <small>Sources</small>
                    </button>
                  </div>

                  {open ? (
                    <div className="atlas-network-input__result">
                      <StructuredWorkResultForm taskId={input.task_id} heading="Source" submitLabel="Save source" />
                    </div>
                  ) : message ? <p className="atlas-network-input__message" aria-live="polite">{message}</p> : null}
                </article>
              );
            })}
          </div>
        </section>
        <style>{networkInputsStyles}</style>
      </>
    );
  }

  function resultInstrument(context: AssignedTaskResultInstrumentContext) {
    const moveBlocked =
      context.busy ||
      closing ||
      Boolean(savingId) ||
      !context.assembly ||
      context.assembly.readiness.status === "blocked" ||
      context.assembly.spine.connection === "stops_at_move";
    const resultBusy = context.busy || closing || Boolean(savingId);

    return (
      <section data-atlas-result-instrument="network-inputs">
        <div className="atlas-task-result-actions atlas-task-result-actions-simple">
          <button type="button" className="done" disabled={moveBlocked} onClick={() => void finishTask(context)}>
            {closing ? "Finishing" : "Done"}
          </button>
          <button type="button" className="unfinished" disabled={resultBusy} onClick={() => window.location.assign(context.returnHref)}>
            Unfinished
          </button>
        </div>
        {taskMessage ? <p className="atlas-network-task-message" aria-live="polite">{taskMessage}</p> : null}
      </section>
    );
  }

  return (
    <AssignedTaskExecutionShell
      task={task}
      childTasks={[]}
      assignee={assignee}
      methodInstrument={methodInstrument}
      resultInstrument={resultInstrument}
    />
  );
}

const networkInputsStyles = `
  .atlas-network-inputs { padding: 22px 18px 8px; border-top: 1px solid var(--atlas-border); }
  .atlas-network-inputs h2 { margin: 0 0 14px; color: #858bb8; font-size: 14px; line-height: 1; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
  .atlas-network-inputs__list { display: grid; gap: 12px; }
  .atlas-network-input { overflow: hidden; border: 1px solid rgba(139,145,194,.22); border-radius: 22px; background: rgba(255,255,255,.82); }
  .atlas-network-input.is-done { background: rgba(228,234,200,.48); }
  .atlas-network-input__row { display: grid; grid-template-columns: 54px minmax(0,1fr); align-items: stretch; min-height: 92px; }
  .atlas-network-input__check { align-self: center; justify-self: center; width: 42px; height: 42px; padding: 0; border: 4px solid rgba(139,145,194,.24); border-radius: 999px; background: rgba(255,255,255,.45); color: #686b7d; font-size: 25px; line-height: 1; font-weight: 950; touch-action: manipulation; }
  .atlas-network-input.is-done .atlas-network-input__check { border-color: rgba(185,204,124,.9); background: rgba(222,233,183,.96); }
  .atlas-network-input__open { min-width: 0; padding: 16px 18px 16px 8px; border: 0; background: transparent; color: var(--atlas-text); text-align: left; touch-action: manipulation; }
  .atlas-network-input__open strong { display: block; font-size: 22px; line-height: 1.06; font-weight: 950; letter-spacing: -.035em; }
  .atlas-network-input__open small { display: block; margin-top: 7px; color: var(--atlas-purple-dark); font-size: 12px; line-height: 1.2; font-weight: 900; letter-spacing: .02em; }
  .atlas-network-input__check:focus-visible, .atlas-network-input__open:focus-visible { outline: 3px solid rgba(85,90,134,.38); outline-offset: -3px; }
  .atlas-network-input__result { margin: 0 12px 12px; }
  .atlas-network-input__message, .atlas-network-task-message { margin: 0; color: #835345; font-size: 12px; line-height: 1.25; font-weight: 850; }
  .atlas-network-input__message { padding: 0 18px 14px 62px; }
  .atlas-network-task-message { padding: 12px 4px 0; text-align: center; }
  .atlas-network-input button:disabled { opacity: .58; }
  @media (max-width: 430px) {
    .atlas-network-inputs { padding: 20px 12px 8px; }
    .atlas-network-input__row { grid-template-columns: 52px minmax(0,1fr); }
    .atlas-network-input__open { padding-right: 14px; }
    .atlas-network-input__open strong { font-size: 21px; }
  }
`;
