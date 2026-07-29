"use client";

import { useEffect, useMemo, useState } from "react";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

type PlantLogForm = {
  amount: string;
  zoneId: string;
  objectId: string;
  message: string | null;
};

type SowingContext = {
  title: string;
  status: string;
  sownDate: string;
  variety: string;
  currentStage: string;
  detailLines: string[];
};

function meta(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function boolish(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function prettyDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function humanStage(value: string) {
  return value ? value.replaceAll("_", " ") : "";
}

function label(task: AtlasTaskCard) {
  return text(meta(task, "checklist_label")) || text(meta(task, "display_subject")) || task.title.replace(/^Checklist\s+—\s+/i, "");
}

function detailLines(task: AtlasTaskCard) {
  return stringList(meta(task, "detail_lines"));
}

function sowingContext(task: AtlasTaskCard, key: "source_sowing" | "gap_fill_sowing"): SowingContext | null {
  const value = record(meta(task, key));
  if (!value) return null;
  const title = text(value.title);
  if (!title) return null;
  return {
    title,
    status: text(value.status),
    sownDate: text(value.sown_date),
    variety: text(value.variety),
    currentStage: text(value.current_stage),
    detailLines: stringList(value.detail_lines),
  };
}

function legacySourceSowing(task: AtlasTaskCard): SowingContext | null {
  const sourceId = text(meta(task, "source_sowing_task_id"));
  if (!sourceId) return null;
  return {
    title: text(meta(task, "source_sowing_title")) || "Linked sowing record",
    status: text(meta(task, "source_sowing_status")),
    sownDate: text(meta(task, "source_sowing_date")),
    variety: "",
    currentStage: text(meta(task, "current_stage")),
    detailLines: [],
  };
}

function isDone(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done" || text(meta(task, "checklist_status")) === "done";
}

function needsPlantingLog(task: AtlasTaskCard) {
  return boolish(meta(task, "planting_log_required"));
}

function needsNetworkLog(task: AtlasTaskCard) {
  return boolish(meta(task, "network_log_enabled"));
}

function networkLogPrompt(task: AtlasTaskCard) {
  return text(meta(task, "network_log_prompt"))
    || "Company — contact — what they have — quantity/frequency — free or price — pickup details";
}

function objectRequired(task: AtlasTaskCard) {
  return meta(task, "planting_log_object_required") !== false && meta(task, "planting_log_object_required") !== "false";
}

function defaultAmount(task: AtlasTaskCard) {
  return numberText(meta(task, "planting_log_default_amount"));
}

function defaultZoneId(task: AtlasTaskCard) {
  return text(meta(task, "planting_log_default_zone_id"));
}

function defaultObjectId(task: AtlasTaskCard) {
  return text(meta(task, "planting_log_default_object_id"));
}

function logSummary(task: AtlasTaskCard) {
  const plantingLog = meta(task, "planting_log") as Record<string, unknown> | undefined;
  return text(plantingLog?.summary);
}

function visibleObjects(zone: AtlasRegistryZone | null) {
  return (zone?.objects ?? [])
    .filter((object) => object.object_type !== "path" && object.object_type !== "corridor")
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.label.localeCompare(b.label));
}

function zoneById(zones: AtlasRegistryZone[], zoneId: string) {
  return zones.find((zone) => zone.id === zoneId) ?? null;
}

function zoneForObject(zones: AtlasRegistryZone[], objectId: string) {
  return zones.find((zone) => visibleObjects(zone).some((object) => object.id === objectId)) ?? null;
}

function objectById(zones: AtlasRegistryZone[], objectId: string) {
  return zoneForObject(zones, objectId)?.objects.find((object) => object.id === objectId) ?? null;
}

function locationForSelection(zones: AtlasRegistryZone[], zoneId: string, objectId: string) {
  const object = objectId ? objectById(zones, objectId) : null;
  if (object) return object.label;
  return zoneById(zones, zoneId)?.label ?? "";
}

async function postChildToggle(taskId: string, checklistStatus: "open" | "done", body: Record<string, unknown> = {}) {
  return postAtlasTaskTransition({
    taskId,
    transition: checklistStatus === "done" ? "checklist_done" : "checklist_open",
    laneKey: "checklist",
    workKey: checklistStatus === "done" ? "checked" : "reopened",
    payload: { completion_source: "checklist", ...body },
  });
}

export function TaskChildChecklist({ childTasks, onChange }: { childTasks: AtlasTaskCard[]; onChange: () => Promise<void> }) {
  const [zones, setZones] = useState<AtlasRegistryZone[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [activeNetworkLogId, setActiveNetworkLogId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, PlantLogForm>>({});
  const [networkDrafts, setNetworkDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    childTasks.map((task) => [task.task_id, task.note ?? ""]),
  ));
  const [savedNetworkNotes, setSavedNetworkNotes] = useState<Record<string, string>>(() => Object.fromEntries(
    childTasks.map((task) => [task.task_id, task.note ?? ""]),
  ));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, string | null>>({});

  const needsRegistry = useMemo(() => childTasks.some((task) => needsPlantingLog(task) && !isDone(task)), [childTasks]);

  useEffect(() => {
    if (!needsRegistry) return;
    let cancelled = false;

    async function load() {
      try {
        setRegistryLoading(true);
        setRegistryError(null);
        const response = await fetchAtlasZoneRegistry();
        if (!cancelled) setZones(response.zones ?? []);
      } catch (error) {
        if (!cancelled) setRegistryError(error instanceof Error ? error.message : "Zone registry failed.");
      } finally {
        if (!cancelled) setRegistryLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [needsRegistry]);

  if (!childTasks.length) return null;

  function formFor(task: AtlasTaskCard) {
    const current = forms[task.task_id];
    if (current) return current;

    const objectId = defaultObjectId(task);
    const objectZone = objectId ? zoneForObject(zones, objectId) : null;
    return {
      amount: defaultAmount(task),
      zoneId: objectZone?.id ?? defaultZoneId(task),
      objectId,
      message: null,
    };
  }

  function updateForm(taskId: string, patch: Partial<PlantLogForm>) {
    setForms((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? { amount: "", zoneId: "", objectId: "", message: null }), ...patch },
    }));
  }

  function openPlantingLog(task: AtlasTaskCard) {
    const initial = formFor(task);
    setActiveNetworkLogId(null);
    setActiveLogId(task.task_id);
    setRowMessages((current) => ({ ...current, [task.task_id]: null }));
    setForms((current) => ({ ...current, [task.task_id]: initial }));
  }

  function openNetworkLog(task: AtlasTaskCard) {
    setActiveLogId(null);
    setActiveNetworkLogId(task.task_id);
    setRowMessages((current) => ({ ...current, [task.task_id]: null }));
    setNetworkDrafts((current) => ({
      ...current,
      [task.task_id]: current[task.task_id] ?? savedNetworkNotes[task.task_id] ?? task.note ?? "",
    }));
  }

  async function togglePlain(task: AtlasTaskCard, checklistStatus: "open" | "done") {
    try {
      setSavingId(task.task_id);
      setRowMessages((current) => ({ ...current, [task.task_id]: null }));
      await postChildToggle(task.task_id, checklistStatus);
      setActiveLogId(null);
      setActiveNetworkLogId(null);
      await onChange();
    } catch (error) {
      setRowMessages((current) => ({ ...current, [task.task_id]: error instanceof Error ? error.message : "Checklist failed." }));
    } finally {
      setSavingId(null);
    }
  }

  async function saveNetworkLog(task: AtlasTaskCard) {
    const note = (networkDrafts[task.task_id] ?? "").trim();
    if (!note) {
      setRowMessages((current) => ({ ...current, [task.task_id]: "Add at least one company or finding first." }));
      return;
    }

    try {
      setSavingId(task.task_id);
      setRowMessages((current) => ({ ...current, [task.task_id]: "Saving…" }));
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "note",
        note,
        laneKey: "network",
        workKey: "input_findings",
        payload: {
          completion_source: "inline_subtask_note",
          note_kind: "network_input_findings",
          parent_task_id: task.parent_task_id,
          input_key: text(meta(task, "network_input_key")),
        },
      });
      setSavedNetworkNotes((current) => ({ ...current, [task.task_id]: note }));
      setActiveNetworkLogId(null);
      setRowMessages((current) => ({ ...current, [task.task_id]: "Company findings saved." }));
    } catch (error) {
      setRowMessages((current) => ({ ...current, [task.task_id]: error instanceof Error ? error.message : "Company findings could not be saved." }));
    } finally {
      setSavingId(null);
    }
  }

  async function savePlantingLog(task: AtlasTaskCard) {
    const form = formFor(task);
    const selectedZone = zoneById(zones, form.zoneId);
    const selectedObjects = visibleObjects(selectedZone);
    const selectedObject = form.objectId ? selectedObjects.find((object) => object.id === form.objectId) : null;

    if (!form.amount.trim()) return updateForm(task.task_id, { message: "Add the count first." });
    if (registryLoading) return updateForm(task.task_id, { message: "Zones are still loading." });
    if (registryError) return updateForm(task.task_id, { message: registryError });
    if (!zones.length) return updateForm(task.task_id, { message: "Zone registry did not load. Try again in a moment." });
    if (!form.zoneId || !selectedZone) return updateForm(task.task_id, { message: "Choose the zone first." });
    if (!selectedObjects.length) return updateForm(task.task_id, { message: "This zone does not have registered beds yet." });
    if (objectRequired(task) && !selectedObject) return updateForm(task.task_id, { message: "Choose the real bed / area next." });

    try {
      setSavingId(task.task_id);
      updateForm(task.task_id, { message: "Saving…" });
      await postChildToggle(task.task_id, "done", {
        plantedAmount: form.amount,
        plantedZoneId: form.zoneId,
        plantedObjectId: form.objectId,
        plantedLocation: locationForSelection(zones, form.zoneId, form.objectId),
      });
      setActiveLogId(null);
      await onChange();
    } catch (error) {
      updateForm(task.task_id, { message: error instanceof Error ? error.message : "Checklist failed." });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="atlas-plant-check" data-react-child-checklist="true">
      <style>{`
        .atlas-plant-check__item.is-simple .atlas-plant-check__actions button::after { content: none !important; }
        .atlas-plant-check__item.is-simple .atlas-plant-check__content { padding-right: 14px !important; }
        .atlas-plant-check__history { display: grid; gap: 3px; margin-top: 8px; }
        .atlas-plant-check__history + .atlas-plant-check__history { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(91, 99, 71, .18); }
        .atlas-plant-check__history b { font-size: .78em; letter-spacing: .08em; text-transform: uppercase; }
        .atlas-plant-check__history em { font-style: normal; font-weight: 700; }
        .atlas-network-findings { white-space: pre-wrap; line-height: 1.42; }
        .atlas-network-log-form { grid-column: 1 / -1; display: grid; gap: 10px; margin: 10px 12px 12px; padding: 12px; border-radius: 14px; background: rgba(255,255,255,.58); border: 1px solid rgba(91, 99, 71, .18); }
        .atlas-network-log-form label { display: grid; gap: 6px; }
        .atlas-network-log-form label > span { font-size: .78rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
        .atlas-network-log-form textarea { width: 100%; min-height: 132px; resize: vertical; border: 1px solid rgba(91, 99, 71, .28); border-radius: 10px; padding: 10px 11px; font: inherit; line-height: 1.4; background: rgba(255,255,255,.9); }
        .atlas-network-log-form small { line-height: 1.35; opacity: .78; }
        .atlas-network-log-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .atlas-network-log-actions button { min-height: 38px; }
        .atlas-plant-check__actions.has-two-actions { display: flex; flex-wrap: wrap; gap: 6px; }
        @media (max-width: 430px) {
          .atlas-plant-check__item.is-simple .atlas-plant-check__content { padding-right: 12px !important; }
          .atlas-network-log-form { margin-inline: 8px; }
        }
      `}</style>
      <h3>Checklist</h3>
      <div className="atlas-plant-check__list">
        {childTasks.map((task) => {
          const done = isDone(task);
          const plantingLog = needsPlantingLog(task);
          const networkLog = needsNetworkLog(task);
          const interactive = plantingLog || networkLog;
          const active = activeLogId === task.task_id;
          const activeNetwork = activeNetworkLogId === task.task_id;
          const form = formFor(task);
          const selectedZone = zoneById(zones, form.zoneId);
          const objects = visibleObjects(selectedZone);
          const rowMessage = rowMessages[task.task_id];
          const isSaving = savingId === task.task_id;
          const summary = logSummary(task);
          const source = sowingContext(task, "source_sowing") ?? legacySourceSowing(task);
          const gapFill = sowingContext(task, "gap_fill_sowing");
          const fallbackLines = !gapFill ? detailLines(task) : [];
          const savedNetworkNote = savedNetworkNotes[task.task_id] ?? task.note ?? "";

          return (
            <article
              key={task.task_id}
              className={`atlas-plant-check__item${interactive ? " has-inline-action" : " is-simple"}${done ? " is-done" : ""}${isSaving ? " is-saving" : ""}`}
              data-child-task-id={task.task_id}
              data-checklist-action={plantingLog ? "inline-form" : networkLog ? "network-log" : "simple"}
            >
              <div className="atlas-plant-check__content">
                <span className="atlas-plant-check__mark">{done ? "✓" : ""}</span>
                <div className="atlas-plant-check__copy">
                  <strong>{label(task)}</strong>
                  {source ? (
                    <div className="atlas-plant-check__history">
                      <b>Last sowing</b>
                      <em>{source.title}{source.sownDate ? ` · ${prettyDate(source.sownDate)}` : ""}</em>
                      {source.currentStage ? <span>Current stand · {humanStage(source.currentStage)}</span> : null}
                      {source.detailLines.map((line) => <span key={`source-${line}`}>{line}</span>)}
                    </div>
                  ) : null}
                  {gapFill ? (
                    <div className="atlas-plant-check__history">
                      <b>Gap fill</b>
                      <em>{gapFill.variety || gapFill.title}{gapFill.sownDate ? ` · ${prettyDate(gapFill.sownDate)}` : ""}</em>
                      {gapFill.detailLines.map((line) => <span key={`gap-${line}`}>{line}</span>)}
                    </div>
                  ) : null}
                  {fallbackLines.map((line) => <span key={line}>{line}</span>)}
                  {savedNetworkNote ? (
                    <div className="atlas-plant-check__history">
                      <b>Company findings</b>
                      <span className="atlas-network-findings">{savedNetworkNote}</span>
                    </div>
                  ) : null}
                  {summary ? <em>{summary}</em> : null}
                  {rowMessage ? <em>{rowMessage}</em> : null}
                </div>
              </div>

              <div className={`atlas-plant-check__actions${networkLog ? " has-two-actions" : ""}`}>
                {done && networkLog ? (
                  <>
                    <button type="button" aria-expanded={activeNetwork} disabled={Boolean(savingId)} onClick={() => activeNetwork ? setActiveNetworkLogId(null) : openNetworkLog(task)}>
                      {activeNetwork ? "Close notes" : "Edit company notes"}
                    </button>
                    <button type="button" disabled={Boolean(savingId)} onClick={() => void togglePlain(task, "open")}>{isSaving ? "Saving" : "Reopen"}</button>
                  </>
                ) : done ? (
                  <button type="button" disabled={Boolean(savingId)} onClick={() => void togglePlain(task, "open")}>{isSaving ? "Saving" : "Reopen"}</button>
                ) : plantingLog ? (
                  <button type="button" aria-expanded={active} disabled={Boolean(savingId)} onClick={() => active ? setActiveLogId(null) : openPlantingLog(task)}>
                    {active ? "Close planting log" : "Open planting log"}
                  </button>
                ) : networkLog ? (
                  <>
                    <button type="button" aria-expanded={activeNetwork} disabled={Boolean(savingId)} onClick={() => activeNetwork ? setActiveNetworkLogId(null) : openNetworkLog(task)}>
                      {activeNetwork ? "Close notes" : savedNetworkNote ? "Edit company notes" : "Add company notes"}
                    </button>
                    <button type="button" disabled={Boolean(savingId)} onClick={() => void togglePlain(task, "done")}>{isSaving ? "Saving" : "Mark done"}</button>
                  </>
                ) : (
                  <button type="button" disabled={Boolean(savingId)} onClick={() => void togglePlain(task, "done")}>{isSaving ? "Saving" : "Mark done"}</button>
                )}
              </div>

              {active ? (
                <form className="atlas-plant-check__form" onSubmit={(event) => { event.preventDefault(); void savePlantingLog(task); }}>
                  <label>
                    <span>Count</span>
                    <input name="plantedAmount" inputMode="numeric" type="number" min="0" step="1" value={form.amount} onChange={(event) => updateForm(task.task_id, { amount: event.target.value, message: null })} />
                  </label>
                  <label>
                    <span>Zone</span>
                    <select name="plantedZoneId" value={form.zoneId} disabled={registryLoading || Boolean(registryError)} onChange={(event) => updateForm(task.task_id, { zoneId: event.target.value, objectId: "", message: null })}>
                      <option value="">{registryLoading ? "Loading zones…" : "Choose zone"}</option>
                      {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                    </select>
                  </label>
                  {form.zoneId ? (
                    <label>
                      <span>Bed / area</span>
                      <select name="plantedObjectId" value={form.objectId} disabled={!objects.length} onChange={(event) => updateForm(task.task_id, { objectId: event.target.value, message: null })}>
                        <option value="">{objects.length ? "Choose bed / area" : "No registered beds in this zone"}</option>
                        {objects.map((object: AtlasRegistryObject) => <option key={object.id} value={object.id}>{object.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <div className="atlas-plant-check__form-actions">
                    <button type="submit" disabled={isSaving}>{isSaving ? "Saving" : "Save planted"}</button>
                    <button type="button" disabled={isSaving} onClick={() => setActiveLogId(null)}>Cancel</button>
                  </div>
                  <p aria-live="polite">{form.message ?? registryError ?? ""}</p>
                </form>
              ) : null}

              {activeNetwork ? (
                <form className="atlas-network-log-form" onSubmit={(event) => { event.preventDefault(); void saveNetworkLog(task); }}>
                  <label>
                    <span>Companies + findings</span>
                    <textarea
                      name="networkFindings"
                      value={networkDrafts[task.task_id] ?? ""}
                      placeholder={networkLogPrompt(task)}
                      onChange={(event) => {
                        setNetworkDrafts((current) => ({ ...current, [task.task_id]: event.target.value }));
                        setRowMessages((current) => ({ ...current, [task.task_id]: null }));
                      }}
                    />
                  </label>
                  <small>Use a new line for each company. Save while you research; marking the subtask done is separate.</small>
                  <div className="atlas-network-log-actions">
                    <button type="submit" disabled={isSaving}>{isSaving ? "Saving" : "Save company findings"}</button>
                    <button type="button" disabled={isSaving} onClick={() => setActiveNetworkLogId(null)}>Cancel</button>
                  </div>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
