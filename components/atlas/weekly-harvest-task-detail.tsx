"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import styles from "./weekly-harvest-task-detail.module.css";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type HarvestGrade = "florist_grade" | "event_grade";
type HarvestException = "not_ready" | "deadheaded" | "crop_loss";
type HistoricalHarvestException = "crop_exhausted";
type ResultKind = "harvest_amount" | HarvestException | HistoricalHarvestException;
type IntakeSource = "Foraged" | "Purchased" | "Gifted";
type IntakeUnit = "Stems" | "Buckets" | "Bundles";

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
  harvestGrade?: HarvestGrade | null;
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

type ExternalIntakeLine = {
  id: string;
  flower: string;
  color: string;
  unit: IntakeUnit;
  quantity: number;
};

type SavedExternalLine = {
  lineId?: string;
  lineNumber?: number;
  flowerLabel: string;
  colorLabel?: string | null;
  countUnit: "stem" | "bucket" | "bundle";
  quantity: number;
};

type ExternalIntakeResponse = {
  ok?: boolean;
  error?: string;
  sourceKind?: string;
  sourceLabel?: string;
  lines?: SavedExternalLine[];
};

const exceptions: Array<{ value: HarvestException; label: string }> = [
  { value: "not_ready", label: "Not ready" },
  { value: "deadheaded", label: "Deadheaded" },
  { value: "crop_loss", label: "Crop loss" },
];

const grades: Array<{ value: HarvestGrade; label: string }> = [
  { value: "florist_grade", label: "Florist grade" },
  { value: "event_grade", label: "Event grade" },
];

const intakeSources: IntakeSource[] = ["Foraged", "Purchased", "Gifted"];
const intakeUnits: IntakeUnit[] = ["Stems", "Buckets", "Bundles"];

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

function gradeLabel(grade: HarvestGrade | null | undefined) {
  return grades.find((choice) => choice.value === grade)?.label ?? null;
}

function outcomeLabel(kind: ResultKind | null | undefined) {
  if (kind === "crop_exhausted") return "Crop exhausted (legacy)";
  return exceptions.find((choice) => choice.value === kind)?.label ?? "Recorded";
}

function resolvedLabel(row: HarvestRow) {
  if (row.resultKind === "harvest_amount" && row.bucketHalves) {
    const amount = `${formatBuckets(row.bucketHalves)} bucket${row.bucketHalves === 2 ? "" : "s"}`;
    const grade = gradeLabel(row.harvestGrade);
    return grade ? `${amount} · ${grade}` : amount;
  }
  return outcomeLabel(row.resultKind);
}

