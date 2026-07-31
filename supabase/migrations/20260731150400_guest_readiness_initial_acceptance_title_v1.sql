-- Preserve the original final-clean, photography, and acceptance intent on the adopted Clock task.

do $$
declare
  v_definition text;
  v_before text := E'    new.title := case when coalesce(new.metadata->>''rhythm_target_state'','''')=''fallen_out_of_rhythm''\n      then ''Restore guest readiness — ''||coalesce(nullif(v_zone.label,''''),''Venue'')\n      else ''Guest readiness walk — ''||coalesce(nullif(v_zone.label,''''),''Venue'') end;';
  v_after text := E'    new.title := case\n      when lower(coalesce(new.metadata->>''initial_guest_readiness_acceptance'',''false'')) in (''true'',''yes'',''1'') then ''Final clean, photograph + Guest Readiness acceptance''\n      when coalesce(new.metadata->>''rhythm_target_state'','''')=''fallen_out_of_rhythm'' then ''Restore guest readiness — ''||coalesce(nullif(v_zone.label,''''),''Venue'')\n      else ''Guest readiness walk — ''||coalesce(nullif(v_zone.label,''''),''Venue'') end;';
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='decorate_biological_clock_task_v1';

  if v_definition is null then
    raise exception 'Biological Clock task decorator was not found.';
  end if;

  if position(v_before in v_definition)>0 then
    execute replace(v_definition,v_before,v_after);
  end if;

  update atlas.tasks set
    title='Final clean, photograph + Guest Readiness acceptance',
    note=case
      when coalesce(note,'') like '%Walk all seven rooms, complete the final clean%' then note
      else coalesce(note,'')||case when coalesce(note,'')='' then '' else E'\n' end||'Walk all seven rooms, complete the final clean, record readiness, and photograph the accepted venue state.'
    end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'photograph_accepted_state',true,
      'display_action','Accept + photograph'
    ),
    updated_at=now()
  where metadata->>'task_key'='owner_20260808_final_clean_photos_acceptance'
    and status in ('open','blocked');

  update atlas.planned_work_occurrences set
    title='Final clean, photograph + Guest Readiness acceptance',
    task_payload=coalesce(task_payload,'{}'::jsonb)||jsonb_build_object(
      'title','Final clean, photograph + Guest Readiness acceptance',
      'note','Walk all seven rooms, complete the final clean, record readiness, and photograph the accepted venue state.'
    ),
    updated_at=now()
  where id=(
    select planned_occurrence_id
    from atlas.tasks
    where metadata->>'task_key'='owner_20260808_final_clean_photos_acceptance'
    limit 1
  );
end;
$$;
