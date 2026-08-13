begin;

create or replace function atlas.worker_dismiss_day_cue_api_v1(p_cue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_cue atlas.worker_day_cues%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  select cue.* into v_cue
  from atlas.worker_day_cues cue
  join atlas.farm_memberships fm on fm.id=cue.membership_id
  where cue.id=p_cue_id
    and fm.active=true
    and fm.user_id=auth.uid()
  for update of cue;

  if v_cue.id is null then
    raise exception 'Cue access required.' using errcode='42501';
  end if;

  if v_cue.status='resolved' then
    return jsonb_build_object(
      'contractVersion','worker_day_cue_dismissal_v1',
      'cueId',v_cue.id,
      'status',v_cue.status,
      'resolvedAt',v_cue.resolved_at,
      'deduplicated',true
    );
  end if;

  if v_cue.status='dismissed' then
    return jsonb_build_object(
      'contractVersion','worker_day_cue_dismissal_v1',
      'cueId',v_cue.id,
      'status',v_cue.status,
      'deduplicated',true
    );
  end if;

  update atlas.worker_day_cues cue
  set status='dismissed',
      updated_at=now()
  where cue.id=p_cue_id
  returning * into v_cue;

  return jsonb_build_object(
    'contractVersion','worker_day_cue_dismissal_v1',
    'cueId',v_cue.id,
    'status',v_cue.status,
    'dismissedAt',v_cue.updated_at
  );
end;
$function$;

revoke all on function atlas.worker_dismiss_day_cue_api_v1(uuid) from public, anon;
grant execute on function atlas.worker_dismiss_day_cue_api_v1(uuid) to authenticated, service_role;

commit;
