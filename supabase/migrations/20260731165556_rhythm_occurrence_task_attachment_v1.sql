create or replace function atlas.attach_released_task_to_source_v1(p_occurrence_id uuid,p_task_id uuid)
returns void
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  o atlas.planned_work_occurrences%rowtype;
  t atlas.tasks%rowtype;
begin
  select * into o from atlas.planned_work_occurrences where id=p_occurrence_id;
  select * into t from atlas.tasks where id=p_task_id;
  if o.id is null or t.id is null then return; end if;

  update atlas.workflow_handoffs set source_id=p_task_id,updated_at=now()
  where source_kind='task' and source_occurrence_id=o.id;

  if o.source_kind='rhythm_state' and o.source_id is not null then
    update atlas.rhythm_state set current_task_id=p_task_id,current_occurrence_id=o.id,updated_at=now() where id=o.source_id;
  elsif o.source_kind='production_succession' and o.source_id is not null then
    update atlas.production_successions set sow_task_id=p_task_id,updated_at=now() where id=o.source_id;
  elsif o.source_kind='workflow_handoff' and o.source_id is not null then
    update atlas.workflow_handoffs set target_task_id=p_task_id,updated_at=now() where id=o.source_id;
  elsif o.source_kind='production_transplant_gate' and o.source_id is not null and t.task_type='production_transplant' then
    update atlas.production_transplant_gates set transplant_task_id=p_task_id,updated_at=now() where id=o.source_id;
  elsif o.source_kind='production_harvest_gate' and o.source_id is not null then
    if t.task_type='production_harvest_readiness' then
      update atlas.production_harvest_gates set harvest_readiness_task_id=p_task_id,harvest_task_id=p_task_id,updated_at=now() where id=o.source_id;
    elsif t.task_type='production_harvest' then
      update atlas.production_harvest_gates set harvest_task_id=p_task_id,updated_at=now() where id=o.source_id;
    end if;
  elsif o.source_kind='production_postharvest_gate' and o.source_id is not null then
    if t.task_type='postharvest_container_assignment' then
      update atlas.production_postharvest_gates set owner_assignment_task_id=p_task_id,updated_at=now() where id=o.source_id;
    elsif t.task_type='production_postharvest_conditioning' then
      update atlas.production_postharvest_gates set conditioning_task_id=p_task_id,updated_at=now() where id=o.source_id;
    elsif t.task_type='production_postharvest_cooling' then
      update atlas.production_postharvest_gates set cooling_task_id=p_task_id,updated_at=now() where id=o.source_id;
    elsif t.task_type='postharvest_container_wash' then
      update atlas.production_postharvest_gates set wash_task_id=p_task_id,updated_at=now() where id=o.source_id;
    end if;
  end if;
end;
$$;
