import type { AtlasLivingDay, AtlasLivingDayResponse } from "./living-day-contract";

export async function fetchAtlasLivingDay(dateIso: string): Promise<AtlasLivingDay> {
  const params = new URLSearchParams({ date: dateIso });
  const response = await fetch(`/api/atlas/living-day?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = (await response.json()) as AtlasLivingDayResponse;
  if (!response.ok || !data.ok || !data.livingDay) {
    throw new Error(data.details || data.error || "The Living Day could not be loaded.");
  }
  return data.livingDay;
}
