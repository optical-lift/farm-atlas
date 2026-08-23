create or replace function local_intel.register_search_discovery_source_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_url text := nullif(btrim(p_payload->>'source_url'),'');
  v_kind text := coalesce(nullif(btrim(p_payload->>'source_kind'),''),'web_source');
  v_publisher text := nullif(btrim(p_payload->>'publisher'),'');
  v_title text := nullif(btrim(p_payload->>'title'),'');
  v_notes text := nullif(btrim(p_payload->>'notes'),'');
  v_id uuid;
begin
  if v_url is null or v_url !~ '^https?://' then
    raise exception 'valid source_url is required';
  end if;

  insert into local_intel.sources(source_url,source_kind,publisher,title,retrieved_at,notes,metadata)
  values(
    v_url,v_kind,v_publisher,v_title,now(),v_notes,
    jsonb_build_object('origin','search_discovery') || coalesce(p_payload->'metadata','{}'::jsonb)
  )
  on conflict (source_url)
  do update set
    publisher=coalesce(local_intel.sources.publisher,excluded.publisher),
    title=coalesce(local_intel.sources.title,excluded.title),
    retrieved_at=now(),
    notes=coalesce(local_intel.sources.notes,excluded.notes),
    metadata=local_intel.sources.metadata||excluded.metadata
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function local_intel.register_search_discovery_source_v1(jsonb) from public,anon,authenticated;
grant execute on function local_intel.register_search_discovery_source_v1(jsonb) to service_role;
comment on function local_intel.register_search_discovery_source_v1(jsonb) is 'Register or refresh a cited web source gathered by the mixed-batch discovery executor without granting broad source-table writes to the caller.';