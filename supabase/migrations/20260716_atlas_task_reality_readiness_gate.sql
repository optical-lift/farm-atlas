create or replace function atlas.enforce_task_reality_gate()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_requires_ready boolean;
  v_source_ready boolean;
  v_blocker text;
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  v_requires_ready := lower(coalesce(new.metadata ->> 'requires_source_ready', 'false')) in ('true','yes','1');
  v_source_ready := lower(coalesce(new.metadata ->> 'source_ready', 'false')) in ('true','yes','1');

  if v_requires_ready and not v_source_ready and new.status = 'open' then
    v_blocker := coalesce(
      nullif(new.metadata ->> 'readiness_blocker', ''),
      nullif(new.metadata ->> 'source_readiness_question', ''),
      'Source material is not confirmed ready.'
    );

    new.status := 'blocked';
    new.due_date := null;
    new.blocker_text := v_blocker;
    new.metadata := new.metadata || jsonb_build_object(
      'reality_gate', 'source_readiness',
      'reality_gate_state', 'waiting',
      'reality_gate_checked_at', now(),
      'attempted_status', 'open'
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_task_reality_gate on atlas.tasks;
create trigger trg_enforce_task_reality_gate
before insert or update of status, due_date, metadata on atlas.tasks
for each row
execute function atlas.enforce_task_reality_gate();

update atlas.tasks
set status = 'blocked',
    due_date = null,
    blocker_text = 'Basil seedlings are not ready to leave the grow room yet.',
    metadata = (coalesce(metadata, '{}'::jsonb)
      - 'unlocked_at'
      - 'unlock_source'
      - 'unlocked_by_maintenance_object_id') || jsonb_build_object(
        'requires_source_ready', true,
        'source_ready', false,
        'source_state', 'growing_in_grow_room',
        'readiness_blocker', 'Basil seedlings are not ready to leave the grow room yet.',
        'source_readiness_question', 'Are the basil seedlings rooted, sturdy, and hardened enough to transplant?',
        'reality_gate', 'source_readiness',
        'reality_gate_state', 'waiting',
        'corrected_at', now(),
        'corrected_reason', 'Maintenance completion proved the bed was ready, not that the basil was ready.'
      ),
    updated_at = now()
where metadata ->> 'task_key' = 'fr8_transplant_basil_after_weeding_20260715';