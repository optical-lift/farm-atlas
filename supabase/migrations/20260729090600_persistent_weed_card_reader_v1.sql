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

revoke all on function atlas.weed_card_task_focus_v1(uuid) from public;
grant execute on function atlas.weed_card_task_focus_v1(uuid) to authenticated, service_role;