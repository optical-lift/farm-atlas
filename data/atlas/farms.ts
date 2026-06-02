export type FarmId = "elm" | "sd-micro";

export type FarmProfile = {
  id: FarmId;
  label: string;
  shortLabel: string;
  locationLabel: string;
  defaultRoute: string;
  status: "active" | "draft";
};

export const farms: FarmProfile[] = [
  {
    id: "elm",
    label: "Elm Farm",
    shortLabel: "Elm",
    locationLabel: "Marshfield, MO",
    defaultRoute: "/",
    status: "active",
  },
  {
    id: "sd-micro",
    label: "SD Micro Farm",
    shortLabel: "SD",
    locationLabel: "South Dakota",
    defaultRoute: "/",
    status: "draft",
  },
];

export const DEFAULT_FARM_ID: FarmId = "elm";