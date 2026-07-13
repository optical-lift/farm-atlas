-- Atlas: protect one quick hoe/rake bed in every daily weeding rotation.
-- Applied to noel-core / atlas schema on 2026-07-13.

update atlas.maintenance_scheduler_settings s
set metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
      'daily_quick_pass_enabled', true,
      'daily_quick_pass_minutes', 20,
      'daily_quick_pass_conditions', jsonb_build_array('maintained', 'moderate'),
      'daily_quick_pass_object_type', 'bed',
      'daily_quick_pass_tools', jsonb_build_array('hoe', 'rake'),
      'daily_quick_pass_mode', 'bonus_timebox',
      'daily_quick_pass_seedling_safety_days', 21
    ),
    updated_at = now()
where s.farm_id = (
    select f.id from atlas.farms f where f.stable_key = 'elm_farm'
  )
  and s.maintenance_type = 'weed';

CREATE OR REPLACE FUNCTION atlas.preview_maintenance_schedule(p_farm_key text DEFAULT 'elm_farm'::text, p_start_date date DEFAULT CURRENT_DATE, p_days integer DEFAULT 7, p_maintenance_type text DEFAULT 'weed'::text)
 RETURNS TABLE(schedule_date date, window_key text, window_minutes integer, window_used_minutes integer, window_remaining_minutes integer, sequence_in_window integer, maintenance_object_id uuid, object_id uuid, object_key text, object_label text, zone_key text, zone_label text, condition text, estimated_minutes integer, priority_score numeric, effective_priority_score numeric, owner_priority integer, next_eligible_date date, must_precede_task boolean, dependent_task_ids uuid[], dependent_task_labels text[], guest_facing boolean, crop_protective boolean, revenue_linked boolean, significant_day_work boolean, estimate_source text, priority_reasons text[])
 LANGUAGE plpgsql
 SET search_path TO 'atlas', 'public'
