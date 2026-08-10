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

type OutreachDraft = {
  contactResult: string;
  reachedName: string;
  groupType: string;
  contactDetails: string;
  followUp: string;
  bookingDate: string;
  bookingStart: string;
  expectedGroupSize: string;
  restroomDisclosed: boolean;
  notes: string;
};

type ThursdaySlot = { start: string; end: string; label: string };

type OutreachController = {
  contacts: AtlasTaskCard[];
  thursdayOptions: string[];
  thursdaySlots: ThursdaySlot[];
  openId: string | null;
  savingId: string | null;
  messageById: Record<string, string>;
  doneById: Record<string, boolean>;
  draftById: Record<string, OutreachDraft>;
  savedById: Record<string, string>;
  allContactsDone: boolean;
  closing: boolean;
  taskMessage: string | null;
  setOpenId: (value: string | null) => void;
  setClosing: (value: boolean) => void;
  setTaskMessage: (value: string | null) => void;
  updateDraft: (taskId: string, patch: Partial<OutreachDraft>) => void;
  reopenContact: (contact: AtlasTaskCard) => Promise<void>;
  saveContactResult: (contact: AtlasTaskCard) => Promise<void>;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function slots(value: unknown): ThursdaySlot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const start = text(row.start);
    const end = text(row.end);
    const label = text(row.label);
    return start && end ? [{ start, end, label: label || `${start}–${end}` }] : [];
  });
}

function stepOrder(task: AtlasTaskCard) {
  const value = task.metadata?.step_order;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 999;
}

function itemLabel(task: AtlasTaskCard) {
  return text(task.metadata?.checklist_label)
    || text(task.metadata?.display_subject)
    || task.title.replace(/^Checklist\s+—\s+/i, "");
}

function currentDone(task: AtlasTaskCard) {
  return task.status === "done" || text(task.metadata?.checklist_status) === "done";
}

function initialDraft(task: AtlasTaskCard): OutreachDraft {
  const saved = record(task.metadata?.network_outreach_result);
  return {
    contactResult: text(saved.contact_result),
    reachedName: text(saved.reached_name),
    groupType: text(saved.group_type) || text(task.metadata?.suggested_group),
    contactDetails: text(saved.contact_details),
    followUp: text(saved.follow_up),
    bookingDate: text(saved.booking_date),
    bookingStart: text(saved.booking_start),
    expectedGroupSize: saved.expected_group_size == null ? "" : String(saved.expected_group_size),
    restroomDisclosed: saved.restroom_disclosed === true,
    notes: text(saved.notes),
  };
}

