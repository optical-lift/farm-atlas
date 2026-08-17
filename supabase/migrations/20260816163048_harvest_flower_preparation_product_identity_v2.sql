create or replace function atlas.record_flower_preparation_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_outputs jsonb,
  p_no_saleable_output boolean,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
) returns jsonb
language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_batch atlas.flower_harvest_batches%rowtype;
  v_existing atlas.flower_preparation_batches%rowtype;
  v_preparation atlas.flower_preparation_batches%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_batch_id uuid;
  v_output jsonb;
  v_kind text;
  v_quantity numeric(10,2);
  v_lower_bound boolean;
  v_unit text;
  v_exactness text;
  v_crop_profile_id uuid;
  v_product_label text;
  v_output_index integer := 0;
  v_input_count integer := 0;
  v_ready jsonb := '[]'::jsonb;
  v_ready_row atlas.flower_ready_inventory_lots%rowtype;
  v_transition jsonb;
  v_remaining_observation_id uuid;
  v_next_task jsonb;
begin
  if v_key is null then raise exception 'Preparation idempotency key is required.' using errcode='22023'; end if;
  if p_outputs is null then p_outputs:='[]'::jsonb; end if;
  if jsonb_typeof(p_outputs)<>'array' then raise exception 'Ready outputs must be an array.' using errcode='22023'; end if;
  if coalesce(p_no_saleable_output,false) and jsonb_array_length(p_outputs)>0 then
    raise exception 'No-saleable-output cannot also create Ready inventory.' using errcode='22023';
  end if;
  if not coalesce(p_no_saleable_output,false) and jsonb_array_length(p_outputs)=0 then
    raise exception 'Record at least one Ready output or mark that nothing saleable resulted.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Preparation task not found.' using errcode='P0002'; end if;

  select * into v_existing from atlas.flower_preparation_batches where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'inventoryKind',r.inventory_kind,'cropProfileId',r.crop_profile_id,'productLabel',r.product_label,
      'quantity',r.quantity,'unit',r.unit,'quantityExactness',r.quantity_exactness,'readyDate',r.ready_date
    ) order by r.created_at),'[]'::jsonb)
    into v_ready from atlas.flower_ready_inventory_lots r where r.preparation_batch_id=v_existing.id;
    return jsonb_build_object('preparationBatchId',v_existing.id,'taskId',v_existing.task_id,'resultKind',v_existing.result_kind,'readyLots',v_ready,'deduplicated',true);
  end if;

  if v_task.status not in ('open','blocked') or v_task.task_type<>'flower_preparation' then
    raise exception 'Task is not an open flower preparation.' using errcode='22023';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record flower preparation.' using errcode='42501';
  end if;
  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id is distinct from p_effective_membership_id) then
    raise exception 'Preparation task is not assigned to this worker.' using errcode='42501';
  end if;

  begin v_batch_id:=nullif(v_task.metadata->>'flower_harvest_batch_id','')::uuid;
  exception when invalid_text_representation then v_batch_id:=null; end;
  if v_batch_id is null then raise exception 'Preparation task has no harvest batch.' using errcode='22023'; end if;
  select * into v_batch from atlas.flower_harvest_batches where id=v_batch_id;
  if v_batch.id is null or v_batch.farm_id is distinct from v_task.farm_id then
    raise exception 'Preparation harvest batch is outside the task farm.' using errcode='22023';
  end if;

  perform 1
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id)
  for update;

  select count(*) into v_input_count
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id);
  if v_input_count=0 then raise exception 'There is no unprepared harvest output in this batch.' using errcode='22023'; end if;

  for v_output in select value from jsonb_array_elements(p_outputs) loop
    if jsonb_typeof(v_output)<>'object' then raise exception 'Each Ready output must be an object.' using errcode='22023'; end if;
    v_kind:=lower(btrim(coalesce(v_output->>'kind',v_output->>'inventoryKind','')));
    if v_kind not in ('conditioned_bucket','counted_stems','posy','bouquet','lobby_arrangement') then
      raise exception 'Choose a supported Ready inventory kind.' using errcode='22023';
    end if;
    begin v_quantity:=(v_output->>'quantity')::numeric;
    exception when others then raise exception 'Ready quantity must be numeric.' using errcode='22023'; end;
    if v_quantity is null or v_quantity<=0 or v_quantity>10000 then raise exception 'Ready quantity must be greater than zero.' using errcode='22023'; end if;
    begin v_lower_bound:=coalesce((v_output->>'lowerBound')::boolean,false);
    exception when others then raise exception 'Ready lowerBound must be boolean.' using errcode='22023'; end;
    begin v_crop_profile_id:=nullif(v_output->>'cropProfileId','')::uuid;
    exception when others then raise exception 'Ready cropProfileId must be a valid crop profile UUID.' using errcode='22023'; end;
    v_product_label:=nullif(btrim(coalesce(v_output->>'productLabel','')),'');

    if v_kind='conditioned_bucket' then
      if mod(v_quantity*4,1)<>0 then raise exception 'Conditioned bucket quantity must use quarter-bucket increments.' using errcode='22023'; end if;
    else
      if mod(v_quantity,1)<>0 then raise exception 'Counted Ready units must be whole numbers.' using errcode='22023'; end if;
      if v_lower_bound then raise exception 'Only conditioned bucket output may remain a lower bound.' using errcode='22023'; end if;
    end if;
    if v_kind='counted_stems' and v_crop_profile_id is null then
      raise exception 'Counted-stem Ready inventory requires crop identity.' using errcode='22023';
    end if;
    if v_crop_profile_id is not null and not exists (
      select 1
      from atlas.flower_harvest_bucket_observations h
      join atlas.crop_cycles c on c.id=h.crop_cycle_id
      where h.batch_id=v_batch.id
        and c.crop_profile_id=v_crop_profile_id
        and not exists (select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id)
    ) then
      raise exception 'Ready crop identity is not present in the unprepared harvest input.' using errcode='22023';
    end if;
  end loop;

  insert into atlas.flower_preparation_batches(
    farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,result_kind,note,idempotency_key,created_by_user_id,metadata
  ) values (
    v_task.farm_id,v_batch.id,v_task.id,v_today,p_effective_membership_id,
    case when coalesce(p_no_saleable_output,false) then 'no_saleable_output' else 'ready' end,
    nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object('operatorMode',p_operator_mode,'effectiveMembershipId',p_effective_membership_id,'inputCount',v_input_count,'truthBoundary','completed_preparation')
  ) returning * into v_preparation;

  insert into atlas.flower_preparation_inputs(
    farm_id,preparation_batch_id,harvest_observation_id,source_bucket_band,source_bucket_equivalent_floor,source_lower_bound
  )
  select h.farm_id,v_preparation.id,h.id,h.bucket_band,h.bucket_equivalent_floor,(h.bucket_band='more_than_one')
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id)
  order by h.created_at;

  for v_output in select value from jsonb_array_elements(p_outputs) loop
    v_output_index:=v_output_index+1;
    v_kind:=lower(btrim(coalesce(v_output->>'kind',v_output->>'inventoryKind')));
    v_quantity:=(v_output->>'quantity')::numeric;
    v_lower_bound:=coalesce((v_output->>'lowerBound')::boolean,false);
    v_crop_profile_id:=nullif(v_output->>'cropProfileId','')::uuid;
    v_product_label:=nullif(btrim(coalesce(v_output->>'productLabel','')),'');
    v_unit:=case v_kind when 'conditioned_bucket' then 'bucket_equivalent' when 'counted_stems' then 'stem' when 'posy' then 'posy' when 'bouquet' then 'bouquet' when 'lobby_arrangement' then 'arrangement' end;
    v_exactness:=case when v_lower_bound then 'lower_bound' else 'exact' end;

    insert into atlas.flower_ready_inventory_lots(
      farm_id,preparation_batch_id,inventory_kind,crop_profile_id,product_label,quantity,unit,quantity_exactness,
      ready_date,idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_preparation.id,v_kind,v_crop_profile_id,v_product_label,v_quantity,v_unit,v_exactness,
      v_today,v_key||':ready:'||v_output_index::text,auth.uid(),
      jsonb_build_object('sourceHarvestBatchId',v_batch.id,'sourcePreparationBatchId',v_preparation.id,'cropProfileId',v_crop_profile_id,'productLabel',v_product_label,'truthBoundary','finished_saleable_inventory')
    ) returning * into v_ready_row;

    v_ready:=v_ready||jsonb_build_array(jsonb_build_object(
      'id',v_ready_row.id,'inventoryKind',v_ready_row.inventory_kind,'cropProfileId',v_ready_row.crop_profile_id,'productLabel',v_ready_row.product_label,
      'quantity',v_ready_row.quantity,'unit',v_ready_row.unit,'quantityExactness',v_ready_row.quantity_exactness,'readyDate',v_ready_row.ready_date
    ));
  end loop;

  v_transition:=atlas.record_task_transition_v1_internal(
    v_task.id,'done','flower-preparation:'||v_preparation.id::text,null,p_note,null,'prepare','flower_preparation',
    jsonb_build_object('flower_harvest_batch_id',v_batch.id,'flower_preparation_batch_id',v_preparation.id,'result_kind',v_preparation.result_kind,'input_count',v_input_count,'ready_lot_count',jsonb_array_length(v_ready)),null
  );

  select h.id into v_remaining_observation_id
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id and not exists (select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id)
  order by h.created_at limit 1;
  if v_remaining_observation_id is not null then
    v_next_task:=atlas.ensure_flower_preparation_task_v1(v_batch.id,v_remaining_observation_id,v_batch.recorded_by_membership_id,v_today);
  end if;

  return jsonb_build_object(
    'preparationBatchId',v_preparation.id,'harvestBatchId',v_batch.id,'taskId',v_task.id,'resultKind',v_preparation.result_kind,
    'inputCount',v_input_count,'readyLots',v_ready,'nextPreparation',v_next_task,'transition',v_transition,'deduplicated',false
  );
end; $$;

alter table atlas.flower_ready_inventory_lots
  add constraint flower_ready_inventory_counted_stems_crop_check
  check (inventory_kind<>'counted_stems' or crop_profile_id is not null);

alter table atlas.flower_product_price_book
  add constraint flower_product_price_counted_stems_crop_check
  check (inventory_kind<>'counted_stems' or crop_profile_id is not null);

alter table atlas.flower_demand_order_lines
  add constraint flower_demand_counted_stems_crop_check
  check (inventory_kind<>'counted_stems' or crop_profile_id is not null);

alter table atlas.flower_standing_order_lines
  add constraint flower_standing_counted_stems_crop_check
  check (inventory_kind<>'counted_stems' or crop_profile_id is not null);