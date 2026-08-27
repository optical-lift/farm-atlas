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

type ResultKind = "food_picked" | "not_ready" | "crop_exhausted";
type FoodHarvestRow = {
  cropCycleId: string;
  cropLabel: string;
  variety?: string | null;
  zoneLabel: string;
  objectLabel: string;
  resolved: boolean;
  resultKind?: ResultKind | null;
};
type FoodHarvestState = {
  ok?: boolean;
  rows?: FoodHarvestRow[];
  totalRows?: number;
  resolvedRows?: number;
  error?: string;
};

const choices: Array<{ value: ResultKind; label: string }> = [
  { value: "food_picked", label: "Picked" },
  { value: "not_ready", label: "Not ready" },
  { value: "crop_exhausted", label: "Crop exhausted" },
];

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function displayCrop(row: FoodHarvestRow) {
  const crop = row.cropLabel.trim();
  const variety = row.variety?.trim();
  if (!variety) return crop;
  return variety.toLowerCase().includes(crop.toLowerCase()) ? variety : `${variety} ${crop}`;
}

function idempotencyKey(taskId: string, cropCycleId: string, resultKind: ResultKind) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weekly-food-harvest:v1:${taskId}:${cropCycleId}:${resultKind}:${nonce}`;
}

export default function WeeklyFoodHarvestTaskDetail({ task, assignee }: Props) {
  const [state, setState] = useState<FoodHarvestState | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadState() {
    const response = await fetch(`/api/atlas/weekly-food-harvest?taskId=${encodeURIComponent(task.task_id)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await response.json() as FoodHarvestState;
    if (!response.ok || !body.ok) throw new Error(body.error || "Food Harvest details could not be loaded.");
    setState(body);
  }

  useEffect(() => {
    let cancelled = false;
    void loadState().catch((error) => {
      if (!cancelled) setState({ ok: false, error: error instanceof Error ? error.message : "Food Harvest details could not be loaded." });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.task_id]);

  const groups = useMemo(() => {
    const grouped = new Map<string, FoodHarvestRow[]>();
    for (const row of state?.rows ?? []) {
      const zone = row.zoneLabel?.trim() || "Elm Farm";
      grouped.set(zone, [...(grouped.get(zone) ?? []), row]);
    }
    return Array.from(grouped.entries());
  }, [state?.rows]);

  async function record(row: FoodHarvestRow, resultKind: ResultKind) {
    const requestKey = `${row.cropCycleId}:${resultKind}`;
    try {
      setSavingKey(requestKey);
      setMessage(null);
      const response = await fetch("/api/atlas/weekly-food-harvest", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.task_id,
          cropCycleId: row.cropCycleId,
          resultKind,
          idempotencyKey: idempotencyKey(task.task_id, row.cropCycleId, resultKind),
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; taskCompleted?: boolean };
      if (!response.ok || !body.ok) throw new Error(body.error || "Food Harvest result failed.");
      if (body.taskCompleted) {
        window.location.assign(assignee.listPath || "/");
        return;
      }
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Food Harvest result failed.");
    } finally {
      setSavingKey(null);
    }
  }

  const total = state?.totalRows ?? 0;
  const resolved = state?.resolvedRows ?? 0;
  const detailStatus = !state ? "Loading garden crops…" : state.error ? "Food Harvest details unavailable" : `${resolved} / ${total} checked · no flower inventory`;

  return (
    <main className={styles.shell} data-atlas-harvest-card="food-weekly">
      <AtlasTaskCardFrame
        family="Food Harvest"
        familyDetail="Tuesday"
        title="Harvest Food"
        subtitle="Elm Farm"
        timing={task.due_date ? `Weekly · ${prettyDate(task.due_date)}` : "Weekly · Tuesday"}
        completion={false}
      >
        <div className={styles.summary}><strong>Garden harvest</strong><span>{detailStatus}</span></div>
        {!state ? <p className={styles.loading}>Loading food crops in their harvest window…</p> : null}
        {state?.error ? <div className={styles.error} role="status"><strong>Food Harvest is still scheduled.</strong><span>{state.error}</span></div> : null}
        {state?.ok && !total ? <p className={styles.empty}>No food crop is in its harvest window today.</p> : null}
        {state?.ok && total ? (
          <div className={styles.groups}>
            {groups.map(([zone, rows]) => (
              <section className={styles.group} key={zone}>
                <header className={styles.groupHeader}><h3>{zone}</h3></header>
                <div className={styles.rows}>
                  {rows.map((row) => (
                    <div className={styles.row} key={row.cropCycleId} data-resolved={row.resolved ? "true" : "false"}>
                      <div className={styles.cropIdentity}>
                        <span className={styles.cropText}><strong>{displayCrop(row)}</strong><small>{row.objectLabel}</small></span>
                        {row.resolved ? <span className={styles.resolvedLabel}>{choices.find((item) => item.value === row.resultKind)?.label ?? "Recorded"}</span> : null}
                      </div>
                      {!row.resolved ? (
                        <div className={styles.exceptionPanel} data-food-direct-outcomes="true">
                          <span>What happened?</span>
                          <div className={styles.outcomeGrid}>
                            {choices.map((item) => {
                              const saving = savingKey === `${row.cropCycleId}:${item.value}`;
                              return <button type="button" key={item.value} disabled={Boolean(savingKey)} onClick={() => void record(row, item.value)}>{saving ? "Recording…" : item.label}</button>;
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {message ? <p className={styles.errorInline}>{message}</p> : null}
      </AtlasTaskCardFrame>
    </main>
  );
}
