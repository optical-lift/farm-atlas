-- Harvest Pass 5 read membrane for buyer selection.
-- buyer_relationship_reconstruction intentionally has no direct authenticated SELECT policy.
-- Expose only the minimal relationship fields needed to attach an explicit sale to a known buyer.

create or replace function atlas.flower_sale_buyer_options_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_role text;
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  v_role:=atlas.current_farm_role(p_farm_id);
  if v_role not in ('owner','manager','farm_hand') then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',buyer.id,
    'businessName',buyer.business_name,
    'buyerType',buyer.buyer_type,
    'relationshipStatus',buyer.relationship_status,
    'priorityRank',buyer.priority_rank
  ) order by buyer.priority_rank nulls last,buyer.business_name),'[]'::jsonb)
  into v_rows
  from atlas.buyer_relationship_reconstruction buyer
  where buyer.farm_id=p_farm_id;

  return v_rows;
end;
$function$;

comment on function atlas.flower_sale_buyer_options_v1(uuid) is
  'Minimal membership-scoped buyer selector for explicit flower sales. Does not broaden direct RLS access to buyer relationship reconstruction.';

revoke all on function atlas.flower_sale_buyer_options_v1(uuid) from public,anon;
grant execute on function atlas.flower_sale_buyer_options_v1(uuid) to authenticated,service_role;
