insert into atlas.farm_round_member_series(
  farm_id,task_series_key,route_stop_key,route_stop_label,route_order,member_order,
  display_label,display_detail,issue_options,active,metadata
)
select f.id,'anna_water_indoor_plants_saturday','house','House',10,30,
  'Water indoor plants',null,'["Water unavailable","Plant stress","Other"]'::jsonb,true,
  jsonb_build_object('source','farm_round_indoor_plants_v1','scheduleOwnership','existing_series')
from atlas.farms f
where f.stable_key='elm_farm'
on conflict (farm_id,task_series_key) do update
set route_stop_key=excluded.route_stop_key,
    route_stop_label=excluded.route_stop_label,
    route_order=excluded.route_order,
    member_order=excluded.member_order,
    display_label=excluded.display_label,
    display_detail=excluded.display_detail,
    issue_options=excluded.issue_options,
    active=true,
    metadata=atlas.farm_round_member_series.metadata||excluded.metadata,
    updated_at=now();

do $$
declare
  v_farm_id uuid;
  v_membership_id uuid;
  r record;
  v_result jsonb;
  v_parent_id uuid;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id into v_membership_id from atlas.farm_memberships
    where farm_id=v_farm_id and active and worker_key='anna'
    order by created_at limit 1;

  for r in
    select distinct planned_due_date
    from atlas.planned_work_occurrences
    where farm_id=v_farm_id
      and planned_due_date >= (now() at time zone 'America/Chicago')::date
      and planned_due_date <= (now() at time zone 'America/Chicago')::date + 90
      and coalesce(task_payload->>'task_series_key',task_payload->'metadata'->>'task_series_key')='anna_water_indoor_plants_saturday'
      and state<>'cancelled'
    order by planned_due_date
  loop
    v_result:=atlas.ensure_farm_round_for_date_v1(v_farm_id,v_membership_id,r.planned_due_date);
    begin
      v_parent_id:=nullif(v_result->>'parentOccurrenceId','')::uuid;
    exception when invalid_text_representation then
      v_parent_id:=null;
    end;
    if v_parent_id is not null then
      perform atlas.refresh_farm_round_preview_v1(v_parent_id);
      if exists(select 1 from atlas.planned_work_occurrences where id=v_parent_id and released_task_id is not null) then
        perform atlas.materialize_farm_round_members_v1(v_parent_id,r.planned_due_date);
      end if;
    end if;
  end loop;
end $$;
