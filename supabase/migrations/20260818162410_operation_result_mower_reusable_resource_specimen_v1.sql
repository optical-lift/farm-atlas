alter table atlas.growing_object_relationships
  drop constraint if exists growing_object_relationships_relationship_type_check;
alter table atlas.growing_object_relationships
  add constraint growing_object_relationships_relationship_type_check
  check (relationship_type in ('contains','adjacent','destination','travels_with'));

create unique index if not exists growing_object_travels_with_symmetric_uq
  on atlas.growing_object_relationships(
    farm_id,
    least(parent_object_id,child_object_id),
    greatest(parent_object_id,child_object_id)
  ) where relationship_type='travels_with';

insert into atlas.resources(
  farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,consumable,borrow_or_owner,metadata
)
select
  f.id,'battery_push_mower_battery_set','Battery Push Mower · Two-Battery Working Set',
  'equipment','power','unknown',1,'battery_set',false,'owner',
  jsonb_build_object(
    'generic_event_state_enabled',true,
    'resource_role','reusable_energy_set',
    'battery_count',2,
    'working_set_semantics','two_batteries_used_together_as_one_working_set',
    'readiness_authority','atlas.resource_operational_state',
    'governing_contract','operation_result_state_transition_or2'
  )
from atlas.farms f
where f.id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
on conflict(farm_id,stable_key) do update set
  label=excluded.label,
  resource_type=excluded.resource_type,
  resource_category=excluded.resource_category,
  consumable=false,
  metadata=coalesce(atlas.resources.metadata,'{}'::jsonb)||excluded.metadata,
  updated_at=now();

insert into atlas.resource_operational_state(
  resource_id,farm_id,readiness_state,quantity_state,known_quantity,unit,state_reason
)
select r.id,r.farm_id,'unknown','not_applicable',null,'battery_set',
       jsonb_build_object(
         'source','or2_initial_truth_boundary',
         'reason','No current witness establishes charged readiness; unknown must remain unknown until confirmed.'
       )
from atlas.resources r
where r.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and r.stable_key='battery_push_mower_battery_set'
on conflict(resource_id) do nothing;

update atlas.growing_objects go
set metadata=coalesce(go.metadata,'{}'::jsonb)||jsonb_build_object(
      'equipment_group','Battery push mower',
      'target_cut_height_inches',3,
      'battery_resource_key','battery_push_mower_battery_set',
      'operation_result_membrane','or2_mower_reusable_resource_v1',
      'mower_truth_corrected_at',now(),
      'mower_truth_reason','August 18 governing Operation → Result → State Transition amendment: battery-push mowing specimen uses one two-battery working set and a 3-inch target cut height.'
    ),
    updated_at=now()
where go.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and go.stable_key in (
    'mowing_field_rows_front_half','mowing_field_rows_back_half',
    'mowing_follow_me_paths_edges','mowing_curve_garden_edges'
  );

update atlas.mowing_area_state mas
set equipment_group='Battery push mower',
    target_cut_height_inches=3,
    metadata=coalesce(mas.metadata,'{}'::jsonb)||jsonb_build_object(
      'battery_resource_key','battery_push_mower_battery_set',
      'operation_result_membrane','or2_mower_reusable_resource_v1'
    ),
    updated_at=now()
where mas.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and mas.object_id in (
    select go.id from atlas.growing_objects go
    where go.farm_id=mas.farm_id
      and go.stable_key in (
        'mowing_field_rows_front_half','mowing_field_rows_back_half',
        'mowing_follow_me_paths_edges','mowing_curve_garden_edges'
      )
  );

insert into atlas.growing_object_relationships(
  farm_id,parent_object_id,child_object_id,relationship_type,position_label,sort_order,metadata
)
select
  f.id,follow.id,curve.id,'travels_with','same battery mowing packet',0,
  jsonb_build_object(
    'affinity_key','battery_push_mower:follow_me_curve',
    'shared_resource_key','battery_push_mower_battery_set',
    'shared_effect','one_full_charge_per_local_service_day',
    'relation_semantics','scheduling_affinity_only',
    'does_not_imply_prerequisite',true,
    'does_not_share_completion',true,
    'does_not_merge_task_identity',true,
    'governing_contract','operation_result_state_transition_or2'
  )
from atlas.farms f
join atlas.growing_objects follow on follow.farm_id=f.id and follow.stable_key='mowing_follow_me_paths_edges'
join atlas.growing_objects curve on curve.farm_id=f.id and curve.stable_key='mowing_curve_garden_edges'
where f.id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
on conflict(parent_object_id,child_object_id,relationship_type) do update set
  position_label=excluded.position_label,
  metadata=coalesce(atlas.growing_object_relationships.metadata,'{}'::jsonb)||excluded.metadata,
  updated_at=now();

