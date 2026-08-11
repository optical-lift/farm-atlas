-- Treat crop-profile transplant readiness as an observation gate, not worker work.
--
-- `transplant_ready_days_min/max` already drive the projected FIELD transplant
-- window on sowing children. They must not silently mean "pot up". Pot-up,
-- hardening, and field transplant are separate farm-state transitions.
--
-- This migration leaves the earlier `transplant_readiness_gate_v1` contract in
-- place for its historical Fall-kale acceptance cue, and introduces the clear
-- `field_transplant_readiness_gate_v1` contract for generated transplant-window
-- observations going forward.

create or replace function atlas.resolve_transplant_readiness_crop_cycle_v1(
  p_task_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_cycle_id uuid;
  v_profile_id uuid;
  v_sown_date date;
  v_candidate_count integer:=0;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return null; end if;

  select tcc.crop_cycle_id into v_cycle_id
  from atlas.task_crop_cycles tcc
  join atlas.crop_cycles cc on cc.id=tcc.crop_cycle_id
  where tcc.task_id=v_task.id
    and cc.lifecycle_status='active'
  order by case tcc.confidence when 'confirmed' then 0 else 1 end,
           case tcc.role when 'observes' then 0 when 'affects' then 1 else 2 end,
           tcc.created_at
  limit 1;
  if v_cycle_id is not null then return v_cycle_id; end if;

  begin
    v_cycle_id:=nullif(v_task.metadata->>'crop_cycle_id','')::uuid;
  exception when invalid_text_representation then
    v_cycle_id:=null;
  end;
  if v_cycle_id is not null
     and exists(select 1 from atlas.crop_cycles cc where cc.id=v_cycle_id and cc.farm_id=v_task.farm_id and cc.lifecycle_status='active') then
    return v_cycle_id;
  end if;

  begin
    v_profile_id:=nullif(v_task.metadata->>'crop_profile_id','')::uuid;
  exception when invalid_text_representation then
    v_profile_id:=null;
  end;
  begin
    v_sown_date:=nullif(v_task.metadata->>'source_sown_date','')::date;
  exception when others then
    v_sown_date:=null;
  end;
  if v_profile_id is null then return null; end if;

  select count(*),min(cc.id)
    into v_candidate_count,v_cycle_id
  from atlas.crop_cycles cc
  where cc.farm_id=v_task.farm_id
    and cc.crop_profile_id=v_profile_id
    and cc.lifecycle_status='active'
    and (v_sown_date is null or cc.sown_date=v_sown_date);

  if v_candidate_count=1 then return v_cycle_id; end if;
  return null;
end;
$function$;

revoke all on function atlas.resolve_transplant_readiness_crop_cycle_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.resolve_transplant_readiness_crop_cycle_v1(uuid) to service_role;

create or replace function atlas.prepare_transplant_readiness_day_cue_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  if new.task_type='transplant_readiness' and new.status='open' and new.assigned_membership_id is not null then
    new.visibility_scope:='system_internal';
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'observation_delivery_mode','day_cue',
        'readiness_target','field_transplant',
        'task_style','transplant_readiness'
      );
  end if;
  return new;
end;
$function$;

revoke all on function atlas.prepare_transplant_readiness_day_cue_v1() from public,anon,authenticated;
grant execute on function atlas.prepare_transplant_readiness_day_cue_v1() to service_role;

drop trigger if exists zzzy_prepare_transplant_readiness_day_cue_v1 on atlas.tasks;
create trigger zzzy_prepare_transplant_readiness_day_cue_v1
before insert or update of task_type,status,due_date,assigned_membership_id,visibility_scope,metadata
on atlas.tasks
for each row execute function atlas.prepare_transplant_readiness_day_cue_v1();

