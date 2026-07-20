const ATLAS_SUPABASE_URL = "https://zirqkouammpwxlqfbsvf.supabase.co";
const ATLAS_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3UCb5b3USJD24c2uX6B_4A_0XWDT6si";

export function getAtlasSupabaseConfig() {
  return {
    url:
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      ATLAS_SUPABASE_URL,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      ATLAS_SUPABASE_PUBLISHABLE_KEY,
  };
}
