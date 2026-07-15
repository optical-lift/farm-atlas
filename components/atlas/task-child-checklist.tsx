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

function label(task: AtlasTaskCard) {
  return text(meta(task, "checklist_label")) || text(meta(task, "display_subject")) || task.title.replace(/^Checklist\s+—\s+/i, "");
}

function detailLines(task: AtlasTaskCard) {
  return stringList(meta(task, "detail_lines"));
}

function sourceSowingSummary(task: AtlasTaskCard) {
  const sourceId = text(meta(task, "source_sowing_task_id"));
  if (!sourceId) return "";

  const sourceTitle = text(meta(task, "source_sowing_title")) || "Linked sowing record";
  const sourceStatus = text(meta(task, "source_sowing_status"));
  return `Original sowing · ${sourceTitle}${sourceStatus ? ` · ${sourceStatus}` : ""}`;
}

function isDone(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done" || text(meta(task, "checklist_status")) === "done";
}

function needsPlantingLog(task: AtlasTaskCard) {
  return boolish(meta(task, "planting_log_required"));
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
  const [forms, setForms] = useState<Record<string, PlantLogForm>>({});
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
    setActiveLogId(task.task_id);
    setRowMessages((current) => ({ ...current, [task.task_id]: null }));
    setForms((current) => ({ ...current, [task.task_id]: initial }));
  }

  async function togglePlain(task: AtlasTaskCard, checklistStatus: "open" | "done") {
    try {
      setSavingId(task.task_id);
      setRowMessages((current) => ({ ...current, [task.task_id]: null }));
      await postChildToggle(task.task_id, checklistStatus);
      setActiveLogId(null);
      await onChange();
    } catch (error) {
      setRowMessages((current) => ({ ...current, [task.task_id]: error instanceof Error ? error.message : "Checklist failed." }));
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
        @media (max-width: 430px) {
          .atlas-plant-check__item.is-simple .atlas-plant-check__content { padding-right: 12px !important; }
        }
      `}</style>
      <h3>Checklist</h3>
      <div className="atlas-plant-check__list">
        {childTasks.map((task) => {
          const done = isDone(task);
          const interactive = needsPlantingLog(task);
          const active = activeLogId === task.task_id;
          const form = formFor(task);
          const selectedZone = zoneById(zones, form.zoneId);
          const objects = visibleObjects(selectedZone);
          const rowMessage = rowMessages[task.task_id];
          const isSaving = savingId === task.task_id;
          const summary = logSummary(task);
          const sourceSowing = sourceSowingSummary(task);

          return (
            <article
              key={task.task_id}
              className={`atlas-plant-check__item${interactive ? " has-inline-action" : " is-simple"}${done ? " is-done" : ""}${isSaving ? " is-saving" : ""}`}
              data-child-task-id={task.task_id}
              data-checklist-action={interactive ? "inline-form" : "simple"}
            >
              <div className="atlas-plant-check__content">
                <span className="atlas-plant-check__mark">{done ? "✓" : ""}</span>
                <div className="atlas-plant-check__copy">
                  <strong>{label(task)}</strong>
                  {sourceSowing ? <em>{sourceSowing}</em> : null}
                  {detailLines(task).map((line) => <span key={line}>{line}</span>)}
                  {summary ? <em>{summary}</em> : null}
                  {rowMessage ? <em>{rowMessage}</em> : null}
                </div>
              </div>

              <div className="atlas-plant-check__actions">
                {done ? (
                  <button type="button" disabled={Boolean(savingId)} onClick={() => void togglePlain(task, "open")}>{isSaving ? "Saving" : "Reopen"}</button>
                ) : interactive ? (
                  <button type="button" aria-expanded={active} disabled={Boolean(savingId)} onClick={() => active ? setActiveLogId(null) : openPlantingLog(task)}>
                    {active ? "Close planting log" : "Open planting log"}
                  </button>
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
            </article>
          );
        })}
      </div>
    </section>
  );
}
