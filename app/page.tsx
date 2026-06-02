"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deliverables } from "../data/atlas/deliverables";
import { measurements } from "../data/atlas/measurements";
import { progression } from "../data/atlas/progression";
import { property } from "../data/atlas/property";
import { rows } from "../data/atlas/rows";
import { atlasZones } from "../data/atlas/zones";

type Tone = "danger" | "watch" | "good" | "info" | "muted";

type SelectableTarget =
  | { kind: "zone"; id: string }
  | { kind: "bed"; id: string }
  | { kind: "corridor"; id: string }
  | null;

type ViewportState = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

const INITIAL_VIEW: ViewportState = {
  minX: 170,
  minY: 790,
  width: 1680,
  height: 1020,
};

const MIN_VIEW_WIDTH = 700;
const MAX_VIEW_WIDTH = 2800;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function badgeClasses(tone: Tone) {
  switch (tone) {
    case "danger":
      return "bg-[#ead8d1] text-[#83594b] border-[#d8b5a8]";
    case "watch":
      return "bg-[#e7e1cf] text-[#756a3e] border-[#d2c69b]";
    case "good":
      return "bg-[#dce9d7] text-[#466246] border-[#bdd1b6]";
    case "info":
      return "bg-[#dce8e4] text-[#42655c] border-[#b7ccc5]";
    case "muted":
    default:
      return "bg-[#ebe5db] text-[#6e675b] border-[#d8cfbf]";
  }
}

function deliverableTone(state: string): Tone {
  if (state === "blocked" || state === "impossible") return "danger";
  if (state === "assembling" || state === "possible-soon") return "watch";
  if (state === "ready" || state === "repeatable") return "good";
  if (state === "concept-only") return "info";
  return "muted";
}

function progressionTone(state: string): Tone {
  if (state === "blocked" || state === "raw") return "danger";
  if (state === "open" || state === "establishing") return "watch";
  if (state === "ready" || state === "active") return "good";
  return "muted";
}

function bedFill(state: string) {
  switch (state) {
    case "harvest_watch":
      return "#dce8cf";
    case "germinated":
      return "#e7efda";
    case "planned":
      return "#efe7d6";
    case "blocked":
      return "#ecd8d1";
    case "establishing":
      return "#dbe4f0";
    case "cleared":
      return "#ebe4d9";
    default:
      return "#e8eadf";
  }
}

function bedStroke(state: string) {
  switch (state) {
    case "harvest_watch":
      return "#88a078";
    case "germinated":
      return "#93a783";
    case "planned":
      return "#b6aa8f";
    case "blocked":
      return "#b07b6f";
    case "establishing":
      return "#7b95b7";
    case "cleared":
      return "#a79b8c";
    default:
      return "#97a08d";
  }
}

function zoneTone(kind: string) {
  switch (kind) {
    case "main_field":
      return {
        fill: "#dce8cf",
        stroke: "#88a078",
        label: "#64795f",
        chip: "#dce8cf",
      };
    case "nursery":
      return {
        fill: "#d9e5f3",
        stroke: "#8198b8",
        label: "#667a95",
        chip: "#d9e5f3",
      };
    case "hospitality_court":
      return {
        fill: "#eadccf",
        stroke: "#b39271",
        label: "#8b7258",
        chip: "#eadccf",
      };
    default:
      return {
        fill: "#e8e1d6",
        stroke: "#a49a8b",
        label: "#7b7265",
        chip: "#e8e1d6",
      };
  }
}

function toPolygon(points: { x: number; y: number }[]) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function compactCropLabel(crop: string) {
  if (crop.length <= 10) return crop;
  return `${crop.slice(0, 10).trim()}…`;
}

function compactStateLabel(value: string) {
  return value.replaceAll("_", " ");
}

function getMeasurementValue(id: string) {
  return measurements.find((item) => item.id === id)?.value ?? null;
}

