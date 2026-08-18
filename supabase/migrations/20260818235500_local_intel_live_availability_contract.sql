-- Elm Directory: expiring live-availability truth contract
-- Applied to live Noel/Elm Supabase on 2026-08-18.
--
-- This migration deliberately does NOT replay point-in-time Aug 18 availability
-- observations as if they were current at migration time. The table is the durable
-- contract; observations are data with their own observed_at / valid_through windows.
--
-- IMPORTANT REPOSITORY HISTORY NOTE
-- The live local_intel schema predates the local migration history currently present
-- in this repository. This is a forward migration against the existing Elm local_intel
-- baseline; it is not a clean-bootstrap definition of that baseline.

DO $$
BEGIN
  IF to_regclass('local_intel.entities') IS NULL
     OR to_regclass('local_intel.offerings') IS NULL
     OR to_regclass('local_intel.occurrences') IS NULL
     OR to_regclass('local_intel.sources') IS NULL
     OR to_regclass('local_intel.question_gaps') IS NULL
     OR to_regclass('local_intel.outreach_targets') IS NULL THEN
    RAISE EXCEPTION 'Elm local_intel baseline is required before 20260818235500_local_intel_live_availability_contract.sql';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS local_intel.availability_assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL UNIQUE,
  entity_id uuid NOT NULL REFERENCES local_intel.entities(id) ON DELETE CASCADE,
  offering_id uuid REFERENCES local_intel.offerings(id) ON DELETE SET NULL,
  occurrence_id uuid REFERENCES local_intel.occurrences(id) ON DELETE SET NULL,
  availability_kind text NOT NULL,
  state text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_through timestamptz NOT NULL,
  source_id uuid REFERENCES local_intel.sources(id) ON DELETE SET NULL,
  source_kind text NOT NULL,
  confidence text NOT NULL DEFAULT 'reported',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_assertions_valid_window_chk CHECK (valid_through > valid_from)
);

ALTER TABLE local_intel.availability_assertions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS availability_assertions_entity_kind_idx
  ON local_intel.availability_assertions(entity_id, availability_kind, valid_through DESC);
CREATE INDEX IF NOT EXISTS availability_assertions_offering_idx
  ON local_intel.availability_assertions(offering_id)
  WHERE offering_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS availability_assertions_occurrence_idx
  ON local_intel.availability_assertions(occurrence_id)
  WHERE occurrence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS availability_assertions_expiry_idx
  ON local_intel.availability_assertions(valid_through);

COMMENT ON TABLE local_intel.availability_assertions IS
  'Expiring current-state assertions for local availability. Every positive or negative live claim has an explicit observation time and validity window; stale assertions cease to cover live-availability questions automatically.';
COMMENT ON COLUMN local_intel.availability_assertions.availability_kind IS
  'Question-specific state lane such as childcare_openings, appointment_openings, product_inventory, live_location, lesson_openings, market_attendance, floral_inventory, venue_date_availability, room_availability, or u_pick_availability.';
COMMENT ON COLUMN local_intel.availability_assertions.valid_through IS
  'Hard expiry for the assertion. Live truth must never be carried forward indefinitely.';

CREATE OR REPLACE VIEW local_intel.v_current_availability
WITH (security_invoker = true)
AS
WITH ranked AS (
  SELECT a.*,
         row_number() OVER (
           PARTITION BY a.entity_id, a.availability_kind, a.offering_id, a.occurrence_id
           ORDER BY a.observed_at DESC, a.created_at DESC
         ) AS recency_rank
  FROM local_intel.availability_assertions a
  WHERE now() >= a.valid_from
    AND now() < a.valid_through
)
SELECT id,stable_key,entity_id,offering_id,occurrence_id,availability_kind,state,summary,details,
       observed_at,valid_from,valid_through,source_id,source_kind,confidence,metadata,created_at,updated_at
FROM ranked
WHERE recency_rank=1;

CREATE OR REPLACE VIEW local_intel.v_live_availability_gap_state
WITH (security_invoker = true)
AS
SELECT qg.id AS gap_id,
       qg.priority,
       qg.status AS stored_status,
       qg.entity_id,
       e.stable_key AS entity_key,
       e.name AS entity_name,
       qg.metadata->>'availability_kind' AS availability_kind,
       ca.id AS current_assertion_id,
       ca.state AS current_state,
       ca.summary AS current_summary,
       ca.observed_at,
       ca.valid_through,
       CASE
         WHEN qg.status <> 'open' THEN qg.status
         WHEN ca.id IS NOT NULL THEN 'covered'
         ELSE 'open'
       END AS effective_status,
       qg.reason,
       qg.recommended_acquisition,
       qg.metadata
