"use client";

import { useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import MaintenanceDirectiveStrip from "@/components/atlas/maintenance-directive-strip";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  ATLAS_WEED_CONDITION_LABELS,
  type AtlasCropOccupancyCohort,
  type AtlasWeedCardContext,
} from "@/lib/atlas/weed-card-contract";
import {
  postAtlasFinishPartialWeedCardDay,
  postAtlasWeedCardSession,
} from "@/lib/atlas/weed-card-client";
import styles from "./weed-card-task-focus.module.css";

type Props = {
  task: AtlasTaskCard;
  card: AtlasWeedCardContext;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type SavingAction = "result" | "blocked" | null;
type WeedResult = "heavy" | "mostly_clear" | "clear";

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

export default function WeedCardTaskFocus({ task, card, assignee }: Props) {
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
    try {
      setSaving("result");
      setMessage(null);
      if (selectedCondition === "clear") {
        await postAtlasWeedCardSession({
          taskId: task.task_id,
          minutes: null,
          conditionAfter: "clear",
          workDate: todayIso(),
          note: note.trim() || undefined,
        });
      } else {
        await postAtlasFinishPartialWeedCardDay({
          taskId: task.task_id,
          minutes: null,
          conditionAfter: selectedCondition,
          workDate: todayIso(),
          note: note.trim() || undefined,
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
      <button type="button" className={styles.blockedAction} disabled={busy} onClick={() => setBlockedOpen((open) => !open)}>Blocked</button>
      {blockedOpen ? (
        <div className={styles.blockedDrawer}>
          <input value={blockedNote} disabled={busy} onChange={(event) => setBlockedNote(event.target.value)} placeholder="What stopped the work?" aria-label="Weeding blocker" />
          <button type="button" disabled={busy || !blockedNote.trim()} onClick={() => void finishBlocked()}>{saving === "blocked" ? "Saving…" : "Record blocker"}</button>
        </div>
      ) : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-weed-card-template="task-card-lab-v3-three-way-result">
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
              <button type="button" className={styles.saveResult} disabled={busy || !selectedCondition} onClick={() => void saveResult()}>
                {saving === "result" ? "Saving…" : "Save result"}
              </button>
            </div>
            {logOpen ? (
              <div className={styles.logDrawer}>
                <input className={styles.optionalNote} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Note (optional)" aria-label="Optional weeding note" />
              </div>
            ) : null}
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}