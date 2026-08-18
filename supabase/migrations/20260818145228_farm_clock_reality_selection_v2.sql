create or replace function atlas.presented_work_selection_rows_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
) returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean
)
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_target_role text;
  v_capacity jsonb;
  v_capacity_class text;
  v_paid_target integer:=0;
  v_maximum integer:=0;
  v_heavy_cap integer:=0;
  v_week_claims jsonb:='{}'::jsonb;
  v_week_optional_room integer:=2147483647;
  v_week_optional_heavy_room integer:=2147483647;
begin
  select fm.role into v_target_role
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_target_role is null then
    raise exception 'Target membership is not active on this farm.' using errcode='42501';
  end if;

  if extract(dow from v_work_date)::integer=0 and v_target_role='farm_hand' then return; end if;
  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,v_work_date) then return; end if;

  v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_work_date);
  if coalesce(v_capacity->>'state','')='anchor_required'
     and v_target_role='manager'
     and extract(isodow from v_work_date)::integer between 1 and 5
     and exists (
       select 1 from atlas.member_capacity_settings m
       where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true
     ) then
    select greatest(coalesce(m.regular_target_minutes,0),0),
           greatest(coalesce(m.maximum_planned_minutes,m.regular_target_minutes,0),coalesce(m.regular_target_minutes,0),0),
           greatest(coalesce(m.heavy_minutes_soft_cap,0),0)
    into v_paid_target,v_maximum,v_heavy_cap
    from atlas.member_capacity_settings m
    where m.farm_id=p_farm_id and m.membership_id=p_membership_id and m.active=true
    order by m.updated_at desc nulls last,m.created_at desc nulls last
    limit 1;
    v_capacity_class:='manager_capacity_setting_fallback';
    v_heavy_cap:=least(v_heavy_cap,v_maximum);
  else
    v_capacity_class:=coalesce(v_capacity->>'capacityClass','none');
    v_paid_target:=greatest(case when v_capacity_class='recovery'
      then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0)
      else coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0) end,0);
    v_maximum:=greatest(case when v_capacity_class='recovery'
      then coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,v_paid_target)
      else coalesce((v_capacity->>'maximumUsableMinutes')::integer,v_paid_target) end,v_paid_target);
    v_heavy_cap:=greatest(least(coalesce((v_capacity->>'heavyMinutesSoftCap')::integer,v_paid_target),v_maximum),0);
  end if;

  if v_target_role='farm_hand' then
    v_week_claims:=atlas.worker_weekly_labor_claims_v2(p_farm_id,p_membership_id,v_work_date);
    v_week_optional_room:=greatest(coalesce((v_week_claims#>>'{totals,remainingOptionalPlannedAvailabilityMinutes}')::integer,0),0);
    v_week_optional_heavy_room:=greatest(coalesce((v_week_claims#>>'{totals,remainingOptionalHeavyAvailabilityMinutes}')::integer,0),0);
  end if;

  return query
  with candidates as materialized (
    select c.*,
      c.legacy_presentation_reason in (
        'within_day_capacity','next_up_capacity','next_up_heavy_capacity'
      ) as flexible_capacity_candidate,
      c.legacy_presentation_state='presented' and c.legacy_presentation_reason in (
        'protected_minimum_selected','consequence_required_selected','hard_date_selected',
        'required_over_capacity','required_selected'
      ) as required_selected,
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end as priority_order
    from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,v_work_date) c
  ), required_stats as (
    select coalesce(sum(c.expected_active_minutes) filter(where c.required_selected),0)::integer as minutes,
           coalesce(sum(c.expected_active_minutes) filter(where c.required_selected and c.physical_load='heavy'),0)::integer as heavy_minutes
    from candidates c
  ), room as (
    select
      least(greatest(v_paid_target-r.minutes,0),v_week_optional_room)::integer as flexible_minutes,
      least(greatest(v_heavy_cap-r.heavy_minutes,0),v_week_optional_heavy_room)::integer as flexible_heavy_minutes
    from required_stats r
  ), flexible_ranked as (
    select c.task_id,
      sum(c.expected_active_minutes) over (
        order by
          coalesce(c.consequence_tier,99),
          c.reality_warrant_order,
          c.due_date nulls last,
          c.priority_order,
          c.lane_order,c.legacy_selection_rank,c.task_id
        rows between unbounded preceding and current row
      )::integer as cumulative_minutes,
      sum(case when c.physical_load='heavy' then c.expected_active_minutes else 0 end) over (
        order by
          coalesce(c.consequence_tier,99),
          c.reality_warrant_order,
          c.due_date nulls last,
          c.priority_order,
          c.lane_order,c.legacy_selection_rank,c.task_id
        rows between unbounded preceding and current row
      )::integer as cumulative_heavy_minutes,
      row_number() over (
        order by
          coalesce(c.consequence_tier,99),
          c.reality_warrant_order,
          c.due_date nulls last,
          c.priority_order,
          c.lane_order,c.legacy_selection_rank,c.task_id
      )::bigint as reality_flexible_rank
    from candidates c
    where c.flexible_capacity_candidate
  ), resolved as (
    select c.*,r.flexible_minutes,r.flexible_heavy_minutes,
           f.cumulative_minutes,f.cumulative_heavy_minutes,f.reality_flexible_rank,
           case
             when not c.flexible_capacity_candidate then c.legacy_presentation_state
             when coalesce(f.cumulative_minutes,0)<=r.flexible_minutes
              and coalesce(f.cumulative_heavy_minutes,0)<=r.flexible_heavy_minutes then 'presented'
             else 'held'
           end as final_state,
           case
             when not c.flexible_capacity_candidate then c.legacy_presentation_reason
             when coalesce(f.cumulative_minutes,0)<=r.flexible_minutes
              and coalesce(f.cumulative_heavy_minutes,0)<=r.flexible_heavy_minutes then 'within_reality_governed_capacity'
             when coalesce(f.cumulative_heavy_minutes,0)>r.flexible_heavy_minutes then 'next_up_reality_heavy_capacity'
             else 'next_up_reality_capacity'
           end as final_reason
    from candidates c
    cross join room r
    left join flexible_ranked f on f.task_id=c.task_id
  ), ordered as (
    select x.*,
      row_number() over (
        order by
          case x.final_state when 'attention' then 0 when 'presented' then 1 else 2 end,
          case when x.required_selected then 0 when x.flexible_capacity_candidate then 1 else 2 end,
          case when x.required_selected then x.legacy_selection_rank end nulls last,
          case when x.flexible_capacity_candidate then coalesce(x.consequence_tier,99) end nulls last,
          case when x.flexible_capacity_candidate then x.reality_warrant_order end nulls last,
          case when x.flexible_capacity_candidate then x.due_date end nulls last,
          case when x.flexible_capacity_candidate then x.priority_order end nulls last,
          case when x.flexible_capacity_candidate then x.reality_flexible_rank end nulls last,
          x.legacy_selection_rank,x.task_id
      )::bigint as final_rank
    from resolved x
  )
  select o.task_id,o.final_state,o.final_reason,o.lane_order,o.final_rank,
         o.work_lane,o.commitment_kind,o.effort_units,o.budget_units,o.notification_planned,
         case when o.flexible_capacity_candidate then false else o.legacy_overload end
  from ordered o
  order by o.final_rank;
end;
$$;

create or replace function atlas.presented_work_rows_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
) returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean,
  task_card jsonb
)
language sql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
  select
    s.task_id,s.presentation_state,s.presentation_reason,s.lane_order,s.selection_rank,
    s.work_lane,s.commitment_kind,s.effort_units,s.budget_units,s.notification_planned,s.overload,
    card.card || jsonb_build_object(
      'sky_timing',atlas.task_sky_presentation_gate_v1(s.task_id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)),
      'capacity_deferral',atlas.task_worker_day_deferral_v1(s.task_id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)),
      'farm_clock_reality',(
        select jsonb_build_object(
          'warrantClass',c.reality_warrant_class,
          'warrantOrder',c.reality_warrant_order,
          'subjectState',c.subject_state,
          'fittingOperation',c.fitting_operation,
          'operationWindow',c.operation_window,
          'claimCapacityContext',c.claim_capacity_context,
          'jurisdiction',c.jurisdiction,
          'truthBoundary',c.truth_boundary
        )
        from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,p_work_date) c
        where c.task_id=s.task_id
        limit 1
      )
    )
  from atlas.presented_work_selection_rows_v2(p_farm_id,p_membership_id,p_work_date) s
  cross join lateral (
    select to_jsonb(c) as card from atlas.v_task_cards c where c.task_id=s.task_id limit 1
  ) card
  order by s.selection_rank;
$$;

revoke all on function atlas.presented_work_selection_rows_v2(uuid,uuid,date) from public,anon,authenticated;
revoke all on function atlas.presented_work_rows_v2(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.presented_work_selection_rows_v2(uuid,uuid,date) to service_role;
grant execute on function atlas.presented_work_rows_v2(uuid,uuid,date) to service_role;