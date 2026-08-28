-- Atlas crop lifecycle continuity contract v1.
--
-- This layer is deliberately read-first. It compiles existing crop-profile biology,
-- explicit stage rules, live crop-cycle evidence, production lots, and future-work
-- custody into one continuity audit without auto-authoring worker-facing tasks.

create table if not exists atlas.crop_lifecycle_stage_rules (
  id uuid primary key default gen_random_uuid(),
  crop_profile_id uuid not null references atlas.crop_profiles(id) on delete cascade,
  stage_key text not null check (stage_key = any (array[
    'source_input'::text,
    'start'::text,
    'germinate'::text,
    'seedling_care'::text,
    'pot_up'::text,
    'grow_out'::text,
    'harden'::text,
    'destination'::text,
    'transplant'::text,
    'establish'::text,
    'care_loop'::text,
    'pinch'::text,
    'harvest_watch'::text,
    'harvest_or_service'::text,
    'decline'::text,
    'terminal_disposition'::text,
    'winter'::text,
    'spring_return'::text,
    'successor'::text
  ])),
  disposition text not null check (disposition = any (array[
    'required'::text,
    'optional'::text,
    'conditional'::text,
    'prohibited'::text,
    'not_applicable'::text
  ])),
  timing_min_days integer check (timing_min_days is null or timing_min_days >= 0),
  timing_max_days integer check (timing_max_days is null or timing_max_days >= 0),
  trigger_spec jsonb not null default '{}'::jsonb check (jsonb_typeof(trigger_spec) = 'object'),
  rule_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(rule_payload) = 'object'),
  confidence text not null default 'explicit'::text,
  source text not null,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crop_lifecycle_stage_rules_timing_order_check
    check (timing_min_days is null or timing_max_days is null or timing_max_days >= timing_min_days),
  constraint crop_lifecycle_stage_rules_profile_stage_key
    unique (crop_profile_id, stage_key)
);

create index if not exists crop_lifecycle_stage_rules_profile_active_idx
  on atlas.crop_lifecycle_stage_rules (crop_profile_id, active, stage_key);

alter table atlas.crop_lifecycle_stage_rules enable row level security;

revoke all on table atlas.crop_lifecycle_stage_rules from anon, authenticated;
grant all on table atlas.crop_lifecycle_stage_rules to service_role;

drop trigger if exists crop_lifecycle_stage_rules_set_updated_at on atlas.crop_lifecycle_stage_rules;
create trigger crop_lifecycle_stage_rules_set_updated_at
before update on atlas.crop_lifecycle_stage_rules
for each row execute function atlas.set_updated_at();

