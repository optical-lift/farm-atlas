"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { AtlasObjectCropCycle } from "@/lib/atlas/object-workbench-client";
import {
  cancelAtlasObjectWorkPlan,
  createAtlasObjectWork,
  fetchAtlasObjectWorkContext,
  type AtlasObjectWorkActionKind,
  type AtlasObjectWorkContext,
  type AtlasObjectWorkEffort,
  type AtlasObjectWorkReleaseMode,
} from "@/lib/atlas/object-work-client";

import styles from "./object-work-composer.module.css";

type Props = {
  objectKey: string;
  cropCycles: AtlasObjectCropCycle[];
  onSaved?: () => void | Promise<void>;
};

type WorkWindow = "first_thing" | "morning" | "midday" | "afternoon" | "evening";

const actions: Array<{ key: AtlasObjectWorkActionKind; label: string; hint: string }> = [
  { key: "check", label: "Check", hint: "Observe something that changes the next move." },
  { key: "water", label: "Water", hint: "Give this place or its crop the water it needs." },
  { key: "sow", label: "Sow", hint: "Put a decided seed plan into this place." },
  { key: "transplant", label: "Transplant", hint: "Move decided plants into this place." },
  { key: "harvest", label: "Harvest", hint: "Take a crop or usable material from this place." },
  { key: "repair", label: "Repair", hint: "Restore a damaged structure or support." },
  { key: "reset", label: "Reset", hint: "Return the place to a decided usable state." },
  { key: "prepare", label: "Prepare", hint: "Make this place ready for its next real use." },
  { key: "deliver", label: "Deliver", hint: "Move the result to its decided destination." },
  { key: "other", label: "Other", hint: "Create other decided work without pretending it is maintenance." },
];

