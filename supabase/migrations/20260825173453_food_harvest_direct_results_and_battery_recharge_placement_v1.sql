create or replace function atlas.ensure_worker_day_battery_recharge_v1(p_farm_id uuid,p_membership_id uuid,p_service_date date)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
declare v_member atlas.farm_memberships%rowtype; v_task atlas.tasks%rowtype; v_occurrence uuid; v_materialized jsonb; v_task_id uuid;
begin
select * into v_member from atlas.farm_memberships where id=p_membership_id and farm_id=p_farm_id and active;
if v_member.id is null then raise exception 'Active worker membership required.' using errcode='42501'; end if;
select * into v_task from atlas.tasks t where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.due_date=p_service_date and t.status in ('open','blocked') and (t.metadata->>'restores_resource_key'='battery_push_mower_battery_set' or (t.title='Charge DeWalt Batteries for Mowing' and t.task_type='mowing_preparation')) order by t.created_at limit 1;
if v_task.id is not null then
  update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('restores_resource_key','battery_push_mower_battery_set','resource_recharge_contract','rechargeable_resource_day_v2','work_order_anchor','afternoon','day_window','afternoon','display_action','Charge','display_subject','DeWalt batteries for mowing'),updated_at=now() where id=v_task.id;
  insert into atlas.worker_day_task_placements(organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,placement_source,placement_reason,state,planned_start_at)
  select f.organization_id,p_farm_id,p_membership_id,v_task.id,p_service_date,'afternoon',50,'atlas','Recharge must sit between two battery mower sessions.','placed',null from atlas.farms f where f.id=p_farm_id
  on conflict(task_id) do update set membership_id=excluded.membership_id,service_date=excluded.service_date,day_window='afternoon',sort_order=50,placement_source='atlas',placement_reason=excluded.placement_reason,state='placed',planned_start_at=null,updated_at=now();
  return jsonb_build_object('state','kept_current','taskId',v_task.id,'dueDate',p_service_date,'placement','afternoon');
end if;
v_occurrence:=atlas.plan_fixed_assigned_worker_occurrence_v1(p_farm_id=>p_farm_id,p_membership_id=>v_member.id,p_user_id=>v_member.user_id,p_definition_key=>'battery_push_mower_recharge_v1',p_policy_key=>'battery_push_mower_recharge_v1:release',p_occurrence_key=>'resource-recharge:battery_push_mower_battery_set:'||p_service_date::text,p_title=>'Charge DeWalt Batteries for Mowing',p_task_type=>'mowing_preparation',p_due_date=>p_service_date,p_priority=>'high',p_action_key=>'prepare',p_series_key=>'battery_push_mower_recharge',p_effort_units=>0.25,p_metadata=>jsonb_build_object('task_style','resource_recharge','display_action','Charge','display_subject','DeWalt batteries for mowing','display_location','Battery charging station','collection_zone','Mowing preparation','collection_label','Mowing preparation','work_route','prepare','work_order_anchor','afternoon','day_window','afternoon','quick_complete_allowed',true,'restores_resource_key','battery_push_mower_battery_set','resource_recharge_contract','rechargeable_resource_day_v2','completion_independent_schedule',true));
if p_service_date<=(now() at time zone 'America/Chicago')::date then
  v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence,(now() at time zone 'America/Chicago')::date);
  begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  if v_task_id is not null then
    insert into atlas.worker_day_task_placements(organization_id,farm_id,membership_id,task_id,service_date,day_window,sort_order,placement_source,placement_reason,state,planned_start_at,planned_occurrence_id)
    select f.organization_id,p_farm_id,p_membership_id,v_task_id,p_service_date,'afternoon',50,'atlas','Recharge must sit between two battery mower sessions.','placed',null,v_occurrence from atlas.farms f where f.id=p_farm_id
    on conflict(task_id) do update set membership_id=excluded.membership_id,service_date=excluded.service_date,day_window='afternoon',sort_order=50,placement_source='atlas',placement_reason=excluded.placement_reason,state='placed',planned_start_at=null,planned_occurrence_id=coalesce(atlas.worker_day_task_placements.planned_occurrence_id,excluded.planned_occurrence_id),updated_at=now();
  end if;
end if;
return jsonb_build_object('state',case when v_task_id is null then 'planned' else 'released' end,'taskId',v_task_id,'occurrenceId',v_occurrence,'dueDate',p_service_date,'placement',case when v_task_id is null then null else 'afternoon' end);
end;$function$;

create or replace function atlas.weekly_food_harvest_candidate_cycles_v1(p_task_id uuid)
returns table(crop_cycle_id uuid,crop_label text,variety text,object_id uuid,object_label text,window_start date,window_end date,cycle_state text,availability_status text)
language sql stable security definer set search_path to 'pg_catalog','atlas' as $function$
with ctx as (select t.id,t.farm_id,coalesce(t.due_date,(now() at time zone 'America/Chicago')::date) service_date from atlas.tasks t where t.id=p_task_id and t.task_type='food_harvest' and t.task_series_key='anna_food_harvest_tuesday_weekly')
select cc.id,coalesce(nullif(cc.crop_label,''),'Crop'),nullif(cc.variety,''),cc.object_id,coalesce(nullif(go.label,''),'Location unrecorded'),cc.expected_harvest_watch_start,coalesce(cc.expected_harvest_watch_end,cc.expected_harvest_watch_start+21),coalesce(nullif(cc.cycle_state,''),'growing'),cha.status
from ctx join atlas.crop_cycles cc on cc.farm_id=ctx.farm_id join atlas.crop_profiles cp on cp.id=cc.crop_profile_id left join atlas.growing_objects go on go.id=cc.object_id left join atlas.crop_harvest_availability cha on cha.crop_cycle_id=cc.id
where coalesce(cc.lifecycle_status,'active')='active' and coalesce(cp.metadata->'use_tags','[]'::jsonb)?'food' and cc.expected_harvest_watch_start is not null and coalesce(go.stable_key,'') not like 'grow_room_%' and lower(coalesce(cc.cycle_state,'')) not in ('failed','cleared','finished','finished_harvest') and coalesce(cha.status,'watching')<>'finished' and cc.expected_harvest_watch_start<=ctx.service_date and coalesce(cc.expected_harvest_watch_end,cc.expected_harvest_watch_start+21)>=ctx.service_date
order by coalesce(go.label,'~'),cc.crop_label,cc.variety,cc.id;
$function$;

