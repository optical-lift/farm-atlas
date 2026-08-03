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
  type AtlasObjectWorkDateCommitment,
  type AtlasObjectWorkEffort,
} from "@/lib/atlas/object-work-client";

import styles from "./object-work-composer.module.css";

type Props = {
  objectKey: string;
  cropCycles: AtlasObjectCropCycle[];
  onSaved?: () => void | Promise<void>;
};

type WorkWindow = "first_thing" | "morning" | "midday" | "afternoon" | "evening";

const actions: Array<{ key: AtlasObjectWorkActionKind; label: string; hint: string }> = [
  { key: "check", label: "Check", hint: "Confirm a condition or decision." },
  { key: "water", label: "Water", hint: "Change this place’s water state." },
  { key: "sow", label: "Sow", hint: "Change an empty or prepared place into a seeded one." },
  { key: "transplant", label: "Transplant", hint: "Change a prepared place into a planted one." },
  { key: "harvest", label: "Harvest", hint: "Change a ready crop into a recorded harvest." },
  { key: "repair", label: "Repair", hint: "Change a damaged object into a working one." },
  { key: "reset", label: "Reset", hint: "Return this place to a usable state." },
  { key: "prepare", label: "Prepare", hint: "Make this place ready for its next use." },
  { key: "deliver", label: "Deliver", hint: "Change prepared goods into delivered goods." },
  { key: "other", label: "Other", hint: "Define another real state change." },
];

