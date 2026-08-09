create or replace function atlas.presented_work_rows_unfiltered_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null::date
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
  overload boolean,
  task_card jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
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
      and t.status in ('open', 'blocked')
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
      card_lookup.card as card,
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
    cross join lateral (
      select card from atlas.v_task_cards card where card.task_id = t.id limit 1
    ) card_lookup
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
      and r.hard_minutes > v_maximum_planned,
    to_jsonb(r.card) || jsonb_build_object(
      'assigned_membership_id',r.assigned_membership_id,
      'assigned_user_id',r.assigned_user_id,
      'visibility_scope',r.visibility_scope,
      'work_lane',r.work_lane,
      'commitment_kind',r.commitment_kind,
      'release_reason',r.release_reason,
      'origin_kind',r.origin_kind
    )
  from resolved r
  order by 4,5;
end;
$$;

comment on function atlas.presented_work_rows_unfiltered_v1(uuid,uuid,date) is
'Body Budget presentation planner. Every open operation-class task receives sky fitness so Preferred can act as a tie-break after obligation/due/priority truth. Windowed withholding still requires independent task deferrability and is applied by the presentation gate. Farm timezone comes from farm metadata with Chicago only as fallback.';