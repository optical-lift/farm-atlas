-- Generic work feeds show one Grow Room doorway. Batch-level and room-specific action
-- work remains available inside the prepared Grow Room reader.
create or replace function atlas.home_task_cards_v2(
  p_farm_id uuid,
  p_worker_key text,
  p_due_through date,
  p_done_date date
)
returns setof atlas.v_task_cards
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select card.*
  from atlas.home_task_cards_v1(p_farm_id, p_worker_key, p_due_through, p_done_date) card
  where
    (
      card.task_type = 'grow_room_care'
      and lower(card.title) in ('grow room care', 'water + check grow room', 'check grow room')
    )
    or not (
      coalesce(card.zone_key, '') = 'grow_room'
      or coalesce(card.zone_label, '') ilike '%grow room%'
      or coalesce(card.metadata ->> 'collection_zone', '') ilike '%grow room%'
      or coalesce(card.metadata ->> 'location_label', '') ilike '%grow room%'
      or coalesce(card.metadata ->> 'work_route', '') in (
        'grow_room_check', 'grow_room_audit', 'pot_up', 'hardening_off', 'soil_block', 'grow_room_setup', 'grow_room_care'
      )
    );
$function$;

revoke all on function atlas.home_task_cards_v2(uuid, text, date, date) from public;
grant execute on function atlas.home_task_cards_v2(uuid, text, date, date) to authenticated;

comment on function atlas.home_task_cards_v2(uuid, text, date, date) is
  'Membership-scoped work feed with one Grow Room doorway; internal room actions are read from grow_room_state_v1.';
