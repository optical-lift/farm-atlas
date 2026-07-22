create or replace function atlas.record_closeout_for_member_v1(
  p_farm_id uuid,
  p_period text,
  p_note text,
  p_carry_forward text default null,
  p_next_focus text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_log_id uuid;
  v_summary text;
  v_created_by text;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_role not in ('owner','manager') or v_membership_id is null then raise exception 'Owner or manager membership required.' using errcode='42501'; end if;
  if p_period not in ('day','week','month') then raise exception 'Closeout period must be day, week, or month.' using errcode='22023'; end if;
  if nullif(btrim(p_note),'') is null then raise exception 'Closeout note required.' using errcode='22023'; end if;
  if length(p_note)>4000 or length(coalesce(p_carry_forward,''))>4000 or length(coalesce(p_next_focus,''))>4000 then raise exception 'Closeout text must be 4,000 characters or fewer.' using errcode='22023'; end if;

  select coalesce(nullif(btrim(up.display_name),''),v_role) into v_created_by from atlas.user_profiles up where up.user_id=auth.uid();
  v_created_by := coalesce(v_created_by,v_role);
  v_summary := concat_ws(' ',v_today::text||' · '||p_period||' closeout saved.',btrim(p_note),
    case when nullif(btrim(p_carry_forward),'') is not null then 'Carry forward: '||btrim(p_carry_forward) end,
    case when nullif(btrim(p_next_focus),'') is not null then 'Next focus: '||btrim(p_next_focus) end);

  insert into atlas.field_logs(farm_id,log_date,action_types,summary_sentence,note,created_by,source,metadata)
  values(p_farm_id,v_today,array['closeout',p_period||'_closeout'],v_summary,btrim(p_note),v_created_by,'atlas_closeout',
    jsonb_build_object('closeout_period',p_period,'carry_forward',nullif(btrim(p_carry_forward),''),'next_focus',nullif(btrim(p_next_focus),''),'actor_user_id',auth.uid(),'actor_membership_id',v_membership_id,'actor_role',v_role))
  returning id into v_log_id;
  return jsonb_build_object('fieldLogId',v_log_id,'logDate',v_today,'period',p_period);
end;
$function$;

revoke all on function atlas.record_closeout_for_member_v1(uuid,text,text,text,text) from public,anon;
grant execute on function atlas.record_closeout_for_member_v1(uuid,text,text,text,text) to authenticated,service_role;
