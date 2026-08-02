"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./harvest.css";

type EvidenceState = "calculated" | "seen" | "confirmed";
type Bucket = "cutting" | "now" | "week1" | "week2" | "week3";
type DateOutlook = "confirmed" | "likely" | "possible" | "too_early" | "past_window";

type Cycle = {
  cropCycleId: string;
  objectId: string | null;
  objectKey: string | null;
  objectLabel: string;
  cropProfileKey: string | null;
  cropLabel: string;
  variety: string | null;
  windowStart: string;
  windowEnd: string;
  cycleState: string;
  forecastState: string;
  evidenceState: EvidenceState;
  latestStage: string | null;
  latestCondition: string | null;
  latestObservationDate: string | null;
  latestObservationNote: string | null;
  bankableStems: number | null;
  estimatedRemainingStems: number | null;
  harvestStartedDate: string | null;
  lastHarvestDate: string | null;
  availabilityStatus: string | null;
  latestHarvestQuantity: number | null;
  latestHarvestUnit: string | null;
};

type Wave = {
  id: string;
  farmId: string;
  cropLabel: string;
  baseCropLabel: string;
  variety: string | null;
  windowStart: string;
  windowEnd: string;
  bucket: Bucket;
  evidenceState: EvidenceState;
  forecastState: string;
  objectLabels: string[];
  bankableStems: number | null;
  estimatedRemainingStems: number | null;
  latestStage: string | null;
  latestCondition: string | null;
  latestObservationDate: string | null;
  latestObservationNote: string | null;
  cycles: Cycle[];
};

type Farm = {
  id: string;
  key: string;
  name: string;
  waves: Wave[];
  counts: {
    cutting: number;
    now: number;
    week1: number;
    week2: number;
    week3: number;
    needsConfirmation: number;
  };
};

type ObservationOption = { key: string; label: string };

type HorizonResponse = {
  ok?: boolean;
  error?: string;
  asOf?: string;
  horizonEnd?: string;
  horizonDays?: number;
  farms?: Farm[];
  observationOptions?: ObservationOption[];
};

const BUCKETS: Array<{ key: Bucket; label: string; detail: string }> = [
  { key: "cutting", label: "Harvest routine", detail: "Confirmed first cuts or active harvest" },
  { key: "now", label: "In the window now", detail: "Expected harvest window is already open" },
  { key: "week1", label: "Coming this week", detail: "Expected to enter the routine in the next 7 days" },
  { key: "week2", label: "Coming next week", detail: "Expected 8–14 days from now" },
  { key: "week3", label: "Later in the horizon", detail: "Expected 15–21 days from now" },
];

const OUTLOOK_ORDER: DateOutlook[] = ["confirmed", "likely", "possible", "too_early", "past_window"];
const OUTLOOK_LABELS: Record<DateOutlook, string> = {
  confirmed: "Confirmed",
  likely: "Likely",
  possible: "Possible",
  too_early: "Probably too early",
  past_window: "May be past peak",
};

