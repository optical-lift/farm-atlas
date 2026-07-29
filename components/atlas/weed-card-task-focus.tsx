"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import TaskDominionTrail from "@/components/atlas/task-dominion-trail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  ATLAS_WEED_CONDITIONS,
  ATLAS_WEED_CONDITION_LABELS,
  type AtlasWeedCardContext,
  type AtlasWeedCondition,
} from "@/lib/atlas/weed-card-contract";
import { postAtlasWeedCardSession } from "@/lib/atlas/weed-card-client";
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

function instruction(card: AtlasWeedCardContext) {
  if (card.condition === "clear") return "Row returned to production";
  if (card.totalMinutes > 0 || card.sessionCount > 0) return "Continue the recovery";
  return "Return the row to production";
}

export default function WeedCardTaskFocus({ task, card, assignee }: Props) {
  const currentIndex = ATLAS_WEED_CONDITIONS.indexOf(card.condition);
  const availableConditions = ATLAS_WEED_CONDITIONS.slice(Math.max(0, currentIndex));
  const [minutes, setMinutes] = useState<number>(20);
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
  const selectedMinutes = customMinutes.trim() ? Number(customMinutes) : minutes;
  const passLabel = card.totalMinutes > 0
    ? `${timeLabel(card.totalMinutes)} this pass`
    : unquantifiedSessions > 0
      ? "work recorded"
      : "new pass";

  async function saveSession() {
    if (!Number.isInteger(selectedMinutes) || selectedMinutes < 1 || selectedMinutes > 480) {
      setMessage("Choose 1–480 minutes.");
      return;
    }

    try {
      setSaving(true);
      setMessage(null);
      await postAtlasWeedCardSession({
        taskId: task.task_id,
        minutes: selectedMinutes,
        conditionAfter,
        workDate: todayIso(),
        note,
      });
      window.location.assign(assignee.listPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Weed Card session failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`${styles.root} atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-weed-card-page-shell`}>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={assignee.listPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{assignee.label}</span>
          </Link>
          <span className="atlas-weather-line">{passLabel}</span>
          <Link href={assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${assignee.label} work`}>↩</Link>
        </header>

        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card atlas-weed-card-task-card">
            <TaskDominionTrail task={task} instruction={instruction(card)} showCondition={false} />

            <section className="atlas-weed-card" aria-label={`${card.objectLabel} Weed Card`}>
              <header>
                <div>
                  <small>Weed Card</small>
                  <strong>{card.objectLabel}</strong>
                </div>
                <span>{ATLAS_WEED_CONDITION_LABELS[card.condition]}</span>
              </header>

              <div className="atlas-weed-condition-scale" aria-label={`Current condition ${ATLAS_WEED_CONDITION_LABELS[card.condition]}; target clear`}>
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
                  {card.sessions.slice(0, 5).map((session) => (
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
              <div className="atlas-weed-minute-rail" aria-label="Minutes worked">
                {QUICK_MINUTES.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={!customMinutes && minutes === value ? "is-selected" : ""}
                    disabled={saving}
                    onClick={() => { setMinutes(value); setCustomMinutes(""); }}
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
                  onChange={(event) => setCustomMinutes(event.target.value)}
                />
              </div>

              <div className="atlas-weed-condition-buttons" aria-label="Condition after this session">
                {availableConditions.map((condition) => (
                  <button
                    type="button"
                    key={condition}
                    className={conditionAfter === condition ? "is-selected" : ""}
                    disabled={saving}
                    onClick={() => setConditionAfter(condition)}
                  >
                    {ATLAS_WEED_CONDITION_LABELS[condition]}
                  </button>
                ))}
              </div>

              <input
                className="atlas-weed-note"
                aria-label="Session note"
                placeholder="Optional note"
                value={note}
                disabled={saving}
                onChange={(event) => setNote(event.target.value)}
              />

              <button type="button" className="atlas-weed-session-save" disabled={saving} onClick={() => void saveSession()}>
                {saving ? "Saving" : conditionAfter === "clear" ? "Finish pass" : "Log session"}
              </button>

              {message ? <p className="atlas-task-page-message">{message}</p> : null}
            </footer>
          </article>
        </div>
      </section>
    </main>
  );
}
