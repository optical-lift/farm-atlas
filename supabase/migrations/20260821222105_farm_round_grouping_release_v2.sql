-- A dated Farm Round parent is not a singleton global serving. Allow independent dated parents.
update atlas.work_release_policies p
set maximum_active_instances=32,updated_at=now()
where p.farm_id=(select id from atlas.farms where stable_key='elm_farm')
  and p.stable_key='farm_round:stewardship:v1:time_window';

-- Group already-planned stewardship occurrences so future days use the parent relationship immediately.
do $$
declare
  v_farm uuid;
  v_anna uuid;
  r record;
begin
  select id into v_farm from atlas.farms where stable_key='elm_farm';
  select id into v_anna from atlas.farm_memberships where farm_id=v_farm and active and worker_key='anna' order by created_at limit 1;
  for r in
    select distinct o.planned_due_date
    from atlas.planned_work_occurrences o
    join atlas.farm_round_member_series cfg
      on cfg.farm_id=o.farm_id and cfg.active
     and cfg.task_series_key=coalesce(o.task_payload->>'task_series_key',o.task_payload->'metadata'->>'task_series_key')
    where o.farm_id=v_farm
      and nullif(o.task_payload->>'assigned_membership_id','')::uuid=v_anna
      and o.state<>'cancelled'
      and o.planned_due_date between (now() at time zone 'America/Chicago')::date and (now() at time zone 'America/Chicago')::date+60
    order by o.planned_due_date
  loop
    perform atlas.ensure_farm_round_for_date_v1(v_farm,v_anna,r.planned_due_date);
  end loop;
end $$;
