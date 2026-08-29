"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AtlasWorkerActivityDay } from "@/lib/atlas/worker-activity-contract";
import {
  deleteWorkerActivity,
  fetchWorkerActivityDay,
  postWorkerActivity,
} from "@/lib/atlas/worker-activity-client";
import styles from "./worker-activity.module.css";

export const ATLAS_OPEN_WORK_LOG_EVENT = "atlas:open-worker-activity-log";

type TimelineRow = {
  id: string;
  occurredAt: string;
  title: string;
  provenance: string;
  kind: "atlas" | "manual";
};

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function timelineRows(day: AtlasWorkerActivityDay, selfView: boolean): TimelineRow[] {
  const atlasRows = day.journalEvents
    .filter((event) => event.sourceKind === "task" && event.eventKind === "task_result" && ["done", "completed"].includes(event.sourceEvent))
    .map((event) => ({
      id: `event:${event.eventId}`,
      occurredAt: event.occurredAt,
      title: event.title,
      provenance: "Atlas task",
      kind: "atlas" as const,
    }));
  const manualRows = day.activityLogs.map((log) => ({
    id: `manual:${log.activityLogId}`,
    occurredAt: log.loggedAt,
    title: log.rawText,
    provenance: selfView ? "You logged this" : "Worker logged this",
    kind: "manual" as const,
  }));
  return [...atlasRows, ...manualRows].sort((left, right) => {
    const timeDifference = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}

export default function WorkerActivityDayLayer({
  dateIso,
  farmId,
  membershipId,
  selfView,
}: {
  dateIso: string;
  farmId: string | null;
  membershipId: string | null;
  selfView: boolean;
}) {
  const [day, setDay] = useState<AtlasWorkerActivityDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const idempotencyRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!farmId || !membershipId) return;
    setLoading(true);
    setReadError(null);
    try {
      setDay(await fetchWorkerActivityDay({ farmId, membershipId, date: dateIso }));
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Atlas could not load today's activity.");
    } finally {
      setLoading(false);
    }
  }, [dateIso, farmId, membershipId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const openLog = () => {
      if (!selfView || !farmId || !membershipId) return;
      setSaveError(null);
      setOpen(true);
    };
    window.addEventListener(ATLAS_OPEN_WORK_LOG_EVENT, openLog);
    return () => window.removeEventListener(ATLAS_OPEN_WORK_LOG_EVENT, openLog);
  }, [farmId, membershipId, selfView]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = window.setTimeout(() => setToastVisible(false), 7000);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

  const rows = useMemo(() => day ? timelineRows(day, selfView) : [], [day, selfView]);
  const manualCount = day?.activityLogs.length ?? 0;
  const plannedDone = day?.plannedDone ?? 0;
  const thingsDone = plannedDone + manualCount;

  async function submit() {
    const sentence = rawText.trim();
    if (!farmId || !membershipId || !selfView || sentence.length < 3 || saving) return;
    const idempotencyKey = idempotencyRef.current ?? `worker-log:${crypto.randomUUID()}`;
    idempotencyRef.current = idempotencyKey;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await postWorkerActivity({
        farmId,
        logDate: dateIso,
        rawText: sentence,
        idempotencyKey,
      });
      setLastSavedId(result.activityLogId);
      setRawText("");
      idempotencyRef.current = null;
      setOpen(false);
      setToastVisible(true);
      await reload();
    } catch (error) {
      // Deliberately retain rawText and the idempotency key so Retry is safe.
      setSaveError(error instanceof Error ? error.message : "Atlas could not save this work log. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function undo() {
    if (!lastSavedId || undoing) return;
    setUndoing(true);
    try {
      await deleteWorkerActivity(lastSavedId);
      setLastSavedId(null);
      setToastVisible(false);
      await reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Atlas could not undo that entry.");
      setOpen(true);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <>
      <section className={styles.today} aria-label="Work recorded today" data-atlas-worker-activity-day="true">
        <header className={styles.summary}>
          <div>
            <span>Today so far</span>
            <strong>{loading && !day ? "—" : thingsDone} {thingsDone === 1 ? "thing" : "things"} done</strong>
            <small>{plannedDone} Atlas {plannedDone === 1 ? "task" : "tasks"} · {manualCount} {selfView ? "you logged" : "worker logged"}</small>
          </div>
          <div className={styles.attention}>
            <span>Still needs attention</span>
            <strong>{day?.plannedOpen ?? "—"}</strong>
            <small>Atlas tasks</small>
          </div>
        </header>

        {readError ? <p className={styles.readError}>{readError}</p> : null}
        {rows.length ? (
          <div className={styles.timeline} aria-label="Chronological work record">
            {rows.map((row) => (
              <div className={styles.timelineRow} data-kind={row.kind} key={row.id}>
                <span className={styles.check} aria-hidden="true">✓</span>
                <div><strong>{row.title}</strong><small>{row.provenance}{timeLabel(row.occurredAt) ? ` · ${timeLabel(row.occurredAt)}` : ""}</small></div>
              </div>
            ))}
          </div>
        ) : !loading ? <p className={styles.empty}>Completed Atlas work and one-sentence work logs will build the day's record here.</p> : null}
      </section>

      {open ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setOpen(false);
        }}>
          <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="worker-log-heading">
            <div className={styles.grabber} aria-hidden="true" />
            <header><h2 id="worker-log-heading">What did you just get done?</h2><p>Just write one sentence. Atlas will save it to your day.</p></header>
            <textarea
              ref={textareaRef}
              value={rawText}
              maxLength={500}
              rows={4}
              placeholder="Watered the porch plants and moved them out of the sun"
              onChange={(event) => setRawText(event.target.value)}
              disabled={saving}
              aria-label="One sentence describing work you just did"
            />
            {saveError ? <p className={styles.saveError}>{saveError}</p> : null}
            <button className={styles.done} type="button" disabled={saving || rawText.trim().length < 3} onClick={() => void submit()}>{saving ? "SAVING…" : saveError ? "TRY AGAIN" : "DONE"}</button>
          </section>
        </div>
      ) : null}

      {toastVisible && lastSavedId ? (
        <div className={styles.toast} role="status"><strong>Added to your day ✓</strong><button type="button" disabled={undoing} onClick={() => void undo()}>{undoing ? "Undoing…" : "Undo"}</button></div>
      ) : null}
    </>
  );
}
