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

type PhoneDraft = {
  contactResult: string;
  reachedName: string;
  notes: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stepOrder(task: AtlasTaskCard) {
  const value = task.metadata?.step_order;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 999;
}

function itemLabel(task: AtlasTaskCard) {
  return text(task.metadata?.checklist_label)
    || text(task.metadata?.business_name)
    || text(task.metadata?.display_subject)
    || task.title.replace(/^Call\s+[—·-]?\s*/i, "");
}

function currentDone(task: AtlasTaskCard) {
  return task.status === "done" || text(task.metadata?.checklist_status) === "done";
}

function initialDraft(task: AtlasTaskCard): PhoneDraft {
  const saved = record(task.metadata?.phone_outreach_result);
  return {
    contactResult: text(saved.contact_result),
    reachedName: text(saved.reached_name),
    notes: text(saved.notes),
  };
}

function outcomeLabel(value: string) {
  return ({
    agreed: "Agreed to save hair",
    maybe: "Maybe / follow up",
    not_interested: "Not interested",
    voicemail: "Left voicemail",
    no_answer: "No answer",
    wrong_contact: "Wrong contact",
  } as Record<string, string>)[value] || value;
}

function reachedSomeone(value: string) {
  return ["agreed", "maybe", "not_interested", "wrong_contact"].includes(value);
}

function summaryForDraft(draft: PhoneDraft) {
  return [
    draft.contactResult ? `Result: ${outcomeLabel(draft.contactResult)}` : "",
    draft.reachedName ? `Reached: ${draft.reachedName}` : "",
    draft.notes ? `Said: ${draft.notes}` : "",
  ].filter(Boolean).join("\n");
}

function savedSummary(task: AtlasTaskCard) {
  return summaryForDraft(initialDraft(task));
}

async function postPhoneOutreach(body: Record<string, unknown>) {
  const response = await fetch("/api/atlas/phone-outreach", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-atlas-intent": "phone-outreach-v1",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: { message?: string };
  };
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || "Atlas could not save this phone call.");
  }
  return data;
}

