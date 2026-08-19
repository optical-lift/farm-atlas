-- OR7 continuity repair: carry preparation-required resource truth all the way
-- into the placed Worker Day as an actionable before-task cue.

create or replace function atlas.apply_worker_day_resource_readiness_verification_v1(
  p_cue_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_cue atlas.worker_day_cues%rowtype;
  v_task atlas.tasks%rowtype;
  v_resource atlas.resources%rowtype;
  v_task_id uuid;
  v_resource_id uuid;
  v_choice text;
  v_event jsonb;
begin
  select * into v_cue
  from atlas.worker_day_cues cue
  where cue.id=p_cue_id
  for update;

  if v_cue.id is null then
    raise exception 'Cue was not found.' using errcode='P0002';
  end if;
  if coalesce(v_cue.result_contract->>'kind','')<>'resource_readiness_verification_v1' then
    raise exception 'Cue is not a resource-readiness verification.' using errcode='22023';
  end if;

  begin
    v_task_id:=nullif(v_cue.result_contract->>'taskId','')::uuid;
    v_resource_id:=nullif(v_cue.result_contract->>'resourceId','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Resource-readiness cue identity is invalid.' using errcode='22023';
  end;

  select * into v_task
  from atlas.tasks task
  where task.id=v_task_id
    and task.farm_id=v_cue.farm_id
    and task.assigned_membership_id=v_cue.membership_id
  for update;
  if v_task.id is null then
    raise exception 'Cue task is outside the assigned Worker Day.' using errcode='55000';
  end if;

  select * into v_resource
  from atlas.resources resource
  where resource.id=v_resource_id
    and resource.farm_id=v_cue.farm_id;
  if v_resource.id is null then
    raise exception 'Cue resource is outside the task farm.' using errcode='55000';
  end if;

  if not exists(
    select 1
    from atlas.task_resource_requirements req
    where req.task_id=v_task.id
      and req.resource_id=v_resource.id
      and req.requirement_role in ('required','check_first','bring_outside')
  ) then
    raise exception 'Cue resource is not a governed requirement of this task.' using errcode='55000';
  end if;

  v_choice:=lower(coalesce(nullif(btrim(p_response->>'choice'),''),''));
  if v_choice<>'ready_confirmed' then
    raise exception 'Confirm the resource only when it is ready for use.' using errcode='22023';
  end if;

  v_event:=atlas.record_resource_event_v1(
    p_resource_id=>v_resource.id,
    p_event_kind=>'ready_confirmed',
    p_idempotency_key=>'worker-day-cue:'||v_cue.id::text||':ready-confirmed',
    p_source_task_id=>v_task.id,
    p_source_kind=>'worker_day_cue',
    p_source_id=>v_cue.id,
    p_effective_membership_id=>v_cue.membership_id,
    p_observed_quantity=>null,
    p_quantity_delta=>null,
    p_unit=>null,
    p_note=>'Worker confirmed required resource ready before execution.',
    p_metadata=>jsonb_build_object(
      'contract','or7_worker_resource_preflight_cue_v1',
      'cueId',v_cue.id,
      'serviceDate',v_cue.service_date,
      'truthBoundary','worker_confirmation_is_a_resource_state_witness_not_task_completion'
    )
  );

  return jsonb_build_object(
    'applied',true,
    'kind','resource_readiness_verification_v1',
    'taskId',v_task.id,
    'resourceId',v_resource.id,
    'resourceEvent',v_event,
    'ready',true
  );
end;
$function$;

create or replace function atlas.worker_resolve_day_cue_api_v1(
  p_cue_id uuid,
  p_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_cue atlas.worker_day_cues%rowtype;
  v_contract_result jsonb:='{}'::jsonb;
  v_is_worker boolean:=false;
  v_kind text;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;

  select cue.* into v_cue
  from atlas.worker_day_cues cue
  join atlas.farm_memberships fm on fm.id=cue.membership_id
  where cue.id=p_cue_id
    and fm.active=true
    and (
      fm.user_id=auth.uid()
      or exists (
        select 1 from atlas.farm_memberships owner_membership
        where owner_membership.farm_id=cue.farm_id
          and owner_membership.active=true
          and owner_membership.role='owner'
          and owner_membership.user_id=auth.uid()
      )
    )
  for update of cue;
  if v_cue.id is null then raise exception 'Cue access required.' using errcode='42501'; end if;

  if v_cue.status='resolved' then
    return jsonb_build_object(
      'contractVersion','worker_day_cue_resolution_v1',
      'cueId',v_cue.id,'status',v_cue.status,'resolvedAt',v_cue.resolved_at,
      'response',v_cue.response,'deduplicated',true
    );
  end if;

  select exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=v_cue.membership_id and fm.active=true and fm.user_id=auth.uid()
  ) into v_is_worker;
  v_kind:=nullif(v_cue.result_contract->>'kind','');

  if coalesce(v_cue.result_contract,'{}'::jsonb)<>'{}'::jsonb then
    if not v_is_worker then raise exception 'Only the assigned worker can resolve a farm-state cue.' using errcode='42501'; end if;
    if v_kind='requirement_confirmation_v1' then
      v_contract_result:=atlas.apply_worker_day_requirement_confirmation_v1(v_cue.id,coalesce(p_response,'{}'::jsonb));
    elsif v_kind='field_transplant_readiness_gate_v1' then
      v_contract_result:=atlas.apply_worker_day_field_transplant_readiness_v1(v_cue.id,coalesce(p_response,'{}'::jsonb));
    elsif v_kind='resource_readiness_verification_v1' then
      v_contract_result:=atlas.apply_worker_day_resource_readiness_verification_v1(v_cue.id,coalesce(p_response,'{}'::jsonb));
    else
      v_contract_result:=atlas.apply_worker_day_cue_result_contract_v1(v_cue.id,coalesce(p_response,'{}'::jsonb));
    end if;
  end if;

  update atlas.worker_day_cues cue
  set response=case when jsonb_typeof(coalesce(p_response,'{}'::jsonb))='object' then coalesce(p_response,'{}'::jsonb) else '{}'::jsonb end,
      status='resolved',resolved_at=now(),updated_at=now()
  where cue.id=p_cue_id
  returning * into v_cue;

  return jsonb_build_object(
    'contractVersion','worker_day_cue_resolution_v1',
    'cueId',v_cue.id,'status',v_cue.status,'resolvedAt',v_cue.resolved_at,
    'response',v_cue.response,'resultContract',v_contract_result
  );
end;
$function$;

create or replace function atlas.sync_worker_day_resource_preflight_cues_v1(
  p_task_id uuid,
  p_service_date date,
  p_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_gate jsonb;
  v_item jsonb;
  v_consequence jsonb;
  v_requirement jsonb;
  v_resource_id uuid;
  v_requirement_id uuid;
  v_resource_label text;
  v_stable_key text;
  v_existing_id uuid;
  v_created integer:=0;
  v_updated integer:=0;
  v_resolved integer:=0;
begin
  if p_task_id is null or p_service_date is null or p_membership_id is null then
    raise exception 'Task, service date, and membership are required.' using errcode='22023';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  select * into v_membership
  from atlas.farm_memberships fm
  where fm.id=p_membership_id
    and fm.farm_id=v_task.farm_id
    and fm.active=true;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  if v_task.assigned_membership_id is distinct from p_membership_id then
    raise exception 'Task is not assigned to this Worker Day membership.' using errcode='55000';
  end if;

  v_gate:=atlas.task_state_consequence_gate_v1(v_task.id);

  -- Resolve obsolete verification cues when the current gate no longer requires
  -- a check-first witness for that task/resource.
  update atlas.worker_day_cues cue
  set status='resolved',
      resolved_at=coalesce(cue.resolved_at,now()),
      response=coalesce(cue.response,'{}'::jsonb)||jsonb_build_object(
        'systemResolved',true,
        'reason','preparation_gate_cleared_before_execution'
      ),
      updated_at=now()
  where cue.anchor_task_id=v_task.id
    and cue.membership_id=p_membership_id
    and cue.status not in ('resolved','dismissed')
    and cue.result_contract->>'kind'='resource_readiness_verification_v1'
    and not exists(
      select 1
      from jsonb_array_elements(coalesce(v_gate->'preparationConsequences','[]'::jsonb)) x(item)
      where x.item#>>'{consequence,actionKey}'='verify_resource_ready'
        and x.item#>>'{requirement,resourceId}'=cue.result_contract->>'resourceId'
    );
  get diagnostics v_resolved=row_count;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_gate->'preparationConsequences','[]'::jsonb))
  loop
    v_consequence:=coalesce(v_item->'consequence','{}'::jsonb);
    v_requirement:=coalesce(v_item->'requirement','{}'::jsonb);
    if coalesce(v_consequence->>'actionKey','')<>'verify_resource_ready' then
      continue;
    end if;

    begin
      v_resource_id:=nullif(v_requirement->>'resourceId','')::uuid;
      v_requirement_id:=nullif(v_requirement->>'requirementId','')::uuid;
    exception when invalid_text_representation then
      continue;
    end;
    if v_resource_id is null then continue; end if;

    v_resource_label:=coalesce(
      nullif(v_requirement->>'resourceLabel',''),
      nullif(v_requirement->>'resourceKey',''),
      'required resource'
    );
    v_stable_key:='resource_preflight:'||v_task.id::text||':'||v_resource_id::text;
    v_existing_id:=null;

    select cue.id into v_existing_id
    from atlas.worker_day_cues cue
    where cue.anchor_task_id=v_task.id
      and cue.membership_id=p_membership_id
      and cue.status not in ('resolved','dismissed')
      and cue.result_contract->>'kind'='resource_readiness_verification_v1'
      and cue.result_contract->>'resourceId'=v_resource_id::text
    order by cue.created_at desc
    limit 1
    for update;

    if v_existing_id is null then
      insert into atlas.worker_day_cues(
        organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
        scheduled_at,title,body,payload,result_contract,status,recovery_policy,
        available_from,expires_at,created_by_user_id
      ) values(
        v_task.organization_id,v_task.farm_id,p_membership_id,p_service_date,
        'requirement','before_task',v_task.id,null,
        'Before you start · '||v_resource_label,
        'Confirm '||v_resource_label||' is ready for use before beginning '||v_task.title||'.',
        jsonb_build_object(
          'stableKey',v_stable_key,
          'resourceId',v_resource_id,
          'resourceLabel',v_resource_label,
          'requirementId',v_requirement_id,
          'choices',jsonb_build_array(jsonb_build_object('label','Ready for use','value','ready_confirmed')),
          'source','task_state_consequence_gate_v1',
          'truthBoundary','unknown remains unknown until the worker supplies a physical readiness witness'
        ),
        jsonb_strip_nulls(jsonb_build_object(
          'kind','resource_readiness_verification_v1',
          'taskId',v_task.id,
          'resourceId',v_resource_id,
          'requirementId',v_requirement_id,
          'eventKind','ready_confirmed'
        )),
        'available','block',null,null,null
      );
      v_created:=v_created+1;
    else
      update atlas.worker_day_cues cue
      set service_date=p_service_date,
          title='Before you start · '||v_resource_label,
          body='Confirm '||v_resource_label||' is ready for use before beginning '||v_task.title||'.',
          payload=coalesce(cue.payload,'{}'::jsonb)||jsonb_build_object(
            'stableKey',v_stable_key,
            'resourceId',v_resource_id,
            'resourceLabel',v_resource_label,
            'requirementId',v_requirement_id,
            'choices',jsonb_build_array(jsonb_build_object('label','Ready for use','value','ready_confirmed')),
            'source','task_state_consequence_gate_v1',
            'truthBoundary','unknown remains unknown until the worker supplies a physical readiness witness'
          ),
          result_contract=jsonb_strip_nulls(jsonb_build_object(
            'kind','resource_readiness_verification_v1',
            'taskId',v_task.id,
            'resourceId',v_resource_id,
            'requirementId',v_requirement_id,
            'eventKind','ready_confirmed'
          )),
          recovery_policy='block',
          updated_at=now()
      where cue.id=v_existing_id;
      v_updated:=v_updated+1;
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion','sync_worker_day_resource_preflight_cues_v1',
    'taskId',v_task.id,
    'serviceDate',p_service_date,
    'createdCount',v_created,
    'updatedCount',v_updated,
    'systemResolvedCount',v_resolved,
    'preparationRequired',coalesce((v_gate->>'preparationRequired')::boolean,false)
  );
