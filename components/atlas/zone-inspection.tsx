"use client";

import React, { useState } from "react";

import type {
  AtlasObjectInspection,
  AtlasRegistryObject,
  AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

const EMPTY = "not logged";

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

export function ZoneLandingCard({ zone }: { zone: AtlasRegistryZone }) {
  return (
    <article className="atlas-zone-landing-card">
      <div>
        <span>{zoneShortMode(zone)}</span>
        <strong>{zone.label}</strong>
      </div>
      <p>{zone.active_object_count} active · {zone.object_count} total</p>
    </article>
  );
}

function InspectionSheet({ object }: { object: AtlasRegistryObject }) {
  return (
    <div className="atlas-bed-inspection-sheet">
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
    </div>
  );
}

export function BedInspectorRow({ object }: { object: AtlasRegistryObject }) {
  const [isOpen, setIsOpen] = useState(false);
  const first = object.contents[0]?.inspection;

  return (
    <article className={`atlas-bed-row-card ${isOpen ? "open" : ""}`}>
      <button type="button" className="atlas-bed-row-button" onClick={() => setIsOpen((current) => !current)}>
        <div>
          <strong>{object.label}</strong>
          <span>{cropLine(object)}</span>
          <small>Seeded {prettyDate(object.inspection_summary?.seeded_date)} · Pinch {first ? yesNo(first.pinch_required) : EMPTY}</small>
        </div>
        <em>{isOpen ? "close" : "open"}</em>
      </button>
      {isOpen ? <InspectionSheet object={object} /> : null}
    </article>
  );
}
