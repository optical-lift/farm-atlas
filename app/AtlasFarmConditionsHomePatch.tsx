"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

type FarmConditionsResponse = {
  ok: boolean;
  farm: {
    id: string;
    name: string;
    locationLabel: string;
    timezone: string;
  };
  observedDate: string;
  headerLabel: string;
  weather: null | {
    condition: string;
    temperatureF: number | null;
    feelsLikeF: number | null;
    humidityPct: number | null;
    windMph: number | null;
    todayEstimateIn: number;
    sevenDayEstimateIn: number;
    forecast48hIn: number;
    forecastChancePct: number;
    daysSinceEstimatedWateringRain: number | null;
    sourceType: "area_model_estimate";
    sourceLabel: string;
  };
  rain: {
    statusLabel: string;
    gauge: {
      hasGaugeData: boolean;
      latest: null | {
        observationDate: string;
        amountIn: number;
        note: string | null;
        recordedAt: string;
      };
      sevenDayTotalIn: number;
      daysSinceWateringRain: number | null;
      wateringRainThresholdIn: number;
    };
    areaEstimate: null | {
      todayIn: number;
      sevenDayIn: number;
      daysSinceWateringRain: number | null;
    };
    forecast: null | {
      next48hIn: number;
      chancePct: number;
    };
  };
  moon: {
    phase: string;
    illuminationPct: number | null;
    direction: "waxing" | "waning" | "boundary";
    moonrise: string | null;
    moonset: string | null;
    closestPhase: null | {
      phase: string;
      dateIso: string | null;
      time: string | null;
    };
    sign: string;
    signSymbol: string;
    signQuality: "fruitful" | "productive" | "barren";
    source: "usno" | "calculated_fallback";
    guidance: {
      profileKey: string;
      traditional: true;
      strength: "strong" | "moderate" | "work_window";
      headline: string;
      detail: string;
      favoredActions: string[];
    };
    astronomySourceLabel: string;
    ruleSourceLabel: string;
  };
  lunarTaskHints: Array<{
    taskId: string;
    title: string;
    dueDate: string | null;
    family: string;
    fit: "favored" | "neutral" | "caution";
    reason: string;
  }>;
  precedence: string[];
};

function inches(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}\"`;
}

