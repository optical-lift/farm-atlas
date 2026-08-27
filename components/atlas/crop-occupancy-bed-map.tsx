"use client";

import type { AtlasBedMap } from "@/lib/atlas/weed-card-contract";
import LegacyCropOccupancyBedMap from "./crop-occupancy-bed-map-legacy";
import ReferenceGeometryBedMap, { hasGovernedReferenceGeometry } from "./reference-geometry-bed-map";

type Props = {
  map: AtlasBedMap | null | undefined;
  variant?: "default" | "notebook";
};

export default function CropOccupancyBedMap({ map, variant = "default" }: Props) {
  if (!map) return null;

  // Governed irregular geometry outranks rectangular fallbacks. An irregular
  // object may also have useful measured dimensions, but those dimensions do
  // not make its physical shape rectangular.
  if (variant === "notebook" && hasGovernedReferenceGeometry(map)) {
    return <ReferenceGeometryBedMap map={map} />;
  }

  return <LegacyCropOccupancyBedMap map={map} variant={variant} />;
}
