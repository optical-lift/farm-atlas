"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/app/grow-room/grow-room.module.css";

type GrowRoomVisitTask = {
  taskId: string;
  title: string;
  status: string;
  dueDate: string | null;
  workOrder: string;
};

type GrowRoomRequest = {
  assignmentId: string;
  taskId: string;
  title: string;
  taskType: string;
  actionKey: string | null;
  status: string;
  dueDate: string | null;
  priority: string;
  sortOrder: number;
  resolvedAt: string | null;
  resolutionKey: string | null;
  requestKind: "germination" | "pot_up" | "hardening" | "readiness" | "care_action";
  displayAction: string;
  displaySubject: string;
  displayDetail: string | null;
  metadata: Record<string, unknown>;
};

type GrowRoomRound = {
  visitTask: GrowRoomVisitTask | null;
  requests: GrowRoomRequest[];
  summary: {
    total: number;
    resolved: number;
    unresolved: number;
    canFinish: boolean;
  };
};

type RoundResponse = {
  ok: boolean;
  round?: GrowRoomRound;
  error?: string;
};

type WriteResponse = {
  ok: boolean;
  error?: string;
};

type GrowRoomTaskFocusProps = {
  visitTaskId: string;
  returnTo?: string | null;
  portalLabel?: string;
};

