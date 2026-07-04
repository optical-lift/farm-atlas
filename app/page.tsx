"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { fetchAtlasCloseout, saveAtlasCloseout, type AtlasCloseoutPeriod, type AtlasCloseoutRecord, type AtlasCloseoutSummary } from "@/lib/atlas/closeout-client";
import { fetchAtlasTaskCards, type AtlasTaskCard, type AtlasTaskCardObject } from "@/lib/atlas/task-cards-client";
import { saveAtlasTaskResult, type AtlasTaskCapture, type AtlasTaskResult } from "@/lib/atlas/task-result-client";
import { saveAtlasInboxItem } from "@/lib/atlas/inbox-client";
import { fetchAtlasZoneRegistry, type AtlasRegistryObject, type AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

type HomePanel = "tasks" | "calendar" | "inbox" | null;
type CalendarEntry = { date: string; title: string; dayKind: string; items: string[] };
type TaskUnit = { id: string; card: AtlasTaskCard; object: AtlasTaskCardObject | null; registryObject: AtlasRegistryObject | null; zone: AtlasRegistryZone | null };

type CloseoutCardRecord = AtlasCloseoutRecord & { sourceLine?: string };

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

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const todayIso = () => new Date().toISOString().slice(0, 10);

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cleanLabel(value: string | null | undefined) {
  return (value ?? "").replace(/truth/gi, "state").replace(/\bAnna\b/g, "crew").replace(/\bLex\b/g, "crew");
}

function currentEntry(today: string) {
  return calendarEntries.find((entry) => entry.date === today) ?? calendarEntries.find((entry) => entry.date > today) ?? calendarEntries[calendarEntries.length - 1];
}

function nextEntries(today: string) {
  return calendarEntries.filter((entry) => entry.date >= today).slice(0, 6);
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

function contentLine(object: AtlasRegistryObject | null) {
  const content = object?.contents[0];
  return content ? [content.content_label, content.variety, content.status?.replaceAll("_", " ")].filter(Boolean).join(" · ") : null;
}

function sizeLine(object: AtlasRegistryObject | null) {
  if (!object) return null;
  if (object.width_ft && object.length_ft) return `${object.width_ft} ft × ${object.length_ft} ft`;
  return object.width_ft ? `${object.width_ft} ft` : object.length_ft ? `${object.length_ft} ft` : null;
}

function captureKind(card: AtlasTaskCard) {
  const text = `${card.task_type} ${card.title}`.toLowerCase();
  if (text.includes("germin")) return "germination";
  if (text.includes("weed")) return "weed";
  if (text.includes("harvest") || text.includes("cut")) return "harvest";
  if (text.includes("audit") || text.includes("walk") || text.includes("state") || text.includes("truth")) return "bed_audit";
  return "generic";
}

function actionLabel(unit: TaskUnit) {
  const kind = captureKind(unit.card);
  const crop = unit.registryObject?.contents[0]?.content_label;
  if (kind === "germination") return crop ? `Record ${crop} germination` : "Record germination";
  if (kind === "weed") return "Record weeded state";
  if (kind === "harvest") return crop ? `Record ${crop} harvest` : "Record harvest";
  if (kind === "bed_audit") return "Record bed state";
  return cleanLabel(unit.card.title);
}

function completedObjectIds(card: AtlasTaskCard) {
  const captureMap = card.metadata?.capture_by_object ?? {};
  return new Set(Object.entries(captureMap).filter(([, value]) => Boolean(value.completed_at)).map(([id]) => id));
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

function unitMeta(unit: TaskUnit) {
  return [contentLine(unit.registryObject), prettyDate(unit.card.due_date)].filter(Boolean).join(" · ");
}

function defaultCapture(kind: string): AtlasTaskCapture {
  return { kind, standQuality: "", standPercent: "", plantCount: "", gaps: "", nextAction: "", finished: "", pressure: "", stems: "", quality: "", destination: "", actualContents: "", heading: "" };
}

function resultLabel(result: AtlasTaskResult) {
  return result === "needs_supplies" ? "Need supplies" : result[0].toUpperCase() + result.slice(1);
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
  return {
    id: `line-${index}-${line}`,
    date: date ?? "",
    zone: null,
    spot: spot ?? null,
    label: spot ?? line,
    action: action ?? null,
    crop: null,
    variety: variety ?? null,
    status: action ?? null,
    note,
    next: null,
    kind: action?.toLowerCase().includes("germination") ? "germination" : action?.toLowerCase().includes("sown") ? "sowing" : null,
    sourceLine: line,
  };
}

function closeoutRecords(summary: AtlasCloseoutSummary): CloseoutCardRecord[] {
  const records = (summary.records ?? []) as CloseoutCardRecord[];
  if (records.length > 0) return records;
  return (summary.recent ?? []).map(parseRecordLine);
}

function CloseoutRecordCard({ record }: { record: CloseoutCardRecord }) {
  const kind = recordKind(record);
  const zone = zoneForRecord(record);
  const title = record.spot || record.label;
  const cropLine = [record.variety, record.crop].filter(Boolean).join(" · ");
  const dateAction = [record.date ? prettyDate(record.date) : null, record.action || record.status].filter(Boolean).join(" · ");

  return (
    <article className="atlas-record-card">
      <div className="atlas-record-card-top">
        <span className="atlas-record-zone">{zone}</span>
        <span className="atlas-record-kind">{kind}</span>
      </div>
      <strong>{title}</strong>
      {cropLine ? <p className="atlas-record-crop">{cropLine}</p> : null}
      {dateAction ? <p className="atlas-record-date">{dateAction}</p> : null}
      {record.note ? <p className="atlas-record-note">{cleanLabel(record.note)}</p> : null}
    </article>
  );
}

function CloseoutCard({ summary }: { summary: AtlasCloseoutSummary }) {
  const count = summary.counts;
  const records = closeoutRecords(summary);
  const hasAnyRecord = records.length > 0 || count.logs > 0 || count.objectEvents > 0 || count.tasksDone > 0 || count.tasksBlocked > 0;
  const headline = [countPhrase(records.length || count.objectEvents, "record"), countPhrase(count.seeded, "sowing"), countPhrase(count.germination, "germination check")].filter(Boolean).slice(0, 3) as string[];
  const work = [countPhrase(count.tasksDone, "done"), count.openTasks ? `${count.openTasks} still open` : null, countPhrase(count.followUps, "follow-up")].filter(Boolean) as string[];

  return (
    <article className="atlas-closeout-card tidy farm-records">
      <div className="atlas-closeout-card-head">
        <strong>{summary.label}</strong>
        <span>{prettyDate(summary.startDate)}–{prettyDate(summary.endDate)}</span>
      </div>
      {!hasAnyRecord ? <p className="atlas-closeout-simple">No updates yet.</p> : null}
      {headline.length > 0 ? <div className="atlas-closeout-pill-row primary">{headline.map((fact) => <span key={fact}>{fact}</span>)}</div> : null}
      {work.length > 0 ? <div className="atlas-closeout-pill-row soft">{work.map((fact) => <span key={fact}>{fact}</span>)}</div> : null}
      {summary.carryForward.length > 0 ? <div className="atlas-closeout-section carry"><span>Carry forward</span>{summary.carryForward.map((line) => <p key={line}>{cleanLabel(line)}</p>)}</div> : null}
      {records.length > 0 ? <div className="atlas-record-list"><span>Records</span>{records.map((record) => <CloseoutRecordCard key={record.id} record={record} />)}</div> : null}
    </article>
  );
}

export default function AtlasHomePage() {
  const [cards, setCards] = useState<AtlasTaskCard[]>([]);
  const [registryZones, setRegistryZones] = useState<AtlasRegistryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<HomePanel>(null);
  const [selectedUnit, setSelectedUnit] = useState<TaskUnit | null>(null);
  const [capture, setCapture] = useState<AtlasTaskCapture>(defaultCapture("generic"));
  const [resultNote, setResultNote] = useState("");
  const [savingResult, setSavingResult] = useState<AtlasTaskResult | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
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
  const today = todayIso();

  async function loadCards() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetchAtlasTaskCards();
      setCards(response.taskCards ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRegistry() {
    try {
      setRegistryLoading(true);
      const response = await fetchAtlasZoneRegistry();
      setRegistryZones(response.zones ?? []);
    } catch (registryError) {
      setError(registryError instanceof Error ? registryError.message : "Zones failed.");
    } finally {
      setRegistryLoading(false);
    }
  }

  async function loadCloseout() {
    try {
      setCloseoutLoading(true);
      const response = await fetchAtlasCloseout();
      setCloseoutSummaries(response.summaries ?? []);
    } catch (closeoutError) {
      setCloseoutMessage(closeoutError instanceof Error ? closeoutError.message : "Closeout failed.");
    } finally {
      setCloseoutLoading(false);
    }
  }

  useEffect(() => {
    void loadCards();
    void loadRegistry();
    void loadCloseout();
  }, []);

  const openCards = useMemo(() => cards.filter((card) => card.status === "open").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))), [cards]);
  const units = useMemo(() => taskUnits(openCards, registryZones), [openCards, registryZones]);
  const primaryUnit = units[0] ?? null;
  const nextUnits = units.slice(1, 4);
  const calendarEntry = currentEntry(today);
  const upcomingCalendar = nextEntries(today);
  const monthSummary = closeoutSummaries.find((summary) => summary.period === "month");
  const homeZones = useMemo(() => {
    const important = ["field_rows", "berry_walk_flower_rows", "barn_beds", "grow_room"];
    const byKey = new Map(registryZones.map((zone) => [zone.stable_key, zone]));
    return important.map((key) => byKey.get(key)).filter(Boolean) as AtlasRegistryZone[];
  }, [registryZones]);

  function openUnit(unit: TaskUnit) {
    const kind = captureKind(unit.card);
    setOpenPanel(null);
    setSelectedUnit(unit);
    setCapture(defaultCapture(kind));
    setResultNote("");
    setResultMessage(null);
  }

  async function saveUnit(result: AtlasTaskResult, useCapture = true) {
    if (!selectedUnit) return;
    const kind = captureKind(selectedUnit.card);
    if (useCapture && kind === "germination" && !capture.standQuality) {
      setResultMessage("Stand required.");
      return;
    }
    try {
      setSavingResult(result);
      setResultMessage(null);
      await saveAtlasTaskResult({ taskId: selectedUnit.card.task_id, result, objectId: selectedUnit.object?.object_id, capture: useCapture ? capture : undefined, note: resultNote.trim() || undefined });
      await loadCards();
      await loadRegistry();
      await loadCloseout();
      setSelectedUnit(null);
      setResultNote("");
    } catch (saveError) {
      setResultMessage(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setSavingResult(null);
    }
  }

  async function submitInbox() {
    const cleanBody = inboxBody.trim();
    if (!cleanBody) {
      setInboxMessage("Note required.");
      return;
    }
    try {
      setInboxSaving(true);
      setInboxMessage(null);
      await saveAtlasInboxItem({ body: cleanBody, zoneKey: inboxZoneKey || null });
      setInboxBody("");
      setInboxZoneKey("");
      setInboxMessage("Saved.");
    } catch (inboxError) {
      setInboxMessage(inboxError instanceof Error ? inboxError.message : "Save failed.");
    } finally {
      setInboxSaving(false);
    }
  }

  async function submitCloseout() {
    const cleanNote = closeoutNote.trim();
    if (!cleanNote) {
      setCloseoutMessage("Closeout note required.");
      return;
    }
    try {
      setCloseoutSaving(true);
      setCloseoutMessage(null);
      await saveAtlasCloseout({ period: closeoutPeriod, note: cleanNote, carryForward: closeoutCarry.trim() || undefined, nextFocus: closeoutNext.trim() || undefined });
      setCloseoutNote("");
      setCloseoutCarry("");
      setCloseoutNext("");
      setCloseoutMessage("Closeout saved.");
      await loadCloseout();
    } catch (closeoutError) {
      setCloseoutMessage(closeoutError instanceof Error ? closeoutError.message : "Closeout save failed.");
    } finally {
      setCloseoutSaving(false);
    }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell">
      <section className="atlas-phone atlas-dashboard-phone">
        <header className="atlas-phone-top atlas-dashboard-top"><div className="atlas-phone-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></div><button type="button" className="atlas-soft-badge" onClick={() => { void loadCards(); void loadRegistry(); void loadCloseout(); }}>Refresh</button></header>
        <div className="atlas-home-grid">
          <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero"><button type="button" className="atlas-home-primary-task" onClick={() => primaryUnit ? openUnit(primaryUnit) : setOpenPanel("tasks")}><strong>{primaryUnit?.object?.object_label ?? primaryUnit?.card.zone_label ?? (loading ? "Loading" : "Clear")}</strong>{primaryUnit ? <em>{actionLabel(primaryUnit)}</em> : null}{primaryUnit ? <span className="atlas-home-task-title">{unitMeta(primaryUnit)}</span> : null}</button><div className="atlas-home-mini-list atlas-home-task-buttons">{nextUnits.length > 0 ? nextUnits.map((unit) => <button type="button" key={unit.id} onClick={() => openUnit(unit)}><span>{unit.object?.object_label ?? unit.card.zone_label ?? cleanLabel(unit.card.title)}</span><small>{actionLabel(unit)}</small></button>) : <button type="button" onClick={() => setOpenPanel("tasks")}>Tasks</button>}</div></article>
          <button type="button" className="atlas-home-box atlas-home-box-white" onClick={() => setOpenPanel("calendar")}><strong>Closeout</strong><em>{monthSummary ? `${monthSummary.counts.objectEvents} records · ${monthSummary.counts.openTasks} still open` : calendarEntry.title}</em><div className="atlas-home-mini-list"><span>{calendarEntry.date === today ? "Today" : prettyDate(calendarEntry.date)} · {calendarEntry.dayKind}</span><span>{calendarEntry.title}</span></div></button>
          <button type="button" className="atlas-home-box atlas-home-box-white atlas-home-note-box" onClick={() => setOpenPanel("inbox")}><strong>Note</strong><em>+</em></button>
          <Link href="/zones" className="atlas-home-box atlas-home-box-white atlas-home-box-link"><strong>{registryLoading ? "Zones" : "Zones"}</strong><div className="atlas-home-zone-list">{homeZones.map((zone) => <span key={zone.id}>{zone.label}: {zone.active_object_count}/{zone.object_count}</span>)}</div></Link>
        </div>
      </section>

      {openPanel ? <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true"><div className="atlas-task-focus-phone"><div className="atlas-task-focus-topbar"><div><strong>{openPanel === "calendar" ? "Closeout" : openPanel === "inbox" ? "Note" : "Tasks"}</strong></div><button type="button" onClick={() => setOpenPanel(null)}>Close</button></div><div className="atlas-task-focus-body">
        {openPanel === "tasks" ? <section className="atlas-task-list">{error ? <div className="atlas-empty">{error}</div> : null}{units.length === 0 ? <div className="atlas-empty">Clear.</div> : null}{units.map((unit) => <article key={unit.id} className="atlas-task-row"><button type="button" className="atlas-task-row-main" onClick={() => openUnit(unit)}><div className="atlas-task-row-head atlas-task-object-row"><div><strong>{unit.object?.object_label ?? unit.card.zone_label ?? cleanLabel(unit.card.title)}</strong><span>{actionLabel(unit)}</span><small>{unitMeta(unit)}</small></div></div></button></article>)}</section> : null}
        {openPanel === "calendar" ? <><section className="atlas-task-focus-purple atlas-closeout-hero"><div className="atlas-task-focus-kicker"><span>{calendarEntry.dayKind}</span></div><h2>Month record</h2><p>{calendarEntry.title}</p></section>{closeoutLoading ? <div className="atlas-empty">Loading closeout.</div> : null}<section className="atlas-closeout-grid">{closeoutSummaries.map((summary) => <CloseoutCard key={summary.period} summary={summary} />)}</section><section className="atlas-task-focus-section atlas-closeout-form"><div className="atlas-add-form"><select aria-label="Closeout period" value={closeoutPeriod} onChange={(event) => setCloseoutPeriod(event.target.value as AtlasCloseoutPeriod)}><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option></select><textarea value={closeoutNote} onChange={(event) => setCloseoutNote(event.target.value)} placeholder="What changed?" /><textarea value={closeoutCarry} onChange={(event) => setCloseoutCarry(event.target.value)} placeholder="Carry forward" /><textarea value={closeoutNext} onChange={(event) => setCloseoutNext(event.target.value)} placeholder="Next focus" /></div><button type="button" className="atlas-zone-action" style={{ width: "100%", marginTop: 12 }} disabled={closeoutSaving} onClick={() => void submitCloseout()}>{closeoutSaving ? "Saving" : "Save closeout"}</button>{closeoutMessage ? <p className="atlas-task-result-message">{cleanLabel(closeoutMessage)}</p> : null}</section><section className="atlas-field-log-list atlas-calendar-preview">{upcomingCalendar.map((entry) => <article className="atlas-field-log-item" key={entry.date}><div className="atlas-field-log-main atlas-calendar-row"><strong>{prettyDate(entry.date)}</strong><span>{entry.title}</span><small>{entry.items.join(" · ")}</small></div></article>)}</section></> : null}
        {openPanel === "inbox" ? <section className="atlas-task-focus-section"><div className="atlas-add-form"><select aria-label="Zone" value={inboxZoneKey} onChange={(event) => setInboxZoneKey(event.target.value)}><option value="">Whole farm</option>{registryZones.map((zone) => <option key={zone.id} value={zone.stable_key}>{zone.label}</option>)}</select><textarea aria-label="Note" value={inboxBody} onChange={(event) => setInboxBody(event.target.value)} placeholder="Note" /></div><button type="button" className="atlas-zone-action accent" style={{ width: "100%", border: 0, marginTop: 12 }} disabled={inboxSaving} onClick={() => void submitInbox()}>{inboxSaving ? "Saving" : "Save"}</button>{inboxMessage ? <p className="atlas-task-result-message">{inboxMessage}</p> : null}</section> : null}
      </div></div></section> : null}

      {selectedUnit ? <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true"><div className="atlas-task-focus-phone"><div className="atlas-task-focus-topbar"><div><strong>{selectedUnit.object?.object_label ?? selectedUnit.card.zone_label ?? cleanLabel(selectedUnit.card.title)}</strong>{contentLine(selectedUnit.registryObject) ? <span>{contentLine(selectedUnit.registryObject)}</span> : null}</div><button type="button" onClick={() => setSelectedUnit(null)}>Close</button></div><div className="atlas-task-focus-body"><section className="atlas-task-focus-purple atlas-work-card"><div className="atlas-task-focus-kicker"><span>{prettyDate(selectedUnit.card.due_date)}</span></div><h2>{actionLabel(selectedUnit)}</h2>{sizeLine(selectedUnit.registryObject) ? <p>{sizeLine(selectedUnit.registryObject)}</p> : null}</section>
        {captureKind(selectedUnit.card) === "germination" ? <section className="atlas-task-focus-section atlas-capture-form"><div className="atlas-add-form"><select value={capture.standQuality ?? ""} onChange={(event) => setCapture({ ...capture, standQuality: event.target.value })} aria-label="Stand"><option value="">Stand</option><option value="good">Good stand</option><option value="patchy">Patchy</option><option value="poor">Poor</option><option value="failed">Failed</option></select><select value={capture.standPercent ?? ""} onChange={(event) => setCapture({ ...capture, standPercent: event.target.value })} aria-label="Percent"><option value="">Percent</option><option value="90">90%+</option><option value="75">75%</option><option value="50">50%</option><option value="25">Under 25%</option></select><input value={capture.plantCount ?? ""} onChange={(event) => setCapture({ ...capture, plantCount: event.target.value })} placeholder="Approx plants" /><select value={capture.gaps ?? ""} onChange={(event) => setCapture({ ...capture, gaps: event.target.value })} aria-label="Gaps"><option value="">Gaps</option><option value="none">None</option><option value="small">Small gaps</option><option value="big">Big gaps</option><option value="section_missing">Section missing</option></select><select value={capture.nextAction ?? ""} onChange={(event) => setCapture({ ...capture, nextAction: event.target.value })} aria-label="Next"><option value="">Next</option><option value="leave">Leave it</option><option value="patch_sow">Patch sow</option><option value="resow">Resow</option><option value="convert">Convert bed</option></select><textarea value={resultNote} onChange={(event) => setResultNote(event.target.value)} placeholder="Note" /></div><button type="button" className="atlas-zone-action" style={{ width: "100%", marginTop: 12 }} disabled={savingResult !== null} onClick={() => void saveUnit("done")}>{savingResult ? "Saving" : "Save bed state"}</button><div className="atlas-task-play-actions" style={{ marginTop: 8 }}><button type="button" disabled={savingResult !== null} onClick={() => void saveUnit("blocked", false)}>Blocked</button><button type="button" disabled={savingResult !== null} onClick={() => void saveUnit("needs_supplies", false)}>Need supplies</button></div>{resultMessage ? <p className="atlas-task-result-message">{resultMessage}</p> : null}</section> : <section className="atlas-task-focus-section"><div className="atlas-add-form"><textarea value={resultNote} onChange={(event) => setResultNote(event.target.value)} placeholder="What changed?" rows={4} /></div><div className="atlas-task-play-actions atlas-task-play-actions-wide" style={{ marginTop: 12 }}>{(["done", "partial", "changed", "blocked", "needs_supplies"] as AtlasTaskResult[]).map((result) => <button key={result} type="button" onClick={() => void saveUnit(result, false)} disabled={savingResult !== null}>{savingResult === result ? "Saving" : resultLabel(result)}</button>)}</div>{resultMessage ? <p className="atlas-task-result-message">{resultMessage}</p> : null}</section>}
      </div></div></section> : null}
    </main>
  );
}
