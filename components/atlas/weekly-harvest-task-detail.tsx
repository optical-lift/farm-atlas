"use client";

import { useEffect, useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import styles from "./weekly-harvest-task-detail.module.css";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type HarvestException = "not_ready" | "deadheaded" | "crop_exhausted";
type ResultKind = "harvest_amount" | HarvestException;

type HarvestRow = {
  cropCycleId: string;
  cropLabel: string;
  variety?: string | null;
  zoneLabel: string;
  objectLabel: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  cycleState?: string | null;
  availabilityStatus?: string | null;
  resolved: boolean;
  resultKind?: ResultKind | null;
  bucketHalves?: number | null;
};

type HarvestState = {
  ok?: boolean;
  taskId?: string;
  status?: string;
  dueDate?: string | null;
  rows?: HarvestRow[];
  totalRows?: number;
  resolvedRows?: number;
  complete?: boolean;
  error?: string;
};

const exceptions: Array<{ value: HarvestException; label: string }> = [
  { value: "not_ready", label: "Not ready" },
  { value: "deadheaded", label: "Deadheaded" },
  { value: "crop_exhausted", label: "Crop exhausted" },
];

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function displayCrop(row: HarvestRow) {
  const crop = row.cropLabel.trim();
  const variety = row.variety?.trim();
  if (!variety) return crop;
  return variety.toLowerCase().includes(crop.toLowerCase()) ? variety : `${variety} ${crop}`;
}

function formatBuckets(bucketHalves: number) {
  const buckets = bucketHalves / 2;
  if (Number.isInteger(buckets)) return `${buckets}`;
  return `${Math.floor(buckets)}½`.replace("0½", "½");
}

function resolvedLabel(row: HarvestRow) {
  if (row.resultKind === "harvest_amount" && row.bucketHalves) return `${formatBuckets(row.bucketHalves)} bucket${row.bucketHalves === 2 ? "" : "s"}`;
  return exceptions.find((choice) => choice.value === row.resultKind)?.label ?? "Recorded";
}

function idempotencyKey(taskId: string, cropCycleId: string, resultKind: ResultKind) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weekly-harvest:v2:${taskId}:${cropCycleId}:${resultKind}:${nonce}`;
}

export default function WeeklyHarvestTaskDetail({ task, assignee }: Props) {
  const [state, setState] = useState<HarvestState | null>(null);
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [bucketHalves, setBucketHalves] = useState(0);
  const [exception, setException] = useState<HarvestException | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadState() {
    const response = await fetch(`/api/atlas/weekly-harvest?taskId=${encodeURIComponent(task.task_id)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await response.json() as HarvestState;
    if (!response.ok || !body.ok) throw new Error(body.error || "Weekly Harvest could not be loaded.");
    setState(body);
  }

  useEffect(() => {
    let cancelled = false;
    void loadState().catch((error) => {
      if (!cancelled) setState({ ok: false, error: error instanceof Error ? error.message : "Weekly Harvest could not be loaded." });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.task_id]);

  const groups = useMemo(() => {
    const grouped = new Map<string, HarvestRow[]>();
    for (const row of state?.rows ?? []) {
      const zone = row.zoneLabel?.trim() || "Elm Farm";
      grouped.set(zone, [...(grouped.get(zone) ?? []), row]);
    }
    return Array.from(grouped.entries());
  }, [state?.rows]);

  function openRow(row: HarvestRow) {
    if (row.resolved) return;
    const next = activeCycleId === row.cropCycleId ? null : row.cropCycleId;
    setActiveCycleId(next);
    setBucketHalves(0);
    setException(null);
    setMessage(null);
  }

  function changeBucketCount(row: HarvestRow, delta: number) {
    if (row.resolved || saving) return;
    setException(null);
    setMessage(null);
    if (activeCycleId !== row.cropCycleId) {
      setActiveCycleId(row.cropCycleId);
      setBucketHalves(Math.max(0, delta));
      return;
    }
    setBucketHalves((current) => Math.max(0, current + delta));
  }

  function chooseException(row: HarvestRow, next: HarvestException) {
    if (row.resolved || saving) return;
    if (activeCycleId !== row.cropCycleId) setActiveCycleId(row.cropCycleId);
    setException(next);
    setBucketHalves(0);
    setMessage(null);
  }

  async function record(row: HarvestRow) {
    const resultKind: ResultKind | null = bucketHalves > 0 ? "harvest_amount" : exception;
    if (!resultKind) return;

    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/weekly-harvest", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.task_id,
          cropCycleId: row.cropCycleId,
          resultKind,
          bucketHalves: resultKind === "harvest_amount" ? bucketHalves : null,
          idempotencyKey: idempotencyKey(task.task_id, row.cropCycleId, resultKind),
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; taskCompleted?: boolean };
      if (!response.ok || !body.ok) throw new Error(body.error || "Harvest result failed.");

      if (body.taskCompleted) {
        window.location.assign(assignee.listPath || "/");
        return;
      }

      setActiveCycleId(null);
      setBucketHalves(0);
      setException(null);
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Harvest result failed.");
    } finally {
      setSaving(false);
    }
  }

  const total = state?.totalRows ?? 0;
  const resolved = state?.resolvedRows ?? 0;
  const timing = task.due_date ? `Weekly · ${prettyDate(task.due_date)}` : "Weekly · Thursday";

  return (
    <main className={styles.shell} data-atlas-harvest-card="weekly">
      <AtlasTaskCardFrame
        family="Harvest"
        familyDetail="Thursday"
        title="Harvest Stems"
        subtitle="Elm Farm"
        timing={timing}
        completion={false}
      >
        <div className={styles.summary}>
          <strong>Ready to harvest</strong>
          <span>{resolved} / {total} recorded · ½ bucket increments</span>
        </div>

        {!state ? <p className={styles.loading}>Loading this week’s crop and bed truth…</p> : null}
        {state?.error ? <p className={styles.error}>{state.error}</p> : null}
        {state?.ok && !total ? <p className={styles.empty}>No crop is in the Harvest window for this card.</p> : null}

        {state?.ok && total ? (
          <div className={styles.groups}>
            {groups.map(([zone, rows]) => (
              <section className={styles.group} key={zone}>
                <header className={styles.groupHeader}><h3>{zone}</h3></header>
                <div className={styles.rows}>
                  {rows.map((row) => {
                    const active = activeCycleId === row.cropCycleId;
                    const visibleHalves = row.resolved && row.resultKind === "harvest_amount" ? row.bucketHalves ?? 0 : active ? bucketHalves : 0;
                    const canRecord = active && (bucketHalves > 0 || Boolean(exception));
                    const recordLabel = bucketHalves > 0
                      ? `Record ${formatBuckets(bucketHalves)} bucket${bucketHalves === 2 ? "" : "s"}`
                      : exception
                        ? `Record ${exceptions.find((choice) => choice.value === exception)?.label ?? "result"}`
                        : "Choose an amount or outcome";

                    return (
                      <div className={styles.row} key={row.cropCycleId} data-open={active ? "true" : "false"} data-resolved={row.resolved ? "true" : "false"}>
                        <button
                          className={styles.cropIdentity}
                          type="button"
                          onClick={() => openRow(row)}
                          disabled={row.resolved}
                          aria-expanded={active}
                          aria-controls={`harvest-outcomes-${row.cropCycleId}`}
                        >
                          <span className={styles.cropText}>
                            <strong>{displayCrop(row)}</strong>
                            <small>{row.objectLabel}</small>
                          </span>
                          {row.resolved ? <span className={styles.resolvedLabel}>{resolvedLabel(row)}</span> : null}
                        </button>

                        <div className={styles.bucketCounter} aria-label={`${displayCrop(row)} bucket count`}>
                          <button
                            type="button"
                            aria-label={`Remove half bucket from ${displayCrop(row)}`}
                            disabled={row.resolved || saving || !active || bucketHalves === 0}
                            onClick={() => changeBucketCount(row, -1)}
                          >−</button>
                          <strong>{formatBuckets(visibleHalves)}</strong>
                          <button
                            type="button"
                            aria-label={`Add half bucket to ${displayCrop(row)}`}
                            disabled={row.resolved || saving}
                            onClick={() => changeBucketCount(row, 1)}
                          >+</button>
                        </div>

                        {active ? (
                          <div className={styles.exceptionPanel} id={`harvest-outcomes-${row.cropCycleId}`}>
                            <span>What happened?</span>
                            <div className={styles.outcomeGrid}>
                              {exceptions.map((choice) => (
                                <button
                                  type="button"
                                  data-active={exception === choice.value ? "true" : "false"}
                                  key={choice.value}
                                  onClick={() => chooseException(row, choice.value)}
                                >{choice.label}</button>
                              ))}
                            </div>
                            {message ? <p className={styles.errorInline}>{message}</p> : null}
                            <button className={styles.record} type="button" disabled={saving || !canRecord} onClick={() => void record(row)}>
                              {saving ? "Recording…" : recordLabel}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </AtlasTaskCardFrame>
    </main>
  );
}
