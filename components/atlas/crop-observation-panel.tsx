"use client";

import { useMemo, useRef, useState } from "react";

import {
  recordAtlasCropObservation,
  type AtlasCropObservationKey,
  type AtlasObjectCropCycle,
} from "@/lib/atlas/object-workbench-client";

const OBSERVATIONS = [
  { key: "germinated", label: "Germinated" },
  { key: "established", label: "Established" },
  { key: "vegetative", label: "Growing" },
  { key: "budding", label: "Budding" },
  { key: "flowering", label: "Flowering" },
  { key: "fruit_set", label: "Fruit / pods set" },
  { key: "first_harvest", label: "First harvest" },
  { key: "peak_harvest", label: "Peak harvest" },
  { key: "slowing", label: "Slowing down" },
  { key: "finished", label: "Finished" },
  { key: "not_ready", label: "Not ready" },
  { key: "changed_plan", label: "Plan changed" },
] satisfies ReadonlyArray<{ key: AtlasCropObservationKey; label: string }>;

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function cropLabel(crop: AtlasObjectCropCycle) {
  if (!crop.variety || crop.crop_label.toLowerCase().includes(crop.variety.toLowerCase())) return crop.crop_label;
  return `${crop.variety} ${crop.crop_label}`;
}

export function CropObservationPanel({
  objectKey,
  cropCycles,
  onSaved,
}: {
  objectKey: string;
  cropCycles: AtlasObjectCropCycle[];
  onSaved: () => void | Promise<void>;
}) {
  const [cropCycleId, setCropCycleId] = useState(cropCycles[0]?.id ?? "");
  const [observationKey, setObservationKey] = useState<AtlasCropObservationKey>("vegetative");
  const [eventDate, setEventDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<{ signature: string; key: string } | null>(null);

  const selectedCrop = useMemo(
    () => cropCycles.find((crop) => crop.id === cropCycleId) ?? cropCycles[0] ?? null,
    [cropCycles, cropCycleId],
  );

  if (cropCycles.length === 0) return null;

  async function saveObservation() {
    if (!selectedCrop) return;
    const payload = {
      cropCycleId: selectedCrop.id,
      observationKey,
      eventDate,
      note: note.trim() || undefined,
    };
    const signature = JSON.stringify(payload);
    if (!retryRef.current || retryRef.current.signature !== signature) {
      retryRef.current = { signature, key: crypto.randomUUID() };
    }

    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      await recordAtlasCropObservation(objectKey, {
        ...payload,
        idempotencyKey: retryRef.current.key,
      });
      retryRef.current = null;
      setNote("");
      setMessage(`${cropLabel(selectedCrop)} updated.`);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Atlas could not save this crop observation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="atlas-object-panel atlas-crop-observation-panel">
      <div className="atlas-object-section-head">
        <div>
          <span className="atlas-home-kicker">Field update</span>
          <h2>What changed with a crop?</h2>
        </div>
        <span>Updates timeline</span>
      </div>

      <label className="atlas-crop-observation-crop">
        <span>Crop</span>
        <select value={selectedCrop?.id ?? ""} onChange={(event) => setCropCycleId(event.target.value)}>
          {cropCycles.map((crop) => (
            <option key={crop.id} value={crop.id}>{cropLabel(crop)}</option>
          ))}
        </select>
      </label>

      <div className="atlas-crop-observation-grid" aria-label="Crop observation">
        {OBSERVATIONS.map((observation) => (
          <button
            key={observation.key}
            type="button"
            className={observationKey === observation.key ? "selected" : ""}
            aria-pressed={observationKey === observation.key}
            onClick={() => setObservationKey(observation.key)}
          >
            {observation.label}
          </button>
        ))}
      </div>

      <div className="atlas-crop-observation-fields">
        <label>
          <span>Date</span>
          <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
        </label>
        <label>
          <span>Note</span>
          <textarea
            value={note}
            maxLength={4000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional field detail"
          />
        </label>
      </div>

      <button
        type="button"
        className="atlas-object-save"
        disabled={saving || !eventDate || !selectedCrop}
        onClick={() => void saveObservation()}
      >
        {saving ? "Updating…" : "Update crop"}
      </button>
      {message ? <p className="atlas-object-save-message success" role="status">{message}</p> : null}
      {error ? <p className="atlas-object-save-message error" role="alert">{error}</p> : null}
    </section>
  );
}
