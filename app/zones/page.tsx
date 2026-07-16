"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import { ZoneLandingCard } from "@/components/atlas/zone-inspection";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

const MAP_ROUTES: Record<string, { href: string; label: string }> = {
  main_garden: { href: "/zones/main-garden-map", label: "Open Main Garden visual map" },
  original_berry_walk: { href: "/zones/berry-walk-map", label: "Open Berry Walk visual map" },
  berry_walk_flower_rows: { href: "/zones/berry-walk-map", label: "Open Berry Walk visual map" },
};

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
    <main className="atlas-phone-shell atlas-route-shell" data-map-navigation="embedded-zone-buttons">
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
            {zones.map((zone) => {
              const mapRoute = MAP_ROUTES[zone.stable_key];

              return (
                <article key={zone.id} className="atlas-zone-card-with-actions">
                  <Link href={`/zones/${zone.stable_key}`} className="atlas-zone-landing-link">
                    <ZoneLandingCard zone={zone} />
                  </Link>

                  {mapRoute ? (
                    <Link
                      href={mapRoute.href}
                      className="atlas-zone-map-button"
                      aria-label={mapRoute.label}
                    >
                      Visual map →
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </section>
        </div>
      </section>

      <style jsx>{`
        .atlas-zone-card-with-actions {
          display: grid;
          gap: 0;
        }

        .atlas-zone-map-button {
          display: block;
          margin: -10px 12px 12px;
          padding: 11px 14px;
          border-radius: 0 0 12px 12px;
          background: #6d5892;
          color: white;
          text-align: center;
          text-decoration: none;
          font-weight: 850;
          position: relative;
          z-index: 1;
        }

        .atlas-zone-map-button:hover,
        .atlas-zone-map-button:focus-visible {
          background: #5d487f;
        }
      `}</style>
    </main>
  );
}
