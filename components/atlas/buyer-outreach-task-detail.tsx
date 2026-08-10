"use client";

import { useMemo, useState } from "react";

import AssignedTaskExecutionShell from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type BuyerDraft = {
  contactResult: string;
  reachedName: string;
  contactDetails: string;
  quantity: string;
  quotedWeeklyPrice: string;
  agreedStartDate: string;
  followUp: string;
  notes: string;
};

type BuyerOutreachResultInstrumentProps = {
  task: AtlasTaskCard;
  contacts: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
  script: string;
  blocked: boolean;
  returnHref: string;
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
    || task.title.replace(/^Checklist\s+—\s+/i, "");
}

function currentDone(task: AtlasTaskCard) {
  return task.status === "done" || text(task.metadata?.checklist_status) === "done";
}

function initialDraft(task: AtlasTaskCard): BuyerDraft {
  const saved = record(task.metadata?.buyer_outreach_result);
  return {
    contactResult: text(saved.contact_result),
    reachedName: text(saved.reached_name),
    contactDetails: text(saved.contact_details),
    quantity: saved.quantity == null ? "" : String(saved.quantity),
    quotedWeeklyPrice: saved.quoted_weekly_price == null ? "" : String(saved.quoted_weekly_price),
    agreedStartDate: text(saved.agreed_start_date),
    followUp: text(saved.follow_up),
    notes: text(saved.notes),
  };
}

function outcomeLabel(value: string) {
  return ({
    interested: "Interested",
    maybe: "Maybe / follow up",
    not_interested: "Not interested",
    voicemail: "Left voicemail",
    no_answer: "No answer",
    wrong_contact: "Wrong contact / referred elsewhere",
  } as Record<string, string>)[value] || value;
}

function summaryForDraft(draft: BuyerDraft) {
  return [
    `Result: ${outcomeLabel(draft.contactResult)}`,
    draft.reachedName ? `Reached: ${draft.reachedName}` : "",
    draft.contactDetails ? `Best contact: ${draft.contactDetails}` : "",
    draft.quantity ? `Quantity: ${draft.quantity}` : "",
    draft.quotedWeeklyPrice ? `Weekly price: $${draft.quotedWeeklyPrice}` : "",
    draft.agreedStartDate ? `Start date: ${draft.agreedStartDate}` : "",
    draft.followUp ? `Follow-up: ${draft.followUp}` : "",
    draft.notes ? `Notes: ${draft.notes}` : "",
  ].filter(Boolean).join("\n");
}

function savedSummary(task: AtlasTaskCard) {
  const draft = initialDraft(task);
  return draft.contactResult ? summaryForDraft(draft) : "";
}

function scriptForBusiness(script: string, businessName: string) {
  return script.replace(/\[restaurant name\]/gi, businessName);
}

async function postBuyerOutreach(body: Record<string, unknown>) {
  const response = await fetch("/api/atlas/buyer-outreach", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-atlas-intent": "buyer-outreach-v1",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: { message?: string };
  };
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || "Atlas could not save this buyer contact.");
  }
  return data;
}

