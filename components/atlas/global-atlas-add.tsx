"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldLogDrawer } from "@/components/atlas/field-log-builder";
import {
  createAtlasObjectWork,
  fetchAtlasObjectWorkContext,
  type AtlasObjectWorkActionKind,
  type AtlasObjectWorkContext,
  type AtlasObjectWorkEffort,
  type AtlasObjectWorkReleaseMode,
} from "@/lib/atlas/object-work-client";
import { fetchAtlasObjectWorkbench, type AtlasObjectCropCycle } from "@/lib/atlas/object-workbench-client";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

import styles from "./global-atlas-add.module.css";

type WorkWindow = "first_thing" | "morning" | "midday" | "afternoon" | "evening";
type AddMode = "work" | "log";

const actions: Array<{ key: AtlasObjectWorkActionKind; label: string }> = [
  { key: "check", label: "Check" },
  { key: "water", label: "Water" },
  { key: "sow", label: "Sow" },
  { key: "transplant", label: "Transplant" },
  { key: "harvest", label: "Harvest" },
  { key: "repair", label: "Repair" },
  { key: "reset", label: "Reset" },
  { key: "prepare", label: "Prepare" },
  { key: "deliver", label: "Deliver" },
  { key: "other", label: "Other" },
];

const windows: Array<{ key: WorkWindow; label: string }> = [
  { key: "first_thing", label: "First thing" },
  { key: "morning", label: "Morning" },
  { key: "midday", label: "Midday" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const efforts: Array<{ key: AtlasObjectWorkEffort; label: string }> = [
  { key: "light", label: "Light" },
  { key: "standard", label: "Standard" },
  { key: "heavy", label: "Heavy" },
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

function compactSpot(label: string) {
  const berry = label.match(/Berry Walk Bed\s*(\d+)/i);
  if (berry) return `BW${berry[1]}`;
  const barn = label.match(/Barn Bed\s*(\d+)/i);
  if (barn) return `BB${barn[1]}`;
  const field = label.match(/Field Row\s*(\d+)/i);
  if (field) return `FR${field[1]}`;
  const entry = label.match(/Entry Billboard(?: Sunflower)? Bed\s*(\d+)/i);
  if (entry) return `EB${entry[1]}`;
  return label;
}

function cropLabel(crop: AtlasObjectCropCycle) {
  return crop.variety && !crop.crop_label.toLowerCase().includes(crop.variety.toLowerCase())
    ? `${crop.variety} ${crop.crop_label}`
    : crop.crop_label;
}

export default function GlobalAtlasAdd() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AddMode>("work");
  const [zones, setZones] = useState<AtlasRegistryZone[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [zoneKey, setZoneKey] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [context, setContext] = useState<AtlasObjectWorkContext | null>(null);
  const [cropCycles, setCropCycles] = useState<AtlasObjectCropCycle[]>([]);
  const [loadingObject, setLoadingObject] = useState(false);
  const [actionKind, setActionKind] = useState<AtlasObjectWorkActionKind>("check");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [doneDefinition, setDoneDefinition] = useState("");
  const [unlockText, setUnlockText] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(centralDate(1));
  const [windowKey, setWindowKey] = useState<WorkWindow>("morning");
  const [effortClass, setEffortClass] = useState<AtlasObjectWorkEffort>("standard");
  const [releaseMode, setReleaseMode] = useState<AtlasObjectWorkReleaseMode>("put_in_work");
  const [selectedCycles, setSelectedCycles] = useState<string[]>([]);
  const [stepDraft, setStepDraft] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedZone = zones.find((zone) => zone.stable_key === zoneKey) ?? null;
  const visibleObjects = selectedZone?.objects ?? [];
  const selectedObject = visibleObjects.find((object) => object.stable_key === objectKey) ?? null;
  const selectedAction = actions.find((action) => action.key === actionKind) ?? actions[0];
  const selectedAssignee = context?.memberships.find((membership) => membership.membershipId === assigneeId) ?? null;
  const activeCycles = useMemo(
    () => cropCycles.filter((cycle) => cycle.lifecycle_status !== "archived" && cycle.cycle_state !== "superseded"),
    [cropCycles],
  );
  const canSave = Boolean(
    context?.canAuthor
      && objectKey
      && title.trim()
      && doneDefinition.trim()
      && assigneeId
      && dueDate,
  );

  async function loadRegistry() {
    if (zones.length || loadingRegistry) return;
    try {
      setLoadingRegistry(true);
      setRegistryError(null);
      const response = await fetchAtlasZoneRegistry();
      setZones(response.zones ?? []);
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : "Atlas could not load farm places.");
    } finally {
      setLoadingRegistry(false);
    }
  }

  function openAdd() {
    setOpen(true);
    setMode("work");
    setMessage(null);
    void loadRegistry();
  }

  function closeAdd() {
    setOpen(false);
    setMode("work");
    setMessage(null);
  }

  useEffect(() => {
    if (!open || mode !== "work" || !objectKey) {
      setContext(null);
      setCropCycles([]);
      return;
    }
    let active = true;
    setLoadingObject(true);
    setMessage(null);
    Promise.all([
      fetchAtlasObjectWorkContext(objectKey),
      fetchAtlasObjectWorkbench(objectKey),
    ])
      .then(([nextContext, workbench]) => {
        if (!active) return;
        setContext(nextContext);
        setCropCycles(workbench.cropCycles);
        setAssigneeId((current) => current || nextContext.viewerMembershipId || nextContext.memberships[0]?.membershipId || "");
        if (nextContext.capacity.farmAtCapacity) setReleaseMode("hold_for_capacity");
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Atlas could not load this place.");
      })
      .finally(() => {
        if (active) setLoadingObject(false);
      });
    return () => {
      active = false;
    };
  }, [objectKey, open, mode]);

  function chooseZone(nextZoneKey: string) {
    setZoneKey(nextZoneKey);
    setObjectKey("");
    setContext(null);
    setCropCycles([]);
    setSelectedCycles([]);
    setAssigneeId("");
  }

  function chooseObject(object: AtlasRegistryObject) {
    setObjectKey(object.stable_key);
    setContext(null);
    setCropCycles([]);
    setSelectedCycles([]);
    setAssigneeId("");
  }

  function toggleCycle(id: string) {
    setSelectedCycles((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function addStep() {
    const value = stepDraft.trim();
    if (!value || steps.length >= 20) return;
    setSteps((current) => [...current, value]);
    setStepDraft("");
  }

  function resetCard() {
    setZoneKey("");
    setObjectKey("");
    setContext(null);
    setCropCycles([]);
    setActionKind("check");
    setTitle("");
    setInstructions("");
    setDoneDefinition("");
    setUnlockText("");
    setAssigneeId("");
    setDueDate(centralDate(1));
    setWindowKey("morning");
    setEffortClass("standard");
    setReleaseMode("put_in_work");
    setSelectedCycles([]);
    setSteps([]);
    setStepDraft("");
  }

  async function save() {
    if (!canSave || !context) return;
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
        ? `${selectedAction.label} card is in Work for ${result.workItem.assignee.displayName} on ${prettyDate(result.workItem.dueDate)}.`
        : `${selectedAction.label} card is attached to ${result.workItem.object.label} and held outside Work until capacity admits it.`);
      resetCard();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not create this work card.");
    } finally {
      setSaving(false);
    }
  }

  function openMaintenance(kind: "weed" | "mow") {
    if (!objectKey) return;
    closeAdd();
    router.push(`/objects/${encodeURIComponent(objectKey)}?author=${kind}`);
  }

  if (open && mode === "log") {
    return (
      <>
        <button type="button" className={styles.floatingButton} aria-label="Add to Atlas" onClick={openAdd}>+</button>
        <FieldLogDrawer
          zones={zones}
          onClose={closeAdd}
          onSaved={() => {
            closeAdd();
            router.refresh();
          }}
        />
      </>
    );
  }

  return (
    <>
      <button type="button" className={styles.floatingButton} aria-label="Add to Atlas" onClick={openAdd}>+</button>

      {open ? (
        <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true" aria-label="Add to Atlas">
          <div className={`atlas-task-focus-phone ${styles.phone}`}>
            <div className={`atlas-task-focus-topbar ${styles.topbar}`}>
              <div>
                <strong>Add to Atlas</strong>
                <span>Build a real sentence</span>
              </div>
              <button type="button" onClick={closeAdd}>Close</button>
            </div>

            <div className={`atlas-task-focus-body ${styles.body}`}>
              <div className={styles.modeTabs} role="tablist" aria-label="What are you adding?">
                <button type="button" role="tab" aria-selected={mode === "work"} onClick={() => setMode("work")}>Make a Work Card</button>
                <button type="button" role="tab" aria-selected={mode === "log"} onClick={() => setMode("log")}>Document what happened</button>
              </div>

              <div className={styles.sentence} aria-label="Task sentence">
                <span>Create</span>
                <b>{selectedAction.label}</b>
                <b>{title.trim() || "work"}</b>
                <span>in</span>
                <b>{selectedZone?.label || "an area"}</b>
                <span>at</span>
                <b>{selectedObject ? compactSpot(selectedObject.label) : "a place"}</b>
                <span>for</span>
                <b>{selectedAssignee?.displayName || "someone"}</b>
                <span>on</span>
                <b>{prettyDate(dueDate)}</b>
              </div>

              <section className={styles.section}>
                <header><span>1</span><div><strong>Area</strong><small>Choose the part of the farm.</small></div></header>
                {loadingRegistry ? <p className={styles.muted}>Loading farm places…</p> : null}
                {registryError ? <p className={styles.error}>{registryError}</p> : null}
                <div className={styles.chips}>
                  {zones.map((zone) => (
                    <button key={zone.id} type="button" data-selected={zoneKey === zone.stable_key} onClick={() => chooseZone(zone.stable_key)}>{zone.label}</button>
                  ))}
                </div>
              </section>

              <section className={styles.section}>
                <header><span>2</span><div><strong>Bed or place</strong><small>One canonical object owns this card.</small></div></header>
                {!selectedZone ? <p className={styles.muted}>Choose an area first.</p> : null}
                <div className={styles.chips}>
                  {visibleObjects.map((object) => (
                    <button key={object.id} type="button" data-selected={objectKey === object.stable_key} onClick={() => chooseObject(object)}>{compactSpot(object.label)}</button>
                  ))}
                </div>
              </section>

              {selectedObject ? (
                <section className={styles.section}>
                  <header><span>3</span><div><strong>Kind of work</strong><small>Weed and Mow stay attached to their perpetual cards.</small></div></header>
                  <div className={styles.chips}>
                    {actions.map((action) => (
                      <button key={action.key} type="button" data-selected={actionKind === action.key} onClick={() => setActionKind(action.key)}>{action.label}</button>
                    ))}
                  </div>
                  <div className={styles.maintenanceRow}>
                    <button type="button" onClick={() => openMaintenance("weed")}><strong>Weed</strong><span>Open this place’s Weed Card</span></button>
                    <button type="button" onClick={() => openMaintenance("mow")}><strong>Mow</strong><span>Open governed mowing</span></button>
                  </div>
                </section>
              ) : null}

              {loadingObject ? <p className={styles.muted}>Loading the real place, crops, people, and capacity…</p> : null}

              {context && !context.canAuthor ? (
                <section className={styles.notice}>
                  <strong>Planning stays with the Owner or manager.</strong>
                  <span>Use “Document what happened” to record field work from this account.</span>
                </section>
              ) : null}

              {context?.canAuthor ? (
                <>
                  <section className={styles.section}>
                    <header><span>4</span><div><strong>The card</strong><small>Say what to do and what physical state proves it is done.</small></div></header>
                    <label><span>Title</span><input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder={`${selectedAction.label} what?`} /></label>
                    <label><span>Instruction</span><textarea rows={3} value={instructions} maxLength={3000} onChange={(event) => setInstructions(event.target.value)} placeholder="What should be done, noticed, preserved, or left alone?" /></label>
                    <label><span>Done means</span><textarea rows={2} value={doneDefinition} maxLength={600} onChange={(event) => setDoneDefinition(event.target.value)} placeholder="Describe what must be physically true afterward." /></label>
                    <label><span>Unlocks or protects</span><input value={unlockText} maxLength={600} onChange={(event) => setUnlockText(event.target.value)} placeholder="Optional consequence or next move" /></label>
                  </section>

                  <section className={styles.section}>
                    <header><span>5</span><div><strong>Person and farm day</strong><small>The date is the farm obligation; the window controls the lockscreen.</small></div></header>
                    <div className={styles.twoColumns}>
                      <label><span>Assigned to</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>{context.memberships.map((membership) => <option key={membership.membershipId} value={membership.membershipId}>{membership.displayName} · {membership.activeTaskCount} active</option>)}</select></label>
                      <label><span>Farm day</span><input type="date" min={centralDate()} max={centralDate(180)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
                    </div>
                    <div className={styles.choiceBlock}><span>Lockscreen window</span><div className={styles.chips}>{windows.map((window) => <button key={window.key} type="button" data-selected={windowKey === window.key} onClick={() => setWindowKey(window.key)}>{window.label}</button>)}</div></div>
                    <div className={styles.choiceBlock}><span>Physical size</span><div className={styles.chips}>{efforts.map((effort) => <button key={effort.key} type="button" data-selected={effortClass === effort.key} onClick={() => setEffortClass(effort.key)}>{effort.label}</button>)}</div></div>
                  </section>

                  {activeCycles.length ? (
                    <section className={styles.section}>
                      <header><span>6</span><div><strong>Real crop cycles</strong><small>The task will remain attached to this crop history.</small></div></header>
                      <div className={styles.cropGrid}>{activeCycles.map((crop) => <button key={crop.id} type="button" data-selected={selectedCycles.includes(crop.id)} onClick={() => toggleCycle(crop.id)}><strong>{cropLabel(crop)}</strong><span>{crop.cycle_state.replaceAll("_", " ")}</span></button>)}</div>
                    </section>
                  ) : null}

                  <section className={styles.section}>
                    <header><span>{activeCycles.length ? "7" : "6"}</span><div><strong>Checkable steps</strong><small>Optional small pieces inside the same card.</small></div></header>
                    <div className={styles.stepEntry}><input value={stepDraft} maxLength={240} onChange={(event) => setStepDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addStep(); } }} placeholder="Add a step" /><button type="button" onClick={addStep}>Add</button></div>
                    {steps.length ? <ol className={styles.steps}>{steps.map((step, index) => <li key={`${step}:${index}`}><span>{step}</span><button type="button" onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></li>)}</ol> : null}
                  </section>

                  <section className={styles.section}>
                    <header><span>{activeCycles.length ? "8" : "7"}</span><div><strong>Put it somewhere truthful</strong><small>Planning and active Work are different states.</small></div></header>
                    <div className={styles.releaseGrid}>
                      <button type="button" data-selected={releaseMode === "put_in_work"} onClick={() => setReleaseMode("put_in_work")}><strong>Put in Work</strong><span>Create the assigned card now.</span></button>
                      <button type="button" data-selected={releaseMode === "hold_for_capacity"} onClick={() => setReleaseMode("hold_for_capacity")}><strong>Hold as planned</strong><span>Keep it attached to the place until capacity admits it.</span></button>
                    </div>
                    <p className={styles.capacity} data-over={context.capacity.farmAtCapacity}>Farm Work is carrying {context.capacity.activeTopLevel} top-level cards against a limit of {context.capacity.maximumTopLevel}.</p>
                  </section>

                  <button type="button" className={styles.save} disabled={!canSave || saving} onClick={() => void save()}>{saving ? "Creating card…" : releaseMode === "put_in_work" ? "Put card in Work" : "Save planned card"}</button>
                </>
              ) : null}

              {message ? <p className={styles.message}>{message}</p> : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