FROM local_intel.question_gaps qg
JOIN local_intel.entities e ON e.id=qg.entity_id
LEFT JOIN LATERAL (
  SELECT a.*
  FROM local_intel.v_current_availability a
  WHERE a.entity_id=qg.entity_id
    AND a.availability_kind=qg.metadata->>'availability_kind'
  ORDER BY a.observed_at DESC
  LIMIT 1
) ca ON true
WHERE qg.question_key='check_availability_now';

-- Classify the current P1 live gaps into durable update lanes. The stored gap remains
-- open. A fresh matching assertion only changes effective_status to covered until it expires.
UPDATE local_intel.question_gaps qg
SET metadata = coalesce(qg.metadata,'{}'::jsonb) || jsonb_build_object(
  'availability_kind', CASE e.stable_key
    WHEN 'first-kids-marshfield' THEN 'childcare_openings'
    WHEN 'animal-medical-center-marshfield' THEN 'new_client_or_appointment_availability'
    WHEN 'artizan-dental-marshfield' THEN 'new_patient_or_appointment_availability'
    WHEN 'b-berry-farms-elkland' THEN 'u_pick_and_farm_product_availability'
    WHEN 'blue-heron-farm-bakery-marshfield' THEN 'product_inventory'
    WHEN 'hartman-farms-marshfield' THEN 'lesson_or_boarding_openings'
    WHEN 'counseling-connections-marshfield' THEN 'new_client_or_appointment_availability'
    WHEN 'down-south-fried-fish-regional' THEN 'live_location'
    WHEN 'goldfinch-creek-farm-bakery-marshfield' THEN 'product_inventory'
    WHEN 'gooseberry-bridge-farm-rogersville' THEN 'u_pick_and_farm_product_availability'
    WHEN 'holiday-inn-express-marshfield' THEN 'room_or_group_block_availability'
    WHEN 'kneading-joy-marshfield' THEN 'live_location_and_product_inventory'
    WHEN 'lace-counseling-center-marshfield' THEN 'new_client_or_appointment_availability'
    WHEN 'lillys-custom-floral-marshfield' THEN 'floral_inventory'
    WHEN 'marshfield-family-dental-care' THEN 'new_patient_or_appointment_availability'
    WHEN 'marshfield-farmers-market-mo' THEN 'market_attendance'
    WHEN 'marshfield-greenhouse' THEN 'product_inventory'
    WHEN 'oacac-marshfield-head-start' THEN 'enrollment_openings'
    WHEN 'oaks-ivy-farm-stables' THEN 'lesson_or_boarding_openings'
    WHEN 'old-earth-acres-sips-marshfield' THEN 'live_location_and_product_inventory'
    WHEN 'sand-ridge-farm-marshfield' THEN 'floral_inventory_and_market_attendance'
    WHEN 'seymour-farmers-market' THEN 'market_attendance'
    WHEN '417-willow-marshfield' THEN 'floral_inventory'
    WHEN 'depot-event-venue-marshfield' THEN 'venue_date_availability'
    WHEN 'dickey-house-marshfield' THEN 'room_availability'
    WHEN 'marshfield-child-development' THEN 'childcare_openings'
    WHEN 'zahn-farms-elkland' THEN 'farm_product_availability_and_market_attendance'
    ELSE 'current_availability'
  END,
  'freshness_contract','expiring_assertion_required',
  'availability_model','local_intel.availability_assertions'
),
updated_at=now()
FROM local_intel.entities e
WHERE qg.entity_id=e.id
  AND qg.question_key='check_availability_now'
  AND qg.priority=1
  AND qg.status='open';

