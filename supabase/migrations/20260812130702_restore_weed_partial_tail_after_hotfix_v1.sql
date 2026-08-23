do $block$
begin
  if to_regprocedure('atlas.release_weed_card_continuation_unqueued_v1(uuid,uuid)') is not null then
    execute $sql$
      create or replace function atlas.release_weed_card_continuation_v1(
        p_occurrence_id uuid,
        p_source_task_id uuid
      )
      returns uuid
      language plpgsql
      security definer
      set search_path to 'pg_catalog','atlas'
      as $function$
      begin
        return atlas.release_weed_card_continuation_unqueued_v1(p_occurrence_id,p_source_task_id);
      end;
      $function$;
    $sql$;

    revoke all on function atlas.release_weed_card_continuation_v1(uuid,uuid) from public,anon,authenticated;
    grant execute on function atlas.release_weed_card_continuation_v1(uuid,uuid) to service_role;
  end if;
end;
$block$;