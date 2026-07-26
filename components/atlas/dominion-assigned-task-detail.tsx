"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import TaskDominionTrail from "@/components/atlas/task-dominion-trail";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasRouteKeyForTask, atlasTaskDisplay } from "@/lib/atlas/task-display";
import { taskDominionOutcomeLabels } from "@/lib/atlas/task-dominion";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type LinkedCropTask = AtlasTaskCard & {
  crop_label?: string | null;
  variety?: string | null;
  crop_profile_metadata?: Record<string, unknown> | null;
};

type ProductionContext = {
  kind?: string;
  system_label?: string;
  varieties?: unknown;
  target_areas?: unknown;
  target_gap_fill_percent?: unknown;
  rows_per_bed?: unknown;
  target_spacing_inches?: unknown;
  marketable_stems_per_plant?: unknown;
  projected_germination_start?: string;
  projected_germination_end?: string;
  projected_harvest_start?: string;
  projected_harvest_end?: string;
  projection_basis?: string;
};

type OperatingFact = {
  label: string;
  value: string;
  wide?: boolean;
};

type TimingFact = {
  key: string;
  label: string;
  value: string;
};

const ALLOWED_RETURN_PATHS = new Set([
  "/",
  "/owner",
  "/marshall",
  "/children",
  "/task",
  "/manage",
  "/work/today",
  "/collections/mowing",
  "/collections/weeding",
  "/day",
  "/overview/week",
  "/overview/month",
]);

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function prettyDate(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function metaString(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function detailLines(task: AtlasTaskCard) {
  if (task.metadata?.hide_details === true || task.metadata?.hide_details === "true") return [];
  const value = task.metadata?.detail_lines;
  if (Array.isArray(value)) {
    return value.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  }
  return task.note ? [task.note] : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function productionContext(task: AtlasTaskCard) {
  const value = task.metadata?.production_context;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as ProductionContext;
  return context.kind === "sunflower_gap_fill" ? context : null;
}

function compactObjectLocations(task: AtlasTaskCard, fallback: string) {
  const labels = task.objects.map((object) => object.object_label).filter(Boolean);
  if (!labels.length) return metaString(task, "location_label") || fallback || "Elm Farm";
  if (labels.length <= 3) return labels.join(" · ");
  return `${labels.length} attached spaces`;
}

function spacingFact(task: AtlasTaskCard, profile: Record<string, unknown>) {
  const lines = [
    ...stringArray(task.metadata?.plant_spacing_lines),
    ...stringArray(profile.spacing_lines),
  ].filter((line) => /row|spacing|inch|apart/i.test(line));
  if (lines.length) return Array.from(new Set(lines)).slice(0, 2).join(" · ");

  const rows = numberValue(profile.rows_per_3ft_bed) ?? numberValue(task.metadata?.rows_per_3ft_bed);
  const spacing = numberValue(profile.in_row_spacing_in) ?? numberValue(task.metadata?.in_row_spacing_in);
  return [
    rows !== null ? `${rows} rows per 3 ft bed` : "",
    spacing !== null ? `${spacing}-inch spacing` : "",
  ].filter(Boolean).join(" · ");
}

function operatingFacts(task: AtlasTaskCard, fallbackLocation: string): OperatingFact[] {
  const route = atlasRouteKeyForTask(task);
  if (route !== "seed" && route !== "plant") return [];

  const linked = task as LinkedCropTask;
  const profile = linked.crop_profile_metadata ?? {};
  const isSeed = route === "seed";
  const primary = metaString(task, "seed_packet_name")
    || metaString(task, "seed_variety")
    || metaString(task, "crop_variety")
    || metaString(task, "variety")
    || linked.variety
    || linked.crop_label
    || metaString(task, "crop_label")
    || metaString(task, "crop")
    || (isSeed ? "Seed packet not linked" : "Crop not linked");

  return [
    { label: isSeed ? "Seed packet" : "Crop", value: primary, wide: true },
    { label: "Bed / location", value: compactObjectLocations(task, fallbackLocation) },
    { label: isSeed ? "Spacing" : "Planting pattern", value: spacingFact(task, profile) || "Not linked" },
  ];
}

function timingFacts(lines: string[], expectedStems: number | null) {
  const facts: TimingFact[] = [];
  const rest: string[] = [];
  const labels: Record<string, string> = {
    "sow window": "Sow window",
    germination: "Germination",
    transplant: "Transplant",
    "first bloom": "First bloom",
    display: "Expected display",
    harvest: "Harvest",
    "clear bed": "Clear bed",
  };

  for (const line of lines) {
    const match = line.match(/^Projected\s+(sow window|germination|transplant|first bloom|display|harvest|clear bed)\s*·\s*(.+)$/i);
    if (!match) {
      rest.push(line);
      continue;
    }
    const key = match[1].toLowerCase();
    facts.push({ key, label: labels[key] ?? match[1], value: match[2].trim() });
  }

  if (expectedStems !== null) {
    facts.push({ key: "expected_stems", label: "Expected stems", value: expectedStems.toLocaleString("en-US") });
  }

  return { facts, rest };
}

function isAllowedReturn(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  return ALLOWED_RETURN_PATHS.has(value.split(/[?#]/, 1)[0]);
}

function returnDestination(fallback: string) {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && isAllowedReturn(returnTo) ? returnTo : fallback;
}

export default function DominionAssignedTaskDetail({ task: initialTask, childTasks: initialChildren, assignee }: Props) {
  const [task, setTask] = useState(initialTask);
  const [children, setChildren] = useState(initialChildren);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, []);

  const display = useMemo(() => atlasTaskDisplay(task), [task]);
  const production = productionContext(task);
  const timing = timingFacts(detailLines(task), numberValue(task.metadata?.expected_stems));
  const contentLines = timing.rest;
  const explicitInstruction = metaString(task, "display_instruction") || metaString(task, "task_instruction") || metaString(task, "current_move");
  const instruction = explicitInstruction || contentLines[0] || display.title;
  const procedureLines = !explicitInstruction && contentLines[0] === instruction ? contentLines.slice(1) : contentLines;
  const detailHeading = metaString(task, "detail_heading") || "How to play this card";
  const facts = operatingFacts(task, display.location);
  const outcomeLabels = taskDominionOutcomeLabels(task);

  async function refreshTask() {
    const response = await fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.task_id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json() as { ok?: boolean; taskCards?: AtlasTaskCard[]; error?: string; details?: string };
    if (!response.ok || !data.ok || !data.taskCards?.[0]) {
      throw new Error(data.details || data.error || "Task refresh failed.");
    }
    setTask(data.taskCards[0]);
  }

  async function transition(outcome: Outcome, note = "") {
    try {
      setSaving(outcome);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: outcome,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { workClass: task.work_class, assigneeKey: assignee.key },
      });
      if (outcome === "done" || outcome === "not_relevant" || outcome === "changed_plan") {
        window.location.assign(returnDestination(assignee.listPath));
        return;
      }
      await refreshTask();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  async function reschedule(targetDate: string | null, reason: string, scheduleIntent?: string) {
    try {
      setSaving("reschedule");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "rescheduled",
        ...(targetDate ? { targetDate } : {}),
        reason,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { assigneeKey: assignee.key, ...(scheduleIntent ? { scheduleIntent } : {}) },
      });
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
  }

  const varieties = stringArray(production?.varieties);
  const targetAreas = stringArray(production?.target_areas);
  const gapFillPercent = numberValue(production?.target_gap_fill_percent);
  const rowsPerBed = numberValue(production?.rows_per_bed);
  const spacingInches = numberValue(production?.target_spacing_inches);
  const stemsPerPlant = numberValue(production?.marketable_stems_per_plant);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={assignee.listPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{assignee.label}</span>
          </Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href={assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${assignee.label} work`}>↩</Link>
        </header>

        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card">
            <TaskDominionTrail task={task} instruction={instruction} />

            {facts.length ? (
              <section className="atlas-task-operating-grid" aria-label="Operating facts">
                {facts.map((fact) => (
                  <div className={`atlas-task-operating-fact${fact.wide ? " wide" : ""}`} key={`${fact.label}:${fact.value}`}>
                    <small>{fact.label}</small>
                    <strong>{fact.value}</strong>
                  </div>
                ))}
              </section>
            ) : null}

            {production ? (
              <section className="atlas-production-context-card">
                <strong>{production.system_label || "Sunflower succession"}</strong>
                <p><b>Work type:</b> Production gap-fill recovery{gapFillPercent !== null ? ` · ${gapFillPercent}% target fill` : ""}</p>
                {targetAreas.length ? <p><b>Areas:</b> {targetAreas.join(" · ")}</p> : null}
                {varieties.length ? <p><b>Linked varieties:</b> {varieties.join(" · ")}</p> : null}
                {rowsPerBed !== null || spacingInches !== null ? (
                  <p><b>Planting pattern:</b> {rowsPerBed !== null ? `${rowsPerBed} rows per bed` : "Existing rows"}{spacingInches !== null ? ` · ${spacingInches}-inch spacing` : ""}{stemsPerPlant !== null ? ` · ${stemsPerPlant} marketable stem per plant` : ""}</p>
                ) : null}
                <p><b>Germination watch:</b> {prettyDate(production.projected_germination_start)}–{prettyDate(production.projected_germination_end)}</p>
                <p><b>Harvest watch:</b> {prettyDate(production.projected_harvest_start)}–{prettyDate(production.projected_harvest_end)}</p>
                {production.projection_basis ? <p><small>{production.projection_basis}</small></p> : null}
              </section>
            ) : null}

            {timing.facts.length ? (
              <section className="atlas-task-timing-wrap" aria-label="Timing forecast">
                <strong>Timing forecast</strong>
                <div className="atlas-task-timing-grid">
                  {timing.facts.map((fact) => (
                    <div className="atlas-task-operating-fact" key={`${fact.key}:${fact.value}`}>
                      <small>{fact.label}</small>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {procedureLines.length ? (
              <details className="atlas-task-procedure">
                <summary>
                  <strong>{detailHeading}</strong>
                  <span>{procedureLines.length} {procedureLines.length === 1 ? "step" : "steps"}</span>
                  <b aria-hidden="true">⌄</b>
                </summary>
                <div className="atlas-task-procedure-body">
                  {procedureLines.map((line) => <p key={line}>{line}</p>)}
                </div>
              </details>
            ) : null}

            <TaskChildChecklist childTasks={children} onChange={async () => setChildren((current) => [...current])} />

            <footer className="atlas-task-result-footer">
              <div className="atlas-task-result-heading">
                <small>Result</small>
                <strong>How did this move land?</strong>
              </div>

              <div className="atlas-task-result-actions">
                <button type="button" className="done" disabled={Boolean(saving)} onClick={() => void transition("done")}>
                  {saving === "done" ? "Finishing" : outcomeLabels.done}
                </button>
                <button type="button" disabled={Boolean(saving)} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>
                  {saving === "partial" ? "Saving" : outcomeLabels.partial}
                </button>
                <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void transition("blocked", window.prompt("What blocked it?", "")?.trim() || "Blocked")}>
                  {saving === "blocked" ? "Saving" : outcomeLabels.blocked}
                </button>
              </div>

              <details className="atlas-task-more-outcomes">
                <summary><span>Move or close this card</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-task-more-outcomes-body">
                  <span>Reschedule</span>
                  <div className="atlas-task-more-outcomes-grid">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(null, "Moved to next Elm Farm calendar day from assigned task page", "next_day")}>Tomorrow</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week from assigned task page")}>Next week</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => {
                      const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim();
                      if (date) void reschedule(date, "Rescheduled from assigned task page");
                    }}>Pick a date</button>
                  </div>
                  <span>Close without doing it</span>
                  <div className="atlas-task-more-outcomes-grid quiet">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void transition("changed_plan", window.prompt("What changed?", "")?.trim() || "Plan changed")}>Changed plan</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => void transition("not_relevant", window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant")}>Not relevant</button>
                  </div>
                </div>
              </details>
            </footer>

            {message ? <p className="atlas-task-page-message">{message}</p> : null}
          </article>
        </div>
      </section>
    </main>
  );
}
