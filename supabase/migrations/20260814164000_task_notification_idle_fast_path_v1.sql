create or replace function atlas.ensure_task_notification_moments_v1(p_farm_id uuid, p_work_date date, p_user_id uuid default null::uuid, p_as_of timestamp with time zone default now())
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
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
    join lateral (
      select active_subscription.time_zone
      from atlas.push_subscriptions active_subscription
      where active_subscription.farm_id = membership.farm_id
        and active_subscription.user_id = membership.user_id
        and active_subscription.status = 'active'
      order by active_subscription.last_seen_at desc nulls last, active_subscription.created_at desc
      limit 1
    ) subscription on true
    left join atlas.notification_preferences preference
      on preference.farm_id = membership.farm_id
     and preference.user_id = membership.user_id
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

    select array_agg(task.id order by presented.lane_order, presented.selection_rank),
           count(*)::integer,
           min(regexp_replace(task.title, '^(Owner|Anna|Marshall) — ', '', 'i'))
    into v_task_ids, v_task_count, v_first_title
    from atlas.presented_work_rows_v1(p_farm_id, v_member.membership_id, p_work_date) presented
    join atlas.tasks task on task.id = presented.task_id
    where presented.presentation_state in ('presented', 'attention')
      and presented.presentation_reason <> 'owner_review'
      and task.task_scope = 'farm_operation'
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = p_work_date;

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

create or replace function atlas.task_notification_clock_tick_v1(p_as_of timestamp with time zone default now())
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_farm record;
  v_today date;
  v_ensured integer := 0;
  v_refreshed integer := 0;
  v_dispatch jsonb;
  v_audience_count integer := 0;
begin
  select count(distinct (membership.farm_id, membership.user_id))::integer
  into v_audience_count
  from atlas.farm_memberships membership
  join atlas.push_subscriptions subscription
    on subscription.farm_id = membership.farm_id
   and subscription.user_id = membership.user_id
   and subscription.status = 'active'
  where membership.active
    and membership.user_id is not null;

  if coalesce(v_audience_count, 0) = 0 then
    return jsonb_build_object(
      'contractVersion', 'task_notification_clock_tick_v1',
      'asOf', coalesce(p_as_of, now()),
      'audienceCount', 0,
      'idle', true,
      'schedulesEnsured', 0,
      'dayPlansRefreshed', 0,
      'dispatch', jsonb_build_object(
        'contractVersion', 'task_notification_dispatch_v1',
        'asOf', coalesce(p_as_of, now()),
        'sent', 0,
        'skipped', 0
      )
    );
  end if;

  for v_farm in
    select distinct membership.farm_id
    from atlas.farm_memberships membership
    join atlas.push_subscriptions subscription
      on subscription.farm_id = membership.farm_id
     and subscription.user_id = membership.user_id
     and subscription.status = 'active'
    where membership.active
      and membership.user_id is not null
    order by membership.farm_id
  loop
    v_today := (coalesce(p_as_of, now()) at time zone 'America/Chicago')::date;
    perform atlas.ensure_task_notification_moments_v1(v_farm.farm_id, v_today, null, p_as_of);
    perform atlas.ensure_task_notification_moments_v1(v_farm.farm_id, v_today + 1, null, p_as_of);
    v_refreshed := v_refreshed + atlas.refresh_task_notification_day_plan_v1(v_farm.farm_id, v_today, null);
    v_refreshed := v_refreshed + atlas.refresh_task_notification_day_plan_v1(v_farm.farm_id, v_today + 1, null);
    v_ensured := v_ensured + 2;
  end loop;

  v_dispatch := atlas.dispatch_task_notification_moments_v1(p_as_of, 500);
  return jsonb_build_object(
    'contractVersion', 'task_notification_clock_tick_v1',
    'asOf', coalesce(p_as_of, now()),
    'audienceCount', v_audience_count,
    'idle', false,
    'schedulesEnsured', v_ensured,
    'dayPlansRefreshed', v_refreshed,
    'dispatch', v_dispatch
  );
end;
$function$;
