begin;

-- Snow in Summer keeps the full canonical requirement truth, but the worker move
-- should read as a compact physical action rather than repeat management prose.
update atlas.tasks
set note = null,
    metadata = jsonb_set(
      jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{execution_do}',
        to_jsonb('Pot up 720 plants → 4 trays'::text),
        true
      ),
      '{execution_done_when}',
      to_jsonb('4 trays potted · area cleaned up'::text),
      true
    ),
    updated_at = now()
where metadata->>'task_key' = 'snow_in_summer_consolidated_pot_up_720'
   or (title = 'Pot up · Snow in Summer' and status = 'open');

-- Sticks/hoses are a procedural preflight of mowing itself, not a second weekly
-- work rhythm. Stop the independent series so the prerequisite travels with every
-- mowing card instead of appearing as an orphan task on Anna's Day.
update atlas.work_definitions
set active = false,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_reason', 'Mowing preflight is rendered as part of the mowing operation.',
      'retired_at', now()
    ),
    updated_at = now()
where metadata->>'series_key' = 'yard_stick_pickup_before_wednesday_mowing';

update atlas.tasks
set status = case when status = 'open' then 'archived' else status end,
    visibility_scope = case when status = 'open' then 'system_internal' else visibility_scope end,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'recreate_on_done', false,
        'mowing_preflight_embedded', true,
        'standalone_series_retired', true,
        'standalone_series_retired_at', now()
      ),
    updated_at = now()
where metadata->>'task_key' = 'yard_stick_pickup_before_wednesday_mowing'
   or task_series_key = 'yard_stick_pickup_before_wednesday_mowing';

update atlas.planned_work_occurrences
set state = 'cancelled',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelled_reason', 'Mowing preflight is now embedded in the mowing operation.',
      'cancelled_at', now()
    ),
    updated_at = now()
where state in ('planned', 'eligible', 'released')
  and (
    task_payload->'metadata'->>'task_key' = 'yard_stick_pickup_before_wednesday_mowing'
    or occurrence_key like '%yard_stick_pickup_before_wednesday_mowing%'
  );

commit;
