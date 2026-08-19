create or replace function atlas.owner_network_confirmation_queue_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_items jsonb;
begin
  if p_farm_id is null then
    raise exception 'Farm is required.' using errcode='22023';
  end if;
  if not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may review networking confirmations.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'decisionId',d.id,
    'taskId',d.task_id,
    'prompt',coalesce(nullif(d.task_snapshot->>'prompt',''),'Send this networking task to Anna?'),
    'title',coalesce(nullif(d.task_snapshot->>'title',''),t.title),
    'dueDate',coalesce(nullif(d.task_snapshot->>'dueDate',''),t.due_date::text),
    'reason',d.reason,
    'createdAt',d.created_at,
    'networkContext',coalesce(d.task_snapshot->'networkContext','{}'::jsonb),
    'taskState',jsonb_build_object(
      'status',t.status,
      'visibilityScope',t.visibility_scope,
      'assignedMembershipId',t.assigned_membership_id,
      'confirmationState',t.metadata->>'network_owner_confirmation_state'
    )
  ) order by d.created_at,d.id),'[]'::jsonb)
  into v_items
  from atlas.work_reservoir_decisions d
  join atlas.tasks t on t.id=d.task_id
  where d.farm_id=p_farm_id
    and d.state='open'
    and coalesce(d.task_snapshot->>'decisionSubtype','')='network_owner_confirmation'
    and coalesce(t.metadata->>'network_owner_confirmation_state','')='pending';

  return jsonb_build_object(
    'contractVersion','owner_network_confirmation_queue_v1',
    'farmId',p_farm_id,
    'pendingCount',jsonb_array_length(v_items),
    'items',v_items,
    'truthBoundary',jsonb_build_object(
      'workerAssignmentWithheldWhilePending',true,
      'workerVisibilityWithheldWhilePending',true,
      'ownerDecisionRequiredBeforeRelease',true,
      'supplierAndBuyerOutreachRemainSeparateWorkflows',true
    )
  );
end;
$function$;

revoke all on function atlas.owner_network_confirmation_queue_v1(uuid) from public,anon;
grant execute on function atlas.owner_network_confirmation_queue_v1(uuid) to authenticated;