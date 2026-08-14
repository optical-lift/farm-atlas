-- Pass 31: reduce interactive Day/Home card hydration work without changing task truth,
-- and stop rebuilding notification schedules every five minutes when nothing changed.

create or replace function atlas.task_card_for_id_v1(p_task_id uuid)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
begin
  if p_task_id is null then
    return;
  end if;

  -- Keep the task id inside the function boundary so Postgres can push the
  -- predicate into v_task_cards before its rich aggregate card assembly.
  return query
  select card.*
  from atlas.v_task_cards card
  where card.task_id = p_task_id;
end;
$function$;

revoke all on function atlas.task_card_for_id_v1(uuid) from public, anon, authenticated;

-- Preserve the current membership-card selector verbatim and only replace its
-- final dynamic join against the aggregate card view with bounded per-id hydration.
-- The guarded replacement makes migration drift fail loudly instead of changing
-- work-selection semantics silently.
do $migration$
declare
  v_definition text;
  v_old_fragment constant text := 'join atlas.v_task_cards card on card.task_id = selected.task_id';
  v_new_fragment constant text := 'cross join lateral atlas.task_card_for_id_v1(selected.task_id) card';
begin
  select pg_get_functiondef('atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure)
  into v_definition;

  if v_definition is null or position(v_old_fragment in v_definition) = 0 then
    raise exception 'home_task_cards_for_membership_v2 hydration contract changed; performance migration requires review.';
  end if;

  execute replace(v_definition, v_old_fragment, v_new_fragment);
end;
$migration$;

comment on function atlas.task_card_for_id_v1(uuid) is
  'Performance boundary for hydrating one already-selected task card. Keeps rich v_task_cards assembly bounded to one task id.';

create index if not exists task_notification_moments_farm_day_refresh_idx
  on atlas.task_notification_moments (farm_id, work_date, updated_at desc);

create or replace function atlas.task_notification_clock_tick_v1(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_farm record;
  v_day date;
  v_today date;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_candidate_count integer;
  v_candidate_updated_at timestamptz;
  v_schedule_updated_at timestamptz;
  v_days_checked integer := 0;
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
    v_today := (v_as_of at time zone 'America/Chicago')::date;

    for v_day in
      select v_today
      union all
      select v_today + 1
    loop
      v_days_checked := v_days_checked + 1;

      -- A cheap indexed probe tells us whether task truth for this dated farm
      -- can possibly require a schedule rebuild.
      select count(*)::integer, max(task.updated_at)
      into v_candidate_count, v_candidate_updated_at
      from atlas.tasks task
      where task.farm_id = v_farm.farm_id
        and task.task_scope = 'farm_operation'
        and task.parent_task_id is null
        and task.status in ('open', 'blocked')
        and task.due_date = v_day;

      if coalesce(v_candidate_count, 0) = 0 then
        continue;
      end if;

      select max(moment.updated_at)
      into v_schedule_updated_at
      from atlas.task_notification_moments moment
      where moment.farm_id = v_farm.farm_id
        and moment.work_date = v_day;

      -- Existing moments already encode their future scheduled times. Keep the
      -- five-minute dispatcher below, but rebuild the expensive presentation /
      -- schedule projection only when task truth changed or at a 30-minute
      -- safety refresh for non-task inputs such as availability/preferences.
      if v_schedule_updated_at is null
         or v_candidate_updated_at is null
         or v_candidate_updated_at > v_schedule_updated_at
         or v_schedule_updated_at <= v_as_of - interval '30 minutes'
      then
        perform atlas.ensure_task_notification_moments_v1(
          v_farm.farm_id,
          v_day,
          null,
          v_as_of
        );
        v_refreshed := v_refreshed + atlas.refresh_task_notification_day_plan_v1(
          v_farm.farm_id,
          v_day,
          null
        );
        v_ensured := v_ensured + 1;
      end if;
    end loop;
  end loop;

  -- Dispatch cadence remains unchanged. Due moments are still checked every
  -- five minutes by the existing cron job; only redundant schedule rebuilding
  -- is suppressed.
  v_dispatch := atlas.dispatch_task_notification_moments_v1(v_as_of, 500);

  return jsonb_build_object(
    'contractVersion', 'task_notification_clock_tick_v1',
    'asOf', v_as_of,
    'scheduleDaysChecked', v_days_checked,
    'schedulesEnsured', v_ensured,
    'dayPlansRefreshed', v_refreshed,
    'dispatch', v_dispatch
  );
end;
$function$;

comment on function atlas.task_notification_clock_tick_v1(timestamptz) is
  'Five-minute notification dispatcher with change-aware / 30-minute schedule refresh, avoiding redundant presented-work rebuilds.';
