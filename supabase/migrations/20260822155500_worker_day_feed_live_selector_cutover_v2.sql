create or replace function atlas.worker_day_feed_plan_live_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_capacity jsonb;
  v_target integer := 0;
  v_selection jsonb := '[]'::jsonb;
  v_real jsonb := '[]'::jsonb;
  v_committed integer := 0;
begin
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;
  if not exists(
    select 1
    from atlas.farm_memberships fm
    where fm.id = p_membership_id
      and fm.farm_id = p_farm_id
      and fm.active = true
      and fm.role = 'farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  v_capacity := atlas.worker_week_day_capacity_v1(p_farm_id, p_membership_id, p_day);
  v_target := case when v_capacity->>'capacityClass' = 'recovery'
    then greatest(coalesce((v_capacity->>'recoveryCapacityMinutes')::integer, 0), 0)
    else greatest(coalesce((v_capacity->>'plannedCapacityMinutes')::integer, 0), 0)
  end;

  if not atlas.worker_day_available_v1(p_farm_id, p_membership_id, p_day) then
    return jsonb_build_object(
      'contractVersion', 'owner_worker_day_feed_plan_v1',
      'farmId', p_farm_id,
      'membershipId', p_membership_id,
      'serviceDate', p_day,
      'availableWorkerDay', false,
      'paidTargetMinutes', v_target,
      'committedPaidMinutes', 0,
      'automaticPaidMinutes', 0,
      'remainingPaidMinutes', v_target,
      'realWork', '[]'::jsonb,
      'automaticWork', '[]'::jsonb,
      'suggestions', '[]'::jsonb,
      'warnings', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', s.task_id,
    'presentationState', s.presentation_state,
    'presentationReason', s.presentation_reason,
    'selectionRank', s.selection_rank,
    'workLane', s.work_lane,
    'commitmentKind', s.commitment_kind
  ) order by s.selection_rank, s.task_id), '[]'::jsonb)
  into v_selection
  from atlas.presented_work_selection_rows_live_v1(
    p_farm_id,
    p_membership_id,
    p_day
  ) s;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', 'task:' || t.id::text,
      'kind', 'real',
      'sourceKind', 'task',
      'sourceId', t.id,
      'taskId', t.id,
      'title', t.title,
      'status', t.status,
      'expectedActiveMinutes', capacity.expected_active_minutes,
      'dayWindow', coalesce(placement.day_window, atlas.worker_task_day_window_v1(t.action_key, t.task_type, t.metadata)),
      'workOrderNumber', coalesce(placement.sort_order, atlas.worker_task_order_v1(t.action_key, t.task_type, t.metadata)),
      'environment', nullif(t.metadata->>'environment', ''),
      'location', coalesce(
        nullif(t.metadata->>'display_location', ''),
        nullif(t.metadata->>'collection_zone', ''),
        nullif(t.metadata->>'collection_label', '')
      ),
      'automatic', false,
      'requiresOwnerApproval', false,
      'reason', s.item->>'presentationReason',
      'commitmentKind', s.item->>'commitmentKind'
    ) order by
      case coalesce(placement.day_window, atlas.worker_task_day_window_v1(t.action_key, t.task_type, t.metadata))
        when 'morning' then 0
        when 'afternoon' then 1
        else 2
      end,
      coalesce(placement.sort_order, atlas.worker_task_order_v1(t.action_key, t.task_type, t.metadata)),
      coalesce(nullif(s.item->>'selectionRank', '')::bigint, 9223372036854775807),
      t.title,
      t.id
    ), '[]'::jsonb),
    coalesce(sum(capacity.expected_active_minutes), 0)::integer
  into v_real, v_committed
  from jsonb_array_elements(v_selection) s(item)
  join atlas.tasks t on t.id = (s.item->>'taskId')::uuid
  cross join lateral atlas.task_capacity_plan_v1(t, p_day) capacity
  left join atlas.worker_day_task_placements placement
    on placement.farm_id = p_farm_id
   and placement.membership_id = p_membership_id
   and placement.task_id = t.id
   and placement.service_date = p_day
   and placement.state = 'placed'
  where s.item->>'presentationState' = 'presented';

  return jsonb_build_object(
    'contractVersion', 'owner_worker_day_feed_plan_v1',
    'farmId', p_farm_id,
    'membershipId', p_membership_id,
    'serviceDate', p_day,
    'availableWorkerDay', true,
    'paidTargetMinutes', v_target,
    'committedPaidMinutes', v_committed,
    'automaticPaidMinutes', 0,
    'remainingPaidMinutes', greatest(v_target - v_committed, 0),
    'realWork', v_real,
    'automaticWork', '[]'::jsonb,
    'suggestions', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'selectionContractVersion', 'presented_work_selection_rows_live_v1'
  );
end;
$function$;
