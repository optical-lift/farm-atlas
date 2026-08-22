create or replace function atlas.record_task_transition_v1_internal(
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null::date,
  p_note text default null::text,
  p_reason text default null::text,
  p_lane_key text default null::text,
  p_work_key text default null::text,
  p_payload jsonb default '{}'::jsonb,
  p_existing_field_log_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.task_transitions%rowtype;
  v_children_closed integer := 0;
  v_round_state jsonb;
  v_round_date date;
  v_child_count integer := 0;
  v_checklist_closed integer := 0;
  v_result jsonb;
  v_return_date date;
  v_carryover jsonb := null;
begin
  if p_task_id is null then
    raise exception 'Task id is required.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks t where t.id=p_task_id for update;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode='P0002';
  end if;

  if p_transition in ('done','checklist_done') and v_task.status='done' then
    select * into v_existing
    from atlas.task_transitions tt
    where tt.task_id=v_task.id and tt.next_status='done'
    order by tt.created_at desc,tt.id desc limit 1;
    if coalesce(v_existing.payload->>'children_closed','') ~ '^\d+$' then
      v_children_closed := (v_existing.payload->>'children_closed')::integer;
    end if;
    return jsonb_build_object(
      'transitionId',v_existing.id,
      'taskId',v_task.id,
      'status','done',
      'fieldLogId',v_existing.field_log_id,
      'taskOutcomeEventId',v_existing.task_outcome_event_id,
      'childTaskIds',coalesce(v_existing.payload->'child_task_ids','[]'::jsonb),
      'childrenClosed',v_children_closed,
      'checklistComponentsClosed',coalesce(nullif(v_existing.payload->>'checklist_components_closed','')::integer,0),
      'nextTaskId',v_existing.payload->>'next_task_id',
      'deduplicated',true,
      'terminalStateNoop',true
    );
  end if;

  if p_transition in ('done','checklist_done')
     and coalesce(v_task.metadata->>'task_style','')='harvest_readiness_round' then
    v_round_state := atlas.harvest_readiness_round_state_v1(v_task.id,coalesce(v_task.due_date,current_date));
    if not coalesce((v_round_state->>'complete')::boolean,false) then
      raise exception 'Done rejected: record each crop harvest-readiness observation in this zone round first.' using errcode='P0001';
    end if;
  end if;

  if p_transition in ('done','checklist_done')
     and v_task.task_type='harvest_watch'
     and coalesce(v_task.metadata->>'harvest_watch_mode','')='boundary_observation'
     and coalesce(v_task.metadata->>'structured_harvest_result_required','false')='true' then
    v_round_date := coalesce(nullif(v_task.metadata->>'harvest_readiness_round_date','')::date,v_task.due_date,current_date);
    if not exists(
      select 1 from atlas.crop_harvest_events e
      where e.task_id=v_task.id and e.event_kind='watch' and e.observed_date>=v_round_date
    ) then
      raise exception 'Done rejected: record the crop harvest-readiness result instead of checking this item off.' using errcode='P0001';
    end if;
  end if;

  if p_transition in ('done','checklist_done')
     and coalesce(v_task.metadata->>'seed_inventory_report_required','false')='true'
     and coalesce(v_task.metadata->>'seed_governance_required','false')='true'
     and not exists(
       select 1 from atlas.seed_inventory_events e
       where e.task_id=v_task.id and coalesce(e.metadata->>'operationEffect','')='direct_sow_seed_result'
     ) then
    raise exception 'Done rejected: this sowing operation requires its post-sow seed inventory result before completion.' using errcode='P0001';
  end if;

  if p_transition in ('done','checklist_done')
     and coalesce(v_task.metadata->>'result_storage','')='atlas.buyer_contact_events' then
    select count(*) into v_child_count from atlas.tasks child where child.parent_task_id=v_task.id and child.status<>'archived';
    if v_child_count>0 then
      if exists(
        select 1 from atlas.tasks child
        where child.parent_task_id=v_task.id
          and child.status<>'archived'
          and not exists(select 1 from atlas.buyer_contact_events event where event.source_task_id=child.id)
      ) then
        raise exception 'Done rejected: record a contact result for every buyer in this outreach batch first.' using errcode='P0001';
      end if;
    elsif not exists(select 1 from atlas.buyer_contact_events event where event.source_task_id=v_task.id) then
      raise exception 'Done rejected: record the buyer contact result before completing this outreach call.' using errcode='P0001';
    end if;
  end if;

  if p_transition = 'partial' then
    begin
      v_return_date := nullif(p_payload#>>'{unfinishedDisposition,requestedReturnDate}','')::date;
    exception when others then
      v_return_date := null;
    end;
    v_return_date := coalesce(v_return_date, p_target_date, timezone('America/Chicago',now())::date + 1);
    if v_return_date <= timezone('America/Chicago',now())::date then
      v_return_date := timezone('America/Chicago',now())::date + 1;
    end if;

    p_payload := coalesce(p_payload,'{}'::jsonb) || jsonb_build_object(
      'unfinished_scope_version', 1,
      'component_scope_snapshot', atlas.task_component_scope_snapshot_v1(p_task_id),
      'unfinished_requested_return_date', v_return_date
    );
  end if;

  if p_transition = 'done' then
    v_checklist_closed := atlas.complete_task_execution_components_v1(
      p_task_id,
      p_idempotency_key,
      coalesce(p_payload,'{}'::jsonb)
    );
    p_payload := coalesce(p_payload,'{}'::jsonb) || jsonb_build_object(
      'checklist_components_closed', v_checklist_closed
    );
  end if;

  v_result := atlas.record_task_transition_v1_internal_legacy(
    p_task_id,p_transition,p_idempotency_key,p_target_date,p_note,p_reason,p_lane_key,p_work_key,coalesce(p_payload,'{}'::jsonb),p_existing_field_log_id
  );

  if p_transition = 'partial' then
    v_carryover := atlas.set_task_aside_today_v2(
      p_task_id,
      v_return_date,
      left('unfinished-carryover:'||p_task_id::text||':'||timezone('America/Chicago',now())::date::text,180)
    );
    v_result := v_result || jsonb_build_object('unfinishedCarryover',v_carryover);
  end if;

  return v_result || jsonb_build_object('checklistComponentsClosed', v_checklist_closed);
end;
$$;
