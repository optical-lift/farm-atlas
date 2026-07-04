export type AtlasWorkKey = "weed" | "germinate" | "harvest" | "venue" | "sowPlant" | "water" | "move" | "observe";

export type AtlasRhythmBlock = {
  id: string;
  stable_key: string;
  season_key: string;
  season_label: string;
  weekday: number;
  sort_order: number;
  work_key: AtlasWorkKey;
  display_label: string;
  default_zone_keys: string[];
  default_duration_minutes: number | null;
  weather_rule: string | null;
  source_note: string | null;
  cue: string | null;
};

export type AtlasTodayRhythmResponse = {
  ok: boolean;
  date: string;
  farmKey: string;
  seasonLabel: string | null;
  blocks: AtlasRhythmBlock[];
  error?: string;
  details?: string;
};

export async function fetchAtlasTodayRhythm(date?: string): Promise<AtlasTodayRhythmResponse> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);

  const response = await fetch(`/api/atlas/rhythm${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const data = (await response.json()) as AtlasTodayRhythmResponse;
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Failed to load Atlas rhythm.");
  return data;
}
