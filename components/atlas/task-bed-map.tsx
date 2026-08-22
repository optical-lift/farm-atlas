"use client";

import { useEffect, useState } from "react";

import CropOccupancyBedMap from "@/components/atlas/crop-occupancy-bed-map";
import type { AtlasBedMap } from "@/lib/atlas/weed-card-contract";

type Props = {
  taskId: string;
  label?: string;
  detail?: string;
};

export default function TaskBedMap({ taskId, label = "Bed map", detail = "current crop occupancy" }: Props) {
  const [map, setMap] = useState<AtlasBedMap | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMap(null);
    void fetch(`/api/atlas/task-bed-map?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as { ok?: boolean; map?: AtlasBedMap | null };
        return response.ok && data.ok ? data.map ?? null : null;
      })
      .then((value) => { if (!controller.signal.aborted) setMap(value); })
      .catch(() => { /* A missing map is a truthful empty state, not a task failure. */ });
    return () => controller.abort();
  }, [taskId]);

  if (!map) return null;

  return (
    <section data-atlas-task-bed-map="canonical-v1" style={{ display: "grid", gap: 10, padding: "16px 18px 18px", borderBottom: "1px solid rgba(215,204,189,.62)", background: "rgba(248,246,238,.34)" }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ color: "#858bb8", fontSize: 10, lineHeight: 1, fontWeight: 950, letterSpacing: ".15em", textTransform: "uppercase" }}>{label}</span>
        <small style={{ color: "#8b8c84", fontSize: 8, lineHeight: 1.15, fontWeight: 760 }}>{detail}</small>
      </header>
      <CropOccupancyBedMap map={map} variant="notebook" />
    </section>
  );
}
