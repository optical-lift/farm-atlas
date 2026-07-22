create or replace function atlas.normalize_child_checklist_task_status()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'atlas'
as $function$
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  if coalesce((new.metadata ->> 'is_child_task')::boolean, false) then
    if new.status in ('archived', 'skipped') then
      new.metadata := jsonb_set(new.metadata, '{checklist_status}', to_jsonb(new.status), true);
    elsif new.status = 'blocked' then
      new.metadata := jsonb_set(new.metadata, '{checklist_status}', '"blocked"'::jsonb, true);
    elsif new.metadata ->> 'checklist_status' = 'done' then
      new.status := 'done';
    elsif new.metadata ->> 'checklist_status' = 'blocked' then
      new.status := 'blocked';
    elsif new.metadata ->> 'checklist_status' = 'open' then
      new.status := 'open';
    end if;
  end if;

  return new;
end;
$function$;

update atlas.tasks
set status = 'blocked',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'checklist_status', 'blocked',
      'blocked_status_reconciled_at', now(),
      'blocked_status_reconciliation_source', 'preserve_spray_readiness_gate'
    ),
    updated_at = now()
where id in (
  '3d446cdd-2dac-4e4f-814c-cf5774179119'::uuid,
  'd2427f8c-462a-4fb8-9d4c-591c377d6989'::uuid,
  '3dd3393c-3f6e-48d1-8e99-8b836735d476'::uuid,
  'a313a4e5-c3cd-4ef0-943b-79b07531dc2c'::uuid,
  '4179a45e-af56-4dc1-9e38-2d5d815d00a9'::uuid,
  '87792dcb-1170-439d-a9db-b4ea7196150d'::uuid
);
