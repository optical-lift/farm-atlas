alter table atlas.crop_harvest_events drop constraint if exists crop_harvest_events_outcome_check;

alter table atlas.crop_harvest_events
  add constraint crop_harvest_events_outcome_check
  check (outcome = any (array[
    'not_ready'::text,
    'beginning'::text,
    'harvestable'::text,
    'declining'::text,
    'finished'::text,
    'problem_or_uncertain'::text,
    'harvested_more'::text,
    'harvested_finished'::text,
    'harvested_uncertain'::text,
    'harvested_amount'::text,
    'deadheaded'::text,
    'crop_exhausted'::text
  ]));