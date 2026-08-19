do $migration$
declare
  v_def text;
  v_old text := $old$missing_destination as (
    select * from packets
    where coalesce(packet #>> '{flowBufferClaim,claims,destination,state}','unresolved')='unresolved'
  ),$old$;
  v_new text := $new$missing_destination as (
    select * from packets
    where coalesce(packet #>> '{flowBufferClaim,claims,destination,state}','unresolved')='unresolved'
      and coalesce(packet #>> '{flowBufferClaim,nextTransitionAvailability,operationFunction}','') <> 'continue_linked_crop_body'
  ),$new$;
begin
  v_def := pg_get_functiondef('atlas.farm_continuity_audit_v3(uuid,date)'::regprocedure);
  if position(v_old in v_def)=0 then
    raise exception 'Expected farm_continuity_audit_v3 missing-destination clause was not found; refusing an unsafe patch.';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$migration$;