"use client";

import { useCallback, useEffect, useState } from "react";

import { AtlasCard, AtlasMetricStrip, AtlasSectionHeading } from "@/components/atlas/ui/AtlasPrimitives";

type FarmScore = {
  id: string;
  key: string;
  name: string;
  readyLotCount: number;
  unpricedReadyLotCount: number;
  valuationComplete: boolean;
  preparedRetailValue: number;
  claimedRetailValue: number;
  disposedRetailValue: number;
  sellThroughPct: number | null;
  activeOrderCount: number;
  fulfilledOrderCount: number;
  cancelledOrderCount: number;
  committedRevenue: number;
  realizedRevenue: number;
  realizedTotalReceipts: number;
};

type Response = { ok?: boolean; error?: string; farms?: FarmScore[] };

function dollars(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function HarvestCommercialScoreSection() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/atlas/flower-commercial-score", { cache: "no-store" });
      const payload = await response.json() as Response;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Harvest commercial result could not be loaded.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Harvest commercial result could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <AtlasCard as="section" ariaLabelledBy="atlas-harvest-commercial-result-title">
      <AtlasSectionHeading kicker="Commercial result" title="What Harvest became" id="atlas-harvest-commercial-result-title" />
      <p>Sell-through compares actual prepared retail value with the portion that has a buyer. Revenue becomes realized only after actual handoff.</p>

      {error ? <p>{error} <button type="button" onClick={() => void load()}>Try again</button></p> : null}
      {!data && !error ? <p>Reconciling Ready inventory, commitments and fulfillment…</p> : null}

      {(data?.farms ?? []).map((farm) => (
        <section key={farm.id}>
          <h3>{farm.name}</h3>
          {farm.readyLotCount === 0 ? (
            <p>No prepared Ready flower inventory has entered the commercial ledger yet.</p>
          ) : (
            <>
              <AtlasMetricStrip ariaLabel={`${farm.name} Harvest commercial result`}>
                <span><b>{farm.sellThroughPct === null ? "—" : `${farm.sellThroughPct.toFixed(1)}%`}</b> sell-through</span>
                <span><b>{dollars(farm.preparedRetailValue)}</b> prepared value</span>
                <span><b>{dollars(farm.committedRevenue)}</b> committed</span>
                <span><b>{dollars(farm.realizedRevenue)}</b> realized</span>
              </AtlasMetricStrip>
              {!farm.valuationComplete ? <p>Sell-through is withheld because {farm.unpricedReadyLotCount} Ready lot{farm.unpricedReadyLotCount === 1 ? "" : "s"} still lack a preserved retail valuation.</p> : null}
              {farm.disposedRetailValue > 0 ? <p>{dollars(farm.disposedRetailValue)} of catalog-valued Ready output has been removed through spoilage, donation or write-off.</p> : null}
              <p>{farm.activeOrderCount} active order{farm.activeOrderCount === 1 ? "" : "s"} · {farm.fulfilledOrderCount} fulfilled · {farm.cancelledOrderCount} cancelled.</p>
            </>
          )}
        </section>
      ))}
    </AtlasCard>
  );
}
