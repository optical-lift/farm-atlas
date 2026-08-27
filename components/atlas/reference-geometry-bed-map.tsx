"use client";

import { useState, type FormEvent } from "react";

import { recordAtlasObservedCropPresence } from "@/lib/atlas/bed-crop-presence-client";
import type { AtlasBedMap } from "@/lib/atlas/weed-card-contract";
import styles from "./reference-geometry-bed-map.module.css";

type ReferenceOrientation = {
  north?: string | null;
  south?: string | null;
  viewpoint?: string | null;
};

type ReferenceSource = {
  kind?: string | null;
  repository?: string | null;
  path?: string | null;
  blob_sha?: string | null;
  owner_visual_confirmation_date?: string | null;
};

type ReferenceGeometry = {
  kind?: "polygon" | "path" | string | null;
  coordinate_space?: string | null;
  view_box?: [number, number, number, number] | number[] | null;
  points?: Array<[number, number]> | null;
  path_d?: string | null;
  precision?: string | null;
  orientation?: ReferenceOrientation | null;
  source?: ReferenceSource | null;
};

type PhysicalModel = {
  kind?: string | null;
  units?: string | null;
  [key: string]: unknown;
};

type GovernedObjectGeometry = {
  schema?: string | null;
  reference?: ReferenceGeometry | null;
  physical_model?: PhysicalModel | null;
};

