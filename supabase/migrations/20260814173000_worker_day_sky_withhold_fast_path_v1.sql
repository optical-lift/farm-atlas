begin;

create or replace function atlas.task_sky_withheld_v1(
  p_task_id uuid,
  p_work_date date default null
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_timezone text := 'America/Chicago';
  v_day date;
  v_today date;
  v_at timestamptz;
  v_policy jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=v_task.farm_id;

  v_day:=coalesce(p_work_date,(now() at time zone v_timezone)::date);
  v_today:=(now() at time zone v_timezone)::date;
  v_at:=case when v_day=v_today then now() else (v_day::timestamp + time '12:00') at time zone v_timezone end;

  v_policy:=atlas.task_sky_deferral_policy_v2(v_task.id,v_at);
  if not coalesce((v_policy->>'canSkyWithhold')::boolean,false) then
    return false;
  end if;

  return coalesce((atlas.task_sky_presentation_gate_v1(v_task.id,v_day)->>'withheldUnderSky')::boolean,false);
end;
$function$;

revoke all on function atlas.task_sky_withheld_v1(uuid,date) from public, anon, authenticated;
grant execute on function atlas.task_sky_withheld_v1(uuid,date) to service_role;

do $migration$
declare
  v_definition text;
  v_updated text;
  v_gate_old text := $old$  cross join lateral (
    select atlas.task_sky_presentation_gate_v1(task.id,v_work_date) as gate
  ) sky$old$;
  v_gate_new text := $new$  cross join lateral (
    select atlas.task_sky_withheld_v1(task.id,v_work_date) as withheld
  ) sky$new$;
  v_withheld_old text := $old$coalesce((sky.gate->>'withheldUnderSky')::boolean,false)$old$;
begin
  select pg_get_functiondef('atlas.presented_work_selection_rows_v1(uuid,uuid,date)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'presented_work_selection_rows_v1 must exist before the sky fast-path migration.';
  end if;

  if position('atlas.task_sky_withheld_v1(task.id,v_work_date)' in v_definition)>0 then
    return;
  end if;

  if position(v_gate_old in v_definition)=0 or position(v_withheld_old in v_definition)=0 then
    raise exception 'presented_work_selection_rows_v1 no longer matches the expected pre-fast-path contract.';
  end if;

  v_updated:=replace(v_definition,v_gate_old,v_gate_new);
  v_updated:=replace(v_updated,v_withheld_old,'sky.withheld');

  if v_updated=v_definition
     or position('atlas.task_sky_withheld_v1(task.id,v_work_date)' in v_updated)=0
     or position(v_withheld_old in v_updated)>0 then
    raise exception 'Sky withhold fast-path rewrite did not produce the required selection contract.';
  end if;

  execute v_updated;
end;
$migration$;

commit;
