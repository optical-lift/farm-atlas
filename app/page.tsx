"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasCloseout,
  saveAtlasCloseout,
  type AtlasCloseoutPeriod,
  type AtlasCloseoutRecord,
  type AtlasCloseoutSummary,
} from "@/lib/atlas/closeout-client";
import { createAtlasFieldLog } from "@/lib/atlas/field-log-client";
import {
  fetchAtlasFarmSnapshot,
  type AtlasFarmSnapshot,
} from "@/lib/atlas/farm-snapshot-client";
import { fetchAtlasProjects, type AtlasProjectCard } from "@/lib/atlas/projects-client";
import {
  fetchAtlasTodayRhythm,
  type AtlasRhythmBlock,
  type AtlasWorkKey,
} from "@/lib/atlas/rhythm-client";
import {
  fetchAtlasTaskCards,
  type AtlasTaskCard,
  type AtlasTaskCardObject,
} from "@/lib/atlas/task-cards-client";
import { saveAtlasInboxItem } from "@/lib/atlas/inbox-client";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

type HomePanel = "tasks" | "calendar" | "inbox" | "projects" | null;
type TaskUnit = { id: string; card: AtlasTaskCard; object: AtlasTaskCardObject | null; registryObject: AtlasRegistryObject | null; zone: AtlasRegistryZone | null };
type CloseoutCardRecord = AtlasCloseoutRecord & { sourceLine?: string };
type WeatherResponse = { ok: boolean; label?: string; rainAge?: string; daysSinceRain?: number | null; error?: string };
type LogSeed = { workKey: AtlasWorkKey; zoneKeys: string[]; objectKeys: string[] };
type WorkConfig = { key: AtlasWorkKey; label: string; actionTypes: string[]; defaultZoneKeys: string[]; shortZones: string };

type CalendarEntry = { date: string; title: string; dayKind: string; items: string[] };

const calendarEntries: CalendarEntry[] = [
  { date: "2026-07-04", dayKind: "Succession / check", title: "Check field germination", items: ["CHECK: Field Rows germination", "CHECK: Barn Beds Teddy status"] },
  { date: "2026-07-06", dayKind: "Start / transplant", title: "Field Rows check", items: ["PLANT: FR7 dahlias", "WALK: Field Rows contents"] },
  { date: "2026-07-07", dayKind: "Seed day", title: "Spring florist trays", items: ["SEED: 7 snap trays", "SEED: BW feverfew / Sweet William / foxglove"] },
  { date: "2026-07-08", dayKind: "Harvest / pinch", title: "Pinch and first cuts", items: ["PINCH: zinnia / basil / celosia", "CHECK: FR7 dahlias", "CUT: bee balm, yarrow, Echinacea"] },
  { date: "2026-07-11", dayKind: "Succession", title: "Teddy succession", items: ["SOW: Teddy succession", "CHECK: u-pick sunflowers"] },
  { date: "2026-07-13", dayKind: "Transplant / weed", title: "Field Rows + perennial plant-out", items: ["CHECK: FR7 dahlias", "WEED: Field Rows", "CUT: watch"] },
  { date: "2026-07-18", dayKind: "Succession", title: "Teddy + U-Pick check", items: ["SOW: Teddy succession", "CHECK: u-pick beds"] },
  { date: "2026-07-24", dayKind: "Harvest", title: "Weekend bouquets", items: ["CUT: weekend bouquets", "SOCIAL MEDIA: bouquet count"] },
];

const workConfigs: WorkConfig[] = [
  { key: "weed", label: "Weed", actionTypes: ["weeded"], defaultZoneKeys: ["field_rows", "berry_walk_flower_rows"], shortZones: "Field Rows · Berry Walk" },
  { key: "germinate", label: "Germinate", actionTypes: ["checked"], defaultZoneKeys: ["field_rows", "barn_beds", "berry_walk_flower_rows"], shortZones: "Field Rows · Barn Beds · Berry Walk" },
  { key: "harvest", label: "Harvest", actionTypes: ["harvested"], defaultZoneKeys: ["field_rows", "main_garden"], shortZones: "Field Rows · Main Garden" },
  { key: "venue", label: "Venue", actionTypes: ["maintained"], defaultZoneKeys: ["main_garden", "entry_billboard"], shortZones: "Tea Courtyard · Entry" },
  { key: "sowPlant", label: "Sow / Plant", actionTypes: ["sowed", "planted"], defaultZoneKeys: ["field_rows", "berry_walk_flower_rows", "barn_beds"], shortZones: "Field Rows · Berry Walk" },
  { key: "water", label: "Water", actionTypes: ["watered"], defaultZoneKeys: ["main_garden", "grow_room"], shortZones: "Main Garden · Grow Room" },
  { key: "move", label: "Move", actionTypes: ["moved"], defaultZoneKeys: ["whole_farm"], shortZones: "Whole farm" },
  { key: "observe", label: "Observe", actionTypes: ["observed"], defaultZoneKeys: ["whole_farm"], shortZones: "Whole farm" },
];

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const todayIso = () => new Date().toISOString().slice(0, 10);
const workConfig = (key: AtlasWorkKey) => workConfigs.find((work) => work.key === key) ?? workConfigs[0];
const defaultSnapshot: AtlasFarmSnapshot = { totalBeds: 0, growingBeds: 0, activeSqft: 0, sowingsLogged: 0, stemsLogged: 0 };

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  const date = dateIso.includes("-") ? new Date(`${dateIso}T12:00:00`) : new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cleanLabel(value: string | null | undefined) {
  return (value ?? "").replace(/truth/gi, "state").replace(/\bAnna\b/g, "crew").replace(/\bLex\b/g, "crew");
}

