create index if not exists field_logs_task_metadata_idx
  on atlas.field_logs (farm_id, ((metadata ->> 'task_id')))
  where metadata ? 'task_id';

create or replace function atlas.presented_work_rows_v1(
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
  overload boolean,
  task_card jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_target_user_id uuid;
  v_target_role text;
  v_target_worker_key text;
  v_budget numeric;
begin
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

  select coalesce(setting.daily_unit_budget,
    case v_target_role when 'owner' then 12 when 'manager' then 8 else 6 end)
  into v_budget
  from (select 1) seed
  left join atlas.member_workload_settings setting
    on setting.farm_id = p_farm_id
   and setting.membership_id = p_membership_id;

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
  ),
  assigned as (
    select
      t.*,
      card_lookup.card as card,
      exists (
        select 1
        from atlas.task_notification_plans notification
        where notification.task_id = t.id
          and notification.active = true
      ) as has_notification,
      row_number() over (
        partition by case
          when t.work_lane = 'rhythm' then coalesce(
            nullif(t.metadata ->> 'rhythm_state_id', ''),
            case
              when nullif(t.metadata ->> 'rhythm_key', '') is not null then concat_ws('|',
                t.metadata ->> 'rhythm_key',
                coalesce(t.zone_id::text, ''),
                coalesce(nullif(t.metadata ->> 'object_key', ''), ''),
                coalesce(nullif(regexp_replace(t.metadata ->> 'collection_member_key', ':[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''), ''), '')
              )
            end,
            case
              when nullif(t.metadata ->> 'collection_member_key', '') is not null then concat_ws('|',
                regexp_replace(t.metadata ->> 'collection_member_key', ':[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''),
                coalesce(t.zone_id::text, '')
              )
            end,
            nullif(t.task_series_key, ''),
            concat_ws('|', lower(regexp_replace(t.title, '\s+[—-].*$', '')), coalesce(t.zone_id::text, '')),
            t.id::text
          )
          else t.id::text
        end
        order by
          case when t.due_date is null or t.due_date <= v_work_date then 0 else 1 end,
          t.due_date desc nulls last,
          t.created_at desc,
          t.id
      ) as rhythm_rank
    from candidate_tasks t
    cross join lateral (
      select card
      from atlas.v_task_cards card
      where card.task_id = t.id
      limit 1
    ) card_lookup
  ),
  ready as (
    select
      a.*,
      case a.work_lane
        when 'required' then 1
        when 'process_continuation' then 2
        when 'rhythm' then 3
        else 4
      end as resolved_lane_order,
      case a.priority
        when 'urgent' then 0
        when 'high' then 1
        when 'normal' then 2
        when 'low' then 3
        else 4
      end as priority_order,
      coalesce((a.metadata ->> 'day_order')::integer, 999999) as day_order,
      lower(coalesce(a.metadata ->> 'reservoirDecisionState', '')) = 'owner_review' as owner_review,
      (a.due_date is null or a.due_date <= v_work_date) as due_now
    from assigned a
  ),
  mandatory_total as (
    select coalesce(sum(r.effort_units), 0)::numeric as units
    from ready r
    where r.status = 'open'
      and r.due_now
      and not r.owner_review
      and r.work_lane in ('required', 'process_continuation', 'rhythm')
      and (r.work_lane <> 'rhythm' or r.rhythm_rank = 1)
  ),
  discretionary_ranked as (
    select
      r.id,
      sum(r.effort_units) over (
        order by
          case when r.due_date is not null and r.due_date < v_work_date then 0
               when r.due_date = v_work_date then 1 else 2 end,
          r.due_date nulls last,
          r.priority_order,
          r.day_order,
          r.created_at,
          r.id
        rows between unbounded preceding and current row
      ) as cumulative_units
    from ready r
    where r.status = 'open'
      and r.due_now
      and not r.owner_review
      and r.work_lane = 'discretionary'
  ),
  resolved as (
    select
      r.*,
      coalesce(d.cumulative_units, 0)::numeric as cumulative_discretionary_units,
      m.units as mandatory_units,
      greatest(v_budget - m.units, 0)::numeric as discretionary_room,
      case
        when r.owner_review and v_target_role = 'owner' then 'attention'
        when r.owner_review then 'held'
        when r.status = 'blocked' and r.due_now then 'attention'
        when not r.due_now then 'held'
        when r.work_lane = 'rhythm' and r.rhythm_rank > 1 then 'held'
        when r.work_lane in ('required', 'process_continuation', 'rhythm') then 'presented'
        when coalesce(d.cumulative_units, 0) <= greatest(v_budget - m.units, 0) then 'presented'
        else 'held'
      end as resolved_state,
      case
        when r.owner_review then 'owner_review'
        when r.status = 'blocked' then 'blocked'
        when not r.due_now then 'future'
        when r.work_lane = 'rhythm' and r.rhythm_rank > 1 then 'superseded_rhythm_serving'
        when r.work_lane = 'required' then 'required_obligation'
        when r.work_lane = 'process_continuation' then 'ready_continuation'
        when r.work_lane = 'rhythm' then 'current_rhythm_serving'
        when coalesce(d.cumulative_units, 0) <= greatest(v_budget - m.units, 0) then 'within_day_budget'
        else 'held_for_day_budget'
      end as resolved_reason
    from ready r
    cross join mandatory_total m
    left join discretionary_ranked d on d.id = r.id
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
             when r.due_date = v_work_date then 1 else 2 end,
        r.due_date nulls last,
        r.priority_order,
        r.day_order,
        r.created_at,
        r.id
    ),
    r.work_lane,
    r.commitment_kind,
    r.effort_units,
    v_budget,
    r.has_notification,
    r.resolved_state = 'presented'
      and r.work_lane in ('required', 'process_continuation', 'rhythm')
      and r.mandatory_units > v_budget,
    to_jsonb(r.card)
      || jsonb_build_object(
        'assigned_membership_id', r.assigned_membership_id,
        'assigned_user_id', r.assigned_user_id,
        'visibility_scope', r.visibility_scope,
        'work_lane', r.work_lane,
        'commitment_kind', r.commitment_kind,
        'effort_units', r.effort_units,
        'release_reason', r.release_reason,
        'origin_kind', r.origin_kind
      )
  from resolved r
  order by 4, 5;
end;
$function$;
