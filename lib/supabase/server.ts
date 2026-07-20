import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

export async function createAtlasServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getAtlasSupabaseConfig();

  return createServerClient(url, publishableKey, {
    db: { schema: "atlas" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The request proxy refreshes
          // the session before protected server rendering begins.
        }
      },
    },
  });
}