export default function Home() {
  const [selected, setSelected] = useState<SelectableTarget>(null);
  const [view, setView] = useState<ViewportState>(INITIAL_VIEW);
  const [isDragging, setIsDragging] = useState(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startMinX: number;
    startMinY: number;
    bounds: DOMRect;
  } | null>(null);

  const centerAisle = useMemo(() => {
    const westBeds = rows.filter((row) => row.id.startsWith("MW"));
    const eastBeds = rows.filter((row) => row.id.startsWith("ME"));

    if (!westBeds.length || !eastBeds.length) return null;

    const top = Math.min(...westBeds.map((row) => row.y), ...eastBeds.map((row) => row.y)) - 18;
    const bottom =
      Math.max(
        ...westBeds.map((row) => row.y + row.height),
        ...eastBeds.map((row) => row.y + row.height),
      ) + 18;
    const left = Math.max(...westBeds.map((row) => row.x + row.width)) + 18;
    const right = Math.min(...eastBeds.map((row) => row.x)) - 18;

    return {
      id: "center-aisle",
      label: "Center Aisle",
      x: left,
      y: top,
      width: Math.max(28, right - left),
      height: bottom - top,
    };
  }, []);

  const selectedZone =
    selected?.kind === "zone"
      ? atlasZones.find((zone) => zone.id === selected.id) ?? null
      : null;

  const selectedBed =
    selected?.kind === "bed"
      ? rows.find((row) => row.id === selected.id) ?? null
      : null;

  const selectedCorridor =
    selected?.kind === "corridor" && selected.id === "center-aisle" && centerAisle
      ? centerAisle
      : null;

  const selectedPanel = useMemo(() => {
    if (selectedZone) {
      const zoneBeds = rows.filter((row) => selectedZone.childObjectIds.includes(row.id));

      return {
        eyebrow: "Zone",
        title: selectedZone.label,
        state: compactStateLabel(selectedZone.state),
        summary:
          selectedZone.kind === "main_field"
            ? "Primary production field with mirrored west/east bed banks."
            : selectedZone.kind === "nursery"
              ? "Perennial growout lane for slower establishment and future planting-out."
              : "Hospitality / showcase zone for abundance, beauty, and guest confidence.",
        detailRows: [
          `${zoneBeds.length} linked bed objects`,
          selectedZone.visibleToGuests ? "Guest-visible zone" : "Utility-facing zone",
          `Mode: ${selectedZone.modeBias.replaceAll("_", " ")}`,
        ],
      };
    }

    if (selectedBed) {
      return {
        eyebrow: "Bed",
        title: `${selectedBed.label} · ${selectedBed.crop}`,
        state: compactStateLabel(selectedBed.state),
        summary:
          selectedBed.mode === "annual_production"
            ? "Annual production bed focused on timing, harvest waves, and succession."
            : selectedBed.mode === "perennial_nursery"
              ? "Nursery bed focused on establishment, vigor, and future payoff."
              : "Hospitality bed focused on visible continuity and presentation.",
        detailRows: [
          `Zone: ${selectedBed.zoneId}`,
          `Mode: ${selectedBed.mode.replaceAll("_", " ")}`,
          selectedBed.guestVisible ? "Guest-visible" : "Not guest-visible",
        ],
      };
    }

    if (selectedCorridor) {
      return {
        eyebrow: "Corridor",
        title: "Center Aisle",
        state: "open",
        summary: "Operational and visual spine between Main Field West and Main Field East.",
        detailRows: [
          `Width: ${getMeasurementValue("center-aisle-width") ?? 6} ft`,
          "Treat as a first-class maintained object",
          "Future role: cart route / beauty axis / guest sightline",
        ],
      };
    }

    return null;
  }, [selectedZone, selectedBed, selectedCorridor]);

  const blockerCount = rows.filter((row) => row.state === "blocked").length;

  const weatherStats = [
    { label: "T", value: "61°" },
    { label: "M", value: "Wax" },
    { label: "W", value: "4" },
    { label: "B", value: String(rows.length) },
  ];

  function zoomAtClientPoint(clientX: number, clientY: number, factor: number) {
    if (!boardRef.current) return;

    const bounds = boardRef.current.getBoundingClientRect();
    const relX = (clientX - bounds.left) / bounds.width;
    const relY = (clientY - bounds.top) / bounds.height;

    const nextWidth = clamp(view.width * factor, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH);
    const nextHeight = nextWidth * (view.height / view.width);

    const anchorX = view.minX + relX * view.width;
    const anchorY = view.minY + relY * view.height;

    const unclampedMinX = anchorX - relX * nextWidth;
    const unclampedMinY = anchorY - relY * nextHeight;

    const nextMinX = clamp(
      unclampedMinX,
      property.viewBox.minX,
      property.viewBox.minX + property.viewBox.width - nextWidth,
    );

    const nextMinY = clamp(
      unclampedMinY,
      property.viewBox.minY,
      property.viewBox.minY + property.viewBox.height - nextHeight,
    );

    setView({
      minX: nextMinX,
      minY: nextMinY,
      width: nextWidth,
      height: nextHeight,
    });
  }

  function resetView() {
    setView(INITIAL_VIEW);
  }

  function startPan(event: React.PointerEvent<SVGRectElement>) {
    if (!boardRef.current) return;

    const bounds = boardRef.current.getBoundingClientRect();
    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startMinX: view.minX,
      startMinY: view.minY,
      bounds,
    };

    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  }

  function movePan(event: React.PointerEvent<SVGRectElement>) {
    const current = panRef.current;
    if (!current) return;

    const dx = event.clientX - current.startClientX;
    const dy = event.clientY - current.startClientY;

    const unitsPerPixelX = view.width / current.bounds.width;
    const unitsPerPixelY = view.height / current.bounds.height;

    const nextMinX = clamp(
      current.startMinX - dx * unitsPerPixelX,
      property.viewBox.minX,
      property.viewBox.minX + property.viewBox.width - view.width,
    );

    const nextMinY = clamp(
      current.startMinY - dy * unitsPerPixelY,
      property.viewBox.minY,
      property.viewBox.minY + property.viewBox.height - view.height,
    );

    setView((prev) => ({
      ...prev,
      minX: nextMinX,
      minY: nextMinY,
    }));
  }

  function endPan(event: React.PointerEvent<SVGRectElement>) {
    panRef.current = null;
    setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  }

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      const bounds = el.getBoundingClientRect();
      const inside =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;

      if (!inside) return;

      const zoomIntent =
        event.ctrlKey || Math.abs(event.deltaY) > Math.abs(event.deltaX);

      if (!zoomIntent) return;

      event.preventDefault();

      // Gentler zoom:
      // small deltas = tiny change
      // large deltas/pinch = still controlled
