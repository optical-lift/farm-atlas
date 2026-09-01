export type AtlasOverviewFact = {
  label: string;
  value: string;
};

export type AtlasOverviewLine = {
  id: string;
  sentence: string;
  state: "done" | "now" | "open" | "waiting";
  worksheet?: {
    kicker?: string;
    facts?: AtlasOverviewFact[];
    note?: string;
  };
};

export type AtlasOverviewSection = {
  label: string;
  lines: AtlasOverviewLine[];
};
