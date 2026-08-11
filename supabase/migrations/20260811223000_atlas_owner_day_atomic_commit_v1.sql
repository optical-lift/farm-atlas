-- Owner Day Edit is one purple draft and one commit.
-- Existing edit/schedule RPCs remain available for backwards compatibility, but
-- the Owner Day board now has one transaction boundary across both placement
-- edits and newly approved work selections.

create or replace function atlas.owner_commit_worker_day_choreography_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_edits jsonb default '[]'::jsonb,
  p_selections jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_edit_result jsonb:='{}'::jsonb;
  v_schedule_result jsonb:='{}'::jsonb;
  v_edit_count integer;
  v_selection_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_edits,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_selections,'[]'::jsonb))<>'array' then
    raise exception 'Day edits and selections must be arrays.' using errcode='22023';
  end if;

  v_edit_count:=jsonb_array_length(coalesce(p_edits,'[]'::jsonb));
  v_selection_count:=jsonb_array_length(coalesce(p_selections,'[]'::jsonb));
  if v_edit_count=0 and v_selection_count=0 then
    raise exception 'Choose at least one Day change.' using errcode='22023';
  end if;
  if v_edit_count>100 or v_selection_count>40 then
    raise exception 'Too many Day changes.' using errcode='22023';
  end if;

  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='owner'
      and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  -- One lock and one PostgreSQL transaction for the whole purple draft. If any
  -- selected card has changed, every placement edit in this call rolls back too.
  perform pg_advisory_xact_lock(
    hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|'||p_day::text||'|owner_day_atomic_commit_v1',0)
  );

  if v_edit_count>0 then
    v_edit_result:=atlas.owner_apply_worker_day_edits_api_v1(
      p_farm_id,
      p_membership_id,
      p_edits
    );
  end if;

  if v_selection_count>0 then
    v_schedule_result:=atlas.owner_build_worker_day_schedule_api_v2(
      p_farm_id,
      p_membership_id,
      p_day,
      p_selections
    );
  end if;

  return jsonb_build_object(
    'contractVersion','owner_worker_day_atomic_commit_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'editCount',v_edit_count,
    'selectionCount',v_selection_count,
    'edits',v_edit_result,
    'schedule',v_schedule_result
  );
end;
$function$;

revoke all on function atlas.owner_commit_worker_day_choreography_api_v1(uuid,uuid,date,jsonb,jsonb) from public,anon;
grant execute on function atlas.owner_commit_worker_day_choreography_api_v1(uuid,uuid,date,jsonb,jsonb) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(signature,write_kind,route_dependencies,protection,evidence,reviewed_at)
values(
  'atlas.owner_commit_worker_day_choreography_api_v1(uuid, uuid, date, jsonb, jsonb)',
  'mutation',
  array['/api/atlas/owner-day-commit'],
  'owner farm membership + active Farm Hand target + one database transaction',
  jsonb_build_object(
    'purpose','Commit the Owner Day purple draft atomically across placement edits and newly approved work',
    'boundary','owner-only; child edit/schedule functions retain their own authorization checks',
    'rollback','any failed edit or selection rolls back the entire Day commit'
  ),
  now()
)
on conflict (signature) do update
set write_kind=excluded.write_kind,
    route_dependencies=excluded.route_dependencies,
    protection=excluded.protection,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
