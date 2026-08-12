-- The Lebanon harvest task predates the Farm Hand execution contract. Its address
-- and return condition currently live in task.note / legacy metadata, which the
-- worker boundary intentionally strips. Move the literal execution facts into the
-- canonical worker fields instead of weakening the privacy boundary.

do $block$
declare
  v_task atlas.tasks%rowtype;
  v_count integer;
begin
  select count(*) into v_count
  from atlas.tasks task
  where task.due_date='2026-08-13'
    and task.action_key='harvest'
    and task.metadata->>'address'='19395 Highway HH, Lebanon, MO 65536';

  if v_count<>1 then
    raise exception 'Expected exactly one Aug 13 Lebanon harvest task; found %.',v_count;
  end if;

  select task.* into v_task
  from atlas.tasks task
  where task.due_date='2026-08-13'
    and task.action_key='harvest'
    and task.metadata->>'address'='19395 Highway HH, Lebanon, MO 65536'
  limit 1;

  if coalesce((v_task.metadata->>'buckets_required')::integer,-1)<>7 then
    raise exception 'Lebanon harvest bucket requirement drifted; refusing worker execution normalization.';
  end if;

  update atlas.tasks task
  set metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_title','Harvest Karianne’s garden for Thursday bouquet bar',
        'display_action','Harvest',
        'display_subject','Karianne’s garden',
        'display_location','Karianne’s garden · Lebanon',
        'execution_do','Harvest Karianne’s garden for Thursday evening’s bouquet bar.',
        'execution_place','Karianne’s garden · 19395 Highway HH, Lebanon, MO 65536',
        'execution_how',jsonb_build_array(
          'Take 7 black florist buckets.',
          'Harvest the garden Thursday morning.',
          'Bring the harvested flowers back to Elm conditioned and ready for bouquet-bar use.'
        ),
        'execution_done_when','Harvested flowers are bucketed, conditioned, and back at Elm for Thursday evening.',
        'worker_result_label','Bring back',
        'worker_result_lines',jsonb_build_array('Harvested + conditioned bouquet-bar flowers'),
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','worker_task_contract_correction_v1'
      ),
      updated_at=now()
  where task.id=v_task.id;
end;
$block$;
