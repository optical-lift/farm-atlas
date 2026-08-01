begin;

create table if not exists atlas.task_notification_plans (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null unique references atlas.tasks(id) on delete cascade,
  release_local_time time not null,
  close_local_time time,
  nudge_after_minutes integer,
  group_key text,
  group_label text,
  source text not null default 'owner_override',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_notification_plans_nudge_check
    check (nudge_after_minutes is null or nudge_after_minutes between 5 and 720)
);

create index if not exists task_notification_plans_farm_id_idx
  on atlas.task_notification_plans(farm_id);
create index if not exists task_notification_plans_active_task_idx
  on atlas.task_notification_plans(task_id)
  where active;

create table if not exists atlas.task_notification_moments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  moment_kind text not null,
  category text not null,
  group_key text not null,
  scheduled_for timestamptz not null,
  required boolean not null default false,
  task_ids uuid[] not null default '{}'::uuid[],
  title text not null,
  body text not null,
  deep_link text not null default '/day',
  status text not null default 'planned',
  outbox_id uuid references atlas.notification_outbox(id) on delete set null,
  sent_at timestamptz,
  skipped_at timestamptz,
  skip_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_notification_moments_kind_check check (
    moment_kind = any (array[
      'tomorrow_covered'::text,
      'day_plan'::text,
      'work_window'::text,
      'task_nudge'::text,
      'window_closing'::text,
      'day_wrap'::text
    ])
  ),
  constraint task_notification_moments_category_check check (
    category = any (array[
      'tomorrow_covered'::text,
      'day_plan'::text,
      'work_window'::text,
      'task_nudge'::text,
      'window_closing'::text,
      'day_wrap'::text
    ])
  ),
  constraint task_notification_moments_status_check check (
    status = any (array['planned'::text, 'sent'::text, 'skipped'::text, 'cancelled'::text])
  ),
  constraint task_notification_moments_identity_key unique (
    farm_id, user_id, work_date, moment_kind, group_key
  )
);

create index if not exists task_notification_moments_due_idx
  on atlas.task_notification_moments(scheduled_for, id)
  where status = 'planned';
create index if not exists task_notification_moments_user_day_idx
  on atlas.task_notification_moments(user_id, work_date, status);
create index if not exists task_notification_moments_membership_idx
  on atlas.task_notification_moments(membership_id);
create index if not exists task_notification_moments_outbox_idx
  on atlas.task_notification_moments(outbox_id);

alter table atlas.task_notification_plans enable row level security;
alter table atlas.task_notification_moments enable row level security;
revoke all on table atlas.task_notification_plans from public, anon, authenticated;
revoke all on table atlas.task_notification_moments from public, anon, authenticated;
grant all on table atlas.task_notification_plans to service_role;
grant all on table atlas.task_notification_moments to service_role;

alter table atlas.notification_outbox
  drop constraint if exists notification_outbox_category_check;
alter table atlas.notification_outbox
  add constraint notification_outbox_category_check
  check (category = any (array[
    'rhythm_warning'::text,
    'rhythm_due'::text,
    'rhythm_failure'::text,
    'unlock'::text,
    'owner_decision'::text,
    'other_player_result'::text,
    'dependency_ready'::text,
    'tomorrow_covered'::text,
    'day_plan'::text,
    'work_window'::text,
    'task_nudge'::text,
    'window_closing'::text,
    'day_wrap'::text,
    'system_test'::text
  ]));

create or replace function atlas.web_push_default_categories_v1()
returns jsonb
language sql
immutable
set search_path = pg_catalog, atlas
as $function$
  select '{
    "rhythm_warning": true,
    "rhythm_due": true,
    "rhythm_failure": true,
    "unlock": true,
    "owner_decision": true,
    "other_player_result": false,
    "dependency_ready": true,
    "tomorrow_covered": true,
    "day_plan": true,
    "work_window": true,
    "task_nudge": true,
    "window_closing": true,
    "day_wrap": true
  }'::jsonb
$function$;

