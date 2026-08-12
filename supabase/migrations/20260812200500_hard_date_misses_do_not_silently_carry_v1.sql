create or replace function atlas.member_day_carryover_v1(p_farm_id uuid, p_membership_id uuid, p_work_date date)
returns table(task_id uuid, previous_work_date date, expected_active_minutes integer, effective_obligation_class text)
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_previous_work_date date;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  if p_work_date < v_today then return; end if;
  if extract(isodow from p_work_date)=7 then return; end if;

  if exists (
    select 1 from atlas.member_unavailability u
    where u.farm_id=p_farm_id and u.membership_id=p_membership_id and u.active=true
      and p_work_date between u.unavailable_start and u.unavailable_end
  ) then return; end if;

  v_previous_work_date:=p_work_date-1;
  loop
    exit when extract(isodow from v_previous_work_date)<>7
      and not exists (
        select 1 from atlas.member_unavailability u
        where u.farm_id=p_farm_id and u.membership_id=p_membership_id and u.active=true
          and v_previous_work_date between u.unavailable_start and u.unavailable_end
      );
    v_previous_work_date:=v_previous_work_date-1;
  end loop;

  if v_previous_work_date>=v_today then return; end if;

  return query
  with target_presented as (
    select p.task_id
    from atlas.presented_work_rows_v1(p_farm_id,p_membership_id,p_work_date) p
    where p.presentation_state in ('attention','presented')
  ), prior_presented as (
    select p.task_id,p.lane_order,p.selection_rank
    from atlas.presented_work_rows_v1(p_farm_id,p_membership_id,v_previous_work_date) p
    where p.presentation_state in ('attention','presented')
  )
  select t.id,v_previous_work_date,capacity.expected_active_minutes,capacity.effective_obligation_class
  from prior_presented prior
  join atlas.tasks t on t.id=prior.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p_work_date) capacity
  where t.status in ('open','blocked')
    -- A missed hard calendar commitment becomes an exception for Owner review.
    -- It is never silently rewritten as tomorrow's worker obligation.
    and not (
      coalesce(t.commitment_kind,'')='hard_date'
      or lower(coalesce(t.metadata->>'date_behavior',''))='hard_date'
      or lower(coalesce(t.metadata->>'date_commitment',''))='hard_date'
      or lower(coalesce(t.metadata->>'calendar_commitment_kind',''))='owner_hard_date'
    )
    and not exists (select 1 from target_presented target where target.task_id=t.id)
    and coalesce((atlas.task_sky_presentation_gate_v1(t.id,p_work_date)->>'withheldUnderSky')::boolean,false)=false
  order by prior.lane_order,prior.selection_rank,t.id;
end;
$function$;

create or replace view atlas.v_missed_hard_date_work as
select
  t.id as task_id,
  t.farm_id,
  t.assigned_membership_id,
  t.title,
  t.task_type,
  t.action_key,
  t.due_date,
  t.commitment_kind,
  t.status,
  case
    when lower(coalesce(t.action_key,'')) in ('sow','seed','sowing','seeding')
      or lower(coalesce(t.task_type,'')) in ('sowing','succession_sowing') then 'sowing_date_missed'
    else 'hard_date_missed'
  end as exception_kind,
  nullif(t.metadata->>'latest_safe_sow_date','')::date as latest_safe_date,
  t.metadata->>'projected_harvest_start' as projected_harvest_start,
  t.metadata->>'projected_harvest_end' as projected_harvest_end,
  'owner_decision_required'::text as disposition
from atlas.tasks t
where t.status in ('open','blocked')
  and t.due_date < (now() at time zone 'America/Chicago')::date
  and (
    coalesce(t.commitment_kind,'')='hard_date'
    or lower(coalesce(t.metadata->>'date_behavior',''))='hard_date'
    or lower(coalesce(t.metadata->>'date_commitment',''))='hard_date'
    or lower(coalesce(t.metadata->>'calendar_commitment_kind',''))='owner_hard_date'
  );

revoke all on atlas.v_missed_hard_date_work from anon, authenticated;
grant select on atlas.v_missed_hard_date_work to service_role;
