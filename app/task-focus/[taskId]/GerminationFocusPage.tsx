"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
};

type WeatherResponse = { ok?: boolean; label?: string };

function returnDestination() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "Not logged";
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateIso : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function prettyRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "Not logged";
  if (start && end) return `${prettyDate(start)} – ${prettyDate(end)}`;
  return prettyDate(start || end);
}

function prettyValue(value: string | null | undefined) {
  if (!value) return "Not logged";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function spacingPrompt(cropLabel: string) {
  const crop = cropLabel.toLowerCase();
  if (crop.includes("sunflower")) return "About how many inches between sunflower seedlings?";
  if (crop.includes("zinnia")) return "About how many inches between zinnia seedlings?";
  if (crop.includes("snapdragon")) return "About how many inches between snapdragon seedlings?";
  return `About how many inches between ${cropLabel.toLowerCase()} seedlings?`;
}

export default function GerminationFocusPage({ task }: { task: GerminationTask }) {
  const [spacingOpen, setSpacingOpen] = useState(false);
  const [spacingInches, setSpacingInches] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");

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

  async function submit(action: "not_yet" | "germinated") {
    try {
      const parsedSpacing = Number(spacingInches);
      if (action === "germinated" && (!Number.isFinite(parsedSpacing) || parsedSpacing <= 0 || parsedSpacing > 120)) {
        setMessage("Enter the observed inches between seedlings.");
        return;
      }

      setSaving(action);
      setMessage(null);
      const response = await fetch("/api/atlas/germination-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ taskId: task.id, action, spacingInches: action === "germinated" ? parsedSpacing : undefined }),
      });
      const data = (await response.json()) as { ok?: boolean; nextDate?: string; error?: string; details?: string };
      if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Germination update failed.");

      setMessage(action === "not_yet" ? `Not yet logged. Check again ${data.nextDate ?? "tomorrow"}.` : "Germination spacing logged.");
      window.setTimeout(() => window.location.assign(returnDestination()), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Germination update failed.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Elm Farm</span>
          </Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <button type="button" className="atlas-note-plus" aria-label="Log germination spacing" onClick={() => setSpacingOpen(true)}>+</button>
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

            <section className="atlas-task-record-card">
              <small>Bed Context</small>
              <div className="atlas-task-record-section"><span>Space</span><strong>{task.objectLabel}</strong></div>
              <div className="atlas-task-record-section"><span>Crop</span><strong>{task.variety ? `${task.variety} ${task.cropLabel}` : task.cropLabel}</strong></div>
              <div className="atlas-task-record-section"><span>Sown</span><strong>{prettyDate(task.sownDate || task.plantedDate)}</strong></div>
              <div className="atlas-task-record-section"><span>Method</span><strong>{prettyValue(task.plantingMethod)}</strong></div>
              <div className="atlas-task-record-section"><span>Current state</span><strong>{prettyValue(task.cycleState)}</strong></div>
              <div className="atlas-task-record-section"><span>Germination window</span><strong>{prettyRange(task.expectedGerminationStart, task.expectedGerminationEnd)}</strong></div>
              <div className="atlas-task-record-section"><span>Harvest watch</span><strong>{prettyRange(task.expectedHarvestStart, task.expectedHarvestEnd)}</strong></div>
            </section>

            <section className="atlas-germination-check-panel">
              {!spacingOpen ? (
                <div className="atlas-germination-actions atlas-germination-primary-actions">
                  <button type="button" className="good" disabled={Boolean(saving)} onClick={() => setSpacingOpen(true)}>Germinated</button>
                  <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => void submit("not_yet")}>
                    {saving === "not_yet" ? "Saving…" : "Not yet"}
                  </button>
                </div>
              ) : (
                <div className="atlas-germination-inline-log">
                  <div className="atlas-germination-check-head">
                    <span>{task.cropLabel} spacing</span>
                    <strong>{spacingPrompt(task.cropLabel)}</strong>
                  </div>
                  <label className="atlas-germination-note">
                    <span>Inches between seedlings</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.25"
                      max="120"
                      step="0.25"
                      value={spacingInches}
                      onChange={(event) => setSpacingInches(event.target.value)}
                      autoFocus
                    />
                  </label>
                  <div className="atlas-germination-actions atlas-germination-stand-actions">
                    <button type="button" className="good" disabled={Boolean(saving)} onClick={() => void submit("germinated")}>
                      {saving === "germinated" ? "Saving…" : "Log germination"}
                    </button>
                    <button type="button" className="not-yet" disabled={Boolean(saving)} onClick={() => setSpacingOpen(false)}>Back</button>
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
