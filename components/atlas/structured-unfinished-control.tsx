"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasRouteKeyForTask } from "@/lib/atlas/task-display";
import { openAtlasTaskProblemHandoff } from "@/lib/atlas/task-problem-handoff-client";
import {
  addDaysIso,
  centralDateIso,
  postAtlasTaskSetAsideToday,
} from "@/lib/atlas/task-set-aside-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type UnfinishedOutcome = "partial" | "blocked";

function truthy(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === "1" || value === 1;
}

function falsey(value: unknown) {
  return value === false || value === "false" || value === "no" || value === "0" || value === 0;
}

function taskAllowsPartlyDone(task: AtlasTaskCard, childTasks: AtlasTaskCard[]) {
  const explicit = task.metadata?.partial_completion_allowed ?? task.metadata?.resumable_task;
  if (truthy(explicit)) return true;
  if (falsey(explicit)) return false;

  const activeChildren = childTasks.some((child) => child.status === "open" || child.status === "blocked");
  if (activeChildren) return false;

  const route = atlasRouteKeyForTask(task);
  if (route === "mow" || route === "build" || route === "harvest") return true;
  if (route === "seed" || route === "plant" || route === "water" || route === "propagation" || route === "crop_cycle") return false;

  const text = `${task.task_type ?? ""} ${task.action_key ?? ""} ${task.title} ${task.unlock_text ?? ""}`.toLowerCase();
  return /\b(mow|paint|trim|clear|prep|build|repair|clean|organize|install|cut|prune|harvest|gather|spread|mulch)\b/.test(text);
}

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function StructuredUnfinishedControl({ task, childTasks, assignee }: Props) {
  const today = useMemo(() => centralDateIso(), []);
  const tomorrow = useMemo(() => addDaysIso(today, 1), [today]);
  const allowsPartial = useMemo(() => taskAllowsPartlyDone(task, childTasks), [task, childTasks]);
  const [actionsTarget, setActionsTarget] = useState<Element | null>(null);
  const [footerTarget, setFooterTarget] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<UnfinishedOutcome | null>(null);
  const [problemText, setProblemText] = useState("");
  const [returnDate, setReturnDate] = useState(tomorrow);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    function prepare() {
      const footer = document.querySelector(".atlas-task-result-footer");
      const actions = footer?.querySelector(".atlas-task-result-actions-simple");
      const oldUnfinished = actions?.querySelector<HTMLButtonElement>("button.unfinished:not([data-structured-unfinished])");
      const oldPanel = footer?.querySelector<HTMLElement>(".atlas-task-result-unfinished");
      const oldMore = footer?.querySelector<HTMLElement>(".atlas-task-more-outcomes");

      if (oldUnfinished) oldUnfinished.hidden = true;
      if (oldPanel) oldPanel.hidden = true;
      if (oldMore) oldMore.hidden = true;
      if (actions) setActionsTarget(actions);
      if (footer) setFooterTarget(footer);
    }

    prepare();
    const observer = new MutationObserver(prepare);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  function chooseOutcome(next: UnfinishedOutcome) {
    setOutcome(next);
    setProblemText("");
    setMessage(null);
  }

  async function savePartial() {
    if (outcome !== "partial" || !returnDate) return;

    try {
      setSaving(true);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "partial",
        idempotencyKey: `unfinished-partial-v2:${today}:${returnDate}`,
        note: "Partly done",
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: {
          workClass: task.work_class,
          assigneeKey: assignee.key,
          unfinishedDisposition: {
            version: 2,
            outcome: "partial",
            outcomeLabel: "Partly done",
            requestedReturnDate: returnDate,
            serviceDate: today,
          },
        },
      });

      const result = await postAtlasTaskSetAsideToday(task.task_id, returnDate);
      setMessage(`Partial progress logged. ${result.message}`);
      window.setTimeout(() => window.location.assign(assignee.listPath), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save this partial progress.");
      setSaving(false);
    }
  }

  async function sendProblem() {
    const issue = problemText.trim();
    if (outcome !== "blocked" || !issue) return;

    try {
      setSaving(true);
      setMessage(null);
      const result = await openAtlasTaskProblemHandoff(task.task_id, issue);
      setMessage(result.message || "Problem sent to the Owner.");
      window.setTimeout(() => window.location.assign(assignee.listPath), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not send this problem to the Owner.");
      setSaving(false);
    }
  }

  if (!actionsTarget || !footerTarget) return null;

  return (
    <>
      {createPortal(
        <button
          type="button"
          className={open ? "unfinished is-open" : "unfinished"}
          data-structured-unfinished="true"
          aria-expanded={open}
          disabled={saving}
          onClick={() => {
            setOpen((current) => !current);
            setMessage(null);
          }}
        >
          Unfinished
        </button>,
        actionsTarget,
      )}

      {open ? createPortal(
        <section className="atlas-structured-unfinished-panel" aria-label="Save task as unfinished">
          <div className="atlas-structured-unfinished-heading">
            <small>Unfinished</small>
            <strong>What happened?</strong>
          </div>

          <div className={`atlas-structured-unfinished-outcomes${allowsPartial ? "" : " single"}`}>
            {allowsPartial ? (
              <button
                type="button"
                className={outcome === "partial" ? "is-selected" : ""}
                aria-pressed={outcome === "partial"}
                disabled={saving}
                onClick={() => chooseOutcome("partial")}
              >
                Partly done
              </button>
            ) : null}
            <button
              type="button"
              className={outcome === "blocked" ? "is-selected" : ""}
              aria-pressed={outcome === "blocked"}
              disabled={saving}
              onClick={() => chooseOutcome("blocked")}
            >
              Problem found
            </button>
          </div>

          {outcome === "partial" ? (
            <>
              <div className="atlas-structured-unfinished-section">
                <span>Move it to</span>
                <div className="atlas-structured-unfinished-return">
                  <button
                    type="button"
                    className={returnDate === tomorrow ? "is-selected" : ""}
                    aria-pressed={returnDate === tomorrow}
                    disabled={saving}
                    onClick={() => setReturnDate(tomorrow)}
                  >
                    Tomorrow
                  </button>
                  <label>
                    <span>Choose date</span>
                    <input
                      type="date"
                      min={tomorrow}
                      value={returnDate}
                      disabled={saving}
                      onChange={(event) => setReturnDate(event.target.value)}
                    />
                  </label>
                </div>
              </div>

              <button
                type="button"
                className="atlas-structured-unfinished-save"
                disabled={saving || !returnDate}
                onClick={() => void savePartial()}
              >
                {saving ? "Saving partial progress" : `Log partly done · returns ${prettyDate(returnDate)}`}
              </button>
            </>
          ) : null}

          {outcome === "blocked" ? (
            <>
              <label className="atlas-structured-unfinished-problem">
                <span>What is the problem?</span>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={problemText}
                  disabled={saving}
                  placeholder="Tell Lex what stopped the task or what needs to change."
                  onChange={(event) => setProblemText(event.target.value)}
                />
              </label>
              <p className="atlas-structured-unfinished-owner-note">
                This task will leave your schedule until the Owner handles the problem and sends it back.
              </p>
              <button
                type="button"
                className="atlas-structured-unfinished-save"
                disabled={saving || !problemText.trim()}
                onClick={() => void sendProblem()}
              >
                {saving ? "Sending to Owner" : "Send problem to Owner"}
              </button>
            </>
          ) : null}

          {message ? <p className="atlas-task-page-message atlas-task-set-aside-message">{message}</p> : null}
        </section>,
        footerTarget,
      ) : null}
    </>
  );
}
