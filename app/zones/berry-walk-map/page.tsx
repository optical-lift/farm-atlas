"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

function byKey(objects: AtlasRegistryObject[]) {
  return new Map(objects.map((object) => [object.stable_key, object]));
}

function bedTone(object: AtlasRegistryObject | undefined) {
  if (!object) return "#eee9df";
  const status = object.contents[0]?.status ?? object.inspection_summary?.stage ?? "";
  const normalized = status.toLowerCase();
  if (normalized.includes("no_emergence") || normalized.includes("failed")) return "#f3d8d3";
  if (normalized.includes("sparse") || normalized.includes("partial")) return "#f5e7bd";
  if (normalized.includes("germin") || normalized.includes("emerg")) return "#dcebd2";
  if (object.contents.length > 0) return "#c7dfba";
  return "#f7f2e9";
}

function ObjectLink({
  object,
  zoneKey,
  ariaLabel,
  children,
}: {
  object: AtlasRegistryObject | undefined;
  zoneKey: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (!object) return <g>{children}</g>;
  return (
    <Link
      href={`/zones/${zoneKey}?object=${encodeURIComponent(object.stable_key)}`}
      aria-label={ariaLabel}
      className="map-object-link"
    >
      {children}
    </Link>
  );
}

export default function BerryWalkMapPage() {
  const [zones, setZones] = useState<AtlasRegistryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchAtlasZoneRegistry()
      .then((response) => setZones(response.zones ?? []))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Atlas could not load Berry Walk."))
      .finally(() => setLoading(false));
  }, []);

  const flowerZone = zones.find((zone) => zone.stable_key === "berry_walk_flower_rows") ?? null;
  const originalZone = zones.find((zone) => zone.stable_key === "original_berry_walk") ?? null;
  const flowerObjects = useMemo(() => byKey(flowerZone?.objects ?? []), [flowerZone]);
  const originalObjects = useMemo(() => byKey(originalZone?.objects ?? []), [originalZone]);

  const beds = Array.from({ length: 10 }, (_, index) => flowerObjects.get(`bw_${index + 1}`));
  const asparagus = Array.from({ length: 4 }, (_, index) => flowerObjects.get(`asparagus_${index + 1}`));
  const crescent = originalObjects.get("berry_walk_crescent_moon");
  const spiral = originalObjects.get("berry_walk_labyrinth_walk");
  const northTulip = originalObjects.get("berry_walk_rail_tie_bed_north");
  const southTulip = originalObjects.get("berry_walk_rail_tie_bed_south");

  const asparagusSections = [
    { object: asparagus[1], x: 70, y: 780, width: 250, label: "A2" },
    { object: asparagus[3], x: 390, y: 780, width: 250, label: "A4" },
    { object: asparagus[0], x: 70, y: 860, width: 250, label: "A1" },
    { object: asparagus[2], x: 390, y: 860, width: 250, label: "A3" },
  ];

  return (
    <main className="berry-map-shell">
      <section className="berry-map-page">
        <header className="berry-map-header">
          <div>
            <span>Atlas field diagram</span>
            <h1>Berry Walk</h1>
            <p>North-up field map with live Atlas objects.</p>
          </div>
          <Link href="/zones/original_berry_walk">Zone inspector</Link>
        </header>

        {loading ? <div className="berry-map-message">Loading the current farm map…</div> : null}
        {error ? <div className="berry-map-message error">{error}</div> : null}

        {!loading && flowerZone && originalZone ? (
          <>
            <div className="berry-map-frame">
              <svg viewBox="0 0 720 1340" role="img" aria-labelledby="berry-map-title berry-map-desc">
                <title id="berry-map-title">Berry Walk north-up field diagram</title>
                <desc id="berry-map-desc">A shallower Crescent Moon wraps around the spiral, rail-tie beds sit east of it, and one north-south center walkway continues through both asparagus and the ten Berry Walk flower rows.</desc>

                <text x="360" y="30" textAnchor="middle" className="direction">North</text>
                <path d="M360 44 V72 M348 58 L360 44 L372 58" className="line" />

                <text x="350" y="105" textAnchor="middle" className="section-title">Original Berry Walk</text>
                <text x="350" y="127" textAnchor="middle" className="section-note">crescent wrapping the spiral · rail-tie entrance on east side</text>

                <ObjectLink object={crescent} zoneKey="original_berry_walk" ariaLabel="Open Crescent Moon in the zone inspector">
                  <path d="M92 500 C82 300 220 155 430 155 C590 155 675 300 625 480 C585 420 515 372 430 340 C310 300 205 350 92 500 Z" fill={bedTone(crescent)} className="crescent clickable-shape" />
                  <text x="330" y="205" textAnchor="middle" className="object-title">Crescent Moon</text>
                </ObjectLink>

                <ObjectLink object={spiral} zoneKey="original_berry_walk" ariaLabel="Open the Berry Walk spiral path in the zone inspector">
                  <path d="M355 655 C195 655 185 480 337 430 C490 380 590 520 505 607 C445 668 325 620 350 525 C370 448 462 458 474 522 C484 570 430 600 394 565" className="spiral clickable-path" />
                  <text x="350" y="390" textAnchor="middle" className="object-title">Spiral / labyrinth</text>
                </ObjectLink>

                <ObjectLink object={northTulip} zoneKey="original_berry_walk" ariaLabel="Open the north rail-tie bed in the zone inspector">
                  <rect x="610" y="360" width="54" height="125" rx="5" fill={bedTone(northTulip)} className="tulip-bed clickable-shape" />
                  <text x="637" y="423" textAnchor="middle" transform="rotate(-90 637 423)" className="small-title">North rail-tie</text>
                </ObjectLink>

                <ObjectLink object={southTulip} zoneKey="original_berry_walk" ariaLabel="Open the south rail-tie bed in the zone inspector">
                  <rect x="610" y="525" width="54" height="125" rx="5" fill={bedTone(southTulip)} className="tulip-bed clickable-shape" />
                  <text x="637" y="588" textAnchor="middle" transform="rotate(-90 637 588)" className="small-title">South rail-tie</text>
                </ObjectLink>
                <path d="M610 485 Q565 505 610 525" className="arch" />
                <text x="570" y="510" textAnchor="end" className="small-label">guest entrance</text>

                <text x="360" y="730" textAnchor="middle" className="section-title">Asparagus</text>
                <text x="360" y="752" textAnchor="middle" className="section-note">A2 / A4 north · A1 / A3 south</text>

                {asparagusSections.map((section) => (
                  <ObjectLink key={section.label} object={section.object} zoneKey="berry_walk_flower_rows" ariaLabel={`Open ${section.label} in the zone inspector`}>
                    <rect x={section.x} y={section.y} width={section.width} height="52" rx="5" className="asparagus clickable-shape" />
                    <text x={section.x + section.width / 2} y={section.y + 32} textAnchor="middle" className="small-title">{section.label}</text>
                  </ObjectLink>
                ))}

                <rect x="90" y="840" width="540" height="12" className="center-walkway" />
                <rect x="344" y="770" width="32" height="473" className="center-walkway" />

                <text x="360" y="965" textAnchor="middle" className="section-title">Berry Walk Flower Rows</text>
                <text x="360" y="987" textAnchor="middle" className="section-note">BW1–BW5 west · BW6–BW10 east · numbered south to north</text>

                {beds.map((object, index) => {
                  const bedNumber = index + 1;
                  const leftGroup = bedNumber <= 5;
                  const positionFromSouth = leftGroup ? bedNumber - 1 : bedNumber - 6;
                  const rowFromTop = 4 - positionFromSouth;
                  const x = leftGroup ? 70 : 390;
                  const y = 1015 + rowFromTop * 48;
                  return (
                    <ObjectLink key={`bw-${bedNumber}`} object={object} zoneKey="berry_walk_flower_rows" ariaLabel={`Open BW${bedNumber} in the zone inspector`}>
                      <rect x={x} y={y} width="250" height="34" rx="5" fill={bedTone(object)} className="bed clickable-shape" />
                      <text x={x + 125} y={y + 23} textAnchor="middle" className="bed-title">BW{bedNumber}</text>
                    </ObjectLink>
                  );
                })}

                <text x="360" y="1124" textAnchor="middle" transform="rotate(-90 360 1124)" className="walk-label">3 ft center walkway</text>

                <text x="360" y="1305" textAnchor="middle" className="direction">South</text>
                <path d="M360 1265 V1292 M348 1279 L360 1292 L372 1279" className="line" />
              </svg>
            </div>

            <section className="berry-map-legend">
              <div><span className="swatch growing" />Growing / established</div>
              <div><span className="swatch emerging" />Emerging</div>
              <div><span className="swatch partial" />Sparse / partial</div>
              <div><span className="swatch open" />Open / no crop record</div>
            </section>

            <p className="berry-map-source">North-up field map: BW1–BW5 run up the west side from south to north, BW6–BW10 run up the east side from south to north, A2 and A4 touch the Original Berry Walk, and A1 and A3 touch the flower rows. The north-south center walkway now continues through both the asparagus and flower-row sections. Tap a mapped object to open its Atlas record.</p>
          </>
        ) : null}
      </section>

      <style jsx>{`
        .berry-map-shell { min-height: 100vh; background: #f4f0e8; color: #211f1c; padding: 18px; }
        .berry-map-page { width: min(100%, 760px); margin: 0 auto; }
        .berry-map-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 16px; }
        .berry-map-header span { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; font-weight: 800; color: #69558c; }
        .berry-map-header h1 { margin: 3px 0 5px; font-size: clamp(30px, 6vw, 52px); }
        .berry-map-header p { margin: 0; color: #625e58; }
        .berry-map-header a { background: #6d5892; color: white; text-decoration: none; padding: 11px 14px; border-radius: 999px; font-weight: 800; white-space: nowrap; }
        .berry-map-frame { background: #fffdfa; border: 2px solid #25231f; border-radius: 16px; padding: 8px; box-shadow: 0 10px 35px rgba(47,39,29,.08); overflow: hidden; }
        svg { display: block; width: 100%; min-width: 0; height: auto; font-family: inherit; }
        .line, .arch, .spiral { fill: none; stroke: #22211e; stroke-width: 3; }
        .arch { stroke-width: 4; }
        .spiral { stroke-width: 14; stroke-linecap: round; }
        .bed, .asparagus, .tulip-bed, .crescent, .center-walkway { stroke: #25231f; stroke-width: 2.5; }
        .asparagus { fill: #adc891; }
        .tulip-bed { fill: #ddd2e8; }
        .crescent { stroke-width: 3; }
        .center-walkway { fill: #fffdfa; }
        .direction { font-size: 18px; font-weight: 850; }
        .section-title { font-size: 18px; font-weight: 900; }
        .section-note { font-size: 12px; font-weight: 700; fill: #666158; }
        .object-title, .bed-title, .small-title { font-size: 15px; font-weight: 900; pointer-events: none; }
        .small-label { font-size: 11px; font-weight: 700; fill: #4e4a44; }
        .walk-label { font-size: 11px; font-weight: 850; pointer-events: none; }
        .clickable-shape, .clickable-path { cursor: pointer; transition: opacity .15s ease, stroke-width .15s ease; }
        :global(.map-object-link:hover) .clickable-shape, :global(.map-object-link:focus-visible) .clickable-shape { opacity: .78; stroke-width: 5; }
        :global(.map-object-link:hover) .clickable-path, :global(.map-object-link:focus-visible) .clickable-path { opacity: .68; stroke-width: 19; }
        :global(.map-object-link:focus-visible) { outline: none; }
        .berry-map-legend { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; margin: 12px 0; }
        .berry-map-legend div { background: #fffdfa; border: 1px solid #d5cec3; border-radius: 10px; padding: 9px 10px; font-size: 12px; font-weight: 750; }
        .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 7px; vertical-align: -1px; border: 1px solid #777; }
        .growing { background: #c7dfba; } .emerging { background: #dcebd2; } .partial { background: #f5e7bd; } .open { background: #f7f2e9; }
        .berry-map-source, .berry-map-message { background: #fffdfa; border-radius: 12px; padding: 12px 14px; font-size: 13px; color: #59544d; }
        .berry-map-message.error { color: #8c2929; }
        @media (max-width: 700px) {
          .berry-map-shell { padding: 12px; }
          .berry-map-header { align-items: stretch; flex-direction: column; gap: 12px; }
          .berry-map-header a { text-align: center; }
          .berry-map-legend { grid-template-columns: repeat(2,minmax(0,1fr)); }
        }
      `}</style>
    </main>
  );
}
