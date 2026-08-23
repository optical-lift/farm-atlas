create or replace function local_intel.get_search_discovery_execution_context_v1(p_search_query_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = local_intel, pg_catalog
as $$
select jsonb_build_object(
  'search_query_id',q.id,
  'query_text',q.query_text,
  'requested_fields',to_jsonb(q.requested_fields),
  'parameters',q.parameters,
  'metadata',q.metadata,
  'status',q.status,
  'loop_state',local_intel.get_search_discovery_loop_state_v1(q.id)
)
from local_intel.search_queries q
where q.id=p_search_query_id;
$$;
revoke all on function local_intel.get_search_discovery_execution_context_v1(uuid) from public,anon,authenticated;
grant execute on function local_intel.get_search_discovery_execution_context_v1(uuid) to service_role;
comment on function local_intel.get_search_discovery_execution_context_v1(uuid) is 'Read-only execution context exposed to the controlled discovery worker without granting direct access to search tables.';