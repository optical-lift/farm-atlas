-- Atlas Phase 2: read-only maintenance labor-window scheduler
-- Applied to noel-core / atlas schema on 2026-07-12.

create table if not exists atlas.maintenance_scheduler_settings (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  maintenance_type text not null,
  morning_minutes integer not null default 120,
  evening_minutes integer not null default 60,
  light_day_evening_minutes integer not null default 120,
  preview_days integer not null default 7,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, maintenance_type),
  check (morning_minutes > 0),
  check (evening_minutes > 0),
  check (light_day_evening_minutes >= evening_minutes),
  check (preview_days between 1 and 31)
);

alter table atlas.maintenance_scheduler_settings enable row level security;

insert into atlas.maintenance_scheduler_settings (
  farm_id, maintenance_type, morning_minutes, evening_minutes,
  light_day_evening_minutes, preview_days, metadata
)
select id, 'weed', 120, 60, 120, 7,
       jsonb_build_object('phase', 2, 'mode', 'read_only_preview')
from atlas.farms
where stable_key = 'elm_farm'
on conflict (farm_id, maintenance_type) do update set
  morning_minutes = excluded.morning_minutes,
  evening_minutes = excluded.evening_minutes,
  light_day_evening_minutes = excluded.light_day_evening_minutes,
  preview_days = excluded.preview_days,
  metadata = atlas.maintenance_scheduler_settings.metadata || excluded.metadata,
  updated_at = now();

create or replace function atlas.preview_maintenance_schedule(
  p_farm_key text default 'elm_farm',
  p_start_date date default current_date,
  p_days integer default 7,
  p_maintenance_type text default 'weed'
)
returns table (
  schedule_date date,
  window_key text,
  window_minutes integer,
  window_used_minutes integer,
  window_remaining_minutes integer,
  sequence_in_window integer,
  maintenance_object_id uuid,
  object_id uuid,
  object_key text,
  object_label text,
  zone_key text,
  zone_label text,
  condition text,
  estimated_minutes integer,
  priority_score numeric,
  next_eligible_date date,
  must_precede_task boolean,
  guest_facing boolean,
  crop_protective boolean,
  revenue_linked boolean,
  significant_day_work boolean,
  priority_reasons text[]
)
language plpgsql
security invoker
set search_path = atlas, public
as $$
declare
  v_farm_id uuid;
  v_morning integer;
  v_evening integer;
  v_light_evening integer;
  v_date date;
  v_day integer;
  v_has_significant boolean;
  v_morning_left integer;
  v_evening_left integer;
  v_morning_seq integer;
  v_evening_seq integer;
  v_rec record;
