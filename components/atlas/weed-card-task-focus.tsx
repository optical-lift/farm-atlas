"use client";

import { useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import CropOccupancyList from "@/components/atlas/crop-occupancy-list";
import MaintenanceDirectiveStrip from "@/components/atlas/maintenance-directive-strip";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  addDaysIso,
  centralDateIso,
  postAtlasTaskSetAsideToday,
} from "@/lib/atlas/task-set-aside-client";
import {
  ATLAS_WEED_CONDITIONS,
  ATLAS_WEED_CONDITION_LABELS,
  type AtlasWeedCardContext,
  type AtlasWeedCondition,
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

type SavingAction = "result" | "blocked" | "log" | "set_aside" | null;

const RESULT_LABELS: Record<AtlasWeedCondition, string> = {
  heavy: "Still rough",
  medium_pressure: "Medium pressure",
  row_readable: "Crop readable",
  mostly_clear: "Mostly clear",
  clear: "Clear",
};

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

export default function WeedCardTaskFocus({ task, card, assignee }: Props) {
  const currentIndex = Math.max(0, ATLAS_WEED_CONDITIONS.indexOf(card.condition));
  const resultChoices = ATLAS_WEED_CONDITIONS.slice(currentIndex);
  const tomorrow = useMemo(() => addDaysIso(centralDateIso(), 1), []);
  const latestSession = card.sessions[0] ?? null;
  const primaryCohort = card.occupancyGroups.flatMap((group) => group.cohorts)[0] ?? null;
  const [selectedCondition, setSelectedCondition] = useState<AtlasWeedCondition | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [note, setNote] = useState("");
  const [blockedNote, setBlockedNote] = useState("");
  const [moveDate, setMoveDate] = useState(tomorrow);
  const [saving, setSaving] = useState<SavingAction>(null);
  const [message, setMessage] = useState<string | null>(null);

  const trail = [
    { label: "Weeded", detail: latestSession ? prettyDate(latestSession.workDate) || "recorded" : "not recorded", state: latestSession ? "done" : "later" },
    { label: "Bed", detail: primaryCohort?.stageLabel || "crop state", state: "done" },
    { label: "Weed", detail: "today", state: "now" },
    { label: "Target", detail: ATLAS_WEED_CONDITION_LABELS[card.targetCondition], state: "later" },
    { label: "Review", detail: card.nextReviewOn ? prettyDate(card.nextReviewOn) || card.nextReviewOn : "after this pass", state: "later" },
  ] as const;

  async function finishResult() {
    if (!selectedCondition) {
      setMessage("Choose what the bed looks like now.");
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

  async function logPass() {
    if (!note.trim()) {
      setMessage("Add the field note you want Atlas to keep.");
      return;
    }
    try {
      setSaving("log");
      setMessage(null);
      await postAtlasWeedCardSession({
        taskId: task.task_id,
        minutes: null,
        conditionAfter: selectedCondition || card.condition,
        workDate: todayIso(),
        note: note.trim(),
      });
      setNote("");
      setLogOpen(false);
      setMessage("Field note logged.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not log the field note.");
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

  async function setAsideToday(requestedReturnDate: string) {
    try {
      setSaving("set_aside");
      setMessage(null);
      const result = await postAtlasTaskSetAsideToday(task.task_id, requestedReturnDate);
      setMessage(result.message);
      window.setTimeout(() => window.location.assign(returnTo(assignee.listPath)), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not move this Weed Card.");
      setSaving(null);
    }
  }

  const busy = saving !== null;
  const timingDate = prettyDate(task.due_date);
  const completion = (
    <div className={styles.finish}>
      <span>Finish Weed</span>
      <div className={styles.finishButtons}>
        <button type="button" className={styles.primaryFinish} disabled={busy || !selectedCondition} onClick={() => void finishResult()}>
          {saving === "result" ? "Saving…" : "Done weeding today"}
        </button>
        <button type="button" disabled={busy} onClick={() => setBlockedOpen((open) => !open)}>Blocked</button>
      </div>

      {blockedOpen ? (
        <div className={styles.blockedDrawer}>
          <input value={blockedNote} disabled={busy} onChange={(event) => setBlockedNote(event.target.value)} placeholder="What stopped the work?" aria-label="Weeding blocker" />
          <button type="button" disabled={busy || !blockedNote.trim()} onClick={() => void finishBlocked()}>{saving === "blocked" ? "Saving…" : "Record blocker"}</button>
        </div>
      ) : null}

      <details className={styles.moveDrawer}>
        <summary><span>Move this card</span><b aria-hidden="true">⌄</b></summary>
        <div className={styles.moveOptions}>
          <button type="button" disabled={busy} onClick={() => void setAsideToday(tomorrow)}>Tomorrow</button>
          <label><span>Choose return date</span><input type="date" min={tomorrow} value={moveDate} disabled={busy} onChange={(event) => setMoveDate(event.target.value)} /></label>
          <button type="button" disabled={busy || !moveDate} onClick={() => void setAsideToday(moveDate)}>{saving === "set_aside" ? "Saving…" : `Move to ${prettyDate(moveDate)}`}</button>
        </div>
      </details>
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-weed-card-template="task-card-lab-v1">
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Weed"
          familyDetail="bed care"
          title={card.objectLabel}
          subtitle={card.zoneLabel || undefined}
          timing={timingDate ? `Today · ${timingDate}` : "Weeding due"}
          completion={completion}
        >
          <div className={styles.trail} aria-label={`${card.objectLabel} weed continuity`}>
            {trail.map((step) => (
              <span key={`${step.label}-${step.detail}`} data-state={step.state}>
                <b>{step.label}</b><small>{step.detail}</small>
              </span>
            ))}
          </div>

          <section className={styles.bedNow}>
            <span>Bed now</span>
            <strong>{primaryCohort?.displayLabel || ATLAS_WEED_CONDITION_LABELS[card.condition]}</strong>
            <div className={styles.factPills}>
              {primaryCohort?.stageLabel ? <b>{primaryCohort.stageLabel}</b> : null}
              <b>{ATLAS_WEED_CONDITION_LABELS[card.condition]}</b>
              <b>Target · {ATLAS_WEED_CONDITION_LABELS[card.targetCondition]}</b>
            </div>
          </section>

          {card.occupancyGroups.some((group) => group.cohorts.length) ? (
            <section className={styles.occupancy} aria-label={`${card.objectLabel} crop occupancy`}>
              <CropOccupancyList groups={card.occupancyGroups} />
            </section>
          ) : null}

          <div className={styles.directive}><MaintenanceDirectiveStrip taskId={task.task_id} /></div>

          {card.sessions.length ? (
            <section className={styles.history}>
              <header><span>Recent passes</span></header>
              <ol>{card.sessions.slice(0, 3).map((session) => (
                <li key={session.id}><span>{prettyDate(session.workDate)}</span><strong>{ATLAS_WEED_CONDITION_LABELS[session.conditionAfter]}</strong><small>{session.conditionBefore === session.conditionAfter ? "state held" : "improved"}</small></li>
              ))}</ol>
            </section>
          ) : null}

          <section className={styles.results}>
            <header><span>How’d we do?</span></header>
            <div className={styles.resultPills}>
              {resultChoices.map((condition) => (
                <button type="button" key={condition} data-active={selectedCondition === condition ? "true" : "false"} disabled={busy} onClick={() => { setSelectedCondition(condition); setMessage(null); }}>
                  {RESULT_LABELS[condition]}
                </button>
              ))}
              <button type="button" className={styles.logButton} data-active={logOpen ? "true" : "false"} disabled={busy} onClick={() => setLogOpen((open) => !open)}>Log it</button>
            </div>
            {logOpen ? (
              <div className={styles.logPanel}>
                <input value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Add note…" aria-label="Add a weeding note" />
                <button type="button" disabled={busy || !note.trim()} onClick={() => void logPass()}>{saving === "log" ? "Saving…" : "Save note"}</button>
              </div>
            ) : null}
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
