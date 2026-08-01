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
    farm_id,
    user_id,
    work_date,
    moment_kind,
    group_key
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
  if v_task.id is null then
    return null;
  end if;

  select * into v_plan
  from atlas.task_notification_plans
  where task_id = p_task_id
    and active;

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
    v_release := time '19:00';
    v_close := time '20:30';
    v_nudge := 35;
    v_group_label := 'Trash to the street';
  elsif v_action = 'harvest' or v_task_type like '%harvest%' then
    v_release := time '06:30';
    v_close := time '09:00';
    v_nudge := 45;
    v_group_label := coalesce(v_collection, 'Morning harvest');
  elsif v_action in ('spray', 'respray') or v_task_type like '%spray%' then
    v_release := time '07:30';
    v_close := time '10:30';
    v_nudge := 60;
    v_group_label := coalesce(v_collection, 'Morning spraying');
  elsif v_action in ('weed', 'weeding') or v_task_type like '%weed%' then
    v_release := time '08:00';
    v_close := time '11:30';
    v_nudge := 60;
    v_group_label := coalesce(v_collection, 'Morning weeding');
  elsif v_action in ('sow', 'transplant', 'plant') or v_task_type in ('sowing', 'transplanting') then
    v_release := time '09:00';
    v_close := time '13:00';
    v_nudge := 60;
    v_group_label := coalesce(v_collection, 'Morning planting');
  elsif v_action in ('call', 'send', 'order', 'coordinate', 'network', 'email')
     or v_task_type in ('marketing', 'coordination', 'purchasing', 'owner_procurement') then
    v_release := case when coalesce(v_collection, '') = 'Saturday Purchases' then time '11:30' else time '10:00' end;
    v_close := case when coalesce(v_collection, '') = 'Saturday Purchases' then time '17:00' else time '15:00' end;
    v_nudge := 90;
    v_group_label := coalesce(v_collection, 'Calls and orders');
  elsif v_action = 'mow' or v_task_type like '%mow%' then
    v_release := time '15:00';
    v_close := time '18:00';
    v_nudge := 75;
    v_group_label := coalesce(v_collection, 'Afternoon mowing');
  elsif v_task_type = 'departure_prep' or v_action in ('pack', 'find', 'prepare') then
    v_release := time '16:00';
    v_close := time '20:00';
    v_nudge := 90;
    v_group_label := coalesce(v_collection, 'Departure preparation');
  elsif v_task_type like '%clean%' or v_action in ('clean', 'reset') then
    v_release := time '13:00';
    v_close := time '17:00';
    v_nudge := 90;
    v_group_label := coalesce(v_collection, 'Afternoon reset');
  else
    v_release := time '10:00';
    v_close := time '17:00';
    v_nudge := 90;
    v_group_label := coalesce(v_collection, nullif(v_task.metadata ->> 'collection_zone', ''), 'Today''s work');
  end if;

  v_group_key := lower(regexp_replace(coalesce(v_group_label, p_task_id::text), '[^a-zA-Z0-9]+', '_', 'g'));
  v_group_key := trim(both '_' from v_group_key);
  if v_group_key in ('owner', 'owner_work', 'today_s_work', '') then
    v_group_key := p_task_id::text;
  end if;

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

create or replace function atlas.upsert_task_notification_moment_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_user_id uuid,
  p_work_date date,
  p_moment_kind text,
  p_category text,
  p_group_key text,
  p_scheduled_for timestamptz,
  p_required boolean,
  p_task_ids uuid[],
  p_title text,
  p_body text,
  p_deep_link text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_id uuid;