function pretty(dateIso: string | null | undefined, includeYear = false) {
  if (!dateIso) return "Not set";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

function localIso(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localIso(date);
}

function nextThursday(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  const delta = (4 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  return localIso(date);
}

function dateOutlook(wave: Wave, dateIso: string): DateOutlook {
  if (wave.evidenceState === "confirmed" && dateIso <= wave.windowEnd) return "confirmed";
  if (dateIso < wave.windowStart) {
    const days = Math.round((new Date(`${wave.windowStart}T12:00:00`).getTime() - new Date(`${dateIso}T12:00:00`).getTime()) / 86_400_000);
    return days <= 3 ? "possible" : "too_early";
  }
  if (dateIso > wave.windowEnd) return "past_window";
  if (wave.evidenceState === "seen" && ["budding", "flowering", "blooming", "fruit_set", "fruiting", "podding", "harvesting"].includes((wave.latestStage || "").toLowerCase())) return "likely";
  return "possible";
}

function stemLabel(wave: Wave) {
  const count = wave.estimatedRemainingStems ?? wave.bankableStems;
  if (!count) return null;
  return `${count.toLocaleString()} forecast stem${count === 1 ? "" : "s"}`;
}

function evidenceLabel(state: EvidenceState) {
  if (state === "confirmed") return "Harvest confirmed";
  if (state === "seen") return "Field evidence";
  return "Calculated only";
}

function WaveCard({
  wave,
  observationOptions,
  savingCycleId,
  onObserve,
}: {
  wave: Wave;
  observationOptions: ObservationOption[];
  savingCycleId: string | null;
  onObserve: (wave: Wave, cycle: Cycle, observationKey: string) => Promise<void>;
}) {
  const [selectedCycleId, setSelectedCycleId] = useState(wave.cycles[0]?.cropCycleId ?? "");
  const selectedCycle = wave.cycles.find((cycle) => cycle.cropCycleId === selectedCycleId) ?? wave.cycles[0];
  const cropHref = selectedCycle?.objectKey ? `/objects/${encodeURIComponent(selectedCycle.objectKey)}` : null;
  const stems = stemLabel(wave);

  return (
    <article className="atlas-harvest-wave" data-evidence={wave.evidenceState} data-confirmation={wave.forecastState}>
      <header>
        <div>
          <small>{evidenceLabel(wave.evidenceState)}</small>
          <h3>{wave.cropLabel}</h3>
          <p>{wave.objectLabels.join(" · ")}</p>
        </div>
        <span>{pretty(wave.windowStart)}–{pretty(wave.windowEnd)}</span>
      </header>

      <div className="atlas-harvest-wave__facts">
        <span><b>Latest</b>{wave.latestStage ? wave.latestStage.replaceAll("_", " ") : "No field sighting"}</span>
        {stems ? <span><b>Capacity</b>{stems}</span> : null}
        {wave.forecastState !== "baseline" ? <span><b>Confidence</b>Needs a fresh look</span> : null}
      </div>

      {wave.latestObservationNote ? <p className="atlas-harvest-wave__note">{wave.latestObservationNote}</p> : null}

      <details className="atlas-harvest-wave__details">
        <summary>
          <span>Record what the field is doing</span>
          <b aria-hidden="true">⌄</b>
        </summary>
        <div>
          {wave.cycles.length > 1 ? (
            <label>
              <span>Bed or growing area</span>
              <select value={selectedCycleId} onChange={(event) => setSelectedCycleId(event.target.value)}>
                {wave.cycles.map((cycle) => <option key={cycle.cropCycleId} value={cycle.cropCycleId}>{cycle.objectLabel}</option>)}
              </select>
            </label>
          ) : null}

          <div className="atlas-harvest-observation-options" aria-label="Quick crop sightings">
            {observationOptions.map((option) => (
              <button
                type="button"
                key={option.key}
                disabled={!selectedCycle || savingCycleId === selectedCycle.cropCycleId}
                onClick={() => selectedCycle && void onObserve(wave, selectedCycle, option.key)}
              >
                {savingCycleId === selectedCycle?.cropCycleId ? "Saving…" : option.label}
              </button>
            ))}
          </div>

          {cropHref ? <Link href={cropHref}>Open {selectedCycle.objectLabel} →</Link> : null}
        </div>
      </details>
    </article>
  );
}

export default function HarvestHorizonPage() {
  const [data, setData] = useState<HorizonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCycleId, setSavingCycleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState(() => nextThursday(localIso()));

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/atlas/harvest-horizon", { cache: "no-store" });
      const payload = await response.json() as HorizonResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Harvest Horizon could not be loaded.");
      setData(payload);
      if (payload.asOf) setTargetDate((current) => current || nextThursday(payload.asOf!));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Harvest Horizon could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function observe(wave: Wave, cycle: Cycle, observationKey: string) {
    if (!cycle.objectKey || savingCycleId) return;
    try {
      setSavingCycleId(cycle.cropCycleId);
      setNotice(null);
      const response = await fetch("/api/atlas/harvest-horizon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-atlas-intent": "harvest-horizon-observation-v1",
        },
        body: JSON.stringify({
          farmId: wave.farmId,
          cropCycleId: cycle.cropCycleId,
          objectKey: cycle.objectKey,
          observationKey,
          eventDate: data?.asOf ?? localIso(),
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "The field sighting could not be recorded.");
      const label = data?.observationOptions?.find((option) => option.key === observationKey)?.label ?? "Field sighting";
      setNotice(`${label} recorded for ${cycle.objectLabel}.`);
      await load();
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "The field sighting could not be recorded.");
    } finally {
      setSavingCycleId(null);
    }
  }

  const dateLens = useMemo(() => {
    return (data?.farms ?? []).map((farm) => ({
      farm,
      groups: OUTLOOK_ORDER.map((outlook) => ({
        outlook,
        waves: farm.waves.filter((wave) => dateOutlook(wave, targetDate) === outlook),
      })).filter((group) => group.waves.length),
    }));
  }, [data, targetDate]);

  return (
    <main className="atlas-harvest-shell">
      <section className="atlas-harvest-page">
        <header className="atlas-harvest-header">
          <Link href="/" className="atlas-harvest-brand">
            <span>Atlas</span>
            <strong>Harvest</strong>
          </Link>
          <div>
            <small>Farm horizon</small>
            <b>{data?.asOf ? `${pretty(data.asOf)}–${pretty(data.horizonEnd)}` : "Next 21 days"}</b>
          </div>
        </header>

        <section className="atlas-harvest-intro">
          <span>What is entering the routine</span>
          <h1>Harvest Horizon</h1>
          <p>Forecasts live here. Work receives only actual cutting, picking, clearing or decision-making.</p>
        </section>

        {notice ? <output className="atlas-harvest-notice" aria-live="polite">{notice}</output> : null}
        {error ? <div className="atlas-harvest-error">{error}<button type="button" onClick={() => void load()}>Try again</button></div> : null}
        {loading && !data ? <div className="atlas-harvest-loading">Reading crop cycles, field evidence and harvest windows…</div> : null}

        {data ? (
          <>
            <section className="atlas-harvest-date-lens">
              <div>
                <span>Date lens</span>
                <h2>What should be available by a particular day?</h2>
                <p>Use this for Thursday events, delivery rounds, bouquet plans or buyer conversations.</p>
              </div>
              <label>
                <span>Look at</span>
                <input type="date" min={data.asOf} max={addDays(data.asOf!, 45)} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
              </label>

              <div className="atlas-harvest-date-lens__farms">
                {dateLens.map(({ farm, groups }) => (
                  <article key={farm.id}>
                    <header><small>{pretty(targetDate, true)}</small><h3>{farm.name}</h3></header>
                    {groups.length ? groups.map((group) => (
                      <div key={group.outlook} data-outlook={group.outlook}>
                        <b>{OUTLOOK_LABELS[group.outlook]}</b>
                        <span>{group.waves.map((wave) => wave.cropLabel).join(" · ")}</span>
                      </div>
                    )) : <p>No crop wave is currently projected for that date.</p>}
                  </article>
                ))}
              </div>
            </section>

            {(data.farms ?? []).map((farm) => (
              <section className="atlas-harvest-farm" key={farm.id}>
                <header className="atlas-harvest-farm__header">
                  <div><span>21-day outlook</span><h2>{farm.name}</h2></div>
                  <div className="atlas-harvest-farm__counts">
                    <span><b>{farm.counts.cutting + farm.counts.now}</b> now</span>
                    <span><b>{farm.counts.week1 + farm.counts.week2 + farm.counts.week3}</b> ahead</span>
                  </div>
                </header>

                {!farm.waves.length ? <div className="atlas-harvest-empty">No crop wave currently enters the next 21 days.</div> : null}

                {BUCKETS.map((bucket) => {
                  const waves = farm.waves.filter((wave) => wave.bucket === bucket.key);
                  if (!waves.length) return null;
                  return (
                    <section className="atlas-harvest-bucket" key={bucket.key}>
                      <header><span>{bucket.label}</span><p>{bucket.detail}</p><b>{waves.length}</b></header>
                      <div>
                        {waves.map((wave) => (
                          <WaveCard
                            key={wave.id}
                            wave={wave}
                            observationOptions={data.observationOptions ?? []}
                            savingCycleId={savingCycleId}
                            onObserve={observe}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </section>
            ))}
          </>
        ) : null}
      </section>
    </main>
  );
}
