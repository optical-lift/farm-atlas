-- Fix Phase 3 preview function output-name collisions by using internal aliases.
create or replace function atlas.preview_maintenance_schedule(
  p_farm_key text default 'elm_farm',
  p_start_date date default current_date,
  p_days integer default 7,
  p_maintenance_type text default 'weed'
)
returns table (
  schedule_date date, window_key text, window_minutes integer,
  window_used_minutes integer, window_remaining_minutes integer,
  sequence_in_window integer, maintenance_object_id uuid, object_id uuid,
  object_key text, object_label text, zone_key text, zone_label text,
  condition text, estimated_minutes integer, priority_score numeric,
  effective_priority_score numeric, owner_priority integer,
  next_eligible_date date, must_precede_task boolean,
  dependent_task_ids uuid[], dependent_task_labels text[],
  guest_facing boolean, crop_protective boolean, revenue_linked boolean,
  significant_day_work boolean, estimate_source text, priority_reasons text[]
)
language plpgsql
security invoker
set search_path = atlas, public
as $$
declare
  v_farm_id uuid; v_morning integer; v_evening integer; v_light_evening integer;
  v_date date; v_day integer; v_has_significant boolean; v_booking_soon boolean;
  v_morning_left integer; v_evening_left integer; v_morning_seq integer; v_evening_seq integer;
  v_rec record;
