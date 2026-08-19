create or replace function atlas.has_positive_ready_flower_inventory_v1(p_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  select exists(
    select 1
    from atlas.flower_ready_inventory_position_v1 position
    where position.farm_id=p_farm_id
      and coalesce(position.available_quantity,0)>0
  );
$function$;

create or replace function atlas.reconcile_sales_outreach_inventory_gate_v1(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_available boolean:=false;
  v_today date;
  v_released integer:=0;
  v_held integer:=0;
  v_task record;
  v_release_date date;
begin
  if p_farm_id is null then raise exception 'Farm is required.' using errcode='22023'; end if;
  v_available:=atlas.has_positive_ready_flower_inventory_v1(p_farm_id);
  select (now() at time zone coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago'))::date
  into v_today from atlas.farms f where f.id=p_farm_id;
  v_today:=coalesce(v_today,current_date);

  if not v_available then
    update atlas.tasks t
    set status=case when t.status='done' then t.status else 'blocked' end,
        due_date=case when t.status='done' then t.due_date else null end,
        blocker_text=case when t.status='done' then t.blocker_text else 'Waiting for ready flower inventory before florist sales outreach is released.' end,
        visibility_scope=case when t.status='done' then t.visibility_scope else 'system_internal' end,
        metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
          'sales_inventory_gate','ready_flower_inventory',
          'sales_inventory_gate_state','waiting_for_inventory',
          'outreach_release_state','waiting_for_inventory'
        ),
        updated_at=now()
    where t.farm_id=p_farm_id
      and coalesce(t.metadata->>'sales_inventory_gate','')='ready_flower_inventory'
      and t.status<>'archived';
    get diagnostics v_held=row_count;
    return jsonb_build_object('farmId',p_farm_id,'inventoryAvailable',false,'releasedCount',0,'heldCount',v_held);
  end if;

  for v_task in
    select t.id,t.assigned_membership_id,t.parent_task_id
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and coalesce(t.metadata->>'sales_inventory_gate','')='ready_flower_inventory'
      and t.status='blocked'
      and not exists(
        select 1
        from atlas.task_prerequisites prerequisite
        join atlas.tasks source on source.id=prerequisite.prerequisite_task_id
        where prerequisite.downstream_task_id=t.id
          and prerequisite.active
          and source.status<>prerequisite.required_status
      )
    order by case when t.parent_task_id is null then 0 else 1 end,t.created_at,t.id
  loop
    v_release_date:=case
      when v_task.assigned_membership_id is null then v_today
      else atlas.worker_day_on_or_after_v1(p_farm_id,v_task.assigned_membership_id,v_today)
    end;
    update atlas.tasks
    set status='open',
        due_date=v_release_date,
        blocker_text=null,
        visibility_scope='assigned_worker',
        released_at=coalesce(released_at,now()),
        release_reason='sales_inventory_gate_satisfied',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'sales_inventory_gate','ready_flower_inventory',
          'sales_inventory_gate_state','released',
          'sales_inventory_gate_satisfied_at',now(),
          'outreach_release_state','released',
          'execution_date',v_release_date
        ),
        updated_at=now()
    where id=v_task.id;
    v_released:=v_released+1;
  end loop;

  return jsonb_build_object('farmId',p_farm_id,'inventoryAvailable',true,'releasedCount',v_released,'heldCount',0);
end;
$function$;

create or replace function atlas.release_sales_outreach_on_ready_inventory_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  perform atlas.reconcile_sales_outreach_inventory_gate_v1(coalesce(new.farm_id,old.farm_id));
  return coalesce(new,old);
end;
$function$;

drop trigger if exists flower_ready_inventory_release_sales_outreach_v1 on atlas.flower_ready_inventory_lots;
create trigger flower_ready_inventory_release_sales_outreach_v1
after insert or update on atlas.flower_ready_inventory_lots
for each row execute function atlas.release_sales_outreach_on_ready_inventory_v1();

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
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.task_transitions%rowtype;
  v_children_closed integer:=0;
  v_round_state jsonb;
  v_round_date date;
  v_child_count integer:=0;
begin
  if p_task_id is null then raise exception 'Task id is required.' using errcode='22023'; end if;
  select * into v_task from atlas.tasks t where t.id=p_task_id for update;
  if v_task.id is null then raise exception 'Task was not found.' using errcode='P0002'; end if;

  if p_transition in ('done','checklist_done') and v_task.status='done' then
    select * into v_existing from atlas.task_transitions tt where tt.task_id=v_task.id and tt.next_status='done' order by tt.created_at desc,tt.id desc limit 1;
    if coalesce(v_existing.payload->>'children_closed','') ~ '^\d+$' then v_children_closed:=(v_existing.payload->>'children_closed')::integer; end if;
    return jsonb_build_object('transitionId',v_existing.id,'taskId',v_task.id,'status','done','fieldLogId',v_existing.field_log_id,'taskOutcomeEventId',v_existing.task_outcome_event_id,'childTaskIds',coalesce(v_existing.payload->'child_task_ids','[]'::jsonb),'childrenClosed',v_children_closed,'nextTaskId',v_existing.payload->>'next_task_id','deduplicated',true,'terminalStateNoop',true);
  end if;

  if p_transition in ('done','checklist_done')
     and coalesce(v_task.metadata->>'task_style','')='harvest_readiness_round' then
    v_round_state:=atlas.harvest_readiness_round_state_v1(v_task.id,coalesce(v_task.due_date,current_date));
    if not coalesce((v_round_state->>'complete')::boolean,false) then
      raise exception 'Done rejected: record each crop harvest-readiness observation in this zone round first.' using errcode='P0001';
    end if;
  end if;

  if p_transition in ('done','checklist_done')
     and v_task.task_type='harvest_watch'
     and coalesce(v_task.metadata->>'harvest_watch_mode','')='boundary_observation'
     and coalesce(v_task.metadata->>'structured_harvest_result_required','false')='true' then
    v_round_date:=coalesce(nullif(v_task.metadata->>'harvest_readiness_round_date','')::date,v_task.due_date,current_date);
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
        select 1
        from atlas.tasks child
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

  return atlas.record_task_transition_v1_internal_legacy(
    p_task_id,p_transition,p_idempotency_key,p_target_date,p_note,p_reason,p_lane_key,p_work_key,coalesce(p_payload,'{}'::jsonb),p_existing_field_log_id
  );
end;
$function$;

create or replace function atlas.sync_outreach_worker_visibility_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if coalesce(new.metadata->>'outreach_queue_key','')='anna_outreach_conveyor' then
    if coalesce(new.metadata->>'sales_inventory_gate','')='ready_flower_inventory'
       and not atlas.has_positive_ready_flower_inventory_v1(new.farm_id) then
      new.status:='blocked';
      new.due_date:=null;
      new.blocker_text:='Waiting for ready flower inventory before florist sales outreach is released.';
      new.visibility_scope:='system_internal';
      new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
        'sales_inventory_gate_state','waiting_for_inventory',
        'outreach_release_state','waiting_for_inventory'
      );
    elsif new.status='open'
       and new.due_date is not null
       and coalesce(new.metadata->>'outreach_release_state','')='released' then
      new.visibility_scope:='assigned_worker';
    elsif new.status='blocked'
       and new.due_date is null
       and coalesce(new.metadata->>'outreach_release_state','') in ('queued','waiting_for_inventory') then
      new.visibility_scope:='system_internal';
    end if;
  end if;
  return new;
end;
$function$;