begin
  insert into atlas.task_notification_moments(
    farm_id, membership_id, user_id, work_date, moment_kind, category,
    group_key, scheduled_for, required, task_ids, title, body, deep_link, metadata
  ) values (
    p_farm_id, p_membership_id, p_user_id, p_work_date, p_moment_kind, p_category,
    p_group_key, p_scheduled_for, coalesce(p_required, false), coalesce(p_task_ids, '{}'::uuid[]),
    left(p_title, 140), left(p_body, 500), coalesce(nullif(p_deep_link, ''), '/day'),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (farm_id, user_id, work_date, moment_kind, group_key)
  do update set
    membership_id = excluded.membership_id,
    scheduled_for = excluded.scheduled_for,
    required = excluded.required,
    task_ids = excluded.task_ids,
    title = excluded.title,
    body = excluded.body,
    deep_link = excluded.deep_link,
    metadata = atlas.task_notification_moments.metadata || excluded.metadata,
    updated_at = now()
  where atlas.task_notification_moments.status = 'planned'
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from atlas.task_notification_moments
    where farm_id = p_farm_id
      and user_id = p_user_id
      and work_date = p_work_date
      and moment_kind = p_moment_kind
      and group_key = p_group_key;
  end if;

  return v_id;
end;
$function$;

create or replace function atlas.ensure_task_notification_moments_v1(
  p_farm_id uuid,
  p_work_date date,
  p_user_id uuid default null,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_member record;
  v_group record;
  v_zone text;
  v_local_today date;
  v_local_time time;
  v_task_ids uuid[];
  v_task_count integer;
  v_first_title text;
  v_first_release time;
  v_moment_count integer := 0;
  v_scheduled timestamptz;
  v_deep_link text;
  v_required text[];
begin
  if p_farm_id is null or p_work_date is null then
    raise exception 'Farm and work date are required.' using errcode = '22023';
  end if;

  for v_member in
    select membership.id as membership_id, membership.user_id, membership.role,
           coalesce(nullif(preference.time_zone, ''), nullif(subscription.time_zone, ''), 'America/Chicago') as time_zone
    from atlas.farm_memberships membership
    left join atlas.notification_preferences preference
      on preference.farm_id = membership.farm_id
     and preference.user_id = membership.user_id
    left join lateral (
      select active_subscription.time_zone
      from atlas.push_subscriptions active_subscription
      where active_subscription.farm_id = membership.farm_id
        and active_subscription.user_id = membership.user_id
        and active_subscription.status = 'active'
      order by active_subscription.last_seen_at desc nulls last, active_subscription.created_at desc
      limit 1
    ) subscription on true
    where membership.farm_id = p_farm_id
      and membership.active
      and membership.user_id is not null
      and (p_user_id is null or membership.user_id = p_user_id)
    order by membership.role, membership.created_at
  loop
    v_zone := v_member.time_zone;
    if not exists (select 1 from pg_timezone_names where name = v_zone) then
      v_zone := 'America/Chicago';
    end if;
    v_local_today := (p_as_of at time zone v_zone)::date;
    v_local_time := (p_as_of at time zone v_zone)::time;
    v_required := array(select jsonb_array_elements_text(atlas.task_notification_category_policy_v1(v_member.role) -> 'requiredCategories'));

    select array_agg(task.id order by task.created_at, task.id),
           count(*)::integer,
           min(regexp_replace(task.title, '^(Owner|Anna|Marshall) — ', '', 'i'))
    into v_task_ids, v_task_count, v_first_title
    from atlas.tasks task
    where task.farm_id = p_farm_id
      and task.task_scope = 'farm_operation'
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = p_work_date
      and (
        task.assigned_membership_id = v_member.membership_id
        or (task.assigned_membership_id is null and task.assigned_user_id = v_member.user_id)
      );

    if coalesce(v_task_count, 0) = 0 then
      continue;
    end if;

    select min((atlas.task_notification_profile_v1(task.id) ->> 'releaseTime')::time)
    into v_first_release
    from atlas.tasks task
    where task.id = any(v_task_ids);

    if p_work_date > v_local_today or v_local_time < time '10:00' then
      v_scheduled := atlas.task_notification_local_timestamp_v1(p_work_date, time '07:00', v_zone);
      perform atlas.upsert_task_notification_moment_v1(
        p_farm_id, v_member.membership_id, v_member.user_id, p_work_date,
        'day_plan', 'day_plan', 'day', v_scheduled,
        'day_plan' = any(v_required), v_task_ids,
        to_char(p_work_date, 'FMDay') || ' at Elm',
        v_task_count::text || ' tasks today. Start with ' || coalesce(v_first_title, 'the first task') || '. Atlas will bring the rest forward through the day.',
        '/day?date=' || p_work_date::text,
        jsonb_build_object('timeZone', v_zone, 'generatedBy', 'daily_task_notification_clock_v1')
      );
      v_moment_count := v_moment_count + 1;
    end if;

    for v_group in
      select
        profile ->> 'groupKey' as group_key,
        max(profile ->> 'groupLabel') as group_label,
        (profile ->> 'releaseTime')::time as release_time,
        max(nullif(profile ->> 'closeTime', ''))::time as close_time,
        max(coalesce((profile ->> 'nudgeMinutes')::integer, 90)) as nudge_minutes,
        array_agg(task.id order by task.created_at, task.id) as task_ids,
        count(*)::integer as task_count,
        min(regexp_replace(task.title, '^(Owner|Anna|Marshall) — ', '', 'i')) as first_title,
        string_agg(regexp_replace(task.title, '^(Owner|Anna|Marshall) — ', '', 'i'), ' · ' order by task.created_at, task.id) as task_names
      from atlas.tasks task
      cross join lateral (
        select atlas.task_notification_profile_v1(task.id) as profile
      ) classified
      where task.id = any(v_task_ids)
      group by profile ->> 'groupKey', (profile ->> 'releaseTime')::time
      order by (profile ->> 'releaseTime')::time, profile ->> 'groupKey'
    loop
      v_scheduled := atlas.task_notification_local_timestamp_v1(p_work_date, v_group.release_time, v_zone);
      v_deep_link := case
        when v_group.task_count = 1 then '/task-focus/' || v_group.task_ids[1]::text
        else '/day?date=' || p_work_date::text
      end;

      perform atlas.upsert_task_notification_moment_v1(
        p_farm_id, v_member.membership_id, v_member.user_id, p_work_date,
        'work_window', 'work_window', v_group.group_key, v_scheduled,
        'work_window' = any(v_required), v_group.task_ids,
        'Do now · ' || coalesce(v_group.group_label, 'Today''s work'),
        case when v_group.task_count = 1
          then v_group.first_title
          else v_group.task_count::text || ' tasks: ' || left(v_group.task_names, 440)
        end,
        v_deep_link,
        jsonb_build_object('timeZone', v_zone, 'releaseTime', v_group.release_time, 'generatedBy', 'daily_task_notification_clock_v1')
      );
      v_moment_count := v_moment_count + 1;

      if v_group.nudge_minutes is not null then
        perform atlas.upsert_task_notification_moment_v1(
          p_farm_id, v_member.membership_id, v_member.user_id, p_work_date,
          'task_nudge', 'task_nudge', v_group.group_key,
          v_scheduled + make_interval(mins => v_group.nudge_minutes),
          'task_nudge' = any(v_required), v_group.task_ids,
          'Still waiting · ' || coalesce(v_group.group_label, 'Today''s work'),
          case when v_group.task_count = 1
            then v_group.first_title || ' has not been touched yet.'
            else v_group.task_count::text || ' tasks are still waiting: ' || left(v_group.task_names, 410)
          end,
          v_deep_link,
          jsonb_build_object('timeZone', v_zone, 'initialScheduledFor', v_scheduled, 'generatedBy', 'daily_task_notification_clock_v1')
        );
        v_moment_count := v_moment_count + 1;
      end if;

      if v_group.close_time is not null then
        perform atlas.upsert_task_notification_moment_v1(
          p_farm_id, v_member.membership_id, v_member.user_id, p_work_date,
          'window_closing', 'window_closing', v_group.group_key,
          atlas.task_notification_local_timestamp_v1(p_work_date, v_group.close_time, v_zone),
          'window_closing' = any(v_required), v_group.task_ids,
          coalesce(v_group.group_label, 'Work') || ' window is closing',
          case when v_group.task_count = 1
            then 'Finish ' || v_group.first_title || ' now or record what is blocking it.'
            else v_group.task_count::text || ' tasks are still open. Finish them now or record what is blocking the work.'
          end,
          v_deep_link,
          jsonb_build_object('timeZone', v_zone, 'closeTime', v_group.close_time, 'generatedBy', 'daily_task_notification_clock_v1')
        );
        v_moment_count := v_moment_count + 1;
      end if;
    end loop;

    perform atlas.upsert_task_notification_moment_v1(
      p_farm_id, v_member.membership_id, v_member.user_id, p_work_date,
      'day_wrap', 'day_wrap', 'day',
      atlas.task_notification_local_timestamp_v1(p_work_date, time '19:30', v_zone),
      'day_wrap' = any(v_required), v_task_ids,
      'Before you stop',
      'Open Atlas to finish, move, or record a blocker for anything still open today.',
      '/day?date=' || p_work_date::text,
      jsonb_build_object('timeZone', v_zone, 'generatedBy', 'daily_task_notification_clock_v1')
    );
    v_moment_count := v_moment_count + 1;

    if v_member.role in ('owner', 'manager') and p_work_date > v_local_today then
      perform atlas.upsert_task_notification_moment_v1(
        p_farm_id, v_member.membership_id, v_member.user_id, p_work_date,
        'tomorrow_covered', 'tomorrow_covered', 'tomorrow',
        atlas.task_notification_local_timestamp_v1(p_work_date - 1, time '20:30', v_zone),
        'tomorrow_covered' = any(v_required), v_task_ids,
        'Tomorrow is covered',
        v_task_count::text || ' tasks are staged across the day. First reminder: ' || to_char(v_first_release, 'FMHH12:MI AM') || '.',
        '/day?date=' || p_work_date::text,
        jsonb_build_object('timeZone', v_zone, 'generatedBy', 'daily_task_notification_clock_v1')
      );
      v_moment_count := v_moment_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'task_notification_schedule_v1',
    'farmId', p_farm_id,
    'workDate', p_work_date,
    'momentsEnsured', v_moment_count
  );
end;
$function$;

create or replace function atlas.task_notification_coverage_v1(
  p_farm_id uuid,
  p_user_id uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_membership_id uuid;
  v_task_count integer;
  v_uncovered integer;
  v_moment_count integer;
  v_first_at timestamptz;
  v_subscription boolean;
begin
  select membership.id into v_membership_id
  from atlas.farm_memberships membership
  where membership.farm_id = p_farm_id
    and membership.user_id = p_user_id
    and membership.active
  order by membership.created_at
  limit 1;

  if v_membership_id is null then
    return jsonb_build_object('covered', false, 'reason', 'active_membership_required');
  end if;

  select count(*)::integer into v_task_count
  from atlas.tasks task
  where task.farm_id = p_farm_id
    and task.task_scope = 'farm_operation'
    and task.parent_task_id is null
    and task.status in ('open', 'blocked')
    and task.due_date = p_work_date
    and (
      task.assigned_membership_id = v_membership_id
      or (task.assigned_membership_id is null and task.assigned_user_id = p_user_id)
    );

  select count(*)::integer, min(moment.scheduled_for)
  into v_moment_count, v_first_at
  from atlas.task_notification_moments moment
  where moment.farm_id = p_farm_id
    and moment.user_id = p_user_id
    and moment.work_date = p_work_date
    and moment.moment_kind in ('day_plan', 'work_window', 'window_closing')
    and moment.status in ('planned', 'sent');

  select count(*)::integer into v_uncovered
  from atlas.tasks task
  where task.farm_id = p_farm_id
    and task.task_scope = 'farm_operation'
    and task.parent_task_id is null
    and task.status in ('open', 'blocked')
    and task.due_date = p_work_date
    and (
      task.assigned_membership_id = v_membership_id
      or (task.assigned_membership_id is null and task.assigned_user_id = p_user_id)
    )
    and not exists (
      select 1
      from atlas.task_notification_moments moment
      where moment.farm_id = p_farm_id
        and moment.user_id = p_user_id
        and moment.work_date = p_work_date
        and moment.moment_kind = 'work_window'
        and moment.status in ('planned', 'sent')
        and task.id = any(moment.task_ids)
    );

  select exists (
    select 1 from atlas.push_subscriptions subscription
    where subscription.farm_id = p_farm_id
      and subscription.user_id = p_user_id
      and subscription.status = 'active'
  ) into v_subscription;

  return jsonb_build_object(
    'contractVersion', 'task_notification_coverage_v1',
    'workDate', p_work_date,
    'taskCount', coalesce(v_task_count, 0),
    'momentCount', coalesce(v_moment_count, 0),
    'uncoveredTaskCount', coalesce(v_uncovered, 0),
    'firstNotificationAt', v_first_at,
    'deviceConnected', v_subscription,
    'covered', coalesce(v_uncovered, 0) = 0 and (coalesce(v_task_count, 0) = 0 or v_subscription)
  );
end;
$function$;

create or replace function atlas.dispatch_task_notification_moments_v1(
  p_as_of timestamptz default now(),
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_moment atlas.task_notification_moments%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_preferences atlas.notification_preferences%rowtype;
  v_policy jsonb;
  v_required boolean;
  v_categories jsonb;
  v_open_ids uuid[];
  v_open_count integer;
  v_transition_count integer;
  v_outbox_id uuid;
  v_dedupe text;
  v_not_before timestamptz;
  v_zone text;
  v_moment_count integer;
  v_first_at timestamptz;
  v_title text;
  v_body text;
  v_sent integer := 0;
  v_skipped integer := 0;
begin
  for v_moment in
    select *
    from atlas.task_notification_moments moment
    where moment.status = 'planned'
      and moment.scheduled_for <= coalesce(p_as_of, now())
    order by moment.scheduled_for, moment.id
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update skip locked
  loop
    select * into v_membership
    from atlas.farm_memberships
    where id = v_moment.membership_id
      and active;

    if v_membership.id is null then
      update atlas.task_notification_moments
      set status = 'skipped', skipped_at = now(), skip_reason = 'membership_inactive', updated_at = now()
      where id = v_moment.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_preferences
    from atlas.notification_preferences
    where farm_id = v_moment.farm_id
      and user_id = v_moment.user_id;

    v_policy := atlas.task_notification_category_policy_v1(v_membership.role);
    v_required := v_moment.category in (
      select jsonb_array_elements_text(v_policy -> 'requiredCategories')
    );
    v_categories := atlas.web_push_default_categories_v1() || coalesce(v_preferences.categories, '{}'::jsonb);

    if not v_required and (
      coalesce(v_preferences.enabled, true) is false
      or coalesce((v_categories ->> v_moment.category)::boolean, true) is false
    ) then
      update atlas.task_notification_moments
      set status = 'skipped', skipped_at = now(), skip_reason = 'optional_category_disabled', updated_at = now()
      where id = v_moment.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if not exists (
      select 1 from atlas.push_subscriptions subscription
      where subscription.farm_id = v_moment.farm_id
        and subscription.user_id = v_moment.user_id
        and subscription.status = 'active'
    ) then
      update atlas.task_notification_moments
      set status = 'skipped', skipped_at = now(), skip_reason = 'no_active_push_subscription', updated_at = now()
      where id = v_moment.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select array_agg(task.id order by task.created_at, task.id), count(*)::integer
    into v_open_ids, v_open_count
    from atlas.tasks task
    where task.id = any(v_moment.task_ids)
      and task.farm_id = v_moment.farm_id
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = v_moment.work_date
      and (
        task.assigned_membership_id = v_moment.membership_id
        or (task.assigned_membership_id is null and task.assigned_user_id = v_moment.user_id)
      );

    if coalesce(v_open_count, 0) = 0 then
      update atlas.task_notification_moments
      set status = 'skipped', skipped_at = now(), skip_reason = 'work_already_resolved_or_moved', updated_at = now()
      where id = v_moment.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_moment.moment_kind = 'task_nudge' then
      select count(*)::integer into v_transition_count
      from atlas.task_transitions transition
      where transition.task_id = any(v_open_ids)
        and transition.created_at >= coalesce(
          (select initial.scheduled_for
           from atlas.task_notification_moments initial
           where initial.farm_id = v_moment.farm_id
             and initial.user_id = v_moment.user_id
             and initial.work_date = v_moment.work_date
             and initial.moment_kind = 'work_window'
             and initial.group_key = v_moment.group_key),
          v_moment.scheduled_for - interval '2 hours'
        );

      if coalesce(v_transition_count, 0) > 0 then
        update atlas.task_notification_moments
        set status = 'skipped', skipped_at = now(), skip_reason = 'work_was_touched', updated_at = now()
        where id = v_moment.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    v_title := v_moment.title;
    v_body := v_moment.body;
    v_zone := coalesce(nullif(v_preferences.time_zone, ''), v_moment.metadata ->> 'timeZone', 'America/Chicago');
    if not exists (select 1 from pg_timezone_names where name = v_zone) then
      v_zone := 'America/Chicago';
    end if;

    if v_moment.moment_kind = 'tomorrow_covered' then
      select count(*)::integer, min(scheduled_for)
      into v_moment_count, v_first_at
      from atlas.task_notification_moments scheduled
      where scheduled.farm_id = v_moment.farm_id
        and scheduled.user_id = v_moment.user_id
        and scheduled.work_date = v_moment.work_date
        and scheduled.moment_kind in ('day_plan', 'work_window', 'window_closing')
        and scheduled.status in ('planned', 'sent');

      v_title := 'Tomorrow is covered';
      v_body := v_open_count::text || ' tasks are staged across ' || coalesce(v_moment_count, 0)::text ||
        ' notification moments. First reminder: ' ||
        to_char(v_first_at at time zone v_zone, 'FMHH12:MI AM') || '.';
    elsif v_moment.moment_kind = 'day_wrap' then
      v_body := v_open_count::text || ' tasks are still open today. Finish, move, or record a blocker before you stop.';
    end if;

    v_dedupe := 'task-moment:' || v_moment.id::text;
    v_not_before := case
      when v_required then coalesce(p_as_of, now())
      else atlas.notification_next_available_at_v1(v_moment.user_id, v_moment.farm_id, coalesce(p_as_of, now()))
    end;

    v_outbox_id := atlas.enqueue_direct_push_v1(
      v_moment.farm_id,
      v_moment.user_id,
      v_moment.category,
      v_title,
      v_body,
      v_moment.deep_link,
      v_dedupe,
      case when v_moment.moment_kind = 'window_closing' then 'attention' else 'normal' end,
      v_not_before,
      jsonb_build_object(
        'taskNotificationMomentId', v_moment.id,
        'workDate', v_moment.work_date,
        'momentKind', v_moment.moment_kind,
        'groupKey', v_moment.group_key,
        'taskIds', to_jsonb(v_open_ids),
        'required', v_required
      )
    );

    if v_outbox_id is null then
      select id into v_outbox_id
      from atlas.notification_outbox
      where dedupe_key = v_dedupe;
    end if;

    update atlas.task_notification_moments
    set status = 'sent', sent_at = now(), outbox_id = v_outbox_id,
        task_ids = v_open_ids, title = v_title, body = v_body, updated_at = now()
    where id = v_moment.id;
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'task_notification_dispatch_v1',
    'asOf', coalesce(p_as_of, now()),
    'sent', v_sent,
    'skipped', v_skipped
  );
end;
$function$;

create or replace function atlas.task_notification_clock_tick_v1(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_farm record;
  v_today date;
  v_ensured integer := 0;
  v_dispatch jsonb;
begin
  for v_farm in
    select distinct membership.farm_id
    from atlas.farm_memberships membership
    where membership.active
    order by membership.farm_id
  loop
    v_today := (coalesce(p_as_of, now()) at time zone 'America/Chicago')::date;
    perform atlas.ensure_task_notification_moments_v1(v_farm.farm_id, v_today, null, p_as_of);
    perform atlas.ensure_task_notification_moments_v1(v_farm.farm_id, v_today + 1, null, p_as_of);
    v_ensured := v_ensured + 2;
  end loop;

  v_dispatch := atlas.dispatch_task_notification_moments_v1(p_as_of, 500);
  return jsonb_build_object(
    'contractVersion', 'task_notification_clock_tick_v1',
    'asOf', coalesce(p_as_of, now()),
    'schedulesEnsured', v_ensured,
    'dispatch', v_dispatch
  );
end;
$function$;

create or replace function atlas.update_notification_preferences_v1(
  p_farm_id uuid,
  p_enabled boolean,
  p_categories jsonb,
  p_quiet_start time without time zone,
  p_quiet_end time without time zone,
  p_time_zone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_zone text := coalesce(nullif(btrim(p_time_zone), ''), 'America/Chicago');
  v_categories jsonb := atlas.web_push_default_categories_v1();
  v_policy jsonb;
  v_key text;
  v_required_key text;
  v_allowed text[] := array[
    'rhythm_warning', 'rhythm_due', 'rhythm_failure', 'unlock', 'owner_decision',
    'other_player_result', 'dependency_ready', 'tomorrow_covered', 'day_plan',
    'work_window', 'task_nudge', 'window_closing', 'day_wrap'
  ];
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  select membership.role into v_role
  from atlas.farm_memberships membership
  where membership.farm_id = p_farm_id
    and membership.user_id = v_user_id
    and membership.active
  order by membership.created_at
  limit 1;

  if v_role is null then
    raise exception 'An active farm membership is required.' using errcode = '42501';
  end if;

  if (p_quiet_start is null) <> (p_quiet_end is null) then
    raise exception 'Quiet hours require both a start and end time.' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'America/Chicago';
  end if;

  if jsonb_typeof(p_categories) = 'object' then
    foreach v_key in array v_allowed loop
      if jsonb_typeof(p_categories -> v_key) = 'boolean' then
        v_categories := jsonb_set(v_categories, array[v_key], p_categories -> v_key, true);
      end if;
    end loop;
  end if;

  v_policy := atlas.task_notification_category_policy_v1(v_role);
  for v_required_key in select jsonb_array_elements_text(v_policy -> 'requiredCategories') loop
    v_categories := jsonb_set(v_categories, array[v_required_key], 'true'::jsonb, true);
  end loop;

  insert into atlas.notification_preferences(
    user_id, farm_id, enabled, categories, quiet_start, quiet_end, time_zone, updated_at
  ) values (
    v_user_id, p_farm_id, true, v_categories, p_quiet_start, p_quiet_end, v_zone, now()
  )
  on conflict(user_id, farm_id) do update set
    enabled = true,
    categories = excluded.categories,
    quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end,
    time_zone = excluded.time_zone,
    updated_at = now();

  return jsonb_build_object(
    'enabled', true,
    'categories', v_categories,
    'quietStart', p_quiet_start,
    'quietEnd', p_quiet_end,
    'timeZone', v_zone,
    'categoryPolicy', v_policy
  );
end;
$function$;

create or replace function atlas.web_push_setup_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_role text;
  v_public_key text;
  v_preferences atlas.notification_preferences%rowtype;
  v_subscriptions jsonb;
  v_categories jsonb;
  v_policy jsonb;
  v_required_key text;
  v_tomorrow date;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  select membership.id, membership.role
  into v_membership_id, v_role
  from atlas.farm_memberships membership
  where membership.farm_id = p_farm_id
    and membership.user_id = v_user_id
    and membership.active
  order by membership.created_at
  limit 1;

  if v_membership_id is null then
    raise exception 'An active farm membership is required.' using errcode = '42501';
  end if;

  select vapid_public_key into v_public_key
  from atlas.web_push_settings
  where singleton;

  select * into v_preferences
  from atlas.notification_preferences
  where user_id = v_user_id
    and farm_id = p_farm_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', subscription.id,
    'endpointHash', subscription.endpoint_hash,
    'deviceLabel', subscription.device_label,
    'status', subscription.status,
    'lastSeenAt', subscription.last_seen_at,
    'lastSuccessAt', subscription.last_success_at
  ) order by subscription.created_at desc), '[]'::jsonb)
  into v_subscriptions
  from atlas.push_subscriptions subscription
  where subscription.user_id = v_user_id
    and subscription.farm_id = p_farm_id
    and subscription.status = 'active';

  v_categories := atlas.web_push_default_categories_v1() || coalesce(v_preferences.categories, '{}'::jsonb);
  v_policy := atlas.task_notification_category_policy_v1(v_role);
  for v_required_key in select jsonb_array_elements_text(v_policy -> 'requiredCategories') loop
    v_categories := jsonb_set(v_categories, array[v_required_key], 'true'::jsonb, true);
  end loop;
  v_tomorrow := ((now() at time zone coalesce(nullif(v_preferences.time_zone, ''), 'America/Chicago'))::date + 1);

  return jsonb_build_object(
    'contractVersion', 'atlas_web_push_v2',
    'farmId', p_farm_id,
    'role', v_role,
    'vapidPublicKey', v_public_key,
    'subscriptions', v_subscriptions,
    'preferences', jsonb_build_object(
      'enabled', true,
      'categories', v_categories,
      'quietStart', v_preferences.quiet_start,
      'quietEnd', v_preferences.quiet_end,
      'timeZone', coalesce(v_preferences.time_zone, 'America/Chicago')
    ),
    'categoryPolicy', v_policy,
    'tomorrowCoverage', atlas.task_notification_coverage_v1(p_farm_id, v_user_id, v_tomorrow)
  );
end;
$function$;

update atlas.notification_preferences preference
set enabled = true,
    categories = atlas.web_push_default_categories_v1()
      || coalesce(preference.categories, '{}'::jsonb)
      || jsonb_build_object(
        'work_window', true,
        'window_closing', true,
        'dependency_ready', true,
        'rhythm_due', true,
        'rhythm_failure', true,
        'unlock', true,
        'owner_decision', true
      ),
    updated_at = now();

revoke all on function atlas.task_notification_category_policy_v1(text) from public, anon, authenticated;
revoke all on function atlas.task_notification_local_timestamp_v1(date, time without time zone, text) from public, anon, authenticated;
revoke all on function atlas.task_notification_profile_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.upsert_task_notification_moment_v1(uuid, uuid, uuid, date, text, text, text, timestamptz, boolean, uuid[], text, text, text, jsonb) from public, anon, authenticated;
revoke all on function atlas.ensure_task_notification_moments_v1(uuid, date, uuid, timestamptz) from public, anon, authenticated;
revoke all on function atlas.task_notification_coverage_v1(uuid, uuid, date) from public, anon, authenticated;
revoke all on function atlas.dispatch_task_notification_moments_v1(timestamptz, integer) from public, anon, authenticated;
revoke all on function atlas.task_notification_clock_tick_v1(timestamptz) from public, anon, authenticated;

grant execute on function atlas.task_notification_category_policy_v1(text) to service_role;
grant execute on function atlas.task_notification_local_timestamp_v1(date, time without time zone, text) to service_role;
grant execute on function atlas.task_notification_profile_v1(uuid) to service_role;
grant execute on function atlas.upsert_task_notification_moment_v1(uuid, uuid, uuid, date, text, text, text, timestamptz, boolean, uuid[], text, text, text, jsonb) to service_role;
grant execute on function atlas.ensure_task_notification_moments_v1(uuid, date, uuid, timestamptz) to service_role;
grant execute on function atlas.task_notification_coverage_v1(uuid, uuid, date) to service_role;
grant execute on function atlas.dispatch_task_notification_moments_v1(timestamptz, integer) to service_role;
grant execute on function atlas.task_notification_clock_tick_v1(timestamptz) to service_role;

revoke all on function atlas.web_push_setup_v1(uuid) from public, anon;
revoke all on function atlas.update_notification_preferences_v1(uuid, boolean, jsonb, time without time zone, time without time zone, text) from public, anon;
grant execute on function atlas.web_push_setup_v1(uuid) to authenticated, service_role;
grant execute on function atlas.update_notification_preferences_v1(uuid, boolean, jsonb, time without time zone, time without time zone, text) to authenticated, service_role;

do $cron$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'atlas-task-notification-clock-v1';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'atlas-task-notification-clock-v1',
    '*/5 * * * *',
    'select atlas.task_notification_clock_tick_v1();'
  );
