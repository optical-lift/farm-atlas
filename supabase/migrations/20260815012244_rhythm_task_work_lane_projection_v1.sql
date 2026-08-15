do $patch$
declare d text; p text;
begin
  select pg_get_functiondef('atlas.ensure_rhythm_task_v1_base(uuid,text,timestamp with time zone)'::regprocedure) into d;
  p:=replace(
    d,
    E'  perform atlas.signal_work_occurrence_v1(\n    v_occurrence_id,',
    E'  if nullif(v_template ->> ''workLane'', '''') is not null then\n    update atlas.planned_work_occurrences\n    set work_lane = v_template ->> ''workLane'',\n        updated_at = now()\n    where id = v_occurrence_id;\n  end if;\n\n  perform atlas.signal_work_occurrence_v1(\n    v_occurrence_id,'
  );
  if p=d then raise exception 'ensure_rhythm_task_v1_base occurrence work-lane seam drifted'; end if;
  execute p;
end $patch$;

update atlas.planned_work_occurrences
set work_lane=task_payload->>'work_lane',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('workLaneProjectionReconciledAt',now()),
    updated_at=now()
where source_kind='rhythm_state'
  and state in ('planned','eligible','failed','releasing')
  and released_task_id is null
  and nullif(task_payload->>'work_lane','') in ('required','process_continuation','rhythm','discretionary')
  and work_lane is distinct from task_payload->>'work_lane';

-- Re-signal required rhythm work that was previously budget-blocked only because
-- the occurrence projection retained the old discretionary default.
do $release$
declare occurrence_row record;
begin
  for occurrence_row in
    select id
    from atlas.planned_work_occurrences
    where source_kind='rhythm_state'
      and state in ('planned','eligible','failed','releasing')
      and released_task_id is null
      and work_lane='required'
      and task_payload->>'work_lane'='required'
  loop
    perform atlas.signal_work_occurrence_v1(
      occurrence_row.id,
      'rhythm_work_lane_projection_v1',
      jsonb_build_object('reason','Required rhythm work lane projection reconciled.')
    );
  end loop;
end $release$;