create or replace function atlas.mowing_travel_affinity_v1(p_object_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'pg_catalog','atlas'
as $$
  select coalesce((
    select jsonb_build_object(
      'state','travels_with',
      'relationshipId',rel.id,
      'affinityKey',rel.metadata->>'affinity_key',
      'sharedResourceKey',rel.metadata->>'shared_resource_key',
      'sharedEffect',rel.metadata->>'shared_effect',
      'otherObjectId',case when rel.parent_object_id=p_object_id then rel.child_object_id else rel.parent_object_id end,
      'truthBoundary',jsonb_build_object(
        'isPrerequisite',false,'sharesCompletion',false,'mergesTaskIdentity',false,'schedulingAffinityOnly',true
      )
    )
    from atlas.growing_object_relationships rel
    where rel.relationship_type='travels_with'
      and p_object_id in (rel.parent_object_id,rel.child_object_id)
    order by rel.created_at,rel.id
    limit 1
  ),jsonb_build_object('state','independent_operation'));
$$;

create or replace function atlas.normalize_clock_mowing_card_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_object atlas.growing_objects%rowtype;
  v_state_id uuid;
  v_equipment text;
  v_height_text text;
  v_height_label text;
  v_required_keys jsonb;
begin
  v_state_id:=atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');

  if coalesce(new.metadata->>'rhythm_key','')='mowing' and v_state_id is not null then
    select go.* into v_object
    from atlas.rhythm_state rs
    join atlas.growing_objects go on go.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='growing_object';

    if v_object.id is not null then
      v_equipment:=nullif(v_object.metadata->>'equipment_group','');
      v_height_text:=nullif(v_object.metadata->>'target_cut_height_inches','');

      if lower(replace(coalesce(v_equipment,''),'_',' ')) in ('push mower','battery push mower') then
        v_equipment:='Battery push mower';
        v_height_text:='3';
        v_required_keys:=case
          when jsonb_typeof(coalesce(new.metadata->'required_resource_keys','[]'::jsonb))='array'
            then coalesce(new.metadata->'required_resource_keys','[]'::jsonb)
          else '[]'::jsonb end;
        if not (v_required_keys ? 'battery_push_mower_battery_set') then
          v_required_keys:=v_required_keys||jsonb_build_array('battery_push_mower_battery_set');
        end if;
        new.metadata:=jsonb_set(coalesce(new.metadata,'{}'::jsonb),'{required_resource_keys}',v_required_keys,true);
      end if;

      if v_height_text ~ '^\d+(\.\d+)?$' then
        v_height_label:=to_char(v_height_text::numeric,'FM999990.##');
      else
        v_height_label:=v_height_text;
      end if;

      new.title:='Mow — '||coalesce(nullif(v_object.label,''),'Mowing route');
      new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
        'display_action','Mow',
        'display_subject',coalesce(nullif(v_object.label,''),'Mowing route'),
        'display_detail',case
          when v_equipment is not null and v_height_label is not null then v_equipment||' · target '||v_height_label||' in'
          when v_equipment is not null then v_equipment
          when v_height_label is not null then 'Target '||v_height_label||' in'
          else null end,
        'equipment_group',v_equipment,
        'target_cut_height_inches',v_height_text,
        'battery_resource_key',case when v_equipment='Battery push mower' then 'battery_push_mower_battery_set' end
      ));
    end if;
  end if;
  return new;
end;
$$;

create or replace function atlas.sync_generated_resource_requirement_status_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $$
declare v_state text;
begin
  if new.status is distinct from old.status then
    select s.readiness_state into v_state
    from atlas.resource_operational_state s
    where s.resource_id=new.id;

    update atlas.task_resource_requirements requirement
    set status=case
          when v_state='ready' then 'available'
          when v_state='unknown' then 'needs_check'
          when v_state is not null then 'needed'
          when new.status='available' then 'available'
          else 'needed'
        end,
        updated_at=now()
    where requirement.resource_id=new.id
      and requirement.requirement_role='required'
      and requirement.requirement_source='system_generated'
      and coalesce(requirement.metadata->>'source','')='task_required_resource_keys_v1';
  end if;
  return new;
end;
$$;

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)
where t.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and t.task_type='mowing'
  and t.status in ('open','blocked')
  and atlas.rhythm_safe_uuid_v1(t.metadata->>'rhythm_state_id') in (
    select rs.id
    from atlas.rhythm_state rs
    join atlas.growing_objects go on go.id=rs.subject_id
    where rs.farm_id=t.farm_id
      and rs.rhythm_key='mowing'
      and go.stable_key in (
        'mowing_field_rows_front_half','mowing_field_rows_back_half',
        'mowing_follow_me_paths_edges','mowing_curve_garden_edges'
      )
  );

