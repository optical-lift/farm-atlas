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
  return <text x={x} y={y} textAnchor="middle" className="bed-title">{object?.label ?? "Missing bed"}</text>;
}

function bedHref(object: AtlasRegistryObject | undefined, fallbackKey: string) {
  const key = object?.stable_key ?? fallbackKey;
  return `/zones/main_garden?object=${encodeURIComponent(key)}#object-${encodeURIComponent(key)}`;
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
            <p>Tap a bed to open its live crop record in the Atlas zone registry.</p>
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
                <desc id="main-garden-desc">Eight clickable growing beds arranged symmetrically around a center diamond with eight equally wide white walkways.</desc>

                <text x="500" y="34" textAnchor="middle" className="direction">North / back of garden</text>
                <path d="M500 48 V78 M488 62 L500 48 L512 62" className="line" />

                <rect x="70" y="100" width="860" height="700" rx="2" className="outer" />

                <a href={bedHref(beds.mg1, "mg1")} className="bed-link" aria-label="Open MG1 crop record">
                  <polygon points="525,100 930,100 930,165 650,410 610,370 525,320" fill={bedTone(beds.mg1)} className="bed" />
                  <BedLabel object={beds.mg1} x={700} y={220} />
                </a>
                <a href={bedHref(beds.mg2, "mg2")} className="bed-link" aria-label="Open MG2 crop record">
                  <polygon points="930,165 930,425 650,425 620,395" fill={bedTone(beds.mg2)} className="bed" />
                  <BedLabel object={beds.mg2} x={795} y={350} />
                </a>
                <a href={bedHref(beds.mg4, "mg4")} className="bed-link" aria-label="Open MG4 crop record">
                  <polygon points="650,475 930,475 930,735 620,505" fill={bedTone(beds.mg4)} className="bed" />
                  <BedLabel object={beds.mg4} x={795} y={590} />
                </a>
                <a href={bedHref(beds.mg5, "mg5")} className="bed-link" aria-label="Open MG5 crop record">
                  <polygon points="610,530 650,490 930,735 930,800 525,800 525,580" fill={bedTone(beds.mg5)} className="bed" />
                  <BedLabel object={beds.mg5} x={685} y={720} />
                </a>

                <a href={bedHref(beds.mg7, "mg7")} className="bed-link" aria-label="Open MG7 crop record">
                  <polygon points="475,580 475,800 70,800 70,735 350,490 390,530" fill={bedTone(beds.mg7)} className="bed" />
                  <BedLabel object={beds.mg7} x={315} y={720} />
                </a>
                <a href={bedHref(beds.mg8, "mg8")} className="bed-link" aria-label="Open MG8 crop record">
                  <polygon points="70,475 350,475 380,505 70,735" fill={bedTone(beds.mg8)} className="bed" />
                  <BedLabel object={beds.mg8} x={205} y={590} />
                </a>
                <a href={bedHref(beds.mg10, "mg10")} className="bed-link" aria-label="Open MG10 crop record">
                  <polygon points="70,165 380,395 350,425 70,425" fill={bedTone(beds.mg10)} className="bed" />
                  <BedLabel object={beds.mg10} x={205} y={350} />
                </a>
                <a href={bedHref(beds.mg11, "mg11")} className="bed-link" aria-label="Open MG11 crop record">
                  <polygon points="70,100 475,100 475,320 390,370 350,410 70,165" fill={bedTone(beds.mg11)} className="bed" />
                  <BedLabel object={beds.mg11} x={300} y={220} />
                </a>

                <rect x="475" y="100" width="50" height="220" className="walkway" />
                <rect x="475" y="580" width="50" height="220" className="walkway" />
                <rect x="70" y="425" width="280" height="50" className="walkway" />
                <rect x="650" y="425" width="280" height="50" className="walkway" />

                <polygon points="70,135 70,170 350,415 380,385" className="walkway" />
                <polygon points="620,385 650,415 930,170 930,135" className="walkway" />
                <polygon points="350,485 380,515 145,800 95,800" className="walkway" />
                <polygon points="620,515 650,485 905,800 855,800" className="walkway" />

                <polygon points="500,330 650,450 500,570 350,450" className="center" />
                <text x="500" y="443" textAnchor="middle" className="center-title">Center Diamond</text>
                <text x="500" y="466" textAnchor="middle" className="center-note">{center?.area_sqft ? `${Math.round(Number(center.area_sqft))} sq ft` : "clock face"}</text>

                <text x="500" y="205" textAnchor="middle" className="walk-label">12</text>
                <text x="500" y="695" textAnchor="middle" className="walk-label">6</text>
                <text x="205" y="457" textAnchor="middle" className="walk-label">9</text>
                <text x="795" y="457" textAnchor="middle" className="walk-label">3</text>
                <text x="255" y="270" transform="rotate(41 255 270)" textAnchor="middle" className="walk-label">10:30</text>
                <text x="745" y="270" transform="rotate(-41 745 270)" textAnchor="middle" className="walk-label">1:30</text>
                <text x="245" y="665" transform="rotate(-50 245 665)" textAnchor="middle" className="walk-label">7:30</text>
                <text x="755" y="665" transform="rotate(50 755 665)" textAnchor="middle" className="walk-label">4:30</text>

                <text x="500" y="848" textAnchor="middle" className="direction">South / front / oak-tree side</text>
                <path d="M500 808 V835 M488 822 L500 835 L512 822" className="line" />
              </svg>
            </div>

            <section className="garden-map-legend">
              <div><span className="swatch growing" />Growing / established</div>
              <div><span className="swatch establishing" />Establishing</div>
              <div><span className="swatch attention" />High weed pressure</div>
              <div><span className="swatch reset" />Reset required</div>
            </section>

            <p className="garden-map-source">Tap any numbered bed to open that exact Atlas object and its active crop record. All eight walkways now use the same proportional four-foot width.</p>
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
        .outer, .center, .walkway { stroke: #25231f; stroke-width: 2.5; }
        .outer { fill: #fffdfa; }
        .bed { stroke: none; transition: filter .15s ease, opacity .15s ease; }
        .bed-link { cursor: pointer; color: inherit; text-decoration: none; }
        .bed-link:hover .bed, .bed-link:focus .bed { filter: brightness(.94); }
        .bed-link:focus { outline: none; }
        .bed-link:focus .bed { stroke: #6d5892; stroke-width: 6; }
        .center { fill: #efe8dc; }
        .walkway { fill: #fffdfa; stroke-linejoin: round; }
        .line { fill: none; stroke: #25231f; stroke-width: 2.5; }
        .direction { font-size: 20px; font-weight: 900; }
        .bed-title { font-size: 20px; font-weight: 900; pointer-events: none; }
        .walk-label { font-size: 14px; font-weight: 850; pointer-events: none; }
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