end;
$function$;

create or replace function atlas.sync_worker_day_resource_preflight_from_placement_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  if new.state='placed' then
    perform atlas.sync_worker_day_resource_preflight_cues_v1(new.task_id,new.service_date,new.membership_id);
  elsif tg_op='UPDATE' and old.state='placed' and new.state<>'placed' then
    update atlas.worker_day_cues cue
    set status='dismissed',updated_at=now()
    where cue.anchor_task_id=new.task_id
      and cue.membership_id=new.membership_id
      and cue.status not in ('resolved','dismissed')
      and cue.result_contract->>'kind'='resource_readiness_verification_v1';
  end if;
  return new;
end;
$function$;

drop trigger if exists sync_worker_day_resource_preflight_from_placement_v1 on atlas.worker_day_task_placements;
create trigger sync_worker_day_resource_preflight_from_placement_v1
after insert or update of service_date,state,task_id,membership_id
on atlas.worker_day_task_placements
for each row
execute function atlas.sync_worker_day_resource_preflight_from_placement_v1();

create or replace function atlas.reconcile_worker_day_resource_preflight_from_state_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_row record;
begin
  -- A canonical ready witness makes any unresolved preflight for this resource obsolete.
  if new.readiness_state='ready' then
    update atlas.worker_day_cues cue
    set status='resolved',
        resolved_at=coalesce(cue.resolved_at,now()),
        response=coalesce(cue.response,'{}'::jsonb)||jsonb_build_object(
          'systemResolved',true,
          'reason','canonical_resource_state_is_ready'
        ),
        updated_at=now()
    where cue.status not in ('resolved','dismissed')
      and cue.result_contract->>'kind'='resource_readiness_verification_v1'
      and cue.result_contract->>'resourceId'=new.resource_id::text;
    return new;
  end if;

  -- If readiness becomes unknown again, any future placed operation that consumes
  -- the resource must regain its preflight witness.
  if new.readiness_state='unknown' then
    for v_row in
      select p.task_id,p.service_date,p.membership_id
      from atlas.worker_day_task_placements p
      join atlas.tasks t on t.id=p.task_id
      join atlas.task_resource_requirements req on req.task_id=t.id and req.resource_id=new.resource_id
      where p.state='placed'
        and t.status='open'
        and p.service_date >= (now() at time zone 'America/Chicago')::date
    loop
      perform atlas.sync_worker_day_resource_preflight_cues_v1(v_row.task_id,v_row.service_date,v_row.membership_id);
    end loop;
  end if;
  return new;
