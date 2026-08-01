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

type FarmConditionsCollectionResponse = {
  ok: boolean;
  conditions?: FarmConditionsResponse[];
  error?: string;
};

type FarmConditionsHost = {
  farmId: string;
  node: HTMLElement;
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

function daysBetweenIso(olderIso: string, newerIso: string) {
  const older = new Date(`${olderIso}T12:00:00Z`).getTime();
  const newer = new Date(`${newerIso}T12:00:00Z`).getTime();
  if (!Number.isFinite(older) || !Number.isFinite(newer)) return 0;
  return Math.max(0, Math.round((newer - older) / 86_400_000));
}

function gaugeStatus(conditions: FarmConditionsResponse) {
  const latest = conditions.rain.gauge.latest;
  if (!latest) return conditions.rain.statusLabel;
  const age = daysBetweenIso(latest.observationDate, conditions.observedDate);
  if (age === 0) return `${latest.amountIn.toFixed(2)}\" gauge reading today`;
  if (age === 1) return "1 day since gauge read";
  return `${age} days since gauge read`;
}

function rainAge(days: number | null) {
  if (days === null) return "No gauge watering-rain history";
  if (days === 0) return "Watering rain logged today";
  if (days === 1) return "1 day since watering rain";
  return `${days} days since watering rain`;
}

function sameHosts(left: FarmConditionsHost[], right: FarmConditionsHost[]) {
  return left.length === right.length
    && left.every((host, index) => host.farmId === right[index]?.farmId && host.node === right[index]?.node);
}

function FarmConditionsEmbedded({
  conditions,
  onReload,
}: {
  conditions: FarmConditionsResponse;
  onReload: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  async function recordRain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
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
      setSaveMessage(`${conditions.farm.name} rain gauge recorded.`);
      onReload();
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Rain reading could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const moonTimes = [
    conditions.moon.moonrise ? `Rise ${conditions.moon.moonrise}` : null,
    conditions.moon.moonset ? `Set ${conditions.moon.moonset}` : null,
  ].filter(Boolean).join(" · ");
  const gaugeLabel = conditions.rain.gauge.latest
    ? `${inches(conditions.rain.gauge.latest.amountIn)} on ${smallDate(conditions.rain.gauge.latest.observationDate)}`
    : "Not read yet";

  return (
    <div
      className="atlas-farm-conditions-embedded"
      aria-label={`${conditions.farm.name} weather, rain, and lunar conditions`}
      data-farm-id={conditions.farm.id}
    >
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
          <small>Rain here</small>
          <strong>{gaugeLabel}</strong>
          <span>{gaugeStatus(conditions)}</span>
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
            <small>Traditional farm almanac</small>
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
            Astronomy: {conditions.moon.astronomySourceLabel}. Guidance: {conditions.moon.ruleSourceLabel}. Weather and rainfall estimates are separate from the farm gauge.
          </small>
        </div>
      </details>

      <details className="atlas-farm-rain-log">
        <summary>
          <span>
            <small>Farm memory</small>
            <strong>Log this farm’s rain gauge</strong>
          </span>
          <b aria-hidden="true">⌄</b>
        </summary>
        <form onSubmit={recordRain}>
          <label htmlFor={`atlas-rain-gauge-amount-${conditions.farm.id}`}>Amount since the last reading</label>
          <div>
            <input
              id={`atlas-rain-gauge-amount-${conditions.farm.id}`}
              type="number"
              inputMode="decimal"
              min="0"
              max="30"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              aria-describedby={`atlas-rain-gauge-unit-${conditions.farm.id}`}
            />
            <span id={`atlas-rain-gauge-unit-${conditions.farm.id}`}>inches</span>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Record"}</button>
          </div>
          <p>Use this farm’s physical gauge. Atlas keeps it separate from the area estimate and forecast.</p>
          {saveMessage ? <output aria-live="polite">{saveMessage}</output> : null}
        </form>
      </details>
    </div>
  );
}

export default function AtlasFarmConditionsHomePatch() {
  const pathname = usePathname();
  const [conditions, setConditions] = useState<FarmConditionsResponse[]>([]);
  const [hosts, setHosts] = useState<FarmConditionsHost[]>([]);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (pathname !== "/") {
      setConditions([]);
      return;
    }

    let active = true;
    fetch("/api/atlas/farm-conditions/all", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json() as FarmConditionsCollectionResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Farm conditions are unavailable.");
        return payload.conditions ?? [];
      })
      .then((payload) => {
        if (active) setConditions(payload);
      })
      .catch(() => {
        if (active) setConditions([]);
      });

    return () => {
      active = false;
    };
  }, [pathname, reloadVersion]);

  const farmIdentityKey = useMemo(
    () => conditions.map((entry) => `${entry.farm.id}:${entry.farm.name}`).sort().join("|"),
    [conditions],
  );

  useEffect(() => {
    if (pathname !== "/" || !conditions.length) {
      setHosts([]);
      return;
    }

    let cancelled = false;
    let observer: MutationObserver | null = null;

    const mount = () => {
      if (cancelled) return;
      const section = document.querySelector<HTMLElement>('section[aria-label="Farm seasons"]');
      const cardContainer = section?.firstElementChild;
      if (!cardContainer) return;

      const farmCards = Array.from(cardContainer.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.tagName === "ARTICLE");
      const nextHosts: FarmConditionsHost[] = [];

      for (const conditionsEntry of conditions) {
        const farmCard = farmCards.find((card) => {
          const title = card.querySelector(":scope > header h3")?.textContent?.trim();
          return title === conditionsEntry.farm.name;
        });
        if (!farmCard) continue;

        let node = Array.from(farmCard.children).find(
          (child): child is HTMLElement => child instanceof HTMLElement
            && child.dataset.atlasFarmConditionsHost === conditionsEntry.farm.id,
        ) ?? null;
        if (!node) {
          node = document.createElement("div");
          node.dataset.atlasFarmConditionsHost = conditionsEntry.farm.id;
          const cardHeader = farmCard.querySelector(":scope > header");
          if (cardHeader) cardHeader.after(node);
          else farmCard.prepend(node);
        }
        nextHosts.push({ farmId: conditionsEntry.farm.id, node });
      }

      setHosts((current) => sameHosts(current, nextHosts) ? current : nextHosts);
    };

    mount();
    observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer?.disconnect();
      document.querySelectorAll<HTMLElement>("[data-atlas-farm-conditions-host]").forEach((node) => node.remove());
      setHosts([]);
    };
  }, [pathname, farmIdentityKey, conditions]);

  if (pathname !== "/" || !hosts.length) return null;

  return (
    <>
      {hosts.map((host) => {
        const entry = conditions.find((candidate) => candidate.farm.id === host.farmId);
        if (!entry) return null;
        return createPortal(
          <FarmConditionsEmbedded
            conditions={entry}
            onReload={() => setReloadVersion((value) => value + 1)}
          />,
          host.node,
          host.farmId,
        );
      })}
    </>
  );
}