function prettyDate(value: string | null) {
  if (!value) return "Today";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function nextDate(value: string | null) {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  base.setDate(base.getDate() + 1);
  return base.toISOString().slice(0, 10);
}

function requestActionLabel(request: GrowRoomRequest) {
  if (request.requestKind === "germination") return "Count live seedlings";
  if (request.requestKind === "pot_up") return "Pot up plants";
  if (request.requestKind === "hardening") return "Advance hardening";
  if (request.requestKind === "readiness") return "Check transplant readiness";
  return (request.displayAction || "Complete action").replace(/[.!]+$/, "");
}

function requestSubjectLabel(request: GrowRoomRequest) {
  const raw = (request.displaySubject || request.title).trim();
  const segments = raw.split("·").map((segment) => segment.trim()).filter(Boolean);
  const subject = segments.length > 1 ? segments[segments.length - 1] : raw;
  return subject
    .replace(/^Check germination\s*[—:-]\s*/i, "")
    .replace(/^Grow Room\s*[—:-]\s*/i, "")
    .replace(/^Check\s+(.+?)\s+germination$/i, "$1")
    .trim();
}

function nonce(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export default function GrowRoomTaskFocus({
  visitTaskId,
  returnTo,
  portalLabel = "Elm Farm",
}: GrowRoomTaskFocusProps) {
  const requestedVisitTaskId = visitTaskId.trim();
  const logPanelRef = useRef<HTMLElement | null>(null);
  const [round, setRound] = useState<GrowRoomRound | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState("");
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemNote, setProblemNote] = useState("");

  const loadRound = useCallback(async (preferFirstUnresolved = false) => {
    setError(null);
    try {
      const response = await fetch(`/api/atlas/grow-room/round?visitTaskId=${encodeURIComponent(requestedVisitTaskId)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json() as RoundResponse;
      if (!response.ok || !data.ok || !data.round) {
        throw new Error(data.error || "The Grow Room round could not be loaded.");
      }
      const loadedRound = data.round;
      setRound(loadedRound);
      setSelectedAssignmentId((current) => {
        const firstUnresolved = loadedRound.requests.find((request) => !request.resolvedAt)?.assignmentId ?? null;
        if (preferFirstUnresolved) return firstUnresolved;
        if (current && loadedRound.requests.some((request) => request.assignmentId === current)) return current;
        return firstUnresolved;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Grow Room round could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [requestedVisitTaskId]);

  useEffect(() => {
    void loadRound();
  }, [loadRound]);

  const activeRequest = useMemo(() => {
    if (!round) return null;
    if (selectedAssignmentId) {
      const selected = round.requests.find((request) => request.assignmentId === selectedAssignmentId);
      if (selected) return selected;
    }
    return round.requests.find((request) => !request.resolvedAt) ?? null;
  }, [round, selectedAssignmentId]);

  const resolvedReturnTo = returnTo || (round?.visitTask?.dueDate
    ? `/day?date=${encodeURIComponent(round.visitTask.dueDate)}`
    : "/");

  function resetLogForm() {
    setLiveCount("");
    setProblemOpen(false);
    setProblemNote("");
    setError(null);
  }

  function openLog(request: GrowRoomRequest) {
    resetLogForm();
    setSelectedAssignmentId(request.assignmentId);
    requestAnimationFrame(() => {
      logPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function openFinish() {
    if (!round?.summary.canFinish) return;
    resetLogForm();
    setSelectedAssignmentId(null);
    requestAnimationFrame(() => {
      logPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function postRound(body: Record<string, unknown>) {
    const response = await fetch("/api/atlas/grow-room/round", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const data = await response.json() as WriteResponse;
    if (!response.ok || !data.ok) throw new Error(data.error || "The Grow Room result could not be saved.");
  }

  async function resolveRequest(
    transition: "done" | "blocked" | "rescheduled" | "unfinished",
    payload: Record<string, unknown>,
    note: string,
  ) {
    if (!round?.visitTask || !activeRequest || activeRequest.resolvedAt) return;
    setSaving(true);
    setError(null);
    try {
      await postRound({
        type: "resolve_request",
        visitTaskId: round.visitTask.taskId,
        requestTaskId: activeRequest.taskId,
        transition,
        targetDate: transition === "rescheduled" || transition === "unfinished"
          ? nextDate(round.visitTask.dueDate)
          : null,
        note,
        reason: transition === "blocked" ? "Problem found during Grow Room round" : null,
        payload,
        idempotencyKey: nonce(`${round.visitTask.taskId}:${activeRequest.taskId}:${transition}`),
      });
      resetLogForm();
      await loadRound(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Grow Room result could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function recordLiveCount() {
    const quantity = Number(liveCount);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setError("Enter the number of live seedlings.");
      return;
    }
    await resolveRequest(
      "done",
      { growRoomResult: "live_count", liveCount: quantity, unit: "seedlings" },
      `${quantity} live seedlings recorded.`,
    );
  }

  async function finishRound() {
    if (!round?.visitTask) return;
    setSaving(true);
    setError(null);
    try {
      await postRound({
        type: "finish_round",
        visitTaskId: round.visitTask.taskId,
        idempotencyKey: nonce(`${round.visitTask.taskId}:finish`),
      });
      window.location.assign(resolvedReturnTo);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Grow Room round could not be finished.");
      setSaving(false);
    }
  }

  return (
    <main className="atlas-task-page-shell" data-atlas-task-workflow="grow-room-round">
      <article className="atlas-task-page-phone">
        <header className={`atlas-phone-top ${styles.topbar}`}>
          <Link href="/" className="atlas-task-header-brand atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <strong className="atlas-phone-title">{portalLabel}</strong>
          </Link>
          <Link href={resolvedReturnTo} className={styles.back}>← Back</Link>
        </header>

        <div className={`atlas-task-page-body ${styles.body}`}>
          {loading ? <div className={styles.loading}>Opening Grow Room Care…</div> : null}
          {error ? <div className={styles.error} role="alert">{error}</div> : null}

          {!loading && round?.visitTask ? (
            <section className="atlas-task-page-active atlas-dominion-task-card">
              <section className="atlas-task-dominion-place">
                <div><small>Grow Room</small><strong>{round.visitTask.title || "Grow Room Care"}</strong></div>
                <span>{prettyDate(round.visitTask.dueDate)}</span>
              </section>

              <ol className="atlas-task-dominion-track" aria-label="Grow Room task steps">
                {(round.requests.length ? round.requests : [{ assignmentId: "care" } as GrowRoomRequest]).map((request, index) => {
                  const complete = Boolean(request.resolvedAt);
                  const current = activeRequest?.assignmentId === request.assignmentId;
                  const stepClass = current ? "step-current" : complete ? "step-complete" : "step-context";
                  return (
                    <li className={stepClass} key={request.assignmentId}>
                      <button
                        type="button"
                        className={styles.logButton}
                        onClick={() => openLog(request)}
                        aria-label={`Open step ${index + 1}: ${request.displaySubject || request.title}`}
                        aria-pressed={current}
                      >
                        <i aria-hidden="true" />
                        <span>{round.requests.length ? `Step ${index + 1}` : "Room care"}</span>
                      </button>
                    </li>
                  );
                })}
                <li className={!activeRequest && round.summary.canFinish ? "step-current" : "step-context"}>
                  <button
                    type="button"
                    className={styles.logButton}
                    disabled={!round.summary.canFinish}
                    onClick={openFinish}
                    aria-label="Open finish step"
                    aria-pressed={!activeRequest && round.summary.canFinish}
                  >
                    <i aria-hidden="true" />
                    <span>Finish</span>
                  </button>
                </li>
              </ol>

              {activeRequest ? (
                <section className="atlas-task-dominion-move" ref={logPanelRef} id="grow-room-log-panel">
                  <div className="atlas-task-dominion-kicker">
                    <span>Step {activeRequest.sortOrder} of {round.summary.total}</span>
                    {activeRequest.resolvedAt
                      ? <small>Complete</small>
                      : activeRequest.dueDate && activeRequest.dueDate < (round.visitTask.dueDate || "")
                        ? <small>Overdue</small>
                        : null}
                  </div>
                  <h1>{requestActionLabel(activeRequest)}</h1>
                  <p className={styles.detail}>{requestSubjectLabel(activeRequest)}</p>
                  {activeRequest.displayDetail ? <p className={styles.detail}>{activeRequest.displayDetail}</p> : null}

                  {activeRequest.resolvedAt ? (
                    <div className={styles.loggedState}>
                      <strong>Step complete</strong>
                      <span>This task result has already been saved.</span>
                    </div>
                  ) : activeRequest.requestKind === "germination" ? (
                    <div className={styles.controls}>
                      <label className={styles.countField}>
                        <span>Live seedlings</span>
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={liveCount}
                          onChange={(event) => setLiveCount(event.target.value)}
                          placeholder="0"
                        />
                      </label>
                      <button className={styles.primary} type="button" disabled={saving} onClick={() => void recordLiveCount()}>
                        Record live count
                      </button>
                      <div className={styles.secondaryRow}>
                        <button type="button" disabled={saving} onClick={() => void resolveRequest("done", { growRoomResult: "no_germination", liveCount: 0 }, "No germination recorded.")}>No germination</button>
                        <button type="button" disabled={saving} onClick={() => void resolveRequest("rescheduled", { growRoomResult: "not_ready_to_count" }, "Not ready to count yet.")}>Not ready yet</button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.controls}>
                      <button className={styles.primary} type="button" disabled={saving} onClick={() => void resolveRequest("done", { growRoomResult: "done" }, `${activeRequest.displayAction} completed.`)}>Done</button>
                      <button className={styles.secondary} type="button" disabled={saving} onClick={() => void resolveRequest("rescheduled", { growRoomResult: "needs_another_day" }, "Needs another day.")}>Needs another day</button>
                      {!problemOpen ? (
                        <button className={styles.textButton} type="button" disabled={saving} onClick={() => setProblemOpen(true)}>Problem found</button>
                      ) : (
                        <div className={styles.problemBox}>
                          <label><span>What stopped this?</span><input value={problemNote} onChange={(event) => setProblemNote(event.target.value)} /></label>
                          <button type="button" disabled={saving || !problemNote.trim()} onClick={() => void resolveRequest("blocked", { growRoomResult: "problem_found", problem: problemNote.trim() }, problemNote.trim())}>Save problem</button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              ) : round.visitTask.status === "done" ? (
                <section className={`atlas-task-dominion-move ${styles.finish}`} ref={logPanelRef} id="grow-room-log-panel">
                  <small className="atlas-soft-label">Complete</small>
                  <h1>Grow Room task finished.</h1>
                  <Link href={resolvedReturnTo}>Return</Link>
                </section>
              ) : (
                <section className={`atlas-task-dominion-move ${styles.finish}`} ref={logPanelRef} id="grow-room-log-panel">
                  <small className="atlas-soft-label">Final step</small>
                  <h1>{round.summary.total ? "Finish Grow Room Care." : "Complete the ordinary Grow Room care."}</h1>
                  <button className={styles.primary} type="button" disabled={saving || !round.summary.canFinish} onClick={() => void finishRound()}>
                    Finish task
                  </button>
                </section>
              )}
            </section>
          ) : null}

          {!loading && !round?.visitTask ? (
            <section className="atlas-task-page-active atlas-dominion-task-card">
              <section className={`atlas-task-dominion-move ${styles.finish}`}>
                <small className="atlas-soft-label">Task unavailable</small>
                <h1>This Grow Room Care task could not be opened.</h1>
                <Link href={resolvedReturnTo}>Return</Link>
              </section>
            </section>
          ) : null}
        </div>
      </article>
    </main>
  );
}
