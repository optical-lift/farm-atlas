"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";

type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
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

type LinkedCropTask = AtlasTaskCard & {
  crop_label?: string | null;
  variety?: string | null;
  crop_profile_metadata?: Record<string, unknown> | null;
};

type TimingFactKey =
  | "sow_window"
  | "germination"
  | "transplant"
  | "first_bloom"
  | "display"
  | "harvest"
  | "clear_bed"
  | "expected_stems";

type TimingFact = {
  key: TimingFactKey;
  label: string;
  value: string;
};

type CropWorkFacts = {
  kind: "sowing" | "planting";
  primaryLabel: "Seed packet" | "Crop";
  primaryValue: string;
  location: string;
  patternLabel: "Spacing" | "Planting pattern";
  pattern: string;
};

const ALLOWED_RETURN_PATHS = new Set(["/", "/owner", "/marshall", "/children", "/task"]);

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
  const date = new Date(`${value}T12:00:00`);
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

function taskRoute(task: AtlasTaskCard) {
  return [
    task.action_key,
    task.task_type,
    metaString(task, "work_route"),
    metaString(task, "display_action"),
  ].filter(Boolean).join(" ").toLowerCase();
}

function isSowingTask(task: AtlasTaskCard) {
  const route = taskRoute(task);
  return route.includes("sow") || route.includes("seed");
}

function isPlantingTask(task: AtlasTaskCard) {
  const route = taskRoute(task);
  return !isSowingTask(task) && (route.includes("plant") || route.includes("transplant"));
}

function pluralBedPrefix(prefix: string) {
  return prefix.replace(/\bBed\s*$/i, "Beds ").replace(/\s+/g, " ");
}

function compactObjectLocations(task: AtlasTaskCard, fallbackLocation: string) {
  const labels = task.objects.map((object) => object.object_label).filter(Boolean);
  if (!labels.length) return metaString(task, "location_label") || fallbackLocation || "Elm Farm";
  if (labels.length === 1) return labels[0];

  const parsed = labels.map((label) => {
    const match = label.match(/^(.*?)(\d+)$/);
    return match ? { prefix: match[1].trimEnd(), number: Number(match[2]) } : null;
  });
  const first = parsed[0];
  if (first && parsed.every((item) => item && item.prefix === first.prefix)) {
    const numbers = parsed.map((item) => item!.number).sort((a, b) => a - b);
    const contiguous = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
    const prefix = pluralBedPrefix(first.prefix);
    return contiguous
      ? `${prefix}${numbers[0]}–${numbers[numbers.length - 1]}`
      : `${prefix}${numbers.join(" + ")}`;
  }

  return labels.join(" · ");
}

function cropSpacing(task: AtlasTaskCard, profile: Record<string, unknown>) {
  const metadataSpacingLines = stringArray(task.metadata?.plant_spacing_lines)
    .filter((line) => /row|spacing|inch|apart/i.test(line))
    .slice(0, 2);
  const profileSpacingLines = stringArray(profile.spacing_lines)
    .filter((line) => /row|spacing|inch|apart/i.test(line))
    .slice(0, 2);
  const rowsPerBed = numberValue(profile.rows_per_3ft_bed) ?? numberValue(task.metadata?.rows_per_3ft_bed);
  const spacingInches = numberValue(profile.in_row_spacing_in) ?? numberValue(task.metadata?.in_row_spacing_in);
  const spacingLines = metadataSpacingLines.length ? metadataSpacingLines : profileSpacingLines;

  return spacingLines.length
    ? spacingLines.join(" · ")
    : [
      rowsPerBed !== null ? `${rowsPerBed} rows per 3 ft bed` : "",
      spacingInches !== null ? `${spacingInches}-inch spacing` : "",
    ].filter(Boolean).join(" · ");
}

function cropWorkFacts(task: AtlasTaskCard, fallbackLocation: string): CropWorkFacts | null {
  const linked = task as LinkedCropTask;
  const profile = linked.crop_profile_metadata ?? {};
  const location = compactObjectLocations(task, fallbackLocation);
  const pattern = cropSpacing(task, profile);

  if (isSowingTask(task)) {
    return {
      kind: "sowing",
      primaryLabel: "Seed packet",
      primaryValue: metaString(task, "seed_packet_name")
        || metaString(task, "seed_variety")
        || metaString(task, "crop_variety")
        || metaString(task, "variety")
        || linked.variety
        || linked.crop_label
        || metaString(task, "crop_label")
        || metaString(task, "crop")
        || "Seed packet not linked",
      location,
      patternLabel: "Spacing",
      pattern,
    };
  }

  if (isPlantingTask(task)) {
    return {
      kind: "planting",
      primaryLabel: "Crop",
      primaryValue: metaString(task, "crop_variety")
        || metaString(task, "variety")
        || linked.variety
        || metaString(task, "crop_label")
        || metaString(task, "crop")
        || linked.crop_label
        || "Crop not linked",
      location,
      patternLabel: "Planting pattern",
      pattern,
    };
  }

  return null;
}