const windows: Array<{ key: WorkWindow; label: string }> = [
  { key: "first_thing", label: "First thing" },
  { key: "morning", label: "Morning" },
  { key: "midday", label: "Midday" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const efforts: Array<{ key: AtlasObjectWorkEffort; label: string; detail: string }> = [
  { key: "light", label: "Light", detail: "Small enough to sit beside heavier work." },
  { key: "standard", label: "Standard", detail: "A normal farm or venue work card." },
  { key: "heavy", label: "Heavy", detail: "Large enough to carry the physical day." },
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

function truthFor(item: AtlasObjectWorkContext["workItems"][number], side: "current" | "after") {
  if (side === "current") return item.currentTruth || "Current truth was not recorded on this older card.";
  return item.afterTruth || item.doneDefinition;
}

export default function ObjectWorkComposer({ objectKey, cropCycles, onSaved }: Props) {
  const [context, setContext] = useState<AtlasObjectWorkContext | null>(null);
  const [open, setOpen] = useState(false);
  const [actionKind, setActionKind] = useState<AtlasObjectWorkActionKind>("check");
  const [title, setTitle] = useState("");
  const [currentTruth, setCurrentTruth] = useState("");
  const [afterTruth, setAfterTruth] = useState("");
  const [unlockText, setUnlockText] = useState("");
  const [effortClass, setEffortClass] = useState<AtlasObjectWorkEffort>("standard");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(centralDate(1));
  const [windowKey, setWindowKey] = useState<WorkWindow>("morning");
  const [dateCommitment, setDateCommitment] = useState<AtlasObjectWorkDateCommitment>("hard_date");
  const [bringIntoWorkNow, setBringIntoWorkNow] = useState(false);
  const [selectedCycles, setSelectedCycles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(membershipId = assigneeId, workDate = dueDate) {
    try {
      const next = await fetchAtlasObjectWorkContext(
        objectKey,
        membershipId || undefined,
        membershipId ? workDate : undefined,
      );
      setContext(next);
      setAssigneeId((current) => current || next.viewerMembershipId || next.memberships[0]?.membershipId || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not load object-first work.");
    }
  }

  useEffect(() => {
    void load("", dueDate);
  }, [objectKey]);

  useEffect(() => {
    if (!assigneeId || !dueDate) return;
    const timer = window.setTimeout(() => {
      void fetchAtlasObjectWorkContext(objectKey, assigneeId, dueDate)
        .then(setContext)
        .catch((error) => setMessage(error instanceof Error ? error.message : "Atlas could not calculate this farm day."));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [assigneeId, dueDate, objectKey]);

  const activeCrops = useMemo(
    () => cropCycles.filter((cycle) => cycle.lifecycle_status !== "archived" && cycle.cycle_state !== "superseded"),
    [cropCycles],
  );
  const action = actions.find((option) => option.key === actionKind) ?? actions[0];
  const assignee = context?.memberships.find((membership) => membership.membershipId === assigneeId);
  const dayLoad = context?.dayLoad;
  const hasRealChange = currentTruth.trim() !== afterTruth.trim();
  const canSave = Boolean(
    context?.canAuthor
    && title.trim()
    && currentTruth.trim()
    && afterTruth.trim()
    && hasRealChange
    && assigneeId
    && dueDate,
  );

  function toggleCycle(id: string) {
    setSelectedCycles((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function reset() {
    setOpen(false);
    setActionKind("check");
    setTitle("");
    setCurrentTruth("");
    setAfterTruth("");
    setUnlockText("");
    setEffortClass("standard");
    setDueDate(centralDate(1));
    setWindowKey("morning");
    setDateCommitment("hard_date");
    setBringIntoWorkNow(false);
    setSelectedCycles([]);
  }

  async function save() {
    if (!canSave) return;
    try {
      setSaving(true);
      setMessage(null);
      const result = await createAtlasObjectWork(objectKey, {
        actionKind,
        title: title.trim(),
        currentTruth: currentTruth.trim(),
        afterTruth: afterTruth.trim(),
        unlockText: unlockText.trim() || undefined,
        effortClass,
        assignedMembershipId: assigneeId,
        dueDate,
        workWindowKey: windowKey,
        dateCommitment,
        bringIntoWorkNow,
        cropCycleIds: selectedCycles,
      });
      setMessage(result.taskId
        ? `${action.label} card is in Work for ${result.workItem.assignee.displayName} on ${prettyDate(result.workItem.dueDate)}.`
        : dateCommitment === "hard_date"
          ? `${action.label} is committed for ${prettyDate(result.workItem.dueDate)}.`
          : `${action.label} is held until that farm day has room.`);
      reset();
      await load(assigneeId, dueDate);
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
      await load(assigneeId, dueDate);
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

      <p className={styles.boundary}>The person making the card declares what is true now and what becomes true when the card is finished.</p>

      {context.workItems.length ? (
        <div className={styles.activeList}>
          {context.workItems.map((item) => (
            <article key={item.id} className={styles.activeCard} data-status={item.status}>
              <small>{item.actionLabel} · {item.status === "released" ? "In Work" : item.dateCommitment === "hard_date" ? "Committed" : "Reservoir"}</small>
              <strong>{item.title}</strong>
              <span>{item.assignee.displayName} · {prettyDate(item.dueDate)} · {item.workWindowKey.replaceAll("_", " ")}</span>
              <div className={styles.truthTransition} aria-label="Prepared state change">
                <div>
                  <small>Current truth</small>
                  <p>{truthFor(item, "current")}</p>
                </div>
                <b aria-hidden="true">→</b>
                <div>
                  <small>After Done</small>
                  <p>{truthFor(item, "after")}</p>
                </div>
              </div>
              <footer>
                {item.taskId ? <Link href={`/task-focus/${encodeURIComponent(item.taskId)}?returnTo=${encodeURIComponent(`/objects/${objectKey}`)}`}>Open work ›</Link> : <span>Held for its farm day</span>}
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
            <legend>What kind of change is this?</legend>
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

          <section className={styles.truthComposer} aria-label="State change contract">
            <label>
              <span>Current truth</span>
              <textarea value={currentTruth} maxLength={600} rows={3} onChange={(event) => setCurrentTruth(event.target.value)} placeholder={`What is true about ${context.object.label} before this work?`} required />
            </label>
            <b aria-hidden="true">→</b>
            <label>
              <span>Truth after completion</span>
              <textarea value={afterTruth} maxLength={600} rows={3} onChange={(event) => setAfterTruth(event.target.value)} placeholder="What becomes true when Done is tapped?" required />
            </label>
          </section>
          {currentTruth.trim() && afterTruth.trim() && !hasRealChange ? (
            <p className={styles.validation}>Before and after must describe a real change.</p>
          ) : null}

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
                    {membership.displayName} · {membership.role.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Farm day</span>
              <input type="date" min={centralDate()} max={centralDate(1825)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>

          <fieldset>
            <legend>Lockscreen window</legend>
            <div className={styles.choices}>
              {windows.map((windowOption) => <button key={windowOption.key} type="button" data-selected={windowKey === windowOption.key} onClick={() => setWindowKey(windowOption.key)}>{windowOption.label}</button>)}
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
            <legend>How firm is this farm day?</legend>
            <div className={styles.releaseGrid}>
              <button type="button" data-selected={dateCommitment === "hard_date"} onClick={() => setDateCommitment("hard_date")}>
                <strong>Must happen that day</strong>
                <span>The obligation remains visible even when the day is full.</span>
              </button>
              <button type="button" data-selected={dateCommitment === "floating"} onClick={() => setDateCommitment("floating")}>
                <strong>Can float around that day</strong>
                <span>Atlas holds it until the person’s presented work has room.</span>
              </button>
            </div>
            {dayLoad ? (
              <p className={styles.capacity} data-over={dayLoad.overloaded}>
                {dateCommitment === "hard_date" && dayLoad.overloaded
                  ? `${prettyDate(dueDate)} is currently overloaded for ${assignee?.displayName || "this person"}. This obligation will still appear.`
                  : dateCommitment === "floating" && dayLoad.overloaded
                    ? `${prettyDate(dueDate)} is currently overloaded for ${assignee?.displayName || "this person"}. Atlas will hold this card until there is room.`
                    : `${prettyDate(dueDate)} currently contains ${dayLoad.lightCount} light, ${dayLoad.standardCount} standard, and ${dayLoad.heavyCount} heavy obligations for ${assignee?.displayName || "this person"}.`}
              </p>
            ) : null}
            <label>
              <span><input type="checkbox" checked={bringIntoWorkNow} onChange={(event) => setBringIntoWorkNow(event.target.checked)} /> Bring into Work now</span>
            </label>
          </fieldset>

          {activeCrops.length ? (
            <fieldset>
              <legend>Real crops changed by this card</legend>
              <div className={styles.cropGrid}>
                {activeCrops.map((crop) => (
                  <button key={crop.id} type="button" data-selected={selectedCycles.includes(crop.id)} onClick={() => toggleCycle(crop.id)}>
                    <strong>{cropLabel(crop)}</strong><span>{crop.cycle_state.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <button className={styles.save} type="button" disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? "Creating card…" : bringIntoWorkNow ? "Bring card into Work" : dateCommitment === "hard_date" ? "Save hard-date card" : "Save for its farm day"}
          </button>
        </div>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}