create or replace view atlas.v_crop_lifecycle_contract_v1
with (security_invoker = true)
as
with stage_catalog(stage_key, stage_order, stage_label) as (
  values
    ('source_input'::text, 10, 'Source / obtain input'::text),
    ('start'::text, 20, 'Start / sow / divide / receive'::text),
    ('germinate'::text, 30, 'Germinate / root / emerge'::text),
    ('seedling_care'::text, 40, 'Seedling care'::text),
    ('pot_up'::text, 50, 'Pot up / thin'::text),
    ('grow_out'::text, 60, 'Grow out'::text),
    ('harden'::text, 70, 'Harden'::text),
    ('destination'::text, 80, 'Destination / bed readiness'::text),
    ('transplant'::text, 90, 'Transplant / plant out'::text),
    ('establish'::text, 100, 'Establishment check'::text),
    ('care_loop'::text, 110, 'Field / stand care loop'::text),
    ('pinch'::text, 120, 'Pinch / train / cut-back rule'::text),
    ('harvest_watch'::text, 130, 'Harvest / display readiness watch'::text),
    ('harvest_or_service'::text, 140, 'Harvest / seed-save / display service'::text),
    ('decline'::text, 150, 'Condition-driven decline'::text),
    ('terminal_disposition'::text, 160, 'Clear or persist decision'::text),
    ('winter'::text, 170, 'Fall care / dormancy / overwinter'::text),
    ('spring_return'::text, 180, 'Spring return / survival / gap fill'::text),
    ('successor'::text, 190, 'Successor / next seasonal cycle'::text)
), base as (
  select
    cp.id as crop_profile_id,
    cp.stable_key as crop_profile_stable_key,
    cp.crop_label,
    cp.variety,
    cp.life_cycle,
    cp.default_planting_method,
    cp.harvest_pattern,
    cp.days_to_germination_min,
    cp.days_to_germination_max,
    cp.days_to_harvest_watch_min,
    cp.days_to_harvest_watch_max,
    cp.clear_offset_days,
    cp.frost_behavior,
    cp.decline_signal,
    coalesce(cp.metadata, '{}'::jsonb) as profile_metadata,
    s.stage_key,
    s.stage_order,
    s.stage_label,
    r.id as explicit_rule_id,
    r.disposition as explicit_disposition,
    r.timing_min_days as explicit_timing_min_days,
    r.timing_max_days as explicit_timing_max_days,
    r.trigger_spec as explicit_trigger_spec,
    r.rule_payload as explicit_rule_payload,
    r.confidence as explicit_confidence,
    r.source as explicit_source,
    r.note as explicit_note
  from atlas.crop_profiles cp
  cross join stage_catalog s
  left join atlas.crop_lifecycle_stage_rules r
    on r.crop_profile_id = cp.id
   and r.stage_key = s.stage_key
   and r.active
), inferred as (
  select b.*,
    lower(coalesce(b.default_planting_method, '')) as method_lc,
    lower(coalesce(b.life_cycle, '')) as life_cycle_lc,
    lower(coalesce(b.frost_behavior, '')) as frost_lc,
    (
      b.profile_metadata ? 'germination_workflow_enabled'
      or b.profile_metadata ? 'germination_check_mode'
      or lower(coalesce(b.default_planting_method, '')) like '%seed%'
      or lower(coalesce(b.default_planting_method, '')) like '%sow%'
    ) as has_germination_signal,
    (
      b.profile_metadata ? 'pot_up_days_min'
      or b.profile_metadata ? 'pot_up_days_max'
      or b.profile_metadata ? 'pot_up_readiness_cue'
    ) as has_pot_up_signal,
    (
      b.profile_metadata ? 'hardening_start_days_min'
      or b.profile_metadata ? 'hardening_start_days_max'
      or b.profile_metadata ? 'hardening_duration_days_min'
      or b.profile_metadata ? 'hardening_duration_days_max'
      or b.profile_metadata ? 'hardening_start_date'
    ) as has_hardening_signal,
    (
      b.profile_metadata ? 'transplant_ready_days_min'
      or b.profile_metadata ? 'transplant_ready_days_max'
      or b.profile_metadata ? 'transplant_readiness_cue'
      or b.profile_metadata ? 'target_transplant_date'
      or b.profile_metadata ? 'target_transplant_window_end'
      or b.profile_metadata ? 'spring_planting_date'
    ) as has_transplant_signal,
    (
      b.profile_metadata ? 'pinch_days_min'
      or b.profile_metadata ? 'pinch_days_max'
      or b.profile_metadata ? 'pinch'
      or exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(b.profile_metadata -> 'tending_gate_template') = 'array'
              then b.profile_metadata -> 'tending_gate_template'
            else '[]'::jsonb
          end
        ) gate
        where lower(coalesce(gate ->> 'key', '')) = 'pinch'
      )
    ) as has_pinch_signal,
    (
      b.harvest_pattern is not null
      or b.days_to_harvest_watch_min is not null
      or b.days_to_harvest_watch_max is not null
      or b.profile_metadata ? 'harvest_start_month_day'
      or b.profile_metadata ? 'harvest_end_month_day'
      or b.profile_metadata ? 'seasonal_harvest_months'
      or b.profile_metadata ? 'harvest_cut_stage'
      or b.profile_metadata ? 'harvest_stage'
      or b.profile_metadata ? 'mature_harvest'
    ) as has_harvest_signal,
    (
      b.clear_offset_days is not null
      or b.profile_metadata ? 'clear_bed_month_day'
      or b.profile_metadata ? 'clear_bed_timing_basis'
      or b.profile_metadata ? 'annual_landscape_clear_rule'
      or b.profile_metadata ? 'working_frost_clear_date'
    ) as has_clear_signal,
    (
      b.decline_signal is not null
      or b.clear_offset_days is not null
      or b.profile_metadata ? 'working_frost_clear_date'
      or b.profile_metadata ? 'clear_bed_month_day'
    ) as has_decline_signal,
    (
      lower(coalesce(b.frost_behavior, '')) like '%winter%'
      or lower(coalesce(b.frost_behavior, '')) like '%overwinter%'
      or lower(coalesce(b.life_cycle, '')) = 'overwintered annual'
    ) as has_winter_signal,
    (
      lower(coalesce(b.default_planting_method, '')) like '%grow_room%'
      or lower(coalesce(b.default_planting_method, '')) like '%indoor%'
      or lower(coalesce(b.default_planting_method, '')) like '%container%'
    ) as controlled_start,
    (
      lower(coalesce(b.default_planting_method, '')) = 'direct_sow'
      or lower(coalesce(b.default_planting_method, '')) = 'direct sow'
    ) as pure_direct_sow,
    (
      lower(coalesce(b.default_planting_method, '')) like '% or %'
      or lower(coalesce(b.default_planting_method, '')) like '%/%'
    ) as mixed_method
  from base b
), compiled as (
  select i.*,
    case i.stage_key
      when 'source_input' then 'required'
      when 'start' then 'required'
      when 'germinate' then
        case
          when i.has_germination_signal then 'required'
          when i.method_lc in ('division','clump','bulb_or_transplant','transplant','start') then 'not_applicable'
          when i.mixed_method then 'conditional'
          else 'unknown'
        end
      when 'seedling_care' then
        case
          when i.controlled_start and i.has_germination_signal then 'required'
          when i.pure_direct_sow then 'not_applicable'
          when i.has_germination_signal then 'conditional'
          when i.method_lc in ('division','clump','bulb_or_transplant','transplant','start') then 'not_applicable'
          else 'unknown'
        end
      when 'pot_up' then
        case
          when i.has_pot_up_signal and i.controlled_start then 'required'
          when i.has_pot_up_signal then 'conditional'
          when i.pure_direct_sow then 'not_applicable'
          when i.controlled_start then 'unknown'
          when i.method_lc in ('division','clump','bulb_or_transplant','transplant','start') then 'not_applicable'
          else 'unknown'
        end
      when 'grow_out' then
        case
          when i.has_pot_up_signal and i.controlled_start then 'required'
          when i.has_pot_up_signal or i.has_transplant_signal then 'conditional'
          when i.pure_direct_sow then 'not_applicable'
          when i.controlled_start then 'unknown'
          else 'not_applicable'
        end
      when 'harden' then
        case
          when i.has_hardening_signal and i.controlled_start then 'required'
          when i.has_hardening_signal then 'conditional'
          when i.pure_direct_sow then 'not_applicable'
          when i.controlled_start or i.method_lc = 'transplant' then 'unknown'
          else 'not_applicable'
        end
      when 'destination' then 'required'
      when 'transplant' then
        case
          when i.controlled_start or i.method_lc = 'transplant' then 'required'
          when i.mixed_method then 'conditional'
          when i.pure_direct_sow then 'not_applicable'
          when i.has_transplant_signal then 'conditional'
          else 'unknown'
        end
      when 'establish' then 'required'
      when 'care_loop' then 'required'
      when 'pinch' then case when i.has_pinch_signal then 'required' else 'unknown' end
      when 'harvest_watch' then case when i.has_harvest_signal then 'required' else 'unknown' end
      when 'harvest_or_service' then case when i.has_harvest_signal then 'required' else 'unknown' end
      when 'decline' then case when i.has_decline_signal then 'required' else 'unknown' end
      when 'terminal_disposition' then case when i.has_clear_signal then 'required' else 'unknown' end
      when 'winter' then
        case
          when i.has_winter_signal then 'required'
          when i.frost_lc = 'killed_by_frost' then 'not_applicable'
          when i.life_cycle_lc like '%perennial%' or i.life_cycle_lc = 'biennial' then 'unknown'
          else 'not_applicable'
        end
      when 'spring_return' then
        case
          when i.has_winter_signal then 'required'
          when i.frost_lc = 'killed_by_frost' then 'not_applicable'
          when i.life_cycle_lc like '%perennial%' or i.life_cycle_lc = 'biennial' then 'unknown'
          else 'not_applicable'
        end
      when 'successor' then 'conditional'
      else 'unknown'
    end as inferred_disposition,
    case i.stage_key
      when 'germinate' then i.days_to_germination_min
      when 'pot_up' then nullif(i.profile_metadata ->> 'pot_up_days_min','')::integer
      when 'harden' then nullif(i.profile_metadata ->> 'hardening_start_days_min','')::integer
      when 'transplant' then nullif(i.profile_metadata ->> 'transplant_ready_days_min','')::integer
      when 'pinch' then nullif(i.profile_metadata ->> 'pinch_days_min','')::integer
      when 'harvest_watch' then i.days_to_harvest_watch_min
      else null
    end as inferred_timing_min_days,
    case i.stage_key
      when 'germinate' then i.days_to_germination_max
      when 'pot_up' then nullif(i.profile_metadata ->> 'pot_up_days_max','')::integer
      when 'harden' then nullif(i.profile_metadata ->> 'hardening_start_days_max','')::integer
      when 'transplant' then nullif(i.profile_metadata ->> 'transplant_ready_days_max','')::integer
      when 'pinch' then nullif(i.profile_metadata ->> 'pinch_days_max','')::integer
      when 'harvest_watch' then i.days_to_harvest_watch_max
      else null
    end as inferred_timing_max_days
  from inferred i
)
select
  c.crop_profile_id,
  c.crop_profile_stable_key,
  c.crop_label,
  c.variety,
  c.life_cycle,
  c.default_planting_method,
  c.stage_key,
  c.stage_order,
  c.stage_label,
  coalesce(c.explicit_disposition, c.inferred_disposition) as disposition,
  coalesce(c.explicit_timing_min_days, c.inferred_timing_min_days) as timing_min_days,
  coalesce(c.explicit_timing_max_days, c.inferred_timing_max_days) as timing_max_days,
  coalesce(c.explicit_trigger_spec, '{}'::jsonb) as trigger_spec,
  coalesce(c.explicit_rule_payload, '{}'::jsonb) as rule_payload,
  case
    when c.explicit_rule_id is not null then 'explicit_rule'
    when c.inferred_disposition = 'unknown' then 'unknown'
    when c.stage_key = 'pinch' and c.has_pinch_signal then 'profile_metadata'
    when c.stage_key in ('pot_up','harden','transplant','harvest_watch','harvest_or_service','decline','terminal_disposition','winter','spring_return')
      and (
        c.has_pot_up_signal or c.has_hardening_signal or c.has_transplant_signal or c.has_harvest_signal
        or c.has_decline_signal or c.has_clear_signal or c.has_winter_signal
      ) then 'profile_metadata'
    else 'profile_shape'
  end as contract_source,
  case when c.explicit_rule_id is not null then c.explicit_confidence else null end as confidence,
  case when c.explicit_rule_id is not null then c.explicit_source else null end as explicit_source,
  case when c.explicit_rule_id is not null then c.explicit_note else null end as note
