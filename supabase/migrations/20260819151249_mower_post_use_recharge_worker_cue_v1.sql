-- Reverse the mower battery interaction from preflight verification to post-use reset.

create or replace function atlas.apply_worker_day_resource_recharge_confirmation_v1(
  p_cue_id uuid,
  p_response jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
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

  if v_cue.id is null then raise exception 'Cue was not found.' using errcode='P0002'; end if;
  if coalesce(v_cue.result_contract->>'kind','')<>'resource_recharge_confirmation_v1' then
    raise exception 'Cue is not a resource-recharge confirmation.' using errcode='22023';
  end if;

  begin
    v_task_id:=nullif(v_cue.result_contract->>'taskId','')::uuid;
    v_resource_id:=nullif(v_cue.result_contract->>'resourceId','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Recharge cue identity is invalid.' using errcode='22023';
  end;

  select * into v_task from atlas.tasks task
  where task.id=v_task_id and task.farm_id=v_cue.farm_id and task.assigned_membership_id=v_cue.membership_id;
  if v_task.id is null then raise exception 'Recharge cue task is outside the assigned Worker Day.' using errcode='55000'; end if;

  select * into v_resource from atlas.resources resource
  where resource.id=v_resource_id and resource.farm_id=v_cue.farm_id;
  if v_resource.id is null then raise exception 'Recharge cue resource is outside the task farm.' using errcode='55000'; end if;

  v_choice:=lower(coalesce(nullif(btrim(p_response->>'choice'),''),''));
  if v_choice<>'charged' then
    raise exception 'Confirm only after the resource has been charged.' using errcode='22023';
  end if;

  v_event:=atlas.record_resource_event_v1(
    p_resource_id=>v_resource.id,
    p_event_kind=>'ready_confirmed',
    p_idempotency_key=>'worker-day-recharge-cue:'||v_cue.id::text||':charged',
    p_source_task_id=>v_task.id,
    p_source_kind=>'worker_day_after_task_cue',
    p_source_id=>v_cue.id,
    p_effective_membership_id=>v_cue.membership_id,
    p_observed_quantity=>null,
    p_quantity_delta=>null,
    p_unit=>null,
    p_note=>'Worker confirmed the reusable resource was charged after use.',
    p_metadata=>jsonb_build_object(
      'contract','or7_worker_resource_post_use_recharge_v1',
      'cueId',v_cue.id,
      'serviceDate',v_cue.service_date,
      'truthBoundary','task_completion_consumes_charge; post-use recharge confirmation restores readiness for the next operation'
    )
  );

  return jsonb_build_object(
    'applied',true,
    'kind','resource_recharge_confirmation_v1',
    'taskId',v_task.id,
    'resourceId',v_resource.id,
    'resourceEvent',v_event,
    'ready',true
  );
end;
$function$;

create or replace function atlas.sync_worker_day_resource_recharge_cue_v1(
  p_task_id uuid,
  p_service_date date,
  p_membership_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_resource atlas.resources%rowtype;
  v_state atlas.resource_operational_state%rowtype;
  v_cue_id uuid;
  v_stable_key text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null or p_service_date is null or p_membership_id is null then return null; end if;
  if v_task.assigned_membership_id is distinct from p_membership_id then return null; end if;

  select * into v_resource
  from atlas.resources
  where farm_id=v_task.farm_id
    and stable_key='battery_push_mower_battery_set'
    and coalesce(metadata->>'resource_role','')='reusable_energy_set';
  if v_resource.id is null then return null; end if;

  select * into v_state from atlas.resource_operational_state where resource_id=v_resource.id;
  if v_state.resource_id is null or v_state.readiness_state<>'needs_charge' then return null; end if;

  v_stable_key:='resource_recharge:'||v_task.id::text||':'||v_resource.id::text;

  select cue.id into v_cue_id
  from atlas.worker_day_cues cue
  where cue.anchor_task_id=v_task.id
    and cue.membership_id=p_membership_id
    and cue.status not in ('resolved','dismissed')
    and cue.result_contract->>'kind'='resource_recharge_confirmation_v1'
    and cue.result_contract->>'resourceId'=v_resource.id::text
  order by cue.created_at desc limit 1
  for update;

  if v_cue_id is null then
    insert into atlas.worker_day_cues(
      organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
      scheduled_at,title,body,payload,result_contract,status,recovery_policy,
      available_from,expires_at,created_by_user_id
    ) values(
      v_task.organization_id,v_task.farm_id,p_membership_id,p_service_date,
      'result','after_task',v_task.id,null,
      'Charge the mower batteries',
      'Before you put the mower away, charge the batteries so they are ready for the next mowing job.',
      jsonb_build_object(
        'stableKey',v_stable_key,
        'resourceId',v_resource.id,
        'resourceLabel',v_resource.label,
        'choices',jsonb_build_array(jsonb_build_object('label','Charged','value','charged')),
        'source','mowing_result_resource_effect',
        'truthBoundary','completion creates the reset obligation; the worker confirms the reset after use'
      ),
      jsonb_build_object(
        'kind','resource_recharge_confirmation_v1',
        'taskId',v_task.id,
        'resourceId',v_resource.id,
        'eventKind','ready_confirmed'
      ),
      'available','persist',null,null,null
    ) returning id into v_cue_id;
  else
    update atlas.worker_day_cues cue
    set service_date=p_service_date,
        anchor_kind='after_task',
        title='Charge the mower batteries',
        body='Before you put the mower away, charge the batteries so they are ready for the next mowing job.',
        payload=jsonb_build_object(
          'stableKey',v_stable_key,
          'resourceId',v_resource.id,
          'resourceLabel',v_resource.label,
          'choices',jsonb_build_array(jsonb_build_object('label','Charged','value','charged')),
          'source','mowing_result_resource_effect',
          'truthBoundary','completion creates the reset obligation; the worker confirms the reset after use'
        ),
        result_contract=jsonb_build_object(
          'kind','resource_recharge_confirmation_v1',
          'taskId',v_task.id,
          'resourceId',v_resource.id,
          'eventKind','ready_confirmed'
        ),
        recovery_policy='persist',
        updated_at=now()
    where cue.id=v_cue_id;
  end if;

  return v_cue_id;
end;
$function$;

-- The generic resolver now understands the post-use recharge result contract.
create or replace function atlas.worker_resolve_day_cue_api_v1(p_cue_id uuid, p_response jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
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
    elsif v_kind='resource_recharge_confirmation_v1' then
      v_contract_result:=atlas.apply_worker_day_resource_recharge_confirmation_v1(v_cue.id,coalesce(p_response,'{}'::jsonb));
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

-- Preserve the existing mowing-result function but attach the reset cue immediately after
-- the result has established that the battery charge was consumed.
create or replace function atlas.record_mowing_result_core_v1(p_task_id uuid, p_effective_membership_id uuid, p_effective_role text, p_outcome text, p_completion_percent integer, p_recheck_date date, p_note text, p_idempotency_key text, p_operator_mode boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_result jsonb;
  v_effect jsonb:=jsonb_build_object('state','not_applicable');
  v_event_id uuid;
  v_task atlas.tasks%rowtype;
  v_actor_user_id uuid;
  v_actor_name text;
  v_owner_user_id uuid;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_route text;
  v_alert_title text;
  v_recharge_cue_id uuid;
  v_service_date date;
begin
  v_result:=atlas.record_mowing_result_core_pre_or2_v1(
    p_task_id,p_effective_membership_id,p_effective_role,p_outcome,p_completion_percent,
    p_recheck_date,p_note,p_idempotency_key,p_operator_mode
  );

  v_event_id:=atlas.rhythm_safe_uuid_v1(v_result->>'eventId');

  if p_outcome='mowed_full' then
    if v_event_id is not null then
      begin
        v_effect:=atlas.apply_mowing_resource_effect_v1(p_task_id,v_event_id,p_effective_membership_id);
        if coalesce(v_effect->>'state','')='charge_consumed' then
          v_service_date:=coalesce((v_effect#>>'{state,last_observed_at}')::timestamptz at time zone 'America/Chicago', now() at time zone 'America/Chicago')::date;
          v_recharge_cue_id:=atlas.sync_worker_day_resource_recharge_cue_v1(p_task_id,v_service_date,p_effective_membership_id);
        end if;
      exception when others then
        v_effect:=jsonb_build_object(
          'state','reconciliation_required',
          'reason','Mowing result was preserved but the reusable-resource consequence could not be applied.',
          'error',sqlerrm,
          'truthBoundary',jsonb_build_object('mowingResultRolledBack',false,'resourceEffectNeedsRepair',true)
        );
      end;
    end if;
  end if;

  if v_note is not null and lower(coalesce(p_effective_role,''))='farm_hand' and v_event_id is not null then
    select * into v_task from atlas.tasks where id=p_task_id;

    select fm.user_id,coalesce(nullif(up.display_name,''),'Farm hand')
      into v_actor_user_id,v_actor_name
    from atlas.farm_memberships fm
    left join atlas.user_profiles up on up.user_id=fm.user_id
    where fm.id=p_effective_membership_id;

    select fm.user_id into v_owner_user_id
    from atlas.farm_memberships fm
    where fm.farm_id=v_task.farm_id and fm.role='owner' and fm.active=true
    order by fm.created_at
    limit 1;

    v_route:=coalesce(nullif(v_task.metadata->>'display_subject',''),nullif(v_task.title,''),'mowing task');
    v_alert_title:=coalesce(v_actor_name,'Farm hand')||' left a mowing note — '||v_route;

    if v_owner_user_id is not null then
      insert into atlas.journal_event_index(
        organization_id,farm_id,event_key,event_kind,source_kind,source_id,source_event,
        occurred_at,journal_date,actor_user_id,assigned_user_id,task_id,title,detail,
        visibility_scope,importance,payload,provenance
      ) values (
        v_task.organization_id,v_task.farm_id,'mowing_worker_note:'||v_event_id::text,
        'task_result','mowing_result',v_event_id,'worker_note',now(),
        (now() at time zone 'America/Chicago')::date,v_actor_user_id,v_owner_user_id,p_task_id,
        v_alert_title,v_note,'owner','attention',
        jsonb_build_object('taskId',p_task_id,'mowingEventId',v_event_id,'outcome',p_outcome,'sourceMembershipId',p_effective_membership_id),
        jsonb_build_object('source','record_mowing_result_core_v1','routing','worker_note_to_owner')
      )
      on conflict (farm_id,event_key) do update set
        detail=excluded.detail,
        assigned_user_id=excluded.assigned_user_id,
        importance='attention',
        updated_at=now();

      perform atlas.enqueue_direct_push_v1(
        v_task.farm_id,v_owner_user_id,'other_player_result',
        v_alert_title,left(v_note,240),'/bell',
        'mowing_worker_note:'||v_event_id::text,'attention',now(),
        jsonb_build_object('taskId',p_task_id,'mowingEventId',v_event_id,'sourceMembershipId',p_effective_membership_id)
      );

      update atlas.mowing_area_state
      set note=null,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'lastWorkerNoteRoutedToOwnerEventId',v_event_id,
            'lastWorkerNoteRoutedToOwnerAt',now()
          ),
          updated_at=now()
      where source_event_id=v_event_id;
    end if;
  end if;

  return v_result||jsonb_build_object(
    'resourceEffect',v_effect,
    'immediateContinuation',coalesce(v_effect->'continuation',jsonb_build_object('humanActionRequired',false)),
    'rechargeCueId',v_recharge_cue_id,
    'operationResultMembrane','operation_result_state_transition_or2'
  );
end;
$function$;

-- Reusable mower batteries no longer create before-task readiness prompts.
-- Any existing unresolved preflight cue for this battery set is obsolete.
update atlas.worker_day_cues cue
set status='dismissed',updated_at=now(),
    response=coalesce(cue.response,'{}'::jsonb)||jsonb_build_object(
      'systemDismissed',true,
      'reason','replaced_by_post_use_recharge_cycle_v1'
    )
where cue.status not in ('resolved','dismissed')
  and cue.result_contract->>'kind'='resource_readiness_verification_v1'
  and exists(
    select 1 from atlas.resources r
    where r.id=(cue.result_contract->>'resourceId')::uuid
      and r.stable_key='battery_push_mower_battery_set'
  );

create or replace function atlas.sync_worker_day_resource_preflight_cues_v1(p_task_id uuid, p_service_date date, p_membership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
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
  v_is_post_use_energy boolean:=false;
begin
  if p_task_id is null or p_service_date is null or p_membership_id is null then
    raise exception 'Task, service date, and membership are required.' using errcode='22023';
  end if;
  select * into v_task from atlas.tasks task where task.id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  select * into v_membership from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=v_task.farm_id and fm.active=true;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_task.assigned_membership_id is distinct from p_membership_id then
    raise exception 'Task is not assigned to this Worker Day membership.' using errcode='55000';
  end if;

  v_gate:=atlas.task_state_consequence_gate_v1(v_task.id);

  update atlas.worker_day_cues cue
  set status='resolved',resolved_at=coalesce(cue.resolved_at,now()),
      response=coalesce(cue.response,'{}'::jsonb)||jsonb_build_object('systemResolved',true,'reason','preparation_gate_cleared_or_post_use_cycle_applies'),
      updated_at=now()
  where cue.anchor_task_id=v_task.id and cue.membership_id=p_membership_id
    and cue.status not in ('resolved','dismissed')
    and cue.result_contract->>'kind'='resource_readiness_verification_v1'
    and (
      not exists(
        select 1 from jsonb_array_elements(coalesce(v_gate->'preparationConsequences','[]'::jsonb)) x(item)
        where x.item#>>'{consequence,actionKey}'='verify_resource_ready'
          and x.item#>>'{requirement,resourceId}'=cue.result_contract->>'resourceId'
      )
      or exists(
        select 1 from atlas.resources r
        where r.id=(cue.result_contract->>'resourceId')::uuid
          and coalesce(r.metadata->>'resource_role','')='reusable_energy_set'
      )
    );
  get diagnostics v_resolved=row_count;

  for v_item in select value from jsonb_array_elements(coalesce(v_gate->'preparationConsequences','[]'::jsonb)) loop
    v_consequence:=coalesce(v_item->'consequence','{}'::jsonb);
    v_requirement:=coalesce(v_item->'requirement','{}'::jsonb);
    if coalesce(v_consequence->>'actionKey','')<>'verify_resource_ready' then continue; end if;
    begin
      v_resource_id:=nullif(v_requirement->>'resourceId','')::uuid;
      v_requirement_id:=nullif(v_requirement->>'requirementId','')::uuid;
    exception when invalid_text_representation then continue;
    end;
    if v_resource_id is null then continue; end if;

    select coalesce(r.metadata->>'resource_role','')='reusable_energy_set'
      into v_is_post_use_energy from atlas.resources r where r.id=v_resource_id;
    if coalesce(v_is_post_use_energy,false) then continue; end if;

    v_resource_label:=coalesce(nullif(v_requirement->>'resourceLabel',''),nullif(v_requirement->>'resourceKey',''),'required resource');
    v_stable_key:='resource_preflight:'||v_task.id::text||':'||v_resource_id::text;
    v_existing_id:=null;
    select cue.id into v_existing_id
    from atlas.worker_day_cues cue
    where cue.anchor_task_id=v_task.id and cue.membership_id=p_membership_id
      and cue.status not in ('resolved','dismissed')
      and cue.result_contract->>'kind'='resource_readiness_verification_v1'
      and cue.result_contract->>'resourceId'=v_resource_id::text
    order by cue.created_at desc limit 1 for update;

    if v_existing_id is null then
      insert into atlas.worker_day_cues(
        organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
        scheduled_at,title,body,payload,result_contract,status,recovery_policy,available_from,expires_at,created_by_user_id
      ) values(
        v_task.organization_id,v_task.farm_id,p_membership_id,p_service_date,
        'requirement','before_task',v_task.id,null,
        'Before you start · '||v_resource_label,
        'Confirm '||v_resource_label||' is ready for use before beginning '||v_task.title||'.',
        jsonb_build_object('stableKey',v_stable_key,'resourceId',v_resource_id,'resourceLabel',v_resource_label,'requirementId',v_requirement_id,
          'choices',jsonb_build_array(jsonb_build_object('label','Ready for use','value','ready_confirmed')),
          'source','task_state_consequence_gate_v1','truthBoundary','unknown remains unknown until the worker supplies a physical readiness witness'),
        jsonb_strip_nulls(jsonb_build_object('kind','resource_readiness_verification_v1','taskId',v_task.id,'resourceId',v_resource_id,'requirementId',v_requirement_id,'eventKind','ready_confirmed')),
        'available','block',null,null,null
      );
      v_created:=v_created+1;
    else
      update atlas.worker_day_cues cue
      set service_date=p_service_date,title='Before you start · '||v_resource_label,
          body='Confirm '||v_resource_label||' is ready for use before beginning '||v_task.title||'.',
          payload=coalesce(cue.payload,'{}'::jsonb)||jsonb_build_object('stableKey',v_stable_key,'resourceId',v_resource_id,'resourceLabel',v_resource_label,'requirementId',v_requirement_id,
            'choices',jsonb_build_array(jsonb_build_object('label','Ready for use','value','ready_confirmed')),
            'source','task_state_consequence_gate_v1','truthBoundary','unknown remains unknown until the worker supplies a physical readiness witness'),
          result_contract=jsonb_strip_nulls(jsonb_build_object('kind','resource_readiness_verification_v1','taskId',v_task.id,'resourceId',v_resource_id,'requirementId',v_requirement_id,'eventKind','ready_confirmed')),
          recovery_policy='block',updated_at=now()
      where cue.id=v_existing_id;
      v_updated:=v_updated+1;
    end if;
  end loop;

  return jsonb_build_object('contractVersion','sync_worker_day_resource_preflight_cues_v1','taskId',v_task.id,'serviceDate',p_service_date,
    'createdCount',v_created,'updatedCount',v_updated,'systemResolvedCount',v_resolved,
    'preparationRequired',coalesce((v_gate->>'preparationRequired')::boolean,false));
end;
$function$;