"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import { VenueZoneLandingCard } from "@/components/atlas/room-inspection";
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

function ZoneCard({ zone }: { zone: AtlasRegistryZone }) {
  return zone.stable_key === "venue"
    ? <VenueZoneLandingCard zone={zone} />
    : <ZoneLandingCard zone={zone} />;
}

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

              if (!mapRoute) {
                return (
                  <Link href={`/zones/${zone.stable_key}`} key={zone.id} className="atlas-zone-landing-link">
                    <ZoneCard zone={zone} />
                  </Link>
                );
              }

              return (
                <article key={zone.id} className="atlas-zone-card-with-actions">
                  <ZoneCard zone={zone} />
                  <div className="atlas-zone-card-actions">
                    <Link
                      href={`/zones/${zone.stable_key}`}
                      className="atlas-zone-action atlas-zone-action-secondary"
                      aria-label={`Open ${zone.label} zone inspector`}
                    >
                      Open zone →
                    </Link>
                    <Link
                      href={mapRoute.href}
                      className="atlas-zone-action atlas-zone-action-primary"
                      aria-label={mapRoute.label}
                    >
                      Visual map →
                    </Link>
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      </section>

      <style jsx>{`
        .atlas-zone-card-with-actions {
          overflow: hidden;
          border: 1px solid #d5cec3;
          border-radius: 16px;
          background: #fffdfa;
        }

        .atlas-zone-card-with-actions :global(.atlas-zone-landing-card) {
          border: 0;
          border-radius: 0;
          box-shadow: none;
        }

        .atlas-zone-card-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          padding: 0 12px 12px;
        }

        .atlas-zone-action {
          display: block;
          padding: 11px 12px;
          border-radius: 10px;
          text-align: center;
          text-decoration: none;
          font-weight: 850;
        }

        .atlas-zone-action-secondary {
          border: 1px solid #d5cec3;
          background: #f7f2e9;
          color: #29263a;
        }

        .atlas-zone-action-primary {
          background: #6d5892;
          color: white;
        }

        .atlas-zone-action-primary:hover,
        .atlas-zone-action-primary:focus-visible {
          background: #5d487f;
        }

        .atlas-zone-action-secondary:hover,
        .atlas-zone-action-secondary:focus-visible {
          background: #eee7dc;
        }
      `}</style>
    </main>
  );
}
