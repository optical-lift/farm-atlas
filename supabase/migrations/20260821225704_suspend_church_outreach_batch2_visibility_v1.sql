do $$
declare
  v_farm uuid;
  v_task uuid;
  v_occurrence uuid;
begin
  select id into v_farm from atlas.farms where stable_key='elm_farm';
  select id,planned_occurrence_id into v_task,v_occurrence
  from atlas.tasks
  where farm_id=v_farm and metadata->>'task_key'='anna_20260812_church_outreach_batch_2'
  order by created_at limit 1;

  if v_task is not null then
    update atlas.tasks
    set visibility_scope='system_internal',
        metadata=jsonb_set(
          coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'visibility_suspended_at',now(),
            'visibility_suspended_by','suspend_church_outreach_batch2_visibility_v1',
            'visibility_suspend_reason','Keep Anna outreach/call work off the worker feed while outreach is suspended.'
          ),
          '{prerequisite_gate_restore,visibility_scope}',to_jsonb('system_internal'::text),true
        ),
        updated_at=now()
    where id=v_task;
  end if;

  if v_occurrence is not null then
    update atlas.planned_work_occurrences
    set task_payload=jsonb_set(
          jsonb_set(coalesce(task_payload,'{}'::jsonb),'{visibility_scope}',to_jsonb('system_internal'::text),true),
          '{metadata}',
          jsonb_set(
            coalesce(task_payload->'metadata','{}'::jsonb)||jsonb_build_object(
              'visibility_suspended_by','suspend_church_outreach_batch2_visibility_v1',
              'visibility_suspend_reason','Keep Anna outreach/call work off the worker feed while outreach is suspended.'
            ),
            '{prerequisite_gate_restore,visibility_scope}',to_jsonb('system_internal'::text),true
          ),true
        ),
        updated_at=now()
    where id=v_occurrence;
  end if;
end $$;
