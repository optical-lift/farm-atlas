-- Day cue mutation contracts v1
-- Cues are delivery choreography, not tasks. Owner authors/re-anchors them;
-- the worker only resolves the specific cue being served.

create or replace function atlas.owner_upsert_worker_day_cue_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_cue jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_id uuid;
  v_service_date date;
  v_kind text;
  v_anchor text;
  v_anchor_task_id uuid;
  v_title text;
  v_body text;
  v_payload jsonb;
  v_result_contract jsonb;
  v_recovery text;
  v_scheduled_at timestamptz;
  v_available_from timestamptz;
  v_expires_at timestamptz;
  v_row atlas.worker_day_cues%rowtype;
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  select farm.organization_id into v_org_id
  from atlas.farms farm
  where farm.id=p_farm_id
    and exists (
      select 1 from atlas.farm_memberships fm
      where fm.farm_id=farm.id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
    );
  if v_org_id is null then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  if p_cue is null or jsonb_typeof(p_cue)<>'object' then
    raise exception 'Cue payload is required.' using errcode='22023';
  end if;

  begin v_id:=nullif(p_cue->>'cueId','')::uuid; exception when invalid_text_representation then raise exception 'cueId must be a UUID.' using errcode='22023'; end;
  begin v_service_date:=nullif(p_cue->>'serviceDate','')::date; exception when others then raise exception 'serviceDate must be a date.' using errcode='22023'; end;
  v_kind:=nullif(p_cue->>'cueKind','');
  v_anchor:=nullif(p_cue->>'anchorKind','');
  begin v_anchor_task_id:=nullif(p_cue->>'anchorTaskId','')::uuid; exception when invalid_text_representation then raise exception 'anchorTaskId must be a UUID.' using errcode='22023'; end;
  v_title:=nullif(btrim(p_cue->>'title'),'');
  v_body:=nullif(btrim(p_cue->>'body'),'');
  v_payload:=case when jsonb_typeof(p_cue->'payload')='object' then p_cue->'payload' else '{}'::jsonb end;
  v_result_contract:=case when jsonb_typeof(p_cue->'resultContract')='object' then p_cue->'resultContract' else '{}'::jsonb end;
  v_recovery:=coalesce(nullif(p_cue->>'recoveryPolicy',''),'refresh');
  begin v_scheduled_at:=nullif(p_cue->>'scheduledAt','')::timestamptz; exception when others then raise exception 'scheduledAt is invalid.' using errcode='22023'; end;
  begin v_available_from:=nullif(p_cue->>'availableFrom','')::timestamptz; exception when others then raise exception 'availableFrom is invalid.' using errcode='22023'; end;
  begin v_expires_at:=nullif(p_cue->>'expiresAt','')::timestamptz; exception when others then raise exception 'expiresAt is invalid.' using errcode='22023'; end;

  if v_service_date is null or v_title is null then
    raise exception 'Cue date and title are required.' using errcode='22023';
  end if;
  if v_kind not in ('briefing','requirement','observation','somatic','result') then
    raise exception 'Unsupported cue kind.' using errcode='22023';
  end if;
  if v_anchor not in ('first_open','before_task','after_task','at_time') then
    raise exception 'Unsupported cue anchor.' using errcode='22023';
  end if;
  if v_recovery not in ('refresh','expire','persist','block') then
    raise exception 'Unsupported cue recovery policy.' using errcode='22023';
  end if;
  if v_anchor in ('before_task','after_task') and v_anchor_task_id is null then
    raise exception 'Task-anchored cues need an anchor task.' using errcode='22023';
  end if;
  if v_anchor_task_id is not null and not exists (
    select 1 from atlas.tasks task
    where task.id=v_anchor_task_id and task.farm_id=p_farm_id and task.assigned_membership_id=p_membership_id
  ) then
    raise exception 'Cue anchor task is not assigned to this worker.' using errcode='55000';
  end if;

  if v_id is null then
    insert into atlas.worker_day_cues(
      organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
      scheduled_at,title,body,payload,result_contract,status,recovery_policy,
      available_from,expires_at,created_by_user_id
    ) values (
      v_org_id,p_farm_id,p_membership_id,v_service_date,v_kind,v_anchor,v_anchor_task_id,
      v_scheduled_at,v_title,v_body,v_payload,v_result_contract,
      case when v_available_from is null or v_available_from<=now() then 'available' else 'waiting' end,
      v_recovery,v_available_from,v_expires_at,auth.uid()
    ) returning * into v_row;
  else
    update atlas.worker_day_cues cue
    set service_date=v_service_date,
        cue_kind=v_kind,
        anchor_kind=v_anchor,
        anchor_task_id=v_anchor_task_id,
        scheduled_at=v_scheduled_at,
        title=v_title,
        body=v_body,
        payload=v_payload,
        result_contract=v_result_contract,
        recovery_policy=v_recovery,
        available_from=v_available_from,
        expires_at=v_expires_at,
        status=case
          when cue.status in ('resolved','dismissed') then cue.status
          when v_available_from is null or v_available_from<=now() then 'available'
          else 'waiting'
        end,
        updated_at=now()
    where cue.id=v_id
      and cue.farm_id=p_farm_id
      and cue.membership_id=p_membership_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'Cue not found.' using errcode='55000';
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','owner_worker_day_cue_v1',
    'cueId',v_row.id,
    'serviceDate',v_row.service_date,
    'cueKind',v_row.cue_kind,
    'anchorKind',v_row.anchor_kind,
    'anchorTaskId',v_row.anchor_task_id,
    'title',v_row.title,
    'status',v_row.status
  );
