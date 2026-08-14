begin;

create or replace function atlas.presented_work_selection_rows_unfiltered_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns table(
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
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_timezone text := 'America/Chicago';
  v_work_date date;
  v_target_user_id uuid;
  v_target_role text;
  v_target_worker_key text;
  v_regular_target integer;
  v_recovery_target integer;
  v_maximum_planned integer;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;

  v_work_date := coalesce(p_work_date,(now() at time zone v_timezone)::date);

  select fm.user_id, fm.role, nullif(lower(btrim(fm.worker_key)), '')
  into v_target_user_id, v_target_role, v_target_worker_key
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_target_user_id is null then
    raise exception 'Target membership is not active on this farm.' using errcode = '42501';
  end if;

  if auth.uid() is not null
    and v_target_user_id is distinct from auth.uid()
    and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s presented work.' using errcode = '42501';
  end if;

  select
    coalesce(setting.regular_target_minutes,
      case v_target_role when 'owner' then 480 when 'manager' then 360 else 300 end),
    coalesce(setting.recovery_target_minutes,
      case v_target_role when 'owner' then 0 when 'manager' then 60 else 90 end),
    coalesce(setting.maximum_planned_minutes,
      case v_target_role when 'owner' then 600 when 'manager' then 480 else 420 end)
  into v_regular_target, v_recovery_target, v_maximum_planned
  from (select 1) seed
  left join atlas.member_capacity_settings setting
    on setting.farm_id = p_farm_id
   and setting.membership_id = p_membership_id
   and setting.active;

  return query
  with candidate_tasks as materialized (
    select t.*
    from atlas.tasks t
    where t.farm_id = p_farm_id
      and t.task_scope = 'farm_operation'
      and (t.status = 'open' or (v_target_role <> 'farm_hand' and t.status = 'blocked'))
      and t.parent_task_id is null
      and t.metadata ->> 'parent_task_id' is null
      and coalesce((t.metadata ->> 'is_child_task')::boolean, false) = false
      and (
        t.assigned_membership_id = p_membership_id
        or t.assigned_user_id = v_target_user_id
        or t.metadata ->> 'executor_membership_id' = p_membership_id::text
        or (
          jsonb_typeof(t.metadata -> 'shared_with_membership_ids') = 'array'
          and (t.metadata -> 'shared_with_membership_ids') ? p_membership_id::text
        )
        or (
          v_target_worker_key is not null
          and lower(coalesce(
            nullif(t.metadata ->> 'executor_worker_key', ''),
            nullif(t.metadata ->> 'assignee_key', ''),
            nullif(t.metadata ->> 'assigned_to', ''),
            nullif(t.metadata ->> 'work_route', '')
          )) = v_target_worker_key
        )
        or (t.visibility_scope = 'farm_shared' and t.assigned_membership_id is null)
        or (
          v_target_role = 'owner'
          and (
            lower(coalesce(t.metadata ->> 'owner_task', 'false')) = 'true'
            or lower(coalesce(t.metadata ->> 'assigned_to', '')) = 'owner'
            or t.visibility_scope = 'owner'
          )
        )
      )
  ), assigned as (
    select
      t.*,
      capacity.expected_active_minutes,
      capacity.physical_load,
      capacity.effective_obligation_class,
      sky.gate as sky_gate,
      exists (
        select 1
        from atlas.task_notification_plans notification
        where notification.task_id = t.id and notification.active = true
      ) as has_notification,
      row_number() over (
        partition by case
          when t.work_lane = 'rhythm' then coalesce(
            nullif(t.metadata ->> 'rhythm_state_id', ''),
            case when nullif(t.metadata ->> 'rhythm_key', '') is not null then concat_ws('|',
              t.metadata ->> 'rhythm_key', coalesce(t.zone_id::text, ''),
              coalesce(nullif(t.metadata ->> 'object_key', ''), ''),
              coalesce(nullif(regexp_replace(t.metadata ->> 'collection_member_key', ':[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''), ''), '')
            ) end,
            case when nullif(t.metadata ->> 'collection_member_key', '') is not null then concat_ws('|',
              regexp_replace(t.metadata ->> 'collection_member_key', ':[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''),
              coalesce(t.zone_id::text, '')
            ) end,
            nullif(t.task_series_key, ''),
            concat_ws('|', lower(regexp_replace(t.title, '\s+[—-].*$', '')), coalesce(t.zone_id::text, '')),
            t.id::text
          )
          else t.id::text
        end
        order by
          case when t.due_date is null or t.due_date <= v_work_date then 0 else 1 end,
          t.due_date desc nulls last, t.created_at desc, t.id
      ) as rhythm_rank
    from candidate_tasks t
    cross join lateral atlas.task_capacity_plan_v1(t, v_work_date) capacity
    cross join lateral (
      select case
        when t.status='open' and t.operation_class is not null
        then atlas.task_sky_presentation_gate_v1(t.id,v_work_date)
        else null::jsonb
      end as gate
    ) sky
  ), ready as (
    select
      a.*,
      case a.effective_obligation_class
        when 'hard_window' then 1
        when 'process_continuation' then 2
        when 'routine_production' then 3
        when 'recovery_work' then 4
        else 5
      end as resolved_lane_order,
      case a.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end as priority_order,
      case
        when coalesce(a.sky_gate->'fitness'->>'enforcementMode','')='preferred'
         and coalesce(a.sky_gate->'fitness'->>'fitness','')='favored'
        then 0 else 1
      end as sky_preference_order,
      coalesce((a.metadata ->> 'day_order')::integer, 999999) as day_order,
      lower(coalesce(a.metadata ->> 'reservoirDecisionState', '')) = 'owner_review' as owner_review,
      (a.due_date is null or a.due_date <= v_work_date) as due_now,
      a.effective_obligation_class = 'recovery_work' as is_recovery,
      a.effective_obligation_class = 'hard_window' as is_hard_window
    from assigned a
  ), hard_total as (
    select coalesce(sum(r.expected_active_minutes),0)::integer as minutes
    from ready r
    where r.status='open' and r.due_now and not r.owner_review
      and not r.is_recovery and r.is_hard_window
      and (r.work_lane <> 'rhythm' or r.rhythm_rank=1)
  ), regular_ranked as (
    select r.id,
      sum(r.expected_active_minutes) over (
        order by
          case r.effective_obligation_class when 'process_continuation' then 0 when 'routine_production' then 1 else 2 end,
          case when r.due_date=v_work_date then 0 when r.due_date is null then 1 else 2 end,
          r.priority_order,
          r.sky_preference_order,
          r.day_order, r.created_at, r.id
        rows between unbounded preceding and current row
      )::integer as cumulative_minutes
    from ready r
    where r.status='open' and r.due_now and not r.owner_review
      and not r.is_recovery and not r.is_hard_window
      and (r.work_lane <> 'rhythm' or r.rhythm_rank=1)
  ), regular_selected as (
    select coalesce(sum(r.expected_active_minutes),0)::integer as minutes
    from ready r
    join regular_ranked ranked on ranked.id=r.id
    cross join hard_total hard
    where ranked.cumulative_minutes <= greatest(v_regular_target-hard.minutes,0)
  ), recovery_capacity as (
    select greatest(0, least(
      greatest(v_maximum_planned-hard.minutes-regular.minutes,0),
      v_recovery_target + greatest(v_regular_target-hard.minutes-regular.minutes,0)
    ))::integer as minutes,
    hard.minutes as hard_minutes,
    regular.minutes as regular_minutes
    from hard_total hard cross join regular_selected regular
  ), recovery_ranked as (
    select r.id,
      sum(r.expected_active_minutes) over (
        order by r.priority_order, r.due_date, r.day_order, r.created_at, r.id
        rows between unbounded preceding and current row
      )::integer as cumulative_minutes
    from ready r
    where r.status='open' and r.due_now and not r.owner_review
      and r.is_recovery
      and (r.work_lane <> 'rhythm' or r.rhythm_rank=1)
  ), resolved as (
    select r.*,
      regular_ranked.cumulative_minutes as cumulative_regular_minutes,
      recovery_ranked.cumulative_minutes as cumulative_recovery_minutes,
      capacity.minutes as recovery_room,
      capacity.hard_minutes,
      capacity.regular_minutes,
      greatest(v_regular_target-capacity.hard_minutes,0)::integer as regular_room,
      case
        when r.owner_review and v_target_role='owner' then 'attention'
        when r.owner_review then 'held'
        when r.status='blocked' and r.due_now then 'attention'
        when not r.due_now then 'held'
        when r.work_lane='rhythm' and r.rhythm_rank>1 then 'held'
        when r.is_hard_window then 'presented'
        when r.is_recovery and coalesce(recovery_ranked.cumulative_minutes,0) <= capacity.minutes then 'presented'
        when not r.is_recovery and coalesce(regular_ranked.cumulative_minutes,0) <= greatest(v_regular_target-capacity.hard_minutes,0) then 'presented'
        else 'held'
      end as resolved_state,
      case
        when r.owner_review then 'owner_review'
        when r.status='blocked' then 'blocked'
        when not r.due_now then 'future'
        when r.work_lane='rhythm' and r.rhythm_rank>1 then 'superseded_rhythm_serving'
        when r.is_hard_window then 'hard_window_selected'
        when r.is_recovery and coalesce(recovery_ranked.cumulative_minutes,0) <= capacity.minutes then 'within_recovery_minutes'
        when r.is_recovery then 'held_beyond_recovery_minutes'
        when coalesce(regular_ranked.cumulative_minutes,0) <= greatest(v_regular_target-capacity.hard_minutes,0) then 'within_regular_minutes'
        else 'held_beyond_regular_minutes'
      end as resolved_reason
    from ready r
    cross join recovery_capacity capacity
    left join regular_ranked on regular_ranked.id=r.id
    left join recovery_ranked on recovery_ranked.id=r.id
  )
  select
    r.id,
    r.resolved_state,
    r.resolved_reason,
    r.resolved_lane_order,
    row_number() over (
      order by
        case r.resolved_state when 'attention' then 0 when 'presented' then 1 else 2 end,
        r.resolved_lane_order,
        case when r.due_date is not null and r.due_date < v_work_date then 0
             when r.due_date=v_work_date then 1 else 2 end,
        r.due_date nulls last,
        r.priority_order,
        r.sky_preference_order,
        r.day_order, r.created_at, r.id
    )::bigint,
    r.work_lane,
    r.commitment_kind,
    r.effort_units,
    0::numeric,
    r.has_notification,
    r.resolved_state='presented' and r.is_hard_window
      and r.hard_minutes > v_maximum_planned
  from resolved r
  order by 4,5;
end;
$function$;

create or replace function atlas.presented_work_selection_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns table(
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
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_target_role text;
  v_target_worker_key text;
begin
  select membership.role,membership.worker_key into v_target_role,v_target_worker_key
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active=true;
  if v_target_role is null then raise exception 'Target membership is not active on this farm.' using errcode='42501'; end if;

  if exists(
    select 1
    from atlas.member_unavailability unavailable
    where unavailable.farm_id=p_farm_id
      and unavailable.membership_id=p_membership_id
      and unavailable.active=true
      and v_work_date between unavailable.unavailable_start and unavailable.unavailable_end
  ) then
    return;
  end if;

  if extract(dow from v_work_date)=0 and v_target_role='farm_hand' then
    return query
    with allowed as (
      select row.*
      from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row
      join atlas.tasks task on task.id=row.task_id
      where task.visibility_scope<>'system_internal'
        and task.due_date=v_work_date
        and task.assigned_membership_id=p_membership_id
        and coalesce((task.metadata->>'allow_sunday')::boolean,false) is true
        and coalesce((task.metadata->>'owner_schedule_override')::boolean,false) is true
        and not exists (
          select 1
          from atlas.task_prerequisites prerequisite
          left join atlas.tasks prerequisite_task on prerequisite_task.id=prerequisite.prerequisite_task_id
          where prerequisite.downstream_task_id=task.id
            and prerequisite.active=true
            and prerequisite.satisfied_at is null
            and (
              prerequisite_task.id is null
              or prerequisite_task.status is distinct from prerequisite.required_status
            )
        )
        and not exists (
          select 1
          from atlas.grow_room_round_requests rr
          join atlas.tasks visit on visit.id=rr.visit_task_id
          where rr.request_task_id=row.task_id
            and rr.resolved_at is null
            and visit.farm_id=p_farm_id
            and visit.status in ('open','blocked')
            and visit.assigned_membership_id=p_membership_id
        )
    )
    select allowed.task_id,'presented'::text,'owner_sunday_override'::text,allowed.lane_order,
      row_number() over(order by allowed.lane_order,allowed.selection_rank,allowed.task_id)::bigint,
      allowed.work_lane,allowed.commitment_kind,allowed.effort_units,allowed.budget_units,
      allowed.notification_planned,false
    from allowed
    order by 4,5;
    return;
  end if;

  return query
  select row.task_id,
    case
      when v_target_role='farm_hand' and dependency.waiting then 'held'
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then 'held'
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'presented'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' then 'presented'
      else row.presentation_state end,
    case
      when v_target_role='farm_hand' and dependency.waiting then 'waiting_on_prerequisite'
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then 'awaiting_favored_sky_window'
      when task.status='open' and task.due_date<v_work_date and accounting.noncounting_overdue then 'overdue_rescheduled_visible_noncounting'
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'overdue_visible_over_capacity'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then 'explicit_due_date_over_capacity'
      when task.status='open' and task.due_date=v_work_date and row.presentation_state='held' then 'explicit_due_date'
      else row.presentation_reason end,
    row.lane_order,row.selection_rank,row.work_lane,row.commitment_kind,row.effort_units,row.budget_units,row.notification_planned,
    case
      when v_target_role='farm_hand' and dependency.waiting then false
      when coalesce((sky.gate->>'withheldUnderSky')::boolean,false) then false
      when accounting.noncounting_overdue then false
      when task.status='open' and task.due_date<v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes') then true
      else row.overload or (task.status='open' and task.due_date=v_work_date and row.presentation_state='held' and row.presentation_reason in ('held_beyond_regular_minutes','held_beyond_recovery_minutes')) end
  from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) row
  join atlas.tasks task on task.id=row.task_id
  cross join lateral (
    select (task.due_date<v_work_date and atlas.task_rescheduled_by_membership_v1(task.id,p_membership_id,v_target_worker_key)) as noncounting_overdue
  ) accounting
  cross join lateral (
    select exists(
      select 1
      from atlas.task_prerequisites prerequisite
      left join atlas.tasks prerequisite_task on prerequisite_task.id=prerequisite.prerequisite_task_id
      where prerequisite.downstream_task_id=task.id
        and prerequisite.active=true
        and prerequisite.satisfied_at is null
        and (
          prerequisite_task.id is null
          or prerequisite_task.status is distinct from prerequisite.required_status
        )
    ) as waiting
  ) dependency
  cross join lateral (
    select atlas.task_sky_presentation_gate_v1(task.id,v_work_date) as gate
  ) sky
  where task.visibility_scope<>'system_internal'
    and (v_work_date<=v_today or task.due_date=v_work_date)
    and not exists (
      select 1
      from atlas.grow_room_round_requests rr
      join atlas.tasks visit on visit.id=rr.visit_task_id
      where rr.request_task_id=row.task_id
        and rr.resolved_at is null
        and visit.farm_id=p_farm_id
        and visit.status in ('open','blocked')
        and visit.assigned_membership_id=p_membership_id
    )
  order by row.lane_order,row.selection_rank;
end;
$function$;

create or replace function atlas.member_day_carryover_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date
)
returns table(task_id uuid, previous_work_date date, expected_active_minutes integer, effective_obligation_class text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
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
    from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_work_date) p
    where p.presentation_state in ('attention','presented')
  ), prior_presented as (
    select p.task_id,p.lane_order,p.selection_rank
    from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,v_previous_work_date) p
    where p.presentation_state in ('attention','presented')
  )
  select t.id,v_previous_work_date,capacity.expected_active_minutes,capacity.effective_obligation_class
  from prior_presented prior
  join atlas.tasks t on t.id=prior.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p_work_date) capacity
  where t.status in ('open','blocked')
    and not (
      coalesce(t.commitment_kind,'')='hard_date'
      or lower(coalesce(t.metadata->>'date_behavior',''))='hard_date'
      or lower(coalesce(t.metadata->>'date_commitment',''))='hard_date'
      or lower(coalesce(t.metadata->>'calendar_commitment_kind',''))='owner_hard_date'
    )
    and not exists(select 1 from target_presented target where target.task_id=t.id)
    and coalesce((atlas.task_sky_presentation_gate_v1(t.id,p_work_date)->>'withheldUnderSky')::boolean,false)=false
  order by prior.lane_order,prior.selection_rank,t.id;
end;
$function$;

create or replace function atlas.owner_capacity_plan_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date:=coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_role text;
  v_member_role text;
  v_worker_key text;
  v_settings atlas.member_capacity_settings%rowtype;
  v_items jsonb:='[]'::jsonb;
  v_regular_minutes integer:=0;
  v_recovery_minutes integer:=0;
  v_heavy_minutes integer:=0;
  v_presented_count integer:=0;
  v_held_count integer:=0;
  v_backlog_minutes integer:=0;
  v_backlog_count integer:=0;
  v_rescheduled_backlog_minutes integer:=0;
  v_rescheduled_backlog_count integer:=0;
  v_held_paid_minutes integer:=0;
  v_due_today_paid_minutes integer:=0;
  v_open_obligation_minutes integer:=0;
  v_regular_target integer:=0;
  v_maximum_planned integer:=0;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  if v_role<>'owner' then raise exception 'Owner farm membership required.' using errcode='42501'; end if;

  select membership.role,membership.worker_key into v_member_role,v_worker_key
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active;
  if v_member_role is null then raise exception 'Target membership is not active on this farm.' using errcode='P0002'; end if;

  select * into v_settings from atlas.member_capacity_settings
  where membership_id=p_membership_id and farm_id=p_farm_id and active;

  v_regular_target:=coalesce(v_settings.regular_target_minutes,case v_member_role when 'farm_hand' then 420 when 'manager' then 360 else 480 end);
  v_maximum_planned:=coalesce(v_settings.maximum_planned_minutes,case v_member_role when 'farm_hand' then 480 when 'manager' then 480 else 600 end);

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'taskId',task.id,'title',task.title,'dueDate',task.due_date,
      'presentationState',presented.presentation_state,'presentationReason',presented.presentation_reason,
      'expectedActiveMinutes',capacity.expected_active_minutes,'physicalLoad',capacity.physical_load,
      'baseObligationClass',capacity.base_obligation_class,'effectiveObligationClass',capacity.effective_obligation_class,
      'microRoundKey',capacity.micro_round_key,'estimateSource',capacity.estimate_source,
      'estimateConfidence',capacity.estimate_confidence,'recoveryOriginDueDate',capacity.recovery_origin_due_date,
      'countsTowardDay',accounting.counts_toward_paid_day,'capacityTreatment',accounting.capacity_treatment,
      'workerRescheduled',accounting.worker_rescheduled
    ) order by presented.lane_order,presented.selection_rank),'[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='presented' and accounting.counts_toward_paid_day and capacity.effective_obligation_class<>'recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='presented' and accounting.counts_toward_paid_day and capacity.effective_obligation_class='recovery_work'),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='presented' and accounting.counts_toward_paid_day and capacity.physical_load='heavy'),0)::integer,
    count(*) filter(where presented.presentation_state='presented')::integer,
    count(*) filter(where presented.presentation_state='held')::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date),0)::integer,
    count(*) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date and accounting.worker_rescheduled),0)::integer,
    count(*) filter(where accounting.counts_toward_paid_day and task.due_date<v_work_date and accounting.worker_rescheduled)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where presented.presentation_state='held' and accounting.counts_toward_paid_day and (task.due_date is null or task.due_date<=v_work_date)),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and task.due_date=v_work_date),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter(where accounting.counts_toward_paid_day and (task.due_date is null or task.due_date<=v_work_date)),0)::integer
  into v_items,v_regular_minutes,v_recovery_minutes,v_heavy_minutes,v_presented_count,v_held_count,
    v_backlog_minutes,v_backlog_count,v_rescheduled_backlog_minutes,v_rescheduled_backlog_count,
    v_held_paid_minutes,v_due_today_paid_minutes,v_open_obligation_minutes
  from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_work_date) presented
  join atlas.tasks task on task.id=presented.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,v_work_date) capacity
  cross join lateral (
    select
      atlas.task_rescheduled_by_membership_v1(task.id,p_membership_id,v_worker_key) as worker_rescheduled,
      case
        when coalesce((task.metadata->>'personal_task')::boolean,false) then false
        when lower(coalesce(task.metadata->>'paid_work','true')) in ('false','no','0') then false
        when capacity.micro_round_key='grow_room_observation' then false
        when capacity.expected_active_minutes<=0 then false
        else true end as counts_toward_paid_day,
      case
        when coalesce((task.metadata->>'personal_task')::boolean,false) or lower(coalesce(task.metadata->>'paid_work','true')) in ('false','no','0') then 'personal_noncounting'
        when capacity.micro_round_key='grow_room_observation' then 'micro_observation_noncounting'
        when capacity.expected_active_minutes<=0 then 'zero_active_minutes'
        when task.due_date<v_work_date then 'overdue_backlog_counted'
        else 'counted' end as capacity_treatment
  ) accounting;

  return jsonb_build_object(
    'contractVersion','owner_capacity_plan_v2',
    'farmId',p_farm_id,'membershipId',p_membership_id,'workDate',v_work_date,
    'member',jsonb_build_object('role',v_member_role,'workerKey',v_worker_key),
    'settings',jsonb_build_object(
      'regularTargetMinutes',v_regular_target,
      'recoveryTargetMinutes',coalesce(v_settings.recovery_target_minutes,case v_member_role when 'farm_hand' then 90 when 'manager' then 60 else 0 end),
      'maximumPlannedMinutes',v_maximum_planned,
      'heavyMinutesSoftCap',coalesce(v_settings.heavy_minutes_soft_cap,case v_member_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end),
      'undercompletionLowersFutureTarget',false
    ),
    'summary',jsonb_build_object(
      'selectedRegularMinutes',v_regular_minutes,
      'selectedRecoveryMinutes',v_recovery_minutes,
      'selectedTotalMinutes',v_regular_minutes+v_recovery_minutes,
      'selectedHeavyMinutes',v_heavy_minutes,
      'backlogPaidMinutes',v_backlog_minutes,
      'backlogCount',v_backlog_count,
      'workerRescheduledBacklogMinutes',v_rescheduled_backlog_minutes,
      'workerRescheduledBacklogCount',v_rescheduled_backlog_count,
      'heldPaidMinutes',v_held_paid_minutes,
      'scheduledTodayPaidMinutes',v_due_today_paid_minutes,
      'openPaidObligationMinutes',v_open_obligation_minutes,
      'obligationBeyondPaidTargetMinutes',greatest(v_open_obligation_minutes-v_regular_target,0),
      'obligationBeyondMaximumPlannedMinutes',greatest(v_open_obligation_minutes-v_maximum_planned,0),
      'noncountingOverdueMinutes',0,
      'noncountingOverdueCount',0,
      'presentedCount',v_presented_count,
      'heldCount',v_held_count
    ),
    'rules',jsonb_build_object(
      'personalWorkCountsTowardPaidDay',false,
      'microObservationCountsTowardPaidDay',false,
      'workerRescheduleErasesObligation',false,
      'workerUndercompletionLowersTomorrowTarget',false,
      'heldWorkStillExists',true
    ),
    'items',v_items
  );
end;
$function$;

revoke all on function atlas.presented_work_selection_rows_unfiltered_v1(uuid,uuid,date) from public, anon, authenticated;
revoke all on function atlas.presented_work_selection_rows_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.presented_work_selection_rows_unfiltered_v1(uuid,uuid,date) to service_role;
grant execute on function atlas.presented_work_selection_rows_v1(uuid,uuid,date) to service_role;

commit;