function friendlyDate(dateIso: string) {
  if (!dateIso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateIso}T12:00:00-05:00`));
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

function summaryForDraft(draft: OutreachDraft, slotList: ThursdaySlot[]) {
  const chosenSlot = slotList.find((slot) => slot.start === draft.bookingStart);
  return [
    `Result: ${outcomeLabel(draft.contactResult)}`,
    draft.reachedName ? `Reached: ${draft.reachedName}` : "",
    draft.groupType ? `Group: ${draft.groupType}` : "",
    draft.contactDetails ? `Best contact: ${draft.contactDetails}` : "",
    draft.bookingDate ? `Thursday booked: ${friendlyDate(draft.bookingDate)} · ${chosenSlot?.label || draft.bookingStart}` : "",
    draft.expectedGroupSize ? `Expected group size: ${draft.expectedGroupSize}` : "",
    draft.followUp ? `Follow-up: ${draft.followUp}` : "",
    draft.notes ? `Notes: ${draft.notes}` : "",
  ].filter(Boolean).join("\n");
}

async function postOutreach(body: Record<string, unknown>) {
  const response = await fetch("/api/atlas/network-outreach", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-atlas-intent": "network-outreach-v1",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: { message?: string };
    nextTaskId?: string;
  };
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || "Atlas could not save this outreach update.");
  }
  return data;
}

function useOutreachController(task: AtlasTaskCard, childTasks: AtlasTaskCard[]): OutreachController {
  const contacts = useMemo(
    () => [...childTasks].sort((a, b) => stepOrder(a) - stepOrder(b) || itemLabel(a).localeCompare(itemLabel(b))),
    [childTasks],
  );
  const thursdayOptions = useMemo(() => strings(task.metadata?.thursday_options), [task.metadata]);
  const thursdaySlots = useMemo(() => slots(task.metadata?.thursday_slots), [task.metadata]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  const [doneById, setDoneById] = useState<Record<string, boolean>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, currentDone(contact)]),
  ));
  const [draftById, setDraftById] = useState<Record<string, OutreachDraft>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, initialDraft(contact)]),
  ));
  const [savedById, setSavedById] = useState<Record<string, string>>(() => Object.fromEntries(
    contacts.map((contact) => [contact.task_id, contact.note ?? ""]),
  ));
  const [closing, setClosing] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);

  function updateDraft(taskId: string, patch: Partial<OutreachDraft>) {
    const contact = contacts.find((item) => item.task_id === taskId);
    if (!contact) return;
    setDraftById((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? initialDraft(contact)), ...patch },
    }));
    setMessageById((current) => ({ ...current, [taskId]: "" }));
  }

  async function reopenContact(contact: AtlasTaskCard) {
    try {
      setSavingId(contact.task_id);
      setMessageById((current) => ({ ...current, [contact.task_id]: "" }));
      await postAtlasTaskTransition({
        taskId: contact.task_id,
        transition: "checklist_open",
        laneKey: "checklist",
        workKey: "reopened",
        payload: {
          completion_source: "network_outreach_checklist",
          parent_task_id: task.task_id,
          contact_key: text(contact.metadata?.task_key),
        },
      });
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
    const draft = draftById[contact.task_id] ?? initialDraft(contact);
    if (!draft.contactResult) {
      setMessageById((current) => ({ ...current, [contact.task_id]: "Choose what happened on the call first." }));
      return;
    }
    if (draft.bookingDate && (!draft.bookingStart || !draft.restroomDisclosed)) {
      setMessageById((current) => ({
        ...current,
        [contact.task_id]: !draft.bookingStart
          ? "Choose a Thursday time before saving the booking."
          : "Confirm that you told them the visit is outdoor-only with no guest restroom.",
      }));
      return;
    }

    const note = summaryForDraft(draft, thursdaySlots);
    try {
      setSavingId(contact.task_id);
      setMessageById((current) => ({ ...current, [contact.task_id]: "" }));
      await postAtlasTaskTransition({
        taskId: contact.task_id,
        transition: "note",
        note,
        laneKey: "network",
        workKey: "contact_result",
        payload: {
          completion_source: "inline_subtask_note",
          note_kind: "network_outreach_result",
          parent_task_id: task.task_id,
          contact_key: text(contact.metadata?.task_key),
        },
      });
      await postOutreach({ action: "save_result", taskId: contact.task_id, ...draft });
      if (!(doneById[contact.task_id] ?? currentDone(contact))) {
        await postAtlasTaskTransition({
          taskId: contact.task_id,
          transition: "checklist_done",
          laneKey: "checklist",
          workKey: "contacted",
          payload: {
            completion_source: "network_outreach_checklist",
            parent_task_id: task.task_id,
            contact_key: text(contact.metadata?.task_key),
            contact_result: draft.contactResult,
            booked_thursday: draft.bookingDate || null,
          },
        });
      }
      setSavedById((current) => ({ ...current, [contact.task_id]: note }));
      setDoneById((current) => ({ ...current, [contact.task_id]: true }));
      setOpenId(null);
    } catch (error) {
      setMessageById((current) => ({
        ...current,
        [contact.task_id]: error instanceof Error ? error.message : "Could not save this contact result.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  const allContactsDone = contacts.length > 0 && contacts.every(
    (contact) => doneById[contact.task_id] ?? currentDone(contact),
  );

  return {
    contacts,
    thursdayOptions,
    thursdaySlots,
    openId,
    savingId,
    messageById,
    doneById,
    draftById,
    savedById,
    allContactsDone,
    closing,
    taskMessage,
    setOpenId,
    setClosing,
    setTaskMessage,
    updateDraft,
    reopenContact,
    saveContactResult,
  };
}

function NetworkOutreachMethodInstrument({
  task,
  controller,
  busy,
}: {
  task: AtlasTaskCard;
  controller: OutreachController;
  busy: boolean;
}) {
  const callbackNumber = text(task.metadata?.callback_number);
  const script = text(task.metadata?.outreach_script);
  const voicemail = text(task.metadata?.voicemail_script);
  const ifTheyAsk = strings(task.metadata?.if_they_ask);

  return (
    <div data-atlas-method-instrument="network-outreach">
      <section className="atlas-outreach-brief">
        {task.note ? <p className="atlas-outreach-objective">{task.note}</p> : null}
        <div className="atlas-outreach-call-window">
          <span>Best call window</span>
          <strong>{text(task.metadata?.preferred_call_window) || "10:00–11:30 AM"}</strong>
        </div>
        {callbackNumber ? (
          <div className="atlas-outreach-callback">
            <span>Elm Farm callback number</span>
            <a href={`tel:${callbackNumber.replace(/\D/g, "")}`}>{callbackNumber}</a>
            <small>{text(task.metadata?.callback_note)}</small>
          </div>
        ) : null}
        {script ? (
          <div className="atlas-outreach-script">
            <span>Call script</span>
            <p>{script}</p>
            <strong>When you reach the group leader:</strong>
            <p>“Great. I have a few Thursdays open. What Thursday usually works best for your group?”</p>
          </div>
        ) : null}
        <details className="atlas-outreach-helper">
          <summary>Voicemail + quick answers</summary>
          {voicemail ? <><strong>Voicemail</strong><p>{voicemail}</p></> : null}
          {ifTheyAsk.length ? <><strong>If they ask…</strong><ul>{ifTheyAsk.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
          <strong>Booking rule</strong>
          <p>{text(task.metadata?.booking_rule)}</p>
        </details>
      </section>

      <section className="atlas-network-inputs" aria-label="Church outreach checklist">
        <h2>{text(task.metadata?.checklist_heading) || "Churches to call"}</h2>
        <p className="atlas-network-inputs__hint">A call counts when you record what happened — yes, no, voicemail, and no answer are all real results.</p>
        <div className="atlas-network-inputs__list">
          {controller.contacts.map((contact) => {
            const done = controller.doneById[contact.task_id] ?? currentDone(contact);
            const open = controller.openId === contact.task_id;
            const saving = controller.savingId === contact.task_id;
            const saved = controller.savedById[contact.task_id] ?? "";
            const message = controller.messageById[contact.task_id] ?? "";
            const draft = controller.draftById[contact.task_id] ?? initialDraft(contact);
            const address = text(contact.metadata?.church_address);
            const phone = text(contact.metadata?.church_phone);
            const email = text(contact.metadata?.church_email);
            const suggestedGroup = text(contact.metadata?.suggested_group);
            const suggestedContact = text(contact.metadata?.suggested_contact);
            const dateOptions = draft.bookingDate && !controller.thursdayOptions.includes(draft.bookingDate)
              ? [draft.bookingDate, ...controller.thursdayOptions]
              : controller.thursdayOptions;

            return (
              <article className={`atlas-network-input${done ? " is-done" : ""}${open ? " is-open" : ""}`} key={contact.task_id}>
                <div className="atlas-network-input__row">
                  <button
                    type="button"
                    className="atlas-network-input__check"
                    aria-label={done ? `Reopen ${itemLabel(contact)}` : `Log result for ${itemLabel(contact)}`}
                    aria-pressed={done}
                    disabled={saving || busy}
                    onClick={() => done ? void controller.reopenContact(contact) : controller.setOpenId(contact.task_id)}
                  >
                    {done ? "✓" : ""}
                  </button>
                  <button
                    type="button"
                    className="atlas-network-input__open"
                    aria-expanded={open}
                    disabled={saving || busy}
                    onClick={() => controller.setOpenId(open ? null : contact.task_id)}
                  >
                    <strong>{itemLabel(contact)}</strong>
                    <small>{done ? "Result recorded · tap to review" : "Tap to call + log result"}</small>
                    {saved ? <span>{saved}</span> : null}
                  </button>
                </div>

                {open ? (
                  <div className="atlas-network-input__detail">
                    <div className="atlas-outreach-contact-card">
                      {address ? <p>{address}</p> : null}
                      <div>
                        {phone ? <a href={`tel:${phone.replace(/\D/g, "")}`}>Call {phone}</a> : null}
                        {email ? <a href={`mailto:${email}`}>{email}</a> : null}
                      </div>
                      {suggestedGroup ? <p><b>Ask for:</b> {suggestedGroup}</p> : null}
                      {suggestedContact ? <p><b>Good contact:</b> {suggestedContact}</p> : null}
                    </div>

                    <form className="atlas-network-input__form" onSubmit={(event) => { event.preventDefault(); void controller.saveContactResult(contact); }}>
                      <label>
                        <span>What happened?</span>
                        <select disabled={busy} value={draft.contactResult} onChange={(event) => controller.updateDraft(contact.task_id, { contactResult: event.target.value })} required>
                          <option value="">Choose a result</option>
                          <option value="interested">Interested</option>
                          <option value="maybe">Maybe / follow up</option>
                          <option value="not_interested">Not interested</option>
                          <option value="voicemail">Left voicemail</option>
                          <option value="no_answer">No answer</option>
                          <option value="wrong_contact">Wrong contact / referred elsewhere</option>
                        </select>
                      </label>
                      <label><span>Who did you reach?</span><input disabled={busy} value={draft.reachedName} placeholder="Name or role" onChange={(event) => controller.updateDraft(contact.task_id, { reachedName: event.target.value })} /></label>
                      <label><span>Their group</span><input disabled={busy} value={draft.groupType} placeholder={suggestedGroup || "Women’s group, small group, homeschool group…"} onChange={(event) => controller.updateDraft(contact.task_id, { groupType: event.target.value })} /></label>
                      <label><span>Best contact / person they referred you to</span><input disabled={busy} value={draft.contactDetails} placeholder="Name · phone · email" onChange={(event) => controller.updateDraft(contact.task_id, { contactDetails: event.target.value })} /></label>
                      <label><span>Follow-up needed?</span><input disabled={busy} value={draft.followUp} placeholder="Who, when, what next" onChange={(event) => controller.updateDraft(contact.task_id, { followUp: event.target.value })} /></label>

                      <fieldset className="atlas-outreach-booking" disabled={busy}>
                        <legend>Book a Thursday if they’re ready</legend>
                        <label>
                          <span>Thursday</span>
                          <select value={draft.bookingDate} onChange={(event) => controller.updateDraft(contact.task_id, {
                            bookingDate: event.target.value,
                            bookingStart: event.target.value ? draft.bookingStart : "",
                            restroomDisclosed: event.target.value ? draft.restroomDisclosed : false,
                          })}>
                            <option value="">Not booked yet</option>
                            {dateOptions.map((date) => <option key={date} value={date}>{friendlyDate(date)}</option>)}
                          </select>
                        </label>
                        {draft.bookingDate ? (
                          <>
                            <label><span>Time</span><select value={draft.bookingStart} onChange={(event) => controller.updateDraft(contact.task_id, { bookingStart: event.target.value })}><option value="">Choose a time</option>{controller.thursdaySlots.map((slot) => <option key={slot.start} value={slot.start}>{slot.label}</option>)}</select></label>
                            <label><span>Expected group size</span><input type="number" min="1" max="250" inputMode="numeric" value={draft.expectedGroupSize} placeholder="About how many?" onChange={(event) => controller.updateDraft(contact.task_id, { expectedGroupSize: event.target.value })} /></label>
                            <label className="atlas-outreach-restroom-check"><input type="checkbox" checked={draft.restroomDisclosed} onChange={(event) => controller.updateDraft(contact.task_id, { restroomDisclosed: event.target.checked })} /><span>I told them this first visit is outdoor-only and there is currently no guest restroom available.</span></label>
                          </>
                        ) : null}
                      </fieldset>

                      <label><span>Anything else?</span><textarea disabled={busy} value={draft.notes} placeholder="Questions, needs, or useful context" onChange={(event) => controller.updateDraft(contact.task_id, { notes: event.target.value })} /></label>
                      <div className="atlas-network-input__form-actions">
                        <button type="submit" disabled={saving || busy}>{saving ? "Saving" : "Save result + mark contacted"}</button>
                        <button type="button" disabled={saving || busy} onClick={() => controller.setOpenId(null)}>Cancel</button>
                      </div>
                      {message ? <p className="atlas-network-input__message-inline" aria-live="polite">{message}</p> : null}
                    </form>
                  </div>
                ) : message ? <p className="atlas-network-input__message" aria-live="polite">{message}</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      <style>{`
        .atlas-outreach-brief { display:grid; gap:12px; padding:18px; border-top:1px solid var(--atlas-border); }
        .atlas-outreach-objective { margin:0; color:var(--atlas-text); font-size:15px; line-height:1.45; font-weight:760; white-space:pre-wrap; }
        .atlas-outreach-call-window,.atlas-outreach-callback,.atlas-outreach-script,.atlas-outreach-helper { border:1px solid rgba(139,145,194,.18); border-radius:16px; padding:13px 14px; background:rgba(255,255,255,.72); }
        .atlas-outreach-call-window span,.atlas-outreach-callback span,.atlas-outreach-script>span { display:block; color:var(--atlas-muted); font-size:10px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; }
        .atlas-outreach-call-window strong { display:block; margin-top:4px; font-size:17px; }
        .atlas-outreach-callback a { display:inline-block; margin-top:5px; color:var(--atlas-purple-dark); font-size:20px; font-weight:950; text-decoration:none; }
        .atlas-outreach-callback small { display:block; margin-top:4px; color:var(--atlas-muted); line-height:1.35; }
        .atlas-outreach-script p,.atlas-outreach-helper p,.atlas-outreach-helper li { color:var(--atlas-text); font-size:14px; line-height:1.45; }
        .atlas-outreach-script p { margin:7px 0 10px; white-space:pre-wrap; }
        .atlas-outreach-script strong,.atlas-outreach-helper strong { font-size:12px; }
        .atlas-outreach-helper summary { cursor:pointer; font-weight:900; }
        .atlas-network-inputs { padding:22px 18px 8px; border-top:1px solid var(--atlas-border); }
        .atlas-network-inputs h2 { margin:0 0 8px; color:#858bb8; font-size:14px; line-height:1; font-weight:950; letter-spacing:.16em; text-transform:uppercase; }
        .atlas-network-inputs__hint { margin:0 0 14px; color:var(--atlas-muted); font-size:12px; line-height:1.4; font-weight:750; }
        .atlas-network-inputs__list { display:grid; gap:12px; }
        .atlas-network-input { overflow:hidden; border:1px solid rgba(139,145,194,.22); border-radius:22px; background:rgba(255,255,255,.82); }
        .atlas-network-input.is-done { background:rgba(228,234,200,.48); }
        .atlas-network-input__row { display:grid; grid-template-columns:54px minmax(0,1fr); align-items:stretch; min-height:104px; }
        .atlas-network-input__check { align-self:center; justify-self:center; width:42px; height:42px; padding:0; border:4px solid rgba(139,145,194,.24); border-radius:999px; background:rgba(255,255,255,.45); color:#686b7d; font-size:25px; line-height:1; font-weight:950; }
        .atlas-network-input.is-done .atlas-network-input__check { border-color:rgba(185,204,124,.9); background:rgba(222,233,183,.96); }
        .atlas-network-input__open { min-width:0; padding:18px 18px 18px 8px; border:0; background:transparent; color:var(--atlas-text); text-align:left; }
        .atlas-network-input__open strong { display:block; font-size:21px; line-height:1.06; font-weight:950; letter-spacing:-.035em; }
        .atlas-network-input__open small { display:block; margin-top:7px; color:var(--atlas-purple-dark); font-size:12px; line-height:1.2; font-weight:900; }
        .atlas-network-input__open span { display:block; margin-top:9px; color:var(--atlas-muted); font-size:13px; line-height:1.35; font-weight:750; white-space:pre-wrap; }
        .atlas-network-input__detail { padding:0 12px 12px; }
        .atlas-outreach-contact-card { display:grid; gap:7px; padding:13px 14px; border-radius:16px; background:rgba(247,244,233,.9); }
        .atlas-outreach-contact-card p { margin:0; color:var(--atlas-text); font-size:14px; line-height:1.35; }
        .atlas-outreach-contact-card div { display:flex; flex-wrap:wrap; gap:8px; }
        .atlas-outreach-contact-card a { display:inline-flex; min-height:38px; align-items:center; padding:0 11px; border-radius:11px; background:#fff; color:var(--atlas-purple-dark); font-size:13px; font-weight:950; text-decoration:none; }
        .atlas-network-input__form { display:grid; gap:11px; margin-top:10px; padding:13px; border:1px solid rgba(91,99,71,.18); border-radius:16px; background:rgba(246,242,230,.82); }
        .atlas-network-input__form label { display:grid; gap:5px; }
        .atlas-network-input__form label>span,.atlas-outreach-booking legend { color:var(--atlas-muted); font-size:11px; line-height:1.2; font-weight:950; letter-spacing:.04em; text-transform:uppercase; }
        .atlas-network-input__form input,.atlas-network-input__form select,.atlas-network-input__form textarea { width:100%; min-height:46px; padding:10px 11px; border:1px solid rgba(139,145,194,.24); border-radius:12px; background:#fff; color:var(--atlas-text); font:inherit; font-size:15px; line-height:1.35; }
        .atlas-network-input__form textarea { min-height:92px; resize:vertical; }
        .atlas-outreach-booking { display:grid; gap:10px; margin:2px 0; padding:12px; border:1px solid rgba(139,145,194,.2); border-radius:14px; background:rgba(255,255,255,.55); }
        .atlas-outreach-restroom-check { grid-template-columns:22px minmax(0,1fr)!important; align-items:start; gap:8px!important; }
        .atlas-outreach-restroom-check input { width:20px; min-height:20px; height:20px; margin-top:1px; }
        .atlas-outreach-restroom-check span { color:#835345!important; font-size:12px!important; line-height:1.35!important; font-weight:850!important; letter-spacing:0!important; text-transform:none!important; }
        .atlas-network-input__form-actions { display:grid; grid-template-columns:minmax(0,1.6fr) 1fr; gap:8px; }
        .atlas-network-input__form-actions button { min-height:48px; border:1px solid rgba(139,145,194,.2); border-radius:14px; background:rgba(255,255,255,.92); color:var(--atlas-text); font-weight:950; }
        .atlas-network-input__form-actions button[type="submit"] { background:rgba(214,225,177,.78); color:#515b34; }
        .atlas-network-input__message,.atlas-network-input__message-inline,.atlas-network-task-message,.atlas-outreach-finish-hint { margin:0; color:#835345; font-size:12px; line-height:1.3; font-weight:850; }
        .atlas-network-input__message { padding:0 18px 14px 62px; }
        .atlas-network-task-message,.atlas-outreach-finish-hint { padding:10px 4px 0; text-align:center; }
        .atlas-network-input button:disabled,.atlas-network-input input:disabled,.atlas-network-input select:disabled,.atlas-network-input textarea:disabled { opacity:.58; }
        @media (max-width:430px) {
          .atlas-outreach-brief,.atlas-network-inputs { padding-left:12px; padding-right:12px; }
          .atlas-network-input__row { grid-template-columns:52px minmax(0,1fr); min-height:96px; }
          .atlas-network-input__open { padding-right:14px; }
          .atlas-network-input__open strong { font-size:20px; }
          .atlas-network-input__form-actions { grid-template-columns:1fr; }
        }
      `}</style>
    </div>
  );
}

function NetworkOutreachResultInstrument({
  task,
  assignee,
  assembly,
  busy,
  returnHref,
  controller,
}: AssignedTaskResultInstrumentContext & { controller: OutreachController }) {
  const taskBusy = controller.closing || Boolean(controller.savingId) || busy;
  const moveBlocked = !assembly
    || assembly.readiness.status === "blocked"
    || assembly.spine.connection === "stops_at_move";
  const finishBlocked = taskBusy || !controller.allContactsDone || moveBlocked;
  const completionLabel = text(task.metadata?.completion_label) || "Done";

  async function finishTask() {
    if (finishBlocked) return;
    try {
      controller.setClosing(true);
      controller.setTaskMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "done",
        laneKey: task.action_key || "network",
        workKey: task.action_key || "network",
        payload: { assigneeKey: assignee.key, completion_source: "network_outreach_batch" },
      });
      const nextTaskKey = text(task.metadata?.next_batch_task_key);
      if (nextTaskKey) {
        await postOutreach({ action: "release_next_batch", taskId: task.task_id, nextTaskKey });
      }
      window.location.assign(returnHref);
    } catch (error) {
      controller.setTaskMessage(error instanceof Error ? error.message : "Could not finish this outreach batch.");
      controller.setClosing(false);
    }
  }

  return (
    <section data-atlas-result-instrument="network-outreach">
      <div className="atlas-task-result-actions atlas-task-result-actions-simple">
        <button type="button" className="done" disabled={finishBlocked} onClick={() => void finishTask()}>
          {controller.closing ? "Finishing" : completionLabel}
        </button>
        <button type="button" className="unfinished" disabled={taskBusy} onClick={() => window.location.assign(returnHref)}>
          Unfinished
        </button>
      </div>
      {!controller.allContactsDone ? <p className="atlas-outreach-finish-hint">Record a result for every contact to finish this batch.</p> : null}
      {controller.taskMessage ? <p className="atlas-network-task-message" aria-live="polite">{controller.taskMessage}</p> : null}
    </section>
  );
}

export default function NetworkOutreachTaskDetail({ task, childTasks, assignee }: Props) {
  const controller = useOutreachController(task, childTasks);
  const methodInstrument = ({ busy }: AssignedTaskInstrumentContext) => (
    <NetworkOutreachMethodInstrument task={task} controller={controller} busy={busy || Boolean(controller.savingId)} />
  );

  return (
    <AssignedTaskExecutionShell
      task={task}
      childTasks={[]}
      assignee={assignee}
      methodInstrument={methodInstrument}
      resultInstrument={(context) => <NetworkOutreachResultInstrument {...context} controller={controller} />}
    />
  );
}
