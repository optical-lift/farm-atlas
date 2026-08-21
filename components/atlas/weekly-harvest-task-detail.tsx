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

type ResultKind = "not_ready" | "beginning" | "harvested" | "declining" | "finished" | "problem_or_uncertain";
type BucketBand = "quarter" | "half" | "three_quarters" | "one" | "more_than_one";
type MoreAvailability = "yes" | "no" | "unsure";

type HarvestRow = {
  cropCycleId: string;
  cropLabel: string;
  variety?: string | null;
  objectLabel: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  cycleState?: string | null;
  availabilityStatus?: string | null;
  resolved: boolean;
  resultKind?: ResultKind | null;
  bucketBand?: BucketBand | null;
  moreAvailability?: MoreAvailability | null;
  note?: string | null;
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

const results: Array<{ value: ResultKind; label: string }> = [
  { value: "not_ready", label: "Not ready" },
  { value: "beginning", label: "Beginning" },
  { value: "harvested", label: "Harvested" },
  { value: "declining", label: "Declining" },
  { value: "finished", label: "Finished" },
  { value: "problem_or_uncertain", label: "Problem / uncertain" },
];

const buckets: Array<{ value: BucketBand; label: string }> = [
  { value: "quarter", label: "¼ bucket" },
  { value: "half", label: "½ bucket" },
  { value: "three_quarters", label: "¾ bucket" },
  { value: "one", label: "1 bucket" },
  { value: "more_than_one", label: "> 1 bucket" },
];

const moreOptions: Array<{ value: MoreAvailability; label: string }> = [
  { value: "yes", label: "More remains" },
  { value: "no", label: "Harvest finished" },
  { value: "unsure", label: "Unsure" },
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

function resultLabel(row: HarvestRow) {
  if (!row.resultKind) return "";
  if (row.resultKind === "harvested" && row.bucketBand) {
    const bucket = buckets.find((candidate) => candidate.value === row.bucketBand)?.label ?? "Harvested";
    return bucket;
  }
  return results.find((candidate) => candidate.value === row.resultKind)?.label ?? row.resultKind.replaceAll("_", " ");
}

function idempotencyKey(taskId: string, cropCycleId: string, resultKind: ResultKind) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weekly-harvest:${taskId}:${cropCycleId}:${resultKind}:${nonce}`;
}

export default function WeeklyHarvestTaskDetail({ task, assignee }: Props) {
  const [state, setState] = useState<HarvestState | null>(null);
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [resultKind, setResultKind] = useState<ResultKind | null>(null);
  const [bucketBand, setBucketBand] = useState<BucketBand | null>(null);
  const [moreAvailability, setMoreAvailability] = useState<MoreAvailability | null>(null);
  const [note, setNote] = useState("");
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
    for (const row of state?.rows ?? []) grouped.set(row.objectLabel, [...(grouped.get(row.objectLabel) ?? []), row]);
    return Array.from(grouped.entries());
  }, [state?.rows]);

  function openRow(row: HarvestRow) {
    if (row.resolved) return;
    const next = activeCycleId === row.cropCycleId ? null : row.cropCycleId;
    setActiveCycleId(next);
    setResultKind(null);
    setBucketBand(null);
    setMoreAvailability(null);
    setNote("");
    setMessage(null);
  }

  async function record(row: HarvestRow) {
    if (!resultKind) return;
    if (resultKind === "harvested" && (!bucketBand || !moreAvailability)) return;
    if (resultKind === "problem_or_uncertain" && !note.trim()) return;

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
          bucketBand: resultKind === "harvested" ? bucketBand : null,
          moreAvailability: resultKind === "harvested" ? moreAvailability : null,
          note: note.trim() || null,
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
      setResultKind(null);
      setBucketBand(null);
      setMoreAvailability(null);
      setNote("");
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
        title="Harvest"
        subtitle="Elm Farm"
        timing={timing}
        completion={false}
      >
        <div className={styles.summary}>
          <strong>Work this week’s harvest rows</strong>
          <span>{resolved} / {total} resolved</span>
        </div>

        {!state ? <p className={styles.loading}>Loading the crops in this week’s harvest window…</p> : null}
        {state?.error ? <p className={styles.error}>{state.error}</p> : null}
        {state?.ok && !total ? <p className={styles.empty}>No crop is in the Harvest window for this card.</p> : null}

        {state?.ok && total ? (
          <div className={styles.groups}>
            {groups.map(([location, rows]) => (
              <section className={styles.group} key={location}>
                <span className={styles.groupHeading}>{location}</span>
                <div className={styles.rows}>
                  {rows.map((row) => {
                    const active = activeCycleId === row.cropCycleId;
                    const needsHarvestDetail = active && resultKind === "harvested";
                    const canRecord = Boolean(resultKind)
                      && (resultKind !== "harvested" || Boolean(bucketBand && moreAvailability))
                      && (resultKind !== "problem_or_uncertain" || Boolean(note.trim()));
                    return (
                      <div className={styles.row} key={row.cropCycleId} data-resolved={row.resolved ? "true" : "false"}>
                        <button className={styles.rowButton} type="button" onClick={() => openRow(row)} disabled={row.resolved} aria-expanded={active}>
                          <span className={styles.check} aria-hidden="true">{row.resolved ? "✓" : ""}</span>
                          <span className={styles.crop}>
                            <strong>{displayCrop(row)}</strong>
                            <small>{row.cycleState?.replaceAll("_", " ") || "Harvest window"}</small>
                          </span>
                          <span className={styles.resultLabel}>{row.resolved ? resultLabel(row) : active ? "Close" : "Open"}</span>
                        </button>

                        {active ? (
                          <div className={styles.editor}>
                            <div className={styles.choices}>
                              {results.map((choice) => (
                                <button
                                  className={styles.choice}
                                  data-active={resultKind === choice.value ? "true" : "false"}
                                  key={choice.value}
                                  type="button"
                                  onClick={() => {
                                    setResultKind(choice.value);
                                    setBucketBand(null);
                                    setMoreAvailability(null);
                                    setMessage(null);
                                  }}
                                >
                                  {choice.label}
                                </button>
                              ))}
                            </div>

                            {needsHarvestDetail ? (
                              <>
                                <fieldset className={styles.fieldset}>
                                  <legend>How much did you cut?</legend>
                                  <div className={styles.bucketChoices}>
                                    {buckets.map((choice) => (
                                      <button className={styles.smallChoice} data-active={bucketBand === choice.value ? "true" : "false"} key={choice.value} type="button" onClick={() => setBucketBand(choice.value)}>{choice.label}</button>
                                    ))}
                                  </div>
                                </fieldset>
                                <fieldset className={styles.fieldset}>
                                  <legend>What remains?</legend>
                                  <div className={styles.moreChoices}>
                                    {moreOptions.map((choice) => (
                                      <button className={styles.smallChoice} data-active={moreAvailability === choice.value ? "true" : "false"} key={choice.value} type="button" onClick={() => setMoreAvailability(choice.value)}>{choice.label}</button>
                                    ))}
                                  </div>
                                </fieldset>
                              </>
                            ) : null}

                            {resultKind ? (
                              <label className={styles.note}>
                                <span>{resultKind === "problem_or_uncertain" ? "What’s wrong or uncertain?" : "Note (optional)"}</span>
                                <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
                              </label>
                            ) : null}

                            {message ? <p className={styles.error}>{message}</p> : null}
                            <button className={styles.record} type="button" disabled={saving || !canRecord} onClick={() => void record(row)}>
                              {saving ? "Recording…" : "Record this crop"}
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