end;
$function$;

drop trigger if exists reconcile_worker_day_resource_preflight_from_state_v1 on atlas.resource_operational_state;
create trigger reconcile_worker_day_resource_preflight_from_state_v1
after insert or update of readiness_state
on atlas.resource_operational_state
for each row
execute function atlas.reconcile_worker_day_resource_preflight_from_state_v1();

create or replace function atlas.guard_unresolved_blocking_worker_day_cue_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  if new.status='done' and old.status is distinct from 'done' and exists(
    select 1
    from atlas.worker_day_cues cue
    where cue.anchor_task_id=new.id
      and cue.anchor_kind='before_task'
      and cue.recovery_policy='block'
      and cue.status not in ('resolved','dismissed')
  ) then
    raise exception 'Complete the required before-task confirmation before marking this work done.' using errcode='55000';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_unresolved_blocking_worker_day_cue_v1 on atlas.tasks;
create trigger guard_unresolved_blocking_worker_day_cue_v1
before update of status
on atlas.tasks
for each row
execute function atlas.guard_unresolved_blocking_worker_day_cue_v1();

-- Backfill the membrane for already-placed current/future work. The sync is
-- idempotent and only creates cues where canonical state says verification is needed.
do $block$
declare
  v_row record;
begin
  for v_row in
    select p.task_id,p.service_date,p.membership_id
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    where p.state='placed'
      and t.status='open'
      and p.service_date >= (now() at time zone 'America/Chicago')::date
  loop
    perform atlas.sync_worker_day_resource_preflight_cues_v1(v_row.task_id,v_row.service_date,v_row.membership_id);
  end loop;
end;
$block$;