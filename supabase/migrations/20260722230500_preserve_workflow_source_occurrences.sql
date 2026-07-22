-- A deferred task may be both a workflow target and a workflow source. Preserve
-- both relationships when its placeholder row is removed, then relink the source
-- to the real task when the occurrence is released.

create or replace function atlas.capture_deferred_task_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare v_payload jsonb;
begin
  if coalesce(new.metadata->>'release_deferred','false')<>'true' then
    return null;
  end if;

  if coalesce(new.metadata->>'release_duplicate','false')<>'true' then
    v_payload := atlas.capture_task_relation_payload_v1(new.id);
    update atlas.planned_work_occurrences
    set
      relation_payload=case
        when v_payload='{}'::jsonb then relation_payload
        else v_payload
      end,
      updated_at=now()
    where id=new.planned_occurrence_id;
  end if;

  update atlas.workflow_handoffs h
  set
    target_occurrence_id=case
      when h.target_task_id=new.id then new.planned_occurrence_id
      else h.target_occurrence_id
    end,
    target_task_id=case
      when h.target_task_id=new.id then null
      else h.target_task_id
    end,
    source_occurrence_id=case
      when h.source_kind='task' and h.source_id=new.id
        then new.planned_occurrence_id
      else h.source_occurrence_id
    end,
    updated_at=now()
  where h.target_task_id=new.id
     or (h.source_kind='task' and h.source_id=new.id);

  update atlas.task_release_queue_items
  set
    planned_occurrence_id=new.planned_occurrence_id,
    task_id=null,
    updated_at=now()
  where task_id=new.id;

  delete from atlas.tasks where id=new.id;
  return null;
end;
$fn$;

create or replace function atlas.attach_released_task_to_source_v1(
  p_occurrence_id uuid,
  p_task_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  o atlas.planned_work_occurrences%rowtype;
  t atlas.tasks%rowtype;
begin
  select * into o
  from atlas.planned_work_occurrences
  where id=p_occurrence_id;
  select * into t from atlas.tasks where id=p_task_id;
  if o.id is null or t.id is null then return; end if;

  update atlas.workflow_handoffs
  set source_id=p_task_id,updated_at=now()
  where source_kind='task'
    and source_occurrence_id=o.id;

  if o.source_kind='production_succession' and o.source_id is not null then
    update atlas.production_successions
    set sow_task_id=p_task_id,updated_at=now()
    where id=o.source_id;
  elsif o.source_kind='workflow_handoff' and o.source_id is not null then
    update atlas.workflow_handoffs
    set target_task_id=p_task_id,updated_at=now()
    where id=o.source_id;
  elsif o.source_kind='production_transplant_gate'
        and o.source_id is not null
        and t.task_type='production_transplant' then
    update atlas.production_transplant_gates
    set transplant_task_id=p_task_id,updated_at=now()
    where id=o.source_id;
  elsif o.source_kind='production_harvest_gate' and o.source_id is not null then
    if t.task_type='production_harvest_readiness' then
      update atlas.production_harvest_gates
      set harvest_readiness_task_id=p_task_id,
          harvest_task_id=p_task_id,
          updated_at=now()
      where id=o.source_id;
    elsif t.task_type='production_harvest' then
      update atlas.production_harvest_gates
      set harvest_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    end if;
  elsif o.source_kind='production_postharvest_gate'
        and o.source_id is not null then
    if t.task_type='postharvest_container_assignment' then
      update atlas.production_postharvest_gates
      set owner_assignment_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    elsif t.task_type='production_postharvest_conditioning' then
      update atlas.production_postharvest_gates
      set conditioning_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    elsif t.task_type='production_postharvest_cooling' then
      update atlas.production_postharvest_gates
      set cooling_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    elsif t.task_type='postharvest_container_wash' then
      update atlas.production_postharvest_gates
      set wash_task_id=p_task_id,updated_at=now()
      where id=o.source_id;
    end if;
  end if;
end;
$fn$;
