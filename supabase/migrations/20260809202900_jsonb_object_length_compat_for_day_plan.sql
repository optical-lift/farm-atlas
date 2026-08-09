create or replace function atlas.jsonb_object_length(p_value jsonb)
returns integer
language sql
immutable
parallel safe
as $$
  select count(*)::integer from jsonb_object_keys(coalesce(p_value,'{}'::jsonb));
$$;