begin
  if p_days < 1 or p_days > 31 then
    raise exception 'p_days must be between 1 and 31';
  end if;

  select f.id into v_farm_id
  from atlas.farms f
  where f.stable_key = p_farm_key;

  if v_farm_id is null then
    raise exception 'Unknown farm key: %', p_farm_key;
  end if;

  select s.morning_minutes, s.evening_minutes, s.light_day_evening_minutes
    into v_morning, v_evening, v_light_evening
  from atlas.maintenance_scheduler_settings s
  where s.farm_id = v_farm_id
    and s.maintenance_type = p_maintenance_type
    and s.active = true;

  v_morning := coalesce(v_morning, 120);
  v_evening := coalesce(v_evening, 60);
  v_light_evening := coalesce(v_light_evening, 120);

  create temporary table if not exists pg_temp.atlas_preview_reserved_objects (
    maintenance_object_id uuid primary key
  ) on commit drop;
  truncate pg_temp.atlas_preview_reserved_objects;

  for v_day in 0..p_days - 1 loop
    v_date := p_start_date + v_day;

    select exists (
      select 1
      from atlas.tasks t
      where t.farm_id = v_farm_id
        and t.status in ('open','blocked')
        and t.due_date = v_date
        and (
          lower(coalesce(t.task_type, '')) ~ '(plant|sow|transplant|mow|harvest|irrigat|water|venue|event|setup|set_up|tear_down)'
          or lower(coalesce(t.metadata->>'work_route', '')) ~ '(plant|sow|mow|harvest|water|venue)'
          or lower(coalesce(t.metadata->>'collection_zone', '')) = 'venue'
        )
    ) into v_has_significant;

    v_morning_left := v_morning;
    v_evening_left := case when v_has_significant then v_evening else v_light_evening end;
    v_morning_seq := 0;
    v_evening_seq := 0;

    for v_rec in
      select
        mo.id as maintenance_object_id,
        mo.object_id,
        go.stable_key as object_key,
        go.label as object_label,
        z.stable_key as zone_key,
        z.label as zone_label,
        mo.condition,
        greatest(0, mo.remaining_effort_minutes) as estimated_minutes,
        mo.priority_score,
        mo.next_eligible_date,
        mo.must_precede_task,
        mo.guest_facing,
        mo.crop_protective,
        mo.revenue_linked,
        array_remove(array[
          case when mo.must_precede_task then 'blocks another task' end,
          case when mo.revenue_linked then 'revenue linked' end,
          case when mo.crop_protective then 'crop protective' end,
          case when mo.guest_facing then 'guest facing' end,
          case when mo.condition in ('heavy','reset') then mo.condition || ' condition' end,
          case when mo.next_eligible_date < v_date then (v_date - mo.next_eligible_date)::text || ' days overdue' end,
          case when mo.owner_priority > 0 then 'owner priority' end
        ], null)::text[] as priority_reasons
      from atlas.maintenance_objects mo
      join atlas.growing_objects go on go.id = mo.object_id
      left join atlas.zones z on z.id = mo.zone_id
      where mo.farm_id = v_farm_id
        and mo.maintenance_type = p_maintenance_type
        and mo.active = true
        and mo.next_eligible_date <= v_date
        and mo.remaining_effort_minutes > 0
        and not exists (
          select 1
          from pg_temp.atlas_preview_reserved_objects r
          where r.maintenance_object_id = mo.id
        )
      order by
        floor((mo.priority_score + mo.owner_priority * 100) / 10) desc,
        z.sort_order asc nulls last,
        z.stable_key asc nulls last,
        mo.priority_score + mo.owner_priority * 100 desc,
        go.sort_order asc,
        go.label asc
    loop
      if v_rec.estimated_minutes <= v_morning_left then
        v_morning_seq := v_morning_seq + 1;
        v_morning_left := v_morning_left - v_rec.estimated_minutes;
        insert into pg_temp.atlas_preview_reserved_objects values (v_rec.maintenance_object_id) on conflict do nothing;

        schedule_date := v_date;
        window_key := 'morning';
        window_minutes := v_morning;
        window_used_minutes := v_morning - v_morning_left;
        window_remaining_minutes := v_morning_left;
        sequence_in_window := v_morning_seq;
        maintenance_object_id := v_rec.maintenance_object_id;
        object_id := v_rec.object_id;
        object_key := v_rec.object_key;
        object_label := v_rec.object_label;
        zone_key := v_rec.zone_key;
        zone_label := v_rec.zone_label;
        condition := v_rec.condition;
        estimated_minutes := v_rec.estimated_minutes;
        priority_score := v_rec.priority_score;
        next_eligible_date := v_rec.next_eligible_date;
        must_precede_task := v_rec.must_precede_task;
        guest_facing := v_rec.guest_facing;
        crop_protective := v_rec.crop_protective;
        revenue_linked := v_rec.revenue_linked;
        significant_day_work := v_has_significant;
        priority_reasons := v_rec.priority_reasons;
        return next;
      elsif v_rec.estimated_minutes <= v_evening_left then
        v_evening_seq := v_evening_seq + 1;
        v_evening_left := v_evening_left - v_rec.estimated_minutes;
        insert into pg_temp.atlas_preview_reserved_objects values (v_rec.maintenance_object_id) on conflict do nothing;

        schedule_date := v_date;
        window_key := 'evening';
        window_minutes := case when v_has_significant then v_evening else v_light_evening end;
        window_used_minutes := window_minutes - v_evening_left;
        window_remaining_minutes := v_evening_left;
        sequence_in_window := v_evening_seq;
        maintenance_object_id := v_rec.maintenance_object_id;
        object_id := v_rec.object_id;
        object_key := v_rec.object_key;
        object_label := v_rec.object_label;
        zone_key := v_rec.zone_key;
        zone_label := v_rec.zone_label;
        condition := v_rec.condition;
        estimated_minutes := v_rec.estimated_minutes;
        priority_score := v_rec.priority_score;
        next_eligible_date := v_rec.next_eligible_date;
        must_precede_task := v_rec.must_precede_task;
        guest_facing := v_rec.guest_facing;
        crop_protective := v_rec.crop_protective;
        revenue_linked := v_rec.revenue_linked;
        significant_day_work := v_has_significant;
        priority_reasons := v_rec.priority_reasons;
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function atlas.preview_maintenance_schedule(text,date,integer,text) from public, anon, authenticated;
grant execute on function atlas.preview_maintenance_schedule(text,date,integer,text) to service_role;

comment on function atlas.preview_maintenance_schedule(text,date,integer,text) is
  'Read-only Phase 2 scheduler preview. Packs eligible canonical maintenance objects into morning and evening labor windows without creating tasks or changing maintenance state.';
