alter table atlas.walkway_cards
  add column if not exists current_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete set null;

comment on column atlas.walkway_cards.current_occurrence_id is
  'Central release occurrence for the currently unlocked walkway move. The task may remain planned when farm capacity is full.';

create or replace function atlas.sync_walkway_card_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_card_id uuid;
  v_keys jsonb;
begin
  v_card_id := atlas.rhythm_safe_uuid_v1(new.task_payload->'metadata'->>'walkway_card_id');
  v_keys := new.task_payload->'metadata'->'walkway_card_keys';

  if v_card_id is not null then
    update atlas.walkway_cards
    set current_occurrence_id = new.id,
        current_task_id = new.released_task_id
    where id = v_card_id;
  end if;

  if jsonb_typeof(v_keys) = 'array' then
    update atlas.walkway_cards card
    set current_occurrence_id = new.id,
        current_task_id = new.released_task_id
    where card.farm_id = new.farm_id
      and card.card_key in (select jsonb_array_elements_text(v_keys));
  end if;

  return new;
end;
$$;

drop trigger if exists sync_walkway_card_occurrence_v1 on atlas.planned_work_occurrences;
create trigger sync_walkway_card_occurrence_v1
after insert or update of state, released_task_id, task_payload
on atlas.planned_work_occurrences
for each row execute function atlas.sync_walkway_card_occurrence_v1();

update atlas.walkway_cards card
set current_occurrence_id = occurrence.id,
    current_task_id = occurrence.released_task_id
from atlas.planned_work_occurrences occurrence
where occurrence.farm_id = card.farm_id
  and occurrence.title = 'Clear dead growth — Main Garden walkways + center diamond'
  and card.card_key in (
    select jsonb_array_elements_text(
      coalesce(occurrence.task_payload->'metadata'->'walkway_card_keys', '[]'::jsonb)
    )
  );
