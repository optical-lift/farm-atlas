"use client";

import { useMemo, useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
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
import cohesionStyles from "./weed-card-cohesion.module.css";
import styles from "./weed-card-task-focus.module.css";

type Props = {
  task: AtlasTaskCard;
  card: AtlasWeedCardContext;
  childTasks: AtlasTaskCard[];
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

export default function WeedCardTaskFocus({ task, card, childTasks, assignee }: Props) {
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

  function methodInstrument(_context: AssignedTaskInstrumentContext) {
    return (
      <section
        className={`${styles.root} ${cohesionStyles.cohesive} atlas-weed-card-method-instrument`}
        data-atlas-method-instrument="weed-card"
        aria-label={`${card.objectLabel} weed state`}
      >
        {/* The old rectangle map was decorative unless Atlas happened to have
            hard-coded geometry. Until a real state portrait exists, show only
            crop occupancy Atlas can actually support from canonical cohort data. */}
        <div className="atlas-weed-card-occupancy" aria-label={`${card.objectLabel} crop occupancy`}>
          <CropOccupancyList groups={card.occupancyGroups} />
        </div>
        <MaintenanceDirectiveStrip taskId={task.task_id} />
        <section className="atlas-weed-pass">
          <div className="atlas-weed-condition-summary">
            <strong>{ATLAS_WEED_CONDITION_LABELS[card.condition]}</strong>
            <span aria-hidden="true">→</span>
            <small>{ATLAS_WEED_CONDITION_LABELS[card.targetCondition]}</small>
          </div>

          <div
            className="atlas-weed-condition-scale"
            aria-label={`Current condition ${ATLAS_WEED_CONDITION_LABELS[card.condition]}; target ${ATLAS_WEED_CONDITION_LABELS[card.targetCondition]}`}
          >
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
      </section>
    );
  }

  function resultInstrument(context: AssignedTaskInstrumentContext) {
    const busy = Boolean(saving) || context.busy;
    return (
      <section
        className={`${styles.root} ${cohesionStyles.cohesive} atlas-weed-session-entry`}
        data-atlas-result-instrument="weed-card"
      >
        <style>{`
          .atlas-task-result-footer > .atlas-task-more-outcomes { display: none; }
          .atlas-weed-card-method-instrument { margin: 0 10px 18px; }
          .atlas-weed-card-occupancy:empty { display:none; }
          .atlas-weed-card-occupancy { margin: 0 18px 14px; }
        `}</style>
        {!logOpen ? (
          <>
            <div className="atlas-task-result-actions atlas-task-result-actions-simple atlas-weed-day-actions">
              <button type="button" className="done" disabled={busy} onClick={() => void markClear()}>
                {saving === "clear" ? "Saving" : "Clear"}
              </button>
              <button
                type="button"
                className="unfinished"
                disabled={busy}
                onClick={() => setLogOpen(true)}
              >
                Partly finished
              </button>
            </div>
            <details className="atlas-task-move-drawer atlas-weed-move-drawer">
              <summary>
                <span>Set aside</span>
                <b aria-hidden="true">⌄</b>
              </summary>
              <div className="atlas-task-move-options">
                <button type="button" disabled={busy} onClick={() => void setAsideToday(tomorrow)}>
                  Tomorrow
                </button>
                <label>
                  <span>Choose return date</span>
                  <input
                    type="date"
                    min={tomorrow}
                    value={moveDate}
                    disabled={busy}
                    onChange={(event) => setMoveDate(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="atlas-task-move-date-button"
                  disabled={busy || !moveDate}
                  onClick={() => void setAsideToday(moveDate)}
                >
                  {saving === "set_aside" ? "Saving" : `Set aside until ${prettyDate(moveDate)}`}
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
                    disabled={busy}
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
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />

            <div className="atlas-weed-log-actions">
              <button type="button" disabled={busy} onClick={() => { setLogOpen(false); setMessage(null); }}>Cancel</button>
              <button type="button" className="atlas-weed-session-save" disabled={busy} onClick={() => void savePartial()}>
                {saving === "partial" ? "Saving" : "Save state"}
              </button>
            </div>
          </section>
        )}

        {message ? <p className="atlas-task-page-message atlas-task-set-aside-message">{message}</p> : null}
      </section>
    );
  }

  return (
    <AssignedTaskExecutionShell
      task={task}
      childTasks={childTasks}
      assignee={assignee}
      methodInstrument={methodInstrument}
      resultInstrument={resultInstrument}
    />
  );
}
