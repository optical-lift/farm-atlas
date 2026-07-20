import type { AtlasSession } from "@/lib/atlas/session";

export function normalizeAtlasSession(input: {
  user: unknown;
  profile: unknown;
  memberships: unknown;
}): AtlasSession | null;
