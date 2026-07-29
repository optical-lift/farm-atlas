import "server-only";

import {
  buildAtlasJournalCover,
  readAtlasJournalCover,
} from "@/lib/atlas/journal-cover-home";
import type { AtlasLivingDay } from "@/lib/atlas/living-day-contract";
import type { AtlasUniversalHomeModel } from "@/lib/atlas/universal-home";
import { createAtlasServerClient } from "@/lib/supabase/server";

type LivingDayRpcError = { message?: string };

export async function readAtlasOperatorJournalCover(home: AtlasUniversalHomeModel) {
  if (home.viewer.canUseAnyOwnerTools) return readAtlasJournalCover(home);

  const dateIso = home.window.doneDate;
  if (!home.activeFarm?.farmId) return buildAtlasJournalCover(home, null, dateIso);

  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("living_day_v1", {
      p_farm_id: home.activeFarm.farmId,
      p_day: dateIso,
    });
    if (error) throw error as LivingDayRpcError;
    const livingDay = data as AtlasLivingDay;
    return buildAtlasJournalCover(home, { ...livingDay, ownerDecisions: [] }, dateIso);
  } catch {
    return buildAtlasJournalCover(home, null, dateIso);
  }
}
