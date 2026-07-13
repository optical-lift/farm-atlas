"use client";

import { useRef, useState } from "react";

import {
  recordAtlasObjectEvent,
  type AtlasObjectCropCycle,
  type AtlasObjectEventType,
  type AtlasObjectPlantInstance,
} from "@/lib/atlas/object-workbench-client";

const ACTIONS = [
  { type: "observed", label: "Observe" },
  { type: "checked", label: "Check" },
  { type: "weeded", label: "Weed" },
  { type: "watered", label: "Water" },
  { type: "sowed", label: "Sow" },
  { type: "planted", label: "Plant" },
  { type: "germinated", label: "Germination" },
  { type: "pinched", label: "Pinch" },
  { type: "bloom_started", label: "Bloom" },
  { type: "harvested", label: "Harvest" },
  { type: "maintained", label: "Maintain" },
  { type: "cleared", label: "Clear" },
] satisfies ReadonlyArray<{ type: AtlasObjectEventType; label: string }>;

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function cropLabel(crop: AtlasObjectCropCycle) {
  if (!crop.variety || crop.crop_label.toLowerCase().includes(crop.variety.toLowerCase())) return crop.crop_label;
  return `${crop.variety} ${crop.crop_label}`;
}

function plantLabel(plant: AtlasObjectPlantInstance) {
  return plant.lineage?.lineage_name || plant.lineage?.common_name || plant.label;
}

export function ObjectQuickLog({
  objectKey,
  cropCycles,
  plantInstances,
  onSaved,
}: {
  objectKey: string;
  cropCycles: AtlasObjectCropCycle[];
  plantInstances: AtlasObjectPlantInstance[];
  onSaved: () => void | Promise<void>;
}) {
  const [eventType, setEventType] = useState<AtlasObjectEventType>("observed");
  const [eventDate, setEventDate] = useState(todayIso());
  const [target, setTarget] = useState("object");
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("stems");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<{ signature: string; key: string } | null>(null);

  const hasTargets = cropCycles.length > 0 || plantInstances.length > 0;
  const selectedIds = (() => {
    if (target.startsWith("crop:")) return { cropCycleId: target.slice(5) };
    if (target.startsWith("plant:")) return { plantInstanceId: target.slice(6) };
    return {};
  })();

  async function saveEvent() {
    const parsedQuantity = quantity.trim() ? Number(quantity) : undefined;
    const payload = {
      eventType,
      eventDate,
      note: note.trim() || undefined,
      quantity: eventType === "harvested" ? parsedQuantity : undefined,
      unit: eventType === "harvested" && parsedQuantity !== undefined ? unit.trim() || undefined : undefined,
      ...selectedIds,
    };
    const signature = JSON.stringify(payload);
    if (!retryRef.current || retryRef.current.signature !== signature) {
      retryRef.current = { signature, key: crypto.randomUUID() };
    }

    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      const result = await recordAtlasObjectEvent(objectKey, {
        ...payload,
        idempotencyKey: retryRef.current.key,
      });
      retryRef.current = null;
      setNote("");
      setQuantity("");
      setMessage(result.deduplicated ? "Already saved." : "Saved to this object.");
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Atlas could not save this event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="atlas-object-panel atlas-object-quick-log">
      <div className="atlas-object-section-head">
        <div>
          <span className="atlas-home-kicker">Quick Log</span>
          <h2>What happened?</h2>
        </div>
        <span>Atomic save</span>
      </div>

      <div className="atlas-object-action-grid" aria-label="Object event">
        {ACTIONS.map((action) => (
          <button
            key={action.type}
            type="button"
            className={eventType === action.type ? "selected" : ""}
            aria-pressed={eventType === action.type}
            onClick={() => setEventType(action.type)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="atlas-object-log-fields">
        <label>
          <span>Date</span>
          <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
        </label>

        {hasTargets ? (
          <label>
            <span>Apply to</span>
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="object">Whole object</option>
              {cropCycles.map((crop) => (
                <option key={crop.id} value={`crop:${crop.id}`}>{cropLabel(crop)}</option>
              ))}
              {plantInstances.map((plant) => (
                <option key={plant.id} value={`plant:${plant.id}`}>{plantLabel(plant)}</option>
              ))}
            </select>
          </label>
        ) : null}

        {eventType === "harvested" ? (
          <div className="atlas-object-quantity-row">
            <label>
              <span>Quantity</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              <span>Unit</span>
              <input value={unit} maxLength={40} onChange={(event) => setUnit(event.target.value)} />
            </label>
          </div>
        ) : null}

        <label>
          <span>Note</span>
          <textarea value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
        </label>
      </div>

      <button type="button" className="atlas-object-save" disabled={saving || !eventDate} onClick={() => void saveEvent()}>
        {saving ? "Saving…" : "Save"}
      </button>
      {message ? <p className="atlas-object-save-message success" role="status">{message}</p> : null}
      {error ? <p className="atlas-object-save-message error" role="alert">{error}</p> : null}
    </section>
  );
}