function currentEntry(today: string) {
  return calendarEntries.find((entry) => entry.date === today) ?? calendarEntries.find((entry) => entry.date > today) ?? calendarEntries[calendarEntries.length - 1];
}

function taskSortValue(card: AtlasTaskCard) {
  return `${card.due_date ?? "9999-12-31"}-${priorityRank[card.priority] ?? 9}-${card.title}`;
}

function registryForObject(objectId: string | null | undefined, zones: AtlasRegistryZone[]) {
  if (!objectId) return { zone: null, object: null };
  for (const zone of zones) {
    const object = zone.objects.find((candidate) => candidate.id === objectId);
    if (object) return { zone, object };
  }
  return { zone: null, object: null };
}

function cropLine(unit: TaskUnit | null) {
  if (!unit) return "";
  const content = unit.registryObject?.contents[0];
  return cleanLabel(content?.content_label ?? content?.variety ?? unit.card.title);
}

function compactSpot(label: string | null | undefined) {
  const value = label ?? "";
  const berry = value.match(/Berry Walk Bed\s*(\d+)/i);
  if (berry) return `BW${berry[1]}`;
  const barn = value.match(/Barn Bed\s*(\d+)/i);
  if (barn) return `BB${barn[1]}`;
  const field = value.match(/Field Row\s*(\d+)/i);
  if (field) return `FR${field[1]}`;
  return value;
}

function captureKind(card: AtlasTaskCard) {
  const text = `${card.task_type} ${card.title}`.toLowerCase();
  if (text.includes("germin")) return "germination";
  if (text.includes("weed")) return "weed";
  if (text.includes("harvest") || text.includes("cut")) return "harvest";
  if (text.includes("sow") || text.includes("seed") || text.includes("plant")) return "sow";
  if (text.includes("venue")) return "venue";
  if (text.includes("audit") || text.includes("walk") || text.includes("state") || text.includes("truth") || text.includes("confirm")) return "bed_audit";
  return "generic";
}

function workFromUnit(unit: TaskUnit | null): AtlasWorkKey {
  if (!unit) return "germinate";
  const kind = captureKind(unit.card);
  if (kind === "germination" || kind === "bed_audit") return "germinate";
  if (kind === "weed") return "weed";
  if (kind === "harvest") return "harvest";
  if (kind === "sow") return "sowPlant";
  if (kind === "venue") return "venue";
  return "observe";
}

function locationLine(unit: TaskUnit | null) {
  if (!unit) return "";
  return [unit.object?.object_label, unit.zone?.label ?? unit.card.zone_label].filter(Boolean).map(cleanLabel).join(" · ");
}

function completedObjectIds(card: AtlasTaskCard) {
  const captureMap = card.metadata?.capture_by_object ?? {};
  return new Set(
    Object.entries(captureMap)
      .filter(([, value]) => Boolean((value as { completed_at?: unknown }).completed_at))
      .map(([id]) => id),
  );
}

function taskUnits(cards: AtlasTaskCard[], zones: AtlasRegistryZone[]) {
  const units: TaskUnit[] = [];
  cards.forEach((card) => {
    const completed = completedObjectIds(card);
    if (card.objects.length === 0) {
      units.push({ id: `${card.task_id}:task`, card, object: null, registryObject: null, zone: null });
      return;
    }
    card.objects.forEach((object) => {
      if (completed.has(object.object_id)) return;
      const match = registryForObject(object.object_id, zones);
      units.push({ id: `${card.task_id}:${object.object_id}`, card, object, registryObject: match.object, zone: match.zone });
    });
  });
  return units;
}

function labelsForZoneKeys(zones: AtlasRegistryZone[], keys: string[]) {
  const labels = keys.map((key) => zones.find((zone) => zone.stable_key === key)?.label).filter(Boolean) as string[];
  return labels.length > 0 ? labels : keys;
}