from compiled c;

revoke all on atlas.v_crop_lifecycle_contract_v1 from anon, authenticated;
grant select on atlas.v_crop_lifecycle_contract_v1 to service_role;

create or replace function atlas.compile_crop_lifecycle_v1(p_crop_profile_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, atlas
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stageKey', c.stage_key,
        'stageOrder', c.stage_order,
        'stageLabel', c.stage_label,
        'disposition', c.disposition,
        'timingMinDays', c.timing_min_days,
        'timingMaxDays', c.timing_max_days,
        'contractSource', c.contract_source,
        'triggerSpec', c.trigger_spec,
        'rulePayload', c.rule_payload
      ) order by c.stage_order
    ),
    '[]'::jsonb
  )
  from atlas.v_crop_lifecycle_contract_v1 c
  where c.crop_profile_id = p_crop_profile_id;
$$;

revoke all on function atlas.compile_crop_lifecycle_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.compile_crop_lifecycle_v1(uuid) to service_role;

-- The final continuity audit view is installed by migration 20260828203222 after evidence refinements.

-- Exact alias repair: these Aug. 8 living transplants are generic mixed zinnias.
insert into atlas.crop_profile_aliases (
  crop_profile_id,
  alias_label,
  alias_variety,
  priority,
  active,
  note
)
select
  cp.id,
  'Zinnia transplants · Aug 8',
  'zinnia',
  20,
  true,
  'Exact living-crop label repair from Elm continuity reconciliation 2026-08-28.'
