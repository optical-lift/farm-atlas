"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import {
  BedInspectorRow,
  stageLabel,
  zoneShortMode,
} from "@/components/atlas/zone-inspection";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

export default function AtlasZoneDetailPage() {
  const params = useParams<{ zoneKey: string }>();
  const zoneKey = params.zoneKey;

  const [zones, setZones] = useState<AtlasRegistryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadZones() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetchAtlasZoneRegistry();
      setZones(response.zones ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Atlas could not load this zone.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadZones();
  }, []);

  const zone = useMemo(
    () => zones.find((candidate) => candidate.stable_key === zoneKey) ?? null,
    [zones, zoneKey],
  );

  const nextZone = useMemo(() => {
    if (!zone || zones.length === 0) return null;
    const index = zones.findIndex((candidate) => candidate.id === zone.id);
    return zones[(index + 1) % zones.length] ?? null;
  }, [zone, zones]);

  return (
    <main className="atlas-phone-shell atlas-route-shell">
      <section className="atlas-phone atlas-zone-page-phone">
        <header className="atlas-phone-top atlas-route-top">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Zone Inspector</span>
          </div>

          <Link className="atlas-soft-badge atlas-link-badge" href="/zones">
            Zones
          </Link>
        </header>

        <div className="atlas-zone-detail-body">
          {loading ? <div className="atlas-route-loading">Loading zone...</div> : null}
          {error ? <div className="atlas-route-error">{error}</div> : null}

          {!loading && !zone ? (
            <section className="atlas-zone-detail-hero">
              <span className="atlas-home-kicker">Missing zone</span>
              <h1>Atlas could not find this zone.</h1>
              <p>Go back to the zone landing pad and choose a current farm zone.</p>
            </section>
          ) : null}

          {zone ? (
            <>
              <section className="atlas-zone-detail-hero compact">
                <div>
                  <span className="atlas-home-kicker">{zoneShortMode(zone)}</span>
                  <h1>{zone.label}</h1>
                  <p>{zone.goal_text ?? "Inspect the place in front of you."}</p>
                </div>

                <div className="atlas-zone-detail-metrics two-only">
                  <span>{zone.active_object_count} active</span>
                  <span>{zone.object_count} total</span>
                </div>
              </section>

              <section className="atlas-zone-bed-list">
                <div className="atlas-zone-bed-list-head">
                  <span className="atlas-home-kicker">Beds / objects</span>
                  <p>Tap one bed to open its inspection sheet.</p>
                </div>

                {zone.objects.length === 0 ? (
                  <div className="atlas-inspection-empty">No beds or objects have been logged here yet.</div>
                ) : null}

                {zone.objects.map((object) => (
                  <BedInspectorRow key={object.id} object={object} />
                ))}
              </section>

              <nav className="atlas-zone-detail-footer" aria-label="Zone navigation">
                <Link href="/zones">All zones</Link>
                {nextZone ? <Link href={`/zones/${nextZone.stable_key}`}>Next: {nextZone.label}</Link> : null}
                <span>{stageLabel(zone.mode_bias)}</span>
              </nav>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
