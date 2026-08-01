begin;

create or replace function atlas.refresh_task_notification_day_plan_v1(
  p_farm_id uuid,
  p_work_date date,
  p_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_moment record;
  v_first_title text;
  v_task_count integer;
  v_updated integer := 0;
begin
  for v_moment in
    select moment.id, moment.task_ids
    from atlas.task_notification_moments moment
    where moment.farm_id = p_farm_id
      and moment.work_date = p_work_date
      and moment.moment_kind = 'day_plan'
      and moment.status = 'planned'
      and (p_user_id is null or moment.user_id = p_user_id)
    for update
  loop
    select
      count(*)::integer,
      (
        select regexp_replace(first_task.title, '^(Owner|Anna|Marshall) — ', '', 'i')
        from atlas.tasks first_task
        where first_task.id = any(v_moment.task_ids)
          and first_task.parent_task_id is null
          and first_task.status in ('open', 'blocked')
          and first_task.due_date = p_work_date
        order by
          (atlas.task_notification_profile_v1(first_task.id) ->> 'releaseTime')::time,
          first_task.created_at,
          first_task.id
        limit 1
      )
    into v_task_count, v_first_title
    from atlas.tasks task
    where task.id = any(v_moment.task_ids)
      and task.parent_task_id is null
      and task.status in ('open', 'blocked')
      and task.due_date = p_work_date;

    if coalesce(v_task_count, 0) = 0 then
      continue;
    end if;

    update atlas.task_notification_moments
    set body = v_task_count::text || ' tasks today. Start with ' ||
          coalesce(v_first_title, 'the first task') ||
          '. Atlas will bring the rest forward through the day.',
        updated_at = now()
    where id = v_moment.id;

    v_updated := v_updated + 1;
  end loop;

  return v_updated;
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
  v_refreshed integer := 0;
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
    v_refreshed := v_refreshed + atlas.refresh_task_notification_day_plan_v1(v_farm.farm_id, v_today, null);
    v_refreshed := v_refreshed + atlas.refresh_task_notification_day_plan_v1(v_farm.farm_id, v_today + 1, null);
    v_ensured := v_ensured + 2;
  end loop;

  v_dispatch := atlas.dispatch_task_notification_moments_v1(p_as_of, 500);
  return jsonb_build_object(
    'contractVersion', 'task_notification_clock_tick_v1',
    'asOf', coalesce(p_as_of, now()),
    'schedulesEnsured', v_ensured,
    'dayPlansRefreshed', v_refreshed,
    'dispatch', v_dispatch
  );
end;
$function$;

revoke all on function atlas.refresh_task_notification_day_plan_v1(uuid, date, uuid) from public, anon, authenticated;
grant execute on function atlas.refresh_task_notification_day_plan_v1(uuid, date, uuid) to service_role;

comment on function atlas.refresh_task_notification_day_plan_v1(uuid, date, uuid) is
  'Keeps the morning brief anchored to the earliest real task release rather than alphabetical task order.';

select atlas.refresh_task_notification_day_plan_v1(
  farm.id,
  (now() at time zone 'America/Chicago')::date + 1,
  null
)
from atlas.farms farm
where farm.status = 'active';

do $postcondition$
declare
  v_bad integer;
begin
  select count(*)::integer into v_bad
  from atlas.task_notification_moments moment
  where moment.moment_kind = 'day_plan'
    and moment.status = 'planned'
    and moment.work_date >= (now() at time zone 'America/Chicago')::date
    and moment.body not like '%Start with%';

  if v_bad <> 0
     or has_function_privilege('anon', 'atlas.refresh_task_notification_day_plan_v1(uuid,date,uuid)', 'EXECUTE')
  then
    raise exception 'Task notification first-release postcondition failed.';
  end if;
end;
$postcondition$;

commit;
