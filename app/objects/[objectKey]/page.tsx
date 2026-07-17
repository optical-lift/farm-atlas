"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CropObservationPanel } from "@/components/atlas/crop-observation-panel";
import { ObjectQuickLog } from "@/components/atlas/object-quick-log";
import {
  fetchAtlasObjectWorkbench,
  type AtlasObjectCropCycle,
  type AtlasObjectPlantInstance,
  type AtlasObjectTimelineEvent,
  type AtlasObjectWorkbenchObject,
  type AtlasOperationalTimeline,
  type AtlasOperationalTimelineItem,
} from "@/lib/atlas/object-workbench-client";

const EVENT_LABELS: Record<string, string> = {
  observed: "Observed",
  checked: "Checked",
  weeded: "Weeded",
  watered: "Watered",
  sowed: "Sowed",
  planted: "Planted",
  germinated: "Germination",
  pinched: "Pinched",
  bloom_started: "Bloom started",
  harvested: "Harvested",
  maintained: "Maintained",
  cleared: "Cleared",
  blocked: "Blocked",
};

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function shortDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyState(value: string | null | undefined) {
  if (!value || ["unknown", "not_logged", "not logged"].includes(value.toLowerCase())) return null;
  return value.replaceAll("_", " ");
}

function numberText(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(numeric);
}

function objectSize(object: AtlasObjectWorkbenchObject) {
  const width = numberText(object.width_ft);
  const length = numberText(object.length_ft);
  const area = numberText(object.area_sqft);
  if (width && length) return `${width} × ${length} ft${area ? ` · ${area} sq ft` : ""}`;
  if (area) return `${area} sq ft`;
  return object.object_type.replaceAll("_", " ");
}

function cropName(crop: AtlasObjectCropCycle) {
  if (!crop.variety || crop.crop_label.toLowerCase().includes(crop.variety.toLowerCase())) return crop.crop_label;
  return `${crop.variety} ${crop.crop_label}`;
}

function plantTitle(plant: AtlasObjectPlantInstance) {
  return plant.lineage?.lineage_name || plant.lineage?.common_name || plant.label;
}

function stateChips(object: AtlasObjectWorkbenchObject) {
  return [
    prettyState(object.life_status),
    prettyState(object.weed_pressure) ? `weeds: ${prettyState(object.weed_pressure)}` : null,
    prettyState(object.water_status) ? `water: ${prettyState(object.water_status)}` : null,
    prettyState(object.presentability) ? `presentation: ${prettyState(object.presentability)}` : null,
    object.decision_required ? "decision needed" : null,
  ].filter((value): value is string => Boolean(value));
}

function timelineDate(item: AtlasOperationalTimelineItem) {
  const start = shortDate(item.startDate);
  const end = shortDate(item.endDate);
  if (start && end && start !== end) return `${start}–${end}`;
  return start ?? end ?? "Current";
}

function OperationalTimelineItem({ item }: { item: AtlasOperationalTimelineItem }) {
  const blocker = typeof item.metadata?.blocker_text === "string" ? item.metadata.blocker_text : null;
  return (
    <article className={`atlas-operational-item state-${item.state}`}>
      <div className="atlas-operational-date">{timelineDate(item)}</div>
      <div className="atlas-operational-copy">
        <span>{item.action}</span>
        <strong>{item.subject}</strong>
        {item.detail ? <p>{item.detail}</p> : null}
        {blocker ? <p className="atlas-operational-blocker">Waiting: {blocker}</p> : null}
      </div>
    </article>
  );
}

function OperationalTimelineSection({
  label,
  items,
}: {
  label: "Now" | "Next" | "Later";
  items: AtlasOperationalTimelineItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className={`atlas-operational-group atlas-operational-${label.toLowerCase()}`}>
      <h3>{label}</h3>
      <div className="atlas-operational-list">
        {items.map((item, index) => (
          <OperationalTimelineItem
            key={`${item.kind}-${item.taskId ?? item.eventId ?? item.cropCycleId ?? index}-${item.startDate ?? "current"}`}
            item={item}
          />
        ))}
      </div>
    </section>
  );
}

function TimelineCard({ event }: { event: AtlasObjectTimelineEvent }) {
  const quantity = numberText(event.quantity);
  return (
    <article className="atlas-object-event-card">
      <div>
        <strong>{EVENT_LABELS[event.event_type] ?? event.event_type.replaceAll("_", " ")}</strong>
        <time dateTime={event.event_date}>{prettyDate(event.event_date)}</time>
      </div>
      {event.entity_label ? <span>{event.entity_label}</span> : null}
      {quantity ? <span>{quantity}{event.unit ? ` ${event.unit}` : ""}</span> : null}
      {event.note ? <p>{event.note}</p> : null}
    </article>
  );
}