function idempotencyKey(taskId: string, cropCycleId: string, resultKind: ResultKind) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weekly-harvest:v3:${taskId}:${cropCycleId}:${resultKind}:${nonce}`;
}

function externalIntakeKey(taskId: string) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `external-intake:v1:${taskId}:${nonce}`;
}

function intakeUnitValue(unit: IntakeUnit): "stem" | "bucket" | "bundle" {
  if (unit === "Buckets") return "bucket";
  if (unit === "Bundles") return "bundle";
  return "stem";
}

function pluralCountUnit(unit: string, quantity: number) {
  if (quantity === 1) return unit;
  if (unit === "bundle") return "bundles";
  if (unit === "bucket") return "buckets";
  return "stems";
}

function ExternalIntakeBuilder({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [sourceType, setSourceType] = useState<IntakeSource | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [flowerDraft, setFlowerDraft] = useState("");
  const [colorDraft, setColorDraft] = useState("");
  const [unitDraft, setUnitDraft] = useState<IntakeUnit>("Stems");
  const [lines, setLines] = useState<ExternalIntakeLine[]>([]);
  const [saved, setSaved] = useState<ExternalIntakeResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const retryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  function addLine() {
    const flower = flowerDraft.trim();
    const color = colorDraft.trim();
    if (!flower || !color) return;
    const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${lines.length}`;
    setLines((current) => [...current, { id: nonce, flower, color, unit: unitDraft, quantity: 0 }]);
    setFlowerDraft("");
    setColorDraft("");
    setMessage(null);
  }

  function changeLineQuantity(id: string, delta: number) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line));
    setMessage(null);
  }

  function resetForAnother() {
    setSourceType(null);
    setSourceLabel("");
    setFlowerDraft("");
    setColorDraft("");
    setUnitDraft("Stems");
    setLines([]);
    setSaved(null);
    setMessage(null);
    retryRef.current = null;
  }

  const canSave = Boolean(sourceType && sourceLabel.trim() && lines.length && lines.every((line) => line.quantity > 0));

  async function saveIntake() {
    if (!sourceType || !canSave) return;
    const requestLines = lines.map((line) => ({
      flowerLabel: line.flower.trim(),
      colorLabel: line.color.trim(),
      countUnit: intakeUnitValue(line.unit),
      quantity: line.quantity,
    }));
    const sourceKind = sourceType.toLowerCase();
    const cleanSourceLabel = sourceLabel.trim();
    const fingerprint = JSON.stringify({ sourceKind, sourceLabel: cleanSourceLabel, lines: requestLines });
    const retry = retryRef.current?.fingerprint === fingerprint
      ? retryRef.current
      : { fingerprint, key: externalIntakeKey(taskId) };
    retryRef.current = retry;

    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/external-flower-intake", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId,
          sourceKind,
          sourceLabel: cleanSourceLabel,
          lines: requestLines,
          idempotencyKey: retry.key,
        }),
      });
      const body = await response.json() as ExternalIntakeResponse;
      if (!response.ok || !body.ok) throw new Error(body.error || "External flower intake failed.");
      setSaved(body);
      retryRef.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "External flower intake failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.intakeDrawer} aria-label="External flower intake">
      <div className={styles.intakeDrawerHead}>
        <div className={styles.intakeHeadCopy}>
          <span className={styles.intakeKicker}>External intake</span>
          <strong>Add flowers that did not come from an Elm bed</strong>
        </div>
        <button type="button" className={styles.intakeTextButton} onClick={onClose}>Close</button>
      </div>

      {saved ? (
        <div className={styles.intakeSaved}>
          <span className={styles.intakeKicker}>Added to today’s flower custody</span>
          <strong>{saved.sourceLabel}</strong>
          <div className={styles.intakeSavedRows}>
            {(saved.lines ?? []).map((line, index) => (
              <span key={line.lineId ?? `${line.flowerLabel}-${index}`}>
                {line.colorLabel ? `${line.colorLabel} ` : ""}{line.flowerLabel} · {line.quantity} {pluralCountUnit(line.countUnit, line.quantity)}
              </span>
            ))}
          </div>
          <button type="button" className={styles.intakeTextButton} onClick={resetForAnother}>Log another source</button>
        </div>
      ) : (
        <div className={styles.intakeBuilder}>
          <div className={styles.intakeStep}>
            <span className={styles.intakeStepLabel}>How did these come in?</span>
            <div className={styles.intakePills}>
              {intakeSources.map((choice) => (
                <button type="button" className={styles.intakePill} data-active={sourceType === choice ? "true" : "false"} key={choice} onClick={() => { setSourceType(choice); setMessage(null); }}>{choice}</button>
              ))}
            </div>
          </div>

          <label className={styles.intakeField}>
            <span className={styles.intakeStepLabel}>Source / place</span>
            <input value={sourceLabel} onChange={(event) => { setSourceLabel(event.target.value); setMessage(null); }} placeholder="Roadside, Mary’s garden, wholesaler…" maxLength={200} />
          </label>

          <div className={styles.intakeStep}>
            <span className={styles.intakeStepLabel}>What came in?</span>
            <div className={styles.intakeComposer}>
              <div className={styles.intakeComposerFields}>
                <label className={styles.intakeField}>
                  <span className={styles.intakeStepLabel}>Flower</span>
                  <input value={flowerDraft} onChange={(event) => setFlowerDraft(event.target.value)} placeholder="Dahlia" maxLength={160} />
                </label>
                <label className={styles.intakeField}>
                  <span className={styles.intakeStepLabel}>Color</span>
                  <input value={colorDraft} onChange={(event) => setColorDraft(event.target.value)} placeholder="pink + white" maxLength={160} />
                </label>
              </div>

              <div className={styles.intakeStep}>
                <span className={styles.intakeStepLabel}>Count by</span>
                <div className={styles.intakePills}>
                  {intakeUnits.map((choice) => (
                    <button type="button" className={styles.intakePill} data-active={unitDraft === choice ? "true" : "false"} key={choice} onClick={() => setUnitDraft(choice)}>{choice}</button>
                  ))}
                </div>
              </div>

              <button type="button" className={styles.intakeAddFlower} disabled={!flowerDraft.trim() || !colorDraft.trim() || saving} onClick={addLine}>+ Add flower</button>
            </div>
          </div>

          {lines.length ? (
            <div className={styles.intakeRows}>
              {lines.map((line) => (
                <div className={styles.intakeRow} key={line.id}>
                  <div className={styles.intakeIdentity}>
                    <strong>{line.color} {line.flower}</strong>
                    <small>count by {line.unit.toLowerCase()}</small>
                    <button type="button" className={styles.intakeRemove} disabled={saving} onClick={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))}>Remove</button>
                  </div>
                  <div className={styles.intakeCounter} aria-label={`${line.color} ${line.flower} quantity`}>
                    <button type="button" disabled={saving || line.quantity === 0} onClick={() => changeLineQuantity(line.id, -1)}>−</button>
                    <strong>{line.quantity}</strong>
                    <button type="button" disabled={saving} onClick={() => changeLineQuantity(line.id, 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {message ? <p className={styles.errorInline}>{message}</p> : null}
          <button type="button" className={styles.intakeSave} disabled={saving || !canSave} onClick={() => void saveIntake()}>{saving ? "Adding…" : "Add to harvest custody"}</button>
        </div>
      )}
    </section>
  );
}

export default function WeeklyHarvestTaskDetail({ task, assignee }: Props) {
  const [state, setState] = useState<HarvestState | null>(null);
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [bucketHalves, setBucketHalves] = useState(0);
  const [harvestGrade, setHarvestGrade] = useState<HarvestGrade | null>(null);
  const [exception, setException] = useState<HarvestException | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [externalOpen, setExternalOpen] = useState(false);

  async function loadState() {
    const response = await fetch(`/api/atlas/weekly-harvest?taskId=${encodeURIComponent(task.task_id)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await response.json() as HarvestState;
    if (!response.ok || !body.ok) throw new Error(body.error || "Crop details could not be loaded.");
    setState(body);
  }

  useEffect(() => {
    let cancelled = false;
    void loadState().catch((error) => {
      if (!cancelled) setState({ ok: false, error: error instanceof Error ? error.message : "Crop details could not be loaded." });
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

  function resetDraft() {
    setBucketHalves(0);
    setHarvestGrade(null);
    setException(null);
    setMessage(null);
  }

  function openRow(row: HarvestRow) {
    if (row.resolved) return;
    const next = activeCycleId === row.cropCycleId ? null : row.cropCycleId;
    setActiveCycleId(next);
    resetDraft();
  }

  function changeBucketCount(row: HarvestRow, delta: number) {
    if (row.resolved || saving) return;
    setException(null);
    setMessage(null);
    if (activeCycleId !== row.cropCycleId) {
      setActiveCycleId(row.cropCycleId);
      const next = Math.max(0, delta);
      setBucketHalves(next);
      if (next === 0) setHarvestGrade(null);
      return;
    }
    setBucketHalves((current) => {
      const next = Math.max(0, current + delta);
      if (next === 0) setHarvestGrade(null);
      return next;
    });
  }

  function chooseException(row: HarvestRow, next: HarvestException) {
    if (row.resolved || saving) return;
    if (activeCycleId !== row.cropCycleId) setActiveCycleId(row.cropCycleId);
    setException(next);
    setBucketHalves(0);
    setHarvestGrade(null);
    setMessage(null);
  }

  async function record(row: HarvestRow) {
    const resultKind: "harvest_amount" | HarvestException | null = bucketHalves > 0 ? "harvest_amount" : exception;
    if (!resultKind || (resultKind === "harvest_amount" && !harvestGrade)) return;

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
          harvestGrade: resultKind === "harvest_amount" ? harvestGrade : null,
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
      resetDraft();
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
  const detailStatus = !state
    ? "Loading crop details…"
    : state.error
      ? `${prettyDate(task.due_date) || "Thursday"} harvest · crop details unavailable`
      : `${resolved} / ${total} recorded · ½ bucket increments`;

  return (
    <main className={styles.shell} data-atlas-harvest-card="weekly" data-atlas-harvest-contract="v3">
      <AtlasTaskCardFrame family="Harvest" familyDetail="Thursday" title="Harvest Stems" subtitle="Elm Farm" timing={timing} completion={false}>
        <div className={styles.summary}>
          <strong>Ready to harvest</strong>
          <span>{detailStatus}</span>
        </div>

        {!state ? <p className={styles.loading}>Loading this week’s crop and bed truth…</p> : null}
        {state?.error ? (
          <div className={styles.error} role="status">
            <strong>Harvest is still scheduled.</strong>
            <span>{state.error}</span>
          </div>
        ) : null}
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
                    const canRecord = active && ((bucketHalves > 0 && Boolean(harvestGrade)) || Boolean(exception));
                    const recordLabel = bucketHalves > 0
                      ? harvestGrade
                        ? `Record ${formatBuckets(bucketHalves)} bucket${bucketHalves === 2 ? "" : "s"} · ${gradeLabel(harvestGrade)}`
                        : "Choose harvest grade"
                      : exception
                        ? `Record ${outcomeLabel(exception)}`
                        : "Choose an amount or outcome";

                    return (
                      <div className={styles.row} key={row.cropCycleId} data-open={active ? "true" : "false"} data-resolved={row.resolved ? "true" : "false"}>
                        <button className={styles.cropIdentity} type="button" onClick={() => openRow(row)} disabled={row.resolved} aria-expanded={active} aria-controls={`harvest-outcomes-${row.cropCycleId}`}>
                          <span className={styles.cropText}>
                            <strong>{displayCrop(row)}</strong>
                            <small>{row.objectLabel}</small>
                          </span>
                          {row.resolved ? <span className={styles.resolvedLabel}>{resolvedLabel(row)}</span> : null}
                        </button>

                        <div className={styles.bucketCounter} aria-label={`${displayCrop(row)} bucket count`}>
                          <button type="button" aria-label={`Remove half bucket from ${displayCrop(row)}`} disabled={row.resolved || saving || !active || bucketHalves === 0} onClick={() => changeBucketCount(row, -1)}>−</button>
                          <strong>{formatBuckets(visibleHalves)}</strong>
                          <button type="button" aria-label={`Add half bucket to ${displayCrop(row)}`} disabled={row.resolved || saving} onClick={() => changeBucketCount(row, 1)}>+</button>
                        </div>

                        {active ? (
                          <div className={styles.exceptionPanel} id={`harvest-outcomes-${row.cropCycleId}`}>
                            {bucketHalves > 0 ? (
                              <>
                                <span>Harvest grade</span>
                                <div className={styles.outcomeGrid}>
                                  {grades.map((choice) => (
                                    <button type="button" data-active={harvestGrade === choice.value ? "true" : "false"} key={choice.value} onClick={() => { setHarvestGrade(choice.value); setException(null); setMessage(null); }}>{choice.label}</button>
                                  ))}
                                </div>
                              </>
                            ) : null}
                            <span>Or record a non-harvest outcome</span>
                            <div className={styles.outcomeGrid}>
                              {exceptions.map((choice) => (
                                <button type="button" data-active={exception === choice.value ? "true" : "false"} key={choice.value} onClick={() => chooseException(row, choice.value)}>{choice.label}</button>
                              ))}
                            </div>
                            {message ? <p className={styles.errorInline}>{message}</p> : null}
                            <button className={styles.record} type="button" disabled={saving || !canRecord} onClick={() => void record(row)}>{saving ? "Recording…" : recordLabel}</button>
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

        {state?.ok ? (
          <div className={styles.intakeLaunch}>
            <div className={styles.intakeHeadCopy}>
              <span className={styles.intakeKicker}>External intake</span>
              <strong>Add flowers that did not come from an Elm bed</strong>
            </div>
            <button type="button" aria-expanded={externalOpen} onClick={() => setExternalOpen((current) => !current)}>{externalOpen ? "Close external intake" : "Log external intake"}</button>
          </div>
        ) : null}

        {state?.ok && externalOpen ? <ExternalIntakeBuilder taskId={task.task_id} onClose={() => setExternalOpen(false)} /> : null}
      </AtlasTaskCardFrame>
    </main>
  );
}
