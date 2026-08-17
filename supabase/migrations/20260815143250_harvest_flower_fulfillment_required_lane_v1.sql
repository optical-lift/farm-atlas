-- Harvest commercial fulfillment hardening.
-- A customer-committed pickup/delivery is not discretionary day-budget work.
-- Any planned occurrence sourced from a flower sale order is a required hard-date obligation.

create or replace function atlas.enforce_flower_sale_occurrence_lane_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.source_kind='flower_sale_order' then
    new.work_lane:='required';
    new.commitment_kind:='hard_date';
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'commercialCommitmentLane','required',
      'commercialCommitmentKind','hard_date',
      'commercialCommitmentReason','Customer pickup/delivery commitment is required work on its promised date.'
    );
  end if;
  return new;
end;
$function$;

comment on function atlas.enforce_flower_sale_occurrence_lane_v1() is
  'Normalizes flower-sale-derived operational occurrences as required hard-date work so a committed pickup/delivery cannot be suppressed by discretionary daily budget.';

revoke all on function atlas.enforce_flower_sale_occurrence_lane_v1() from public,anon,authenticated;
grant execute on function atlas.enforce_flower_sale_occurrence_lane_v1() to service_role;

drop trigger if exists flower_sale_occurrence_required_lane_v1 on atlas.planned_work_occurrences;
create trigger flower_sale_occurrence_required_lane_v1
before insert or update of source_kind,source_id,work_lane,commitment_kind
on atlas.planned_work_occurrences
for each row
execute function atlas.enforce_flower_sale_occurrence_lane_v1();
