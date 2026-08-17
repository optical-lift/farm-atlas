"use client";

import { useCallback, useEffect, useState } from "react";

import { AtlasCard, AtlasSectionHeading } from "@/components/atlas/ui/AtlasPrimitives";
import "./postharvest.css";

type AwaitingPreparation = {
  id: string;
  harvestDate: string;
  bucketEquivalentFloor: number;
  lowerBound: boolean;
  observationCount: number;
  crops: string[];
};

type ReadyLot = {
  id: string;
  inventoryKind: string;
  quantity: number;
  unit: string;
  quantityExactness: string;
  readyDate: string;
  harvestDate: string | null;
};

type NoSaleableResult = {
  id: string;
  preparedDate: string;
  harvestDate: string | null;
};

type PostharvestFarm = {
  id: string;
  key: string;
  name: string;
  awaitingPreparation: AwaitingPreparation[];
  ready: ReadyLot[];
  completedNoSaleable: NoSaleableResult[];
};

type PostharvestResponse = {
  ok?: boolean;
  error?: string;
  asOf?: string;
  rangeStart?: string;
  rangeDays?: number;
  farms?: PostharvestFarm[];
};

const KIND_LABELS: Record<string, string> = {
  conditioned_bucket: "Conditioned flowers",
  counted_stems: "Counted stems",
  posy: "Posy",
  bouquet: "Bouquet",
  lobby_arrangement: "Lobby arrangement",
};

function pretty(dateIso: string | null | undefined) {
  if (!dateIso) return "Not set";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatBucket(value: number, lowerBound: boolean) {
  const rounded = Math.round(value * 100) / 100;
  const amount = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, "");
  return `${lowerBound ? "≥" : ""}${amount} bucket${rounded === 1 && !lowerBound ? "" : "s"}`;
}

function readyAmount(lot: ReadyLot) {
  const amount = Number.isInteger(lot.quantity) ? lot.quantity.toFixed(0) : lot.quantity.toFixed(2).replace(/0$/, "");
  const prefix = lot.quantityExactness === "lower_bound" ? "≥" : "";
  const units: Record<string, [string, string]> = {
    bucket_equivalent: ["bucket", "buckets"],
    stem: ["stem", "stems"],
    posy: ["posy", "posies"],
    bouquet: ["bouquet", "bouquets"],
    arrangement: ["arrangement", "arrangements"],
  };
  const [singular, plural] = units[lot.unit] ?? [lot.unit, lot.unit];
  return `${prefix}${amount} ${lot.quantity === 1 && lot.quantityExactness !== "lower_bound" ? singular : plural}`;
}

export default function FlowerPostharvestSection() {
  const [data, setData] = useState<PostharvestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/atlas/flower-postharvest", { cache: "no-store" });
      const payload = await response.json() as PostharvestResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Prepare and Ready truth could not be loaded.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Prepare and Ready truth could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const farms = data?.farms ?? [];
  const hasAwaiting = farms.some((farm) => farm.awaitingPreparation.length);
  const hasReady = farms.some((farm) => farm.ready.length);
  const hasNoSaleable = farms.some((farm) => farm.completedNoSaleable.length);

  return (
    <>
      <AtlasCard as="section" className="atlas-postharvest" ariaLabelledBy="atlas-prepare-title">
        <header className="atlas-postharvest__heading">
          <div>
            <AtlasSectionHeading kicker="Transformation" title="Prepare" id="atlas-prepare-title" />
            <p>Harvested physical output that still needs real handling before Atlas may call anything saleable.</p>
          </div>
          {data?.rangeStart && data.asOf ? <span>{pretty(data.rangeStart)}–{pretty(data.asOf)}</span> : null}
        </header>

        {!data && !error ? <div className="atlas-postharvest__state">Reading preparation truth…</div> : null}
        {error ? <div className="atlas-postharvest__state atlas-postharvest__state--error"><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : null}
        {data && !hasAwaiting ? <div className="atlas-postharvest__empty"><b>No harvested flower output is awaiting preparation.</b><span>A Harvest record enters this lane until a completed Prepare result consumes it.</span></div> : null}

        {farms.filter((farm) => farm.awaitingPreparation.length).map((farm) => (
          <section className="atlas-postharvest__farm" key={farm.id}>
            <header><small>Awaiting at</small><h3>{farm.name}</h3></header>
            <div className="atlas-postharvest__list">
              {farm.awaitingPreparation.map((batch) => (
                <article className="atlas-postharvest-item" key={batch.id}>
                  <div><small>Harvested {pretty(batch.harvestDate)}</small><h4>{batch.crops.join(" · ")}</h4><p>{batch.observationCount} physical harvest record{batch.observationCount === 1 ? "" : "s"}</p></div>
                  <strong>{formatBucket(batch.bucketEquivalentFloor, batch.lowerBound)}</strong>
                </article>
              ))}
            </div>
          </section>
        ))}
      </AtlasCard>

      <AtlasCard as="section" className="atlas-postharvest atlas-ready" ariaLabelledBy="atlas-ready-title">
        <header className="atlas-postharvest__heading">
          <div>
            <AtlasSectionHeading kicker="Finished saleable inventory" title="Ready" id="atlas-ready-title" />
            <p>Only output explicitly born from completed preparation appears here. No forecast or raw harvest is promoted into inventory.</p>
          </div>
        </header>

        {data && !hasReady ? <div className="atlas-postharvest__empty"><b>No Ready flower inventory has been recorded in this window.</b><span>Ready lots appear only after a Prepare task records the finished saleable form.</span></div> : null}

        {farms.filter((farm) => farm.ready.length).map((farm) => (
          <section className="atlas-postharvest__farm" key={farm.id}>
            <header><small>Ready at</small><h3>{farm.name}</h3></header>
            <div className="atlas-postharvest__list">
              {farm.ready.map((lot) => (
                <article className="atlas-postharvest-item atlas-ready-item" key={lot.id}>
                  <div><small>Ready {pretty(lot.readyDate)}</small><h4>{KIND_LABELS[lot.inventoryKind] ?? lot.inventoryKind}</h4>{lot.harvestDate ? <p>From flowers harvested {pretty(lot.harvestDate)}</p> : null}</div>
                  <strong>{readyAmount(lot)}</strong>
                </article>
              ))}
            </div>
          </section>
        ))}

        {data && hasNoSaleable ? <p className="atlas-postharvest__note">Some completed preparation produced no saleable output. Those results remain recorded without creating fake Ready inventory.</p> : null}
      </AtlasCard>
    </>
  );
}
