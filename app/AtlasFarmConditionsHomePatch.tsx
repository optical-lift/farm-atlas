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
      method?: "inverse_distance_weighted_three_point";
      sourceLabel?: string;
      stationCount?: number;
      spreadSevenDayIn?: number;
      confidence?: "high" | "moderate" | "low";
      stations?: Array<{
        key: string;
        label: string;
        latitude: number;
        longitude: number;
        distanceMiles: number;
        weight: number;
        todayIn: number;
        sevenDayIn: number;
        daysSinceWateringRain: number | null;
      }>;
    };
    forecast: null | {
      next48hIn: number;
      chancePct: number;
    };
  };
};

type CanonicalSkyState = {
  covered?: boolean;
  moonSign?: string | null;
  moonSignWindowStart?: string | null;
  moonSignWindowEnd?: string | null;
  moonMode?: string | null;
  phaseState?: string | null;
  phaseWindowStart?: string | null;
  phaseWindowEnd?: string | null;
  phaseAngleDeg?: number | string | null;
  illuminationFraction?: number | string | null;
  sourceProvider?: string | null;
  sourceVersion?: string | null;
  calculationVersion?: string | null;
};

type CanonicalSkyResponse = {
  ok: boolean;
  authority?: string;
  state?: CanonicalSkyState;
  ledger?: {
    sampleCount?: number;
    windowCount?: number;
    coverageFrom?: string | null;
    coverageThrough?: string | null;
  } | null;
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

const SIGN_SYMBOLS: Record<string, string> = {
  aries: "♈︎",
  taurus: "♉︎",
  gemini: "♊︎",
  cancer: "♋︎",
  leo: "♌︎",
  virgo: "♍︎",
  libra: "♎︎",
  scorpio: "♏︎",
  sagittarius: "♐︎",
  capricorn: "♑︎",
  aquarius: "♒︎",
  pisces: "♓︎",
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

function smallDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function titleCase(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function numeric(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moonPhaseLabel(value: number | string | null | undefined) {
  const angle = numeric(value);
  if (angle === null) return "Sky ledger refreshing";
  if (angle < 22.5 || angle >= 337.5) return "New Moon";
  if (angle < 67.5) return "Waxing Crescent";
  if (angle < 112.5) return "First Quarter";
  if (angle < 157.5) return "Waxing Gibbous";
  if (angle < 202.5) return "Full Moon";
  if (angle < 247.5) return "Waning Gibbous";
  if (angle < 292.5) return "Last Quarter";
  return "Waning Crescent";
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
  const [sky, setSky] = useState<CanonicalSkyResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/atlas/sky-state?farmId=${encodeURIComponent(conditions.farm.id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json() as CanonicalSkyResponse;
        if (!response.ok || !payload.ok) throw new Error("Sky state unavailable");
        return payload;
      })
      .then((payload) => {
        if (active) setSky(payload);
      })
      .catch(() => {
        if (active) setSky(null);
      });
    return () => {
      active = false;
    };
  }, [conditions.farm.id]);

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

  const gaugeLabel = conditions.rain.gauge.latest
    ? `${inches(conditions.rain.gauge.latest.amountIn)} on ${smallDate(conditions.rain.gauge.latest.observationDate)}`
    : "Not read yet";
  const areaEstimate = conditions.rain.areaEstimate;
  const rainfallStations = areaEstimate?.stations ?? [];
  const estimateLabel = areaEstimate?.stationCount === 3 ? "3-station" : "Area estimate";
  const skyState = sky?.state;
  const skyCovered = skyState?.covered === true;
  const signKey = skyCovered && skyState?.moonSign ? skyState.moonSign.toLowerCase() : null;
  const signLabel = signKey ? titleCase(signKey) : "Unknown";
  const signSymbol = signKey ? SIGN_SYMBOLS[signKey] ?? "" : "";
  const phaseLabel = moonPhaseLabel(skyCovered ? skyState?.phaseAngleDeg : null);
  const illumination = skyCovered && numeric(skyState?.illuminationFraction) !== null
    ? Math.round((numeric(skyState?.illuminationFraction) ?? 0) * 100)
    : null;
  const sourceLabel = skyCovered
    ? `${skyState?.sourceProvider ?? "Atlas sky ledger"}${skyState?.sourceVersion ? ` ${skyState.sourceVersion}` : ""}`
    : "Canonical sky ledger refreshing";

  return (
    <div
      className="atlas-farm-conditions-embedded"
      aria-label={`${conditions.farm.name} weather, rain, and sky conditions`}
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
            {areaEstimate ? ` · ${estimateLabel} ${inches(areaEstimate.sevenDayIn)}` : ""}
          </p>
        </article>

        <article className="atlas-farm-condition-cell atlas-farm-moon-cell" data-moon-direction={skyState?.phaseState ?? "unknown"}>
          <small>Moon · {signSymbol} {signLabel}</small>
          <strong>{phaseLabel}</strong>
          <span>{illumination === null ? "Sky ledger refreshing" : `${illumination}% illuminated · ${titleCase(skyState?.moonMode)}`}</span>
          <p>{sourceLabel}</p>
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

      {rainfallStations.length === 3 && areaEstimate ? (
        <details className="atlas-farm-lunar-planner atlas-farm-rain-stations">
          <summary>
            <span>
              <small>Triangulated rainfall</small>
              <strong>{inches(areaEstimate.sevenDayIn)} across three stations</strong>
            </span>
            <b aria-hidden="true">⌄</b>
          </summary>
          <div className="atlas-farm-lunar-body">
            <div className="atlas-farm-lunar-actions" aria-label="Rainfall station estimates">
              {rainfallStations.map((station) => (
                <span key={station.key}>{station.label} · {inches(station.sevenDayIn)}</span>
              ))}
            </div>
            <p>
              Atlas weights the three surrounding station locations by distance to this farm. Agreement is {areaEstimate.confidence ?? "unrated"}
              {typeof areaEstimate.spreadSevenDayIn === "number" ? ` · ${inches(areaEstimate.spreadSevenDayIn)} spread` : ""}.
            </p>
            <small className="atlas-farm-condition-source">
              These are weather-model rainfall readings at the configured station locations, not the physical farm gauge.
            </small>
          </div>
        </details>
      ) : null}

      <details className="atlas-farm-lunar-planner">
        <summary>
          <span>
            <small>Sky state</small>
            <strong>{skyCovered ? `${signSymbol} ${signLabel} · ${titleCase(skyState?.moonMode)}` : "Canonical ledger refreshing"}</strong>
          </span>
          <b aria-hidden="true">⌄</b>
        </summary>
        <div className="atlas-farm-lunar-body">
          <p>
            This is the factual Atlas sky ledger only. Farm Conditions no longer assigns traditional good/bad task scores or independently ranks farm work.
          </p>
          <div className="atlas-farm-lunar-actions" aria-label="Current measured sky state">
            <span>{phaseLabel}</span>
            <span>{illumination === null ? "Illumination pending" : `${illumination}% illuminated`}</span>
            {skyState?.moonSignWindowEnd ? <span>Sign changes {smallDateTime(skyState.moonSignWindowEnd)}</span> : null}
            {skyState?.phaseWindowEnd ? <span>Phase half changes {smallDateTime(skyState.phaseWindowEnd)}</span> : null}
          </div>
          <p className="atlas-farm-lunar-precedence">
            Task timing lives in one place: approved operation rules → safety and biological guardrails → Body Budget → Daily Hand.
          </p>
          <small className="atlas-farm-condition-source">
            Astronomy: {sourceLabel}. Calculation: {skyState?.calculationVersion ?? "awaiting ledger"}. No task guidance is produced by this panel.
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