update atlas.tasks t
set metadata=jsonb_set(
      coalesce(t.metadata,'{}'::jsonb),'{required_resource_keys}',
      case
        when jsonb_typeof(coalesce(t.metadata->'required_resource_keys','[]'::jsonb))='array'
          and coalesce(t.metadata->'required_resource_keys','[]'::jsonb) ? 'battery_push_mower_battery_set'
          then coalesce(t.metadata->'required_resource_keys','[]'::jsonb)
        when jsonb_typeof(coalesce(t.metadata->'required_resource_keys','[]'::jsonb))='array'
          then coalesce(t.metadata->'required_resource_keys','[]'::jsonb)||jsonb_build_array('battery_push_mower_battery_set')
        else jsonb_build_array('battery_push_mower_battery_set')
      end,true
    )||jsonb_build_object('battery_resource_key','battery_push_mower_battery_set'),
    updated_at=now()
where t.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and t.task_type='mowing'
  and t.status in ('open','blocked')
  and lower(replace(coalesce(t.metadata->>'equipment_group',''),'_',' '))='battery push mower';

update atlas.task_completion_impact_policies p
set acceptable_state_impacts=(
      select array_agg(distinct x order by x)
      from unnest(coalesce(p.acceptable_state_impacts,'{}'::text[])||array['resource_event','resource_state','next_task']) x
    ),
    description=p.description||' OR2: full battery-push mowing may also consume reusable-resource readiness and expose a separate reset continuation.',
    updated_at=now()
where p.action_family in ('mow','mowing');

create or replace function atlas.apply_mowing_resource_effect_v1(
  p_task_id uuid,
  p_mowing_event_id uuid,
  p_effective_membership_id uuid
) returns jsonb
language plpgsql volatile security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_event atlas.mowing_events%rowtype;
  v_task atlas.tasks%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_resource atlas.resources%rowtype;
  v_affinity jsonb;
  v_relation_id uuid;
  v_local_date date;
  v_key text;
  v_result jsonb;
  v_equipment text;
begin
  select * into v_event from atlas.mowing_events where id=p_mowing_event_id;
  if v_event.id is null or v_event.task_id is distinct from p_task_id then
    raise exception 'Mowing result event does not match the task.' using errcode='22023';
  end if;
  if v_event.outcome<>'mowed_full' then
    return jsonb_build_object('state','not_applicable','reason','Only a completed full mowing packet consumes the modeled battery charge.');
  end if;

  select * into v_task from atlas.tasks where id=p_task_id;
  select * into v_object from atlas.growing_objects where id=v_event.object_id;
  if v_task.id is null or v_object.id is null then
    raise exception 'Mowing task or route subject is missing.' using errcode='P0002';
  end if;

  v_equipment:=lower(replace(coalesce(v_object.metadata->>'equipment_group',v_task.metadata->>'equipment_group',''),'_',' '));
  if v_equipment not in ('push mower','battery push mower') then
    return jsonb_build_object('state','not_applicable','reason','This mowing route does not use the battery push mower.');
  end if;

  select * into v_resource
  from atlas.resources
  where farm_id=v_task.farm_id and stable_key='battery_push_mower_battery_set';
  if v_resource.id is null then raise exception 'Battery push mower working-set resource is missing.' using errcode='P0002'; end if;

  v_affinity:=atlas.mowing_travel_affinity_v1(v_object.id);
  v_relation_id:=atlas.rhythm_safe_uuid_v1(v_affinity->>'relationshipId');
  v_local_date:=(v_event.observed_at at time zone 'America/Chicago')::date;

  if v_relation_id is not null then
    v_key:='mowing-charge:affinity:'||v_relation_id::text||':'||v_local_date::text;
  else
    v_key:='mowing-charge:task:'||p_task_id::text;
  end if;

  v_result:=atlas.record_resource_event_v1(
    v_resource.id,'charge_consumed',v_key,p_task_id,'mowing_result',v_event.id,
    p_effective_membership_id,null,null,'full_charge',
    'Full battery-push mowing packet consumed one working-set charge.',
    jsonb_build_object(
      'mowingEventId',v_event.id,'mowingObjectId',v_object.id,'mowingObjectKey',v_object.stable_key,
      'localServiceDate',v_local_date,'affinity',v_affinity,'effectClass','reusable_resource_charge_consumption'
    )
  );

  return v_result||jsonb_build_object(
    'state','charge_consumed','affinity',v_affinity,
    'continuation',atlas.resource_immediate_continuation_v1(v_resource.id),
    'truthBoundary',jsonb_build_object(
      'mowingCompletionRemainsComplete',true,
      'resetIsSeparateOperation',true,
      'sharedAffinityDeduplicatesOneCharge',v_relation_id is not null
    )
  );
