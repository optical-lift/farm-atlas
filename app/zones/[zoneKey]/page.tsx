"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { TaskPhysicalSpaces } from "@/components/atlas/task-physical-spaces";
import { DocumentWorkCard, FieldLogDrawer, type AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";
import {
  BedInspectorRow,
  prettyDate,
  stageLabel,
  zoneShortMode,
} from "@/components/atlas/zone-inspection";
import {
  fetchAtlasTaskCards,
  type AtlasTaskCard,
} from "@/lib/atlas/task-cards-client";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

function statusLabel(status: string) {
  if (status === "done") return "Done";
  if (status === "blocked") return "Blocked";
  if (status === "skipped") return "Skipped";
  return "Open";
}

function objectTasks(object: AtlasRegistryObject, tasks: AtlasTaskCard[]) {
  return tasks.filter((task) => task.objects.some((taskObject) => taskObject.object_id === object.id));
}

function workKeyFromTask(task: AtlasTaskCard): AtlasFieldLogSeed["workKey"] {
  const text = `${task.task_type} ${task.title}`.toLowerCase();
  if (text.includes("weed")) return "weed";
  if (text.includes("plant") || text.includes("transplant")) return "plant";
  if (text.includes("sow") || text.includes("seed")) return "sow";
  if (text.includes("water")) return "water";
  if (text.includes("harvest") || text.includes("cut")) return "harvest";
  if (text.includes("mow") || text.includes("build") || text.includes("prep") || text.includes("maint")) return "maintain";
  if (text.includes("check") || text.includes("germin") || text.includes("confirm")) return "check";
  return "observe";
}

export default function AtlasZoneDetailPage() {
  const params = useParams<{ zoneKey: string }>();
  const zoneKey = params.zoneKey;

  const [zones, setZones] = useState<AtlasRegistryZone[]>([]);
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<AtlasTaskCard | null>(null);
  const [logSeed, setLogSeed] = useState<AtlasFieldLogSeed | null>(null);

  async function loadZoneData() {
    try {
      setLoading(true);
      setError(null);
      const [zoneResponse, taskResponse] = await Promise.all([
        fetchAtlasZoneRegistry(),
        fetchAtlasTaskCards(),
      ]);
      setZones(zoneResponse.zones ?? []);
      setTasks((taskResponse.taskCards ?? []).filter((task) => task.status !== "archived"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Atlas could not load this zone.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadZoneData();
  }, []);

  const zone = useMemo(
    () => zones.find((candidate) => candidate.stable_key === zoneKey) ?? null,
    [zones, zoneKey],
  );

  const nextZone = useMemo(() => {
    if (!zone || zones.length === 0) return null;
    const index = zones.findIndex((candidate) => candidate.id === zone.id);
    return zones[(index + 1) % zones.length] ?? null;
  }, [zone, zones]);

  const zoneTasks = useMemo(() => {
    if (!zone) return [];
    const objectIds = new Set(zone.objects.map((object) => object.id));
    return tasks.filter((task) => task.objects.some((object) => objectIds.has(object.object_id)));
  }, [tasks, zone]);

  function openZoneLog(workKey: AtlasFieldLogSeed["workKey"] = "observe") {
    if (!zone) return;
    setLogSeed({ workKey, zoneKeys: [zone.stable_key], objectKeys: [] });
  }

  function openObjectLog(object: AtlasRegistryObject, workKey: AtlasFieldLogSeed["workKey"] = "observe") {
    if (!zone) return;
    setLogSeed({ workKey, zoneKeys: [zone.stable_key], objectKeys: [object.stable_key] });
  }

  return (
    <main className="atlas-phone-shell atlas-route-shell">
      <section className="atlas-phone atlas-zone-page-phone">
        <header className="atlas-phone-top atlas-route-top">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Zone Inspector</span>
          </div>

          <Link className="atlas-soft-badge atlas-link-badge" href="/zones">
            Zones
          </Link>
        </header>

        <div className="atlas-zone-detail-body">
          {loading ? <div className="atlas-route-loading">Loading zone...</div> : null}
          {error ? <div className="atlas-route-error">{error}</div> : null}

          {!loading && !zone ? (
            <section className="atlas-zone-detail-hero">
              <span className="atlas-home-kicker">Missing zone</span>
              <h1>Atlas could not find this zone.</h1>
              <p>Go back to the zone landing pad and choose a current farm zone.</p>
            </section>
          ) : null}

          {zone ? (
            <>
              <section className="atlas-zone-detail-hero compact">
                <div>
                  <span className="atlas-home-kicker">{zoneShortMode(zone)}</span>
                  <h1>{zone.label}</h1>
                  <p>{zone.goal_text ?? "Inspect the place in front of you."}</p>
                </div>

                <div className="atlas-zone-detail-metrics two-only">
                  <span>{zone.active_object_count} active</span>
                  <span>{zone.object_count} total</span>
                  <span>{zoneTasks.length} {zoneTasks.length === 1 ? "task" : "tasks"}</span>
                </div>
              </section>

              <DocumentWorkCard
                title="Document work here"
                detail={`Write what was touched in ${zone.label}.`}
                onOpen={() => openZoneLog()}
              />

              <section className="atlas-zone-bed-list">
                <div className="atlas-zone-bed-list-head">
                  <span className="atlas-home-kicker">Beds / objects</span>
                  <p>Tap one bed to open its crop record and attached tasks.</p>
                </div>

                {zone.objects.length === 0 ? (
                  <div className="atlas-inspection-empty">No beds or objects have been logged here yet.</div>
                ) : null}

                {zone.objects.map((object) => (
                  <BedInspectorRow
                    key={object.id}
                    object={object}
                    tasks={objectTasks(object, tasks)}
                    onTaskSelect={(task) => {
                      setSelectedTask(task);
                      const taskObject = task.objects.find((candidate) => candidate.object_id === object.id);
                      if (taskObject) openObjectLog(object, workKeyFromTask(task));
                    }}
                    onDocumentObject={openObjectLog}
                  />
                ))}
              </section>

              <nav className="atlas-zone-detail-footer" aria-label="Zone navigation">
                <Link href="/zones">All zones</Link>
                {nextZone ? <Link href={`/zones/${nextZone.stable_key}`}>Next: {nextZone.label}</Link> : null}
                <span>{stageLabel(zone.mode_bias)}</span>
              </nav>
            </>
          ) : null}
        </div>
      </section>

      {selectedTask ? (
        <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
          <div className="atlas-task-focus-phone">
            <div className="atlas-task-focus-topbar">
              <div>
                <span className="atlas-phone-kicker">Task</span>
                <strong>{selectedTask.zone_label ?? "Atlas"}</strong>
              </div>

              <button type="button" onClick={() => setSelectedTask(null)}>
                Close
              </button>
            </div>

            <div className="atlas-task-focus-body">
              <section className="atlas-task-focus-purple">
                <div className="atlas-task-focus-kicker">
                  <span>{statusLabel(selectedTask.status)}</span>
                  <span>{selectedTask.priority}</span>
                  <span>{prettyDate(selectedTask.due_date)}</span>
                </div>
                <h2>{selectedTask.title}</h2>
                {selectedTask.unlock_text ? <p>{selectedTask.unlock_text}</p> : null}
              </section>

              <TaskPhysicalSpaces task={selectedTask} zones={zones} />

              {selectedTask.note ? (
                <section className="atlas-task-focus-section">
                  <span className="atlas-soft-label">Instructions / data</span>
                  <p>{selectedTask.note}</p>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {logSeed ? (
        <FieldLogDrawer
          zones={zones}
          seed={logSeed}
          onClose={() => setLogSeed(null)}
          onSaved={loadZoneData}
        />
      ) : null}
    </main>
  );
}
