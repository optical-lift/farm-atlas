-- Operational eligibility helpers are composition predicates used only from
-- SECURITY DEFINER Worker Day functions. They are not authenticated app RPCs.
revoke all on function atlas.task_required_resources_available_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.task_temporally_eligible_v1(uuid,date) from public, anon, authenticated;

grant execute on function atlas.task_required_resources_available_v1(uuid) to service_role;
grant execute on function atlas.task_temporally_eligible_v1(uuid,date) to service_role;

-- Fail closed if either helper accidentally remains in the signed-in RPC surface.
do $verify$
begin
  if has_function_privilege('authenticated','atlas.task_required_resources_available_v1(uuid)','EXECUTE') then
    raise exception 'resource eligibility helper remains authenticated-executable';
  end if;
  if has_function_privilege('authenticated','atlas.task_temporally_eligible_v1(uuid,date)','EXECUTE') then
    raise exception 'temporal eligibility helper remains authenticated-executable';
  end if;
  if not has_function_privilege('service_role','atlas.task_required_resources_available_v1(uuid)','EXECUTE') then
    raise exception 'resource eligibility helper lost service-role execution';
  end if;
  if not has_function_privilege('service_role','atlas.task_temporally_eligible_v1(uuid,date)','EXECUTE') then
    raise exception 'temporal eligibility helper lost service-role execution';
  end if;
end $verify$;