insert into atlas.crop_profiles(stable_key,crop_label,variety,days_to_harvest_watch_min,days_to_harvest_watch_max,harvest_pattern,metadata)
values('container_zucchini_generic','Zucchini','Container zucchini',45,60,'repeat_pick',jsonb_build_object('use_tags',jsonb_build_array('food'),'source','owner_confirmed_harvestable_2026_08_25'))
on conflict(stable_key) do update set crop_label=excluded.crop_label,variety=excluded.variety,days_to_harvest_watch_min=excluded.days_to_harvest_watch_min,days_to_harvest_watch_max=excluded.days_to_harvest_watch_max,harvest_pattern=excluded.harvest_pattern,metadata=coalesce(atlas.crop_profiles.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now();

update atlas.crop_cycles cc set crop_profile_id=cp.id,cycle_state='harvesting',harvest_started_date=coalesce(cc.harvest_started_date,date '2026-08-25'),expected_harvest_watch_start=date '2026-08-25',expected_harvest_watch_end=greatest(coalesce(cc.expected_harvest_watch_end,date '2026-09-07'),date '2026-09-07'),metadata=coalesce(cc.metadata,'{}'::jsonb)||jsonb_build_object('harvestability_source','owner_confirmed_2026_08_25'),updated_at=now() from atlas.crop_profiles cp where cc.id='2aff628f-be53-4531-a3b5-161724f4ad21' and cp.stable_key='container_zucchini_generic';
update atlas.crop_cycles set cycle_state='harvesting',harvest_started_date=coalesce(harvest_started_date,date '2026-08-25'),expected_harvest_watch_start=least(coalesce(expected_harvest_watch_start,date '2026-08-25'),date '2026-08-25'),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('harvestability_source','owner_confirmed_2026_08_25'),updated_at=now() where id='5c7f55c2-003d-4936-96b5-2d04b548003b';

do $block$
declare v_farm uuid; v_profile uuid; v_object uuid; v_cycle uuid;
begin
select id into v_farm from atlas.farms where name='Elm Farm' limit 1;
select id into v_profile from atlas.crop_profiles where stable_key='muncher_cucumber';
if v_farm is not null and v_profile is not null then
  select id into v_object from atlas.growing_objects where farm_id=v_farm and stable_key='food_harvest_cucumber_location_unrecorded';
  if v_object is null then
    insert into atlas.growing_objects(farm_id,zone_id,stable_key,label,object_type,object_mode,guest_visible,sort_order,metadata)
    values(v_farm,null,'food_harvest_cucumber_location_unrecorded','Cucumber location unrecorded','area','epistemic_placeholder',false,99999,jsonb_build_object('physical_location_known',false,'purpose','Hold owner-confirmed living crop truth without inventing a bed.','source','owner_confirmed_harvestable_2026_08_25')) returning id into v_object;
  end if;
  select id into v_cycle from atlas.crop_cycles where farm_id=v_farm and crop_cycle_key='owner-confirmed:muncher-cucumber:2026-08-25';
  if v_cycle is null then
    insert into atlas.crop_cycles(farm_id,object_id,crop_profile_id,crop_cycle_key,crop_label,variety,cycle_state,lifecycle_status,harvest_started_date,expected_harvest_watch_start,expected_harvest_watch_end,metadata)
    values(v_farm,v_object,v_profile,'owner-confirmed:muncher-cucumber:2026-08-25','Muncher Cucumber','Muncher','harvesting','active',date '2026-08-25',date '2026-08-25',date '2026-09-15',jsonb_build_object('harvestability_source','owner_confirmed_2026_08_25','physical_location_known',false,'location_status','unrecorded'));
  else
    update atlas.crop_cycles set object_id=v_object,crop_profile_id=v_profile,cycle_state='harvesting',lifecycle_status='active',harvest_started_date=coalesce(harvest_started_date,date '2026-08-25'),expected_harvest_watch_start=date '2026-08-25',expected_harvest_watch_end=greatest(coalesce(expected_harvest_watch_end,date '2026-09-15'),date '2026-09-15'),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('harvestability_source','owner_confirmed_2026_08_25','physical_location_known',false,'location_status','unrecorded'),updated_at=now() where id=v_cycle;
  end if;
end if;
end;$block$;

do $block$
declare v_farm uuid; v_member uuid;
begin
select f.id into v_farm from atlas.farms f where f.name='Elm Farm' limit 1;
select t.assigned_membership_id into v_member from atlas.tasks t where t.farm_id=v_farm and t.due_date=date '2026-08-25' and t.metadata->>'battery_resource_key'='battery_push_mower_battery_set' and t.status='open' order by t.created_at limit 1;
if v_farm is not null and v_member is not null then perform atlas.reconcile_worker_day_battery_sessions_v1(v_farm,v_member,date '2026-08-25'); end if;
end;$block$;