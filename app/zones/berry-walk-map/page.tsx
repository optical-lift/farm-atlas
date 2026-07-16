"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

function compactCrop(object: AtlasRegistryObject) {
  const content = object.contents[0];
  if (!content) return object.object_type === "path" ? "walkway" : "open";
  return (content.variety || content.content_label)
    .replace(/sunflower/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bedTone(object: AtlasRegistryObject) {
  const status = object.contents[0]?.status ?? object.inspection_summary?.stage ?? "";
  const normalized = status.toLowerCase();
  if (normalized.includes("no_emergence") || normalized.includes("failed")) return "#f3d8d3";
  if (normalized.includes("sparse") || normalized.includes("partial")) return "#f5e7bd";
  if (normalized.includes("germin") || normalized.includes("emerg")) return "#dcebd2";
  if (object.contents.length > 0) return "#c7dfba";
  return "#f7f2e9";
}

function byKey(objects: AtlasRegistryObject[]) {
  return new Map(objects.map((object) => [object.stable_key, object]));
}

function labelFor(object: AtlasRegistryObject | undefined, fallback: string) {
  return object ? `${object.label.replace("Berry Walk Bed ", "BW")}\n${compactCrop(object)}` : fallback;
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

  return (
    <main className="berry-map-shell">
      <section className="berry-map-page">
        <header className="berry-map-header">
          <div>
            <span>Atlas field diagram</span>
            <h1>Berry Walk</h1>
            <p>Live labels and crop status are pulled from the Atlas zone registry.</p>
          </div>
          <Link href="/zones/original_berry_walk">Zone inspector</Link>
        </header>

        {loading ? <div className="berry-map-message">Loading the current farm map…</div> : null}
        {error ? <div className="berry-map-message error">{error}</div> : null}

        {!loading && flowerZone && originalZone ? (
          <>
            <div className="berry-map-frame">
              <svg viewBox="0 0 1240 720" role="img" aria-labelledby="berry-map-title berry-map-desc">
                <title id="berry-map-title">Berry Walk field diagram</title>
                <desc id="berry-map-desc">East-west flower beds on the left, east-west asparagus beds beside them, Original Berry Walk and spiral to the right, rail-tie beds at the guest entrance, and the crescent moon at the far right.</desc>

                <text x="620" y="32" textAnchor="middle" className="direction">North / dining-room side</text>
                <path d="M620 45 L620 75 M608 58 L620 45 L632 58" className="line" />

                <text x="250" y="94" textAnchor="middle" className="section-title">Berry Walk Flower Rows</text>
                <text x="250" y="115" textAnchor="middle" className="section-note">10 east-west beds · 3 ft × 22 ft · 2 ft mulch walks</text>

                {beds.map((object, index) => {
                  const groupIndex = index < 5 ? index : index - 5;
                  const x = 48 + groupIndex * 82;
                  const y = index < 5 ? 136 : 408;
                  const lines = labelFor(object, `BW${index + 1}\nnot found`).split("\n");
                  const centerX = x + 32;
                  const centerY = y + 102;
                  return (
                    <g key={`bed-${index}`}>
                      <rect x={x} y={y} width="64" height="204" rx="5" fill={object ? bedTone(object) : "#eee"} className="bed" />
                      <text x={centerX} y={centerY - 8} textAnchor="middle" transform={`rotate(-90 ${centerX} ${centerY - 8})`} className="bed-title">{lines[0]}</text>
                      <text x={centerX} y={centerY + 10} textAnchor="middle" transform={`rotate(-90 ${centerX} ${centerY + 10})`} className="bed-crop">{lines[1]}</text>
                    </g>
                  );
                })}

                <rect x="42" y="360" width="416" height="28" className="walkway" />
                <text x="250" y="379" textAnchor="middle" className="walk-label">3 ft center walkway between the two groups of five</text>

                <path d="M478 104 V668" className="divider" />
                <text x="562" y="94" textAnchor="middle" className="section-title">Asparagus</text>
                <text x="562" y="115" textAnchor="middle" className="section-note">four east-west beds · 18 in walks</text>

                {asparagus.map((object, index) => {
                  const widths = [34, 48, 34, 48];
                  const gap = 10;
                  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * 3;
                  const left = 562 - totalWidth / 2;
                  const x = left + widths.slice(0, index).reduce((sum, width) => sum + width, 0) + gap * index;
                  const width = widths[index];
                  const centerX = x + width / 2;
                  const centerY = 384;
                  return (
                    <g key={`asparagus-${index}`}>
                      <rect x={x} y="144" width={width} height="480" rx="5" className="asparagus" />
                      <text x={centerX} y={centerY - 8} textAnchor="middle" transform={`rotate(-90 ${centerX} ${centerY - 8})`} className="small-title">A{index + 1}</text>
                      <text x={centerX} y={centerY + 12} textAnchor="middle" transform={`rotate(-90 ${centerX} ${centerY + 12})`} className="small-label">{object?.width_ft ?? (index % 2 === 0 ? 2 : 3)} ft wide</text>
                    </g>
                  );
                })}

                <path d="M648 104 V668" className="divider" />
                <text x="835" y="94" textAnchor="middle" className="section-title">Original Berry Walk</text>
                <text x="835" y="115" textAnchor="middle" className="section-note">stone spiral / labyrinth · rail-tie entrance at south end</text>

                <path d="M838 510 C708 510 690 370 807 334 C924 298 1014 398 951 471 C905 526 814 487 834 417 C849 365 919 369 926 414 C932 448 895 469 870 446" className="spiral" />
                <text x="835" y="240" textAnchor="middle" className="bed-title">Spiral / labyrinth walk</text>
                <text x="835" y="260" textAnchor="middle" className="bed-crop">{spiral ? `${Math.round(Number(spiral.length_ft || 162))} ft · ${spiral.width_ft || 2} ft wide` : "stone-lined path"}</text>

                <rect x="676" y="594" width="136" height="54" rx="4" className="tulip-bed" />
                <rect x="858" y="594" width="136" height="54" rx="4" className="tulip-bed" />
                <text x="744" y="617" textAnchor="middle" className="small-title">North rail-tie bed</text>
                <text x="744" y="637" textAnchor="middle" className="small-label">florist tulips</text>
                <text x="926" y="617" textAnchor="middle" className="small-title">South rail-tie bed</text>
                <text x="926" y="637" textAnchor="middle" className="small-label">florist tulips</text>
                <path d="M812 594 Q835 558 858 594" className="arch" />
                <text x="835" y="552" textAnchor="middle" className="small-label">future arch / guest entrance</text>

                <path d="M982 154 V668" className="divider" />
                <text x="1105" y="94" textAnchor="middle" className="section-title">Crescent Moon</text>
                <text x="1105" y="115" textAnchor="middle" className="section-note">furthest-right garden end</text>
                <path d="M1024 620 A170 240 0 0 0 1024 160 A116 188 0 0 1 1024 620 Z" className="crescent" />
                <text x="1100" y="376" textAnchor="middle" className="bed-title">Crescent Moon</text>
                <text x="1100" y="397" textAnchor="middle" className="bed-crop">{crescent ? compactCrop(crescent) : "zinnias + celosia"}</text>

                <text x="620" y="700" textAnchor="middle" className="direction">South / guest entrance side</text>
              </svg>
            </div>

            <section className="berry-map-legend">
              <div><span className="swatch growing" />Growing / established</div>
              <div><span className="swatch emerging" />Emerging</div>
              <div><span className="swatch partial" />Sparse / partial</div>
              <div><span className="swatch open" />Open / no crop record</div>
            </section>

            <p className="berry-map-source">Corrected field order: Flower Rows → Asparagus → Original Berry Walk / spiral → Crescent Moon. Flower-row and asparagus bed shapes are rotated to match their real east-west run. The two rail-tie florist-tulip beds sit at the south guest entrance below the spiral. Current registry: {flowerZone.object_count} Berry Walk row/asparagus objects and {originalZone.object_count} Original Berry Walk objects. Rail-tie beds: {northTulip?.length_ft ?? 8.5} × {northTulip?.width_ft ?? 4} ft and {southTulip?.length_ft ?? 8.5} × {southTulip?.width_ft ?? 4} ft.</p>
          </>
        ) : null}
      </section>

      <style jsx>{`
        .berry-map-shell { min-height: 100vh; background: #f4f0e8; color: #211f1c; padding: 18px; }
        .berry-map-page { width: min(100%, 1180px); margin: 0 auto; }
        .berry-map-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 16px; }
        .berry-map-header span { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; font-weight: 800; color: #69558c; }
        .berry-map-header h1 { margin: 3px 0 5px; font-size: clamp(30px, 6vw, 52px); }
        .berry-map-header p { margin: 0; color: #625e58; }
        .berry-map-header a { background: #6d5892; color: white; text-decoration: none; padding: 11px 14px; border-radius: 999px; font-weight: 800; white-space: nowrap; }
        .berry-map-frame { background: #fffdfa; border: 2px solid #25231f; border-radius: 16px; padding: 8px; box-shadow: 0 10px 35px rgba(47, 39, 29, .08); overflow-x: auto; }
        svg { display: block; width: 100%; min-width: 980px; height: auto; font-family: inherit; }
        .line, .divider, .arch, .spiral { fill: none; stroke: #22211e; stroke-width: 3; }
        .divider { stroke-width: 2; }
        .arch { stroke-width: 4; }
        .spiral { stroke-width: 13; stroke-linecap: round; }
        .bed, .asparagus, .tulip-bed, .crescent, .walkway { stroke: #25231f; stroke-width: 2.5; }
        .walkway { fill: #eee9df; }
        .asparagus { fill: #adc891; }
        .tulip-bed { fill: #ddd2e8; }
        .crescent { fill: #d8cbe4; stroke-width: 3; }
        .direction { font-size: 18px; font-weight: 800; }
        .section-title { font-size: 18px; font-weight: 900; }
        .section-note { font-size: 12px; font-weight: 700; fill: #666158; }
        .bed-title, .small-title { font-size: 14px; font-weight: 900; }
        .bed-crop, .small-label { font-size: 11px; font-weight: 650; fill: #4e4a44; }
        .walk-label { font-size: 12px; font-weight: 850; }
        .berry-map-legend { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
        .berry-map-legend div { background: #fffdfa; border: 1px solid #d5cec3; border-radius: 10px; padding: 9px 10px; font-size: 12px; font-weight: 750; }
        .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 7px; vertical-align: -1px; border: 1px solid #777; }
        .growing { background: #c7dfba; } .emerging { background: #dcebd2; } .partial { background: #f5e7bd; } .open { background: #f7f2e9; }
        .berry-map-source, .berry-map-message { background: #fffdfa; border-radius: 12px; padding: 12px 14px; font-size: 13px; color: #59544d; }
        .berry-map-message.error { color: #8c2929; }
        @media (max-width: 700px) {
          .berry-map-shell { padding: 12px; }
          .berry-map-header { align-items: stretch; flex-direction: column; gap: 12px; }
          .berry-map-header a { text-align: center; }
          .berry-map-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>
    </main>
  );
}
