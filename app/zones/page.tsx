"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { ZoneLandingCard } from "@/components/atlas/zone-inspection";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

export default function AtlasZonesPage() {
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
      setError(loadError instanceof Error ? loadError.message : "Atlas could not load zones.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadZones();
  }, []);

  const totals = useMemo(() => {
    return {
      zones: zones.length,
      active: zones.reduce((sum, zone) => sum + zone.active_object_count, 0),
      total: zones.reduce((sum, zone) => sum + zone.object_count, 0),
      unknown: zones.reduce((sum, zone) => sum + (zone.unknown_count ?? 0), 0),
    };
  }, [zones]);

  return (
    <main className="atlas-phone-shell atlas-route-shell">
      <section className="atlas-phone atlas-zone-page-phone">
        <header className="atlas-phone-top atlas-route-top">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Zone Landing Pad</span>
          </div>

          <Link className="atlas-soft-badge atlas-link-badge" href="/">
            Home
          </Link>
        </header>

        <div className="atlas-zone-landing-body">
          <section className="atlas-zone-landing-summary">
            <span className="atlas-home-kicker">Bed inspector</span>
            <h1>Pick the place you are standing in.</h1>
            <p>
              {loading
                ? "Loading Atlas zones..."
                : `${totals.zones} zones · ${totals.active}/${totals.total} active objects · ${totals.unknown} unknown fields`}
            </p>
            {error ? <p className="atlas-route-error">{error}</p> : null}
          </section>

          <section className="atlas-zone-landing-grid" aria-label="Atlas zones">
            {zones.map((zone) => (
              <Link href={`/zones/${zone.stable_key}`} key={zone.id} className="atlas-zone-landing-link">
                <ZoneLandingCard zone={zone} />
              </Link>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
