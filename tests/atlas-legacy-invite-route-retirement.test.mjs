import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const retired = [
  ["app/api/atlas/owner/members/invites/route.ts", "POST"],
  ["app/api/atlas/owner/members/invites/[inviteId]/route.ts", "DELETE"],
  ["app/api/atlas/owner/members/invites/[inviteId]/send/route.ts", "POST"],
  ["app/api/atlas/auth/invite/accept/route.ts", "POST"],
];

test("all legacy farm invitation endpoints fail closed before any mutation", () => {
  for (const [path, method] of retired) {
    const source = read(path);
    assert.match(source, new RegExp(`export async function ${method}\\(\\)`), path);
    assert.match(source, /status: 410/, path);
    assert.match(source, /Cache-Control": "private, no-store"/, path);
    assert.doesNotMatch(source, /supabase|\.rpc\(|auth\.admin|auth\.updateUser|createAtlasAdminClient|ATLAS_INVITES_ENABLED/i, path);
  }
});

test("old invitation acceptance page does not read or activate old membership grants", () => {
  const page = read("app/onboarding/invite/page.tsx");
  assert.match(page, /invitation route has been retired/i);
  assert.doesNotMatch(page, /getPendingMembershipInvite|InviteAcceptanceClient|createAtlasServerClient|accept_membership_invite_v1/);
});

test("existing owner member directory remains read-only and keeps real memberships", () => {
  const page = read("app/owner/members/page.tsx");
  const client = read("app/owner/members/MembershipClient.tsx");
  const data = read("lib/atlas-data/members.ts");
  assert.match(page, /requireAtlasRole\(\["owner"\]\)/);
  assert.match(page, /getOwnerMemberDirectory\(access\)/);
  assert.match(client, /directory\.memberships\.map/);
  assert.doesNotMatch(client, /fetch\(|prepareInvite|sendInvite|revokeInvite|<form|inviteDrafts|ATLAS_INVITES_ENABLED/);
  assert.match(data, /owner_list_farm_members_v1/);
  assert.doesNotMatch(page, /invitesEnabled|ATLAS_INVITES_ENABLED/);
});
