begin;

create or replace function atlas.owner_tomorrow_preflight_v1(
  p_farm_id uuid,
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date + 1);
  v_members jsonb := '[]'::jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_member_count integer := 0;
  v_overloaded_count integer := 0;
  v_notification_gap_count integer := 0;
  v_presented_count integer := 0;
  v_held_count integer := 0;
  v_attention_count integer := 0;
  v_decision_count integer := 0;
begin
  if not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read Tomorrow Preflight.' using errcode = '42501';
  end if;

  with packets as (
    select
      fm.id as membership_id,
      case fm.role when 'owner' then 1 when 'manager' then 2 else 3 end as role_order,
      atlas.presented_work_v1(p_farm_id, fm.id, v_work_date) as packet
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.active = true
  )
  select
    coalesce(jsonb_agg(packet order by role_order, packet->'member'->>'displayName'), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where coalesce((packet->'summary'->>'overloadUnits')::numeric, 0) > 0)::integer,
    coalesce(sum((packet->'summary'->>'hardDateMissingNotificationCount')::integer), 0)::integer,
    coalesce(sum((packet->'summary'->>'presentedCount')::integer), 0)::integer,
    coalesce(sum((packet->'summary'->>'heldCount')::integer), 0)::integer,
    coalesce(sum((packet->'summary'->>'attentionCount')::integer), 0)::integer
  into
    v_members,
    v_member_count,
    v_overloaded_count,
    v_notification_gap_count,
    v_presented_count,
    v_held_count,
    v_attention_count
  from packets;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'decisionId', decision.id,
      'taskId', decision.task_id,
      'title', task.title,
      'status', task.status,
      'dueDate', task.due_date,
      'assignedMembershipId', task.assigned_membership_id,
      'workLane', task.work_lane,
      'effortUnits', task.effort_units,
      'reason', decision.reason,
      'suggestedAction', decision.suggested_action,
      'createdAt', decision.created_at,
      'actions', jsonb_build_array('keep_now','choose_date','return_to_reservoir','archive')
    ) order by task.due_date nulls last, task.title), '[]'::jsonb),
    count(*)::integer
  into v_decisions, v_decision_count
  from atlas.work_reservoir_decisions decision
  join atlas.tasks task on task.id = decision.task_id
  where decision.farm_id = p_farm_id
    and decision.state = 'open';

  return jsonb_build_object(
    'contractVersion', 'owner_tomorrow_preflight_v1',
    'farmId', p_farm_id,
    'workDate', v_work_date,
    'members', v_members,
    'decisions', v_decisions,
    'summary', jsonb_build_object(
      'memberCount', v_member_count,
      'overloadedMemberCount', v_overloaded_count,
      'hardDateMissingNotificationCount', v_notification_gap_count,
      'presentedCount', v_presented_count,
      'attentionCount', v_attention_count,
      'heldCount', v_held_count,
      'openDecisionCount', v_decision_count
    )
  );
end;
$function$;

revoke execute on function atlas.owner_tomorrow_preflight_v1(uuid, date) from public, anon;
grant execute on function atlas.owner_tomorrow_preflight_v1(uuid, date) to authenticated, service_role;

commit;
