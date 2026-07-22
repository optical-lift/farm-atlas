create or replace function atlas.sync_production_care_policies_v1(p_production_lot_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_farm_id uuid;
  v_water_due boolean;
  v_weed_due boolean;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  select farm_id into v_farm_id from atlas.production_lots where id=p_production_lot_id;
  if v_farm_id is null then raise exception 'Production lot was not found' using errcode='P0002'; end if;

  select
    coalesce(bool_or(water_status='needs_water'),false),
    coalesce(bool_or(weed_pressure in ('moderate','heavy')),false)
  into v_water_due,v_weed_due
  from atlas.production_field_care_state
  where production_lot_id=p_production_lot_id
    and establishment_status<>'failed';

  insert into atlas.production_care_policies(
    farm_id,production_lot_id,care_kind,policy_status,
    required_before_harvest,current_status,last_satisfied_at,metadata
  ) values(
    v_farm_id,p_production_lot_id,'watering','monitor',true,
    case when v_water_due then 'needs_attention' else 'satisfied' end,
    case when v_water_due then null else v_today end,
    jsonb_build_object('source','field_care_state','current_need',v_water_due)
  )
  on conflict(production_lot_id,care_kind) do update set
    policy_status='monitor',
    required_before_harvest=true,
    current_status=case when v_water_due then 'needs_attention' else 'satisfied' end,
    last_satisfied_at=case when v_water_due then atlas.production_care_policies.last_satisfied_at else v_today end,
    metadata=atlas.production_care_policies.metadata||jsonb_build_object('source','field_care_state','current_need',v_water_due),
    updated_at=now();

  insert into atlas.production_care_policies(
    farm_id,production_lot_id,care_kind,policy_status,
    required_before_harvest,current_status,last_satisfied_at,metadata
  ) values(
    v_farm_id,p_production_lot_id,'weeding','monitor',true,
    case when v_weed_due then 'needs_attention' else 'satisfied' end,
    case when v_weed_due then null else v_today end,
    jsonb_build_object('source','field_care_state','current_need',v_weed_due)
  )
  on conflict(production_lot_id,care_kind) do update set
    policy_status='monitor',
    required_before_harvest=true,
    current_status=case when v_weed_due then 'needs_attention' else 'satisfied' end,
    last_satisfied_at=case when v_weed_due then atlas.production_care_policies.last_satisfied_at else v_today end,
    metadata=atlas.production_care_policies.metadata||jsonb_build_object('source','field_care_state','current_need',v_weed_due),
    updated_at=now();
end; $$;

create or replace function atlas.refresh_production_harvest_gate_v1(p_production_lot_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_lot atlas.production_lots%rowtype;
  v_rule atlas.production_harvest_rules%rowtype;
  v_gate atlas.production_harvest_gates%rowtype;
  v_expected integer:=0;
  v_established integer:=0;
  v_alive numeric:=0;
  v_required_policies integer:=0;
  v_satisfied_policies integer:=0;
  v_unsatisfied text;
  v_status text;
  v_blocker text;
  v_owner_task atlas.tasks%rowtype;
  v_harvest_task atlas.tasks%rowtype;
  v_visibility text:='assigned_worker';
  v_membership uuid;
  v_transition jsonb;
  v_today date:=(now() at time zone 'America/Chicago')::date;
begin
  select * into v_lot from atlas.production_lots where id=p_production_lot_id for update;
  if v_lot.id is null then raise exception 'Production lot was not found' using errcode='P0002'; end if;

  select
    count(*) filter(where stand_status<>'cleared'),
    count(*) filter(where stand_status in ('established','field_care','harvest_watch','declining')),
    coalesce(sum(current_plants) filter(where stand_status<>'cleared'),0)
  into v_expected,v_established,v_alive
  from atlas.production_field_stands
  where production_lot_id=v_lot.id;

  select * into v_rule from atlas.production_harvest_rules where production_lot_id=v_lot.id;

  select
    count(*) filter(where required_before_harvest and policy_status<>'not_required'),
    count(*) filter(where required_before_harvest and (policy_status='not_required' or current_status in ('satisfied','not_required'))),
    string_agg(
      case when required_before_harvest
              and policy_status<>'not_required'
              and current_status not in ('satisfied','not_required')
        then initcap(care_kind)||' is '||replace(current_status,'_',' ')
      end,
      ' · ' order by care_kind
    )
  into v_required_policies,v_satisfied_policies,v_unsatisfied
  from atlas.production_care_policies
  where production_lot_id=v_lot.id;

  select t.visibility_scope,t.assigned_membership_id
  into v_visibility,v_membership
  from atlas.production_lot_tasks plt
  join atlas.tasks t on t.id=plt.task_id
  where plt.production_lot_id=v_lot.id
    and plt.link_role in ('establishment_check','water_care','weed_care','pinch_care')
  order by t.created_at desc
  limit 1;
  v_visibility:=coalesce(v_visibility,'assigned_worker');

  if v_expected=0 or v_established<v_expected then
    v_status:='waiting_establishment';
    v_blocker:=(v_expected-v_established)::text||' field bed(s) still need counted establishment.';
  elsif v_alive<=0 then
    v_status:='failed';
    v_blocker:='No living plants remain in the field cohort.';
  elsif v_rule.id is null
     or v_rule.pinch_required is null
     or v_rule.harvest_watch_start is null
     or v_rule.harvest_watch_end is null
  then
    v_status:='waiting_rules';
    v_blocker:='Owner must confirm whether pinching is required and set the harvest-watch window.';
  elsif v_required_policies<>v_satisfied_policies then
    v_status:='waiting_care';
    v_blocker:=coalesce(v_unsatisfied,'Required crop care is not current.');
  else
    v_status:='ready_for_watch';
    v_blocker:=null;
  end if;

  insert into atlas.production_harvest_gates(
    farm_id,production_lot_id,gate_status,blocker_text,
    established_beds,expected_beds,plants_alive,ready_at,refresh_version,metadata
  ) values(
    v_lot.farm_id,v_lot.id,v_status,v_blocker,
    v_established,v_expected,v_alive,
    case when v_status='ready_for_watch' then now() end,
    1,
    jsonb_build_object(
      'required_care_policies',v_required_policies,
      'satisfied_care_policies',v_satisfied_policies,
      'unsatisfied_care',v_unsatisfied
    )
  )
  on conflict(production_lot_id) do update set
    gate_status=case
      when atlas.production_harvest_gates.gate_status in ('harvest_watch','harvest_ready')
        and excluded.gate_status='ready_for_watch'
      then atlas.production_harvest_gates.gate_status
      else excluded.gate_status
    end,
    blocker_text=excluded.blocker_text,
    established_beds=excluded.established_beds,
    expected_beds=excluded.expected_beds,
    plants_alive=excluded.plants_alive,
    ready_at=case
      when excluded.gate_status='ready_for_watch'
      then coalesce(atlas.production_harvest_gates.ready_at,now())
      else null
    end,
    refresh_version=atlas.production_harvest_gates.refresh_version+1,
    metadata=atlas.production_harvest_gates.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_gate;

  if v_status='waiting_rules' then
    select * into v_owner_task from atlas.tasks where id=v_gate.owner_decision_task_id;
    if v_owner_task.id is null then
      insert into atlas.tasks(
        farm_id,title,task_type,status,priority,due_date,
        generated_from,generated_from_id,note,metadata,
        action_key,work_class,task_series_key,engine_instance_key,visibility_scope
      ) values(
        v_lot.farm_id,
        'Owner — Set pinch + harvest rules — '||v_lot.lot_label,
        'owner_decision','open','high',v_today,
        'production_harvest_gate',v_gate.id,
        'Confirm whether this crop cohort must be pinched and enter a real harvest-watch window before Atlas generates harvest work.',
        jsonb_build_object(
          'task_key','production_harvest_rules_'||v_gate.id::text,
          'owner_task',true,'anna_task',false,
          'production_lot_id',v_lot.id,
          'production_lot_key',v_lot.stable_key,
          'production_harvest_gate_id',v_gate.id,
          'display_action','Set rules',
          'display_subject',v_lot.lot_label,
          'display_detail','Pinch requirement + harvest window',
          'collection_zone','Owner','assigned_to','Owner'
        ),
        'decide','light',
        'production-lot:'||v_lot.stable_key||':harvest-rules',
        'production-harvest-rules:'||v_gate.id::text,
        'owner'
      ) returning * into v_owner_task;
      update atlas.production_harvest_gates
      set owner_decision_task_id=v_owner_task.id
      where id=v_gate.id;
      insert into atlas.production_lot_tasks(
        production_lot_id,task_id,link_role,source,metadata
      ) values(
        v_lot.id,v_owner_task.id,'harvest_rules_decision',
        'production_stage_engine',jsonb_build_object('harvest_gate_id',v_gate.id)
      );
    end if;
  end if;

  if v_status='ready_for_watch' then
    select * into v_harvest_task
    from atlas.tasks
    where id=coalesce(v_gate.harvest_readiness_task_id,v_gate.harvest_task_id);
    if v_harvest_task.id is null then
      insert into atlas.tasks(
        farm_id,title,task_type,status,priority,due_date,
        generated_from,generated_from_id,note,metadata,
        action_key,work_class,task_series_key,engine_instance_key,
        visibility_scope,assigned_membership_id
      ) values(
        v_lot.farm_id,
        'Open harvest readiness — '||v_lot.lot_label,
        'production_harvest_readiness','open','high',v_rule.harvest_watch_start,
        'production_harvest_gate',v_gate.id,
        'Inspect this exact field cohort for cut stage. Do not record harvest until marketable stems are counted.',
        jsonb_build_object(
          'task_key','production_harvest_readiness_'||v_gate.id::text,
          'task_style','production_harvest_readiness',
          'production_lot_id',v_lot.id,
          'production_lot_key',v_lot.stable_key,
          'production_harvest_gate_id',v_gate.id,
          'harvest_watch_start',v_rule.harvest_watch_start,
          'harvest_watch_end',v_rule.harvest_watch_end,
          'plants_alive',v_alive,
          'display_action','Inspect',
          'display_subject',v_lot.lot_label||' harvest readiness',
          'display_detail',v_alive::text||' living plants',
          'collection_zone','Production beds'
        ),
        'harvest','standard',
        'production-lot:'||v_lot.stable_key||':harvest-readiness',
        'production-harvest-readiness:'||v_gate.id::text,
        v_visibility,v_membership
      ) returning * into v_harvest_task;

      update atlas.production_harvest_gates
      set harvest_readiness_task_id=v_harvest_task.id,
          harvest_task_id=v_harvest_task.id,
          gate_status='harvest_watch'
      where id=v_gate.id;

      insert into atlas.production_lot_tasks(
        production_lot_id,task_id,link_role,source,metadata
      ) values(
        v_lot.id,v_harvest_task.id,'harvest_readiness',
        'production_stage_engine',jsonb_build_object('harvest_gate_id',v_gate.id)
      );

      insert into atlas.task_objects(task_id,object_id,role)
      select v_harvest_task.id,object_id,'target'
      from atlas.production_field_stands
      where production_lot_id=v_lot.id
        and current_plants>0
        and stand_status<>'cleared'
      on conflict do nothing;

      insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
      select
        v_harvest_task.id,crop_cycle_id,'observes','confirmed',
        'production_stage_engine',jsonb_build_object('harvest_gate_id',v_gate.id)
      from atlas.production_field_stands
      where production_lot_id=v_lot.id
        and current_plants>0
        and stand_status<>'cleared'
      on conflict do nothing;
      v_status:='harvest_watch';
    elsif v_harvest_task.status='blocked' then
      v_transition:=atlas.record_task_transition_v1_internal(
        v_harvest_task.id,'rescheduled',
        left('production-harvest-gate-ready:'||v_gate.id::text||':'||v_gate.refresh_version::text,160),
        v_rule.harvest_watch_start,
        'Field cohort is established, care-current, and inside a confirmed harvest-watch plan.',
        null,'harvest','production_lot',
        jsonb_build_object('production_lot_id',v_lot.id,'harvest_gate_id',v_gate.id),
        null
      );
      update atlas.production_harvest_gates
      set gate_status='harvest_watch'
      where id=v_gate.id;
      v_status:='harvest_watch';
    end if;
  elsif coalesce(v_gate.harvest_readiness_task_id,v_gate.harvest_task_id) is not null then
    select * into v_harvest_task
    from atlas.tasks
    where id=coalesce(v_gate.harvest_readiness_task_id,v_gate.harvest_task_id);
    if v_harvest_task.status='open' then
      v_transition:=atlas.record_task_transition_v1_internal(
        v_harvest_task.id,'blocked',
        left('production-harvest-gate-blocked:'||v_gate.id::text||':'||v_gate.refresh_version::text,160),
        null,v_blocker,v_blocker,'harvest','production_lot',
        jsonb_build_object(
          'production_lot_id',v_lot.id,
          'harvest_gate_id',v_gate.id,
          'gate_status',v_status
        ),
        null
      );
    end if;
  end if;

  return jsonb_build_object(
    'productionLotId',v_lot.id,
    'harvestGateId',v_gate.id,
    'gateStatus',v_status,
    'blocker',v_blocker,
    'expectedBeds',v_expected,
    'establishedBeds',v_established,
    'plantsAlive',v_alive,
    'requiredCarePolicies',v_required_policies,
    'satisfiedCarePolicies',v_satisfied_policies,
    'unsatisfiedCare',v_unsatisfied,
    'ownerDecisionTaskId',v_owner_task.id,
    'harvestTaskId',v_harvest_task.id
  );
end; $$;