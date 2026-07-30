alter table atlas.walkway_cards
  add column if not exists current_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete set null;

comment on column atlas.walkway_cards.current_occurrence_id is
  'Central release occurrence for the currently unlocked walkway move. The task may remain planned when farm capacity is full.';
