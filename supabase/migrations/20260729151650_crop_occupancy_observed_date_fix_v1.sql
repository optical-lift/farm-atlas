create or replace function atlas.ensure_crop_cycle_for_content_v1(p_object_content_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_content atlas.object_contents%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_claim atlas.planting_claims%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_identity text;
  v_start_date date;
  v_observed_date date;
  v_life_cycle text;
  v_start_method text;
  v_stage text;
  v_key text;
begin
  select oc.* into v_content from atlas.object_contents oc where oc.id=p_object_content_id;
  if v_content.id is null then
    raise exception 'Object content not found.' using errcode='P0002';
  end if;

  select go.* into v_object from atlas.growing_objects go where go.id=v_content.object_id;
  if v_content.planting_claim_id is not null then
    select pc.* into v_claim from atlas.planting_claims pc where pc.id=v_content.planting_claim_id;
  end if;

  v_identity := atlas.normalize_crop_identity_v1(v_content.content_label,v_content.variety);
  v_observed_date := coalesce(
    atlas.try_date_v1(v_content.metadata->>'observed_date'),
    atlas.try_date_v1(v_content.metadata->>'verified_date'),
    atlas.try_date_v1(v_content.metadata->>'photo_truth_date')
  );
  v_start_date := coalesce(v_content.planted_date,v_claim.planted_date);
  v_life_cycle := case
    when lower(coalesce(v_content.content_type,'')) like '%perennial%' then 'perennial'
    else null
  end;
  v_start_method := lower(coalesce(v_content.start_method,v_claim.planting_method,''));
  v_stage := atlas.crop_stage_from_state_v1(v_content.status,v_life_cycle);

  select cc.* into v_cycle
  from atlas.crop_cycles cc
  where cc.object_content_id=v_content.id
  order by
    (cc.lifecycle_status='active') desc,
    (atlas.normalize_crop_identity_v1(cc.crop_label,cc.variety)=v_identity) desc,
    (coalesce(cc.sown_date,cc.planted_date)=v_start_date) desc,
    cc.updated_at desc
  limit 1;

  if v_cycle.id is null then
    select cc.* into v_cycle
    from atlas.crop_cycles cc
    where cc.object_id=v_content.object_id
      and cc.lifecycle_status='active'
      and atlas.normalize_crop_identity_v1(cc.crop_label,cc.variety)=v_identity
    order by
      (coalesce(cc.sown_date,cc.planted_date)=v_start_date) desc,
      (coalesce(cc.sown_date,cc.planted_date) is null and v_start_date is null) desc,
      cc.updated_at desc
    limit 1;
  end if;

  if v_cycle.id is null then
    v_key := 'occupancy:' || v_object.stable_key || ':' || substr(md5(coalesce(v_identity,v_content.id::text)||':'||coalesce(v_start_date::text,'unknown')||':'||v_content.id::text),1,24);
    insert into atlas.crop_cycles(
      farm_id,object_id,planting_claim_id,crop_profile_id,crop_cycle_key,
      crop_label,variety,cycle_state,lifecycle_status,sown_date,planted_date,
      object_content_id,metadata
    ) values (
      v_content.farm_id,v_content.object_id,v_content.planting_claim_id,v_content.crop_profile_id,v_key,
      v_content.content_label,v_content.variety,coalesce(v_stage,'planned'),'active',
      case when v_start_method in ('direct_sow','direct sow','sow','seed','seeded') then v_start_date else null end,
      case when v_start_method in ('direct_sow','direct sow','sow','seed','seeded') then null else v_start_date end,
      v_content.id,
      jsonb_build_object(
        'source','crop_occupancy_backfill_v1',
        'identity',v_identity,
        'date_source',case when v_content.planted_date is not null then 'object_content' when v_claim.planted_date is not null then 'planting_claim' else 'unknown' end,
        'first_observed_date',v_observed_date
      )
    ) returning * into v_cycle;
  elsif v_cycle.object_content_id is null then
    update atlas.crop_cycles
    set object_content_id=v_content.id,
        crop_profile_id=coalesce(crop_profile_id,v_content.crop_profile_id),
        planting_claim_id=coalesce(planting_claim_id,v_content.planting_claim_id),
        updated_at=now()
    where id=v_cycle.id
    returning * into v_cycle;
  end if;

  update atlas.object_contents
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'crop_occupancy_cycle_id',v_cycle.id,
        'crop_occupancy_identity',v_identity,
        'crop_occupancy_reconciled_at',now()
      ),
      updated_at=now()
  where id=v_content.id;

  insert into atlas.crop_occupancy_evidence(
    farm_id,object_id,crop_cycle_id,object_content_id,planting_claim_id,
    evidence_role,evidence_date,confidence,metadata
  ) values (
    v_content.farm_id,v_content.object_id,v_cycle.id,v_content.id,v_content.planting_claim_id,
    'identity',coalesce(v_start_date,v_observed_date),atlas.occupancy_confidence_v1(v_content.confidence),
    jsonb_build_object('content_label',v_content.content_label,'variety',v_content.variety,'content_type',v_content.content_type,'status',v_content.status)
  ) on conflict do nothing;

  if v_start_date is not null or v_content.planting_claim_id is not null then
    insert into atlas.crop_occupancy_evidence(
      farm_id,object_id,crop_cycle_id,object_content_id,planting_claim_id,
      evidence_role,evidence_date,confidence,metadata
    ) values (
      v_content.farm_id,v_content.object_id,v_cycle.id,v_content.id,v_content.planting_claim_id,
      'planting',v_start_date,atlas.occupancy_confidence_v1(v_content.confidence),
      jsonb_build_object('start_method',nullif(v_start_method,''),'source_date',v_start_date)
    ) on conflict do nothing;
  end if;

  return v_cycle.id;
end;
$$;

update atlas.crop_cycles
set sown_date=null,
    planted_date=null,
    metadata=metadata||jsonb_build_object('date_source','unknown'),
    updated_at=now()
where metadata->>'source'='crop_occupancy_backfill_v1'
  and metadata->>'date_source'='observation';