create or replace function atlas.task_component_scope_snapshot_v1(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select jsonb_build_object(
    'version', 1,
    'childTasks', jsonb_build_object(
      'completed', coalesce((
        select jsonb_agg(jsonb_build_object('taskId', c.id, 'title', c.title) order by c.created_at, c.id)
        from atlas.tasks c
        where (c.parent_task_id = p_task_id or c.metadata->>'parent_task_id' = p_task_id::text)
          and c.status <> 'archived'
          and (c.status = 'done' or coalesce(c.metadata->>'checklist_status','') = 'done')
      ), '[]'::jsonb),
      'remaining', coalesce((
        select jsonb_agg(jsonb_build_object('taskId', c.id, 'title', c.title, 'status', c.status) order by c.created_at, c.id)
        from atlas.tasks c
        where (c.parent_task_id = p_task_id or c.metadata->>'parent_task_id' = p_task_id::text)
          and c.status <> 'archived'
          and not (c.status = 'done' or coalesce(c.metadata->>'checklist_status','') = 'done')
      ), '[]'::jsonb)
    ),
    'checklist', jsonb_build_object(
      'completed', coalesce((
        select jsonb_agg(jsonb_build_object('itemId', i.id, 'itemKey', i.item_key, 'label', i.item_label) order by i.sort_order, i.item_key)
        from atlas.task_execution_checklist_items i
        where i.task_id = p_task_id
          and coalesce(i.metadata->>'retired','false') <> 'true'
          and i.checked
      ), '[]'::jsonb),
      'remaining', coalesce((
        select jsonb_agg(jsonb_build_object('itemId', i.id, 'itemKey', i.item_key, 'label', i.item_label, 'required', i.required) order by i.sort_order, i.item_key)
        from atlas.task_execution_checklist_items i
        where i.task_id = p_task_id
          and coalesce(i.metadata->>'retired','false') <> 'true'
          and not i.checked
      ), '[]'::jsonb)
    )
  );
$$;

create or replace function atlas.complete_task_execution_components_v1(
  p_task_id uuid,
  p_parent_transition_key text,
  p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_task atlas.tasks%rowtype;
  v_item atlas.task_execution_checklist_items%rowtype;
  v_actor_membership_id uuid;
  v_effective_membership_id uuid;
  v_closed integer := 0;
  v_event_key text;
begin
  select * into v_task from atlas.tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;

  begin
    v_actor_membership_id := nullif(coalesce(p_payload->>'actor_membership_id', p_payload->>'actorMembershipId'), '')::uuid;
  exception when others then
    v_actor_membership_id := null;
  end;
  if v_actor_membership_id is null then
    v_actor_membership_id := atlas.current_membership_id(v_task.farm_id);
  end if;

  begin
    v_effective_membership_id := nullif(coalesce(p_payload->>'effective_membership_id', p_payload->>'effectiveMembershipId'), '')::uuid;
  exception when others then
    v_effective_membership_id := null;
  end;
  v_effective_membership_id := coalesce(v_effective_membership_id, v_actor_membership_id);

  for v_item in
    select i.*
    from atlas.task_execution_checklist_items i
    where i.task_id = p_task_id
      and coalesce(i.metadata->>'retired','false') <> 'true'
      and not i.checked
    order by i.sort_order, i.item_key
    for update
  loop
    update atlas.task_execution_checklist_items
    set checked = true,
        checked_at = now(),
        checked_by_membership_id = v_actor_membership_id,
        updated_at = now()
    where id = v_item.id;

    v_event_key := left(
      'parent-done:' || p_task_id::text || ':' || md5(coalesce(p_parent_transition_key,'')) || ':' || v_item.id::text,
      180
    );

    insert into atlas.task_execution_checklist_events (
      farm_id, task_id, item_id, item_key, event_kind,
      actor_user_id, actor_membership_id, effective_membership_id,
      idempotency_key, payload
    ) values (
      v_task.farm_id, p_task_id, v_item.id, v_item.item_key, 'checked',
      auth.uid(), v_actor_membership_id, v_effective_membership_id,
      v_event_key,
      jsonb_build_object(
        'source', 'parent_attestation',
        'checked', true,
        'parent_task_done', true,
        'parent_task_id', p_task_id
      )
    ) on conflict (farm_id, idempotency_key) do nothing;

    v_closed := v_closed + 1;
  end loop;

  return v_closed;
end;
$$;

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
    p_payload := coalesce(p_payload,'{}'::jsonb) || jsonb_build_object(
      'unfinished_scope_version', 1,
      'component_scope_snapshot', atlas.task_component_scope_snapshot_v1(p_task_id)
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

  return v_result || jsonb_build_object('checklistComponentsClosed', v_checklist_closed);
end;
$$;
