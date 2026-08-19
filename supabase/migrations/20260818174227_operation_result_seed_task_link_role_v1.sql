create or replace function atlas.link_seed_lot_metadata_task_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $$
declare v_seed_lot_id uuid;v_role text;
begin
  v_seed_lot_id:=atlas.rhythm_safe_uuid_v1(new.metadata->>'seed_lot_id');
  if v_seed_lot_id is null then return new; end if;
  if not exists(select 1 from atlas.seed_lots sl where sl.id=v_seed_lot_id and sl.farm_id=new.farm_id) then return new; end if;
  v_role:=case
    when new.task_type='seed_inventory_decision' then 'inventory_purchase_decision'
    when new.task_type='seed_inventory_recount' and new.status='blocked' then 'inventory_problem'
    when new.task_type='seed_inventory_recount' then 'inventory_recount'
    when coalesce(new.action_key,'')='sow' or coalesce(new.metadata->>'work_route','')='sow' then 'sowing_input'
    else 'inventory_recount' end;
  insert into atlas.seed_lot_task_links(seed_lot_id,task_id,link_role,source,metadata)
  values(v_seed_lot_id,new.id,v_role,'task_metadata_v1',jsonb_build_object('task_type',new.task_type,'task_style',new.metadata->>'task_style'))
  on conflict(seed_lot_id,task_id) do update set
    link_role=excluded.link_role,source=excluded.source,
    metadata=atlas.seed_lot_task_links.metadata||excluded.metadata,updated_at=now();
  return new;
end;
$$;

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb),updated_at=now()
where t.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and t.metadata->>'task_key' in ('owner_20260814_sow_procut_orange_fr13_fr14','anna_20260817_sow_procut_orange_fr11_fr12_after_turnover')
  and nullif(t.metadata->>'seed_lot_id','') is not null;

comment on function atlas.link_seed_lot_metadata_task_v1() is 'Canonical seed-lot task linker. OR3 distinguishes sowing_input from inventory recount/problem/decision roles so sow operations do not masquerade as inventory tasks.';