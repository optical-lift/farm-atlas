"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FieldLogDrawer } from "@/components/atlas/field-log-builder";
import {
  createAtlasManualTask,
  fetchAtlasManualTaskContext,
  type AtlasManualTaskActionKind,
  type AtlasManualTaskContext,
  type AtlasManualTaskDateCommitment,
  type AtlasManualTaskEffort,
} from "@/lib/atlas/manual-task-client";
import { fetchAtlasObjectWorkbench, type AtlasObjectCropCycle } from "@/lib/atlas/object-workbench-client";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

import styles from "./global-atlas-add.module.css";

type WorkWindow = "first_thing" | "morning" | "midday" | "afternoon" | "evening";
type AddMode = "work" | "log";

const actions: Array<{ key: AtlasManualTaskActionKind; label: string }> = [
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

const efforts: Array<{ key: AtlasManualTaskEffort; label: string }> = [
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

function workloadSentence(context: AtlasManualTaskContext, commitment: AtlasManualTaskDateCommitment) {
  const load = context.dayLoad;
  if (!load) return "Atlas will calculate this person’s farm-day load when the person and date are selected.";
  const mix = `${load.lightCount} light, ${load.standardCount} standard, and ${load.heavyCount} heavy`;
  if (!load.overloaded) {
    return `${prettyDate(load.workDate)} currently contains ${mix} obligations · ${load.totalUnits} of ${load.dailyUnitBudget} workload units.`;
  }
  if (commitment === "hard_date") {
    return `${prettyDate(load.workDate)} is overloaded with ${mix} obligations. This hard-date card will still appear and notify the assigned person.`;
  }
  return `${prettyDate(load.workDate)} is overloaded with ${mix} obligations. Atlas will keep this floating obligation discretionary when presenting the farm day.`;
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
  const [context, setContext] = useState<AtlasManualTaskContext | null>(null);
  const [cropCycles, setCropCycles] = useState<AtlasObjectCropCycle[]>([]);
  const [loadingObject, setLoadingObject] = useState(false);
  const [actionKind, setActionKind] = useState<AtlasManualTaskActionKind>("check");
  const [title, setTitle] = useState("");
  const [currentTruth, setCurrentTruth] = useState("");
  const [afterTruth, setAfterTruth] = useState("");
  const [unlockText, setUnlockText] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(centralDate(1));
  const [windowKey, setWindowKey] = useState<WorkWindow>("morning");
  const [effortClass, setEffortClass] = useState<AtlasManualTaskEffort>("standard");
  const [dateCommitment, setDateCommitment] = useState<AtlasManualTaskDateCommitment>("hard_date");
  const [bringIntoWorkNow, setBringIntoWorkNow] = useState(false);
  const [selectedCycles, setSelectedCycles] = useState<string[]>([]);
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
  const hasRealChange = currentTruth.trim() !== afterTruth.trim();
  const canSave = Boolean(
    context?.canAuthor
      && objectKey
      && title.trim()
      && currentTruth.trim()
      && afterTruth.trim()
      && hasRealChange
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
      fetchAtlasManualTaskContext(objectKey),
      fetchAtlasObjectWorkbench(objectKey),
    ])
      .then(([nextContext, workbench]) => {
        if (!active) return;
        setContext(nextContext);
        setCropCycles(workbench.cropCycles);
        setAssigneeId((current) => current || nextContext.viewerMembershipId || nextContext.memberships[0]?.membershipId || "");
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

  useEffect(() => {
    if (!open || mode !== "work" || !objectKey || !assigneeId || !dueDate) return;
    let active = true;
    fetchAtlasManualTaskContext(objectKey, assigneeId, dueDate)
      .then((nextContext) => {
        if (active) setContext(nextContext);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Atlas could not calculate this farm day.");
      });
    return () => {
      active = false;
    };
  }, [assigneeId, dueDate, mode, objectKey, open]);

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

  function resetCard() {
    setZoneKey("");
    setObjectKey("");
    setContext(null);
    setCropCycles([]);
    setActionKind("check");
    setTitle("");
    setCurrentTruth("");
    setAfterTruth("");
    setUnlockText("");
    setAssigneeId("");
    setDueDate(centralDate(1));
    setWindowKey("morning");
    setEffortClass("standard");
    setDateCommitment("hard_date");
    setBringIntoWorkNow(false);
    setSelectedCycles([]);
  }

  async function save() {
    if (!canSave || !context) return;
    try {
      setSaving(true);
      setMessage(null);
      const result = await createAtlasManualTask(objectKey, {
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
      const assigneeName = result.assignee?.displayName || selectedAssignee?.displayName || "the assigned person";
      const taskDate = result.task?.dueDate || dueDate;
      setMessage(`${selectedAction.label} task created for ${assigneeName} on ${prettyDate(taskDate)}.`);
      resetCard();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not create this task.");
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

              {loadingObject ? <p className={styles.muted}>Loading the real place, crops, people, and farm-day load…</p> : null}

              {context && !context.canAuthor ? (
                <section className={styles.notice}>
                  <strong>Planning stays with the Owner or manager.</strong>
                  <span>Use “Document what happened” to record field work from this account.</span>
                </section>
              ) : null}

              {context?.canAuthor ? (
                <>
                  <section className={styles.section}>
                    <header><span>4</span><div><strong>The state change</strong><small>The person making the card defines what Done will make true.</small></div></header>
                    <label><span>Title</span><input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder={`${selectedAction.label} what?`} /></label>
                    <label><span>Current truth</span><textarea rows={3} value={currentTruth} maxLength={600} onChange={(event) => setCurrentTruth(event.target.value)} placeholder={`What is true about ${selectedObject?.label || "this place"} now?`} /></label>
                    <label><span>Truth after completion</span><textarea rows={3} value={afterTruth} maxLength={600} onChange={(event) => setAfterTruth(event.target.value)} placeholder="What becomes true when the worker taps Done?" /></label>
                    {currentTruth.trim() && afterTruth.trim() && !hasRealChange ? <p className={styles.error}>Current truth and after truth must describe a real change.</p> : null}
                    <label><span>Unlocks or protects</span><input value={unlockText} maxLength={600} onChange={(event) => setUnlockText(event.target.value)} placeholder="Optional consequence or next move" /></label>
                  </section>

                  <section className={styles.section}>
                    <header><span>5</span><div><strong>Person and farm day</strong><small>The date is the farm obligation; the window controls the lockscreen.</small></div></header>
                    <div className={styles.twoColumns}>
                      <label><span>Assigned to</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>{context.memberships.map((membership) => <option key={membership.membershipId} value={membership.membershipId}>{membership.displayName} · {membership.activeTaskCount} active</option>)}</select></label>
                      <label><span>Farm day</span><input type="date" min={centralDate()} max={centralDate(1825)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
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
                    <header><span>{activeCycles.length ? "7" : "6"}</span><div><strong>How firm is this farm day?</strong><small>Atlas remembers every decision. This choice controls commitment and presentation.</small></div></header>
                    <div className={styles.releaseGrid}>
                      <button type="button" data-selected={dateCommitment === "hard_date"} onClick={() => setDateCommitment("hard_date")}><strong>Must happen that day</strong><span>Atlas commits the card to that farm day.</span></button>
                      <button type="button" data-selected={dateCommitment === "floating"} onClick={() => setDateCommitment("floating")}><strong>Can float around that day</strong><span>Atlas marks this as discretionary work when presenting the farm day.</span></button>
                    </div>
                    <p className={styles.capacity} data-over={Boolean(context.dayLoad?.overloaded)}>{workloadSentence(context, dateCommitment)}</p>
                    <label>
                      <span>Owner exception</span>
                      <span><input type="checkbox" checked={bringIntoWorkNow} onChange={(event) => setBringIntoWorkNow(event.target.checked)} /> Bring into Work now</span>
                    </label>
                  </section>

                  <button type="button" className={styles.save} disabled={!canSave || saving} onClick={() => void save()}>
                    {saving ? "Saving obligation…" : "Create task"}
                  </button>
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