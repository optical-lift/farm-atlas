"use client";

import Link from "next/link";
import React, { useState } from "react";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type {
  AtlasObjectContent,
  AtlasObjectInspection,
  AtlasRegistryMetadata,
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

function numericValue(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function formatNumber(value: number | string | null | undefined) {
  const numeric = numericValue(value);
  if (numeric === null) return EMPTY;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(numeric);
}

function metadataNumber(metadata: AtlasRegistryMetadata | null | undefined, key: string) {
  return numericValue(metadata?.[key] as number | string | null | undefined);
}

function metadataString(metadata: AtlasRegistryMetadata | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataNumberRange(metadata: AtlasRegistryMetadata | null | undefined, key: string) {
  const value = metadata?.[key];
  if (!Array.isArray(value)) return null;
  const range = value.map((item) => numericValue(item as number | string | null | undefined)).filter((item): item is number => item !== null);
  return range.length >= 2 ? [range[0], range[1]] as const : null;
}

function formatNumberRange(range: readonly [number, number] | null, suffix = "") {
  if (!range) return EMPTY;
  return `${formatNumber(range[0])}–${formatNumber(range[1])}${suffix}`;
}

export function stageLabel(stage: string | null | undefined) {
  return (stage ?? EMPTY).replaceAll("_", " ");
}

function contentIsCropCycle(content: AtlasObjectContent | null | undefined) {
  return content?.content_type === "crop_cycle";
}

function cropDisplayName(content: Pick<AtlasObjectContent, "content_label" | "variety"> | AtlasObjectInspection) {
  const label = "content_label" in content ? content.content_label : content.crop_label;
  const variety = content.variety;
  if (!variety) return label;
  const lower = label.toLowerCase();
  return lower.includes(variety.toLowerCase()) ? label : `${variety} ${label}`;
}

function primaryContent(object: AtlasRegistryObject) {
  return object.contents.find(contentIsCropCycle) ?? object.contents[0] ?? null;
}

function cropLine(object: AtlasRegistryObject) {
  const content = primaryContent(object);
  if (!content) return "No current crop logged";
  const inspection = content.inspection;
  const seeded = inspection.seeded_date ? ` · sown ${prettyDate(inspection.seeded_date)}` : "";
  return `${cropDisplayName(content)} · ${stageLabel(inspection.stage)}${seeded}`;
}

function inspectionRows(content: AtlasObjectContent) {
  const inspection = content.inspection;

  if (contentIsCropCycle(content)) {
    return [
      ["Cycle", "Current crop cycle"],
      ["State", stageLabel(inspection.stage)],
      ["Sown", prettyDate(inspection.seeded_date)],
      ["Variety", inspection.variety ?? EMPTY],
      ["Start method", inspection.start_method ? stageLabel(inspection.start_method) : EMPTY],
      ["Germination", inspection.germinated_date ? prettyDate(inspection.germinated_date) : prettyRange(inspection.expected_germination_start, inspection.expected_germination_end)],
      ["Harvest watch", inspection.harvest_dates.length > 0 ? prettyDateList(inspection.harvest_dates) : prettyRange(inspection.expected_harvest_watch_start, inspection.expected_harvest_watch_end)],
      ["Clear marker", prettyDate(inspection.clear_bed_date)],
      ["Next crop", inspection.next_crop_planned ?? EMPTY],
    ];
  }

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

function uniqueKnown(values: Array<number | string | null>) {
  return Array.from(new Set(values.map(numericValue).filter((value): value is number => value !== null)));
}

function objectIsGrowingSpace(object: AtlasRegistryObject) {
  if (object.object_type === "path" || object.object_type === "corridor") return false;
  if (object.metadata?.is_growing_space === false) return false;
  return true;
}

function objectAreaSummary(object: AtlasRegistryObject) {
  const areaSqFt = numericValue(object.area_sqft);
  if (areaSqFt) return `${formatNumber(areaSqFt)} sq ft`;

  const widthFt = numericValue(object.width_ft);
  const lengthFt = numericValue(object.length_ft);
  if (widthFt && lengthFt) return `${formatNumber(widthFt)} × ${formatNumber(lengthFt)} ft`;

  return object.object_type.replaceAll("_", " ");
}

function currentCropCycleContents(zone: AtlasRegistryZone) {
  return zone.objects.flatMap((object) => object.contents.filter(contentIsCropCycle));
}

function currentCropCycleLines(zone: AtlasRegistryZone) {
  const cycles = currentCropCycleContents(zone);
  if (cycles.length === 0) return [];

  const counts = new Map<string, { count: number; state: string }>();
  cycles.forEach((content) => {
    const label = cropDisplayName(content);
    const state = stageLabel(content.status);
    const current = counts.get(label) ?? { count: 0, state };
    current.count += 1;
    counts.set(label, current);
  });

  const summary = `${cycles.length} active crop ${cycles.length === 1 ? "cycle" : "cycles"}`;
  const cropLines = Array.from(counts.entries())
    .slice(0, 3)
    .map(([label, value]) => `${value.count} ${label} · ${value.state}`);

  return [summary, ...cropLines];
}

function zoneSpaceSummary(zone: AtlasRegistryZone) {
  const fallback = ZONE_LAYOUT_FALLBACKS[zone.stable_key] ?? {};
  const metadata = zone.metadata ?? {};
  const objectsWithDimensions = zone.objects.filter(
    (object) => numericValue(object.width_ft) !== null && numericValue(object.length_ft) !== null,
  );

  const widthValues = uniqueKnown(zone.objects.map((object) => object.width_ft));
  const lengthValues = uniqueKnown(zone.objects.map((object) => object.length_ft));
  const bedCount = metadataNumber(metadata, "bed_count");
  const workingBedArea = metadataNumber(metadata, "bed_area_sqft_working_estimate");
  const totalGrowingFromMetadata = metadataNumber(metadata, "total_growing_bed_area_sqft_estimate");
  const totalGrowingFromObjects = zone.objects.reduce((sum, object) => {
    if (!objectIsGrowingSpace(object)) return sum;
    return sum + (numericValue(object.area_sqft) ?? 0);
  }, 0);

  if (zone.stable_key === "main_garden" && totalGrowingFromMetadata) {
    const count = bedCount ?? 8;
    const bedLine = workingBedArea
      ? `${count} clock beds · ${formatNumber(workingBedArea)} sq ft working estimate each`
      : `${count} clock beds`;
    const centerRange = metadataNumberRange(metadata, "center_diamond_area_sqft_range");
    const lines = [bedLine];
    if (centerRange) lines.push(`Center diamond: ${formatNumberRange(centerRange, " sq ft")} non-growing`);
    lines.push(`Total growing bed area: ${formatNumber(totalGrowingFromMetadata)} sq ft`);
    return lines;
  }

  const count = objectsWithDimensions.length || fallback.count || zone.object_count;
  const widthFt = widthValues.length === 1 ? widthValues[0] : fallback.widthFt;
  const lengthFt = lengthValues.length === 1 ? lengthValues[0] : fallback.lengthFt;

  const totalSqFt = totalGrowingFromMetadata
    ?? (totalGrowingFromObjects > 0 ? totalGrowingFromObjects : null)
    ?? (objectsWithDimensions.length > 0
      ? objectsWithDimensions.reduce(
          (sum, object) => sum + (numericValue(object.width_ft) ?? 0) * (numericValue(object.length_ft) ?? 0),
          0,
        )
      : count && widthFt && lengthFt
        ? count * widthFt * lengthFt
        : null);

  const dimensionLine = widthFt && lengthFt
    ? `${count} ${count === 1 ? "space" : "beds"} · ${formatNumber(widthFt)} ft wide · ${formatNumber(lengthFt)} ft long`
    : `${zone.object_count} mapped ${zone.object_count === 1 ? "space" : "spaces"}`;

  const lines = [dimensionLine];
  if (fallback.walkway) lines.push(fallback.walkway);
  lines.push(totalSqFt ? `Total growing space: ${formatNumber(totalSqFt)} sq ft` : "Total growing space: not logged");

  return lines;
}

function zoneFactRows(zone: AtlasRegistryZone) {
  const metadata = zone.metadata ?? {};
  const bedCount = metadataNumber(metadata, "bed_count");
  const workingBedArea = metadataNumber(metadata, "bed_area_sqft_working_estimate");
  const bedAreaRange = metadataNumberRange(metadata, "bed_area_sqft_range");
  const totalGrowing = metadataNumber(metadata, "total_growing_bed_area_sqft_estimate");
  const centerAreaRange = metadataNumberRange(metadata, "center_diamond_area_sqft_range");
  const centerPointRange = metadataNumberRange(metadata, "center_diamond_point_to_point_ft_range");
  const orientation = metadataString(metadata, "orientation_note");
  const cropCycles = currentCropCycleContents(zone);

  const rows: Array<[string, string]> = [];
  if (bedCount || workingBedArea) rows.push(["Growing beds", `${bedCount ? `${formatNumber(bedCount)} beds` : "Beds"}${workingBedArea ? ` · ${formatNumber(workingBedArea)} sq ft each` : ""}`]);
  if (cropCycles.length) rows.push(["Current crop cycles", `${cropCycles.length} active`]);
  if (bedAreaRange) rows.push(["Bed range", formatNumberRange(bedAreaRange, " sq ft")]);
  if (totalGrowing) rows.push(["Growing bed total", `${formatNumber(totalGrowing)} sq ft`]);
  if (centerAreaRange || centerPointRange) {
    rows.push([
      "Center diamond",
      [
        centerAreaRange ? `${formatNumberRange(centerAreaRange, " sq ft")}` : null,
        centerPointRange ? `${formatNumberRange(centerPointRange, " ft")} point-to-point` : null,
      ].filter(Boolean).join(" · "),
    ]);
  }
  if (orientation) rows.push(["Orientation", orientation]);

  return rows;
}

export function ZoneRegistryFactCard({ zone }: { zone: AtlasRegistryZone }) {
  const rows = zoneFactRows(zone);
  if (rows.length === 0) return null;

  return (
    <section className="atlas-zone-registry-facts">
      <span className="atlas-home-kicker">Registry truth</span>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function taskLabel(count: number) {
  if (count === 0) return "No tasks attached";
  if (count === 1) return "1 task attached";
  return `${count} tasks attached`;
}

export function ZoneLandingCard({ zone }: { zone: AtlasRegistryZone }) {
  const cropLines = currentCropCycleLines(zone);

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
        {cropLines.length ? (
          <div className="atlas-zone-current-crop-summary">
            <span>Current crop</span>
            {cropLines.map((line) => <p key={line}>{line}</p>)}
          </div>
        ) : null}
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

function ObjectRegistryFactLine({ object }: { object: AtlasRegistryObject }) {
  const clockPosition = metadataString(object.metadata, "clock_position");
  const orientation = metadataString(object.metadata, "orientation_note");
  const activeCropLabel = metadataString(object.metadata, "active_crop_label");
  const activeCropVariety = metadataString(object.metadata, "active_crop_variety");
  const activeCropSownDate = metadataString(object.metadata, "active_crop_sown_date");
  const activeHarvestStart = metadataString(object.metadata, "expected_harvest_watch_start");
  const areaRange = metadataNumberRange(object.metadata, "bed_area_sqft_range") ?? metadataNumberRange(object.metadata, "area_sqft_range");
  const cropName = activeCropLabel ? [activeCropVariety, activeCropLabel].filter(Boolean).join(" ") : null;
  const parts = [
    object.object_type.replaceAll("_", " "),
    objectAreaSummary(object),
    clockPosition ? `${clockPosition} position` : null,
    areaRange ? `${formatNumberRange(areaRange, " sq ft range")}` : null,
    object.guest_visible ? "guest visible" : null,
  ].filter(Boolean);

  return (
    <p className="atlas-object-registry-line">
      {parts.join(" · ")}
      {orientation ? <><br />{orientation}</> : null}
      {cropName ? <><br />Current crop: {cropName} · sown {prettyDate(activeCropSownDate)} · harvest watch {prettyDate(activeHarvestStart)}</> : null}
    </p>
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
        <Link className="atlas-object-open-link" href={`/objects/${object.stable_key}`}>
          Open object and log work
        </Link>
      ) : null}
      <ObjectRegistryFactLine object={object} />
      {object.contents.length === 0 ? <div className="atlas-inspection-empty">No current crop cycle logged.</div> : null}
      {object.contents.map((content) => (
        <section key={content.id} className={`atlas-crop-cycle-sheet ${contentIsCropCycle(content) ? "current-crop-cycle" : ""}`}>
          <div className="atlas-crop-cycle-title">
            {contentIsCropCycle(content) ? "Current crop cycle" : object.contents.length > 1 ? content.content_label : "Crop record"}
            {contentIsCropCycle(content) ? <span>{cropDisplayName(content)}</span> : null}
          </div>
          <dl className="atlas-inspection-list-sheet">
            {inspectionRows(content).map(([label, value]) => (
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
  const firstContent = primaryContent(object);
  const first = firstContent?.inspection;
  const harvestWatch = first?.expected_harvest_watch_start ? ` · harvest ${prettyDate(first.expected_harvest_watch_start)}` : "";

  return (
    <article className={`atlas-bed-row-card ${isOpen ? "open" : ""}`}>
      <button type="button" className="atlas-bed-row-button" onClick={() => setIsOpen((current) => !current)}>
        <div>
          <strong>{object.label}</strong>
          <span>{cropLine(object)}</span>
          <small>{objectAreaSummary(object)} · Sown {prettyDate(object.inspection_summary?.seeded_date)}{harvestWatch} · Pinch {first ? yesNo(first.pinch_required) : EMPTY} · {taskLabel(tasks.length)}</small>
        </div>
        <em>{isOpen ? "close" : "open"}</em>
      </button>
      {isOpen ? <InspectionSheet object={object} tasks={tasks} onTaskSelect={onTaskSelect} onDocumentObject={onDocumentObject} /> : null}
    </article>
  );
}
