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
              <svg viewBox="0 0 1000 760" role="img" aria-labelledby="berry-map-title berry-map-desc">
                <title id="berry-map-title">Berry Walk field diagram</title>
                <desc id="berry-map-desc">Ten flower beds in two groups, four asparagus beds, two rail-tie tulip beds, the crescent moon bed, and the spiral walk.</desc>

                <text x="500" y="34" textAnchor="middle" className="direction">North / dining-room side</text>
                <path d="M500 48 L500 78 M488 61 L500 48 L512 61" className="line" />

                <text x="245" y="92" textAnchor="middle" className="section-title">Berry Walk Flower Rows</text>
                <text x="245" y="114" textAnchor="middle" className="section-note">10 beds · 3 ft × 22 ft · 2 ft mulch walks</text>

                {beds.slice(0, 5).map((object, index) => {
                  const y = 135 + index * 66;
                  const lines = labelFor(object, `BW${index + 1}\nnot found`).split("\n");
                  return (
                    <g key={`west-${index}`}>
                      <rect x="70" y={y} width="350" height="44" rx="5" fill={object ? bedTone(object) : "#eee"} className="bed" />
                      <text x="245" y={y + 18} textAnchor="middle" className="bed-title">{lines[0]}</text>
                      <text x="245" y={y + 34} textAnchor="middle" className="bed-crop">{lines[1]}</text>
                    </g>
                  );
                })}

                <rect x="438" y="135" width="44" height="308" className="walkway" />
                <text x="460" y="290" textAnchor="middle" transform="rotate(-90 460 290)" className="walk-label">3 ft center walkway</text>

                {beds.slice(5, 10).map((object, index) => {
                  const y = 135 + index * 66;
                  const lines = labelFor(object, `BW${index + 6}\nnot found`).split("\n");
                  return (
                    <g key={`east-${index}`}>
                      <rect x="500" y={y} width="350" height="44" rx="5" fill={object ? bedTone(object) : "#eee"} className="bed" />
                      <text x="675" y={y + 18} textAnchor="middle" className="bed-title">{lines[0]}</text>
                      <text x="675" y={y + 34} textAnchor="middle" className="bed-crop">{lines[1]}</text>
                    </g>
                  );
                })}

                <text x="880" y="92" textAnchor="middle" className="section-title">Asparagus connection</text>
                <text x="880" y="114" textAnchor="middle" className="section-note">18 in walks · widths 2 / 3 / 2 / 3 ft</text>
                {asparagus.map((object, index) => {
                  const x = 872 + (index % 2) * 48;
                  const y = 145 + Math.floor(index / 2) * 148;
                  const width = index % 2 === 0 ? 30 : 42;
                  return (
                    <g key={`asparagus-${index}`}>
                      <rect x={x} y={y} width={width} height="116" rx="4" className="asparagus" />
                      <text x={x + width / 2} y={y + 59} textAnchor="middle" transform={`rotate(-90 ${x + width / 2} ${y + 59})`} className="vertical-label">A{index + 1}</text>
                    </g>
                  );
                })}

                <path d="M70 468 H932" className="divider" />
                <text x="500" y="498" textAnchor="middle" className="section-title">Original Berry Walk</text>

                <rect x="420" y="520" width="78" height="102" rx="4" className="tulip-bed" />
                <rect x="502" y="520" width="78" height="102" rx="4" className="tulip-bed" />
                <text x="459" y="548" textAnchor="middle" className="small-title">North</text>
                <text x="459" y="566" textAnchor="middle" className="small-label">rail-tie</text>
                <text x="459" y="584" textAnchor="middle" className="small-label">tulips</text>
                <text x="541" y="548" textAnchor="middle" className="small-title">South</text>
                <text x="541" y="566" textAnchor="middle" className="small-label">rail-tie</text>
                <text x="541" y="584" textAnchor="middle" className="small-label">tulips</text>
                <path d="M459 520 Q500 475 541 520" className="arch" />
                <text x="500" y="512" textAnchor="middle" className="small-label">future arch / entrance</text>

                <path d="M92 704 A225 225 0 0 1 542 704 L470 704 A153 153 0 0 0 164 704 Z" className="crescent" />
                <text x="317" y="672" textAnchor="middle" className="bed-title">Crescent Moon</text>
                <text x="317" y="692" textAnchor="middle" className="bed-crop">{crescent ? compactCrop(crescent) : "zinnias + celosia"}</text>

                <path d="M785 698 C670 698 650 590 750 565 C850 540 914 622 860 680 C820 722 742 690 758 631 C770 589 830 590 837 627 C842 653 811 670 790 652" className="spiral" />
                <text x="780" y="536" textAnchor="middle" className="bed-title">Spiral walk</text>
                <text x="780" y="554" textAnchor="middle" className="bed-crop">{spiral ? `${Math.round(Number(spiral.length_ft || 162))} ft · ${spiral.width_ft || 2} ft wide` : "stone-lined path"}</text>

                <text x="500" y="744" textAnchor="middle" className="direction">South / guest entrance side</text>
              </svg>
            </div>

            <section className="berry-map-legend">
              <div><span className="swatch growing" />Growing / established</div>
              <div><span className="swatch emerging" />Emerging</div>
              <div><span className="swatch partial" />Sparse / partial</div>
              <div><span className="swatch open" />Open / no crop record</div>
            </section>

            <p className="berry-map-source">Current registry: {flowerZone.object_count} Berry Walk row/asparagus objects and {originalZone.object_count} Original Berry Walk objects. Rail-tie beds: {northTulip?.length_ft ?? 8.5} × {northTulip?.width_ft ?? 4} ft and {southTulip?.length_ft ?? 8.5} × {southTulip?.width_ft ?? 4} ft.</p>
          </>
        ) : null}
      </section>

      <style jsx>{`
        .berry-map-shell { min-height: 100vh; background: #f4f0e8; color: #211f1c; padding: 18px; }
        .berry-map-page { width: min(100%, 980px); margin: 0 auto; }
        .berry-map-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 16px; }
        .berry-map-header span { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; font-weight: 800; color: #69558c; }
        .berry-map-header h1 { margin: 3px 0 5px; font-size: clamp(30px, 6vw, 52px); }
        .berry-map-header p { margin: 0; color: #625e58; }
        .berry-map-header a { background: #6d5892; color: white; text-decoration: none; padding: 11px 14px; border-radius: 999px; font-weight: 800; white-space: nowrap; }
        .berry-map-frame { background: #fffdfa; border: 2px solid #25231f; border-radius: 16px; padding: 8px; box-shadow: 0 10px 35px rgba(47, 39, 29, .08); overflow-x: auto; }
        svg { display: block; width: 100%; min-width: 720px; height: auto; font-family: inherit; }
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
        .walk-label, .vertical-label { font-size: 12px; font-weight: 850; }
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
