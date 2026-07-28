create or replace function atlas.sync_workflow_event_to_rhythm_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  begin
    perform atlas.apply_result_rhythm_effects_v1(new.id);
  exception when others then
    -- A Clock evaluation problem must never roll back the canonical task result,
    -- observation, or field log that triggered it. Persist the failure on the
    -- affected Clock state so the scheduled tick can retry and surface it.
    update atlas.rhythm_state s
    set metadata = s.metadata || jsonb_build_object(
          'last_result_clock_error', sqlerrm,
          'last_result_clock_sqlstate', sqlstate,
          'last_result_clock_error_at', now(),
          'last_result_workflow_event_id', new.id
        ),
        updated_at = now()
    where s.farm_id = new.farm_id
      and exists (
        select 1
        from atlas.rhythm_workflow_subjects_v1(new.id) affected
        where affected.subject_kind = s.subject_kind
          and affected.subject_id = s.subject_id
      );
    raise warning 'Rhythm Clock result evaluation failed for workflow event %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function atlas.sync_workflow_event_to_rhythm_v1()
  from public, anon, authenticated;