AS $function$
declare
  v_farm_id uuid;
  v_morning integer;
  v_evening integer;
  v_light_evening integer;
  v_settings_metadata jsonb;
  v_quick_enabled boolean := false;
  v_quick_minutes integer := 20;
  v_quick_effort integer;
  v_date date;
  v_day integer;
  v_has_significant boolean;
  v_booking_soon boolean;
  v_morning_left integer;
  v_evening_left integer;
  v_evening_capacity integer;
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

  select
    s.morning_minutes,
    s.evening_minutes,
    s.light_day_evening_minutes,
    s.metadata
  into
    v_morning,
    v_evening,
    v_light_evening,
    v_settings_metadata
  from atlas.maintenance_scheduler_settings s
  where s.farm_id = v_farm_id
    and s.maintenance_type = p_maintenance_type
    and s.active;

  v_morning := coalesce(v_morning, 120);
  v_evening := coalesce(v_evening, 60);
  v_light_evening := coalesce(v_light_evening, 120);
  v_settings_metadata := coalesce(v_settings_metadata, '{}'::jsonb);

  v_quick_enabled :=
    p_maintenance_type = 'weed'
    and lower(coalesce(v_settings_metadata->>'daily_quick_pass_enabled', 'false')) = 'true';

  v_quick_minutes := case
    when coalesce(v_settings_metadata->>'daily_quick_pass_minutes', '') ~ '^[0-9]+$'
      then greatest(5, least(60, (v_settings_metadata->>'daily_quick_pass_minutes')::integer))
    else 20
  end;

  create temporary table if not exists pg_temp.atlas_preview_reserved_objects (
    maintenance_object_id uuid primary key
  ) on commit drop;
  truncate pg_temp.atlas_preview_reserved_objects;

  for v_day in 0..p_days - 1 loop
    v_date := p_start_date + v_day;

    select exists(
      select 1
      from atlas.tasks t
      where t.farm_id = v_farm_id
        and t.status in ('open', 'blocked')
        and t.due_date = v_date
        and (
          lower(coalesce(t.task_type, '')) ~ '(plant|sow|transplant|mow|harvest|irrigat|water|venue|event|setup|set_up|tear_down)'
          or lower(coalesce(t.metadata->>'work_route', '')) ~ '(plant|sow|mow|harvest|water|venue)'
          or lower(coalesce(t.metadata->>'collection_zone', '')) = 'venue'
        )
    ) into v_has_significant;

    select exists(
      select 1
      from atlas.tasks t
      where t.farm_id = v_farm_id
        and t.status in ('open', 'blocked')
        and t.due_date between v_date and v_date + 7
        and (
          lower(coalesce(t.task_type, '')) ~ '(venue|event|setup|set_up|tear_down)'
          or lower(coalesce(t.metadata->>'collection_zone', '')) = 'venue'
        )
    ) into v_booking_soon;

    v_morning_left := v_morning;
    v_evening_capacity := case when v_has_significant then v_evening else v_light_evening end;
    v_evening_left := v_evening_capacity;
    v_morning_seq := 0;
    v_evening_seq := 0;

    if v_quick_enabled then
      select
        mo.id as mo_id,
        mo.object_id as go_id,
        go.stable_key as go_key,
        go.label as go_label,
        z.stable_key as z_key,
        z.label as z_label,
        mo.condition as mo_condition,
        greatest(1, mo.remaining_effort_minutes) as effort_minutes,
        mo.priority_score as base_priority,
        mo.owner_priority as owner_rank,
        mo.next_eligible_date as eligible_date,
        mo.must_precede_task as precedes_task,
        mo.guest_facing as is_guest_facing,
        mo.crop_protective as is_crop_protective,
        mo.revenue_linked as is_revenue_linked,
        mo.estimate_source as effort_source,
        coalesce((
          select array_agg(md.dependent_task_id order by t.title)
          from atlas.maintenance_dependencies md
          join atlas.tasks t on t.id = md.dependent_task_id
          where md.maintenance_object_id = mo.id
            and md.active
            and md.satisfied_at is null
        ), '{}'::uuid[]) as dep_ids,
        coalesce((
          select array_agg(t.title order by t.title)
          from atlas.maintenance_dependencies md
          join atlas.tasks t on t.id = md.dependent_task_id
          where md.maintenance_object_id = mo.id
            and md.active
            and md.satisfied_at is null
        ), '{}'::text[]) as dep_labels,
        (
          mo.priority_score
          + mo.crop_loss_risk
          + mo.revenue_unlock_score
          + mo.planting_block_score
          + mo.guest_visibility_score
          + mo.weed_spread_risk
          + case when v_booking_soon and mo.guest_facing then 60 else mo.upcoming_booking_score end
          + least(90, greatest(0, (v_date - mo.next_eligible_date)) * 3)
          + case mo.condition when 'moderate' then 35 else 10 end
        )::numeric as effective_score,
        array_remove(array[
          'daily quick hoe/rake pass',
          case when mo.condition = 'moderate' then 'moderate bed maintenance' else 'easy bed maintenance' end,
          'established crop rows',
          case when mo.guest_facing then 'guest visible' end,
          case when mo.next_eligible_date < v_date then (v_date - mo.next_eligible_date)::text || ' days overdue' end
        ], null)::text[] as reasons
      into v_rec
      from atlas.maintenance_objects mo
      join atlas.growing_objects go on go.id = mo.object_id
      left join atlas.zones z on z.id = mo.zone_id
      left join atlas.object_state os on os.object_id = mo.object_id
      where mo.farm_id = v_farm_id
        and mo.maintenance_type = 'weed'
        and mo.active
        and mo.condition in ('maintained', 'moderate')
        and go.object_type = 'bed'
        and mo.next_eligible_date <= v_date
        and mo.remaining_effort_minutes > 0
        and coalesce(os.life_status, 'active') not in (
          'germinating',
          'planted',
          'planted_no_emergence',
          'emerging'
        )
        and not exists(
          select 1
          from atlas.object_contents oc
          where oc.object_id = mo.object_id
            and oc.planted_date >= v_date - 21
            and lower(coalesce(oc.status, '')) in (
              'planted',
              'germinating',
              'no_emergence_observed',
              'emerging',
              'sparse_germination',
              'partial_stand'
            )
        )
        and not exists(
          select 1
          from pg_temp.atlas_preview_reserved_objects reserved
          where reserved.maintenance_object_id = mo.id
        )
      order by
        case mo.condition when 'maintained' then 0 else 1 end,
        mo.last_completed_at asc nulls first,
        mo.next_eligible_date asc,
        mo.priority_score desc,
        z.sort_order asc nulls last,
        go.sort_order asc nulls last,
        go.label asc
      limit 1;

      if found then
        v_quick_effort := least(v_quick_minutes, v_rec.effort_minutes);
        v_evening_capacity := v_evening_capacity + v_quick_effort;
        v_evening_left := v_evening_left + v_quick_effort;
        v_evening_seq := v_evening_seq + 1;
        v_evening_left := v_evening_left - v_quick_effort;

        insert into pg_temp.atlas_preview_reserved_objects values(v_rec.mo_id)
        on conflict do nothing;

        schedule_date := v_date;
        window_key := 'evening';
        window_minutes := v_evening_capacity;
        window_used_minutes := v_evening_capacity - v_evening_left;
        window_remaining_minutes := v_evening_left;
        sequence_in_window := v_evening_seq;
        maintenance_object_id := v_rec.mo_id;
        object_id := v_rec.go_id;
        object_key := v_rec.go_key;
        object_label := v_rec.go_label;
        zone_key := v_rec.z_key;
        zone_label := v_rec.z_label;
        condition := v_rec.mo_condition;
        estimated_minutes := v_quick_effort;
        priority_score := v_rec.base_priority;
        effective_priority_score := v_rec.effective_score;
        owner_priority := v_rec.owner_rank;
        next_eligible_date := v_rec.eligible_date;
        must_precede_task := v_rec.precedes_task;
        dependent_task_ids := v_rec.dep_ids;
        dependent_task_labels := v_rec.dep_labels;
        guest_facing := v_rec.is_guest_facing;
        crop_protective := v_rec.is_crop_protective;
        revenue_linked := v_rec.is_revenue_linked;
        significant_day_work := v_has_significant;
        estimate_source := 'daily_quick_timebox';
        priority_reasons := v_rec.reasons;
        return next;
      end if;
    end if;

    for v_rec in
      with ranked as (
        select
          mo.id as mo_id,
          mo.object_id as go_id,
          go.stable_key as go_key,
          go.label as go_label,
          z.stable_key as z_key,
          z.label as z_label,
          mo.condition as mo_condition,
          greatest(0, mo.remaining_effort_minutes) as effort_minutes,
          mo.priority_score as base_priority,
          mo.owner_priority as owner_rank,
          mo.next_eligible_date as eligible_date,
          mo.must_precede_task as precedes_task,
          mo.guest_facing as is_guest_facing,
          mo.crop_protective as is_crop_protective,
          mo.revenue_linked as is_revenue_linked,
          mo.estimate_source as effort_source,
          coalesce((
            select array_agg(md.dependent_task_id order by t.title)
            from atlas.maintenance_dependencies md
            join atlas.tasks t on t.id = md.dependent_task_id
            where md.maintenance_object_id = mo.id
              and md.active
              and md.satisfied_at is null
          ), '{}'::uuid[]) as dep_ids,
          coalesce((
            select array_agg(t.title order by t.title)
            from atlas.maintenance_dependencies md
            join atlas.tasks t on t.id = md.dependent_task_id
            where md.maintenance_object_id = mo.id
              and md.active
              and md.satisfied_at is null
          ), '{}'::text[]) as dep_labels,
          (
            mo.priority_score
            + mo.crop_loss_risk
            + mo.revenue_unlock_score
            + mo.planting_block_score
            + mo.guest_visibility_score
            + mo.weed_spread_risk
            + case when v_booking_soon and mo.guest_facing then 60 else mo.upcoming_booking_score end
            + least(90, greatest(0, (v_date - mo.next_eligible_date)) * 3)
            + case mo.condition
                when 'reset' then 100
                when 'heavy' then 80
                when 'moderate' then 35
                else 10
              end
            + case when mo.owner_priority > 0 then 10000 + mo.owner_priority * 100 else 0 end
          )::numeric as effective_score,
          array_remove(array[
            case when mo.owner_priority > 0 then 'owner override' end,
            case when mo.must_precede_task then
              'unlocks ' || coalesce((
                select string_agg(t.title, ', ' order by t.title)
                from atlas.maintenance_dependencies md
                join atlas.tasks t on t.id = md.dependent_task_id
                where md.maintenance_object_id = mo.id
                  and md.active
                  and md.satisfied_at is null
              ), 'dependent work')
            end,
            case when mo.crop_loss_risk >= 60 then 'crop loss risk' end,
            case when mo.revenue_unlock_score >= 60 then 'revenue unlocked' end,
            case when v_booking_soon and mo.guest_facing then 'upcoming venue booking' end,
            case when mo.guest_facing then 'guest visible' end,
            case when mo.weed_spread_risk >= 60 then 'weed spread risk' end,
            case when mo.next_eligible_date < v_date then (v_date - mo.next_eligible_date)::text || ' days overdue' end,
            mo.condition || ' condition'
          ], null)::text[] as reasons,
          z.sort_order as z_sort,
          go.sort_order as go_sort
        from atlas.maintenance_objects mo
        join atlas.growing_objects go on go.id = mo.object_id
        left join atlas.zones z on z.id = mo.zone_id
        where mo.farm_id = v_farm_id
          and mo.maintenance_type = p_maintenance_type
          and mo.active
          and mo.next_eligible_date <= v_date
          and mo.remaining_effort_minutes > 0
          and not exists(
            select 1
            from pg_temp.atlas_preview_reserved_objects reserved
            where reserved.maintenance_object_id = mo.id
          )
      )
      select *
      from ranked r
      order by
        case when r.owner_rank > 0 then 0 else 1 end,
        floor(r.effective_score / 25) desc,
        r.z_sort asc nulls last,
        r.z_key asc nulls last,
        r.effective_score desc,
        r.go_sort asc,
        r.go_label asc
    loop
      if v_rec.effort_minutes <= v_morning_left then
        v_morning_seq := v_morning_seq + 1;
        v_morning_left := v_morning_left - v_rec.effort_minutes;

        insert into pg_temp.atlas_preview_reserved_objects values(v_rec.mo_id)
        on conflict do nothing;

        schedule_date := v_date;
        window_key := 'morning';
        window_minutes := v_morning;
        window_used_minutes := v_morning - v_morning_left;
        window_remaining_minutes := v_morning_left;
        sequence_in_window := v_morning_seq;
      elsif v_rec.effort_minutes <= v_evening_left then
        v_evening_seq := v_evening_seq + 1;
        v_evening_left := v_evening_left - v_rec.effort_minutes;

        insert into pg_temp.atlas_preview_reserved_objects values(v_rec.mo_id)
        on conflict do nothing;

        schedule_date := v_date;
        window_key := 'evening';
        window_minutes := v_evening_capacity;
        window_used_minutes := v_evening_capacity - v_evening_left;
        window_remaining_minutes := v_evening_left;
        sequence_in_window := v_evening_seq;
      else
        continue;
      end if;

      maintenance_object_id := v_rec.mo_id;
      object_id := v_rec.go_id;
      object_key := v_rec.go_key;
      object_label := v_rec.go_label;
      zone_key := v_rec.z_key;
      zone_label := v_rec.z_label;
      condition := v_rec.mo_condition;
      estimated_minutes := v_rec.effort_minutes;
      priority_score := v_rec.base_priority;
      effective_priority_score := v_rec.effective_score;
      owner_priority := v_rec.owner_rank;
      next_eligible_date := v_rec.eligible_date;
      must_precede_task := v_rec.precedes_task;
      dependent_task_ids := v_rec.dep_ids;
      dependent_task_labels := v_rec.dep_labels;
      guest_facing := v_rec.is_guest_facing;
      crop_protective := v_rec.is_crop_protective;
      revenue_linked := v_rec.is_revenue_linked;
      significant_day_work := v_has_significant;
      estimate_source := v_rec.effort_source;
      priority_reasons := v_rec.reasons;
      return next;
    end loop;
  end loop;
