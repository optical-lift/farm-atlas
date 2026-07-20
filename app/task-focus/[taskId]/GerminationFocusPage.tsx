"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type GerminationOutcome = "thin" | "on_target" | "patch";

type GerminationTask = {
  id: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
  dueDate?: string | null;
  sownDate?: string | null;
  plantedDate?: string | null;
  plantingMethod?: string | null;
  cycleState?: string | null;
  expectedGerminationStart?: string | null;
  expectedGerminationEnd?: string | null;
  expectedHarvestStart?: string | null;
  expectedHarvestEnd?: string | null;
  targetSpacingInches?: number | null;
};

type WeatherResponse = { ok?: boolean; label?: string };

type HydratedFacts = {
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
  sownDate: string | null;
  plantingMethod: string | null;
  cycleState: string | null;
  expectedGerminationStart: string | null;
  expectedGerminationEnd: string | null;
  expectedHarvestStart: string | null;
  expectedHarvestEnd: string | null;
  spacing: string | null;
  targetSpacingInches: number | null;
};

function returnDestination() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "";
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateIso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "";
  if (start && end) {
    const startDate = new Date(`${start}T12:00:00`);
    const endDate = new Date(`${end}T12:00:00`);
    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      const sameMonth = startDate.getMonth() === endDate.getMonth();
      return sameMonth
        ? `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${endDate.toLocaleDateString("en-US", { day: "numeric" })}`
        : `${prettyDate(start)}–${prettyDate(end)}`;
    }
  }
  return prettyDate(start || end);
}

function cropName(cropLabel: string, variety: string | null) {
  if (!variety) return cropLabel;
  return variety.toLowerCase().includes(cropLabel.toLowerCase()) ? variety : `${variety} ${cropLabel}`;
}

