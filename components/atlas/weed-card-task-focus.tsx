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
  type AtlasCropOccupancyGroup,
  type AtlasSelectedCropTurnoverContext,
  type AtlasWeedBedTrailEvent,
  type AtlasWeedCardContext,
  type AtlasWeedSession,
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

type SavingAction = "result" | "blocked" | null;
type BedWorkResult = "heavy" | "mostly_clear" | "clear";

const BED_WORK_RESULTS: Array<{ condition: BedWorkResult; label: string }> = [
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

function dedupeCrops(groups: AtlasCropOccupancyGroup[]) {
  const seen = new Set<string>();
  return groups
    .flatMap((group) => group.cohorts)
    .filter((cohort) => {
      if (seen.has(cohort.cropCycleId)) return false;
      seen.add(cohort.cropCycleId);
      return true;
    })
    .sort((a, b) => lifecycleRank(a.lifeCycle) - lifecycleRank(b.lifeCycle) || a.displayLabel.localeCompare(b.displayLabel));
}

export default function WeedCardTaskFocus({ task, card, turnover, assignee }: Props) {
  const isClear = Boolean(turnover);
  const clearCrop = turnover ? displayCrop(turnover) : null;
  const family = isClear ? "Clear" : "Weed";
  const familyDetail = turnover ? clearCrop || turnover.cropLabel : card?.bedUseCategory || "bed care";
  const objectLabel = turnover ? turnover.collectionLabel : card?.objectLabel || "Bed";
  const zoneLabel = turnover ? turnover.zoneLabel : card?.zoneLabel || "";
  const mainCropLabel = turnover ? clearCrop : card?.mainCropLabel || null;
  const occupancyGroups = turnover ? turnover.occupancyGroups : card?.occupancyGroups || [];
  const activeCrops = dedupeCrops(occupancyGroups);
  const bedTrail: AtlasWeedBedTrailEvent[] = turnover ? turnover.bedTrail : card?.bedTrail || [];
  const bedMaps = turnover ? turnover.bedMaps : card?.bedMap ? [card.bedMap] : [];
  const sessions: AtlasWeedSession[] = turnover ? turnover.sessions : card?.sessions || [];
  const lastWeededOn = turnover ? turnover.lastWeededOn : card?.lastWeededOn || null;

  const [selectedCondition, setSelectedCondition] = useState<BedWorkResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [note, setNote] = useState("");
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedNote, setBlockedNote] = useState("");
  const [saving, setSaving] = useState<SavingAction>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!card && !turnover) return null;

  async function saveResult() {
    if (!selectedCondition) {
      setMessage("Choose a result first.");
      return;
    }
    const observation = note.trim();
    if (!observation) {
      setLogOpen(true);
      setMessage(`Log what you observed before saving the ${family} result.`);
      return;
    }

    try {
      setSaving("result");
      setMessage(null);

      if (turnover) {
        await postAtlasTaskTransition({
          taskId: task.task_id,
          transition: selectedCondition === "clear" ? "done" : "partial",
          note: observation,
          laneKey: "clear",
          workKey: "clear",
          payload: {
            weedManagementMode: "clear_selected_crop",
            selectedCropCycleId: turnover.cropCycleId,
            biomassDestination: turnover.biomassDestination,
            conditionAfter: selectedCondition,
            wholeBedTurnover: false,
          },
        });
      } else if (card) {
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
      }

      window.location.assign(returnTo(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Atlas could not save the ${family.toLowerCase()} result.`);
    } finally {
      setSaving(null);
    }
  }

  async function finishBlocked() {
    const blocker = blockedNote.trim();
    if (!blocker) {
      setMessage(`Say what stopped the ${family.toLowerCase()} work.`);
      return;
    }

    try {
      setSaving("blocked");
      setMessage(null);

      if (turnover) {
        await postAtlasTaskTransition({
          taskId: task.task_id,
          transition: "partial",
          note: `Blocked: ${blocker}`,
          laneKey: "clear",
          workKey: "clear",
          payload: {
            weedManagementMode: "clear_selected_crop",
            selectedCropCycleId: turnover.cropCycleId,
            biomassDestination: turnover.biomassDestination,
            conditionAfter: selectedCondition || "heavy",
            wholeBedTurnover: false,
          },
        });
      } else if (card) {
        await postAtlasFinishPartialWeedCardDay({
          taskId: task.task_id,
          minutes: null,
          conditionAfter: selectedCondition || card.condition,
          workDate: todayIso(),
          note: `Blocked: ${blocker}`,
        });
      }

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
    <main className={styles.shell} data-atlas-weed-card-template="task-card-lab-v4-spatial-result" data-atlas-bed-work-action={family.toLowerCase()}>
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family={family}
          familyDetail={familyDetail}
          title={objectLabel}
          subtitle={zoneLabel || undefined}
          timing={`Last weeded · ${prettyDate(lastWeededOn) || "not recorded"}`}
          completion={completion}
        >
          {bedTrail.length ? (
            <div className={styles.trail} aria-label={`${objectLabel} bed and crop trail`}>
              {bedTrail.map((step) => (
                <span key={`${step.taskId}-${step.eventDate}-${step.eventKind}`} data-state="done">
                  <b>{step.eventKind}</b>
                  <small>{step.cropLabel || shortTrailTitle(step.title)}</small>
                  <em>{prettyDate(step.eventDate)}</em>
                </span>
              ))}
            </div>
          ) : null}

          <section className={styles.bedNow}>
            <span>Bed now</span>
            <strong>{mainCropLabel || "Unknown main crop"}</strong>
          </section>

          {bedMaps.map((map) => (
            <section className={styles.bedMapSection} aria-label={`${map.objectLabel} bed diagram`} key={map.objectId}>
              <header><span>Bed map</span><small>{bedMaps.length > 1 ? `${map.objectLabel} · ` : ""}current crop occupancy</small></header>
              <CropOccupancyBedMap map={map} variant="notebook" />
            </section>
          ))}

          {activeCrops.length ? (
            <section className={styles.activeCrops} aria-label={`${objectLabel} active crops`}>
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

          {sessions.length ? (
            <section className={styles.history}>
              <header><span>Recent passes</span></header>
              <ol>{sessions.slice(0, 3).map((session) => (
                <li key={session.id}><span>{prettyDate(session.workDate)}</span><strong>{ATLAS_WEED_CONDITION_LABELS[session.conditionAfter]}</strong><small>{session.conditionBefore === session.conditionAfter ? "state held" : "changed"}</small></li>
              ))}</ol>
            </section>
          ) : null}

          <section className={styles.results}>
            <header><span>How’d we do?</span></header>
            <div className={styles.resultPills} role="group" aria-label={`${family} result`}>
              {BED_WORK_RESULTS.map(({ condition, label }) => (
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
                <input className={styles.optionalNote} value={note} disabled={busy} onChange={(event) => { setNote(event.target.value); setMessage(null); }} placeholder="What did you observe?" aria-label={`${family} observation`} required />
              </div>
            ) : null}
            {blockedOpen ? (
              <div className={styles.blockedDrawer}>
                <input value={blockedNote} disabled={busy} onChange={(event) => setBlockedNote(event.target.value)} placeholder="What stopped the work?" aria-label={`${family} blocker`} />
                <button type="button" disabled={busy || !blockedNote.trim()} onClick={() => void finishBlocked()}>{saving === "blocked" ? "Saving…" : "Record blocker"}</button>
              </div>
            ) : null}
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