end;
$cron$;

comment on table atlas.task_notification_plans is
  'Optional task-specific notification timing overrides. Due date, process readiness, and lockscreen delivery remain separate truths.';
comment on table atlas.task_notification_moments is
  'Idempotent lockscreen moments generated from assigned task work dates, action windows, and user preference policy.';
comment on function atlas.task_notification_clock_tick_v1(timestamptz) is
  'Five-minute task-delivery clock. Ensures today/tomorrow schedules and dispatches due lockscreen moments without creating Bell history.';
comment on function atlas.task_notification_category_policy_v1(text) is
  'Role-aware required and optional notification categories. Required work-delivery categories cannot be disabled inside Atlas.';

perform atlas.task_notification_clock_tick_v1(now());

do $postcondition$
declare
  v_constraint text;
  v_cron_active boolean;
  v_anon_count integer;
begin
  select pg_get_constraintdef(oid) into v_constraint
  from pg_constraint
  where conrelid = 'atlas.notification_outbox'::regclass
    and conname = 'notification_outbox_category_check';

  select active into v_cron_active
  from cron.job
  where jobname = 'atlas-task-notification-clock-v1';

  select count(*)::integer into v_anon_count
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'atlas'
    and routine.proname in (
      'task_notification_category_policy_v1',
      'task_notification_local_timestamp_v1',
      'task_notification_profile_v1',
      'upsert_task_notification_moment_v1',
      'ensure_task_notification_moments_v1',
      'task_notification_coverage_v1',
      'dispatch_task_notification_moments_v1',
      'task_notification_clock_tick_v1'
    )
    and has_function_privilege('anon', routine.oid, 'EXECUTE');

  if v_constraint not like '%day_plan%'
    or v_constraint not like '%window_closing%'
    or coalesce(v_cron_active, false) is not true
    or v_anon_count <> 0
  then
    raise exception 'Daily task notification clock postcondition failed.';
  end if;
end;
$postcondition$;

commit;