const raw = Math.abs(event.deltaY);
const step = Math.min(0.09, Math.max(0.07, raw * 0.0006));
const factor = event.deltaY < 0 ? 1 - step : 1 + step;

      zoomAtClientPoint(event.clientX, event.clientY, factor);
    };

    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [view]);

  return (
    <main className="h-screen overflow-hidden bg-[#f4f0e7] p-4 text-[#2f3a32] md:p-5">
      <section className="relative h-full overflow-hidden rounded-[34px] border border-[#d8d0c1] bg-[#fbf8f2] shadow-[0_10px_30px_rgba(91,84,62,0.08)]">
        <div className="absolute left-5 top-5 z-20 w-[72px] rounded-[22px] border border-[#e1d9cc] bg-[#fbf8f2]/94 p-2 shadow-sm backdrop-blur-sm">
          <div className="grid gap-2">
            {weatherStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl bg-[#f3efe7] px-2 py-2 text-center"
              >
                <p className="text-[9px] uppercase tracking-[0.16em] text-[#8a8376]">
                  {stat.label}
                </p>
                <p className="mt-1 text-[14px] font-semibold text-[#434b40]">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute left-[92px] right-5 top-5 z-20 flex flex-wrap items-center gap-3">
          {deliverables.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-full border border-[#ddd4c5] bg-[#fbf7f0]/95 px-5 py-3 text-sm shadow-sm"
            >
              <div className="text-left">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#8c8578]">
                  Deliverable
                </p>
                <p className="text-base font-semibold text-[#3b4539]">{item.title}</p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs ${badgeClasses(deliverableTone(item.state))}`}
              >
                {item.state}
              </span>
            </div>
          ))}
        </div>

        <div className="absolute right-5 top-[96px] z-20 flex items-center gap-2">
          <button
            onClick={() => zoomAtClientPoint(window.innerWidth / 2, window.innerHeight / 2, 0.95)}
            className="rounded-full border border-[#ddd4c5] bg-[#fbf7f0]/95 px-4 py-2 text-sm font-semibold text-[#6b6458] shadow-sm hover:bg-white"
          >
            +
          </button>
          <button
            onClick={() => zoomAtClientPoint(window.innerWidth / 2, window.innerHeight / 2, 1.05)}
            className="rounded-full border border-[#ddd4c5] bg-[#fbf7f0]/95 px-4 py-2 text-sm font-semibold text-[#6b6458] shadow-sm hover:bg-white"
          >
            −
          </button>
          <button
            onClick={resetView}
            className="rounded-full border border-[#ddd4c5] bg-[#fbf7f0]/95 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#756f64] shadow-sm hover:bg-white"
          >
            Reset
          </button>
          <div className="rounded-full border border-[#ddd4c5] bg-[#fbf7f0]/95 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#756f64] shadow-sm">
            {property.name}
          </div>
          <div className="rounded-full border border-[#ddd4c5] bg-[#fbf7f0]/95 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#756f64] shadow-sm">
            blockers {blockerCount}
          </div>
        </div>

        <div className="absolute inset-[18px] overflow-hidden rounded-[28px] border border-[#e5ded1] bg-[linear-gradient(180deg,#eef4ea_0%,#e6eedf_42%,#d6e2cc_100%)]">
          <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(248,244,235,0.75),rgba(248,244,235,0))]" />

          <div ref={boardRef} className="absolute inset-0">
            <svg
              viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
              className="h-full w-full"
              preserveAspectRatio="none"
            >
              <defs>
                <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow
                    dx="0"
                    dy="8"
                    stdDeviation="10"
                    floodColor="#8c9d86"
                    floodOpacity="0.12"
                  />
                </filter>

                <pattern
                  id="grid-1ft"
                  x="0"
                  y="0"
                  width="10"
                  height="10"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 10 0 L 0 0 0 10"
                    fill="none"
                    stroke="#9da790"
                    strokeOpacity="0.10"
                    strokeWidth="0.7"
                  />
                </pattern>

                <pattern
                  id="grid-5ft"
                  x="0"
                  y="0"
                  width="50"
                  height="50"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 50 0 L 0 0 0 50"
                    fill="none"
                    stroke="#8d9a82"
                    strokeOpacity="0.13"
                    strokeWidth="0.9"
                  />
                </pattern>
              </defs>

              <rect
                x={property.viewBox.minX}
                y={property.viewBox.minY}
                width={property.viewBox.width}
                height={property.viewBox.height}
                fill="#eef2ea"
              />
              <rect
                x={property.viewBox.minX}
                y={property.viewBox.minY}
                width={property.viewBox.width}
                height={property.viewBox.height}
                fill="url(#grid-1ft)"
              />
              <rect
                x={property.viewBox.minX}
                y={property.viewBox.minY}
                width={property.viewBox.width}
                height={property.viewBox.height}
                fill="url(#grid-5ft)"
              />

              <ellipse cx="620" cy="930" rx="120" ry="95" fill="#d8dfd0" opacity="0.45" />
              <ellipse cx="760" cy="900" rx="48" ry="38" fill="#cad8bf" opacity="0.52" />
              <ellipse cx="1490" cy="1540" rx="86" ry="66" fill="#e7dfd2" opacity="0.6" />
              <ellipse cx="430" cy="1360" rx="92" ry="70" fill="#d7e2cf" opacity="0.34" />

              <rect
                x={property.viewBox.minX}
                y={property.viewBox.minY}
                width={property.viewBox.width}
                height={property.viewBox.height}
                fill="transparent"
                style={{ cursor: isDragging ? "grabbing" : "grab" }}
                onPointerDown={startPan}
                onPointerMove={movePan}
                onPointerUp={endPan}
                onPointerCancel={endPan}
              />

              <g opacity="0.78" filter="url(#softShadow)">
                <path
                  d="M585 835 L690 834 L707 936 L600 945 Z"
                  fill="#efe6d9"
                  stroke="#c7b6a2"
                  strokeWidth="3"
                />
                <rect
                  x="620"
                  y="854"
                  width="42"
                  height="48"
                  rx="8"
                  fill="#e8dccd"
                  stroke="#bca996"
                  strokeWidth="1.8"
                />
              </g>

              {atlasZones.map((zone) => {
                const tone = zoneTone(zone.kind);
                const isSelected = selected?.kind === "zone" && selected.id === zone.id;
                const minX = Math.min(...zone.polygon.map((point) => point.x));
                const minY = Math.min(...zone.polygon.map((point) => point.y));

                return (
                  <g key={zone.id}>
<polygon
  points={toPolygon(zone.polygon)}
  fill={tone.fill}
  fillOpacity={0.05}
  stroke={tone.stroke}
  strokeOpacity={0.22}
  strokeWidth={1.2}
  filter="url(#softShadow)"
  pointerEvents="none"
/>
                    <text
                      x={minX + 12}
                      y={minY + 18}
                      fontSize="10"
                      letterSpacing="2.2"
                      fill={tone.label}
                      opacity={0.58}
                      pointerEvents="none"
                    >
                      ZONE
                    </text>
                    <text
                      x={minX + 12}
                      y={minY + 38}
                      fontSize="17"
                      fontWeight="700"
                      fill={tone.label}
                      opacity={0.72}
                      pointerEvents="none"
                    >
                      {zone.label}
                    </text>
                    <rect
                      x={minX + 12}
                      y={minY + 45}
                      width={Math.max(68, compactStateLabel(zone.state).length * 6.2)}
                      height="18"
                      rx="9"
                      fill={tone.chip}
                      fillOpacity={0.34}
                      pointerEvents="none"
                    />
                    <text
                      x={minX + 20}
                      y={minY + 57}
                      fontSize="9.5"
                      fill={tone.label}
                      opacity={0.66}
                      pointerEvents="none"
                    >
                      {compactStateLabel(zone.state)}
                    </text>
                  </g>
                );
              })}

              {centerAisle ? (
                <g>
                  <rect
                    x={centerAisle.x}
                    y={centerAisle.y}
                    width={centerAisle.width}
                    height={centerAisle.height}
                    rx="16"
                    fill="rgba(234,220,207,0.08)"
                    stroke={
                      selected?.kind === "corridor" && selected.id === "center-aisle"
                        ? "#3765d8"
                        : "#bea88e"
                    }
                    strokeOpacity={selected?.kind === "corridor" && selected.id === "center-aisle" ? 1 : 0.38}
                    strokeWidth={selected?.kind === "corridor" && selected.id === "center-aisle" ? 3 : 1.4}
                    strokeDasharray="7 8"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected({ kind: "corridor", id: "center-aisle" });
                    }}
                    style={{ cursor: "pointer" }}
                  />
                  <text
                    x={centerAisle.x + centerAisle.width / 2}
                    y={centerAisle.y + 16}
                    textAnchor="middle"
                    fontSize="9.5"
                    letterSpacing="1.4"
                    fill="#7d6f5f"
                    opacity="0.74"
                    pointerEvents="none"
                  >
                    CENTER AISLE
                  </text>
                </g>
              ) : null}

              {rows.map((row) => {
                const isSelected = selected?.kind === "bed" && selected.id === row.id;

                return (
                  <g
                    key={row.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected({ kind: "bed", id: row.id });
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={row.x}
                      y={row.y - 1}
                      width={row.width}
                      height={row.height + 2}
                      rx="7"
                      fill={bedFill(row.state)}
                      stroke={isSelected ? "#3765d8" : bedStroke(row.state)}
                      strokeWidth={isSelected ? 3 : 1.8}
                    />
                    <rect
                      x={row.x + 3}
                      y={row.y + 2}
                      width={34}
                      height={12}
                      rx="6"
                      fill="rgba(255,255,255,0.72)"
                      pointerEvents="none"
                    />
                    <text
                      x={row.x + 9}
                      y={row.y + 10.8}
                      fontSize="8.8"
                      fontWeight="700"
                      fill="#546053"
                      pointerEvents="none"
                    >
                      {row.label}
                    </text>
                    <text
                      x={row.x + 42}
                      y={row.y + 10.9}
                      fontSize="8.7"
                      fill="#4e554c"
                      pointerEvents="none"
                    >
                      {compactCropLabel(row.crop)}
                    </text>
                  </g>
                );
              })}

              <g opacity="0.30" pointerEvents="none">
                <path
                  d="M250 1692 L1735 1692"
                  stroke="#96a590"
                  strokeWidth="1.4"
                  strokeDasharray="8 8"
                />
                <text x="260" y="1710" fontSize="10.5" fill="#758271">
                  guest / visual corridor
                </text>
              </g>
            </svg>
          </div>

          <div className="absolute bottom-4 right-4 z-20 flex max-w-[72%] flex-wrap justify-end gap-2">
            {progression.map((item) => (
              <button
                key={item.id}
                onClick={() =>
                  item.id === "center-aisle"
                    ? setSelected({ kind: "corridor", id: "center-aisle" })
                    : setSelected({ kind: "zone", id: item.id })
                }
                className="rounded-full border border-[#d8cfbf] bg-[#fbf7f0]/94 px-3 py-2 text-left shadow-sm backdrop-blur-sm transition hover:bg-white"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-[#3d473c]">{item.title}</span>
                  <span
                    className={`rounded-full border px-2 py-[2px] text-[10px] ${badgeClasses(progressionTone(item.state))}`}
                  >
                    {item.state}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {selectedPanel ? (
          <aside className="absolute bottom-5 right-5 top-[170px] z-30 w-[320px] rounded-[28px] border border-[#ddd4c5] bg-[#fbf7f0]/97 p-5 shadow-[0_16px_40px_rgba(92,83,63,0.14)] backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8a8377]">
                  {selectedPanel.eyebrow}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#334034]">
                  {selectedPanel.title}
                </h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-full border border-[#ddd4c5] px-3 py-1.5 text-sm text-[#6f685d] transition hover:bg-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4">
              <span className="rounded-full bg-[#ece9da] px-3 py-1 text-xs uppercase tracking-[0.12em] text-[#6f6848]">
                {selectedPanel.state}
              </span>
            </div>

            <p className="mt-4 text-sm leading-6 text-[#534f47]">
              {selectedPanel.summary}
            </p>

            <div className="mt-5 grid gap-2">
              {selectedPanel.detailRows.map((detail) => (
                <div
                  key={detail}
                  className="rounded-2xl border border-[#e6ded1] bg-[#f8f4ed] px-4 py-3 text-sm text-[#4f4a42]"
                >
                  {detail}
                </div>
              ))}
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  );
}