create or replace function atlas.normalize_execution_checklist_quick_complete_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  if btrim(coalesce(new.metadata ->> 'execution_checklist_template_key', '')) <> '' then
    new.metadata := jsonb_set(
      coalesce(new.metadata, '{}'::jsonb),
      '{quick_complete_allowed}',
      'false'::jsonb,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ac_normalize_execution_checklist_quick_complete_v1 on atlas.tasks;
create trigger ac_normalize_execution_checklist_quick_complete_v1
before insert or update of metadata, status on atlas.tasks
for each row
execute function atlas.normalize_execution_checklist_quick_complete_v1();

update atlas.tasks
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{quick_complete_allowed}',
  'false'::jsonb,
  true
)
where status in ('open', 'blocked')
  and btrim(coalesce(metadata ->> 'execution_checklist_template_key', '')) <> ''
  and metadata -> 'quick_complete_allowed' is distinct from 'false'::jsonb;
