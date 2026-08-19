create or replace function atlas.normalize_seed_inventory_quantity_knowledge_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $$
begin
  if new.status in ('verified','depleted') and new.verified_on_hand_quantity is not null then
    new.quantity_knowledge_kind:='exact';
    new.known_lower_bound_quantity:=new.verified_on_hand_quantity;
  elsif new.status='bounded' then
    if new.known_lower_bound_quantity is null then
      raise exception 'Bounded seed inventory requires a known lower-bound quantity.' using errcode='22023';
    end if;
    new.verified_on_hand_quantity:=null;
    new.quantity_knowledge_kind:='lower_bound';
  elsif new.status='uncertain' and new.verified_on_hand_quantity is null then
    if new.quantity_knowledge_kind not in ('positive_unknown','unknown') then
      new.quantity_knowledge_kind:='unknown';
      new.known_lower_bound_quantity:=null;
    end if;
  elsif new.verified_on_hand_quantity is null and new.quantity_knowledge_kind='exact' then
    new.quantity_knowledge_kind:='unknown';
    new.known_lower_bound_quantity:=null;
  end if;
  return new;
end;
$$;

drop trigger if exists seed_inventory_state_normalize_quantity_knowledge_v1 on atlas.seed_inventory_state;
create trigger seed_inventory_state_normalize_quantity_knowledge_v1
before insert or update of status,verified_on_hand_quantity,quantity_knowledge_kind,known_lower_bound_quantity
on atlas.seed_inventory_state
for each row execute function atlas.normalize_seed_inventory_quantity_knowledge_v1();

revoke all on function atlas.normalize_seed_inventory_quantity_knowledge_v1() from public,anon,authenticated;

comment on function atlas.normalize_seed_inventory_quantity_knowledge_v1() is 'OR3 compatibility projection: exact physical counts/depletion automatically become exact knowledge, bounded evidence stays lower-bound knowledge, and unknown/positive-unknown states cannot accidentally retain an exact quantity.';