function BuyerOutreachResultInstrument({
  task,
  contacts,
  assignee,
  script,
  blocked,
  returnHref,
}: BuyerOutreachResultInstrumentProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  const [doneById, setDoneById] = useState<Record<string, boolean>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, currentDone(contact)]),
  ));
  const [draftById, setDraftById] = useState<Record<string, BuyerDraft>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, initialDraft(contact)]),
  ));
  const [savedById, setSavedById] = useState<Record<string, string>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, savedSummary(contact)]),
  ));

  function updateDraft(taskId: string, patch: Partial<BuyerDraft>) {
    if (blocked) return;
    const contact = contacts.find((candidate) => candidate.task_id === taskId);
    if (!contact) return;
    setDraftById((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? initialDraft(contact)), ...patch },
    }));
    setMessageById((current) => ({ ...current, [taskId]: "" }));
  }

  async function reopenContact(contact: AtlasTaskCard) {
    if (blocked) return;
    try {
      setSavingId(contact.task_id);
      await postAtlasTaskTransition({
        taskId: contact.task_id,
        transition: "checklist_open",
        laneKey: "checklist",
        workKey: "reopened",
        payload: {
          completion_source: "buyer_outreach_checklist",
          parent_task_id: task.task_id,
          contact_key: text(contact.metadata?.task_key),
        },
      });
      setDraftById((current) => ({
        ...current,
        [contact.task_id]: {
          contactResult: "",
          reachedName: "",
          contactDetails: "",
          quantity: "",
          quotedWeeklyPrice: "",
          agreedStartDate: "",
          followUp: "",
          notes: "",
        },
      }));
      setDoneById((current) => ({ ...current, [contact.task_id]: false }));
      setOpenId(contact.task_id);
    } catch (error) {
      setMessageById((current) => ({
        ...current,
        [contact.task_id]: error instanceof Error ? error.message : "Could not reopen this contact.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function saveContactResult(contact: AtlasTaskCard) {
    if (blocked) return;
    const draft = draftById[contact.task_id] ?? initialDraft(contact);
    if (!draft.contactResult) {
      setMessageById((current) => ({ ...current, [contact.task_id]: "Choose what happened on the call first." }));
      return;
    }

    const note = summaryForDraft(draft);
    try {
      setSavingId(contact.task_id);
      setMessageById((current) => ({ ...current, [contact.task_id]: "" }));

      await postBuyerOutreach({
        taskId: contact.task_id,
        ...draft,
      });

      await postAtlasTaskTransition({
        taskId: contact.task_id,
        transition: "note",
        note,
        laneKey: "network",
        workKey: "buyer_contact_result",
        payload: {
          completion_source: "buyer_outreach_result",
          note_kind: "buyer_outreach_result",
          parent_task_id: task.task_id,
          buyer_relationship_stable_key: text(contact.metadata?.buyer_relationship_stable_key),
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
            completion_source: "buyer_outreach_checklist",
            parent_task_id: task.task_id,
            buyer_relationship_stable_key: text(contact.metadata?.buyer_relationship_stable_key),
            contact_result: draft.contactResult,
          },
        });
      }

      setSavedById((current) => ({ ...current, [contact.task_id]: note }));
      setDoneById((current) => ({ ...current, [contact.task_id]: true }));
      setOpenId(null);
    } catch (error) {
      setMessageById((current) => ({
        ...current,
        [contact.task_id]: error instanceof Error ? error.message : "Could not save this buyer contact.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  const allContactsDone = contacts.length > 0 && contacts.every(
    (contact) => doneById[contact.task_id] ?? currentDone(contact),
  );

  async function finishTask() {
    if (blocked) return;
    if (!allContactsDone) {
      setTaskMessage("Record a result for all five restaurants before closing this batch.");
      return;
    }

    try {
      setClosing(true);
      setTaskMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "done",
        laneKey: task.action_key || "network",
        workKey: task.action_key || "network",
        payload: { assigneeKey: assignee.key, completion_source: "buyer_outreach_batch" },
      });
      window.location.assign(returnHref);
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : "Could not finish this restaurant outreach batch.");
    } finally {
      setClosing(false);
    }
  }

  return (
    <section
      className="atlas-network-outreach-card"
      aria-label="Restaurant outreach checklist"
      data-atlas-result-instrument="buyer-outreach"
    >
      <section className="atlas-network-inputs">
        <h2>Restaurants to call</h2>
        <div className="atlas-network-inputs__list">
          {contacts.map((contact) => {
            const done = doneById[contact.task_id] ?? currentDone(contact);
            const open = openId === contact.task_id;
            const saving = savingId === contact.task_id;
            const saved = savedById[contact.task_id] ?? "";
            const message = messageById[contact.task_id] ?? "";
            const draft = draftById[contact.task_id] ?? initialDraft(contact);
            const businessName = itemLabel(contact);
            const phone = text(contact.metadata?.business_phone);
            const address = text(contact.metadata?.business_address);

            return (
              <article className={`atlas-network-input${done ? " is-done" : ""}${open ? " is-open" : ""}`} key={contact.task_id}>
                <div className="atlas-network-input__row">
                  <button
                    type="button"
                    className="atlas-network-input__check"
                    aria-label={done ? `Log another contact with ${businessName}` : `Log result for ${businessName}`}
                    aria-pressed={done}
                    disabled={blocked || saving}
                    onClick={() => done ? void reopenContact(contact) : setOpenId(contact.task_id)}
                  >
                    {done ? "✓" : ""}
                  </button>
                  <button
                    type="button"
                    className="atlas-network-input__open"
                    aria-expanded={open}
                    disabled={blocked || saving}
                    onClick={() => setOpenId(open ? null : contact.task_id)}
                  >
                    <strong>{businessName}</strong>
                    <small>{done ? "Result recorded" : "Tap to call + record result"}</small>
                    {saved ? <span>{saved}</span> : null}
                  </button>
                </div>

                {open ? (
                  <div className="atlas-network-input__detail">
                    <div className="atlas-outreach-contact-card">
                      {address ? <p>{address}</p> : null}
                      {phone ? blocked
                        ? <span>Call {phone}</span>
                        : <a href={`tel:${phone.replace(/\D/g, "")}`}>Call {phone}</a>
                      : null}
                    </div>

                    {script ? (
                      <div className="atlas-outreach-script">
                        <span>Say this</span>
                        <p>{scriptForBusiness(script, businessName)}</p>
                      </div>
                    ) : null}

                    <form className="atlas-network-input__form" onSubmit={(event) => { event.preventDefault(); void saveContactResult(contact); }}>
                      <label>
                        <span>What happened?</span>
                        <select disabled={blocked || saving} value={draft.contactResult} onChange={(event) => updateDraft(contact.task_id, { contactResult: event.target.value })} required>
                          <option value="">Choose a result</option>
                          <option value="interested">Interested</option>
                          <option value="maybe">Maybe / follow up</option>
                          <option value="not_interested">Not interested</option>
                          <option value="voicemail">Left voicemail</option>
                          <option value="no_answer">No answer</option>
                          <option value="wrong_contact">Wrong contact / referred elsewhere</option>
                        </select>
                      </label>
                      <label>
                        <span>Who did you reach?</span>
                        <input disabled={blocked || saving} value={draft.reachedName} placeholder="Name or role" onChange={(event) => updateDraft(contact.task_id, { reachedName: event.target.value })} />
                      </label>
                      <label>
                        <span>Best contact / person they referred you to</span>
                        <input disabled={blocked || saving} value={draft.contactDetails} placeholder="Name · phone · email" onChange={(event) => updateDraft(contact.task_id, { contactDetails: event.target.value })} />
                      </label>
                      <label>
                        <span>Quantity, only if different</span>
                        <input disabled={blocked || saving} type="number" min="1" inputMode="numeric" value={draft.quantity} placeholder="12" onChange={(event) => updateDraft(contact.task_id, { quantity: event.target.value })} />
                      </label>
                      <label>
                        <span>Weekly price, only if different</span>
                        <input disabled={blocked || saving} type="number" min="0" step="0.01" inputMode="decimal" value={draft.quotedWeeklyPrice} placeholder="48" onChange={(event) => updateDraft(contact.task_id, { quotedWeeklyPrice: event.target.value })} />
                      </label>
                      <label>
                        <span>Start date, if agreed</span>
                        <input disabled={blocked || saving} type="date" value={draft.agreedStartDate} onChange={(event) => updateDraft(contact.task_id, { agreedStartDate: event.target.value })} />
                      </label>
                      <label>
                        <span>Follow-up</span>
                        <input disabled={blocked || saving} value={draft.followUp} placeholder="Who, when, what next" onChange={(event) => updateDraft(contact.task_id, { followUp: event.target.value })} />
                      </label>
                      <label>
                        <span>Notes</span>
                        <textarea disabled={blocked || saving} value={draft.notes} rows={3} onChange={(event) => updateDraft(contact.task_id, { notes: event.target.value })} />
                      </label>

                      {message ? <p className="atlas-network-input__message">{message}</p> : null}
                      <button type="submit" className="atlas-network-input__save" disabled={blocked || saving}>
                        {saving ? "Saving…" : "Save call result"}
                      </button>
                    </form>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {taskMessage ? <p className="atlas-network-input__message">{taskMessage}</p> : null}
      <button
        type="button"
        className="atlas-network-input__save"
        disabled={blocked || closing || !allContactsDone}
        onClick={() => void finishTask()}
      >
        {closing ? "Finishing…" : "Finish restaurant calls"}
      </button>
    </section>
  );
}

export default function BuyerOutreachTaskDetail({ task, childTasks, assignee }: Props) {
  const contacts = useMemo(
    () => [...childTasks].sort((a, b) => stepOrder(a) - stepOrder(b) || itemLabel(a).localeCompare(itemLabel(b))),
    [childTasks],
  );
  const script = text(task.metadata?.outreach_script) || text(task.note);

  return (
    <AssignedTaskExecutionShell
      task={task}
      childTasks={[]}
      assignee={assignee}
      methodInstrument={script ? () => (
        <section className="atlas-outreach-brief" data-atlas-method-instrument="buyer-outreach-script">
          <div className="atlas-outreach-script">
            <span>Call script</span>
            <p>{script}</p>
          </div>
        </section>
      ) : undefined}
      resultInstrument={({ assembly, busy, returnHref }) => {
        const blocked = busy
          || !assembly
          || assembly.readiness.status === "blocked"
          || assembly.spine.connection === "stops_at_move";
        return (
          <BuyerOutreachResultInstrument
            task={task}
            contacts={contacts}
            assignee={assignee}
            script={script}
            blocked={blocked}
            returnHref={returnHref}
          />
        );
      }}
    />
  );
}