-- Convert remaining effective-open P1 live gaps into explicit acquisition work.
-- A provider-push channel is preferred; otherwise refresh according to volatility.
INSERT INTO local_intel.outreach_targets
(entity_id,target_kind,rationale,proposed_format,priority,status,contact_email,contact_phone,notes,metadata,created_at,updated_at)
SELECT e.id,
       'availability_refresh',
       'Elm has the provider/service/product identity but still lacks a fresh expiring assertion for ' || replace(lg.availability_kind,'_',' ') || '.',
       CASE lg.availability_kind
         WHEN 'childcare_openings' THEN 'Ask current openings by age, waitlist status, part-time/full-time, school-out/summer care, price and preferred refresh cadence.'
         WHEN 'enrollment_openings' THEN 'Ask current enrollment/application openings, eligible ages, waitlist/application timing and preferred refresh cadence.'
         WHEN 'new_client_or_appointment_availability' THEN 'Ask whether new clients are currently being accepted, the current booking path, and whether there is a public way to check the next available appointment without calling.'
         WHEN 'new_patient_or_appointment_availability' THEN 'Ask whether new patients are currently being accepted, the current booking path, and whether there is a public way to check the next available appointment without calling.'
         WHEN 'u_pick_and_farm_product_availability' THEN 'Ask what is available now/this week, public open days/hours, pickup or U-pick rules, weather/crop caveats and the easiest way to receive short availability updates.'
         WHEN 'product_inventory' THEN 'Ask what product categories are actually in stock this week, ordering/pickup details, recurring rhythm and preferred way to send short inventory updates.'
         WHEN 'lesson_or_boarding_openings' THEN 'Ask current riding-lesson and/or boarding openings, ages/experience served, next available start, schedule/pricing and preferred refresh cadence.'
         WHEN 'room_or_group_block_availability' THEN 'Ask for the live booking path, meeting/group-block contact, whether group availability can be checked online, and the best source for event-weekend room status.'
         WHEN 'live_location_and_product_inventory' THEN 'Ask where the business will be this week, what will be available, preorder/pickup options and the easiest way to send location/inventory updates.'
         WHEN 'floral_inventory' THEN 'Ask what fresh floral inventory or bouquet options are available now, same-day pickup/delivery rules, event-order path and preferred refresh cadence.'
         WHEN 'market_attendance' THEN 'Ask the current vendor roster for the next market date, regular vs occasional attendance, what each vendor sells and any preorder/contact links.'
         WHEN 'floral_inventory_and_market_attendance' THEN 'Ask current flower availability, next confirmed market appearance, pickup/preorder options, and preferred cadence for short flower/attendance updates.'
         WHEN 'venue_date_availability' THEN 'Ask for current rental availability mechanism, next open weekday/weekend windows, booking lead time and whether Elm can use a public calendar or short availability feed.'
         WHEN 'room_availability' THEN 'Ask for the current suite/room booking mechanism, whether live dates are publicly visible, and the best direct path for same-week or event-weekend availability.'
         WHEN 'farm_product_availability_and_market_attendance' THEN 'Ask what farm products are available now, pickup/preorder details, next confirmed market attendance and preferred cadence for inventory/attendance updates.'
         ELSE 'Ask for the current live state, how often it changes, and the preferred way Elm should refresh it.'
       END,
       CASE
         WHEN lg.availability_kind IN ('childcare_openings','enrollment_openings','lesson_or_boarding_openings','market_attendance') THEN 99
         WHEN lg.availability_kind IN ('product_inventory','floral_inventory','floral_inventory_and_market_attendance','farm_product_availability_and_market_attendance','live_location_and_product_inventory','u_pick_and_farm_product_availability') THEN 98
         ELSE 97
       END,
       CASE WHEN e.phone IS NOT NULL OR e.email IS NOT NULL THEN 'ready_to_contact' ELSE 'needs_contact_path' END,
       e.email,
       e.phone,
       'Do not convert capacity, general service existence, regular hours or historical schedule into a live yes/no. Every answer must carry an as-of time and expire.',
       jsonb_build_object(
         'availability_kind',lg.availability_kind,
         'recommended_refresh','provider-push preferred; otherwise refresh based on volatility',
         'assertion_table','local_intel.availability_assertions',
         'created_from_gap',lg.gap_id
       ),
       now(),now()
FROM local_intel.v_live_availability_gap_state lg
JOIN local_intel.entities e ON e.id=lg.entity_id
WHERE lg.priority=1
  AND lg.stored_status='open'
  AND lg.effective_status='open'
  AND NOT EXISTS (
    SELECT 1
    FROM local_intel.outreach_targets ot
    WHERE ot.entity_id=e.id
      AND ot.target_kind='availability_refresh'
      AND ot.status IN ('ready_to_contact','contacted','waiting','needs_contact_path')
  );
