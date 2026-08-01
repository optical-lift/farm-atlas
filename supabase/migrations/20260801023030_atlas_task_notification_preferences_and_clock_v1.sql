begin;

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
  v_zone text;
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
  where user_id = v_user_id and farm_id = p_farm_id;

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

  v_zone := coalesce(nullif(v_preferences.time_zone, ''), 'America/Chicago');
  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'America/Chicago';
  end if;
  v_tomorrow := (now() at time zone v_zone)::date + 1;

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
      'timeZone', v_zone
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

select atlas.task_notification_clock_tick_v1(now());

do $postcondition$
declare
  v_cron_active boolean;
  v_registry_drift integer;
  v_anon_count integer;
begin
  select active into v_cron_active
  from cron.job
  where jobname = 'atlas-task-notification-clock-v1';

  select count(*)::integer into v_registry_drift
  from atlas.authenticated_rpc_registry_drift_v1();

  select count(*)::integer into v_anon_count
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'atlas'
    and has_function_privilege('anon', routine.oid, 'EXECUTE');

  if coalesce(v_cron_active, false) is not true
    or v_registry_drift <> 0
    or v_anon_count <> 0
  then
    raise exception 'Task notification preference and clock postcondition failed.';
  end if;
end;
$postcondition$;

commit;
