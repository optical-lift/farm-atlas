"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import {
  TaskPhysicalSpaces,
  taskObjectDetailLine,
  taskObjectTitle,
} from "@/components/atlas/task-physical-spaces";
import {
  fetchAtlasTaskCards,
  type AtlasTaskCard,
} from "@/lib/atlas/task-cards-client";
import {
  saveAtlasTaskResult,
  type AtlasTaskResult,
} from "@/lib/atlas/task-result-client";
import { saveAtlasInboxItem } from "@/lib/atlas/inbox-client";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

type HomePanel = "tasks" | "calendar" | "inbox" | null;

type CalendarEntry = {
  date: string;
  title: string;
  dayKind: string;
  items: string[];
};

const calendarEntries: CalendarEntry[] = [
  { date: "2026-07-04", dayKind: "Succession / check", title: "Check field germination", items: ["CHECK: Field Rows germination", "CHECK: Barn Beds Teddy status"] },
  { date: "2026-07-06", dayKind: "Anna start / transplant", title: "Anna starts + Field Rows truth", items: ["ANNA START", "PLANT: FR7 dahlias", "WALK: Field Rows contents"] },
  { date: "2026-07-07", dayKind: "Seed day", title: "Spring florist trays", items: ["SEED: 7 snap trays", "SEED: BW feverfew / Sweet William / foxglove"] },
  { date: "2026-07-08", dayKind: "Harvest / pinch", title: "Pinch and first cuts", items: ["PINCH: zinnia / basil / celosia in Field Rows", "CHECK: FR7 dahlias", "CUT: bee balm, yarrow, Echinacea"] },
  { date: "2026-07-09", dayKind: "Seed day", title: "Winter greens + nursery", items: ["SEED: winter greens", "SEED: perennial nursery", "SEED: 3 Snow + 2 thyme trays"] },
  { date: "2026-07-10", dayKind: "Harvest / weed", title: "Curve Garden and cut watch", items: ["WEED: Curve Garden", "CUT: watch"] },
  { date: "2026-07-11", dayKind: "Succession", title: "Teddy succession", items: ["SOW: Teddy succession", "CHECK: u-pick sunflowers"] },
  { date: "2026-07-13", dayKind: "Transplant / weed", title: "Field Rows + perennial plant-out", items: ["CHECK: FR7 dahlias", "WEED: Field Rows", "CUT: watch", "PLANT: irises, yarrow, lambs ear"] },
  { date: "2026-07-14", dayKind: "Seed day", title: "Veronica / yarrow", items: ["SEED: Veronica / yarrow"] },
  { date: "2026-07-15", dayKind: "Harvest / pinch", title: "Pinch field flowers", items: ["PINCH: basil / zinnia / celosia in Field Rows", "CUT: bee balm"] },
  { date: "2026-07-16", dayKind: "Seed / weed", title: "Entry Billboard", items: ["WEED: Entry Billboard"] },
  { date: "2026-07-18", dayKind: "Succession", title: "Teddy + U-Pick check", items: ["SOW: Teddy succession", "CHECK: u-pick beds"] },
  { date: "2026-07-20", dayKind: "Transplant / check", title: "Field Rows + Follow Me", items: ["CHECK: Field Rows", "WEED: Follow Me"] },
  { date: "2026-07-21", dayKind: "Seed / germination", title: "Crop check", items: ["GERM: crop check"] },
  { date: "2026-07-22", dayKind: "Harvest / pot-up", title: "Cabbage/kale pot-up watch", items: ["POT UP WATCH: cabbage/kale to 2 inch", "CUT: bee balm"] },
  { date: "2026-07-23", dayKind: "Seed / weed", title: "U-Pick beds", items: ["WEED: U-Pick beds"] },
  { date: "2026-07-24", dayKind: "Harvest", title: "Weekend bouquets", items: ["CUT: weekend bouquets", "SOCIAL MEDIA: bouquet count"] },
  { date: "2026-07-25", dayKind: "Succession", title: "Final Teddy succession", items: ["SOW: final Teddy sunflower succession", "CHECK: u-pick beds"] },
  { date: "2026-07-27", dayKind: "Transplant / harvest", title: "Bouquets + Main Garden", items: ["CUT: 10-15 bouquets", "WEED: Main Garden"] },
  { date: "2026-07-28", dayKind: "Seed / germination", title: "Crop check", items: ["GERM: crop check"] },
  { date: "2026-07-29", dayKind: "Harvest / pot-up", title: "Bouquets + delivery", items: ["POT UP: cabbage/kale to 2 inch", "CUT: 10-15 bouquets", "DELIVER"] },
  { date: "2026-07-30", dayKind: "Seed / harden", title: "Greens + Berry Walk", items: ["HARDEN: greens", "WEED: Berry Walk"] },
  { date: "2026-07-31", dayKind: "Harvest", title: "Bouquet count", items: ["SOCIAL MEDIA: bouquet count", "CUT: 10-15 bouquets"] },
  { date: "2026-08-01", dayKind: "Succession / weed", title: "Entry Billboard", items: ["WEED: Entry Billboard"] },
  { date: "2026-08-03", dayKind: "Transplant / weed", title: "FR 1-3 + first cuts", items: ["WEED: FR 1-3", "CUT: 1 bee balm, 1 basil"] },
  { date: "2026-08-04", dayKind: "Seed / germination", title: "Spring tray germination", items: ["GERM: snaps BW1-3", "GERM: feverfew / Sweet William / foxglove", "GERM: Snow 1-3 + thyme 1-2"] },
  { date: "2026-08-05", dayKind: "Harvest / pot-up", title: "Small bouquets", items: ["CUT: 1 bee balm, 1 zinnia, 1 basil", "BUNDLE: 5-10 small bouquets", "POT UP: rooted cabbage/kale to 2 inch"] },
  { date: "2026-08-06", dayKind: "Weed / harden", title: "FR 4-6 + greens", items: ["WEED: FR 4-6", "HARDEN: mustard / spinach / lettuce 7/9 trays"] },
  { date: "2026-08-08", dayKind: "Succession / harvest", title: "BB1 Teddy", items: ["CUT: BB1 Teddy sunflowers", "BUNDLE: 5 Teddy sunflower bundles", "CLEAR: BB1 Teddy stems"] },
  { date: "2026-08-11", dayKind: "Seed / sales", title: "Germination + grocery", items: ["GERM: July flower trays", "GERM: perennial nursery trays", "GROCERY: contact 5 stores"] },
  { date: "2026-08-13", dayKind: "Weed / harden", title: "Follow Me + scallions", items: ["WEED: FR 10-12", "WEED: Follow Me beds 1-4", "HARDEN: scallion clumps 7/9 trays"] },
  { date: "2026-08-21", dayKind: "Harvest / deliver", title: "Sunflower bundles", items: ["CUT: 2 Italian sunflower, 3 zinnia, 1 basil, 1 celosia", "BUNDLE: 5 sunflower bundles", "DELIVER"] },
  { date: "2026-08-31", dayKind: "Transplant / weed", title: "Main Garden + Berry Walk", items: ["WEED: MG paths", "WEED: BW Flower Rows 1-4", "CUT: 3 zinnia, 2 sunflower, 1 basil, 1 celosia", "BUNDLE: 10-15 bouquets"] },
];

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const todayIso = () => new Date().toISOString().slice(0, 10);

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  const date = new Date(`${dateIso}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function resultButtonLabel(result: AtlasTaskResult) {
  if (result === "done") return "Done";
  if (result === "partial") return "Partial";
  if (result === "changed") return "Changed";
  if (result === "blocked") return "Blocked";
  return "Need supplies";
}

function resultSuccessMessage(result: AtlasTaskResult) {
  if (result === "done") return "Done.";
  if (result === "partial") return "Partial saved.";
  if (result === "changed") return "Changed saved.";
  if (result === "blocked") return "Blocked.";
  return "Supply need saved.";
}

function taskSortValue(card: AtlasTaskCard) {
  const date = card.due_date ?? "9999-12-31";
  const priority = priorityRank[card.priority] ?? 9;
  return `${date}-${priority}-${card.title}`;
}

function noteLines(note: string | null | undefined) {
  return (note ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function currentOrNextCalendarEntry(today: string) {
  return calendarEntries.find((entry) => entry.date === today) ?? calendarEntries.find((entry) => entry.date > today) ?? calendarEntries[calendarEntries.length - 1];
}

function nextCalendarEntries(today: string) {
  return calendarEntries.filter((entry) => entry.date >= today).slice(0, 6);
}

function panelTitle(panel: Exclude<HomePanel, null>, calendarEntry: CalendarEntry) {
  if (panel === "calendar") return prettyDate(calendarEntry.date);
  if (panel === "inbox") return "Note";
  return "Tasks";
}

function taskMetaLine(card: AtlasTaskCard, zones: AtlasRegistryZone[]) {
  return [taskObjectDetailLine(card, zones), prettyDate(card.due_date)].filter(Boolean).join(" · ");
}

export default function AtlasHomePage() {
  const [cards, setCards] = useState<AtlasTaskCard[]>([]);
  const [registryZones, setRegistryZones] = useState<AtlasRegistryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<HomePanel>(null);
  const [selectedCard, setSelectedCard] = useState<AtlasTaskCard | null>(null);
  const [resultNote, setResultNote] = useState("");
  const [createdBy, setCreatedBy] = useState("anna");
  const [savingResult, setSavingResult] = useState<AtlasTaskResult | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [inboxBody, setInboxBody] = useState("");
  const [inboxZoneKey, setInboxZoneKey] = useState("");
  const [inboxSaving, setInboxSaving] = useState(false);
  const [inboxMessage, setInboxMessage] = useState<string | null>(null);

  const today = todayIso();

  async function loadCards() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetchAtlasTaskCards();
      const nextCards = response.taskCards ?? [];
      setCards(nextCards);
      return nextCards;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
      return [];
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

  useEffect(() => {
    void loadCards();
    void loadRegistry();
  }, []);

  const openCards = useMemo(() => cards.filter((card) => card.status === "open").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))), [cards]);
  const primaryTask = openCards[0] ?? null;
  const nextTasks = openCards.slice(1, 4);
  const calendarEntry = currentOrNextCalendarEntry(today);
  const upcomingCalendar = nextCalendarEntries(today);

  const homeZones = useMemo(() => {
    const important = ["field_rows", "berry_walk_flower_rows", "barn_beds", "grow_room"];
    const byKey = new Map(registryZones.map((zone) => [zone.stable_key, zone]));
    return important.map((key) => byKey.get(key)).filter(Boolean) as AtlasRegistryZone[];
  }, [registryZones]);

  function openTask(card: AtlasTaskCard) {
    setOpenPanel(null);
    setSelectedCard(card);
    setResultNote("");
    setResultMessage(null);
  }

  async function handleTaskResult(result: AtlasTaskResult) {
    if (!selectedCard) return;
    const cleanNote = resultNote.trim();
    if (result !== "done" && !cleanNote) {
      setResultMessage("Note required.");
      return;
    }

    try {
      setSavingResult(result);
      setResultMessage(null);
      await saveAtlasTaskResult({ taskId: selectedCard.task_id, result, note: cleanNote || undefined, createdBy: createdBy.trim() || "anna" });
      const nextCards = await loadCards();
      await loadRegistry();
      setSelectedCard(nextCards.find((card) => card.task_id === selectedCard.task_id) ?? null);
      setResultNote("");
      setResultMessage(resultSuccessMessage(result));
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
      await saveAtlasInboxItem({ body: cleanBody, zoneKey: inboxZoneKey || null, createdBy: createdBy.trim() || "anna" });
      setInboxBody("");
      setInboxZoneKey("");
      setInboxMessage("Saved.");
    } catch (inboxError) {
      setInboxMessage(inboxError instanceof Error ? inboxError.message : "Save failed.");
    } finally {
      setInboxSaving(false);
    }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell">
      <section className="atlas-phone atlas-dashboard-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Elm Farm</span>
          </div>
          <button type="button" className="atlas-soft-badge" onClick={() => { void loadCards(); void loadRegistry(); }}>
            Refresh
          </button>
        </header>

        <div className="atlas-home-grid">
          <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero">
            <button type="button" className="atlas-home-primary-task" onClick={() => primaryTask ? openTask(primaryTask) : setOpenPanel("tasks")}>
              <strong>{primaryTask ? taskObjectTitle(primaryTask, registryZones) : (loading ? "Loading" : "Clear")}</strong>
              {primaryTask ? <em>{taskMetaLine(primaryTask, registryZones)}</em> : null}
              {primaryTask ? <span className="atlas-home-task-title">{primaryTask.title}</span> : null}
            </button>
            <div className="atlas-home-mini-list atlas-home-task-buttons">
              {nextTasks.length > 0 ? nextTasks.map((task) => (
                <button type="button" key={task.task_id} onClick={() => openTask(task)}>
                  <span className="atlas-home-mini-object">{taskObjectTitle(task, registryZones)}</span>
                  <small className="atlas-home-mini-action">{task.title}</small>
                </button>
              )) : <button type="button" onClick={() => setOpenPanel("tasks")}>Tasks</button>}
            </div>
          </article>

          <button type="button" className="atlas-home-box atlas-home-box-white" onClick={() => setOpenPanel("calendar")}>
            <strong>{calendarEntry.date === today ? "Today" : prettyDate(calendarEntry.date)}</strong>
            <em>{calendarEntry.title}</em>
            <div className="atlas-home-mini-list">
              {calendarEntry.items.slice(0, 3).map((item) => <span key={item}>{item}</span>)}
            </div>
          </button>

          <button type="button" className="atlas-home-box atlas-home-box-white atlas-home-note-box" onClick={() => setOpenPanel("inbox")}>
            <strong>Note</strong>
            <em>+</em>
          </button>

          <Link href="/zones" className="atlas-home-box atlas-home-box-white atlas-home-box-link">
            <strong>{registryLoading ? "Zones" : "Zones"}</strong>
            <div className="atlas-home-zone-list">
              {homeZones.map((zone) => <span key={zone.id}>{zone.label}: {zone.active_object_count}/{zone.object_count}</span>)}
            </div>
          </Link>
        </div>
      </section>

      {openPanel ? (
        <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
          <div className="atlas-task-focus-phone">
            <div className="atlas-task-focus-topbar">
              <div>
                <strong>{panelTitle(openPanel, calendarEntry)}</strong>
              </div>
              <button type="button" onClick={() => setOpenPanel(null)}>Close</button>
            </div>

            <div className="atlas-task-focus-body">
              {openPanel === "tasks" ? (
                <section className="atlas-task-list">
                  {error ? <div className="atlas-empty">{error}</div> : null}
                  {openCards.length === 0 ? <div className="atlas-empty">Clear.</div> : null}
                  {openCards.map((card) => (
                    <article key={card.task_id} className="atlas-task-row atlas-task-row-playable">
                      <button type="button" className="atlas-task-row-main" onClick={() => openTask(card)}>
                        <div className="atlas-task-row-head atlas-task-object-row">
                          <div>
                            <strong>{taskObjectTitle(card, registryZones)}</strong>
                            <span>{taskMetaLine(card, registryZones)}</span>
                            <small>{card.title}</small>
                          </div>
                        </div>
                      </button>
                    </article>
                  ))}
                </section>
              ) : null}

              {openPanel === "calendar" ? (
                <>
                  <section className="atlas-task-focus-purple">
                    <div className="atlas-task-focus-kicker"><span>{calendarEntry.dayKind}</span></div>
                    <h2>{calendarEntry.title}</h2>
                    <p>{calendarEntry.items.join(" · ")}</p>
                  </section>
                  <section className="atlas-field-log-list">
                    {upcomingCalendar.map((entry) => (
                      <article className="atlas-field-log-item" key={entry.date}>
                        <div className="atlas-field-log-main atlas-calendar-row">
                          <strong>{prettyDate(entry.date)}</strong>
                          <span>{entry.title}</span>
                          <small>{entry.items.join(" · ")}</small>
                        </div>
                      </article>
                    ))}
                  </section>
                </>
              ) : null}

              {openPanel === "inbox" ? (
                <section className="atlas-task-focus-section">
                  <div className="atlas-add-form">
                    <select aria-label="Zone" value={inboxZoneKey} onChange={(event) => setInboxZoneKey(event.target.value)}><option value="">Whole farm</option>{registryZones.map((zone) => <option key={zone.id} value={zone.stable_key}>{zone.label}</option>)}</select>
                    <textarea aria-label="Note" value={inboxBody} onChange={(event) => setInboxBody(event.target.value)} placeholder="Note" />
                  </div>
                  <button type="button" className="atlas-zone-action accent" style={{ width: "100%", border: 0, marginTop: 12 }} disabled={inboxSaving} onClick={() => void submitInbox()}>{inboxSaving ? "Saving" : "Save"}</button>
                  {inboxMessage ? <p className="atlas-task-result-message">{inboxMessage}</p> : null}
                </section>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {selectedCard ? (
        <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
          <div className="atlas-task-focus-phone">
            <div className="atlas-task-focus-topbar">
              <div>
                <strong>{taskObjectTitle(selectedCard, registryZones)}</strong>
                {taskObjectDetailLine(selectedCard, registryZones) ? <span>{taskObjectDetailLine(selectedCard, registryZones)}</span> : null}
              </div>
              <button type="button" onClick={() => setSelectedCard(null)}>Close</button>
            </div>

            <div className="atlas-task-focus-body">
              <TaskPhysicalSpaces task={selectedCard} zones={registryZones} />

              <section className="atlas-task-focus-purple atlas-work-card">
                <div className="atlas-task-focus-kicker"><span>{prettyDate(selectedCard.due_date)}</span></div>
                <h2>{selectedCard.title}</h2>
                {noteLines(selectedCard.note).map((line) => <p key={line}>{line}</p>)}
              </section>

              <section className="atlas-task-focus-section">
                <div className="atlas-add-form">
                  <input aria-label="Who" value={createdBy} onChange={(event) => setCreatedBy(event.target.value)} placeholder="anna" />
                  <textarea aria-label="Result note" value={resultNote} onChange={(event) => setResultNote(event.target.value)} placeholder="What changed?" rows={4} />
                </div>
                <div className="atlas-task-play-actions atlas-task-play-actions-wide" style={{ marginTop: 12 }}>
                  {(["done", "partial", "changed", "blocked", "needs_supplies"] as AtlasTaskResult[]).map((result) => (
                    <button key={result} type="button" onClick={() => void handleTaskResult(result)} disabled={savingResult !== null} title={resultButtonLabel(result)}>{savingResult === result ? "Saving" : resultButtonLabel(result)}</button>
                  ))}
                </div>
                {resultMessage ? <p className="atlas-task-result-message">{resultMessage}</p> : null}
              </section>

              {selectedCard.task_logs.length > 0 ? (
                <section className="atlas-field-log-list">
                  {selectedCard.task_logs.slice(0, 6).map((log) => (
                    <article key={log.field_log_id} className="atlas-field-log-item"><div className="atlas-field-log-main"><strong>{prettyDate(log.log_date)}</strong><span>{log.summary_sentence}</span>{log.note ? <small>{log.note}</small> : null}</div></article>
                  ))}
                </section>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
