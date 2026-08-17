-- Pass 3F — Owner-authored Worker Day shape.
-- Day Shape is farm-execution policy, not Principal scheduling and not inferred from task history.

create or replace function atlas.owner_set_worker_day_shape_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_weekdays smallint[],
  p_local_start time without time zone,
  p_local_end time without time zone,
  p_effective_from date,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_weekdays smallint[];
  v_version integer;
  v_policy_id uuid;
  v_policy_key text := 'standard_worker_day';
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  if p_effective_from is null or p_local_start is null or p_local_end is null then
    raise exception 'Effective date, local start, and local end are required.' using errcode='22023';
  end if;
  if p_local_end<=p_local_start then
    raise exception 'Worker Day end must be later than its start.' using errcode='22023';
  end if;

  select array_agg(distinct weekday order by weekday)
  into v_weekdays
  from unnest(coalesce(p_weekdays,'{}'::smallint[])) weekday
  where weekday between 0 and 6;

  if coalesce(cardinality(v_weekdays),0)=0
     or cardinality(v_weekdays)<>cardinality(coalesce(p_weekdays,'{}'::smallint[])) then
    raise exception 'Choose one or more unique weekdays from 0 through 6.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text||':worker-day-shape',0));

  select coalesce(max(policy.version),0)+1
  into v_version
  from atlas.worker_day_shape_policies policy
  where policy.membership_id=p_membership_id and policy.policy_key=v_policy_key;

  -- Preserve past history. A replacement owns the requested effective date forward.
  update atlas.worker_day_shape_policies policy
  set effective_through=p_effective_from-1,
      updated_at=now()
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.policy_key=v_policy_key
    and policy.active=true
    and policy.effective_from<p_effective_from
    and (policy.effective_through is null or policy.effective_through>=p_effective_from);

  update atlas.worker_day_shape_policies policy
  set active=false,
      updated_at=now(),
      metadata=coalesce(policy.metadata,'{}'::jsonb)||jsonb_build_object(
        'superseded_at',now(),
        'superseded_by_version',v_version
      )
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.policy_key=v_policy_key
    and policy.active=true
    and policy.effective_from>=p_effective_from;

  insert into atlas.worker_day_shape_policies(
    farm_id,membership_id,policy_key,policy_name,version,weekdays,local_start,local_end,
    effective_from,active,authored_by_user_id,authored_reason,metadata
  ) values (
    p_farm_id,p_membership_id,v_policy_key,'Standard Worker Day',v_version,v_weekdays,p_local_start,p_local_end,
    p_effective_from,true,auth.uid(),nullif(btrim(coalesce(p_reason,'')),''),
    jsonb_build_object('source','owner_set_worker_day_shape_api_v1')
  ) returning id into v_policy_id;

  return jsonb_build_object(
    'ok',true,
    'policyId',v_policy_id,
    'policyVersion',v_version,
    'effective',atlas.worker_day_shape_effective_v1(p_farm_id,p_membership_id,p_effective_from)
  );
end;
$$;

revoke all on function atlas.owner_set_worker_day_shape_api_v1(uuid,uuid,smallint[],time without time zone,time without time zone,date,text) from public,anon;
grant execute on function atlas.owner_set_worker_day_shape_api_v1(uuid,uuid,smallint[],time without time zone,time without time zone,date,text) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values (
  'atlas.owner_set_worker_day_shape_api_v1(uuid, uuid, smallint[], time without time zone, time without time zone, date, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Author the Farm Hand Day Shape used by Worker Day chronology proposals.',
    'boundary','Farm Owner only; no schedule is inferred and no task placement is committed.',
    'history','Replacements preserve past effective policy while superseding the requested date forward.'
  ),now()
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=now();
