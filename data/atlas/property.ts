export type PropertyMapImage = {
  src: string;
  widthPx: number;
  heightPx: number;
  northUp: boolean;
};

export type PropertyViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export type PropertyRecord = {
  id: string;
  name: string;
  acreage: number | null;
  locationLabel: string;
  notes?: string;
  mapImage: PropertyMapImage;
  viewBox: PropertyViewBox;
  defaultSceneCenter: {
    x: number;
    y: number;
  };
  defaultSceneZoom: number;
  primaryHouseFeatureId: string;
  primaryZoneIds: string[];
};

export const property: PropertyRecord = {
  id: "spencer-farm",
  name: "Spencer Farm",
  acreage: 1,
  locationLabel: "Primary farm property",
  notes: "Settled version-1 board property for the farm command atlas.",
  mapImage: {
    src: "/maps/farm_map_01.jpg",
    widthPx: 2048,
    heightPx: 2732,
    northUp: true,
  },
  viewBox: {
    minX: 0,
    minY: 0,
    width: 2048,
    height: 2732,
  },
  defaultSceneCenter: {
    x: 1024,
    y: 1366,
  },
  defaultSceneZoom: 1,
  primaryHouseFeatureId: "house",
  primaryZoneIds: ["main-field", "nursery", "hospitality-court"],
};