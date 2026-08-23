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

-- Repair any currently unreleased rhythm occurrence whose canonical task payload
-- already declares a recognized work lane but whose occurrence projection retained
-- the old default.
update atlas.planned_work_occurrences
set work_lane=task_payload->>'work_lane',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('workLaneProjectionReconciledAt',now()),
    updated_at=now()
where source_kind='rhythm_state'
  and state in ('planned','eligible','failed','releasing')
  and released_task_id is null
  and nullif(task_payload->>'work_lane','') in ('required','process_continuation','rhythm','discretionary')
  and work_lane is distinct from task_payload->>'work_lane';

select atlas.signal_work_occurrence_v1(
  '76c32d70-c22c-4481-9e33-bb27329a6d09',
  'grow_room_calendar_day_repair_v1',
  jsonb_build_object('reason','Grow Room Care is required daily farm-calendar work; occurrence lane projection repaired.')
);