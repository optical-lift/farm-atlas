-- Finish-line normalization for worker-visible Aug. 12–13 tasks whose literal
-- execution truth already exists in canonical notes/detail lines. The worker
-- contract does not expose those Owner-side fields as fallback prose, so copy
-- only the execution facts into deliberate worker fields.

do $block$
declare
  v_task atlas.tasks%rowtype;

  procedure load_task(p_title text,p_due date,p_status text default null) is
  begin
    select t.* into v_task
    from atlas.tasks t
    where t.title=p_title
      and t.due_date=p_due
      and t.visibility_scope='assigned_worker'
      and (p_status is null or t.status=p_status)
      and t.status in ('open','blocked')
    order by t.created_at desc
    limit 1;

    if v_task.id is null then
      raise exception 'Worker acceptance task missing: % on %',p_title,p_due;
    end if;
  end;

  procedure stamp_packet(
    p_action text,
    p_subject text,
    p_location text,
    p_do text,
    p_how jsonb
  ) is
  begin
    if p_how is null or jsonb_typeof(p_how)<>'array' or jsonb_array_length(p_how)=0 then
      raise exception 'Worker acceptance packet for % requires literal execution steps.',v_task.title;
    end if;

    update atlas.tasks t
    set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
          'display_action',p_action,
          'display_subject',p_subject,
          'display_location',p_location,
          'execution_do',p_do,
          'execution_place',p_location,
          'execution_how',p_how,
          'worker_execution_normalized_at',now(),
          'worker_execution_normalized_source','aug12_aug13_worker_packet_normalization_v1'
        ),
        updated_at=now()
    where t.id=v_task.id;
  end;
