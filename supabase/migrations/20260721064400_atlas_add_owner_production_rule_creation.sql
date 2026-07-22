create or replace function atlas.owner_create_production_plan_from_rule_v1(
  p_farm_id uuid,
  p_rule_id uuid,
  p_crop_profile_id uuid default null,
  p_season_year integer default null,
  p_first_window_start date default null,
  p_final_biological_sow_date date default null,
  p_intended_uses text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_rule atlas.production_rule_templates%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_plan_id uuid;
  v_stable_key text;
  v_result jsonb;
begin
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner membership required.' using errcode='42501'; end if;
  if p_rule_id is null or p_season_year<2026 or p_season_year>2100 or p_first_window_start is null then
    raise exception 'Production rule plan settings are invalid.' using errcode='22023';
  end if;
  select * into v_rule from atlas.production_rule_templates where id=p_rule_id and active=true;
  if v_rule.id is null then raise exception 'Production rule was not found.' using errcode='P0002'; end if;
  select * into v_profile from atlas.crop_profiles where id=coalesce(p_crop_profile_id,v_rule.crop_profile_id);
  if v_profile.id is null then raise exception 'This rule requires a crop profile.' using errcode='22023'; end if;
  v_stable_key:=v_profile.stable_key||'_'||p_season_year::text||'_production';

  insert into atlas.production_plans(
    farm_id,crop_profile_id,rule_template_id,stable_key,season_year,plan_label,plan_kind,first_window_start,
    succession_count,spacing_days,window_length_days,late_window_days,skip_threshold_days,missed_strategy,
    intended_uses,protect_final_succession,final_biological_sow_date,active,notes,metadata,updated_at
  ) values (
    p_farm_id,v_profile.id,v_rule.id,v_stable_key,p_season_year,v_profile.crop_label||' '||p_season_year::text||' production plan',
    v_rule.plan_kind,p_first_window_start,v_rule.default_succession_count,v_rule.default_spacing_days,v_rule.default_window_length_days,
    v_rule.default_late_window_days,0,v_rule.missed_strategy,coalesce(p_intended_uses,'{}'::text[]),v_rule.protect_final_succession,
    p_final_biological_sow_date,true,v_rule.operational_summary,
    jsonb_build_object('production_rule_key',v_rule.stable_key,'rule_config',v_rule.rule_config,'created_from','production_rule_library'),now()
  ) on conflict(farm_id,stable_key,season_year) do update
  set crop_profile_id=excluded.crop_profile_id,rule_template_id=excluded.rule_template_id,plan_label=excluded.plan_label,
      plan_kind=excluded.plan_kind,first_window_start=excluded.first_window_start,succession_count=excluded.succession_count,
      spacing_days=excluded.spacing_days,window_length_days=excluded.window_length_days,late_window_days=excluded.late_window_days,
      missed_strategy=excluded.missed_strategy,intended_uses=excluded.intended_uses,
      protect_final_succession=excluded.protect_final_succession,final_biological_sow_date=excluded.final_biological_sow_date,
      active=true,notes=excluded.notes,metadata=coalesce(atlas.production_plans.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now()
  returning id into v_plan_id;

  v_result:=atlas.owner_update_production_plan_v1(
    p_farm_id,'regenerate',v_plan_id,null,null,null,
    v_rule.default_succession_count,v_rule.default_spacing_days,p_first_window_start,
    v_rule.default_window_length_days,v_rule.default_late_window_days,v_rule.missed_strategy
  );
  return jsonb_build_object('action','create_from_rule','planId',v_plan_id,'regeneration',v_result);
end;
$function$;

revoke all on function atlas.owner_create_production_plan_from_rule_v1(uuid,uuid,uuid,integer,date,date,text[]) from public,anon;
grant execute on function atlas.owner_create_production_plan_from_rule_v1(uuid,uuid,uuid,integer,date,date,text[]) to authenticated,service_role;
