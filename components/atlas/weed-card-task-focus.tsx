"use client";

import { useState } from "react";

import CropOccupancyBedMap from "@/components/atlas/crop-occupancy-bed-map";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import MaintenanceDirectiveStrip from "@/components/atlas/maintenance-directive-strip";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import {
  ATLAS_WEED_CONDITION_LABELS,
  type AtlasCropOccupancyCohort,
  type AtlasSelectedCropTurnoverContext,
  type AtlasWeedCardContext,
} from "@/lib/atlas/weed-card-contract";
import {
  postAtlasFinishPartialWeedCardDay,
  postAtlasWeedCardSession,
} from "@/lib/atlas/weed-card-client";
import styles from "./weed-card-task-focus.module.css";

type Props = {
  task: AtlasTaskCard;
  card?: AtlasWeedCardContext;
  turnover?: AtlasSelectedCropTurnoverContext;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type StandardProps = Props & { card: AtlasWeedCardContext };
type TurnoverProps = Props & { turnover: AtlasSelectedCropTurnoverContext };
type SavingAction = "result" | "blocked" | null;
type WeedResult = "heavy" | "mostly_clear" | "clear";

type ClearTrailState = "done" | "now" | "later";
type ClearTrailStep = { label: string; detail: string; state: ClearTrailState };

const WEED_RESULTS: Array<{ condition: WeedResult; label: string }> = [
  { condition: "heavy", label: "Still rough" },
  { condition: "mostly_clear", label: "Mostly clear" },
  { condition: "clear", label: "All clear" },
];

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function returnTo(path: string) {
  const requested = new URLSearchParams(window.location.search).get("returnTo");
  return requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : path;
}

function titleCase(value: string | null | undefined) {
  if (!value) return "Lifecycle unknown";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function daysBetween(older: string, newer: string) {
  const oldDate = new Date(`${older.slice(0, 10)}T12:00:00`);
  const newDate = new Date(`${newer.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(oldDate.getTime()) || Number.isNaN(newDate.getTime())) return 0;
  return Math.floor((newDate.getTime() - oldDate.getTime()) / 86_400_000);
}

function cropNeedsFieldConfirmation(cohort: AtlasCropOccupancyCohort) {
  const stage = (cohort.stage || "").toLowerCase();
  if (stage !== "awaiting_germination" && stage !== "sown") return false;
  const observedOrEstablished = cohort.observedQuantityDate || cohort.establishmentDate;
  if (!observedOrEstablished) return false;
  return daysBetween(observedOrEstablished, todayIso()) > 21;
}

function lifecycleRank(value: string | null | undefined) {
  switch ((value || "").toLowerCase()) {
    case "perennial": return 0;
    case "biennial": return 1;
    case "annual": return 2;
    default: return 3;
  }
}

function shortTrailTitle(title: string) {
  return title
    .replace(/^Planting\s*[—-]\s*/i, "")
    .replace(/^Plant\s+/i, "")
    .replace(/^Transplant\s+/i, "")
    .trim();
}

function displayCrop(turnover: AtlasSelectedCropTurnoverContext) {
  if (!turnover.variety) return turnover.cropLabel;
  if (turnover.cropLabel.toLowerCase().includes(turnover.variety.toLowerCase())) return turnover.cropLabel;
  return `${turnover.variety} ${turnover.cropLabel}`;
}

function ClearTrail({ steps, label }: { steps: ClearTrailStep[]; label: string }) {
  return (
    <div className={styles.trail} aria-label={label}>
      {steps.map((step) => (
        <span data-state={step.state} key={`${step.label}-${step.detail}`}>
          <b>{step.label}</b>
          <small>{step.detail}</small>
        </span>
      ))}
    </div>
  );
}

function ClearReminder({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className={styles.turnoverReminderRow}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      <label htmlFor={id}><strong>{label}</strong></label>
    </div>
  );
}

function SelectedCropClearCard({ task, turnover, assignee }: TurnoverProps) {
  const crop = displayCrop(turnover);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<"done" | "unfinished" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const locations = turnover.locations.length ? turnover.locations : [turnover.collectionLabel];
  const clearItems = [
    ...locations.map((location) => `Remove ${crop} from ${location}`),
    `Take ${crop} biomass to ${turnover.biomassDestination}`,
  ];
  const trail: ClearTrailStep[] = [
    { label: "Harvest", detail: "finished", state: "done" },
    { label: "Clear", detail: "today", state: "now" },
    { label: "Compost", detail: turnover.biomassDestination, state: "later" },
  ];

  function toggleItem(index: number) {
    const key = `clear-${index}`;
    setCheckedItems((current) => ({ ...current, [key]: !current[key] }));
  }

  async function finish(outcome: "done" | "partial") {
    try {
      setSaving(outcome === "done" ? "done" : "unfinished");
      setMessage(null);
      const note = outcome === "done"
        ? `${crop} removed from ${locations.join(" + ")}; biomass taken to ${turnover.biomassDestination}. Other foot-bed crops left in place.`
        : `${crop} turnover unfinished; the crop remains active until the physical removal is completed.`;
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: outcome,
        note,
        laneKey: task.action_key || "clear",
        workKey: task.action_key || "clear",
        payload: {
          weedManagementMode: "clear_selected_crop",
          selectedCropCycleId: turnover.cropCycleId,
          biomassDestination: turnover.biomassDestination,
          wholeBedTurnover: false,
        },
      });
      window.location.assign(returnTo(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the clearing result.");
    } finally {
      setSaving(null);
    }
  }

  const busy = saving !== null;

  return (
    <main className={styles.shell} data-atlas-weed-card-template="task-card-editor-clear-variant">
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Clear"
          familyDetail="bed turnover"
          title={turnover.collectionLabel}
          timing="After harvest · clearing due"
          onDone={() => void finish("done")}
          onUnfinished={() => void finish("partial")}
          completionDisabled={busy}
        >
          <ClearTrail steps={trail} label={`${turnover.collectionLabel} crop-cycle clearing trail`} />

          <section className={styles.bedNow}>
            <span>Bed now</span>
            <strong>{crop}</strong>
            <div className={styles.bedFacts}>
              <b>{titleCase(turnover.cycleState || "finished_harvest")}</b>
              <b>{locations.join(" + ")}</b>
            </div>
          </section>

          {turnover.bedMaps.map((map) => (
            <section className={styles.bedMapSection} aria-label={`${map.objectLabel} crop map`} key={map.objectId}>
              <header><span>Bed map</span><small>{map.objectLabel} · current crop occupancy</small></header>
              <CropOccupancyBedMap map={map} variant="notebook" />
            </section>
          ))}

          <section className={styles.turnoverMethod}>
            <div className={styles.turnoverMethodKey}>tap to cross off</div>
            <section className={styles.turnoverCategory}>
              <header><h3>Clear</h3></header>
              <div className={styles.turnoverCategoryRail}>
                {clearItems.map((item, index) => (
                  <ClearReminder
                    id={`turnover-clear-${index}`}
                    label={item}
                    checked={Boolean(checkedItems[`clear-${index}`])}
                    onChange={() => toggleItem(index)}
                    key={item}
                  />
                ))}
              </div>
              {turnover.preserveOtherCrops ? (
                <div className={styles.turnoverAvailability}>Selected crop only · foot-bed crops stay in place</div>
              ) : null}
            </section>
          </section>

          {message ? <p className={styles.turnoverMessage}>{message}</p> : null}
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}

function StandardWeedCardTaskFocus({ task, card, assignee }: StandardProps) {
  const activeCrops = card.occupancyGroups
    .flatMap((group) => group.cohorts)
    .sort((a, b) => lifecycleRank(a.lifeCycle) - lifecycleRank(b.lifeCycle) || a.displayLabel.localeCompare(b.displayLabel));
  const [selectedCondition, setSelectedCondition] = useState<WeedResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [note, setNote] = useState("");
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedNote, setBlockedNote] = useState("");
  const [saving, setSaving] = useState<SavingAction>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function saveResult() {
    if (!selectedCondition) {
      setMessage("Choose a result first.");
      return;
    }
    const observation = note.trim();
    if (!observation) {
      setLogOpen(true);
      setMessage("Log what you observed before saving the Weed result.");
      return;
    }
    try {
      setSaving("result");
      setMessage(null);
      if (selectedCondition === "clear") {
        await postAtlasWeedCardSession({
          taskId: task.task_id,
          minutes: null,
          conditionAfter: "clear",
          workDate: todayIso(),
          note: observation,
        });
      } else {
        await postAtlasFinishPartialWeedCardDay({
          taskId: task.task_id,
          minutes: null,
          conditionAfter: selectedCondition,
          workDate: todayIso(),
          note: observation,
        });
      }
      window.location.assign(returnTo(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the bed’s current state.");
    } finally {
      setSaving(null);
    }
  }

  async function finishBlocked() {
    const blocker = blockedNote.trim();
    if (!blocker) {
      setMessage("Say what stopped the weeding.");
      return;
    }
    try {
      setSaving("blocked");
      setMessage(null);
      await postAtlasFinishPartialWeedCardDay({
        taskId: task.task_id,
        minutes: null,
        conditionAfter: selectedCondition || card.condition,
        workDate: todayIso(),
        note: `Blocked: ${blocker}`,
      });
      window.location.assign(returnTo(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not record the blocker.");
    } finally {
      setSaving(null);
    }
  }

  const busy = saving !== null;
  const completion = (
    <div className={styles.finish}>
      <button
        type="button"
        className={styles.saveResult}
        disabled={busy || !selectedCondition || !note.trim()}
        onClick={() => void saveResult()}
      >
        {saving === "result" ? "Saving…" : "Save result"}
      </button>
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-weed-card-template="task-card-lab-v4-spatial-result">
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Weed"
          familyDetail={card.bedUseCategory}
          title={card.objectLabel}
          subtitle={card.zoneLabel || undefined}
          timing={`Last weeded · ${prettyDate(card.lastWeededOn) || "not recorded"}`}
          completion={completion}
        >
          {card.bedTrail.length ? (
            <div className={styles.trail} aria-label={`${card.objectLabel} bed and crop trail`}>
              {card.bedTrail.map((step) => (
                <span key={`${step.taskId}-${step.eventDate}`} data-state="done">
                  <b>{step.eventKind}</b>
                  <small>{step.cropLabel || shortTrailTitle(step.title)}</small>
                  <em>{prettyDate(step.eventDate)}</em>
                </span>
              ))}
            </div>
          ) : null}

          <section className={styles.bedNow}>
            <span>Bed now</span>
            <strong>{card.mainCropLabel || "Unknown main crop"}</strong>
          </section>

          {card.bedMap ? (
            <section className={styles.bedMapSection} aria-label={`${card.objectLabel} bed diagram`}>
              <header><span>Bed map</span><small>current crop occupancy</small></header>
              <CropOccupancyBedMap map={card.bedMap} variant="notebook" />
            </section>
          ) : null}

          {activeCrops.length ? (
            <section className={styles.activeCrops} aria-label={`${card.objectLabel} active crops`}>
              <header><span>Active Crops</span></header>
              <div className={styles.cropRows}>
                {activeCrops.map((cohort) => {
                  const stale = cropNeedsFieldConfirmation(cohort);
                  const truthDate = cohort.observedQuantityDate || cohort.establishmentDate;
                  return (
                    <article className={styles.cropRow} key={cohort.cropCycleId} data-needs-confirmation={stale ? "true" : "false"}>
                      <div className={styles.cropIdentity}>
                        <strong>{cohort.displayLabel}</strong>
                        <small>{titleCase(cohort.lifeCycle)}</small>
                      </div>
                      <div className={styles.cropState}>
                        <b>{stale ? "Needs field confirmation" : cohort.stageLabel}</b>
                        {stale && truthDate ? <small>Last observed {cohort.stageLabel} · {prettyDate(truthDate)}</small> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className={styles.directive}><MaintenanceDirectiveStrip taskId={task.task_id} /></div>

          {card.sessions.length ? (
            <section className={styles.history}>
              <header><span>Recent passes</span></header>
              <ol>{card.sessions.slice(0, 3).map((session) => (
                <li key={session.id}><span>{prettyDate(session.workDate)}</span><strong>{ATLAS_WEED_CONDITION_LABELS[session.conditionAfter]}</strong><small>{session.conditionBefore === session.conditionAfter ? "state held" : "changed"}</small></li>
              ))}</ol>
            </section>
          ) : null}

          <section className={styles.results}>
            <header><span>How’d we do?</span></header>
            <div className={styles.resultPills} role="group" aria-label="Weed result">
              {WEED_RESULTS.map(({ condition, label }) => (
                <button type="button" key={condition} data-active={selectedCondition === condition ? "true" : "false"} aria-pressed={selectedCondition === condition} disabled={busy} onClick={() => { setSelectedCondition(condition); setMessage(null); }}>
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.resultActions}>
              <button type="button" className={styles.logButton} aria-expanded={logOpen} disabled={busy} onClick={() => setLogOpen((open) => !open)}>Log it</button>
              <button type="button" className={styles.blockedAction} aria-expanded={blockedOpen} disabled={busy} onClick={() => setBlockedOpen((open) => !open)}>Blocked</button>
            </div>
            {logOpen ? (
              <div className={styles.logDrawer}>
                <input className={styles.optionalNote} value={note} disabled={busy} onChange={(event) => { setNote(event.target.value); setMessage(null); }} placeholder="What did you observe?" aria-label="Weeding observation" required />
              </div>
            ) : null}
            {blockedOpen ? (
              <div className={styles.blockedDrawer}>
                <input value={blockedNote} disabled={busy} onChange={(event) => setBlockedNote(event.target.value)} placeholder="What stopped the work?" aria-label="Weeding blocker" />
                <button type="button" disabled={busy || !blockedNote.trim()} onClick={() => void finishBlocked()}>{saving === "blocked" ? "Saving…" : "Record blocker"}</button>
              </div>
            ) : null}
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}

export default function WeedCardTaskFocus(props: Props) {
  if (props.turnover) return <SelectedCropClearCard {...props} turnover={props.turnover} />;
  if (props.card) return <StandardWeedCardTaskFocus {...props} card={props.card} />;
  return null;
}
