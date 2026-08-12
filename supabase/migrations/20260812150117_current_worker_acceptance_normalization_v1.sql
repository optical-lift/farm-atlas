-- Finish-line acceptance normalization for current Farm Hand work.
-- Keep this deliberately narrow: only live specimens whose execution truth is
-- already present in canonical task metadata or a proven prior occurrence.

do $block$
declare
  v_chicken atlas.tasks%rowtype;
  v_prior_chicken atlas.tasks%rowtype;
  v_zinnia atlas.tasks%rowtype;
  v_mow atlas.tasks%rowtype;
  v_lights atlas.tasks%rowtype;
begin
  -- Chicken Chore: today's occurrence lost the literal packet fields even though
  -- yesterday's completed occurrence in the same routine has the approved words.
  select t.* into v_chicken
  from atlas.tasks t
  where t.metadata->>'task_key'='anna_chicken_chore_20260812'
    and t.status='open'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc
  limit 1;

  if v_chicken.id is null then
    raise exception 'Current Aug. 12 Chicken Chore is missing; refusing acceptance normalization.';
  end if;

  select t.* into v_prior_chicken
  from atlas.tasks t
  where t.metadata->>'task_key'='anna_chicken_chore_20260811'
    and t.status='done'
  order by t.updated_at desc
  limit 1;

  if v_prior_chicken.id is null
     or v_prior_chicken.metadata->>'execution_do' <> 'Complete the chicken chore'
     or v_prior_chicken.metadata->'execution_how' <> jsonb_build_array(
       'Give 4 scoops of feed.',
       'Refresh the water bucket.',
       'Gather eggs.'
     ) then
    raise exception 'Approved Chicken Chore execution packet drifted; refusing to copy it.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_do',v_prior_chicken.metadata->>'execution_do',
        'execution_place','Chicken Coop / Chicken Run',
        'execution_how',v_prior_chicken.metadata->'execution_how',
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','current_worker_acceptance_normalization_v1'
      ),
      updated_at=now()
  where t.id=v_chicken.id;

  -- Exact-date zinnia sowing: all sowing geometry already exists canonically.
  -- Expose those same facts literally rather than inventing a separate method.
  select t.* into v_zinnia
  from atlas.tasks t
  where t.metadata->>'task_key'='zinnia_2026_s5_house_south_sow'
    and t.status='open'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc
  limit 1;

  if v_zinnia.id is null then
    raise exception 'Aug. 12 House South West zinnia sowing task is missing.';
  end if;

  if v_zinnia.due_date<>date '2026-08-12'
     or coalesce(v_zinnia.metadata->>'bed_label','')<>'House South Foundation Border — West Section'
     or coalesce(v_zinnia.metadata->>'crop_label','')<>'California Giant Zinnia'
     or coalesce((v_zinnia.metadata->>'rows_per_3ft_bed')::numeric,-1)<>3
     or coalesce((v_zinnia.metadata->>'in_row_spacing_in')::numeric,-1)<>9 then
    raise exception 'House South West zinnia sowing truth drifted; refusing worker normalization.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Sow',
        'display_subject','California Giant Zinnias',
        'display_location','House South Foundation Border — West Section',
        'execution_do','Sow California Giant zinnias in the House South Foundation Border — West Section.',
        'execution_place','House South Foundation Border — West Section',
        'execution_how',jsonb_build_array(
          'Use 3 rows.',
          'Sow at 9-inch spacing within each row.'
        ),
        'worker_result_label','Next',
        'worker_result_lines',jsonb_build_array('Germination watch begins from the recorded sow date.'),
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','current_worker_acceptance_normalization_v1'
      ),
      updated_at=now()
  where t.id=v_zinnia.id;

  -- Mowing acceptance specimen: the task already says Corral + riding mower.
  -- Do not expose the Owner-side equipment-state commentary as worker prose.
  select t.* into v_mow
  from atlas.tasks t
  where t.metadata->>'task_key'='anna_20260713_mow_corral_weekly'
    and t.status='open'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc
  limit 1;

  if v_mow.id is null then
    raise exception 'Current Corral mowing task is missing.';
  end if;

  if coalesce(v_mow.metadata->>'display_subject','')<>'Corral'
     or coalesce(v_mow.metadata->>'display_location','')<>'Corral'
     or coalesce(v_mow.metadata->'detail_lines','[]'::jsonb)<>jsonb_build_array('Use riding mower') then
    raise exception 'Corral mowing execution facts drifted; refusing worker normalization.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_do','Mow the Corral.',
        'execution_place','Corral',
        'execution_how',jsonb_build_array('Use the riding mower.'),
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','current_worker_acceptance_normalization_v1'
      ),
      updated_at=now()
  where t.id=v_mow.id;

  -- This current event-setup task already has literal execution instructions;
  -- it only lacks the display identity required by the worker contract audit.
  select t.* into v_lights
  from atlas.tasks t
  where t.title='Hang conference-room café lights + porch solar lights'
    and t.status='open'
    and t.due_date=date '2026-08-12'
    and t.visibility_scope='assigned_worker'
  order by t.created_at desc
  limit 1;

  if v_lights.id is null then
    raise exception 'Current café/solar-light setup task is missing.';
  end if;

  if coalesce(v_lights.metadata->>'execution_do','')<>'Hang conference-room café lights and porch solar lights'
     or jsonb_array_length(coalesce(v_lights.metadata->'execution_how','[]'::jsonb))<>3 then
    raise exception 'Current café/solar-light execution packet drifted; refusing display normalization.';
  end if;

  update atlas.tasks t
  set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_action','Hang',
        'display_subject','Café lights + porch solar lights',
        'display_location','Conference room + porches',
        'execution_place','Conference room + porches',
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','current_worker_acceptance_normalization_v1'
      ),
      updated_at=now()
  where t.id=v_lights.id;
end;
$block$;