begin
  call load_task('Clean Interior Windows + Glass Doors',date '2026-08-12','open');
  if coalesce(v_task.metadata->'detail_lines','[]'::jsonb)<>jsonb_build_array(
    'Clean interior glass surfaces',
    'Remove fingerprints, dust and streaks',
    'Wipe accessible tracks and sills',
    'Leave glass clear and guest-presentable'
  ) then
    raise exception 'Interior glass detail lines drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Clean','Windows + glass doors','Farmhouse + venue-facing interior glass',
    'Clean the interior windows and glass doors.',
    v_task.metadata->'detail_lines'
  );

  call load_task('Kid Chore — Sweep Porches',date '2026-08-12','open');
  if coalesce(v_task.note,'')<>'Sweep leaves, dirt, and loose debris away from doors and guest-visible porch areas.' then
    raise exception 'Porch-sweeping instruction drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Sweep','House porches','House porches',
    'Sweep the house porches.',
    jsonb_build_array('Sweep leaves, dirt, and loose debris away from doors and guest-visible porch areas.')
  );

  call load_task('Kid Chore — Take Trash to Street for Thursday Pickup',date '2026-08-12','open');
  if coalesce(v_task.metadata->>'display_detail','')<>'House / street pickup' then
    raise exception 'Trash pickup location truth drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Take out','Trash for Thursday pickup','House → street pickup point',
    'Take the trash to the street for Thursday pickup.',
    jsonb_build_array('Move the house trash to the street pickup point for Thursday pickup.')
  );

  call load_task('Pick Up Sticks + Put Away Hoses Before Mowing',date '2026-08-12','open');
  if coalesce(v_task.metadata->'detail_lines','[]'::jsonb)<>jsonb_build_array(
    'Pick up sticks, branches, and debris from mowing areas',
    'Put away hoses before mowing'
  ) then
    raise exception 'Pre-mowing yard-prep detail lines drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Prepare','Sticks + hoses before mowing','Yard + mowing areas',
    'Clear sticks, branches, debris, and hoses out of the mowing areas.',
    v_task.metadata->'detail_lines'
  );

  call load_task('Pick Up Home Depot Order — Curbside',date '2026-08-13','open');
  if coalesce(v_task.metadata->'detail_lines','[]'::jsonb)<>jsonb_build_array(
    'Download the Home Depot app before leaving.',
    'Use curbside pickup and check in through the app when you arrive.',
    'Pickup store: Home Depot, 2104 E Independence, Springfield, MO 65804.',
    'Order includes the 1-gallon HDX sprayer and 10 packs of 12 pine grade stakes.'
  ) then
    raise exception 'Home Depot curbside instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Pick up','Home Depot order','Home Depot — 2104 E Independence, Springfield, MO 65804',
    'Pick up the Home Depot curbside order.',
    v_task.metadata->'detail_lines'
  );

  call load_task('Check + cut Elm bouquet extras',date '2026-08-13','open');
  if coalesce(v_task.note,'')<>'Harvest copious lemon basil. Check whether goldenrod has started and cut usable stems. Add yarrow and lamb’s ear only if they are genuinely harvest-ready. Keep all of these as bonus bouquet material, not required volume.' then
    raise exception 'Elm bouquet-extra harvest instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Harvest','Elm bouquet extras','Elm Farm',
    'Check and cut Elm-grown bouquet extras for Thursday evening.',
    jsonb_build_array(
      'Harvest copious lemon basil.',
      'Check whether goldenrod has started and cut usable stems.',
      'Add yarrow and lamb’s ear only if they are genuinely harvest-ready.',
      'Keep all of these as bonus bouquet material, not required volume.'
    )
  );

  call load_task('Condition + sort Thursday flower buckets',date '2026-08-13','blocked');
  if coalesce(v_task.note,'')<>'Condition the seven sister-garden florist buckets plus any Elm lemon basil/goldenrod/yarrow/lamb’s-ear extras. Remove submerged leaves and sort loosely enough that the round table reads abundant and easy to shop.' then
    raise exception 'Thursday flower-conditioning instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Condition + sort','Thursday flower buckets','Elm Farm',
    'Condition and sort the Thursday flower buckets.',
    jsonb_build_array(
      'Condition the seven sister-garden florist buckets plus any Elm lemon basil, goldenrod, yarrow, or lamb’s-ear extras.',
      'Remove submerged leaves.',
      'Sort loosely enough that the round table reads abundant and easy to shop.'
    )
  );

  call load_task('Make basement restroom route guest-ready',date '2026-08-13','open');
  if coalesce(v_task.note,'')<>'Clear the path and stairs, light them well, clean the bathroom thoroughly, hide obvious clutter along the immediate route where practical, and place a simple temporary RESTROOM sign at the stair entrance.' then
    raise exception 'Basement restroom-route instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Make guest-ready','Basement restroom route','Basement restroom route',
    'Make the basement restroom route guest-ready.',
    jsonb_build_array(
      'Clear the path and stairs.',
      'Light the path and stairs well.',
      'Clean the bathroom thoroughly.',
      'Hide obvious clutter along the immediate route where practical.',
      'Place a simple temporary RESTROOM sign at the stair entrance.'
    )
  );

  call load_task('Set bloom bar — round table by windows',date '2026-08-13','blocked');
  if coalesce(v_task.note,'')<>'Set the conditioned florist buckets full of flowers on the round table by the windows. Include sister-garden flowers plus Elm lemon basil and any ready goldenrod/yarrow/lamb’s ear. Keep the table flower-first and uncluttered.' then
    raise exception 'Bloom-bar setup instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Set','Bloom bar','Round table by the windows',
    'Set the bloom bar on the round table by the windows.',
    jsonb_build_array(
      'Set the conditioned florist buckets full of flowers on the round table by the windows.',
      'Include sister-garden flowers plus Elm lemon basil and any ready goldenrod, yarrow, or lamb’s ear.',
      'Keep the table flower-first and uncluttered.'
    )
  );

  call load_task('Set cold-brew drink station',date '2026-08-13','blocked');
  if coalesce(v_task.note,'')<>'Stage the cold brew carafe, milk carafe, brown sugar syrup, strawberry syrup, cups, ice/water, and anything already used for Elm’s coffee service.' then
    raise exception 'Cold-brew station instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Set','Cold-brew drink station','Elm event drink station',
    'Set the cold-brew drink station.',
    jsonb_build_array('Stage the cold brew carafe, milk carafe, brown sugar syrup, strawberry syrup, cups, ice/water, and anything already used for Elm’s coffee service.')
  );

  call load_task('Set finished-bouquet holding line — staircase console',date '2026-08-13','open');
  if coalesce(v_task.note,'')<>'Along the long console on the staircase wall, line up empty florist buckets with exactly 3 inches of clean water. Put each finished, name-marked bouquet into a holding bucket until its guest is ready to leave.' then
    raise exception 'Finished-bouquet holding instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Set','Finished-bouquet holding line','Long console along the staircase wall',
    'Set the finished-bouquet holding line on the staircase console.',
    jsonb_build_array(
      'Line up empty florist buckets along the long console on the staircase wall.',
      'Put exactly 3 inches of clean water in each bucket.',
      'Put each finished, name-marked bouquet into a holding bucket until its guest is ready to leave.'
    )
  );

  call load_task('Set snips + stripping station — final round table',date '2026-08-13','blocked');
  if coalesce(v_task.note,'')<>'Use the final round table. Stage the 5 new snips plus any existing usable snips and one black florist stripping bucket for leaves/trim waste.' then
    raise exception 'Snips/stripping station instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Set','Snips + stripping station','Final round table',
    'Set the snips and stripping station on the final round table.',
    jsonb_build_array(
      'Stage the 5 new snips plus any existing usable snips.',
      'Add one black florist stripping bucket for leaves and trim waste.'
    )
  );

  call load_task('Set wrapping station — round table by clock',date '2026-08-13','blocked');
  if coalesce(v_task.note,'')<>'Use the round table by the clock. Stage pre-cut brown paper, Elm stamp + ink, green rubber bands, flower-food packets, tape dispenser, and a Sharpie for writing each guest’s name on the wrap.' then
    raise exception 'Wrapping-station instructions drifted; refusing worker normalization.';
  end if;
  call stamp_packet(
    'Set','Wrapping station','Round table by the clock',
    'Set the wrapping station on the round table by the clock.',
    jsonb_build_array(
      'Stage pre-cut brown paper, Elm stamp + ink, green rubber bands, flower-food packets, and the tape dispenser.',
      'Add a Sharpie for writing each guest’s name on the wrap.'
    )
  );
end;
$block$;
