"use client";

import React, { useState } from "react";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type {
  AtlasObjectInspection,
  AtlasRegistryObject,
  AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

const EMPTY = "not logged";

type ZoneLayoutFallback = {
  count?: number;
  widthFt?: number;
  lengthFt?: number;
  walkway?: string;
};

const ZONE_LAYOUT_FALLBACKS: Record<string, ZoneLayoutFallback> = {
  field_rows: { count: 18, widthFt: 3, lengthFt: 30, walkway: "3 ft grass walkways" },
  berry_walk_flower_rows: { count: 10, widthFt: 3, lengthFt: 22, walkway: "2 ft mulch walkways" },
  barn_beds: { count: 11, widthFt: 3, lengthFt: 18, walkway: "3 ft grass walkways" },
  u_pick: { walkway: "5 ft grass walkways" },
};

export function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return EMPTY;
  const date = new Date(`${dateIso}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyDateList(dates: string[]) {
  return dates.length > 0 ? dates.map((date) => prettyDate(date)).join(", ") : EMPTY;
}

function prettyRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return EMPTY;
  if (start && end && start !== end) return `${prettyDate(start)} to ${prettyDate(end)}`;
  return prettyDate(start ?? end);
}

function yesNo(value: boolean | null | undefined) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return EMPTY;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function stageLabel(stage: string | null | undefined) {
  return (stage ?? EMPTY).replaceAll("_", " ");
}

function cropLine(object: AtlasRegistryObject) {
  const inspection = object.inspection_summary;
  if (!inspection) return "No current crop logged";
  return `${inspection.crop_label} · ${stageLabel(inspection.stage)}`;
}

function inspectionRows(inspection: AtlasObjectInspection) {
  return [
    ["Seeded", prettyDate(inspection.seeded_date)],
    ["Variety", inspection.variety ?? EMPTY],
    ["Germinated", prettyDate(inspection.germinated_date)],
    ["Weeded", prettyDateList(inspection.weeded_dates)],
    ["Pinch", yesNo(inspection.pinch_required)],
    ["Bloom", inspection.bloom_date ? prettyDate(inspection.bloom_date) : EMPTY],
    [
      "Harvest",
      inspection.harvest_dates.length > 0
        ? prettyDateList(inspection.harvest_dates)
        : prettyRange(inspection.expected_harvest_watch_start, inspection.expected_harvest_watch_end),
    ],
    ["Clear bed", prettyDate(inspection.clear_bed_date)],
    ["Next crop", inspection.next_crop_planned ?? EMPTY],
  ];
}

export function zoneShortMode(zone: AtlasRegistryZone) {
  return (zone.mode_bias ?? zone.zone_type ?? "zone").replaceAll("_", " ");
}

function uniqueKnown(values: Array<number | null>) {
  return Array.from(new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))));
}

function zoneSpaceSummary(zone: AtlasRegistryZone) {
  const fallback = ZONE_LAYOUT_FALLBACKS[zone.stable_key] ?? {};
  const objectsWithDimensions = zone.objects.filter(
    (object) => typeof object.width_ft === "number" && typeof object.length_ft === "number",
  );

  const widthValues = uniqueKnown(zone.objects.map((object) => object.width_ft));
  const lengthValues = uniqueKnown(zone.objects.map((object) => object.length_ft));

  const count = objectsWithDimensions.length || fallback.count || zone.object_count;
  const widthFt = widthValues.length === 1 ? widthValues[0] : fallback.widthFt;
  const lengthFt = lengthValues.length === 1 ? lengthValues[0] : fallback.lengthFt;

  const totalSqFt = objectsWithDimensions.length > 0
    ? objectsWithDimensions.reduce((sum, object) => sum + (object.width_ft ?? 0) * (object.length_ft ?? 0), 0)
    : count && widthFt && lengthFt
      ? count * widthFt * lengthFt
      : null;

  const dimensionLine = widthFt && lengthFt
    ? `${count} ${count === 1 ? "space" : "beds"} · ${formatNumber(widthFt)} ft wide · ${formatNumber(lengthFt)} ft long`
    : `${zone.object_count} mapped ${zone.object_count === 1 ? "space" : "spaces"}`;

  const lines = [dimensionLine];
  if (fallback.walkway) lines.push(fallback.walkway);
  lines.push(totalSqFt ? `Total growing space: ${formatNumber(totalSqFt)} sq ft` : "Total growing space: not logged");

  return lines;
}

function taskLabel(count: number) {
  if (count === 0) return "No tasks attached";
  if (count === 1) return "1 task attached";
  return `${count} tasks attached`;
}

export function ZoneLandingCard({ zone }: { zone: AtlasRegistryZone }) {
  return (
    <article className="atlas-zone-landing-card">
      <div>
        <span>{zoneShortMode(zone)}</span>
        <strong>{zone.label}</strong>
      </div>
      <div className="atlas-zone-space-summary">
        {zoneSpaceSummary(zone).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </article>
  );
}

function BedTaskList({
  tasks,
  onTaskSelect,
}: {
  tasks: AtlasTaskCard[];
  onTaskSelect?: (task: AtlasTaskCard) => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="atlas-bed-task-list">
      <span className="atlas-soft-label">Attached tasks</span>
      {tasks.map((task) => (
        <button type="button" key={task.task_id} onClick={() => onTaskSelect?.(task)}>
          <strong>{task.title}</strong>
          <small>{prettyDate(task.due_date)} · {task.status.replaceAll("_", " ")}</small>
        </button>
      ))}
    </section>
  );
}

function InspectionSheet({
  object,
  tasks,
  onTaskSelect,
  onDocumentObject,
}: {
  object: AtlasRegistryObject;
  tasks: AtlasTaskCard[];
  onTaskSelect?: (task: AtlasTaskCard) => void;
  onDocumentObject?: (object: AtlasRegistryObject) => void;
}) {
  return (
    <div className="atlas-bed-inspection-sheet">
      {onDocumentObject ? (
        <button type="button" className="atlas-document-this-bed-button" onClick={() => onDocumentObject(object)}>
          Document work on this bed
        </button>
      ) : null}
      {object.contents.length === 0 ? <div className="atlas-inspection-empty">No current crop cycle logged.</div> : null}
      {object.contents.map((content) => (
        <section key={content.id} className="atlas-crop-cycle-sheet">
          {object.contents.length > 1 ? <div className="atlas-crop-cycle-title">{content.content_label}</div> : null}
          <dl className="atlas-inspection-list-sheet">
            {inspectionRows(content.inspection).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {content.inspection.note ? <p className="atlas-inspection-note">{content.inspection.note}</p> : null}
        </section>
      ))}
      <BedTaskList tasks={tasks} onTaskSelect={onTaskSelect} />
    </div>
  );
}

export function BedInspectorRow({
  object,
  tasks = [],
  onTaskSelect,
  onDocumentObject,
}: {
  object: AtlasRegistryObject;
  tasks?: AtlasTaskCard[];
  onTaskSelect?: (task: AtlasTaskCard) => void;
  onDocumentObject?: (object: AtlasRegistryObject) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const first = object.contents[0]?.inspection;

  return (
    <article className={`atlas-bed-row-card ${isOpen ? "open" : ""}`}>
      <button type="button" className="atlas-bed-row-button" onClick={() => setIsOpen((current) => !current)}>
        <div>
          <strong>{object.label}</strong>
          <span>{cropLine(object)}</span>
          <small>Seeded {prettyDate(object.inspection_summary?.seeded_date)} · Pinch {first ? yesNo(first.pinch_required) : EMPTY} · {taskLabel(tasks.length)}</small>
        </div>
        <em>{isOpen ? "close" : "open"}</em>
      </button>
      {isOpen ? <InspectionSheet object={object} tasks={tasks} onTaskSelect={onTaskSelect} onDocumentObject={onDocumentObject} /> : null}
    </article>
  );
}
