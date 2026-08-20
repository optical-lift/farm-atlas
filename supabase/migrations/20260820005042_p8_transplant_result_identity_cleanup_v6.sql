do $p8_fix$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='record_crop_requirement_transplant_result_v1'
    and pg_get_function_identity_arguments(p.oid)='p_task_id uuid, p_actor_membership_id uuid, p_planted_date date, p_planted_amount numeric, p_destination_object_id uuid, p_all_remaining_transplanted boolean, p_note text, p_idempotency_key text';
  if v_def is null then raise exception 'record_crop_requirement_transplant_result_v1 definition not found'; end if;

  v_def:=replace(v_def,$old$  v_destination_label text;
  v_key text$old$,$new$  v_destination_label text;
  v_identity_label text;
  v_key text$new$);

  v_def:=replace(v_def,$old$  if v_source_cycle.id is null or v_req.subject_kind<>'crop_cycle' then raise exception 'Source crop cycle not found.' using errcode='P0002'; end if;

  if not exists($old$,$new$  if v_source_cycle.id is null or v_req.subject_kind<>'crop_cycle' then raise exception 'Source crop cycle not found.' using errcode='P0002'; end if;
  v_identity_label:=coalesce(nullif(v_source_cycle.variety,''),nullif(v_source_cycle.crop_label,''),'Crop');

  if not exists($new$);

  v_def:=replace(v_def,$old$  perform atlas.sync_crop_cycle_registry_v1(v_task.farm_id,p_destination_object_id);
  select id into v_destination_cycle_id
  from atlas.crop_cycles
  where object_content_id=v_content_id
  order by created_at desc,id
  limit 1;

  if v_destination_cycle_id is not null then$old$,$new$  perform atlas.sync_crop_cycle_registry_v1(v_task.farm_id,p_destination_object_id);
  select id into v_destination_cycle_id
  from atlas.crop_cycles
  where object_content_id=v_content_id
  order by created_at desc,id
  limit 1;

  -- Normalize the legacy planting logger's display fallback back to the canonical source identity.
  update atlas.tasks
  set metadata=jsonb_set(
        metadata,
        '{planting_log}',
        coalesce(metadata->'planting_log','{}'::jsonb)||jsonb_build_object(
          'variety',v_source_cycle.variety,
          'summary','Planted '||p_planted_amount::text||' plants '||v_identity_label||' in '||v_destination_label
        ),
        true
      ),
      updated_at=now()
  where id=v_task.id;
  update atlas.planting_claims
  set variety=v_source_cycle.variety,
      note='Planted '||p_planted_amount::text||' plants '||v_identity_label||' in '||v_destination_label,
      updated_at=now()
  where id=v_claim_id;
  update atlas.object_contents
  set variety=v_source_cycle.variety,
      note='Planted '||p_planted_amount::text||' plants '||v_identity_label||' in '||v_destination_label,
      updated_at=now()
  where id=v_content_id;
  if v_field_log_id is not null then
    update atlas.field_logs
    set summary_sentence='Planted '||p_planted_amount::text||' plants '||v_identity_label||' in '||v_destination_label,
        note='Planted '||p_planted_amount::text||' plants '||v_identity_label||' in '||v_destination_label
    where id=v_field_log_id;
  end if;
  if v_destination_cycle_id is not null then
    update atlas.crop_cycles
    set variety=v_source_cycle.variety,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'identity_normalized_from_source_crop_cycle',v_source_cycle.id,
          'identity_normalized_by','crop_requirement_transplant_result_v1'
        ),
        updated_at=now()
    where id=v_destination_cycle_id;
  end if;

  select * into v_task from atlas.tasks where id=p_task_id;

  if v_destination_cycle_id is not null then$new$);

  execute v_def;
end
$p8_fix$;

comment on function atlas.record_crop_requirement_transplant_result_v1(uuid,uuid,date,numeric,uuid,boolean,text,text) is
'P8 structured transplant result. The source crop cycle owns crop identity; legacy task-title display fallbacks are normalized out of planting claim, content, destination cycle, field log, and embedded task result.';
