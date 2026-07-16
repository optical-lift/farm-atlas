"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasZoneRegistry,
  type AtlasRegistryObject,
  type AtlasRegistryZone,
} from "@/lib/atlas/zone-registry-client";

function objectMap(objects: AtlasRegistryObject[]) {
  return new Map(objects.map((object) => [object.stable_key, object]));
}

function cropSummary(object: AtlasRegistryObject | undefined) {
  if (!object) return "not found";
  const labels = object.contents
    .map((content) => content.content_label || content.variety)
    .filter(Boolean)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 2)
    .map((label) => String(label).replace(/ plant cluster$/i, "").replace(/ collection$/i, ""));
  return labels.length ? labels.join(" · ") : "no crop record";
}

function bedTone(object: AtlasRegistryObject | undefined) {
  if (!object) return "#ece8e0";
  const life = String((object as AtlasRegistryObject & { life_status?: string | null }).life_status ?? "").toLowerCase();
  const weed = String((object as AtlasRegistryObject & { weed_pressure?: string | null }).weed_pressure ?? "").toLowerCase();
  if (life.includes("reset") || weed.includes("severe")) return "#f0c7c0";
  if (weed.includes("high")) return "#f2dfad";
  if (life.includes("establish")) return "#dbe9cf";
  if (object.contents.length > 0) return "#c9dfbc";
  return "#eee9df";
}

function BedLabel({ object, x, y }: { object: AtlasRegistryObject | undefined; x: number; y: number }) {
  return (
    <g>
      <text x={x} y={y} textAnchor="middle" className="bed-title">{object?.label ?? "Missing bed"}</text>
      <text x={x} y={y + 20} textAnchor="middle" className="bed-crop">{cropSummary(object)}</text>
    </g>
  );
}