function isGrowRoomSowing(task: AtlasTaskCard, location: string) {
  const context = [
    location,
    metaString(task, "collection_zone"),
    metaString(task, "location_label"),
    metaString(task, "display_detail"),
  ].join(" ").toLowerCase();
  return /grow\s*room|seed shelves/.test(context);
}

function timingFacts(lines: string[], includeTransplant: boolean, expectedStems: number | null) {
  const facts: TimingFact[] = [];
  const rest: string[] = [];
  const labels: Record<TimingFactKey, string> = {
    sow_window: "Sow window",
    germination: "Germination",
    transplant: "Transplant",
    first_bloom: "First bloom",
    display: "Expected display",
    harvest: "Harvest",
    clear_bed: "Clear bed",
    expected_stems: "Expected stems",
  };
  const keys: Record<string, TimingFactKey> = {
    "sow window": "sow_window",
    germination: "germination",
    transplant: "transplant",
    "first bloom": "first_bloom",
    display: "display",
    harvest: "harvest",
    "clear bed": "clear_bed",
  };

  for (const line of lines) {
    const match = line.match(/^Projected\s+(sow window|germination|transplant|first bloom|display|harvest|clear bed)\s*·\s*(.+)$/i);
    if (!match) {
      rest.push(line);
      continue;
    }
    const key = keys[match[1].toLowerCase()];
    if (!key) {
      rest.push(line);
      continue;
    }
    if (key === "transplant" && !includeTransplant) continue;
    facts.push({ key, label: labels[key], value: match[2].trim() });
  }

  if (expectedStems !== null) {
    facts.push({
      key: "expected_stems",
      label: labels.expected_stems,
      value: expectedStems.toLocaleString("en-US"),
    });
  }

  return { facts, rest };
}

function returnDestination(fallback: string) {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && ALLOWED_RETURN_PATHS.has(returnTo) ? returnTo : fallback;
}

