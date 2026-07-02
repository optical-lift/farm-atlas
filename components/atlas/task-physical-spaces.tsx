import Link from "next/link";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasRegistryObject, AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

type Match = {
  zone: AtlasRegistryZone;
  object: AtlasRegistryObject;
};

function feet(value: number | null | undefined) {
  return typeof value === "number" ? `${value} ft` : null;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return null;
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function readableStatus(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : null;
}

function dimensionLine(object: AtlasRegistryObject) {
  const width = feet(object.width_ft);
  const length = feet(object.length_ft);
  if (width && length) return `${width} × ${length}`;
  return width ?? length;
}

function cropLine(object: AtlasRegistryObject) {
  const content = object.contents[0];
  if (!content) return null;

  return [content.content_label, content.variety, readableStatus(content.status)]
    .filter(Boolean)
    .join(" · ");
}

function cropName(object: AtlasRegistryObject) {
  return object.contents[0]?.content_label ?? null;
}

function timelineLines(object: AtlasRegistryObject) {
  const inspection = object.contents[0]?.inspection;
  if (!inspection) return [];

  const lines = [
    inspection.seeded_date ? `Sown ${dateLabel(inspection.seeded_date)}` : null,
    inspection.germinated_date ? `Germinated ${dateLabel(inspection.germinated_date)}` : null,
    inspection.expected_germination_start || inspection.expected_germination_end
      ? `Germination ${dateLabel(inspection.expected_germination_start) ?? ""}${inspection.expected_germination_end ? `–${dateLabel(inspection.expected_germination_end)}` : ""}`
      : null,
    inspection.pinch_required === true ? "Pinch" : inspection.pinch_required === false ? "No pinch" : null,
    inspection.bloom_date ? `Bloom ${dateLabel(inspection.bloom_date)}` : null,
    inspection.clear_bed_date ? `Clear ${dateLabel(inspection.clear_bed_date)}` : null,
    inspection.next_crop_planned ? `Next ${inspection.next_crop_planned}` : null,
  ];

  return lines.filter(Boolean) as string[];
}

export function taskObjectMatches(task: AtlasTaskCard, zones: AtlasRegistryZone[]) {
  const matches: Match[] = [];

  task.objects.forEach((taskObject) => {
    for (const zone of zones) {
      const object = zone.objects.find((candidate) => candidate.id === taskObject.object_id);
      if (object) {
        matches.push({ zone, object });
        return;
      }
    }
  });

  return matches;
}

export function taskObjectTitle(task: AtlasTaskCard, zones: AtlasRegistryZone[]) {
  const matches = taskObjectMatches(task, zones);

  if (matches.length === 1) return matches[0].object.label;
  if (matches.length > 1) {
    const zoneIds = new Set(matches.map((match) => match.zone.id));
    if (zoneIds.size === 1) {
      if (matches.length <= 3) return matches.map((match) => match.object.label).join(" · ");
      return `${matches[0].zone.label} · ${matches.length}`;
    }
    return task.title;
  }

  return task.zone_label ?? task.title;
}

export function taskObjectDetailLine(task: AtlasTaskCard, zones: AtlasRegistryZone[]) {
  const matches = taskObjectMatches(task, zones);

  if (matches.length > 1) {
    const crops = Array.from(new Set(matches.map((match) => cropName(match.object)).filter(Boolean))) as string[];
    if (crops.length > 0) return crops.slice(0, 3).join(" · ");
    return Array.from(new Set(matches.map((match) => match.zone.label))).join(" · ");
  }

  const primaryObject = matches[0]?.object;
  const crop = primaryObject ? cropLine(primaryObject) : null;

  if (crop) return crop;
  return task.zone_label ?? null;
}

export function TaskPhysicalSpaces({ task, zones }: { task: AtlasTaskCard; zones: AtlasRegistryZone[] }) {
  const matches = taskObjectMatches(task, zones);

  if (matches.length === 0) return null;

  return (
    <section className="atlas-task-space-list atlas-object-stack">
      {matches.map(({ zone, object }) => {
        const dimensions = dimensionLine(object);
        const crop = cropLine(object);
        const timeline = timelineLines(object);

        return (
          <article className="atlas-task-space-card atlas-object-card" key={object.id}>
            <div>
              <strong>{object.label}</strong>
              <span>{zone.label}</span>
            </div>
            {dimensions ? <p>{dimensions}</p> : null}
            {crop ? <p>{crop}</p> : null}
            {timeline.map((line) => <p key={line}>{line}</p>)}
            <Link href={`/zones/${zone.stable_key}`}>{zone.label}</Link>
          </article>
        );
      })}
    </section>
  );
}
