create or replace function atlas.refresh_production_transplant_gate_from_prep_task_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_lot_id uuid;
begin
  if new.status is not distinct from old.status or new.generated_from is distinct from 'production_bed_assignment' then return new; end if;
  begin v_lot_id:=(new.metadata->>'production_lot_id')::uuid; exception when others then v_lot_id:=null; end;
  if v_lot_id is not null and exists(select 1 from atlas.production_transplant_gates where production_lot_id=v_lot_id and gate_status<>'transplanted') then perform atlas.refresh_production_transplant_gate_v1(v_lot_id); end if;
  return new;
end; $$;
create trigger trg_refresh_production_transplant_gate_from_prep after update of status on atlas.tasks for each row execute function atlas.refresh_production_transplant_gate_from_prep_task_v1();
