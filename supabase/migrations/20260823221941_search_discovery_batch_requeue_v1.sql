create or replace function local_intel.requeue_search_discovery_batch_v1(
  p_search_query_id uuid,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare v_state jsonb;
begin
  update local_intel.search_discovery_queue
     set status='queued',claimed_at=null,
         metadata=metadata||jsonb_build_object('last_error',p_error,'last_error_at',now()),
         updated_at=now()
   where search_query_id=p_search_query_id and status='in_process';
  v_state := local_intel.get_search_discovery_loop_state_v1(p_search_query_id);
  return v_state;
end;
$$;
revoke all on function local_intel.requeue_search_discovery_batch_v1(uuid,text) from public,anon,authenticated;
grant execute on function local_intel.requeue_search_discovery_batch_v1(uuid,text) to service_role;
comment on function local_intel.requeue_search_discovery_batch_v1(uuid,text) is 'Return a failed claimed discovery batch to the queue without granting the executor direct discovery-table mutation privileges.';