function labelsForObjectKeys(zones: AtlasRegistryZone[], keys: string[]) {
  const objects = zones.flatMap((zone) => zone.objects);
  return keys.map((key) => objects.find((object) => object.stable_key === key)?.label).filter(Boolean) as string[];
}

function objectKeysFromUnits(units: TaskUnit[]) {
  return Array.from(new Set(units.map((unit) => unit.registryObject?.stable_key).filter(Boolean) as string[]));
}

function zoneKeysFromUnits(units: TaskUnit[]) {
  return Array.from(new Set(units.map((unit) => unit.zone?.stable_key).filter(Boolean) as string[]));
}

function extractTemp(label: string) {
  const match = label.match(/(-?\d+)°/);
  return match ? Number(match[1]) : null;
}

function extractRainAge(label: string) {
  const parts = label.split("·").map((part) => part.trim()).filter(Boolean);
  return parts[2] ?? parts[1] ?? "rain age";
}

function countPhrase(count: number, singular: string, plural = `${singular}s`) {
  return count === 0 ? null : `${count} ${count === 1 ? singular : plural}`;
}

function recordKind(record: CloseoutCardRecord) {
  const text = [record.kind, record.action, record.status, record.sourceLine].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("germin") || text.includes("check")) return "Checked";
  if (text.includes("sow") || text.includes("sown") || text.includes("seed")) return "Sown";
  if (text.includes("harvest") || text.includes("cut")) return "Harvest";
  return record.action || "Record";
}

function zoneForRecord(record: CloseoutCardRecord) {
  const text = [record.zone, record.label, record.spot, record.sourceLine].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("berry") || text.includes("bw")) return "Berry Walk";
  if (text.includes("barn") || text.includes("bb")) return "Barn Beds";
  if (text.includes("field") || text.includes("fr") || text.includes("zinnia block") || text.includes("sunflower block")) return "Field Rows";
  return record.zone ?? "Elm Farm";
}

function parseRecordLine(line: string, index: number): CloseoutCardRecord {
  const parts = line.split("·").map((part) => cleanLabel(part.trim())).filter(Boolean);
  const [spot, variety, date, action, ...noteParts] = parts;
  const note = noteParts.join(" · ") || null;
  return { id: `line-${index}-${line}`, date: date ?? "", zone: null, spot: spot ?? null, label: spot ?? line, action: action ?? null, crop: null, variety: variety ?? null, status: action ?? null, note, next: null, kind: action?.toLowerCase().includes("germination") ? "germination" : action?.toLowerCase().includes("sown") ? "sowing" : null, sourceLine: line };
}

function closeoutRecords(summary: AtlasCloseoutSummary): CloseoutCardRecord[] {
  const records = (summary.records ?? []) as CloseoutCardRecord[];
  if (records.length > 0) return records;
  return (summary.recent ?? []).map(parseRecordLine);
}

function panelTitle(panel: HomePanel) {
  if (panel === "calendar") return "Closeout";
  if (panel === "inbox") return "Note";
  if (panel === "projects") return "Projects";
  return "Tasks";
}

function fallbackBlocks(): AtlasRhythmBlock[] {
  return [
    { id: "fallback-weed", stable_key: "fallback_weed", season_key: "fallback", season_label: "Today", weekday: new Date().getDay(), sort_order: 10, work_key: "weed", display_label: "Weed", default_zone_keys: ["field_rows", "berry_walk_flower_rows"], default_duration_minutes: 45, weather_rule: "hot_first", source_note: "Fallback rhythm", cue: "start before heat" },
    { id: "fallback-germinate", stable_key: "fallback_germinate", season_key: "fallback", season_label: "Today", weekday: new Date().getDay(), sort_order: 20, work_key: "germinate", display_label: "Germinate", default_zone_keys: ["field_rows", "barn_beds", "berry_walk_flower_rows"], default_duration_minutes: 45, weather_rule: null, source_note: "Fallback rhythm", cue: "log only changes" },
    { id: "fallback-venue", stable_key: "fallback_venue", season_key: "fallback", season_label: "Today", weekday: new Date().getDay(), sort_order: 30, work_key: "venue", display_label: "Venue", default_zone_keys: ["main_garden", "entry_billboard"], default_duration_minutes: 30, weather_rule: null, source_note: "Fallback rhythm", cue: "guest-visible reset" },
  ];
}