end;
$$;

alter function atlas.record_mowing_result_core_v1(uuid,uuid,text,text,integer,date,text,text,boolean)
  rename to record_mowing_result_core_pre_or2_v1;

create or replace function atlas.record_mowing_result_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_outcome text,
  p_completion_percent integer,
  p_recheck_date date,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
) returns jsonb
language plpgsql volatile security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_result jsonb;
  v_effect jsonb:=jsonb_build_object('state','not_applicable');
  v_event_id uuid;
begin
  v_result:=atlas.record_mowing_result_core_pre_or2_v1(
    p_task_id,p_effective_membership_id,p_effective_role,p_outcome,p_completion_percent,
    p_recheck_date,p_note,p_idempotency_key,p_operator_mode
  );

  if p_outcome='mowed_full' then
    v_event_id:=atlas.rhythm_safe_uuid_v1(v_result->>'eventId');
    if v_event_id is not null then
      begin
        v_effect:=atlas.apply_mowing_resource_effect_v1(p_task_id,v_event_id,p_effective_membership_id);
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

  return v_result||jsonb_build_object(
    'resourceEffect',v_effect,
    'immediateContinuation',coalesce(v_effect->'continuation',jsonb_build_object('humanActionRequired',false)),
    'operationResultMembrane','operation_result_state_transition_or2'
  );
end;
$$;

revoke all on function atlas.mowing_travel_affinity_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.apply_mowing_resource_effect_v1(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function atlas.record_mowing_result_core_pre_or2_v1(uuid,uuid,text,text,integer,date,text,text,boolean) from public,anon,authenticated;
revoke all on function atlas.record_mowing_result_core_v1(uuid,uuid,text,text,integer,date,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.mowing_travel_affinity_v1(uuid) to service_role;
grant execute on function atlas.apply_mowing_resource_effect_v1(uuid,uuid,uuid) to service_role;
grant execute on function atlas.record_mowing_result_core_pre_or2_v1(uuid,uuid,text,text,integer,date,text,text,boolean) to service_role;
grant execute on function atlas.record_mowing_result_core_v1(uuid,uuid,text,text,integer,date,text,text,boolean) to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,
  service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values
(
  'atlas.record_resource_reset_for_member_v1(uuid, uuid, text, text, text)','app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Allow an active farm member to record the smallest reusable-resource reset witness: charging started or readiness confirmed.',
    'boundary','Reset confirmation is separate from the completed operation. It cannot retroactively change mowing completion and does not bypass resource readiness.'
  ),now(),now()
),
(
  'atlas.record_resource_event_v1(uuid, text, text, uuid, text, uuid, uuid, numeric, numeric, text, text, jsonb)','service_internal','verified','active',false,true,true,0,0,
  jsonb_build_object(
    'purpose','Internal append-only generic resource event writer for resources without stronger domain ledgers.',
    'boundary','Seed and Harvest remain on their domain-specific ledgers; generic resource events preserve unknown when evidence is insufficient.'
  ),now(),now()
),
(
  'atlas.apply_mowing_resource_effect_v1(uuid, uuid, uuid)','service_internal','verified','active',false,true,true,0,0,
  jsonb_build_object(
    'purpose','Apply the reusable battery-set consequence of a completed battery-push mowing packet.',
    'boundary','Mowing completion remains true if the downstream resource effect needs reconciliation; reset is a separate operation.'
  ),now(),now()
),
(
  'atlas.mowing_travel_affinity_v1(uuid)','service_internal','verified','active',false,true,true,0,0,
  jsonb_build_object(
    'purpose','Read durable mowing-route TRAVELS_WITH affinity without converting affinity into prerequisite or shared completion.',
    'boundary','Scheduling affinity only.'
  ),now(),now()
)
on conflict(signature) do update set
  classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,service_execute_expected=excluded.service_execute_expected,
  evidence=excluded.evidence,reviewed_at=now();

comment on function atlas.apply_mowing_resource_effect_v1(uuid,uuid,uuid) is
'OR2 mower adapter. A full battery-push mowing result consumes one battery working-set charge, deduplicated across a same-day TRAVELS_WITH pair. It does not complete the separate reset operation.';
comment on function atlas.record_mowing_result_core_v1(uuid,uuid,text,text,integer,date,text,text,boolean) is
'Canonical mowing result core after OR2. Preserves mature mowing-domain result semantics, then applies reusable-resource effects through the shared Operation → Result → State Transition membrane.';