"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import CropOccupancyBedMap from "@/components/atlas/crop-occupancy-bed-map";
import CropOccupancyList from "@/components/atlas/crop-occupancy-list";
import MaintenanceDirectiveStrip from "@/components/atlas/maintenance-directive-strip";
import TaskDominionTrail from "@/components/atlas/task-dominion-trail";
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
import cohesionStyles from "./weed-card-cohesion.module.css";
import styles from "./weed-card-task-focus.module.css";

type Props = {
  task: AtlasTaskCard;
  card: AtlasWeedCardContext;
  assignee: AtlasAssigneeConfig;
};

type SavingAction = "clear" | "partial" | "set_aside" | null;

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

export default function WeedCardTaskFocus({ task, card, assignee }: Props) {
  const currentIndex = ATLAS_WEED_CONDITIONS.indexOf(card.condition);
  const availableConditions = ATLAS_WEED_CONDITIONS
    .slice(Math.max(0, currentIndex))
    .filter((condition) => condition !== "clear");
  const tomorrow = useMemo(() => addDaysIso(centralDateIso(), 1), []);
  const [logOpen, setLogOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [conditionAfter, setConditionAfter] = useState<AtlasWeedCondition>(card.condition);
  const [moveDate, setMoveDate] = useState(tomorrow);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<SavingAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const occupancy = card.bedMap
    ? <CropOccupancyBedMap map={card.bedMap} variant="notebook" />
    : <CropOccupancyList groups={card.occupancyGroups} />;

  async function savePartial() {
    if (conditionAfter === card.condition && !note.trim()) {
      setMessage("Choose the bed’s current condition or add a field note.");
      return;
    }

    try {
      setSaving("partial");
      setMessage(null);
      await postAtlasFinishPartialWeedCardDay({
        taskId: task.task_id,
        minutes: null,
        conditionAfter,
        workDate: todayIso(),
        note,
      });
      window.location.assign(assignee.listPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the bed’s current state.");
    } finally {
      setSaving(null);
    }
  }

  async function markClear() {
    try {
      setSaving("clear");
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
      setSaving(null);
    }
  }

  async function setAsideToday(requestedReturnDate: string) {
    try {
      setSaving("set_aside");
      setMessage(null);
      const result = await postAtlasTaskSetAsideToday(task.task_id, requestedReturnDate);
      setMessage(result.message);
      window.setTimeout(() => window.location.assign(assignee.listPath), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not set this task aside today.");
      setSaving(null);
    }
  }

  return (
    <main className={`${styles.root} ${cohesionStyles.cohesive} atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-weed-card-page-shell`}>
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

            <MaintenanceDirectiveStrip taskId={task.task_id} />

            <section className="atlas-weed-pass" aria-label={`${card.objectLabel} weed state`}>
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

              {card.sessions.length ? (
                <ol className="atlas-weed-session-history" aria-label="Recent bed states">
                  {card.sessions.slice(0, 4).map((session) => (
                    <li key={session.id}>
                      <span>{prettyDate(session.workDate)}</span>
                      <strong>{ATLAS_WEED_CONDITION_LABELS[session.conditionAfter]}</strong>
                      <small>{session.conditionBefore === session.conditionAfter ? "state held" : "improved"}</small>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>

            <footer className="atlas-weed-session-entry">
              {!logOpen ? (
                <>
                  <div className="atlas-task-result-actions atlas-task-result-actions-simple atlas-weed-day-actions">
                    <button type="button" className="done" disabled={Boolean(saving)} onClick={() => void markClear()}>
                      {saving === "clear" ? "Saving" : "Clear"}
                    </button>
                    <button
                      type="button"
                      className="unfinished"
                      disabled={Boolean(saving)}
                      onClick={() => setLogOpen(true)}
                    >
                      Partly finished
                    </button>
                  </div>
                  <details className="atlas-task-move-drawer atlas-weed-move-drawer">
                    <summary>
                      <span>Move</span>
                      <b aria-hidden="true">⌄</b>
                    </summary>
                    <div className="atlas-task-move-options">
                      <button
                        type="button"
                        disabled={Boolean(saving)}
                        onClick={() => void setAsideToday(tomorrow)}
                      >
                        Tomorrow
                      </button>
                      <label>
                        <span>Choose date</span>
                        <input
                          type="date"
                          min={tomorrow}
                          value={moveDate}
                          disabled={Boolean(saving)}
                          onChange={(event) => setMoveDate(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="atlas-task-move-date-button"
                        disabled={Boolean(saving) || !moveDate}
                        onClick={() => void setAsideToday(moveDate)}
                      >
                        {saving === "set_aside" ? "Moving" : `Move to ${prettyDate(moveDate)}`}
                      </button>
                    </div>
                  </details>
                </>
              ) : (
                <section className="atlas-weed-log-drawer" aria-label="Partly finished">
                  <button
                    type="button"
                    className="atlas-weed-log-row"
                    aria-expanded={conditionOpen}
                    onClick={() => setConditionOpen((value) => !value)}
                  >
                    <span>Bed now</span>
                    <strong>{ATLAS_WEED_CONDITION_LABELS[conditionAfter]}</strong>
                    <b aria-hidden="true">›</b>
                  </button>

                  {conditionOpen ? (
                    <div className="atlas-weed-condition-buttons" aria-label="Current bed condition">
                      {availableConditions.map((condition) => (
                        <button
                          type="button"
                          key={condition}
                          className={conditionAfter === condition ? "is-selected" : ""}
                          disabled={Boolean(saving)}
                          onClick={() => { setConditionAfter(condition); setConditionOpen(false); }}
                        >
                          {ATLAS_WEED_CONDITION_LABELS[condition]}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <input
                    className="atlas-weed-note"
                    aria-label="Field note"
                    placeholder="Field note"
                    value={note}
                    disabled={Boolean(saving)}
                    onChange={(event) => setNote(event.target.value)}
                  />

                  <div className="atlas-weed-log-actions">
                    <button type="button" disabled={Boolean(saving)} onClick={() => { setLogOpen(false); setMessage(null); }}>Cancel</button>
                    <button type="button" className="atlas-weed-session-save" disabled={Boolean(saving)} onClick={() => void savePartial()}>
                      {saving === "partial" ? "Saving" : "Save state"}
                    </button>
                  </div>
                </section>
              )}

              {message ? <p className="atlas-task-page-message atlas-task-set-aside-message">{message}</p> : null}
            </footer>
          </article>
        </div>
      </section>
    </main>
  );
}