begin
  if p_days < 1 or p_days > 31 then raise exception 'p_days must be between 1 and 31'; end if;
  select f.id into v_farm_id from atlas.farms f where f.stable_key=p_farm_key;
  if v_farm_id is null then raise exception 'Unknown farm key: %',p_farm_key; end if;
  select s.morning_minutes,s.evening_minutes,s.light_day_evening_minutes
    into v_morning,v_evening,v_light_evening
  from atlas.maintenance_scheduler_settings s
  where s.farm_id=v_farm_id and s.maintenance_type=p_maintenance_type and s.active;
  v_morning:=coalesce(v_morning,120); v_evening:=coalesce(v_evening,60); v_light_evening:=coalesce(v_light_evening,120);
  create temporary table if not exists pg_temp.atlas_preview_reserved_objects(maintenance_object_id uuid primary key) on commit drop;
  truncate pg_temp.atlas_preview_reserved_objects;

  for v_day in 0..p_days-1 loop
    v_date:=p_start_date+v_day;
    select exists(select 1 from atlas.tasks t where t.farm_id=v_farm_id and t.status in('open','blocked') and t.due_date=v_date
      and (lower(coalesce(t.task_type,''))~'(plant|sow|transplant|mow|harvest|irrigat|water|venue|event|setup|set_up|tear_down)'
        or lower(coalesce(t.metadata->>'work_route',''))~'(plant|sow|mow|harvest|water|venue)'
        or lower(coalesce(t.metadata->>'collection_zone',''))='venue')) into v_has_significant;
    select exists(select 1 from atlas.tasks t where t.farm_id=v_farm_id and t.status in('open','blocked') and t.due_date between v_date and v_date+7
      and (lower(coalesce(t.task_type,''))~'(venue|event|setup|set_up|tear_down)'
        or lower(coalesce(t.metadata->>'collection_zone',''))='venue')) into v_booking_soon;
    v_morning_left:=v_morning; v_evening_left:=case when v_has_significant then v_evening else v_light_evening end;
    v_morning_seq:=0; v_evening_seq:=0;

    for v_rec in
      with ranked as(
        select mo.id as mo_id,mo.object_id as go_id,go.stable_key as go_key,go.label as go_label,
          z.stable_key as z_key,z.label as z_label,mo.condition as mo_condition,
          greatest(0,mo.remaining_effort_minutes) as effort_minutes,mo.priority_score as base_priority,
          mo.owner_priority as owner_rank,mo.next_eligible_date as eligible_date,
          mo.must_precede_task as precedes_task,mo.guest_facing as is_guest_facing,
          mo.crop_protective as is_crop_protective,mo.revenue_linked as is_revenue_linked,
          mo.estimate_source as effort_source,
          coalesce((select array_agg(md.dependent_task_id order by t.title) from atlas.maintenance_dependencies md join atlas.tasks t on t.id=md.dependent_task_id where md.maintenance_object_id=mo.id and md.active and md.satisfied_at is null),'{}'::uuid[]) as dep_ids,
          coalesce((select array_agg(t.title order by t.title) from atlas.maintenance_dependencies md join atlas.tasks t on t.id=md.dependent_task_id where md.maintenance_object_id=mo.id and md.active and md.satisfied_at is null),'{}'::text[]) as dep_labels,
          (mo.priority_score+mo.crop_loss_risk+mo.revenue_unlock_score+mo.planting_block_score+mo.guest_visibility_score+mo.weed_spread_risk
            +case when v_booking_soon and mo.guest_facing then 60 else mo.upcoming_booking_score end
            +least(90,greatest(0,(v_date-mo.next_eligible_date))*3)
            +case mo.condition when 'reset' then 100 when 'heavy' then 80 when 'moderate' then 35 else 10 end
            +case when mo.owner_priority>0 then 10000+mo.owner_priority*100 else 0 end)::numeric as effective_score,
          array_remove(array[
            case when mo.owner_priority>0 then 'owner override' end,
            case when mo.must_precede_task then 'unlocks '||coalesce((select string_agg(t.title,', ' order by t.title) from atlas.maintenance_dependencies md join atlas.tasks t on t.id=md.dependent_task_id where md.maintenance_object_id=mo.id and md.active and md.satisfied_at is null),'dependent work') end,
            case when mo.crop_loss_risk>=60 then 'crop loss risk' end,
            case when mo.revenue_unlock_score>=60 then 'revenue unlocked' end,
            case when v_booking_soon and mo.guest_facing then 'upcoming venue booking' end,
            case when mo.guest_facing then 'guest visible' end,
            case when mo.weed_spread_risk>=60 then 'weed spread risk' end,
            case when mo.next_eligible_date<v_date then (v_date-mo.next_eligible_date)::text||' days overdue' end,
            mo.condition||' condition'],null)::text[] as reasons,
          z.sort_order as z_sort,go.sort_order as go_sort
        from atlas.maintenance_objects mo join atlas.growing_objects go on go.id=mo.object_id left join atlas.zones z on z.id=mo.zone_id
        where mo.farm_id=v_farm_id and mo.maintenance_type=p_maintenance_type and mo.active
          and mo.next_eligible_date<=v_date and mo.remaining_effort_minutes>0
          and not exists(select 1 from pg_temp.atlas_preview_reserved_objects r where r.maintenance_object_id=mo.id)
      )
      select * from ranked r
      order by case when r.owner_rank>0 then 0 else 1 end,
        floor(r.effective_score/25) desc,r.z_sort asc nulls last,r.z_key asc nulls last,
        r.effective_score desc,r.go_sort asc,r.go_label asc
    loop
      if v_rec.effort_minutes<=v_morning_left then
        v_morning_seq:=v_morning_seq+1; v_morning_left:=v_morning_left-v_rec.effort_minutes;
        insert into pg_temp.atlas_preview_reserved_objects values(v_rec.mo_id) on conflict do nothing;
        schedule_date:=v_date; window_key:='morning'; window_minutes:=v_morning;
        window_used_minutes:=v_morning-v_morning_left; window_remaining_minutes:=v_morning_left; sequence_in_window:=v_morning_seq;
      elsif v_rec.effort_minutes<=v_evening_left then
        v_evening_seq:=v_evening_seq+1; v_evening_left:=v_evening_left-v_rec.effort_minutes;
        insert into pg_temp.atlas_preview_reserved_objects values(v_rec.mo_id) on conflict do nothing;
        schedule_date:=v_date; window_key:='evening'; window_minutes:=case when v_has_significant then v_evening else v_light_evening end;
        window_used_minutes:=window_minutes-v_evening_left; window_remaining_minutes:=v_evening_left; sequence_in_window:=v_evening_seq;
      else continue; end if;
      maintenance_object_id:=v_rec.mo_id; object_id:=v_rec.go_id; object_key:=v_rec.go_key; object_label:=v_rec.go_label;
      zone_key:=v_rec.z_key; zone_label:=v_rec.z_label; condition:=v_rec.mo_condition; estimated_minutes:=v_rec.effort_minutes;
      priority_score:=v_rec.base_priority; effective_priority_score:=v_rec.effective_score; owner_priority:=v_rec.owner_rank;
      next_eligible_date:=v_rec.eligible_date; must_precede_task:=v_rec.precedes_task;
      dependent_task_ids:=v_rec.dep_ids; dependent_task_labels:=v_rec.dep_labels;
      guest_facing:=v_rec.is_guest_facing; crop_protective:=v_rec.is_crop_protective; revenue_linked:=v_rec.is_revenue_linked;
      significant_day_work:=v_has_significant; estimate_source:=v_rec.effort_source; priority_reasons:=v_rec.reasons;
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function atlas.preview_maintenance_schedule(text,date,integer,text) from public,anon,authenticated;
grant execute on function atlas.preview_maintenance_schedule(text,date,integer,text) to service_role;
