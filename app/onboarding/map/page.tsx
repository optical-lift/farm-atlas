"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { property } from "@/data/atlas/property";
import { propertyBoundary } from "@/data/atlas/property-boundary";
import { atlasZones, type AtlasZone } from "@/data/atlas/zones";

type Point = {
  x: number;
  y: number;
};

type Mode = "zones" | "boundary";

type DragState =
  | {
      kind: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startPanX: number;
      startPanY: number;
      moved: boolean;
    }
  | {
      kind: "zone-vertex";
      pointerId: number;
      zoneId: string;
      vertexIndex: number;
    };

const BOUNDARY_STORAGE_KEY = "atlas.property.boundary.v5";
const ZONES_STORAGE_KEY = "atlas.zones.v1";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pointsToBoundarySnippet(points: Point[]) {
  return `export const propertyBoundary = ${JSON.stringify(points, null, 2)} as const;`;
}

function zonesToSnippet(zones: AtlasZone[]) {
  return `export const atlasZones = ${JSON.stringify(zones, null, 2)} as const;`;
}

function polygonCenter(points: Point[]) {
  if (points.length === 0) return { x: 0, y: 0 };

  const total = points.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0.00001) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

function zoneStyle(kind: AtlasZone["kind"], selected: boolean) {
  const base =
    kind === "production"
      ? {
          fill: selected ? "rgba(78, 135, 73, 0.34)" : "rgba(78, 135, 73, 0.18)",
          stroke: selected ? "#2f6b2a" : "#567650",
          labelFill: selected ? "#ffffff" : "rgba(255,255,255,0.94)",
          labelText: "#294127",
          handleFill: "#2f6b2a",
        }
      : kind === "nursery"
      ? {
          fill: selected ? "rgba(117, 145, 78, 0.34)" : "rgba(117, 145, 78, 0.18)",
          stroke: selected ? "#5b7334" : "#687e4b",
          labelFill: selected ? "#ffffff" : "rgba(255,255,255,0.94)",
          labelText: "#39452a",
          handleFill: "#5b7334",
        }
      : kind === "pollinator"
      ? {
          fill: selected ? "rgba(196, 164, 57, 0.34)" : "rgba(196, 164, 57, 0.18)",
          stroke: selected ? "#8d6f15" : "#a28633",
          labelFill: selected ? "#ffffff" : "rgba(255,255,255,0.94)",
          labelText: "#5f4b10",
          handleFill: "#8d6f15",
        }
      : {
          fill: selected ? "rgba(176, 123, 87, 0.34)" : "rgba(176, 123, 87, 0.18)",
          stroke: selected ? "#8b5c39" : "#987053",
          labelFill: selected ? "#ffffff" : "rgba(255,255,255,0.94)",
          labelText: "#5c3d27",
          handleFill: "#8b5c39",
        };

  return {
    ...base,
    strokeWidth: selected ? 5 : 3,
    dash: selected ? undefined : kind === "hospitality" ? "10 8" : undefined,
  };
}

const fileBoundary: Point[] = propertyBoundary.map((p) => ({ x: p.x, y: p.y }));
const fileZones: AtlasZone[] = atlasZones.map((zone) => ({
  ...zone,
  polygon: zone.polygon.map((p) => ({ x: p.x, y: p.y })),
}));

