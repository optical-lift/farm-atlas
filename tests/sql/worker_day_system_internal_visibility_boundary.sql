-- Database acceptance specimen for the Worker Day system_internal visibility boundary.
-- This script creates only synthetic rows and always rolls them back.
-- It deliberately exercises the real Day-cue result contract rather than granting
-- direct Farm Hand completion access to internal source tasks.

begin;

do $contract$
declare
  v_farm uuid;
  v_org uuid;
  v_membership uuid;
  v_user uuid;
  v_day date;
  v_ready_task uuid := gen_random_uuid();
  v_not_ready_task uuid := gen_random_uuid();
  v_ready_cycle uuid := gen_random_uuid();
  v_not_ready_cycle uuid := gen_random_uuid();
  v_ready_cue uuid := gen_random_uuid();
  v_not_ready_cue uuid := gen_random_uuid();
  v_plan jsonb;
  v_bundle jsonb;
  v_choreo jsonb;
  v_cards jsonb;
  v_next_day date;
begin
  select fm.farm_id, f.organization_id, fm.id, fm.user_id
    into v_farm, v_org, v_membership, v_user
  from atlas.farm_memberships fm
  join atlas.farms f on f.id=fm.farm_id
  where fm.active=true and fm.role='farm_hand' and fm.user_id is not null
  order by fm.created_at
  limit 1;

  if v_membership is null then
    raise exception 'An active Farm Hand membership is required for this contract test.';
  end if;

  v_day := atlas.next_worker_day_v1(v_farm,v_membership,current_date);

  insert into atlas.crop_cycles(id,farm_id,crop_cycle_key,crop_label,variety,cycle_state,lifecycle_status,metadata)
  values
    (v_ready_cycle,v_farm,'acceptance-system-internal-ready-'||v_ready_cycle::text,'Acceptance readiness','Ready specimen','planned','complete','{}'::jsonb),
    (v_not_ready_cycle,v_farm,'acceptance-system-internal-not-ready-'||v_not_ready_cycle::text,'Acceptance readiness','Not-ready specimen','planned','complete','{}'::jsonb);

  insert into atlas.tasks(
    id,organization_id,farm_id,assigned_membership_id,title,task_type,status,due_date,
    visibility_scope,task_scope,origin_kind,work_lane,commitment_kind,metadata
  ) values
    (v_ready_task,v_org,v_farm,v_membership,'Acceptance internal readiness — ready','transplant_readiness','open',v_day,
      'system_internal','farm_operation','generated','required','hard_date',
      jsonb_build_object('observation_delivery_mode','day_cue','variety','Ready specimen','crop_cycle_id',v_ready_cycle)),
    (v_not_ready_task,v_org,v_farm,v_membership,'Acceptance internal readiness — not ready','transplant_readiness','open',v_day,
      'system_internal','farm_operation','generated','required','hard_date',
      jsonb_build_object('observation_delivery_mode','day_cue','variety','Not-ready specimen','crop_cycle_id',v_not_ready_cycle));

  insert into atlas.worker_day_cues(
    id,organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,title,body,payload,result_contract,status,recovery_policy
  ) values
    (v_ready_cue,v_org,v_farm,v_membership,v_day,'observation','first_open','Acceptance ready cue','Synthetic readiness observation','{}'::jsonb,
      jsonb_build_object('kind','field_transplant_readiness_gate_v1','taskId',v_ready_task,'cropCycleId',v_ready_cycle,'subject','Ready specimen'),'available','refresh'),
    (v_not_ready_cue,v_org,v_farm,v_membership,v_day,'observation','first_open','Acceptance not-ready cue','Synthetic readiness observation','{}'::jsonb,
      jsonb_build_object('kind','field_transplant_readiness_gate_v1','taskId',v_not_ready_task,'cropCycleId',v_not_ready_cycle,'subject','Not-ready specimen'),'available','refresh');

  v_plan := atlas.owner_worker_day_plan_v1(v_farm,v_membership,v_day);
  if exists(select 1 from jsonb_array_elements(v_plan->'realWork') x where x->>'taskId' in (v_ready_task::text,v_not_ready_task::text)) then
    raise exception 'system_internal source leaked through base Worker Day realWork';
  end if;

  insert into atlas.worker_day_task_placements(
    organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,placement_source,state
  ) values (v_org,v_farm,v_membership,v_ready_task,v_day,'morning',1,'owner','placed');

  v_plan := atlas.owner_worker_day_plan_choreographed_v1(v_farm,v_membership,v_day);
  if exists(select 1 from jsonb_array_elements(v_plan->'realWork') x where x->>'taskId'=v_ready_task::text) then
    raise exception 'explicit placement resurrected system_internal source';
  end if;

  perform set_config('request.jwt.claim.sub',v_user::text,true);

  v_plan := atlas.worker_self_day_plan_api_v1(v_farm,v_membership,v_day);
  if exists(select 1 from jsonb_array_elements(v_plan->'realWork') x where x->>'taskId' in (v_ready_task::text,v_not_ready_task::text)) then
    raise exception 'Farm Hand self plan leaked system_internal source';
  end if;

  v_bundle := atlas.worker_self_day_bundle_api_v1(v_farm,v_membership,v_day);
  if exists(select 1 from jsonb_array_elements(v_bundle->'plan'->'realWork') x where x->>'taskId' in (v_ready_task::text,v_not_ready_task::text)) then
    raise exception 'Farm Hand bundle plan leaked system_internal source';
  end if;
  if exists(select 1 from jsonb_array_elements(v_bundle->'taskCards') x where x->>'task_id' in (v_ready_task::text,v_not_ready_task::text)) then
    raise exception 'Farm Hand bundle cards leaked system_internal source';
  end if;

  v_cards := atlas.worker_day_operational_task_cards_v2(v_farm,v_membership,v_day,array[v_ready_task,v_not_ready_task]);
  if jsonb_array_length(v_cards)<>0 then
    raise exception 'explicit card hydration returned system_internal source';
  end if;

  v_choreo := atlas.worker_day_choreography_api_v1(v_farm,v_membership,v_day);
  if not exists(select 1 from jsonb_array_elements(v_choreo->'cues') x where x->>'cueId'=v_ready_cue::text and x->>'status'='available') then
    raise exception 'ready source cue disappeared from Day choreography';
  end if;
  if not exists(select 1 from jsonb_array_elements(v_choreo->'cues') x where x->>'cueId'=v_not_ready_cue::text and x->>'status'='available') then
    raise exception 'not-ready source cue disappeared from Day choreography';
  end if;

  perform atlas.worker_resolve_day_cue_api_v1(v_ready_cue,jsonb_build_object('readiness','ready','condition','all_great'));
  if (select status from atlas.tasks where id=v_ready_task)<>'done' then
    raise exception 'ready cue did not complete internal source task';
  end if;
  if (select metadata->'latest_field_transplant_readiness_observation'->>'readiness' from atlas.tasks where id=v_ready_task)<>'ready' then
    raise exception 'ready cue did not write readiness observation metadata';
  end if;
  if (select cycle_state from atlas.crop_cycles where id=v_ready_cycle)<>'transplant_ready' then
    raise exception 'ready cue did not advance crop cycle';
  end if;
  if (select status from atlas.worker_day_cues where id=v_ready_cue)<>'resolved' then
    raise exception 'ready cue did not resolve';
  end if;

  perform atlas.worker_resolve_day_cue_api_v1(v_not_ready_cue,jsonb_build_object('readiness','not_ready'));
  if (select status from atlas.tasks where id=v_not_ready_task)<>'open' then
    raise exception 'not-ready cue incorrectly closed internal source task';
  end if;
  if (select metadata->'latest_field_transplant_readiness_observation'->>'readiness' from atlas.tasks where id=v_not_ready_task)<>'not_ready' then
    raise exception 'not-ready cue did not write observation metadata';
  end if;
  if (select status from atlas.worker_day_cues where id=v_not_ready_cue)<>'resolved' then
    raise exception 'not-ready current cue did not resolve';
  end if;

  v_next_day := atlas.next_worker_day_v1(v_farm,v_membership,greatest(v_day,current_date));
  if not exists(
    select 1 from atlas.worker_day_cues c
    where c.farm_id=v_farm and c.membership_id=v_membership and c.service_date=v_next_day
      and c.status='available' and c.anchor_kind='first_open'
      and c.result_contract->>'kind'='field_transplant_readiness_gate_v1'
      and c.result_contract->>'taskId'=v_not_ready_task::text
  ) then
    raise exception 'not-ready cue did not generate the next worker-day observation';
  end if;
end;
$contract$;

rollback;