function plantingRecordLabel(method: string | null, dateIso: string | null) {
  if (!dateIso) return "";
  const date = prettyDate(dateIso);
  const normalized = (method || "").toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (normalized.includes("transplant") || normalized.includes("plug") || normalized.includes("division")) return `Transplanted ${date}`;
  if (normalized.includes("direct_sow") || normalized === "sown" || normalized === "sow") return `Direct sown ${date}`;
  return `Planted ${date}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function compactSpacing(value: unknown) {
  if (!Array.isArray(value)) return null;
  const lines = value.filter((line): line is string => typeof line === "string");
  const rowLine = lines.find((line) => /row/i.test(line));
  const spacingLine = lines.find((line) => /apart|spacing|inch|"|″/i.test(line));
  const rowMatch = rowLine?.match(/(\d+(?:\.\d+)?)\s*rows?/i);
  const spacingMatch = spacingLine?.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"|″)/i);
  return [rowMatch ? `${rowMatch[1]} rows` : "", spacingMatch ? `${spacingMatch[1]}″ spacing` : ""].filter(Boolean).join(" · ") || null;
}

export default function GerminationFocusPage({ task }: { task: GerminationTask }) {
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [facts, setFacts] = useState<HydratedFacts>({
    cropLabel: task.cropLabel,
    variety: task.variety,
    objectLabel: task.objectLabel,
    sownDate: task.sownDate || task.plantedDate || null,
    plantingMethod: task.plantingMethod || null,
    cycleState: task.cycleState || null,
    expectedGerminationStart: task.expectedGerminationStart || null,
    expectedGerminationEnd: task.expectedGerminationEnd || null,
    expectedHarvestStart: task.expectedHarvestStart || null,
    expectedHarvestEnd: task.expectedHarvestEnd || null,
    spacing: task.targetSpacingInches ? `${task.targetSpacingInches}″ spacing` : null,
    targetSpacingInches: task.targetSpacingInches || null,
  });

  const target = facts.targetSpacingInches;
  const isLettuceContainer = facts.cropLabel.toLowerCase().includes("lettuce");
  const displayCrop = useMemo(() => cropName(facts.cropLabel, facts.variety), [facts.cropLabel, facts.variety]);
  const plantingRecord = plantingRecordLabel(facts.plantingMethod, facts.sownDate);

  useEffect(() => {
    let active = true;

    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json() as Promise<WeatherResponse>)
      .then((data) => { if (active) setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"); })
      .catch(() => { if (active) setWeatherLabel("weather unavailable"); });

    void fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.id)}`, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { taskCards?: Array<{ metadata?: Record<string, unknown>; objects?: Array<{ object_label?: string }> }> }) => {
        if (!active) return;
        const card = data.taskCards?.[0];
        const metadata = card?.metadata ?? {};
        const spacing = compactSpacing(metadata.plant_spacing_lines);
        const spacingNumber = numberValue(metadata.target_spacing_inches)
          || numberValue(Array.isArray(metadata.plant_spacing_lines)
            ? metadata.plant_spacing_lines.map((line) => typeof line === "string" ? line.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"|″)/i)?.[1] : null).find(Boolean)
            : null);

        setFacts((current) => ({
          cropLabel: stringValue(metadata.crop_label) || current.cropLabel,
          variety: stringValue(metadata.crop_variety) || stringValue(metadata.variety) || current.variety || stringValue(metadata.crop_profile_variety),
          objectLabel: card?.objects?.map((object) => object.object_label).filter(Boolean).join(" · ") || stringValue(metadata.object_label) || current.objectLabel,
          sownDate: stringValue(metadata.source_sown_date) || stringValue(metadata.actual_sow_date) || current.sownDate,
          plantingMethod: stringValue(metadata.planting_method) || stringValue(metadata.default_planting_method) || current.plantingMethod,
          cycleState: stringValue(metadata.current_state) || stringValue(metadata.cycle_state) || current.cycleState,
          expectedGerminationStart: stringValue(metadata.expected_germination_start) || current.expectedGerminationStart,
          expectedGerminationEnd: stringValue(metadata.expected_germination_end) || current.expectedGerminationEnd,
          expectedHarvestStart: stringValue(metadata.expected_harvest_watch_start) || current.expectedHarvestStart,
          expectedHarvestEnd: stringValue(metadata.expected_harvest_watch_end) || current.expectedHarvestEnd,
          spacing: spacing || current.spacing,
          targetSpacingInches: spacingNumber || current.targetSpacingInches,
        }));
      })
      .catch(() => undefined);

    return () => { active = false; };
  }, [task.id]);

  async function submit(action: "not_yet" | "germinated", spacingOutcome?: GerminationOutcome) {
    try {
      setSaving(spacingOutcome || action);
      setMessage(null);
      const response = await fetch("/api/atlas/germination-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ taskId: task.id, action, spacingOutcome, targetSpacingInches: target }),
      });
      const data = (await response.json()) as { ok?: boolean; nextDate?: string; error?: string; details?: string };
      if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Germination update failed.");
      setMessage(action === "not_yet" ? `Not yet logged. Check again ${data.nextDate ?? "tomorrow"}.` : "Germination logged.");
      window.setTimeout(() => window.location.assign(returnDestination()), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
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
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <button type="button" className="atlas-note-plus" aria-label="Log germination result" onClick={() => setOutcomeOpen(true)}>+</button>
        </header>

        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-germination-task">
            <div className="atlas-task-page-kicker"><span>Up Now</span><small>Germination</small></div>
            <h1>{`${facts.cropLabel} · ${facts.objectLabel}`.toUpperCase()}</h1>
            <div className="atlas-task-page-time-row"><span>Germination</span><span>After rain</span><span>{prettyDate(task.dueDate)}</span></div>

            <section aria-label="Germination crop facts" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", margin: "18px 0 4px" }}>
              <div style={{ ...factCardStyle, gridColumn: "1 / -1" }}><small style={factLabelStyle}>Crop</small><strong style={{ ...factValueStyle, fontSize: "1.28rem", lineHeight: 1.15 }}>{displayCrop}</strong></div>
              <div style={factCardStyle}><small style={factLabelStyle}>Bed / location</small><strong style={factValueStyle}>{facts.objectLabel}</strong></div>
              {facts.spacing ? <div style={factCardStyle}><small style={factLabelStyle}>Spacing</small><strong style={factValueStyle}>{facts.spacing}</strong></div> : null}
              {plantingRecord ? <div style={{ ...factCardStyle, gridColumn: "1 / -1" }}><small style={factLabelStyle}>Planting</small><strong style={factValueStyle}>{plantingRecord}</strong></div> : null}
            </section>

            {(facts.expectedGerminationStart || facts.expectedGerminationEnd || facts.expectedHarvestStart || facts.expectedHarvestEnd) ? (
              <section className="atlas-task-detail-card" aria-label="Crop timing">
                <strong>Crop timing</strong>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", marginTop: "12px" }}>
                  {(facts.expectedGerminationStart || facts.expectedGerminationEnd) ? <div style={{ ...factCardStyle, padding: "12px 14px" }}><small style={factLabelStyle}>Germination window</small><strong style={{ ...factValueStyle, fontSize: "1.02rem" }}>{prettyRange(facts.expectedGerminationStart, facts.expectedGerminationEnd)}</strong></div> : null}
                  {(facts.expectedHarvestStart || facts.expectedHarvestEnd) ? <div style={{ ...factCardStyle, padding: "12px 14px" }}><small style={factLabelStyle}>Harvest watch</small><strong style={{ ...factValueStyle, fontSize: "1.02rem" }}>{prettyRange(facts.expectedHarvestStart, facts.expectedHarvestEnd)}</strong></div> : null}
                </div>
              </section>
            ) : null}

            <section className="atlas-germination-check-panel">
              {!outcomeOpen ? (
                <div className="atlas-germination-actions atlas-germination-primary-actions">
                  <button type="button" className="good" disabled={Boolean(saving)} onClick={() => setOutcomeOpen(true)}>Germinated</button>
                  <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => void submit("not_yet")}>{saving === "not_yet" ? "Saving…" : "Not yet"}</button>
                </div>
              ) : (
                <div className="atlas-germination-inline-log">
                  <div className="atlas-germination-check-head"><span>{isLettuceContainer ? `${displayCrop} pots` : `${displayCrop} spacing`}</span><strong>{isLettuceContainer ? "How did the seven lettuce pots germinate?" : target ? `How does the stand compare with the ${target}-inch target?` : "How does the stand look?"}</strong></div>
                  <div className="atlas-germination-actions atlas-germination-stand-actions">
                    <button type="button" className="good" disabled={Boolean(saving)} onClick={() => void submit("germinated", "thin")}>{saving === "thin" ? "Saving…" : isLettuceContainer ? "Great · multiple seedlings per pot · Thin" : `Great · closer than ${target ?? "target"} in · Thin`}</button>
                    <button type="button" className="spotty" disabled={Boolean(saving)} onClick={() => void submit("germinated", "on_target")}>{saving === "on_target" ? "Saving…" : isLettuceContainer ? "Good · one healthy seedling per pot · No action" : `Good · about ${target ?? "target"} in · No action`}</button>
                    <button type="button" className="poor" disabled={Boolean(saving)} onClick={() => void submit("germinated", "patch")}>{saving === "patch" ? "Saving…" : isLettuceContainer ? "Poor · empty or failed pots · Reseed" : `Poor · wider than ${target ?? "target"} in · Patch seed`}</button>
                    <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => setOutcomeOpen(false)}>Back</button>
                  </div>
                </div>
              )}
              {message ? <p className="atlas-task-page-message">{message}</p> : null}
            </section>
          </article>
        </div>
      </section>
    </main>
  );
}
