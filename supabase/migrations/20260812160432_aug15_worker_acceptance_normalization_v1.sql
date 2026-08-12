-- Finish-line normalization for Anna's Aug. 15 acceptance set.
-- Preserve the specialty decision selector as the result instrument while giving
-- the shared worker execution brief literal instructions. Owner why/state-effect
-- reasoning remains outside the Farm Hand packet.

do $block$
declare
  v_task atlas.tasks%rowtype;
  v_options jsonb;
begin
  select t.* into v_task
  from atlas.tasks t
  where t.title='Golden yarrow — tray 1 — 130'
    and t.due_date=date '2026-08-15'
    and t.status='open'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc limit 1;

  if v_task.id is null
     or coalesce((v_task.metadata->>'target_quantity')::integer,-1)<>130
     or coalesce(v_task.metadata->>'container_kind','')<>'200-cell plug tray'
     or coalesce(v_task.metadata->>'display_subject','')<>'Golden yarrow' then
    raise exception 'Golden yarrow Aug. 15 pot-up truth drifted; refusing normalization.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_do','Pot up 130 Golden yarrow plants.',
        'execution_place','200-cell Pot Up',
        'execution_how',jsonb_build_array('Pot up 130 Golden yarrow plants into one 200-cell plug tray.'),
        'execution_done_when','The 130 Golden yarrow plants are potted into the tray.',
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','aug15_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.id=v_task.id;

  select t.* into v_task
  from atlas.tasks t
  where t.title='Violet salvia — tray 1 — 130'
    and t.due_date=date '2026-08-15'
    and t.status='open'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc limit 1;

  if v_task.id is null
     or coalesce((v_task.metadata->>'target_quantity')::integer,-1)<>130
     or coalesce(v_task.metadata->>'container_kind','')<>'200-cell plug tray'
     or coalesce(v_task.metadata->>'display_subject','')<>'Violet salvia' then
    raise exception 'Violet salvia Aug. 15 pot-up truth drifted; refusing normalization.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_do','Pot up 130 Violet salvia plants.',
        'execution_place','200-cell Pot Up',
        'execution_how',jsonb_build_array('Pot up 130 Violet salvia plants into one 200-cell plug tray.'),
        'execution_done_when','The 130 Violet salvia plants are potted into the tray.',
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','aug15_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.id=v_task.id;

  select t.* into v_task
  from atlas.tasks t
  where t.title='Grey Couch in Garage'
    and t.due_date=date '2026-08-15'
    and t.status='open'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc limit 1;

  if v_task.id is null
     or coalesce(v_task.metadata->>'task_style','')<>'decision_selector'
     or coalesce(v_task.metadata->>'decision_selector_key','')<>'grey_couch_decision_v1'
     or coalesce(v_task.metadata->>'display_instruction','')<>'Decide what to do with the grey couch'
     or coalesce(v_task.metadata->>'personal_display_label','')<>'Personal · not paid Elm work' then
    raise exception 'Grey Couch decision-selector identity drifted; refusing normalization.';
  end if;

  v_options:=v_task.metadata->'decision_options';
  if v_options<>jsonb_build_array(
    jsonb_build_object('key','marketplace','label','List on FB Marketplace with the kitty litter box'),
    jsonb_build_object('key','detached_garage','label','Move to detached garage after creating a space along one wall in the back'),
    jsonb_build_object('key','handled_elsewhere','label','I’ve made a decision that doesn’t require an Atlas task')
  ) then
    raise exception 'Grey Couch decision options drifted; refusing normalization.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_do','Decide what to do with the grey couch.',
        'execution_place','Grey couch in garage',
        'execution_how',jsonb_build_array(
          'Choose the option below that matches your decision.',
          'Save the decision in Atlas.'
        ),
        'execution_done_when','One couch decision is saved.',
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','aug15_worker_acceptance_normalization_v1'
      ),updated_at=now()
  where t.id=v_task.id;
end;
$block$;