create or replace function atlas.sync_transplant_readiness_day_cue_v1(
  p_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_cycle_id uuid;
  v_cue_id uuid;
  v_subject text;
  v_body text;
  v_recovery_prompt text;
  v_payload jsonb;
  v_contract jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return null; end if;

  if v_task.task_type<>'transplant_readiness'
     or v_task.status<>'open'
     or v_task.assigned_membership_id is null
     or v_task.due_date is null then
    update atlas.worker_day_cues cue
      set status='dismissed',updated_at=now()
    where cue.result_contract->>'kind'='field_transplant_readiness_gate_v1'
      and cue.result_contract->>'taskId'=p_task_id::text
      and cue.status not in ('resolved','dismissed');
    return null;
  end if;

  begin
    select * into v_profile
    from atlas.crop_profiles cp
    where cp.id=nullif(v_task.metadata->>'crop_profile_id','')::uuid;
  exception when invalid_text_representation then
    null;
  end;

  v_cycle_id:=atlas.resolve_transplant_readiness_crop_cycle_v1(v_task.id);
  v_subject:=coalesce(
    nullif(v_task.metadata->>'variety',''),
    nullif(v_profile.variety,''),
    nullif(v_task.metadata->>'crop',''),
    nullif(v_profile.crop_label,''),
    'these seedlings'
  );
  v_body:='Are the '||v_subject||' seedlings ready to plant out?';
  v_recovery_prompt:='What do the '||v_subject||' seedlings look like now?';

  v_payload:=jsonb_build_object(
    'stableKey','field_transplant_readiness:'||v_task.id::text,
    'recoveryTitle',v_subject,
    'recoveryPrompt',v_recovery_prompt,
    'questions',jsonb_build_array(
      jsonb_build_object(
        'key','readiness',
        'prompt',v_body,
        'choices',jsonb_build_array(
          jsonb_build_object('label','Yes, they’re ready','value','ready'),
          jsonb_build_object('label','Not yet','value','not_ready'),
          jsonb_build_object('label','Already planted','value','already_planted'),
          jsonb_build_object('label','Something went wrong','value','problem')
        )
      ),
      jsonb_build_object(
        'key','condition',
        'when',jsonb_build_object('key','readiness','equals','ready'),
        'prompt','How did the seedlings make it?',
        'choices',jsonb_build_array(
          jsonb_build_object('label','They look great','value','all_great'),
          jsonb_build_object('label','Struggling but still there','value','struggling'),
          jsonb_build_object('label','Record number','value','record_number')
        )
      ),
      jsonb_build_object(
        'key','surviving_count',
        'when',jsonb_build_object('key','condition','equals','record_number'),
        'input','number',
        'prompt','How many seedlings are ready?',
        'placeholder','Ready seedlings'
      )
    )
  );
  v_contract:=jsonb_strip_nulls(jsonb_build_object(
    'kind','field_transplant_readiness_gate_v1',
    'taskId',v_task.id,
    'cropCycleId',v_cycle_id,
    'subject',v_subject
  ));

  select cue.id into v_cue_id
  from atlas.worker_day_cues cue
  where cue.farm_id=v_task.farm_id
    and cue.membership_id=v_task.assigned_membership_id
    and cue.result_contract->>'kind'='field_transplant_readiness_gate_v1'
    and cue.result_contract->>'taskId'=v_task.id::text
    and cue.status not in ('resolved','dismissed')
  order by cue.service_date desc,cue.created_at desc
  limit 1;

  if v_cue_id is not null then
    update atlas.worker_day_cues cue
      set service_date=case when cue.service_date>=current_date then v_task.due_date else cue.service_date end,
          title=v_subject,
          body=v_body,
          payload=v_payload,
          result_contract=v_contract,
          recovery_policy='refresh',
          updated_at=now()
    where cue.id=v_cue_id;
    return v_cue_id;
  end if;

  insert into atlas.worker_day_cues(
    organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
    scheduled_at,title,body,payload,result_contract,status,recovery_policy,
    available_from,expires_at,created_by_user_id
  ) values (
    v_task.organization_id,v_task.farm_id,v_task.assigned_membership_id,v_task.due_date,
    'observation','first_open',null,null,v_subject,v_body,v_payload,v_contract,
    'available','refresh',null,null,v_task.created_by_user_id
  ) returning id into v_cue_id;

  return v_cue_id;
end;
$function$;

revoke all on function atlas.sync_transplant_readiness_day_cue_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.sync_transplant_readiness_day_cue_v1(uuid) to service_role;

create or replace function atlas.trg_sync_transplant_readiness_day_cue_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  perform atlas.sync_transplant_readiness_day_cue_v1(new.id);
  return new;
end;
$function$;

revoke all on function atlas.trg_sync_transplant_readiness_day_cue_v1() from public,anon,authenticated;
grant execute on function atlas.trg_sync_transplant_readiness_day_cue_v1() to service_role;

drop trigger if exists zzzz_sync_transplant_readiness_day_cue_v1 on atlas.tasks;
create trigger zzzz_sync_transplant_readiness_day_cue_v1
after insert or update of task_type,status,due_date,assigned_membership_id,visibility_scope,metadata
on atlas.tasks
for each row execute function atlas.trg_sync_transplant_readiness_day_cue_v1();

create or replace function atlas.apply_worker_day_field_transplant_readiness_v1(
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
  v_cycle_id uuid;
  v_readiness text;
  v_condition text;
  v_count integer;
  v_service_day date;
  v_next_day date;
  v_next_cue_id uuid;
  v_observation jsonb;
  v_transition_result jsonb:='{}'::jsonb;
  v_subject text;
begin
  select * into v_cue
  from atlas.worker_day_cues cue
  where cue.id=p_cue_id
  for update;
  if v_cue.id is null then raise exception 'Cue was not found.' using errcode='P0002'; end if;
  if v_cue.result_contract->>'kind'<>'field_transplant_readiness_gate_v1' then
    raise exception 'Cue is not a field-transplant readiness observation.' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_response,'{}'::jsonb))<>'object' then
    raise exception 'Cue response data must be an object.' using errcode='22023';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=nullif(v_cue.result_contract->>'taskId','')::uuid
    and task.farm_id=v_cue.farm_id
    and task.assigned_membership_id=v_cue.membership_id
  for update;
  if v_task.id is null then raise exception 'Cue result task is outside the worker Day.' using errcode='55000'; end if;
  if v_task.task_type<>'transplant_readiness' then
    raise exception 'Cue result task is not a field-transplant readiness source.' using errcode='22023';
  end if;

  begin
    v_cycle_id:=nullif(v_cue.result_contract->>'cropCycleId','')::uuid;
  exception when invalid_text_representation then
    v_cycle_id:=null;
  end;
  if v_cycle_id is null then v_cycle_id:=atlas.resolve_transplant_readiness_crop_cycle_v1(v_task.id); end if;
  v_subject:=coalesce(nullif(v_cue.result_contract->>'subject',''),nullif(v_task.metadata->>'variety',''),nullif(v_task.metadata->>'crop',''),'seedlings');
  v_service_day:=greatest(v_cue.service_date,current_date);
  v_readiness:=lower(coalesce(nullif(btrim(p_response->>'readiness'),''),''));
  v_condition:=lower(coalesce(nullif(btrim(p_response->>'condition'),''),''));

  if v_readiness not in ('ready','not_ready','already_planted','problem') then
    raise exception 'Choose the current seedling state.' using errcode='22023';
  end if;
  if nullif(p_response->>'surviving_count','') is not null then
    begin
      v_count:=(p_response->>'surviving_count')::integer;
    exception when invalid_text_representation then
      raise exception 'Ready seedling count must be a whole number.' using errcode='22023';
    end;
    if v_count<0 then raise exception 'Ready seedling count cannot be negative.' using errcode='22023'; end if;
  end if;
  if v_readiness='ready' then
    if v_condition not in ('all_great','struggling','record_number') then
      raise exception 'Record how the seedlings made it.' using errcode='22023';
    end if;
    if v_condition='record_number' and (v_count is null or v_count<1) then
      raise exception 'Enter the ready seedling count.' using errcode='22023';
    end if;
  end if;

  v_observation:=jsonb_strip_nulls(jsonb_build_object(
    'readiness',v_readiness,
    'condition',nullif(v_condition,''),
    'ready_count',v_count,
    'observed_date',v_service_day,
    'recorded_at',now(),
    'source','worker_day_cue',
    'cue_id',v_cue.id,
    'actor_user_id',auth.uid(),
    'actor_membership_id',v_cue.membership_id
  ));

  update atlas.tasks task
    set metadata=coalesce(task.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'latest_field_transplant_readiness_observation',v_observation,
        'field_transplant_readiness_status',v_readiness,
        'field_transplant_readiness_condition',nullif(v_condition,''),
        'field_transplant_ready_seedlings',v_count,
        'observation_delivery_mode','day_cue',
        'readiness_target','field_transplant'
      ),
      updated_at=now()
  where task.id=v_task.id;

  if v_cycle_id is not null then
    insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source)
    values(v_task.id,v_cycle_id,'observes','confirmed','field_transplant_readiness_cue')
    on conflict do nothing;

    update atlas.crop_cycles cc
      set cycle_state=case
          when v_readiness='ready' then 'transplant_ready'
          when v_readiness='already_planted' then 'transplanted_location_unconfirmed'
          else cc.cycle_state end,
          metadata=coalesce(cc.metadata,'{}'::jsonb)
            || jsonb_build_object(
              'latest_field_transplant_readiness_observation',v_observation,
              'field_transplant_readiness_status',v_readiness
            ),
          updated_at=now()
    where cc.id=v_cycle_id and cc.farm_id=v_cue.farm_id;
  end if;

  if v_readiness='not_ready' then
    v_next_day:=atlas.next_worker_day_v1(v_cue.farm_id,v_cue.membership_id,v_service_day);
    insert into atlas.worker_day_cues(
      organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
      scheduled_at,title,body,payload,result_contract,status,recovery_policy,
      available_from,expires_at,created_by_user_id
    )
    select
      v_cue.organization_id,v_cue.farm_id,v_cue.membership_id,v_next_day,
      v_cue.cue_kind,'first_open',null,null,
      v_cue.title,coalesce(nullif(v_cue.payload->>'recoveryPrompt',''),v_cue.body),
      v_cue.payload,v_cue.result_contract,'available','refresh',null,null,v_cue.created_by_user_id
    where not exists (
      select 1 from atlas.worker_day_cues existing
      where existing.farm_id=v_cue.farm_id
        and existing.membership_id=v_cue.membership_id
        and existing.service_date=v_next_day
        and existing.status not in ('resolved','dismissed')
        and existing.result_contract->>'kind'='field_transplant_readiness_gate_v1'
        and existing.result_contract->>'taskId'=v_task.id::text
    )
    returning id into v_next_cue_id;

    return jsonb_build_object(
      'applied',true,
      'kind','field_transplant_readiness_gate_v1',
      'farmState','not_ready',
      'cropCycleId',v_cycle_id,
      'nextObservationDay',v_next_day,
      'nextCueId',v_next_cue_id
    );
  end if;

  if v_readiness='problem' then
    update atlas.tasks
      set status='blocked',
          visibility_scope='management',
          blocker_text='A field-transplant readiness problem was reported for '||v_subject||'.',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('field_transplant_readiness_problem_reported',true),
          updated_at=now()
    where id=v_task.id;

    return jsonb_build_object(
      'applied',true,
      'kind','field_transplant_readiness_gate_v1',
      'farmState','problem_reported',
      'cropCycleId',v_cycle_id
    );
  end if;

  v_transition_result:=atlas.record_task_transition_v1_internal(
    p_task_id=>v_task.id,
    p_transition=>'done',
    p_idempotency_key=>'field-transplant-readiness-cue:'||v_cue.id::text||':'||v_readiness,
    p_target_date=>null,
    p_note=>null,
    p_reason=>null,
    p_lane_key=>coalesce(v_task.action_key,'transplant_readiness'),
    p_work_key=>'field_transplant_readiness',
    p_payload=>jsonb_build_object(
      'completion_source','day_cue_observation',
      'day_cue_id',v_cue.id,
      'readiness',v_readiness,
      'condition',nullif(v_condition,''),
      'ready_count',v_count,
      'crop_cycle_id',v_cycle_id,
      'observed_date',v_service_day
    ),
    p_existing_field_log_id=>null
  );

  return jsonb_build_object(
    'applied',true,
    'kind','field_transplant_readiness_gate_v1',
    'farmState',case when v_readiness='ready' then 'transplant_ready' else 'already_planted_location_unconfirmed' end,
    'cropCycleId',v_cycle_id,
    'transition',v_transition_result,
    'taskReleased',false,
    'releaseReason','A planting move still needs a truthful destination and any remaining farm-state gates.'
  );
