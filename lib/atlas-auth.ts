import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const ACCESS_COOKIE = "atlas_access_token";
const REFRESH_COOKIE = "atlas_refresh_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type AtlasFarmRole = "owner" | "manager" | "farm_hand";

export type AtlasMembership = {
  id: string;
  farm_id: string;
  role: AtlasFarmRole;
  worker_key: string | null;
  active: boolean;
  permissions: Record<string, unknown>;
  farm: {
    id: string;
    stable_key: string;
    name: string;
    status: string;
  } | null;
};

export type AtlasIdentity = {
  user: User;
  profile: {
    user_id: string;
    display_name: string;
    default_farm_id: string | null;
    active: boolean;
  } | null;
  memberships: AtlasMembership[];
};

function env(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function createAtlasAuthClient() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: { schema: "atlas" },
  });
}

export async function writeAtlasSession(accessToken: string, refreshToken: string) {
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  const options = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };

  store.set(ACCESS_COOKIE, accessToken, options);
  store.set(REFRESH_COOKIE, refreshToken, options);
}

export async function clearAtlasSession() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function readAtlasTokens() {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_COOKIE)?.value ?? null,
    refreshToken: store.get(REFRESH_COOKIE)?.value ?? null,
  };
}

export async function getAtlasIdentity(): Promise<AtlasIdentity | null> {
  const { accessToken, refreshToken } = await readAtlasTokens();
  if (!accessToken && !refreshToken) return null;

  const supabase = createAtlasAuthClient();
  let token = accessToken;

  if (token) {
    const { data } = await supabase.auth.getUser(token);
    if (data.user) return loadIdentity(supabase, data.user);
  }

  if (!refreshToken) return null;

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) return null;

  await writeAtlasSession(data.session.access_token, data.session.refresh_token);
  return loadIdentity(supabase, data.user);
}

async function loadIdentity(
  supabase: ReturnType<typeof createAtlasAuthClient>,
  user: User,
): Promise<AtlasIdentity> {
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("user_id, display_name, default_farm_id, active")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("farm_memberships")
      .select("id, farm_id, role, worker_key, active, permissions, farm:farms(id, stable_key, name, status)")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  return {
    user,
    profile: profile ?? null,
    memberships: (memberships ?? []) as unknown as AtlasMembership[],
  };
}

export function membershipForFarm(identity: AtlasIdentity, farmId: string) {
  return identity.memberships.find((membership) => membership.farm_id === farmId) ?? null;
}

export function canSeeWholeFarm(role: AtlasFarmRole) {
  return role === "owner" || role === "manager";
}
