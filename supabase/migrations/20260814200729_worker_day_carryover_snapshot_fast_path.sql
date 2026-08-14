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
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_previous_work_date date;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_prior_task_ids uuid[] := array[]::uuid[];
  v_target_task_ids uuid[] := array[]::uuid[];
  v_snapshot_found boolean := false;
begin
  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active=true
  ) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  if p_work_date < v_today then return; end if;
  if extract(isodow from p_work_date)=7 then return; end if;

  if exists (
    select 1
    from atlas.member_unavailability u
    where u.farm_id=p_farm_id
      and u.membership_id=p_membership_id
      and u.active=true
      and p_work_date between u.unavailable_start and u.unavailable_end
  ) then return; end if;

  v_previous_work_date:=p_work_date-1;
  loop
    exit when extract(isodow from v_previous_work_date)<>7
      and not exists (
        select 1
        from atlas.member_unavailability u
        where u.farm_id=p_farm_id
          and u.membership_id=p_membership_id
          and u.active=true
          and v_previous_work_date between u.unavailable_start and u.unavailable_end
      );
    v_previous_work_date:=v_previous_work_date-1;
  end loop;

  if v_previous_work_date>=v_today then return; end if;

  select coalesce(snapshot.planned_task_ids,array[]::uuid[])
  into v_prior_task_ids
  from atlas.day_plan_snapshots snapshot
  where snapshot.farm_id=p_farm_id
    and snapshot.membership_id=p_membership_id
    and snapshot.service_date=v_previous_work_date
  limit 1;
  v_snapshot_found:=found;

  if not v_snapshot_found then
    select coalesce(
      array_agg(p.task_id order by p.lane_order,p.selection_rank,p.task_id),
      array[]::uuid[]
    )
    into v_prior_task_ids
    from atlas.presented_work_selection_rows_v1(
      p_farm_id,
      p_membership_id,
      v_previous_work_date
    ) p
    where p.presentation_state in ('attention','presented');
  end if;

  select coalesce(snapshot.planned_task_ids,array[]::uuid[])
  into v_target_task_ids
  from atlas.day_plan_snapshots snapshot
  where snapshot.farm_id=p_farm_id
    and snapshot.membership_id=p_membership_id
    and snapshot.service_date=p_work_date
  limit 1;
  v_snapshot_found:=found;

  if not v_snapshot_found then
    select coalesce(
      array_agg(p.task_id order by p.lane_order,p.selection_rank,p.task_id),
      array[]::uuid[]
    )
    into v_target_task_ids
    from atlas.presented_work_selection_rows_v1(
      p_farm_id,
      p_membership_id,
      p_work_date
    ) p
    where p.presentation_state in ('attention','presented');
  end if;

  return query
  with prior_presented as (
    select item.task_id,item.ordinality
    from unnest(coalesce(v_prior_task_ids,array[]::uuid[]))
      with ordinality as item(task_id,ordinality)
  ), prior_open as materialized (
    select t.id,prior.ordinality
    from prior_presented prior
    join atlas.tasks t on t.id=prior.task_id
    where t.status in ('open','blocked')
      and not (
        coalesce(t.commitment_kind,'')='hard_date'
        or lower(coalesce(t.metadata->>'date_behavior',''))='hard_date'
        or lower(coalesce(t.metadata->>'date_commitment',''))='hard_date'
        or lower(coalesce(t.metadata->>'calendar_commitment_kind',''))='owner_hard_date'
      )
  )
  select
    t.id,
    v_previous_work_date,
    capacity.expected_active_minutes,
    capacity.effective_obligation_class
  from prior_open prior
  join atlas.tasks t on t.id=prior.id
  cross join lateral atlas.task_capacity_plan_v1(t,p_work_date) capacity
  where not (t.id=any(coalesce(v_target_task_ids,array[]::uuid[])))
    and coalesce(
      (atlas.task_sky_presentation_gate_v1(t.id,p_work_date)->>'withheldUnderSky')::boolean,
      false
    )=false
  order by prior.ordinality,t.id;
end;
$function$;
