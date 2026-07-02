"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

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

  return (
    <main className="atlas-phone-shell atlas-route-shell">
      <section className="atlas-phone atlas-zone-page-phone">
        <header className="atlas-phone-top atlas-route-top">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Zones</span>
          </div>

          <Link className="atlas-soft-badge atlas-link-badge" href="/">
            Home
          </Link>
        </header>

        <div className="atlas-zone-landing-body no-summary">
          {loading ? <div className="atlas-route-loading">Loading zones...</div> : null}
          {error ? <div className="atlas-route-error">{error}</div> : null}

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
