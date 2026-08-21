-- Production follow-up that removed generated Elm UUID literals from the Venue and Farm Round generators.
-- During source recovery, the dynamic farm/member/owner lookup form was folded directly into
-- 20260821221552_community_thursday_venue_cycle_v1.sql and
-- 20260821222031_farm_round_grouping_v1.sql so a fresh replay never contains the unsafe form.
-- This ledger-preserving migration is intentionally idempotent.
select 1;
