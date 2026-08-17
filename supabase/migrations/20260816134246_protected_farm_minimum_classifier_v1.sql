create or replace function atlas.task_protected_farm_minimum_v1(
  p_task_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_task atlas.tasks%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_consequence jsonb;
  v_tier integer;
  v_downstream_tier integer;
  v_operation_class text;
  v_source_kind text;
  v_state text:='not_protected';
  v_category text;
  v_source text;
  v_confidence text:='structural';
  v_basis jsonb:='[]'::jsonb;
  v_dependency_link_repair_needed boolean:=false;
  v_explicit text;
  v_potential_dependency_hint boolean:=false;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then
    raise exception 'Task not found.' using errcode='P0002';
  end if;

  if v_task.planned_occurrence_id is not null then
    select * into v_occurrence
    from atlas.planned_work_occurrences
    where id=v_task.planned_occurrence_id;
  end if;

  v_consequence:=atlas.task_effective_delay_consequence_v1(p_task_id,p_as_of_date);
  if coalesce(v_consequence->>'effectiveTier','') ~ '^[1-6]$' then
    v_tier:=(v_consequence->>'effectiveTier')::integer;
  end if;
  if coalesce(v_consequence->>'inheritedDownstreamTier','') ~ '^[1-6]$' then
    v_downstream_tier:=(v_consequence->>'inheritedDownstreamTier')::integer;
  end if;

  v_operation_class:=lower(coalesce(v_task.metadata->>'operation_class',''));
  v_source_kind:=lower(coalesce(v_occurrence.source_kind,''));
  v_explicit:=lower(coalesce(
    v_task.metadata->>'protected_farm_minimum',
    v_task.metadata->>'protectedFarmMinimum',
    ''
  ));

  v_potential_dependency_hint:=
    jsonb_typeof(v_task.metadata->'dependent_task_ids')='array'
    and jsonb_array_length(v_task.metadata->'dependent_task_ids')>0;

  if v_explicit in ('false','no','0') then
    v_state:='not_protected';
    v_category:='explicitly_not_protected';
    v_source:='task_explicit_override';
    v_confidence:='explicit';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','explicit_protected_minimum_false'));

  elsif v_explicit in ('true','yes','1') then
    v_state:='protected';
    v_category:=coalesce(nullif(v_task.metadata->>'protected_farm_minimum_category',''),'explicit_protected_minimum');
    v_source:='task_explicit_override';
    v_confidence:='explicit';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','explicit_protected_minimum_true'));

  elsif v_tier=1 then
    v_state:='protected';
    v_category:='life_protection';
    v_source:='effective_delay_consequence';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','tier_1_irreversible_living_loss'));

  elsif v_tier=2 then
    v_state:='protected';
    v_category:='biological_deadline';
    v_source:='effective_delay_consequence';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','tier_2_biological_deadline'));

  elsif v_tier=3 and v_downstream_tier in (1,2) then
    v_state:='protected';
    v_category:='production_prerequisite';
    v_source:='proven_dependency_inheritance';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object(
      'code','prerequisite_unlocks_protected_downstream',
      'inheritedDownstreamTier',v_downstream_tier,
      'inheritedFromTaskId',v_consequence->>'inheritedFromTaskId'
    ));

  elsif lower(coalesce(v_task.metadata->>'rhythm_key',''))='grow_room_care'
     or lower(coalesce(v_task.metadata->>'work_rhythm',''))='grow room care' then
    v_state:='protected';
    v_category:='life_protection';
    v_source:='living_propagation_care_contract';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','grow_room_care_living_round'));

  elsif lower(coalesce(v_task.metadata->>'grow_room_round_linked','false')) in ('true','yes','1')
     and v_operation_class in ('establish_aboveground','inspect_assess','remove_uproot','water_nourish') then
    v_state:='protected';
    v_category:='living_propagation';
    v_source:='grow_room_round_link';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object(
      'code','living_propagation_intervention',
      'operationClass',v_operation_class
    ));

  elsif v_source_kind in ('propagation_split','propagation_followup','germination_workflow','germination_thinning') then
    v_state:='protected';
    v_category:='living_propagation';
    v_source:='lifecycle_source_kind';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','living_propagation_source','sourceKind',v_source_kind));

  elsif v_source_kind='germination_harvest_watch' and v_operation_class='harvest_aboveground' then
    v_state:='protected';
    v_category:='harvest_maturity';
    v_source:='lifecycle_source_kind';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','harvest_maturity_watch'));

  elsif v_source_kind='germination_harvest_watch' and v_operation_class='inspect_assess' then
    v_state:='protected';
    v_category:='biological_deadline';
    v_source:='lifecycle_source_kind';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','transplant_readiness_watch'));

  elsif v_source_kind in ('production_succession','crop_cycle_milestone','crop_cycle_followup','sowing_bed_checklist')
     and v_operation_class in ('establish_aboveground','divide_reestablish_belowground','harvest_aboveground') then
    v_state:='protected';
    v_category:='biological_deadline';
    v_source:='production_lifecycle_contract';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object(
      'code','production_lifecycle_stage',
      'sourceKind',v_source_kind,
      'operationClass',v_operation_class
    ));

  elsif lower(coalesce(v_task.metadata->>'completion_unlocks_sowing','false')) in ('true','yes','1') then
    v_state:='protected';
    v_category:='production_prerequisite';
    v_source:='declared_sowing_unlock';
    v_confidence:='declared';
    v_dependency_link_repair_needed:=coalesce((v_consequence->>'dependencyLinkCount')::integer,0)=0;
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object(
      'code','declared_completion_unlocks_sowing',
      'unlockScope',v_task.metadata->>'sowing_unlock_scope',
      'dependencyLinkRepairNeeded',v_dependency_link_repair_needed
    ));

  elsif v_operation_class='water_nourish'
     and lower(coalesce(v_task.metadata->>'crop_threatening_if_missed','false')) in ('true','yes','1') then
    v_state:='protected';
    v_category:='life_protection';
    v_source:='explicit_crop_threat_contract';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','crop_threatening_irrigation'));

  elsif v_potential_dependency_hint
     and coalesce((v_consequence->>'dependencyLinkCount')::integer,0)=0 then
    v_state:='unresolved';
    v_category:='possible_production_prerequisite';
    v_source:='legacy_dependency_hint_without_proven_edge';
    v_confidence:='unresolved';
    v_dependency_link_repair_needed:=true;
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object(
      'code','dependent_task_ids_without_relational_edge',
      'dependentTaskIds',v_task.metadata->'dependent_task_ids'
    ));

  else
    v_state:='not_protected';
    v_category:='ordinary_farm_work';
    v_source:='no_protected_minimum_evidence';
    v_confidence:='structural';
  end if;

  return jsonb_build_object(
    'contractVersion','task_protected_farm_minimum_v1',
    'taskId',v_task.id,
    'asOfDate',coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date),
    'state',v_state,
    'protectedFarmMinimum',case when v_state='protected' then true when v_state='not_protected' then false else null end,
    'category',v_category,
    'source',v_source,
    'confidence',v_confidence,
    'basis',v_basis,
    'dependencyLinkRepairNeeded',v_dependency_link_repair_needed,
    'effectiveConsequenceTier',v_tier,
    'operationClass',nullif(v_operation_class,''),
    'occurrenceSourceKind',nullif(v_source_kind,'')
  );
end;
$$;

revoke all on function atlas.task_protected_farm_minimum_v1(uuid,date) from public, anon, authenticated;
grant execute on function atlas.task_protected_farm_minimum_v1(uuid,date) to service_role;