export default function MainGardenMapPage() {
  const [zones, setZones] = useState<AtlasRegistryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchAtlasZoneRegistry()
      .then((response) => setZones(response.zones ?? []))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Atlas could not load the Main Garden."))
      .finally(() => setLoading(false));
  }, []);

  const zone = zones.find((candidate) => candidate.stable_key === "main_garden") ?? null;
  const objects = useMemo(() => objectMap(zone?.objects ?? []), [zone]);
  const beds = {
    mg1: objects.get("mg1"), mg2: objects.get("mg2"), mg4: objects.get("mg4"), mg5: objects.get("mg5"),
    mg7: objects.get("mg7"), mg8: objects.get("mg8"), mg10: objects.get("mg10"), mg11: objects.get("mg11"),
  };
  const center = objects.get("mg_center_diamond") ?? objects.get("main_garden_center");

  return (
    <main className="garden-map-shell">
      <section className="garden-map-page">
        <header className="garden-map-header">
          <div>
            <span>Atlas field diagram</span>
            <h1>Main Garden</h1>
            <p>The clock-face beds and live crop labels are pulled from the Atlas zone registry.</p>
          </div>
          <Link href="/zones/main_garden">Zone inspector</Link>
        </header>

        {loading ? <div className="garden-map-message">Loading the current garden map…</div> : null}
        {error ? <div className="garden-map-message error">{error}</div> : null}

        {!loading && zone ? (
          <>
            <div className="garden-map-frame">
              <svg viewBox="0 0 1000 900" role="img" aria-labelledby="main-garden-title main-garden-desc">
                <title id="main-garden-title">Main Garden clock-face diagram</title>
                <desc id="main-garden-desc">Eight growing beds arranged around a center diamond, with eight fully defined white walkways between them.</desc>

                <text x="500" y="34" textAnchor="middle" className="direction">North / back of garden</text>
                <path d="M500 48 V78 M488 62 L500 48 L512 62" className="line" />

                <rect x="55" y="95" width="890" height="700" rx="2" className="outer" />

                <polygon points="560,95 945,95 945,145 650,350 590,315 560,315" fill={bedTone(beds.mg1)} className="bed" />
                <polygon points="945,195 945,455 655,455 625,415" fill={bedTone(beds.mg2)} className="bed" />
                <polygon points="655,495 945,495 945,795 825,795 625,610" fill={bedTone(beds.mg4)} className="bed" />
                <polygon points="590,575 650,540 905,795 560,795 560,575" fill={bedTone(beds.mg5)} className="bed" />
                <polygon points="440,575 380,540 125,795 55,795 440,795" fill={bedTone(beds.mg7)} className="bed" />
                <polygon points="345,495 55,495 55,795 175,795 375,610" fill={bedTone(beds.mg8)} className="bed" />
                <polygon points="345,455 55,455 55,195 375,415" fill={bedTone(beds.mg10)} className="bed" />
                <polygon points="440,95 55,95 55,145 350,350 410,315 440,315" fill={bedTone(beds.mg11)} className="bed" />

                <polygon points="500,340 620,455 500,575 380,455" className="center" />
                <text x="500" y="443" textAnchor="middle" className="center-title">Center Diamond</text>
                <text x="500" y="466" textAnchor="middle" className="center-note">{center?.area_sqft ? `${Math.round(Number(center.area_sqft))} sq ft` : "clock face"}</text>

                <rect x="440" y="95" width="120" height="220" className="walkway" />
                <rect x="440" y="575" width="120" height="220" className="walkway" />
                <rect x="55" y="455" width="290" height="40" className="walkway" />
                <rect x="655" y="455" width="290" height="40" className="walkway" />

                <polygon points="55,145 75,175 380,415 410,385" className="walkway" />
                <polygon points="590,385 620,415 945,175 945,145" className="walkway" />
                <polygon points="345,495 375,525 175,795 125,795" className="walkway" />
                <polygon points="625,525 655,495 905,795 825,795" className="walkway" />

                <text x="500" y="205" textAnchor="middle" className="walk-label">12 walkway</text>
                <text x="500" y="695" textAnchor="middle" className="walk-label">6 walkway</text>
                <text x="200" y="481" textAnchor="middle" className="walk-label">9 walkway</text>
                <text x="800" y="481" textAnchor="middle" className="walk-label">3 walkway</text>
                <text x="255" y="270" transform="rotate(39 255 270)" textAnchor="middle" className="walk-label">10:30 walkway</text>
                <text x="745" y="270" transform="rotate(-39 745 270)" textAnchor="middle" className="walk-label">1:30 walkway</text>
                <text x="255" y="650" transform="rotate(-49 255 650)" textAnchor="middle" className="walk-label">7:30 walkway</text>
                <text x="745" y="650" transform="rotate(49 745 650)" textAnchor="middle" className="walk-label">4:30 walkway</text>

                <BedLabel object={beds.mg11} x={315} y={205} />
                <BedLabel object={beds.mg10} x={205} y={350} />
                <BedLabel object={beds.mg8} x={205} y={590} />
                <BedLabel object={beds.mg7} x={320} y={710} />
                <BedLabel object={beds.mg1} x={700} y={205} />
                <BedLabel object={beds.mg2} x={815} y={350} />
                <BedLabel object={beds.mg4} x={815} y={590} />
                <BedLabel object={beds.mg5} x={700} y={710} />

                <text x="500" y="842" textAnchor="middle" className="direction">South / front / oak-tree side</text>
                <path d="M500 805 V830 M488 817 L500 830 L512 817" className="line" />
              </svg>
            </div>

            <section className="garden-map-legend">
              <div><span className="swatch growing" />Growing / established</div>
              <div><span className="swatch establishing" />Establishing</div>
              <div><span className="swatch attention" />High weed pressure</div>
              <div><span className="swatch reset" />Reset required</div>
            </section>

            <p className="garden-map-source">Live map: eight numbered beds, eight fully bounded clock-position walkways, and the center diamond. The map now uses the whole real garden footprint without the chicken-coop illustration.</p>
          </>
        ) : null}
      </section>

      <style jsx>{`
        .garden-map-shell { min-height: 100vh; background: #f4f0e8; color: #211f1c; padding: 18px; }
        .garden-map-page { width: min(100%, 1040px); margin: 0 auto; }
        .garden-map-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 16px; }
        .garden-map-header span { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; font-weight: 800; color: #69558c; }
        .garden-map-header h1 { margin: 3px 0 5px; font-size: clamp(30px, 6vw, 52px); }
        .garden-map-header p { margin: 0; color: #625e58; }
        .garden-map-header a { background: #6d5892; color: white; text-decoration: none; padding: 11px 14px; border-radius: 999px; font-weight: 800; white-space: nowrap; }
        .garden-map-frame { background: #fffdfa; border: 2px solid #25231f; border-radius: 16px; padding: 8px; box-shadow: 0 10px 35px rgba(47,39,29,.08); overflow: hidden; }
        svg { display: block; width: 100%; min-width: 0; height: auto; font-family: inherit; }
        .outer, .bed, .center, .walkway { stroke: #25231f; stroke-width: 2.5; }
        .outer { fill: #fffdfa; }
        .center { fill: #efe8dc; }
        .walkway { fill: #fffdfa; }
        .line { fill: none; stroke: #25231f; stroke-width: 2.5; }
        .direction { font-size: 20px; font-weight: 900; }
        .bed-title { font-size: 18px; font-weight: 900; }
        .bed-crop { font-size: 10px; font-weight: 700; fill: #514d47; }
        .walk-label { font-size: 13px; font-weight: 850; }
        .center-title { font-size: 17px; font-weight: 900; }
        .center-note { font-size: 11px; font-weight: 700; fill: #625e58; }
        .garden-map-legend { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; margin: 12px 0; }
        .garden-map-legend div { background: #fffdfa; border: 1px solid #d5cec3; border-radius: 10px; padding: 9px 10px; font-size: 12px; font-weight: 750; }
        .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 7px; vertical-align: -1px; border: 1px solid #777; }
        .growing { background: #c9dfbc; } .establishing { background: #dbe9cf; } .attention { background: #f2dfad; } .reset { background: #f0c7c0; }
        .garden-map-source, .garden-map-message { background: #fffdfa; border-radius: 12px; padding: 12px 14px; font-size: 13px; color: #59544d; }
        .garden-map-message.error { color: #8c2929; }
        @media (max-width: 700px) {
          .garden-map-shell { padding: 12px; }
          .garden-map-header { align-items: stretch; flex-direction: column; gap: 12px; }
          .garden-map-header a { text-align: center; }
          .garden-map-legend { grid-template-columns: repeat(2,minmax(0,1fr)); }
        }
      `}</style>
    </main>
  );
}
