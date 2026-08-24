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
  then
    if new.planned_occurrence_id is null
       or coalesce(new.metadata->>'farmRoundCompletionSource','') <> 'all_member_occurrences_terminal'
       or coalesce(new.metadata->>'farmRoundAutoCompletedAt','') is not distinct from coalesce(old.metadata->>'farmRoundAutoCompletedAt','')
       or exists (
         select 1
         from atlas.planned_work_occurrences child
         where child.parent_occurrence_id = new.planned_occurrence_id
           and child.state not in ('completed','cancelled')
       )
    then
      raise exception 'Farm Round parent completion is derived from live same-day member occurrence truth and cannot be completed directly.' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;