function orderedRhythmBlocks(blocks: AtlasRhythmBlock[], weatherLabel: string) {
  const working = blocks.length > 0 ? [...blocks] : fallbackBlocks();
  const temp = extractTemp(weatherLabel);
  const weedIndex = working.findIndex((block) => block.work_key === "weed" && block.weather_rule === "hot_first");
  if (temp !== null && temp >= 85 && weedIndex > 0) {
    const [weed] = working.splice(weedIndex, 1);
    return [weed, ...working];
  }
  return working;
}

function unitsForBlock(block: AtlasRhythmBlock, units: TaskUnit[]) {
  return units.filter((unit) => {
    const unitWork = workFromUnit(unit);
    const zoneMatch = !block.default_zone_keys.length || (unit.zone?.stable_key && block.default_zone_keys.includes(unit.zone.stable_key));
    return unitWork === block.work_key && zoneMatch;
  });
}

function zonePreview(block: AtlasRhythmBlock, zones: AtlasRegistryZone[]) {
  const labels = labelsForZoneKeys(zones, block.default_zone_keys).slice(0, 3);
  return labels.length ? labels.join(" · ") : workConfig(block.work_key).shortZones;
}

function blockCue(block: AtlasRhythmBlock, weatherLabel: string) {
  const temp = extractTemp(weatherLabel);
  if (block.weather_rule === "hot_first" && temp !== null && temp >= 85) return "start before heat";
  return block.cue ?? block.source_note ?? "log when finished";
}

function CloseoutRecordCard({ record }: { record: CloseoutCardRecord }) {
  const kind = recordKind(record);
  const zone = zoneForRecord(record);
  const title = record.spot || record.label;
  const crop = [record.variety, record.crop].filter(Boolean).join(" · ");
  const dateAction = [record.date ? prettyDate(record.date) : null, record.action || record.status].filter(Boolean).join(" · ");
  return <article className="atlas-record-card"><div className="atlas-record-card-top"><span className="atlas-record-zone">{zone}</span><span className="atlas-record-kind">{kind}</span></div><strong>{title}</strong>{crop ? <p className="atlas-record-crop">{crop}</p> : null}{dateAction ? <p className="atlas-record-date">{dateAction}</p> : null}{record.note ? <p className="atlas-record-note">{cleanLabel(record.note)}</p> : null}</article>;
}

function CloseoutCard({ summary }: { summary: AtlasCloseoutSummary }) {
  const count = summary.counts;
  const records = closeoutRecords(summary);
  const hasAnyRecord = records.length > 0 || count.logs > 0 || count.objectEvents > 0 || count.tasksDone > 0 || count.tasksBlocked > 0;
  const headline = [countPhrase(records.length || count.objectEvents, "record"), countPhrase(count.seeded, "sowing"), countPhrase(count.germination, "germination check")].filter(Boolean).slice(0, 3) as string[];
  const work = [countPhrase(count.tasksDone, "done"), count.openTasks ? `${count.openTasks} still open` : null, countPhrase(count.followUps, "follow-up")].filter(Boolean) as string[];
  return <article className="atlas-closeout-card tidy farm-records"><div className="atlas-closeout-card-head"><strong>{summary.label}</strong><span>{prettyDate(summary.startDate)}–{prettyDate(summary.endDate)}</span></div>{!hasAnyRecord ? <p className="atlas-closeout-simple">No updates yet.</p> : null}{headline.length > 0 ? <div className="atlas-closeout-pill-row primary">{headline.map((fact) => <span key={fact}>{fact}</span>)}</div> : null}{work.length > 0 ? <div className="atlas-closeout-pill-row soft">{work.map((fact) => <span key={fact}>{fact}</span>)}</div> : null}{summary.carryForward.length > 0 ? <div className="atlas-closeout-section carry"><span>Carry forward</span>{summary.carryForward.map((line) => <p key={line}>{cleanLabel(line)}</p>)}</div> : null}{records.length > 0 ? <div className="atlas-record-list"><span>Records</span>{records.map((record) => <CloseoutRecordCard key={record.id} record={record} />)}</div> : null}</article>;
}

