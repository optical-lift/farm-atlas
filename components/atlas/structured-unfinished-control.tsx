"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { openAtlasTaskProblemHandoff } from "@/lib/atlas/task-problem-handoff-client";
import { addDaysIso, centralDateIso } from "@/lib/atlas/task-set-aside-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type UnfinishedOutcome = "partial" | "blocked";

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function returnDestination(fallback: string) {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export default function StructuredUnfinishedControl({ task, assignee }: Props) {
  const today = useMemo(() => centralDateIso(), []);
  const tomorrow = useMemo(() => addDaysIso(today, 1), [today]);
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
        idempotencyKey: `unfinished-partial-v3:${today}:${returnDate}`,
        note: "Partly done",
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: {
          workClass: task.work_class,
          assigneeKey: assignee.key,
          unfinishedDisposition: {
            version: 3,
            outcome: "partial",
            outcomeLabel: "Partly done",
            requestedReturnDate: returnDate,
            serviceDate: today,
            preserveCompletedComponents: true,
            carryRemainingComponents: true,
          },
        },
      });

      setMessage(`Progress saved. Remaining work returns ${prettyDate(returnDate)}.`);
      window.setTimeout(() => window.location.assign(returnDestination(assignee.listPath)), 700);
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
      window.setTimeout(() => window.location.assign(returnDestination(assignee.listPath)), 700);
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

          <div className="atlas-structured-unfinished-outcomes">
            <button
              type="button"
              className={outcome === "partial" ? "is-selected" : ""}
              aria-pressed={outcome === "partial"}
              disabled={saving}
              onClick={() => chooseOutcome("partial")}
            >
              Partly done
            </button>
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
                <span>Return remaining work</span>
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
                {saving ? "Saving progress" : `Save progress · return ${prettyDate(returnDate)}`}
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
                  onChange={(event) => setProblemText(event.target.value)}
                />
              </label>
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
