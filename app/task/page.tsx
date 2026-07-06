"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type LaneKey = "start" | "maintain" | "harvest" | "venue";
type Outcome = "done" | "partial" | "blocked";
type WeatherResponse = { ok: boolean; label?: string };
type QuickCheckState = { exceptions: string[]; left: string[]; other: string };

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const laneLabels: Record<LaneKey, string> = { start: "Start", maintain: "Maintain", harvest: "Harvest", venue: "Venue" };
const defaultQuickCheck: QuickCheckState = { exceptions: [], left: [], other: "" };
const ww = String.fromCharCode(119, 101, 101, 100);
const WW = ww.charAt(0).toUpperCase() + ww.slice(1);
const stillFull = "Still " + ww + "y";
const tooFull = "Too " + ww + "y";
const moreCleanout = "More " + ww + "s";
const exceptionOptions = ["Thin crop", "No crop", "Some gaps", "Many gaps", stillFull, tooFull, "Plan changed", "Not checked"];
const leftOptions = [moreCleanout, "Gaps need patching", "Too wet", "Could not find", "Needs decision", "Other note"];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(dateIso: string, days: number) { const d = new Date(`${dateIso}T12:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function prettyDate(dateIso: string | null | undefined) { if (!dateIso) return "No date"; const d = new Date(`${dateIso}T12:00:00`); return Number.isNaN(d.getTime()) ? dateIso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function clean(value: string | null | undefined) { return (value ?? "").replace(/urgent|high|normal|low/gi, "").replace(/truth/gi, "state").replace(/Anna/g, "crew").replace(/Lex/g, "crew").replace(/\s+·\s+·\s+/g, " · ").replace(/^\s*·\s*|\s*·\s*$/g, "").trim(); }
function taskSortValue(task: AtlasTaskCard) { return `${task.due_date ?? "9999-12-31"}-${priorityRank[task.priority] ?? 9}-${task.title}`; }
function taskText(task: AtlasTaskCard) { return `${task.task_type ?? ""} ${task.title ?? ""}`.toLowerCase(); }
function metaString(task: AtlasTaskCard, key: string) { const value = task.metadata?.[key]; return typeof value === "string" ? value : null; }
function oldSurveyText(text: string) { return text.includes("walk field rows") || text.includes("confirm each bed"); }
function toggleValue(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

function laneForTask(task: AtlasTaskCard): LaneKey {
  const text = taskText(task);
  if (text.includes("harvest") || text.includes("cut") || text.includes("bucket") || text.includes("bundle")) return "harvest";
  if (text.includes("venue") || text.includes("guest") || text.includes("entry") || text.includes("courtyard")) return "venue";
  if (text.includes("sow") || text.includes("seed") || text.includes("plant") || text.includes("transplant") || text.includes("assign")) return "start";
  return "maintain";
}

function ticketAction(task: AtlasTaskCard) {
  const explicit = metaString(task, "display_action");
  if (explicit) return explicit;
  const text = taskText(task);
  if (text.includes("mow")) return "Mow";
  if (oldSurveyText(text)) return WW;
  if (text.includes("check") && (text.includes(ww) || text.includes("hoe"))) return `Check + ${ww}`;
  if (text.includes("confirm") || text.includes("walk")) return "Confirm";
  if (text.includes("germin") || text.includes("check")) return "Check";
  if (text.includes("hoe")) return "Hoe";
  if (text.includes(ww)) return WW;
  if (text.includes("water")) return "Water";
  if (text.includes("patch")) return "Patch";
  if (text.includes("protect")) return "Protect";
  if (text.includes("mark")) return "Mark";
  if (text.includes("count")) return "Count";
  if (text.includes("harvest") || text.includes("cut")) return "Cut";
  if (text.includes("bucket")) return "Bucket";
  if (text.includes("stage")) return "Stage";
  if (text.includes("load")) return "Load";
  if (text.includes("clear") || text.includes("pull")) return "Clear";
  if (text.includes("flip")) return "Flip";
  if (text.includes("fix") || text.includes("repair")) return "Fix";
  if (text.includes("sow") || text.includes("seed")) return "Sow";
  if (text.includes("transplant") || text.includes("plant")) return "Plant";
  if (text.includes("move") || text.includes("assign")) return "Move";
  return laneLabels[laneForTask(task)];
}

function ticketObject(task: AtlasTaskCard) {
  if (ticketAction(task).toLowerCase() === "mow") return "";
  const text = taskText(task);
  if (text.includes("seed order")) return "seed";
  if (text.includes("germin")) return "sprouting";
  if (text.includes("tray") || text.includes("grow room")) return "trays";
  if (text.includes("bucket")) return "buckets";
  if (text.includes("stem")) return "stems";
  if (text.includes("gap")) return "gaps";
  if (text.includes("row")) return "rows";
  if (text.includes("bed")) return "beds";
  if (text.includes("pocket")) return "pockets";
  if (text.includes("vine")) return "vines";
  if (text.includes("arch")) return "arches";
  if (text.includes("entry")) return "entry";
  if (text.includes("path")) return "paths";
  return task.zone_label ? task.zone_label.replace(/ garden| rows| blocks/gi, "").toLowerCase() : "task";
}

function ticketTitle(task: AtlasTaskCard) { return [ticketAction(task), ticketObject(task)].filter(Boolean).join(" ").trim(); }
function placeName(task: AtlasTaskCard) { return metaString(task, "display_detail") ?? task.unlock_text ?? task.zone_label ?? "Elm Farm"; }
function objectLabels(task: AtlasTaskCard, limit = 12) { if (metaString(task, "display_detail")) return []; return task.objects.map((object) => object.object_label).filter(Boolean).slice(0, limit); }
function objectLine(task: AtlasTaskCard, limit = 4) { const labels = objectLabels(task, limit); return labels.length ? labels.join(" · ") : placeName(task); }
function locationLine(task: AtlasTaskCard) { const place = placeName(task); const objects = objectLine(task, 4); return objects && objects !== place ? `${place} · ${objects}` : place; }
function workWindowForTask(task: AtlasTaskCard, weatherLabel: string) { const text = taskText(task); const lane = laneForTask(task); const weather = weatherLabel.toLowerCase(); if (weather.includes("rain") && (text.includes("germin") || text.includes("check") || text.includes("confirm"))) return "After rain"; if (text.includes("heat") || text.includes("water") || text.includes(ww) || text.includes("hoe") || lane === "harvest") return "Morning"; if (lane === "venue") return "Afternoon"; return ""; }
function latestOutcome(task: AtlasTaskCard) { return task.task_outcomes?.[0] ?? null; }
function carryoverLabel(task: AtlasTaskCard, today: string) { const outcome = latestOutcome(task); if (task.status === "blocked" || outcome?.outcome === "blocked") return "Waiting"; if (outcome?.outcome === "partial") return "Needs next step"; if (task.due_date && task.due_date < today) return `Carried from ${prettyDate(task.due_date)}`; if (!task.due_date) return ""; if (task.due_date === today) return "Today"; return prettyDate(task.due_date); }
function isCarryoverTask(task: AtlasTaskCard, today: string) { const outcome = latestOutcome(task); return task.status === "blocked" || outcome?.outcome === "blocked" || outcome?.outcome === "partial" || Boolean(task.due_date && task.due_date < today); }
function rowMeta(task: AtlasTaskCard, today: string, weatherLabel: string) { return [locationLine(task), workWindowForTask(task, weatherLabel), carryoverLabel(task, today)].filter(Boolean).join(" · "); }
function needsCapture(task: AtlasTaskCard) { const action = ticketAction(task).toLowerCase(); return [ww, "check", `check + ${ww}`, "hoe", "protect", "patch", "water"].includes(action); }

function detailLines(task: AtlasTaskCard) {
  const fromNote = (task.note ?? "").split(".").map((line) => clean(line)).filter((line) => line && line.toLowerCase() !== placeName(task).toLowerCase());
  const fromResources = task.resource_requirements.map((req) => clean(req.note || [req.quantity_needed, req.unit, req.resource_label].filter(Boolean).join(" "))).filter(Boolean);
  return Array.from(new Set([...fromResources, ...fromNote]));
}

function quickCheckNote(state: QuickCheckState) { const exceptions = state.exceptions; const notChecked = exceptions.includes("Not checked"); const crop = notChecked ? "not checked" : exceptions.includes("No crop") ? "none" : exceptions.includes("Thin crop") ? "thin" : "okay"; const gaps = notChecked ? "not checked" : exceptions.includes("Many gaps") ? "many" : exceptions.includes("Some gaps") ? "some" : "okay"; const cleanState = notChecked ? "not checked" : exceptions.includes(tooFull) ? "heavy" : exceptions.includes(stillFull) ? "partial" : "enough"; const plan = exceptions.includes("Plan changed") ? "changed" : "same"; return ["Quick check: expected unless noted", `Exceptions: ${exceptions.length ? exceptions.join(", ") : "none"}`, `Crop: ${crop}`, `Gaps: ${gaps}`, `Clean: ${cleanState}`, `Plan: ${plan}`, state.left.length ? `Left: ${state.left.join(", ")}` : null, state.other.trim() ? `Note: ${state.other.trim()}` : null].filter(Boolean).join("\n"); }
async function postOutcome(task: AtlasTaskCard, outcome: Outcome, note = "") { const response = await fetch("/api/atlas/task-outcome", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ taskId: task.task_id, outcome, note, reason: note, laneKey: laneForTask(task), workKey: ticketAction(task).toLowerCase().replace(/\s+/g, "_") }) }); const data = (await response.json()) as { ok?: boolean; error?: string; details?: string }; if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task update failed."); }
async function postNote(task: AtlasTaskCard, note: string) { const response = await fetch("/api/atlas/task-note", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ taskId: task.task_id, note, laneKey: laneForTask(task) }) }); const data = (await response.json()) as { ok?: boolean; error?: string; details?: string }; if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task note failed."); }

function TaskSummaryButton({ task, selected, onSelect, today, weatherLabel }: { task: AtlasTaskCard; selected: boolean; onSelect: () => void; today: string; weatherLabel: string }) { const windowLabel = workWindowForTask(task, weatherLabel); return <button type="button" className={selected ? "atlas-task-page-row selected" : "atlas-task-page-row"} onClick={onSelect}><div><strong>{ticketTitle(task)}</strong><span>{rowMeta(task, today, weatherLabel)}</span></div>{windowLabel ? <small>{windowLabel}</small> : null}</button>; }
function ChipGroup({ label, values, selected, onToggle }: { label: string; values: string[]; selected: string[]; onToggle: (value: string) => void }) { return <div className="atlas-quick-check-group"><span>{label}</span><div>{values.map((value) => <button type="button" key={value} className={selected.includes(value) ? "selected" : ""} onClick={() => onToggle(value)}>{value}</button>)}</div></div>; }
function DetailCard({ lines }: { lines: string[] }) { if (!lines.length) return null; return <section className="atlas-task-detail-card"><strong>Tools needed / stored</strong>{lines.map((line) => <p key={line}>{line}</p>)}</section>; }

function ActiveTaskCard({ task, onChange, today, weatherLabel }: { task: AtlasTaskCard; onChange: () => Promise<void>; today: string; weatherLabel: string }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<Outcome | null>(null);
  const [quickCheck, setQuickCheck] = useState<QuickCheckState>(defaultQuickCheck);
  const labels = objectLabels(task, 12);
  const details = detailLines(task);
  const windowLabel = workWindowForTask(task, weatherLabel);
  function resetQuickCheck() { setPendingOutcome(null); setQuickCheck(defaultQuickCheck); }
  function updateExceptions(value: string) { setQuickCheck((current) => ({ ...current, exceptions: toggleValue(current.exceptions, value) })); }
  function updateLeft(value: string) { setQuickCheck((current) => ({ ...current, left: toggleValue(current.left, value) })); }
  async function submit(outcome: Outcome, note = "") { try { setSaving(outcome); setMessage(null); await postOutcome(task, outcome, note); await onChange(); resetQuickCheck(); setMessage(outcome === "done" ? "Done." : "Saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Task update failed."); } finally { setSaving(null); } }
  function startSave(outcome: Outcome) { if (outcome !== "blocked" && needsCapture(task)) { setPendingOutcome(outcome); setQuickCheck(defaultQuickCheck); return; } if (outcome === "blocked") { void submit(outcome, "Stuck"); return; } const note = outcome === "done" ? "" : window.prompt(outcome === "partial" ? "Left?" : "Note", "") ?? ""; void submit(outcome, note); }
  function saveQuickCheck() { void submit(pendingOutcome ?? "done", quickCheckNote(quickCheck)); }
  async function addNote() { const note = window.prompt("Note", "")?.trim(); if (!note) return; try { setSaving("note"); setMessage(null); await postNote(task, note); await onChange(); setMessage("Note saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Task note failed."); } finally { setSaving(null); } }
  return <article className="atlas-task-page-active atlas-task-ticket-card"><div className="atlas-task-page-kicker"><span>Up Now</span><small>{laneLabels[laneForTask(task)]}</small></div><h1>{ticketTitle(task).toUpperCase()}</h1><div className="atlas-task-page-time-row">{windowLabel ? <span>{windowLabel}</span> : null}<span>{task.due_date ? prettyDate(task.due_date) : carryoverLabel(task, today)}</span></div><section className="atlas-task-place-card"><strong>{placeName(task)}</strong>{labels.length ? <div className="atlas-task-place-chips">{labels.map((label) => <span key={label}>{label}</span>)}</div> : null}</section><DetailCard lines={details} />{pendingOutcome ? <section className="atlas-quick-check-card"><strong>{pendingOutcome === "partial" ? "More" : "Quick check"}</strong><p><b>Expected</b><br />Crop okay · No major gaps · Clean enough · Plan same</p>{pendingOutcome === "partial" ? <ChipGroup label="What is left?" values={leftOptions} selected={quickCheck.left} onToggle={updateLeft} /> : null}<ChipGroup label="Anything different?" values={exceptionOptions} selected={quickCheck.exceptions} onToggle={updateExceptions} />{quickCheck.left.includes("Other note") ? <textarea aria-label="Other note" placeholder="Other note" value={quickCheck.other} onChange={(event) => setQuickCheck((current) => ({ ...current, other: event.target.value }))} /> : null}<div className="atlas-quick-check-actions"><button type="button" onClick={resetQuickCheck}>Cancel</button><button type="button" className="save" disabled={Boolean(saving)} onClick={saveQuickCheck}>{saving ? "Saving" : "Save"}</button></div></section> : <div className="atlas-task-page-actions"><button type="button" className="done" disabled={Boolean(saving)} onClick={() => startSave("done")}>{saving === "done" ? "Saving" : "Done"}</button><button type="button" disabled={Boolean(saving)} onClick={() => startSave("partial")}>{saving === "partial" ? "Saving" : "More"}</button><button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => startSave("blocked")}>{saving === "blocked" ? "Saving" : "Stuck"}</button><button type="button" disabled={Boolean(saving)} onClick={() => void addNote()}>{saving === "note" ? "Saving" : "Note"}</button></div>}{message ? <p className="atlas-task-page-message">{message}</p> : null}</article>;
}

export default function AtlasTaskPage() {
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]); const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null); const [selectedLane, setSelectedLane] = useState<LaneKey | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [weatherLabel, setWeatherLabel] = useState("live weather loading…"); const [message, setMessage] = useState<string | null>(null); const activeTaskAnchorRef = useRef<HTMLDivElement | null>(null); const today = todayIso(); const nextWeek = addDaysIso(today, 7);
  async function loadTasks() { try { setLoading(true); setError(null); const response = await fetchAtlasTaskCards(); setTasks((response.taskCards ?? []).filter((task) => task.status !== "archived").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)))); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Tasks failed."); } finally { setLoading(false); } }
  async function loadWeather() { try { const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" }); const data = (await response.json()) as WeatherResponse; setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable"); } catch { setWeatherLabel("weather unavailable"); } }
  useEffect(() => { const params = new URLSearchParams(window.location.search); const taskId = params.get("taskId"); const lane = params.get("lane") as LaneKey | null; if (taskId) setSelectedTaskId(taskId); if (lane && laneLabels[lane]) setSelectedLane(lane); void loadTasks(); void loadWeather(); }, []);
  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open" || task.status === "blocked"), [tasks]); const visibleTasks = useMemo(() => selectedLane ? openTasks.filter((task) => laneForTask(task) === selectedLane) : openTasks, [openTasks, selectedLane]); const todayTasks = useMemo(() => visibleTasks.filter((task) => !task.due_date || task.due_date <= today), [visibleTasks, today]); const nextTasks = useMemo(() => visibleTasks.filter((task) => task.due_date && task.due_date > today && task.due_date <= nextWeek), [visibleTasks, nextWeek, today]); const nextWorkTasks = useMemo(() => (todayTasks.length ? todayTasks : nextTasks).slice(0, 3), [nextTasks, todayTasks]); const laterWorkTasks = useMemo(() => (todayTasks.length ? todayTasks : nextTasks).slice(3), [nextTasks, todayTasks]); const carryoverTasks = useMemo(() => visibleTasks.filter((task) => isCarryoverTask(task, today)).slice(0, 5), [visibleTasks, today]); const matchingLane = useMemo(() => selectedLane ? openTasks.filter((task) => laneForTask(task) === selectedLane) : [], [openTasks, selectedLane]); const selectedTask = useMemo(() => { if (selectedTaskId) return tasks.find((task) => task.task_id === selectedTaskId) ?? null; if (matchingLane.length) return matchingLane[0]; return nextWorkTasks[0] ?? todayTasks[0] ?? nextTasks[0] ?? openTasks[0] ?? null; }, [matchingLane, nextTasks, nextWorkTasks, openTasks, selectedTaskId, tasks, todayTasks]);
  function scrollToActiveTask() { window.setTimeout(() => { activeTaskAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0); } function selectTask(taskId: string) { setSelectedTaskId(taskId); scrollToActiveTask(); } function selectLane(lane: LaneKey) { setSelectedLane((current) => current === lane ? null : lane); setSelectedTaskId(null); scrollToActiveTask(); } async function handleTaskChanged() { await loadTasks(); setSelectedTaskId(null); } async function addHeaderNote() { if (!selectedTask) { setMessage("Choose a task first."); return; } const note = window.prompt("Note", "")?.trim(); if (!note) return; try { setMessage(null); await postNote(selectedTask, note); await loadTasks(); setMessage("Note saved."); } catch (noteError) { setMessage(noteError instanceof Error ? noteError.message : "Task note failed."); } } function renderTaskRows(rows: AtlasTaskCard[], empty: string) { return rows.length === 0 ? <p className="atlas-task-page-muted">{empty}</p> : rows.map((task) => <TaskSummaryButton key={task.task_id} task={task} selected={task.task_id === selectedTask?.task_id} onSelect={() => selectTask(task.task_id)} today={today} weatherLabel={weatherLabel} />); }
  return <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell"><section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone"><header className="atlas-phone-top atlas-dashboard-top"><Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link><span className="atlas-weather-line">{weatherLabel}</span><button type="button" className="atlas-note-plus" aria-label="Add task note" onClick={() => void addHeaderNote()}>+</button></header><div className="atlas-task-page-body"><section className="atlas-task-page-hero"><span>Today · {prettyDate(today)}</span><h2>Production Setup</h2><p>{nextWorkTasks.length} next · {laterWorkTasks.length} later · {carryoverTasks.length} waiting</p><div className="atlas-task-page-lanes">{(Object.keys(laneLabels) as LaneKey[]).map((lane) => { const count = openTasks.filter((task) => laneForTask(task) === lane).length; return <button key={lane} type="button" className={selectedLane === lane ? "selected" : ""} onClick={() => selectLane(lane)}>{laneLabels[lane]} <b>{count}</b></button>; })}</div></section>{loading ? <div className="atlas-task-page-empty">Loading tasks.</div> : null}{error ? <div className="atlas-task-page-empty error">{error}</div> : null}{message ? <div className="atlas-task-page-empty">{message}</div> : null}{!loading && !selectedTask ? <div className="atlas-task-page-empty">No open tasks.</div> : null}{selectedTask ? <div ref={activeTaskAnchorRef} className="atlas-task-page-active-anchor"><ActiveTaskCard task={selectedTask} onChange={handleTaskChanged} today={today} weatherLabel={weatherLabel} /></div> : null}<section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>Next</span><small>{nextWorkTasks.length}</small></div>{renderTaskRows(nextWorkTasks, "No next tasks ready.")}</section><section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>Later</span><small>{laterWorkTasks.length}</small></div>{renderTaskRows(laterWorkTasks, "Nothing queued later yet.")}</section><section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>Waiting</span><small>{carryoverTasks.length}</small></div>{renderTaskRows(carryoverTasks, "No carried or waiting tasks.")}</section><section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>This Week</span><small>{nextTasks.length}</small></div>{renderTaskRows(nextTasks, "No scheduled tasks in the next week.")}</section></div></section></main>;
}