export default function MapOnboardingPage() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const imageWidth = property.mapImage.widthPx;
  const imageHeight = property.mapImage.heightPx;

  const [mode, setMode] = useState<Mode>("zones");
  const [boundaryPoints, setBoundaryPoints] = useState<Point[]>(fileBoundary);
  const [zones, setZones] = useState<AtlasZone[]>(fileZones);
  const [selectedZoneId, setSelectedZoneId] = useState<string>(fileZones[0]?.id ?? "");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [initialized, setInitialized] = useState(false);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [copiedBoundary, setCopiedBoundary] = useState(false);
  const [copiedZones, setCopiedZones] = useState(false);
  const [usingLocalBoundaryDraft, setUsingLocalBoundaryDraft] = useState(false);
  const [usingLocalZoneDraft, setUsingLocalZoneDraft] = useState(false);

  useEffect(() => {
    try {
      const rawBoundary = window.localStorage.getItem(BOUNDARY_STORAGE_KEY);
      if (rawBoundary) {
        const parsed = JSON.parse(rawBoundary) as Point[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setBoundaryPoints(parsed);
          setUsingLocalBoundaryDraft(true);
        }
      }

      const rawZones = window.localStorage.getItem(ZONES_STORAGE_KEY);
      if (rawZones) {
        const parsed = JSON.parse(rawZones) as AtlasZone[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setZones(parsed);
          setUsingLocalZoneDraft(true);
          if (parsed[0]?.id) {
            setSelectedZoneId(parsed[0].id);
          }
        }
      }
    } catch {}

    setDraftsLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftsLoaded) return;
    window.localStorage.setItem(BOUNDARY_STORAGE_KEY, JSON.stringify(boundaryPoints));
  }, [boundaryPoints, draftsLoaded]);

  useEffect(() => {
    if (!draftsLoaded) return;
    window.localStorage.setItem(ZONES_STORAGE_KEY, JSON.stringify(zones));
  }, [zones, draftsLoaded]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height,
      });
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (initialized) return;
    if (!viewportSize.width || !viewportSize.height) return;

    const fit = Math.min(
      viewportSize.width / imageWidth,
      viewportSize.height / imageHeight
    );

    const nextZoom = fit * 0.94;

    setZoom(nextZoom);
    setPan({
      x: (viewportSize.width - imageWidth * nextZoom) / 2,
      y: (viewportSize.height - imageHeight * nextZoom) / 2,
    });
    setInitialized(true);
  }, [initialized, viewportSize, imageWidth, imageHeight]);

  const selectedZone = useMemo(
    () => zones.find((zone) => zone.id === selectedZoneId) ?? zones[0],
    [zones, selectedZoneId]
  );

  const boundaryCountLabel = useMemo(() => {
    if (boundaryPoints.length === 0) return "No boundary points";
    if (boundaryPoints.length === 1) return "1 boundary point";
    return `${boundaryPoints.length} boundary points`;
  }, [boundaryPoints]);

  const zoneStats = useMemo(() => {
    return {
      total: zones.length,
      production: zones.filter((zone) => zone.kind === "production").length,
      nursery: zones.filter((zone) => zone.kind === "nursery").length,
      pollinator: zones.filter((zone) => zone.kind === "pollinator").length,
      hospitality: zones.filter((zone) => zone.kind === "hospitality").length,
    };
  }, [zones]);

  function screenToImage(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    if (!viewport) return null;

    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    return {
      x: clamp(Math.round((localX - pan.x) / zoom), 0, imageWidth),
      y: clamp(Math.round((localY - pan.y) / zoom), 0, imageHeight),
    };
  }

  function findZoneAtPoint(point: Point) {
    for (let i = zones.length - 1; i >= 0; i -= 1) {
      if (pointInPolygon(point, zones[i].polygon as Point[])) {
        return zones[i];
      }
    }
    return null;
  }

  function findSelectedZoneHandle(point: Point) {
    if (!selectedZone) return null;

    const threshold = 28 / zoom;

    for (let i = 0; i < selectedZone.polygon.length; i += 1) {
      const vertex = selectedZone.polygon[i];
      const dx = point.x - vertex.x;
      const dy = point.y - vertex.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= threshold) {
        return {
          zoneId: selectedZone.id,
          vertexIndex: i,
        };
      }
    }

    return null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const mapped = screenToImage(event.clientX, event.clientY);

    if (mode === "zones" && mapped) {
      const handle = findSelectedZoneHandle(mapped);
      if (handle) {
        dragRef.current = {
          kind: "zone-vertex",
          pointerId: event.pointerId,
          zoneId: handle.zoneId,
          vertexIndex: handle.vertexIndex,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    dragRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.kind === "pan") {
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        drag.moved = true;
      }

      setPan({
        x: drag.startPanX + dx,
        y: drag.startPanY + dy,
      });
      return;
    }

    if (drag.kind === "zone-vertex") {
      const mapped = screenToImage(event.clientX, event.clientY);
      if (!mapped) return;

      setZones((prev) =>
        prev.map((zone) => {
          if (zone.id !== drag.zoneId) return zone;

          const polygon = zone.polygon.map((p) => ({ x: p.x, y: p.y }));
          polygon[drag.vertexIndex] = mapped;

          return {
            ...zone,
            polygon,
          };
        })
      );
      setUsingLocalZoneDraft(true);
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const mapped = screenToImage(event.clientX, event.clientY);

    if (drag.kind === "pan") {
      if (!drag.moved && mapped) {
        if (mode === "boundary") {
          setBoundaryPoints((prev) => [...prev, mapped]);
          setUsingLocalBoundaryDraft(true);
        } else {
          const hitZone = findZoneAtPoint(mapped);
          if (hitZone) {
            setSelectedZoneId(hitZone.id);
          }
        }
      }
    }

    dragRef.current = null;
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = clamp(zoom * factor, 0.2, 8);

    const imageX = (cursorX - pan.x) / zoom;
    const imageY = (cursorY - pan.y) / zoom;

    setZoom(nextZoom);
    setPan({
      x: cursorX - imageX * nextZoom,
      y: cursorY - imageY * nextZoom,
    });
  }

  function zoomBy(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const centerX = viewport.clientWidth / 2;
    const centerY = viewport.clientHeight / 2;

    const nextZoom = clamp(zoom * factor, 0.2, 8);

    const imageX = (centerX - pan.x) / zoom;
    const imageY = (centerY - pan.y) / zoom;

    setZoom(nextZoom);
    setPan({
      x: centerX - imageX * nextZoom,
      y: centerY - imageY * nextZoom,
    });
  }

  function resetView() {
    if (!viewportSize.width || !viewportSize.height) return;

    const fit = Math.min(
      viewportSize.width / imageWidth,
      viewportSize.height / imageHeight
    );

    const nextZoom = fit * 0.94;

    setZoom(nextZoom);
    setPan({
      x: (viewportSize.width - imageWidth * nextZoom) / 2,
      y: (viewportSize.height - imageHeight * nextZoom) / 2,
    });
  }

  function undoLastBoundaryPoint() {
    setBoundaryPoints((prev) => prev.slice(0, -1));
    setUsingLocalBoundaryDraft(true);
  }

  function clearBoundary() {
    setBoundaryPoints([]);
    setUsingLocalBoundaryDraft(true);
    window.localStorage.removeItem(BOUNDARY_STORAGE_KEY);
  }

  function restoreFileBoundary() {
    setBoundaryPoints(fileBoundary);
    setUsingLocalBoundaryDraft(false);
    window.localStorage.removeItem(BOUNDARY_STORAGE_KEY);
  }

  function restoreFileZones() {
    setZones(fileZones);
    setSelectedZoneId(fileZones[0]?.id ?? "");
    setUsingLocalZoneDraft(false);
    window.localStorage.removeItem(ZONES_STORAGE_KEY);
  }

  async function copyBoundarySnippet() {
    if (boundaryPoints.length < 3) return;
    await navigator.clipboard.writeText(pointsToBoundarySnippet(boundaryPoints));
    setCopiedBoundary(true);
    window.setTimeout(() => setCopiedBoundary(false), 1200);
  }

  async function copyZonesSnippet() {
    await navigator.clipboard.writeText(zonesToSnippet(zones));
    setCopiedZones(true);
    window.setTimeout(() => setCopiedZones(false), 1200);
  }

  const boundaryPolyline = boundaryPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <main className="min-h-screen bg-[#f4f0e7] p-4 text-[#2f3a32] md:p-6">
      <section className="mx-auto max-w-[1720px] rounded-[34px] border border-[#d8d0c1] bg-[#fbf8f2] p-5 shadow-[0_10px_30px_rgba(91,84,62,0.08)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#8e8778]">
              Atlas onboarding
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em]">
              Map builder
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6e6a60]">
              Use <strong>Edit zones</strong> to select a zone and drag its corner
              handles. Use <strong>Refine boundary</strong> only when you want to add
              more parcel points.
            </p>
          </div>

          <a
            href="/"
            className="rounded-full border border-[#ddd4c5] bg-white px-4 py-2 text-sm text-[#5f5a52] shadow-sm"
          >
            Back to command board
          </a>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("zones")}
            className={`rounded-full px-4 py-2 text-sm shadow-sm ${
              mode === "zones"
                ? "border border-[#5e7350] bg-[#e9f0e4] text-[#385135]"
                : "border border-[#ddd4c5] bg-white text-[#5f5a52]"
            }`}
          >
            Edit zones
          </button>
          <button
            type="button"
            onClick={() => setMode("boundary")}
            className={`rounded-full px-4 py-2 text-sm shadow-sm ${
              mode === "boundary"
                ? "border border-[#8d7156] bg-[#f3e8de] text-[#684632]"
                : "border border-[#ddd4c5] bg-white text-[#5f5a52]"
            }`}
          >
            Refine boundary
          </button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="rounded-[28px] border border-[#ddd5c7] bg-[#f3efe7] p-3 shadow-sm">
            <div
              ref={viewportRef}
              className="relative h-[78vh] min-h-[620px] max-h-[920px] overflow-hidden rounded-[22px] bg-[#ebe5d8] touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
            >
              <div
                className="absolute left-0 top-0"
                style={{
                  width: imageWidth,
                  height: imageHeight,
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <img
                  src={property.mapImage.src}
                  alt="Farm map"
                  draggable={false}
                  className="pointer-events-none block select-none"
                  style={{
                    width: `${imageWidth}px`,
                    height: `${imageHeight}px`,
                    maxWidth: "none",
                    filter: "saturate(0.9) brightness(0.92) contrast(0.94)",
                    opacity: 0.92,
                  }}
                />

                <svg
                  className="pointer-events-none absolute left-0 top-0"
                  width={imageWidth}
                  height={imageHeight}
                  viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                >
                  {zones.map((zone) => {
                    const selected = zone.id === selectedZone?.id;
                    const style = zoneStyle(zone.kind, selected);
                    const center = polygonCenter(zone.polygon as Point[]);
                    const polygonString = zone.polygon.map((p) => `${p.x},${p.y}`).join(" ");

                    return (
                      <g key={zone.id}>
                        <polygon
                          points={polygonString}
                          fill={style.fill}
                          stroke={style.stroke}
                          strokeWidth={style.strokeWidth}
                          strokeLinejoin="round"
                          strokeDasharray={style.dash}
                        />

                        {selected && (
                          <polygon
                            points={polygonString}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="2"
                            strokeLinejoin="round"
                          />
                        )}

                        <rect
                          x={center.x - 120}
                          y={center.y - 34}
                          width={240}
                          height={58}
                          rx={20}
                          fill={style.labelFill}
                          stroke={style.stroke}
                          strokeWidth={selected ? 2.5 : 1.5}
                        />
                        <text
                          x={center.x}
                          y={center.y - 5}
                          textAnchor="middle"
                          fontSize="24"
                          fontWeight="700"
                          fill={style.labelText}
                        >
                          {zone.name}
                        </text>
                        <text
                          x={center.x}
                          y={center.y + 18}
                          textAnchor="middle"
                          fontSize="15"
                          fill={style.labelText}
                          opacity="0.78"
                        >
                          {zone.kind} · {zone.state}
                        </text>

                        {selected &&
                          zone.polygon.map((point, index) => (
                            <g key={`${zone.id}-${index}`}>
                              <circle
                                cx={point.x}
                                cy={point.y}
                                r="16"
                                fill="#ffffff"
                                stroke={style.stroke}
                                strokeWidth="3"
                              />
                              <circle
                                cx={point.x}
                                cy={point.y}
                                r="8"
                                fill={style.handleFill}
                              />
                            </g>
                          ))}
                      </g>
                    );
                  })}

                  {boundaryPoints.length >= 2 && (
                    <polyline
                      points={boundaryPolyline}
                      fill="none"
                      stroke={mode === "boundary" ? "#fff7ea" : "rgba(255,255,255,0.82)"}
                      strokeWidth={mode === "boundary" ? "5" : "3"}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {boundaryPoints.length >= 3 && (
                    <polygon
                      points={boundaryPolyline}
                      fill="rgba(255,255,255,0.02)"
                      stroke={mode === "boundary" ? "#fff7ea" : "rgba(255,255,255,0.76)"}
                      strokeWidth={mode === "boundary" ? "4" : "2"}
                      strokeLinejoin="round"
                    />
                  )}

                  {mode === "boundary" &&
                    boundaryPoints.map((point, index) => (
                      <g key={`${point.x}-${point.y}-${index}`}>
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="10"
                          fill="#fbf8f2"
                          stroke="#8b5c39"
                          strokeWidth="3"
                        />
                        <circle cx={point.x} cy={point.y} r="3.5" fill="#8b5c39" />
                        <text
                          x={point.x + 14}
                          y={point.y - 12}
                          fontSize="18"
                          fontWeight="700"
                          fill="#fbf8f2"
                          stroke="#684632"
                          strokeWidth="0.75"
                          paintOrder="stroke"
                        >
                          {index + 1}
                        </text>
                      </g>
                    ))}
                </svg>
              </div>

              <div className="absolute left-5 top-5 rounded-full bg-[#fbf8f2]/96 px-5 py-3 text-sm text-[#625c52] shadow-sm">
                {mode === "zones"
                  ? "Zone mode · click a zone to select it · drag the round corner handles"
                  : "Boundary mode · click to add boundary points · drag to pan"}
              </div>

              <div className="absolute right-5 top-5 rounded-full bg-[#fbf8f2]/96 px-4 py-2 text-xs font-semibold tracking-[0.08em] text-[#625c52] shadow-sm">
                {mode === "zones" ? "EDIT ZONES" : "REFINE BOUNDARY"}
              </div>

              <div className="absolute left-5 bottom-5 rounded-full bg-[#fbf8f2]/96 px-4 py-2 text-sm text-[#625c52] shadow-sm">
                Image: {imageWidth} × {imageHeight}px
              </div>
            </div>
          </div>

          <aside className="rounded-[28px] border border-[#ddd5c7] bg-[#f8f4ec] p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8e8778]">
              Boundary + zones
            </p>

            <div className="mt-3 space-y-3">
              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="text-xs text-[#8a8376]">Mode</p>
                <p className="mt-1 text-base font-semibold">
                  {mode === "zones" ? "Edit zones" : "Refine boundary"}
                </p>
              </div>

              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="text-xs text-[#8a8376]">Boundary source</p>
                <p className="mt-1 text-sm font-semibold">
                  {usingLocalBoundaryDraft ? "Local draft override" : "Atlas file boundary"}
                </p>
                <p className="mt-2 text-xs text-[#6e6a60]">{boundaryCountLabel}</p>
              </div>

              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="text-xs text-[#8a8376]">Zone source</p>
                <p className="mt-1 text-sm font-semibold">
                  {usingLocalZoneDraft ? "Local draft override" : "Atlas file zones"}
                </p>
                <p className="mt-2 text-xs text-[#6e6a60]">{zoneStats.total} zones loaded</p>
              </div>

              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="text-xs text-[#8a8376]">Selected zone</p>
                {selectedZone ? (
                  <>
                    <p className="mt-1 text-base font-semibold">{selectedZone.name}</p>
                    <p className="mt-1 text-xs text-[#6e6a60]">
                      {selectedZone.kind} · {selectedZone.state}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-[#6e6a60]">No zone selected</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => zoomBy(0.9)}
                  className="rounded-2xl border border-[#ddd4c5] bg-white px-3 py-2 text-sm shadow-sm"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  className="rounded-2xl border border-[#ddd4c5] bg-white px-3 py-2 text-sm shadow-sm"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => zoomBy(1.1)}
                  className="rounded-2xl border border-[#ddd4c5] bg-white px-3 py-2 text-sm shadow-sm"
                >
                  +
                </button>
              </div>

              <div className="rounded-2xl bg-[#f1ede4] px-4 py-4 text-sm leading-7 text-[#6d675d]">
                In zone mode, click a zone card or click the zone on the map to select it.
                Then drag the visible corner handles to reshape it.
              </div>

              <div className="rounded-2xl bg-white px-4 py-3">
                <p className="text-xs text-[#8a8376]">Zone registry</p>
                <div className="mt-2 space-y-2 text-xs">
                  {zones.map((zone) => {
                    const selected = zone.id === selectedZone?.id;
                    const style = zoneStyle(zone.kind, selected);

                    return (
                      <button
                        key={zone.id}
                        type="button"
                        onClick={() => {
                          setSelectedZoneId(zone.id);
                          setMode("zones");
                        }}
                        className={`w-full rounded-xl border px-3 py-3 text-left shadow-sm ${
                          selected
                            ? "border-[#5e7350] bg-[#f8fbf6]"
                            : "border-[#ebe3d7] bg-[#fbf8f2]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: style.stroke }}
                          />
                          <span className="font-semibold text-[#3b3935]">{zone.name}</span>
                        </div>
                        <div className="mt-1 text-[#6e6a60]">
                          {zone.kind} · {zone.state}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {mode === "boundary" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={undoLastBoundaryPoint}
                      disabled={boundaryPoints.length === 0}
                      className="rounded-2xl border border-[#ddd4c5] bg-white px-3 py-2 text-sm shadow-sm disabled:opacity-40"
                    >
                      Undo last
                    </button>
                    <button
                      type="button"
                      onClick={clearBoundary}
                      disabled={boundaryPoints.length === 0}
                      className="rounded-2xl border border-[#ddd4c5] bg-white px-3 py-2 text-sm shadow-sm disabled:opacity-40"
                    >
                      Clear all
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={restoreFileBoundary}
                    className="w-full rounded-2xl border border-[#ddd4c5] bg-white px-3 py-2 text-sm shadow-sm"
                  >
                    Restore atlas file boundary
                  </button>

                  <button
                    type="button"
                    onClick={copyBoundarySnippet}
                    disabled={boundaryPoints.length < 3}
                    className="w-full rounded-2xl border border-[#cbd6e9] bg-[#edf3ff] px-3 py-2 text-sm shadow-sm disabled:opacity-40"
                  >
                    {copiedBoundary ? "Copied" : "Copy boundary snippet"}
                  </button>
                </>
              )}

              {mode === "zones" && (
                <>
                  <button
                    type="button"
                    onClick={restoreFileZones}
                    className="w-full rounded-2xl border border-[#ddd4c5] bg-white px-3 py-2 text-sm shadow-sm"
                  >
                    Restore atlas file zones
                  </button>

                  <button
                    type="button"
                    onClick={copyZonesSnippet}
                    className="w-full rounded-2xl border border-[#cbd6e9] bg-[#edf3ff] px-3 py-2 text-sm shadow-sm"
                  >
                    {copiedZones ? "Copied" : "Copy zones snippet"}
                  </button>

                  {selectedZone && (
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <p className="text-xs text-[#8a8376]">Selected zone vertices</p>
                      <div className="mt-2 space-y-1 text-xs leading-6 text-[#514c44]">
                        {selectedZone.polygon.map((point, index) => (
                          <div key={`${selectedZone.id}-${index}`}>
                            {index + 1}. x:{point.x} y:{point.y}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}