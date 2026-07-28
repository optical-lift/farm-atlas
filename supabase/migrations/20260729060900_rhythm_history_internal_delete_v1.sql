create or replace function atlas.prevent_rhythm_history_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if current_setting('atlas.rhythm_history_internal_write', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'Rhythm transition and satisfaction history is append-only.' using errcode = '55000';
end;
$$;

revoke all on function atlas.prevent_rhythm_history_mutation_v1()
  from public, anon, authenticated;
