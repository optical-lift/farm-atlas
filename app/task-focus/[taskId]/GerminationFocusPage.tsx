"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
      const startLabel = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const endLabel = endDate.toLocaleDateString("en-US", {
        month: startDate.getMonth() === endDate.getMonth() ? undefined : "short",
        day: "numeric",
      });
      return `${startLabel}–${endLabel}`;
    }
  }
  return prettyDate(start || end);
}

function prettyValue(value: string | null | undefined) {
  if (!value) return "";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cropName(task: GerminationTask) {
  return task.variety ? `${task.variety} ${task.cropLabel}` : task.cropLabel;
}

export default function GerminationFocusPage({ task }: { task: GerminationTask }) {
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const target = task.targetSpacingInches;
  const isLettuceContainer = task.cropLabel.toLowerCase().includes("lettuce");
  const sown = prettyDate(task.sownDate || task.plantedDate);
  const method = prettyValue(task.plantingMethod);
  const state = prettyValue(task.cycleState);
  const germinationWindow = prettyRange(task.expectedGerminationStart, task.expectedGerminationEnd);
  const harvestWindow = prettyRange(task.expectedHarvestStart, task.expectedHarvestEnd);
  const spacing = isLettuceContainer ? "1 healthy seedling" : target ? `${target}″ spacing` : "";

  useEffect(() => {
    let active = true;
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json() as Promise<WeatherResponse>)
      .then((data) => {
        if (active) setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable");
      })
      .catch(() => {
        if (active) setWeatherLabel("weather unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

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
      setMessage(action === "not_yet" ? `Check again ${data.nextDate ?? "tomorrow"}.` : "Germination logged.");
      window.setTimeout(() => window.location.assign(returnDestination()), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
    } finally {
      setSaving(null);
    }
  }

  const cardStyle = { padding: "14px 16px", border: "1px solid rgba(111, 97, 76, .24)", borderRadius: "18px" } as const;
  const labelStyle = { display: "block", fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", opacity: .62 } as const;
  const valueStyle = { display: "block", marginTop: "3px", lineHeight: 1.2 } as const;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Elm Farm</span>
          </Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <button type="button" className="atlas-note-plus" aria-label="Log germination result" onClick={() => setOutcomeOpen(true)}>+</button>
        </header>

        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-germination-task">
            <div className="atlas-task-page-kicker"><span>Up Now</span><small>Germination</small></div>
            <h1>{`${task.cropLabel} · ${task.objectLabel}`.toUpperCase()}</h1>
            <div className="atlas-task-page-time-row">
              <span>Germination</span>
              <span>After rain</span>
              <span>{prettyDate(task.dueDate)}</span>
            </div>

            <section aria-label="Germination crop data" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", margin: "18px 0 4px" }}>
              <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
                <small style={labelStyle}>Crop</small>
                <strong style={{ ...valueStyle, fontSize: "1.28rem", lineHeight: 1.15 }}>{cropName(task)}</strong>
              </div>
              <div style={cardStyle}>
                <small style={labelStyle}>Bed / location</small>
                <strong style={valueStyle}>{task.objectLabel}</strong>
              </div>
              {spacing ? (
                <div style={cardStyle}>
                  <small style={labelStyle}>{isLettuceContainer ? "Target per pot" : "Spacing"}</small>
                  <strong style={valueStyle}>{spacing}</strong>
                </div>
              ) : null}
              {sown ? (
                <div style={cardStyle}>
                  <small style={labelStyle}>Sown</small>
                  <strong style={valueStyle}>{sown}</strong>
                </div>
              ) : null}
              {method ? (
                <div style={cardStyle}>
                  <small style={labelStyle}>Method</small>
                  <strong style={valueStyle}>{method}</strong>
                </div>
              ) : null}
              {state ? (
                <div style={cardStyle}>
                  <small style={labelStyle}>Current state</small>
                  <strong style={valueStyle}>{state}</strong>
                </div>
              ) : null}
            </section>

            {(germinationWindow || harvestWindow) ? (
              <section className="atlas-task-detail-card" aria-label="Crop timing">
                <strong>Crop timing</strong>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", marginTop: "12px" }}>
                  {germinationWindow ? (
                    <div style={{ ...cardStyle, padding: "12px 14px" }}>
                      <small style={labelStyle}>Germination window</small>
                      <strong style={{ ...valueStyle, fontSize: "1.02rem" }}>{germinationWindow}</strong>
                    </div>
                  ) : null}
                  {harvestWindow ? (
                    <div style={{ ...cardStyle, padding: "12px 14px" }}>
                      <small style={labelStyle}>Harvest watch</small>
                      <strong style={{ ...valueStyle, fontSize: "1.02rem" }}>{harvestWindow}</strong>
                    </div>
                  ) : null}
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
                  <div className="atlas-germination-check-head">
                    <span>{isLettuceContainer ? `${cropName(task)} pots` : `${cropName(task)} spacing`}</span>
                    <strong>{isLettuceContainer ? "How did the seven lettuce pots germinate?" : target ? `How does the stand compare with the ${target}-inch target?` : "How does the stand look?"}</strong>
                  </div>
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