function RhythmController({ blocks, units, loading, zones, weatherLabel, seasonLabel, openLog, openTasks }: { blocks: AtlasRhythmBlock[]; units: TaskUnit[]; loading: boolean; zones: AtlasRegistryZone[]; weatherLabel: string; seasonLabel: string | null; openTasks: () => void; openLog: (seed: LogSeed) => void }) {
  const visibleBlocks = orderedRhythmBlocks(blocks, weatherLabel).slice(0, 3);
  const primary = visibleBlocks[0];
  const primaryUnits = primary ? unitsForBlock(primary, units) : [];
  const primaryObjectKeys = objectKeysFromUnits(primaryUnits);
  const primaryZoneKeys = zoneKeysFromUnits(primaryUnits);
  const primaryZones = primaryZoneKeys.length > 0 ? primaryZoneKeys : primary?.default_zone_keys ?? [];
  const rainAge = extractRainAge(weatherLabel);

  if (loading && units.length === 0 && blocks.length === 0) {
    return <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller empty"><div className="atlas-task-controller-head"><span className="atlas-task-kicker">Today</span><span className="atlas-task-date">Loading</span></div><button type="button" className="atlas-task-active-card" onClick={openTasks}><strong>Loading</strong><em>Atlas is loading the day.</em></button></article>;
  }

  return (
    <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller">
      <div className="atlas-task-controller-head"><div><span className="atlas-task-kicker">Today</span>{seasonLabel ? <em className="atlas-season-label">{seasonLabel}</em> : null}</div><span className="atlas-task-date">{prettyDate(todayIso())}</span></div>
      <div className="atlas-day-schedule">
        {visibleBlocks.map((block, index) => {
          const blockUnits = unitsForBlock(block, units);
          const objectKeys = objectKeysFromUnits(blockUnits);
          const liveZoneKeys = zoneKeysFromUnits(blockUnits);
          const zoneKeys = liveZoneKeys.length > 0 ? liveZoneKeys : block.default_zone_keys;
          return (
            <button type="button" key={block.id} className={index === 0 ? "atlas-day-row primary" : "atlas-day-row"} onClick={() => openLog({ workKey: block.work_key, zoneKeys, objectKeys })}>
              <small>{index + 1}</small>
              <strong>{block.display_label}</strong>
              <span>{zonePreview(block, zones)}</span>
              <em>{blockCue(block, weatherLabel)}</em>
              {index === 0 ? <b>log →</b> : null}
            </button>
          );
        })}
      </div>
      <div className="atlas-task-status-footer">
        <span><small>Dry</small><strong>{rainAge}</strong></span>
        <span><small>Beds</small><strong>{primaryObjectKeys.length || "choose"}</strong></span>
        <span><small>Next</small><strong>{visibleBlocks[1]?.display_label ?? "Log"}</strong></span>
      </div>
    </article>
  );
}

