create or replace function atlas.enforce_flower_preparation_occurrence_lane_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if new.source_kind='flower_harvest_batch'
     or coalesce(new.task_payload->>'task_type','')='flower_preparation' then
    new.work_lane:='process_continuation';
    new.commitment_kind:='dependency';
    new.effort_units:=greatest(coalesce(new.effort_units,1),0.5);
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'postharvestContinuationLane','process_continuation',
      'postharvestCommitmentKind','dependency',
      'postharvestContinuationReason','Recorded physical harvest output requires postharvest handling before it can become Ready inventory; this is a process continuation, not discretionary backlog.',
      'truthBoundary','harvest_output_requires_lawful_preparation_continuation'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists flower_preparation_occurrence_process_lane_v1 on atlas.planned_work_occurrences;
create trigger flower_preparation_occurrence_process_lane_v1
before insert or update on atlas.planned_work_occurrences
for each row execute function atlas.enforce_flower_preparation_occurrence_lane_v1();

update atlas.planned_work_occurrences
set work_lane='process_continuation',
    commitment_kind='dependency',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'postharvestContinuationLane','process_continuation',
      'postharvestCommitmentKind','dependency',
      'postharvestContinuationReason','Recorded physical harvest output requires postharvest handling before it can become Ready inventory; this is a process continuation, not discretionary backlog.',
      'truthBoundary','harvest_output_requires_lawful_preparation_continuation'
    ),
    updated_at=now()
where source_kind='flower_harvest_batch'
   or coalesce(task_payload->>'task_type','')='flower_preparation';