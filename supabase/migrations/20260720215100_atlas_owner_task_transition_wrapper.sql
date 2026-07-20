revoke all on function atlas.record_task_transition_v1(uuid, text, text, date, text, text, text, text, jsonb, uuid)
from public, anon, authenticated;

grant execute on function atlas.record_task_transition_v1(uuid, text, text, date, text, text, text, text, jsonb, uuid)
to service_role;

create or replace function atlas.owner_record_task_transition_v1(
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null,
  p_note text default null,
  p_reason text default null,
  p_lane_key text default null,
  p_work_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_existing_field_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_farm_id uuid;
begin
  select t.farm_id
  into v_farm_id
  from atlas.tasks t
  where t.id = p_task_id;

  if v_farm_id is null or not atlas.is_farm_owner(v_farm_id) then
    raise exception 'Owner membership required for task transition.' using errcode = '42501';
  end if;

  return atlas.record_task_transition_v1(
    p_task_id,
    p_transition,
    p_idempotency_key,
    p_target_date,
    p_note,
    p_reason,
    p_lane_key,
    p_work_key,
    coalesce(p_payload, '{}'::jsonb),
    p_existing_field_log_id
  );
end;
$function$;

revoke all on function atlas.owner_record_task_transition_v1(uuid, text, text, date, text, text, text, text, jsonb, uuid)
from public, anon;

grant execute on function atlas.owner_record_task_transition_v1(uuid, text, text, date, text, text, text, text, jsonb, uuid)
to authenticated;
