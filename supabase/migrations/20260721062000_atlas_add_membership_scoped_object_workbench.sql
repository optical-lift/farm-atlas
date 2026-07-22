create or replace function atlas.object_workbench_v1(
  p_farm_id uuid,
  p_object_key text,
  p_history_days integer default 14,
  p_future_days integer default 365
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_role text;
  v_farm_key text;
  v_object atlas.v_object_workbench%rowtype;
  v_result jsonb;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select f.stable_key into v_farm_key from atlas.farms f where f.id = p_farm_id;
  if v_farm_key is null then raise exception 'Farm was not found.' using errcode = 'P0002'; end if;

  select workbench.* into v_object
  from atlas.v_object_workbench workbench
  where workbench.farm_id = p_farm_id
    and workbench.object_key = nullif(btrim(p_object_key), '');
  if v_object.object_id is null then raise exception 'Farm object was not found.' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'object', to_jsonb(v_object),
    'cropCycles', coalesce((select jsonb_agg(jsonb_build_object(
      'id', cc.id, 'crop_cycle_key', cc.crop_cycle_key, 'crop_label', cc.crop_label,
      'variety', cc.variety, 'cycle_state', cc.cycle_state, 'lifecycle_status', cc.lifecycle_status,
      'sown_date', cc.sown_date, 'planted_date', cc.planted_date,
      'germination_checked_date', cc.germination_checked_date,
      'harvest_started_date', cc.harvest_started_date, 'last_harvest_date', cc.last_harvest_date,
      'expected_germination_start', cc.expected_germination_start,
      'expected_germination_end', cc.expected_germination_end,
      'expected_harvest_watch_start', cc.expected_harvest_watch_start,
      'expected_harvest_watch_end', cc.expected_harvest_watch_end,
      'expected_clear_date', cc.expected_clear_date, 'note', cc.note
    ) order by cc.created_at) from atlas.crop_cycles cc
      where cc.farm_id = p_farm_id and cc.object_id = v_object.object_id and cc.lifecycle_status = 'active'), '[]'::jsonb),
    'plantInstances', coalesce((select jsonb_agg(jsonb_build_object(
      'id', pi.id, 'lineage_id', pi.lineage_id, 'stable_key', pi.stable_key, 'label', pi.label,
      'quantity', pi.quantity, 'unit', pi.unit, 'generation', pi.generation, 'status', pi.status,
      'acquired_date', pi.acquired_date, 'planted_date', pi.planted_date, 'note', pi.note,
      'lineage', case when pl.id is null then null else jsonb_build_object(
        'id', pl.id, 'stable_key', pl.stable_key, 'lineage_name', pl.lineage_name,
        'common_name', pl.common_name, 'botanical_name', pl.botanical_name,
        'source_name', pl.source_name, 'source_type', pl.source_type, 'origin_year', pl.origin_year,
        'origin_detail', pl.origin_detail, 'propagation_goal', pl.propagation_goal
      ) end
    ) order by pi.created_at) from atlas.plant_instances pi
      left join atlas.plant_lineages pl on pl.id = pi.lineage_id
      where pi.farm_id = p_farm_id and pi.object_id = v_object.object_id
        and pi.status not in ('dead', 'removed', 'archived')), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'event_id', timeline.event_id, 'object_id', timeline.object_id,
      'object_key', timeline.object_key, 'object_label', timeline.object_label,
      'field_log_id', timeline.field_log_id, 'crop_cycle_id', timeline.crop_cycle_id,
      'plant_instance_id', timeline.plant_instance_id, 'entity_label', timeline.entity_label,
      'entity_kind', timeline.entity_kind, 'event_type', timeline.event_type,
      'event_date', timeline.event_date, 'note', timeline.note, 'quantity', timeline.quantity,
      'unit', timeline.unit, 'source', timeline.source, 'created_at', timeline.created_at
    ) order by timeline.event_date desc, timeline.created_at desc)
      from (select * from atlas.v_object_event_timeline event_row
        where event_row.farm_id = p_farm_id and event_row.object_id = v_object.object_id
        order by event_row.event_date desc, event_row.created_at desc limit 40) timeline), '[]'::jsonb),
    'operationalTimeline', atlas.get_object_operational_timeline_v1(
      v_farm_key, v_object.object_key, greatest(coalesce(p_history_days, 14), 0), greatest(coalesce(p_future_days, 365), 0)
    )
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function atlas.record_object_event_for_member_v1(
  p_farm_id uuid, p_object_key text, p_event_type text, p_event_date date default current_date,
  p_note text default null, p_quantity numeric default null, p_unit text default null,
  p_crop_cycle_id uuid default null, p_plant_instance_id uuid default null,
  p_state jsonb default '{}'::jsonb, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, atlas
as $function$
declare v_role text; v_membership_id uuid; v_farm_key text; v_state jsonb;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then raise exception 'Active farm membership required.' using errcode = '42501'; end if;
  select f.stable_key into v_farm_key from atlas.farms f where f.id = p_farm_id;
  if v_farm_key is null then raise exception 'Farm was not found.' using errcode = 'P0002'; end if;
  v_state := coalesce(p_state, '{}'::jsonb) || jsonb_build_object('actor_user_id', auth.uid(), 'actor_membership_id', v_membership_id, 'actor_role', v_role);
  return atlas.record_object_event_v1(v_farm_key, p_object_key, p_event_type, p_event_date, p_note, p_quantity, p_unit, p_crop_cycle_id, p_plant_instance_id, v_state, p_idempotency_key);
end;
$function$;

create or replace function atlas.record_crop_observation_for_member_v1(
  p_farm_id uuid, p_object_key text, p_crop_cycle_id uuid, p_observation_key text,
  p_event_date date default current_date, p_note text default null, p_quantity numeric default null,
  p_unit text default null, p_state jsonb default '{}'::jsonb, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, atlas
as $function$
declare v_role text; v_membership_id uuid; v_farm_key text; v_state jsonb;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then raise exception 'Active farm membership required.' using errcode = '42501'; end if;
  select f.stable_key into v_farm_key from atlas.farms f where f.id = p_farm_id;
  if v_farm_key is null then raise exception 'Farm was not found.' using errcode = 'P0002'; end if;
  v_state := coalesce(p_state, '{}'::jsonb) || jsonb_build_object('actor_user_id', auth.uid(), 'actor_membership_id', v_membership_id, 'actor_role', v_role);
  return atlas.record_crop_observation_v1(v_farm_key, p_object_key, p_crop_cycle_id, p_observation_key, p_event_date, p_note, p_quantity, p_unit, v_state, p_idempotency_key);
end;
$function$;

revoke all on function atlas.object_workbench_v1(uuid, text, integer, integer) from public, anon;
revoke all on function atlas.record_object_event_for_member_v1(uuid, text, text, date, text, numeric, text, uuid, uuid, jsonb, text) from public, anon;
revoke all on function atlas.record_crop_observation_for_member_v1(uuid, text, uuid, text, date, text, numeric, text, jsonb, text) from public, anon;
grant execute on function atlas.object_workbench_v1(uuid, text, integer, integer) to authenticated, service_role;
grant execute on function atlas.record_object_event_for_member_v1(uuid, text, text, date, text, numeric, text, uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function atlas.record_crop_observation_for_member_v1(uuid, text, uuid, text, date, text, numeric, text, jsonb, text) to authenticated, service_role;
