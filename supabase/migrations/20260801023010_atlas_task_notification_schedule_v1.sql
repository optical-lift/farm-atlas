begin;

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
    v_required := array(
      select jsonb_array_elements_text(
        atlas.task_notification_category_policy_v1(v_member.role) -> 'requiredCategories'
      )
    );

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

    if coalesce(v_task_count, 0) = 0 then continue; end if;

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

revoke all on function atlas.upsert_task_notification_moment_v1(uuid, uuid, uuid, date, text, text, text, timestamptz, boolean, uuid[], text, text, text, jsonb) from public, anon, authenticated;
revoke all on function atlas.ensure_task_notification_moments_v1(uuid, date, uuid, timestamptz) from public, anon, authenticated;
revoke all on function atlas.task_notification_coverage_v1(uuid, uuid, date) from public, anon, authenticated;
grant execute on function atlas.upsert_task_notification_moment_v1(uuid, uuid, uuid, date, text, text, text, timestamptz, boolean, uuid[], text, text, text, jsonb) to service_role;
grant execute on function atlas.ensure_task_notification_moments_v1(uuid, date, uuid, timestamptz) to service_role;
grant execute on function atlas.task_notification_coverage_v1(uuid, uuid, date) to service_role;

comment on function atlas.ensure_task_notification_moments_v1(uuid, date, uuid, timestamptz) is
  'Builds one morning plan, grouped work releases, optional untouched nudges, required closing warnings, an optional day wrap, and management tomorrow coverage.';

do $postcondition$
declare
  v_anon_count integer;
begin
  select count(*)::integer into v_anon_count
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'atlas'
    and routine.proname in (
      'upsert_task_notification_moment_v1',
      'ensure_task_notification_moments_v1',
      'task_notification_coverage_v1'
    )
    and has_function_privilege('anon', routine.oid, 'EXECUTE');

  if v_anon_count <> 0 then
    raise exception 'Task notification schedule postcondition failed.';
  end if;
end;
$postcondition$;

commit;
