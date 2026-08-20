do $p8_fix$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='record_crop_requirement_transplant_result_v1'
    and pg_get_function_identity_arguments(p.oid)='p_task_id uuid, p_actor_membership_id uuid, p_planted_date date, p_planted_amount numeric, p_destination_object_id uuid, p_all_remaining_transplanted boolean, p_note text, p_idempotency_key text';
  if v_def is null then raise exception 'record_crop_requirement_transplant_result_v1 definition not found'; end if;

  v_old:=$old$
  if v_claim_id is null or v_content_id is null then
    raise exception 'Structured transplant result did not produce canonical planting evidence.' using errcode='55000';
  end if;

  perform atlas.sync_crop_cycle_registry_v1(v_task.farm_id,p_destination_object_id);$old$;

  v_new:=$new$
  if v_claim_id is null or v_content_id is null then
    raise exception 'Structured transplant result did not produce canonical planting evidence.' using errcode='55000';
  end if;

  -- The legacy planting logger requires a display fallback for variety. Requirement-derived
  -- execution has stronger source identity: if the source variety is unknown, canonical rows
  -- must remain unknown rather than inheriting the task title as a fake cultivar.
  if v_source_cycle.variety is null then
    update atlas.planting_claims set variety=null,updated_at=now() where id=v_claim_id;
    update atlas.object_contents set variety=null,updated_at=now() where id=v_content_id;
  else
    update atlas.planting_claims set variety=v_source_cycle.variety,updated_at=now() where id=v_claim_id;
    update atlas.object_contents set variety=v_source_cycle.variety,updated_at=now() where id=v_content_id;
  end if;

  perform atlas.sync_crop_cycle_registry_v1(v_task.farm_id,p_destination_object_id);$new$;

  if strpos(v_def,v_old)=0 then raise exception 'P8 variety correction insertion point not found'; end if;
  v_def:=replace(v_def,v_old,v_new);
  execute v_def;
end
$p8_fix$;

comment on function atlas.record_crop_requirement_transplant_result_v1(uuid,uuid,date,numeric,uuid,boolean,text,text) is
'P8 structured transplant result. Canonical planting identity comes from the source crop cycle; an unknown source variety remains unknown and is never replaced by a task title.';
