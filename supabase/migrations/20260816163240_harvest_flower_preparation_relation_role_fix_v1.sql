create or replace function atlas.ensure_flower_preparation_task_v1(p_harvest_batch_id uuid, p_source_observation_id uuid, p_assigned_membership_id uuid, p_due_date date)
returns jsonb
language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare
  v_batch atlas.flower_harvest_batches%rowtype;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_existing_task uuid;
  v_existing_occurrence uuid;
  v_occurrence uuid;
  v_released_task uuid;
  v_signal jsonb;
  v_relation jsonb;
begin
  select * into v_batch from atlas.flower_harvest_batches where id=p_harvest_batch_id;
  if v_batch.id is null then raise exception 'Flower harvest batch not found.' using errcode='P0002'; end if;
  select * into v_observation from atlas.flower_harvest_bucket_observations where id=p_source_observation_id;
  if v_observation.id is null or v_observation.batch_id is distinct from v_batch.id then
    raise exception 'Flower harvest observation is outside the preparation batch.' using errcode='22023';
  end if;
  select * into v_membership from atlas.farm_memberships where id=p_assigned_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from v_batch.farm_id then
    raise exception 'Preparation assignee must be an active member of this farm.' using errcode='22023';
  end if;
  if not exists (
    select 1 from atlas.flower_harvest_bucket_observations h
    where h.batch_id=v_batch.id
      and not exists (select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id)
  ) then
    return jsonb_build_object('taskId',null,'occurrenceId',null,'action','nothing_to_prepare');
  end if;
  select t.id,t.planned_occurrence_id into v_existing_task,v_existing_occurrence
  from atlas.tasks t
  where t.farm_id=v_batch.farm_id and t.status in ('open','blocked') and t.task_type='flower_preparation'
    and t.metadata->>'flower_harvest_batch_id'=v_batch.id::text
  order by t.created_at limit 1;
  if v_existing_task is not null then
    return jsonb_build_object('taskId',v_existing_task,'occurrenceId',v_existing_occurrence,'action','kept_current');
  end if;
  select jsonb_build_object(
    'task_crop_cycles',coalesce(jsonb_agg(distinct jsonb_build_object(
      'crop_cycle_id',h.crop_cycle_id,
      'role','preserves',
      'confidence','confirmed',
      'source','flower_preparation_v1'
    )),'[]'::jsonb)
  ) into v_relation
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id);
  v_occurrence:=atlas.plan_work_occurrence_v1(
    p_farm_id=>v_batch.farm_id,
    p_definition_key=>'flower-preparation:'||v_batch.id::text,
    p_policy_key=>'flower-preparation:'||v_batch.id::text||':one-active',
    p_occurrence_key=>'flower-preparation:'||p_source_observation_id::text,
    p_title=>'Prepare harvested flowers · '||v_batch.harvest_date::text,
    p_task_type=>'flower_preparation',
    p_due_date=>coalesce(p_due_date,v_batch.harvest_date),
    p_source_kind=>'flower_harvest_batch',
    p_source_id=>v_batch.id,
    p_gate_type=>'event',
    p_horizon_days=>0,
    p_maximum_active_instances=>1,
    p_task_payload=>jsonb_build_object(
      'task_type','flower_preparation','priority','high','generated_from','flower_harvest_batch','generated_from_id',v_batch.id,
      'note','Prepare the harvested flowers from this batch. Strip, condition, cool, bunch, or assemble the actual saleable form. Record what is Ready only after the handling is complete. Count stems only when the sale unit itself requires a stem count.',
      'action_key','prepare','work_class','postharvest','task_series_key','flower-preparation:'||v_batch.id::text,
      'engine_instance_key','flower-preparation:'||p_source_observation_id::text,'visibility_scope','assigned_worker','assigned_membership_id',p_assigned_membership_id,
      'metadata',jsonb_build_object('task_style','flower_preparation','structured_result_required',true,'flower_harvest_batch_id',v_batch.id,'source_harvest_observation_id',p_source_observation_id,'display_action','Prepare','display_subject','Harvested flowers','display_detail','Create Ready inventory','physical_output_mode','bucket_scale','time_claims_physical_condition',false)
    ),
    p_relation_payload=>coalesce(v_relation,'{}'::jsonb),
    p_gate_config=>jsonb_build_object('requiresHarvestOutput',true,'timeClaimsPhysicalCondition',false),
    p_not_before_date=>coalesce(p_due_date,v_batch.harvest_date),
    p_metadata=>jsonb_build_object('flowerHarvestBatchId',v_batch.id,'sourceObservationId',p_source_observation_id)
  );
  v_signal:=atlas.signal_work_occurrence_v1(v_occurrence,'harvest_output_recorded',jsonb_build_object('flowerHarvestBatchId',v_batch.id,'sourceObservationId',p_source_observation_id));
  select released_task_id into v_released_task from atlas.planned_work_occurrences where id=v_occurrence;
  return jsonb_build_object('taskId',v_released_task,'occurrenceId',v_occurrence,'action',case when v_released_task is null then 'planned_awaiting_capacity' else 'released' end,'release',v_signal->'release');
end; $$;