create or replace function atlas.guard_farm_round_parent_derived_completion_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if old.status is distinct from new.status
     and new.status='done'
     and coalesce(new.metadata->>'farm_round_parent','false') in ('true','yes','1')
     and coalesce(new.metadata->>'farmRoundCompletionSource','') <> 'all_member_occurrences_terminal'
  then
    raise exception 'Farm Round parent completion is derived from its member occurrences and cannot be completed directly.' using errcode='P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_farm_round_parent_derived_completion_v1 on atlas.tasks;
create trigger guard_farm_round_parent_derived_completion_v1
before update of status on atlas.tasks
for each row
execute function atlas.guard_farm_round_parent_derived_completion_v1();