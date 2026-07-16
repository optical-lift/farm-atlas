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

          <Link
            href="/zones/main-garden-map"
            className="atlas-zone-landing-link"
            aria-label="Open the Main Garden field diagram"
          >
            <article className="atlas-zone-landing-card">
              <span className="atlas-home-kicker">Field diagram</span>
              <h2>Main Garden map</h2>
              <p>See all eight clock-face beds, the eight named walkways, and the center diamond together.</p>
              <div className="atlas-zone-landing-card-footer">
                <span>Live Atlas labels</span>
                <strong>Open map →</strong>
              </div>
            </article>
          </Link>

          <Link
            href="/zones/berry-walk-map"
            className="atlas-zone-landing-link"
            aria-label="Open the Berry Walk field diagram"
          >
            <article className="atlas-zone-landing-card">
              <span className="atlas-home-kicker">Field diagram</span>
              <h2>Berry Walk map</h2>
              <p>See the 10 flower rows, four asparagus beds, rail-tie beds, crescent, and spiral together.</p>
              <div className="atlas-zone-landing-card-footer">
                <span>Live Atlas labels</span>
                <strong>Open map →</strong>
              </div>
            </article>
          </Link>

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