create or replace function atlas.task_notification_category_policy_v1(p_role text)
returns jsonb
language sql
immutable
set search_path = pg_catalog, atlas
as $function$
  select jsonb_build_object(
    'requiredCategories', to_jsonb(case
      when p_role in ('owner', 'manager') then array[
        'tomorrow_covered', 'day_plan', 'work_window', 'window_closing',
        'dependency_ready', 'rhythm_due', 'rhythm_failure', 'unlock', 'owner_decision'
      ]::text[]
      else array[
        'work_window', 'window_closing', 'dependency_ready',
        'rhythm_due', 'rhythm_failure', 'unlock', 'owner_decision'
      ]::text[]
    end),
    'optionalCategories', to_jsonb(case
      when p_role in ('owner', 'manager') then array[
        'task_nudge', 'day_wrap', 'rhythm_warning', 'other_player_result'
      ]::text[]
      else array[
        'day_plan', 'task_nudge', 'day_wrap', 'rhythm_warning', 'other_player_result'
      ]::text[]
    end),
    'canPauseAll', false,
    'labels', jsonb_build_object(
      'tomorrow_covered', 'Tomorrow coverage',
      'day_plan', 'Morning plan',
      'work_window', 'Work ready now',
      'task_nudge', 'Friendly untouched reminders',
      'window_closing', 'Closing-window warnings',
      'day_wrap', 'End-of-day wrap-up',
      'dependency_ready', 'Process timers and dependent work',
      'rhythm_warning', 'Coming-due rhythm warnings',
      'rhythm_due', 'Rhythm work due now',
      'rhythm_failure', 'Missed rhythm boundaries',
      'unlock', 'Newly unlocked work',
      'owner_decision', 'Required handoffs and decisions',
      'other_player_result', 'Important results from another person'
    )
  )
$function$;

create or replace function atlas.task_notification_local_timestamp_v1(
  p_work_date date,
  p_local_time time,
  p_time_zone text
)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, atlas
as $function$
declare
  v_zone text := coalesce(nullif(btrim(p_time_zone), ''), 'America/Chicago');
begin
  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'America/Chicago';
  end if;
  return (p_work_date::timestamp + p_local_time) at time zone v_zone;
end;
$function$;

