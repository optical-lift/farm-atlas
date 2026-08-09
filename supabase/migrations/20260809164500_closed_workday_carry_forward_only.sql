create or replace function atlas.member_day_carryover_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date
)
returns table(
  task_id uuid,
  previous_work_date date,
  expected_active_minutes integer,
  effective_obligation_class text
)
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $$
declare
  v_previous_work_date date;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.id = p_membership_id
      and fm.farm_id = p_farm_id
      and fm.active = true
  ) then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  -- Carry-forward is actual-state truth, not a recursive future forecast.
  -- A future day may inherit only from a workday that has already closed.
  -- This lets Monday inherit unfinished Saturday work across a Sunday/no-work day,
  -- while Tuesday planning still assumes Monday's scheduled work will be completed.
  if p_work_date < v_today then
    return;
  end if;

  if extract(isodow from p_work_date) = 7 then
    return;
  end if;

  if exists (
    select 1
    from atlas.member_unavailability u
    where u.farm_id = p_farm_id
      and u.membership_id = p_membership_id
      and u.active = true
      and p_work_date between u.unavailable_start and u.unavailable_end
  ) then
    return;
  end if;

  v_previous_work_date := p_work_date - 1;
  loop
    exit when extract(isodow from v_previous_work_date) <> 7
      and not exists (
        select 1
        from atlas.member_unavailability u
        where u.farm_id = p_farm_id
          and u.membership_id = p_membership_id
          and u.active = true
          and v_previous_work_date between u.unavailable_start and u.unavailable_end
      );
    v_previous_work_date := v_previous_work_date - 1;
  end loop;

  -- Never project today's or another future workday's unfinished state forward.
  -- It becomes carry-forward only after that source workday is in the past.
  if v_previous_work_date >= v_today then
    return;
  end if;

  return query
  with target_presented as (
    select p.task_id
    from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, p_work_date) p
    where p.presentation_state in ('attention', 'presented')
  ), prior_presented as (
    select p.task_id, p.lane_order, p.selection_rank
    from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_previous_work_date) p
    where p.presentation_state in ('attention', 'presented')
  )
  select
    t.id,
    v_previous_work_date,
    capacity.expected_active_minutes,
    capacity.effective_obligation_class
  from prior_presented prior
  join atlas.tasks t on t.id = prior.task_id
  cross join lateral atlas.task_capacity_plan_v1(t, p_work_date) capacity
  where t.status in ('open', 'blocked')
    and not exists (
      select 1 from target_presented target where target.task_id = t.id
    )
    and coalesce(
      (atlas.task_sky_presentation_gate_v1(t.id, p_work_date) ->> 'withheldUnderSky')::boolean,
      false
    ) = false
  order by prior.lane_order, prior.selection_rank, t.id;
end;
$$;

revoke all on function atlas.member_day_carryover_v1(uuid, uuid, date) from public, anon, authenticated;
grant execute on function atlas.member_day_carryover_v1(uuid, uuid, date) to service_role;
