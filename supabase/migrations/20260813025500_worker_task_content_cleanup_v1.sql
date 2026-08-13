begin;

-- The weekly Elm harvest rhythm should ask Atlas what is actually in the
-- harvest window instead of carrying one week's crop names forever.
update atlas.tasks
set metadata = coalesce(metadata, '{}'::jsonb) - 'execution_how',
    note = null,
    updated_at = now()
where task_series_key = 'anna_harvest_thursday_weekly'
  and status <> 'archived';

-- Trading Post stickers are the actual closing supply for this station. Tape is
-- not a conditional worker instruction and should not appear in Task Focus.
update atlas.tasks
set metadata = (
      case
        when jsonb_typeof(coalesce(metadata, '{}'::jsonb)->'execution_how') = 'array' then
          jsonb_set(
            coalesce(metadata, '{}'::jsonb) - 'substitution_plan',
            '{execution_how}',
            coalesce((
              select jsonb_agg(value order by ordinality)
              from jsonb_array_elements(coalesce(metadata, '{}'::jsonb)->'execution_how') with ordinality as step(value, ordinality)
              where value #>> '{}' not ilike '%usable tape%'
                and value #>> '{}' not ilike '%tape purchase%'
            ), '[]'::jsonb),
            true
          )
        else coalesce(metadata, '{}'::jsonb) - 'substitution_plan'
      end
    ),
    note = 'Round table by the clock. Set out the brown paper rectangles, Elm Farm stamp + ink, green rubber bands, flower-food packets, a Sharpie, and the small Elm Farm Trading Post stickers to close the wraps.',
    updated_at = now()
where metadata->>'work_definition_key' = 'thursdays_retail_stock_wrapping_station'
  and status <> 'archived';

commit;
