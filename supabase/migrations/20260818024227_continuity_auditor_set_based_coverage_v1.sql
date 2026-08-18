do $do$
declare
  v_oid oid;
  v_def text;
  v_start integer;
  v_classified integer;
  v_replacement text := $replacement$  with active_cycles as materialized (
    select
      cc.*,
      z.stable_key as zone_key,
      go.label as object_label
    from atlas.crop_cycles cc
    left join atlas.growing_objects go on go.id=cc.object_id
    left join atlas.zones z on z.id=go.zone_id
    where cc.farm_id=p_farm_id
      and coalesce(cc.lifecycle_status,'active')='active'
  ), farm_tasks as materialized (
    select t.id,t.status,t.metadata
    from atlas.tasks t
    where t.farm_id=p_farm_id
  ), task_cycle_links as materialized (
    select distinct ft.id as task_id,tc.crop_cycle_id
    from farm_tasks ft
    join atlas.task_crop_cycles tc on tc.task_id=ft.id
    union
    select distinct ft.id,c.id
    from farm_tasks ft
    join active_cycles c on ft.metadata->>'crop_cycle_id'=c.id::text
    union
    select distinct ft.id,c.id
    from farm_tasks ft
    join active_cycles c on coalesce(ft.metadata->'crop_cycle_ids','[]'::jsonb) ? c.id::text
  ), current_cycles as (
    select distinct l.crop_cycle_id
    from task_cycle_links l
    join farm_tasks t on t.id=l.task_id
    where t.status in ('open','blocked')
  ), future_cycles as (
    select distinct o.source_id as crop_cycle_id
    from atlas.planned_work_occurrences o
    join active_cycles c on c.id=o.source_id
    where o.farm_id=p_farm_id
      and o.state in ('planned','eligible','released')
      and o.source_kind='crop_cycle'
    union
    select distinct l.crop_cycle_id
    from atlas.planned_work_occurrences o
    join task_cycle_links l on l.task_id=o.released_task_id
    where o.farm_id=p_farm_id
      and o.state in ('planned','eligible','released')
  ), coverage as (
    select c.id,
      (cur.crop_cycle_id is not null) as has_current_task,
      (fut.crop_cycle_id is not null) as has_future_occurrence
    from active_cycles c
    left join current_cycles cur on cur.crop_cycle_id=c.id
    left join future_cycles fut on fut.crop_cycle_id=c.id
  ), $replacement$;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.relnamespace
  where n.nspname='atlas'
    and p.proname='farm_continuity_audit_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_as_of_date date';
  if v_oid is null then raise exception 'farm_continuity_audit_v1 not found'; end if;

  v_def:=pg_get_functiondef(v_oid);
  v_start:=position('  with active_cycles as (' in v_def);
  v_classified:=position('classified as (' in v_def);
  if v_start=0 or v_classified=0 or v_classified<=v_start then
    raise exception 'Expected v1 coverage block markers were not found';
  end if;

  v_def:=substr(v_def,1,v_start-1)||v_replacement||substr(v_def,v_classified);
  execute v_def;
end
$do$;