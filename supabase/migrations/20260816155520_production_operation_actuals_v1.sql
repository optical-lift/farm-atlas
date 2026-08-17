create table if not exists atlas.production_operation_actuals (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id),
  production_lot_id uuid references atlas.production_lots(id),
  task_id uuid not null references atlas.tasks(id),
  operation_class text not null,
  observed_date date not null,
  actual_minutes integer not null check(actual_minutes>0 and actual_minutes<=1440),
  expected_minutes_before integer,
  quantity numeric,
  unit text,
  actor_membership_id uuid references atlas.farm_memberships(id),
  note text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(farm_id,idempotency_key)
);
create index if not exists production_operation_actuals_operation_idx on atlas.production_operation_actuals(farm_id,operation_class,observed_date desc);
create index if not exists production_operation_actuals_lot_idx on atlas.production_operation_actuals(production_lot_id,observed_date desc);
alter table atlas.production_operation_actuals enable row level security;
revoke all on atlas.production_operation_actuals from public,anon,authenticated;
grant all on atlas.production_operation_actuals to service_role;

create or replace function atlas.prevent_production_operation_actual_mutation_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$ begin raise exception 'Production operation actuals are append-only; write a correcting actual instead'; end; $function$;
drop trigger if exists prevent_production_operation_actual_mutation on atlas.production_operation_actuals;
create trigger prevent_production_operation_actual_mutation before update or delete on atlas.production_operation_actuals for each row execute function atlas.prevent_production_operation_actual_mutation_v1();

create or replace function atlas.record_production_operation_actual_v1(
  p_task_id uuid,
  p_actual_minutes integer,
  p_quantity numeric default null,
  p_unit text default null,
  p_observed_date date default null,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_lot_id uuid;
  v_expected integer;
  v_membership uuid;
  v_day date:=coalesce(p_observed_date,(now() at time zone 'America/Chicago')::date);
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_actual atlas.production_operation_actuals%rowtype;
  v_event_id uuid;
begin
  if p_task_id is null or p_actual_minutes is null or p_actual_minutes<=0 or p_actual_minutes>1440 then
    raise exception 'Task and actual minutes from 1 to 1440 are required' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>120 then raise exception 'A valid labor-actual idempotency key is required' using errcode='22023'; end if;
  if v_day>(now() at time zone 'America/Chicago')::date+1 then raise exception 'Labor actual date cannot be in the future' using errcode='22023'; end if;

  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task was not found' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_task.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  select fm.id into v_membership from atlas.farm_memberships fm where fm.farm_id=v_task.farm_id and fm.user_id=auth.uid() and fm.active order by fm.created_at limit 1;
  select plt.production_lot_id into v_lot_id from atlas.production_lot_tasks plt where plt.task_id=v_task.id order by plt.created_at limit 1;
  if v_lot_id is null then
    begin v_lot_id:=nullif(v_task.metadata->>'production_lot_id','')::uuid; exception when others then v_lot_id:=null; end;
  end if;
  if v_lot_id is null then raise exception 'Task is not linked to a production lot' using errcode='22023'; end if;

  select expected_active_minutes into v_expected from atlas.task_capacity_profiles where task_id=v_task.id;
  select * into v_actual from atlas.production_operation_actuals where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_actual.id is not null then
    return jsonb_build_object('actualId',v_actual.id,'taskId',v_task.id,'productionLotId',v_actual.production_lot_id,'deduplicated',true);
  end if;

  insert into atlas.production_operation_actuals(
    farm_id,production_lot_id,task_id,operation_class,observed_date,actual_minutes,expected_minutes_before,quantity,unit,actor_membership_id,note,idempotency_key,metadata
  ) values(
    v_task.farm_id,v_lot_id,v_task.id,coalesce(nullif(v_task.operation_class,''),'unclassified'),v_day,p_actual_minutes,v_expected,p_quantity,nullif(btrim(coalesce(p_unit,'')),''),v_membership,
    nullif(btrim(coalesce(p_note,'')),''),v_key,
    jsonb_build_object('operationClassSource',coalesce(v_task.operation_class_source,'unclassified'),'estimateSource',(select estimate_source from atlas.task_capacity_profiles where task_id=v_task.id),'estimateConfidence',(select estimate_confidence from atlas.task_capacity_profiles where task_id=v_task.id))
  ) returning * into v_actual;

  insert into atlas.production_lot_events(farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,note,source,idempotency_key,metadata)
  values(v_task.farm_id,v_lot_id,'labor_actual',v_day,p_actual_minutes,'minutes',v_task.id,p_note,'production_operation_actual',left(v_key||':lot-event',160),jsonb_strip_nulls(jsonb_build_object('operation_actual_id',v_actual.id,'operation_class',v_actual.operation_class,'actual_minutes',p_actual_minutes,'expected_minutes_before',v_expected,'work_quantity',p_quantity,'work_unit',nullif(btrim(coalesce(p_unit,'')),''),'variance_minutes',case when v_expected is null then null else p_actual_minutes-v_expected end)))
  returning id into v_event_id;

  return jsonb_build_object('contractVersion','record_production_operation_actual_v1','actualId',v_actual.id,'productionLotEventId',v_event_id,'taskId',v_task.id,'productionLotId',v_lot_id,'operationClass',v_actual.operation_class,'actualMinutes',p_actual_minutes,'expectedMinutesBefore',v_expected,'varianceMinutes',case when v_expected is null then null else p_actual_minutes-v_expected end,'deduplicated',false);
end;
$function$;

create or replace view atlas.production_operation_labor_evidence_v1 as
select
  farm_id,
  operation_class,
  count(*)::integer as sample_count,
  round(avg(actual_minutes)::numeric,1) as average_actual_minutes,
  percentile_cont(0.5) within group(order by actual_minutes)::numeric as median_actual_minutes,
  min(actual_minutes) as minimum_actual_minutes,
  max(actual_minutes) as maximum_actual_minutes,
  round((avg(expected_minutes_before) filter(where expected_minutes_before is not null))::numeric,1) as average_expected_minutes_before,
  round((avg(actual_minutes-expected_minutes_before) filter(where expected_minutes_before is not null))::numeric,1) as average_variance_minutes,
  max(observed_date) as last_observed_date,
  case when count(*)>=5 then 'eligible_for_estimator_review' when count(*)>=2 then 'emerging_evidence' else 'insufficient_sample' end as evidence_state
from atlas.production_operation_actuals
group by farm_id,operation_class;
revoke all on atlas.production_operation_labor_evidence_v1 from public,anon,authenticated;
grant select on atlas.production_operation_labor_evidence_v1 to service_role;

revoke all on function atlas.record_production_operation_actual_v1(uuid,integer,numeric,text,date,text,text) from public;
grant execute on function atlas.record_production_operation_actual_v1(uuid,integer,numeric,text,date,text,text) to authenticated,service_role;