end;
$function$
;

revoke all on function atlas.preview_maintenance_schedule(text, date, integer, text)
  from public, anon, authenticated;
grant execute on function atlas.preview_maintenance_schedule(text, date, integer, text)
  to service_role;

comment on function atlas.preview_maintenance_schedule(text, date, integer, text) is
  'Packs canonical maintenance into daily labor windows and reserves one extra safe 20-minute hoe/rake bed during weeding rotations. Newly planted, germinating, sparse, emerging, and recent partial stands are excluded from the quick pass.';

CREATE OR REPLACE FUNCTION atlas.refresh_weeding_collection_tasks(p_start_date date DEFAULT CURRENT_DATE, p_days integer DEFAULT 14)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'atlas', 'public'
AS $function$
declare
  v_farm_id uuid;
  v_count integer := 0;
  v_is_quick boolean;
  r record;
  v_task_id uuid;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key = 'elm_farm';

  if v_farm_id is null then
    raise exception 'Elm Farm not found';
  end if;

  update atlas.tasks
  set status = 'archived',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_reason', 'Replaced by Weeding collection refresh',
        'archived_at', now()
      )
  where status in ('open', 'blocked')
    and (
      generated_from = 'maintenance_weeding_collection'
      or coalesce(metadata->>'maintenance_plan_card', 'false') = 'true'
    );

  for r in
    select *
    from atlas.preview_maintenance_schedule('elm_farm', p_start_date, p_days, 'weed')
  loop
    v_is_quick := 'daily quick hoe/rake pass' = any(coalesce(r.priority_reasons, '{}'::text[]));

    insert into atlas.tasks(
      farm_id,
      zone_id,
      title,
      task_type,
      status,
      priority,
      due_date,
      unlock_text,
      generated_from,
      generated_from_id,
      note,
      metadata
    ) values (
      v_farm_id,
      (select zone_id from atlas.maintenance_objects where id = r.maintenance_object_id),
      case when v_is_quick
        then 'Quick hoe/rake ' || r.object_label
        else 'Weed ' || r.object_label
      end,
      'maintenance',
      'open',
      case when r.owner_priority > 0 or r.must_precede_task then 'high' else 'normal' end,
      r.schedule_date,
      case
        when cardinality(r.dependent_task_labels) > 0
          then 'Unlocks ' || array_to_string(r.dependent_task_labels, ' · ')
        when v_is_quick
          then 'Keeps an easy bed from becoming a heavy reset.'
        else 'Returns after the weeding cooldown.'
      end,
      'maintenance_weeding_collection',
      r.maintenance_object_id,
      case when v_is_quick then
        'Timebox at 20 minutes. Hoe or rake only between clearly established crop rows; hand-pull close to stems. If the bed is not clean at the bell, use Partly done.'
      end,
      jsonb_build_object(
        'work_collection_key', 'weeding',
        'collection_member_key', r.maintenance_object_id::text,
        'maintenance_object_id', r.maintenance_object_id,
        'maintenance_type', 'weed',
        'work_route', 'weed',
        'work_rhythm', 'Weeding',
        'display_action', case when v_is_quick then 'Quick hoe/rake' else 'Weed' end,
        'display_subject', r.object_label,
        'display_title', case when v_is_quick
          then 'Quick hoe/rake ' || r.object_label
          else 'Weed ' || r.object_label
        end,
        'display_detail', case when v_is_quick
          then r.estimated_minutes::text || ' min · quick hoe/rake'
          else r.estimated_minutes::text || ' min · ' || r.condition
        end,
        'collection_zone', coalesce(r.zone_label, 'Elm Farm'),
        'collection_label', r.object_label,
        'estimated_minutes', r.estimated_minutes,
        'condition', r.condition,
        'window_key', r.window_key,
        'day_order', case when r.window_key = 'morning' then 1200 else 8200 end + r.sequence_in_window,
        'day_work_order', case when r.window_key = 'morning' then 1200 else 8200 end + r.sequence_in_window,
        'run_sheet_order', case when r.window_key = 'morning' then 1200 else 8200 end + r.sequence_in_window,
        'priority_reasons', to_jsonb(r.priority_reasons),
        'dependent_task_labels', to_jsonb(r.dependent_task_labels),
        'quick_maintenance_pass', v_is_quick,
        'timeboxed_minutes', case when v_is_quick then r.estimated_minutes else null end,
        'tool_hint', case when v_is_quick then 'hoe or rake' else null end,
        'seedling_safety_rule', case when v_is_quick then 'established crop rows only' else null end,
        'canonical_maintenance_delivery', true
      )
    )
    returning id into v_task_id;

    insert into atlas.task_objects(task_id, object_id, role)
    values(v_task_id, r.object_id, 'target')
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;

revoke all on function atlas.refresh_weeding_collection_tasks(date, integer)
  from public, anon, authenticated;
grant execute on function atlas.refresh_weeding_collection_tasks(date, integer)
  to service_role;