from atlas.crop_profiles cp
where cp.stable_key = 'zinnia_cut_flower_generic'
  and not exists (
    select 1
    from atlas.crop_profile_aliases a
    where a.crop_profile_id = cp.id
      and lower(a.alias_label) = lower('Zinnia transplants · Aug 8')
      and lower(coalesce(a.alias_variety,'')) = lower('zinnia')
  );

-- Correct the crossed Rocket/Madame Butterfly payload while keeping the future
-- occurrence planned. Seed custody is still allowed to block release later.
update atlas.planned_work_occurrences
set task_payload = jsonb_set(
      task_payload,
      '{note}',
      to_jsonb('Start the Rocket spring succession in 3/4-inch soil blocks. Keep Rocket separate from the other snapdragon series and record the actual seed/block count at sowing.'::text),
      true
    ),
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'continuity_reconciled_at', now(),
      'continuity_reconciliation', 'corrected_cross_crop_instruction_identity',
      'continuity_reconciliation_source', 'owner_approved_property_plan_20260828'
    ),
    updated_at = now()
where farm_id = '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and occurrence_key = 'legacy-task:40e14d01-faa1-4843-a2a6-4e96ef1805a6'
  and state = 'planned';

-- Quarantine obsolete 2027 directions without deleting history. These six
-- occurrences predate and conflict with the current owner-approved property plan.
update atlas.planned_work_occurrences
set state = 'cancelled',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'quarantined_at', now(),
      'quarantined_by', 'crop_lifecycle_reconciliation_20260828',
      'quarantine_reason', 'superseded_by_owner_approved_property_plan_20260828',
      'pre_quarantine_state', state
    ),
    updated_at = now()
where farm_id = '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and id = any (array[
    '414e097f-01b2-4005-81c2-c60ba84e4754'::uuid,
    'de14da78-854c-4c2f-b0e7-2c2806772100'::uuid,
    'b8902867-f771-46d2-932c-31311ba119ee'::uuid,
    '26e59efa-26c3-43d9-b9c8-32c6563c525e'::uuid,
    '10bd235c-39ea-418e-b719-e709901f064e'::uuid,
    'adb7e325-293c-4415-bff0-cc2ab8431d60'::uuid
  ])
  and state in ('planned','eligible');