function FieldLogBuilder({ seed, zones, onClose, onSaved }: { seed: LogSeed; zones: AtlasRegistryZone[]; onClose: () => void; onSaved: () => void }) {
  const [workKey, setWorkKey] = useState<AtlasWorkKey>(seed.workKey);
  const [zoneKeys, setZoneKeys] = useState<string[]>(seed.zoneKeys.length > 0 ? seed.zoneKeys : workConfig(seed.workKey).defaultZoneKeys.filter((key) => zones.some((zone) => zone.stable_key === key)));
  const [objectKeys, setObjectKeys] = useState<string[]>(seed.objectKeys);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selectedWork = workConfig(workKey);
  const visibleObjects = zones.flatMap((zone) => zoneKeys.includes(zone.stable_key) ? zone.objects : []);
  const zoneLabels = labelsForZoneKeys(zones, zoneKeys);
  const objectLabels = labelsForObjectKeys(zones, objectKeys);
  const summaryParts = [prettyDate(todayIso()), "I", selectedWork.label, ...zoneLabels, ...objectLabels.map(compactSpot)];
  const summarySentence = summaryParts.filter(Boolean).join(" · ");

  function toggleZone(key: string) {
    setZoneKeys((current) => {
      if (current.includes(key)) {
        const next = current.filter((candidate) => candidate !== key);
        const removedZone = zones.find((zone) => zone.stable_key === key);
        if (removedZone) {
          const removedObjectKeys = new Set(removedZone.objects.map((object) => object.stable_key));
          setObjectKeys((objects) => objects.filter((objectKey) => !removedObjectKeys.has(objectKey)));
        }
        return next;
      }
      return [...current, key];
    });
  }

  function toggleObject(key: string) {
    setObjectKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }

  async function saveLog() {
    if (zoneKeys.length === 0) { setMessage("Choose a zone."); return; }
    try {
      setSaving(true);
      setMessage(null);
      await createAtlasFieldLog({ actionTypes: selectedWork.actionTypes, summarySentence, note: note.trim() || undefined, zoneKeys, objectKeys });
      await onSaved();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Field log failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
      <div className="atlas-task-focus-phone">
        <div className="atlas-task-focus-topbar"><div><strong>Log</strong><span>{selectedWork.label}</span></div><button type="button" onClick={onClose}>Close</button></div>
        <div className="atlas-task-focus-body atlas-log-builder">
          <section className="atlas-task-focus-purple atlas-log-hero"><div className="atlas-task-focus-kicker"><span>{prettyDate(todayIso())}</span></div><h2>{selectedWork.label}</h2><p>{zoneLabels.join(" · ") || "Choose zone"}</p></section>
          <section className="atlas-task-focus-section atlas-log-compose">
            <div className="atlas-log-sentence">{summarySentence}</div>
            <div className="atlas-log-step"><span>Work</span><div className="atlas-log-chip-grid">{workConfigs.map((work) => <button key={work.key} type="button" className={work.key === workKey ? "selected" : ""} onClick={() => { setWorkKey(work.key); if (zoneKeys.length === 0) setZoneKeys(work.defaultZoneKeys.filter((key) => zones.some((zone) => zone.stable_key === key))); }}>{work.label}</button>)}</div></div>
            <div className="atlas-log-step"><span>Zone</span><div className="atlas-log-chip-grid">{zones.map((zone) => <button key={zone.id} type="button" className={zoneKeys.includes(zone.stable_key) ? "selected" : ""} onClick={() => toggleZone(zone.stable_key)}>{zone.label}</button>)}</div></div>
            <div className="atlas-log-step"><span>Beds</span>{visibleObjects.length === 0 ? <p className="atlas-log-muted">Choose a zone first.</p> : <div className="atlas-log-chip-grid compact">{visibleObjects.map((object) => <button key={object.id} type="button" className={objectKeys.includes(object.stable_key) ? "selected" : ""} onClick={() => toggleObject(object.stable_key)}>{compactSpot(object.label)}</button>)}</div>}</div>
            <div className="atlas-add-form"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note" /></div>
            <button type="button" className="atlas-zone-action" style={{ width: "100%", marginTop: 12 }} disabled={saving} onClick={() => void saveLog()}>{saving ? "Saving" : "Save field log"}</button>
            {message ? <p className="atlas-task-result-message">{message}</p> : null}
          </section>
        </div>
      </div>
    </section>
  );
}

function ProjectPanel({ projects }: { projects: AtlasProjectCard[] }) {
  return <section className="atlas-task-focus-section atlas-project-panel"><div className="atlas-project-list">{projects.map((project) => <article key={`${project.project_id}-${project.project_goal_id ?? project.project_key}`} className="atlas-project-card"><strong>{project.project_title}</strong><span>{project.goal_label ?? project.project_goal_text ?? project.target_window_label ?? "Project"}</span><small>{[project.zone_label, project.target_window_label, project.open_task_count ? `${project.open_task_count} open` : null].filter(Boolean).join(" · ")}</small></article>)}</div></section>;
}

function FarmSnapshotBox({ snapshot, loading }: { snapshot: AtlasFarmSnapshot; loading: boolean }) {
  return <Link href="/zones" className="atlas-home-box atlas-home-box-white atlas-home-box-link atlas-farm-snapshot-box"><strong>Farm Snapshot</strong><div className="atlas-snapshot-grid"><span><b>{loading ? "…" : snapshot.growingBeds}</b> growing beds</span><span><b>{loading ? "…" : snapshot.activeSqft.toLocaleString()}</b> active sq ft</span><span><b>{loading ? "…" : snapshot.sowingsLogged}</b> sowings logged</span><span><b>{loading ? "…" : snapshot.stemsLogged}</b> stems logged</span></div></Link>;
}

export default function AtlasHomePage() {
  const [cards, setCards] = useState<AtlasTaskCard[]>([]);
  const [registryZones, setRegistryZones] = useState<AtlasRegistryZone[]>([]);
  const [rhythmBlocks, setRhythmBlocks] = useState<AtlasRhythmBlock[]>([]);
  const [rhythmSeasonLabel, setRhythmSeasonLabel] = useState<string | null>(null);
  const [projects, setProjects] = useState<AtlasProjectCard[]>([]);
  const [snapshot, setSnapshot] = useState<AtlasFarmSnapshot>(defaultSnapshot);
  const [loading, setLoading] = useState(true);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<HomePanel>(null);
  const [logSeed, setLogSeed] = useState<LogSeed | null>(null);
  const [inboxBody, setInboxBody] = useState("");
  const [inboxZoneKey, setInboxZoneKey] = useState("");
  const [inboxSaving, setInboxSaving] = useState(false);
  const [inboxMessage, setInboxMessage] = useState<string | null>(null);
  const [closeoutSummaries, setCloseoutSummaries] = useState<AtlasCloseoutSummary[]>([]);
  const [closeoutLoading, setCloseoutLoading] = useState(true);
  const [closeoutPeriod, setCloseoutPeriod] = useState<AtlasCloseoutPeriod>("day");
  const [closeoutNote, setCloseoutNote] = useState("");
  const [closeoutCarry, setCloseoutCarry] = useState("");
  const [closeoutNext, setCloseoutNext] = useState("");
  const [closeoutSaving, setCloseoutSaving] = useState(false);
  const [closeoutMessage, setCloseoutMessage] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const today = todayIso();

  async function loadCards() { try { setLoading(true); setError(null); const response = await fetchAtlasTaskCards(); setCards(response.taskCards ?? []); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Tasks failed."); } finally { setLoading(false); } }
  async function loadRegistry() { try { setRegistryLoading(true); const response = await fetchAtlasZoneRegistry(); setRegistryZones(response.zones ?? []); } catch (registryError) { setError(registryError instanceof Error ? registryError.message : "Zones failed."); } finally { setRegistryLoading(false); } }
  async function loadRhythm() { try { const response = await fetchAtlasTodayRhythm(); setRhythmBlocks(response.blocks ?? []); setRhythmSeasonLabel(response.seasonLabel); } catch (rhythmError) { setError(rhythmError instanceof Error ? rhythmError.message : "Rhythm failed."); } }
  async function loadProjects() { try { const response = await fetchAtlasProjects(); setProjects((response.projects ?? []).filter((project) => project.project_status === "active")); } catch (projectError) { setError(projectError instanceof Error ? projectError.message : "Projects failed."); } }
  async function loadSnapshot() { try { setSnapshotLoading(true); const response = await fetchAtlasFarmSnapshot(); setSnapshot(response.snapshot ?? defaultSnapshot); } catch (snapshotError) { setError(snapshotError instanceof Error ? snapshotError.message : "Snapshot failed."); } finally { setSnapshotLoading(false); } }
  async function loadCloseout() { try { setCloseoutLoading(true); const response = await fetchAtlasCloseout(); setCloseoutSummaries(response.summaries ?? []); } catch (closeoutError) { setCloseoutMessage(closeoutError instanceof Error ? closeoutError.message : "Closeout failed."); } finally { setCloseoutLoading(false); } }
  async function loadWeather() { try { const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" }); const data = (await response.json()) as WeatherResponse; setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable"); } catch { setWeatherLabel("weather unavailable"); } }

  useEffect(() => { void loadCards(); void loadRegistry(); void loadRhythm(); void loadProjects(); void loadSnapshot(); void loadCloseout(); void loadWeather(); }, []);

  const openCards = useMemo(() => cards.filter((card) => card.status === "open").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))), [cards]);
  const units = useMemo(() => taskUnits(openCards, registryZones), [openCards, registryZones]);
  const calendarEntry = currentEntry(today);
  const monthSummary = closeoutSummaries.find((summary) => summary.period === "month");
  const homeProjects = projects.slice(0, 3);

  function openLog(seed: LogSeed) { setOpenPanel(null); setLogSeed(seed); }
  async function afterLogSaved() { await loadRegistry(); await loadSnapshot(); await loadCloseout(); }

  async function submitInbox() {
    const cleanBody = inboxBody.trim();
    if (!cleanBody) { setInboxMessage("Note required."); return; }
    try { setInboxSaving(true); setInboxMessage(null); await saveAtlasInboxItem({ body: cleanBody, zoneKey: inboxZoneKey || null }); setInboxBody(""); setInboxZoneKey(""); setInboxMessage("Saved."); }
    catch (inboxError) { setInboxMessage(inboxError instanceof Error ? inboxError.message : "Save failed."); }
    finally { setInboxSaving(false); }
  }

  async function submitCloseout() {
    const cleanNote = closeoutNote.trim();
    if (!cleanNote) { setCloseoutMessage("Closeout note required."); return; }
    try { setCloseoutSaving(true); setCloseoutMessage(null); await saveAtlasCloseout({ period: closeoutPeriod, note: cleanNote, carryForward: closeoutCarry.trim() || undefined, nextFocus: closeoutNext.trim() || undefined }); setCloseoutNote(""); setCloseoutCarry(""); setCloseoutNext(""); setCloseoutMessage("Closeout saved."); await loadCloseout(); }
    catch (closeoutError) { setCloseoutMessage(closeoutError instanceof Error ? closeoutError.message : "Closeout save failed."); }
    finally { setCloseoutSaving(false); }
  }

  return <main className="atlas-phone-shell atlas-home-shell"><section className="atlas-phone atlas-dashboard-phone"><header className="atlas-phone-top atlas-dashboard-top"><div className="atlas-phone-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></div><span className="atlas-weather-line">{weatherLabel}</span><button type="button" className="atlas-note-plus" aria-label="Add note" onClick={() => setOpenPanel("inbox")}>+</button></header><div className="atlas-home-grid"><RhythmController blocks={rhythmBlocks} units={units} loading={loading} zones={registryZones} seasonLabel={rhythmSeasonLabel} weatherLabel={weatherLabel} openLog={openLog} openTasks={() => setOpenPanel("tasks")} /><button type="button" className="atlas-home-box atlas-home-box-white" onClick={() => setOpenPanel("calendar")}><strong>Closeout</strong><em>{monthSummary ? `${monthSummary.counts.objectEvents} records · ${monthSummary.counts.openTasks} still open` : calendarEntry.title}</em><div className="atlas-home-mini-list"><span>{calendarEntry.date === today ? "Today" : prettyDate(calendarEntry.date)} · {calendarEntry.dayKind}</span><span>{calendarEntry.title}</span></div></button><button type="button" className="atlas-home-box atlas-home-box-white atlas-projects-box" onClick={() => setOpenPanel("projects")}><strong>Projects</strong><div className="atlas-project-mini-list">{homeProjects.length ? homeProjects.map((project) => <span key={`${project.project_id}-${project.project_goal_id ?? project.project_key}`}>{project.project_title}</span>) : <span>Loading projects</span>}</div></button><FarmSnapshotBox snapshot={snapshot} loading={snapshotLoading || registryLoading} /></div></section>{openPanel ? <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true"><div className="atlas-task-focus-phone"><div className="atlas-task-focus-topbar"><div><strong>{panelTitle(openPanel)}</strong></div><button type="button" onClick={() => setOpenPanel(null)}>Close</button></div><div className="atlas-task-focus-body">{openPanel === "tasks" ? <section className="atlas-task-list">{error ? <div className="atlas-empty">{error}</div> : null}{units.length === 0 ? <div className="atlas-empty">Clear.</div> : null}{units.map((unit) => <article key={unit.id} className="atlas-task-row"><button type="button" className="atlas-task-row-main" onClick={() => openLog({ workKey: workFromUnit(unit), zoneKeys: unit.zone?.stable_key ? [unit.zone.stable_key] : [], objectKeys: unit.registryObject?.stable_key ? [unit.registryObject.stable_key] : [] })}><div className="atlas-task-row-head atlas-task-object-row"><div><strong>{workConfig(workFromUnit(unit)).label}</strong><span>{cropLine(unit)}</span><small>{locationLine(unit)}</small></div></div></button></article>)}</section> : null}{openPanel === "projects" ? <ProjectPanel projects={projects} /> : null}{openPanel === "calendar" ? <><section className="atlas-task-focus-purple atlas-closeout-hero"><div className="atlas-task-focus-kicker"><span>{calendarEntry.dayKind}</span></div><h2>Month record</h2><p>{calendarEntry.title}</p></section>{closeoutLoading ? <div className="atlas-empty">Loading closeout.</div> : null}<section className="atlas-closeout-grid">{closeoutSummaries.map((summary) => <CloseoutCard key={summary.period} summary={summary} />)}</section><section className="atlas-task-focus-section atlas-closeout-form"><div className="atlas-add-form"><select aria-label="Closeout period" value={closeoutPeriod} onChange={(event) => setCloseoutPeriod(event.target.value as AtlasCloseoutPeriod)}><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option></select><textarea value={closeoutNote} onChange={(event) => setCloseoutNote(event.target.value)} placeholder="What changed?" /><textarea value={closeoutCarry} onChange={(event) => setCloseoutCarry(event.target.value)} placeholder="Carry forward" /><textarea value={closeoutNext} onChange={(event) => setCloseoutNext(event.target.value)} placeholder="Next focus" /></div><button type="button" className="atlas-zone-action" style={{ width: "100%", marginTop: 12 }} disabled={closeoutSaving} onClick={() => void submitCloseout()}>{closeoutSaving ? "Saving" : "Save closeout"}</button>{closeoutMessage ? <p className="atlas-task-result-message">{cleanLabel(closeoutMessage)}</p> : null}</section></> : null}{openPanel === "inbox" ? <section className="atlas-task-focus-section"><div className="atlas-add-form"><select aria-label="Zone" value={inboxZoneKey} onChange={(event) => setInboxZoneKey(event.target.value)}><option value="">Whole farm</option>{registryZones.map((zone) => <option key={zone.id} value={zone.stable_key}>{zone.label}</option>)}</select><textarea aria-label="Note" value={inboxBody} onChange={(event) => setInboxBody(event.target.value)} placeholder="Note" /></div><button type="button" className="atlas-zone-action accent" style={{ width: "100%", border: 0, marginTop: 12 }} disabled={inboxSaving} onClick={() => void submitInbox()}>{inboxSaving ? "Saving" : "Save"}</button>{inboxMessage ? <p className="atlas-task-result-message">{inboxMessage}</p> : null}</section> : null}</div></div></section> : null}{logSeed ? <FieldLogBuilder seed={logSeed} zones={registryZones} onClose={() => setLogSeed(null)} onSaved={() => void afterLogSaved()} /> : null}</main>;
}
