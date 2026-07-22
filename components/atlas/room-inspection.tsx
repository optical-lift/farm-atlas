"use client";

import Link from "next/link";
import { useState } from "react";

import { prettyDate, zoneShortMode } from "@/components/atlas/zone-inspection";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasRegistryObject, AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readable(value: string | null | undefined) {
  return (value ?? "not assessed").replaceAll("_", " ");
}

function openTaskCount(tasks: AtlasTaskCard[]) {
  return tasks.filter((task) => task.status === "open" || task.status === "blocked").length;
}

export function VenueZoneLandingCard({ zone }: { zone: AtlasRegistryZone }) {
  const roomCount = zone.objects.filter((object) => object.object_type === "room").length;
  const readiness = metadataString(zone.metadata, "rental_readiness") ?? zone.current_state;

  return (
    <article className="atlas-zone-landing-card atlas-venue-zone-landing-card">
      <div>
        <span>{zoneShortMode(zone)}</span>
        <strong>{zone.label}</strong>
      </div>
      <div className="atlas-zone-space-summary">
        <p>{roomCount} rentable rooms</p>
        <p>Guest-facing indoor operations</p>
        <div className="atlas-room-registry-summary">
          <span>Rental readiness</span>
          <p>{readable(readiness)}</p>
        </div>
      </div>
    </article>
  );
}

export function RoomInspectorRow({
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
  const readiness = metadataString(object.metadata, "rental_readiness") ?? "work_in_progress";
  const bookingReady = object.metadata?.booking_ready === true;
  const openCount = openTaskCount(tasks);

  return (
    <article className={`atlas-bed-row-card room-object ${isOpen ? "open" : ""}`}>
      <button type="button" className="atlas-bed-row-button" onClick={() => setIsOpen((current) => !current)}>
        <div>
          <strong>{object.label}</strong>
          <span>Rentable room · {readable(readiness)}</span>
          <small>{openCount} open {openCount === 1 ? "task" : "tasks"} · {bookingReady ? "booking ready" : "not booking ready"} · guest visible</small>
        </div>
        <em>{isOpen ? "close" : "open"}</em>
      </button>

      {isOpen ? (
        <div className="atlas-bed-inspection-sheet">
          {onDocumentObject ? (
            <Link className="atlas-object-open-link" href={`/objects/${object.stable_key}`} onClick={() => onDocumentObject(object)}>
              Open room and log work
            </Link>
          ) : null}

          <div className="atlas-room-registry-summary">
            <span>Room state</span>
            <p>Rental readiness: {readable(readiness)}</p>
            <p>Booking ready: {bookingReady ? "yes" : "no"}</p>
            <p>Active work: {openCount}</p>
          </div>

          {tasks.length ? (
            <section className="atlas-bed-task-list">
              <span className="atlas-soft-label">Work inside this room</span>
              {tasks.map((task) => (
                <button type="button" key={task.task_id} onClick={() => onTaskSelect?.(task)}>
                  <strong>{task.title}</strong>
                  <small>{prettyDate(task.due_date)} · {task.status.replaceAll("_", " ")}</small>
                </button>
              ))}
            </section>
          ) : <div className="atlas-inspection-empty">No active work is attached to this room.</div>}
        </div>
      ) : null}
    </article>
  );
}
