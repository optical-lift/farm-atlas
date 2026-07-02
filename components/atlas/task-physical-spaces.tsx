import Link from "next/link";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasRegistryObject, AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

type Match = {
  zone: AtlasRegistryZone;
  object: AtlasRegistryObject;
};

function feet(value: number | null | undefined) {
  return typeof value === "number" ? `${value} ft` : "not logged";
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "not logged";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cropLine(object: AtlasRegistryObject) {
  const content = object.contents[0];
  if (!content) return "No crop cycle logged.";
  return `${content.content_label} · ${content.status.replaceAll("_", " ")}`;
}

function timelineLine(object: AtlasRegistryObject) {
  const inspection = object.contents[0]?.inspection;
  if (!inspection) return "Seeded not logged · pinch not logged";
  const pinch = inspection.pinch_required === true ? "yes" : inspection.pinch_required === false ? "no" : "not logged";
  return `Seeded ${dateLabel(inspection.seeded_date)} · pinch ${pinch}`;
}

function matchesForTask(task: AtlasTaskCard, zones: AtlasRegistryZone[]) {
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

export function TaskPhysicalSpaces({ task, zones }: { task: AtlasTaskCard; zones: AtlasRegistryZone[] }) {
  const matches = matchesForTask(task, zones);

  if (matches.length === 0) {
    return (
      <section className="atlas-task-focus-section">
        <span className="atlas-soft-label">Physical space</span>
        <p className="atlas-task-space-empty">No specific bed or object is tagged yet.</p>
      </section>
    );
  }

  return (
    <section className="atlas-task-focus-section">
      <span className="atlas-soft-label">Physical space</span>
      <div className="atlas-task-space-list">
        {matches.map(({ zone, object }) => (
          <article className="atlas-task-space-card" key={object.id}>
            <div>
              <span>{zone.label}</span>
              <strong>{object.label}</strong>
            </div>
            <p>{feet(object.width_ft)} wide · {feet(object.length_ft)} long</p>
            <p>{cropLine(object)}</p>
            <p>{timelineLine(object)}</p>
            <Link href={`/zones/${zone.stable_key}`}>Open zone registry</Link>
          </article>
        ))}
      </div>
    </section>
  );
}