end;
$$;

grant execute on function atlas.owner_upsert_worker_day_cue_api_v1(uuid,uuid,jsonb) to authenticated;

create or replace function atlas.owner_delete_worker_day_cue_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_cue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_deleted uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) then raise exception 'Owner farm membership required.' using errcode='42501'; end if;

  delete from atlas.worker_day_cues cue
  where cue.id=p_cue_id and cue.farm_id=p_farm_id and cue.membership_id=p_membership_id
  returning cue.id into v_deleted;
  if v_deleted is null then raise exception 'Cue not found.' using errcode='55000'; end if;

  return jsonb_build_object('contractVersion','owner_worker_day_cue_delete_v1','cueId',v_deleted,'deleted',true);
end;
$$;

grant execute on function atlas.owner_delete_worker_day_cue_api_v1(uuid,uuid,uuid) to authenticated;

create or replace function atlas.worker_resolve_day_cue_api_v1(
  p_cue_id uuid,
  p_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_cue atlas.worker_day_cues%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;

  select cue.* into v_cue
  from atlas.worker_day_cues cue
  join atlas.farm_memberships fm on fm.id=cue.membership_id
  where cue.id=p_cue_id
    and fm.active=true
    and (
      fm.user_id=auth.uid()
      or exists (
        select 1 from atlas.farm_memberships owner_membership
        where owner_membership.farm_id=cue.farm_id
          and owner_membership.active=true
          and owner_membership.role='owner'
          and owner_membership.user_id=auth.uid()
      )
    );
  if v_cue.id is null then raise exception 'Cue access required.' using errcode='42501'; end if;

  update atlas.worker_day_cues cue
  set response=case when jsonb_typeof(coalesce(p_response,'{}'::jsonb))='object' then coalesce(p_response,'{}'::jsonb) else '{}'::jsonb end,
      status='resolved',resolved_at=now(),updated_at=now()
  where cue.id=p_cue_id
  returning * into v_cue;

  return jsonb_build_object(
    'contractVersion','worker_day_cue_resolution_v1',
    'cueId',v_cue.id,
    'status',v_cue.status,
    'resolvedAt',v_cue.resolved_at,
    'response',v_cue.response
  );
end;
$$;

grant execute on function atlas.worker_resolve_day_cue_api_v1(uuid,jsonb) to authenticated;
