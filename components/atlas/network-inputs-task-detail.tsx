"use client";

import { useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
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

function NetworkInputsInstrument({
  task,
  childTasks,
  busy,
}: {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  busy: boolean;
}) {
  const inputs = useMemo(
    () => [...childTasks].sort((a, b) => stepOrder(a) - stepOrder(b) || inputLabel(a).localeCompare(inputLabel(b))),
    [childTasks],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  const [doneById, setDoneById] = useState<Record<string, boolean>>(() => Object.fromEntries(
    inputs.map((input) => [input.task_id, currentDone(input)]),
  ));
  const [draftById, setDraftById] = useState<Record<string, string>>(() => Object.fromEntries(
    inputs.map((input) => [input.task_id, input.note ?? ""]),
  ));
  const [savedById, setSavedById] = useState<Record<string, string>>(() => Object.fromEntries(
    inputs.map((input) => [input.task_id, input.note ?? ""]),
  ));

  async function toggleDone(input: AtlasTaskCard) {
    if (busy) return;
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

  async function saveFindings(input: AtlasTaskCard) {
    if (busy) return;
    const note = (draftById[input.task_id] ?? "").trim();
    if (!note) {
      setMessageById((current) => ({ ...current, [input.task_id]: "Add a company or finding first." }));
      return;
    }

    try {
      setSavingId(input.task_id);
      setMessageById((current) => ({ ...current, [input.task_id]: "" }));
      await postAtlasTaskTransition({
        taskId: input.task_id,
        transition: "note",
        note,
        laneKey: "network",
        workKey: "input_findings",
        payload: {
          completion_source: "inline_subtask_note",
          note_kind: "network_input_findings",
          parent_task_id: task.task_id,
          input_key: text(input.metadata?.network_input_key),
        },
      });
      setSavedById((current) => ({ ...current, [input.task_id]: note }));
      setOpenId(null);
    } catch (error) {
      setMessageById((current) => ({
        ...current,
        [input.task_id]: error instanceof Error ? error.message : "Could not save this finding.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="atlas-network-inputs" aria-label="Disposal inputs" data-atlas-method-instrument="network-inputs">
      <h2>Checklist</h2>
      <div className="atlas-network-inputs__list">
        {inputs.map((input) => {
          const done = doneById[input.task_id] ?? currentDone(input);
          const open = openId === input.task_id;
          const saving = savingId === input.task_id;
          const saved = savedById[input.task_id] ?? "";
          const message = messageById[input.task_id] ?? "";

          return (
            <article className={`atlas-network-input${done ? " is-done" : ""}${open ? " is-open" : ""}`} key={input.task_id}>
              <div className="atlas-network-input__row">
                <button
                  type="button"
                  className="atlas-network-input__check"
                  aria-label={done ? `Reopen ${inputLabel(input)}` : `Complete ${inputLabel(input)}`}
                  aria-pressed={done}
                  disabled={saving || busy}
                  onClick={() => void toggleDone(input)}
                >
                  {done ? "✓" : ""}
                </button>
                <button
                  type="button"
                  className="atlas-network-input__open"
                  aria-expanded={open}
                  disabled={saving || busy}
                  onClick={() => setOpenId(open ? null : input.task_id)}
                >
                  <strong>{inputLabel(input)}</strong>
                  <small>Tap to log info</small>
                  {saved ? <span>{saved}</span> : null}
                </button>
              </div>

              {open ? (
                <form className="atlas-network-input__form" onSubmit={(event) => { event.preventDefault(); void saveFindings(input); }}>
                  <textarea
                    aria-label={`Companies and findings for ${inputLabel(input)}`}
                    value={draftById[input.task_id] ?? ""}
                    placeholder="Company — what they have"
                    disabled={busy}
                    onChange={(event) => {
                      setDraftById((current) => ({ ...current, [input.task_id]: event.target.value }));
                      setMessageById((current) => ({ ...current, [input.task_id]: "" }));
                    }}
                  />
                  <div className="atlas-network-input__form-actions">
                    <button type="submit" disabled={saving || busy}>{saving ? "Saving" : "Save"}</button>
                    <button type="button" disabled={saving || busy} onClick={() => setOpenId(null)}>Cancel</button>
                  </div>
                  {message ? <p aria-live="polite">{message}</p> : null}
                </form>
              ) : message ? <p className="atlas-network-input__message" aria-live="polite">{message}</p> : null}
            </article>
          );
        })}
      </div>
      <style>{`
        .atlas-network-inputs { padding: 22px 18px 8px; border-top: 1px solid var(--atlas-border); }
        .atlas-network-inputs h2 { margin: 0 0 14px; color: #858bb8; font-size: 14px; line-height: 1; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
        .atlas-network-inputs__list { display: grid; gap: 12px; }
        .atlas-network-input { overflow: hidden; border: 1px solid rgba(139,145,194,.22); border-radius: 22px; background: rgba(255,255,255,.82); }
        .atlas-network-input.is-done { background: rgba(228,234,200,.48); }
        .atlas-network-input__row { display: grid; grid-template-columns: 54px minmax(0,1fr); align-items: stretch; min-height: 104px; }
        .atlas-network-input__check { align-self: center; justify-self: center; width: 42px; height: 42px; padding: 0; border: 4px solid rgba(139,145,194,.24); border-radius: 999px; background: rgba(255,255,255,.45); color: #686b7d; font-size: 25px; line-height: 1; font-weight: 950; touch-action: manipulation; }
        .atlas-network-input.is-done .atlas-network-input__check { border-color: rgba(185,204,124,.9); background: rgba(222,233,183,.96); }
        .atlas-network-input__open { min-width: 0; padding: 18px 18px 18px 8px; border: 0; background: transparent; color: var(--atlas-text); text-align: left; touch-action: manipulation; }
        .atlas-network-input__open strong { display: block; font-size: 22px; line-height: 1.06; font-weight: 950; letter-spacing: -.035em; }
        .atlas-network-input__open small { display: block; margin-top: 7px; color: var(--atlas-purple-dark); font-size: 12px; line-height: 1.2; font-weight: 900; letter-spacing: .02em; }
        .atlas-network-input__open span { display: block; margin-top: 9px; color: var(--atlas-muted); font-size: 14px; line-height: 1.35; font-weight: 750; white-space: pre-wrap; }
        .atlas-network-input__check:focus-visible, .atlas-network-input__open:focus-visible { outline: 3px solid rgba(85,90,134,.38); outline-offset: -3px; }
        .atlas-network-input__form { display: grid; gap: 10px; margin: 0 12px 12px; padding: 12px; border: 1px solid rgba(91,99,71,.18); border-radius: 16px; background: rgba(246,242,230,.82); }
        .atlas-network-input__form textarea { width: 100%; min-height: 140px; resize: vertical; padding: 12px; border: 1px solid rgba(139,145,194,.24); border-radius: 14px; background: #fff; color: var(--atlas-text); font: inherit; font-size: 16px; line-height: 1.4; }
        .atlas-network-input__form-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .atlas-network-input__form-actions button { min-height: 48px; border: 1px solid rgba(139,145,194,.2); border-radius: 14px; background: rgba(255,255,255,.92); color: var(--atlas-text); font-weight: 950; }
        .atlas-network-input__form-actions button[type="submit"] { background: rgba(214,225,177,.78); color: #515b34; }
        .atlas-network-input__form p, .atlas-network-input__message, .atlas-network-task-message { margin: 0; color: #835345; font-size: 12px; line-height: 1.25; font-weight: 850; }
        .atlas-network-input__message { padding: 0 18px 14px 62px; }
        .atlas-network-input button:disabled, .atlas-network-input textarea:disabled { opacity: .58; }
        @media (max-width: 430px) {
          .atlas-network-inputs { padding: 20px 12px 8px; }
          .atlas-network-input__row { grid-template-columns: 52px minmax(0,1fr); min-height: 96px; }
          .atlas-network-input__open { padding-right: 14px; }
          .atlas-network-input__open strong { font-size: 21px; }
        }
      `}</style>
    </section>
  );
}

function NetworkInputsResultInstrument({
  task,
  assignee,
  assembly,
  busy,
  returnHref,
}: AssignedTaskResultInstrumentContext) {
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const blocked = busy
    || closing
    || !assembly
    || assembly.readiness.status === "blocked"
    || assembly.spine.connection === "stops_at_move";

  async function finishTask() {
    if (blocked) return;
    try {
      setClosing(true);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "done",
        laneKey: task.action_key || "network",
        workKey: task.action_key || "network",
        payload: { assigneeKey: assignee.key },
      });
      window.location.assign(returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not finish this task.");
      setClosing(false);
    }
  }

  return (
    <section data-atlas-result-instrument="network-inputs">
      <div className="atlas-task-result-actions atlas-task-result-actions-simple">
        <button type="button" className="done" disabled={blocked} onClick={() => void finishTask()}>
          {closing ? "Finishing" : "Done"}
        </button>
        <button type="button" className="unfinished" disabled={busy || closing} onClick={() => window.location.assign(returnHref)}>
          Unfinished
        </button>
      </div>
      {message ? <p className="atlas-network-task-message" aria-live="polite">{message}</p> : null}
    </section>
  );
}

export default function NetworkInputsTaskDetail({ task, childTasks, assignee }: Props) {
  const methodInstrument = ({ busy }: AssignedTaskInstrumentContext) => (
    <NetworkInputsInstrument task={task} childTasks={childTasks} busy={busy} />
  );

  return (
    <AssignedTaskExecutionShell
      task={task}
      childTasks={[]}
      assignee={assignee}
      methodInstrument={methodInstrument}
      resultInstrument={(context) => <NetworkInputsResultInstrument {...context} />}
    />
  );
}
