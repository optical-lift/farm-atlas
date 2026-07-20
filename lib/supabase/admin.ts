import { createClient } from "@supabase/supabase-js";

import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

export function createAtlasAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  const { url } = getAtlasSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: { schema: "atlas" },
  });
}
