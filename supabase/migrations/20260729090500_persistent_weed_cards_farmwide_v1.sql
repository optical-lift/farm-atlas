create or replace function atlas.weed_card_condition_from_text_v1(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case lower(btrim(coalesce(p_value, '')))
    when 'reset' then 'heavy'
    when 'heavy' then 'heavy'
    when 'high' then 'heavy'
    when 'moderate' then 'medium_pressure'
    when 'medium' then 'medium_pressure'
    when 'medium_pressure' then 'medium_pressure'
    when 'light' then 'row_readable'
    when 'low' then 'row_readable'
    when 'row_readable' then 'row_readable'
    when 'mostly_clear' then 'mostly_clear'
    when 'maintained' then 'clear'
    when 'clear' then 'clear'
    else null
  end;
$$;

create or replace function atlas.ensure_weed_card_for_object_v1(
  p_object_id uuid,
  p_task_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_object atlas.growing_objects%rowtype;
  v_task atlas.tasks%rowtype;
  v_has_task boolean := false;
  v_maintenance atlas.maintenance_objects%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_condition text;
  v_maintenance_condition text;
  v_reset_minutes integer;
  v_maintenance_minutes integer := 25;
  v_task_condition text;
  v_estimated_minutes integer;
begin
  if p_object_id is null then
    raise exception 'A growing object is required.' using errcode = '22023';
  end if;

  select go.* into v_object
  from atlas.growing_objects go
  where go.id = p_object_id;
  if v_object.id is null then
    raise exception 'Growing object not found.' using errcode = 'P0002';
  end if;

  if p_task_id is not null then
    select t.* into v_task from atlas.tasks t where t.id = p_task_id;
    v_has_task := found;
  end if;

  if v_has_task then
    v_task_condition := atlas.weed_card_condition_from_text_v1(v_task.metadata ->> 'condition');
    begin
      v_estimated_minutes := nullif(v_task.metadata ->> 'estimated_minutes', '')::integer;
    exception when others then
      v_estimated_minutes := null;
    end;
  end if;

  select mo.* into v_maintenance
  from atlas.maintenance_objects mo
  where mo.object_id = p_object_id
    and mo.maintenance_type = 'weed'
  order by mo.created_at
  limit 1;

  if v_maintenance.id is null then
    v_condition := coalesce(v_task_condition, 'medium_pressure');
    v_maintenance_condition := case v_condition
      when 'heavy' then 'heavy'
      when 'clear' then 'maintained'
      else 'moderate'
    end;
    v_reset_minutes := coalesce(
      v_estimated_minutes,
      case
        when v_object.stable_key ~* '^fr[_-]?[0-9]+$' then 120
        when v_object.object_type in ('path', 'walkway') then 60
        when v_object.object_type = 'bed' then 30
        else 60
      end
    );

    insert into atlas.maintenance_objects(
      farm_id, zone_id, object_id, maintenance_type, condition,
      reset_effort_minutes, maintenance_effort_minutes,
      current_effort_minutes, remaining_effort_minutes,
      normal_return_interval_days, next_eligible_date,
      guest_facing, crop_protective, revenue_linked,
      active, source, estimate_source, metadata
    ) values (
      v_object.farm_id, v_object.zone_id, v_object.id, 'weed', v_maintenance_condition,
      greatest(1, v_reset_minutes), v_maintenance_minutes,
      greatest(1, v_reset_minutes), greatest(1, v_reset_minutes),
      21, coalesce(v_task.due_date, current_date),
      coalesce(v_object.guest_visible, false), v_object.object_type = 'bed', false,
      not (v_has_task and v_task.status in ('open', 'blocked')),
      'persistent_weed_card_conversion_v1', 'persistent_weed_card_default',
      jsonb_build_object(
        'object_stable_key', v_object.stable_key,
        'weed_card_managed', true,
        'created_for_task_id', p_task_id,
        'conversion_source', 'persistent_weed_cards_farmwide_v1'
      )
    ) returning * into v_maintenance;
  end if;

  v_condition := coalesce(
    v_task_condition,
    atlas.weed_card_condition_from_text_v1(v_maintenance.condition),
    'medium_pressure'
  );

  insert into atlas.weed_cards(
    farm_id, object_id, maintenance_object_id, card_key,
    current_condition, target_condition, metadata
  ) values (
    v_object.farm_id, v_object.id, v_maintenance.id,
    'weed:' || v_object.stable_key,
    v_condition, 'clear',
    jsonb_build_object(
      'persistent', true,
      'plant_contents_source', 'object_contents',
      'conversion_source', 'persistent_weed_cards_farmwide_v1'
    )
  )
  on conflict (object_id) do update
  set maintenance_object_id = excluded.maintenance_object_id,
      metadata = atlas.weed_cards.metadata || excluded.metadata,
      updated_at = now()
  returning * into v_card;

  update atlas.maintenance_objects
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'weed_card_managed', true,
        'weed_card_id', v_card.id,
        'persistent_weed_card', true,
        'plant_contents_source', 'object_contents'
      ),
      updated_at = now()
  where id = v_maintenance.id;

  if v_has_task then
    update atlas.tasks
    set metadata = (
          coalesce(metadata, '{}'::jsonb)
          - 'display_detail'
          - 'display_instruction'
          - 'task_instruction'
          - 'current_move'
        ) || jsonb_build_object(
          'weed_card_id', v_card.id,
          'weed_card_managed', true,
          'weed_card_session_task', true,
          'persistent_weed_card', true,
          'plant_contents_source', 'object_contents',
          'hide_details', true
        ),
        updated_at = now()
    where id = v_task.id;

    if v_task.status in ('open', 'blocked') then
      select p.* into v_pass
      from atlas.weed_passes p
      where p.weed_card_id = v_card.id
        and p.status = 'active'
      limit 1;

      if v_pass.id is null then
        insert into atlas.weed_passes(
          weed_card_id, status, opened_at,
          starting_condition, current_condition, target_condition, metadata
        ) values (
          v_card.id, 'active', now(),
          v_condition, v_condition, v_card.target_condition,
          jsonb_build_object(
            'opened_from_task_id', v_task.id,
            'source', 'persistent_weed_card_conversion_v1'
          )
        ) returning * into v_pass;
      end if;

      update atlas.weed_cards
      set current_condition = v_pass.current_condition,
          next_review_on = null,
          updated_at = now()
      where id = v_card.id;

      update atlas.maintenance_objects
      set active = false,
          metadata = metadata || jsonb_build_object(
            'weed_card_condition', v_pass.current_condition,
            'active_weed_pass_id', v_pass.id,
            'active_weed_task_id', v_task.id
          ),
          updated_at = now()
      where id = v_maintenance.id;
    end if;
  end if;

  return v_card.id;
end;
$$;

create or replace function atlas.adopt_linked_weed_task_v1(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_object_id uuid;
  v_object_count integer;
begin
  select t.* into v_task from atlas.tasks t where t.id = p_task_id;
  if v_task.id is null then return null; end if;

  if not (
    lower(coalesce(v_task.action_key, '')) in ('weed', 'weeding')
    or lower(coalesce(v_task.task_type, '')) in ('weed', 'weeding')
    or lower(coalesce(v_task.metadata ->> 'work_route', '')) in ('weed', 'weeding')
    or v_task.title ~* '^weed\b'
  ) then
    return null;
  end if;

  select count(distinct tx.object_id), min(tx.object_id)
  into v_object_count, v_object_id
  from atlas.task_objects tx
  where tx.task_id = p_task_id;

  if v_object_count <> 1 then return null; end if;
  return atlas.ensure_weed_card_for_object_v1(v_object_id, p_task_id);
end;
$$;

create or replace function atlas.adopt_linked_weed_task_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.adopt_linked_weed_task_v1(new.task_id);
  return new;
end;
$$;

drop trigger if exists adopt_linked_weed_task_v1 on atlas.task_objects;
create trigger adopt_linked_weed_task_v1
after insert or update of object_id on atlas.task_objects
for each row execute function atlas.adopt_linked_weed_task_trigger_v1();

create or replace function atlas.adopt_updated_weed_task_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if lower(coalesce(new.metadata ->> 'weed_card_session_task', 'false')) in ('true', 'yes', '1') then
    return new;
  end if;
  perform atlas.adopt_linked_weed_task_v1(new.id);
  return new;
end;
$$;

drop trigger if exists adopt_updated_weed_task_v1 on atlas.tasks;
create trigger adopt_updated_weed_task_v1
after insert or update of title, action_key, task_type, status, metadata on atlas.tasks
for each row execute function atlas.adopt_updated_weed_task_trigger_v1();

create or replace function atlas.enrich_weed_card_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_object_id uuid;
  v_card_id uuid;
  v_pass_id uuid;
  v_metadata jsonb;
begin
  if new.source_kind <> 'maintenance_weeding_collection' or new.source_id is null then
    return new;
  end if;

  select mo.object_id into v_object_id
  from atlas.maintenance_objects mo
  where mo.id = new.source_id;
  if v_object_id is null then return new; end if;

  v_card_id := atlas.ensure_weed_card_for_object_v1(v_object_id, null);
  select p.id into v_pass_id
  from atlas.weed_passes p
  where p.weed_card_id = v_card_id and p.status = 'active'
  limit 1;

  v_metadata := (
      coalesce(new.task_payload -> 'metadata', '{}'::jsonb)
      - 'display_detail'
      - 'display_instruction'
      - 'task_instruction'
      - 'current_move'
    ) || jsonb_strip_nulls(jsonb_build_object(
      'weed_card_id', v_card_id,
      'weed_pass_id', v_pass_id,
      'weed_card_managed', true,
      'weed_card_session_task', true,
      'persistent_weed_card', true,
      'plant_contents_source', 'object_contents',
      'hide_details', true,
      'release_gate_installed', true
    ));

  new.task_payload := jsonb_set(coalesce(new.task_payload, '{}'::jsonb), '{metadata}', v_metadata, true);
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'weed_card_id', v_card_id,
    'weed_card_managed', true,
    'persistent_weed_card', true
  );
  return new;
end;
$$;

create or replace function atlas.weed_card_task_focus_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone_label text;
  v_role text;
  v_membership_id uuid;
  v_sessions jsonb;
  v_plants jsonb;
  v_condition text;
begin
  select t.* into v_task from atlas.tasks t where t.id = p_task_id;
  if v_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id = v_membership_id)
  then
    raise exception 'This Weed Card is not available to the signed-in farm member.' using errcode = '42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c
  join atlas.task_objects x on x.object_id = c.object_id
  where x.task_id = p_task_id
  limit 1;
  if v_card.id is null then return null; end if;

  select p.* into v_pass
  from atlas.weed_passes p
  where p.weed_card_id = v_card.id and p.status = 'active'
  limit 1;

  v_condition := coalesce(
    v_pass.current_condition,
    atlas.weed_card_condition_from_text_v1(v_task.metadata ->> 'condition'),
    v_card.current_condition
  );

  select go.* into v_object from atlas.growing_objects go where go.id = v_card.object_id;
  select z.label into v_zone_label from atlas.zones z where z.id = v_object.zone_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'workDate', s.work_date,
      'minutes', s.minutes,
      'minutesKnown', s.minutes_known,
      'conditionBefore', s.condition_before,
      'conditionAfter', s.condition_after,
      'note', s.note,
      'recordedAt', s.recorded_at
    ) order by s.recorded_at desc), '[]'::jsonb)
  into v_sessions
  from (
    select ws.* from atlas.weed_sessions ws
    where ws.weed_card_id = v_card.id
      and (v_pass.id is null or ws.weed_pass_id = v_pass.id)
    order by ws.recorded_at desc
    limit 12
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
      'contentId', plant.content_id,
      'contentLabel', plant.content_label,
      'displayLabel', plant.display_label,
      'variety', plant.variety,
      'contentType', plant.content_type,
      'status', plant.status,
      'displayOrder', plant.display_order
    ) order by plant.display_order, plant.display_label), '[]'::jsonb)
  into v_plants
  from (
    select distinct on (lower(raw.display_label)) raw.*
    from (
      select
        oc.id as content_id,
        oc.content_label,
        case
          when lower(oc.content_label) = 'sunflower'
            and nullif(btrim(coalesce(oc.variety, '')), '') is not null
            then btrim(oc.variety) || ' sunflower'
          when lower(oc.content_label) in ('bearded iris', 'iris') then 'Iris'
          else oc.content_label
        end as display_label,
        oc.variety,
        oc.content_type,
        oc.status,
        case
          when coalesce(oc.metadata ->> 'display_order', '') ~ '^\d+$'
            then (oc.metadata ->> 'display_order')::integer
          else 999
        end as display_order,
        oc.created_at
      from atlas.object_contents oc
      where oc.object_id = v_object.id
        and lower(coalesce(oc.status, '')) not in (
          'cleared', 'archived', 'removed', 'failed', 'dead', 'inactive', 'planned', 'reserved'
        )
    ) raw
    order by lower(raw.display_label), raw.display_order, raw.created_at
  ) plant;

  return jsonb_build_object(
    'taskId', v_task.id,
    'taskStatus', v_task.status,
    'taskDueDate', v_task.due_date,
    'cardId', v_card.id,
    'passId', v_pass.id,
    'passStatus', coalesce(v_pass.status, 'closed'),
    'objectId', v_object.id,
    'objectKey', v_object.stable_key,
    'objectLabel', v_object.label,
    'zoneLabel', coalesce(v_zone_label, 'Elm Farm'),
    'cropLabel', coalesce(v_plants -> 0 ->> 'displayLabel', 'Bed'),
    'plants', v_plants,
    'condition', v_condition,
    'targetCondition', coalesce(v_pass.target_condition, v_card.target_condition),
    'totalMinutes', coalesce(v_pass.total_minutes, 0),
    'sessionCount', case when v_pass.id is null then 0 else jsonb_array_length(v_sessions) end,
    'nextReviewOn', v_card.next_review_on,
    'sessions', case when v_pass.id is null then '[]'::jsonb else v_sessions end
  );
