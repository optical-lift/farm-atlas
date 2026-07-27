"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import styles from "./grow-room.module.css";

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

function requestInstruction(request: GrowRoomRequest) {
  const subject = request.displaySubject || request.title;
  if (request.requestKind === "germination") return `Count what is alive in ${subject}.`;
  if (request.requestKind === "pot_up") return `Pot up ${subject}.`;
  if (request.requestKind === "hardening") return `Advance hardening for ${subject}.`;
  if (request.requestKind === "readiness") return `Check whether ${subject} is ready.`;
  const action = request.displayAction || "Complete";
  return `${action} ${subject}.`;
}

function nonce(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function GrowRoomRoundPage() {
  const searchParams = useSearchParams();
  const requestedVisitTaskId = searchParams.get("visitTaskId")?.trim() || null;
  const [round, setRound] = useState<GrowRoomRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState("");
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemNote, setProblemNote] = useState("");

  const loadRound = useCallback(async () => {
    setError(null);
    const query = requestedVisitTaskId ? `?visitTaskId=${encodeURIComponent(requestedVisitTaskId)}` : "";
    try {
      const response = await fetch(`/api/atlas/grow-room/round${query}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json() as RoundResponse;
      if (!response.ok || !data.ok || !data.round) {
        throw new Error(data.error || "The Grow Room round could not be loaded.");
      }
      setRound(data.round);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Grow Room round could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [requestedVisitTaskId]);

  useEffect(() => {
    void loadRound();
  }, [loadRound]);

  const activeRequest = useMemo(
    () => round?.requests.find((request) => !request.resolvedAt) ?? null,
    [round],
  );

  const returnTo = round?.visitTask?.dueDate
    ? `/day?date=${encodeURIComponent(round.visitTask.dueDate)}`
    : "/";

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
    if (!round?.visitTask || !activeRequest) return;
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
      setLiveCount("");
      setProblemOpen(false);
      setProblemNote("");
      await loadRound();
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
      window.location.assign(returnTo);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Grow Room round could not be finished.");
      setSaving(false);
    }
  }

  return (
    <main className="atlas-task-page-shell">
      <article className="atlas-task-page-phone">
        <header className={`atlas-phone-top ${styles.topbar}`}>
          <Link href="/" className="atlas-task-header-brand atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <strong className="atlas-phone-title">Elm Farm</strong>
          </Link>
          <Link href={returnTo} className={styles.back}>← Today</Link>
        </header>

        <div className={`atlas-task-page-body ${styles.body}`}>
          {loading ? <div className={styles.loading}>Opening Grow Room Care…</div> : null}
          {error ? <div className={styles.error} role="alert">{error}</div> : null}

          {!loading && round?.visitTask ? (
            <section className="atlas-task-page-active atlas-dominion-task-card">
              <section className="atlas-task-dominion-place">
                <div><small>Grow Room</small><strong>Grow Room Care</strong></div>
                <span>{prettyDate(round.visitTask.dueDate)}</span>
              </section>

              <ol className="atlas-task-dominion-track" aria-label="Grow Room logs">
                {(round.requests.length ? round.requests : [{ assignmentId: "care" } as GrowRoomRequest]).map((request, index) => {
                  const complete = Boolean(request.resolvedAt);
                  const current = activeRequest?.assignmentId === request.assignmentId;
                  const stepClass = complete ? "step-complete" : current ? "step-current" : "step-context";
                  return (
                    <li className={stepClass} key={request.assignmentId}>
                      <i aria-hidden="true" />
                      <span>{round.requests.length ? `Log ${index + 1}` : "Room care"}</span>
                    </li>
                  );
                })}
                <li className={!activeRequest && round.summary.canFinish ? "step-current" : "step-context"}>
                  <i aria-hidden="true" />
                  <span>Finish</span>
                </li>
              </ol>

              {activeRequest ? (
                <section className="atlas-task-dominion-move">
                  <div className="atlas-task-dominion-kicker">
                    <span>Log {activeRequest.sortOrder} of {round.summary.total}</span>
                    {activeRequest.dueDate && activeRequest.dueDate < (round.visitTask.dueDate || "") ? <small>Overdue</small> : null}
                  </div>
                  <h1>{requestInstruction(activeRequest)}</h1>
                  {activeRequest.displayDetail ? <p className={styles.detail}>{activeRequest.displayDetail}</p> : null}

                  {activeRequest.requestKind === "germination" ? (
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
                <section className={`atlas-task-dominion-move ${styles.finish}`}>
                  <small className="atlas-soft-label">Complete</small>
                  <h1>Grow Room round finished.</h1>
                  <Link href={returnTo}>Return to Today</Link>
                </section>
              ) : (
                <section className={`atlas-task-dominion-move ${styles.finish}`}>
                  <small className="atlas-soft-label">Final step</small>
                  <h1>{round.summary.total ? "Finish the Grow Room round." : "Complete the ordinary Grow Room care."}</h1>
                  <button className={styles.primary} type="button" disabled={saving || !round.summary.canFinish} onClick={() => void finishRound()}>
                    Finish Grow Room round
                  </button>
                </section>
              )}
            </section>
          ) : null}

          {!loading && !round?.visitTask ? (
            <section className="atlas-task-page-active atlas-dominion-task-card">
              <section className={`atlas-task-dominion-move ${styles.finish}`}>
                <small className="atlas-soft-label">No round assigned</small>
                <h1>There is no Grow Room Care task to complete.</h1>
                <Link href="/">Return to Today</Link>
              </section>
            </section>
          ) : null}
        </div>
      </article>
    </main>
  );
}

export default function GrowRoomPage() {
  return <Suspense fallback={<main className="atlas-task-page-shell"><div className={styles.loading}>Opening Grow Room Care…</div></main>}><GrowRoomRoundPage /></Suspense>;
}
