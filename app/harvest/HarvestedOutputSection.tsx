"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AtlasCard, AtlasSectionHeading } from "@/components/atlas/ui/AtlasPrimitives";

type HarvestedEntry = {
  id: string;
  cropCycleId: string;
  cropLabel: string;
  variety: string | null;
  observedDate: string;
  bucketEquivalentFloor: number;
  lowerBound: boolean;
  moreAvailable: boolean;
  observationCount: number;
  note: string | null;
};

type HarvestedFarm = {
  id: string;
  key: string;
  name: string;
  entries: HarvestedEntry[];
  totals: {
    bucketEquivalentFloor: number;
    lowerBound: boolean;
    observationCount: number;
  };
};

type HarvestedResponse = {
  ok?: boolean;
  error?: string;
  asOf?: string;
  rangeStart?: string;
  rangeDays?: number;
  farms?: HarvestedFarm[];
};

function pretty(dateIso: string | null | undefined) {
  if (!dateIso) return "Not set";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatBucketFloor(value: number, lowerBound: boolean) {
  const rounded = Math.round(value * 100) / 100;
  const amount = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, "");
  const noun = rounded === 1 && !lowerBound ? "bucket" : "buckets";
  return `${lowerBound ? "≥" : ""}${amount} ${noun}`;
}

export default function HarvestedOutputSection({ asOf }: { asOf: string | undefined }) {
  const [data, setData] = useState<HarvestedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
      const response = await fetch(`/api/atlas/harvested${query}`, { cache: "no-store" });
      const payload = await response.json() as HarvestedResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Harvested output could not be loaded.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Harvested output could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => { void load(); }, [load]);

  const farmsWithOutput = useMemo(
    () => (data?.farms ?? []).filter((farm) => farm.entries.length),
    [data],
  );
  const totalEntries = farmsWithOutput.reduce((sum, farm) => sum + farm.entries.length, 0);

  return (
    <AtlasCard as="section" className="atlas-harvested" ariaLabelledBy="atlas-harvested-title">
      <header className="atlas-harvested__heading">
        <div>
          <AtlasSectionHeading kicker="Physical output" title="Harvested" id="atlas-harvested-title" />
          <p>What physically came out of the field. This is not prepared or ready inventory.</p>
        </div>
        {data?.rangeStart && data.asOf ? <span>{pretty(data.rangeStart)}–{pretty(data.asOf)}</span> : null}
      </header>

      {loading && !data ? <div className="atlas-harvested__state">Reading recorded harvest output…</div> : null}
      {error ? (
        <div className="atlas-harvested__state atlas-harvested__state--error">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : null}

      {data && !totalEntries ? (
        <div className="atlas-harvested__empty">
          <b>No harvested flower output has been recorded in this window.</b>
          <span>When a Harvest task records a bucket amount, the physical output will appear here.</span>
        </div>
      ) : null}

      {farmsWithOutput.map((farm) => (
        <section className="atlas-harvested__farm" key={farm.id}>
          <header>
            <div><small>Harvested at</small><h3>{farm.name}</h3></div>
            <strong>{formatBucketFloor(farm.totals.bucketEquivalentFloor, farm.totals.lowerBound)}</strong>
          </header>
          <div className="atlas-harvested__entries">
            {farm.entries.map((entry) => (
              <article className="atlas-harvested-entry" key={entry.id} data-lower-bound={entry.lowerBound ? "true" : "false"}>
                <div>
                  <small>{pretty(entry.observedDate)}</small>
                  <h4>{entry.cropLabel}{entry.variety ? ` · ${entry.variety}` : ""}</h4>
                  {entry.note ? <p>{entry.note}</p> : null}
                </div>
                <div className="atlas-harvested-entry__amount">
                  <b>{formatBucketFloor(entry.bucketEquivalentFloor, entry.lowerBound)}</b>
                  {entry.moreAvailable ? <span>More remained</span> : <span>Cut reported complete</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {farmsWithOutput.some((farm) => farm.totals.lowerBound) ? (
        <p className="atlas-harvested__lower-bound"><b>≥</b> means “at least.” A 1+ bucket observation stays a lower bound instead of being turned into invented precision.</p>
      ) : null}
    </AtlasCard>
  );
}