end;
$$;

revoke all on function atlas.weed_card_condition_from_text_v1(text) from public;
revoke all on function atlas.ensure_weed_card_for_object_v1(uuid, uuid) from public;
revoke all on function atlas.adopt_linked_weed_task_v1(uuid) from public;
revoke all on function atlas.weed_card_task_focus_v1(uuid) from public;
grant execute on function atlas.weed_card_task_focus_v1(uuid) to authenticated, service_role;
grant execute on function atlas.weed_card_condition_from_text_v1(text) to authenticated, service_role;

do $$
declare
  r record;
begin
  insert into atlas.weed_cards(
    farm_id, object_id, maintenance_object_id, card_key,
    current_condition, target_condition, metadata
  )
  select
    mo.farm_id,
    mo.object_id,
    mo.id,
    'weed:' || go.stable_key,
    coalesce(atlas.weed_card_condition_from_text_v1(mo.condition), 'medium_pressure'),
    'clear',
    jsonb_build_object(
      'persistent', true,
      'plant_contents_source', 'object_contents',
      'conversion_source', 'persistent_weed_cards_farmwide_v1'
    )
  from atlas.maintenance_objects mo
  join atlas.growing_objects go on go.id = mo.object_id
  where mo.maintenance_type = 'weed'
  on conflict (object_id) do update
  set maintenance_object_id = excluded.maintenance_object_id,
      metadata = atlas.weed_cards.metadata || excluded.metadata,
      updated_at = now();

  update atlas.maintenance_objects mo
  set metadata = coalesce(mo.metadata, '{}'::jsonb) || jsonb_build_object(
        'weed_card_managed', true,
        'weed_card_id', wc.id,
        'persistent_weed_card', true,
        'plant_contents_source', 'object_contents'
      ),
      updated_at = now()
  from atlas.weed_cards wc
  where wc.object_id = mo.object_id
    and mo.maintenance_type = 'weed';

  for r in
    select t.id as task_id, min(tx.object_id) as object_id
    from atlas.tasks t
    join atlas.task_objects tx on tx.task_id = t.id
    where t.status in ('open', 'blocked')
      and (
        lower(coalesce(t.action_key, '')) in ('weed', 'weeding')
        or lower(coalesce(t.task_type, '')) in ('weed', 'weeding')
        or lower(coalesce(t.metadata ->> 'work_route', '')) in ('weed', 'weeding')
        or t.title ~* '^weed\b'
      )
    group by t.id
    having count(distinct tx.object_id) = 1
  loop
    perform atlas.ensure_weed_card_for_object_v1(r.object_id, r.task_id);
  end loop;

  update atlas.planned_work_occurrences
  set task_payload = task_payload,
      updated_at = now()
  where source_kind = 'maintenance_weeding_collection'
    and state in ('planned', 'eligible', 'failed', 'releasing', 'released');
end;
$$;