create or replace function atlas.task_notification_profile_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_plan atlas.task_notification_plans%rowtype;
  v_title text;
  v_action text;
  v_task_type text;
  v_collection text;
  v_group_key text;
  v_group_label text;
  v_release time;
  v_close time;
  v_nudge integer;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then return null; end if;

  select * into v_plan
  from atlas.task_notification_plans
  where task_id = p_task_id and active;

  if v_plan.id is not null then
    return jsonb_build_object(
      'source', v_plan.source,
      'releaseTime', to_char(v_plan.release_local_time, 'HH24:MI'),
      'closeTime', case when v_plan.close_local_time is null then null else to_char(v_plan.close_local_time, 'HH24:MI') end,
      'nudgeMinutes', v_plan.nudge_after_minutes,
      'groupKey', coalesce(nullif(v_plan.group_key, ''), p_task_id::text),
      'groupLabel', coalesce(nullif(v_plan.group_label, ''), nullif(v_task.metadata ->> 'collection_label', ''), v_task.title)
    );
  end if;

  v_title := lower(coalesce(v_task.title, ''));
  v_action := lower(coalesce(nullif(v_task.action_key, ''), nullif(v_task.metadata ->> 'display_action', ''), ''));
  v_task_type := lower(coalesce(v_task.task_type, ''));
  v_collection := nullif(v_task.metadata ->> 'collection_label', '');

  if v_title like '%trash%' then
    v_release := time '19:00'; v_close := time '20:30'; v_nudge := 35; v_group_label := 'Trash to the street';
  elsif v_action = 'harvest' or v_task_type like '%harvest%' then
    v_release := time '06:30'; v_close := time '09:00'; v_nudge := 45; v_group_label := coalesce(v_collection, 'Morning harvest');
  elsif v_action in ('spray', 'respray') or v_task_type like '%spray%' then
    v_release := time '07:30'; v_close := time '10:30'; v_nudge := 60; v_group_label := coalesce(v_collection, 'Morning spraying');
  elsif v_action in ('weed', 'weeding') or v_task_type like '%weed%' then
    v_release := time '08:00'; v_close := time '11:30'; v_nudge := 60; v_group_label := coalesce(v_collection, 'Morning weeding');
  elsif v_action in ('sow', 'transplant', 'plant') or v_task_type in ('sowing', 'transplanting') then
    v_release := time '09:00'; v_close := time '13:00'; v_nudge := 60; v_group_label := coalesce(v_collection, 'Morning planting');
  elsif v_action in ('call', 'send', 'order', 'coordinate', 'network', 'email')
     or v_task_type in ('marketing', 'coordination', 'purchasing', 'owner_procurement') then
    v_release := case when coalesce(v_collection, '') = 'Saturday Purchases' then time '11:30' else time '10:00' end;
    v_close := case when coalesce(v_collection, '') = 'Saturday Purchases' then time '17:00' else time '15:00' end;
    v_nudge := 90; v_group_label := coalesce(v_collection, 'Calls and orders');
  elsif v_action = 'mow' or v_task_type like '%mow%' then
    v_release := time '15:00'; v_close := time '18:00'; v_nudge := 75; v_group_label := coalesce(v_collection, 'Afternoon mowing');
  elsif v_task_type = 'departure_prep' or v_action in ('pack', 'find', 'prepare') then
    v_release := time '16:00'; v_close := time '20:00'; v_nudge := 90; v_group_label := coalesce(v_collection, 'Departure preparation');
  elsif v_task_type like '%clean%' or v_action in ('clean', 'reset') then
    v_release := time '13:00'; v_close := time '17:00'; v_nudge := 90; v_group_label := coalesce(v_collection, 'Afternoon reset');
  else
    v_release := time '10:00'; v_close := time '17:00'; v_nudge := 90;
    v_group_label := coalesce(v_collection, nullif(v_task.metadata ->> 'collection_zone', ''), 'Today''s work');
  end if;

  v_group_key := trim(both '_' from lower(regexp_replace(coalesce(v_group_label, p_task_id::text), '[^a-zA-Z0-9]+', '_', 'g')));
  if v_group_key in ('owner', 'owner_work', 'today_s_work', '') then v_group_key := p_task_id::text; end if;

  return jsonb_build_object(
    'source', 'inferred_v1',
    'releaseTime', to_char(v_release, 'HH24:MI'),
    'closeTime', to_char(v_close, 'HH24:MI'),
    'nudgeMinutes', v_nudge,
    'groupKey', v_group_key || '@' || replace(to_char(v_release, 'HH24:MI'), ':', ''),
    'groupLabel', v_group_label
  );
end;
$function$;

revoke all on function atlas.task_notification_category_policy_v1(text) from public, anon, authenticated;
revoke all on function atlas.task_notification_local_timestamp_v1(date, time without time zone, text) from public, anon, authenticated;
revoke all on function atlas.task_notification_profile_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.task_notification_category_policy_v1(text) to service_role;
grant execute on function atlas.task_notification_local_timestamp_v1(date, time without time zone, text) to service_role;
grant execute on function atlas.task_notification_profile_v1(uuid) to service_role;

comment on table atlas.task_notification_plans is
  'Optional task-specific notification timing overrides. Due date, process readiness, and lockscreen delivery remain separate truths.';
comment on table atlas.task_notification_moments is
  'Idempotent lockscreen moments generated from assigned task work dates, action windows, and user preference policy.';
comment on function atlas.task_notification_category_policy_v1(text) is
  'Role-aware required and optional notification categories. Required work-delivery categories cannot be disabled inside Atlas.';

do $postcondition$
declare
  v_constraint text;
  v_anon_count integer;
begin
  select pg_get_constraintdef(oid) into v_constraint
  from pg_constraint
  where conrelid = 'atlas.notification_outbox'::regclass
    and conname = 'notification_outbox_category_check';

  select count(*)::integer into v_anon_count
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'atlas'
    and routine.proname in (
      'task_notification_category_policy_v1',
      'task_notification_local_timestamp_v1',
      'task_notification_profile_v1'
    )
    and has_function_privilege('anon', routine.oid, 'EXECUTE');

  if v_constraint not like '%day_plan%'
    or v_constraint not like '%window_closing%'
    or v_anon_count <> 0
  then
    raise exception 'Task notification plan foundation postcondition failed.';
  end if;
end;
$postcondition$;

commit;