export default function PhoneOutreachTaskDetail({ task, childTasks, assignee }: Props) {
  const contacts = useMemo(
    () => [...childTasks].sort((a, b) => stepOrder(a) - stepOrder(b) || itemLabel(a).localeCompare(itemLabel(b))),
    [childTasks],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  const [doneById, setDoneById] = useState<Record<string, boolean>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, currentDone(contact)]),
  ));
  const [draftById, setDraftById] = useState<Record<string, PhoneDraft>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, initialDraft(contact)]),
  ));
  const [savedById, setSavedById] = useState<Record<string, string>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, savedSummary(contact)]),
  ));

  function updateDraft(taskId: string, patch: Partial<PhoneDraft>) {
    const contact = contacts.find((candidate) => candidate.task_id === taskId);
    if (!contact) return;
    setDraftById((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? initialDraft(contact)), ...patch },
    }));
    setMessageById((current) => ({ ...current, [taskId]: "" }));
  }

  async function reopenContact(contact: AtlasTaskCard, shellBusy: boolean) {
    if (shellBusy || closing || savingId) return;
    try {
      setSavingId(contact.task_id);
      await postAtlasTaskTransition({
        taskId: contact.task_id,
        transition: "checklist_open",
        laneKey: "checklist",
        workKey: "reopened",
        payload: {
          completion_source: "phone_outreach_checklist",
          parent_task_id: task.task_id,
          local_intel_entity_id: text(contact.metadata?.local_intel_entity_id),
        },
      });
      setDoneById((current) => ({ ...current, [contact.task_id]: false }));
      setOpenId(contact.task_id);
    } catch (error) {
      setMessageById((current) => ({
        ...current,
        [contact.task_id]: error instanceof Error ? error.message : "Could not reopen this call.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function saveContactResult(contact: AtlasTaskCard, shellBusy: boolean) {
    if (shellBusy || closing || savingId) return;
    const draft = draftById[contact.task_id] ?? initialDraft(contact);
    if (!draft.contactResult) {
      setMessageById((current) => ({ ...current, [contact.task_id]: "Choose what happened on the call first." }));
      return;
    }
    if (reachedSomeone(draft.contactResult) && !draft.reachedName.trim()) {
      setMessageById((current) => ({ ...current, [contact.task_id]: "Add who you talked to." }));
      return;
    }
    if (reachedSomeone(draft.contactResult) && !draft.notes.trim()) {
      setMessageById((current) => ({ ...current, [contact.task_id]: "Add what they said." }));
      return;
    }

    const summary = summaryForDraft(draft);
    try {
      setSavingId(contact.task_id);
      setMessageById((current) => ({ ...current, [contact.task_id]: "" }));

      await postPhoneOutreach({
        taskId: contact.task_id,
        contactResult: draft.contactResult,
        reachedName: draft.reachedName,
        notes: draft.notes,
      });

      await postAtlasTaskTransition({
        taskId: contact.task_id,
        transition: "note",
        note: summary,
        laneKey: "network",
        workKey: "phone_call_result",
        payload: {
          completion_source: "phone_outreach_result",
          note_kind: "phone_outreach_result",
          parent_task_id: task.task_id,
          local_intel_entity_id: text(contact.metadata?.local_intel_entity_id),
          contact_result: draft.contactResult,
        },
      });

      if (!(doneById[contact.task_id] ?? currentDone(contact))) {
        await postAtlasTaskTransition({
          taskId: contact.task_id,
          transition: "checklist_done",
          laneKey: "checklist",
          workKey: "contacted",
          payload: {
            completion_source: "phone_outreach_checklist",
            parent_task_id: task.task_id,
            local_intel_entity_id: text(contact.metadata?.local_intel_entity_id),
            contact_result: draft.contactResult,
          },
        });
      }

      setSavedById((current) => ({ ...current, [contact.task_id]: summary }));
      setDoneById((current) => ({ ...current, [contact.task_id]: true }));
      setOpenId(null);
    } catch (error) {
      setMessageById((current) => ({
        ...current,
        [contact.task_id]: error instanceof Error ? error.message : "Could not save this call result.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  const allContactsDone = contacts.length > 0 && contacts.every(
    (contact) => doneById[contact.task_id] ?? currentDone(contact),
  );
  const script = text(task.metadata?.outreach_script);
  const checklistHeading = text(task.metadata?.checklist_heading) || "Calls";
  const completionLabel = text(task.metadata?.completion_label) || "Done";

  async function finishTask({
    task: currentTask,
    assignee: currentAssignee,
    assembly,
    busy,
    returnHref,
  }: AssignedTaskResultInstrumentContext) {
    if (!allContactsDone) {
      setTaskMessage("Record a result for every call before closing this task.");
      return;
    }
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
        payload: { assigneeKey: currentAssignee.key, completion_source: "phone_outreach_batch" },
      });
      window.location.assign(returnHref);
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : "Could not finish this calling task.");
    } finally {
      setClosing(false);
    }
  }

  function methodInstrument({ busy }: AssignedTaskInstrumentContext) {
    const methodBusy = busy || closing || Boolean(savingId);
    return (
      <>
        <div data-atlas-method-instrument="phone-outreach">
          <section className="atlas-phone-outreach-brief">
            {task.note ? <p className="atlas-phone-outreach-purpose">{task.note}</p> : null}
            {script ? (
              <div className="atlas-phone-outreach-script">
                <span>Call script</span>
                <p>{script}</p>
              </div>
            ) : null}
          </section>

          <section className="atlas-phone-outreach-calls" aria-label="Phone outreach checklist">
            <h2>{checklistHeading}</h2>
            <div className="atlas-phone-outreach-list">
              {contacts.map((contact) => {
                const done = doneById[contact.task_id] ?? currentDone(contact);
                const open = openId === contact.task_id;
                const saving = savingId === contact.task_id;
                const saved = savedById[contact.task_id] ?? "";
                const message = messageById[contact.task_id] ?? "";
                const draft = draftById[contact.task_id] ?? initialDraft(contact);
                const phone = text(contact.metadata?.business_phone);
                const hairType = text(contact.metadata?.hair_type_label);

                return (
                  <article className={`atlas-phone-outreach-item${done ? " is-done" : ""}${open ? " is-open" : ""}`} key={contact.task_id}>
                    <div className="atlas-phone-outreach-row">
                      <button
                        type="button"
                        className="atlas-phone-outreach-check"
                        aria-label={done ? `Log another call with ${itemLabel(contact)}` : `Log result for ${itemLabel(contact)}`}
                        aria-pressed={done}
                        disabled={methodBusy}
                        onClick={() => done ? void reopenContact(contact, busy) : setOpenId(contact.task_id)}
                      >
                        {done ? "✓" : ""}
                      </button>
                      <button
                        type="button"
                        className="atlas-phone-outreach-open"
                        aria-expanded={open}
                        disabled={methodBusy}
                        onClick={() => setOpenId(open ? null : contact.task_id)}
                      >
                        <strong>{itemLabel(contact)}</strong>
                        {phone ? <small>{phone}</small> : null}
                        {hairType ? <small>{hairType}</small> : null}
                        {saved ? <span>{saved}</span> : null}
                      </button>
                    </div>

                    {open ? (
                      <div className="atlas-phone-outreach-detail">
                        {phone ? <a className="atlas-phone-outreach-call" href={`tel:${phone.replace(/\D/g, "")}`}>Call {phone}</a> : null}
                        <form className="atlas-phone-outreach-form" onSubmit={(event) => { event.preventDefault(); void saveContactResult(contact, busy); }}>
                          <label>
                            <span>What happened?</span>
                            <select disabled={methodBusy && !saving} value={draft.contactResult} onChange={(event) => updateDraft(contact.task_id, { contactResult: event.target.value })} required>
                              <option value="">Choose a result</option>
                              <option value="agreed">Agreed to save hair</option>
                              <option value="maybe">Maybe / follow up</option>
                              <option value="not_interested">Not interested</option>
                              <option value="voicemail">Left voicemail</option>
                              <option value="no_answer">No answer</option>
                              <option value="wrong_contact">Wrong contact</option>
                            </select>
                          </label>
                          <label>
                            <span>Who did you talk to?</span>
                            <input disabled={methodBusy && !saving} value={draft.reachedName} placeholder="Name or role" onChange={(event) => updateDraft(contact.task_id, { reachedName: event.target.value })} />
                          </label>
                          <label>
                            <span>What did they say?</span>
                            <textarea disabled={methodBusy && !saving} rows={4} value={draft.notes} onChange={(event) => updateDraft(contact.task_id, { notes: event.target.value })} />
                          </label>
                          <div className="atlas-phone-outreach-actions">
                            <button type="submit" disabled={methodBusy}>{saving ? "Saving" : "Save result"}</button>
                            <button type="button" disabled={methodBusy} onClick={() => setOpenId(null)}>Cancel</button>
                          </div>
                          {message ? <p className="atlas-phone-outreach-message" aria-live="polite">{message}</p> : null}
                        </form>
                      </div>
                    ) : message ? <p className="atlas-phone-outreach-message closed" aria-live="polite">{message}</p> : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
        <style>{phoneOutreachStyles}</style>
      </>
    );
  }

  function resultInstrument(context: AssignedTaskResultInstrumentContext) {
    const resultBusy = context.busy || closing || Boolean(savingId);
    const moveBlocked =
      resultBusy ||
      !allContactsDone ||
      !context.assembly ||
      context.assembly.readiness.status === "blocked" ||
      context.assembly.spine.connection === "stops_at_move";

    return (
      <section data-atlas-result-instrument="phone-outreach">
        <div className="atlas-task-result-actions atlas-task-result-actions-simple">
          <button type="button" className="done" disabled={moveBlocked} onClick={() => void finishTask(context)}>
            {closing ? "Finishing" : completionLabel}
          </button>
          <button type="button" className="unfinished" disabled={resultBusy} onClick={() => window.location.assign(context.returnHref)}>
            Unfinished
          </button>
        </div>
        {!allContactsDone ? <p className="atlas-phone-outreach-finish-hint">Record a result for every call to finish this task.</p> : null}
        {taskMessage ? <p className="atlas-phone-outreach-message task" aria-live="polite">{taskMessage}</p> : null}
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

const phoneOutreachStyles = `
  .atlas-phone-outreach-brief { display:grid; gap:14px; padding:20px 18px 22px; border-top:1px solid var(--atlas-border); background:linear-gradient(180deg,rgba(255,255,255,.56),rgba(246,242,230,.48)); }
  .atlas-phone-outreach-purpose { margin:0; color:var(--atlas-text); font-size:17px; line-height:1.45; font-weight:800; }
  .atlas-phone-outreach-script { display:grid; gap:9px; padding:16px; border-radius:18px; background:rgba(232,235,211,.7); }
  .atlas-phone-outreach-script>span { color:#858bb8; font-size:11px; line-height:1; font-weight:950; letter-spacing:.13em; text-transform:uppercase; }
  .atlas-phone-outreach-script p { margin:0; white-space:pre-wrap; color:var(--atlas-text); font-size:15px; line-height:1.5; }
  .atlas-phone-outreach-calls { padding:22px 18px 8px; border-top:1px solid var(--atlas-border); }
  .atlas-phone-outreach-calls h2 { margin:0 0 14px; color:#858bb8; font-size:14px; line-height:1; font-weight:950; letter-spacing:.16em; text-transform:uppercase; }
  .atlas-phone-outreach-list { display:grid; gap:12px; }
  .atlas-phone-outreach-item { overflow:hidden; border:1px solid rgba(139,145,194,.22); border-radius:22px; background:rgba(255,255,255,.82); }
  .atlas-phone-outreach-item.is-done { background:rgba(228,234,200,.48); }
  .atlas-phone-outreach-row { display:grid; grid-template-columns:54px minmax(0,1fr); align-items:stretch; min-height:104px; }
  .atlas-phone-outreach-check { align-self:center; justify-self:center; width:42px; height:42px; padding:0; border:4px solid rgba(139,145,194,.24); border-radius:999px; background:rgba(255,255,255,.45); color:#686b7d; font-size:25px; line-height:1; font-weight:950; touch-action:manipulation; }
  .atlas-phone-outreach-item.is-done .atlas-phone-outreach-check { border-color:rgba(185,204,124,.9); background:rgba(222,233,183,.96); }
  .atlas-phone-outreach-open { min-width:0; padding:18px 18px 18px 8px; border:0; background:transparent; color:var(--atlas-text); text-align:left; touch-action:manipulation; }
  .atlas-phone-outreach-open strong { display:block; font-size:21px; line-height:1.06; font-weight:950; letter-spacing:-.035em; }
  .atlas-phone-outreach-open small { display:block; margin-top:6px; color:var(--atlas-purple-dark); font-size:13px; line-height:1.2; font-weight:900; }
  .atlas-phone-outreach-open span { display:block; margin-top:9px; color:var(--atlas-muted); font-size:13px; line-height:1.35; font-weight:750; white-space:pre-wrap; }
  .atlas-phone-outreach-detail { display:grid; gap:10px; padding:0 12px 12px; }
  .atlas-phone-outreach-call { display:inline-flex; width:max-content; max-width:100%; min-height:42px; align-items:center; padding:0 13px; border-radius:12px; background:#fff; color:var(--atlas-purple-dark); font-size:14px; font-weight:950; text-decoration:none; }
  .atlas-phone-outreach-form { display:grid; gap:11px; padding:13px; border:1px solid rgba(91,99,71,.18); border-radius:16px; background:rgba(246,242,230,.82); }
  .atlas-phone-outreach-form label { display:grid; gap:5px; }
  .atlas-phone-outreach-form label>span { color:var(--atlas-muted); font-size:11px; line-height:1.2; font-weight:950; letter-spacing:.04em; text-transform:uppercase; }
  .atlas-phone-outreach-form input,.atlas-phone-outreach-form select,.atlas-phone-outreach-form textarea { width:100%; min-height:46px; padding:10px 11px; border:1px solid rgba(139,145,194,.24); border-radius:12px; background:#fff; color:var(--atlas-text); font:inherit; font-size:15px; line-height:1.35; }
  .atlas-phone-outreach-form textarea { min-height:104px; resize:vertical; }
  .atlas-phone-outreach-actions { display:grid; grid-template-columns:minmax(0,1.5fr) 1fr; gap:8px; }
  .atlas-phone-outreach-actions button { min-height:48px; border:1px solid rgba(139,145,194,.2); border-radius:14px; background:rgba(255,255,255,.92); color:var(--atlas-text); font-weight:950; }
  .atlas-phone-outreach-actions button[type="submit"] { background:rgba(214,225,177,.78); color:#515b34; }
  .atlas-phone-outreach-message,.atlas-phone-outreach-finish-hint { margin:0; color:#835345; font-size:12px; line-height:1.3; font-weight:850; }
  .atlas-phone-outreach-message.closed { padding:0 18px 14px 62px; }
  .atlas-phone-outreach-message.task,.atlas-phone-outreach-finish-hint { padding:10px 4px 0; text-align:center; }
  .atlas-phone-outreach-item button:disabled,.atlas-phone-outreach-item input:disabled,.atlas-phone-outreach-item select:disabled,.atlas-phone-outreach-item textarea:disabled { opacity:.58; }
  @media (max-width:430px) {
    .atlas-phone-outreach-brief,.atlas-phone-outreach-calls { padding-left:12px; padding-right:12px; }
    .atlas-phone-outreach-row { grid-template-columns:52px minmax(0,1fr); min-height:96px; }
    .atlas-phone-outreach-open { padding-right:14px; }
    .atlas-phone-outreach-open strong { font-size:20px; }
    .atlas-phone-outreach-actions { grid-template-columns:1fr; }
  }
`;
