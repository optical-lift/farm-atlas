"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import CropOccupancyBedMap from "@/components/atlas/crop-occupancy-bed-map";
import CropOccupancyList from "@/components/atlas/crop-occupancy-list";
import TaskDominionTrail from "@/components/atlas/task-dominion-trail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
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
  assignee: AtlasAssigneeConfig;
};

const QUICK_MINUTES = [10, 20, 30, 45] as const;

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function prettyDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeLabel(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export default function WeedCardTaskFocus({ task, card, assignee }: Props) {
  const currentIndex = ATLAS_WEED_CONDITIONS.indexOf(card.condition);
  const availableConditions = ATLAS_WEED_CONDITIONS
    .slice(Math.max(0, currentIndex))
    .filter((condition) => condition !== "clear");
  const [logOpen, setLogOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [customMinutes, setCustomMinutes] = useState("");
  const [conditionAfter, setConditionAfter] = useState<AtlasWeedCondition>(card.condition);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const investedBlocks = useMemo(() => Math.min(18, Math.ceil(card.totalMinutes / 10)), [card.totalMinutes]);
  const unquantifiedSessions = useMemo(
    () => card.sessions.filter((session) => !session.minutesKnown).length,
    [card.sessions],
  );
  const selectedMinutes = customMinutes.trim() ? Number(customMinutes) : minutes ?? 0;
  const selectedTimeLabel = customMinutes.trim()
    ? `${customMinutes}m`
    : minutes
      ? `${minutes}m`
      : "Add time";
  const occupancy = card.bedMap
    ? <CropOccupancyBedMap map={card.bedMap} variant="notebook" />
    : <CropOccupancyList groups={card.occupancyGroups} />;

  async function savePartial() {
    if (!Number.isInteger(selectedMinutes) || selectedMinutes < 0 || selectedMinutes > 480) {
      setMessage("Choose 1–480 minutes, or leave time blank.");
      return;
    }
    if (selectedMinutes === 0 && conditionAfter === card.condition && !note.trim()) {
      setMessage("Add time or change the condition.");
      return;
    }

    try {
      setSaving(true);
      setMessage(null);
      await postAtlasFinishPartialWeedCardDay({
        taskId: task.task_id,
        minutes: selectedMinutes || null,
        conditionAfter,
        workDate: todayIso(),
        note,
      });
      window.location.assign(assignee.listPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the partial Weed Card work.");
    } finally {
      setSaving(false);
    }
  }

  async function markClear() {
    try {
      setSaving(true);
      setMessage(null);
      await postAtlasWeedCardSession({
        taskId: task.task_id,
        minutes: null,
        conditionAfter: "clear",
        workDate: todayIso(),
      });
      window.location.assign(assignee.listPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not mark the bed clear.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`${styles.root} atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-weed-card-page-shell`}>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top atlas-weed-card-top">
          <Link href={assignee.listPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{assignee.label}</span>
          </Link>
          <Link href={assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${assignee.label} work`}>↩</Link>
        </header>

        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card atlas-weed-card-task-card">
            <TaskDominionTrail
              task={task}
              instruction="Weed"
              showCondition={false}
              showZoneLabel={false}
              showSubjectLabel={false}
              moveDetails={occupancy}
              presentation="weed-sheet"
            />

            <section className="atlas-weed-pass" aria-label={`${card.objectLabel} weed progress`}>
              <div className="atlas-weed-condition-summary">
                <strong>{ATLAS_WEED_CONDITION_LABELS[card.condition]}</strong>
                <span aria-hidden="true">→</span>
                <small>{ATLAS_WEED_CONDITION_LABELS[card.targetCondition]}</small>
              </div>

              <div className="atlas-weed-condition-scale" aria-label={`Current condition ${ATLAS_WEED_CONDITION_LABELS[card.condition]}; target ${ATLAS_WEED_CONDITION_LABELS[card.targetCondition]}`}>
                {ATLAS_WEED_CONDITIONS.map((condition, index) => (
                  <span
                    key={condition}
                    className={`${index <= currentIndex ? "is-reached " : ""}${condition === card.condition ? "is-current " : ""}${condition === card.targetCondition ? "is-target" : ""}`.trim()}
                    title={ATLAS_WEED_CONDITION_LABELS[condition]}
                  />
                ))}
              </div>

              <div className="atlas-weed-invested">
                <div className="atlas-weed-invested-head">
                  <strong>{card.totalMinutes > 0 ? timeLabel(card.totalMinutes) : unquantifiedSessions > 0 ? "Time unrecorded" : "0m"}</strong>
                  <span>{card.sessionCount} {card.sessionCount === 1 ? "session" : "sessions"}</span>
                </div>
                <div className="atlas-weed-invested-rail" aria-label={`${card.totalMinutes} recorded minutes invested in this pass`}>
                  {Array.from({ length: 18 }, (_, index) => <i className={index < investedBlocks ? "is-filled" : ""} key={index} />)}
                </div>
              </div>

              {card.sessions.length ? (
                <ol className="atlas-weed-session-history">
                  {card.sessions.slice(0, 4).map((session) => (
                    <li key={session.id}>
                      <span>{prettyDate(session.workDate)}</span>
                      <strong>{session.minutesKnown ? timeLabel(session.minutes) : "time unrecorded"}</strong>
                      <small>{ATLAS_WEED_CONDITION_LABELS[session.conditionAfter]}</small>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>

            <footer className="atlas-weed-session-entry">
              {!logOpen ? (
                <div className="atlas-task-result-actions atlas-task-result-actions-simple atlas-weed-day-actions">
                  <button type="button" className="done" disabled={saving} onClick={() => void markClear()}>
                    {saving ? "Saving" : "Clear"}
                  </button>
                  <button
                    type="button"
                    className="unfinished"
                    disabled={saving}
                    onClick={() => setLogOpen(true)}
                  >
                    Partly finished
                  </button>
                </div>
              ) : (
                <section className="atlas-weed-log-drawer" aria-label="Partly finished">
                  <button
                    type="button"
                    className="atlas-weed-log-row"
                    aria-expanded={conditionOpen}
                    onClick={() => setConditionOpen((value) => !value)}
                  >
                    <span>Condition</span>
                    <strong>{ATLAS_WEED_CONDITION_LABELS[conditionAfter]}</strong>
                    <b aria-hidden="true">›</b>
                  </button>

                  {conditionOpen ? (
                    <div className="atlas-weed-condition-buttons" aria-label="Condition after this pass">
                      {availableConditions.map((condition) => (
                        <button
                          type="button"
                          key={condition}
                          className={conditionAfter === condition ? "is-selected" : ""}
                          disabled={saving}
                          onClick={() => { setConditionAfter(condition); setConditionOpen(false); }}
                        >
                          {ATLAS_WEED_CONDITION_LABELS[condition]}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="atlas-weed-log-row"
                    aria-expanded={timeOpen}
                    onClick={() => setTimeOpen((value) => !value)}
                  >
                    <span>Time</span>
                    <strong>{selectedTimeLabel}</strong>
                    <b aria-hidden="true">›</b>
                  </button>

                  {timeOpen ? (
                    <div className="atlas-weed-minute-rail" aria-label="Minutes worked">
                      {QUICK_MINUTES.map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={!customMinutes && minutes === value ? "is-selected" : ""}
                          disabled={saving}
                          onClick={() => { setMinutes(value); setCustomMinutes(""); setTimeOpen(false); }}
                        >
                          {value}m
                        </button>
                      ))}
                      <input
                        aria-label="Custom minutes"
                        inputMode="numeric"
                        min="1"
                        max="480"
                        placeholder="Other"
                        type="number"
                        value={customMinutes}
                        disabled={saving}
                        onChange={(event) => { setCustomMinutes(event.target.value); setMinutes(null); }}
                      />
                    </div>
                  ) : null}

                  <input
                    className="atlas-weed-note"
                    aria-label="Pass note"
                    placeholder="Note"
                    value={note}
                    disabled={saving}
                    onChange={(event) => setNote(event.target.value)}
                  />

                  <div className="atlas-weed-log-actions">
                    <button type="button" disabled={saving} onClick={() => { setLogOpen(false); setMessage(null); }}>Cancel</button>
                    <button type="button" className="atlas-weed-session-save" disabled={saving} onClick={() => void savePartial()}>
                      {saving ? "Saving" : "Save partial"}
                    </button>
                  </div>
                </section>
              )}

              {message ? <p className="atlas-task-page-message">{message}</p> : null}
            </footer>
          </article>
        </div>
      </section>
    </main>
  );
}
