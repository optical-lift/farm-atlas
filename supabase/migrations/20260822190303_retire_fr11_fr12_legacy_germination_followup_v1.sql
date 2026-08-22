do $migration$
declare
  v_sow_task_id uuid;
begin
  select id into v_sow_task_id
  from atlas.tasks
  where metadata->>'task_key'='anna_20260817_sow_procut_orange_fr11_fr12_after_turnover'
  order by created_at
  limit 1;

  if v_sow_task_id is null then
    raise exception 'Canonical FR11/FR12 ProCut Orange sow task was not found.';
  end if;

  update atlas.tasks
  set status='archived',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'archived_reason','legacy_sow_followup_superseded_by_canonical_germination_rhythm',
        'archived_on',date '2026-08-22',
        'timing_authority','canonical_germination_rhythm'
      )
  where status='open'
    and task_type='germination_check'
    and metadata->>'source_sowing_task_id'=v_sow_task_id::text
    and nullif(metadata->>'rhythm_state_id','') is null;
end
$migration$;
