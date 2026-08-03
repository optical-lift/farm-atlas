with elm as (
  select f.id as farm_id, f.organization_id
  from atlas.farms f where f.stable_key = 'elm_farm'
), event as (
  select ce.id, ce.stable_key, ce.event_date, ce.start_local_time, ce.end_local_time
  from atlas.community_events ce
  join elm on elm.farm_id = ce.farm_id
  where ce.stable_key = 'thursdays_at_elm_2026_08_06_morning'
), owner_member as (
  select fm.user_id
  from atlas.farm_memberships fm join elm on elm.farm_id = fm.farm_id
  where fm.active and fm.role = 'owner'
  order by fm.created_at limit 1
)
insert into atlas.journal_event_index(
  organization_id, farm_id, event_key, event_kind, source_kind, source_id,
  source_event, occurred_at, journal_date, actor_user_id, title, detail,
  visibility_scope, importance, payload, provenance
)
select
  elm.organization_id,
  elm.farm_id,
  'community-event-reminder:thursdays_at_elm_2026_08_06_morning:2026-08-05',
  'system_event',
  'community_event',
  event.id,
  'member_reminder',
  timestamp with time zone '2026-08-05 19:00:00-05',
  date '2026-08-05',
  owner_member.user_id,
  'Tomorrow at Elm · Come Flower Farm With Us',
  'Thursday, August 6 · 9:30–11:30 a.m. Coffee, field walking, flower farming, and optional bouquet making.',
  'farm_shared',
  'normal',
  jsonb_build_object(
    'communityEventId', event.id,
    'communityEventKey', event.stable_key,
    'eventDate', event.event_date,
    'startLocalTime', event.start_local_time,
    'endLocalTime', event.end_local_time,
    'timeZone', 'America/Chicago',
    'deepLink', '/day?date=2026-08-06',
    'programKey', 'thursdays_at_elm'
  ),
  jsonb_build_object(
    'source', 'owner_task:build_community_thursday_event_bell_flow',
    'scheduledAt', now(),
    'scheduleReason', 'day-before member reminder'
  )
from elm cross join event cross join owner_member
on conflict (farm_id, event_key) do update
set occurred_at = excluded.occurred_at,
    journal_date = excluded.journal_date,
    title = excluded.title,
    detail = excluded.detail,
    visibility_scope = excluded.visibility_scope,
    importance = excluded.importance,
    payload = excluded.payload,
    provenance = atlas.journal_event_index.provenance || excluded.provenance,
    updated_at = now();

with event_notice as (
  select jei.id as journal_event_id, jei.farm_id, jei.title, jei.detail, jei.payload
  from atlas.journal_event_index jei
  join atlas.farms f on f.id = jei.farm_id
  where f.stable_key = 'elm_farm'
    and jei.event_key = 'community-event-reminder:thursdays_at_elm_2026_08_06_morning:2026-08-05'
), members as (
  select fm.user_id, fm.worker_key, fm.role
  from atlas.farm_memberships fm
  join atlas.farms f on f.id = fm.farm_id
  where f.stable_key = 'elm_farm' and fm.active = true
)
insert into atlas.notification_outbox(
  farm_id, user_id, journal_event_id, category, title, body, deep_link,
  badge_count, importance, dedupe_key, not_before, status, payload
)
select
  event_notice.farm_id,
  members.user_id,
  event_notice.journal_event_id,
  'day_plan',
  event_notice.title,
  event_notice.detail,
  '/day?date=2026-08-06',
  1,
  'normal',
  format('community-event-reminder:%s:%s', event_notice.journal_event_id, members.user_id),
  timestamp with time zone '2026-08-05 19:00:00-05',
  'pending',
  event_notice.payload || jsonb_build_object(
    'recipientWorkerKey', members.worker_key,
    'recipientRole', members.role,
    'scheduledBy', 'community_thursday_event_bell_flow_v1'
  )
from event_notice cross join members
on conflict (dedupe_key) do update
set title = excluded.title,
    body = excluded.body,
    deep_link = excluded.deep_link,
    badge_count = excluded.badge_count,
    importance = excluded.importance,
    not_before = excluded.not_before,
    payload = excluded.payload,
    status = case when atlas.notification_outbox.status = 'sent' then 'sent' else 'pending' end,
    updated_at = now();