end;
$function$;

revoke all on function atlas.apply_worker_day_field_transplant_readiness_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function atlas.apply_worker_day_field_transplant_readiness_v1(uuid,jsonb) to service_role;

-- Preserve the already-deployed pot-up contract as a historical helper, then
-- put a small dispatcher back under the canonical internal function name.
alter function atlas.apply_worker_day_cue_result_contract_v1(uuid,jsonb)
  rename to apply_worker_day_pot_up_readiness_contract_v1;

revoke all on function atlas.apply_worker_day_pot_up_readiness_contract_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function atlas.apply_worker_day_pot_up_readiness_contract_v1(uuid,jsonb) to service_role;

create or replace function atlas.apply_worker_day_cue_result_contract_v1(
  p_cue_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_kind text;
begin
  select nullif(cue.result_contract->>'kind','') into v_kind
  from atlas.worker_day_cues cue
  where cue.id=p_cue_id;

  if v_kind='field_transplant_readiness_gate_v1' then
    return atlas.apply_worker_day_field_transplant_readiness_v1(p_cue_id,p_response);
  end if;
  return atlas.apply_worker_day_pot_up_readiness_contract_v1(p_cue_id,p_response);
end;
$function$;

revoke all on function atlas.apply_worker_day_cue_result_contract_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function atlas.apply_worker_day_cue_result_contract_v1(uuid,jsonb) to service_role;

-- Backfill only still-open generated readiness sources. The task remains the
-- internal provenance object; the worker receives the observation cue.
update atlas.tasks task
set metadata=coalesce(task.metadata,'{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'crop_cycle_id',atlas.resolve_transplant_readiness_crop_cycle_v1(task.id),
      'readiness_target','field_transplant',
      'observation_delivery_mode','day_cue'
    )),
    updated_at=now()
where task.task_type='transplant_readiness'
  and task.status='open'
  and task.assigned_membership_id is not null;

select atlas.sync_task_crop_cycle_links_v1(task.id)
from atlas.tasks task
where task.task_type='transplant_readiness'
  and task.status='open'
  and task.assigned_membership_id is not null;

select atlas.sync_transplant_readiness_day_cue_v1(task.id)
from atlas.tasks task
where task.task_type='transplant_readiness'
  and task.status='open'
  and task.assigned_membership_id is not null;
