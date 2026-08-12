-- Finish-line normalization for worker-visible Aug. 12–13 tasks whose literal
-- execution truth already exists in canonical notes/detail lines. The worker
-- contract does not expose those Owner-side fields as fallback prose, so copy
-- only the execution facts into deliberate worker fields.

do $block$
declare
  v_task atlas.tasks%rowtype;
  v_action text;
  v_subject text;
  v_location text;
  v_do text;
  v_how jsonb;
  v_seen integer:=0;
begin
  for v_task in
    select t.*
    from atlas.tasks t
    where t.visibility_scope='assigned_worker'
      and t.status in ('open','blocked')
      and (
        (t.due_date=date '2026-08-12' and t.title in (
          'Clean Interior Windows + Glass Doors',
          'Kid Chore — Sweep Porches',
          'Kid Chore — Take Trash to Street for Thursday Pickup',
          'Pick Up Sticks + Put Away Hoses Before Mowing'
        ))
        or
        (t.due_date=date '2026-08-13' and t.title in (
          'Pick Up Home Depot Order — Curbside',
          'Check + cut Elm bouquet extras',
          'Condition + sort Thursday flower buckets',
          'Make basement restroom route guest-ready',
          'Set bloom bar — round table by windows',
          'Set cold-brew drink station',
          'Set finished-bouquet holding line — staircase console',
          'Set snips + stripping station — final round table',
          'Set wrapping station — round table by clock'
        ))
      )
    order by t.due_date,t.title,t.created_at desc
  loop
    v_seen:=v_seen+1;
    v_action:=null;
    v_subject:=null;
    v_location:=null;
    v_do:=null;
    v_how:=null;

    case v_task.title
      when 'Clean Interior Windows + Glass Doors' then
        if coalesce(v_task.metadata->'detail_lines','[]'::jsonb)<>jsonb_build_array(
          'Clean interior glass surfaces',
          'Remove fingerprints, dust and streaks',
          'Wipe accessible tracks and sills',
          'Leave glass clear and guest-presentable'
        ) then
          raise exception 'Interior glass detail lines drifted; refusing worker normalization.';
        end if;
        v_action:='Clean';
        v_subject:='Windows + glass doors';
        v_location:='Farmhouse + venue-facing interior glass';
        v_do:='Clean the interior windows and glass doors.';
        v_how:=v_task.metadata->'detail_lines';

      when 'Kid Chore — Sweep Porches' then
        if coalesce(v_task.note,'')<>'Sweep leaves, dirt, and loose debris away from doors and guest-visible porch areas.' then
          raise exception 'Porch-sweeping instruction drifted; refusing worker normalization.';
        end if;
        v_action:='Sweep';
        v_subject:='House porches';
        v_location:='House porches';
        v_do:='Sweep the house porches.';
        v_how:=jsonb_build_array('Sweep leaves, dirt, and loose debris away from doors and guest-visible porch areas.');

      when 'Kid Chore — Take Trash to Street for Thursday Pickup' then
        if coalesce(v_task.metadata->>'display_detail','')<>'House / street pickup' then
          raise exception 'Trash pickup location truth drifted; refusing worker normalization.';
        end if;
        v_action:='Take out';
        v_subject:='Trash for Thursday pickup';
        v_location:='House → street pickup point';
        v_do:='Take the trash to the street for Thursday pickup.';
        v_how:=jsonb_build_array('Move the house trash to the street pickup point for Thursday pickup.');

      when 'Pick Up Sticks + Put Away Hoses Before Mowing' then
        if coalesce(v_task.metadata->'detail_lines','[]'::jsonb)<>jsonb_build_array(
          'Pick up sticks, branches, and debris from mowing areas',
          'Put away hoses before mowing'
        ) then
          raise exception 'Pre-mowing yard-prep detail lines drifted; refusing worker normalization.';
        end if;
        v_action:='Prepare';
        v_subject:='Sticks + hoses before mowing';
        v_location:='Yard + mowing areas';
        v_do:='Clear sticks, branches, debris, and hoses out of the mowing areas.';
        v_how:=v_task.metadata->'detail_lines';

      when 'Pick Up Home Depot Order — Curbside' then
        if coalesce(v_task.metadata->'detail_lines','[]'::jsonb)<>jsonb_build_array(
          'Download the Home Depot app before leaving.',
          'Use curbside pickup and check in through the app when you arrive.',
          'Pickup store: Home Depot, 2104 E Independence, Springfield, MO 65804.',
          'Order includes the 1-gallon HDX sprayer and 10 packs of 12 pine grade stakes.'
        ) then
          raise exception 'Home Depot curbside instructions drifted; refusing worker normalization.';
        end if;
        v_action:='Pick up';
        v_subject:='Home Depot order';
        v_location:='Home Depot — 2104 E Independence, Springfield, MO 65804';
        v_do:='Pick up the Home Depot curbside order.';
        v_how:=v_task.metadata->'detail_lines';

      when 'Check + cut Elm bouquet extras' then
        if coalesce(v_task.note,'')<>'Harvest copious lemon basil. Check whether goldenrod has started and cut usable stems. Add yarrow and lamb’s ear only if they are genuinely harvest-ready. Keep all of these as bonus bouquet material, not required volume.' then
          raise exception 'Elm bouquet-extra harvest instructions drifted; refusing worker normalization.';
        end if;
        v_action:='Harvest';
        v_subject:='Elm bouquet extras';
        v_location:='Elm Farm';
        v_do:='Check and cut Elm-grown bouquet extras for Thursday evening.';
        v_how:=jsonb_build_array(
          'Harvest copious lemon basil.',
          'Check whether goldenrod has started and cut usable stems.',
          'Add yarrow and lamb’s ear only if they are genuinely harvest-ready.',
          'Keep all of these as bonus bouquet material, not required volume.'
        );

      when 'Condition + sort Thursday flower buckets' then
        if v_task.status<>'blocked' or coalesce(v_task.note,'')<>'Condition the seven sister-garden florist buckets plus any Elm lemon basil/goldenrod/yarrow/lamb’s-ear extras. Remove submerged leaves and sort loosely enough that the round table reads abundant and easy to shop.' then
          raise exception 'Thursday flower-conditioning truth drifted; refusing worker normalization.';
        end if;
        v_action:='Condition + sort';
        v_subject:='Thursday flower buckets';
        v_location:='Elm Farm';
        v_do:='Condition and sort the Thursday flower buckets.';
        v_how:=jsonb_build_array(
          'Condition the seven sister-garden florist buckets plus any Elm lemon basil, goldenrod, yarrow, or lamb’s-ear extras.',
          'Remove submerged leaves.',
          'Sort loosely enough that the round table reads abundant and easy to shop.'
        );

      when 'Make basement restroom route guest-ready' then
        if coalesce(v_task.note,'')<>'Clear the path and stairs, light them well, clean the bathroom thoroughly, hide obvious clutter along the immediate route where practical, and place a simple temporary RESTROOM sign at the stair entrance.' then
          raise exception 'Basement restroom-route instructions drifted; refusing worker normalization.';
        end if;
        v_action:='Make guest-ready';
        v_subject:='Basement restroom route';
        v_location:='Basement restroom route';
        v_do:='Make the basement restroom route guest-ready.';
        v_how:=jsonb_build_array(
          'Clear the path and stairs.',
          'Light the path and stairs well.',
          'Clean the bathroom thoroughly.',
          'Hide obvious clutter along the immediate route where practical.',
          'Place a simple temporary RESTROOM sign at the stair entrance.'
        );

      when 'Set bloom bar — round table by windows' then
        if v_task.status<>'blocked' or coalesce(v_task.note,'')<>'Set the conditioned florist buckets full of flowers on the round table by the windows. Include sister-garden flowers plus Elm lemon basil and any ready goldenrod/yarrow/lamb’s ear. Keep the table flower-first and uncluttered.' then
          raise exception 'Bloom-bar setup truth drifted; refusing worker normalization.';
        end if;
        v_action:='Set';
        v_subject:='Bloom bar';
        v_location:='Round table by the windows';
        v_do:='Set the bloom bar on the round table by the windows.';
        v_how:=jsonb_build_array(
          'Set the conditioned florist buckets full of flowers on the round table by the windows.',
          'Include sister-garden flowers plus Elm lemon basil and any ready goldenrod, yarrow, or lamb’s ear.',
          'Keep the table flower-first and uncluttered.'
        );

      when 'Set cold-brew drink station' then
        if v_task.status<>'blocked' or coalesce(v_task.note,'')<>'Stage the cold brew carafe, milk carafe, brown sugar syrup, strawberry syrup, cups, ice/water, and anything already used for Elm’s coffee service.' then
          raise exception 'Cold-brew station truth drifted; refusing worker normalization.';
        end if;
        v_action:='Set';
        v_subject:='Cold-brew drink station';
        v_location:='Elm event drink station';
        v_do:='Set the cold-brew drink station.';
        v_how:=jsonb_build_array('Stage the cold brew carafe, milk carafe, brown sugar syrup, strawberry syrup, cups, ice/water, and anything already used for Elm’s coffee service.');

      when 'Set finished-bouquet holding line — staircase console' then
        if coalesce(v_task.note,'')<>'Along the long console on the staircase wall, line up empty florist buckets with exactly 3 inches of clean water. Put each finished, name-marked bouquet into a holding bucket until its guest is ready to leave.' then
          raise exception 'Finished-bouquet holding truth drifted; refusing worker normalization.';
        end if;
        v_action:='Set';
        v_subject:='Finished-bouquet holding line';
        v_location:='Long console along the staircase wall';
        v_do:='Set the finished-bouquet holding line on the staircase console.';
        v_how:=jsonb_build_array(
          'Line up empty florist buckets along the long console on the staircase wall.',
          'Put exactly 3 inches of clean water in each bucket.',
          'Put each finished, name-marked bouquet into a holding bucket until its guest is ready to leave.'
        );

      when 'Set snips + stripping station — final round table' then
        if v_task.status<>'blocked' or coalesce(v_task.note,'')<>'Use the final round table. Stage the 5 new snips plus any existing usable snips and one black florist stripping bucket for leaves/trim waste.' then
          raise exception 'Snips/stripping station truth drifted; refusing worker normalization.';
        end if;
        v_action:='Set';
        v_subject:='Snips + stripping station';
        v_location:='Final round table';
        v_do:='Set the snips and stripping station on the final round table.';
        v_how:=jsonb_build_array(
          'Stage the 5 new snips plus any existing usable snips.',
          'Add one black florist stripping bucket for leaves and trim waste.'
        );

      when 'Set wrapping station — round table by clock' then
        if v_task.status<>'blocked' or coalesce(v_task.note,'')<>'Use the round table by the clock. Stage pre-cut brown paper, Elm stamp + ink, green rubber bands, flower-food packets, tape dispenser, and a Sharpie for writing each guest’s name on the wrap.' then
          raise exception 'Wrapping-station truth drifted; refusing worker normalization.';
        end if;
        v_action:='Set';
        v_subject:='Wrapping station';
        v_location:='Round table by the clock';
        v_do:='Set the wrapping station on the round table by the clock.';
        v_how:=jsonb_build_array(
          'Stage pre-cut brown paper, Elm stamp + ink, green rubber bands, flower-food packets, and the tape dispenser.',
          'Add a Sharpie for writing each guest’s name on the wrap.'
        );
    end case;

    if v_action is null or v_do is null or v_how is null or jsonb_typeof(v_how)<>'array' or jsonb_array_length(v_how)=0 then
      raise exception 'Worker packet assembly failed for %.',v_task.title;
    end if;

    update atlas.tasks t
    set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
          'display_action',v_action,
          'display_subject',v_subject,
          'display_location',v_location,
          'execution_do',v_do,
          'execution_place',v_location,
          'execution_how',v_how,
          'worker_execution_normalized_at',now(),
          'worker_execution_normalized_source','aug12_aug13_worker_packet_normalization_v1'
        ),
        updated_at=now()
    where t.id=v_task.id;
  end loop;

  if v_seen<>13 then
    raise exception 'Expected 13 current worker acceptance tasks, found %; refusing partial normalization.',v_seen;
  end if;
end;
$block$;
