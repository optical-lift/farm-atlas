"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasCloseout,
  type AtlasCloseoutSummary,
} from "@/lib/atlas/closeout-client";
import { fetchAtlasFarmSnapshot, type AtlasFarmSnapshot } from "@/lib/atlas/farm-snapshot-client";
import { fetchAtlasProjects, type AtlasProjectCard, type AtlasProjectStepCard } from "@/lib/atlas/projects-client";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { saveAtlasInboxItem } from "@/lib/atlas/inbox-client";

type HomePanel = "inbox" | "projects" | "closeout" | null;
type WeatherResponse = { ok: boolean; label?: string; rainAge?: string; daysSinceRain?: number | null; error?: string };
type TaskLaneKey = "start" | "maintain" | "verify";
type TaskLane = { key: TaskLaneKey; label: string; action: string; summary: string };

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const defaultSnapshot: AtlasFarmSnapshot = { totalBeds: 0, growingBeds: 0, activeSqft: 0, sowingsLogged: 0, stemsLogged: 0 };
const taskLanes: TaskLane[] = [
  { key: "start", label: "Start", action: "Sow / Plant", summary: "Seed · plant · assign" },
  { key: "maintain", label: "Maintain", action: "Weed / Water / Protect", summary: "Keep beds usable" },
  { key: "verify", label: "Verify", action: "Check / Count / Confirm", summary: "Find what is true" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "unknown";
  const date = dateIso.includes("-") ? new Date(`${dateIso}T12:00:00`) : new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cleanLabel(value: string | null | undefined) {
  return (value ?? "").replace(/truth/gi, "state").replace(/\bAnna\b/g, "crew").replace(/\bLex\b/g, "crew");
}

function taskSortValue(card: AtlasTaskCard) {
  return `${card.due_date ?? "9999-12-31"}-${priorityRank[card.priority] ?? 9}-${card.title}`;
}

function taskLaneForCard(card: AtlasTaskCard): TaskLaneKey {
  const text = `${card.task_type} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  if (text.includes("sow") || text.includes("seed") || text.includes("plant") || text.includes("transplant") || text.includes("assign")) return "start";
  if (text.includes("check") || text.includes("confirm") || text.includes("count") || text.includes("germin") || text.includes("mark") || text.includes("walk")) return "verify";
  return "maintain";
}

function openCardsByLane(cards: AtlasTaskCard[], lane: TaskLaneKey) {
  return cards.filter((card) => taskLaneForCard(card) === lane);
}

function compactTaskLocation(task: AtlasTaskCard | undefined) {
  if (!task) return "Open task board";
  const objectLabels = task.objects.map((object) => object.object_label).filter(Boolean).slice(0, 2);
  return objectLabels.length ? objectLabels.join(" · ") : task.zone_label ?? "Elm Farm";
}

function projectCardKey(project: AtlasProjectCard) {
  return `${project.project_id}-${project.project_goal_id ?? project.project_key}`;
}

function uniqueProjects(projects: AtlasProjectCard[]) {
  const byId = new Map<string, AtlasProjectCard>();
  projects.forEach((project) => {
    if (!byId.has(project.project_id)) byId.set(project.project_id, project);
  });
  return Array.from(byId.values());
}

function projectSteps(project: AtlasProjectCard | null) {
  return [...(project?.steps ?? [])].sort((a, b) => (a.step_order ?? 999) - (b.step_order ?? 999));
}

function waitingProjectSteps(project: AtlasProjectCard | null) {
  return projectSteps(project)
    .filter((step) => step.task_id && step.task_status === "open")
    .sort((a, b) => `${a.task_due_date ?? "9999-12-31"}-${priorityRank[a.task_priority ?? "normal"] ?? 9}-${a.step_order}`.localeCompare(`${b.task_due_date ?? "9999-12-31"}-${priorityRank[b.task_priority ?? "normal"] ?? 9}-${b.step_order}`));
}

function panelTitle(panel: HomePanel) {
  if (panel === "inbox") return "Note";
  if (panel === "projects") return "Projects";
  if (panel === "closeout") return "Closeout";
  return "Atlas";
}

function TaskLaunchHero({ cards, loading }: { cards: AtlasTaskCard[]; loading: boolean }) {
  if (loading && cards.length === 0) {
    return <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller empty"><div className="atlas-task-controller-head"><span className="atlas-task-kicker">Today</span><span className="atlas-task-date">Loading</span></div><Link href="/task" className="atlas-task-active-card"><strong>Loading</strong><em>Atlas is loading the day.</em></Link></article>;
  }

  return <article className="atlas-home-box atlas-home-box-purple atlas-home-task-hero atlas-task-controller"><div className="atlas-task-controller-head"><div><span className="atlas-task-kicker">Today</span><em className="atlas-season-label">Production Setup</em></div><span className="atlas-task-date">{prettyDate(todayIso())}</span></div><div className="atlas-day-schedule">{taskLanes.map((lane, index) => { const laneCards = openCardsByLane(cards, lane.key); const firstTask = laneCards[0]; return <Link key={lane.key} href={`/task?lane=${lane.key}`} className={index === 0 ? "atlas-day-row primary" : "atlas-day-row"}><small>{laneCards.length}</small><strong>{lane.label}</strong><span>{lane.action}</span><em>{firstTask ? cleanLabel(firstTask.title) : lane.summary}</em><b>{firstTask ? "tasks →" : "open →"}</b></Link>; })}</div></article>;
}

function ProjectPanel({ projects }: { projects: AtlasProjectCard[] }) {
  const projectList = useMemo(() => uniqueProjects(projects), [projects]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectedProject = projectList.find((project) => project.project_id === selectedProjectId) ?? null;
  const selectedSteps = projectSteps(selectedProject);
  const waiting = waitingProjectSteps(selectedProject);

  if (!selectedProject) {
    return <section className="atlas-task-focus-section atlas-project-panel"><div className="atlas-project-list">{projectList.map((project) => <button key={projectCardKey(project)} type="button" className="atlas-project-card atlas-project-list-card" onClick={() => setSelectedProjectId(project.project_id)}><strong>{project.project_title}</strong><span>{project.goal_label ?? project.project_goal_text ?? project.target_window_label ?? "Project"}</span><small>{[project.zone_label, project.target_window_label, project.open_task_count ? `${project.open_task_count} open` : null].filter(Boolean).join(" · ")}</small></button>)}</div></section>;
  }

  const done = selectedProject.done_step_count ?? selectedSteps.filter((step) => step.step_status === "done").length;
  const total = selectedProject.step_count ?? selectedSteps.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return <section className="atlas-task-focus-section atlas-project-panel"><button type="button" className="atlas-project-back" onClick={() => setSelectedProjectId(null)}>← Projects</button><article className="atlas-project-detail-hero"><strong>{selectedProject.project_title}</strong>{selectedProject.project_goal_text ? <p>{selectedProject.project_goal_text}</p> : null}<div className="atlas-project-detail-meta"><span>{done}/{total} steps</span><span>{percent}%</span>{selectedProject.open_task_count ? <span>{selectedProject.open_task_count} open</span> : null}</div></article><div className="atlas-project-section"><div className="atlas-project-section-head"><span>Project Tasks</span><small>{waiting.length}</small></div>{waiting.length === 0 ? <p className="atlas-project-empty">No open linked tasks.</p> : <div className="atlas-project-task-list">{waiting.map((step: AtlasProjectStepCard) => <Link key={step.step_id} href={step.task_id ? `/task?taskId=${encodeURIComponent(step.task_id)}` : "/task"} className="atlas-project-task-card"><strong>{step.task_title ?? step.step_title}</strong><span>{[step.task_due_date ? prettyDate(step.task_due_date) : null, step.task_priority, selectedProject.zone_label].filter(Boolean).join(" · ")}</span></Link>)}</div>}</div></section>;
}

function FarmSnapshotBox({ snapshot, loading }: { snapshot: AtlasFarmSnapshot; loading: boolean }) {
  return <Link href="/zones" className="atlas-home-box atlas-home-box-white atlas-home-box-link atlas-farm-snapshot-box"><strong>Farm Snapshot</strong><div className="atlas-snapshot-grid"><span><b>{loading ? "…" : snapshot.growingBeds}</b> growing beds</span><span><b>{loading ? "…" : snapshot.activeSqft.toLocaleString()}</b> active sq ft</span><span><b>{loading ? "…" : snapshot.sowingsLogged}</b> sowings logged</span><span><b>{loading ? "…" : snapshot.stemsLogged}</b> stems logged</span></div></Link>;
}

function CloseoutPanel({ summaries, loading }: { summaries: AtlasCloseoutSummary[]; loading: boolean }) {
  return <section className="atlas-task-focus-section"><div className="atlas-closeout-grid">{loading ? <div className="atlas-empty">Loading closeout.</div> : null}{summaries.map((summary) => <article key={summary.period} className="atlas-closeout-card tidy"><div className="atlas-closeout-card-head"><strong>{summary.label}</strong><span>{prettyDate(summary.startDate)}–{prettyDate(summary.endDate)}</span></div><div className="atlas-closeout-pill-row soft"><span>{summary.counts.objectEvents} records</span><span>{summary.counts.openTasks} open</span><span>{summary.counts.tasksBlocked} blocked</span></div>{summary.carryForward.length > 0 ? <div className="atlas-closeout-section carry"><span>Carry forward</span>{summary.carryForward.map((line) => <p key={line}>{cleanLabel(line)}</p>)}</div> : null}</article>)}</div></section>;
}

export default function AtlasHomePage() {
  const [cards, setCards] = useState<AtlasTaskCard[]>([]);
  const [projects, setProjects] = useState<AtlasProjectCard[]>([]);
  const [snapshot, setSnapshot] = useState<AtlasFarmSnapshot>(defaultSnapshot);
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [openPanel, setOpenPanel] = useState<HomePanel>(null);
  const [inboxBody, setInboxBody] = useState("");
  const [inboxZoneKey, setInboxZoneKey] = useState("");
  const [inboxSaving, setInboxSaving] = useState(false);
  const [inboxMessage, setInboxMessage] = useState<string | null>(null);
  const [closeoutSummaries, setCloseoutSummaries] = useState<AtlasCloseoutSummary[]>([]);
  const [closeoutLoading, setCloseoutLoading] = useState(true);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const today = todayIso();

  async function loadCards() { try { setLoading(true); const response = await fetchAtlasTaskCards(); setCards((response.taskCards ?? []).filter((card) => card.status === "open").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)))); } finally { setLoading(false); } }
  async function loadProjects() { try { const response = await fetchAtlasProjects(); setProjects((response.projects ?? []).filter((project) => project.project_status === "active")); } catch {} }
  async function loadSnapshot() { try { setSnapshotLoading(true); const response = await fetchAtlasFarmSnapshot(); setSnapshot(response.snapshot ?? defaultSnapshot); } finally { setSnapshotLoading(false); } }
  async function loadCloseout() { try { setCloseoutLoading(true); const response = await fetchAtlasCloseout(); setCloseoutSummaries(response.summaries ?? []); } finally { setCloseoutLoading(false); } }
  async function loadWeather() { try { const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" }); const data = (await response.json()) as WeatherResponse; setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable"); } catch { setWeatherLabel("weather unavailable"); } }

  useEffect(() => { void loadCards(); void loadProjects(); void loadSnapshot(); void loadCloseout(); void loadWeather(); }, []);

  const homeProjects = uniqueProjects(projects).slice(0, 3);
  const monthSummary = closeoutSummaries.find((summary) => summary.period === "month");

  async function submitInbox() {
    const cleanBody = inboxBody.trim();
    if (!cleanBody) { setInboxMessage("Note required."); return; }
    try { setInboxSaving(true); setInboxMessage(null); await saveAtlasInboxItem({ body: cleanBody, zoneKey: inboxZoneKey || null }); setInboxBody(""); setInboxZoneKey(""); setInboxMessage("Saved."); }
    catch (inboxError) { setInboxMessage(inboxError instanceof Error ? inboxError.message : "Save failed."); }
    finally { setInboxSaving(false); }
  }

  return <main className="atlas-phone-shell atlas-home-shell"><section className="atlas-phone atlas-dashboard-phone"><header className="atlas-phone-top atlas-dashboard-top"><div className="atlas-phone-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></div><span className="atlas-weather-line">{weatherLabel}</span><button type="button" className="atlas-note-plus" aria-label="Add note" onClick={() => setOpenPanel("inbox")}>+</button></header><div className="atlas-home-grid"><TaskLaunchHero cards={cards} loading={loading} /><button type="button" className="atlas-home-box atlas-home-box-white" onClick={() => setOpenPanel("closeout")}><strong>Closeout</strong><em>{monthSummary ? `${monthSummary.counts.objectEvents} records · ${monthSummary.counts.openTasks} still open` : "Month record"}</em><div className="atlas-home-mini-list"><span>Today · {prettyDate(today)}</span><span>Review what changed</span></div></button><button type="button" className="atlas-home-box atlas-home-box-white atlas-projects-box" onClick={() => setOpenPanel("projects")}><strong>Projects</strong><div className="atlas-project-mini-list">{homeProjects.length ? homeProjects.map((project) => <span key={projectCardKey(project)}>{project.project_title}</span>) : <span>Loading projects</span>}</div></button><FarmSnapshotBox snapshot={snapshot} loading={snapshotLoading} /></div></section>{openPanel ? <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true"><div className="atlas-task-focus-phone"><div className="atlas-task-focus-topbar"><div><strong>{panelTitle(openPanel)}</strong></div><button type="button" onClick={() => setOpenPanel(null)}>Close</button></div><div className="atlas-task-focus-body">{openPanel === "projects" ? <ProjectPanel projects={projects} /> : null}{openPanel === "closeout" ? <CloseoutPanel summaries={closeoutSummaries} loading={closeoutLoading} /> : null}{openPanel === "inbox" ? <section className="atlas-task-focus-section"><div className="atlas-add-form"><select aria-label="Zone" value={inboxZoneKey} onChange={(event) => setInboxZoneKey(event.target.value)}><option value="">Whole farm</option></select><textarea aria-label="Note" value={inboxBody} onChange={(event) => setInboxBody(event.target.value)} placeholder="Note" /></div><button type="button" className="atlas-zone-action accent" style={{ width: "100%", border: 0, marginTop: 12 }} disabled={inboxSaving} onClick={() => void submitInbox()}>{inboxSaving ? "Saving" : "Save"}</button>{inboxMessage ? <p className="atlas-task-result-message">{inboxMessage}</p> : null}</section> : null}</div></div></section> : null}</main>;
}
