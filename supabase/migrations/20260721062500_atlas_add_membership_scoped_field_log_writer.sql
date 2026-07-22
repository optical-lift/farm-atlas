create or replace function atlas.record_field_log_for_member_v1(
  p_farm_id uuid,
  p_action_types text[],
  p_summary_sentence text,
  p_note text default null,
  p_zone_keys text[] default '{}'::text[],
  p_object_keys text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_created_by text;
  v_log_id uuid;
  v_log_date date := (now() at time zone 'America/Chicago')::date;
  v_action text;
  v_object_ids uuid[];
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then raise exception 'Active farm membership required.' using errcode = '42501'; end if;

  if coalesce(array_length(p_action_types, 1), 0) = 0 then raise exception 'Choose at least one action type.' using errcode = '22023'; end if;
  foreach v_action in array p_action_types loop
    if v_action not in ('planted','sowed','weeded','watered','checked','harvested','moved','observed','maintained','blocked','completed') then
      raise exception 'Unsupported field log action: %', v_action using errcode = '22023';
    end if;
  end loop;
  if nullif(btrim(p_summary_sentence), '') is null then raise exception 'A summary sentence is required.' using errcode = '22023'; end if;
  if length(p_summary_sentence) > 4000 or length(coalesce(p_note, '')) > 4000 then raise exception 'Field log text must be 4,000 characters or fewer.' using errcode = '22023'; end if;

  select coalesce(nullif(btrim(up.display_name), ''), v_role) into v_created_by
  from atlas.user_profiles up where up.user_id = auth.uid();
  v_created_by := coalesce(v_created_by, v_role);

  insert into atlas.field_logs(farm_id, log_date, action_types, summary_sentence, note, created_by, source, metadata)
  values (p_farm_id, v_log_date, p_action_types, btrim(p_summary_sentence), nullif(btrim(p_note), ''), v_created_by, 'atlas_mobile',
    jsonb_build_object('actor_user_id', auth.uid(), 'actor_membership_id', v_membership_id, 'actor_role', v_role))
  returning id into v_log_id;

  insert into atlas.field_log_objects(field_log_id, zone_id, object_id, role)
  select v_log_id, z.id, null, 'touched' from atlas.zones z
  where z.farm_id = p_farm_id and z.stable_key = any(coalesce(p_zone_keys, '{}'::text[]))
  on conflict do nothing;

  select coalesce(array_agg(go.id), '{}'::uuid[]) into v_object_ids
  from atlas.growing_objects go
  where go.farm_id = p_farm_id and go.stable_key = any(coalesce(p_object_keys, '{}'::text[]));

  insert into atlas.field_log_objects(field_log_id, zone_id, object_id, role)
  select v_log_id, go.zone_id, go.id, 'touched' from atlas.growing_objects go where go.id = any(v_object_ids)
  on conflict do nothing;

  if coalesce(array_length(v_object_ids, 1), 0) > 0 then
    update atlas.object_state os
    set last_touched_at = greatest(coalesce(os.last_touched_at, v_log_date), v_log_date),
        last_weeded_at = case when 'weeded' = any(p_action_types) then greatest(coalesce(os.last_weeded_at, v_log_date), v_log_date) else os.last_weeded_at end,
        last_watered_at = case when 'watered' = any(p_action_types) then greatest(coalesce(os.last_watered_at, v_log_date), v_log_date) else os.last_watered_at end,
        last_checked_at = case when 'checked' = any(p_action_types) then greatest(coalesce(os.last_checked_at, v_log_date), v_log_date) else os.last_checked_at end,
        water_status = case when 'watered' = any(p_action_types) then 'irrigated' else os.water_status end,
        metadata = coalesce(os.metadata, '{}'::jsonb) || jsonb_build_object('last_field_log_id', v_log_id),
        updated_at = now()
    where os.farm_id = p_farm_id and os.object_id = any(v_object_ids);
  end if;

  return jsonb_build_object('id', v_log_id, 'log_date', v_log_date, 'action_types', p_action_types,
    'summary_sentence', btrim(p_summary_sentence), 'note', nullif(btrim(p_note), ''));
end;
$function$;

revoke all on function atlas.record_field_log_for_member_v1(uuid, text[], text, text, text[], text[]) from public, anon;
grant execute on function atlas.record_field_log_for_member_v1(uuid, text[], text, text, text[], text[]) to authenticated, service_role;