export default function AtlasObjectPage() {
  const params = useParams<{ objectKey: string }>();
  const objectKey = params.objectKey;
  const [object, setObject] = useState<AtlasObjectWorkbenchObject | null>(null);
  const [cropCycles, setCropCycles] = useState<AtlasObjectCropCycle[]>([]);
  const [plantInstances, setPlantInstances] = useState<AtlasObjectPlantInstance[]>([]);
  const [events, setEvents] = useState<AtlasObjectTimelineEvent[]>([]);
  const [operationalTimeline, setOperationalTimeline] = useState<AtlasOperationalTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadObject = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      const workbench = await fetchAtlasObjectWorkbench(objectKey);
      setObject(workbench.object);
      setCropCycles(workbench.cropCycles);
      setPlantInstances(workbench.plantInstances);
      setEvents(workbench.events);
      setOperationalTimeline(workbench.operationalTimeline);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Atlas could not load this object.");
    } finally {
      setLoading(false);
    }
  }, [objectKey]);

  useEffect(() => {
    void loadObject();
  }, [loadObject]);

  const chips = object ? stateChips(object) : [];
  const timelineCount = operationalTimeline
    ? operationalTimeline.now.length + operationalTimeline.next.length + operationalTimeline.later.length
    : 0;

  return (
    <main className="atlas-phone-shell atlas-route-shell">
      <section className="atlas-phone atlas-object-page-phone">
        <header className="atlas-phone-top atlas-route-top">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Object</span>
          </div>
          {object?.zone_key ? (
            <Link className="atlas-soft-badge atlas-link-badge" href={`/zones/${object.zone_key}`}>
              {object.zone_label ?? "Zone"}
            </Link>
          ) : <Link className="atlas-soft-badge atlas-link-badge" href="/zones">Zones</Link>}
        </header>

        <div className="atlas-object-body">
          {loading ? <div className="atlas-route-loading">Loading object…</div> : null}
          {error ? <div className="atlas-route-error">{error}</div> : null}

          {object ? (
            <>
              <section className="atlas-object-hero">
                <span className="atlas-home-kicker">{object.object_type.replaceAll("_", " ")}</span>
                <h1>{object.object_label}</h1>
                <p>{objectSize(object)}</p>
                {chips.length > 0 ? (
                  <div className="atlas-object-state-chips">
                    {chips.map((chip) => <span key={chip}>{chip}</span>)}
                  </div>
                ) : null}
                <div className="atlas-object-touch-grid">
                  {object.last_weeded_at ? <span>Weeded <strong>{prettyDate(object.last_weeded_at)}</strong></span> : null}
                  {object.last_watered_at ? <span>Watered <strong>{prettyDate(object.last_watered_at)}</strong></span> : null}
                  {object.last_checked_at ? <span>Checked <strong>{prettyDate(object.last_checked_at)}</strong></span> : null}
                </div>
              </section>

              <section className="atlas-object-panel atlas-object-contents">
                <div className="atlas-object-section-head">
                  <div>
                    <span className="atlas-home-kicker">Current</span>
                    <h2>What’s here</h2>
                  </div>
                  <span>{cropCycles.length + plantInstances.length}</span>
                </div>

                {cropCycles.map((crop) => (
                  <article key={crop.id} className="atlas-object-occupant-card crop">
                    <span>Crop cycle</span>
                    <h3>{cropName(crop)}</h3>
                    <p>{crop.cycle_state.replaceAll("_", " ")}</p>
                    <dl>
                      {crop.sown_date ? <div><dt>Sown</dt><dd>{prettyDate(crop.sown_date)}</dd></div> : null}
                      {crop.planted_date ? <div><dt>Planted</dt><dd>{prettyDate(crop.planted_date)}</dd></div> : null}
                      {crop.expected_harvest_watch_start ? <div><dt>Harvest watch</dt><dd>{prettyDate(crop.expected_harvest_watch_start)}</dd></div> : null}
                    </dl>
                    {crop.note ? <p>{crop.note}</p> : null}
                  </article>
                ))}

                {plantInstances.map((plant) => (
                  <article key={plant.id} className="atlas-object-occupant-card plant">
                    <span>Permanent plant</span>
                    <h3>{plantTitle(plant)}</h3>
                    <p>{plant.status.replaceAll("_", " ")}</p>
                    <dl>
                      {plant.quantity ? <div><dt>Quantity</dt><dd>{numberText(plant.quantity)}{plant.unit ? ` ${plant.unit}` : ""}</dd></div> : null}
                      {plant.planted_date ? <div><dt>Planted</dt><dd>{prettyDate(plant.planted_date)}</dd></div> : null}
                      {plant.lineage?.source_name ? <div><dt>Source</dt><dd>{plant.lineage.source_name}</dd></div> : null}
                    </dl>
                    {plant.lineage?.propagation_goal ? <p>{plant.lineage.propagation_goal}</p> : null}
                  </article>
                ))}

                {cropCycles.length === 0 && plantInstances.length === 0 ? (
                  <p className="atlas-object-empty">No current crop cycle or permanent plant is attached.</p>
                ) : null}
              </section>

              <section className="atlas-object-panel atlas-operational-panel">
                <div className="atlas-object-section-head">
                  <div>
                    <span className="atlas-home-kicker">Working timeline</span>
                    <h2>What happens next</h2>
                  </div>
                  <span>{timelineCount}</span>
                </div>
                {operationalTimeline ? (
                  <div className="atlas-operational-groups">
                    <OperationalTimelineSection label="Now" items={operationalTimeline.now} />
                    <OperationalTimelineSection label="Next" items={operationalTimeline.next} />
                    <OperationalTimelineSection label="Later" items={operationalTimeline.later} />
                  </div>
                ) : (
                  <p className="atlas-object-empty">No operational timeline is available yet.</p>
                )}
              </section>

              <CropObservationPanel
                objectKey={object.object_key}
                cropCycles={cropCycles}
                onSaved={() => loadObject(false)}
              />

              <ObjectQuickLog
                objectKey={object.object_key}
                cropCycles={cropCycles}
                plantInstances={plantInstances}
                onSaved={() => loadObject(false)}
              />

              <section className="atlas-object-panel atlas-object-timeline">
                <div className="atlas-object-section-head">
                  <div><span className="atlas-home-kicker">History</span><h2>Object timeline</h2></div>
                  <span>{events.length}</span>
                </div>
                {events.map((event) => <TimelineCard key={event.event_id} event={event} />)}
                {events.length === 0 ? <p className="atlas-object-empty">No events have been recorded for this object yet.</p> : null}
              </section>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
