with event as (
  select ce.id, ce.stable_key, ce.event_date
  from atlas.community_events ce
  join atlas.farms f on f.id = ce.farm_id
  where f.stable_key = 'elm_farm'
    and ce.stable_key = 'thursdays_at_elm_2026_08_06_morning'
)
update atlas.tasks t
set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'community_event_id', event.id,
      'community_event_key', event.stable_key,
      'community_event_date', event.event_date,
      'recurrence_pending_event_engine', false,
      'recurrence_installed_at', now()
    ),
    updated_at = now()
from event
where t.task_series_key = 'community_thursday_wednesday_setup'
  and t.due_date = date '2026-08-05';

update atlas.work_definitions wd
set title_template = 'Prepare Community Thursday',
    source_kind = 'community_program',
    work_class = 'light',
    default_visibility_scope = 'assigned_worker',
    metadata = coalesce(wd.metadata, '{}'::jsonb) || jsonb_build_object(
      'series_key', 'community_thursday_wednesday_setup',
      'program_key', 'thursdays_at_elm',
      'recurrence', 'Wednesday before first and third Thursday community mornings',
      'installed_at', now()
    ),
    updated_at = now()
where wd.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and wd.stable_key = 'auto:manual:community_thursday_wednesday_setup:f688f27fa96a';

update atlas.work_release_policies wrp
set gate_type = 'time_window',
    horizon_days = 60,
    maximum_active_instances = 1,
    gate_config = jsonb_build_object(
      'automatic', true,
      'source_kind', 'community_program',
      'repeat_rule', 'monthly_weekday_ordinals',
      'setup_weekday', 3,
      'linked_event_weekday', 4,
      'linked_event_week_ordinals', jsonb_build_array(1, 3),
      'release_lead_days', 1
    ),
    metadata = coalesce(wrp.metadata, '{}'::jsonb) || jsonb_build_object(
      'program_key', 'thursdays_at_elm',
      'owner_authorized_at', now(),
      'recurrence_installed', true
    ),
    updated_at = now()
from atlas.work_definitions wd
where wrp.work_definition_id = wd.id
  and wd.farm_id = (select id from atlas.farms where stable_key = 'elm_farm')
  and wd.stable_key = 'auto:manual:community_thursday_wednesday_setup:f688f27fa96a';

with event as (
  select ce.id, ce.stable_key, ce.event_date
  from atlas.community_events ce
  join atlas.farms f on f.id = ce.farm_id
  where f.stable_key = 'elm_farm'
    and ce.stable_key = 'thursdays_at_elm_2026_08_06_morning'
)
update atlas.planned_work_occurrences pwo
set source_kind = 'community_event',
    source_id = event.id,
    source_event_key = event.stable_key,
    relation_payload = coalesce(pwo.relation_payload, '{}'::jsonb) || jsonb_build_object(
      'community_event_id', event.id,
      'community_event_key', event.stable_key,
      'community_event_date', event.event_date
    ),
    metadata = coalesce(pwo.metadata, '{}'::jsonb) || jsonb_build_object(
      'program_key', 'thursdays_at_elm',
      'recurrence_installed', true
    ),
    updated_at = now()
from event
where pwo.occurrence_key = 'community_thursday_wednesday_setup:2026-08-05';

with definition as (
  select wd.id as work_definition_id, wrp.id as release_policy_id, wd.farm_id
  from atlas.work_definitions wd
  join atlas.work_release_policies wrp on wrp.work_definition_id = wd.id
  join atlas.farms f on f.id = wd.farm_id
  where f.stable_key = 'elm_farm'
    and wd.stable_key = 'auto:manual:community_thursday_wednesday_setup:f688f27fa96a'
), anna as (
  select fm.id as membership_id, fm.user_id
  from atlas.farm_memberships fm
  join atlas.farms f on f.id = fm.farm_id
  where f.stable_key = 'elm_farm' and fm.active = true and fm.worker_key = 'anna'
  order by fm.created_at
  limit 1
), template as (
  select pwo.task_payload
  from atlas.planned_work_occurrences pwo
  where pwo.occurrence_key = 'community_thursday_wednesday_setup:2026-08-05'
  limit 1
), future_events as (
  select ce.id as event_id, ce.stable_key as event_key, ce.event_date,
         (ce.event_date - 1) as setup_date
  from atlas.community_events ce
  join atlas.farms f on f.id = ce.farm_id
  where f.stable_key = 'elm_farm'
    and ce.event_kind = 'free_community_morning'
    and ce.event_date > date '2026-08-06'
    and ce.event_date <= date '2026-12-31'
)
insert into atlas.planned_work_occurrences(
  farm_id, work_definition_id, release_policy_id, occurrence_key,
  source_kind, source_id, source_event_key, title, planned_due_date,
  not_before_date, state, task_payload, relation_payload, metadata,
  work_lane, commitment_kind, effort_units
)
select
  definition.farm_id,
  definition.work_definition_id,
  definition.release_policy_id,
  format('community_thursday_wednesday_setup:%s', future_events.setup_date),
  'community_event',
  future_events.event_id,
  future_events.event_key,
  'Prepare Community Thursday',
  future_events.setup_date,
  future_events.setup_date - 1,
  'planned',
  (template.task_payload - 'completed_at' - 'completed_by') || jsonb_build_object(
    'due_date', future_events.setup_date,
    'engine_instance_key', format('recurring:community_thursday_wednesday_setup:%s', future_events.setup_date),
    'metadata', coalesce(template.task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
      'task_key', format('anna_%s_prepare_community_thursday', to_char(future_events.setup_date, 'YYYYMMDD')),
      'community_event_id', future_events.event_id,
      'community_event_key', future_events.event_key,
      'community_event_date', future_events.event_date,
      'visit_window_start', future_events.setup_date - 1,
      'visit_window_end', future_events.setup_date,
      'recurrence_pending_event_engine', false,
      'recurrence_pattern', 'Wednesday before first and third Thursday community mornings'
    ),
    'assigned_membership_id', anna.membership_id,
    'assigned_user_id', anna.user_id
  ),
  jsonb_build_object(
    'community_event_id', future_events.event_id,
    'community_event_key', future_events.event_key,
    'community_event_date', future_events.event_date
  ),
  jsonb_build_object(
    'program_key', 'thursdays_at_elm',
    'created_by', 'community_thursday_recurrence_v1'
  ),
  'required',
  'hard_date',
  0.5
from definition cross join anna cross join template cross join future_events
on conflict (farm_id, work_definition_id, occurrence_key) do update
set source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    source_event_key = excluded.source_event_key,
    title = excluded.title,
    planned_due_date = excluded.planned_due_date,
    not_before_date = excluded.not_before_date,
    task_payload = excluded.task_payload,
    relation_payload = excluded.relation_payload,
    metadata = atlas.planned_work_occurrences.metadata || excluded.metadata,
    work_lane = excluded.work_lane,
    commitment_kind = excluded.commitment_kind,
    effort_units = excluded.effort_units,
    updated_at = now();