function smallDate(dateIso: string | null | undefined) {
  if (!dateIso) return "";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function rainAge(days: number | null) {
  if (days === null) return "No gauge watering-rain history";
  if (days === 0) return "Watering rain logged today";
  if (days === 1) return "1 day since watering rain";
  return `${days} days since watering rain`;
}

function weatherValue(conditions: FarmConditionsResponse) {
  if (!conditions.weather) return "Weather unavailable";
  const temp = conditions.weather.temperatureF === null ? "" : ` · ${conditions.weather.temperatureF}°`;
  return `${conditions.weather.condition}${temp}`;
}

function FarmConditionsPanel({
  conditions,
  loading,
  error,
  onReload,
}: {
  conditions: FarmConditionsResponse | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  async function recordRain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conditions || saving) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 30) {
      setSaveMessage("Enter a rain-gauge amount between 0 and 30 inches.");
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch("/api/atlas/farm-conditions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          farmId: conditions.farm.id,
          amountIn: parsed,
          observationDate: conditions.observedDate,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Rain reading could not be saved.");
      setAmount("");
      setSaveMessage("Elm rain gauge recorded.");
      onReload();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Rain reading could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !conditions) {
    return (
      <section className="atlas-farm-conditions-card is-loading" aria-label="Farm conditions loading">
        <span>Reading farm conditions…</span>
      </section>
    );
  }

  if (!conditions) {
    return (
      <section className="atlas-farm-conditions-card is-error" aria-label="Farm conditions unavailable">
        <div>
          <small>Farm conditions</small>
          <strong>{error || "Conditions are temporarily unavailable."}</strong>
        </div>
        <button type="button" onClick={onReload}>Try again</button>
      </section>
    );
  }

  const moonTimes = [
    conditions.moon.moonrise ? `Rise ${conditions.moon.moonrise}` : null,
    conditions.moon.moonset ? `Set ${conditions.moon.moonset}` : null,
  ].filter(Boolean).join(" · ");
  const gaugeLabel = conditions.rain.gauge.latest
    ? `${inches(conditions.rain.gauge.latest.amountIn)} on ${smallDate(conditions.rain.gauge.latest.observationDate)}`
    : "Not read yet";

  return (
    <section className="atlas-farm-conditions-card" aria-labelledby="atlas-farm-conditions-title">
      <header className="atlas-farm-conditions-head">
        <div>
          <small>Farm conditions · {conditions.farm.locationLabel}</small>
          <h2 id="atlas-farm-conditions-title">{conditions.farm.name}</h2>
        </div>
        <span>{weatherValue(conditions)}</span>
      </header>

      <div className="atlas-farm-conditions-grid">
        <article className="atlas-farm-condition-cell atlas-farm-weather-cell">
          <small>Weather now</small>
          <strong>{conditions.weather?.temperatureF === null || !conditions.weather ? "—" : `${conditions.weather.temperatureF}°`}</strong>
          <span>{conditions.weather?.condition ?? "Unavailable"}</span>
          <p>
            {conditions.weather?.feelsLikeF === null || !conditions.weather ? null : `Feels ${conditions.weather.feelsLikeF}°`}
            {conditions.weather?.windMph === null || !conditions.weather ? null : ` · Wind ${conditions.weather.windMph} mph`}
            {conditions.weather?.humidityPct === null || !conditions.weather ? null : ` · ${conditions.weather.humidityPct}% humidity`}
          </p>
        </article>

        <article className="atlas-farm-condition-cell atlas-farm-rain-cell">
          <small>Rain at Elm</small>
          <strong>{gaugeLabel}</strong>
          <span>{conditions.rain.statusLabel}</span>
          <p>
            Gauge 7 days {inches(conditions.rain.gauge.sevenDayTotalIn)}
            {conditions.rain.areaEstimate ? ` · Area estimate ${inches(conditions.rain.areaEstimate.sevenDayIn)}` : ""}
          </p>
        </article>

        <article className="atlas-farm-condition-cell atlas-farm-moon-cell" data-moon-direction={conditions.moon.direction}>
          <small>Moon · {conditions.moon.signSymbol} {conditions.moon.sign}</small>
          <strong>{conditions.moon.phase}</strong>
          <span>{conditions.moon.illuminationPct === null ? "Illumination unavailable" : `${conditions.moon.illuminationPct}% illuminated`}</span>
          <p>{moonTimes || conditions.moon.astronomySourceLabel}</p>
        </article>
      </div>

      <div className="atlas-farm-condition-summary-row">
        <span>
          <b>Next 48 hours</b>
          {conditions.rain.forecast
            ? `${inches(conditions.rain.forecast.next48hIn)} forecast · ${conditions.rain.forecast.chancePct}% chance`
            : "Forecast unavailable"}
        </span>
        <span>
          <b>Gauge memory</b>
          {rainAge(conditions.rain.gauge.daysSinceWateringRain)}
        </span>
      </div>

      <details className="atlas-farm-lunar-planner">
        <summary>
          <span>
            <small>Traditional Elm Almanac</small>
            <strong>{conditions.moon.guidance.headline}</strong>
          </span>
          <b aria-hidden="true">⌄</b>
        </summary>
        <div className="atlas-farm-lunar-body">
          <p>{conditions.moon.guidance.detail}</p>
          <div className="atlas-farm-lunar-actions" aria-label="Favored traditional work">
            {conditions.moon.guidance.favoredActions.map((action) => <span key={action}>{action}</span>)}
          </div>

          {conditions.lunarTaskHints.length ? (
            <section className="atlas-farm-lunar-task-list" aria-label="Atlas tasks compared with the lunar window">
              <h3>Current Atlas work</h3>
              {conditions.lunarTaskHints.map((task) => (
                <a key={task.taskId} href={`/task-focus/${encodeURIComponent(task.taskId)}`} data-lunar-fit={task.fit}>
                  <span>
                    <small>{task.fit}{task.dueDate ? ` · ${smallDate(task.dueDate)}` : ""}</small>
                    <strong>{task.title}</strong>
                    <em>{task.reason}</em>
                  </span>
                  <b aria-hidden="true">›</b>
                </a>
              ))}
            </section>
          ) : (
            <p className="atlas-farm-lunar-empty">No open sowing, planting, harvesting, or clearing task is inside the next 21 days.</p>
          )}

          <p className="atlas-farm-lunar-precedence">
            Atlas keeps the decision order: {conditions.precedence.join(" → ")}. Lunar timing advises; it does not move a viable crop window on its own.
          </p>
          <small className="atlas-farm-condition-source">
            Astronomy: {conditions.moon.astronomySourceLabel}. Guidance: {conditions.moon.ruleSourceLabel}. Weather and rainfall estimates are separate from the Elm gauge.
          </small>
        </div>
      </details>

      <details className="atlas-farm-rain-log">
        <summary>
          <span>
            <small>Farm memory</small>
            <strong>Log the Elm rain gauge</strong>
          </span>
          <b aria-hidden="true">⌄</b>
        </summary>
        <form onSubmit={recordRain}>
          <label htmlFor="atlas-rain-gauge-amount">Amount since the last reading</label>
          <div>
            <input
              id="atlas-rain-gauge-amount"
              type="number"
              inputMode="decimal"
              min="0"
              max="30"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              aria-describedby="atlas-rain-gauge-unit"
            />
            <span id="atlas-rain-gauge-unit">inches</span>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Record"}</button>
          </div>
          <p>Use the physical Elm gauge here. Atlas keeps this separate from the Marshfield-area estimate and the forecast.</p>
          {saveMessage ? <output aria-live="polite">{saveMessage}</output> : null}
        </form>
      </details>
    </section>
  );
}

export default function AtlasFarmConditionsHomePatch() {
  const pathname = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [conditions, setConditions] = useState<FarmConditionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (pathname !== "/") {
      setHost(null);
      return;
    }

    let cancelled = false;
    let observer: MutationObserver | null = null;

    const mount = () => {
      if (cancelled) return;
      const section = document.querySelector<HTMLElement>('section[aria-label="Farm seasons"]');
      if (!section) return;
      let node = section.querySelector<HTMLElement>(":scope > [data-atlas-farm-conditions-host]");
      if (!node) {
        node = document.createElement("div");
        node.dataset.atlasFarmConditionsHost = "true";
        section.prepend(node);
      }
      setHost(node);
    };

    mount();
    observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer?.disconnect();
      document.querySelectorAll("[data-atlas-farm-conditions-host]").forEach((node) => node.remove());
      setHost(null);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    let active = true;
    setLoading(true);
    setError(null);
    fetch("/api/atlas/farm-conditions", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json() as FarmConditionsResponse & { error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Farm conditions are unavailable.");
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setConditions(payload);
        const topLine = document.querySelector<HTMLElement>(".atlas-weather-line");
        if (topLine) {
          topLine.textContent = payload.headerLabel;
          topLine.dataset.atlasFarmConditions = "true";
        }
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Farm conditions are unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [pathname, reloadVersion]);

  const panel = useMemo(() => (
    <FarmConditionsPanel
      conditions={conditions}
      loading={loading}
      error={error}
      onReload={() => setReloadVersion((value) => value + 1)}
    />
  ), [conditions, loading, error]);

  if (!host || pathname !== "/") return null;
  return createPortal(panel, host);
}