type GovernedBedMap = AtlasBedMap & {
  areaSqft?: number | null;
  geometry?: GovernedObjectGeometry | null;
  referenceGeometry?: ReferenceGeometry | null;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function governedMap(map: AtlasBedMap): GovernedBedMap {
  return map as GovernedBedMap;
}

function referenceGeometry(map: AtlasBedMap) {
  const governed = governedMap(map);
  if (governed.geometry?.schema === "atlas_object_geometry_v1" && governed.geometry.reference) {
    return governed.geometry.reference;
  }
  return governed.referenceGeometry ?? null;
}

function isRenderableReference(reference: ReferenceGeometry | null | undefined) {
  if (!reference) return false;
  if (reference.kind === "polygon") return Array.isArray(reference.points) && reference.points.length >= 3;
  if (reference.kind === "path") return typeof reference.path_d === "string" && reference.path_d.trim().length > 0;
  return false;
}

export function hasGovernedReferenceGeometry(map: AtlasBedMap) {
  const governed = governedMap(map);
  if (governed.geometry?.schema !== "atlas_object_geometry_v1") return false;
  return isRenderableReference(governed.geometry.reference);
}

function numberLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function boundsFromPoints(points: Array<[number, number]>): Bounds | null {
  if (points.length < 2) return null;
  const xs = points.map(([x]) => x).filter(Number.isFinite);
  const ys = points.map(([, y]) => y).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function boundsFromSimplePath(pathD: string): Bounds | null {
  // The governed Berry Walk reference paths currently use only M/C/Z SVG
  // commands. Restrict automatic cropping to that known grammar; future path
  // grammars fall back to their source viewBox rather than guessing bounds.
  const commands = pathD.match(/[A-Za-z]/g) ?? [];
  if (commands.some((command) => !["M", "C", "Z", "m", "c", "z"].includes(command))) return null;
  const values = (pathD.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 4 || values.length % 2 !== 0) return null;
  const points: Array<[number, number]> = [];
  for (let index = 0; index < values.length; index += 2) points.push([values[index], values[index + 1]]);
  return boundsFromPoints(points);
}

function paddedViewBox(bounds: Bounds) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const padding = Math.max(spanX, spanY) * 0.09;
  return `${bounds.minX - padding} ${bounds.minY - padding} ${spanX + padding * 2} ${spanY + padding * 2}`;
}

function sourceViewBox(reference: ReferenceGeometry) {
  const box = reference.view_box;
  if (!Array.isArray(box) || box.length !== 4 || box.some((value) => typeof value !== "number" || !Number.isFinite(value))) return "0 0 100 100";
  return box.join(" ");
}

function displayViewBox(reference: ReferenceGeometry) {
  if (reference.kind === "polygon" && reference.points) {
    const bounds = boundsFromPoints(reference.points);
    if (bounds) return paddedViewBox(bounds);
  }
  if (reference.kind === "path" && reference.path_d) {
    const bounds = boundsFromSimplePath(reference.path_d);
    if (bounds) return paddedViewBox(bounds);
  }
  return sourceViewBox(reference);
}

function referenceCenter(reference: ReferenceGeometry) {
  if (reference.kind === "polygon" && reference.points?.length) {
    const bounds = boundsFromPoints(reference.points);
    if (bounds) return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  }
  if (reference.kind === "path" && reference.path_d) {
    const bounds = boundsFromSimplePath(reference.path_d);
    if (bounds) return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  }
  const box = reference.view_box;
  if (Array.isArray(box) && box.length === 4) return { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 };
  return { x: 50, y: 50 };
}

function InlineCropAdder({ map, onAdded }: { map: AtlasBedMap; onAdded: (label: string) => void }) {
  const [cropLabel, setCropLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = cropLabel.trim();
    if (!label || saving) return;
    try {
      setSaving(true);
      setMessage(null);
      const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await recordAtlasObservedCropPresence({
        objectKey: map.objectKey,
        cropLabel: label,
        observedDate: todayIso(),
        idempotencyKey: `bed-crop:${map.objectKey}:${nonce}`,
      });
      onAdded(result.cropLabel);
      setCropLabel("");
      setMessage(`${result.cropLabel} added`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not add this crop.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.addCrop} onSubmit={(event) => void submit(event)} data-atlas-inline-crop-entry="true">
      <input value={cropLabel} disabled={saving} onChange={(event) => { setCropLabel(event.target.value); setMessage(null); }} placeholder="+ Add crop…" aria-label={`Add crop observed in ${map.objectLabel}`} maxLength={120} />
      {cropLabel.trim() ? <button type="submit" disabled={saving}>{saving ? "Adding…" : "Add"}</button> : null}
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

export default function ReferenceGeometryBedMap({ map }: { map: AtlasBedMap }) {
  const governed = governedMap(map);
  const reference = referenceGeometry(map);
  const [addedLabels, setAddedLabels] = useState<string[]>([]);
  if (!isRenderableReference(reference)) return null;

  const cropLabels = Array.from(new Set([...map.placements.map((placement) => placement.displayLabel), ...addedLabels]));
  const center = referenceCenter(reference!);
  const polygonPoints = reference!.points?.map(([x, y]) => `${x},${y}`).join(" ") ?? "";
  const pathIsClosed = reference!.kind === "path" && /z\s*$/i.test(reference!.path_d ?? "");
  const northUp = reference!.orientation?.north === "top";
  const areaLabel = governed.areaSqft != null ? `~${numberLabel(governed.areaSqft)} sq ft working area` : null;
  const physicalKind = governed.geometry?.physical_model?.kind ?? null;

  return (
    <section className={styles.root} data-atlas-reference-bed-map="atlas-object-geometry-v1" aria-label={`Governed reference-shape crop map for ${map.objectLabel}.`}>
      <div className={styles.canvas}>
        <svg viewBox={displayViewBox(reference!)} role="img" aria-label={`${map.objectLabel} physical reference shape`} preserveAspectRatio="xMidYMid meet">
          {reference!.kind === "polygon" ? <polygon points={polygonPoints} className={styles.areaShape} /> : null}
          {reference!.kind === "path" ? <path d={reference!.path_d ?? ""} className={pathIsClosed ? styles.areaShape : styles.pathShape} /> : null}
          <text x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle" className={styles.objectLabel}>{map.objectLabel}</text>
          {northUp ? <g className={styles.northMarker} aria-hidden="true"><text x="96%" y="10%" textAnchor="end">N ↑</text></g> : null}
        </svg>
      </div>

      <div className={styles.shapeFacts}>
        <span>{reference!.kind === "polygon" ? "Bed shape" : physicalKind === "archimedean_spiral_corridor" ? "Spiral path" : "Growing shape"}</span>
        <strong>{map.objectLabel}</strong>
        <small>{[areaLabel, reference!.precision === "reference_not_surveyed" ? "reference outline · not surveyed from drawing" : null].filter(Boolean).join(" · ")}</small>
      </div>

      <div className={styles.crops}>
        <span>Active crops</span>
        <div className={styles.cropChips}>
          {cropLabels.length ? cropLabels.map((label) => <b key={label}>{label}</b>) : <em>No crop recorded</em>}
        </div>
        <small>Crop occupancy is real; exact positions inside this irregular shape are not yet mapped.</small>
        <InlineCropAdder map={map} onAdded={(label) => setAddedLabels((current) => current.includes(label) ? current : [...current, label])} />
      </div>
    </section>
  );
}
