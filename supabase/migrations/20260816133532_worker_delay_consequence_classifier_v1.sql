create or replace function atlas.task_delay_consequence_v1(
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
  v_capacity record;
  v_as_of date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_explicit jsonb:='{}'::jsonb;
  v_tier integer;
  v_class text;
  v_source text;
  v_confidence text;
  v_basis jsonb:='[]'::jsonb;
  v_explicit_tier_text text;
  v_operation_class text;
  v_living_source boolean:=false;
  v_canonical_upper date;
  v_needs_explicit boolean:=false;
  v_is_hard_date boolean:=false;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then
    raise exception 'Task not found.' using errcode='P0002';
  end if;

  if v_task.planned_occurrence_id is not null then
    select * into v_occurrence from atlas.planned_work_occurrences where id=v_task.planned_occurrence_id;
  end if;

  select * into v_capacity from atlas.task_capacity_plan_v1(v_task,v_as_of);

  v_explicit:=coalesce(v_occurrence.miss_consequence,'{}'::jsonb);
  v_operation_class:=lower(coalesce(v_task.metadata->>'operation_class',''));
  v_is_hard_date:=
    coalesce(v_task.commitment_kind,'')='hard_date'
    or lower(coalesce(v_task.metadata->>'date_behavior',''))='hard_date'
    or lower(coalesce(v_task.metadata->>'date_commitment',''))='hard_date'
    or lower(coalesce(v_task.metadata->>'calendar_commitment_kind',''))='owner_hard_date';

  if v_occurrence.latest_lawful_date is not null and v_occurrence.hard_finish_date is not null then
    v_canonical_upper:=least(v_occurrence.latest_lawful_date,v_occurrence.hard_finish_date);
  else
    v_canonical_upper:=coalesce(v_occurrence.latest_lawful_date,v_occurrence.hard_finish_date);
  end if;

  v_living_source:=coalesce(v_occurrence.source_kind,'') in (
    'production_succession','crop_cycle_milestone','crop_cycle_followup','germination_workflow',
    'germination_thinning','germination_harvest_watch','propagation_followup','propagation_split',
    'sowing_bed_checklist','spring_snapdragon_stagger_2027','retroactive_crop_profile'
  );

  if v_explicit<>'{}'::jsonb then
    v_explicit_tier_text:=coalesce(v_explicit->>'tier',v_explicit->>'tierNumber');
    if coalesce(v_explicit_tier_text,'') ~ '^[1-6]$' then
      v_tier:=v_explicit_tier_text::integer;
    end if;
    v_class:=nullif(lower(coalesce(v_explicit->>'class',v_explicit->>'consequenceClass','')),'');
    if v_tier is null then
      v_tier:=case v_class
        when 'irreversible_living_loss' then 1
        when 'biological_deadline' then 2
        when 'prerequisite_unlock' then 3
        when 'revenue_commitment' then 4
        when 'recurring_maintenance' then 5
        when 'routine_production' then 5
        when 'improvement_side_project' then 6
        else null
      end;
    end if;
    v_class:=coalesce(v_class,case when v_tier is not null then 'explicit_tier_'||v_tier::text else 'explicit_unparsed' end);
    v_source:='occurrence_miss_consequence';
    v_confidence:=case when v_tier is not null then 'explicit' else 'unresolved' end;
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','explicit_miss_consequence','value',v_explicit));
    v_needs_explicit:=v_tier is null;
  elsif coalesce(v_task.metadata->>'sale_channel','')<>''
     or lower(coalesce(v_task.metadata->>'revenue_commitment','false')) in ('true','yes','1') then
    v_tier:=4;
    v_class:='revenue_commitment';
    v_source:='task_revenue_contract';
    v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','revenue_contract_metadata'));
  elsif v_living_source and v_canonical_upper is not null then
    v_tier:=2;
    v_class:='biological_deadline';
    v_source:='canonical_living_window';
    v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object(
      'code','living_source_with_canonical_upper_bound',
      'sourceKind',v_occurrence.source_kind,
      'latestLawfulDate',v_occurrence.latest_lawful_date,
      'hardFinishDate',v_occurrence.hard_finish_date
    ));
  elsif coalesce(v_task.work_lane,'')='rhythm'
     or coalesce(v_occurrence.source_kind,'') in ('recurring_task','rhythm_state','maintenance_weeding_collection','weed_card','walkway_card_collection') then
    v_tier:=5;
    v_class:='recurring_maintenance';
    v_source:='recurring_continuity_contract';
    v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','recurring_or_rhythm_contract','sourceKind',v_occurrence.source_kind));
  elsif coalesce(v_capacity.effective_obligation_class,'')='optional_improvement'
     or coalesce(v_occurrence.source_kind,'') in ('project_pull_item','owner_project') then
    v_tier:=6;
    v_class:='improvement_side_project';
    v_source:='optional_improvement_contract';
    v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','optional_improvement_contract'));
  elsif coalesce(v_capacity.effective_obligation_class,'')='routine_production'
     and coalesce(v_task.work_lane,'')='discretionary' then
    v_tier:=5;
    v_class:='routine_production';
    v_source:='routine_production_contract';
    v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','routine_production_without_known_deadline'));
  elsif coalesce(v_task.commitment_kind,'')='dependency' or coalesce(v_task.work_lane,'')='process_continuation' then
    v_tier:=null;
    v_class:='dependency_consequence_unresolved';
    v_source:='dependency_contract';
    v_confidence:='unresolved';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','dependency_requires_downstream_consequence'));
    v_needs_explicit:=true;
  elsif v_is_hard_date then
    v_tier:=null;
    v_class:='hard_date_consequence_unresolved';
    v_source:='hard_date_target_only';
    v_confidence:='unresolved';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','hard_date_does_not_identify_consequence'));
    v_needs_explicit:=true;
  else
    v_tier:=null;
    v_class:='unclassified';
    v_source:='insufficient_structural_evidence';
    v_confidence:='unresolved';
    v_needs_explicit:=true;
  end if;

  return jsonb_build_object(
    'contractVersion','task_delay_consequence_v1',
    'taskId',v_task.id,
    'asOfDate',v_as_of,
    'directTier',v_tier,
    'directClass',v_class,
    'source',v_source,
    'confidence',v_confidence,
    'basis',v_basis,
    'needsExplicitConsequence',v_needs_explicit,
    'canonicalMissConsequence',v_explicit,
    'plannedOccurrenceId',v_task.planned_occurrence_id,
    'occurrenceSourceKind',v_occurrence.source_kind,
    'operationClass',nullif(v_operation_class,''),
    'workLane',v_task.work_lane,
    'commitmentKind',v_task.commitment_kind,
    'effectiveObligationClass',v_capacity.effective_obligation_class,
    'canonicalUpperBound',v_canonical_upper
  );
end;
$$;

revoke all on function atlas.task_delay_consequence_v1(uuid,date) from public, anon, authenticated;
grant execute on function atlas.task_delay_consequence_v1(uuid,date) to service_role;