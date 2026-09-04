import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const oauth = read("lib/atlas/integrations/providers/google/oauth.ts");
const gmail = read("lib/atlas/integrations/providers/google/gmail.ts");
const calendar = read("lib/atlas/integrations/providers/google/calendar.ts");

test("Google web-server authorization requires offline incremental consent and state", () => {
  assert.match(oauth, /access_type", "offline"/);
  assert.match(oauth, /include_granted_scopes", "true"/);
  assert.match(oauth, /response_type", "code"/);
  assert.match(oauth, /state\.trim\(\)\.length < 32/);
  assert.match(oauth, /callback state mismatch/);
});

test("Google credential custody is by opaque secret handle", () => {
  assert.match(oauth, /IntegrationSecretHandle/);
  assert.match(oauth, /purpose: "oauth_client"/);
  assert.match(oauth, /purpose: "oauth_connection"/);
  assert.doesNotMatch(oauth, /clientSecret\s*:/);
  assert.doesNotMatch(oauth, /refreshToken\s*:/);
  assert.doesNotMatch(oauth, /accessToken\s*:/);
});

test("Gmail starts with read-only profiles and no mutation/send authority", () => {
  assert.match(gmail, /gmail\.metadata/);
  assert.match(gmail, /gmail\.readonly/);
  assert.doesNotMatch(gmail, /gmail\.send|gmail\.modify|gmail\.compose|gmail\.settings|mail\.google\.com/);
});

test("Calendar starts with list + event read-only scopes only", () => {
  assert.match(calendar, /calendar\.calendarlist\.readonly/);
  assert.match(calendar, /calendar\.events\.readonly/);
  assert.doesNotMatch(calendar, /auth\/calendar"|auth\/calendar\.events"|calendar\.acls/);
});