export default function CanonicalAssignedTaskDetail({ task: initialTask, childTasks: initialChildren, assignee }: Props) {
  const [task, setTask] = useState(initialTask);
  const [children, setChildren] = useState(initialChildren);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, []);

  const display = useMemo(() => atlasTaskDisplay(task), [task]);
  const allLines = detailLines(task);
  const detailHeading = metaString(task, "detail_heading") || "Details";
  const production = productionContext(task);
  const varieties = stringArray(production?.varieties);
  const targetAreas = stringArray(production?.target_areas);
  const gapFillPercent = numberValue(production?.target_gap_fill_percent);
  const rowsPerBed = numberValue(production?.rows_per_bed);
  const spacingInches = numberValue(production?.target_spacing_inches);
  const stemsPerPlant = numberValue(production?.marketable_stems_per_plant);
  const cropWork = cropWorkFacts(task, display.location);
  const expectedStems = numberValue(task.metadata?.expected_stems);
  const timing = timingFacts(
    allLines,
    cropWork?.kind === "sowing" ? isGrowRoomSowing(task, cropWork.location) : true,
    expectedStems,
  );
  const lines = cropWork?.kind === "sowing" ? timing.rest : allLines;

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

  async function reschedule(targetDate: string, reason: string) {
    try {
      setSaving("reschedule");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "rescheduled",
        targetDate,
        reason,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { assigneeKey: assignee.key },
      });
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
  }

  async function moveToNextDay() {
    try {
      setSaving("reschedule");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "rescheduled",
        reason: "Moved to next Elm Farm calendar day from assigned task page",
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { assigneeKey: assignee.key, scheduleIntent: "next_day" },
      });
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
  }

  const factCardStyle = { padding: "14px 16px", border: "1px solid rgba(111, 97, 76, .24)", borderRadius: "18px" } as const;
  const factLabelStyle = { display: "block", fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", opacity: .62 } as const;
  const factValueStyle = { display: "block", marginTop: "3px", lineHeight: 1.2 } as const;

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
          <article className="atlas-task-page-active atlas-task-ticket-card">
            <section className="atlas-task-place-card" aria-label={`Assigned to ${assignee.label}`}>
              <small>Assigned to</small>
              <strong>{assignee.label.toUpperCase()}</strong>
            </section>
            <div className="atlas-task-page-kicker">
              <span>Up Now</span>
              <small>{task.task_type.replaceAll("_", " ")}</small>
            </div>
            <h1>{display.title.toUpperCase()}</h1>
            <div className="atlas-task-page-time-row">
              <span>{metaString(task, "display_action") || task.action_key || "Work"}</span>
              <span>{prettyDate(task.due_date)}</span>
            </div>

            {cropWork ? (
              <section
                className="atlas-task-sowing-facts"
                aria-label={cropWork.kind === "sowing" ? "Sowing specification" : "Planting specification"}
                style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", margin: "18px 0 4px" }}
              >
                <div style={{ ...factCardStyle, gridColumn: "1 / -1" }}>
                  <small style={factLabelStyle}>{cropWork.primaryLabel}</small>
                  <strong style={{ ...factValueStyle, fontSize: "1.28rem", lineHeight: 1.15 }}>{cropWork.primaryValue}</strong>
                </div>
                <div style={factCardStyle}>
                  <small style={factLabelStyle}>Bed / location</small>
                  <strong style={factValueStyle}>{cropWork.location}</strong>
                </div>
                <div style={factCardStyle}>
                  <small style={factLabelStyle}>{cropWork.patternLabel}</small>
                  <strong style={factValueStyle}>{cropWork.pattern || "Not linked"}</strong>
                </div>
              </section>
            ) : (
              <section className="atlas-task-place-card">
                <small>Location</small>
                <strong>{display.location || "Elm Farm"}</strong>
              </section>
            )}

            {production ? (
              <section className="atlas-task-detail-card atlas-production-context-card">
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

            {cropWork?.kind === "sowing" && timing.facts.length ? (
              <section className="atlas-task-detail-card" aria-label="Timing forecast">
                <strong>Timing forecast</strong>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", marginTop: "12px" }}>
                  {timing.facts.map((fact, index) => (
                    <div key={fact.key} style={{ ...factCardStyle, padding: "12px 14px", ...(timing.facts.length % 2 === 1 && index === 0 ? { gridColumn: "1 / -1" } : {}) }}>
                      <small style={factLabelStyle}>{fact.label}</small>
                      <strong style={{ ...factValueStyle, fontSize: "1.02rem" }}>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {lines.length ? (
              <section className="atlas-task-detail-card">
                <strong>{detailHeading}</strong>
                {lines.map((line) => <p key={line}>{line}</p>)}
              </section>
            ) : null}

            <TaskChildChecklist childTasks={children} onChange={async () => setChildren((current) => [...current])} />

            <div className="atlas-task-page-actions atlas-task-primary-actions">
              <button type="button" className="done" disabled={Boolean(saving)} onClick={() => void transition("done")}>
                {saving === "done" ? "Finishing" : "Done"}
              </button>
              {assignee.secondaryAction === "tomorrow" ? (
                <button type="button" disabled={Boolean(saving)} onClick={() => void moveToNextDay()}>
                  {saving === "reschedule" ? "Moving" : "Tomorrow"}
                </button>
              ) : (
                <button type="button" disabled={Boolean(saving)} onClick={() => setUnfinishedOpen((open) => !open)}>
                  {unfinishedOpen ? "Close" : "Unfinished"}
                </button>
              )}
            </div>

            {assignee.secondaryAction === "unfinished" && unfinishedOpen ? (
              <section className="atlas-task-unfinished-panel">
                <strong>What happened?</strong>
                <div className="atlas-task-unfinished-grid">
                  <button type="button" disabled={Boolean(saving)} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>Partly done</button>
                  <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void transition("blocked", window.prompt("What blocked it?", "")?.trim() || "Blocked")}>Blocked</button>
                </div>
                <span>Reschedule</span>
                <div className="atlas-task-unfinished-grid reschedule">
                  <button type="button" disabled={Boolean(saving)} onClick={() => void moveToNextDay()}>Tomorrow</button>
                  <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week from assigned task page")}>Next week</button>
                  <button type="button" disabled={Boolean(saving)} onClick={() => {
                    const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim();
                    if (date) void reschedule(date, "Rescheduled from assigned task page");
                  }}>Pick a date</button>
                </div>
                <span>Close without doing it</span>
                <div className="atlas-task-unfinished-grid quiet">
                  <button type="button" disabled={Boolean(saving)} onClick={() => void transition("changed_plan", window.prompt("What changed?", "")?.trim() || "Plan changed")}>Changed plan</button>
                  <button type="button" disabled={Boolean(saving)} onClick={() => void transition("not_relevant", window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant")}>Not relevant</button>
                </div>
              </section>
            ) : null}

            {message ? <p className="atlas-task-page-message">{message}</p> : null}
          </article>
        </div>
      </section>
    </main>
  );
}
