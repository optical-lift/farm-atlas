"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { AtlasObjectCropCycle } from "@/lib/atlas/object-workbench-client";
import {
  cancelAtlasMaintenanceDirective,
  createAtlasMaintenanceDirective,
  fetchAtlasMaintenanceDirectiveContext,
  type AtlasMaintenanceDirective,
  type AtlasMaintenanceDirectiveContext,
  type AtlasMaintenanceDirectiveKind,
  type AtlasMaintenanceEffectPolicy,
  type AtlasMaintenanceKind,
} from "@/lib/atlas/maintenance-directives-client";

import styles from "./maintenance-directive-composer.module.css";

type Props = {
  objectKey: string;
  cropCycles: AtlasObjectCropCycle[];
  onSaved?: () => void | Promise<void>;
};

type WorkWindow = "first_thing" | "morning" | "midday" | "afternoon" | "evening";

const windows: Array<{ key: WorkWindow; label: string }> = [
  { key: "first_thing", label: "First thing" },
  { key: "morning", label: "Morning" },
  { key: "midday", label: "Midday" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const effectOptions: Array<{ key: AtlasMaintenanceEffectPolicy; title: string; detail: string }> = [
  {
    key: "bring_forward_only",
    title: "Bring the card forward only",
    detail: "The instruction closes when real work is recorded. It does not promise the normal maintenance cycle was completed.",
  },
  {
    key: "target_condition",
    title: "Count when the target is reached",
    detail: "Keep the instruction active until the Weed Card records the selected physical condition.",
  },
  {
    key: "full_maintenance",
    title: "Count as full maintenance",
    detail: "The instruction closes only after Clear on a Weed Card or Mowed fully on a Mowing Card.",
  },
  {
    key: "inspection_only",
    title: "Inspection only",
    detail: "Record what is found without claiming the maintenance cycle was completed.",
  },
];

const weedTargets = [
  { key: "row_readable", label: "Row readable" },
  { key: "mostly_clear", label: "Mostly clear" },
  { key: "clear", label: "Clear" },
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
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
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

function effectLabel(effect: AtlasMaintenanceEffectPolicy, target: string | null) {
  if (effect === "bring_forward_only") return "card comes forward; clock stays truthful";
  if (effect === "inspection_only") return "inspection only; no automatic reset";
  if (effect === "full_maintenance") return "full result required to renew clock";
  return `stays active until ${target?.replaceAll("_", " ") || "target"}`;
}

function directiveDestination(directive: AtlasMaintenanceDirective) {
  const taskId = directive.prerequisiteTaskId || directive.servingTaskId;
  return taskId ? `/task-focus/${encodeURIComponent(taskId)}` : null;
}

export default function MaintenanceDirectiveComposer({ objectKey, cropCycles, onSaved }: Props) {
  const [context, setContext] = useState<AtlasMaintenanceDirectiveContext | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AtlasMaintenanceKind>("weed");
  const [directiveKind, setDirectiveKind] = useState<AtlasMaintenanceDirectiveKind>("instruction");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(centralDate(1));
  const [windowKey, setWindowKey] = useState<WorkWindow>("morning");
  const [effect, setEffect] = useState<AtlasMaintenanceEffectPolicy>("bring_forward_only");
  const [targetCondition, setTargetCondition] = useState("clear");
  const [selectedCycles, setSelectedCycles] = useState<string[]>([]);
  const [stepDraft, setStepDraft] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const next = await fetchAtlasMaintenanceDirectiveContext(objectKey);
      setContext(next);
      setAssigneeId((current) => current || next.viewerMembershipId || next.memberships[0]?.membershipId || "");
      if (!next.capabilities.weed && next.capabilities.mow) {
        setKind("mow");
        setWindowKey("afternoon");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not load maintenance cards for this place.");
    }
  }

  useEffect(() => {
    void load();
  }, [objectKey]);

  useEffect(() => {
    if (kind === "mow") {
      setWindowKey("afternoon");
      if (effect === "target_condition") setEffect("bring_forward_only");
    } else if (windowKey === "afternoon") {
      setWindowKey("morning");
    }
  }, [kind]);

  const activeCrops = useMemo(
    () => cropCycles.filter((cycle) => cycle.lifecycle_status !== "archived" && cycle.cycle_state !== "superseded"),
    [cropCycles],
  );
  const selectedAssignee = context?.memberships.find((membership) => membership.membershipId === assigneeId);
  const cardName = kind === "weed" ? "Weed Card" : "Mowing Card";
  const canSave = Boolean(context?.canAuthor && title.trim() && assigneeId && dueDate);

  function toggleCycle(id: string) {
    setSelectedCycles((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function addStep() {
    const value = stepDraft.trim();
    if (!value || steps.length >= 20) return;
    setSteps((current) => [...current, value]);
    setStepDraft("");
  }

  function reset() {
    setOpen(false);
    setDirectiveKind("instruction");
    setTitle("");
    setInstructions("");
    setDueDate(centralDate(1));
    setEffect("bring_forward_only");
    setTargetCondition("clear");
    setSelectedCycles([]);
    setSteps([]);
    setStepDraft("");
  }

  async function save() {
    if (!canSave) return;
    try {
      setSaving(true);
      setMessage(null);
      const result = await createAtlasMaintenanceDirective(objectKey, {
        maintenanceKind: kind,
        directiveKind,
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        assignedMembershipId: assigneeId,
        dueDate,
        workWindowKey: windowKey,
        effectPolicy: effect,
        targetCondition: kind === "weed" && effect === "target_condition" ? targetCondition : undefined,
        cropCycleIds: selectedCycles,
        steps,
      });
      setMessage(
        directiveKind === "prerequisite"
          ? `Prerequisite created. ${cardName} is held until it is finished.`
          : `${cardName} will carry this instruction on ${prettyDate(dueDate)}.`,
      );
      reset();
      await load();
      await onSaved?.();
      if (result.servingTaskId) window.setTimeout(() => setMessage(null), 5000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not attach this work to the maintenance card.");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(directiveId: string) {
    try {
      setMessage(null);
      await cancelAtlasMaintenanceDirective(objectKey, directiveId);
      await load();
      setMessage("Instruction cancelled. The perpetual card remains on its normal cycle.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not cancel this instruction.");
    }
  }

  if (!context) {
    return message ? <section className={styles.panel}><p className={styles.message}>{message}</p></section> : null;
  }

  const availableKinds: AtlasMaintenanceKind[] = [
    ...(context.capabilities.weed ? ["weed" as const] : []),
    ...(context.capabilities.mow ? ["mow" as const] : []),
  ];
  if (!availableKinds.length && !context.directives.length) return null;

  return (
    <section className={styles.panel} aria-label="Maintenance card work">
      <header className={styles.header}>
        <div>
          <span>Work attached to this place</span>
          <h2>Maintenance instructions</h2>
        </div>
        {context.canAuthor && availableKinds.length ? (
          <button type="button" onClick={() => setOpen((current) => !current)}>{open ? "Close" : "Add work"}</button>
        ) : null}
      </header>

      {context.directives.length ? (
        <div className={styles.activeList}>
          {context.directives.map((directive) => {
            const destination = directiveDestination(directive);
            return (
              <article key={directive.id} className={styles.activeDirective}>
                <small>{directive.directiveKind === "prerequisite" ? "Prerequisite" : "Attached instruction"} · {directive.maintenanceKind === "weed" ? "Weed Card" : "Mowing Card"}</small>
                <strong>{directive.title}</strong>
                <span>{directive.assignee.displayName} · {prettyDate(directive.dueDate)} · {directive.workWindowKey.replaceAll("_", " ")}</span>
                <em>{effectLabel(directive.effectPolicy, directive.targetCondition)}</em>
                <footer>
                  {destination ? <Link href={destination}>Open work ›</Link> : <span>Waiting for card release</span>}
                  {context.canAuthor ? <button type="button" onClick={() => void cancel(directive.id)}>Cancel</button> : null}
                </footer>
              </article>
            );
          })}
        </div>
      ) : null}

      {open && context.canAuthor ? (
        <div className={styles.composer}>
          <div className={styles.sentence} aria-label="Maintenance task sentence">
            <span>Create</span>
            <button type="button" className={styles.pill}>{title.trim() || "title"}</button>
            <span>on</span>
            <button type="button" className={styles.pill}>{cardName} · {context.object.label}</button>
            <span>for</span>
            <button type="button" className={styles.pill}>{selectedAssignee?.displayName || "assignee"}</button>
            <span>due</span>
            <button type="button" className={styles.pill}>{prettyDate(dueDate)}</button>
            <span>during</span>
            <button type="button" className={styles.pill}>{windows.find((window) => window.key === windowKey)?.label}</button>
          </div>

          {availableKinds.length > 1 ? (
            <fieldset>
              <legend>Attach to</legend>
              <div className={styles.choices}>
                {availableKinds.map((option) => (
                  <button key={option} type="button" data-selected={kind === option} onClick={() => setKind(option)}>
                    {option === "weed" ? "Weed Card" : "Mowing Card"}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend>Kind of work</legend>
            <div className={styles.choices}>
              <button type="button" data-selected={directiveKind === "instruction"} onClick={() => setDirectiveKind("instruction")}>Attach instruction</button>
              <button type="button" data-selected={directiveKind === "prerequisite"} onClick={() => setDirectiveKind("prerequisite")}>Create prerequisite</button>
            </div>
            <p>{directiveKind === "instruction" ? `The existing ${cardName} carries the instruction. Atlas does not create a rival maintenance task.` : `A separate preparation task must finish before the existing ${cardName} can proceed.`}</p>
          </fieldset>

          <label>
            <span>Task title</span>
            <input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "weed" ? "Pull giant pigweed beside the okra" : "Mow the guest-facing edge to four inches"} />
          </label>

          <label>
            <span>Instructions</span>
            <textarea value={instructions} maxLength={3000} rows={3} onChange={(event) => setInstructions(event.target.value)} placeholder="What should the person notice, preserve, or leave behind?" />
          </label>

          <div className={styles.twoColumns}>
            <label>
              <span>Assigned to</span>
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                {context.memberships.map((membership) => <option key={membership.membershipId} value={membership.membershipId}>{membership.displayName} · {membership.role.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input type="date" min={centralDate()} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>

          <fieldset>
            <legend>Lockscreen window</legend>
            <div className={styles.choices}>
              {windows.map((window) => (
                <button key={window.key} type="button" data-selected={windowKey === window.key} onClick={() => setWindowKey(window.key)}>{window.label}</button>
              ))}
            </div>
          </fieldset>

          {directiveKind === "instruction" ? (
            <fieldset>
              <legend>What does completion mean?</legend>
              <div className={styles.effectList}>
                {effectOptions.filter((option) => kind === "weed" || option.key !== "target_condition").map((option) => (
                  <button key={option.key} type="button" data-selected={effect === option.key} onClick={() => setEffect(option.key)}>
                    <strong>{option.title}</strong>
                    <span>{option.detail}</span>
                  </button>
                ))}
              </div>
              {kind === "weed" && effect === "target_condition" ? (
                <div className={styles.choices}>
                  {weedTargets.map((target) => <button key={target.key} type="button" data-selected={targetCondition === target.key} onClick={() => setTargetCondition(target.key)}>{target.label}</button>)}
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {activeCrops.length ? (
            <fieldset>
              <legend>Attach crop cycles</legend>
              <div className={styles.cropChoices}>
                {activeCrops.map((crop) => (
                  <button key={crop.id} type="button" data-selected={selectedCycles.includes(crop.id)} onClick={() => toggleCycle(crop.id)}>
                    <strong>{cropLabel(crop)}</strong>
                    <span>{crop.cycle_state.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend>Checklist</legend>
            {steps.length ? (
              <ol className={styles.steps}>
                {steps.map((step, index) => (
                  <li key={`${step}-${index}`}><span>{step}</span><button type="button" onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></li>
                ))}
              </ol>
            ) : null}
            <div className={styles.stepEntry}>
              <input value={stepDraft} maxLength={240} onChange={(event) => setStepDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addStep(); } }} placeholder="Add a step" />
              <button type="button" onClick={addStep}>Add</button>
            </div>
          </fieldset>

          <div className={styles.saveRow}>
            <p>{cardName} remains the perpetual record. This instruction lasts only until its real result is recorded.</p>
            <button type="button" disabled={!canSave || saving} onClick={() => void save()}>{saving ? "Attaching…" : directiveKind === "prerequisite" ? "Create prerequisite" : `Attach to ${cardName}`}</button>
          </div>
        </div>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}
