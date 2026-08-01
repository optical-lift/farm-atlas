begin;

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
    where id = v_moment.membership_id and active;

    if v_membership.id is null then
      update atlas.task_notification_moments
      set status = 'skipped', skipped_at = now(), skip_reason = 'membership_inactive', updated_at = now()
      where id = v_moment.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_preferences
    from atlas.notification_preferences
    where farm_id = v_moment.farm_id and user_id = v_moment.user_id;

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

revoke all on function atlas.dispatch_task_notification_moments_v1(timestamptz, integer) from public, anon, authenticated;
revoke all on function atlas.task_notification_clock_tick_v1(timestamptz) from public, anon, authenticated;
grant execute on function atlas.dispatch_task_notification_moments_v1(timestamptz, integer) to service_role;
grant execute on function atlas.task_notification_clock_tick_v1(timestamptz) to service_role;

comment on function atlas.task_notification_clock_tick_v1(timestamptz) is
  'Five-minute task-delivery clock. Ensures today/tomorrow schedules and dispatches due lockscreen moments without creating Bell history.';

do $postcondition$
declare
  v_anon_count integer;
begin
  select count(*)::integer into v_anon_count
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'atlas'
    and routine.proname in ('dispatch_task_notification_moments_v1', 'task_notification_clock_tick_v1')
    and has_function_privilege('anon', routine.oid, 'EXECUTE');

  if v_anon_count <> 0 then
    raise exception 'Task notification dispatch postcondition failed.';
  end if;
end;
$postcondition$;

commit;
