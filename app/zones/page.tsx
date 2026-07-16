"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import { ZoneLandingCard } from "@/components/atlas/zone-inspection";
import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

const MAP_ROUTES: Record<string, { href: string; label: string }> = {
  main_garden: { href: "/zones/main-garden-map", label: "Open Main Garden map" },
  original_berry_walk: { href: "/zones/berry-walk-map", label: "Open Berry Walk map" },
  berry_walk_flower_rows: { href: "/zones/berry-walk-map", label: "Open Berry Walk map" },
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

          <section className="atlas-field-maps" aria-labelledby="field-maps-title">
            <div className="atlas-field-maps-heading">
              <span className="atlas-home-kicker">Visual navigation</span>
              <h2 id="field-maps-title">Field Maps</h2>
              <p>Open a live map, then tap a bed to see what is growing there.</p>
            </div>

            <div className="atlas-field-maps-grid">
              <Link
                href="/zones/main-garden-map"
                className="atlas-zone-landing-link"
                aria-label="Open the Main Garden field diagram"
              >
                <article className="atlas-zone-landing-card atlas-field-map-card">
                  <span className="atlas-home-kicker">Field diagram</span>
                  <h3>Main Garden map</h3>
                  <p>Eight clock-face beds, eight walkways, and the center diamond.</p>
                  <div className="atlas-zone-landing-card-footer">
                    <span>Tap a bed for details</span>
                    <strong>Open map →</strong>
                  </div>
                </article>
              </Link>

              <Link
                href="/zones/berry-walk-map"
                className="atlas-zone-landing-link"
                aria-label="Open the Berry Walk field diagram"
              >
                <article className="atlas-zone-landing-card atlas-field-map-card">
                  <span className="atlas-home-kicker">Field diagram</span>
                  <h3>Berry Walk map</h3>
                  <p>Flower rows, asparagus beds, rail ties, crescent, and spiral.</p>
                  <div className="atlas-zone-landing-card-footer">
                    <span>Tap a bed for details</span>
                    <strong>Open map →</strong>
                  </div>
                </article>
              </Link>
            </div>
          </section>

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
                      Open map →
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </section>
        </div>
      </section>

      <style jsx>{`
        .atlas-field-maps {
          display: grid;
          gap: 12px;
          margin-bottom: 20px;
        }

        .atlas-field-maps-heading h2 {
          margin: 3px 0 4px;
          font-size: 24px;
        }

        .atlas-field-maps-heading p {
          margin: 0;
          color: #625e58;
          font-size: 14px;
        }

        .atlas-field-maps-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .atlas-field-map-card {
          height: 100%;
        }

        .atlas-field-map-card h3 {
          margin: 4px 0 6px;
          font-size: 20px;
        }

        .atlas-field-map-card p {
          margin: 0 0 12px;
        }

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

        @media (max-width: 640px) {
          .atlas-field-maps-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