const windows: Array<{ key: WorkWindow; label: string }> = [
  { key: "first_thing", label: "First thing" },
  { key: "morning", label: "Morning" },
  { key: "midday", label: "Midday" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const efforts: Array<{ key: AtlasObjectWorkEffort; label: string; detail: string }> = [
  { key: "light", label: "Light", detail: "A small card that can sit beside heavier work." },
  { key: "standard", label: "Standard", detail: "A normal field or farm work card." },
  { key: "heavy", label: "Heavy", detail: "A card that should carry the physical day." },
];

function centralDate(days = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function cropLabel(crop: AtlasObjectCropCycle) {
  return crop.variety && !crop.crop_label.toLowerCase().includes(crop.variety.toLowerCase())
    ? `${crop.variety} ${crop.crop_label}`
    : crop.crop_label;
}

export default function ObjectWorkComposer({ objectKey, cropCycles, onSaved }: Props) {
  const [context, setContext] = useState<AtlasObjectWorkContext | null>(null);
  const [open, setOpen] = useState(false);
  const [actionKind, setActionKind] = useState<AtlasObjectWorkActionKind>("check");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [doneDefinition, setDoneDefinition] = useState("");
  const [unlockText, setUnlockText] = useState("");
  const [effortClass, setEffortClass] = useState<AtlasObjectWorkEffort>("standard");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(centralDate(1));
  const [windowKey, setWindowKey] = useState<WorkWindow>("morning");
  const [releaseMode, setReleaseMode] = useState<AtlasObjectWorkReleaseMode>("put_in_work");
  const [selectedCycles, setSelectedCycles] = useState<string[]>([]);
  const [stepDraft, setStepDraft] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const next = await fetchAtlasObjectWorkContext(objectKey);
      setContext(next);
      setAssigneeId((current) => current || next.viewerMembershipId || next.memberships[0]?.membershipId || "");
      setReleaseMode((current) => next.capacity.farmAtCapacity && current === "put_in_work" ? "hold_for_capacity" : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not load object-first work.");
    }
  }

  useEffect(() => {
    void load();
  }, [objectKey]);

  const activeCrops = useMemo(
    () => cropCycles.filter((cycle) => cycle.lifecycle_status !== "archived" && cycle.cycle_state !== "superseded"),
    [cropCycles],
  );
  const action = actions.find((option) => option.key === actionKind) ?? actions[0];
  const assignee = context?.memberships.find((membership) => membership.membershipId === assigneeId);
  const canSave = Boolean(context?.canAuthor && title.trim() && doneDefinition.trim() && assigneeId && dueDate);

  function toggleCycle(id: string) {
    setSelectedCycles((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function addStep() {
    const value = stepDraft.trim();
    if (!value || steps.length >= 20) return;
    setSteps((current) => [...current, value]);
    setStepDraft("");
  }

  function reset() {
    setOpen(false);
    setActionKind("check");
    setTitle("");
    setInstructions("");
    setDoneDefinition("");
    setUnlockText("");
    setEffortClass("standard");
    setDueDate(centralDate(1));
    setWindowKey("morning");
    setSelectedCycles([]);
    setSteps([]);
    setStepDraft("");
  }

  async function save() {
    if (!canSave) return;
    try {
      setSaving(true);
      setMessage(null);
      const result = await createAtlasObjectWork(objectKey, {
        actionKind,
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        doneDefinition: doneDefinition.trim(),
        unlockText: unlockText.trim() || undefined,
        effortClass,
        assignedMembershipId: assigneeId,
        dueDate,
        workWindowKey: windowKey,
        releaseMode,
        cropCycleIds: selectedCycles,
        steps,
      });
      setMessage(result.taskId
        ? `${action.label} card is in Work for ${result.workItem.assignee.displayName} on ${prettyDate(result.workItem.dueDate)}.`
        : `${action.label} card is planned and will wait outside Work until capacity admits it.`);
      reset();
      await load();
      await onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not create this work card.");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(workItemId: string) {
    try {
      setMessage(null);
      await cancelAtlasObjectWorkPlan(objectKey, workItemId);
      await load();
      setMessage("The planned card was cancelled before it entered Work.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not cancel this plan.");
    }
  }

  if (!context) return message ? <section className={styles.panel}><p className={styles.message}>{message}</p></section> : null;

  return (
    <section className={styles.panel} aria-label="Object-first work authoring">
      <header className={styles.header}>
        <div>
          <span>Decided work for this place</span>
          <h2>Work cards</h2>
        </div>
        {context.canAuthor ? (
          <button type="button" onClick={() => setOpen((current) => !current)}>{open ? "Close" : "Make a card"}</button>
        ) : null}
      </header>

      <p className={styles.boundary}>Check, water, sow, transplant, harvest, repair, reset, prepare, and delivery work begins here. Weed and Mow remain on their perpetual maintenance cards below.</p>

      {context.workItems.length ? (
        <div className={styles.activeList}>
          {context.workItems.map((item) => (
            <article key={item.id} className={styles.activeCard} data-status={item.status}>
              <small>{item.actionLabel} · {item.status === "released" ? "In Work" : "Planned"}</small>
              <strong>{item.title}</strong>
              <span>{item.assignee.displayName} · {prettyDate(item.dueDate)} · {item.workWindowKey.replaceAll("_", " ")}</span>
              <p><b>Done means:</b> {item.doneDefinition}</p>
              <footer>
                {item.taskId ? <Link href={`/task-focus/${encodeURIComponent(item.taskId)}?returnTo=${encodeURIComponent(`/objects/${objectKey}`)}`}>Open work ›</Link> : <span>Waiting outside Work</span>}
                {context.canAuthor && item.status === "planned" ? <button type="button" onClick={() => void cancel(item.id)}>Cancel plan</button> : null}
              </footer>
            </article>
          ))}
        </div>
      ) : null}

      {open && context.canAuthor ? (
        <div className={styles.composer}>
          <div className={styles.sentence} aria-label="Object work sentence">
            <span>Create</span>
            <button type="button" className={styles.pill}>{action.label}</button>
            <button type="button" className={styles.pill}>{title.trim() || "work"}</button>
            <span>at</span>
            <button type="button" className={styles.pill}>{context.object.label}</button>
            <span>for</span>
            <button type="button" className={styles.pill}>{assignee?.displayName || "assignee"}</button>
            <span>on</span>
            <button type="button" className={styles.pill}>{prettyDate(dueDate)}</button>
          </div>

          <fieldset>
            <legend>What kind of card is this?</legend>
            <div className={styles.actionGrid}>
              {actions.map((option) => (
                <button key={option.key} type="button" data-selected={actionKind === option.key} onClick={() => setActionKind(option.key)}>
                  <strong>{option.label}</strong>
                  <span>{option.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label>
            <span>Card title</span>
            <input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder={`${action.label} what?`} />
          </label>

          <label>
            <span>Instruction</span>
            <textarea value={instructions} maxLength={3000} rows={3} onChange={(event) => setInstructions(event.target.value)} placeholder="What should the person do, notice, preserve, or leave alone?" />
          </label>

          <label>
            <span>Done means</span>
            <textarea value={doneDefinition} maxLength={600} rows={2} onChange={(event) => setDoneDefinition(event.target.value)} placeholder="Describe the physical or operational state that should exist afterward." required />
          </label>

          <label>
            <span>What this unlocks or protects</span>
            <input value={unlockText} maxLength={600} onChange={(event) => setUnlockText(event.target.value)} placeholder="Optional consequence or next move" />
          </label>

          <div className={styles.twoColumns}>
            <label>
              <span>Assigned to</span>
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                {context.memberships.map((membership) => (
                  <option key={membership.membershipId} value={membership.membershipId}>
                    {membership.displayName} · {membership.role.replaceAll("_", " ")} · {membership.activeTaskCount} active
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Farm day</span>
              <input type="date" min={centralDate()} max={centralDate(180)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>

          <fieldset>
            <legend>Lockscreen window</legend>
            <div className={styles.choices}>
              {windows.map((window) => <button key={window.key} type="button" data-selected={windowKey === window.key} onClick={() => setWindowKey(window.key)}>{window.label}</button>)}
            </div>
          </fieldset>

          <fieldset>
            <legend>Physical size of the card</legend>
            <div className={styles.effortGrid}>
              {efforts.map((effort) => (
                <button key={effort.key} type="button" data-selected={effortClass === effort.key} onClick={() => setEffortClass(effort.key)}>
                  <strong>{effort.label}</strong><span>{effort.detail}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Where should the card live?</legend>
            <div className={styles.releaseGrid}>
              <button type="button" data-selected={releaseMode === "put_in_work"} onClick={() => setReleaseMode("put_in_work")}>
                <strong>Put in Work</strong>
                <span>Owner or manager explicitly admits this card now, even when the farm is already carrying too much.</span>
              </button>
              <button type="button" data-selected={releaseMode === "hold_for_capacity"} onClick={() => setReleaseMode("hold_for_capacity")}>
                <strong>Hold as planned</strong>
                <span>Keep the decision attached to this place, but do not add another active task until the release engine has capacity.</span>
              </button>
            </div>
            <p className={styles.capacity} data-over={context.capacity.farmAtCapacity}>
              Farm Work is carrying {context.capacity.activeTopLevel} top-level cards against a limit of {context.capacity.maximumTopLevel}.
            </p>
          </fieldset>

          {activeCrops.length ? (
            <fieldset>
              <legend>Real crops touched by this card</legend>
              <div className={styles.cropGrid}>
                {activeCrops.map((crop) => (
                  <button key={crop.id} type="button" data-selected={selectedCycles.includes(crop.id)} onClick={() => toggleCycle(crop.id)}>
                    <strong>{cropLabel(crop)}</strong><span>{crop.cycle_state.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend>Checkable steps</legend>
            <div className={styles.stepEntry}>
              <input value={stepDraft} maxLength={240} onChange={(event) => setStepDraft(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); addStep(); }
              }} placeholder="Add a step" />
              <button type="button" onClick={addStep}>Add</button>
            </div>
            {steps.length ? (
              <ol className={styles.steps}>
                {steps.map((step, index) => (
                  <li key={`${step}:${index}`}><span>{step}</span><button type="button" onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></li>
                ))}
              </ol>
            ) : null}
          </fieldset>

          <button className={styles.save} type="button" disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? "Creating card…" : releaseMode === "put_in_work" ? "Put card in Work" : "Save planned card"}
          </button>
        </div>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}
