import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260730170000_web_push_foundation_v1.sql");
const edge = read("supabase/functions/atlas-web-push-dispatch/index.ts");
const route = read("app/api/atlas/push/route.ts");
const client = read("lib/atlas/push-client.ts");
const setup = read("components/atlas/pwa/AtlasPwaSetup.tsx");
const serviceWorker = read("public/sw.js");

const build = `${migration}\n${edge}\n${route}\n${client}\n${setup}\n${serviceWorker}`;

test("Build 10 stores one user-and-device subscription without exposing VAPID secrets", () => {
  assert.match(migration, /create table if not exists atlas\.push_subscriptions/);
  assert.match(migration, /user_id uuid not null references auth\.users/);
  assert.match(migration, /endpoint text not null unique/);
  assert.match(migration, /p256dh text not null/);
  assert.match(migration, /auth_key text not null/);
  assert.match(migration, /alter table atlas\.push_subscriptions enable row level security/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /VAPID and dispatcher secrets are provisioned directly/);
  assert.doesNotMatch(migration, /BEGIN PRIVATE KEY|VAPID_PRIVATE_KEY|qhO98Zx/);
  assert.doesNotMatch(client, /vapidPrivate|dispatchToken/);
});

test("permission and PushManager subscription require the explicit installed-app action", () => {
  assert.match(setup, /Connect lockscreen delivery/);
  assert.match(setup, /Enable Atlas notifications/);
  assert.match(setup, /connectAlerts/);
  assert.match(client, /pushManager\.subscribe/);
  assert.match(client, /userVisibleOnly: true/);
  assert.match(client, /applicationServerKey/);
  assert.match(route, /x-atlas-intent/);
  assert.match(route, /actualUserFarmId/);
  assert.doesNotMatch(route, /effectiveMembershipId|operatorContext/);
});

test("the Journal remains event-notification truth and creates a deduplicated outbox", () => {
  assert.match(migration, /journal_event_id uuid references atlas\.journal_event_index/);
  assert.match(migration, /create table if not exists atlas\.notification_outbox/);
  assert.match(migration, /dedupe_key text not null unique/);
  assert.match(migration, /after insert on atlas\.journal_event_index/);
  assert.match(migration, /enqueue_journal_event_notifications_v1/);
  assert.match(migration, /bell_event_deep_link_v1/);
  assert.doesNotMatch(migration, /insert into atlas\.journal_event_index/);
  assert.doesNotMatch(migration, /create table if not exists atlas\.notification_events/);
});

test("push recipients and event categories are resolved from farm roles, assignment, visibility, and preferences", () => {
  assert.match(migration, /new\.assigned_user_id is not null and fm\.user_id = new\.assigned_user_id/);
  assert.match(migration, /fm\.role in \('owner','manager'\)/);
  assert.match(migration, /notification_can_user_read_event_v1/);
  assert.match(migration, /rhythm_warning/);
  assert.match(migration, /rhythm_due/);
  assert.match(migration, /rhythm_failure/);
  assert.match(migration, /owner_decision/);
  assert.match(migration, /other_player_result/);
  assert.match(migration, /v_user\.user_id = new\.actor_user_id/);
});

test("quiet hours delay optional transport while required work timing remains deliverable", () => {
  assert.match(migration, /create table if not exists atlas\.notification_preferences/);
  assert.match(migration, /quiet_start time/);
  assert.match(migration, /quiet_end time/);
  assert.match(migration, /notification_next_available_at_v1/);
  assert.match(migration, /not_before/);
  assert.match(setup, /Use quiet hours for optional notifications/);
  assert.match(setup, /Required process timers, work releases, and closing-window warnings may still arrive during quiet hours/);
  assert.match(setup, /Save optional choices/);
});

test("the dispatcher leases deliveries, sends encrypted Web Push, retries transient failures, and retires stale devices", () => {
  assert.match(migration, /create table if not exists atlas\.notification_deliveries/);
  assert.match(migration, /for update of delivery skip locked/);
  assert.match(migration, /lease_until/);
  assert.match(edge, /npm:web-push@3\.6\.7/);
  assert.match(edge, /webpush\.setVapidDetails/);
  assert.match(edge, /webpush\.sendNotification/);
  assert.match(edge, /status === 404 \|\| status === 410/);
  assert.match(migration, /status = case when p_stale then 'stale'/);
  assert.match(migration, /v_attempts < 5/);
});

test("the dispatcher uses custom server authentication and never accepts caller-selected payloads", () => {
  assert.match(edge, /x-atlas-dispatch-token/);
  assert.match(edge, /web_push_dispatch_config_v1/);
  assert.match(edge, /claim_notification_delivery_batch_v1/);
  assert.doesNotMatch(edge, /body\.payload|body\.endpoint|body\.userId/);
  assert.match(migration, /grant execute on function atlas\.web_push_dispatch_config_v1\(text\) to service_role/);
  assert.match(migration, /revoke all on table atlas\.web_push_settings from public, anon, authenticated/);
});

test("notification taps keep exact Atlas deep links and Bell-derived badges", () => {
  assert.match(serviceWorker, /payload\.deepLink/);
  assert.match(serviceWorker, /const deepLink = data\.deepLink \|\| "\/bell"/);
  assert.match(serviceWorker, /openAtlasDestination\(deepLink\)/);
  assert.match(serviceWorker, /setAtlasBadge\(badgeCount\)/);
  assert.match(migration, /bell_badge_count_for_user_v1/);
  assert.doesNotMatch(build, /total open tasks.*badge/i);
});
